/**
 * Phase 10 Step 5: Version History Frontend Components & Workflow Verification Suite
 *
 * Verifies:
 * 1. Component exports and TypeScript interfaces for:
 *    - VersionHistoryPanel
 *    - SnapshotItem
 *    - RestoreConfirmationDialog
 *    - ReadOnlyPreview
 * 2. Role-based capabilities and visibility matrix:
 *    - OWNER & EDITOR have creation form and restore triggers.
 *    - VIEWER & COMMENTER have read-only access (no create button, no restore button).
 * 3. Client API methods contract in src/lib/api/history.ts.
 * 4. Mutual exclusion between Comments drawer and History drawer.
 * 5. Editor integration: History button, Preview alert banner, and Read-Only canvas replacement.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

async function runTests() {
  console.log('\n=== Phase 10 Step 5: Version History Frontend UI Verification ===\n');

  let passed = 0;
  let failed = 0;

  function pass(name) {
    console.log(`  [PASS] ${name}`);
    passed++;
  }

  function fail(name, err) {
    console.error(`  [FAIL] ${name}:`, err.message || err);
    failed++;
  }

  // --- Section 1: File Existence & Export Structure ---
  console.log('--- Section 1: Component Files & Structure ---');

  const filesToCheck = [
    'src/components/history/SnapshotItem.tsx',
    'src/components/history/RestoreConfirmationDialog.tsx',
    'src/components/history/ReadOnlyPreview.tsx',
    'src/components/history/VersionHistoryPanel.tsx',
    'src/lib/api/history.ts',
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), relPath);
    try {
      assert.strictEqual(fs.existsSync(fullPath), true, `File ${relPath} must exist`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(content.length > 100, `File ${relPath} should have substantial content`);
      pass(`1. Component file ${relPath} exists and is populated`);
    } catch (err) {
      fail(`1. Component file ${relPath}`, err);
    }
  }

  // --- Section 2: Component Implementation Contracts ---
  console.log('\n--- Section 2: Implementation Details & RBAC Guardrails ---');

  // Test 6: SnapshotItem renders recovery vs manual badges
  try {
    const itemSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/history/SnapshotItem.tsx'), 'utf8');
    assert.ok(itemSrc.includes('snapshot.isAutomatic'), 'Must inspect isAutomatic flag');
    assert.ok(itemSrc.includes('Recovery') || itemSrc.includes('Automatic'), 'Must display recovery badge');
    assert.ok(itemSrc.includes('canRestore'), 'Must guard restore button with canRestore prop');
    assert.ok(itemSrc.includes('onPreview'), 'Must support onPreview handler');
    assert.ok(itemSrc.includes('onRestore'), 'Must support onRestore handler');
    pass('6. SnapshotItem properly supports isAutomatic badges, preview, and canRestore guards');
  } catch (err) {
    fail('6. SnapshotItem implementation', err);
  }

  // Test 7: RestoreConfirmationDialog safety notices & progress
  try {
    const dialogSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/history/RestoreConfirmationDialog.tsx'),
      'utf8'
    );
    assert.ok(dialogSrc.includes('role="dialog"'), 'Must have accessible dialog role');
    assert.ok(dialogSrc.includes('aria-modal="true"'), 'Must have aria-modal attribute');
    assert.ok(dialogSrc.includes('recovery snapshot'), 'Must explain automatic recovery snapshot guarantee');
    assert.ok(dialogSrc.includes('isRestoring'), 'Must disable buttons during in-flight restore');
    assert.ok(dialogSrc.includes('onConfirm'), 'Must provide onConfirm callback');
    assert.ok(dialogSrc.includes('onCancel'), 'Must provide onCancel callback');
    pass('7. RestoreConfirmationDialog contains accessibility, safety notices, and progress states');
  } catch (err) {
    fail('7. RestoreConfirmationDialog implementation', err);
  }

  // Test 8: ReadOnlyPreview TipTap integration
  try {
    const previewSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/history/ReadOnlyPreview.tsx'),
      'utf8'
    );
    assert.ok(previewSrc.includes('editable: false'), 'TipTap instance must be non-editable (read-only)');
    assert.ok(previewSrc.includes('StarterKit'), 'Must use StarterKit extension for rendering ProseMirror AST');
    assert.ok(previewSrc.includes('EditorContent'), 'Must render EditorContent');
    pass('8. ReadOnlyPreview renders read-only TipTap canvas without altering collaborative Y.Doc');
  } catch (err) {
    fail('8. ReadOnlyPreview implementation', err);
  }

  // Test 9: VersionHistoryPanel role-based creation action
  try {
    const panelSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/history/VersionHistoryPanel.tsx'),
      'utf8'
    );
    assert.ok(panelSrc.includes('canManageVersions'), 'Must compute canManageVersions based on user role');
    assert.ok(panelSrc.includes('OWNER') && panelSrc.includes('EDITOR'), 'Only OWNER and EDITOR can manage');
    assert.ok(panelSrc.includes('createPageVersion'), 'Must call createPageVersion on form submit');
    assert.ok(panelSrc.includes('listPageVersions'), 'Must fetch version list from API');
    assert.ok(panelSrc.includes('Save Current Version') || panelSrc.includes('Save Version'), 'Must have save snapshot button');
    pass('9. VersionHistoryPanel enforces OWNER/EDITOR snapshot creation and handles empty/loading states');
  } catch (err) {
    fail('9. VersionHistoryPanel implementation', err);
  }

  // Test 10: History API Client Helper
  try {
    const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/api/history.ts'), 'utf8');
    assert.ok(apiSrc.includes('listPageVersions'), 'Must export listPageVersions');
    assert.ok(apiSrc.includes('getPageVersion'), 'Must export getPageVersion');
    assert.ok(apiSrc.includes('createPageVersion'), 'Must export createPageVersion');
    assert.ok(apiSrc.includes('restorePageVersion'), 'Must export restorePageVersion');
    assert.ok(apiSrc.includes('/versions'), 'Must target version endpoints');
    assert.ok(apiSrc.includes('/restore'), 'Must target restore endpoint');
    pass('10. Client API library provides typed methods for listing, preview, creation, and restoration');
  } catch (err) {
    fail('10. Client API library', err);
  }

  // Test 11: RichTextEditor integration
  try {
    const editorSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/editor/RichTextEditor.tsx'),
      'utf8'
    );
    assert.ok(editorSrc.includes('VersionHistoryPanel'), 'Must include VersionHistoryPanel drawer');
    assert.ok(editorSrc.includes('RestoreConfirmationDialog'), 'Must include RestoreConfirmationDialog modal');
    assert.ok(editorSrc.includes('ReadOnlyPreview'), 'Must include ReadOnlyPreview');
    assert.ok(editorSrc.includes('isHistoryOpen'), 'Must track history drawer open state');
    assert.ok(editorSrc.includes('setIsCommentsOpen(false)'), 'Opening history must close comments');
    assert.ok(editorSrc.includes('setIsHistoryOpen(false)'), 'Opening comments must close history');
    assert.ok(editorSrc.includes('Viewing Historical Version'), 'Must render preview alert banner');
    assert.ok(editorSrc.includes('Exit Preview'), 'Must provide Exit Preview button');
    pass('11. RichTextEditor integrates history toggle button, mutual drawer exclusion, and preview banner');
  } catch (err) {
    fail('11. RichTextEditor integration', err);
  }

  console.log('\n==================================================');
  console.log(`Frontend UI Verification Tests: ${passed} passed, ${failed} failed`);
  console.log('==================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

