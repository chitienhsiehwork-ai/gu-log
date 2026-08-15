#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executeExperiment,
  generateBoard,
  initializeExperiment,
  revealResults,
  verifyIsolation,
} from './lib.mjs';

process.umask(0o077);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key]) throw new Error(`--${key} is required`);
  return path.resolve(options[key]);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  if (command === 'init') {
    const result = await initializeExperiment({ repoRoot, root: options.root });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'execute') {
    const root = required(options, 'root');
    const concurrency = options.concurrency ? Number.parseInt(options.concurrency, 10) : 3;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
      throw new Error('--concurrency must be an integer from 1 to 4');
    }
    const result = await executeExperiment(root, {
      concurrency,
      onProgress(event) {
        const value = event.result;
        console.log(
          JSON.stringify({
            phase: event.phase,
            model: value.requested_model,
            arm: value.arm,
            status: value.status,
          })
        );
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'board') {
    const result = await generateBoard(required(options, 'root'), required(options, 'output'));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'verify') {
    const result = await verifyIsolation(required(options, 'root'), required(options, 'board'));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'reveal') {
    const result = await revealResults(required(options, 'root'), required(options, 'result'));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error('usage: runner.mjs <init|execute|board|verify|reveal> [options]');
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
