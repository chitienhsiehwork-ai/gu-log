import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POSTS_DIR, loadPosts, postInfo, suggestFor } from '../scripts/suggest-crosslinks.mjs';
import { segmentGuide } from '../scripts/lib/source-distance.mjs';

// gp-pipeline 對 GP 在工作目錄的 final.mdx 跑 post-fixer，再蓋來源距離章（openspec
// gp-pipeline-publish-integrity）。這兩支 fixer 要能改 posts/ 以外的檔，語料照舊從
// posts/ 讀；MP 對 posts/ 內檔案的呼叫方式與結果不變。

const ROOT = path.resolve(__dirname, '..');
const run = (script: string, args: string[]) =>
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

// fixer 寫錯地方時會在 posts/ 生出同檔名的新檔，所以比對檔名清單。不比 mtime 或內容：
// 其他測試（例如 tribunal 的 shell 測試）會暫時改寫 posts/ 裡的真文章再還原，平行跑時
// 會讓整個語料的快照對不上。
function postsSnapshot() {
  return fs.readdirSync(POSTS_DIR).sort().join('\n');
}

const posts = loadPosts();
// 語料裡最常見的標籤，讓工作目錄的草稿一定挑得到相關文章。
const commonTag = (() => {
  const counts = new Map<string, number>();
  for (const p of posts) {
    if (p.lang !== 'zh-tw') continue;
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
})();

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-fixers-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function draft(frontmatter: string, body: string) {
  const file = path.join(dir, 'final.mdx');
  fs.writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}\n`);
  return file;
}

describe('add-kaomoji.mjs on a file outside posts/', () => {
  it('writes the kaomoji into that file and leaves posts/ alone', () => {
    const file = draft(
      'ticketId: "GP-PENDING"\ntitle: "導讀"\nlang: "zh-tw"',
      '這是一段足夠長的導讀正文，最後一句話在這裡結束。'
    );
    const before = postsSnapshot();
    run('add-kaomoji.mjs', ['--write', file]);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toMatch(/最後一句話在這裡結束。 \S+\n$/);
    expect(postsSnapshot()).toBe(before);
  });
});

describe('inject-related-posts.mjs on a file outside posts/', () => {
  it('picks related posts from the posts/ corpus and edits only that file', () => {
    const file = draft(
      `ticketId: "GP-PENDING"\ntitle: "工作目錄裡的導讀"\nlang: "zh-tw"\ntags: ["${commonTag}"]`,
      '導讀正文沒有任何站內連結。'
    );
    const before = postsSnapshot();
    run('inject-related-posts.mjs', ['--file', file]);
    const content = fs.readFileSync(file, 'utf8');
    const expected = suggestFor(postInfo('final.mdx', content)!, posts);
    expect(expected.length).toBeGreaterThan(0);
    expect(content).toContain('## 延伸閱讀');
    for (const link of expected) {
      expect(content).toContain(`](/posts/${link.slug}/)`);
      expect(fs.existsSync(path.join(POSTS_DIR, `${link.slug}.mdx`))).toBe(true);
    }
    expect(postsSnapshot()).toBe(before);

    // 已經有站內連結就不再插第二次；dry-run 不寫檔。
    run('inject-related-posts.mjs', ['--file', file]);
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
    const fresh = draft(
      `ticketId: "GP-PENDING"\ntitle: "另一篇導讀"\nlang: "zh-tw"\ntags: ["${commonTag}"]`,
      '正文。'
    );
    const untouched = fs.readFileSync(fresh, 'utf8');
    expect(run('inject-related-posts.mjs', ['--file', fresh, '--dry-run'])).toContain(
      '## 延伸閱讀'
    );
    expect(fs.readFileSync(fresh, 'utf8')).toBe(untouched);
  });

  it('插入的延伸閱讀整段不進來源距離章的投影（openspec source-distance-stamp）', () => {
    for (const [lang, heading] of [
      ['zh-tw', '## 延伸閱讀'],
      ['en', '## Related Reading'],
    ]) {
      const file = draft(
        `ticketId: "GP-PENDING"\ntitle: "導讀"\nlang: "${lang}"\ntags: ["${commonTag}"]`,
        '導讀正文第一句。\n\n<MoguNote>\nMogu 的吐槽。\n</MoguNote>'
      );
      const before = segmentGuide(fs.readFileSync(file, 'utf8'));
      run('inject-related-posts.mjs', ['--file', file]);
      const after = fs.readFileSync(file, 'utf8');
      expect(after).toContain(heading);
      expect(segmentGuide(after)).toEqual(before);
    }
  });

  it('never suggests the allocated post the draft will replace', () => {
    const self = posts.find((p) => p.lang === 'zh-tw' && p.ticketId && p.tags.includes(commonTag))!;
    const file = draft(
      `ticketId: "${self.ticketId}"\ntitle: "${self.title.replace(/"/g, '')}"\nlang: "zh-tw"\ntags: ["${commonTag}"]`,
      '正文。'
    );
    const links = suggestFor(postInfo('final.mdx', fs.readFileSync(file, 'utf8'))!, posts);
    expect(links.map((l: { ticketId: string | null }) => l.ticketId)).not.toContain(self.ticketId);
  });
});

describe('suggest-crosslinks.mjs 的候選語料', () => {
  it('不把已下架的墓碑當成延伸閱讀候選（openspec post-takedown）', () => {
    const corpus = path.join(dir, 'posts');
    fs.mkdirSync(corpus);
    fs.writeFileSync(
      path.join(corpus, 'gp-1-20260101-live.mdx'),
      '---\nticketId: "GP-1"\ntitle: "還在的文章"\nlang: "zh-tw"\ntags: ["ui"]\n---\n\n正文。\n'
    );
    fs.writeFileSync(
      path.join(corpus, 'gp-2-20260101-gone.mdx'),
      '---\nticketId: "GP-2"\ntitle: "下架的文章"\nlang: "zh-tw"\nstatus: "taken-down"\ntags: ["ui"]\n---\n'
    );
    expect(loadPosts(corpus).map((p: { ticketId: string | null }) => p.ticketId)).toEqual([
      'GP-1',
    ]);
  });
});

describe('inject-related-posts.mjs on a file inside posts/ (the MP call)', () => {
  it('still uses the corpus-wide suggestions for that post', () => {
    const eligible = posts.find((p) => {
      if (p.lang !== 'zh-tw') return false;
      const body = fs.readFileSync(path.join(POSTS_DIR, p.file), 'utf8');
      return (
        !/\]\(\/posts\/|gu-log\.vercel\.app\/posts\//.test(body) && suggestFor(p, posts).length
      );
    });
    if (!eligible) return; // 語料裡每篇都已經有站內連結時沒有東西可驗
    const before = postsSnapshot();
    const out = run('inject-related-posts.mjs', [
      '--file',
      path.join('src/content/posts', eligible.file),
      '--dry-run',
    ]);
    expect(out).toContain(`DRY RUN: ${eligible.file}`);
    for (const link of suggestFor(eligible, posts)) {
      expect(out).toContain(`](/posts/${link.slug}/)`);
    }
    expect(postsSnapshot()).toBe(before);
  }, 60_000); // 沒給 --input 時要先替整個語料算一次建議
});
