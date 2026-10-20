import { describe, expect, it } from 'vitest';
import { getAboutProfile, type AboutProfileData } from '../src/lib/about-profile';

const base: AboutProfileData = {
  name: { 'zh-tw': '香菇大狗狗', en: 'ShroomDog' },
  role: { 'zh-tw': '站長', en: 'Runs gu-log' },
  bio: { 'zh-tw': '', en: '' },
  links: {
    github: 'https://github.com/example',
    repo: 'https://github.com/example/repo',
    linkedin: '',
    x: '',
    email: '',
  },
};

describe('getAboutProfile', () => {
  it('空欄位不顯示', () => {
    const p = getAboutProfile('en', base);
    expect(p.bio).toBe('');
    expect(p.links.map((l) => l.key)).toEqual(['github', 'repo']);
  });

  it('填了才顯示，email 轉成 mailto', () => {
    const p = getAboutProfile('zh-tw', {
      ...base,
      bio: { 'zh-tw': '寫程式的人', en: 'A builder' },
      links: { ...base.links, linkedin: 'https://linkedin.com/in/x', email: 'me@example.com' },
    });
    expect(p.bio).toBe('寫程式的人');
    expect(p.links.map((l) => l.key)).toEqual(['github', 'repo', 'linkedin', 'email']);
    expect(p.links.at(-1)?.href).toBe('mailto:me@example.com');
  });

  it('正式資料：中英共用同一組連結，只連 GitHub', () => {
    const zh = getAboutProfile('zh-tw');
    const en = getAboutProfile('en');
    expect(zh.links.map((l) => l.href)).toEqual(en.links.map((l) => l.href));
    for (const link of zh.links) expect(link.href).toMatch(/^https:\/\/github\.com\//);
  });
});
