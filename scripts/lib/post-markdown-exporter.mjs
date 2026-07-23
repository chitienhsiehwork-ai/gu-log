import fs from 'node:fs/promises';
import path from 'node:path';

import { createProcessor } from '@mdx-js/mdx';
import { fromHtml } from 'hast-util-from-html';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export const COMPONENT_ADAPTERS = Object.freeze({
  MoguNote: 'mogu-note',
  ShroomDogNote: 'shroomdog-note',
  Toggle: 'toggle',
  LevelUpProgress: 'level-up-progress',
  LevelUpQuiz: 'level-up-quiz',
  AnalogyBox: 'analogy-box',
  Mermaid: 'mermaid',
  PostImage: 'post-image',
  DiffBlock: 'diff-block',
  CodexLearningMap: 'codex-learning-map',
});

function fail(sourceName, message) {
  throw new Error(`${sourceName}: ${message}`);
}

function expressionNode(attribute) {
  return attribute.value?.data?.estree?.body?.[0]?.expression;
}

function isStaticExpression(node) {
  if (!node) return false;
  if (node.type === 'Literal') return true;
  if (node.type === 'TemplateLiteral') return node.expressions.length === 0;
  if (node.type === 'ArrayExpression') {
    return node.elements.every((element) => element === null || isStaticExpression(element));
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.every(
      (property) =>
        property.type === 'Property' &&
        property.kind === 'init' &&
        !property.computed &&
        isStaticExpression(property.value)
    );
  }
  return false;
}

function attributeMap(node, sourceName) {
  const attributes = new Map();
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== 'mdxJsxAttribute') {
      fail(sourceName, `unsupported spread/expression attribute on <${node.name}>`);
    }
    if (attributes.has(attribute.name)) {
      fail(sourceName, `duplicate attribute ${attribute.name} on <${node.name}>`);
    }
    attributes.set(attribute.name, attribute);
  }
  return attributes;
}

function validateComponent(node, sourceName, importsByName) {
  if (!Object.hasOwn(COMPONENT_ADAPTERS, node.name)) {
    fail(sourceName, `unknown custom component <${node.name}>`);
  }
  const componentSource = importsByName.get(node.name);
  if (
    componentSource !== `../../components/${node.name}.astro` &&
    componentSource !== `../components/${node.name}.astro` &&
    componentSource !== `./${node.name}.astro`
  ) {
    fail(sourceName, `custom component <${node.name}> is not backed by an import`);
  }

  const attributes = attributeMap(node, sourceName);
  for (const attribute of attributes.values()) {
    if (typeof attribute.value === 'string' || attribute.value === null) continue;
    const expression = expressionNode(attribute);
    const staticImageIdentifier =
      node.name === 'PostImage' &&
      attribute.name === 'src' &&
      expression?.type === 'Identifier' &&
      /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(importsByName.get(expression.name) ?? '');
    if (!staticImageIdentifier && !isStaticExpression(expression)) {
      fail(sourceName, `unsupported expression for <${node.name}> attribute ${attribute.name}`);
    }
  }
}

function elementChildren(node) {
  const elements = [];
  for (const child of node.children ?? []) {
    if (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') {
      elements.push(child);
    } else if (child.type === 'paragraph') {
      elements.push(
        ...(child.children ?? []).filter(
          (nested) => nested.type === 'mdxJsxFlowElement' || nested.type === 'mdxJsxTextElement'
        )
      );
    }
  }
  return elements;
}

function staticAttributeValue(node, name) {
  const attribute = (node.attributes ?? []).find(
    (candidate) => candidate.type === 'mdxJsxAttribute' && candidate.name === name
  );
  return attribute?.value ?? null;
}

function assertExactAttributes(node, sourceName, allowedNames) {
  const attributes = attributeMap(node, sourceName);
  for (const name of attributes.keys()) {
    if (!allowedNames.has(name)) {
      fail(sourceName, `unknown semantic attribute ${name} on <${node.name}>`);
    }
  }
}

function assertArtifactElement(node, sourceName, name, className, allowedAttributes = []) {
  if (!node) {
    fail(sourceName, `artifact-callout is missing ${name}.${className}`);
  }
  const actualClass =
    staticAttributeValue(node, 'className') ?? staticAttributeValue(node, 'class');
  if (node?.name !== name || actualClass !== className) {
    fail(sourceName, `artifact-callout has an unknown ${name}.${className} hierarchy`);
  }
  assertExactAttributes(node, sourceName, new Set(['className', 'class', ...allowedAttributes]));
}

function validateArtifactCallout(node, sourceName) {
  const attributes = attributeMap(node, sourceName);
  if (attributes.has('class') === attributes.has('className')) {
    fail(sourceName, 'artifact-callout must have exactly one of class or className');
  }
  const className = attributes.get('className')?.value ?? attributes.get('class')?.value;
  if (node.name !== 'a' || className !== 'artifact-callout') {
    fail(sourceName, `unknown native JSX structure <${node.name}>`);
  }

  const href = attributes.get('href')?.value;
  if (typeof href !== 'string' || href.length === 0) {
    fail(sourceName, 'artifact-callout href must be a static non-empty string');
  }
  assertExactAttributes(node, sourceName, new Set(['className', 'class', 'href']));

  const [iconWrap, body, ...extra] = elementChildren(node);
  if (extra.length > 0) fail(sourceName, 'artifact-callout has extra element children');
  assertArtifactElement(iconWrap, sourceName, 'span', 'artifact-callout__icon-wrap');
  assertArtifactElement(body, sourceName, 'span', 'artifact-callout__body');

  const [icon, tap, ...iconExtra] = elementChildren(iconWrap);
  if (iconExtra.length > 0) fail(sourceName, 'artifact-callout icon wrapper has extra children');
  assertArtifactElement(icon, sourceName, 'span', 'artifact-callout__icon', ['aria-hidden']);
  if (staticAttributeValue(icon, 'aria-hidden') !== 'true') {
    fail(sourceName, 'artifact-callout icon must be aria-hidden');
  }
  assertArtifactElement(tap, sourceName, 'span', 'artifact-callout__tap');

  const [label, strong, meta, cta, ...bodyExtra] = elementChildren(body);
  if (bodyExtra.length > 0) fail(sourceName, 'artifact-callout body has extra children');
  assertArtifactElement(label, sourceName, 'span', 'artifact-callout__label');
  if (strong?.name !== 'strong' || (strong.attributes ?? []).length > 0) {
    fail(sourceName, 'artifact-callout must contain one unadorned strong label');
  }
  assertArtifactElement(meta, sourceName, 'span', 'artifact-callout__meta');
  assertArtifactElement(cta, sourceName, 'span', 'artifact-callout__cta');
  const [ctaLabel, ctaIcon, ...ctaExtra] = elementChildren(cta);
  if (
    ctaExtra.length > 0 ||
    ctaLabel?.name !== 'span' ||
    (ctaLabel.attributes ?? []).length > 0 ||
    ctaIcon?.name !== 'span' ||
    staticAttributeValue(ctaIcon, 'aria-hidden') !== 'true'
  ) {
    fail(sourceName, 'artifact-callout cta must contain its registered label and hidden icon');
  }
  assertExactAttributes(ctaIcon, sourceName, new Set(['aria-hidden']));
}

function walk(node, visitor, parent = null) {
  visitor(node, parent);
  for (const child of node.children ?? []) walk(child, visitor, node);
}

function stripFrontmatter(source) {
  if (!source.startsWith('---')) return source;
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? source.slice(match[0].length) : source;
}

/**
 * Parse raw MDX and fail closed when the source contains a component, native
 * JSX structure, or expression form that has no registered projection.
 */
export function inventoryMdx(source, { sourceName = '<mdx>' } = {}) {
  const tree = createProcessor({ format: 'mdx' }).parse(stripFrontmatter(source));
  const imports = [];
  const importsByName = new Map();

  walk(tree, (node) => {
    if (node.type !== 'mdxjsEsm') return;
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type !== 'ImportDeclaration') {
        fail(sourceName, 'only static import declarations are allowed in MDX ESM');
      }
      const specifiers = statement.specifiers.map((specifier) => specifier.local.name);
      for (const name of specifiers) importsByName.set(name, statement.source.value);
      imports.push({ source: statement.source.value, names: specifiers });
    }
  });

  const components = new Set();
  const componentCounts = new Map();
  const nativeElements = new Set();
  const nativeElementCounts = new Map();
  const expressionForms = new Set();

  const validatedArtifactNodes = new Set();
  walk(tree, (node, parent) => {
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      if (!/^\/\*[\s\S]*\*\/$/.test(node.value.trim())) {
        fail(sourceName, `unsupported content expression: {${node.value}}`);
      }
      expressionForms.add('comment');
      return;
    }
    if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
    if (!node.name) fail(sourceName, 'MDX fragments are not supported');

    if (/^[A-Z]/.test(node.name)) {
      validateComponent(node, sourceName, importsByName);
      components.add(node.name);
      componentCounts.set(node.name, (componentCounts.get(node.name) ?? 0) + 1);
      for (const attribute of node.attributes ?? []) {
        if (typeof attribute.value === 'object' && attribute.value !== null) {
          expressionForms.add(expressionNode(attribute)?.type ?? 'unknown');
        }
      }
      return;
    }

    if (
      node.name === 'a' &&
      (staticAttributeValue(node, 'className') === 'artifact-callout' ||
        staticAttributeValue(node, 'class') === 'artifact-callout')
    ) {
      validateArtifactCallout(node, sourceName);
      walk(node, (descendant) => validatedArtifactNodes.add(descendant));
      nativeElements.add('a.artifact-callout');
      nativeElementCounts.set(
        'a.artifact-callout',
        (nativeElementCounts.get('a.artifact-callout') ?? 0) + 1
      );
      return;
    }
    if (validatedArtifactNodes.has(node)) return;

    if (node.name === 'a') {
      assertExactAttributes(node, sourceName, new Set(['href']));
      const href = staticAttributeValue(node, 'href');
      if (typeof href !== 'string' || href.length === 0) {
        fail(sourceName, 'inline native <a> href must be a static non-empty string');
      }
      nativeElements.add('a');
      nativeElementCounts.set('a', (nativeElementCounts.get('a') ?? 0) + 1);
      return;
    }
    if (node.name === 'code') {
      assertExactAttributes(node, sourceName, new Set());
      nativeElements.add('code');
      nativeElementCounts.set('code', (nativeElementCounts.get('code') ?? 0) + 1);
      return;
    }
    fail(
      sourceName,
      `unknown native JSX structure <${node.name}> inside <${parent?.name ?? 'root'}>`
    );
  });

  return {
    imports,
    components: [...components].sort(),
    componentCounts: Object.fromEntries([...componentCounts].sort()),
    nativeElements: [...nativeElements].sort(),
    nativeElementCounts: Object.fromEntries([...nativeElementCounts].sort()),
    expressionForms: [...expressionForms].sort(),
  };
}

export function normalizeRenderedText(value) {
  return value.replaceAll('\u2060', '').replaceAll('\u00a0', ' ');
}

function hasClass(node, className) {
  return node.properties?.className?.includes(className) ?? false;
}

function findElements(node, predicate, matches = []) {
  if (node.type === 'element' && predicate(node)) matches.push(node);
  for (const child of node.children ?? []) findElements(child, predicate, matches);
  return matches;
}

function requiredElement(node, predicate, label, context) {
  const matches = findElements(node, predicate);
  if (matches.length !== 1) {
    fail(context.sourceName, `${label} expected exactly once, found ${matches.length}`);
  }
  return matches[0];
}

function rawText(node) {
  if (node.type === 'text') return normalizeRenderedText(node.value);
  return (node.children ?? []).map(rawText).join('');
}

function visibleText(node) {
  return rawText(node).replace(/\s+/g, ' ').trim();
}

function escapeInline(value) {
  return normalizeRenderedText(value)
    .replaceAll('\\', '\\\\')
    .replace(/([`*_[\]])/g, '\\$1')
    .replaceAll('<', '&lt;');
}

function absoluteUrl(value, baseUrl, label, context, allowedProtocols = ['http:', 'https:']) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(context.sourceName, `${label} must be a non-empty URL`);
  }
  let resolved;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    fail(context.sourceName, `${label} is invalid: ${JSON.stringify(value)}`);
  }
  if (!allowedProtocols.includes(resolved.protocol)) {
    fail(context.sourceName, `${label} uses unsupported protocol ${resolved.protocol}`);
  }
  return resolved.href;
}

function markdownBlockquote(markdown) {
  return markdown
    .trim()
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

function compactBlocks(markdown) {
  return normalizeRenderedText(markdown)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STANDARD_ATTRIBUTES = Object.freeze({
  a: new Set([
    'ariaDescribedBy',
    'ariaLabel',
    'className',
    'dataFootnoteBackref',
    'dataFootnoteRef',
    'href',
    'id',
  ]),
  blockquote: new Set(),
  br: new Set(),
  code: new Set(),
  em: new Set(),
  h1: new Set(['id']),
  h2: new Set(['className', 'id']),
  h3: new Set(['id']),
  h4: new Set(['id']),
  h5: new Set(['id']),
  h6: new Set(['id']),
  hr: new Set(),
  img: new Set(['alt', 'src']),
  li: new Set(['id']),
  ol: new Set(['start']),
  p: new Set(),
  pre: new Set(['className', 'dataLanguage', 'style', 'tabIndex']),
  section: new Set(['className', 'dataFootnotes']),
  span: new Set(['className', 'style']),
  strong: new Set(),
  sup: new Set(),
  table: new Set(),
  tbody: new Set(),
  td: new Set(),
  th: new Set(),
  thead: new Set(),
  tr: new Set(),
  ul: new Set(),
});

function isAstroAttribute(name) {
  return /^dataAstro/i.test(name);
}

function validateRenderedElement(node, context) {
  const allowed = STANDARD_ATTRIBUTES[node.tagName];
  if (!allowed) fail(context.sourceName, `unknown rendered element <${node.tagName}>`);
  for (const name of Object.keys(node.properties ?? {})) {
    if (!isAstroAttribute(name) && !allowed.has(name)) {
      fail(context.sourceName, `unknown rendered attribute ${name} on <${node.tagName}>`);
    }
  }

  const classes = node.properties?.className ?? [];
  if (
    (node.tagName === 'a' && classes.some((name) => name !== 'data-footnote-backref')) ||
    (node.tagName === 'h2' && classes.some((name) => name !== 'sr-only')) ||
    (node.tagName === 'pre' &&
      classes.some(
        (name) =>
          !['astro-code', 'astro-code-themes', 'solarized-light', 'dracula-soft'].includes(name)
      )) ||
    (node.tagName === 'section' && classes.some((name) => name !== 'footnotes')) ||
    (node.tagName === 'span' && classes.length > 0)
  ) {
    fail(
      context.sourceName,
      `unknown rendered semantic class on <${node.tagName}>: ${classes.join(' ')}`
    );
  }
}

const BLOCK_TAGS = new Set([
  'aside',
  'blockquote',
  'div',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'ol',
  'p',
  'pre',
  'script',
  'section',
  'table',
  'ul',
]);

function isBlockNode(node) {
  return (
    node?.type === 'element' &&
    (BLOCK_TAGS.has(node.tagName) ||
      node.properties?.dataMarkdownAdapter !== undefined ||
      hasClass(node, 'artifact-callout'))
  );
}

function projectChildren(node, context) {
  const children = node.children ?? [];
  return children
    .map((child, index) => {
      if (
        child.type === 'text' &&
        /^\s*$/.test(child.value) &&
        (isBlockNode(children[index - 1]) || isBlockNode(children[index + 1]))
      ) {
        return '';
      }
      return projectNode(child, context);
    })
    .join('');
}

function projectMoguNote(node, context) {
  const prefix = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'mogu-prefix'),
    'Mogu prefix',
    context
  );
  const content = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'mogu-note-content'),
    'Mogu content',
    context
  );
  const body = compactBlocks(projectChildren(content, context));
  return `${markdownBlockquote(`**${escapeInline(visibleText(prefix))}**\n\n${body}`)}\n\n`;
}

function projectShroomDogNote(node, context) {
  const prefix = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'shroomdog-prefix'),
    'ShroomDog prefix',
    context
  );
  const content = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'shroomdog-note-content'),
    'ShroomDog content',
    context
  );
  const body = compactBlocks(projectChildren(content, context));
  return `${markdownBlockquote(`**${escapeInline(visibleText(prefix))}**\n\n${body}`)}\n\n`;
}

function projectToggle(node, context) {
  const title = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'toggle-title'),
    'Toggle title',
    context
  );
  const content = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'toggle-content'),
    'Toggle content',
    context
  );
  return `**${escapeInline(visibleText(title))}**\n\n${compactBlocks(
    projectChildren(content, context)
  )}\n\n`;
}

function projectProgress(node, context) {
  const level = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'progress-level'),
    'Progress level',
    context
  );
  const titles = findElements(node, (candidate) => hasClass(candidate, 'progress-title'));
  const percentage = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'progress-percentage'),
    'Progress percentage',
    context
  );
  if (titles.length > 1) fail(context.sourceName, 'Progress title appears more than once');
  const parts = [
    visibleText(level),
    titles[0] && visibleText(titles[0]),
    visibleText(percentage),
  ].filter(Boolean);
  return `**${escapeInline(parts.join(' — '))}**\n\n`;
}

function projectQuiz(node, context) {
  const question = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'quiz-question'),
    'Quiz question',
    context
  );
  const options = findElements(node, (candidate) => hasClass(candidate, 'quiz-option'));
  if (options.length === 0) fail(context.sourceName, 'Quiz must contain at least one option');
  const answer = node.properties?.dataAnswer;
  if (typeof answer !== 'string' || answer.length === 0) {
    fail(context.sourceName, 'Quiz data-answer marker is missing');
  }
  const explanation = requiredElement(
    node,
    (candidate) =>
      hasClass(candidate, 'result-correct') &&
      findElements(candidate, (nested) => hasClass(nested, 'result-explanation')).length === 1,
    'Quiz correct result',
    context
  );
  const explanationText = requiredElement(
    explanation,
    (candidate) => hasClass(candidate, 'result-explanation'),
    'Quiz explanation',
    context
  );
  const optionLines = options.map((option) => {
    const label = requiredElement(
      option,
      (candidate) => hasClass(candidate, 'option-label'),
      'Quiz option label',
      context
    );
    const text = requiredElement(
      option,
      (candidate) => hasClass(candidate, 'option-text'),
      'Quiz option text',
      context
    );
    return `- ${escapeInline(visibleText(label))}. ${escapeInline(visibleText(text))}`;
  });
  return `**Quiz:** ${escapeInline(visibleText(question))}\n\n${optionLines.join(
    '\n'
  )}\n\n**Answer:** ${escapeInline(answer)} — ${escapeInline(visibleText(explanationText))}\n\n`;
}

function projectAnalogy(node, context) {
  const title = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'analogy-title'),
    'Analogy title',
    context
  );
  const content = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'analogy-content'),
    'Analogy content',
    context
  );
  return `${markdownBlockquote(
    `**${escapeInline(visibleText(title))}**\n\n${compactBlocks(projectChildren(content, context))}`
  )}\n\n`;
}

function projectMermaid(node, context) {
  const source = requiredElement(
    node,
    (candidate) => candidate.properties?.dataMermaid !== undefined,
    'Mermaid source',
    context
  );
  const captions = findElements(node, (candidate) => hasClass(candidate, 'mermaid-caption'));
  if (captions.length > 1) fail(context.sourceName, 'Mermaid caption appears more than once');
  const caption = captions[0] ? `\n\n_${escapeInline(visibleText(captions[0]))}_` : '';
  return `\`\`\`mermaid\n${rawText(source).trim()}\n\`\`\`${caption}\n\n`;
}

function projectPostImage(node, context) {
  const open = requiredElement(
    node,
    (candidate) => candidate.properties?.dataPostImageOpen !== undefined,
    'PostImage primary control',
    context
  );
  const image = requiredElement(
    open,
    (candidate) => candidate.tagName === 'img',
    'PostImage img',
    context
  );
  const alt = image.properties?.alt;
  if (typeof alt !== 'string' || alt.trim().length === 0) {
    fail(context.sourceName, 'PostImage alt must be meaningful');
  }
  const src = absoluteUrl(image.properties?.src, context.canonicalUrl, 'PostImage src', context);
  const captions = findElements(node, (candidate) => candidate.tagName === 'figcaption');
  if (captions.length > 1) fail(context.sourceName, 'PostImage caption appears more than once');
  const caption = captions[0] ? `\n\n_${escapeInline(visibleText(captions[0]))}_` : '';
  return `![${escapeInline(alt)}](${src})${caption}\n\n`;
}

function projectDiff(node, context) {
  const before = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'diff-before'),
    'Diff before panel',
    context
  );
  const after = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'diff-after'),
    'Diff after panel',
    context
  );
  const panel = (candidate) => {
    const label = requiredElement(
      candidate,
      (nested) => hasClass(nested, 'diff-label'),
      'Diff label',
      context
    );
    const body = requiredElement(
      candidate,
      (nested) => hasClass(nested, 'diff-body'),
      'Diff body',
      context
    );
    return `**${escapeInline(visibleText(label))}:** ${escapeInline(visibleText(body))}`;
  };
  return `${markdownBlockquote(`${panel(before)}\n\n${panel(after)}`)}\n\n`;
}

function projectLearningMap(node, context) {
  const title = node.properties?.ariaLabel;
  if (typeof title !== 'string' || title.length === 0) {
    fail(context.sourceName, 'CodexLearningMap aria-label is missing');
  }
  const bad = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'model-card') && hasClass(candidate, 'bad'),
    'Learning map wrong model',
    context
  );
  const good = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'model-card') && hasClass(candidate, 'good'),
    'Learning map useful model',
    context
  );
  const steps = requiredElement(
    node,
    (candidate) => candidate.tagName === 'ol' && hasClass(candidate, 'steps'),
    'Learning map steps',
    context
  );
  const stepLines = (steps.children ?? [])
    .filter((child) => child.type === 'element' && child.tagName === 'li')
    .map((step, index) => {
      const label = requiredElement(
        step,
        (candidate) => hasClass(candidate, 'step-label'),
        'Learning map step label',
        context
      );
      const goal = requiredElement(
        step,
        (candidate) => candidate.tagName === 'p',
        'Learning map step goal',
        context
      );
      const output = requiredElement(
        step,
        (candidate) => candidate.tagName === 'span',
        'Learning map step output',
        context
      );
      return `${index + 1}. **${escapeInline(visibleText(label))}** — ${escapeInline(
        visibleText(goal)
      )} _(${escapeInline(visibleText(output))})_`;
    });
  return `**${escapeInline(title)}**\n\n- ${escapeInline(visibleText(bad))}\n- ${escapeInline(
    visibleText(good)
  )}\n\n${stepLines.join('\n')}\n\n`;
}

function projectArtifactCallout(node, context) {
  const label = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'artifact-callout__label'),
    'Artifact callout label',
    context
  );
  const title = requiredElement(
    node,
    (candidate) => candidate.tagName === 'strong',
    'Artifact callout title',
    context
  );
  const meta = requiredElement(
    node,
    (candidate) => hasClass(candidate, 'artifact-callout__meta'),
    'Artifact callout metadata',
    context
  );
  const href = absoluteUrl(
    node.properties?.href,
    context.canonicalUrl,
    'artifact callout href',
    context
  );
  return `[${escapeInline(visibleText(title))}](${href}) — ${escapeInline(
    visibleText(label)
  )} — ${escapeInline(visibleText(meta))}\n\n`;
}

const RENDERED_ADAPTERS = Object.freeze({
  'mogu-note': projectMoguNote,
  'shroomdog-note': projectShroomDogNote,
  toggle: projectToggle,
  'level-up-progress': projectProgress,
  'level-up-quiz': projectQuiz,
  'analogy-box': projectAnalogy,
  mermaid: projectMermaid,
  'post-image': projectPostImage,
  'diff-block': projectDiff,
  'codex-learning-map': projectLearningMap,
});

function projectList(node, context, ordered) {
  const items = (node.children ?? []).filter(
    (child) => child.type === 'element' && child.tagName === 'li'
  );
  const start = ordered && Number.isInteger(node.properties?.start) ? node.properties.start : 1;
  return `${items
    .map((item, index) => {
      const content = compactBlocks(projectChildren(item, context));
      const marker = ordered ? `${start + index}.` : '-';
      return content
        .split('\n')
        .map((line, lineIndex) => `${lineIndex === 0 ? marker : '  '} ${line}`)
        .join('\n');
    })
    .join('\n')}\n\n`;
}

function projectTable(node, context) {
  const rows = findElements(node, (candidate) => candidate.tagName === 'tr');
  if (rows.length === 0) fail(context.sourceName, 'Rendered table has no rows');
  const projected = rows.map((row) =>
    (row.children ?? [])
      .filter(
        (child) => child.type === 'element' && (child.tagName === 'th' || child.tagName === 'td')
      )
      .map((cell) =>
        compactBlocks(projectChildren(cell, context)).replaceAll('|', '\\|').replaceAll('\n', ' ')
      )
  );
  const width = Math.max(...projected.map((row) => row.length));
  if (width === 0 || projected.some((row) => row.length !== width)) {
    fail(context.sourceName, 'Rendered table rows have inconsistent columns');
  }
  const [header, ...body] = projected;
  return `| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n${body
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')}\n\n`;
}

function codeFence(value, minimumLength = 3) {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(Math.max(minimumLength, longest + 1));
}

function projectNode(node, context) {
  if (node.type === 'text')
    return escapeInline(normalizeRenderedText(node.value).replace(/\s+/g, ' '));
  if (node.type === 'comment') return '';
  if (node.type !== 'element') {
    fail(context.sourceName, `unknown rendered node type ${node.type}`);
  }

  const adapter = node.properties?.dataMarkdownAdapter;
  if (adapter !== undefined) {
    const project = RENDERED_ADAPTERS[adapter];
    if (!project) fail(context.sourceName, `unknown rendered adapter marker ${adapter}`);
    return project(node, context);
  }
  if (hasClass(node, 'artifact-callout')) return projectArtifactCallout(node, context);

  if (
    (node.tagName === 'div' &&
      (hasClass(node, 'mermaid-overlay') || hasClass(node, 'mermaid-overlay-content'))) ||
    (node.tagName === 'button' && hasClass(node, 'mermaid-close-btn')) ||
    (node.tagName === 'script' && node.properties?.type === 'module')
  ) {
    return '';
  }
  if (node.tagName === 'div' && hasClass(node, 'post-content')) {
    return projectChildren(node, context);
  }

  validateRenderedElement(node, context);
  const children = () => projectChildren(node, context);
  switch (node.tagName) {
    case 'p':
      return `${children().trim()}\n\n`;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const originalDepth = Number(node.tagName.slice(1));
      const depth = originalDepth === 1 ? 2 : originalDepth;
      return `${'#'.repeat(depth)} ${children().trim()}\n\n`;
    }
    case 'strong':
      return `**${children().trim()}**`;
    case 'em':
      return `_${children().trim()}_`;
    case 'code': {
      const value = rawText(node);
      const ticks = codeFence(value, 1);
      return `${ticks}${value}${ticks}`;
    }
    case 'pre': {
      const value = rawText(node).replace(/\n$/, '');
      const language =
        typeof node.properties?.dataLanguage === 'string' &&
        /^[A-Za-z0-9_+-]*$/.test(node.properties.dataLanguage)
          ? node.properties.dataLanguage
          : '';
      const fence = codeFence(value);
      return `${fence}${language}\n${normalizeRenderedText(value)}\n${fence}\n\n`;
    }
    case 'a': {
      const href = absoluteUrl(
        node.properties?.href,
        context.canonicalUrl,
        'rendered link href',
        context,
        ['http:', 'https:', 'mailto:']
      );
      return `[${children().trim()}](${href})`;
    }
    case 'img': {
      const alt = node.properties?.alt;
      if (typeof alt !== 'string' || alt.trim().length === 0) {
        fail(context.sourceName, 'rendered image alt must be meaningful');
      }
      const src = absoluteUrl(
        node.properties?.src,
        context.canonicalUrl,
        'rendered image src',
        context
      );
      return `![${escapeInline(alt)}](${src})`;
    }
    case 'blockquote':
      return `${markdownBlockquote(compactBlocks(children()))}\n\n`;
    case 'ul':
      return projectList(node, context, false);
    case 'ol':
      return projectList(node, context, true);
    case 'li':
    case 'section':
    case 'span':
    case 'sup':
    case 'thead':
    case 'tbody':
    case 'tr':
    case 'th':
    case 'td':
      return children();
    case 'table':
      return projectTable(node, context);
    case 'br':
      return '\n';
    case 'hr':
      return '---\n\n';
    default:
      fail(context.sourceName, `unhandled rendered element <${node.tagName}>`);
  }
}

export const POST_JSON_V2_KEYS = Object.freeze(
  [
    'authorshipNote',
    'body',
    'headings',
    'lang',
    'originalDate',
    'schemaVersion',
    'slug',
    'source',
    'sourceUrl',
    'summary',
    'tags',
    'ticketId',
    'title',
    'translatedBy',
    'translatedDate',
    'url',
  ].sort()
);

function frontmatterData(rawMdx, sourceName) {
  const match = rawMdx.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail(sourceName, 'raw MDX frontmatter is missing');
  const data = parseYaml(match[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(sourceName, 'raw MDX frontmatter must be a mapping');
  }
  return data;
}

export function assertPostJsonV2(postJson, rawMdx, { sourceName = '<post>' } = {}) {
  if (!postJson || typeof postJson !== 'object' || Array.isArray(postJson)) {
    fail(sourceName, 'post JSON must be an object');
  }
  const keys = Object.keys(postJson).sort();
  if (JSON.stringify(keys) !== JSON.stringify(POST_JSON_V2_KEYS)) {
    fail(
      sourceName,
      `post JSON v2 keys changed: expected ${POST_JSON_V2_KEYS.join(', ')}, got ${keys.join(', ')}`
    );
  }
  if (postJson.schemaVersion !== 2) fail(sourceName, 'post JSON schemaVersion must remain 2');
  if (Object.hasOwn(postJson, 'status')) fail(sourceName, 'post JSON v2 must not expose status');
  if (
    typeof postJson.body !== 'string' ||
    postJson.body.trim() !== stripFrontmatter(rawMdx).trim()
  ) {
    fail(sourceName, 'post JSON body no longer matches raw MDX body');
  }
}

function markerValue(node, name) {
  const value = node.properties?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function validateStatus(article, context) {
  const status = markerValue(article, 'dataPostStatus');
  if (!['published', 'deprecated', 'retired'].includes(status)) {
    fail(context.sourceName, `article status marker is invalid: ${JSON.stringify(status)}`);
  }
  const replacementTicketId = markerValue(article, 'dataReplacementTicketId');
  const replacementUrlValue = markerValue(article, 'dataReplacementUrl');
  const replacementUrl = replacementUrlValue
    ? absoluteUrl(replacementUrlValue, context.canonicalUrl, 'article replacement URL', context)
    : null;

  if (
    (status === 'published' && (replacementTicketId !== null || replacementUrl !== null)) ||
    (status === 'deprecated' && (replacementTicketId === null || replacementUrl === null)) ||
    (status === 'retired' && (replacementTicketId !== null || replacementUrl !== null))
  ) {
    fail(context.sourceName, `article ${status} replacement marker contract is invalid`);
  }

  const banners = findElements(
    article,
    (candidate) => candidate.properties?.dataPostStatusBanner !== undefined
  );
  if (status === 'published') {
    if (banners.length !== 0)
      fail(context.sourceName, 'published article must not render a status banner');
  } else {
    if (banners.length !== 1) {
      fail(context.sourceName, `${status} article must render exactly one status banner`);
    }
    const banner = banners[0];
    if (
      markerValue(banner, 'dataStatus') !== status ||
      markerValue(banner, 'dataReplacementTicketId') !== replacementTicketId ||
      markerValue(banner, 'dataReplacementUrl') !== replacementUrl
    ) {
      fail(context.sourceName, 'article status marker and visible banner disagree');
    }
  }

  return { status, replacementTicketId, replacementUrl };
}

function validateProjectionCounts(postContent, inventory, context) {
  const renderedCounts = new Map();
  for (const node of findElements(
    postContent,
    (candidate) => candidate.properties?.dataMarkdownAdapter !== undefined
  )) {
    const adapter = node.properties.dataMarkdownAdapter;
    if (!Object.values(COMPONENT_ADAPTERS).includes(adapter)) {
      fail(context.sourceName, `rendered content has unknown adapter marker ${adapter}`);
    }
    renderedCounts.set(adapter, (renderedCounts.get(adapter) ?? 0) + 1);
  }

  for (const [component, adapter] of Object.entries(COMPONENT_ADAPTERS)) {
    const rawCount = inventory.componentCounts[component] ?? 0;
    const renderedCount = renderedCounts.get(adapter) ?? 0;
    if (rawCount !== renderedCount) {
      fail(
        context.sourceName,
        `projection mismatch for ${component}/${adapter}: raw=${rawCount}, rendered=${renderedCount}`
      );
    }
  }

  const rawCallouts = inventory.nativeElementCounts['a.artifact-callout'] ?? 0;
  const renderedCallouts = findElements(postContent, (candidate) =>
    hasClass(candidate, 'artifact-callout')
  ).length;
  if (rawCallouts !== renderedCallouts) {
    fail(
      context.sourceName,
      `projection mismatch for artifact-callout: raw=${rawCallouts}, rendered=${renderedCallouts}`
    );
  }
}

export function projectRenderedArticle({
  html,
  rawMdx,
  slug,
  lang,
  canonicalUrl,
  sourceName = slug,
}) {
  const tree = fromHtml(html);
  const context = { sourceName, canonicalUrl };
  const articles = findElements(
    tree,
    (candidate) => candidate.properties?.dataPostRepresentation !== undefined
  );
  if (articles.length !== 1) {
    fail(sourceName, `post representation marker expected exactly once, found ${articles.length}`);
  }
  const article = articles[0];
  if (
    markerValue(article, 'dataPostSlug') !== slug ||
    markerValue(article, 'dataPostLang') !== lang
  ) {
    fail(sourceName, 'article slug/lang marker does not match post metadata');
  }

  const alternateLinks = findElements(
    tree,
    (candidate) => candidate.properties?.dataPostMarkdownAlternate !== undefined
  );
  if (alternateLinks.length !== 1) {
    fail(sourceName, `Markdown alternate expected exactly once, found ${alternateLinks.length}`);
  }
  const alternate = alternateLinks[0];
  const expectedMarkdownUrl = `${canonicalUrl}.md`;
  if (
    alternate.tagName !== 'link' ||
    alternate.properties?.type !== 'text/markdown' ||
    absoluteUrl(alternate.properties?.href, canonicalUrl, 'Markdown alternate href', context) !==
      expectedMarkdownUrl
  ) {
    fail(sourceName, 'Markdown alternate does not match the canonical post representation');
  }

  const postContent = requiredElement(
    article,
    (candidate) => hasClass(candidate, 'post-content'),
    'post-content',
    context
  );
  const inventory = inventoryMdx(rawMdx, { sourceName });
  validateProjectionCounts(postContent, inventory, context);
  const status = validateStatus(article, context);
  const body = compactBlocks(projectChildren(postContent, context));
  if (body.length === 0) fail(sourceName, 'rendered Markdown body is empty');
  return { ...status, body, inventory, markdownUrl: expectedMarkdownUrl };
}

function assertCleanMarkdown(markdown, sourceName) {
  if (markdown.includes('\u2060') || markdown.includes('\u00a0')) {
    fail(sourceName, 'generated Markdown contains rendered-only Unicode controls');
  }
  const bodyOnly = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const outsideCode = [];
  let fenceLength = 0;
  let fenceOpening = null;
  for (const line of bodyOnly.split('\n')) {
    const fence = line.match(/^(`{3,})([^`]*)$/);
    if (fenceLength === 0 && fence) {
      fenceLength = fence[1].length;
      fenceOpening = line;
      continue;
    }
    if (fenceLength > 0 && new RegExp(`^\`{${fenceLength},}\\s*$`).test(line)) {
      fenceLength = 0;
      fenceOpening = null;
      continue;
    }
    if (fenceLength === 0) outsideCode.push(line);
  }
  if (fenceLength !== 0) {
    fail(
      sourceName,
      `generated Markdown contains an unclosed code fence opened by ${JSON.stringify(fenceOpening)}`
    );
  }
  const withoutCode = outsideCode
    .map((line) => {
      let output = '';
      for (let index = 0; index < line.length;) {
        if (line[index] !== '`' || line[index - 1] === '\\') {
          output += line[index];
          index += 1;
          continue;
        }
        let end = index;
        while (line[end] === '`') end += 1;
        const delimiter = line.slice(index, end);
        const closing = line.indexOf(delimiter, end);
        if (closing === -1) {
          output += delimiter;
          index = end;
        } else {
          index = closing + delimiter.length;
        }
      }
      return output;
    })
    .join('\n');
  if (
    /^\s*import\s/m.test(withoutCode) ||
    /<\/?[A-Za-z][^>\n]*>/.test(withoutCode) ||
    /<script\b/i.test(withoutCode)
  ) {
    fail(sourceName, 'generated Markdown contains residual MDX/JSX/script syntax');
  }
  const h1s = withoutCode.match(/^# /gm) ?? [];
  if (h1s.length !== 1) fail(sourceName, `generated Markdown must contain exactly one H1`);
}

export function serializeMarkdownArtifact({
  rawMdx,
  postJson,
  html,
  siteOrigin = 'https://gu-log.vercel.app',
  sourceName = postJson?.slug ?? '<post>',
}) {
  assertPostJsonV2(postJson, rawMdx, { sourceName });
  const canonicalUrl = absoluteUrl(postJson.url, siteOrigin, 'canonical post URL', {
    sourceName,
  }).replace(/\/$/, '');
  const projected = projectRenderedArticle({
    html,
    rawMdx,
    slug: postJson.slug,
    lang: postJson.lang,
    canonicalUrl,
    sourceName,
  });
  const rawData = frontmatterData(rawMdx, sourceName);
  const sourceUrl = absoluteUrl(postJson.sourceUrl, canonicalUrl, 'source URL', { sourceName });
  const author =
    typeof rawData.author === 'string' && rawData.author.trim() ? rawData.author : null;
  const authorshipNote =
    typeof postJson.authorshipNote === 'string' && postJson.authorshipNote.trim()
      ? postJson.authorshipNote
      : null;
  const metadata = {
    schemaVersion: 1,
    slug: postJson.slug,
    ticketId: postJson.ticketId,
    lang: postJson.lang,
    title: postJson.title,
    summary: postJson.summary,
    originalDate: postJson.originalDate,
    translatedDate: postJson.translatedDate,
    source: postJson.source,
    sourceUrl,
    author,
    authorshipNote,
    canonicalUrl,
    status: projected.status,
    replacementTicketId: projected.replacementTicketId,
    replacementUrl: projected.replacementUrl,
  };
  const statusNotice =
    projected.status === 'published'
      ? ''
      : postJson.lang === 'en'
        ? `> **Status: ${projected.status}.**${
            projected.replacementUrl
              ? ` Replacement: [${projected.replacementTicketId}](${projected.replacementUrl})`
              : ''
          }\n\n`
        : `> **狀態：${projected.status}。**${
            projected.replacementUrl
              ? ` 替代文章：[${projected.replacementTicketId}](${projected.replacementUrl})`
              : ''
          }\n\n`;
  const attributionParts = [
    `[${escapeInline(postJson.source)}](${sourceUrl})`,
    author && escapeInline(author),
    authorshipNote && escapeInline(authorshipNote),
  ].filter(Boolean);
  const attributionLabel = postJson.lang === 'en' ? 'Source' : '來源';
  const markdown = `---\n${stringifyYaml(metadata, { lineWidth: 0 }).trimEnd()}\n---\n\n# ${escapeInline(
    postJson.title
  )}\n\n${statusNotice}> **${attributionLabel}:** ${attributionParts.join(
    ' · '
  )}\n\n${projected.body}\n`;
  assertCleanMarkdown(markdown, sourceName);
  return { markdown, metadata, inventory: projected.inventory, markdownUrl: projected.markdownUrl };
}

export async function writeMarkdownArtifactAtomically(outputPath, markdown) {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, markdown, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}
