/**
 * Tribunal v2 — Claude CLI Invocation Helper
 *
 * Shared helper for spawning `claude -p --agent <name>` subprocesses.
 * All v2 stage runners go through this to talk to Claude Code agents.
 *
 * Why subprocess (not SDK)?
 * - Proven pattern from v1 `scripts/tribunal-all-claude.sh`
 * - Reuses the existing `.claude/agents/*.md` definitions as SSOT
 * - Agents that write files (Write tool) work naturally via CLI
 * - Zero extra auth setup — inherits user's claude login
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Options for a single Claude agent invocation.
 */
export interface SpawnClaudeAgentOptions {
  /** Agent name (without .md), e.g. "vibe-opus-scorer" */
  agent: string;
  /** The prompt string to pass as the positional arg to `claude -p` */
  prompt: string;
  /** Timeout in seconds before killing the subprocess */
  timeoutSec: number;
  /** Working directory for the subprocess (defaults to process.cwd()) */
  cwd?: string;
}

export interface SpawnClaudeAgentResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Spawn `claude -p --agent <name> --dangerously-skip-permissions "<prompt>"`.
 *
 * Returns captured stdout/stderr. Does NOT parse JSON — that's the caller's job.
 * Throws on non-zero exit or timeout.
 */
export async function spawnClaudeAgent(
  opts: SpawnClaudeAgentOptions
): Promise<SpawnClaudeAgentResult> {
  const started = Date.now();
  const args = ['-p', '--agent', opts.agent, '--dangerously-skip-permissions', opts.prompt];

  return new Promise((resolve, reject) => {
    // `spawn` (not execFile) so we can pass stdio: 'ignore' on stdin —
    // `claude -p` otherwise waits 3s for stdin data on every invocation.
    //
    // `detached: true` puts the child in its own process group. On timeout
    // we send the signal to the group (`process.kill(-pid, sig)`) so that
    // any tool-execution subprocesses Claude has spawned (Write/Edit/Bash)
    // are torn down with it — otherwise orphaned children can keep
    // mutating the repo after the pipeline has already moved on, racing
    // with constraint reverts and subsequent git commits.
    const child = spawn('claude', args, {
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let sigkillTimer: NodeJS.Timeout | null = null;

    /** Signal the entire process group. Swallow ESRCH (group already gone). */
    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Group already exited — benign.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      // Fallback: if the group ignores SIGTERM or a child hangs in I/O,
      // force-kill after 5s so the Promise never stalls past the timeout.
      sigkillTimer = setTimeout(() => killGroup('SIGKILL'), 5000);
    }, opts.timeoutSec * 1000);

    child.stdout.on('data', (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr.on('data', (buf: Buffer) => {
      stderr += buf.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      reject(new Error(`claude --agent ${opts.agent} failed to spawn: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      const durationMs = Date.now() - started;

      if (timedOut) {
        reject(
          new Error(
            `claude --agent ${opts.agent} timed out after ${opts.timeoutSec}s (ran ${durationMs}ms)`
          )
        );
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `claude --agent ${opts.agent} failed (code=${code}, ${durationMs}ms):\n` +
              `stdout: ${stdout.slice(-500)}\n` +
              `stderr: ${stderr.slice(-500)}`
          )
        );
        return;
      }

      resolve({ stdout, stderr, durationMs });
    });
  });
}

/**
 * Strip markdown code fences and extract the first valid JSON object/array.
 * Ported from `scripts/score-helpers.sh` normalize_json_file().
 *
 * Agents sometimes wrap output in ```json ... ``` or include prose before/after.
 * This finds the first `{` or `[` and greedily parses forward.
 */
export function extractJson(raw: string): unknown {
  // Strip leading markdown code fence
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '');
  text = text.replace(/\s*```\s*$/i, '');

  // Find first { or [ and try to parse from there
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;

    // Try progressively longer slices — cheap brute force for small outputs
    // For agent JSON we almost always get valid JSON in one shot
    try {
      return JSON.parse(text.slice(i));
    } catch {
      // Try to find matching close bracket
      const close = ch === '{' ? '}' : ']';
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (c === ch) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(i, j + 1));
            } catch {
              break;
            }
          }
        }
      }
    }
  }

  throw new Error(`No valid JSON found in output:\n${raw.slice(0, 500)}`);
}

/**
 * Run a judge agent that writes its JSON output to a temp file.
 * Pattern: prompt tells the agent "write JSON to <path>", we read it back.
 *
 * This is more reliable than parsing stdout because:
 * - Agents often write explanatory prose + JSON together on stdout
 * - File-based handoff is what v1 uses and it's battle-tested
 */
export async function runJudgeAgent<T>(opts: {
  agent: string;
  /** Build the prompt given the output JSON file path */
  buildPrompt: (outputPath: string) => string;
  timeoutSec: number;
  cwd?: string;
}): Promise<{ parsed: T; raw: string; stdout: string; durationMs: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'tribunal-v2-'));
  const outputPath = join(dir, 'output.json');

  try {
    const prompt = opts.buildPrompt(outputPath);
    const result = await spawnClaudeAgent({
      agent: opts.agent,
      prompt,
      timeoutSec: opts.timeoutSec,
      cwd: opts.cwd,
    });

    let raw: string;
    try {
      raw = await readFile(outputPath, 'utf-8');
    } catch {
      // Fall back to stdout if agent didn't write the file
      raw = result.stdout;
    }

    const parsed = extractJson(raw) as T;
    return { parsed, raw, stdout: result.stdout, durationMs: result.durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Run a writer agent that modifies the article file in place.
 * Pattern: prompt tells the agent "rewrite src/content/posts/foo.mdx", it uses Write tool.
 * We don't parse structured output — just verify the file was touched.
 */
export async function runWriterAgent(opts: {
  agent: string;
  prompt: string;
  timeoutSec: number;
  cwd?: string;
}): Promise<{ stdout: string; durationMs: number }> {
  const result = await spawnClaudeAgent(opts);
  return { stdout: result.stdout, durationMs: result.durationMs };
}
