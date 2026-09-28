#!/usr/bin/env node
/**
 * 來源距離章的 CLI：gp-pipeline 透過它取斷句、算帳、做英文逐字檢查、蓋章與驗章，
 * 所有確定性邏輯都在 scripts/lib/source-distance.mjs（validate-posts 與棘輪直接 import
 * 同一份）。行為契約見 openspec `source-distance-stamp`。
 *
 * 用法（輸出一律是 stdout 上的一份 JSON；錯誤訊息寫 stderr）：
 *
 *   segment --file <文章.mdx> --source <擷取檔>
 *       正文投影與原文正規化後的斷句、指紋、units 與 κ，以及給配對 prompt 用的
 *       「編號<TAB>句子」文字（區塊之間空一行）。
 *   score --segments <segment.json> --alignment <第一次.json> [--alignment <第二次.json>]
 *       驗證配對、計分並判定：ZERO（第一次零配對）、FAIL（附改寫報告）、
 *       NEEDS_SECOND（第一次三條都過，要做第二次配對）或 PASS（附章要記的指標）。
 *   ngram --file <英文.mdx> --source <擷取檔>
 *       英文版的逐字 n-gram 檢查，verdict 為 PASS 或 FAIL。
 *   stamp --file <文章.mdx> --result <score 或 ngram 的輸出> [--aligner <model>
 *         --rewrites <n> --aligner-calls <n>] [--checked-at <YYYY-MM-DD>]
 *       把通過的結果寫成章（只改 frontmatter 的 sourceDistance，正文一字不動）。結果記錄的
 *       指紋跟檔案目前的正文不同時拒絕（檔案在計分之後被改過）。繁中檔既有的
 *       englishSkipped 標記保留。
 *   stamp --file <繁中.mdx> --english-skipped verbatim | --clear-english-skipped
 *       在既有的繁中章上加上或清掉「英文版因逐字檢查略過」的標記（不影響指紋）。
 *   verify --file <文章.mdx> [--file ...]
 *       驗章，並回報這篇需不需要章（GP、外部來源、沒下架）。
 *
 * 結束碼：
 *   0  成功（判定結果在 JSON 的 verdict 裡）
 *   1  用法或輸入錯誤（缺參數、讀不到檔案、MDX 解析失敗）
 *   2  aligner 的配對輸出不合格（漏句、重複、不存在的編號）
 *   3  輸入超出 policy 的範圍（沒有導讀句、沒有原文句、原文句數超過上限）
 *   4  拒絕蓋章（結果不是 PASS，或檔案在計分之後被改過）
 *   5  verify 發現章有問題（每條錯誤也以「檔案: 訊息」寫到 stderr）
 */
import fs from 'node:fs';
import process from 'node:process';
import {
  ENGLISH_SKIPPED_VERBATIM,
  POLICY,
  STAMP_FIELD,
  decide,
  englishVerbatim,
  parseFrontmatter,
  segmentGuide,
  segmentSource,
  sourceSummary,
  subjectFingerprint,
  validateAlignment,
  verifyStamp,
  writeStamp,
} from './lib/source-distance.mjs';

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const REPEATABLE = new Set(['--alignment', '--file']);
const FLAGS = new Set(['--clear-english-skipped']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith('--')) throw new CliError(`unexpected argument ${key}`, 1);
    if (FLAGS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new CliError(`${key} needs a value`, 1);
    i++;
    if (REPEATABLE.has(key)) (options[key] ||= []).push(value);
    else options[key] = value;
  }
  return { command, options };
}

function need(options, key) {
  const value = options[key];
  if (value === undefined) throw new CliError(`missing ${key}`, 1);
  return Array.isArray(value) ? value[0] : value;
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new CliError(`cannot read ${file}: ${error.message}`, 1);
  }
}

function readJson(file) {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${file} is not valid JSON: ${error.message}`, 1);
  }
}

function frontmatterOf(file, content) {
  let data;
  try {
    data = parseFrontmatter(content);
  } catch (error) {
    throw new CliError(`${file}: frontmatter is not valid YAML: ${error.message}`, 1);
  }
  if (!data) throw new CliError(`${file}: missing YAML frontmatter`, 1);
  return data;
}

function guideSentences(file, content) {
  try {
    return segmentGuide(content);
  } catch (error) {
    throw new CliError(`${file}: cannot parse MDX: ${error.message}`, 1);
  }
}

function promptLines(sentences) {
  const lines = [];
  let previous = null;
  for (const sentence of sentences) {
    if (previous !== null && sentence.block !== previous) lines.push('');
    lines.push(`${sentence.id}\t${sentence.text}`);
    previous = sentence.block;
  }
  return lines.join('\n');
}

function segment(options) {
  const file = need(options, '--file');
  const content = read(file);
  const data = frontmatterOf(file, content);
  const guide = guideSentences(file, content);
  const source = segmentSource(read(need(options, '--source')));
  if (!guide.length) throw new CliError(`${file}: the body has no sentences to align`, 3);
  if (!source.length)
    throw new CliError('the source capture has no sentences after normalization', 3);
  if (source.length > POLICY.maxSourceSentences) {
    throw new CliError(
      `the source has ${source.length} sentences; ${POLICY.version} aligns at most ${POLICY.maxSourceSentences}`,
      3
    );
  }
  return {
    policy: POLICY.version,
    sourceUrl: data.sourceUrl ?? null,
    subjectSha256: subjectFingerprint(data.sourceUrl ?? '', guide),
    ...sourceSummary(source),
    guide,
    source,
    prompt: { guide: promptLines(guide), source: promptLines(source) },
  };
}

function score(options) {
  const segments = readJson(need(options, '--segments'));
  if (!Array.isArray(segments.guide) || !Array.isArray(segments.source)) {
    throw new CliError('--segments is not the output of `segment`', 1);
  }
  const files = options['--alignment'] || [];
  if (files.length < 1 || files.length > 2)
    throw new CliError('score takes one or two --alignment files', 1);
  const maps = files.map((file) => {
    try {
      return validateAlignment(readJson(file), segments.guide, segments.source);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`${file}: ${error.message}`, 2);
    }
  });
  const result = decide(segments.guide, segments.source, maps);
  const summarize = (s) => ({
    aligned: s.aligned,
    translationPairs: s.translationPairs,
    maxRun: s.maxRun,
    sourceRatio: s.sourceRatio,
  });
  return {
    policy: POLICY.version,
    kind: 'guide',
    verdict: result.verdict,
    fails: result.fails,
    subjectSha256: segments.subjectSha256,
    sourceSha256: segments.sourceSha256,
    sourceUnits: segments.sourceUnits,
    scores: result.scores.map(summarize),
    ...(result.union ? { union: summarize(result.union) } : {}),
    ...(result.metrics ? { metrics: result.metrics } : {}),
    ...(result.report ? { report: result.report } : {}),
  };
}

function ngram(options) {
  const file = need(options, '--file');
  const content = read(file);
  const data = frontmatterOf(file, content);
  const guide = guideSentences(file, content);
  const source = segmentSource(read(need(options, '--source')));
  if (!source.length)
    throw new CliError('the source capture has no sentences after normalization', 3);
  const { sourceSha256, sourceUnits } = sourceSummary(source);
  const result = englishVerbatim(content, source);
  return {
    policy: POLICY.version,
    kind: 'english',
    verdict: result.verdict,
    fails: result.fails,
    subjectSha256: subjectFingerprint(data.sourceUrl ?? '', guide),
    sourceSha256,
    sourceUnits,
    metrics: result.metrics,
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function count(options, key) {
  const value = Number(need(options, key));
  if (!Number.isInteger(value) || value < 0)
    throw new CliError(`${key} must be a non-negative integer`, 1);
  return value;
}

function stamp(options) {
  const file = need(options, '--file');
  const content = read(file);
  const data = frontmatterOf(file, content);
  const existing = data[STAMP_FIELD];

  if (options['--english-skipped'] !== undefined || options['--clear-english-skipped']) {
    if (data.lang === 'en') throw new CliError('englishSkipped only belongs on the zh-tw stamp', 1);
    if (!existing || typeof existing !== 'object') {
      throw new CliError(`${file} has no ${STAMP_FIELD} stamp to mark`, 4);
    }
    const next = { ...existing };
    if (options['--clear-english-skipped']) delete next.englishSkipped;
    else if (options['--english-skipped'] === ENGLISH_SKIPPED_VERBATIM) {
      next.englishSkipped = ENGLISH_SKIPPED_VERBATIM;
    } else {
      throw new CliError(`--english-skipped only accepts ${ENGLISH_SKIPPED_VERBATIM}`, 1);
    }
    fs.writeFileSync(file, writeStamp(content, next));
    return { file, stamp: next };
  }

  const result = readJson(need(options, '--result'));
  if (result.policy !== POLICY.version) {
    throw new CliError(
      `result was computed under ${result.policy}, current policy is ${POLICY.version}`,
      4
    );
  }
  if (result.verdict !== 'PASS')
    throw new CliError(`result verdict is ${result.verdict}, not PASS`, 4);
  const english = data.lang === 'en';
  if ((result.kind === 'english') !== english) {
    throw new CliError(`${file} is ${data.lang}; the result is a ${result.kind} check`, 1);
  }
  const guide = guideSentences(file, content);
  if (subjectFingerprint(data.sourceUrl ?? '', guide) !== result.subjectSha256) {
    throw new CliError(`${file} changed after it was scored; score it again before stamping`, 4);
  }
  const checkedAt = options['--checked-at'] ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt))
    throw new CliError('--checked-at must be YYYY-MM-DD', 1);
  const next = {
    policy: POLICY.version,
    verdict: 'PASS',
    subjectSha256: result.subjectSha256,
    sourceSha256: result.sourceSha256,
    sourceUnits: result.sourceUnits,
    metrics: result.metrics,
  };
  if (!english) {
    next.aligner = need(options, '--aligner');
    next.rewrites = count(options, '--rewrites');
    next.alignerCalls = count(options, '--aligner-calls');
    if (existing && typeof existing === 'object' && existing.englishSkipped !== undefined) {
      next.englishSkipped = existing.englishSkipped;
    }
  }
  next.checkedAt = checkedAt;
  fs.writeFileSync(file, writeStamp(content, next));
  return { file, stamp: next };
}

function verify(options) {
  const files = options['--file'] || [];
  if (!files.length) throw new CliError('verify needs at least one --file', 1);
  const results = files.map((file) => {
    const content = read(file);
    const data = frontmatterOf(file, content);
    const { required, errors } = verifyStamp({ content, data, file });
    return {
      file,
      lang: data.lang ?? null,
      required,
      ok: errors.length === 0,
      errors,
    };
  });
  return { results };
}

const COMMANDS = { segment, score, ngram, stamp, verify };

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const run = COMMANDS[command];
  if (!run)
    throw new CliError(
      `usage: source-distance.mjs ${Object.keys(COMMANDS).join('|')} [options]`,
      1
    );
  const output = run(options);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (command === 'verify') {
    // pre-commit 丟掉 JSON，只給人看 stderr。
    for (const r of output.results) {
      for (const error of r.errors) process.stderr.write(`${r.file}: ${error}\n`);
    }
    if (output.results.some((r) => !r.ok)) process.exitCode = 5;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`source-distance: ${error.message}\n`);
  process.exitCode = error instanceof CliError ? error.code : 1;
}
