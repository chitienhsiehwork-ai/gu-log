/**
 * FactChecker focal-source packet (#1099, openspec
 * tribunal-focal-source-evidence): on a GP/MP post, scripts/tribunal.sh
 * captures the complete focal source itself before the FactChecker judge
 * runs, verifies its integrity before and after the judge, and hands the
 * judge file paths — never inlined content. Capture and integrity failures
 * are operational errors (RUNNER_ERROR), never fidelity verdicts.
 * The happy path and sourceEvidence ledger binding are asserted in
 * tests/tribunal-gp-score-only.test.ts.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import {
  GP_POST,
  JUDGES,
  POST_FILE,
  makeTribunalRepo,
  runTribunal,
} from './helpers/tribunal-fixture';
import { useTestTempDirectories } from './helpers/temp-directories';

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
const linuxIt = process.platform === 'linux' ? it : it.skip;

const makeRepo = () => makeTribunalRepo(makeTempDirectory);

function stageEntry(run: ReturnType<typeof runTribunal>, postFile = POST_FILE) {
  return run.progress[postFile]?.stages?.factChecker;
}

describe('focal-source capture failures are operational, never verdicts', () => {
  linuxIt(
    'marks RUNNER_ERROR with zero attempts and calls no judge when the fetch fails',
    () => {
      const run = runTribunal(makeRepo(), { extraEnv: { FAKE_GP_FETCH_FAIL: '1' } });

      expect(run.result.status, run.output).not.toBe(0);
      expect(run.judges, 'no judge may run without a verified packet').toEqual([]);
      const entry = run.progress[POST_FILE];
      expect(entry?.status, run.output).toBe('RUNNER_ERROR');
      expect(stageEntry(run)?.error).toBe('source_capture_failed');
      expect(stageEntry(run)?.attempts, 'a capture failure costs no judge attempt').toBe(0);
      // No verdict and no score may come out of an operational failure.
      expect(matter(fs.readFileSync(run.postPath, 'utf8')).data.scores).toBeUndefined();
    },
    120_000
  );

  linuxIt.each([
    ['data file only', '1'],
    // The manifest is rewritten to match the tampered bytes: the check must
    // compare against the hash the harness holds in memory, not re-read disk.
    ['data file and manifest consistently', 'consistent'],
    // Only the judge-visible provenance is swapped; the data bytes are intact.
    ['manifest only', 'manifest-only'],
  ])(
    'discards the judge output when the packet changes while the judge runs (%s)',
    (_label, tamperMode) => {
      const run = runTribunal(makeRepo(), { extraEnv: { FAKE_TAMPER_PACKET: tamperMode } });

      expect(run.result.status, run.output).not.toBe(0);
      expect(run.judges, run.output).toEqual(['fact-checker']);
      expect(run.progress[POST_FILE]?.status, run.output).toBe('RUNNER_ERROR');
      expect(stageEntry(run)?.error).toBe('source_packet_tampered');
      expect(stageEntry(run)?.sourceEvidence).toBeUndefined();
      expect(
        matter(fs.readFileSync(run.postPath, 'utf8')).data.scores,
        'a verdict judged against a tampered capture must not persist'
      ).toBeUndefined();
    },
    120_000
  );
});

describe('the judge prompt hands over files, not inlined source content', () => {
  linuxIt(
    'frames the packet as untrusted evidence and keeps hostile source text out of the prompt',
    () => {
      const repo = makeRepo();
      const promptDump = path.join(repo.root, 'fact-checker-prompt.txt');
      const run = runTribunal(repo, { extraEnv: { FAKE_PROMPT_DUMP: promptDump } });

      expect(run.result.status, run.output).toBe(0);
      const prompt = fs.readFileSync(promptDump, 'utf8');
      expect(prompt).toContain('UNTRUSTED EVIDENCE');
      expect(prompt).toContain('Do NOT');
      expect(prompt).toContain('source-tweet.md');
      expect(prompt).toContain('manifest.json');
      // The capture body embeds an instruction-shaped line; it must reach the
      // judge only through the file, never through the prompt itself.
      expect(prompt).not.toContain('ignore your rubric');
    },
    120_000
  );
});

describe('explicit packet replay (TRIBUNAL_SOURCE_PACKET)', () => {
  function preparePacket(repo: { root: string }) {
    const packetDir = path.join(repo.root, 'replay-packet');
    fs.mkdirSync(packetDir, { mode: 0o700 });
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source scripts/tribunal-helpers.sh && tribunal_source_packet_prepare "$PWD" "$1" "$2"',
        'bash',
        path.join('src/content/posts', POST_FILE),
        packetDir,
      ],
      { cwd: repo.root, encoding: 'utf8' }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return packetDir;
  }

  linuxIt(
    'judges against the replayed packet without any live fetch',
    () => {
      const repo = makeRepo();
      const packetDir = preparePacket(repo);
      const run = runTribunal(repo, { extraEnv: { TRIBUNAL_SOURCE_PACKET: packetDir } });

      expect(run.result.status, run.output).toBe(0);
      expect(run.judges, run.output).toEqual(JUDGES);
      expect(run.fetches, 'replay must not fetch the source again').toEqual([]);
      expect(stageEntry(run)?.sourceEvidence?.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    },
    120_000
  );

  linuxIt(
    'hands the judge the data file the manifest names, not a hard-coded filename',
    () => {
      const repo = makeRepo();
      const packetDir = preparePacket(repo);
      // Rename the verified data file and point the manifest at it; a stale
      // decoy keeps the hard-coded name occupied.
      const dataPath = path.join(packetDir, 'source-tweet.md');
      const renamedPath = path.join(packetDir, 'evidence.md');
      fs.renameSync(dataPath, renamedPath);
      fs.writeFileSync(dataPath, 'stale decoy that must not be judged\n');
      const manifestPath = path.join(packetDir, 'manifest.json');
      fs.chmodSync(manifestPath, 0o600);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.content.file = 'evidence.md';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const promptDump = path.join(repo.root, 'fact-checker-prompt.txt');
      const run = runTribunal(repo, {
        extraEnv: { TRIBUNAL_SOURCE_PACKET: packetDir, FAKE_PROMPT_DUMP: promptDump },
      });
      expect(run.result.status, run.output).toBe(0);
      const prompt = fs.readFileSync(promptDump, 'utf8');
      expect(prompt).toContain('evidence.md');
      expect(prompt).not.toContain('source-tweet.md');
    },
    120_000
  );

  linuxIt(
    'rejects a replay packet captured for a different source URL',
    () => {
      const repo = makeRepo();
      const packetDir = preparePacket(repo);
      const manifestPath = path.join(packetDir, 'manifest.json');
      fs.chmodSync(manifestPath, 0o600);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.requestedUrl = 'https://other-site.test/posts/not-this-article';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const run = runTribunal(repo, { extraEnv: { TRIBUNAL_SOURCE_PACKET: packetDir } });
      expect(run.result.status, run.output).not.toBe(0);
      expect(run.judges, 'a mismatched packet must not reach a judge').toEqual([]);
      expect(run.fetches, 'a mismatch must not silently re-fetch').toEqual([]);
      expect(stageEntry(run)?.error).toBe('source_packet_replay_mismatch');
    },
    120_000
  );

  linuxIt(
    'fails as an operational error — with no live-fetch fallback — when the replay packet is invalid',
    () => {
      const repo = makeRepo();
      const packetDir = preparePacket(repo);
      const dataFile = path.join(packetDir, 'source-tweet.md');
      fs.chmodSync(dataFile, 0o600);
      fs.appendFileSync(dataFile, 'tampered after capture\n');

      const run = runTribunal(repo, { extraEnv: { TRIBUNAL_SOURCE_PACKET: packetDir } });
      expect(run.result.status, run.output).not.toBe(0);
      expect(run.judges, 'no judge may see an unverified packet').toEqual([]);
      expect(run.fetches, 'an invalid replay must not silently re-fetch').toEqual([]);
      expect(run.progress[POST_FILE]?.status, run.output).toBe('RUNNER_ERROR');
      expect(stageEntry(run)?.error).toBe('source_packet_replay_invalid');
    },
    120_000
  );
});

describe('posts outside GP/MP run FactChecker without a packet', () => {
  linuxIt(
    'scores an SD post with no capture and no packet section in the prompt',
    () => {
      const repo = makeRepo();
      const sdFile = 'sd-pending-20260928-logbook.mdx';
      const sdPost = GP_POST.replace('ticketId: "GP-PENDING"', 'ticketId: "SD-PENDING"');
      fs.writeFileSync(path.join(repo.root, 'src/content/posts', sdFile), sdPost);
      fs.writeFileSync(
        path.join(repo.root, 'src/content/posts', `en-${sdFile}`),
        fs
          .readFileSync(path.join(repo.root, 'src/content/posts', `en-${POST_FILE}`), 'utf8')
          .replace('ticketId: "GP-PENDING"', 'ticketId: "SD-PENDING"')
      );

      const run = runTribunal(repo, {
        postFile: sdFile,
        extraEnv: { FAKE_REQUIRE_PACKET: '', FAKE_FORBID_PACKET: '1' },
      });
      expect(run.result.status, run.output).toBe(0);
      expect(run.judges, run.output).toEqual(JUDGES);
      expect(run.fetches, 'SD has no focal source to capture').toEqual([]);
      expect(stageEntry(run, sdFile)?.sourceEvidence).toBeUndefined();
    },
    120_000
  );
});
