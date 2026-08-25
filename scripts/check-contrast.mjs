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

function hexToRgba(hex) {
  const decodedHex = `#${hex
    .slice(1)
    .replace(
      /\\([0-9a-fA-F]{1,6})(?:[ \t])?|\\([^\r\n\f0-9a-fA-F])/g,
      (_match, codePoint, escapedCharacter) =>
        codePoint ? String.fromCodePoint(parseInt(codePoint, 16)) : escapedCharacter
    )}`;
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(decodedHex)) {
    throw new Error(`unsupported hex color ${hex}`);
  }

  let value = decodedHex.slice(1);
  if (value.length === 3 || value.length === 4) {
    value = [...value].map((digit) => digit + digit).join('');
  }

  return {
    rgb: [
      parseInt(value.slice(0, 2), 16) / 255,
      parseInt(value.slice(2, 4), 16) / 255,
      parseInt(value.slice(4, 6), 16) / 255,
    ],
    alpha: value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1,
  };
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const foreground = hexToRgba(fg);
  const background = hexToRgba(bg);
  if (background.alpha !== 1) {
    throw new Error(`background ${bg} must be opaque because its underlay is unknown`);
  }

  const compositedForeground = foreground.rgb.map(
    (channel, index) => channel * foreground.alpha + background.rgb[index] * (1 - foreground.alpha)
  );
  const l1 = relativeLuminance(compositedForeground);
  const l2 = relativeLuminance(background.rgb);
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
  // MoguNote light theme (orange on surface)
  {
    fgVar: '--color-mogu-orange',
    bgVar: '--color-surface',
    theme: 'light',
    context: 'light --color-mogu-orange on --color-surface',
    file: 'src/components/MoguNote.astro',
    name: 'light-mogu-prefix-on-surface',
  },
  {
    fgVar: '--color-on-accent',
    bgVar: '--color-accent',
    theme: 'dark',
    context: 'dark share label on --color-accent',
    file: 'src/components/ShareButton.astro',
    name: 'dark-on-accent',
  },
  {
    fgVar: '--color-on-accent',
    bgVar: '--color-accent',
    theme: 'light',
    context: 'light share label on --color-accent',
    file: 'src/components/ShareButton.astro',
    name: 'light-on-accent',
  },
  // Named pairs need a deliberate margin above the default WCAG AA floor.
  // Resolve the actual theme tokens from global.css so this gate cannot pass
  // against a stale copy of the production colors.
  {
    fgVar: '--color-text-muted',
    bgVar: '--color-bg',
    theme: 'dark',
    context: 'dark --color-text-muted on --color-bg',
    file: 'src/styles/global.css',
    name: 'dark-text-muted-on-bg',
  },
  {
    fgVar: '--color-mogu-note-text',
    bgVar: '--color-surface',
    theme: 'light',
    context: 'light MoguNote body text on --color-surface',
    file: 'src/styles/global.css',
    name: 'light-mogu-note-on-surface',
  },
  {
    fgVar: '--color-source-link',
    bgVar: '--color-surface',
    theme: 'dark',
    context: 'dark active TOC link on --color-surface',
    file: 'src/components/TableOfContents.astro',
    name: 'dark-active-toc-on-surface',
  },
  {
    fgVar: '--color-source-link',
    bgVar: '--color-surface',
    theme: 'light',
    context: 'light active TOC link on --color-surface',
    file: 'src/components/TableOfContents.astro',
    name: 'light-active-toc-on-surface',
  },
  ...['dark', 'light'].flatMap((theme) => [
    {
      fgVar: '--color-post-link-internal',
      bgVar: '--color-bg',
      theme,
      context: `${theme} internal post link on --color-bg`,
      file: 'src/styles/global.css',
      name: `${theme}-post-link-internal-on-bg`,
    },
    {
      fgVar: '--color-post-link-external',
      bgVar: '--color-bg',
      theme,
      context: `${theme} external post link on --color-bg`,
      file: 'src/styles/global.css',
      name: `${theme}-post-link-external-on-bg`,
    },
    {
      fgVar: '--color-post-link-internal-surface',
      bgVar: '--color-surface',
      theme,
      context: `${theme} internal post link on --color-surface`,
      file: 'src/styles/global.css',
      name: `${theme}-post-link-internal-on-surface`,
    },
    {
      fgVar: '--color-post-link-external-surface',
      bgVar: '--color-surface',
      theme,
      context: `${theme} external post link on --color-surface`,
      file: 'src/styles/global.css',
      name: `${theme}-post-link-external-on-surface`,
    },
  ]),
  {
    fgVar: '--color-accent',
    bgVar: '--color-surface',
    theme: 'dark',
    context: 'dark TOC focus ring on --color-surface',
    file: 'src/components/TableOfContents.astro',
    name: 'dark-toc-focus-on-surface',
  },
  {
    fgVar: '--color-accent',
    bgVar: '--color-surface',
    theme: 'light',
    context: 'light TOC focus ring on --color-surface',
    file: 'src/components/TableOfContents.astro',
    name: 'light-toc-focus-on-surface',
  },
];

// ── Named pairs get a stricter per-pair minimum than the default AA floor ──
// (#616): both of these are deliberate margins, not bare passes.
const NAMED_PAIR_MINIMUMS = {
  'dark-text-muted-on-bg': 5.5,
  'light-mogu-note-on-surface': 5.5,
  'dark-active-toc-on-surface': 5.5,
  'light-active-toc-on-surface': 5.5,
  'light-mogu-prefix-on-surface': 5.5,
  'dark-post-link-internal-on-bg': 5,
  'dark-post-link-external-on-bg': 5,
  'dark-post-link-internal-on-surface': 5,
  'dark-post-link-external-on-surface': 5,
  'light-post-link-internal-on-bg': 5,
  'light-post-link-external-on-bg': 5,
  'light-post-link-internal-on-surface': 5,
  'light-post-link-external-on-surface': 5,
  'dark-toc-focus-on-surface': 3,
  'light-toc-focus-on-surface': 3,
};

// ── Auto-scan: extract "color: #xxx; /* ... on #yyy */" patterns ────

const HEX_COLOR_PATTERN = String.raw`#(?:[A-Za-z0-9_-]|\\(?:[0-9a-fA-F]{1,6}[ \t]?|[^\r\n\f0-9a-fA-F]))+`;
const COLOR_ON_BG_RE = new RegExp(
  `color:\\s*(${HEX_COLOR_PATTERN});\\s*\\/\\*.*?on\\s+(${HEX_COLOR_PATTERN})`,
  'g'
);

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
const THRESHOLD = AA_NORMAL; // we check normal text by default

const args = process.argv.slice(2);
const repoRoot = resolve(import.meta.dirname, '..');
const globalCssPath = resolve(repoRoot, 'src/styles/global.css');

function themeVariables(theme) {
  const css = readFileSync(globalCssPath, 'utf-8');
  const readBlock = (selector) => {
    const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!match) throw new Error(`missing CSS variable block: ${selector}`);
    return Object.fromEntries(
      [...match[1].matchAll(/(--[A-Za-z0-9-]+):\s*([^;]+);/g)].map((entry) => [
        entry[1],
        entry[2].trim(),
      ])
    );
  };
  const variables = readBlock(':root');
  if (theme === 'light') Object.assign(variables, readBlock("\\[data-theme='light'\\]"));
  return variables;
}

function resolveThemeColor(variable, theme, seen = new Set()) {
  if (seen.has(variable)) throw new Error(`circular CSS variable reference: ${variable}`);
  seen.add(variable);
  const value = themeVariables(theme)[variable];
  if (!value) throw new Error(`missing ${theme} CSS variable: ${variable}`);
  const reference = value.match(/^var\((--[A-Za-z0-9-]+)\)$/)?.[1];
  return reference ? resolveThemeColor(reference, theme, seen) : value;
}

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
  const resolved = entry.fgVar
    ? {
        ...entry,
        fg: resolveThemeColor(entry.fgVar, entry.theme),
        bg: resolveThemeColor(entry.bgVar, entry.theme),
      }
    : entry;
  allPairs.push({
    ...resolved,
    file: resolve(repoRoot, entry.file),
    line: null,
  });
}

// Check all pairs
let failures = 0;
let checked = 0;

for (const pair of allPairs) {
  checked++;
  const minimum = (pair.name && NAMED_PAIR_MINIMUMS[pair.name]) || THRESHOLD;
  const relFile = relative(repoRoot, pair.file);
  const loc = pair.line ? `${relFile}:${pair.line}` : relFile;
  let ratio;

  try {
    ratio = contrastRatio(pair.fg, pair.bg);
  } catch (error) {
    failures++;
    console.error(`❌ FAIL  ${pair.fg} on ${pair.bg} → ${error.message}  ${loc}`);
    if (pair.context) {
      console.error(`         ${pair.context}`);
    }
    continue;
  }

  if (ratio < minimum) {
    failures++;
    console.error(
      `❌ FAIL  ${pair.fg} on ${pair.bg} → ${ratio.toFixed(2)}:1 (need ≥${minimum}:1)  ${loc}`
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
