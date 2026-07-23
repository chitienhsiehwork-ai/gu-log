import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  applyResidualPolicy,
  canonicalizeSeriesTaxonomyText,
  isResidualScopeExcluded,
  isCanonicalSeriesTaxonomyOnlyChange,
  scanCanonicalReferences,
  scanLegacyPath,
  scanLegacyText,
  validatePolicy,
} from '../scripts/check-brand-taxonomy.mjs';

type ResidualPolicy = Parameters<typeof applyResidualPolicy>[1];
const REPO_ROOT = path.resolve(__dirname, '..');

function yamlJobBlock(yaml: string, job: string): string {
  const marker = `\n  ${job}:\n`;
  const start = yaml.indexOf(marker);
  if (start < 0) throw new Error(`missing CI job: ${job}`);

  const bodyStart = start + marker.length;
  const nextJobOffset = yaml.slice(bodyStart).search(/\n {2}[a-z0-9-]+:\n/);
  const end = nextJobOffset < 0 ? yaml.length : bodyStart + nextJobOffset;
  return yaml.slice(start, end);
}

const policy = (overrides: Partial<ResidualPolicy> = {}): ResidualPolicy => ({
  schemaVersion: 1,
  immutableHistoryExcludes: ['sources/**', 'openspec/changes/archive/**'],
  generatedArtifactExcludes: ['quality/generated.json'],
  exactExceptions: [],
  ...overrides,
});

const repositoryState = (trackedPaths: string[], existingPaths = trackedPaths) => ({
  trackedFiles: new Set(trackedPaths),
  pathExists: (file: string) => existingPaths.includes(file),
});

describe('brand taxonomy residual gate', () => {
  it('keeps the writer frontmatter example canonical', () => {
    const writerPrompt = fs.readFileSync(path.join(REPO_ROOT, 'GU-LOG_WRITER_PROMPT.md'), 'utf8');
    const frontmatterExample = writerPrompt.match(/```yaml\n([\s\S]*?)\n```/)?.[1];
    const parseTags = (frontmatter: string) => {
      const document = frontmatter.replace(/^---\n/, '').replace(/\n---$/, '');
      return parseYaml(document).tags;
    };
    const canonicalizeTagValues = (tags: string[]) => {
      const probe = `tags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`;
      return parseYaml(canonicalizeSeriesTaxonomyText(probe)).tags ?? [];
    };

    expect(frontmatterExample).toBeDefined();
    const originalTags = parseTags(frontmatterExample!);
    expect(Array.isArray(originalTags)).toBe(true);
    expect(originalTags.length).toBeGreaterThan(0);
    expect(canonicalizeTagValues(originalTags)).toEqual(originalTags);
  });

  it('is wired into the required CI path and both tracked pre-push mirrors', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const ci = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const validateContent = yamlJobBlock(ci, 'validate-content');
    const aggregateGate = yamlJobBlock(ci, 'ci-passed');
    const sourceHook = fs.readFileSync(path.join(REPO_ROOT, 'scripts/hooks/pre-push'), 'utf8');
    const mirrorHook = fs.readFileSync(path.join(REPO_ROOT, '.githooks/pre-push'), 'utf8');

    expect(packageJson.scripts['taxonomy:check']).toBe(
      'node scripts/check-brand-taxonomy.mjs --check'
    );
    expect(validateContent).toContain('run: pnpm run taxonomy:check');
    expect(aggregateGate).toContain('      - validate-content');
    expect(sourceHook).toContain('pnpm run taxonomy:check');
    expect(mirrorHook).toBe(sourceHook);
  });

  it('accepts only one-way semantic series canonicalization', () => {
    const oldUpper = ['S', 'P'].join('');
    const oldLower = ['s', 'p'].join('');
    const oldCompanion = ['C', 'P'].join('');
    const before = [
      `ticketId: "${oldUpper}-63"`,
      `template: "${oldUpper}-XXX" / "${oldCompanion}-XX"`,
      `一般 ${oldUpper} 放上來`,
      `final ${oldUpper} takeaway`,
      `run /tmp/worktree-${oldLower}-151`,
      `service provider (${oldUpper})`,
    ].join('\n');
    const after = [
      'ticketId: "GP-63"',
      'template: "GP-XXX" / "MP-XX"',
      '一般 GP 放上來',
      'final GP takeaway',
      'run /tmp/worktree-gp-151',
      `service provider (${oldUpper})`,
    ].join('\n');

    expect(canonicalizeSeriesTaxonomyText(before)).toBe(after);
    expect(isCanonicalSeriesTaxonomyOnlyChange(before, after)).toBe(true);
    expect(isCanonicalSeriesTaxonomyOnlyChange(before, `${after}\nextra prose`)).toBe(false);
  });

  it('canonicalizes the full one-shot rebrand contract (component/schema/pipeline/persona/tags), but still gates a neighboring prose edit', () => {
    const before = [
      '---',
      'ticketId: "CP-9"',
      '  pipelineUrl: "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/ralph-loop.sh"',
      '    clawdNote: 9',
      "tags: ['clawd-picks', 'ai-agents', 'workflow']",
      '---',
      '',
      "import ClawdNote from '../../components/ClawdNote.astro';",
      '',
      '<ClawdNote>',
      '我是 Clawd，這是 Clawd Picks 系列的第一篇。',
      '</ClawdNote>',
    ].join('\n');
    const after = [
      '---',
      'ticketId: "MP-9"',
      '  pipelineUrl: "https://github.com/chitienhsiehwork-ai/gu-log/tree/main/tools/gp-pipeline"',
      '    moguNote: 9',
      'tags: ["ai-agents","workflow"]',
      '---',
      '',
      "import MoguNote from '../../components/MoguNote.astro';",
      '',
      '<MoguNote>',
      '我是 Mogu，這是 Mogu Picks 系列的第一篇。',
      '</MoguNote>',
    ].join('\n');

    expect(canonicalizeSeriesTaxonomyText(before)).toBe(after);
    expect(isCanonicalSeriesTaxonomyOnlyChange(before, after)).toBe(true);

    const afterWithProseEdit = after.replace(
      '我是 Mogu，這是 Mogu Picks 系列的第一篇。',
      '我是 [Mogu](/glossary#mogu)，這是 Mogu Picks 系列的第一篇——現在加上一句全新的讀者感想。'
    );
    expect(isCanonicalSeriesTaxonomyOnlyChange(before, afterWithProseEdit)).toBe(false);
  });

  it('finds semantic legacy contracts including compact tokens away from a prefix', () => {
    const findings = scanLegacyText(
      'src/example.ts',
      [
        'ticketId: "SP-63"',
        'const related = "CP-12";',
        'const brief = "things-SP63-notes";',
        'const asset = "/images/foo-sp57-card.png";',
        'const command = "tools/sp-pipeline/sp-pipeline";',
        'const ticketPrefixes = ["SP", "CP", "SD", "Lv"] as const;',
        'run --prefix SP',
        'const note = data.clawdNote;',
        'import ClawdNote from "../components/ClawdNote.astro";',
        'const route = "/shroomdog-picks/2";',
      ].join('\n')
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual(
      expect.arrayContaining([
        'ticket-id:SP-63',
        'ticket-id:CP-12',
        'compact-ticket:SP63',
        'compact-slug:sp57',
        'pipeline-command:sp-pipeline',
        'legacy-prefix-value:SP',
        'legacy-prefix-value:CP',
        'schema-key:clawdNote',
        'component:ClawdNote',
        'legacy-route:shroomdog-picks',
      ])
    );
  });

  it('does not flag unrelated abbreviations or factual third-party names', () => {
    const findings = scanLegacyText(
      'docs/facts.md',
      [
        'service provider (SP)',
        '這台機器的 CP 值很高',
        'Claude Code is made by Anthropic.',
        'OpenClaw is a third-party runtime name.',
        'See Clawd.rip for the historical timeline.',
        '災區訊息分類完成後，這個 CP 值高得不真實。',
        'See /posts/mp-1-example for context; the CP value is excellent.',
      ].join('\n')
    );

    expect(findings).toEqual([]);
  });

  it('finds legacy callouts, anchors, identifiers, workspace and deployment coordinates', () => {
    const findings = scanLegacyText(
      'docs/operator.md',
      [
        '> [!clawd] retired callout',
        'See /glossary#clawd and /en/glossary#clawd.',
        'CLAWD_NOTE_TITLE .clawd-prefix --color-clawd-accent color-clawd-muted clawdPrefix',
        'https://github.com/example/clawd-workspace/blob/main/README.md',
        'ssh clawd@legacy.example',
        'checkout=%h/clawd/projects/gu-log',
        'linuxCheckout=/home/moltbot/clawd/projects/gu-log',
        'repo = Path.home() / "clawd" / "projects" / "gu-log"',
      ].join('\n')
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual(
      expect.arrayContaining([
        'obsidian-callout:[!clawd]',
        'legacy-glossary-anchor:/glossary#clawd',
        'legacy-glossary-anchor:/en/glossary#clawd',
        'legacy-identifier:CLAWD_NOTE_TITLE',
        'legacy-identifier:.clawd-prefix',
        'legacy-identifier:--color-clawd-accent',
        'legacy-identifier:color-clawd-muted',
        'legacy-identifier:clawdPrefix',
        'external-workspace-coordinate:clawd-workspace',
        'deployment-coordinate:clawd@legacy.example',
        'deployment-coordinate:%h/clawd',
        'deployment-coordinate:/home/moltbot/clawd',
        'deployment-coordinate:Path.home() / "clawd"',
      ])
    );
  });

  it('finds template tickets, broad post slugs and semantic SP/CP series labels', () => {
    const xTicket = [['S', 'P'].join(''), 'XXX'].join('-');
    const xCompanionTicket = [['C', 'P'].join(''), 'XXX'].join('-');
    const placeholderSlug = [['s', 'p'].join(''), 'xxx'].join('-');
    const symbolicPlaceholderSlug = [['s', 'p'].join(''), 'template'].join('-');
    const findings = scanLegacyText(
      'docs/taxonomy.md',
      [
        'Template tickets are SP-N and CP-NNN.',
        `Alternate template tickets are ${xTicket} and ${xCompanionTicket}.`,
        'Wiki link: [[sp-100-old-title]] and markdown target (cp-pending-draft).',
        `Retired placeholder filename: ${placeholderSlug}.mdx.`,
        `Another symbolic placeholder filename: ${symbolicPlaceholderSlug}.mdx.`,
        `Unrelated Markdown filename: ${['s', 'p'].join('')}-auth.md.`,
        'The SP series and CP writer share one queue.',
        'The SP/CP taxonomy contract is retired.',
      ].join('\n')
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual(
      expect.arrayContaining([
        'ticket-id:SP-N',
        'ticket-id:CP-NNN',
        `ticket-id:${xTicket}`,
        `ticket-id:${xCompanionTicket}`,
        'post-slug:sp-100-old-title',
        'post-slug:cp-pending-draft',
        `post-slug:${placeholderSlug}`,
        `post-slug:${symbolicPlaceholderSlug}`,
        'legacy-prefix-value:SP',
        'legacy-prefix-value:CP',
      ])
    );
  });

  it('requires exact factual exceptions for compound retired persona names', () => {
    const findings = scanLegacyText(
      'src/data/history.json',
      'Git authors included Clawd Bot, ClawdBot and Clawdus.'
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual([
      'persona:Clawd',
      'legacy-compound-persona:ClawdBot',
      'legacy-compound-persona:Clawdus',
    ]);
  });

  it('scans legacy filenames without reading binary content', () => {
    const placeholderPath = ['docs/templates/', ['s', 'p'].join(''), '-xxx.mdx'].join('');
    const symbolicPlaceholderPath = ['docs/templates/', ['s', 'p'].join(''), '-template.mdx'].join(
      ''
    );
    const legacySeriesArtifact = [['s', 'p'].join(''), 'source-fetch.sh'].join('-');
    expect(scanLegacyPath('src/assets/posts/foo-sp57-card.png')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'path-compact-slug', token: 'sp57' }),
      ])
    );
    expect(scanLegacyPath('public/artifacts/sp-251-unknowns/index.html')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'path-post-slug', token: 'sp-251' })])
    );
    expect(scanLegacyPath('docs/templates/cp-NNN-example.md')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'path-post-slug', token: 'cp-NNN' })])
    );
    expect(scanLegacyPath(`scripts/${legacySeriesArtifact}`)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'path-series-artifact', token: legacySeriesArtifact }),
      ])
    );
    expect(scanLegacyPath(placeholderPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'path-post-slug',
          token: path.basename(placeholderPath, '.mdx'),
        }),
      ])
    );
    expect(scanLegacyPath(symbolicPlaceholderPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'path-post-slug',
          token: path.basename(symbolicPlaceholderPath, '.mdx'),
        }),
      ])
    );
  });

  it('flags deleted root series script references but accepts tracked replacements', () => {
    const rootReference = (prefix: string, name: string) =>
      ['scripts/', `${prefix}-`, name].join('');
    const missing = [
      rootReference('sp', 'removed.sh'),
      rootReference('cp', 'dedup-similarity.py'),
      rootReference('mp', 'removed.json'),
    ];
    const trackedFile = rootReference('gp', 'current.sh');
    const findings = scanCanonicalReferences(
      'docs/runbook.md',
      [...missing, trackedFile, 'gp-pipeline.sh', 'scripts/mogu-picks.log'].join('\n'),
      new Set([trackedFile])
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual(
      missing.map((token) => `dangling-root-series-script-reference:${token}`)
    );
  });

  it('fails tracked canonical references whose renamed target does not resolve', () => {
    const trackedPaths = new Set([
      'tools/gp-pipeline/gp-pipeline',
      'tools/gp-pipeline/internal/runner/exec.go',
      'scripts/mogu-picks-prompt.md',
      'scripts/mogu-picks-config.json',
      'scripts/mogu-picks-loop.sh',
    ]);
    const text = [
      'Run tools/gp-pipeline/gp-pipeline.',
      'See tools/gp-pipeline/internal/runner.',
      'Read scripts/mogu-picks-prompt.md and scripts/mogu-picks-config.json.',
      'Start scripts/mogu-picks-loop.sh and update scripts/mogu-picks-queue.yaml.',
    ].join('\n');

    expect(scanCanonicalReferences('docs/runbook.md', text, trackedPaths)).toEqual([
      expect.objectContaining({
        path: 'docs/runbook.md',
        rule: 'dangling-root-series-script-reference',
        token: 'scripts/mogu-picks-queue.yaml',
      }),
    ]);
    expect(scanCanonicalReferences('.gitignore', 'tools/gp-pipeline/bin', trackedPaths)).toEqual(
      []
    );
  });

  it('only accepts an exact path, rule, token and expected count', () => {
    const findings = scanLegacyText('src/fact.md', 'Old name: Clawd. Old name: Clawd.');
    const accepted = applyResidualPolicy(
      findings,
      policy({
        exactExceptions: [
          {
            path: 'src/fact.md',
            rule: 'persona',
            token: 'Clawd',
            expectedCount: 2,
            reason: 'Verbatim historical rename fact.',
          },
        ],
      }),
      repositoryState(['src/fact.md'])
    );

    expect(accepted.blockers).toEqual([]);
    expect(accepted.staleExceptions).toEqual([]);

    const stale = applyResidualPolicy(
      findings.slice(0, 1),
      policy({
        exactExceptions: [
          {
            path: 'src/fact.md',
            rule: 'persona',
            token: 'Clawd',
            expectedCount: 2,
            reason: 'Verbatim historical rename fact.',
          },
        ],
      }),
      repositoryState(['src/fact.md'])
    );
    expect(stale.staleExceptions).toHaveLength(1);
  });

  it('limits broad exclusions to named immutable or generated trees', () => {
    const currentPolicy = policy();
    expect(isResidualScopeExcluded('sources/original.md', currentPolicy)).toBe(true);
    expect(
      isResidualScopeExcluded('openspec/changes/archive/2026-old/spec.md', currentPolicy)
    ).toBe(true);
    expect(isResidualScopeExcluded('quality/generated.json', currentPolicy)).toBe(true);
    expect(isResidualScopeExcluded('src/content/posts/gp-1.mdx', currentPolicy)).toBe(false);

    const invalid = applyResidualPolicy([], policy({ immutableHistoryExcludes: ['src/**'] }));
    expect(invalid.policyErrors).toEqual([
      'immutable exclusion is not an approved history scope: src/**',
    ]);
  });

  it('rejects malformed allowlist containers without throwing', () => {
    const errors = validatePolicy(
      {
        schemaVersion: 1,
        immutableHistoryExcludes: 'sources/**',
        generatedArtifactExcludes: null,
        exactExceptions: {},
      },
      repositoryState([])
    );

    expect(errors).toEqual([
      'policy immutableHistoryExcludes must be an array',
      'policy generatedArtifactExcludes must be an array',
      'policy exactExceptions must be an array',
    ]);
  });

  it('rejects unknown rules, wildcards, blank tokens, bad counts and non-repo paths', () => {
    const errors = validatePolicy(
      policy({
        exactExceptions: [
          {
            path: 'docs/*.md',
            rule: 'made-up-rule',
            token: ' ',
            expectedCount: 0,
            reason: ' ',
          },
          {
            path: 'docs/untracked.md',
            rule: 'persona',
            token: 'Claw*',
            expectedCount: 1,
            reason: 'Historical quote.',
          },
          {
            path: 'docs/missing.md',
            rule: 'persona',
            token: 'Clawd',
            expectedCount: 1,
            reason: 'Historical quote.',
          },
        ],
      }),
      repositoryState(['docs/missing.md'], [])
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'exception path must be exact: docs/*.md',
        'exception rule is unknown: made-up-rule',
        'exception token is required: docs/*.md',
        'exception reason is required: docs/*.md',
        'exception expectedCount must be a positive integer: docs/*.md',
        'exception path is not tracked: docs/*.md',
        'exception token must be exact: Claw*',
        'exception path is not tracked: docs/untracked.md',
        'exception path does not exist: docs/missing.md',
      ])
    );
  });

  it('rejects duplicate exact exceptions after validating their shape', () => {
    const exception = {
      path: 'src/fact.md',
      rule: 'persona',
      token: 'Clawd',
      expectedCount: 1,
      reason: 'Verbatim historical rename fact.',
    };
    const errors = validatePolicy(
      policy({ exactExceptions: [exception, { ...exception }] }),
      repositoryState(['src/fact.md'])
    );

    expect(errors).toContain('duplicate exact exception: src/fact.md / persona / Clawd');
  });
});
