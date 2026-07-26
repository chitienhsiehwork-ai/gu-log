#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// v9 (move-clarity-vibe-to-fresheyes): clarity moved from Vibe → Fresh Eyes.
export const CURRENT_TRIBUNAL_VERSION = 9;

// Unstamped posts predate the v9 ownership move. Reading them as the current
// version would silently hide their legacy Vibe clarity score.
export const LEGACY_TRIBUNAL_VERSION = 8;

export function tribunalVersion(selector = 'current') {
  switch (selector) {
    case 'current':
      return CURRENT_TRIBUNAL_VERSION;
    case 'legacy':
      return LEGACY_TRIBUNAL_VERSION;
    default:
      throw new Error(`Unknown Tribunal version selector: ${selector}`);
  }
}

function sameRealPath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const argvScriptPath = process.argv[1] ?? '';
const __isCli = Boolean(argvScriptPath) && sameRealPath(scriptPath, argvScriptPath);

if (__isCli) {
  try {
    process.stdout.write(`${tribunalVersion(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  }
}
