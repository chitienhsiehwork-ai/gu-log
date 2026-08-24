import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

export function useTestTempDirectories(): (prefix: string) => string {
  const directories = new Set<string>();

  afterEach(() => {
    for (const directory of directories) {
      rmSync(directory, { recursive: true, force: true });
    }
    directories.clear();
  });

  return (prefix: string) => {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    directories.add(directory);
    return directory;
  };
}
