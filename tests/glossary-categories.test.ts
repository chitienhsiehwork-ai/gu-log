import { describe, expect, it } from 'vitest';
import glossaryData from '../src/data/glossary.json';
import {
  GLOSSARY_CATEGORY_LABELS,
  findUnlabeledGlossaryCategories,
  glossaryCategoryFilters,
  glossaryCategoryLabel,
} from '../src/config/glossary';

// openspec: glossary-browsing〈分類篩選 SHALL 從詞條資料產生並有雙語 label〉
describe('glossary categories', () => {
  it('labels every category the glossary data uses, in both languages', () => {
    expect(findUnlabeledGlossaryCategories(glossaryData)).toEqual([]);
    for (const labels of Object.values(GLOSSARY_CATEGORY_LABELS)) {
      expect(labels['zh-tw']).toMatch(/\S/);
      expect(labels.en).toMatch(/\S/);
    }
  });

  it('names a category the data uses without a label', () => {
    const entries = [{ category: 'concepts' }, { category: 'datasets' }, { category: 'datasets' }];

    expect(findUnlabeledGlossaryCategories(entries)).toEqual(['datasets']);
    expect(() => glossaryCategoryLabel('datasets', 'zh-tw')).toThrow('"datasets"');
  });

  it('builds filter buttons only for categories that have entries', () => {
    const entries = [{ category: 'people' }, { category: 'concepts' }, { category: 'people' }];

    expect(glossaryCategoryFilters(entries, 'zh-tw')).toEqual([
      { id: 'concepts', label: '概念' },
      { id: 'people', label: '人物' },
    ]);
    expect(glossaryCategoryFilters(entries, 'en')).toEqual([
      { id: 'concepts', label: 'Concepts' },
      { id: 'people', label: 'People' },
    ]);
  });

  it('gives every category in the current data a filter button with a label per language', () => {
    const used = new Set(glossaryData.map((entry) => entry.category));

    for (const lang of ['zh-tw', 'en'] as const) {
      const filters = glossaryCategoryFilters(glossaryData, lang);
      expect(new Set(filters.map((filter) => filter.id))).toEqual(used);
    }
    expect(glossaryCategoryFilters(glossaryData, 'zh-tw')).toEqual(
      expect.arrayContaining([
        { id: 'products', label: '產品' },
        { id: 'models', label: '模型' },
        { id: 'platforms', label: '平台' },
      ])
    );
  });
});
