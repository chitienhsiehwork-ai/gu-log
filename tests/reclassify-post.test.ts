/**
 * scripts/reclassify-post.mjs（openspec gp-signature-picks〈改系列 SHALL 只用一支指令，兩種語言一起搬〉
 * 〈改系列 SHALL 在動手前拒絕不合法的移動〉）：在暫存 git repo 跑真的 script。validate-posts 換成
 * 記錄參數的替身，`FAKE_VALIDATE_FAIL=1` 時讓它失敗。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { isLinkOnlyChange } from '../scripts/check-glossary-links.mjs';
import { createPostLinkValidator } from '../scripts/lib/post-link-validator.mjs';
import { meetsPublishBar } from '../src/utils/tribunal-scores';
import { buildRedirectConfig, deriveManifestCounts } from '../vercel.mjs';
import { scorecard } from './helpers/publish-bar-scorecard';
import { useTestTempDirectories } from './helpers/temp-directories';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'reclassify-post.mjs');
const POSTS = 'src/content/posts';
const makeTempDirectory = useTestTempDirectories();

const PASS = scorecard(9);
const FAIL = scorecard(6);
// 其他三位評審都是 9 分，只少 Fresh Eyes：分數不完整也不算過 publish bar。
const { freshEyes: _missing, ...MISSING_JUDGE } = PASS;

function post(data: Record<string, unknown>, body = '正文。\n') {
  return `---\n${YAML.stringify(data)}---\n\n${body}`;
}

const zhEn = (name: string, ticketId: string, title: string, extra = {}) => ({
  [name]: post({ ticketId, title, lang: 'zh-tw', ...extra }),
  [`en-${name}`]: post({ ticketId, title: `${title} EN`, lang: 'en', ...extra }),
});

const LINKER = 'mp-50-20260110-linker.mdx';
const LINKER_BODY = [
  '看 [MP-20: Beta](/posts/mp-20-20260102-beta/)，',
  '英文版是 [MP-20: Beta EN](/en/posts/en-mp-20-20260102-beta/)。',
  '',
].join('\n');

const POST_FILES: Record<string, string> = {
  ...zhEn('gp-10-20260101-alpha.mdx', 'GP-10', 'Alpha', { scores: FAIL }),
  ...zhEn('mp-20-20260102-beta.mdx', 'MP-20', 'Beta', { scores: PASS }),
  'mp-21-20260103-gamma.mdx': post({ ticketId: 'MP-21', title: 'Gamma', scores: FAIL }),
  'mp-22-20260104-delta.mdx': post({ ticketId: 'MP-22', title: 'Delta', scores: PASS }),
  'mp-23-20260108-epsilon.mdx': post({
    ticketId: 'MP-23',
    title: 'Epsilon',
    scores: MISSING_JUDGE,
  }),
  ...zhEn('gp-11-20260105-gone.mdx', 'GP-11', 'Gone', { status: 'taken-down' }),
  'mp-pending-20260106-draft.mdx': post({ ticketId: 'MP-PENDING', title: 'Draft' }),
  'sd-5-20260107-own.mdx': post({ ticketId: 'SD-5', title: 'Own' }),
  [LINKER]: post({ ticketId: 'MP-50', title: 'Linker', lang: 'zh-tw' }, LINKER_BODY),
  'mp-51-20260111-old.mdx': post({
    ticketId: 'MP-51',
    title: 'Old',
    status: 'deprecated',
    deprecatedBy: 'MP-20',
  }),
};

const ALIAS = {
  lang: 'zh-tw',
  oldTicketId: 'SP-5',
  newTicketId: 'MP-20',
  oldFilename: 'sp-5-20260102-beta.mdx',
  newFilename: 'mp-20-20260102-beta.mdx',
  oldSlug: 'sp-5-20260102-beta',
  newSlug: 'mp-20-20260102-beta',
};

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });

function makeRepo() {
  const repo = makeTempDirectory('gu-log-reclassify-');
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  for (const [name, content] of Object.entries(POST_FILES)) write(`${POSTS}/${name}`, content);
  write('src/pages/picks.astro', '<a href="/posts/mp-20-20260102-beta/">Beta</a>\n');
  const counter = { GP: { next: 30 }, MP: { next: 40 }, SD: { next: 6 }, Lv: { next: 1 } };
  write('scripts/article-counter.json', `${JSON.stringify(counter, null, 2)}\n`);
  const manifest = {
    schemaVersion: 1,
    counts: deriveManifestCounts([ALIAS]),
    entries: [ALIAS],
  };
  write('quality/brand-taxonomy-post-migration.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write(
    'scripts/validate-posts.mjs',
    [
      "import fs from 'node:fs';",
      "fs.writeFileSync('validate-args.json', JSON.stringify(process.argv.slice(2)));",
      "if (process.env.FAKE_VALIDATE_FAIL) { console.log('❌ fake validator rejected'); process.exit(1); }",
      '',
    ].join('\n')
  );
  write('.gitignore', 'validate-args.json\n');
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return repo;
}

function reclassify(repo: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

const read = (repo: string, file: string) => fs.readFileSync(path.join(repo, file), 'utf8');
const readJson = (repo: string, file: string) => JSON.parse(read(repo, file));
const ticketOf = (repo: string, name: string) =>
  YAML.parse(read(repo, `${POSTS}/${name}`).split('---')[1]).ticketId;
const status = (repo: string) => git(repo, ['status', '--porcelain', '--untracked-files=all']);

describe('reclassify-post.mjs moves a published post with all its languages', () => {
  it('fixture scorecards sit on the intended side of the publish bar', () => {
    expect(meetsPublishBar(PASS as never)).toBe(true);
    expect(meetsPublishBar(FAIL as never)).toBe(false);
    expect(meetsPublishBar(MISSING_JUDGE as never)).toBe(false);
  });

  it('turns a published GP back into an MP, even below the publish bar', () => {
    const repo = makeRepo();
    const run = reclassify(repo, ['GP-10', 'MP']);
    expect(run.status, run.output).toBe(0);

    for (const name of ['mp-40-20260101-alpha.mdx', 'en-mp-40-20260101-alpha.mdx']) {
      expect(ticketOf(repo, name)).toBe('MP-40');
    }
    expect(fs.existsSync(path.join(repo, POSTS, 'gp-10-20260101-alpha.mdx'))).toBe(false);
    expect(fs.existsSync(path.join(repo, POSTS, 'en-gp-10-20260101-alpha.mdx'))).toBe(false);
    expect(git(repo, ['diff', '--cached', '--name-status', '-M'])).toMatch(
      /^R\d+\tsrc\/content\/posts\/gp-10-20260101-alpha\.mdx\tsrc\/content\/posts\/mp-40-/m
    );

    const counter = readJson(repo, 'scripts/article-counter.json');
    expect(counter.MP.next).toBe(41);
    expect(counter.GP.next).toBe(30);

    const manifest = readJson(repo, 'quality/brand-taxonomy-post-migration.json');
    expect(manifest.entries.slice(1)).toEqual(
      ['zh-tw', 'en'].map((lang) => {
        const prefix = lang === 'en' ? 'en-' : '';
        return {
          lang,
          oldTicketId: 'GP-10',
          newTicketId: 'MP-40',
          oldFilename: `${prefix}gp-10-20260101-alpha.mdx`,
          newFilename: `${prefix}mp-40-20260101-alpha.mdx`,
          oldSlug: `${prefix}gp-10-20260101-alpha`,
          newSlug: `${prefix}mp-40-20260101-alpha`,
        };
      })
    );
    expect(manifest.counts).toEqual(deriveManifestCounts(manifest.entries));
    const validated = JSON.parse(read(repo, 'validate-args.json')) as string[];
    expect(validated.map((file) => path.basename(file))).toEqual([
      'mp-40-20260101-alpha.mdx',
      'en-mp-40-20260101-alpha.mdx',
    ]);
  });

  it('promotes an MP that clears the publish bar: 308 from the old URL, aliases and links follow', () => {
    const repo = makeRepo();
    const linkerBefore = read(repo, `${POSTS}/${LINKER}`);
    const run = reclassify(repo, ['MP-20', 'GP']);
    expect(run.status, run.output).toBe(0);

    expect(ticketOf(repo, 'gp-30-20260102-beta.mdx')).toBe('GP-30');
    expect(ticketOf(repo, 'en-gp-30-20260102-beta.mdx')).toBe('GP-30');
    const counter = readJson(repo, 'scripts/article-counter.json');
    expect([counter.GP.next, counter.MP.next]).toEqual([31, 40]);

    const manifest = readJson(repo, 'quality/brand-taxonomy-post-migration.json');
    expect(manifest.entries[0]).toMatchObject({
      oldSlug: 'sp-5-20260102-beta',
      newTicketId: 'GP-30',
      newSlug: 'gp-30-20260102-beta',
    });
    const { redirects } = buildRedirectConfig(manifest);
    for (const [source, destination] of [
      ['/posts/mp-20-20260102-beta{/}?', '/posts/gp-30-20260102-beta'],
      ['/en/posts/en-mp-20-20260102-beta{/}?', '/en/posts/en-gp-30-20260102-beta'],
      ['/posts/sp-5-20260102-beta{/}?', '/posts/gp-30-20260102-beta'],
    ]) {
      expect(redirects).toContainEqual({ source, destination, permanent: true });
    }

    const linkerAfter = read(repo, `${POSTS}/${LINKER}`);
    expect(linkerAfter).toContain('[GP-30: Beta](/posts/gp-30-20260102-beta/)');
    expect(linkerAfter).toContain('[GP-30: Beta EN](/en/posts/en-gp-30-20260102-beta/)');
    const listPosts = () => fs.readdirSync(path.join(repo, POSTS)).map((f) => `${POSTS}/${f}`);
    const validatePostLink = createPostLinkValidator({
      listPosts,
      readPost: (file: string) => read(repo, file),
    });
    expect(
      isLinkOnlyChange(linkerBefore, linkerAfter, {
        filePath: LINKER,
        glossary: [],
        validatePostLink,
      })
    ).toBe(true);
    expect(read(repo, `${POSTS}/mp-51-20260111-old.mdx`)).toContain('deprecatedBy: GP-30');
    expect(read(repo, 'src/pages/picks.astro')).toContain('href="/posts/gp-30-20260102-beta/"');
  });

  it('moves only the language file that exists', () => {
    const repo = makeRepo();
    const run = reclassify(repo, ['MP-22', 'GP']);
    expect(run.status, run.output).toBe(0);
    expect(ticketOf(repo, 'gp-30-20260104-delta.mdx')).toBe('GP-30');
    expect(fs.existsSync(path.join(repo, POSTS, 'en-gp-30-20260104-delta.mdx'))).toBe(false);
    const manifest = readJson(repo, 'quality/brand-taxonomy-post-migration.json');
    expect(manifest.entries.map((entry: { oldSlug: string }) => entry.oldSlug)).toEqual([
      'sp-5-20260102-beta',
      'mp-22-20260104-delta',
    ]);
  });

  it('exits non-zero with the validator output when validate-posts fails', () => {
    const repo = makeRepo();
    const run = reclassify(repo, ['GP-10', 'MP'], { FAKE_VALIDATE_FAIL: '1' });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('fake validator rejected');
  });
});

describe('reclassify-post.mjs refuses an illegal move before touching anything', () => {
  it.each([
    ['an MP below the publish bar into GP', ['MP-21', 'GP'], /publish bar/],
    ['an MP missing one judge score into GP', ['MP-23', 'GP'], /publish bar/],
    ['a taken-down GP', ['GP-11', 'MP'], /已下架/],
    ['an SD ticket', ['SD-5', 'GP'], /GP 或 MP/],
    ['an Lv ticket', ['Lv-1', 'MP'], /GP 或 MP/],
    ['MP-PENDING', ['MP-PENDING', 'GP'], /還沒上線/],
    ['GP-PENDING', ['GP-PENDING', 'MP'], /還沒上線/],
    ['a ticket with no post', ['MP-99', 'GP'], /找不到/],
    ['a post already in the target series', ['GP-10', 'GP'], /已經是 GP/],
    ['a target outside GP and MP', ['MP-20', 'SD'], /GP 或 MP/],
    // ticket 參數不會被當成 regex：特殊字元直接拒絕，GP-1 也不會撈到 gp-10、gp-11 的檔。
    ['a ticket argument with regex syntax', ['MP-(2|20)', 'GP'], /GP 或 MP/],
    ['a wildcard ticket argument', ['.*', 'MP'], /GP 或 MP/],
    ['GP-1 next to gp-10 and gp-11 files', ['GP-1', 'MP'], /找不到/],
  ])('%s', (_, args, message) => {
    const repo = makeRepo();
    const run = reclassify(repo, args);
    expect(run.status, run.output).not.toBe(0);
    expect(run.output).toMatch(message);
    expect(status(repo)).toBe('');
  });
});
