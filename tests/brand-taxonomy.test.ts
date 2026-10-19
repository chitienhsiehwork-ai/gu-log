import { describe, expect, it } from 'vitest';
import { isExcluded, scanText } from '../scripts/check-brand-taxonomy.mjs';

const tokens = (text: string) => scanText(text).map((hit: { token: string }) => hit.token);

describe('brand taxonomy check', () => {
  it('擋已退役的元件、persona、ticket、slug 與路由', () => {
    expect(tokens('<ClawdNote>Clawd 說</ClawdNote>')).toEqual(['ClawdNote', 'ClawdNote', 'Clawd']);
    expect(tokens('ticketId: "SP-12"\n見 CP-PENDING')).toEqual(['SP-12', 'CP-PENDING']);
    expect(tokens('[x](/posts/sp-12-foo) /clawd-picks sp-pipeline')).toEqual([
      'sp-12',
      'clawd-picks',
      'sp-pipeline',
    ]);
  });

  it('不誤擋現行名稱與無關縮寫', () => {
    expect(tokens('<MoguNote> GP-12 mp-3-foo gp-pipeline Clawd.rip SP500 cp -r')).toEqual([]);
  });

  it('只排除歷史與刻意保留舊名的檔案', () => {
    expect(isExcluded('openspec/changes/archive/x/design.md')).toBe(true);
    expect(isExcluded('tools/gp-pipeline/internal/x_test.go')).toBe(true);
    expect(isExcluded('src/content/posts/gp-1-foo.mdx')).toBe(false);
  });
});
