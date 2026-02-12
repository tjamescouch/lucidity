#!/usr/bin/env node

/**
 * lucidity curator — memory curation between agent sessions
 *
 * reads the transcript from the last session, updates the memory tree,
 * compresses old nodes via `claude -p`, and emits skill.md.
 *
 * usage:
 *   node curator.js --agent NAME --tree PATH --transcript PATH --output PATH [--curate]
 *
 * flags:
 *   --agent       agent name (for logging/context)
 *   --tree        path to tree.json (created if missing)
 *   --transcript  path to transcript log
 *   --output      path to write skill.md
 *   --curate      run compression pass (requires claude -p)
 *
 * without --curate, just adds a trunk node from the transcript and emits skill.md.
 * with --curate, also compresses old nodes using claude -p for summarization.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  createTree,
  addTrunkNode,
  compressNode,
  getCompactionTargets,
  pruneOrphans,
  saveTree,
  loadTree,
  writeSkillMd,
} = require('./tree.js');

// --- arg parsing ---

const args = process.argv.slice(2);
let agentName = 'agent';
let treePath = '';
let transcriptPath = '';
let outputPath = '';
let doCurate = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--agent': agentName = args[++i]; break;
    case '--tree': treePath = args[++i]; break;
    case '--transcript': transcriptPath = args[++i]; break;
    case '--output': outputPath = args[++i]; break;
    case '--curate': doCurate = true; break;
    default:
      console.error(`unknown arg: ${args[i]}`);
      process.exit(1);
  }
}

if (!treePath || !outputPath) {
  console.error('usage: curator.js --agent NAME --tree PATH --transcript PATH --output PATH [--curate]');
  process.exit(1);
}

function log(msg) {
  console.log(`[curator] ${msg}`);
}

// --- transcript reading ---

function readTranscript(filepath, maxLines = 200) {
  if (!filepath || !fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');
  // take last N lines for current session context
  const recent = lines.slice(-maxLines).join('\n').trim();
  return recent || null;
}

// --- LLM summarization via claude -p ---

function summarize(content, targetLevel, agentContext) {
  const prompts = {
    summary: `You are a memory curator for an AI agent named "${agentContext}". Compress the following session transcript into a concise summary (2-4 sentences). Preserve: key decisions made, important facts learned, tasks completed or assigned, and any unresolved issues. Drop: greetings, filler, repetition, verbose explanations.

Transcript:
${content}

Write ONLY the summary, nothing else.`,

    oneliner: `You are a memory curator. Compress this summary into a single sentence (max 120 chars). Keep the most important fact or decision.

Summary:
${content}

Write ONLY the one-liner, nothing else.`,

    tag: `You are a memory curator. Compress this into a short tag/label (2-5 words max). Like a commit message subject.

Content:
${content}

Write ONLY the tag, nothing else.`,
  };

  const prompt = prompts[targetLevel];
  if (!prompt) {
    log(`no prompt template for level: ${targetLevel}`);
    return null;
  }

  try {
    // claude -p reads prompt from stdin, outputs to stdout
    const result = execSync(
      `claude -p`,
      {
        input: prompt,
        encoding: 'utf-8',
        timeout: 60000, // 60s timeout
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return result.trim();
  } catch (err) {
    log(`claude -p failed: ${err.message}`);
    return null;
  }
}

// --- main ---

function main() {
  log(`starting for agent: ${agentName}`);

  // load or create tree
  let tree;
  try {
    tree = loadTree(treePath);
  } catch (err) {
    log(`tree.json corrupted or unreadable: ${err.message}`);
    log('starting fresh (corrupted file will be overwritten on save)');
    tree = null;
  }
  if (tree) {
    log(`loaded tree (${Object.keys(tree.nodes).length} nodes, ${tree.trunk.length} trunk)`);
  } else {
    log('no existing tree — starting fresh');
    tree = createTree();
  }

  // read transcript and add as trunk node
  const transcript = readTranscript(transcriptPath);
  if (transcript) {
    log(`read transcript (${transcript.length} chars)`);
    addTrunkNode(tree, transcript);
    log('added trunk node from transcript');
  } else {
    log('no transcript available — skipping trunk node');
  }

  // compression pass (if requested and claude is available)
  if (doCurate) {
    log('running compression pass...');
    const targets = getCompactionTargets(tree);
    log(`found ${targets.length} compaction targets`);

    for (const target of targets) {
      const node = tree.nodes[target.id];
      if (!node) continue;

      log(`compressing node ${target.id.slice(0, 8)}... (${target.from} -> ${target.to})`);
      const compressed = summarize(node.content, target.to, agentName);

      if (compressed) {
        compressNode(tree, target.id, compressed, target.to);
        log(`  compressed to ${compressed.length} chars`);
      } else {
        log(`  summarization failed — keeping original content`);
      }
    }

    // prune orphans
    const pruned = pruneOrphans(tree);
    if (pruned.length > 0) {
      log(`pruned ${pruned.length} orphan nodes`);
    }
  }

  // save tree
  const treeDir = path.dirname(treePath);
  if (!fs.existsSync(treeDir)) {
    fs.mkdirSync(treeDir, { recursive: true });
  }
  saveTree(tree, treePath);
  log(`saved tree to ${treePath}`);

  // emit skill.md
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  writeSkillMd(tree, outputPath);
  log(`wrote skill.md to ${outputPath}`);

  // summary stats
  const nodeCount = Object.keys(tree.nodes).length;
  const trunkCount = tree.trunk.length;
  const skillSize = fs.statSync(outputPath).size;
  log(`done: ${nodeCount} nodes, ${trunkCount} trunk entries, skill.md ${skillSize} bytes`);
}

main();
