#!/usr/bin/env node
// lucidity/src/integration.test.js
// Integration smoke test — runs the full pipeline:
// agentchat messages → transcript adapter → curator logic → tree → skill.md
// Uses Bob's tree.js API (addTrunkNode, addBranchNode, etc.)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set env BEFORE requiring modules so they pick up test paths
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucidity-test-'));
process.env.LUCIDITY_LOG_DIR = path.join(tmpDir, 'logs');
process.env.LUCIDITY_SKILL_PATH = path.join(tmpDir, 'skill.md');
process.env.LUCIDITY_TREE_PATH = path.join(tmpDir, 'tree.json');

const { parseTranscript, extractMetadata } = require('./transcript');
const { createTree, addTrunkNode, addBranchNode, compressNode,
        getCompactionTargets, pruneOrphans, saveTree, loadTree,
        emitSkillMd, writeSkillMd } = require('./tree');
const { log: logMessage, getCurrentLogPath, shutdown: shutdownLogger } = require('./message-log');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}: ${err.message}`);
  }
}

console.log('integration tests\n');
console.log(`temp dir: ${tmpDir}\n`);

try {

// --- Stage 1: Message logging ---
console.log('stage 1: message logging');

const testMessages = [
  { from: '@abc', from_name: 'Junior', to: '#general', content: 'Working on the curator module', ts: Date.now() - 60000 },
  { from: '@def', from_name: 'Senior', to: '#general', content: 'Make sure to handle truncated JSON from crashes', ts: Date.now() - 50000 },
  { from: '@ghi', from_name: 'BobTheBuilder', to: '#general', content: '`tree.js` committed with 18 tests', ts: Date.now() - 40000 },
  { from: '@abc', from_name: 'Junior', to: '#general', content: 'Shipped `transcript.js` — handles agentchat JSONL, claude JSONL, and plain text', ts: Date.now() - 30000 },
  { from: '@jkl', from_name: 'Ghost', to: '#general', content: 'Pipeline: `supervisor` → `curator-run` → `curator.js` → skill.md', ts: Date.now() - 20000 },
  { from: '@def', from_name: 'Senior', to: '#general', content: 'Code review: looks clean. Ship it.', ts: Date.now() - 10000 },
];

test('message-log writes JSONL to disk', () => {
  for (const msg of testMessages) {
    logMessage(msg);
  }
  const logPath = getCurrentLogPath();
  assert(fs.existsSync(logPath), `log file should exist at ${logPath}`);
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, testMessages.length);
});

// --- Stage 2: Transcript parsing ---
console.log('\nstage 2: transcript parsing');

test('transcript adapter parses logged messages', () => {
  const logPath = getCurrentLogPath();
  const raw = fs.readFileSync(logPath, 'utf8');
  const text = parseTranscript(raw, { format: 'auto' });
  assert(text.includes('Junior'), 'should contain agent name');
  assert(text.includes('curator module'), 'should contain message content');
  assert(text.includes('#general'), 'should contain channel');
});

test('metadata extraction finds agents and topics', () => {
  const logPath = getCurrentLogPath();
  const raw = fs.readFileSync(logPath, 'utf8');
  const meta = extractMetadata(raw);
  assert.strictEqual(meta.messageCount, testMessages.length);
  assert(meta.agents.has('@abc'), 'should find Junior');
  assert(meta.agents.has('@def'), 'should find Senior');
  assert.strictEqual(meta.agents.get('@abc').name, 'Junior');
  assert(meta.topics.length > 0, 'should extract some topics');
});

// --- Stage 3: Tree + curation (Bob's API) ---
console.log('\nstage 3: tree operations (Bob\'s API)');

test('addTrunkNode creates root', () => {
  const tree = createTree();
  const node = addTrunkNode(tree, 'Session: built lucidity memory system.');
  assert(node.id);
  assert.strictEqual(tree.trunk.length, 1);
  assert.strictEqual(tree.trunk[0], node.id);
  assert.strictEqual(node.summary_level, 'full');
});

test('addBranchNode links to parent', () => {
  const tree = createTree();
  const trunk = addTrunkNode(tree, 'Main session');
  const branch = addBranchNode(tree, trunk.id, 'supervisor.sh details', 'supervisor');
  assert.strictEqual(branch.depth, 1);
  assert.strictEqual(trunk.links.length, 1);
  assert.strictEqual(trunk.links[0].target_id, branch.id);
});

test('emitSkillMd generates valid output', () => {
  const tree = createTree();
  addTrunkNode(tree, 'Current session: building lucidity memory system with the team.');
  addTrunkNode(tree, 'Previous session: designed owl spec and data model.');

  const rootId = tree.trunk[0];
  addBranchNode(tree, rootId, 'supervisor.sh — PID 1 restart loop', 'supervisor');

  const skillMd = emitSkillMd(tree);
  assert(skillMd.includes('# memory'), 'should have header');
  assert(skillMd.includes('current session'), 'should have current session');
  assert(skillMd.includes('lucidity memory system'), 'should have newest root content');
  assert(skillMd.includes('topics'), 'should have topics section');
  assert(skillMd.includes('supervisor'), 'should list branch');
  assert(skillMd.includes('recent history'), 'should have history');
});

test('saveTree + loadTree roundtrip', () => {
  const tree = createTree();
  addTrunkNode(tree, 'test content');
  const savePath = path.join(tmpDir, 'roundtrip.json');
  saveTree(tree, savePath);
  const loaded = loadTree(savePath);
  assert(loaded);
  assert.strictEqual(loaded.trunk.length, 1);
  assert.strictEqual(Object.keys(loaded.nodes).length, 1);
});

// --- Stage 4: Full pipeline ---
console.log('\nstage 4: full pipeline');

test('end-to-end: messages → log → parse → tree → skill.md', () => {
  // 1. Log messages
  const pipeDir = path.join(tmpDir, 'pipeline');
  fs.mkdirSync(pipeDir, { recursive: true });
  const logFile = path.join(pipeDir, 'test.jsonl');
  const msgs = [
    { from: '@x', from_name: 'TestAgent', to: '#test', content: 'built the thing', ts: Date.now() },
    { from: '@y', from_name: 'Reviewer', to: '#test', content: 'LGTM, ship it', ts: Date.now() },
  ];
  for (const msg of msgs) {
    fs.appendFileSync(logFile, JSON.stringify(msg) + '\n');
  }

  // 2. Parse transcript
  const raw = fs.readFileSync(logFile, 'utf8');
  const text = parseTranscript(raw);
  assert(text.includes('TestAgent'));
  assert(text.includes('LGTM'));

  // 3. Build tree using Bob's API
  const tree = createTree();
  addTrunkNode(tree, 'Summary: TestAgent built the thing, Reviewer approved.');

  // 4. Write skill.md using Bob's writeSkillMd
  const skillPath = path.join(pipeDir, 'skill.md');
  writeSkillMd(tree, skillPath);
  assert(fs.existsSync(skillPath));
  const content = fs.readFileSync(skillPath, 'utf8');
  assert(content.includes('TestAgent built the thing'));
});

} finally {
  // Always clean up, even on test failure
  shutdownLogger();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
