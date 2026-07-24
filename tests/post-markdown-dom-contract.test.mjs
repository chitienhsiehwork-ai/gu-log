import assert from 'node:assert/strict';
import test from 'node:test';

import { fromHtml } from 'hast-util-from-html';

import { assertRenderedAdapterDomContract } from '../scripts/lib/post-markdown-dom-contract.mjs';

function fixture(markup) {
  const tree = fromHtml(markup, { fragment: true });
  return tree.children.find((child) => child.type === 'element');
}

const FIXTURES = {
  'mogu-note': `
    <blockquote class="mogu-note" data-mogu-note data-markdown-adapter="mogu-note"
      data-has-summary="false" data-astro-cid-fixture>
      <strong class="mogu-prefix">
        <a href="/glossary#mogu" class="mogu-prefix-link" aria-label="Mogu glossary">
          <img src="/mogu-picks-icon.png" alt="" class="mogu-prefix-icon" width="20" height="20">
          <span>Mogu</span>
        </a>
        <span> says:</span>
      </strong>
      <div class="mogu-note-content" id="mogu-note-content-1">
        <p><a href="/safe">Authored content</a></p>
      </div>
    </blockquote>`,
  'shroomdog-note': `
    <blockquote class="shroomdog-note" data-shroomdog-note
      data-markdown-adapter="shroomdog-note" data-auto-fold="false"
      data-collapse-threshold="260" data-min-expandable-overflow="72">
      <strong class="shroomdog-prefix">
        <img src="/shroomdog-icon-128.png" alt="ShroomDog"
          class="shroomdog-prefix-icon" width="22" height="22">
        ShroomDog says:
      </strong>
      <div class="shroomdog-note-content" id="shroomdog-note-content-1">
        <p>Authored content</p>
      </div>
    </blockquote>`,
  toggle: `
    <div class="toggle-container" data-open="false" data-markdown-adapter="toggle">
      <button class="toggle-header" aria-expanded="false" data-astro-cid-fixture>
        <span class="toggle-icon"></span>
        <span class="toggle-title">Details</span>
      </button>
      <div class="toggle-wrapper">
        <div class="toggle-inner">
          <div class="toggle-content"><p>Authored content</p></div>
        </div>
      </div>
    </div>`,
  'level-up-progress': `
    <div class="levelup-progress" data-markdown-adapter="level-up-progress">
      <div class="progress-header">
        <span class="progress-level">Level 1 / 2</span>
      </div>
      <div class="progress-bar-track" role="progressbar"
        aria-valuenow="1" aria-valuemin="0" aria-valuemax="2">
        <div class="progress-bar-fill" style="width: 50%"></div>
      </div>
      <div class="progress-percentage">50%</div>
    </div>`,
  'level-up-quiz': `
    <div class="levelup-quiz" data-quiz-id="quiz-one" data-answer="A"
      data-markdown-adapter="level-up-quiz">
      <div class="quiz-header">
        <span class="quiz-icon">?</span>
        <span class="quiz-label">Quiz</span>
      </div>
      <p class="quiz-question">Question?</p>
      <div class="quiz-options">
        <button class="quiz-option" data-label="A" type="button">
          <span class="option-label">A</span>
          <span class="option-text">Answer</span>
        </button>
      </div>
      <div class="quiz-result" aria-live="polite">
        <div class="result-correct" hidden>
          <span class="result-icon">yes</span>
          <strong>Correct</strong>
          <p class="result-explanation">Explanation</p>
        </div>
        <div class="result-wrong" hidden>
          <span class="result-icon">no</span>
          <strong>Wrong</strong>
          <p class="result-answer">Answer: <strong>A</strong></p>
          <p class="result-explanation">Explanation</p>
        </div>
      </div>
    </div>`,
  'analogy-box': `
    <aside class="analogy-box" role="note" data-markdown-adapter="analogy-box">
      <div class="analogy-header">
        <span class="analogy-title">Analogy</span>
        <span class="analogy-badge">Badge</span>
      </div>
      <div class="analogy-content"><p>Authored content</p></div>
    </aside>`,
  mermaid: `
    <div class="mermaid-wrapper" data-markdown-adapter="mermaid">
      <div class="mermaid-scroll">
        <div class="mermaid-source" style="display:none;" data-mermaid>graph TD</div>
        <div class="mermaid-render"></div>
      </div>
      <button class="mermaid-expand-btn" aria-label="Expand" title="Zoom">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
        </svg>
      </button>
    </div>`,
  'post-image': `
    <figure class="post-image" data-post-image data-markdown-adapter="post-image">
      <button type="button" class="post-image-open" aria-label="Enlarge"
        aria-haspopup="dialog" aria-controls="post-image-1-dialog" data-post-image-open>
        <img src="/image.webp" alt="Meaningful alt" loading="lazy" decoding="async"
          width="1200" height="520">
        <span class="post-image-zoom-hint" aria-hidden="true">Zoom</span>
      </button>
      <div id="post-image-1-dialog" class="post-image-dialog" role="dialog"
        aria-modal="true" aria-label="Enlarge" hidden data-post-image-dialog>
        <div class="post-image-dialog-surface" data-post-image-surface>
          <button type="button" class="post-image-close" aria-label="Close"
            data-post-image-close>Close</button>
          <div class="post-image-dialog-scroll" data-post-image-scroll>
            <img class="post-image-dialog-img" alt="Meaningful alt"
              data-full-src="/image.png" draggable="false" decoding="async"
              data-post-image-expanded-img>
          </div>
        </div>
      </div>
    </figure>`,
  'diff-block': `
    <div class="diff-block" data-markdown-adapter="diff-block">
      <div class="diff-panel diff-before">
        <div class="diff-header diff-header--before">
          <span class="diff-icon">x</span>
          <span class="diff-label">Before</span>
        </div>
        <div class="diff-body">Old</div>
      </div>
      <div class="diff-panel diff-after">
        <div class="diff-header diff-header--after">
          <span class="diff-icon">yes</span>
          <span class="diff-label">After</span>
        </div>
        <div class="diff-body">New</div>
      </div>
    </div>`,
  'codex-learning-map': `
    <section class="codex-learning-map" aria-label="Learning map"
      data-markdown-adapter="codex-learning-map">
      <div class="model-shift">
        <div class="model-card bad"><span>Wrong</span><strong>Lecture</strong></div>
        <div class="arrow" aria-hidden="true">to</div>
        <div class="model-card good"><span>Right</span><strong>Action</strong></div>
      </div>
      <ol class="steps">
        <li><div class="step-label">1</div><p>Goal</p><span>Output</span></li>
        <li><div class="step-label">2</div><p>Goal</p><span>Output</span></li>
        <li><div class="step-label">3</div><p>Goal</p><span>Output</span></li>
        <li><div class="step-label">4</div><p>Goal</p><span>Output</span></li>
        <li><div class="step-label">5</div><p>Goal</p><span>Output</span></li>
      </ol>
    </section>`,
};

for (const [adapter, markup] of Object.entries(FIXTURES)) {
  test(`${adapter} accepts its legal minimal DOM fixture`, () => {
    assert.doesNotThrow(() =>
      assertRenderedAdapterDomContract(fixture(markup), {
        sourceName: `${adapter}.html`,
      })
    );
  });

  test(`${adapter} rejects an unknown direct child`, () => {
    const root = fixture(markup);
    root.children.push(fixture('<div class="new-visible-semantic">drift</div>'));
    assert.throws(
      () =>
        assertRenderedAdapterDomContract(root, {
          sourceName: `${adapter}.html`,
        }),
      /unknown direct child <div\.new-visible-semantic>/
    );
  });

  test(`${adapter} rejects an unknown attribute`, () => {
    const root = fixture(markup);
    root.properties.dataUnknownSemantic = 'drift';
    assert.throws(
      () =>
        assertRenderedAdapterDomContract(root, {
          sourceName: `${adapter}.html`,
        }),
      /unknown attribute dataUnknownSemantic/
    );
  });
}

test('the four authored content roots stay opaque to their adapter contract', () => {
  const cases = [
    ['mogu-note', 'mogu-note-content'],
    ['shroomdog-note', 'shroomdog-note-content'],
    ['toggle', 'toggle-content'],
    ['analogy-box', 'analogy-content'],
  ];

  for (const [adapter, className] of cases) {
    const root = fixture(FIXTURES[adapter]);
    const queue = [root];
    let contentRoot;
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (candidate.properties?.className?.includes(className)) {
        contentRoot = candidate;
        break;
      }
      queue.push(...(candidate.children ?? []).filter((child) => child.type === 'element'));
    }
    assert.ok(contentRoot);
    contentRoot.children.push(
      fixture('<div class="new-visible-semantic" surprise="allowed-here"></div>')
    );
    assert.doesNotThrow(() => assertRenderedAdapterDomContract(root, { sourceName: adapter }));
  }
});

test('mogu-note accepts the complete optional summary and toggle branch', () => {
  const root = fixture(FIXTURES['mogu-note']);
  root.properties.dataHasSummary = 'true';
  const contentIndex = root.children.findIndex(
    (child) =>
      child.type === 'element' && child.properties?.className?.includes('mogu-note-content')
  );
  root.children.splice(
    contentIndex,
    0,
    fixture(
      '<div class="mogu-note-summary" hidden><span class="mogu-note-summary-label">Short</span><p>Summary</p></div>'
    )
  );
  root.children.push(
    fixture(
      '<button class="mogu-note-toggle" type="button" aria-expanded="false" aria-controls="mogu-note-content-1" hidden><span class="mogu-note-toggle-icon" aria-hidden="true">v</span><span class="mogu-note-toggle-label">Expand</span></button>'
    )
  );
  assert.doesNotThrow(() => assertRenderedAdapterDomContract(root));
});

test('Toggle rejects the review evidence inserted at the adapter root', () => {
  const root = fixture(FIXTURES.toggle);
  root.children.splice(1, 0, fixture('<div class="new-visible-semantic">visible drift</div>'));
  assert.throws(
    () => assertRenderedAdapterDomContract(root, { sourceName: 'toggle-review.html' }),
    /toggle-review\.html: rendered adapter DOM contract violation/
  );
});

test('structured adapter nodes reject unregistered visible direct text', () => {
  const root = fixture(FIXTURES.toggle);
  root.children.splice(1, 0, { type: 'text', value: 'IMPORTANT LOST TEXT' });
  assert.throws(
    () => assertRenderedAdapterDomContract(root, { sourceName: 'toggle-text-review.html' }),
    /unknown direct text "IMPORTANT LOST TEXT"/
  );
  root.children.splice(1, 1);

  const wrapper = root.children.find(
    (child) => child.type === 'element' && child.properties?.className?.includes('toggle-wrapper')
  );
  wrapper.children.unshift({ type: 'text', value: 'WRAPPER TEXT WOULD BE LOST' });
  assert.throws(
    () => assertRenderedAdapterDomContract(root, { sourceName: 'toggle-wrapper-review.html' }),
    /unknown direct text "WRAPPER TEXT WOULD BE LOST"/
  );
});
