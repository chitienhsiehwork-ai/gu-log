import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach } from 'vitest';

const REMOVE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 50,
} as const;

export type TestTempDirectoryRemover = (directory: string, options: typeof REMOVE_OPTIONS) => void;

export function cleanupTestTempDirectories(
  directories: Set<string>,
  removeDirectory: TestTempDirectoryRemover = rmSync
): void {
  const errors: Error[] = [];

  for (const directory of directories) {
    try {
      removeDirectory(directory, REMOVE_OPTIONS);
      directories.delete(directory);
    } catch (error) {
      errors.push(
        new Error(`Failed to remove test temp directory: ${directory}`, { cause: error })
      );
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, `Failed to remove ${errors.length} test temp directory(s)`);
  }
}

export function useTestTempDirectories(
  options: { cleanup?: 'afterEach' | 'afterAll' } = {}
): (prefix: string) => string {
  const directories = new Set<string>();
  const cleanup = () => cleanupTestTempDirectories(directories);

  if (options.cleanup === 'afterAll') {
    afterAll(cleanup);
  } else {
    afterEach(cleanup);
  }

  return (prefix: string) => {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    directories.add(directory);
    return directory;
  };
}
