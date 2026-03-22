#!/usr/bin/env node
/**
 * build-score-manifest.mjs — Build a single JSON manifest from ralph-progress.json
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

// Load multi-score results (if any exist)
if (fs.existsSync(MULTI_SCORE_DIR)) {
  const files = fs
    .readdirSync(MULTI_SCORE_DIR)
    .filter((f) => f.startsWith('multi-score-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(MULTI_SCORE_DIR, file), 'utf8'));
      const ticketId = data.ticketId;
      if (!ticketId) continue;

      if (!manifest[ticketId]) manifest[ticketId] = {};

      // Extract fact-check scores
      if (data.judges?.factCheck?.scores) {
        const fc = data.judges.factCheck.scores;
        manifest[ticketId].factCheck = {
          dataAccuracy: fc.dataAccuracy?.score,
          attributionAccuracy: fc.attributionAccuracy?.score,
          logicalCoherence: fc.logicalCoherence?.score,
        };
      }

      // Extract cross-ref scores
      if (data.judges?.crossRef?.scores) {
        const cr = data.judges.crossRef.scores;
        manifest[ticketId].crossRef = {
          sourceFidelity: cr.sourceFidelity?.score,
          internalCrossRefs: cr.internalCrossRefs?.score,
          sourceCoverage: cr.sourceCoverage?.score,
        };
      }
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e.message);
    }
  }
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`Score manifest: ${Object.keys(manifest).length} posts → ${OUTPUT_FILE}`);
