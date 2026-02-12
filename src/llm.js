// lucidity/src/llm.js
// LLM interface for curator summarization
// Supports: claude CLI, Anthropic API, or naive fallback

const { execSync } = require('child_process');
const https = require('https');

// --- Config ---
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const LLM_MODEL = process.env.LUCIDITY_MODEL || 'claude-sonnet-4-20250514';
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
  } catch (err) {
    console.warn(`[lucidity] CLI call error: ${err.message}`);
    return null;
  }
}

// --- Backend: Anthropic API ---
function callAnthropicApi(prompt, content) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) {
      return reject(new Error('No ANTHROPIC_API_KEY'));
    }

    const body = JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: `${prompt}\n\n---\n\n${content}` }
      ],
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content && parsed.content[0]) {
            resolve(parsed.content[0].text.trim());
          } else {
            reject(new Error(`Unexpected API response: ${data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('API request timeout'));
    });
    req.write(body);
    req.end();
  });
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

// --- Main interface ---
async function summarize(content, level = 'summary') {
  const prompt = PROMPTS[level] || PROMPTS.summary;

  // Try backends in order: API > CLI > naive
  if (ANTHROPIC_API_KEY) {
    try {
      const result = await callAnthropicApi(prompt, content);
      if (result) {
        console.log(`[lucidity] LLM summarization (api, ${level}): ok`);
        return result;
      }
    } catch (err) {
      console.warn(`[lucidity] API call failed: ${err.message}, trying CLI...`);
    }
  }

  if (cliExists()) {
    try {
      const result = await callClaudeCli(prompt, content);
      if (result) {
        console.log(`[lucidity] LLM summarization (cli, ${level}): ok`);
        return result;
      }
    } catch (err) {
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
  if (ANTHROPIC_API_KEY) return 'anthropic-api';
  try {
    execSync(`which ${CLAUDE_CLI}`, { encoding: 'utf8' });
    return 'claude-cli';
  } catch {
    return 'naive-fallback';
  }
}

module.exports = { summarize, getBackend, PROMPTS };
