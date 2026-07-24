import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runJudgeAgentMock, runWriterAgentMock } = vi.hoisted(() => ({
  runJudgeAgentMock: vi.fn(),
  runWriterAgentMock: vi.fn(),
}));

vi.mock('../../src/lib/tribunal-v2/runners/claude-cli', () => ({
  runJudgeAgent: runJudgeAgentMock,
  runWriterAgent: runWriterAgentMock,
}));

import { stage3FactCorrectorRunner } from '../../src/lib/tribunal-v2/runners/stage-runners';
import type { FactCorrectorOutput } from '../../src/lib/tribunal-v2/types';

const output: FactCorrectorOutput = {
  changes_made: [
    {
      location: 'paragraph 2',
      before: '40%',
      after: '42%',
      reason: 'Matches the source.',
      source_verified: true,
    },
  ],
  flagged_but_not_changed: [],
  source_urls_fetched: ['https://example.com/source'],
  scope_violations_detected: [],
};

describe('Stage 3 FactCorrector runner contract', () => {
  beforeEach(() => {
    runJudgeAgentMock.mockReset();
    runWriterAgentMock.mockReset();
    runJudgeAgentMock.mockResolvedValue({
      parsed: output,
      raw: JSON.stringify(output),
      stdout: 'FACT CORRECTION COMPLETE',
      durationMs: 12,
    });
  });

  it('routes the article, source, creative-scope boundary, and output contract to the agent', async () => {
    const result = await stage3FactCorrectorRunner.run({
      articleContent: 'not passed inline because the agent reads the file',
      articlePath: '/repo/src/content/posts/gp-1-example.mdx',
      sourceUrl: 'https://example.com/source',
    });

    expect(result).toEqual(output);
    expect(runJudgeAgentMock).toHaveBeenCalledOnce();

    const options = runJudgeAgentMock.mock.calls[0][0] as {
      agent: string;
      timeoutSec: number;
      buildPrompt: (outputPath: string) => string;
    };
    expect(options.agent).toBe('fact-checker');
    expect(options.timeoutSec).toBe(600);

    const prompt = options.buildPrompt('/tmp/fact-corrector-output.json');
    expect(prompt).toContain('/repo/src/content/posts/gp-1-example.mdx');
    expect(prompt).toContain('https://example.com/source');
    expect(prompt).toContain('body + ShroomDogNote ONLY');
    expect(prompt).toContain('do NOT modify MoguNote content');
    expect(prompt).toContain('standing checklist');
    expect(prompt).toContain('source_urls_fetched');
    expect(prompt).toContain('/tmp/fact-corrector-output.json');
  });

  it('fails closed before invoking an agent when articlePath is absent', async () => {
    await expect(
      stage3FactCorrectorRunner.run({
        articleContent: 'body',
        sourceUrl: 'https://example.com/source',
      })
    ).rejects.toThrow('stage3FactCorrector: articlePath required');

    expect(runJudgeAgentMock).not.toHaveBeenCalled();
  });
});
