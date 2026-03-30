#!/usr/bin/env node
/**
 * build-score-manifest.mjs - Build a single JSON manifest from ralph-progress.json
 * and any multi-score results for UI consumption at build time.
 *
 * Output: src/data/score-manifest.json
 *
 * Usage: node scripts/build-score-manifest.mjs
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PROGRESS_FILE = 'scripts/ralph-progress.json';
const MULTI_SCORE_DIR = '/tmp/multi-score';
const DAEMON_SCORES_DIR = 'scores';
const OUTPUT_FILE = 'src/data/score-manifest.json';

// Ensure output dir exists
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

// --- Version helpers ---

let _gitAvailable = true;

/**
 * Count git commits touching filePath, optionally only those before beforeTs (ISO string).
 * Returns null if git is unavailable or the file has no history.
 */
function getFileCommitCount(filePath, beforeTs = null) {
  if (!_gitAvailable) return null;
  try {
    const beforeFlag = beforeTs ? `--before="${beforeTs}"` : '';
    const out = execSync(
      `git log ${beforeFlag} --oneline -- "${filePath}"`,
      { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 },
    );
    const count = out.trim().split('\n').filter(Boolean).length;
    return count > 0 ? count : null;
  } catch {
    _gitAvailable = false;
    return null;
  }
}

// --- Manifest build ---

const manifest = {};

// ticketId → MDX filename (without path prefix), used to compute currentVersion
const ticketToFile = {};

// Load Ralph vibe scores (from ralph-progress.json, has timestamp per entry)
if (fs.existsSync(PROGRESS_FILE)) {
  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  for (const [file, data] of Object.entries(progress.posts || {})) {
    const ticketId = data.ticketId;
    if (!ticketId || !data.scores) continue;

    ticketToFile[ticketId] = file;

    const vibeEntry = {
      persona: data.scores.persona,
      clawdNote: data.scores.clawdNote,
      vibe: data.scores.vibe,
    };

    // Compute scoredAtVersion if we have a timestamp
    if (data.timestamp) {
      const v = getFileCommitCount(`src/content/posts/${file}`, data.timestamp);
      if (v != null) vibeEntry.scoredAtVersion = v;
    }

    if (!manifest[ticketId]) manifest[ticketId] = {};
    manifest[ticketId].vibe = vibeEntry;
  }
}

// Load individual scorer results + legacy multi-score results
if (fs.existsSync(MULTI_SCORE_DIR)) {
  // Codex single-score files (codex-TICKET.json)
  for (const file of fs
    .readdirSync(MULTI_SCORE_DIR)
    .filter((f) => f.startsWith('codex-') && f.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MULTI_SCORE_DIR, file), 'utf8'));
      const ticketId = data.ticketId || file.replace('codex-', '').replace('.json', '');
      if (!ticketId || data.score == null) continue;
      if (!manifest[ticketId]) manifest[ticketId] = {};
      manifest[ticketId].factCheck = { score: data.score };
    } catch (e) {
      console.error(`codex ${file}:`, e.message);
    }
  }

  // Gemini single-score files (gemini-TICKET.json)
  for (const file of fs
    .readdirSync(MULTI_SCORE_DIR)
    .filter((f) => f.startsWith('gemini-') && f.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MULTI_SCORE_DIR, file), 'utf8'));
      const ticketId = data.ticketId || file.replace('gemini-', '').replace('.json', '');
      if (!ticketId || data.score == null) continue;
      if (!manifest[ticketId]) manifest[ticketId] = {};
      manifest[ticketId].crossRef = { score: data.score };
    } catch (e) {
      console.error(`gemini ${file}:`, e.message);
    }
  }

  // Legacy multi-score files
  const files = fs
    .readdirSync(MULTI_SCORE_DIR)
    .filter((f) => f.startsWith('multi-score-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MULTI_SCORE_DIR, file), 'utf8'));
      const ticketId = data.ticketId;
      if (!ticketId) continue;

      if (!manifest[ticketId]) manifest[ticketId] = {};

      // Extract fact-check score (single number)
      if (data.judges?.factCheck?.score != null) {
        manifest[ticketId].factCheck = { score: data.judges.factCheck.score };
      }

      // Extract cross-ref score (single number)
      if (data.judges?.crossRef?.score != null) {
        manifest[ticketId].crossRef = { score: data.judges.crossRef.score };
      }
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e.message);
    }
  }
}

// Load daemon scores (scores/*.json) — written by ralph-orchestrator daemon
// These take priority over /tmp/multi-score since they're newer
const DAEMON_JUDGES = {
  'codex-scores.json': 'fact',
  'gemini-scores.json': 'crossref',
  'opus-scores.json': 'vibe',
};

if (fs.existsSync(DAEMON_SCORES_DIR)) {
  for (const [file, judgeType] of Object.entries(DAEMON_JUDGES)) {
    const filePath = path.join(DAEMON_SCORES_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const scores = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let count = 0;

      for (const [ticketId, data] of Object.entries(scores)) {
        if (!ticketId || data.score == null) continue;
        if (!manifest[ticketId]) manifest[ticketId] = {};

        // Track file mapping for currentVersion computation
        if (data.file) ticketToFile[ticketId] = data.file;

        // Compute scoredAtVersion if we have a timestamp and file
        let scoredAtVersion;
        if (data.ts && data.file) {
          const v = getFileCommitCount(`src/content/posts/${data.file}`, data.ts);
          if (v != null) scoredAtVersion = v;
        }

        if (judgeType === 'fact') {
          const entry = { score: data.score };
          if (scoredAtVersion != null) entry.scoredAtVersion = scoredAtVersion;
          manifest[ticketId].factCheck = entry;
          count++;
        } else if (judgeType === 'crossref') {
          const entry = { score: data.score };
          if (scoredAtVersion != null) entry.scoredAtVersion = scoredAtVersion;
          manifest[ticketId].crossRef = entry;
          count++;
        } else if (judgeType === 'vibe') {
          // Opus daemon scores have persona/clawdNote/vibe in details
          if (data.details?.persona != null) {
            const entry = {
              persona: data.details.persona,
              clawdNote: data.details.clawdNote,
              vibe: data.details.vibe,
            };
            if (scoredAtVersion != null) entry.scoredAtVersion = scoredAtVersion;
            manifest[ticketId].vibe = entry;
          } else {
            // Fallback: just store the aggregate score
            const entry = { score: data.score };
            if (scoredAtVersion != null) entry.scoredAtVersion = scoredAtVersion;
            manifest[ticketId].vibe = entry;
          }
          count++;
        }
      }

      console.log(`  daemon ${file}: ${count} scores loaded`);
    } catch (e) {
      console.error(`daemon ${file}:`, e.message);
    }
  }
}

// Add currentVersion to each manifest entry
for (const [ticketId, entry] of Object.entries(manifest)) {
  const file = ticketToFile[ticketId];
  if (!file) continue;
  const v = getFileCommitCount(`src/content/posts/${file}`);
  if (v != null) entry.currentVersion = v;
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`Score manifest: ${Object.keys(manifest).length} posts → ${OUTPUT_FILE}`);
