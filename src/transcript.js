#!/usr/bin/env node
// lucidity/src/transcript.js
// Transcript adapter — converts various log formats into normalized
// transcript text that the curator can ingest.
//
// Supported formats:
// - agentchat JSONL (one JSON message per line with from/to/content/ts)
// - claude JSONL (Claude Code conversation logs)
// - plain text (passed through as-is)

const fs = require('fs');
const path = require('path');

// --- Format detection ---

function detectFormat(line) {
  try {
    const obj = JSON.parse(line);
    if (obj.from && obj.to && obj.content) return 'agentchat';
    if (obj.role && obj.content) return 'claude';
    if (obj.type && obj.message) return 'generic-jsonl';
    return 'unknown-json';
  } catch {
    return 'plain';
  }
}

// --- Parsers ---

function parseAgentchatMessage(json) {
  const ts = json.ts ? new Date(json.ts).toISOString() : '';
  const from = json.from_name || json.from || 'unknown';
  const to = json.to || '';
  const prefix = ts ? `[${ts}]` : '';
  return `${prefix} ${from} → ${to}: ${json.content}`;
}

function parseClaudeMessage(json) {
  const role = json.role || 'unknown';
  const content = typeof json.content === 'string'
    ? json.content
    : JSON.stringify(json.content);
  return `[${role}] ${content}`;
}

function parseGenericMessage(json) {
  const type = json.type || 'msg';
  const msg = json.message || json.content || JSON.stringify(json);
  const ts = json.timestamp || json.ts || '';
  const prefix = ts ? `[${new Date(ts).toISOString()}]` : '';
  return `${prefix} [${type}] ${msg}`;
}

// --- Main parser ---

/**
 * Parse a transcript buffer (string) into normalized text.
 * Handles mixed formats — detects per-line.
 *
 * @param {string} raw - Raw transcript content
 * @param {object} opts - Options
 * @param {string} opts.format - Force format ('agentchat', 'claude', 'plain', or 'auto')
 * @param {boolean} opts.dedup - Remove duplicate consecutive messages
 * @param {number} opts.maxLines - Max lines to return (0 = unlimited)
 * @returns {string} Normalized transcript text
 */
function parseTranscript(raw, opts = {}) {
  const { format = 'auto', dedup = true, maxLines = 0 } = opts;

  const lines = raw.split('\n').filter(l => l.trim());
  const parsed = [];
  let lastLine = '';

  for (const line of lines) {
    let fmt = format === 'auto' ? detectFormat(line) : format;
    let result;

    try {
      switch (fmt) {
        case 'agentchat': {
          const json = JSON.parse(line);
          result = parseAgentchatMessage(json);
          break;
        }
        case 'claude': {
          const json = JSON.parse(line);
          result = parseClaudeMessage(json);
          break;
        }
        case 'generic-jsonl': {
          const json = JSON.parse(line);
          result = parseGenericMessage(json);
          break;
        }
        case 'plain':
        default:
          result = line;
      }
    } catch {
      // If JSON parse fails, treat as plain text
      result = line;
    }

    // Dedup consecutive identical messages
    if (dedup && result === lastLine) continue;
    lastLine = result;

    parsed.push(result);
  }

  const output = maxLines > 0 ? parsed.slice(-maxLines) : parsed;
  return output.join('\n');
}

/**
 * Read and parse a transcript file.
 *
 * @param {string} filePath - Path to transcript file
 * @param {object} opts - parseTranscript options + offset/limit
 * @param {number} opts.offset - Byte offset to start reading from
 * @returns {{ text: string, bytesRead: number, newOffset: number }}
 */
function readTranscriptFile(filePath, opts = {}) {
  const { offset = 0, ...parseOpts } = opts;

  if (!fs.existsSync(filePath)) {
    return { text: '', bytesRead: 0, newOffset: offset };
  }

  const stat = fs.statSync(filePath);
  if (stat.size <= offset) {
    return { text: '', bytesRead: 0, newOffset: offset };
  }

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);

  const raw = buf.toString('utf8');
  const text = parseTranscript(raw, parseOpts);

  return {
    text,
    bytesRead: buf.length,
    newOffset: stat.size,
  };
}

/**
 * Extract structured metadata from agentchat messages.
 * Pulls out agent identities, topics, and relationships.
 *
 * @param {string} raw - Raw JSONL content
 * @returns {{ agents: Map<string, object>, topics: string[], messageCount: number }}
 */
function extractMetadata(raw) {
  const lines = raw.split('\n').filter(l => l.trim());
  const agents = new Map();
  const topicWords = new Map();
  let messageCount = 0;

  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (!json.from || !json.content) continue;

      messageCount++;

      // Track agents
      const agentId = json.from;
      const name = json.from_name || agentId;
      if (!agents.has(agentId)) {
        agents.set(agentId, {
          id: agentId,
          name,
          firstSeen: json.ts,
          lastSeen: json.ts,
          messageCount: 0,
          channels: new Set(),
        });
      }
      const agent = agents.get(agentId);
      agent.lastSeen = json.ts;
      agent.messageCount++;
      if (json.to && json.to.startsWith('#')) {
        agent.channels.add(json.to);
      }

      // Extract @mentions as relationship signals
      const mentions = json.content.match(/@[\w-]+/g) || [];
      // Could build a relationship graph here later

      // Extract topic words (simple: words that appear in backticks or after #)
      const codeRefs = json.content.match(/`[^`]+`/g) || [];
      const hashtags = json.content.match(/#\w+/g) || [];
      for (const ref of [...codeRefs, ...hashtags]) {
        const clean = ref.replace(/[`#]/g, '');
        topicWords.set(clean, (topicWords.get(clean) || 0) + 1);
      }
    } catch {
      continue;
    }
  }

  // Sort topics by frequency
  const topics = [...topicWords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);

  // Convert agent channel sets to arrays for serialization
  for (const agent of agents.values()) {
    agent.channels = [...agent.channels];
  }

  return { agents, topics, messageCount };
}

// --- CLI ---
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: transcript.js <file> [--format auto|agentchat|claude|plain] [--offset N] [--max-lines N] [--metadata]');
    process.exit(1);
  }

  const filePath = args[0];
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'auto';
  const offset = args.includes('--offset') ? parseInt(args[args.indexOf('--offset') + 1]) : 0;
  const maxLines = args.includes('--max-lines') ? parseInt(args[args.indexOf('--max-lines') + 1]) : 0;
  const showMetadata = args.includes('--metadata');

  if (showMetadata) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const meta = extractMetadata(raw);
    console.log(JSON.stringify({
      messageCount: meta.messageCount,
      agents: Object.fromEntries(meta.agents),
      topics: meta.topics,
    }, null, 2));
  } else {
    const result = readTranscriptFile(filePath, { format, offset, maxLines });
    process.stdout.write(result.text);
    if (result.text && !result.text.endsWith('\n')) process.stdout.write('\n');
    console.error(`[transcript] read ${result.bytesRead} bytes, new offset: ${result.newOffset}`);
  }
}

module.exports = { parseTranscript, readTranscriptFile, extractMetadata, detectFormat };
