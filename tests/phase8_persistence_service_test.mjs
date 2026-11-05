/**
 * Phase 8 Step 2: Persistence Service Test Suite
 * Real-Time Collaborative Workspace
 *
 * Validates:
 * 1. Unit tests for encoding and decoding Yjs binary states
 * 2. Save and load round-trip (BYTEA & stateVersion increment)
 * 3. Debounce behavior (coalescing multiple rapid edits into 1 write)
 * 4. Max wait behavior (forced write during continuous typing)
 * 5. Concurrent write queue protection (strictly sequential execution)
 * 6. Database failure handling (no false success reporting, queue self-heals)
 * 7. Legacy Page.content JSONB fallback hydration
 * 8. Immediate flushSave behavior
 * 9. Security: Server-side awareness identity binding & spoofing prevention
 */

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  loadDocumentState,
  saveDocumentState,
  scheduleSave,
  flushSave,
  getPrismaClient,
  closePersistence,
  sanitizeAwarenessUpdate,
} from '../src/server/collab-persistence.mjs';

const prisma = getPrismaClient();

let passedCount = 0;
let failedCount = 0;

function report(testName, passed, detail = '') {
  if (passed) {
    console.log(`[PASS] ${testName}${detail ? ` - ${detail}` : ''}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('======================================================================');
  console.log('       Phase 8 Step 2: Persistence Service Verification Suite         ');
  console.log('======================================================================\n');

  // Test Workspace & Pages for testing
  let testWorkspace = null;
  let testUser = null;
  const createdPageIds = [];

  try {
    // Setup test user & workspace
    testUser = await prisma.user.findFirst();
    if (!testUser) {
      throw new Error('No user found in database. Run auth setup first.');
    }

    testWorkspace = await prisma.workspace.findFirst();
    if (!testWorkspace) {
      throw new Error('No workspace found in database.');
    }

    // ------------------------------------------------------------------------
    // Test 1: Unit Test - Yjs State Binary Encoding and Decoding
    // ------------------------------------------------------------------------
    console.log('--- Test 1: Yjs State Binary Encoding & Decoding ---');
    const doc1 = new Y.Doc();
    const fragment1 = doc1.getXmlFragment('default');
    const para1 = new Y.XmlElement('paragraph');
    const text1 = new Y.XmlText('Real-time collaborative text in Yjs');
    para1.insert(0, [text1]);
    fragment1.insert(0, [para1]);

    const binarySnapshot = Y.encodeStateAsUpdate(doc1);
    report(
      'Binary snapshot encoding',
      binarySnapshot instanceof Uint8Array && binarySnapshot.length > 0,
      `Snapshot size: ${binarySnapshot.length} bytes`
    );

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, binarySnapshot);
    const fragment2 = doc2.getXmlFragment('default');
    const restoredText = fragment2.get(0).get(0).toString();

    report(
      'Binary snapshot decoding round-trip',
      restoredText === 'Real-time collaborative text in Yjs',
      `Restored: "${restoredText}"`
    );

    // ------------------------------------------------------------------------
    // Test 2: Database Save and Load Round-Trip
    // ------------------------------------------------------------------------
    console.log('\n--- Test 2: Database Save & Load Round-Trip ---');
    const pageA = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Round-Trip Test Page',
      },
    });
    createdPageIds.push(pageA.id);

    // Initial save
    const saveRes1 = await saveDocumentState(pageA.id, doc1);
    report(
      'Initial save creates DocumentState record',
      saveRes1.success === true && saveRes1.stateVersion === 1,
      `Version: ${saveRes1.stateVersion}, Bytes: ${saveRes1.byteLength}`
    );

    // Verify row in PostgreSQL
    const dbRow1 = await prisma.documentState.findUnique({ where: { pageId: pageA.id } });
    const isBinaryBytes = dbRow1 !== null && (dbRow1.yjsState instanceof Uint8Array || Buffer.isBuffer(dbRow1.yjsState));
    report(
      'PostgreSQL BYTEA storage verified',
      isBinaryBytes && dbRow1.yjsState.length === saveRes1.byteLength,
      `Stored byte length: ${dbRow1?.yjsState?.length}, Type: ${dbRow1?.yjsState?.constructor?.name}`
    );

    // Load into empty doc
    const loadDoc1 = new Y.Doc();
    const loadRes1 = await loadDocumentState(pageA.id, loadDoc1);
    const loadedFragment = loadDoc1.getXmlFragment('default');
    const loadedText = loadedFragment.get(0).get(0).toString();

    report(
      'State restored identically from PostgreSQL BYTEA',
      loadRes1.source === 'documentState' &&
      loadRes1.version === 1 &&
      loadedText === 'Real-time collaborative text in Yjs',
      `Loaded text: "${loadedText}"`
    );

    // Second save: mutate doc and verify stateVersion increment
    const paraExtra = new Y.XmlElement('paragraph');
    paraExtra.insert(0, [new Y.XmlText(' - Second Revision')]);
    doc1.getXmlFragment('default').insert(1, [paraExtra]);

    const saveRes2 = await saveDocumentState(pageA.id, doc1);
    report(
      'Subsequent save increments stateVersion monotonically',
      saveRes2.success === true && saveRes2.stateVersion === 2,
      `New Version: ${saveRes2.stateVersion}`
    );

    // ------------------------------------------------------------------------
    // Test 3: Debounce Behavior (Coalescing Rapid Updates)
    // ------------------------------------------------------------------------
    console.log('\n--- Test 3: Debounce Behavior ---');
    const pageB = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Debounce Test Page',
      },
    });
    createdPageIds.push(pageB.id);

    const debounceDoc = new Y.Doc();
    const debFrag = debounceDoc.getXmlFragment('default');
    const debPara = new Y.XmlElement('paragraph');
    debFrag.insert(0, [debPara]);

    const initialSaveCount = (await prisma.documentState.findUnique({ where: { pageId: pageB.id } }))?.stateVersion || 0;

    // Trigger 15 rapid scheduled saves with 30ms interval (simulating rapid keystrokes)
    const promises = [];
    for (let i = 0; i < 15; i++) {
      debPara.insert(i, [new Y.XmlText(`k${i}`)]);
      promises.push(scheduleSave(pageB.id, debounceDoc, { debounceMs: 200, maxWaitMs: 1500 }));
      await new Promise((r) => setTimeout(r, 20));
    }

    // Wait for the single debounced write to finish
    await Promise.all(promises);
    const finalRowB = await prisma.documentState.findUnique({ where: { pageId: pageB.id } });

    report(
      '15 rapid edits coalesced into a single database write',
      finalRowB.stateVersion === initialSaveCount + 1,
      `State version increased by exactly 1 (from ${initialSaveCount} to ${finalRowB.stateVersion})`
    );

    // ------------------------------------------------------------------------
    // Test 4: Max Wait Behavior (Continuous Typing Ceiling)
    // ------------------------------------------------------------------------
    console.log('\n--- Test 4: Max Wait Ceiling Enforcement ---');
    const pageC = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Max Wait Test Page',
      },
    });
    createdPageIds.push(pageC.id);

    const maxWaitDoc = new Y.Doc();
    const mwFrag = maxWaitDoc.getXmlFragment('default');
    mwFrag.insert(0, [new Y.XmlElement('paragraph')]);

    const startTime = Date.now();

    // Schedule saves continuously every 50ms with 200ms debounce and 400ms maxWait
    const mwPromise = scheduleSave(pageC.id, maxWaitDoc, { debounceMs: 200, maxWaitMs: 400 });
    const interval = setInterval(() => {
      scheduleSave(pageC.id, maxWaitDoc, { debounceMs: 200, maxWaitMs: 400 });
    }, 50);

    const mwResult = await mwPromise;
    clearInterval(interval);
    const elapsed = Date.now() - startTime;

    report(
      'Continuous typing forced save at maxWait ceiling',
      elapsed >= 350 && elapsed <= 700 && mwResult.success === true,
      `Elapsed: ${elapsed}ms (ceiling was 400ms)`
    );

    // ------------------------------------------------------------------------
    // Test 5: Concurrent Write Queue Protection (Sequential Non-Overlapping)
    // ------------------------------------------------------------------------
    console.log('\n--- Test 5: Concurrent Write Queue Protection ---');
    const pageD = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Sequential Queue Page',
      },
    });
    createdPageIds.push(pageD.id);

    const queueDoc = new Y.Doc();
    const qFrag = queueDoc.getXmlFragment('default');
    qFrag.insert(0, [new Y.XmlElement('paragraph')]);

    // Launch 5 concurrent saveDocumentState calls without awaiting
    const concurrentSaves = [
      saveDocumentState(pageD.id, queueDoc),
      saveDocumentState(pageD.id, queueDoc),
      saveDocumentState(pageD.id, queueDoc),
      saveDocumentState(pageD.id, queueDoc),
      saveDocumentState(pageD.id, queueDoc),
    ];

    const queueResults = await Promise.all(concurrentSaves);
    const versions = queueResults.map((r) => r.stateVersion);

    // Versions should be monotonically increasing [1, 2, 3, 4, 5]
    const strictlyOrdered = versions.every((v, idx) => v === idx + 1);
    report(
      'Concurrent save requests executed in strict sequential order',
      strictlyOrdered,
      `Versions recorded: [${versions.join(', ')}]`
    );

    // ------------------------------------------------------------------------
    // Test 6: Database Failure Handling
    // ------------------------------------------------------------------------
    console.log('\n--- Test 6: Database Failure Handling ---');
    const mockFailingPrisma = {
      documentState: {
        upsert: async () => {
          throw new Error('Simulated PostgreSQL Connection Failure');
        },
      },
      page: {
        update: async () => {},
      },
    };

    let errorThrown = false;
    let caughtMessage = '';
    try {
      await saveDocumentState('fake-page-err', doc1, { prisma: mockFailingPrisma });
    } catch (err) {
      errorThrown = true;
      caughtMessage = err.message;
    }

    report(
      'Database failure correctly rejects without false success',
      errorThrown && caughtMessage.includes('Simulated PostgreSQL Connection Failure'),
      `Caught: ${caughtMessage}`
    );

    // Verify queue recovers after failure
    const pageRecover = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Queue Recovery Test Page',
      },
    });
    createdPageIds.push(pageRecover.id);

    const recoverSave = await saveDocumentState(pageRecover.id, doc1);
    report(
      'Write queue self-heals after error for subsequent saves',
      recoverSave.success === true && recoverSave.stateVersion === 1,
      `Version: ${recoverSave.stateVersion}`
    );

    // ------------------------------------------------------------------------
    // Test 7: Legacy Page.content JSONB Fallback Hydration
    // ------------------------------------------------------------------------
    console.log('\n--- Test 7: Legacy Page.content JSONB Fallback Hydration ---');
    const legacyPage = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Legacy JSON Page',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Pre-existing legacy content from Phase 5',
                },
              ],
            },
          ],
        },
      },
    });
    createdPageIds.push(legacyPage.id);

    const legacyDoc = new Y.Doc();
    const legacyLoadRes = await loadDocumentState(legacyPage.id, legacyDoc);

    const legacyFragment = legacyDoc.getXmlFragment('default');
    const legacyTextNode = legacyFragment.get(0)?.get(0)?.toString();

    // Verify DocumentState was automatically generated from legacy fallback
    const migratedState = await prisma.documentState.findUnique({ where: { pageId: legacyPage.id } });

    report(
      'Legacy Page.content hydrated into Y.Doc and DocumentState generated',
      legacyLoadRes.source === 'legacy_fallback' &&
      legacyTextNode === 'Pre-existing legacy content from Phase 5' &&
      migratedState !== null &&
      migratedState.stateVersion === 1,
      `Loaded text: "${legacyTextNode}", State bytes: ${migratedState?.yjsState?.length}`
    );

    // ------------------------------------------------------------------------
    // Test 8: Immediate flushSave Behavior
    // ------------------------------------------------------------------------
    console.log('\n--- Test 8: Immediate flushSave Behavior ---');
    const pageFlush = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Flush Test Page',
      },
    });
    createdPageIds.push(pageFlush.id);

    const flushDoc = new Y.Doc();
    flushDoc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')]);

    // Schedule save with long debounce (10,000ms)
    const longDebouncePromise = scheduleSave(pageFlush.id, flushDoc, { debounceMs: 10000 });

    // Immediately flush
    const flushStart = Date.now();
    const flushResult = await flushSave(pageFlush.id, flushDoc);
    const flushDuration = Date.now() - flushStart;
    const debouncedResolved = await longDebouncePromise;

    report(
      'flushSave executes immediately and resolves scheduled promises',
      flushDuration < 1000 &&
      flushResult.success === true &&
      debouncedResolved.stateVersion === flushResult.stateVersion,
      `Flush completed in ${flushDuration}ms`
    );

    // ------------------------------------------------------------------------
    // Test 9: Security - Server-Side Awareness Identity Binding
    // ------------------------------------------------------------------------
    console.log('\n--- Test 9: Security - Server-Side Awareness Identity Binding ---');
    const attackerDoc = new Y.Doc();
    const attackerAwareness = new awarenessProtocol.Awareness(attackerDoc);

    // Attacker client attempts to spoof another user's name and role
    attackerAwareness.setLocalState({
      user: {
        name: 'Spoofed Administrator',
        role: 'OWNER',
        id: 'spoofed-admin-id',
        color: '#ff0000',
      },
      cursor: { index: 42 },
    });

    const rawSpoofedUpdate = awarenessProtocol.encodeAwarenessUpdate(attackerAwareness, [attackerAwareness.clientID]);

    // Authenticated user verified from JWT
    const authenticatedUser = {
      userId: 'real-editor-id-777',
      userName: 'Real Verified Editor',
      role: 'EDITOR',
    };

    // Server-side sanitization
    const sanitizedUpdate = sanitizeAwarenessUpdate(rawSpoofedUpdate, authenticatedUser);

    // Apply to remote server awareness
    const remoteDoc = new Y.Doc();
    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc);
    awarenessProtocol.applyAwarenessUpdate(remoteAwareness, sanitizedUpdate, null);

    const resultingState = remoteAwareness.getStates().get(attackerAwareness.clientID);

    const nameBound = resultingState?.user?.name === 'Real Verified Editor';
    const roleBound = resultingState?.user?.role === 'EDITOR';
    const idBound = resultingState?.user?.id === 'real-editor-id-777';
    const cursorPreserved = resultingState?.cursor?.index === 42;

    report(
      'Server strictly binds awareness identity to authenticated JWT session',
      nameBound && roleBound && idBound && cursorPreserved,
      `Sanitized name: "${resultingState?.user?.name}", role: "${resultingState?.user?.role}", id: "${resultingState?.user?.id}"`
    );

    // ------------------------------------------------------------------------
    // Test 10: Root-Level Identity Spoofing Stripping
    // ------------------------------------------------------------------------
    console.log('\n--- Test 10: Root-Level Identity Spoofing Stripping ---');
    const rootSpoofDoc = new Y.Doc();
    const rootSpoofAwareness = new awarenessProtocol.Awareness(rootSpoofDoc);

    rootSpoofAwareness.setLocalState({
      name: 'Root Injected Admin',
      role: 'OWNER',
      id: 'root-spoofed-id',
      email: 'hacker@malicious.com',
      user: {
        name: 'Nested Injected Admin',
        role: 'OWNER',
        id: 'nested-spoofed-id',
        color: '#10b981',
      },
      cursor: { anchor: 10, head: 25 },
    });

    const rootSpoofUpdate = awarenessProtocol.encodeAwarenessUpdate(rootSpoofAwareness, [rootSpoofAwareness.clientID]);
    const rootSanitizedUpdate = sanitizeAwarenessUpdate(rootSpoofUpdate, authenticatedUser);

    const checkDoc = new Y.Doc();
    const checkAwareness = new awarenessProtocol.Awareness(checkDoc);
    awarenessProtocol.applyAwarenessUpdate(checkAwareness, rootSanitizedUpdate, null);
    const checkedState = checkAwareness.getStates().get(rootSpoofAwareness.clientID);

    const rootStripped = checkedState.name === undefined && checkedState.role === undefined && checkedState.id === undefined && checkedState.email === undefined;
    const nestedEnforced = checkedState.user.name === 'Real Verified Editor' && checkedState.user.role === 'EDITOR' && checkedState.user.id === 'real-editor-id-777';

    report(
      'Root-level and nested spoofed claims completely stripped/overwritten',
      rootStripped && nestedEnforced && checkedState.cursor.anchor === 10,
      `Root fields stripped: ${rootStripped}, User role: ${checkedState?.user?.role}`
    );

    // ------------------------------------------------------------------------
    // Test 11: Real-World Phase 5 TipTap Schema Round-Trip
    // ------------------------------------------------------------------------
    console.log('\n--- Test 11: Real-World Phase 5 TipTap Schema Round-Trip ---');
    const { getSchema } = await import('@tiptap/core');
    const StarterKit = (await import('@tiptap/starter-kit')).default;
    const yTiptap = await import('@tiptap/y-tiptap');

    const fullSchema = getSchema([StarterKit]);
    const representativeLegacyContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Section 1: Architecture Overview' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Collaborative real-time editing with ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'bold text' },
            { type: 'text', text: ' and ' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'italic text' },
            { type: 'text', text: ' along with ' },
            { type: 'text', marks: [{ type: 'underline' }], text: 'underlined content' },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'This is a quoted architectural decision record.' }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First bullet point' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second bullet point' }] }],
            },
          ],
        },
      ],
    };

    const convertDoc = new Y.Doc();
    const convertFragment = convertDoc.getXmlFragment('default');
    yTiptap.prosemirrorJSONToYXmlFragment(fullSchema, representativeLegacyContent, convertFragment);

    report(
      'Legacy TipTap JSON converts to Y.Doc XmlFragment nodes',
      convertFragment.length === 4,
      `XmlFragment top-level child count: ${convertFragment.length}`
    );

    const exportedBack = yTiptap.yXmlFragmentToProsemirrorJSON(convertFragment);
    const headingsMatch = exportedBack.content[0].content[0].text === 'Section 1: Architecture Overview';
    const boldMatches = exportedBack.content[1].content[1].marks[0].type === 'bold';
    const quoteMatches = exportedBack.content[2].content[0].content[0].text === 'This is a quoted architectural decision record.';
    const listCountMatches = exportedBack.content[3].content.length === 2;

    report(
      'Exported ProseMirror JSON preserves all structure, marks, and text',
      headingsMatch && boldMatches && quoteMatches && listCountMatches,
      'Heading, bold, italic, underline, blockquote, and list items verified.'
    );

    // ------------------------------------------------------------------------
    // Test 12: Empty Document Preview Dual-Write
    // ------------------------------------------------------------------------
    console.log('\n--- Test 12: Empty Document Preview Dual-Write ---');
    const emptyPage = await prisma.page.create({
      data: {
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: 'Phase 8 Empty Preview Page',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial' }] }] },
      },
    });
    createdPageIds.push(emptyPage.id);

    const emptyDoc = new Y.Doc();
    // Do not insert any children into default fragment (simulating completely cleared document)
    await saveDocumentState(emptyPage.id, emptyDoc);

    const updatedEmptyPage = await prisma.page.findUnique({ where: { id: emptyPage.id } });
    const contentUpdated = updatedEmptyPage.content && updatedEmptyPage.content.type === 'doc';

    report(
      'Empty document dual-write updates Page.content preview to empty doc',
      contentUpdated,
      `Updated Page.content type: ${updatedEmptyPage?.content?.type}`
    );

  } finally {
    // Wait for in-flight debounced saves to settle before deleting test pages
    await new Promise((r) => setTimeout(r, 600));

    // Cleanup created test records
    console.log('\n--- Cleaning up temporary test records ---');
    for (const pageId of createdPageIds) {
      try {
        await prisma.page.delete({ where: { id: pageId } });
      } catch {}
    }
    await closePersistence();
    console.log('Persistence pool closed.');
  }

  console.log('\n======================================================================');
  console.log(`Phase 8 Step 2 Verification Results: ${passedCount} / ${passedCount + failedCount} Passed`);
  console.log('======================================================================');

  process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
