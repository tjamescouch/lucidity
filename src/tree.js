#!/usr/bin/env node

/**
 * lucidity — tree data structure
 *
 * temporal spine with associative branches.
 * nodes have: id, created_at, updated_at, depth, content, links, summary_level
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function makeId() {
  return crypto.randomBytes(8).toString('hex');
}

function createNode({ content, depth = 0, summaryLevel = 'full', links = [] }) {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    created_at: now,
    updated_at: now,
    depth,
    content,
    links, // array of { target_id, label }
    summary_level: summaryLevel, // full | summary | oneliner | tag
  };
}

function createTree() {
  return {
    nodes: {},   // id -> node
    trunk: [],   // ordered list of trunk node ids, newest first
    version: 1,
  };
}

function addTrunkNode(tree, content) {
  const node = createNode({ content, depth: 0 });
  tree.nodes[node.id] = node;
  tree.trunk.unshift(node.id); // newest first
  return node;
}

function addBranchNode(tree, parentId, content, label) {
  const parent = tree.nodes[parentId];
  if (!parent) throw new Error(`parent node ${parentId} not found`);

  const node = createNode({ content, depth: parent.depth + 1 });
  tree.nodes[node.id] = node;
  parent.links.push({ target_id: node.id, label });
  parent.updated_at = new Date().toISOString();
  return node;
}

function compressNode(tree, nodeId, newContent, targetLevel) {
  const node = tree.nodes[nodeId];
  if (!node) throw new Error(`node ${nodeId} not found`);

  const levels = ['full', 'summary', 'oneliner', 'tag'];
  const currentIdx = levels.indexOf(node.summary_level);
  const targetIdx = levels.indexOf(targetLevel);

  if (targetIdx <= currentIdx) {
    throw new Error(`cannot compress ${node.summary_level} to ${targetLevel} — level must decrease`);
  }

  node.content = newContent;
  node.summary_level = targetLevel;
  node.updated_at = new Date().toISOString();
  return node;
}

function pruneOrphans(tree, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  const referenced = new Set();

  // collect all referenced node ids
  for (const node of Object.values(tree.nodes)) {
    for (const link of node.links) {
      referenced.add(link.target_id);
    }
  }
  // trunk nodes are always referenced
  for (const id of tree.trunk) {
    referenced.add(id);
  }

  const pruned = [];
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (!referenced.has(id)) {
      const age = now - new Date(node.created_at).getTime();
      if (age > maxAgeMs) {
        pruned.push(id);
        delete tree.nodes[id];
      }
    }
  }
  return pruned;
}

function getCompactionTargets(tree, thresholds = {}) {
  const defaults = {
    summary: 60 * 60 * 1000,           // 1 hour
    oneliner: 24 * 60 * 60 * 1000,     // 1 day
    tag: 7 * 24 * 60 * 60 * 1000,      // 1 week
  };
  const t = { ...defaults, ...thresholds };
  const now = Date.now();
  const targets = [];

  for (const id of tree.trunk) {
    const node = tree.nodes[id];
    if (!node) continue;
    const age = now - new Date(node.created_at).getTime();

    if (node.summary_level === 'full' && age > t.summary) {
      targets.push({ id, from: 'full', to: 'summary' });
    } else if (node.summary_level === 'summary' && age > t.oneliner) {
      targets.push({ id, from: 'summary', to: 'oneliner' });
    } else if (node.summary_level === 'oneliner' && age > t.tag) {
      targets.push({ id, from: 'oneliner', to: 'tag' });
    }
  }
  return targets;
}

// --- persistence ---

function saveTree(tree, filepath) {
  const tmpPath = filepath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(tree, null, 2));
  fs.renameSync(tmpPath, filepath); // atomic write-before-delete
}

function loadTree(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const data = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(data);
}

// --- skill.md generation ---

function emitSkillMd(tree, maxTokenEstimate = 4000) {
  const lines = [];
  const charsPerToken = 4; // rough estimate
  const maxChars = maxTokenEstimate * charsPerToken;
  let charCount = 0;

  lines.push('# memory');
  lines.push('');

  // current session (first trunk node, full detail)
  if (tree.trunk.length > 0) {
    const root = tree.nodes[tree.trunk[0]];
    if (root) {
      lines.push('## current session');
      lines.push('');
      lines.push(root.content);
      lines.push('');
      charCount += root.content.length + 30;

      // emit branch links from root
      if (root.links.length > 0) {
        lines.push('### topics');
        for (const link of root.links) {
          lines.push(`- @@seek(id=${link.target_id})@@ ${link.label}`);
          charCount += 40 + link.label.length;
        }
        lines.push('');
      }
    }
  }

  // recent trunk summaries
  if (tree.trunk.length > 1) {
    lines.push('## recent history');
    lines.push('');
    for (let i = 1; i < tree.trunk.length; i++) {
      const node = tree.nodes[tree.trunk[i]];
      if (!node) continue;

      const entry = `- [${node.summary_level}] ${node.content}`;
      if (charCount + entry.length > maxChars) {
        lines.push('- ... (older history truncated)');
        break;
      }
      lines.push(entry);
      charCount += entry.length;

      // compact branch index for non-root nodes
      for (const link of node.links) {
        const branchEntry = `  - @@seek(id=${link.target_id})@@ ${link.label}`;
        if (charCount + branchEntry.length > maxChars) break;
        lines.push(branchEntry);
        charCount += branchEntry.length;
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function writeSkillMd(tree, filepath, maxTokens = 4000) {
  const content = emitSkillMd(tree, maxTokens);
  const tmpPath = filepath + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filepath);
  return content;
}

module.exports = {
  createTree,
  createNode,
  addTrunkNode,
  addBranchNode,
  compressNode,
  pruneOrphans,
  getCompactionTargets,
  saveTree,
  loadTree,
  emitSkillMd,
  writeSkillMd,
};
