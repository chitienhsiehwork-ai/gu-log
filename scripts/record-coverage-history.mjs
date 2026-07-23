#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function upsertCoverageHistory(history, entry) {
  if (!Array.isArray(history)) {
    throw new Error('coverage history must be an array');
  }
  if (!entry || typeof entry !== 'object' || typeof entry.date !== 'string') {
    throw new Error('coverage history entry must have a date');
  }

  return [...history.filter((item) => item?.date !== entry.date), entry];
}

export async function recordCoverageHistory(filePath, entry) {
  let history = [];
  try {
    history = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const replaced = history.some((item) => item?.date === entry.date);
  const nextHistory = upsertCoverageHistory(history, entry);
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(nextHistory, null, 2)}\n`);
  await rename(temporaryPath, filePath);
  return { replaced };
}

async function main() {
  const [filePath, entryJson] = process.argv.slice(2);
  if (!filePath || !entryJson) {
    throw new Error('Usage: record-coverage-history.mjs <history-file> <entry-json>');
  }

  const entry = JSON.parse(entryJson);
  const { replaced } = await recordCoverageHistory(filePath, entry);
  console.log(
    replaced
      ? `📝 Replaced the ${entry.date} coverage history entry.`
      : `📝 Appended the ${entry.date} coverage history entry.`
  );
}

const isDirectlyExecuted = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error(`❌ Could not record coverage history: ${error.message}`);
    process.exit(1);
  });
}
