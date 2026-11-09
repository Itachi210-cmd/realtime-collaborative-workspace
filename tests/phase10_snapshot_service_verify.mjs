/**
 * Phase 10 Step 3: Version Snapshot Service Unit & Integration Verification Suite
 *
 * Verifies:
 * 1. Plain text extraction and deterministic word count calculation.
 * 2. Binary Yjs snapshot capture and round-trip state reconstruction.
 * 3. Dual storage of binary Yjs state (BYTEA) and TipTap preview JSON (JSONB).
 * 4. Manual snapshots (metadata, createdBy relation, isAutomatic: false).
 * 5. Automatic recovery snapshots (isAutomatic: true, trigger action label).
 * 6. Reverse-chronological listing (newest first, lightweight summary without BYTEA).
 * 7. Single snapshot preview retrieval with strict cross-page isolation.
 * 8. Coordination with active in-memory rooms and persistence write flush.
 * 9. Atomic error handling on invalid inputs.
 */

import path from 'path';
import fs from 'fs';
import assert from 'assert';
import * as Y from 'yjs';
import * as yTiptap from '@tiptap/y-tiptap';
import {
  getPrismaClient,
  saveDocumentState,
  closePersistence,
} from '../src/server/collab-persistence.mjs';
import {
  createVersionSnapshot,
  createRecoverySnapshot,
  listVersionSnapshots,
  getVersionSnapshot,
  extractTextFromProseMirror,
  calculateWordCount,
  getActiveRoomDoc,
} from '../src/server/version-snapshot-service.mjs';

function loadEnv() {
  const envFiles = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const k = trimmed.substring(0, eq).trim();
          let v = trimmed.substring(eq + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }
}
loadEnv();

const prisma = getPrismaClient();

// Helper to construct a TipTap / ProseMirror fragment in a Y.Doc
function populateDocWithSampleContent(doc, textContent) {
  const fragment = doc.getXmlFragment('default');
  const p = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, textContent);
  p.insert(0, [text]);
  fragment.insert(0, [p]);
}

async function runTests() {
  console.log('\n=== Phase 10 Step 3: Version Snapshot Service Verification ===\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}`);
        failed++;
      }
    })();
  }

  // Test setup variables
  const timestamp = Date.now();
  const testUserId = `test-user-snap-${timestamp}`;
  const testWorkspaceId = `test-ws-snap-${timestamp}`;
  const testPageId1 = `test-page-snap-1-${timestamp}`;
  const testPageId2 = `test-page-snap-2-${timestamp}`;

  try {
    // 0. Seed test fixtures in database
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `snapshot-test-${timestamp}@example.com`,
        name: 'Snapshot Tester',
        passwordHash: 'dummy-hash',
      },
    });

    await prisma.workspace.create({
      data: {
        id: testWorkspaceId,
        name: 'Snapshot Test Workspace',
        ownerId: testUserId,
      },
    });

    await prisma.page.createMany({
      data: [
        {
          id: testPageId1,
          workspaceId: testWorkspaceId,
          title: 'Snapshot Test Page 1',
          createdById: testUserId,
        },
        {
          id: testPageId2,
          workspaceId: testWorkspaceId,
          title: 'Snapshot Test Page 2',
          createdById: testUserId,
        },
      ],
    });

    // TEST 1: Plain text extraction & word count
    await test('1. Deterministic plain-text extraction and word count calculation', async () => {
      assert.strictEqual(extractTextFromProseMirror(null), '');
      assert.strictEqual(calculateWordCount(null), 0);

      const sampleAst = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            content: [{ type: 'text', text: 'Architecture Design Document' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Real-time collaborative workspace with CRDT synchronization.' },
            ],
          },
        ],
      };

      const extracted = extractTextFromProseMirror(sampleAst);
      assert.ok(extracted.includes('Architecture Design Document'));
      assert.ok(extracted.includes('CRDT synchronization'));

      const count = calculateWordCount(sampleAst);
      // "Architecture Design Document Real-time collaborative workspace with CRDT synchronization." -> 9 words
      assert.strictEqual(count, 9);
    });

    // TEST 2: Manual snapshot creation with Y.Doc and TipTap preview
    let snapshot1 = null;
    await test('2. Manual snapshot creation with dual binary Yjs and TipTap JSON storage', async () => {
      const doc = new Y.Doc();
      populateDocWithSampleContent(doc, 'Hello Phase 10 Version Snapshots!');

      snapshot1 = await createVersionSnapshot(testPageId1, {
        userId: testUserId,
        label: 'Initial Architecture Draft',
        description: 'First manual version snapshot created by author.',
        isAutomatic: false,
        doc,
      });

      assert.ok(snapshot1.id, 'Snapshot must have a generated ID');
      assert.strictEqual(snapshot1.pageId, testPageId1);
      assert.strictEqual(snapshot1.createdById, testUserId);
      assert.strictEqual(snapshot1.label, 'Initial Architecture Draft');
      assert.strictEqual(snapshot1.description, 'First manual version snapshot created by author.');
      assert.strictEqual(snapshot1.isAutomatic, false);
      assert.ok(snapshot1.yjsState instanceof Buffer || snapshot1.yjsState instanceof Uint8Array, 'yjsState must be a Buffer');
      assert.ok(snapshot1.yjsState.length > 0, 'yjsState must not be empty');
      assert.ok(snapshot1.content, 'Snapshot must include TipTap content preview JSON');
      assert.strictEqual(snapshot1.wordCount, 5, 'Word count must be 5');
      assert.ok(snapshot1.createdBy, 'createdBy relation must be populated');
      assert.strictEqual(snapshot1.createdBy.id, testUserId);
      assert.strictEqual(snapshot1.createdBy.name, 'Snapshot Tester');

      doc.destroy();
    });

    // TEST 3: Binary Yjs state round-trip reconstruction
    await test('3. Binary Yjs state round-trip verification', async () => {
      // Fetch fresh record directly from DB
      const dbRecord = await prisma.versionSnapshot.findUnique({
        where: { id: snapshot1.id },
      });
      assert.ok(dbRecord, 'Record must exist in DB');

      // Reconstruct fresh Y.Doc from stored binary update
      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, dbRecord.yjsState);

      const fragment = restoredDoc.getXmlFragment('default');
      const restoredJson = yTiptap.yXmlFragmentToProsemirrorJSON(fragment);
      const text = extractTextFromProseMirror(restoredJson);

      assert.strictEqual(text.trim(), 'Hello Phase 10 Version Snapshots!');
      restoredDoc.destroy();
    });

    // TEST 4: Automatic recovery snapshot creation
    let recoverySnapshot = null;
    await test('4. Automatic recovery snapshot with default label and isAutomatic: true', async () => {
      const doc = new Y.Doc();
      populateDocWithSampleContent(doc, 'Content before dangerous restore operation');

      recoverySnapshot = await createRecoverySnapshot(testPageId1, {
        userId: testUserId,
        triggerAction: 'restore',
        doc,
      });

      assert.ok(recoverySnapshot.id);
      assert.strictEqual(recoverySnapshot.isAutomatic, true);
      assert.strictEqual(recoverySnapshot.label, 'Automatic recovery snapshot before restore');
      assert.strictEqual(recoverySnapshot.createdById, testUserId);

      doc.destroy();
    });

    // TEST 5: Snapshot creation from persisted database state (no in-memory doc provided)
    let snapshotFromDb = null;
    await test('5. Snapshot creation fallback from persisted document state in PostgreSQL', async () => {
      // First save state into document_states
      const sourceDoc = new Y.Doc();
      populateDocWithSampleContent(sourceDoc, 'Persisted document content loaded from database');
      await saveDocumentState(testPageId1, sourceDoc);
      sourceDoc.destroy();

      // Create snapshot without providing doc
      snapshotFromDb = await createVersionSnapshot(testPageId1, {
        userId: testUserId,
        label: 'Persisted State Snapshot',
        isAutomatic: false,
      });

      assert.ok(snapshotFromDb.id);
      assert.strictEqual(snapshotFromDb.label, 'Persisted State Snapshot');
      assert.ok(snapshotFromDb.content);
      const text = extractTextFromProseMirror(snapshotFromDb.content);
      assert.strictEqual(text.trim(), 'Persisted document content loaded from database');
    });

    // TEST 6: Reverse-chronological listing (newest first, lightweight)
    await test('6. listVersionSnapshots returns newest first and omits heavy binary yjsState', async () => {
      const list = await listVersionSnapshots(testPageId1);
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 3, `Expected at least 3 snapshots, got ${list.length}`);

      // Verify newest first
      for (let i = 0; i < list.length - 1; i++) {
        const current = new Date(list[i].createdAt).getTime();
        const next = new Date(list[i + 1].createdAt).getTime();
        assert.ok(current >= next, `Snapshots must be ordered newest first: index ${i} (${current}) vs index ${i+1} (${next})`);
      }

      // Verify binary yjsState is NOT returned in list
      for (const item of list) {
        assert.strictEqual(item.yjsState, undefined, 'yjsState must be excluded from listing payload');
        assert.ok(item.id);
        assert.ok(item.pageId);
        assert.ok(item.createdAt);
      }
    });

    // TEST 7: Single snapshot retrieval and cross-page isolation
    await test('7. getVersionSnapshot retrieves preview content and enforces page isolation', async () => {
      // Correct page and ID
      const single = await getVersionSnapshot(testPageId1, snapshot1.id);
      assert.ok(single);
      assert.strictEqual(single.id, snapshot1.id);
      assert.ok(single.content, 'Single retrieval must include content JSON preview');
      assert.strictEqual(single.label, 'Initial Architecture Draft');

      // Cross-page isolation: querying with testPageId2 must return null
      const crossPage = await getVersionSnapshot(testPageId2, snapshot1.id);
      assert.strictEqual(crossPage, null, 'Must return null when snapshot pageId does not match queried pageId');

      // Non-existent snapshot ID must return null
      const nonExistent = await getVersionSnapshot(testPageId1, 'non-existent-snapshot-cuid');
      assert.strictEqual(nonExistent, null);
    });

    // TEST 8: Coordination with active room registry (globalThis.__collabRooms)
    await test('8. Active room registry coordination and persistence flush prior to snapshot', async () => {
      const activeDoc = new Y.Doc();
      populateDocWithSampleContent(activeDoc, 'Live active in-memory room content');

      // Mock active room in globalThis.__collabRooms
      if (!globalThis.__collabRooms) {
        globalThis.__collabRooms = new Map();
      }
      globalThis.__collabRooms.set(testPageId2, {
        doc: activeDoc,
        isDestroyed: false,
      });

      try {
        const activeRoomDoc = getActiveRoomDoc(testPageId2);
        assert.strictEqual(activeRoomDoc, activeDoc, 'getActiveRoomDoc must return the registered room doc');

        const activeSnapshot = await createVersionSnapshot(testPageId2, {
          userId: testUserId,
          label: 'Active Room Snapshot',
        });

        assert.ok(activeSnapshot);
        const text = extractTextFromProseMirror(activeSnapshot.content);
        assert.strictEqual(text.trim(), 'Live active in-memory room content');
      } finally {
        globalThis.__collabRooms.delete(testPageId2);
        activeDoc.destroy();
      }
    });

    // TEST 9: Error handling on invalid parameters
    await test('9. Atomic validation & error handling for invalid arguments', async () => {
      await assert.rejects(
        async () => {
          await createVersionSnapshot(null);
        },
        /Invalid pageId/,
        'Should reject invalid pageId'
      );

      await assert.rejects(
        async () => {
          await listVersionSnapshots('');
        },
        /Invalid pageId/,
        'Should reject empty pageId in listVersionSnapshots'
      );
    });

  } finally {
    // Teardown test fixtures
    console.log('\nCleaning up test fixtures...');
    try {
      await prisma.versionSnapshot.deleteMany({
        where: { pageId: { in: [testPageId1, testPageId2] } },
      });
      await prisma.documentState.deleteMany({
        where: { pageId: { in: [testPageId1, testPageId2] } },
      });
      await prisma.page.deleteMany({
        where: { id: { in: [testPageId1, testPageId2] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: testWorkspaceId },
      });
      await prisma.user.deleteMany({
        where: { id: testUserId },
      });
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }
    await closePersistence();
  }

  console.log(`\n==================================================`);
  console.log(`Snapshot Service Tests: ${passed} passed, ${failed} failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
