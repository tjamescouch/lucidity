#!/usr/bin/env node
/**
 * lucidity/src/boot-memory.js
 *
 * One-shot boot loader for agent memory.
 * Reads tree.json, optionally curates new transcript data, emits skill.md.
 * Exits when done — designed to run before the agent starts.
 *
 * Usage:
 *   node boot-memory.js [--tree PATH] [--transcript PATH] [--output PATH] [--curate]
 *
 * Without --curate: just loads tree and emits skill.md (fast, no LLM needed)
 * With --curate: reads transcript delta, extracts facts, compresses old nodes, then emits
 */

const fs = require('fs');
const path = require('path');
const { createTree, addTrunkNode, compressNode, pruneOrphans,
        getCompactionTargets, saveTree, loadTree,
        writeSkillMd } = require('./tree');
const { asError } = require('./errors');

// --- Parse args ---
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(name);

const TREE_PATH = getArg('--tree', path.join(process.env.HOME, '.claude', 'memory', 'tree.json'));
const TRANSCRIPT_PATH = getArg('--transcript', null);
const SKILL_MD_PATH = getArg('--output', path.join(process.env.HOME, '.claude', 'agentchat.skill.md'));
const DO_CURATE = hasFlag('--curate');

// --- Main ---
async function main() {
  // Ensure directories exist
  fs.mkdirSync(path.dirname(TREE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(SKILL_MD_PATH), { recursive: true });

  // Load or create tree
  let tree = loadTree(TREE_PATH);
  if (tree) {
    console.log(`[boot-memory] loaded tree: ${Object.keys(tree.nodes).length} nodes, ${tree.trunk.length} trunk entries`);
  } else {
    tree = createTree();
    console.log('[boot-memory] no existing tree — created fresh');
  }

  // Optional: curate new transcript data
  if (DO_CURATE && TRANSCRIPT_PATH) {
    console.log('[boot-memory] curating transcript...');
    try {
      const { readTranscriptFile } = require('./transcript');
      const { summarize } = require('./llm');

      // Read the last chunk of transcript (we don't track offset in one-shot mode,
      // so read the tail — last 10k chars should capture the most recent session)
      if (fs.existsSync(TRANSCRIPT_PATH)) {
        const stat = fs.statSync(TRANSCRIPT_PATH);
        const readStart = Math.max(0, stat.size - 10000);
        const result = readTranscriptFile(TRANSCRIPT_PATH, {
          offset: readStart,
          format: 'auto',
          dedup: true,
        });

        if (result.bytesRead > 0) {
          console.log(`[boot-memory] read ${result.bytesRead} bytes of transcript`);
          // Summarize and add as trunk node
          try {
            const facts = await summarize(result.text, 'root');
            if (facts) {
              const node = addTrunkNode(tree, facts);
              console.log(`[boot-memory] added trunk node: ${node.id}`);
            }
          } catch (e) {
            const err = asError(e);
            console.warn(`[boot-memory] LLM summarization failed, using raw: ${err.message}`);
            const raw = result.text.slice(-2000);
            addTrunkNode(tree, raw);
          }
        }
      }

      // Compress old trunk nodes
      const targets = getCompactionTargets(tree);
      for (const target of targets) {
        try {
          const node = tree.nodes[target.id];
          if (!node) continue;
          const compressed = await summarize(node.content, target.to);
          compressNode(tree, target.id, compressed, target.to);
          console.log(`[boot-memory] compressed ${target.id}: ${target.from} → ${target.to}`);
        } catch (e) {
          const err = asError(e);
          console.warn(`[boot-memory] compression failed for ${target.id}: ${err.message}`);
        }
      }

      // Prune orphans
      const pruned = pruneOrphans(tree);
      if (pruned.length > 0) {
        console.log(`[boot-memory] pruned ${pruned.length} orphans`);
      }

      // Save updated tree
      saveTree(tree, TREE_PATH);
      console.log('[boot-memory] saved tree');
    } catch (e) {
      const err = asError(e);
      console.error(`[boot-memory] curation error: ${err.message}`);
      console.log('[boot-memory] continuing with existing tree state');
    }
  }

  // Always emit skill.md
  const content = writeSkillMd(tree, SKILL_MD_PATH);
  const size = fs.statSync(SKILL_MD_PATH).size;
  console.log(`[boot-memory] wrote ${SKILL_MD_PATH} (${size} bytes)`);

  // Summary
  if (tree.trunk.length === 0) {
    console.log('[boot-memory] no memories yet — skill.md will be minimal');
  } else {
    const newest = tree.nodes[tree.trunk[0]];
    if (newest) {
      const preview = newest.content.slice(0, 80).replace(/\n/g, ' ');
      console.log(`[boot-memory] latest memory: "${preview}..."`);
    }
  }
}

main().then(() => {
  console.log('[boot-memory] done');
  process.exit(0);
}).catch(e => {
  const err = asError(e);
  console.error(`[boot-memory] fatal: ${err.message}`);
  // Even on error, try to write a minimal skill.md so the agent isn't blank
  try {
    fs.mkdirSync(path.dirname(SKILL_MD_PATH), { recursive: true });
    fs.writeFileSync(SKILL_MD_PATH, '# memory\n\nboot-memory failed. no curated history available.\n');
    console.log('[boot-memory] wrote fallback skill.md');
  } catch (_) {}
  process.exit(1);
});
