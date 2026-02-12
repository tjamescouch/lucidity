#!/usr/bin/env node

/**
 * lucidity — boot-memory
 *
 * entry point for the boot sequence (behaviors/boot.md).
 * called by agent-supervisor.sh before the agent starts.
 *
 * 1. loads tree from local disk (or creates empty)
 * 2. generates skill.md from tree
 * 3. writes skill.md to the agent's expected path
 *
 * this is the minimal fast-path. no LLM calls, no compression.
 * just: load state, emit context, let the agent boot.
 *
 * usage:
 *   node boot-memory.js [--agent NAME] [--tree PATH] [--output PATH]
 *
 * defaults:
 *   --agent   $AGENT_NAME or "agent"
 *   --tree    ~/.claude/memory-tree/tree.json
 *   --output  ~/.claude/agentchat.skill.md
 */

const fs = require('fs');
const path = require('path');
const { loadTree, createTree, writeSkillMd } = require('./tree.js');
const { createStore } = require('./store.js');

const HOME = process.env.HOME || '/home/agent';

// --- arg parsing ---

const args = process.argv.slice(2);
let agentName = process.env.AGENT_NAME || 'agent';
let treePath = path.join(HOME, '.claude', 'memory-tree', 'tree.json');
let outputPath = path.join(HOME, '.claude', 'agentchat.skill.md');

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--agent': agentName = args[++i]; break;
    case '--tree': treePath = args[++i]; break;
    case '--output': outputPath = args[++i]; break;
    default:
      console.error(`unknown arg: ${args[i]}`);
      process.exit(1);
  }
}

function log(msg) {
  console.log(`[boot-memory] ${msg}`);
}

// --- main ---

function main() {
  log(`booting memory for agent: ${agentName}`);

  // step 1: load tree
  let tree = null;
  try {
    tree = loadTree(treePath);
  } catch (err) {
    log(`tree load error: ${err.message}`);
  }

  if (tree) {
    const nodeCount = Object.keys(tree.nodes).length;
    const trunkCount = tree.trunk.length;
    log(`loaded tree: ${nodeCount} nodes, ${trunkCount} trunk entries`);
  } else {
    log('no existing tree — agent will boot without memory');
    tree = createTree();
  }

  // step 2: ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // step 3: write skill.md
  const content = writeSkillMd(tree, outputPath);
  const size = fs.statSync(outputPath).size;
  log(`wrote skill.md (${size} bytes) to ${outputPath}`);

  // step 4: report store stats for debugging
  const store = createStore({
    treeDir: path.dirname(treePath),
  });
  const stats = store.stats();
  log(`store stats: ${JSON.stringify(stats)}`);

  log('boot complete');
}

try {
  main();
} catch (err) {
  // boot-memory must never crash the agent startup
  console.error(`[boot-memory] fatal error: ${err.message}`);
  console.error(`[boot-memory] agent will start without memory`);

  // write minimal skill.md so agent can still boot
  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, `# memory\n\nboot-memory failed: ${err.message}\nno previous memory available.\n`);
  } catch (_) {
    // truly nothing we can do
  }

  process.exit(0); // exit 0 so agent startup continues
}
