#!/usr/bin/env node
// WCAG AA contrast ratio checker for gu-log components.
//
// Scans .astro and .css files for foreground/background color pairs
// declared via inline comments like:
//   color: #116329; /* forest green — 6.66:1 on #f0f5e6 */
//
// The pattern "on #xxxxxx" tells the checker what background to test against.
//
// Exit 1 if any pair fails WCAG AA (4.5:1 for normal text).
//
// Usage:
//   node scripts/check-contrast.mjs              # scan all components
//   node scripts/check-contrast.mjs src/components/DiffBlock.astro

import { readFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';

// ── WCAG math ───────────────────────────────────────────────────────

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Hardcoded manifest for pairs that can't be auto-detected ────────
// Format: { fg, bg, context, file }
// Add entries here when CSS variables or complex selectors make
// auto-detection impractical.

const MANIFEST = [
  // AiJudgeScore light theme
  {
    fg: '#047857',
    bg: '#fdf6e3',
    context: 'light score-high',
    file: 'src/components/AiJudgeScore.astro',
  },
  {
    fg: '#586e75',
    bg: '#fdf6e3',
    context: 'light score-pass',
    file: 'src/components/AiJudgeScore.astro',
  },
  {
    fg: '#b71c1c',
    bg: '#fdf6e3',
    context: 'light score-fail',
    file: 'src/components/AiJudgeScore.astro',
  },
  // ClawdNote light theme (orange on surface)
  {
    fg: '#955330',
    bg: '#eee8d5',
    context: 'light clawd-orange on surface',
    file: 'src/components/ClawdNote.astro',
  },
];

// ── Auto-scan: extract "color: #xxx; /* ... on #yyy */" patterns ────

const COLOR_ON_BG_RE = /color:\s*(#[0-9a-fA-F]{3,8});\s*\/\*.*?on\s+(#[0-9a-fA-F]{3,8})/g;

function scanFile(filePath) {
  const pairs = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    COLOR_ON_BG_RE.lastIndex = 0;
    while ((match = COLOR_ON_BG_RE.exec(line)) !== null) {
      pairs.push({
        fg: match[1],
        bg: match[2],
        file: filePath,
        line: i + 1,
        context: line.trim(),
      });
    }
  }
  return pairs;
}

// ── Main ────────────────────────────────────────────────────────────

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
const THRESHOLD = AA_NORMAL; // we check normal text by default

const args = process.argv.slice(2);
const repoRoot = resolve(import.meta.dirname, '..');

let files;
if (args.length > 0) {
  files = args.map((f) => resolve(f));
} else {
  // Scan all component and style files
  const { execSync } = await import('node:child_process');
  const found = execSync(
    'find src/components src/styles -name "*.astro" -o -name "*.css" 2>/dev/null',
    { cwd: repoRoot, encoding: 'utf-8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  files = found.map((f) => resolve(repoRoot, f));
}

// Collect all pairs
const allPairs = [];

// Auto-scan files
for (const file of files) {
  if (!existsSync(file)) continue;
  allPairs.push(...scanFile(file));
}

// Add manifest pairs
for (const entry of MANIFEST) {
  allPairs.push({
    ...entry,
    file: resolve(repoRoot, entry.file),
    line: null,
  });
}

// Check all pairs
let failures = 0;
let checked = 0;

for (const pair of allPairs) {
  checked++;
  const ratio = contrastRatio(pair.fg, pair.bg);
  const pass = ratio >= THRESHOLD;
  const relFile = relative(repoRoot, pair.file);
  const loc = pair.line ? `${relFile}:${pair.line}` : relFile;

  if (!pass) {
    failures++;
    console.error(
      `❌ FAIL  ${pair.fg} on ${pair.bg} → ${ratio.toFixed(2)}:1 (need ≥${THRESHOLD}:1)  ${loc}`
    );
    if (pair.context) {
      console.error(`         ${pair.context}`);
    }
  }
}

if (checked === 0) {
  console.log('ℹ️  No contrast pairs found to check.');
  console.log('   Add "/* ... on #xxxxxx */" comments to color declarations to enable checking.');
} else if (failures === 0) {
  console.log(`✓ All ${checked} color contrast pairs pass WCAG AA (≥${THRESHOLD}:1)`);
} else {
  console.error(`\n${failures}/${checked} pairs FAILED WCAG AA contrast check.`);
  process.exit(1);
}
