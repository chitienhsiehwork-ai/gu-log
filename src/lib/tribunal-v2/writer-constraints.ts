/**
 * Tribunal v2 — Writer Constraint Checkers
 *
 * Deterministic structural constraint checks for writer output.
 * These catch things LLMs can't reliably self-enforce:
 * URL immutability, heading order preservation, frontmatter protection,
 * and pronoun clarity (no 你/我 in body — delegates to the existing
 * `scripts/check-pronoun-clarity.mjs` so the rule stays SSOT'd with
 * the pre-commit hook).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// URL extraction + diff
// ---------------------------------------------------------------------------

const URL_REGEX = /https?:\/\/[^\s)>"'`\]]+/g;

/** Extract all unique URLs from content */
export function extractUrls(content: string): string[] {
  const matches = content.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

/** Check that URLs are unchanged between versions */
export function checkUrlsUnchanged(
  before: string,
  after: string
): {
  pass: boolean;
  violations: Array<{ type: 'added' | 'removed' | 'changed'; url: string }>;
} {
  const beforeUrls = new Set(extractUrls(before));
  const afterUrls = new Set(extractUrls(after));

  const violations: Array<{ type: 'added' | 'removed' | 'changed'; url: string }> = [];

  for (const url of beforeUrls) {
    if (!afterUrls.has(url)) {
      violations.push({ type: 'removed', url });
    }
  }

  for (const url of afterUrls) {
    if (!beforeUrls.has(url)) {
      violations.push({ type: 'added', url });
    }
  }

  return { pass: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Heading extraction + diff
// ---------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
}

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/gm;

/** Extract markdown headings with level + text */
export function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let match;
  while ((match = HEADING_REGEX.exec(content)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim() });
  }
  // Reset lastIndex for reuse
  HEADING_REGEX.lastIndex = 0;
  return headings;
}

/** Identity key for a heading: level + text. A `## Foo` → `### Foo` demotion
 * produces a different key even though the text is identical — this closes
 * the gap flagged by the Codex review where text-only comparison let silent
 * heading hierarchy mutations slip through. */
function headingKey(h: Heading): string {
  return `h${h.level}:${h.text}`;
}

/** Pretty-print a heading for violation messages. */
function headingLabel(h: Heading): string {
  return `${'#'.repeat(h.level)} ${h.text}`;
}

/** Check that markdown headings order AND levels are preserved */
export function checkHeadingsPreserved(
  before: string,
  after: string
): {
  pass: boolean;
  violations: Array<{ type: 'added' | 'removed' | 'reordered'; heading: string }>;
} {
  const beforeHeadings = extractHeadings(before);
  const afterHeadings = extractHeadings(after);

  const violations: Array<{ type: 'added' | 'removed' | 'reordered'; heading: string }> = [];

  const beforeKeys = beforeHeadings.map(headingKey);
  const afterKeys = afterHeadings.map(headingKey);

  // Removed: same text at a different level is reported as BOTH removed
  // and added — which is exactly what we want, since the hierarchy has
  // changed even though the words are the same.
  for (let i = 0; i < beforeHeadings.length; i++) {
    if (!afterKeys.includes(beforeKeys[i])) {
      violations.push({ type: 'removed', heading: headingLabel(beforeHeadings[i]) });
    }
  }

  for (let i = 0; i < afterHeadings.length; i++) {
    if (!beforeKeys.includes(afterKeys[i])) {
      violations.push({ type: 'added', heading: headingLabel(afterHeadings[i]) });
    }
  }

  // Reordered (only among shared level+text keys)
  const sharedBefore = beforeKeys.filter((k) => afterKeys.includes(k));
  const sharedAfter = afterKeys.filter((k) => beforeKeys.includes(k));

  if (sharedBefore.length === sharedAfter.length && violations.length === 0) {
    for (let i = 0; i < sharedBefore.length; i++) {
      if (sharedBefore[i] !== sharedAfter[i]) {
        // sharedAfter[i] is already a "h2:Some Heading" key — parse it back
        // into a display label so the violation message stays readable.
        violations.push({ type: 'reordered', heading: sharedAfter[i] });
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Frontmatter extraction + diff
// ---------------------------------------------------------------------------

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/** Parse frontmatter into key-value pairs (simple YAML-like parsing) */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return {};

  const lines = match[1].split('\n');
  const result: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }

  return result;
}

/** Check frontmatter is unchanged for protected fields */
export function checkFrontmatterPreserved(
  before: string,
  after: string,
  protectedFields: string[]
): {
  pass: boolean;
  violations: Array<{ field: string; before: string; after: string }>;
} {
  const beforeFm = parseFrontmatter(before);
  const afterFm = parseFrontmatter(after);

  const violations: Array<{ field: string; before: string; after: string }> = [];

  for (const field of protectedFields) {
    const bVal = beforeFm[field] ?? '';
    const aVal = afterFm[field] ?? '';
    if (bVal !== aVal) {
      violations.push({ field, before: bVal, after: aVal });
    }
  }

  return { pass: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Pronoun clarity (delegates to the canonical mjs script — SSOT w/ hook)
// ---------------------------------------------------------------------------

/**
 * Run `scripts/check-pronoun-clarity.mjs <articlePath>` and parse its stdout.
 * Returns `{ pass, violations }` where violations carry file/line/pronoun
 * context so the pipeline can feed useful feedback back into the writer.
 */
export async function checkPronounsClean(
  articlePath: string,
  cwd: string = process.cwd()
): Promise<{
  pass: boolean;
  violations: Array<{ line: number; pronoun: string; snippet: string }>;
  rawOutput: string;
}> {
  try {
    const { stdout } = await execFileAsync(
      'node',
      ['scripts/check-pronoun-clarity.mjs', articlePath],
      { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
    );
    return { pass: true, violations: [], rawOutput: stdout.toString() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    const stdout = (e.stdout ?? '').toString();
    const stderr = (e.stderr ?? '').toString();
    const combined = stdout + '\n' + stderr;

    const violations: Array<{ line: number; pronoun: string; snippet: string }> = [];
    const lineRegex = /line (\d+) — found 「([^」]+)」/g;
    let m: RegExpExecArray | null;
    while ((m = lineRegex.exec(combined)) !== null) {
      const lineNum = Number(m[1]);
      const pronoun = m[2];
      const afterMatch = combined.slice(m.index, m.index + 400);
      const snippetMatch = afterMatch.match(/>\s*\d+\s*\|\s*(.+)/);
      violations.push({
        line: lineNum,
        pronoun,
        snippet: snippetMatch ? snippetMatch[1].trim().slice(0, 200) : '',
      });
    }

    // If the catch fired but we couldn't parse any violation lines, this
    // is an operational failure (ENOENT on the script, syntax error in
    // the .mjs, timeout, unexpected exit code) — NOT a pronoun violation.
    // Returning `pass: false` with empty violations would feed empty
    // feedback into the writer loop and burn retries on a problem that
    // has nothing to do with the article. Rethrow so the pipeline
    // surfaces the real error instead of masking it as quality failure.
    if (violations.length === 0) {
      throw new Error(
        `scripts/check-pronoun-clarity.mjs failed for ${articlePath} ` +
          `(exit=${e.code ?? '?'}, no parseable violations):\n${combined.slice(-500) || '(no output)'}`
      );
    }

    return { pass: false, violations, rawOutput: combined };
  }
}

// ---------------------------------------------------------------------------
// Unified enforcement — single call-site from the pipeline
// ---------------------------------------------------------------------------

export interface WriterConstraintViolations {
  urls: ReturnType<typeof checkUrlsUnchanged>['violations'];
  headings: ReturnType<typeof checkHeadingsPreserved>['violations'];
  frontmatter: ReturnType<typeof checkFrontmatterPreserved>['violations'];
  pronouns: Array<{ line: number; pronoun: string; snippet: string }>;
}

export interface EnforceWriterConstraintsResult {
  pass: boolean;
  violations: WriterConstraintViolations;
  feedback: string;
}

/** Fields in gu-log frontmatter that a writer must never touch. */
export const PROTECTED_FRONTMATTER_FIELDS = [
  'title',
  'ticketId',
  'slug',
  'lang',
  'date',
  'updatedAt',
  'pubDate',
  'summary',
  'description',
  'source',
  'sourceUrl',
  'series',
  'author',
  'translator',
  'status',
  'tags',
];

/**
 * Run all four writer-constraint checks on the article at `articlePath`
 * comparing the current file contents with the `before` snapshot.
 *
 * Returns `pass: false` with structured violations AND a formatted
 * feedback string ready to feed into the next writer loop prompt.
 */
export async function enforceWriterConstraints(
  before: string,
  after: string,
  articlePath: string,
  cwd: string = process.cwd()
): Promise<EnforceWriterConstraintsResult> {
  const urls = checkUrlsUnchanged(before, after);
  const headings = checkHeadingsPreserved(before, after);
  const frontmatter = checkFrontmatterPreserved(before, after, PROTECTED_FRONTMATTER_FIELDS);
  const pronouns = await checkPronounsClean(articlePath, cwd);

  const violations: WriterConstraintViolations = {
    urls: urls.violations,
    headings: headings.violations,
    frontmatter: frontmatter.violations,
    pronouns: pronouns.violations,
  };

  const allPass = urls.pass && headings.pass && frontmatter.pass && pronouns.pass;

  const parts: string[] = [];
  if (!urls.pass) {
    parts.push('URLs changed (must be preserved byte-for-byte):');
    for (const v of urls.violations.slice(0, 5)) parts.push(`  - ${v.type}: ${v.url}`);
  }
  if (!headings.pass) {
    parts.push('Headings changed (structure must be preserved):');
    for (const v of headings.violations.slice(0, 5)) parts.push(`  - ${v.type}: ${v.heading}`);
  }
  if (!frontmatter.pass) {
    parts.push('Frontmatter changed (must be immutable):');
    for (const v of frontmatter.violations.slice(0, 5))
      parts.push(`  - ${v.field}: "${v.before}" → "${v.after}"`);
  }
  if (!pronouns.pass) {
    parts.push(
      'Pronoun violations (你/我 in body — forbidden outside ClawdNote/ShroomDogNote/blockquote/code):'
    );
    for (const v of pronouns.violations.slice(0, 5)) {
      parts.push(`  - line ${v.line}: found 「${v.pronoun}」 — ${v.snippet}`);
    }
    parts.push(
      '  Fix: use specific names (ShroomDog, Clawd, 讀者) or restructure sentences to be impersonal.'
    );
  }

  return {
    pass: allPass,
    violations,
    feedback: parts.join('\n'),
  };
}
