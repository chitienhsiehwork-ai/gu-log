import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/pages/reading-tracker.astro', import.meta.url), 'utf8');
const readButtonSource = readFileSync(
  new URL('../src/components/ReadStatusButton.astro', import.meta.url),
  'utf8'
);

describe('reading tracker semantic status colors', () => {
  it('themes sync badge foregrounds and backgrounds through status tokens', () => {
    expect(source).toContain('var(--color-status-success)');
    expect(source).toContain('var(--color-status-warning)');
    expect(source).toContain('var(--color-status-danger)');
    expect(source).toContain('var(--color-status-neutral)');
    expect(source).toContain(
      'color-mix(in srgb, var(--color-status-danger) 30%, var(--color-text))'
    );
    expect(source).toContain(":global([data-theme='light']) .sync-status-badge.sync-status-error");
    expect(source).toContain('color-mix(in srgb, var(--color-status-success) 8%, transparent)');
    expect(source).toContain('color-mix(in srgb, var(--color-status-warning) 8%, transparent)');
    expect(source).toContain('color-mix(in srgb, var(--color-status-danger) 8%, transparent)');
  });

  it('does not retain the legacy Dracula sync-status colors', () => {
    expect(source).not.toContain('rgba(80, 250, 123, 0.08)');
    expect(source).not.toContain('rgba(255, 184, 108, 0.08)');
    expect(source).not.toContain('#ff5555');
  });

  it('fails the build when the configured API URL is not HTTP(S)', () => {
    expect(source).toContain('new URL(configuredApiUrl)');
    expect(source).toContain("parsedApiUrl.protocol !== 'https:'");
    expect(source).toContain("parsedApiUrl.protocol !== 'http:'");
    expect(source).toContain('PUBLIC_API_URL must use http or https');
  });

  it('routes foreground and background sync imports through the fail-closed helper', () => {
    expect(source).not.toContain('importJson(JSON.stringify(merged))');
    expect(source).not.toContain('importJson(JSON.stringify(remote))');
    expect(source.match(/importSyncStore\(/g)).toHaveLength(2);
    const foregroundPush = source.indexOf('await pushToReaderSyncApi(syncApiUrl(), merged)');
    const foregroundImport = source.indexOf('importSyncStore(merged)');
    expect(foregroundPush).toBeGreaterThanOrEqual(0);
    expect(foregroundImport).toBeGreaterThanOrEqual(0);
    expect(foregroundPush).toBeLessThan(foregroundImport);

    expect(readButtonSource).not.toContain('importJson(JSON.stringify(merged))');
    expect(readButtonSource.match(/importSyncStore\(/g)).toHaveLength(1);
    const backgroundPush = readButtonSource.indexOf('await pushToReaderSyncApi(apiUrl, merged)');
    const backgroundImport = readButtonSource.indexOf('importSyncStore(merged)');
    expect(backgroundPush).toBeGreaterThanOrEqual(0);
    expect(backgroundImport).toBeGreaterThanOrEqual(0);
    expect(backgroundPush).toBeLessThan(backgroundImport);
  });

  it('keeps manual read UI and sync unchanged when the tracker write fails', () => {
    const toggle = readButtonSource.indexOf('const nowRead = toggleRead(slug, readerRevision)');
    const failedWriteGuard = readButtonSource.indexOf('if (nowRead === null) return;', toggle);
    const recordSignal = readButtonSource.indexOf('recordManualMarkRead', toggle);
    const updateUi = readButtonSource.indexOf('updateUI(nowRead)', toggle);
    const dispatch = readButtonSource.indexOf("new CustomEvent('read-status-changed'", toggle);
    const scheduleSync = readButtonSource.indexOf('scheduleDebouncedSync()', toggle);

    expect(toggle).toBeGreaterThanOrEqual(0);
    expect(failedWriteGuard).toBeGreaterThan(toggle);
    expect(failedWriteGuard).toBeLessThan(recordSignal);
    expect(failedWriteGuard).toBeLessThan(updateUi);
    expect(failedWriteGuard).toBeLessThan(dispatch);
    expect(failedWriteGuard).toBeLessThan(scheduleSync);
  });

  it('only updates auto-read UI and sync after the tracker write succeeds', () => {
    const persistRead = readButtonSource.indexOf(
      "const readPersisted = markAsRead(slug, 'active_scroll_end', readerRevision)"
    );
    const successGuard = readButtonSource.indexOf('if (readPersisted) {', persistRead);
    const markDirty = readButtonSource.indexOf('markDirtyForSync()', successGuard);
    const scheduleSync = readButtonSource.indexOf('scheduleDebouncedSync()', successGuard);
    const updateButtons = readButtonSource.indexOf(
      "document.querySelectorAll<HTMLElement>('[data-read-button]')",
      successGuard
    );
    const cleanup = readButtonSource.indexOf('cleanupTracking()', successGuard);

    expect(persistRead).toBeGreaterThanOrEqual(0);
    expect(successGuard).toBeGreaterThan(persistRead);
    expect(markDirty).toBeGreaterThan(successGuard);
    expect(scheduleSync).toBeGreaterThan(successGuard);
    expect(updateButtons).toBeGreaterThan(successGuard);
    expect(cleanup).toBeGreaterThan(updateButtons);
  });
});
