#!/usr/bin/env node

/**
 * Unit tests for lucidity tree.js
 * Tests: persistence round-trip, emitSkillMd output, compression, pruning
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  createTree,
  addTrunkNode,
  addBranchNode,
  compressNode,
  pruneOrphans,
  getCompactionTargets,
  saveTree,
  loadTree,
  emitSkillMd,
  writeSkillMd,
} = require('./tree.js');

let tmpDir;
let passed = 0;
let failed = 0;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucidity-test-'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

// === Persistence round-trip tests ===

console.log('\n=== Persistence Round-Trip ===');
setup();

test('empty tree round-trips', () => {
  const tree = createTree();
  const filepath = path.join(tmpDir, 'empty.json');
  saveTree(tree, filepath);
  const loaded = loadTree(filepath);
  assert.deepStrictEqual(loaded.nodes, {});
  assert.deepStrictEqual(loaded.trunk, []);
  assert.strictEqual(loaded.version, 1);
});

test('tree with trunk nodes round-trips', () => {
  const tree = createTree();
  addTrunkNode(tree, 'First conversation about memory systems');
  addTrunkNode(tree, 'Second conversation about agentchat');
  const filepath = path.join(tmpDir, 'trunk.json');
  saveTree(tree, filepath);
  const loaded = loadTree(filepath);
  assert.strictEqual(Object.keys(loaded.nodes).length, 2);
  assert.strictEqual(loaded.trunk.length, 2);
  // newest first
  const newest = loaded.nodes[loaded.trunk[0]];
  assert.strictEqual(newest.content, 'Second conversation about agentchat');
});

test('tree with branches round-trips', () => {
  const tree = createTree();
  const trunk = addTrunkNode(tree, 'Main conversation');
  addBranchNode(tree, trunk.id, 'Side topic about lucidity', 'lucidity');
  addBranchNode(tree, trunk.id, 'Side topic about testing', 'testing');
  const filepath = path.join(tmpDir, 'branches.json');
  saveTree(tree, filepath);
  const loaded = loadTree(filepath);
  assert.strictEqual(Object.keys(loaded.nodes).length, 3);
  const loadedTrunk = loaded.nodes[loaded.trunk[0]];
  assert.strictEqual(loadedTrunk.links.length, 2);
  assert.strictEqual(loadedTrunk.links[0].label, 'lucidity');
  assert.strictEqual(loadedTrunk.links[1].label, 'testing');
  // branch nodes are accessible
  const branch1 = loaded.nodes[loadedTrunk.links[0].target_id];
  assert.strictEqual(branch1.content, 'Side topic about lucidity');
  assert.strictEqual(branch1.depth, 1);
});

test('compressed nodes round-trip', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Long detailed conversation about memory architecture');
  compressNode(tree, node.id, 'Memory architecture discussion', 'summary');
  const filepath = path.join(tmpDir, 'compressed.json');
  saveTree(tree, filepath);
  const loaded = loadTree(filepath);
  const loadedNode = loaded.nodes[loaded.trunk[0]];
  assert.strictEqual(loadedNode.summary_level, 'summary');
  assert.strictEqual(loadedNode.content, 'Memory architecture discussion');
});

test('loadTree returns null for missing file', () => {
  const result = loadTree(path.join(tmpDir, 'nonexistent.json'));
  assert.strictEqual(result, null);
});

test('saveTree uses atomic write (tmp + rename)', () => {
  const tree = createTree();
  addTrunkNode(tree, 'test');
  const filepath = path.join(tmpDir, 'atomic.json');
  saveTree(tree, filepath);
  // tmp file should not exist after save
  assert.strictEqual(fs.existsSync(filepath + '.tmp'), false);
  assert.strictEqual(fs.existsSync(filepath), true);
});

teardown();

// === Compression tests ===

console.log('\n=== Compression ===');

test('compress full -> summary works', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Detailed content');
  compressNode(tree, node.id, 'Summary', 'summary');
  assert.strictEqual(tree.nodes[node.id].summary_level, 'summary');
  assert.strictEqual(tree.nodes[node.id].content, 'Summary');
});

test('compress summary -> oneliner works', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Detailed content');
  compressNode(tree, node.id, 'Summary', 'summary');
  compressNode(tree, node.id, 'One liner', 'oneliner');
  assert.strictEqual(tree.nodes[node.id].summary_level, 'oneliner');
});

test('compress cannot go backwards (summary -> full)', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Detailed content');
  compressNode(tree, node.id, 'Summary', 'summary');
  assert.throws(() => {
    compressNode(tree, node.id, 'Back to full', 'full');
  }, /cannot compress/);
});

test('compress same level throws', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Detailed content');
  assert.throws(() => {
    compressNode(tree, node.id, 'Still full', 'full');
  }, /cannot compress/);
});

// === emitSkillMd tests ===

console.log('\n=== emitSkillMd Output ===');

test('emitSkillMd produces valid markdown for empty tree', () => {
  const tree = createTree();
  const md = emitSkillMd(tree);
  assert.ok(md.includes('# memory'));
});

test('emitSkillMd includes current session content', () => {
  const tree = createTree();
  addTrunkNode(tree, 'Working on lucidity memory integration');
  const md = emitSkillMd(tree);
  assert.ok(md.includes('## current session'));
  assert.ok(md.includes('Working on lucidity memory integration'));
});

test('emitSkillMd includes branch topics', () => {
  const tree = createTree();
  const trunk = addTrunkNode(tree, 'Main discussion');
  addBranchNode(tree, trunk.id, 'Details about tree.js', 'tree implementation');
  const md = emitSkillMd(tree);
  assert.ok(md.includes('### topics'));
  assert.ok(md.includes('tree implementation'));
});

test('emitSkillMd includes recent history', () => {
  const tree = createTree();
  addTrunkNode(tree, 'Older conversation');
  addTrunkNode(tree, 'Current conversation');
  const md = emitSkillMd(tree);
  assert.ok(md.includes('## current session'));
  assert.ok(md.includes('Current conversation'));
  assert.ok(md.includes('## recent history'));
  assert.ok(md.includes('Older conversation'));
});

test('emitSkillMd respects token budget', () => {
  const tree = createTree();
  // Add lots of content
  for (let i = 0; i < 50; i++) {
    addTrunkNode(tree, `Session ${i}: ${'x'.repeat(200)}`);
  }
  const md = emitSkillMd(tree, 500); // very small budget
  assert.ok(md.includes('truncated'));
  // Should be under budget (500 tokens * ~4 chars)
  assert.ok(md.length < 500 * 4 + 200); // some margin
});

test('emitSkillMd shows summary_level tags in history', () => {
  const tree = createTree();
  const old = addTrunkNode(tree, 'Old conversation');
  compressNode(tree, old.id, 'Compressed old convo', 'summary');
  addTrunkNode(tree, 'Current session');
  const md = emitSkillMd(tree);
  assert.ok(md.includes('[summary]'));
});

test('writeSkillMd creates file on disk', () => {
  setup();
  const tree = createTree();
  addTrunkNode(tree, 'Test session content');
  const filepath = path.join(tmpDir, 'skill.md');
  writeSkillMd(tree, filepath);
  assert.ok(fs.existsSync(filepath));
  const content = fs.readFileSync(filepath, 'utf-8');
  assert.ok(content.includes('Test session content'));
  teardown();
});

// === Pruning tests ===

console.log('\n=== Pruning ===');

test('pruneOrphans removes old unreferenced nodes', () => {
  const tree = createTree();
  const trunk = addTrunkNode(tree, 'Main');
  // Manually add an orphan node
  const orphanId = 'orphan-node-123';
  tree.nodes[orphanId] = {
    id: orphanId,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days old
    updated_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    depth: 1,
    content: 'Orphan content',
    links: [],
    summary_level: 'full',
  };
  const pruned = pruneOrphans(tree);
  assert.strictEqual(pruned.length, 1);
  assert.strictEqual(pruned[0], orphanId);
  assert.strictEqual(tree.nodes[orphanId], undefined);
});

test('pruneOrphans keeps trunk nodes', () => {
  const tree = createTree();
  addTrunkNode(tree, 'Keep this');
  const pruned = pruneOrphans(tree, 0); // maxAge 0 = prune everything eligible
  assert.strictEqual(pruned.length, 0);
  assert.strictEqual(Object.keys(tree.nodes).length, 1);
});

test('pruneOrphans keeps referenced branch nodes', () => {
  const tree = createTree();
  const trunk = addTrunkNode(tree, 'Main');
  addBranchNode(tree, trunk.id, 'Referenced branch', 'topic');
  const pruned = pruneOrphans(tree, 0);
  assert.strictEqual(pruned.length, 0);
  assert.strictEqual(Object.keys(tree.nodes).length, 2);
});

// === getCompactionTargets tests ===

console.log('\n=== Compaction Targets ===');

test('getCompactionTargets identifies old full nodes', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Old content');
  // Backdate the node
  node.created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours old
  const targets = getCompactionTargets(tree);
  assert.strictEqual(targets.length, 1);
  assert.strictEqual(targets[0].from, 'full');
  assert.strictEqual(targets[0].to, 'summary');
});

test('getCompactionTargets skips recent nodes', () => {
  const tree = createTree();
  addTrunkNode(tree, 'Fresh content'); // just created
  const targets = getCompactionTargets(tree);
  assert.strictEqual(targets.length, 0);
});

// === Summary ===

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
