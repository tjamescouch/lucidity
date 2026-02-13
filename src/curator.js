#!/usr/bin/env node
// lucidity/src/curator.js
// The curator process — watches transcript, curates memory tree, emits skill.md
// Uses Bob's tree.js API (addTrunkNode, compressNode, pruneOrphans, etc.)

const fs = require('fs');
const path = require('path');
const { createTree, addTrunkNode, compressNode, pruneOrphans,
        getCompactionTargets, saveTree, loadTree,
        emitSkillMd, writeSkillMd: writeSkillMdToFile } = require('./tree');
const { summarize, getBackend } = require('./llm');
const { readTranscriptFile } = require('./transcript');
const { asError } = require('./errors');

// --- Config ---
const CURATION_INTERVAL_MS = parseInt(process.env.LUCIDITY_INTERVAL || '300000'); // 5 min default
const SKILL_MD_PATH = process.env.LUCIDITY_SKILL_PATH || path.join(process.env.HOME, '.claude', 'agentchat.skill.md');
const TREE_PATH = process.env.LUCIDITY_TREE_PATH || path.join(process.env.HOME, '.claude', 'memory', 'tree.json');
const PAGES_DIR = process.env.LUCIDITY_PAGES_DIR || path.join(process.env.HOME, '.claude', 'memory', 'pages');
const TRANSCRIPT_PATH = process.env.LUCIDITY_TRANSCRIPT || null;

// --- State ---
let tree = null;
let lastCurationOffset = 0;
let running = true;

// --- Init ---
function init() {
  fs.mkdirSync(path.dirname(SKILL_MD_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(TREE_PATH), { recursive: true });
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  // Load existing tree or create new one
  const loaded = loadTree(TREE_PATH);
  if (loaded) {
    tree = loaded;
    console.log('[lucidity] loaded existing tree from disk');
  } else {
    tree = createTree();
    console.log('[lucidity] no existing tree found, creating new one');
  }

  console.log(`[lucidity] curator started. interval=${CURATION_INTERVAL_MS}ms`);
  console.log(`[lucidity] skill.md -> ${SKILL_MD_PATH}`);
  console.log(`[lucidity] tree -> ${TREE_PATH}`);
  console.log(`[lucidity] tree has ${Object.keys(tree.nodes).length} nodes, ${tree.trunk.length} trunk entries`);
  console.log(`[lucidity] llm backend: ${getBackend()}`);

  // Write initial skill.md
  doWriteSkillMd();
}

function doWriteSkillMd() {
  try {
    writeSkillMdToFile(tree, SKILL_MD_PATH);
    const size = fs.statSync(SKILL_MD_PATH).size;
    console.log(`[lucidity] wrote skill.md (${size} bytes)`);
  } catch (e) {
    const err = asError(e);
    console.error('[lucidity] failed to write skill.md:', err.message);
  }
}

function doSaveTree() {
  try {
    saveTree(tree, TREE_PATH);
  } catch (e) {
    const err = asError(e);
    console.error('[lucidity] failed to save tree:', err.message);
  }
}

// --- Curation ---
function readTranscriptDelta() {
  if (!TRANSCRIPT_PATH || !fs.existsSync(TRANSCRIPT_PATH)) {
    return null;
  }
  try {
    const result = readTranscriptFile(TRANSCRIPT_PATH, {
      offset: lastCurationOffset,
      format: 'auto',
      dedup: true,
    });
    if (result.bytesRead === 0) {
      return null;
    }
    lastCurationOffset = result.newOffset;
    console.log(`[lucidity] read ${result.bytesRead} bytes of transcript (offset now ${result.newOffset})`);
    return result.text;
  } catch (e) {
    const err = asError(e);
    console.error('[lucidity] failed to read transcript:', err.message);
    return null;
  }
}

async function extractKeyFacts(transcript) {
  if (!transcript) return null;
  const input = transcript.length > 10000 ? transcript.slice(-10000) : transcript;
  try {
    return await summarize(input, 'root');
  } catch (e) {
    const err = asError(e);
    console.warn(`[lucidity] LLM extraction failed, using raw truncation: ${err.message}`);
    const lines = input.trim().split('\n');
    const recent = lines.slice(-50).join('\n');
    return recent.length > 2000 ? recent.slice(-2000) : recent;
  }
}

async function compressTrunk() {
  // Use Bob's getCompactionTargets to find what needs compressing
  const targets = getCompactionTargets(tree);
  for (const target of targets) {
    try {
      const node = tree.nodes[target.id];
      if (!node) continue;
      const compressed = await summarize(node.content, target.to);
      compressNode(tree, target.id, compressed, target.to);
      console.log(`[lucidity] compressed ${target.id}: ${target.from} → ${target.to}`);
    } catch (e) {
      const err = asError(e);
      console.warn(`[lucidity] compression failed for ${target.id}: ${err.message}`);
    }
  }
}

async function curate() {
  console.log(`[lucidity] curation pass starting...`);

  // 1. Read transcript delta
  const delta = readTranscriptDelta();

  // 2. Extract and add new trunk node
  if (delta) {
    const facts = await extractKeyFacts(delta);
    if (facts) {
      const node = addTrunkNode(tree, facts);
      console.log(`[lucidity] added trunk node: ${node.id}`);
    }
  }

  // 3. Compress trunk (old nodes get summarized)
  await compressTrunk();

  // 4. Prune orphan branches
  const pruned = pruneOrphans(tree);
  if (pruned.length > 0) {
    console.log(`[lucidity] pruned ${pruned.length} orphan branches`);
  }

  // 5. Emit skill.md
  doWriteSkillMd();

  // 6. Save tree
  doSaveTree();

  console.log(`[lucidity] curation pass complete. ${Object.keys(tree.nodes).length} nodes, ${tree.trunk.length} trunk entries.`);
}

// --- Lifecycle ---
async function run() {
  init();

  while (running) {
    await curate();
    await sleep(CURATION_INTERVAL_MS);
  }
}

function shutdown() {
  console.log('[lucidity] shutting down...');
  running = false;
  curate().then(() => {
    console.log('[lucidity] final curation complete. goodbye.');
    process.exit(0);
  }).catch(e => {
    const err = asError(e);
    console.error('[lucidity] error during shutdown curation:', err.message);
    doSaveTree();
    doWriteSkillMd();
    process.exit(1);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

run().catch(e => {
  const err = asError(e);
  console.error('[lucidity] fatal error:', err.message);
  process.exit(1);
});
