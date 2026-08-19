import { createProcessor } from '@mdx-js/mdx';
import { LineCounter, isAlias, isMap, isScalar, isSeq, parse, parseDocument } from 'yaml';

// This legacy hash projection is intentionally frozen. Expanding the emoji
// policy surface must not invalidate every existing Reader Tracker record.
export const READER_REVISION_FRONTMATTER_KEYS = Object.freeze([
  'ticketId',
  'title',
  'originalDate',
  'translatedDate',
  'source',
  'sourceUrl',
  'author',
  'summary',
  'lang',
  'tags',
  'status',
  'deprecatedBy',
  'deprecatedReason',
  'retiredReason',
  'retiredAt',
  'series',
]);

// Values from these fields are rendered by the zh-tw/en article pages,
// banners, navigation, or technical-details panel. Keep this list aligned
// with those consumers rather than treating machine-only frontmatter as prose.
export const READER_VISIBLE_FRONTMATTER_KEYS = Object.freeze([
  ...READER_REVISION_FRONTMATTER_KEYS,
  'warnReason',
  'warnOverrideComment',
  'translatedBy',
  'stage4Scores',
  'scores',
]);

const READER_VISIBLE_FRONTMATTER_KEY_SET = new Set(READER_VISIBLE_FRONTMATTER_KEYS);

export function extractPostParts(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      frontmatter: {},
      frontmatterRaw: '',
      body: content,
      bodyStartLine: 1,
    };
  }
  return {
    frontmatter: parse(match[1]) ?? {},
    frontmatterRaw: match[1],
    body: content.slice(match[0].length),
    bodyStartLine: match[0].split('\n').length,
  };
}

export function stableReaderValue(value) {
  if (Array.isArray(value)) return value.map(stableReaderValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableReaderValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function readerRevisionCanonicalJSON(frontmatter, body) {
  const readerVisibleFrontmatter = {};
  for (const key of READER_REVISION_FRONTMATTER_KEYS) {
    if (frontmatter[key] !== undefined) {
      readerVisibleFrontmatter[key] = stableReaderValue(frontmatter[key]);
    }
  }
  return JSON.stringify({ frontmatter: readerVisibleFrontmatter, body }, null, 2);
}

function sourceLineForYamlNode(node, lineCounter) {
  const sourceLines = sourceLinesForYamlNode(node, lineCounter);
  const sourceLine = sourceLines.values().next().value;
  if (!Number.isInteger(sourceLine)) {
    throw new Error('reader-visible YAML node is missing a source range');
  }
  return sourceLine;
}

function sourceLinesForYamlNode(node, lineCounter) {
  const startOffset = node?.range?.[0];
  const endOffset = node?.range?.[1];
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) {
    throw new Error('reader-visible YAML node is missing a source range');
  }
  // frontmatterRaw starts on MDX source line 2.
  const firstLine = lineCounter.linePos(startOffset).line + 1;
  const lastLine = lineCounter.linePos(Math.max(startOffset, endOffset - 1)).line + 1;
  return new Set(
    Array.from({ length: lastLine - firstLine + 1 }, (_unused, index) => firstLine + index)
  );
}

function collectResolvedYamlValue(value, surfaceKind, sourceLine, sourceLines, records) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectResolvedYamlValue(item, surfaceKind, sourceLine, sourceLines, records);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectResolvedYamlValue(item, surfaceKind, sourceLine, sourceLines, records);
    }
    return;
  }
  if (value === null || value === undefined) return;
  const canonicalValue = String(value);
  if (canonicalValue.trim() !== '') {
    records.push({ canonicalText: canonicalValue, surfaceKind, sourceLine, sourceLines });
  }
}

function collectYamlValueRecords(node, surfaceKind, lineCounter, document, records) {
  if (isScalar(node)) {
    if (node.value === null || node.value === undefined) return;
    const sourceLines = sourceLinesForYamlNode(node, lineCounter);
    if (node.srcToken?.type === 'block-scalar') {
      const sourceLine = sourceLineForYamlNode(node, lineCounter) + 1;
      for (const [index, line] of node.srcToken.source.split('\n').entries()) {
        if (line.trim() === '') continue;
        records.push({
          canonicalText: line.trimStart(),
          surfaceKind,
          sourceLine: sourceLine + index,
          sourceLines,
        });
      }
      return;
    }
    const canonicalValue = String(node.value);
    const sourceLine = sourceLineForYamlNode(node, lineCounter);
    for (const line of canonicalValue.split('\n')) {
      if (line.trim() === '') continue;
      records.push({ canonicalText: line, surfaceKind, sourceLine, sourceLines });
    }
    return;
  }
  if (isAlias(node)) {
    const sourceLine = sourceLineForYamlNode(node, lineCounter);
    const sourceLines = sourceLinesForYamlNode(node, lineCounter);
    const target = node.resolve(document);
    if (target) {
      for (const targetLine of sourceLinesForYamlNode(target, lineCounter)) {
        sourceLines.add(targetLine);
      }
    }
    collectResolvedYamlValue(node.toJS(document), surfaceKind, sourceLine, sourceLines, records);
    return;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      collectYamlValueRecords(pair.value, surfaceKind, lineCounter, document, records);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      collectYamlValueRecords(item, surfaceKind, lineCounter, document, records);
    }
  }
}

function collectFrontmatterRecords(frontmatterRaw) {
  if (!frontmatterRaw) return [];
  const lineCounter = new LineCounter();
  const document = parseDocument(frontmatterRaw, { keepSourceTokens: true, lineCounter });
  if (document.errors.length > 0) throw document.errors[0];
  if (!isMap(document.contents)) return [];

  const records = [];
  for (const pair of document.contents.items) {
    const topLevelKey = isScalar(pair.key) ? String(pair.key.value) : '';
    if (!READER_VISIBLE_FRONTMATTER_KEY_SET.has(topLevelKey)) continue;
    collectYamlValueRecords(
      pair.value,
      `frontmatter.${topLevelKey}`,
      lineCounter,
      document,
      records
    );
  }
  return records;
}

function isNonRenderingNode(node) {
  if (node.type === 'mdxjsEsm') return true;
  if (node.type === 'html') return /^\s*<!--[\s\S]*-->\s*$/.test(node.value ?? '');
  if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return false;
  const value = (node.value ?? '').trim();
  return /^\/\*[\s\S]*\*\/$/.test(value) || /^\/\//.test(value);
}

function walk(node, visit) {
  visit(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child, visit);
}

function decodeNumericCharacterReferences(value) {
  return value.replace(/&#(?:x([\da-f]+)|(\d+));/giu, (reference, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return reference;
    return String.fromCodePoint(codePoint);
  });
}

function staticStringFromExpression(node) {
  const program = node?.data?.estree;
  if (program?.type !== 'Program' || program.body?.length !== 1) return null;
  const statement = program.body[0];
  if (statement?.type !== 'ExpressionStatement') return null;
  const expression = statement.expression;
  if (expression?.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value;
  }
  if (
    expression?.type === 'TemplateLiteral' &&
    expression.expressions?.length === 0 &&
    expression.quasis?.length === 1 &&
    typeof expression.quasis[0]?.value?.cooked === 'string'
  ) {
    return expression.quasis[0].value.cooked;
  }
  return null;
}

function collectBodyRecords(body, bodyStartLine) {
  const tree = createProcessor({ format: 'mdx' }).parse(body);
  const bodyLines = body.split('\n');
  const records = [];

  function sourceLocation(node) {
    const startLine = node.position?.start?.line;
    const endLine = node.position?.end?.line;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
      throw new Error(`reader-surface node ${node.type} is missing a source line`);
    }
    const sourceLine = bodyStartLine + startLine - 1;
    return {
      sourceLine,
      sourceLines: new Set(
        Array.from({ length: endLine - startLine + 1 }, (_unused, index) => sourceLine + index)
      ),
    };
  }

  function pushValue(value, node, lineOffset = 0) {
    if (typeof value !== 'string' || value === '') return;
    const { sourceLine } = sourceLocation(node);
    for (const [index, line] of value.split('\n').entries()) {
      if (line.trim() === '') continue;
      records.push({
        canonicalText: line,
        surfaceKind: 'mdx',
        sourceLine: sourceLine + lineOffset + index,
      });
    }
  }

  function pushUnresolvedExpression(node, surfaceKind) {
    const { sourceLine, sourceLines } = sourceLocation(node);
    records.push({
      canonicalText: '',
      surfaceKind,
      sourceLine,
      sourceLines,
      unresolvedExpression: typeof node.value === 'string' ? node.value.trim() : '',
    });
  }

  walk(tree, (node) => {
    if (isNonRenderingNode(node)) return;
    if (node.type === 'text' || node.type === 'inlineCode') {
      pushValue(node.value, node);
      return;
    }
    if (node.type === 'code') {
      const startLine = node.position?.start?.line;
      const rawStart = Number.isInteger(startLine) ? (bodyLines[startLine - 1] ?? '') : '';
      pushValue(node.value, node, /^\s*(?:`{3,}|~{3,})/.test(rawStart) ? 1 : 0);
      return;
    }
    if (node.type === 'image') {
      pushValue(node.alt, node);
      pushValue(node.title, node);
      return;
    }
    if (node.type === 'link') {
      pushValue(node.title, node);
      return;
    }
    if (node.type === 'html') {
      pushValue(decodeNumericCharacterReferences(node.value ?? ''), node);
      return;
    }
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      const staticValue = staticStringFromExpression(node);
      if (staticValue === null) pushUnresolvedExpression(node, 'mdx.expression');
      else pushValue(staticValue, node);
      return;
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.type === 'mdxJsxExpressionAttribute') {
          pushUnresolvedExpression(attribute, 'mdx.spread-attribute');
          continue;
        }
        if (attribute.type !== 'mdxJsxAttribute') continue;
        if (typeof attribute.value === 'string') pushValue(attribute.value, attribute);
        else if (attribute.value?.type === 'mdxJsxAttributeValueExpression') {
          const staticValue = staticStringFromExpression(attribute.value);
          if (staticValue === null) {
            pushUnresolvedExpression(attribute, `mdx.attribute.${attribute.name}`);
          } else pushValue(staticValue, attribute);
        }
      }
    }
  });
  return records;
}

export function collectReaderSurfaceLineRecords(content) {
  const { frontmatterRaw, body, bodyStartLine } = extractPostParts(content);
  return [...collectFrontmatterRecords(frontmatterRaw), ...collectBodyRecords(body, bodyStartLine)];
}
