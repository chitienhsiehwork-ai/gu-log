import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  COMPONENT_ADAPTERS,
  POST_JSON_V2_KEYS,
  assertPostJsonV2,
  inventoryMdx,
  normalizeRenderedText,
  serializeMarkdownArtifact,
  writeMarkdownArtifactAtomically,
} from '../scripts/lib/post-markdown-exporter.mjs';

function rawPost(body, extraFrontmatter = '') {
  return `---
ticketId: GP-999
title: Fixture title
summary: Fixture summary
originalDate: 2026-01-02
translatedDate: 2026-01-03
source: Fixture source
sourceUrl: https://example.com/source
author: Fixture Author
lang: zh-tw
tags: [testing]
${extraFrontmatter}---
${body}`;
}

function rawBody(rawMdx) {
  return rawMdx.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function postJson(rawMdx, overrides = {}) {
  return {
    schemaVersion: 2,
    slug: 'fixture',
    ticketId: 'GP-999',
    url: '/posts/fixture',
    title: 'Fixture title',
    summary: 'Fixture summary',
    tags: ['testing'],
    lang: 'zh-tw',
    originalDate: '2026-01-02',
    translatedDate: '2026-01-03',
    source: 'Fixture source',
    sourceUrl: 'https://example.com/source',
    authorshipNote: 'Human-authored note',
    translatedBy: null,
    headings: [],
    body: rawBody(rawMdx),
    ...overrides,
  };
}

function pageHtml(
  content,
  {
    slug = 'fixture',
    lang = 'zh-tw',
    status = 'published',
    replacementTicketId = '',
    replacementUrl = '',
    banner = '',
  } = {}
) {
  const prefix = lang === 'en' ? '/en/posts/' : '/posts/';
  const canonical = `https://gu-log.vercel.app${prefix}${slug}`;
  return `<!doctype html>
<html>
  <head>
    <link rel="alternate" type="text/markdown" href="${canonical}.md" data-post-markdown-alternate>
  </head>
  <body>
    <article
      data-post-representation
      data-post-slug="${slug}"
      data-post-lang="${lang}"
      data-post-status="${status}"
      data-replacement-ticket-id="${replacementTicketId}"
      data-replacement-url="${replacementUrl}"
    >
      ${banner}
      <div class="post-content">${content}</div>
    </article>
  </body>
</html>`;
}

test('inventory accepts the registered component set and static prop expressions', () => {
  const source = `
import MoguNote from '../../components/MoguNote.astro';
import LevelUpQuiz from '../../components/LevelUpQuiz.astro';

<MoguNote prefix="Mogu thinking:">先看清楚。</MoguNote>
<LevelUpQuiz
  question="答案？"
  options={[{ label: "A", text: "靜態值" }]}
  answer="A"
  explanation="因為是 A。"
/>
`;

  assert.deepEqual(inventoryMdx(source, { sourceName: 'fixture.mdx' }).components, [
    'LevelUpQuiz',
    'MoguNote',
  ]);
  assert.equal(COMPONENT_ADAPTERS.LevelUpQuiz, 'level-up-quiz');
});

test('inventory fails closed for unknown components', () => {
  assert.throws(
    () =>
      inventoryMdx('import Mystery from \'./Mystery.astro\';\n\n<Mystery secret="lost" />', {
        sourceName: 'unknown.mdx',
      }),
    /unknown\.mdx: unknown custom component <Mystery>/
  );
});

test('inventory fails closed for dynamic expressions', () => {
  assert.throws(
    () =>
      inventoryMdx(
        "import MoguNote from './MoguNote.astro';\n\n<MoguNote prefix={getPrefix()}>Nope</MoguNote>",
        { sourceName: 'dynamic.mdx' }
      ),
    /unsupported expression for <MoguNote> attribute prefix/
  );
});

test('inventory enforces each adapter prop and child contract', () => {
  assert.throws(
    () =>
      inventoryMdx(
        'import Toggle from \'./Toggle.astro\';\n\n<Toggle title="T" unregisteredSemanticProp="LOST">body</Toggle>',
        { sourceName: 'unknown-prop.mdx' }
      ),
    /unknown semantic attribute unregisteredSemanticProp on <Toggle>/
  );
  assert.throws(
    () =>
      inventoryMdx("import Toggle from './Toggle.astro';\n\n<Toggle>body</Toggle>", {
        sourceName: 'missing-prop.mdx',
      }),
    /<Toggle> is missing required attribute title/
  );
  assert.throws(
    () =>
      inventoryMdx(
        "import LevelUpProgress from './LevelUpProgress.astro';\n\n<LevelUpProgress current={1} total={2}>lost body</LevelUpProgress>",
        { sourceName: 'unknown-child.mdx' }
      ),
    /<LevelUpProgress> does not accept child content/
  );
  assert.throws(
    () =>
      inventoryMdx(
        'import LevelUpQuiz from \'./LevelUpQuiz.astro\';\n\n<LevelUpQuiz question="Q" options={[{ label: "A", lost: "B" }]} answer="A" explanation="E" />',
        { sourceName: 'bad-options.mdx' }
      ),
    /options must contain exact string label\/text fields/
  );
});

test('inventory rejects a top-level span outside the exact artifact-callout hierarchy', () => {
  assert.throws(
    () => inventoryMdx('<span className="artifact-callout__meta">orphan</span>'),
    /unknown native JSX structure <span>/
  );
});

test('inventory accepts the exact artifact-callout hierarchy with corpus class syntax', () => {
  const source = `
<a class="artifact-callout" href="/artifact">
  <span class="artifact-callout__icon-wrap">
    <span class="artifact-callout__icon" aria-hidden="true">↗</span>
    <span class="artifact-callout__tap">open</span>
  </span>
  <span class="artifact-callout__body">
    <span class="artifact-callout__label">demo</span>
    <strong>Title</strong>
    <span class="artifact-callout__meta">metadata</span>
    <span class="artifact-callout__cta">
      <span>open</span>
      <span aria-hidden="true">→</span>
    </span>
  </span>
</a>`;
  assert.deepEqual(inventoryMdx(source).nativeElements, ['a.artifact-callout']);
});

test('inventory rejects drift inside the artifact-callout hierarchy', () => {
  const source = `
<a className="artifact-callout" href="/artifact">
  <span className="artifact-callout__icon-wrap">
    <span className="artifact-callout__icon" aria-hidden="true">↗</span>
    <span className="artifact-callout__tap">open</span>
  </span>
  <span className="artifact-callout__body">
    <span className="artifact-callout__label">demo</span>
    <strong>Title</strong>
    <span className="artifact-callout__unknown">lost</span>
    <span className="artifact-callout__cta">
      <span>open</span>
      <span aria-hidden="true">→</span>
    </span>
  </span>
</a>`;
  assert.throws(() => inventoryMdx(source), /artifact-callout__meta hierarchy/);
});

test('inventory rejects ambiguous artifact-callout class attributes', () => {
  assert.throws(
    () =>
      inventoryMdx(
        '<a class="artifact-callout" className="artifact-callout" href="/artifact"></a>'
      ),
    /exactly one of class or className/
  );
});

test('PostImage src identifier must resolve to a static image import', () => {
  const source = `
import PostImage from '../../components/PostImage.astro';
import arbitraryData from './fixture.json';

<PostImage src={arbitraryData} alt="bad" />
`;
  assert.throws(() => inventoryMdx(source), /unsupported expression for <PostImage> attribute src/);
});

test('serializes fixed metadata/status/source/body order and keeps inline code with angle brackets', () => {
  const raw = rawPost(`
import MoguNote from '../../components/MoguNote.astro';

Run \`claude --resume <session-id>\`.

<MoguNote>Kaomoji stays visible.</MoguNote>
`);
  const html = pageHtml(`
    <p>Run <code>claude --resume &lt;session-id&gt;</code>. (⌐■_■)\u2060 A\u00a0B</p>
    <blockquote class="mogu-note" data-mogu-note data-markdown-adapter="mogu-note" data-has-summary="false">
      <strong class="mogu-prefix">
        <a href="/glossary#mogu" class="mogu-prefix-link" aria-label="Mogu glossary">
          <img src="/mogu-picks-icon.png" alt="" class="mogu-prefix-icon" width="20" height="20">
          <span>Mogu</span>
        </a>
        <span> says:</span>
      </strong>
      <div class="mogu-note-content" id="mogu-note-content-fixture"><p>Kaomoji stays visible. (◕‿◕)</p></div>
    </blockquote>
  `);
  const result = serializeMarkdownArtifact({
    rawMdx: raw,
    postJson: postJson(raw),
    html,
    sourceName: 'fixture',
  });

  const frontmatter = parseYaml(result.markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
  assert.deepEqual(Object.keys(frontmatter), [
    'schemaVersion',
    'slug',
    'ticketId',
    'lang',
    'title',
    'summary',
    'originalDate',
    'translatedDate',
    'source',
    'sourceUrl',
    'author',
    'authorshipNote',
    'canonicalUrl',
    'status',
    'replacementTicketId',
    'replacementUrl',
  ]);
  assert.equal(frontmatter.author, 'Fixture Author');
  assert.equal(frontmatter.status, 'published');
  assert.equal(frontmatter.replacementUrl, null);
  assert.match(result.markdown, /^# Fixture title$/m);
  assert.match(result.markdown, /> \*\*來源:\*\* \[Fixture source\]/);
  assert.match(result.markdown, /`claude --resume <session-id>`/);
  assert.match(result.markdown, /\(⌐■\\_■\) A B/);
  assert.match(result.markdown, /> \*\*Mogu says:\*\*/);
  assert.doesNotMatch(result.markdown, /hidden interaction|\u2060|\u00a0|<MoguNote>/);
  assert.equal(normalizeRenderedText('A\u2060 B\u00a0C'), 'A B C');
});

test('escapes literal backslashes together with Markdown inline punctuation', () => {
  const raw = rawPost('\nEscaping fixture.\n');
  const html = pageHtml(String.raw`<p>Path C:\tmp and *literal*.</p>`);
  const result = serializeMarkdownArtifact({
    rawMdx: raw,
    postJson: postJson(raw),
    html,
    sourceName: 'backslash-escaping',
  });

  assert.ok(result.markdown.includes(String.raw`Path C:\\tmp and \*literal\*.`));
});

test('projects every registered adapter and the exact artifact callout without hidden duplicates', () => {
  const raw = rawPost(`
import MoguNote from '../../components/MoguNote.astro';
import ShroomDogNote from '../../components/ShroomDogNote.astro';
import Toggle from '../../components/Toggle.astro';
import LevelUpProgress from '../../components/LevelUpProgress.astro';
import LevelUpQuiz from '../../components/LevelUpQuiz.astro';
import AnalogyBox from '../../components/AnalogyBox.astro';
import Mermaid from '../../components/Mermaid.astro';
import PostImage from '../../components/PostImage.astro';
import DiffBlock from '../../components/DiffBlock.astro';
import CodexLearningMap from '../../components/CodexLearningMap.astro';
import fixtureImage from '../../assets/posts/fixture.png';

<MoguNote>Mogu body</MoguNote>
<ShroomDogNote>Dog body</ShroomDogNote>
<Toggle title="Details">Toggle body</Toggle>
<LevelUpProgress current={2} total={4} title="Course" />
<LevelUpQuiz question="Question?" options={[{ label: "A", text: "Option" }]} answer="A" explanation="Because." />
<AnalogyBox title="Analogy">Analogy body</AnalogyBox>
<Mermaid chart={\`graph TD\nA-->B\`} caption="Diagram" />
<PostImage src={fixtureImage} alt="Fixture image" caption="Caption" />
<DiffBlock before="old" after="new" />
<CodexLearningMap lang="en" />

<a class="artifact-callout" href="/artifacts/demo/">
  <span class="artifact-callout__icon-wrap">
    <span class="artifact-callout__icon" aria-hidden="true">↗</span>
    <span class="artifact-callout__tap">open</span>
  </span>
  <span class="artifact-callout__body">
    <span class="artifact-callout__label">demo</span>
    <strong>Artifact title</strong>
    <span class="artifact-callout__meta">no API</span>
    <span class="artifact-callout__cta">
      <span>open it</span>
      <span aria-hidden="true">→</span>
    </span>
  </span>
</a>
`);
  const html = pageHtml(`
    <blockquote class="mogu-note" data-mogu-note data-markdown-adapter="mogu-note" data-has-summary="true">
      <strong class="mogu-prefix">
        <a href="/glossary#mogu" class="mogu-prefix-link" aria-label="Mogu glossary">
          <img src="/mogu-picks-icon.png" alt="" class="mogu-prefix-icon" width="20" height="20">
          <span>Mogu</span>
        </a>
        <span>:</span>
      </strong>
      <div class="mogu-note-summary" hidden><span class="mogu-note-summary-label">Short</span><p>duplicate summary</p></div>
      <div class="mogu-note-content" id="mogu-note-content-all"><p>Mogu body</p></div>
      <button class="mogu-note-toggle" type="button" aria-expanded="false" aria-controls="mogu-note-content-all" hidden>
        <span class="mogu-note-toggle-icon" aria-hidden="true">v</span>
        <span class="mogu-note-toggle-label">Expand</span>
      </button>
    </blockquote>
    <blockquote class="shroomdog-note" data-shroomdog-note data-markdown-adapter="shroomdog-note"
      data-auto-fold="false" data-collapse-threshold="260" data-min-expandable-overflow="72">
      <strong class="shroomdog-prefix">
        <img src="/shroomdog-icon-128.png" alt="ShroomDog" class="shroomdog-prefix-icon" width="22" height="22">
        ShroomDog:
      </strong>
      <div class="shroomdog-note-content" id="shroomdog-note-content-all"><p>Dog body</p></div>
    </blockquote>
    <div class="toggle-container" data-open="false" data-markdown-adapter="toggle">
      <button class="toggle-header" aria-expanded="false">
        <span class="toggle-icon"></span><span class="toggle-title">Details</span>
      </button>
      <div class="toggle-wrapper"><div class="toggle-inner"><div class="toggle-content"><p>Toggle body</p></div></div></div>
    </div>
    <div class="levelup-progress" data-markdown-adapter="level-up-progress">
      <div class="progress-header"><span class="progress-level">Level 2 / 4</span><span class="progress-title">Course</span></div>
      <div class="progress-bar-track" role="progressbar" aria-valuenow="2" aria-valuemin="0" aria-valuemax="4">
        <div class="progress-bar-fill" style="width: 50%"></div>
      </div>
      <div class="progress-percentage">50%</div>
    </div>
    <div class="levelup-quiz" data-quiz-id="quiz-all" data-markdown-adapter="level-up-quiz" data-answer="A">
      <div class="quiz-header"><span class="quiz-icon">?</span><span class="quiz-label">Quiz</span></div>
      <p class="quiz-question">Question?</p>
      <div class="quiz-options"><button class="quiz-option" data-label="A" type="button"><span class="option-label">A</span><span class="option-text">Option</span></button></div>
      <div class="quiz-result" aria-live="polite">
        <div class="result-correct" hidden><span class="result-icon">yes</span><strong>Correct</strong><p class="result-explanation">Because.</p></div>
        <div class="result-wrong" hidden><span class="result-icon">no</span><strong>Wrong</strong><p class="result-answer">Answer: <strong>A</strong></p><p class="result-explanation">duplicate explanation</p></div>
      </div>
    </div>
    <aside class="analogy-box" role="note" data-markdown-adapter="analogy-box">
      <div class="analogy-header"><span class="analogy-title">Analogy</span><span class="analogy-badge">Badge</span></div>
      <div class="analogy-content"><p>Analogy body</p></div>
    </aside>
    <div class="mermaid-wrapper" data-markdown-adapter="mermaid">
      <div class="mermaid-scroll"><div class="mermaid-source" style="display:none;" data-mermaid>graph TD\nA--&gt;B</div><div class="mermaid-render"></div></div>
      <p class="mermaid-caption">Diagram</p>
      <button class="mermaid-expand-btn" aria-label="Expand" title="Zoom"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path></svg></button>
    </div>
    <div class="mermaid-overlay"><button class="mermaid-close-btn">hidden close</button></div>
    <figure class="post-image" data-post-image data-markdown-adapter="post-image">
      <button type="button" class="post-image-open" aria-label="Enlarge" aria-haspopup="dialog" aria-controls="post-image-all-dialog" data-post-image-open>
        <img src="/_astro/fixture.hash.png" alt="Fixture image" loading="lazy" decoding="async" width="1200" height="520" aria-describedby="post-image-all-caption">
        <span class="post-image-zoom-hint" aria-hidden="true">Zoom</span>
      </button>
      <figcaption id="post-image-all-caption">Caption</figcaption>
      <div id="post-image-all-dialog" class="post-image-dialog" role="dialog" aria-modal="true" aria-label="Enlarge" aria-describedby="post-image-all-caption" hidden data-post-image-dialog>
        <div class="post-image-dialog-surface" data-post-image-surface>
          <button type="button" class="post-image-close" aria-label="Close" data-post-image-close>Close</button>
          <div class="post-image-dialog-scroll" data-post-image-scroll><img class="post-image-dialog-img" alt="Fixture image" data-full-src="/duplicate.png" draggable="false" decoding="async" aria-describedby="post-image-all-caption" data-post-image-expanded-img></div>
          <p class="post-image-dialog-caption">Caption</p>
        </div>
      </div>
    </figure>
    <div class="diff-block" data-markdown-adapter="diff-block">
      <div class="diff-panel diff-before"><div class="diff-header diff-header--before"><span class="diff-icon">x</span><span class="diff-label">Before</span></div><div class="diff-body">old</div></div>
      <div class="diff-panel diff-after"><div class="diff-header diff-header--after"><span class="diff-icon">yes</span><span class="diff-label">After</span></div><div class="diff-body">new</div></div>
    </div>
    <section class="codex-learning-map" data-markdown-adapter="codex-learning-map" aria-label="Learning map">
      <div class="model-shift"><div class="model-card bad"><span>Wrong</span><strong>Lecture</strong></div><div class="arrow" aria-hidden="true">to</div><div class="model-card good"><span>Useful</span><strong>Action</strong></div></div>
      <ol class="steps">
        <li><div class="step-label">Step 1</div><p>Try it</p><span>Output</span></li>
        <li><div class="step-label">Step 2</div><p>Try it</p><span>Output</span></li>
        <li><div class="step-label">Step 3</div><p>Try it</p><span>Output</span></li>
        <li><div class="step-label">Step 4</div><p>Try it</p><span>Output</span></li>
        <li><div class="step-label">Step 5</div><p>Try it</p><span>Output</span></li>
      </ol>
    </section>
    <a class="artifact-callout" href="/artifacts/demo/">
      <span class="artifact-callout__label">demo</span>
      <strong>Artifact title</strong>
      <span class="artifact-callout__meta">no API</span>
      <span class="artifact-callout__cta">hidden CTA →</span>
    </a>
  `);
  const { markdown, inventory } = serializeMarkdownArtifact({
    rawMdx: raw,
    postJson: postJson(raw),
    html,
    sourceName: 'all-adapters',
  });

  assert.deepEqual(inventory.components, Object.keys(COMPONENT_ADAPTERS).sort());
  for (const expected of [
    'Mogu body',
    'Dog body',
    'Toggle body',
    'Level 2 / 4',
    '**Quiz:** Question?',
    'Analogy body',
    '```mermaid',
    '![Fixture image](https://gu-log.vercel.app/_astro/fixture.hash.png)',
    '**Before:** old',
    '**Learning map**',
    '[Artifact title](https://gu-log.vercel.app/artifacts/demo/)',
  ]) {
    assert.ok(markdown.includes(expected), `missing projection: ${expected}`);
  }
  assert.doesNotMatch(
    markdown,
    /duplicate summary|duplicate explanation|hidden expand|hidden close|duplicate\.png|hidden CTA/
  );
});

test('status marker and banner must agree, including English inherited status', () => {
  const raw = rawPost('\nA retired body.\n');
  const replacement = 'https://gu-log.vercel.app/en/posts/en-replacement';
  const goodBanner = `<div
    data-post-status-banner
    data-status="deprecated"
    data-replacement-ticket-id="GP-1000"
    data-replacement-url="${replacement}"
  >Deprecated</div>`;
  const good = serializeMarkdownArtifact({
    rawMdx: raw,
    postJson: postJson(raw, {
      slug: 'en-fixture',
      url: '/en/posts/en-fixture',
      lang: 'en',
    }),
    html: pageHtml('<p>A retired body.</p>', {
      slug: 'en-fixture',
      lang: 'en',
      status: 'deprecated',
      replacementTicketId: 'GP-1000',
      replacementUrl: replacement,
      banner: goodBanner,
    }),
    sourceName: 'en-fixture',
  });
  assert.equal(good.metadata.status, 'deprecated');
  assert.equal(good.metadata.replacementUrl, replacement);
  assert.match(good.markdown, /> \*\*Status: deprecated\.\*\*/);

  const retiredBanner =
    '<div data-post-status-banner data-status="retired" data-replacement-ticket-id="" data-replacement-url="">Retired</div>';
  const retired = serializeMarkdownArtifact({
    rawMdx: raw,
    postJson: postJson(raw),
    html: pageHtml('<p>A retired body.</p>', {
      status: 'retired',
      banner: retiredBanner,
    }),
    sourceName: 'retired-fixture',
  });
  assert.equal(retired.metadata.status, 'retired');
  assert.equal(retired.metadata.replacementUrl, null);

  assert.throws(
    () =>
      serializeMarkdownArtifact({
        rawMdx: raw,
        postJson: postJson(raw, {
          slug: 'en-fixture',
          url: '/en/posts/en-fixture',
          lang: 'en',
        }),
        html: pageHtml('<p>A retired body.</p>', {
          slug: 'en-fixture',
          lang: 'en',
          status: 'deprecated',
          replacementTicketId: 'GP-1000',
          replacementUrl: replacement,
          banner: goodBanner.replace('data-status="deprecated"', 'data-status="retired"'),
        }),
        sourceName: 'en-fixture',
      }),
    /status marker and visible banner disagree/
  );
  assert.throws(
    () =>
      serializeMarkdownArtifact({
        rawMdx: raw,
        postJson: postJson(raw),
        html: pageHtml('<p>A body.</p>', { status: '' }),
        sourceName: 'missing-status',
      }),
    /status marker is invalid/
  );
});

test('JSON v2 keys/body remain exact and reject a synthetic status field', () => {
  const raw = rawPost('\nBody stays raw.\n');
  const json = postJson(raw);
  assert.deepEqual(Object.keys(json).sort(), POST_JSON_V2_KEYS);
  assert.doesNotThrow(() => assertPostJsonV2(json, raw, { sourceName: 'fixture' }));
  assert.throws(
    () => assertPostJsonV2({ ...json, status: 'published' }, raw, { sourceName: 'fixture' }),
    /post JSON v2 keys changed/
  );
});

test('rendered links fail closed on unsafe URL protocols', () => {
  const raw = rawPost('\n[unsafe](javascript:alert(1))\n');
  assert.throws(
    () =>
      serializeMarkdownArtifact({
        rawMdx: raw,
        postJson: postJson(raw),
        html: pageHtml('<p><a href="javascript:alert(1)">unsafe</a></p>'),
        sourceName: 'unsafe-url',
      }),
    /unsupported protocol/
  );
});

test('source, rendered, and replacement URLs reject control characters before parsing', () => {
  const raw = rawPost('\nA body.\n');
  assert.throws(
    () =>
      serializeMarkdownArtifact({
        rawMdx: raw,
        postJson: postJson(raw, { sourceUrl: 'https://example.com/a\nb' }),
        html: pageHtml('<p>A body.</p>'),
        sourceName: 'source-control-url',
      }),
    /source URL contains a control character/
  );
  assert.throws(
    () =>
      serializeMarkdownArtifact({
        rawMdx: raw,
        postJson: postJson(raw),
        html: pageHtml('<p><a href="https://example.com/a&#x9;b">unsafe</a></p>'),
        sourceName: 'rendered-control-url',
      }),
    /rendered link href contains a control character/
  );
  assert.throws(
    () =>
      serializeMarkdownArtifact({
        rawMdx: raw,
        postJson: postJson(raw),
        html: pageHtml('<p>A body.</p>', {
          status: 'deprecated',
          replacementTicketId: 'GP-1000',
          replacementUrl: 'https://gu-log.vercel.app/posts/a\nb',
          banner:
            '<div data-post-status-banner data-status="deprecated" data-replacement-ticket-id="GP-1000" data-replacement-url="https://gu-log.vercel.app/posts/a&#xA;b">Deprecated</div>',
        }),
        sourceName: 'replacement-control-url',
      }),
    /article replacement URL contains a control character/
  );
});

test('atomic writer preserves the prior artifact when the temporary write fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'post-markdown-exporter-'));
  const outputPath = path.join(directory, 'fixture.md');
  try {
    await fs.writeFile(outputPath, 'previous');
    await assert.rejects(() => writeMarkdownArtifactAtomically(outputPath, { invalid: true }));
    assert.equal(await fs.readFile(outputPath, 'utf8'), 'previous');
    assert.deepEqual(await fs.readdir(directory), ['fixture.md']);

    await writeMarkdownArtifactAtomically(outputPath, 'replacement');
    assert.equal(await fs.readFile(outputPath, 'utf8'), 'replacement');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
