#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_REF = 'origin/main';
const ACTIVE_CHANGES_DIR = path.join('openspec', 'changes');

export function findUnarchivedNewChanges(baseActiveNames, headActiveNames) {
  const base = new Set(baseActiveNames);
  return [...new Set(headActiveNames)].filter((name) => !base.has(name)).sort();
}

function gitLsTreeActiveNames(baseRef) {
  try {
    const output = execFileSync(
      'git',
      ['ls-tree', '-d', '--name-only', `${baseRef}:${ACTIVE_CHANGES_DIR}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    return parseActiveNames(output);
  } catch (error) {
    const message = String(error.stderr ?? error.message ?? '');
    if (
      message.includes('Not a valid object name') ||
      message.includes('does not exist') ||
      message.includes('not found')
    ) {
      return [];
    }

    throw error;
  }
}

function workingTreeActiveNames(repoRoot) {
  const changesPath = path.join(repoRoot, ACTIVE_CHANGES_DIR);
  if (!fs.existsSync(changesPath)) {
    return [];
  }

  return fs
    .readdirSync(changesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(isActiveChangeName)
    .sort();
}

function parseActiveNames(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(isActiveChangeName)
    .sort();
}

function isActiveChangeName(name) {
  return Boolean(name) && name !== 'archive';
}

function printPass(baseActiveNames, headActiveNames) {
  console.log('✓ OpenSpec archive gate passed.');
  console.log(`Base active changes: ${baseActiveNames.length}`);
  console.log(`HEAD active changes: ${headActiveNames.length}`);
  console.log('No newly introduced active OpenSpec change remains un-archived.');
}

function printFailure(unarchivedChanges) {
  console.error('✗ OpenSpec archive gate failed.');
  console.error('');
  console.error('This PR introduces active OpenSpec change(s) that are still un-archived:');
  for (const name of unarchivedChanges) {
    console.error(`- openspec/changes/${name}/`);
  }
  console.error('');
  console.error('Archive each change before marking this PR ready to merge.');
  console.error('Workflow SSOT: .agents/openspec-sdlc.md');
  console.error('Skill: source-command-opsx-archive');
  console.error('');
  console.error('Manual archive shape:');
  console.error('- sync the spec delta into openspec/specs/<capability>/spec.md');
  console.error('- move the active dir to openspec/changes/archive/YYYY-MM-DD-<name>/');
}

export function main({ baseRef = DEFAULT_BASE_REF, repoRoot = process.cwd() } = {}) {
  const baseActiveNames = gitLsTreeActiveNames(baseRef);
  const headActiveNames = workingTreeActiveNames(repoRoot);
  const unarchivedChanges = findUnarchivedNewChanges(baseActiveNames, headActiveNames);

  if (unarchivedChanges.length > 0) {
    printFailure(unarchivedChanges);
    return 1;
  }

  printPass(baseActiveNames, headActiveNames);
  return 0;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  process.exitCode = main();
}
