/**
 * Metrics Reader Service
 *
 * Shared logic for reading quality/ JSON files.
 * Handles file-not-found gracefully, provides typed access
 * to all metric data sources, and computes trends.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Trend } from '../types/metrics.js';

/** Base path to quality/ directory. Can be overridden for testing. */
let qualityDir = join(import.meta.dirname, '..', '..', '..', 'quality');

/**
 * Override the quality directory path (used in tests).
 */
export function setQualityDir(dir: string): void {
  qualityDir = dir;
}

/**
 * Get the current quality directory path.
 */
export function getQualityDir(): string {
  return qualityDir;
}

/**
 * Read and parse a JSON file from the quality/ directory.
 * Returns null if file doesn't exist or is invalid JSON.
 *
 * @param filename - Name of the file inside quality/
 * @returns Parsed JSON data or null
 */
export async function readMetricFile<T>(filename: string): Promise<T | null> {
  try {
    const filePath = join(qualityDir, filename);
    let content = await readFile(filePath, 'utf-8');
    // Some quality files contain npm script output before JSON.
    // Strip everything before the first { or [.
    content = stripNonJsonPrefix(content);
    return JSON.parse(content) as T;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null;
    }
    // Re-throw parse errors and other unexpected errors
    throw err;
  }
}

/**
 * Read a metric file, throwing a typed error if not found.
 * Use this when the file is required for a response.
 */
export async function readRequiredMetricFile<T>(filename: string): Promise<T> {
  const data = await readMetricFile<T>(filename);
  if (data === null) {
    const error = new MetricNotFoundError(`No data yet: ${filename}`);
    throw error;
  }
  return data;
}

/**
 * Compute trend from a history array using a numeric value extractor.
 * Compares latest entry to the one before it.
 *
 * - improving: value decreased (fewer issues) or increased (for coverage)
 * - degrading: value increased (more issues) or decreased (for coverage)
 * - stable: no change or not enough data
 *
 * @param history - Array of history entries (oldest first)
 * @param getValue - Function to extract the comparable numeric value
 * @param higherIsBetter - If true, higher values = improving (e.g., coverage)
 */
export function computeTrend<T>(
  history: T[],
  getValue: (entry: T) => number,
  higherIsBetter = false
): Trend {
  if (history.length < 2) return 'stable';

  const latest = getValue(history[history.length - 1]!);
  const previous = getValue(history[history.length - 2]!);

  if (latest === previous) return 'stable';

  if (higherIsBetter) {
    return latest > previous ? 'improving' : 'degrading';
  }
  return latest < previous ? 'improving' : 'degrading';
}

/**
 * Filter history entries by date range and limit.
 */
export function filterHistory<T extends { date: string }>(
  history: T[],
  from?: string,
  limit?: number
): T[] {
  let filtered = history;

  if (from) {
    const fromDate = new Date(from);
    filtered = filtered.filter((entry) => new Date(entry.date) >= fromDate);
  }

  if (limit !== undefined && limit > 0) {
    filtered = filtered.slice(-limit);
  }

  return filtered;
}

/**
 * Validate query parameters for history endpoints.
 * Returns an error message if invalid, null if valid.
 */
export function validateHistoryParams(
  from?: string,
  limit?: string
): string | null {
  if (from !== undefined) {
    const date = new Date(from);
    if (isNaN(date.getTime())) {
      return `Invalid 'from' date: ${from}. Expected ISO date format (e.g., 2026-02-01)`;
    }
  }

  if (limit !== undefined) {
    const num = Number(limit);
    if (isNaN(num) || !Number.isInteger(num) || num < 1) {
      return `Invalid 'limit': ${limit}. Expected a positive integer`;
    }
    if (num > 1000) {
      return `'limit' too large: ${limit}. Maximum is 1000`;
    }
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────

export class MetricNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'MetricNotFoundError';
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Strip non-JSON prefix from file content.
 * Some quality/ files contain npm script output lines before JSON data.
 * This finds the first { or [ and returns from there.
 */
function stripNonJsonPrefix(content: string): string {
  const objStart = content.indexOf('{');
  const arrStart = content.indexOf('[');

  if (objStart === -1 && arrStart === -1) return content;
  if (objStart === -1) return content.slice(arrStart);
  if (arrStart === -1) return content.slice(objStart);

  return content.slice(Math.min(objStart, arrStart));
}
