import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const SCRIPT = path.resolve(__dirname, '../scripts/list-content-gate-posts.mjs');
const CI_WORKFLOW = path.resolve(__dirname, '../.github/workflows/ci.yml');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function post(ticketId: string, marker: string, extra = ''): string {
  const body = Array.from(
    { length: 24 },
    (_, index) => `${marker} stable migration evidence line ${index}`
  ).join('\n');
  return `---\nticketId: "${ticketId}"\n---\n\n${body}\n${extra}`;
}

function postWithStatus(ticketId: string, marker: string, status: string, extra = ''): string {
  return post(ticketId, marker, extra).replace('\n---\n\n', `\nstatus: ${status}\n---\n\n`);
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-content-gate-'));
  fs.mkdirSync(path.join(repo, 'src', 'content', 'posts'), { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  return repo;
}

function writeGlossary(repo: string, terms: string[]): void {
  fs.mkdirSync(path.join(repo, 'src', 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'src', 'data', 'glossary.json'),
    `${JSON.stringify(
      terms.map((term) => ({ term, en: term, category: 'concepts' })),
      null,
      2
    )}\n`
  );
}

function runGate(repo: string, baseRef = 'base'): string[] {
  const output = execFileSync('node', [SCRIPT, `--base=${baseRef}`], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  return output ? output.split('\n') : [];
}

describe('list-content-gate-posts fail-closed base contract', () => {
  it('rejects an unresolvable base ref instead of returning an empty success', () => {
    const repo = makeRepo();

    try {
      const file = path.join(repo, 'src', 'content', 'posts', 'gp-1-new.mdx');
      fs.writeFileSync(file, post('GP-1', 'new-post'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed head']);

      const result = spawnSync('node', [SCRIPT, '--base=definitely-missing'], {
        cwd: repo,
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(
        '[list-content-gate-posts] Unable to resolve base ref "definitely-missing"'
      );
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('binds the CI selector and grandfather baseline to the immutable PR base SHA', () => {
    const workflow = parse(fs.readFileSync(CI_WORKFLOW, 'utf8'));
    const step = workflow.jobs['validate-content'].steps.find(({ name }: { name?: string }) =>
      name?.startsWith('Content gates')
    );

    expect(step.if).toBe("github.event_name == 'pull_request'");
    expect(step.env.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
    expect(step.run).not.toContain('|| true');
    expect(step.run).toContain('git fetch --no-tags origin "$BASE_SHA"');
    expect(step.run).toContain('git cat-file -e "$BASE_SHA^{commit}"');
    expect(step.run).toContain('node scripts/list-content-gate-posts.mjs "--base=$BASE_SHA"');
    expect(step.run).toContain(
      'node scripts/check-jingjing.mjs "--baseline-ref=$BASE_SHA" $CHANGED_MDX'
    );
  });

  it('still gates a unique new post when git grep returns no match', () => {
    const repo = makeRepo();

    try {
      const postsDir = path.join(repo, 'src', 'content', 'posts');
      fs.writeFileSync(path.join(postsDir, 'gp-1-existing.mdx'), post('GP-1', 'existing-post'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed baseline']);
      git(repo, ['branch', 'base']);

      const newFile = 'src/content/posts/gp-2-new.mdx';
      fs.writeFileSync(path.join(repo, newFile), post('GP-2', 'new-post'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'add unique post']);

      expect(runGate(repo)).toEqual([newFile]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('skips a post that became a taken-down tombstone (openspec: post-takedown)', () => {
    const repo = makeRepo();

    try {
      const takenDown = 'src/content/posts/gp-3-taken-down.mdx';
      const edited = 'src/content/posts/mp-4-edited.mdx';
      fs.writeFileSync(path.join(repo, takenDown), post('GP-3', 'translated-body'));
      fs.writeFileSync(path.join(repo, edited), post('MP-4', 'mogu-body'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed baseline']);
      git(repo, ['branch', 'base']);

      fs.writeFileSync(
        path.join(repo, takenDown),
        '---\nticketId: "GP-3"\nstatus: "taken-down"\ntakenDownAt: "2026-09-27"\n---\n'
      );
      fs.writeFileSync(path.join(repo, edited), post('MP-4', 'rewritten-mogu-body'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'take down GP-3 and edit MP-4']);

      expect(runGate(repo)).toEqual([edited]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still gates reader prose whose lines start with a metadata key', () => {
    const repo = makeRepo();

    try {
      const file = 'src/content/posts/gp-1-metadata-like-prose.mdx';
      fs.writeFileSync(
        path.join(repo, file),
        post('GP-1', 'stable-post', 'status: 這是讀者看得到的舊段落\n')
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed baseline']);
      git(repo, ['branch', 'base']);

      fs.writeFileSync(
        path.join(repo, file),
        post('GP-1', 'stable-post', 'status: Scalable workflow for every reader\n')
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'edit metadata-like reader prose']);

      expect(runGate(repo)).toEqual([file]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('exempts an originalDate-only correction', () => {
    const repo = makeRepo();

    try {
      const file = 'src/content/posts/mp-1-original-date.mdx';
      const withDate = (date: string) =>
        post('MP-1', 'stable-post').replace('\n---\n\n', `\noriginalDate: "${date}"\n---\n\n`);
      fs.writeFileSync(path.join(repo, file), withDate('2026-02-20'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed baseline']);
      git(repo, ['branch', 'base']);

      fs.writeFileSync(path.join(repo, file), withDate('2025-06-18'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'fix originalDate']);

      expect(runGate(repo)).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still exempts an allowed frontmatter change when body contains a metadata-like line', () => {
    const repo = makeRepo();

    try {
      const file = 'src/content/posts/gp-1-frontmatter-status.mdx';
      fs.writeFileSync(
        path.join(repo, file),
        postWithStatus('GP-1', 'stable-post', 'active', 'status: reader prose stays unchanged\n')
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed baseline']);
      git(repo, ['branch', 'base']);

      fs.writeFileSync(
        path.join(repo, file),
        postWithStatus(
          'GP-1',
          'stable-post',
          'deprecated',
          'status: reader prose stays unchanged\n'
        )
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'deprecate post']);

      expect(runGate(repo)).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still gates a nested frontmatter key that happens to use an exempt name', () => {
    const repo = makeRepo();

    try {
      const file = 'src/content/posts/gp-1-nested-status.mdx';
      // 掛在讀者看得到的 author 底下；後台欄位底下的變動另由 reader revision 豁免。
      const withNestedStatus = (status: string) =>
        post('GP-1', 'stable-post').replace('\n---\n\n', `\nauthor:\n  status: ${status}\n---\n\n`);
      fs.writeFileSync(path.join(repo, file), withNestedStatus('old'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed baseline']);
      git(repo, ['branch', 'base']);

      fs.writeFileSync(path.join(repo, file), withNestedStatus('new'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'edit nested status metadata']);

      expect(runGate(repo)).toEqual([file]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('list-content-gate-posts reader-revision exemption', () => {
  // 跟 pre-commit 的 reader_visible_changed 一樣：只動後台 frontmatter（scores、
  // pipeline…）的 PR 不重查舊文正文，score floor、代名詞、AI-tells 都不會跑。
  const SCORES = 'scores:\n  vibe:\n    composite: 8\n';

  function runEdit(before: string, after: string): string[] {
    const repo = makeRepo();

    try {
      const file = 'src/content/posts/mp-5-legacy.mdx';
      fs.writeFileSync(path.join(repo, file), before);
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed legacy post']);
      git(repo, ['branch', 'base']);

      fs.writeFileSync(path.join(repo, file), after);
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'edit legacy post']);
      return runGate(repo).map((listed) => listed.replace(file, 'FILE'));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  const withFrontmatter = (extra: string, marker = 'legacy') =>
    post('MP-5', marker).replace('\n---\n\n', `\n${extra}---\n\n`);

  it('skips a Tribunal publisher PR that only writes back scores', () => {
    expect(runEdit(post('MP-5', 'legacy'), withFrontmatter(SCORES))).toEqual([]);
  });

  it('skips a PR that only moves backend frontmatter', () => {
    const before = withFrontmatter('pipeline:\n  - role: writer\n');
    const after = withFrontmatter('translatedBy:\n  pipeline:\n    - role: writer\n');
    expect(runEdit(before, after)).toEqual([]);
  });

  it('still gates a scores write-back that also edits reader-visible content', () => {
    expect(runEdit(post('MP-5', 'legacy'), withFrontmatter(SCORES, 'rewritten'))).toEqual(['FILE']);
    expect(runEdit(post('MP-5', 'legacy'), withFrontmatter(`title: "新標題"\n${SCORES}`))).toEqual([
      'FILE',
    ]);
  });
});

describe('CI Content gates step', () => {
  // 把 ci.yml 的 run 原樣搬到假 PR repo 實跑，只把 node scripts/ 指回這個 repo。
  const STEP_RUN: string = parse(fs.readFileSync(CI_WORKFLOW, 'utf8')).jobs[
    'validate-content'
  ].steps.find(({ name }: { name?: string }) => name?.startsWith('Content gates')).run;
  const zhPost = (ticketId: string, extra = '') =>
    `---\nticketId: "${ticketId}"\n${extra}---\n\n${Array.from(
      { length: 12 },
      (_, i) => `第 ${i} 段正文，講部署流程。`
    ).join('\n\n')}\n`;

  function runStep(seed: Record<string, string>, change: Record<string, string>) {
    const repo = makeRepo();
    const commit = (files: Record<string, string>, message: string) => {
      for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(repo, 'src', 'content', 'posts', name), text);
      }
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', message]);
    };

    try {
      writeGlossary(repo, []);
      commit(seed, 'seed base');
      git(repo, ['branch', 'base']);
      commit(change, 'pr change');
      git(repo, ['remote', 'add', 'origin', repo]);
      const run = STEP_RUN.replaceAll('node scripts/', `node ${path.dirname(SCRIPT)}/`);
      return spawnSync('bash', ['-c', run], {
        cwd: repo,
        env: { ...process.env, BASE_SHA: git(repo, ['rev-parse', 'base']) },
        encoding: 'utf8',
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  it('passes a Tribunal publisher PR that only writes back scores', () => {
    const scores = 'scores:\n  vibe:\n    composite: 8\n';
    const r = runStep(
      { 'mp-5-legacy.mdx': zhPost('MP-5') },
      { 'mp-5-legacy.mdx': zhPost('MP-5', scores) }
    );

    expect(r.stdout).toContain('skipping content gates');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('fails an unscored numbered post, skips PENDING drafts, and still runs every gate', () => {
    const r = runStep(
      {},
      {
        'sd-7-new.mdx': `${zhPost('SD-7')}\n這套流程被他拆過一遍。\n`,
        'sd-pending-draft.mdx': zhPost('SD-PENDING'),
      }
    );

    expect(r.stdout).toContain(
      '::error file=src/content/posts/sd-7-new.mdx::score floor: missing scores.vibe'
    );
    expect(r.stdout).not.toContain('sd-pending-draft.mdx::score floor');
    // floor 先失敗，排在最後的 AI-tells 照樣要跑完，結果一起回報。
    expect(r.stdout).toContain('AI-tells check failed');
    expect(r.status, r.stdout + r.stderr).toBe(1);
  });
});

describe('list-content-gate-posts link-only proof', () => {
  // 只驗 CI 的接線（glossary 與站內文章目標都讀 head），證明本身的案例在
  // tests/link-only-proof.test.ts。
  const TARGET_FILE = 'src/content/posts/mp-316-target.mdx';
  const TARGET_LINK = '[MP-316: 目標文章](/posts/mp-316-target/)';

  function seedLegacyPost(repo: string, terms: string[], extra: string): string {
    const file = 'src/content/posts/mp-4-legacy.mdx';
    writeGlossary(repo, terms);
    fs.writeFileSync(
      path.join(repo, TARGET_FILE),
      '---\nticketId: "MP-316"\ntitle: "目標文章"\nlang: "zh-tw"\n---\n\n目標\n'
    );
    fs.writeFileSync(path.join(repo, file), post('MP-4', 'legacy', extra));
    git(repo, ['add', '.']);
    git(repo, ['commit', '-qm', 'seed legacy post without scores']);
    git(repo, ['branch', 'base']);
    return file;
  }

  it('exempts a legacy post that only gains a link to an entry added in the same PR', () => {
    const repo = makeRepo();

    try {
      const file = seedLegacyPost(repo, ['Mogu'], 'Kubernetes keeps state\n');
      writeGlossary(repo, ['Mogu', 'Kubernetes']);
      fs.writeFileSync(
        path.join(repo, file),
        post('MP-4', 'legacy', '[Kubernetes](/glossary#kubernetes) keeps state\n')
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'add Kubernetes and backfill links']);

      expect(runGate(repo)).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('exempts a corrected glossary anchor beside a retargeted internal post link', () => {
    const repo = makeRepo();

    try {
      const file = seedLegacyPost(
        repo,
        ['Kubernetes'],
        '[Kubernetes](/glossary#Kubernetes) keeps state\n延伸閱讀：[GP-53: 舊標題](/posts/gp-53-old/)\n'
      );
      fs.writeFileSync(
        path.join(repo, file),
        post(
          'MP-4',
          'legacy',
          `[Kubernetes](/glossary#kubernetes) keeps state\n延伸閱讀：${TARGET_LINK}\n`
        )
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'fix links']);

      expect(runGate(repo)).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still gates a wrong glossary anchor even when the internal post link is valid', () => {
    const repo = makeRepo();

    try {
      const file = seedLegacyPost(
        repo,
        ['Kubernetes'],
        'Kubernetes keeps state\n延伸閱讀：[GP-53: 舊標題](/posts/gp-53-old/)\n'
      );
      fs.writeFileSync(
        path.join(repo, file),
        post(
          'MP-4',
          'legacy',
          `[Kubernetes](/glossary#kube) keeps state\n延伸閱讀：${TARGET_LINK}\n`
        )
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'link the wrong anchor']);

      expect(runGate(repo)).toEqual([file]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
