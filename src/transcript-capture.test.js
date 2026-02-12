#!/usr/bin/env node

/**
 * Unit tests for lucidity transcript-capture.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createStore } = require('./store.js');
const { createCapture } = require('./transcript-capture.js');

let tmpDir;
let passed = 0;
let failed = 0;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucidity-capture-test-'));
  const store = createStore({
    treeDir: path.join(tmpDir, 'tree'),
    transcriptDir: path.join(tmpDir, 'transcripts'),
  });
  return { store, capture: createCapture(store, 'god') };
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

// === Recording incoming messages ===

console.log('\n=== Record Incoming ===');

test('record returns 0 for empty messages', ({ capture }) => {
  assert.strictEqual(capture.record([]), 0);
  assert.strictEqual(capture.record(null), 0);
  assert.strictEqual(capture.record(undefined), 0);
});

test('record captures messages to transcript', ({ store, capture }) => {
  const messages = [
    { from: '@abc123', from_name: 'visitor', to: '#general', content: 'hello world', ts: Date.now() },
  ];
  assert.strictEqual(capture.record(messages), 1);
  const transcript = store.readTranscript('god');
  assert.ok(transcript.includes('#general <visitor> hello world'));
});

test('record skips own messages', ({ store, capture }) => {
  const messages = [
    { from: '@self', from_name: 'god', to: '#general', content: 'my own message', ts: Date.now() },
    { from: '@other', from_name: 'bob', to: '#general', content: 'bobs message', ts: Date.now() },
  ];
  assert.strictEqual(capture.record(messages), 1);
  const transcript = store.readTranscript('god');
  assert.ok(!transcript.includes('my own message'));
  assert.ok(transcript.includes('bobs message'));
});

test('record handles multiple messages', ({ store, capture }) => {
  const messages = [
    { from: '@a', from_name: 'alice', to: '#general', content: 'msg 1', ts: Date.now() },
    { from: '@b', from_name: 'bob', to: '#general', content: 'msg 2', ts: Date.now() },
    { from: '@c', from_name: 'charlie', to: '#dev', content: 'msg 3', ts: Date.now() },
  ];
  assert.strictEqual(capture.record(messages), 3);
  const transcript = store.readTranscript('god');
  assert.ok(transcript.includes('<alice> msg 1'));
  assert.ok(transcript.includes('<bob> msg 2'));
  assert.ok(transcript.includes('#dev <charlie> msg 3'));
});

test('record uses from as fallback when from_name missing', ({ store, capture }) => {
  const messages = [
    { from: '@abc123', to: '#general', content: 'no name', ts: Date.now() },
  ];
  capture.record(messages);
  const transcript = store.readTranscript('god');
  assert.ok(transcript.includes('<@abc123> no name'));
});

// === Recording sent messages ===

console.log('\n=== Record Sent ===');

test('recordSent captures outgoing messages', ({ store, capture }) => {
  capture.recordSent('#general', 'I said this');
  const transcript = store.readTranscript('god');
  assert.ok(transcript.includes('#general <god> I said this'));
});

// === Recording events ===

console.log('\n=== Record Events ===');

test('recordEvent captures system events', ({ store, capture }) => {
  capture.recordEvent('session restart #93');
  const transcript = store.readTranscript('god');
  assert.ok(transcript.includes('[event] session restart #93'));
});

// === Stats ===

console.log('\n=== Stats ===');

test('stats tracks message count', ({ capture }) => {
  const messages = [
    { from: '@a', from_name: 'alice', to: '#general', content: 'msg', ts: Date.now() },
  ];
  capture.record(messages);
  capture.recordSent('#general', 'reply');
  const s = capture.stats();
  assert.strictEqual(s.messageCount, 2);
  assert.strictEqual(s.agentName, 'god');
  assert.ok(s.lastCaptureAt);
});

test('stats initial state is clean', ({ capture }) => {
  const s = capture.stats();
  assert.strictEqual(s.messageCount, 0);
  assert.strictEqual(s.lastCaptureAt, null);
});

// === Summary ===

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
