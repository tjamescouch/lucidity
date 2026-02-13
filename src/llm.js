// lucidity/src/llm.js
// LLM interface for curator summarization
// Supports: OpenAI-compatible API, Anthropic API, claude CLI, or naive fallback

const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const { asError } = require('./errors');

// --- Config ---
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
const LLM_MODEL = process.env.LUCIDITY_MODEL || 'gpt-4o-mini';
const CLAUDE_CLI = process.env.LUCIDITY_CLAUDE_CLI || 'claude';

// --- Prompts ---
const PROMPTS = {
  summary: `You are a memory curator for an AI agent. Compress the following text into a 2-3 sentence summary that preserves key facts, decisions, identities, and relationships. Output ONLY the summary, no preamble.`,

  oneliner: `You are a memory curator for an AI agent. Compress the following text into a single sentence that captures the most important fact or decision. Output ONLY the one sentence, no preamble.`,

  tag: `You are a memory curator for an AI agent. Extract 3-5 keywords or short phrases from the following text that capture its essence. Output ONLY the keywords separated by commas, no preamble.`,

  root: `You are a memory curator for an AI agent. Summarize the following conversation transcript into a concise session summary. Include: who was involved, what was discussed, what was decided, and what work was done. Keep it under 500 words. Output ONLY the summary, no preamble.`,
};

// --- Backend: Claude CLI ---
let _cliExists = null; // cache result of which check

function cliExists() {
  if (_cliExists !== null) return _cliExists;
  try {
    execSync(`which ${CLAUDE_CLI}`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    _cliExists = true;
  } catch {
    _cliExists = false;
  }
  return _cliExists;
}

async function callClaudeCli(prompt, content) {
  if (!cliExists()) return null;
  try {
    const input = `${prompt}\n\n---\n\n${content}`;
    const result = execSync(
      `${CLAUDE_CLI} -p --model haiku`,
      { input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim();
  } catch (e) {
    const err = asError(e);
    console.warn(`[lucidity] CLI call error: ${err.message}`);
    return null;
  }
}

// --- Generic HTTP request helper ---
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: options.method || 'POST',
      headers: options.headers || {},
    };

    const transport = isHttps ? https : http;
    const req = transport.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('API request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

// --- Backend: OpenAI-compatible API ---
async function callOpenAiApi(prompt, content) {
  if (!OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY');

  const base = OPENAI_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/v1/chat/completions`;

  const body = JSON.stringify({
    model: LLM_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content },
    ],
  });

  const data = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text === 'string') return text.trim();
  throw new Error(`Unexpected OpenAI response: ${JSON.stringify(data).slice(0, 200)}`);
}

// --- Backend: Anthropic API ---
async function callAnthropicApi(prompt, content) {
  if (!ANTHROPIC_API_KEY) throw new Error('No ANTHROPIC_API_KEY');

  const base = ANTHROPIC_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/v1/messages`;

  const body = JSON.stringify({
    model: LLM_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'user', content: `${prompt}\n\n---\n\n${content}` }
    ],
  });

  const data = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  if (data?.content?.[0]?.text) return data.content[0].text.trim();
  throw new Error(`Unexpected Anthropic response: ${JSON.stringify(data).slice(0, 200)}`);
}

// --- Backend: Naive fallback (no LLM) ---
function naiveSummarize(content, level) {
  const lines = content.trim().split('\n').filter(l => l.trim());
  switch (level) {
    case 'summary':
      // Take first 3 non-empty lines, truncate to 500 chars
      return lines.slice(0, 3).join(' ').slice(0, 500);
    case 'oneliner':
      return lines[0] ? lines[0].slice(0, 120) : '(empty)';
    case 'tag':
      // Extract capitalized words and common nouns as pseudo-tags
      const words = content.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || [];
      const unique = [...new Set(words)].slice(0, 5);
      return unique.length > 0 ? unique.join(', ') : lines[0] ? lines[0].slice(0, 50) : '(empty)';
    case 'root':
      return lines.slice(0, 10).join('\n').slice(0, 2000);
    default:
      return content.slice(0, 500);
  }
}

// --- Detect if model is OpenAI-family ---
function isOpenAiModel(model) {
  return /^(gpt-|o[134]-|o[134]$|chatgpt-)/.test(model);
}

// --- Main interface ---
async function summarize(content, level = 'summary') {
  const prompt = PROMPTS[level] || PROMPTS.summary;

  // Try backends in order: OpenAI > Anthropic > CLI > naive
  if (OPENAI_API_KEY && isOpenAiModel(LLM_MODEL)) {
    try {
      const result = await callOpenAiApi(prompt, content);
      if (result) {
        console.log(`[lucidity] LLM summarization (openai, ${level}): ok`);
        return result;
      }
    } catch (e) {
      const err = asError(e);
      console.warn(`[lucidity] OpenAI API call failed: ${err.message}, trying Anthropic...`);
    }
  }

  if (ANTHROPIC_API_KEY && !isOpenAiModel(LLM_MODEL)) {
    try {
      const result = await callAnthropicApi(prompt, content);
      if (result) {
        console.log(`[lucidity] LLM summarization (anthropic, ${level}): ok`);
        return result;
      }
    } catch (e) {
      const err = asError(e);
      console.warn(`[lucidity] Anthropic API call failed: ${err.message}, trying CLI...`);
    }
  }

  if (cliExists()) {
    try {
      const result = await callClaudeCli(prompt, content);
      if (result) {
        console.log(`[lucidity] LLM summarization (cli, ${level}): ok`);
        return result;
      }
    } catch (e) {
      const err = asError(e);
      console.warn(`[lucidity] CLI call failed: ${err.message}, using naive fallback`);
    }
  } else {
    console.log(`[lucidity] CLI not found (${CLAUDE_CLI}), skipping to fallback`);
  }

  console.log(`[lucidity] using naive fallback for ${level} compression`);
  return naiveSummarize(content, level);
}

// Check which backend is available
function getBackend() {
  if (OPENAI_API_KEY && isOpenAiModel(LLM_MODEL)) return 'openai-api';
  if (ANTHROPIC_API_KEY && !isOpenAiModel(LLM_MODEL)) return 'anthropic-api';
  try {
    execSync(`which ${CLAUDE_CLI}`, { encoding: 'utf8' });
    return 'claude-cli';
  } catch {
    return 'naive-fallback';
  }
}

module.exports = { summarize, getBackend, PROMPTS };
