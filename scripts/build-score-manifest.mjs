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

const PROGRESS_FILE = 'scripts/ralph-progress.json';
const MULTI_SCORE_DIR = '/tmp/multi-score';
const DAEMON_SCORES_DIR = 'scores';
const OUTPUT_FILE = 'src/data/score-manifest.json';

// Ensure output dir exists
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

const manifest = {};

// Load Ralph vibe scores
if (fs.existsSync(PROGRESS_FILE)) {
  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  for (const [file, data] of Object.entries(progress.posts || {})) {
    const ticketId = data.ticketId;
    if (!ticketId || !data.scores) continue;

    if (!manifest[ticketId]) manifest[ticketId] = {};
    manifest[ticketId].vibe = {
      persona: data.scores.persona,
      clawdNote: data.scores.clawdNote,
      vibe: data.scores.vibe,
    };
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
      manifest[ticketId].factCheck = data.score;
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
      manifest[ticketId].crossRef = data.score;
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
        manifest[ticketId].factCheck = data.judges.factCheck.score;
      }

      // Extract cross-ref score (single number)
      if (data.judges?.crossRef?.score != null) {
        manifest[ticketId].crossRef = data.judges.crossRef.score;
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

        if (judgeType === 'fact') {
          manifest[ticketId].factCheck = data.score;
          count++;
        } else if (judgeType === 'crossref') {
          manifest[ticketId].crossRef = data.score;
          count++;
        } else if (judgeType === 'vibe') {
          // Opus daemon scores have persona/clawdNote/vibe in details
          if (data.details?.persona != null) {
            manifest[ticketId].vibe = {
              persona: data.details.persona,
              clawdNote: data.details.clawdNote,
              vibe: data.details.vibe,
            };
          } else {
            // Fallback: just store the aggregate score
            manifest[ticketId].vibe = { score: data.score };
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

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`Score manifest: ${Object.keys(manifest).length} posts → ${OUTPUT_FILE}`);
