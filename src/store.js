#!/usr/bin/env node

/**
 * lucidity — store component
 *
 * persistence layer for the memory tree.
 * handles local disk storage and external backup (git-based).
 *
 * local disk is primary. git is the durable backup.
 * raw transcripts are append-only, never deleted.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { saveTree, loadTree } = require('./tree.js');

const DEFAULT_TREE_DIR = path.join(process.env.HOME || '/home/agent', '.claude', 'memory-tree');
const DEFAULT_TRANSCRIPT_DIR = path.join(process.env.HOME || '/home/agent', '.claude', 'transcripts');

function createStore(opts = {}) {
  const treeDir = opts.treeDir || DEFAULT_TREE_DIR;
  const transcriptDir = opts.transcriptDir || DEFAULT_TRANSCRIPT_DIR;
  const treePath = path.join(treeDir, 'tree.json');

  // ensure directories exist
  fs.mkdirSync(treeDir, { recursive: true });
  fs.mkdirSync(transcriptDir, { recursive: true });

  return {
    treePath,
    treeDir,
    transcriptDir,

    /**
     * load tree from local disk.
     * returns null if no tree exists.
     */
    load() {
      try {
        return loadTree(treePath);
      } catch (err) {
        console.error(`[store] failed to load tree: ${err.message}`);
        return null;
      }
    },

    /**
     * save tree to local disk.
     * uses atomic write (tmp + rename) via tree.js.
     */
    save(tree) {
      try {
        saveTree(tree, treePath);
        return true;
      } catch (err) {
        console.error(`[store] failed to save tree: ${err.message}`);
        return false;
      }
    },

    /**
     * append a line to the transcript log.
     * transcripts are append-only, never modified, never deleted.
     */
    appendTranscript(agentName, content) {
      const logPath = path.join(transcriptDir, `${agentName}.log`);
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] ${content}\n`;
      try {
        fs.appendFileSync(logPath, line);
        return true;
      } catch (err) {
        console.error(`[store] failed to append transcript: ${err.message}`);
        return false;
      }
    },

    /**
     * read the transcript log for an agent.
     * returns the last N lines (for curator consumption).
     */
    readTranscript(agentName, maxLines = 200) {
      const logPath = path.join(transcriptDir, `${agentName}.log`);
      if (!fs.existsSync(logPath)) return null;
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.length > 0);
        return lines.slice(-maxLines).join('\n');
      } catch (err) {
        console.error(`[store] failed to read transcript: ${err.message}`);
        return null;
      }
    },

    /**
     * sync local tree state to git (external backup).
     * commits tree.json + transcripts to a local git repo.
     * push is separate (requires remote config).
     *
     * returns { success, message }
     */
    sync(agentName = 'agent') {
      try {
        // init git repo in tree dir if needed
        if (!fs.existsSync(path.join(treeDir, '.git'))) {
          execSync('git init', { cwd: treeDir, stdio: 'pipe' });
          execSync('git config user.email "curator@lucidity"', { cwd: treeDir, stdio: 'pipe' });
          execSync('git config user.name "lucidity-curator"', { cwd: treeDir, stdio: 'pipe' });
        }

        // copy transcripts into tree dir for unified backup
        const transcriptDest = path.join(treeDir, 'transcripts');
        fs.mkdirSync(transcriptDest, { recursive: true });

        const transcriptFiles = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.log'));
        for (const file of transcriptFiles) {
          fs.copyFileSync(
            path.join(transcriptDir, file),
            path.join(transcriptDest, file)
          );
        }

        // stage and commit
        execSync('git add -A', { cwd: treeDir, stdio: 'pipe' });

        // check if there's anything to commit
        try {
          execSync('git diff --cached --quiet', { cwd: treeDir, stdio: 'pipe' });
          return { success: true, message: 'no changes to sync' };
        } catch (_) {
          // diff --quiet exits non-zero when there are staged changes
        }

        const msg = `curator sync: ${agentName} @ ${new Date().toISOString()}`;
        execSync(`git commit -m "${msg}"`, { cwd: treeDir, stdio: 'pipe' });
        return { success: true, message: 'committed' };
      } catch (err) {
        return { success: false, message: err.message };
      }
    },

    /**
     * get store stats for logging/debugging.
     */
    stats() {
      const treeExists = fs.existsSync(treePath);
      let nodeCount = 0;
      let trunkCount = 0;
      let treeSize = 0;

      if (treeExists) {
        try {
          const stat = fs.statSync(treePath);
          treeSize = stat.size;
          const tree = this.load();
          if (tree) {
            nodeCount = Object.keys(tree.nodes).length;
            trunkCount = tree.trunk.length;
          }
        } catch (_) {}
      }

      const transcriptFiles = fs.existsSync(transcriptDir)
        ? fs.readdirSync(transcriptDir).filter(f => f.endsWith('.log'))
        : [];

      let totalTranscriptSize = 0;
      for (const file of transcriptFiles) {
        try {
          totalTranscriptSize += fs.statSync(path.join(transcriptDir, file)).size;
        } catch (_) {}
      }

      return {
        treeExists,
        nodeCount,
        trunkCount,
        treeSizeBytes: treeSize,
        transcriptCount: transcriptFiles.length,
        transcriptTotalBytes: totalTranscriptSize,
      };
    },
  };
}

module.exports = { createStore };
