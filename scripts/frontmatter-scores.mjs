#!/usr/bin/env node
/**
 * frontmatter-scores.mjs — Read/write/delete tribunal judge scores in MDX frontmatter
 *
 * Usage:
 *   node scripts/frontmatter-scores.mjs get    <file_path> <judge>
 *   node scripts/frontmatter-scores.mjs write  <file_path> <judge> <score_json>
 *   node scripts/frontmatter-scores.mjs delete <file_path> <judge>
 *
 * Judges: librarian | factCheck | freshEyes | vibe
 *
 * Frontmatter storage format (uniform — all judges):
 *   scores:
 *     librarian:
 *       glossary: 8
 *       crossRef: 9
 *       sourceAlign: 8
 *       attribution: 8
 *       score: 8
 *       date: "2026-04-07"
 *       model: "claude-sonnet-4-6"
 *
 * write input: uniform agent JSON { judge, dimensions, score, verdict, reasons, model? }
 * get output: { dimensions, score, date, model? }
 */

import fs from 'fs';
import process from 'node:process';

const VALID_JUDGES = ['librarian', 'factCheck', 'freshEyes', 'vibe'];

const [, , op, filePath, judge, scoreJsonStr] = process.argv;

if (!op || !filePath || !judge) {
  process.stderr.write(
    'Usage: frontmatter-scores.mjs <get|write|delete> <file> <judge> [score_json]\n'
  );
  process.exit(1);
}

if (!VALID_JUDGES.includes(judge)) {
  process.stderr.write(`Unknown judge: ${judge}. Expected: ${VALID_JUDGES.join(', ')}.\n`);
  process.exit(1);
}

// ─── Frontmatter parser ────────────────────────────────────────────────────

/**
 * Split MDX file into { fmText, body }.
 */
function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { fmText: match[1], body: match[2] };
}

/**
 * Parse the scores: block from YAML frontmatter text.
 * Returns an object like { librarian: { glossary: 8, crossRef: 9, ..., score: 8, date: "..." } }
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
      // 2-space indent: judge key (e.g. "  librarian:")
      const judgeMatch = line.match(/^\s{2}(\w+):\s*$/);
      if (judgeMatch) {
        currentKey = judgeMatch[1];
        scores[currentKey] = {};
        continue;
      }
      // 2-space indent: scalar value (e.g. "  tribunalVersion: 1")
      const scalarNumMatch = line.match(/^\s{2}(\w+):\s*(\d+(?:\.\d+)?)\s*$/);
      const scalarStrMatch = line.match(/^\s{2}(\w+):\s*"([^"]*)"\s*$/);
      if (scalarNumMatch) {
        scores[scalarNumMatch[1]] = Number(scalarNumMatch[2]);
        currentKey = null;
        continue;
      }
      if (scalarStrMatch) {
        scores[scalarStrMatch[1]] = scalarStrMatch[2];
        currentKey = null;
        continue;
      }
      // 4-space indent: field value (e.g. "    glossary: 8" or "    date: \"2026-04-07\"")
      if (currentKey) {
        const numMatch = line.match(/^\s{4}(\w+):\s*(\d+(?:\.\d+)?)\s*$/);
        const strMatch = line.match(/^\s{4}(\w+):\s*"([^"]*)"\s*$/);
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
 * Serialize scores object back to YAML lines.
 */
function serializeScores(scores) {
  if (Object.keys(scores).length === 0) return '';
  let out = 'scores:';
  // Scalar fields first (e.g. tribunalVersion: 1)
  for (const [key, data] of Object.entries(scores)) {
    if (typeof data !== 'object' || data === null) {
      if (typeof data === 'string') {
        out += `\n  ${key}: "${data}"`;
      } else {
        out += `\n  ${key}: ${data}`;
      }
    }
  }
  // Judge objects
  for (const [key, data] of Object.entries(scores)) {
    if (typeof data === 'object' && data !== null) {
      out += `\n  ${key}:`;
      for (const [field, val] of Object.entries(data)) {
        if (typeof val === 'string') {
          out += `\n    ${field}: "${val}"`;
        } else {
          out += `\n    ${field}: ${val}`;
        }
      }
    }
  }
  return out;
}

/**
 * Remove the entire scores: block from YAML text.
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
  // Trim trailing blank lines
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

// ─── Dimension definitions per judge ──────────────────────────────────────

const JUDGE_DIMS = {
  librarian: ['glossary', 'crossRef', 'sourceAlign', 'attribution'],
  factCheck: ['accuracy', 'fidelity', 'consistency'],
  freshEyes: ['readability', 'firstImpression'],
  vibe: ['persona', 'clawdNote', 'vibe', 'clarity', 'narrative'],
};

// ─── Operations ───────────────────────────────────────────────────────────

function opGet() {
  if (!fs.existsSync(filePath)) {
    process.exit(0); // empty = no score
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(content);
  if (!parts) process.exit(0);

  const scores = parseScores(parts.fmText);
  const entry = scores[judge];

  if (!entry || Object.keys(entry).length === 0) {
    process.exit(0);
  }

  if (entry.score == null) process.exit(0);

  const dims = JUDGE_DIMS[judge];
  const dimensions = {};
  for (const dim of dims) {
    if (entry[dim] != null) dimensions[dim] = entry[dim];
  }

  const output = {
    dimensions,
    score: entry.score,
    date: entry.date,
    ...(entry.model ? { model: entry.model } : {}),
  };

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

  // Build the new entry from uniform agent JSON
  const dims = JUDGE_DIMS[judge];
  const entry = {};

  // Extract dimensions from agent JSON (supports both { dimensions: {...} } and flat { dim: score } formats)
  const dimSource = scoreData.dimensions || scoreData.details || scoreData;
  for (const dim of dims) {
    const val = dimSource[dim] ?? scoreData[dim];
    if (val != null) entry[dim] = Number(val);
  }

  // Calculate composite score: floor(avg of dims)
  const dimValues = dims.map((d) => entry[d]).filter((v) => v != null);
  entry.score =
    dimValues.length > 0
      ? Math.floor(dimValues.reduce((a, b) => a + b, 0) / dimValues.length)
      : Number(scoreData.score) || 0;

  entry.date = today;
  if (scoreData.model) entry.model = scoreData.model;

  scores[judge] = entry;

  // Ensure tribunalVersion is set (default to 1 for current rubric)
  if (scores.tribunalVersion == null) {
    scores.tribunalVersion = 1;
  }

  let newFm = removeScoresBlock(parts.fmText);
  const scoresYaml = serializeScores(scores);
  if (scoresYaml) {
    newFm = newFm ? `${newFm}\n${scoresYaml}` : scoresYaml;
  }

  writeFrontmatter(filePath, newFm, parts.body);
}

function opDelete() {
  if (!fs.existsSync(filePath)) {
    process.exit(0);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(content);
  if (!parts) process.exit(0);

  const scores = parseScores(parts.fmText);
  if (!scores[judge]) process.exit(0);

  delete scores[judge];

  let newFm = removeScoresBlock(parts.fmText);
  const scoresYaml = serializeScores(scores);
  if (scoresYaml) {
    newFm = newFm ? `${newFm}\n${scoresYaml}` : scoresYaml;
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
