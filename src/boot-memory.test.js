#!/usr/bin/env node

/**
 * Unit tests for lucidity boot-memory.js
 * Tests the boot sequence as a subprocess (since it's a CLI entrypoint)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { createTree, addTrunkNode, saveTree } = require('./tree.js');

let tmpDir;
let passed = 0;
let failed = 0;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucidity-boot-test-'));
  fs.mkdirSync(path.join(tmpDir, 'tree'), { recursive: true });
  return {
    treePath: path.join(tmpDir, 'tree', 'tree.json'),
    outputPath: path.join(tmpDir, 'skill.md'),
  };
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function runBoot(args) {
  const script = path.join(__dirname, 'boot-memory.js');
  return execSync(`node ${script} ${args}`, {
    encoding: 'utf-8',
    env: { ...process.env, HOME: tmpDir },
    timeout: 10000,
  });
}

function test(name, fn) {
  const ctx = setup();
  try {
    fn(ctx);
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

// === Boot tests ===

console.log('\n=== Boot Sequence ===');

test('boots with no existing tree (cold start)', ({ treePath, outputPath }) => {
  const output = runBoot(`--agent god --tree ${treePath} --output ${outputPath}`);
  assert.ok(output.includes('no existing tree'));
  assert.ok(output.includes('boot complete'));
  assert.ok(fs.existsSync(outputPath));
  const content = fs.readFileSync(outputPath, 'utf-8');
  assert.ok(content.includes('# memory'));
});

test('boots with existing tree', ({ treePath, outputPath }) => {
  // pre-populate tree
  const tree = createTree();
  addTrunkNode(tree, 'Previous session: discussed marker protocol and memory architecture');
  saveTree(tree, treePath);

  const output = runBoot(`--agent god --tree ${treePath} --output ${outputPath}`);
  assert.ok(output.includes('loaded tree: 1 nodes'));
  assert.ok(output.includes('boot complete'));

  const content = fs.readFileSync(outputPath, 'utf-8');
  assert.ok(content.includes('marker protocol'));
});

test('boots with multi-session tree', ({ treePath, outputPath }) => {
  const tree = createTree();
  addTrunkNode(tree, 'Session 1: set up lucidity repo');
  addTrunkNode(tree, 'Session 2: built store and transcript capture');
  addTrunkNode(tree, 'Session 3: integrated boot-memory');
  saveTree(tree, treePath);

  const output = runBoot(`--agent god --tree ${treePath} --output ${outputPath}`);
  assert.ok(output.includes('3 nodes, 3 trunk'));

  const content = fs.readFileSync(outputPath, 'utf-8');
  assert.ok(content.includes('## current session'));
  assert.ok(content.includes('Session 3'));
  assert.ok(content.includes('## recent history'));
});

test('survives corrupted tree.json', ({ treePath, outputPath }) => {
  fs.writeFileSync(treePath, '{ invalid json !!!');
  const output = runBoot(`--agent god --tree ${treePath} --output ${outputPath}`);
  assert.ok(output.includes('boot complete') || output.includes('no previous memory'));
  assert.ok(fs.existsSync(outputPath));
});

test('creates output directory if missing', ({ treePath }) => {
  const deepOutput = path.join(tmpDir, 'deep', 'nested', 'dir', 'skill.md');
  const output = runBoot(`--agent god --tree ${treePath} --output ${deepOutput}`);
  assert.ok(output.includes('boot complete'));
  assert.ok(fs.existsSync(deepOutput));
});

test('uses AGENT_NAME env var as default', ({ treePath, outputPath }) => {
  const script = path.join(__dirname, 'boot-memory.js');
  const output = execSync(`node ${script} --tree ${treePath} --output ${outputPath}`, {
    encoding: 'utf-8',
    env: { ...process.env, HOME: tmpDir, AGENT_NAME: 'TestBot' },
    timeout: 10000,
  });
  assert.ok(output.includes('TestBot'));
});

// === Summary ===

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
