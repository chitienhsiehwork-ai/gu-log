import type { SearchEntry } from '../../src/config/fuse-options';

const shared = {
  date: '2026-07-23',
  source: 'Golden Fixture',
  sourceUrl: '',
};

export const zhSearchRankingFixture: SearchEntry[] = [
  {
    ...shared,
    slug: 'golden-title-zh',
    ticketId: 'GP-901',
    title: '蘭花',
    summary: '從零開始整理上線步驟。',
    tags: ['部署'],
    lang: 'zh-tw',
  },
  {
    ...shared,
    slug: 'golden-tag-zh',
    ticketId: 'GP-902',
    title: '植物',
    summary: '整理一份穩定的上線流程。',
    tags: ['蘭花'],
    lang: 'zh-tw',
  },
  {
    ...shared,
    slug: 'golden-summary-zh',
    ticketId: 'GP-903',
    title: '植物照護指南',
    summary: '蘭花',
    tags: ['園藝'],
    lang: 'zh-tw',
  },
];

export const enSearchRankingFixture: SearchEntry[] = [
  {
    ...shared,
    slug: 'golden-title-en',
    ticketId: 'GP-901',
    title: 'Orchid',
    summary: 'A practical release walkthrough.',
    tags: ['deployment'],
    lang: 'en',
  },
  {
    ...shared,
    slug: 'golden-tag-en',
    ticketId: 'GP-902',
    title: 'Plant',
    summary: 'A stable release workflow.',
    tags: ['orchid'],
    lang: 'en',
  },
  {
    ...shared,
    slug: 'golden-summary-en',
    ticketId: 'GP-903',
    title: 'Plant care guide',
    summary: 'Orchid',
    tags: ['gardening'],
    lang: 'en',
  },
];

export const searchRankingGoldenCases = [
  {
    name: 'zh-tw title > tag > summary',
    query: '蘭花',
    entries: zhSearchRankingFixture,
    tickets: ['GP-901', 'GP-902', 'GP-903'],
  },
  {
    name: 'en title > tag > summary',
    query: 'orchid',
    entries: enSearchRankingFixture,
    tickets: ['GP-901', 'GP-902', 'GP-903'],
  },
] as const;
