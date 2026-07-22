#!/usr/bin/env node
/**
 * gu-log Playwright spec ownership gate — deterministic, no LLM, all blocking.
 *
 * Every tests/*.spec.ts file must have exactly one entry in
 * tests/spec-ownership.json classifying it as blocking / nightly / quarantined.
 * Workflows do not hand-list specs at all — they consume `--list <class>`
 * from this script, so a registry reclassification and a workflow's actual
 * run set can never drift apart (the #585 finding: ~29 of 40 specs were
 * referenced by nothing, because the old approach was a workflow hand-list
 * that a regex tried to keep honest after the fact).
 *
 * Usage:
 *   node scripts/check-spec-ownership.mjs                — validate registry + workflows, exit 0/1
 *   node scripts/check-spec-ownership.mjs --list <class>  — print that class's spec paths, one per
 *                                                           line, sorted; exit 1 on an empty result
 *                                                           (a workflow consuming this via $(...)
 *                                                           must never silently expand to nothing,
 *                                                           which would make `playwright test` run
 *                                                           every spec in the project).
 *
 * Scope boundary: this only enforces CI-facing workflows (.github/workflows/).
 * package.json dev-convenience scripts (e.g. `test:toc`) that hand-list a
 * spec path for local iteration are intentionally NOT covered — they're a
 * local shortcut, not CI truth, and bringing them under this gate would be
 * managing something that was never the source of drift in the first place.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VALID_CLASSES, validateWorkflowRunBlocks } from './spec-ownership-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const REGISTRY_PATH = path.join(TESTS_DIR, 'spec-ownership.json');
const WORKFLOWS_DIR = path.join(ROOT, '.github/workflows');

// Matches an unconditional skip: test.skip(true, ...), bare test.skip(),
// a named test.skip('...') call, test.describe.skip(...), or the fixme
// equivalents (test.fixme(...) / test.describe.fixme(...) also make
// Playwright not execute the test, same as skip).
// Recommended pattern for a legitimate data-dependent skip: the expression
// form test.skip(someRuntimeCondition, 'reason') — see publish-bar-visibility
// and ticket-badge-colors for the two shapes that must NOT match this regex.
const UNCONDITIONAL_SKIP_RE =
  /(^|\n)\s*test\.(skip|fixme)\(\s*(true\b|['"`]|\))|(^|\n)\s*test\.describe\.(skip|fixme)\(/;

// ─── Load registry ──────────────────────────────────────────────────
if (!fs.existsSync(REGISTRY_PATH)) {
  console.error(`FATAL: registry not found at ${path.relative(ROOT, REGISTRY_PATH)}`);
  process.exit(1);
}
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const specs = registry.specs || {};

// ─── --list <class> mode: print and exit before any validation ─────────
const listIdx = process.argv.indexOf('--list');
if (listIdx !== -1) {
  const cls = process.argv[listIdx + 1];
  if (!VALID_CLASSES.has(cls)) {
    console.error(
      `FATAL: --list requires a valid class (${[...VALID_CLASSES].join(' / ')}), got "${cls}".`
    );
    process.exit(1);
  }
  const list = Object.entries(specs)
    .filter(([, entry]) => entry.class === cls)
    .map(([spec]) => spec)
    .sort();
  if (list.length === 0) {
    console.error(
      `FATAL: --list ${cls} matched zero specs. Refusing to print an empty list — a workflow doing ` +
        `$(node scripts/check-spec-ownership.mjs --list ${cls}) would otherwise expand to no arguments ` +
        `and \`playwright test\` would run every spec in the project instead of none. Fix the registry.`
    );
    process.exit(1);
  }
  // Same parsed registry, same disk check the full validation mode does
  // below (§1 Completeness) — not a second implementation of it. Without
  // this, a spec renamed on disk without a registry update would be caught
  // as STALE by the separate `spec-ownership` validation job, while this
  // job's `--list` output still named the missing path; Playwright would
  // silently treat it as a filter with zero matches and the run would go
  // green having run one fewer spec than the registry claims.
  const missing = list.filter((spec) => !fs.existsSync(path.join(ROOT, spec)));
  if (missing.length > 0) {
    console.error(`FATAL: --list ${cls} includes non-existent spec(s): ${missing.join(', ')}.`);
    process.exit(1);
  }
  console.log(list.join('\n'));
  process.exit(0);
}

const errors = [];
const fail = (msg) => errors.push(msg);

// ─── Discover specs on disk (recursive, matches Playwright's testDir) ──
function findSpecFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSpecFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}
const diskSpecs = new Set(findSpecFiles(TESTS_DIR));
const registrySpecs = new Set(Object.keys(specs));

// ─── 1. Completeness: disk <-> registry must match exactly ─────────────
for (const spec of diskSpecs) {
  if (!registrySpecs.has(spec)) {
    fail(`UNOWNED: ${spec} exists on disk but has no entry in tests/spec-ownership.json.`);
  }
}
for (const spec of registrySpecs) {
  if (!diskSpecs.has(spec)) {
    fail(`STALE: ${spec} has a registry entry but the file no longer exists (renamed/deleted?).`);
  }
}

// ─── 2. Per-entry shape checks ──────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
for (const [spec, entry] of Object.entries(specs)) {
  if (!diskSpecs.has(spec)) continue; // already reported as STALE above

  if (!VALID_CLASSES.has(entry.class)) {
    fail(
      `INVALID CLASS: ${spec} has class "${entry.class}" — must be one of ${[...VALID_CLASSES].join(' / ')}.`
    );
  }
  if (!entry.owner || typeof entry.owner !== 'string') {
    fail(`MISSING OWNER: ${spec} has no owner.`);
  }
  if (!entry.reason || typeof entry.reason !== 'string' || entry.reason.length < 10) {
    fail(`MISSING REASON: ${spec} needs a real (>=10 char) reason, not a placeholder.`);
  }

  if (entry.class === 'quarantined') {
    if (!entry.expiry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expiry)) {
      fail(`MISSING/INVALID EXPIRY: ${spec} is quarantined but has no valid YYYY-MM-DD expiry.`);
    } else if (entry.expiry < today) {
      fail(
        `EXPIRED QUARANTINE: ${spec} expired on ${entry.expiry}. Quarantine is not a permanent exemption — ` +
          `re-run it, fix it, promote it to blocking/nightly, or delete it and extend the expiry with a fresh reason.`
      );
    }
  } else if (entry.expiry) {
    fail(
      `UNEXPECTED EXPIRY: ${spec} is "${entry.class}" but has an expiry field (only quarantined specs may).`
    );
  }

  // A spec with an unconditional skip cannot honestly be blocking/nightly —
  // it would pass CI while asserting nothing.
  const fullPath = path.join(ROOT, spec);
  if (fs.existsSync(fullPath)) {
    const body = fs.readFileSync(fullPath, 'utf8');
    if (UNCONDITIONAL_SKIP_RE.test(body) && entry.class !== 'quarantined') {
      fail(
        `UNCONDITIONAL SKIP IN NON-QUARANTINED SPEC: ${spec} is "${entry.class}" but contains an unconditional ` +
          `test.skip(...) — that means it can pass a blocking/nightly job while running zero assertions. ` +
          `Reclassify as quarantined (with expiry) or remove the skip.`
      );
    }
  }
}

// ─── 3. Workflow wiring: workflows must consume --list, never hand-list ────
// Every workflow file — not just ci.yml/nightly-deep.yml — is scanned for a
// literal `tests/*.spec.ts` reference. A literal reference is exactly the
// old failure mode (a hand-copied list a regex tries to keep honest after
// the fact); the fix is that no workflow ever spells out a spec path, it
// asks this script with --list <class> instead.
const LITERAL_SPEC_RE = /tests\/[\w/-]+\.spec\.ts/g;
const workflowFiles = fs
  .readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml')))
  .map((e) => e.name);
const expectedWorkflowClasses = new Map([
  ['.github/workflows/ci.yml', { 'e2e-core': 'blocking' }],
  ['.github/workflows/nightly-deep.yml', { 'coverage-ratchet': 'nightly' }],
]);

for (const file of workflowFiles) {
  const rel = `.github/workflows/${file}`;
  const text = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
  const literalRefs = [...new Set([...text.matchAll(LITERAL_SPEC_RE)].map((m) => m[0]))];
  if (literalRefs.length > 0) {
    fail(
      `LITERAL SPEC PATH IN WORKFLOW: ${rel} references ${literalRefs.join(', ')} directly instead of ` +
        `consuming \`node scripts/check-spec-ownership.mjs --list <class>\`. This is exactly the drift ` +
        `this gate exists to prevent — wire it through --list. (Comments count too — this scan doesn't ` +
        `parse YAML comments out, so a "# e.g. tests/foo.spec.ts" example in a comment will also trip ` +
        `this; reword the comment rather than adding an exception.)`
    );
  }
  for (const wiringError of validateWorkflowRunBlocks(
    rel,
    text,
    expectedWorkflowClasses.get(rel) ?? {}
  )) {
    fail(wiringError);
  }
}

// ─── Report ──────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error(`\n✗ spec ownership gate failed with ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    '\nFix: edit tests/spec-ownership.json and the relevant workflow file so every spec has exactly one class,\n' +
      'and every class is backed by (and only by) the matching workflow reference.\n'
  );
  process.exit(1);
}

const counts = { blocking: 0, nightly: 0, quarantined: 0 };
for (const entry of Object.values(specs)) counts[entry.class] = (counts[entry.class] || 0) + 1;
console.log(
  `✓ spec ownership gate passed — ${diskSpecs.size} specs: ` +
    `${counts.blocking} blocking, ${counts.nightly} nightly, ${counts.quarantined} quarantined.`
);
