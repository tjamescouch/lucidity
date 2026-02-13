#!/usr/bin/env node
// lucidity/src/message-log.js
// Lightweight message logger — appends agentchat messages to a JSONL file.
// Designed to run as a child of the supervisor alongside the agent.
//
// Reads from stdin (piped from agentchat daemon inbox) or can be
// required as a module and called with log(message).
//
// Output: one JSON line per message, appended to the log file.
// Rotates daily by default.

const fs = require('fs');
const path = require('path');
const { asError } = require('./errors');

// --- Config ---
const LOG_DIR = process.env.LUCIDITY_LOG_DIR || path.join(process.env.HOME, '.claude', 'memory', 'logs');
const LOG_PREFIX = process.env.LUCIDITY_LOG_PREFIX || 'transcript';
const ROTATE = process.env.LUCIDITY_LOG_ROTATE !== 'false'; // daily rotation by default
const MAX_LINE_BYTES = 64 * 1024; // skip lines > 64KB (binary junk protection)

// --- State ---
let currentDate = '';
let currentFd = null;
let currentPath = '';
let bytesWritten = 0;
let messagesWritten = 0;

function getLogPath(date) {
  if (ROTATE) {
    return path.join(LOG_DIR, `${LOG_PREFIX}-${date}.jsonl`);
  }
  return path.join(LOG_DIR, `${LOG_PREFIX}.jsonl`);
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function openLog() {
  const date = today();
  if (currentFd !== null && date === currentDate) return;

  // Close previous
  if (currentFd !== null) {
    try { fs.closeSync(currentFd); } catch {}
  }

  currentDate = date;
  currentPath = getLogPath(date);
  ensureDir();
  currentFd = fs.openSync(currentPath, 'a');
  console.error(`[message-log] logging to ${currentPath}`);
}

/**
 * Log a message object to the transcript file.
 * @param {object} msg - Message with from, to, content, ts fields
 */
function log(msg) {
  openLog();

  const line = JSON.stringify({
    from: msg.from || null,
    from_name: msg.from_name || null,
    to: msg.to || null,
    content: msg.content || '',
    ts: msg.ts || Date.now(),
    _logged: Date.now(),
  }) + '\n';

  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    console.error(`[message-log] skipping oversized message (${Buffer.byteLength(line)} bytes)`);
    return;
  }

  try {
    fs.writeSync(currentFd, line);
    bytesWritten += Buffer.byteLength(line);
    messagesWritten++;
  } catch (e) {
    const err = asError(e);
    console.error(`[message-log] write error: ${err.message}`);
    // Try reopening on next call
    currentFd = null;
    currentDate = '';
  }
}

/**
 * Get the current log file path (for curator to find).
 * @returns {string}
 */
function getCurrentLogPath() {
  return getLogPath(today());
}

/**
 * Get all log file paths, sorted oldest to newest.
 * @returns {string[]}
 */
function getAllLogPaths() {
  ensureDir();
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith(LOG_PREFIX) && f.endsWith('.jsonl'))
    .sort()
    .map(f => path.join(LOG_DIR, f));
}

/**
 * Get stats about the logger.
 */
function getStats() {
  return {
    currentPath,
    bytesWritten,
    messagesWritten,
    logDir: LOG_DIR,
    allFiles: getAllLogPaths(),
  };
}

function shutdown() {
  if (currentFd !== null) {
    try { fs.closeSync(currentFd); } catch {}
    currentFd = null;
  }
  console.error(`[message-log] shutdown. ${messagesWritten} messages, ${bytesWritten} bytes written.`);
}

// --- CLI: read from stdin ---
if (require.main === module) {
  console.error(`[message-log] starting, logging to ${LOG_DIR}/`);
  ensureDir();

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Try to parse as JSON (agentchat message)
    try {
      const msg = JSON.parse(trimmed);
      log(msg);
    } catch {
      // Plain text line — wrap it
      log({
        content: trimmed,
        ts: Date.now(),
      });
    }
  });

  rl.on('close', shutdown);
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });
  process.on('SIGINT', () => { shutdown(); process.exit(0); });
}

module.exports = { log, getCurrentLogPath, getAllLogPaths, getStats, shutdown };
