/**
 * 首頁 GP 區的挑法（openspec: gp-signature-picks〈首頁沒有能放的 GP〉〈首頁有能放的 GP〉）。
 * 真內容現在沒有過 publish bar 的 GP，e2e 只跑得到「不輸出」那一邊，所以用假文章直接驗
 * 兩頁共用的 selectHomeGpBlock。
 */
import { describe, expect, it } from 'vitest';

import { HOME_GP_LIMIT, selectHomeGpBlock } from '../src/lib/gp-listing.mjs';
import { meetsPublishBar } from '../src/utils/tribunal-scores';
import { scorecard } from './helpers/publish-bar-scorecard';

const post = (ticketId: string, score?: number) => ({
  id: ticketId.toLowerCase(),
  data: { ticketId, ...(score === undefined ? {} : { scores: scorecard(score) }) },
});
const select = (posts: ReturnType<typeof post>[]) => selectHomeGpBlock(posts, meetsPublishBar);
const tickets = (picks: ReturnType<typeof post>[]) => picks.map((p) => p.data.ticketId);

describe('selectHomeGpBlock', () => {
  it('outputs nothing when no GP can go on the homepage', () => {
    for (const posts of [
      [],
      [post('MP-5', 9), post('SD-2', 9)],
      [post('GP-1', 9)], // 示範文不是招牌
    ]) {
      expect(select(posts)).toEqual({ picks: [], showViewAll: false });
    }
  });

  it('keeps a GP below the publish bar or without scores off the homepage', () => {
    expect(select([post('GP-40', 6)])).toEqual({ picks: [], showViewAll: false });
    expect(select([post('GP-41')])).toEqual({ picks: [], showViewAll: false });
  });

  it('shows the newest picks up to the limit and links to the listing for the rest', () => {
    const { picks, showViewAll } = select([
      post('GP-9', 9),
      post('GP-30', 9),
      post('GP-12', 6),
      post('GP-10', 9),
      post('MP-99', 9),
      post('GP-21', 9),
    ]);
    expect(HOME_GP_LIMIT).toBe(3);
    expect(tickets(picks)).toEqual(['GP-30', 'GP-21', 'GP-10']);
    expect(showViewAll).toBe(true);
  });

  it('links to the listing when it lists a GP the homepage leaves out', () => {
    const { picks, showViewAll } = select([post('GP-30', 9), post('GP-31', 6)]);
    expect(tickets(picks)).toEqual(['GP-30']);
    expect(showViewAll).toBe(true);
    expect(select([post('GP-30', 9)]).showViewAll).toBe(false);
  });
});
