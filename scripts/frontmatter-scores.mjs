#!/usr/bin/env node
/**
 * frontmatter-scores.mjs — Read/write/delete AI judge scores in MDX frontmatter
 *
 * Usage:
 *   node scripts/frontmatter-scores.mjs get    <file_path> <judge>
 *   node scripts/frontmatter-scores.mjs write  <file_path> <judge> <score_json>
 *   node scripts/frontmatter-scores.mjs delete <file_path> <judge>
 *
 * Judges: gemini | codex | opus
 *
 * Frontmatter storage format:
 *   gemini  → scores.gemini { score, date }
 *   codex   → scores.codex  { score, date }
 *   opus    → scores.ralph  { p, c, v, date }  (p=persona c=clawdNote v=vibe)
 *
 * get output (stdout JSON, empty = not found):
 *   gemini/codex → { score: N }
 *   opus         → { score: min(p,c,v), details: { persona: N, clawdNote: N, vibe: N } }
 *
 * write input (score_json from judge daemon):
 *   gemini/codex → { score: N, ... }
 *   opus         → { score: N, details: { persona: N, clawdNote: N, vibe: N }, ... }
 */

import fs from 'fs';

const [, , op, filePath, judge, scoreJsonStr] = process.argv;

if (!op || !filePath || !judge) {
  process.stderr.write(
    'Usage: frontmatter-scores.mjs <get|write|delete> <file> <judge> [score_json]\n',
  );
  process.exit(1);
}

if (!['gemini', 'codex', 'opus'].includes(judge)) {
  process.stderr.write(`Unknown judge: ${judge}. Expected gemini, codex, or opus.\n`);
  process.exit(1);
}

// Map judge name → frontmatter key
const FM_KEY = { gemini: 'gemini', codex: 'codex', opus: 'ralph' };
const fmKey = FM_KEY[judge];

// ─── Frontmatter parser ────────────────────────────────────────────────────

/**
 * Split MDX file into { fmText, body }.
 * fmText is the raw YAML between the --- delimiters (without the --- lines).
 */
function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { fmText: match[1], body: match[2] };
}

/**
 * Parse the scores: block from YAML frontmatter text.
 * Returns an object like { ralph: { p: 9, c: 9, v: 9, date: "..." }, gemini: { score: 8, date: "..." } }
 */
function parseScores(fmText) {
  const lines = fmText.split('\n');
  const scores = {};
  let inScores = false;
  let currentKey = null;

  for (const line of lines) {
    if (line === 'scores:') {
      inScores = true;
      currentKey = null;
      continue;
    }
    if (inScores) {
      // Non-indented non-empty line ends the scores block
      if (line !== '' && !/^\s/.test(line)) {
        break;
      }
      // 2-space indent: judge key (e.g. "  ralph:")
      const judgeMatch = line.match(/^  (\w+):\s*$/);
      if (judgeMatch) {
        currentKey = judgeMatch[1];
        scores[currentKey] = {};
        continue;
      }
      // 4-space indent: field value (e.g. "    p: 9" or "    date: \"2026-03-30\"")
      if (currentKey) {
        const numMatch = line.match(/^    (\w+):\s*(\d+(?:\.\d+)?)\s*$/);
        const strMatch = line.match(/^    (\w+):\s*"([^"]*)"\s*$/);
        if (numMatch) {
          scores[currentKey][numMatch[1]] = Number(numMatch[2]);
        } else if (strMatch) {
          scores[currentKey][strMatch[1]] = strMatch[2];
        }
      }
    }
  }
  return scores;
}

/**
 * Serialize scores object back to YAML lines (without trailing newline).
 * Returns empty string if scores is empty.
 */
function serializeScores(scores) {
  if (Object.keys(scores).length === 0) return '';
  let out = 'scores:';
  for (const [key, data] of Object.entries(scores)) {
    out += `\n  ${key}:`;
    for (const [field, val] of Object.entries(data)) {
      if (typeof val === 'string') {
        out += `\n    ${field}: "${val}"`;
      } else {
        out += `\n    ${field}: ${val}`;
      }
    }
  }
  return out;
}

/**
 * Remove the scores: block from YAML text (all lines from scores: to next top-level key).
 * Returns new fmText without the scores block.
 */
function removeScoresBlock(fmText) {
  const lines = fmText.split('\n');
  const result = [];
  let inScores = false;

  for (const line of lines) {
    if (line === 'scores:') {
      inScores = true;
      continue;
    }
    if (inScores) {
      if (line !== '' && !/^\s/.test(line)) {
        inScores = false;
        result.push(line);
      }
      continue;
    }
    result.push(line);
  }
  // Trim trailing blank lines that were between scores block and end
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result.join('\n');
}

/**
 * Write modified frontmatter back to file.
 */
function writeFrontmatter(filePath, fmText, body) {
  fs.writeFileSync(filePath, `---\n${fmText}\n---\n${body}`);
}

// ─── Operations ───────────────────────────────────────────────────────────

function opGet() {
  if (!fs.existsSync(filePath)) {
    process.exit(0); // empty = no score
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(content);
  if (!parts) process.exit(0);

  const scores = parseScores(parts.fmText);
  const entry = scores[fmKey];

  if (!entry || Object.keys(entry).length === 0) {
    process.exit(0); // empty = no score
  }

  let output;
  if (judge === 'opus') {
    // ralph: { p, c, v, date } → { score: min, details: { persona, clawdNote, vibe } }
    const { p, c, v } = entry;
    if (p == null || c == null || v == null) process.exit(0);
    const minScore = Math.min(p, c, v);
    output = { score: minScore, details: { persona: p, clawdNote: c, vibe: v } };
  } else {
    // gemini/codex: { score, date } → { score: N }
    if (entry.score == null) process.exit(0);
    output = { score: entry.score };
  }

  process.stdout.write(JSON.stringify(output));
}

function opWrite() {
  if (!scoreJsonStr) {
    process.stderr.write('score_json required for write operation\n');
    process.exit(1);
  }

  let scoreData;
  try {
    scoreData = JSON.parse(scoreJsonStr);
  } catch (e) {
    process.stderr.write(`Invalid score JSON: ${e.message}\n`);
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(content);
  if (!parts) {
    process.stderr.write(`No frontmatter found in: ${filePath}\n`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const scores = parseScores(parts.fmText);

  if (judge === 'opus') {
    const persona = scoreData.details?.persona ?? scoreData.score ?? 0;
    const clawdNote = scoreData.details?.clawdNote ?? scoreData.score ?? 0;
    const vibe = scoreData.details?.vibe ?? scoreData.score ?? 0;
    const entry = { p: persona, c: clawdNote, v: vibe, date: today };
    if (scoreData.model) entry.model = scoreData.model;
    if (scoreData.harness) entry.harness = scoreData.harness;
    scores['ralph'] = entry;
  } else {
    // gemini or codex
    const entry = { score: scoreData.score, date: today };
    if (scoreData.model) entry.model = scoreData.model;
    if (scoreData.harness) entry.harness = scoreData.harness;
    scores[fmKey] = entry;
  }

  let newFm = removeScoresBlock(parts.fmText);
  const scoresYaml = serializeScores(scores);
  if (scoresYaml) {
    newFm = newFm + '\n' + scoresYaml;
  }

  writeFrontmatter(filePath, newFm, parts.body);
}

function opDelete() {
  if (!fs.existsSync(filePath)) {
    process.exit(0); // nothing to do
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(content);
  if (!parts) process.exit(0);

  const scores = parseScores(parts.fmText);
  if (!scores[fmKey]) process.exit(0); // already absent

  delete scores[fmKey];

  let newFm = removeScoresBlock(parts.fmText);
  const scoresYaml = serializeScores(scores);
  if (scoresYaml) {
    newFm = newFm + '\n' + scoresYaml;
  }

  writeFrontmatter(filePath, newFm, parts.body);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

switch (op) {
  case 'get':
    opGet();
    break;
  case 'write':
    opWrite();
    break;
  case 'delete':
    opDelete();
    break;
  default:
    process.stderr.write(`Unknown op: ${op}. Expected get, write, or delete.\n`);
    process.exit(1);
}
