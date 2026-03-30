#!/usr/bin/env node
/**
 * backfill-scores-to-frontmatter.mjs — One-time migration: scores/*.json → frontmatter
 *
 * Reads existing score manifests and writes them into each post's frontmatter.
 * Safe to run multiple times (overwrites existing frontmatter scores).
 *
 * Usage: node scripts/backfill-scores-to-frontmatter.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DRY_RUN = process.argv.includes('--dry-run');
const POSTS_DIR = 'src/content/posts';
const SCORES_DIR = 'scores';
const RALPH_PROGRESS = 'scripts/ralph-progress.json';

// Build ticketId → file mapping
function buildTicketMap() {
  const map = {}; // ticketId → [zhFile, enFile?]
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const match = content.match(/ticketId:\s*"([^"]+)"/);
    if (match) {
      const tid = match[1];
      if (!map[tid]) map[tid] = [];
      map[tid].push(file);
    }
  }
  return map;
}

// Collect all scores per ticketId
function collectScores() {
  const allScores = {}; // ticketId → { gemini, codex, ralph }

  // 1. Legacy Ralph vibe scores from ralph-progress.json
  if (fs.existsSync(RALPH_PROGRESS)) {
    const progress = JSON.parse(fs.readFileSync(RALPH_PROGRESS, 'utf8'));
    for (const [, data] of Object.entries(progress.posts || {})) {
      const tid = data.ticketId;
      if (!tid || !data.scores) continue;
      if (!allScores[tid]) allScores[tid] = {};
      allScores[tid].ralph = {
        p: data.scores.persona,
        c: data.scores.clawdNote,
        v: data.scores.vibe,
        date: data.timestamp ? data.timestamp.slice(0, 10) : '2026-03-01',
        model: data.model || 'claude-opus-4-6',
        harness: 'Claude Code',
      };
    }
  }

  // 2. Daemon scores from scores/*.json (take priority)
  const judgeFiles = {
    'gemini-scores.json': 'gemini',
    'codex-scores.json': 'codex',
    'opus-scores.json': 'opus',
  };

  for (const [file, judge] of Object.entries(judgeFiles)) {
    const filePath = path.join(SCORES_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    
    const scores = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const [tid, data] of Object.entries(scores)) {
      if (!tid || data.score == null) continue;
      if (!allScores[tid]) allScores[tid] = {};

      const date = data.ts ? data.ts.slice(0, 10) : '2026-03-28';

      if (judge === 'opus') {
        // Opus has persona/clawdNote/vibe in details
        if (data.details?.persona != null) {
          allScores[tid].ralph = {
            p: data.details.persona,
            c: data.details.clawdNote,
            v: data.details.vibe,
            date,
            model: data.model || undefined,
            harness: 'Claude Code',
          };
        }
      } else if (judge === 'gemini') {
        allScores[tid].gemini = { score: data.score, date, model: data.model || undefined, harness: 'Gemini CLI' };
      } else if (judge === 'codex') {
        allScores[tid].codex = { score: data.score, date, model: data.model || undefined, harness: 'Codex CLI' };
      }
    }
  }

  return allScores;
}

// Main
const ticketMap = buildTicketMap();
const allScores = collectScores();

let written = 0;
let skipped = 0;

for (const [tid, scores] of Object.entries(allScores)) {
  const files = ticketMap[tid];
  if (!files || files.length === 0) {
    skipped++;
    continue;
  }

  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);

    // Write each judge's score
    for (const [judge, scoreData] of Object.entries(scores)) {
      // Map internal names to frontmatter-scores.mjs judge parameter
      let judgeParam;
      let scoreJson;

      if (judge === 'ralph') {
        judgeParam = 'opus';
        scoreJson = JSON.stringify({
          score: Math.min(scoreData.p, scoreData.c, scoreData.v),
          details: {
            persona: scoreData.p,
            clawdNote: scoreData.c,
            vibe: scoreData.v,
          },
          date: scoreData.date,
          model: scoreData.model,
          harness: scoreData.harness,
        });
      } else {
        judgeParam = judge;
        scoreJson = JSON.stringify({
          score: scoreData.score,
          date: scoreData.date,
          model: scoreData.model,
          harness: scoreData.harness,
        });
      }

      if (DRY_RUN) {
        console.log(`[DRY-RUN] ${file}: would write ${judgeParam} = ${scoreJson}`);
      } else {
        try {
          execSync(
            `node scripts/frontmatter-scores.mjs write "${filePath}" ${judgeParam} '${scoreJson}'`,
            { stdio: 'pipe' }
          );
        } catch (e) {
          console.error(`ERROR writing ${judgeParam} to ${file}: ${e.stderr?.toString() || e.message}`);
        }
      }
    }
  }
  written++;
}

console.log(`\nBackfill complete: ${written} ticketIds written, ${skipped} skipped (no matching file)`);
if (DRY_RUN) console.log('(dry-run mode — no files were modified)');
