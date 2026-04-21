#!/usr/bin/env node
// Level D loader + Level E evaluator — dedup fixture harness.
//
// Modes:
// - 預設模式（無 flag）：只做 schema validation + coverage warning，不呼叫 judge。
//   退出碼：schema 違規 = 1，其他 = 0。
//   行為與 Level D 一致，維持 pre-commit / CI gate。
//
// - `--run` 模式：對每筆 fixture 呼叫 `claude -p --agent v2-factlib-judge`，
//   比對 expectedAction，算 per-category precision + recall，輸出 markdown report。
//   退出碼：schema 違規 = 1，judge 呼叫失敗 = 2，其他 = 0（包含 fixture 判錯）。
//
// Usage:
//   node scripts/eval-dedup-harness.mjs                  # schema only
//   node scripts/eval-dedup-harness.mjs --run            # evaluator mode
//   node scripts/eval-dedup-harness.mjs --run --timeout=120  # 自訂 judge timeout（秒）
//   node scripts/eval-dedup-harness.mjs --run --dry-run  # stub judge for local testing

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYAML } from 'yaml';

const FIXTURES_DIR = 'tribunal/fixtures';
const SCORES_DIR = 'scores';
const VALID_CLASSES = ['hard-dup', 'soft-dup', 'intentional-series', 'clean-diff'];
const VALID_ACTIONS = ['BLOCK', 'WARN', 'allow'];
const DEFAULT_JUDGE_TIMEOUT_SEC = 180;

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    run: false,
    dryRun: false,
    timeoutSec: DEFAULT_JUDGE_TIMEOUT_SEC,
  };
  for (const a of argv.slice(2)) {
    if (a === '--run') args.run = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--timeout=')) args.timeoutSec = Number(a.slice('--timeout='.length));
    else if (a === '-h' || a === '--help') {
      console.log(
        `Usage: node scripts/eval-dedup-harness.mjs [--run] [--dry-run] [--timeout=SECONDS]`,
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Fixture loader + schema validator (Level D parity)
// ---------------------------------------------------------------------------

function listYamlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...listYamlFiles(p));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      out.push(p);
    }
  }
  return out;
}

function validateFixture(path, data) {
  const errors = [];
  const required = [
    'inputPost',
    'corpusSnapshot',
    'expectedClass',
    'expectedAction',
    'humanReasoning',
    'sourceRef',
  ];
  for (const key of required) {
    if (!(key in data)) errors.push(`missing required field: ${key}`);
  }
  if (data.expectedClass && !VALID_CLASSES.includes(data.expectedClass)) {
    errors.push(
      `expectedClass "${data.expectedClass}" not in ${JSON.stringify(VALID_CLASSES)}`,
    );
  }
  if (data.expectedAction && !VALID_ACTIONS.includes(data.expectedAction)) {
    errors.push(
      `expectedAction "${data.expectedAction}" not in ${JSON.stringify(VALID_ACTIONS)}`,
    );
  }
  if (data.inputPost) {
    if (typeof data.inputPost.slug !== 'string') errors.push('inputPost.slug must be string');
    if (typeof data.inputPost.contentSnapshot !== 'string')
      errors.push('inputPost.contentSnapshot must be string');
    if (!data.inputPost.frontmatter || typeof data.inputPost.frontmatter !== 'object')
      errors.push('inputPost.frontmatter must be object');
  }
  if (data.corpusSnapshot) {
    if (!Array.isArray(data.corpusSnapshot)) {
      errors.push('corpusSnapshot must be array');
    } else {
      data.corpusSnapshot.forEach((item, i) => {
        if (typeof item.slug !== 'string')
          errors.push(`corpusSnapshot[${i}].slug must be string`);
        if (typeof item.contentSnapshot !== 'string')
          errors.push(`corpusSnapshot[${i}].contentSnapshot must be string`);
        if (!item.frontmatter || typeof item.frontmatter !== 'object')
          errors.push(`corpusSnapshot[${i}].frontmatter must be object`);
      });
    }
  }
  // expectedClass 與路徑子目錄一致（tribunal/fixtures/{class}/*.yaml）
  const rel = relative(FIXTURES_DIR, path);
  const dirClass = rel.split('/')[0];
  if (VALID_CLASSES.includes(dirClass) && data.expectedClass && dirClass !== data.expectedClass) {
    errors.push(
      `directory mismatch: placed in ${dirClass}/ but expectedClass is ${data.expectedClass}`,
    );
  }
  return errors;
}

function loadAllFixtures() {
  const files = listYamlFiles(FIXTURES_DIR);
  const fixtures = [];
  const errors = [];
  for (const file of files) {
    let data;
    try {
      data = parseYAML(readFileSync(file, 'utf8'));
    } catch (err) {
      errors.push({ file, error: `YAML parse error — ${err.message}` });
      continue;
    }
    const validationErrors = validateFixture(file, data);
    if (validationErrors.length > 0) {
      for (const e of validationErrors) errors.push({ file, error: e });
      continue;
    }
    fixtures.push({ file, data });
  }
  return { fixtures, errors };
}

function printSchemaSummary(fixtures, errors) {
  const counts = Object.fromEntries(VALID_CLASSES.map((c) => [c, 0]));

  for (const f of fixtures) {
    counts[f.data.expectedClass] += 1;
    console.log(`  ✓ ${f.file}  (${f.data.expectedClass} → ${f.data.expectedAction})`);
  }
  for (const e of errors) {
    console.error(`  ✗ ${e.file}: ${e.error}`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total fixtures: ${fixtures.length + errors.length}`);
  for (const c of VALID_CLASSES) {
    const n = counts[c];
    const marker = n === 0 ? '⚠️ ' : '   ';
    console.log(`${marker}${c.padEnd(22)} ${n}`);
  }

  const missing = VALID_CLASSES.filter((c) => counts[c] === 0);
  if (missing.length > 0) {
    console.log(`\n⚠️  Coverage gap — 無 fixture 的分類：${missing.join(', ')}`);
  }
  return { counts, missing };
}

// ---------------------------------------------------------------------------
// Judge invocation (Level E evaluator)
// ---------------------------------------------------------------------------

/**
 * Build prompt for v2-factlib-judge given a fixture.
 * Judge reads article snapshot + corpus snapshot from prompt context, not from
 * filesystem. This mirrors how the pipeline injects content.
 */
function buildJudgePrompt(fixture, outputPath) {
  const { inputPost, corpusSnapshot } = fixture.data;

  const inputYaml = `slug: ${inputPost.slug}\nfrontmatter:\n${indentYaml(inputPost.frontmatter, 2)}\ncontentSnapshot: |\n${indentBlock(inputPost.contentSnapshot, 2)}`;

  const corpusYaml = corpusSnapshot
    .map(
      (c) =>
        `- slug: ${c.slug}\n  frontmatter:\n${indentYaml(c.frontmatter, 4)}\n  contentSnapshot: |\n${indentBlock(c.contentSnapshot, 4)}`,
    )
    .join('\n');

  // IMPORTANT: The CORPUS SNAPSHOT below is the authoritative corpus for this
  // evaluation. DO NOT glob src/content/posts/ — use ONLY the corpusSnapshot
  // provided below. Globbing the live corpus would: (a) break reproducibility
  // because the corpus changes over time, and (b) cause self-matching when the
  // fixture inputPost slug already exists in the real corpus.
  return `You are evaluating a dedup fixture. Score ONLY the dupCheck dimension for this exercise.
The fact / library dimensions may be stubbed (e.g. 8, 8, 8, 8) — focus on judging whether
this inputPost is hard-dup / soft-dup / intentional-series / clean-diff relative to the
provided corpusSnapshot.

EVALUATOR MODE — CORPUS SOURCE OVERRIDE:
  DO NOT glob src/content/posts/ or read any real corpus files.
  Use ONLY the CORPUS SNAPSHOT below as the authoritative corpus for this evaluation.
  Reason: this is a frozen reproducibility test; live corpus may differ.

INPUT POST (被審稿件):
---
${inputYaml}
---

CORPUS SNAPSHOT (凍結的既有 corpus — 你要跟這些比對):
---
${corpusYaml}
---

Read tribunal/fixtures/{hard-dup,soft-dup,intentional-series,clean-diff}/*.yaml as few-shot
reference for the four categories.

Output a FactLibJudgeOutput JSON to: ${outputPath}
The dupCheck score + improvements.dupCheck verdict must reflect your judgement.
Format improvements.dupCheck as:
  "class=<hard-dup|soft-dup|intentional-series|clean-diff> action=<BLOCK|WARN|allow> matchedSlugs=[...] reason=<中文一句>"

Confirm with a one-line status on stdout.
`;
}

function indentYaml(obj, spaces) {
  // Minimal YAML emitter for frontmatter (strings + objects). Good enough for
  // fixture snapshots — we don't need full YAML spec coverage here.
  const pad = ' '.repeat(spaces);
  return Object.entries(obj)
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return `${pad}${k}:\n${indentYaml(v, spaces + 2)}`;
      }
      if (Array.isArray(v)) {
        return `${pad}${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`;
      }
      // Quote strings that contain special chars; otherwise bare value.
      const s = typeof v === 'string' ? JSON.stringify(v) : String(v);
      return `${pad}${k}: ${s}`;
    })
    .join('\n');
}

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/**
 * Spawn `claude -p --agent v2-factlib-judge --dangerously-skip-permissions <prompt>`
 * and return the parsed JSON.
 *
 * Dry-run mode (for local testing): returns a stub verdict derived from the
 * fixture's expectedClass — useful when you want to exercise the report
 * pipeline without burning LLM tokens.
 */
async function invokeJudge(fixture, { timeoutSec, dryRun }) {
  if (dryRun) {
    // Stub judge: pretend it answered correctly half the time, flip on
    // soft-dup so the report exercises "misclassified" rendering.
    const expected = fixture.data.expectedClass;
    const mockClass = expected === 'soft-dup' ? 'clean-diff' : expected;
    const mockAction = mockClass === 'clean-diff' ? 'allow' : fixture.data.expectedAction;
    return {
      dupCheckScore: mockClass === expected ? 8 : 4,
      actualClass: mockClass,
      actualAction: mockAction,
      matchedSlugs: fixture.data.corpusSnapshot.map((c) => c.slug),
      reason: `[dry-run stub] expected=${expected} predicted=${mockClass}`,
      rawImprovement: `class=${mockClass} action=${mockAction} matchedSlugs=[] reason=dry-run`,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'dedup-eval-'));
  const outputPath = join(dir, 'output.json');
  const prompt = buildJudgePrompt(fixture, outputPath);

  try {
    await spawnClaudeJudge(prompt, timeoutSec);

    let raw;
    try {
      raw = await readFile(outputPath, 'utf-8');
    } catch {
      throw new Error(`judge did not write output file for ${fixture.file}`);
    }

    const parsed = extractJson(raw);
    return parseDupCheckVerdict(parsed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function spawnClaudeJudge(prompt, timeoutSec) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--agent',
      'v2-factlib-judge',
      '--dangerously-skip-permissions',
      prompt,
    ];
    const child = spawn('claude', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stderr = '';
    let timedOut = false;
    let sigkillTimer = null;
    const killGroup = (signal) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* group already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      sigkillTimer = setTimeout(() => killGroup('SIGKILL'), 5000);
    }, timeoutSec * 1000);

    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
    });
    child.stdout.on('data', () => {
      /* agent writes JSON to output file; discard stdout */
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      reject(new Error(`claude --agent v2-factlib-judge spawn failed: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (timedOut) {
        reject(new Error(`claude --agent v2-factlib-judge timed out after ${timeoutSec}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`claude --agent v2-factlib-judge exit ${code}: ${stderr.slice(-400)}`));
        return;
      }
      resolve();
    });
  });
}

function extractJson(raw) {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    try {
      return JSON.parse(text.slice(i));
    } catch {
      /* keep scanning */
    }
  }
  throw new Error(`No valid JSON in judge output: ${raw.slice(0, 300)}`);
}

function parseDupCheckVerdict(judgeOutput) {
  const dupCheckScore = Number(judgeOutput?.scores?.dupCheck ?? 0);
  const improvementStr =
    judgeOutput?.improvements?.dupCheck ??
    judgeOutput?.improvements?.dedup ??
    '';

  // Parse "class=X action=Y matchedSlugs=[...] reason=..."
  const classMatch = /class=([a-z-]+)/i.exec(improvementStr);
  const actionMatch = /action=(BLOCK|WARN|allow)/i.exec(improvementStr);
  const slugsMatch = /matchedSlugs=\[([^\]]*)\]/i.exec(improvementStr);
  const reasonMatch = /reason=(.+?)(?:\s*$|\s+class=)/is.exec(improvementStr);

  return {
    dupCheckScore,
    actualClass: classMatch ? classMatch[1].toLowerCase() : 'unknown',
    actualAction: actionMatch ? actionMatch[1] : 'unknown',
    matchedSlugs: slugsMatch
      ? slugsMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : [],
    reason: reasonMatch ? reasonMatch[1].trim() : improvementStr,
    rawImprovement: improvementStr,
  };
}

// ---------------------------------------------------------------------------
// Metrics: per-category precision + recall
// ---------------------------------------------------------------------------

/**
 * Confusion matrix rows = expected class, cols = predicted class.
 * 'unknown' bucket captures judge outputs that couldn't be parsed.
 */
function buildConfusionMatrix(results) {
  const allClasses = [...VALID_CLASSES, 'unknown'];
  const matrix = Object.fromEntries(
    VALID_CLASSES.map((e) => [e, Object.fromEntries(allClasses.map((p) => [p, 0]))]),
  );
  for (const r of results) {
    const expected = r.expectedClass;
    const predicted = VALID_CLASSES.includes(r.actualClass) ? r.actualClass : 'unknown';
    if (matrix[expected]) matrix[expected][predicted] += 1;
  }
  return matrix;
}

function computePerCategoryMetrics(results) {
  const metrics = {};
  for (const c of VALID_CLASSES) {
    const expectedC = results.filter((r) => r.expectedClass === c);
    const predictedC = results.filter((r) => r.actualClass === c);
    const truePositive = results.filter((r) => r.expectedClass === c && r.actualClass === c);

    metrics[c] = {
      expectedCount: expectedC.length,
      predictedCount: predictedC.length,
      truePositive: truePositive.length,
      precision: predictedC.length === 0 ? null : truePositive.length / predictedC.length,
      recall: expectedC.length === 0 ? null : truePositive.length / expectedC.length,
    };
  }
  return metrics;
}

function computeOverallAccuracy(results) {
  if (results.length === 0) return 0;
  const correct = results.filter((r) => r.expectedClass === r.actualClass).length;
  return correct / results.length;
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function formatMetric(value) {
  if (value === null || value === undefined) return 'n/a';
  return value.toFixed(2);
}

function buildMarkdownReport({ results, metrics, accuracy, matrix, timestamp, counts }) {
  const lines = [];
  lines.push(`# Dedup Eval Harness Report`);
  lines.push('');
  lines.push(`Generated: ${timestamp}`);
  lines.push(`Judge: \`v2-factlib-judge\` (dupCheck dimension, Level E)`);
  lines.push('');
  lines.push('## Fixture Distribution');
  lines.push('');
  lines.push('| Class | Count |');
  lines.push('|---|---|');
  for (const c of VALID_CLASSES) {
    lines.push(`| \`${c}\` | ${counts[c]} |`);
  }
  lines.push(`| **Total** | **${results.length}** |`);
  lines.push('');
  lines.push('## Per-Category Precision / Recall');
  lines.push('');
  lines.push('| Class | Expected N | Predicted N | TP | Precision | Recall |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of VALID_CLASSES) {
    const m = metrics[c];
    lines.push(
      `| \`${c}\` | ${m.expectedCount} | ${m.predictedCount} | ${m.truePositive} | ${formatMetric(m.precision)} | ${formatMetric(m.recall)} |`,
    );
  }
  lines.push('');
  lines.push(`**Overall accuracy**: ${formatMetric(accuracy)} (${results.filter((r) => r.expectedClass === r.actualClass).length}/${results.length})`);
  lines.push('');
  lines.push('## Confusion Matrix');
  lines.push('');
  const header = ['expected \\ predicted', ...VALID_CLASSES, 'unknown'];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const e of VALID_CLASSES) {
    const row = [`\`${e}\``, ...VALID_CLASSES.map((p) => String(matrix[e][p] ?? 0)), String(matrix[e].unknown ?? 0)];
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');

  // Misclassified list
  const misclassified = results.filter((r) => r.expectedClass !== r.actualClass);
  lines.push('## Misclassified Fixtures');
  lines.push('');
  if (misclassified.length === 0) {
    lines.push('無 — 所有 fixture 判對。');
  } else {
    lines.push(
      '| slug | expectedClass | actualClass | expectedAction | actualAction | dupCheck | fixture |',
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const m of misclassified) {
      lines.push(
        `| \`${m.slug}\` | ${m.expectedClass} | ${m.actualClass} | ${m.expectedAction} | ${m.actualAction} | ${m.dupCheckScore} | \`${m.fixturePath}\` |`,
      );
    }
  }
  lines.push('');

  // Detailed per-fixture results
  lines.push('## Per-Fixture Detail');
  lines.push('');
  for (const r of results) {
    const verdict = r.expectedClass === r.actualClass ? '✓' : '✗';
    lines.push(`### ${verdict} \`${r.slug}\``);
    lines.push('');
    lines.push(`- **Fixture**: \`${r.fixturePath}\``);
    lines.push(`- **Expected**: class=\`${r.expectedClass}\` action=\`${r.expectedAction}\``);
    lines.push(`- **Judge**: class=\`${r.actualClass}\` action=\`${r.actualAction}\` dupCheck=\`${r.dupCheckScore}\``);
    if (r.matchedSlugs && r.matchedSlugs.length > 0) {
      lines.push(`- **Matched**: ${r.matchedSlugs.map((s) => `\`${s}\``).join(', ')}`);
    }
    if (r.reason) {
      lines.push(`- **Reason**: ${r.reason}`);
    }
    if (r.error) {
      lines.push(`- **Error**: ${r.error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runEvaluator(fixtures, opts) {
  const results = [];
  let judgeFailures = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const fixturePath = f.file;
    const slug = f.data.inputPost.slug;
    const expectedClass = f.data.expectedClass;
    const expectedAction = f.data.expectedAction;

    console.log(`[${i + 1}/${fixtures.length}] Judging ${slug} (expected ${expectedClass})…`);
    try {
      const verdict = await invokeJudge(f, opts);
      results.push({
        slug,
        fixturePath,
        expectedClass,
        expectedAction,
        actualClass: verdict.actualClass,
        actualAction: verdict.actualAction,
        dupCheckScore: verdict.dupCheckScore,
        matchedSlugs: verdict.matchedSlugs,
        reason: verdict.reason,
      });
    } catch (err) {
      judgeFailures += 1;
      console.error(`  ! judge failed for ${slug}: ${err.message}`);
      results.push({
        slug,
        fixturePath,
        expectedClass,
        expectedAction,
        actualClass: 'unknown',
        actualAction: 'unknown',
        dupCheckScore: 0,
        matchedSlugs: [],
        reason: '',
        error: err.message,
      });
    }
  }

  return { results, judgeFailures };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`\n=== Dedup Eval Harness ===\n`);
  console.log(`Scanning ${FIXTURES_DIR}/ …`);

  const { fixtures, errors } = loadAllFixtures();
  const { counts, missing } = printSchemaSummary(fixtures, errors);

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} schema error(s) — 修好再跑`);
    process.exit(1);
  }
  console.log(`\n✓ 全部 fixture schema 通過`);

  if (!args.run) {
    if (missing.length > 0) {
      console.log(`   Level E 之前必補齊（見 spec R3 / R6）。`);
    }
    process.exit(0);
  }

  // ---- Level E evaluator mode ----
  console.log(`\n--- Level E evaluator ---`);
  console.log(`Mode: ${args.dryRun ? 'dry-run (stub judge)' : 'live judge'}`);
  console.log(`Judge timeout: ${args.timeoutSec}s per fixture`);
  console.log('');

  const { results, judgeFailures } = await runEvaluator(fixtures, args);

  const matrix = buildConfusionMatrix(results);
  const metrics = computePerCategoryMetrics(results);
  const accuracy = computeOverallAccuracy(results);
  const timestamp = new Date().toISOString();

  // Console summary
  console.log(`\n--- Metrics ---`);
  for (const c of VALID_CLASSES) {
    const m = metrics[c];
    console.log(
      `  ${c.padEnd(22)} P=${formatMetric(m.precision)} R=${formatMetric(m.recall)} (expected=${m.expectedCount}, predicted=${m.predictedCount}, TP=${m.truePositive})`,
    );
  }
  console.log(`  ${'overall accuracy'.padEnd(22)} ${formatMetric(accuracy)}`);

  // Markdown report
  const report = buildMarkdownReport({ results, metrics, accuracy, matrix, timestamp, counts });

  if (!existsSync(SCORES_DIR)) {
    await mkdir(SCORES_DIR, { recursive: true });
  }
  const stamp = timestamp.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const reportPath = join(SCORES_DIR, `dedup-eval-${stamp}.md`);
  await writeFile(reportPath, report, 'utf8');
  console.log(`\n✓ Report written to ${reportPath}`);

  if (judgeFailures > 0) {
    console.error(`\n✗ ${judgeFailures} fixture judge call(s) failed — exit code 2`);
    process.exit(2);
  }
  // Fixtures misjudged are evaluation data, not script error → exit 0.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
