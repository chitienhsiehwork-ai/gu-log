#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CHANGES_ROOT = 'openspec/changes';
const ARCHIVE_ROOT = `${CHANGES_ROOT}/archive`;
// Normative source: the spec-driven-review-loop archive-shape requirement.
const MANDATORY_FILES = ['.openspec.yaml', 'proposal.md', 'design.md', 'tasks.md'];
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

class OperationalError extends Error {}

function failOperational(message) {
  throw new OperationalError(message);
}

function git(args, context) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT,
  });

  if (result.error) {
    failOperational(`${context}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`)
      .trim()
      .split('\n')[0];
    failOperational(`${context}: ${detail}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--base' && flag !== '--head') {
      failOperational(`unknown argument: ${flag}`);
    }
    const key = flag.slice(2);
    if (values[key] !== undefined) {
      failOperational(`duplicate argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      failOperational(`missing value for ${flag}`);
    }
    values[key] = value;
    index += 1;
  }

  for (const key of ['base', 'head']) {
    if (!values[key]) failOperational(`missing required --${key} <sha>`);
    if (!OID_RE.test(values[key])) {
      failOperational(`--${key} must be a full commit SHA`);
    }
  }
  return values;
}

function parseSingleOid(output, context) {
  const oid = output.trim();
  if (!OID_RE.test(oid)) failOperational(`${context}: invalid object id output`);
  return oid.toLowerCase();
}

function validateCommit(label, input) {
  const type = git(['cat-file', '-t', input], `cannot resolve ${label} commit`).trim();
  if (type !== 'commit') failOperational(`${label} object is ${type || 'unknown'}, not a commit`);

  const commit = parseSingleOid(
    git(['rev-parse', '--verify', `${input}^{commit}`], `cannot resolve ${label} commit`),
    `cannot resolve ${label} commit`
  );
  const tree = parseSingleOid(
    git(['rev-parse', '--verify', `${commit}^{tree}`], `cannot read ${label} commit tree`),
    `cannot read ${label} commit tree`
  );
  const treeType = git(['cat-file', '-t', tree], `cannot read ${label} commit tree`).trim();
  if (treeType !== 'tree') failOperational(`${label} commit tree is not a tree object`);
  return { commit, tree };
}

function parseTreeRecords(output, context) {
  if (output === '') return [];
  const records = output.split('\0');
  if (records.pop() !== '') failOperational(`${context}: unterminated git ls-tree output`);

  return records.map((record) => {
    const tab = record.indexOf('\t');
    if (tab < 0) failOperational(`${context}: malformed git ls-tree record`);
    const metadata = record.slice(0, tab).split(' ');
    if (metadata.length !== 3 || !/^\d{6}$/.test(metadata[0]) || !OID_RE.test(metadata[2])) {
      failOperational(`${context}: malformed git ls-tree metadata`);
    }
    return {
      mode: metadata[0],
      type: metadata[1],
      oid: metadata[2].toLowerCase(),
      path: record.slice(tab + 1),
    };
  });
}

const entryCache = new Map();
function entryAt(commit, path) {
  const cacheKey = `${commit}\0${path}`;
  if (entryCache.has(cacheKey)) return entryCache.get(cacheKey);

  const entries = parseTreeRecords(
    git(['ls-tree', '-z', '--full-tree', commit, '--', path], `cannot read ${path} at ${commit}`),
    `cannot read ${path} at ${commit}`
  );
  const exact = entries.filter((entry) => entry.path === path);
  if (exact.length > 1) failOperational(`multiple tree entries returned for ${path} at ${commit}`);
  const value = exact[0] ?? null;
  entryCache.set(cacheKey, value);
  return value;
}

const childrenCache = new Map();
function treeChildren(treeOid, context) {
  if (childrenCache.has(treeOid)) return childrenCache.get(treeOid);
  const entries = parseTreeRecords(
    git(['ls-tree', '-z', treeOid], `cannot enumerate ${context}`),
    `cannot enumerate ${context}`
  );
  childrenCache.set(treeOid, entries);
  return entries;
}

const recursiveTreeCache = new Map();
function recursiveTreeEntries(treeOid, context) {
  if (recursiveTreeCache.has(treeOid)) return recursiveTreeCache.get(treeOid);
  const entries = parseTreeRecords(
    git(['ls-tree', '-r', '-t', '-z', treeOid], `cannot traverse ${context}`),
    `cannot traverse ${context}`
  );
  recursiveTreeCache.set(treeOid, entries);
  return entries;
}

function childEntriesAt(commit, path) {
  const root = entryAt(commit, path);
  if (!root) return [];
  if (root.type !== 'tree') failOperational(`${path} at ${commit} is not a directory tree`);
  return treeChildren(root.oid, `${path} at ${commit}`);
}

function activeDirectories(commit) {
  return new Map(
    childEntriesAt(commit, CHANGES_ROOT)
      .filter((entry) => entry.type === 'tree' && entry.path !== 'archive')
      .map((entry) => [entry.path, entry])
  );
}

function archiveEntries(commit) {
  return new Map(childEntriesAt(commit, ARCHIVE_ROOT).map((entry) => [entry.path, entry]));
}

function parseOidLines(output, context) {
  if (output.trim() === '') return [];
  return output
    .trim()
    .split('\n')
    .map((line) => {
      if (!OID_RE.test(line)) failOperational(`${context}: invalid commit id output`);
      return line.toLowerCase();
    });
}

function prOnlyCommits(head, base) {
  return parseOidLines(
    git(['rev-list', head, '--not', base], 'cannot enumerate PR-only reachable commits'),
    'cannot enumerate PR-only reachable commits'
  );
}

function pathSetForTree(entry, context) {
  if (entry.type !== 'tree') failOperational(`${context} is not a directory tree`);
  return new Set(recursiveTreeEntries(entry.oid, context).map((item) => item.path));
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidDate(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function parseCanonicalArchiveName(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(.+)$/.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDate(year, month, day)) return null;
  return { date: `${match[1]}-${match[2]}-${match[3]}`, changeName: match[4] };
}

function isRegularFile(entry) {
  return entry?.type === 'blob' && /^100\d{3}$/.test(entry.mode);
}

const blobSizeCache = new Map();
function blobSize(oid) {
  if (blobSizeCache.has(oid)) return blobSizeCache.get(oid);
  const output = git(['cat-file', '-s', oid], `cannot read blob size for ${oid}`).trim();
  if (!/^\d+$/.test(output))
    failOperational(`cannot read blob size for ${oid}: invalid size output`);
  const size = Number(output);
  if (!Number.isSafeInteger(size))
    failOperational(`cannot read blob size for ${oid}: invalid size`);
  blobSizeCache.set(oid, size);
  return size;
}

function isNonemptyRegularFile(entry) {
  return isRegularFile(entry) && blobSize(entry.oid) > 0;
}

function graphDistancesFromHead(head) {
  const output = git(['rev-list', '--parents', head], 'cannot enumerate HEAD ancestry');
  const parentsByCommit = new Map();
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const fields = line.split(' ');
    if (fields.some((field) => !OID_RE.test(field))) {
      failOperational('cannot enumerate HEAD ancestry: invalid rev-list output');
    }
    parentsByCommit.set(
      fields[0].toLowerCase(),
      fields.slice(1).map((field) => field.toLowerCase())
    );
  }
  if (!parentsByCommit.has(head)) failOperational('cannot enumerate HEAD ancestry: HEAD is absent');

  const distances = new Map([[head, 0]]);
  const queue = [head];
  for (let index = 0; index < queue.length; index += 1) {
    const commit = queue[index];
    const parents = parentsByCommit.get(commit);
    if (!parents) failOperational(`cannot enumerate HEAD ancestry at ${commit}`);
    for (const parent of parents) {
      if (!distances.has(parent)) {
        distances.set(parent, distances.get(commit) + 1);
        queue.push(parent);
      }
    }
  }
  return distances;
}

function stableSetKey(paths) {
  return [...paths].sort().join('\0');
}

function nearestSnapshotPaths(name, snapshots, distances) {
  let nearestDistance = Number.POSITIVE_INFINITY;
  const frontier = [];
  for (const snapshot of snapshots) {
    const distance = distances.get(snapshot.commit);
    if (distance === undefined) {
      failOperational(`active snapshot ${snapshot.commit} for ${name} is not reachable from HEAD`);
    }
    if (distance < nearestDistance) {
      nearestDistance = distance;
      frontier.length = 0;
      frontier.push(snapshot);
    } else if (distance === nearestDistance) {
      frontier.push(snapshot);
    }
  }

  const keys = new Set(frontier.map((snapshot) => stableSetKey(snapshot.paths)));
  if (keys.size !== 1) {
    failOperational(
      `nearest active snapshot frontier for "${name}" has conflicting path sets at distance ${nearestDistance}`
    );
  }
  return frontier[0].paths;
}

function addFinding(findings, message) {
  findings.add(message);
}

function describeFileProblem(entry) {
  if (!entry) return 'is missing';
  if (!isRegularFile(entry)) return 'is not a regular file';
  if (blobSize(entry.oid) === 0) return 'is empty';
  return null;
}

function validateArchive({ entry, parsed, snapshots, distances, base, head, findings }) {
  const archivePath = `${ARCHIVE_ROOT}/${entry.path}`;
  const items = recursiveTreeEntries(entry.oid, archivePath);
  const itemByPath = new Map(items.map((item) => [item.path, item]));
  const archivePaths = new Set(items.map((item) => item.path));

  for (const requiredPath of MANDATORY_FILES) {
    const problem = describeFileProblem(itemByPath.get(requiredPath));
    if (problem) addFinding(findings, `archive "${archivePath}" ${problem} at "${requiredPath}".`);
  }

  const deltaSpecs = items.filter((item) => /^specs\/[^/]+\/spec\.md$/.test(item.path));
  const validDeltaSpecs = deltaSpecs.filter(isNonemptyRegularFile);
  if (validDeltaSpecs.length === 0) {
    addFinding(
      findings,
      `archive "${archivePath}" has no nonempty regular specs/<capability>/spec.md.`
    );
  }
  for (const deltaSpec of deltaSpecs) {
    const problem = describeFileProblem(deltaSpec);
    if (problem)
      addFinding(findings, `archive "${archivePath}" ${problem} at "${deltaSpec.path}".`);
  }

  if (snapshots?.length) {
    const nearestPaths = nearestSnapshotPaths(parsed.changeName, snapshots, distances);
    for (const requiredPath of [...nearestPaths].sort()) {
      if (!archivePaths.has(requiredPath)) {
        addFinding(
          findings,
          `archive "${archivePath}" does not preserve nearest active path "${requiredPath}".`
        );
      }
    }
  }

  for (const deltaSpec of deltaSpecs) {
    const capability = deltaSpec.path.split('/')[1];
    const stablePath = `openspec/specs/${capability}/spec.md`;
    const headStable = entryAt(head, stablePath);
    const stableProblem = describeFileProblem(headStable);
    if (stableProblem) {
      addFinding(
        findings,
        `archive "${archivePath}" stable spec "${stablePath}" ${stableProblem}.`
      );
      continue;
    }
    const baseStable = entryAt(base, stablePath);
    if (baseStable && baseStable.oid === headStable.oid) {
      addFinding(
        findings,
        `archive "${archivePath}" stable spec "${stablePath}" has the same blob as base.`
      );
    }
  }
}

function run(baseInput, headInput) {
  const shallow = git(
    ['rev-parse', '--is-shallow-repository'],
    'cannot inspect repository history'
  ).trim();
  if (shallow !== 'false')
    failOperational('repository history is shallow; exact commit graph is incomplete');

  const base = validateCommit('base', baseInput).commit;
  const head = validateCommit('head', headInput).commit;
  const baseActive = activeDirectories(base);
  const headActive = activeDirectories(head);
  const baseArchives = archiveEntries(base);
  const headArchives = archiveEntries(head);
  const commits = prOnlyCommits(head, base);

  const snapshotsByName = new Map();
  for (const commit of commits) {
    for (const [name, entry] of activeDirectories(commit)) {
      if (baseActive.has(name)) continue;
      if (!snapshotsByName.has(name)) snapshotsByName.set(name, []);
      snapshotsByName.get(name).push({
        commit,
        paths: pathSetForTree(entry, `${CHANGES_ROOT}/${name} at ${commit}`),
      });
    }
  }

  const introducedNames = [...snapshotsByName.keys()].sort();
  const newArchiveEntries = [...headArchives.values()]
    .filter((entry) => !baseArchives.has(entry.path))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const parsedEntries = new Map();
  const findings = new Set();

  for (const entry of newArchiveEntries) {
    const parsed = parseCanonicalArchiveName(entry.path);
    if (entry.type !== 'tree' || !parsed) {
      addFinding(
        findings,
        `archive entry "${ARCHIVE_ROOT}/${entry.path}" must be a canonical YYYY-MM-DD-<change> directory.`
      );
      continue;
    }
    parsedEntries.set(entry.path, parsed);
  }

  for (const name of introducedNames) {
    if (headActive.has(name)) addFinding(findings, `change "${name}" remains active at HEAD.`);
    const matches = newArchiveEntries.filter((entry) => {
      const parsed = parsedEntries.get(entry.path);
      return entry.type === 'tree' && parsed?.changeName === name;
    });
    if (matches.length !== 1) {
      addFinding(
        findings,
        `change "${name}" requires exactly one PR-new canonical archive; found ${matches.length}.`
      );
    }
  }

  const distances = snapshotsByName.size > 0 ? graphDistancesFromHead(head) : new Map();
  for (const entry of newArchiveEntries) {
    const parsed = parsedEntries.get(entry.path);
    if (!parsed || entry.type !== 'tree') continue;
    validateArchive({
      entry,
      parsed,
      snapshots: snapshotsByName.get(parsed.changeName),
      distances,
      base,
      head,
      findings,
    });
  }

  const sortedFindings = [...findings].sort();
  if (sortedFindings.length > 0) {
    console.error(`OpenSpec archive gate found ${sortedFindings.length} policy violation(s):`);
    for (const finding of sortedFindings) console.error(`- ${finding}`);
    return 1;
  }

  console.log(
    `OpenSpec archive gate passed (${introducedNames.length} introduced change(s), ${newArchiveEntries.length} PR-new archive entry/entries).`
  );
  return 0;
}

try {
  const { base, head } = parseArgs(process.argv.slice(2));
  process.exitCode = run(base, head);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OpenSpec archive gate could not determine a result: ${message}`);
  process.exitCode = 2;
}
