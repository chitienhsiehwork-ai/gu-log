/**
 * openspec editorial-charter〈自動化寫作 SHALL NOT 產生 ShroomDogNote〉：
 * ShroomDogNote 是 ShroomDog 本人的話。Tribunal 的 writer 與 FactCorrector
 * 不分系列都不能新增、刪掉或改寫它；前後的 ShroomDogNote 有任何不同，
 * pipeline 就把這次輸出當成違反 writer constraints 退回。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPipeline, type PipelineConfig } from '../../src/lib/tribunal-v2/pipeline';
import { checkShroomDogNotesPreserved } from '../../src/lib/tribunal-v2/writer-constraints';
import {
  FAILING_SCORES,
  MINIMAL_ARTICLE,
  PASSING_SCORES,
  emptyFactCorrector,
  factLibPass,
  mockGit,
  passThroughConfig,
  vibe,
} from './pipeline-fixtures';

const NOTE = '<ShroomDogNote>我自己也踩過這個坑。</ShroomDogNote>';
const ARTICLE = MINIMAL_ARTICLE.replace('## 結論', `${NOTE}\n\n## 結論`);
const ADDED = '<ShroomDogNote>這段是模型自己加的。</ShroomDogNote>';

describe('checkShroomDogNotesPreserved', () => {
  it('passes when only the body around the notes changes', () => {
    const after = ARTICLE.replace('Mogu 覺得結束了。', 'Mogu 覺得可以收尾了。');
    expect(checkShroomDogNotesPreserved(ARTICLE, after).pass).toBe(true);
  });

  const twoNotes = ARTICLE.replace(NOTE, `${ADDED}\n\n${NOTE}`);
  it.each([
    ['adds a note', ARTICLE, ARTICLE.replace('## 結論', `${ADDED}\n\n## 結論`)],
    ['removes a note', ARTICLE, ARTICLE.replace(NOTE, '')],
    ['edits a note', ARTICLE, ARTICLE.replace('踩過這個坑', '踩過不少坑')],
    ['reorders two notes', twoNotes, ARTICLE.replace(NOTE, `${NOTE}\n\n${ADDED}`)],
  ])('fails when the writer %s', (_, before, after) => {
    expect(checkShroomDogNotesPreserved(before, after).pass).toBe(false);
  });
});

describe('pipeline rejects a writer that touches a ShroomDogNote', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tribunal-v2-shroomdognote-'));
    articlePath = join(tmpDir, 'mp-999-test.mdx');
    await writeFile(articlePath, ARTICLE, 'utf-8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ['adds one', (raw: string) => raw.replace('## 結論', `${ADDED}\n\n## 結論`)],
    ['edits the existing one', (raw: string) => raw.replace('踩過這個坑', '踩過不少坑')],
  ])('Stage 3: a FactCorrector that %s is reverted before the judge reads', async (_, edit) => {
    const judgeContents: string[] = [];
    const git = mockGit();
    const config: PipelineConfig = {
      ...passThroughConfig(),
      git: git.adapter,
      runners: {
        ...passThroughConfig().runners,
        stage3FactCorrector: {
          run: async () => {
            await writeFile(articlePath, edit(await readFile(articlePath, 'utf-8')), 'utf-8');
            return emptyFactCorrector();
          },
        },
        stage3Judge: {
          run: async ({ articleContent }) => {
            judgeContents.push(articleContent);
            return factLibPass();
          },
        },
      },
    };

    const final = await runPipeline(articlePath, config);

    expect(final.stages.stage3.status).toBe('passed');
    expect(judgeContents[0]).toContain(NOTE);
    expect(judgeContents[0]).not.toContain(ADDED);
    expect(judgeContents[0]).not.toContain('踩過不少坑');
    expect(git.commits.some((m) => m.includes('FactCorrector rejected'))).toBe(true);
  });

  it('Stage 1: a writer that adds a ShroomDogNote is rejected and told why', async () => {
    const feedbacks: string[] = [];
    let judgeCalls = 0;
    const config: PipelineConfig = {
      ...passThroughConfig(),
      runners: {
        ...passThroughConfig().runners,
        stage1Judge: {
          run: async () => {
            judgeCalls++;
            return judgeCalls >= 3 ? vibe(true, PASSING_SCORES) : vibe(false, FAILING_SCORES);
          },
        },
        stage1Writer: {
          run: async ({ articleContent, feedback }) => {
            feedbacks.push(feedback);
            return {
              content:
                feedbacks.length === 1
                  ? articleContent.replace('## 結論', `${ADDED}\n\n## 結論`)
                  : articleContent.replace('Mogu 覺得結束了。', 'Mogu 覺得可以收尾了。'),
            };
          },
        },
      },
    };

    const final = await runPipeline(articlePath, config);

    expect(final.status).toBe('passed');
    expect(feedbacks[1]).toContain('ShroomDogNote');
    const content = await readFile(articlePath, 'utf-8');
    expect(content).not.toContain(ADDED);
    expect(content).toContain(NOTE);
  });
});
