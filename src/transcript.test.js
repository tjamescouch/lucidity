#!/usr/bin/env node
// lucidity/src/transcript.test.js
// Quick tests for the transcript adapter

const assert = require('assert');
const { parseTranscript, detectFormat, extractMetadata } = require('./transcript');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

console.log('transcript.js tests\n');

// --- Format detection ---
console.log('detectFormat:');

test('detects agentchat JSONL', () => {
  const line = '{"from":"@abc","to":"#general","content":"hello","ts":1234}';
  assert.strictEqual(detectFormat(line), 'agentchat');
});

test('detects claude JSONL', () => {
  const line = '{"role":"assistant","content":"hello"}';
  assert.strictEqual(detectFormat(line), 'claude');
});

test('detects plain text', () => {
  assert.strictEqual(detectFormat('just some plain text'), 'plain');
});

test('detects generic JSONL', () => {
  const line = '{"type":"event","message":"something happened"}';
  assert.strictEqual(detectFormat(line), 'generic-jsonl');
});

// --- Parsing ---
console.log('\nparseTranscript:');

test('parses agentchat messages', () => {
  const input = '{"from":"@abc","from_name":"Junior","to":"#general","content":"hello world","ts":1700000000000}\n';
  const result = parseTranscript(input);
  assert(result.includes('Junior'));
  assert(result.includes('#general'));
  assert(result.includes('hello world'));
});

test('parses claude messages', () => {
  const input = '{"role":"assistant","content":"I can help with that"}\n';
  const result = parseTranscript(input);
  assert(result.includes('[assistant]'));
  assert(result.includes('I can help with that'));
});

test('passes through plain text', () => {
  const input = 'line one\nline two\nline three\n';
  const result = parseTranscript(input);
  assert(result.includes('line one'));
  assert(result.includes('line three'));
});

test('handles mixed formats', () => {
  const input = [
    '{"from":"@abc","to":"#general","content":"json msg","ts":1700000000000}',
    'plain text line',
    '{"role":"user","content":"claude msg"}',
  ].join('\n');
  const result = parseTranscript(input);
  assert(result.includes('json msg'));
  assert(result.includes('plain text line'));
  assert(result.includes('claude msg'));
});

test('deduplicates consecutive identical lines', () => {
  const input = 'same line\nsame line\nsame line\ndifferent\n';
  const result = parseTranscript(input, { dedup: true });
  const lines = result.split('\n');
  assert.strictEqual(lines.length, 2); // 'same line' + 'different'
});

test('respects maxLines', () => {
  const input = 'a\nb\nc\nd\ne\n';
  const result = parseTranscript(input, { maxLines: 2 });
  const lines = result.split('\n');
  assert.strictEqual(lines.length, 2);
  assert(result.includes('d'));
  assert(result.includes('e'));
});

// --- Edge cases (Senior's crash concern) ---
console.log('\nedge cases:');

test('handles truncated JSON gracefully', () => {
  const input = '{"from":"@abc","to":"#general","content":"good msg","ts":123}\n{"from":"@abc","to":"#ge\n';
  const result = parseTranscript(input);
  assert(result.includes('good msg'));
  // Truncated line should be treated as plain text, not crash
  assert(result.includes('{"from":"@abc","to":"#ge'));
});

test('handles empty input', () => {
  assert.strictEqual(parseTranscript(''), '');
  assert.strictEqual(parseTranscript('\n\n\n'), '');
});

test('handles binary junk in a line', () => {
  const input = 'normal line\n\x00\x01\x02binary junk\nnormal again\n';
  const result = parseTranscript(input);
  assert(result.includes('normal line'));
  assert(result.includes('normal again'));
});

test('handles very long lines without crashing', () => {
  const longContent = 'x'.repeat(100000);
  const input = `{"from":"@a","to":"#b","content":"${longContent}","ts":1}\nnormal\n`;
  const result = parseTranscript(input);
  assert(result.includes(longContent));
  assert(result.includes('normal'));
});

// --- Metadata extraction ---
console.log('\nextractMetadata:');

test('extracts agent identities', () => {
  const input = [
    '{"from":"@abc","from_name":"Junior","to":"#general","content":"hello","ts":1000}',
    '{"from":"@def","from_name":"Senior","to":"#general","content":"hi back","ts":2000}',
    '{"from":"@abc","from_name":"Junior","to":"#general","content":"second msg","ts":3000}',
  ].join('\n');
  const meta = extractMetadata(input);
  assert.strictEqual(meta.messageCount, 3);
  assert(meta.agents.has('@abc'));
  assert.strictEqual(meta.agents.get('@abc').name, 'Junior');
  assert.strictEqual(meta.agents.get('@abc').messageCount, 2);
});

test('extracts topics from backticks and hashtags', () => {
  const input = '{"from":"@a","to":"#general","content":"check out `supervisor.sh` and `curator.js` in #lucidity","ts":1}\n';
  const meta = extractMetadata(input);
  assert(meta.topics.includes('supervisor.sh'));
  assert(meta.topics.includes('curator.js'));
});

test('handles non-JSON lines in metadata extraction', () => {
  const input = 'plain text\n{"from":"@a","to":"#b","content":"valid","ts":1}\nmore plain\n';
  const meta = extractMetadata(input);
  assert.strictEqual(meta.messageCount, 1);
});

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
