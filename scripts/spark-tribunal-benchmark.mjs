#!/usr/bin/env node
/**
 * spark-tribunal-benchmark.mjs
 *
 * Build and optionally run harmless, blind A/B benchmark packs for Codex Spark
 * tribunal experiments. The harness exports before/after post revisions from git,
 * strips score/identity metadata, randomizes A/B order, and keeps ground truth in a
 * private directory that the judge prompt must not read.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
// Codex CLI expects the raw OpenAI model id. OpenClaw sessions use
// openai-codex/gpt-5.3-codex, but `codex exec` rejects provider-prefixed ids.
const DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_CANDIDATES = join(ROOT, 'scripts/fixtures/spark-tribunal-candidates.sample.json');

const STAGE_RUBRICS = {
  librarian: '.claude/agents/librarian.md',
  factChecker: '.claude/agents/fact-checker.md',
  freshEyes: '.claude/agents/fresh-eyes.md',
  vibe: '.claude/agents/vibe-opus-scorer.md',
  mixed: '.claude/agents/librarian.md',
  unknown: '.claude/agents/fresh-eyes.md',
};

function usage() {
  console.log(`Usage:
  node scripts/spark-tribunal-benchmark.mjs [options]

Options:
  --candidates <json>   Candidate JSON from history mining (default: ${DEFAULT_CANDIDATES})
  --out <dir>           Output dir (default: .results/spark-tribunal-<timestamp>)
  --limit <n>           Max candidates to export/run (default: 6)
  --stage <name>        Filter by judgeStage: librarian|factChecker|freshEyes|vibe|mixed
  --seed <text>         Deterministic A/B shuffle seed (default: spark-tribunal-v1)
  --model <id>          Model for --run (default: ${DEFAULT_MODEL})
  --run                 Run Codex on each blind case (sandbox scoped to disposable case dir)
  --help                Show this help

Examples:
  node scripts/spark-tribunal-benchmark.mjs --limit 4
  node scripts/spark-tribunal-benchmark.mjs --stage factChecker --limit 3 --run
`);
}

function parseArgs(argv) {
  const args = {
    candidates: DEFAULT_CANDIDATES,
    out: '',
    limit: 6,
    stage: '',
    seed: 'spark-tribunal-v1',
    model: DEFAULT_MODEL,
    run: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const need = (name) => {
      const value = argv[++i];
      if (!value) throw new Error(`${name} requires a value`);
      return value;
    };

    if (arg === '--') {
      continue;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--candidates') args.candidates = need(arg);
    else if (arg === '--out') args.out = need(arg);
    else if (arg === '--limit') args.limit = Number.parseInt(need(arg), 10);
    else if (arg === '--stage') args.stage = need(arg);
    else if (arg === '--seed') args.seed = need(arg);
    else if (arg === '--model') args.model = need(arg);
    else if (arg === '--run') args.run = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  if (!args.out) {
    const stamp = new Date()
      .toISOString()
      .replaceAll(':', '')
      .replace(/\.\d{3}Z$/, 'Z');
    args.out = join(ROOT, '.results', `spark-tribunal-${stamp}`);
  }
  args.candidates = resolve(args.candidates);
  args.out = resolve(args.out);
  return args;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function assertSafePostPath(postFile) {
  if (
    !postFile.startsWith('src/content/posts/') ||
    postFile.includes('..') ||
    !postFile.endsWith('.mdx')
  ) {
    throw new Error(`Unsafe or unsupported postFile: ${postFile}`);
  }
}

function readRevision(commit, postFile) {
  assertSafePostPath(postFile);
  return git(['show', `${commit}:${postFile}`]);
}

function stripFrontmatterBlock(frontmatter, key) {
  const lines = frontmatter.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === `${key}:` || line.startsWith(`${key}: `)) {
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') {
          i += 1;
          continue;
        }
        if (!next.startsWith(' ') && !next.startsWith('\t')) break;
        i += 1;
      }
      i -= 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function sanitizePost(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return text;

  let frontmatter = text.slice(4, end);
  const body = text.slice(end + 5);

  for (const key of ['scores', 'translatedBy']) {
    frontmatter = stripFrontmatterBlock(frontmatter, key);
  }

  frontmatter = frontmatter
    .split('\n')
    .filter((line) => !line.startsWith('ticketId:') && !line.startsWith('pipelineUrl:'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `---\n${frontmatter}\n---\n${body}`;
}

function pickLabel(seed, candidate) {
  const h = createHash('sha256')
    .update(`${seed}:${candidate.rank}:${candidate.ticketId}:${candidate.afterCommit}`)
    .digest('hex');
  return Number.parseInt(h.slice(0, 2), 16) % 2 === 0 ? 'A' : 'B';
}

function stageRubricPath(stage) {
  return STAGE_RUBRICS[stage] || STAGE_RUBRICS.unknown;
}

function normalizeStage(stage) {
  if (stage === 'fact-checker' || stage === 'factchecker') return 'factChecker';
  if (stage === 'fresh-eyes' || stage === 'fresheyes') return 'freshEyes';
  return stage || 'unknown';
}

function loadCandidates(path, stageFilter, limit) {
  if (!existsSync(path)) throw new Error(`Candidate file not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
  if (!Array.isArray(candidates))
    throw new Error('Candidate JSON must be an array or { candidates: [...] }');

  return candidates
    .map((candidate, index) => ({
      ...candidate,
      rank: candidate.rank ?? index + 1,
      judgeStage: normalizeStage(candidate.judgeStage),
    }))
    .filter((candidate) => !stageFilter || candidate.judgeStage === normalizeStage(stageFilter))
    .slice(0, limit);
}

function buildPrompt({ caseId, stage, rubricFile, promptVersion }) {
  return `You are Codex Spark running a blind gu-log tribunal benchmark case.

STRICT RULES:
- Use only files in this directory: A.mdx, B.mdx, rubric.md, and this prompt.
- Do not inspect parent directories, git history, score manifests, commit messages, or the real gu-log repo.
- Do not use the network.
- Do not modify files.
- Existing scores and identifying metadata were intentionally removed.

TASK:
Compare A.mdx and B.mdx using rubric.md for judge stage: ${stage}.
Choose which version is better for that judge stage. If neither is meaningfully better, choose "tie".

Return JSON only, exactly this shape:
{
  "caseId": "${caseId}",
  "promptVersion": "${promptVersion}",
  "judgeStage": "${stage}",
  "winner": "A|B|tie",
  "confidence": "low|medium|high",
  "dimensionScores": {
    "A": { "score": 0 },
    "B": { "score": 0 }
  },
  "reasons": ["short grounded reason 1", "short grounded reason 2"],
  "failureRisks": ["if any"],
  "notes": "one sentence max"
}

Rubric file: ${rubricFile}
`;
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function makeCase(outDir, candidate, index, seed) {
  const caseId = `case-${String(index + 1).padStart(3, '0')}`;
  const blindDir = join(outDir, 'blind', caseId);
  mkdirSync(blindDir, { recursive: true });

  const stage = normalizeStage(candidate.judgeStage);
  const afterLabel = pickLabel(seed, candidate);
  const beforeLabel = afterLabel === 'A' ? 'B' : 'A';
  const beforeText = sanitizePost(readRevision(candidate.beforeCommit, candidate.postFile));
  const afterText = sanitizePost(readRevision(candidate.afterCommit, candidate.postFile));

  writeFileSync(join(blindDir, `${beforeLabel}.mdx`), beforeText);
  writeFileSync(join(blindDir, `${afterLabel}.mdx`), afterText);

  const rubricRel = stageRubricPath(stage);
  const rubricPath = join(ROOT, rubricRel);
  const rubric = existsSync(rubricPath)
    ? readFileSync(rubricPath, 'utf8')
    : `No stage-specific rubric found for ${stage}. Judge practical improvement only.`;
  writeFileSync(join(blindDir, 'rubric.md'), rubric);

  const promptVersion = 'spark-tribunal-ab-v1';
  const prompt = buildPrompt({ caseId, stage, rubricFile: 'rubric.md', promptVersion });
  writeFileSync(join(blindDir, 'prompt.md'), prompt);

  return {
    caseId,
    blindDir,
    expectedWinner: afterLabel,
    beforeLabel,
    afterLabel,
    stage,
    candidate: {
      rank: candidate.rank,
      ticketId: candidate.ticketId || '',
      postFile: candidate.postFile,
      beforeCommit: candidate.beforeCommit,
      afterCommit: candidate.afterCommit,
      leakageRisk: candidate.leakageRisk || 'unknown',
      recommendedBlindTest: candidate.recommendedBlindTest || '',
    },
  };
}

function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to fenced/verbose-output JSON extraction.
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // Fall through to null when the model output is not valid JSON.
    }
  }
  return null;
}

function buildEmbeddedRunPrompt(testCase) {
  const basePrompt = readFileSync(join(testCase.blindDir, 'prompt.md'), 'utf8');
  const rubric = readFileSync(join(testCase.blindDir, 'rubric.md'), 'utf8');
  const a = readFileSync(join(testCase.blindDir, 'A.mdx'), 'utf8');
  const b = readFileSync(join(testCase.blindDir, 'B.mdx'), 'utf8');
  return `${basePrompt}

AUTOMATED RUN OVERRIDE:
Do not run shell commands and do not read files. All required inputs are embedded below.

<rubric.md>
${rubric}
</rubric.md>

<A.mdx>
${a}
</A.mdx>

<B.mdx>
${b}
</B.mdx>
`;
}

function runCase(testCase, model, resultsDir) {
  const prompt = buildEmbeddedRunPrompt(testCase);
  const outputPath = join(resultsDir, `${testCase.caseId}.raw.txt`);
  const args = [
    'exec',
    '--model',
    model,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--cd',
    testCase.blindDir,
    '--',
    prompt,
  ];

  const result = spawnSync('codex', args, {
    cwd: testCase.blindDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = `${result.stdout || ''}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`;
  writeFileSync(outputPath, raw);

  const parsed = extractJson(result.stdout || '');
  const winner = parsed?.winner || null;
  const correct = winner === testCase.expectedWinner;
  return {
    caseId: testCase.caseId,
    judgeStage: testCase.stage,
    model,
    exitCode: result.status,
    expectedWinner: testCase.expectedWinner,
    actualWinner: winner,
    correct,
    parsed,
    rawOutput: outputPath,
  };
}

function summarizeRun(runResults) {
  const judged = runResults.filter((r) => r.actualWinner && r.actualWinner !== 'tie');
  const correct = judged.filter((r) => r.correct).length;
  return {
    totalCases: runResults.length,
    judgedCases: judged.length,
    correct,
    accuracy: judged.length ? Number((correct / judged.length).toFixed(3)) : null,
    ties: runResults.filter((r) => r.actualWinner === 'tie').length,
    errors: runResults.filter((r) => r.exitCode !== 0 || !r.parsed).length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = loadCandidates(args.candidates, args.stage, args.limit);
  if (candidates.length === 0) throw new Error('No candidates selected');

  mkdirSync(args.out, { recursive: true });
  mkdirSync(join(args.out, 'blind'), { recursive: true });
  mkdirSync(join(args.out, 'private'), { recursive: true });
  mkdirSync(join(args.out, 'results'), { recursive: true });

  const cases = candidates.map((candidate, index) =>
    makeCase(args.out, candidate, index, args.seed)
  );
  writeJson(join(args.out, 'private', 'ground-truth.json'), {
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    candidateSource: args.candidates,
    cases: cases.map(({ blindDir: _blindDir, ...rest }) => rest),
  });

  const publicManifest = {
    generatedAt: new Date().toISOString(),
    prompt:
      'Blind A/B packs for Codex Spark tribunal benchmark. Ground truth is intentionally private.',
    cases: cases.map((testCase) => ({
      caseId: testCase.caseId,
      judgeStage: testCase.stage,
      blindDir: testCase.blindDir,
      files: ['A.mdx', 'B.mdx', 'rubric.md', 'prompt.md'],
    })),
  };
  writeJson(join(args.out, 'manifest.json'), publicManifest);

  const runResults = [];
  if (args.run) {
    for (const testCase of cases) {
      console.error(
        `[spark-benchmark] running ${testCase.caseId} (${testCase.stage}) with ${args.model}`
      );
      runResults.push(runCase(testCase, args.model, join(args.out, 'results')));
    }
    writeJson(join(args.out, 'results', 'results.json'), {
      generatedAt: new Date().toISOString(),
      model: args.model,
      summary: summarizeRun(runResults),
      results: runResults,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: args.out,
        cases: cases.length,
        run: args.run,
        model: args.run ? args.model : undefined,
        results: args.run ? summarizeRun(runResults) : undefined,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(`[spark-benchmark] ERROR: ${error.message}`);
  process.exit(1);
}
