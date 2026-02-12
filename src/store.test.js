#!/usr/bin/env node

/**
 * Unit tests for lucidity store.js
 * Tests: load/save, transcript append/read, sync, stats
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createStore } = require('./store.js');
const { createTree, addTrunkNode } = require('./tree.js');

let tmpDir;
let passed = 0;
let failed = 0;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucidity-store-test-'));
  return createStore({
    treeDir: path.join(tmpDir, 'tree'),
    transcriptDir: path.join(tmpDir, 'transcripts'),
  });
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function test(name, fn) {
  const store = setup();
  try {
    fn(store);
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  } finally {
    teardown();
  }
}

// === Load/Save ===

console.log('\n=== Load/Save ===');

test('load returns null when no tree exists', (store) => {
  const result = store.load();
  assert.strictEqual(result, null);
});

test('save and load round-trips a tree', (store) => {
  const tree = createTree();
  addTrunkNode(tree, 'Test session content');
  assert.strictEqual(store.save(tree), true);
  const loaded = store.load();
  assert.ok(loaded);
  assert.strictEqual(loaded.trunk.length, 1);
  assert.strictEqual(loaded.nodes[loaded.trunk[0]].content, 'Test session content');
});

test('save overwrites previous tree', (store) => {
  const tree1 = createTree();
  addTrunkNode(tree1, 'First');
  store.save(tree1);

  const tree2 = createTree();
  addTrunkNode(tree2, 'Second');
  addTrunkNode(tree2, 'Third');
  store.save(tree2);

  const loaded = store.load();
  assert.strictEqual(loaded.trunk.length, 2);
});

// === Transcript ===

console.log('\n=== Transcript ===');

test('appendTranscript creates log file', (store) => {
  assert.strictEqual(store.appendTranscript('god', 'hello world'), true);
  const content = store.readTranscript('god');
  assert.ok(content);
  assert.ok(content.includes('hello world'));
});

test('appendTranscript appends multiple entries', (store) => {
  store.appendTranscript('god', 'line 1');
  store.appendTranscript('god', 'line 2');
  store.appendTranscript('god', 'line 3');
  const content = store.readTranscript('god');
  assert.ok(content.includes('line 1'));
  assert.ok(content.includes('line 2'));
  assert.ok(content.includes('line 3'));
});

test('appendTranscript entries have timestamps', (store) => {
  store.appendTranscript('god', 'timestamped entry');
  const content = store.readTranscript('god');
  // ISO timestamp format: [2024-...]
  assert.ok(/\[\d{4}-\d{2}-\d{2}T/.test(content));
});

test('readTranscript returns null for missing agent', (store) => {
  const result = store.readTranscript('nonexistent');
  assert.strictEqual(result, null);
});

test('readTranscript respects maxLines', (store) => {
  for (let i = 0; i < 50; i++) {
    store.appendTranscript('god', `line ${i}`);
  }
  const content = store.readTranscript('god', 5);
  const lines = content.split('\n').filter(l => l.length > 0);
  assert.strictEqual(lines.length, 5);
  // should have the last 5 lines
  assert.ok(lines[0].includes('line 45'));
  assert.ok(lines[4].includes('line 49'));
});

test('separate agents have separate transcripts', (store) => {
  store.appendTranscript('god', 'god message');
  store.appendTranscript('bob', 'bob message');
  const godContent = store.readTranscript('god');
  const bobContent = store.readTranscript('bob');
  assert.ok(godContent.includes('god message'));
  assert.ok(!godContent.includes('bob message'));
  assert.ok(bobContent.includes('bob message'));
  assert.ok(!bobContent.includes('god message'));
});

// === Sync ===

console.log('\n=== Sync ===');

test('sync initializes git repo if needed', (store) => {
  const tree = createTree();
  addTrunkNode(tree, 'Content for sync');
  store.save(tree);
  const result = store.sync('god');
  assert.strictEqual(result.success, true);
  assert.ok(fs.existsSync(path.join(store.treeDir, '.git')));
});

test('sync commits tree changes', (store) => {
  const tree = createTree();
  addTrunkNode(tree, 'First content');
  store.save(tree);
  const result = store.sync('god');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.message, 'committed');
});

test('sync reports no changes when nothing changed', (store) => {
  const tree = createTree();
  store.save(tree);
  store.sync('god'); // first commit
  const result = store.sync('god'); // no changes
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.message, 'no changes to sync');
});

test('sync includes transcripts', (store) => {
  const tree = createTree();
  store.save(tree);
  store.appendTranscript('god', 'transcript content');
  const result = store.sync('god');
  assert.strictEqual(result.success, true);
  // transcript should be copied to tree dir
  const transcriptCopy = path.join(store.treeDir, 'transcripts', 'god.log');
  assert.ok(fs.existsSync(transcriptCopy));
});

// === Stats ===

console.log('\n=== Stats ===');

test('stats reports empty state', (store) => {
  const s = store.stats();
  assert.strictEqual(s.treeExists, false);
  assert.strictEqual(s.nodeCount, 0);
  assert.strictEqual(s.trunkCount, 0);
  assert.strictEqual(s.transcriptCount, 0);
});

test('stats reports tree state', (store) => {
  const tree = createTree();
  addTrunkNode(tree, 'Session 1');
  addTrunkNode(tree, 'Session 2');
  store.save(tree);
  const s = store.stats();
  assert.strictEqual(s.treeExists, true);
  assert.strictEqual(s.nodeCount, 2);
  assert.strictEqual(s.trunkCount, 2);
  assert.ok(s.treeSizeBytes > 0);
});

test('stats reports transcript state', (store) => {
  store.appendTranscript('god', 'some content');
  store.appendTranscript('bob', 'more content');
  const s = store.stats();
  assert.strictEqual(s.transcriptCount, 2);
  assert.ok(s.transcriptTotalBytes > 0);
});

// === Summary ===

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
