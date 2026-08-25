import { describe, expect, it, vi } from 'vitest';
import {
  cleanupTestTempDirectories,
  type TestTempDirectoryRemover,
} from './helpers/temp-directories';

describe('test temp directory cleanup', () => {
  it('attempts every removal, retains failures, and reports them together', () => {
    const failedDirectoryOne = '/tmp/gu-log-cleanup-failure-one';
    const failedDirectoryTwo = '/tmp/gu-log-cleanup-failure-two';
    const failureOne = new Error('simulated removal failure one');
    const failureTwo = new Error('simulated removal failure two');
    const directories = new Set([
      failedDirectoryOne,
      '/tmp/gu-log-cleanup-success',
      failedDirectoryTwo,
    ]);
    const removeDirectory = vi.fn<TestTempDirectoryRemover>((directory) => {
      if (directory === failedDirectoryOne) throw failureOne;
      if (directory === failedDirectoryTwo) throw failureTwo;
    });

    let thrown: unknown;
    try {
      cleanupTestTempDirectories(directories, removeDirectory);
    } catch (error) {
      thrown = error;
    }

    expect(removeDirectory.mock.calls.map(([directory]) => directory)).toEqual([
      failedDirectoryOne,
      '/tmp/gu-log-cleanup-success',
      failedDirectoryTwo,
    ]);
    expect(removeDirectory.mock.calls[0]?.[1]).toMatchObject({
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    expect(directories).toEqual(new Set([failedDirectoryOne, failedDirectoryTwo]));
    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregateError = thrown as AggregateError;
    expect(aggregateError.errors).toHaveLength(2);
    expect(aggregateError.errors.map((error) => (error as Error).cause)).toEqual([
      failureOne,
      failureTwo,
    ]);

    removeDirectory.mockImplementation(() => undefined);
    cleanupTestTempDirectories(directories, removeDirectory);
    expect(directories).toEqual(new Set());
  });
});
