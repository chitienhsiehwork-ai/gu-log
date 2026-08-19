import { createProcessor } from '@mdx-js/mdx';
import { decodeHTML } from 'entities';
import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';

import { findEmojiSequences } from './emoji-sequences.mjs';
import { READER_REVISION_FRONTMATTER_KEYS, extractPostParts } from './reader-revision-core.mjs';

export {
  READER_REVISION_FRONTMATTER_KEYS,
  extractPostParts,
  readerRevisionCanonicalJSON,
  stableReaderValue,
} from './reader-revision-core.mjs';

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

function sourceLineForYamlNode(node, lineCounter, frontmatterStartLine) {
  const sourceLines = sourceLinesForYamlNode(node, lineCounter, frontmatterStartLine);
  const sourceLine = sourceLines.values().next().value;
  if (!Number.isInteger(sourceLine)) {
    throw new Error('reader-visible YAML node is missing a source range');
  }
  return sourceLine;
}

function sourceLinesForYamlNode(node, lineCounter, frontmatterStartLine) {
  const startOffset = node?.range?.[0];
  const endOffset = node?.range?.[1];
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) {
    throw new Error('reader-visible YAML node is missing a source range');
  }
  const firstLine = lineCounter.linePos(startOffset).line + frontmatterStartLine - 1;
  const lastLine =
    lineCounter.linePos(Math.max(startOffset, endOffset - 1)).line + frontmatterStartLine - 1;
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

function parseQuotedYamlFragment(fragment, quote, trimLeadingWhitespace) {
  let source = trimLeadingWhitespace ? fragment.trimStart() : fragment;
  let continuesOnNextLine = false;
  if (quote === '"') {
    let trailingBackslashes = 0;
    for (let index = source.length - 1; index >= 0 && source[index] === '\\'; index -= 1) {
      trailingBackslashes += 1;
    }
    // An odd trailing backslash escapes the physical line break in a YAML
    // double-quoted scalar. It contributes no reader-visible character.
    if (trailingBackslashes % 2 === 1) {
      source = source.slice(0, -1);
      continuesOnNextLine = true;
    }
  }

  const fragmentDocument = parseDocument(`${quote}${source}${quote}`);
  if (fragmentDocument.errors.length > 0 || !isScalar(fragmentDocument.contents)) {
    throw new Error('reader-visible multiline quoted YAML scalar could not be projected per line');
  }
  return { canonicalText: String(fragmentDocument.contents.value ?? ''), continuesOnNextLine };
}

function continuedPhysicalLineRecords(projectedLines, surfaceKind) {
  const records = [];
  for (let index = 0; index < projectedLines.length; index += 1) {
    const group = [projectedLines[index]];
    while (group.at(-1).continuesOnNextLine && index + 1 < projectedLines.length) {
      index += 1;
      group.push(projectedLines[index]);
    }
    if (group.length === 1) {
      const [line] = group;
      if (line.canonicalText.trim() !== '') {
        records.push({
          canonicalText: line.canonicalText,
          surfaceKind,
          sourceLine: line.sourceLine,
          sourceLines: new Set([line.sourceLine]),
        });
      }
      continue;
    }

    const canonicalText = group.map((line) => line.canonicalText).join('');
    const offsets = [];
    let offset = 0;
    for (const line of group) {
      offsets.push({ start: offset, end: offset + line.canonicalText.length });
      offset += line.canonicalText.length;
    }
    const localMatches = group.map(() => []);
    const crossLineRecords = [];
    for (const match of findEmojiSequences(canonicalText)) {
      const matchEnd = match.index + match.emoji.length;
      let lineIndexes = offsets.flatMap(({ start, end }, lineIndex) =>
        match.index < end && matchEnd > start ? [lineIndex] : []
      );
      if (lineIndexes.length === 1) {
        const lineIndex = lineIndexes[0];
        localMatches[lineIndex].push({
          ...match,
          index: match.index - offsets[lineIndex].start,
        });
        continue;
      }
      lineIndexes = Array.from(
        { length: lineIndexes.at(-1) - lineIndexes[0] + 1 },
        (_unused, spanIndex) => lineIndexes[0] + spanIndex
      );
      const sliceStart = offsets[lineIndexes[0]].start;
      const sliceEnd = offsets[lineIndexes.at(-1)].end;
      const sourceLines = new Set(lineIndexes.map((lineIndex) => group[lineIndex].sourceLine));
      crossLineRecords.push({
        canonicalText: canonicalText.slice(sliceStart, sliceEnd),
        surfaceKind,
        sourceLine: group[lineIndexes[0]].sourceLine,
        sourceLines,
        emojiMatches: [{ ...match, index: match.index - sliceStart }],
      });
    }
    for (const [lineIndex, line] of group.entries()) {
      if (line.canonicalText.trim() === '') continue;
      records.push({
        canonicalText: line.canonicalText,
        surfaceKind,
        sourceLine: line.sourceLine,
        sourceLines: new Set([line.sourceLine]),
        emojiMatches: localMatches[lineIndex],
      });
    }
    records.push(...crossLineRecords);
  }
  return records;
}

function quotedYamlLineRecords(node, surfaceKind, lineCounter, frontmatterStartLine) {
  const tokenType = node.srcToken?.type;
  if (tokenType !== 'double-quoted-scalar' && tokenType !== 'single-quoted-scalar') return null;
  const physicalLines = node.srcToken.source.split('\n');
  if (physicalLines.length === 1) return null;

  const quote = tokenType === 'double-quoted-scalar' ? '"' : "'";
  const firstSourceLine = sourceLineForYamlNode(node, lineCounter, frontmatterStartLine);
  const projectedLines = physicalLines.map((rawLine, index) => {
    let fragment = rawLine;
    if (index === 0 && fragment.startsWith(quote)) fragment = fragment.slice(1);
    if (index === physicalLines.length - 1 && fragment.endsWith(quote)) {
      fragment = fragment.slice(0, -1);
    }
    const sourceLine = firstSourceLine + index;
    return { ...parseQuotedYamlFragment(fragment, quote, index > 0), sourceLine };
  });

  return continuedPhysicalLineRecords(projectedLines, surfaceKind);
}

function plainYamlLineRecords(node, surfaceKind, lineCounter, frontmatterStartLine) {
  if (node.srcToken?.type !== 'scalar') return null;
  const physicalLines = node.srcToken.source.split('\n');
  if (physicalLines.length === 1) return null;

  const firstSourceLine = sourceLineForYamlNode(node, lineCounter, frontmatterStartLine);
  return physicalLines.flatMap((rawLine, index) => {
    // YAML folds plain-scalar line breaks to whitespace, so an emoji sequence
    // cannot span two physical lines. Attribute each visible fragment only to
    // the line that supplied it, matching the line-level ratchet.
    const canonicalText = rawLine.trim();
    if (canonicalText === '') return [];
    const sourceLine = firstSourceLine + index;
    return [{ canonicalText, surfaceKind, sourceLine, sourceLines: new Set([sourceLine]) }];
  });
}

function collectYamlValueRecords(
  node,
  surfaceKind,
  lineCounter,
  document,
  records,
  frontmatterStartLine
) {
  if (isScalar(node)) {
    if (node.value === null || node.value === undefined) return;
    const sourceLines = sourceLinesForYamlNode(node, lineCounter, frontmatterStartLine);
    if (node.srcToken?.type === 'block-scalar') {
      const sourceLine = sourceLineForYamlNode(node, lineCounter, frontmatterStartLine) + 1;
      for (const [index, line] of node.srcToken.source.split('\n').entries()) {
        if (line.trim() === '') continue;
        const physicalSourceLine = sourceLine + index;
        records.push({
          canonicalText: line.trimStart(),
          surfaceKind,
          sourceLine: physicalSourceLine,
          sourceLines: new Set([physicalSourceLine]),
        });
      }
      return;
    }
    const quotedLineRecords = quotedYamlLineRecords(
      node,
      surfaceKind,
      lineCounter,
      frontmatterStartLine
    );
    if (quotedLineRecords) {
      records.push(...quotedLineRecords);
      return;
    }
    const plainLineRecords = plainYamlLineRecords(
      node,
      surfaceKind,
      lineCounter,
      frontmatterStartLine
    );
    if (plainLineRecords) {
      records.push(...plainLineRecords);
      return;
    }
    const canonicalValue = String(node.value);
    const sourceLine = sourceLineForYamlNode(node, lineCounter, frontmatterStartLine);
    for (const line of canonicalValue.split('\n')) {
      if (line.trim() === '') continue;
      records.push({ canonicalText: line, surfaceKind, sourceLine, sourceLines });
    }
    return;
  }
  if (isAlias(node)) {
    const aliasSourceLine = sourceLineForYamlNode(node, lineCounter, frontmatterStartLine);
    const aliasSourceLines = sourceLinesForYamlNode(node, lineCounter, frontmatterStartLine);
    const target = node.resolve(document);
    if (target) {
      const targetRecords = [];
      collectYamlValueRecords(
        target,
        surfaceKind,
        lineCounter,
        document,
        targetRecords,
        frontmatterStartLine
      );
      for (const record of targetRecords) {
        records.push({
          ...record,
          sourceLines: new Set([
            ...(record.sourceLines ?? [record.sourceLine]),
            ...aliasSourceLines,
          ]),
        });
      }
      return;
    }
    collectResolvedYamlValue(
      node.toJS(document),
      surfaceKind,
      aliasSourceLine,
      aliasSourceLines,
      records
    );
    return;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      collectYamlValueRecords(
        pair.value,
        surfaceKind,
        lineCounter,
        document,
        records,
        frontmatterStartLine
      );
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      collectYamlValueRecords(
        item,
        surfaceKind,
        lineCounter,
        document,
        records,
        frontmatterStartLine
      );
    }
  }
}

function collectFrontmatterRecords({
  frontmatter,
  frontmatterRaw,
  frontmatterFormat,
  frontmatterStartLine,
}) {
  if (!frontmatterRaw) return [];
  if (frontmatterFormat === 'toml') {
    const sourceLines = new Set(
      Array.from(
        { length: frontmatterRaw.split('\n').length },
        (_unused, index) => frontmatterStartLine + index
      )
    );
    const records = [];
    for (const key of READER_VISIBLE_FRONTMATTER_KEYS) {
      if (frontmatter[key] === undefined) continue;
      collectResolvedYamlValue(
        frontmatter[key],
        `frontmatter.${key}`,
        frontmatterStartLine,
        sourceLines,
        records
      );
    }
    return records;
  }
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
      records,
      frontmatterStartLine
    );
  }
  return records;
}

function stripHtmlCommentsPreservingLines(value) {
  return value.replace(/<!--[\s\S]*?-->/gu, (comment) => comment.replace(/[^\n]/gu, ' '));
}

function isNonRenderingNode(node) {
  if (node.type === 'mdxjsEsm') return true;
  if (node.type === 'html') {
    return stripHtmlCommentsPreservingLines(node.value ?? '').trim() === '';
  }
  if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return false;
  const program = node.data?.estree;
  return program?.type === 'Program' && program.body?.length === 0;
}

function walk(node, visit) {
  if (visit(node) === false) return;
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child, visit);
}

function sourceLinesForEstreeNode(node, bodyStartLine) {
  const startLine = node?.loc?.start?.line;
  const endLine = node?.loc?.end?.line;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;
  const sourceLine = bodyStartLine + startLine - 1;
  return new Set(
    Array.from({ length: endLine - startLine + 1 }, (_unused, index) => sourceLine + index)
  );
}

function parseStaticTemplateFragment(fragment) {
  let source = fragment;
  let trailingBackslashes = 0;
  for (let index = source.length - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    trailingBackslashes += 1;
  }
  const continuesOnNextLine = trailingBackslashes % 2 === 1;
  if (continuesOnNextLine) source = source.slice(0, -1);

  const fragmentTree = createProcessor({ format: 'mdx' }).parse(`{\`${source}\`}`);
  const expression = fragmentTree.children?.[0]?.data?.estree?.body?.[0]?.expression;
  if (
    expression?.type !== 'TemplateLiteral' ||
    expression.expressions?.length !== 0 ||
    expression.quasis?.some((quasi) => typeof quasi.value?.cooked !== 'string')
  ) {
    throw new Error('reader-visible static template literal could not be projected per line');
  }
  return {
    canonicalText: expression.quasis.map((quasi) => quasi.value.cooked).join(''),
    continuesOnNextLine,
  };
}

function parseStaticStringFragment(fragment, quote) {
  let source = fragment;
  let trailingBackslashes = 0;
  for (let index = source.length - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    trailingBackslashes += 1;
  }
  const continuesOnNextLine = trailingBackslashes % 2 === 1;
  if (continuesOnNextLine) source = source.slice(0, -1);

  const fragmentTree = createProcessor({ format: 'mdx' }).parse(`{${quote}${source}${quote}}`);
  const expression = fragmentTree.children?.[0]?.data?.estree?.body?.[0]?.expression;
  if (expression?.type !== 'Literal' || typeof expression.value !== 'string') {
    throw new Error('reader-visible static string literal could not be projected per line');
  }
  return { canonicalText: expression.value, continuesOnNextLine };
}

function collectStaticStringValues(expression, values, bodyStartLine) {
  if (expression?.type === 'Literal') {
    if (typeof expression.value === 'string') {
      values.push({
        value: expression.value,
        literalRaw: expression.raw,
        sourceLines: sourceLinesForEstreeNode(expression, bodyStartLine),
      });
    } else if (
      expression.value !== null &&
      typeof expression.value !== 'number' &&
      typeof expression.value !== 'boolean' &&
      typeof expression.value !== 'bigint'
    ) {
      return false;
    }
    return true;
  }
  if (
    expression?.type === 'UnaryExpression' &&
    (expression.operator === '+' || expression.operator === '-') &&
    expression.argument?.type === 'Literal' &&
    (typeof expression.argument.value === 'number' || typeof expression.argument.value === 'bigint')
  ) {
    return true;
  }
  if (expression?.type === 'TemplateLiteral') {
    if (expression.expressions?.length !== 0) return false;
    const cooked = expression.quasis?.map((quasi) => quasi.value?.cooked);
    if (!cooked || cooked.some((value) => typeof value !== 'string')) return false;
    values.push({
      value: cooked.join(''),
      sourceLines: sourceLinesForEstreeNode(expression, bodyStartLine),
      templateRaw: expression.quasis.map((quasi) => quasi.value.raw).join(''),
    });
    return true;
  }
  if (expression?.type === 'ArrayExpression') {
    for (const element of expression.elements ?? []) {
      if (element === null) continue;
      if (
        element.type === 'SpreadElement' ||
        !collectStaticStringValues(element, values, bodyStartLine)
      ) {
        return false;
      }
    }
    return true;
  }
  if (expression?.type === 'ObjectExpression') {
    for (const property of expression.properties ?? []) {
      if (
        property.type !== 'Property' ||
        property.kind !== 'init' ||
        property.method ||
        property.computed ||
        !collectStaticStringValues(property.value, values, bodyStartLine)
      ) {
        return false;
      }
      if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
        values.push({
          literalRaw: property.key.raw,
          value: property.key.value,
          sourceLines: sourceLinesForEstreeNode(property.key, bodyStartLine),
        });
      }
    }
    return true;
  }
  return false;
}

function staticStringsFromExpression(node, bodyStartLine) {
  const program = node?.data?.estree;
  if (program?.type !== 'Program' || program.body?.length !== 1) return null;
  const statement = program.body[0];
  if (statement?.type !== 'ExpressionStatement') return null;
  const values = [];
  return collectStaticStringValues(statement.expression, values, bodyStartLine) ? values : null;
}

function collectBodyRecords(body, bodyStartLine, format) {
  const tree = createProcessor({ format }).parse(body);
  const bodyLines = body.split('\n');
  const records = [];
  const definitions = new Map();

  walk(tree, (node) => {
    if (node.type !== 'definition' || definitions.has(node.identifier)) return;
    definitions.set(node.identifier, node);
  });

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

  function pushValue(value, node, lineOffset = 0, sourceLinesOverride = null) {
    if (typeof value !== 'string' || value === '') return;
    const fallbackLocation = sourceLocation(node);
    const sourceLines = sourceLinesOverride ?? fallbackLocation.sourceLines;
    const sourceLine = sourceLinesOverride
      ? sourceLines.values().next().value
      : fallbackLocation.sourceLine;
    for (const [index, line] of value.split('\n').entries()) {
      if (line.trim() === '') continue;
      const renderedLine = sourceLine + lineOffset + index;
      records.push({
        canonicalText: line,
        surfaceKind: 'mdx',
        sourceLine: sourceLines.has(renderedLine) ? renderedLine : sourceLine,
        sourceLines:
          sourceLinesOverride || !sourceLines.has(renderedLine)
            ? sourceLines
            : new Set([renderedLine]),
      });
    }
  }

  function rawSource(node) {
    const startOffset = node.position?.start?.offset;
    const endOffset = node.position?.end?.offset;
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return null;
    return body.slice(startOffset, endOffset);
  }

  function pushDecodedPhysicalValue(
    value,
    node,
    rawValue,
    firstSourceLine = sourceLocation(node).sourceLine,
    associatedSourceLines = []
  ) {
    if (typeof value !== 'string' || value === '' || typeof rawValue !== 'string') return false;
    const canonicalLines = value.split('\n');
    const physicalLines = rawValue.split('\n');
    const canonicalLineCounts = physicalLines.map(
      (rawLine) => decodeHTML(rawLine).split('\n').length
    );
    if (canonicalLineCounts.reduce((sum, count) => sum + count, 0) !== canonicalLines.length) {
      return false;
    }

    let canonicalLineIndex = 0;
    for (const [physicalLineIndex, canonicalLineCount] of canonicalLineCounts.entries()) {
      const sourceLine = firstSourceLine + physicalLineIndex;
      for (let index = 0; index < canonicalLineCount; index += 1) {
        const canonicalText = canonicalLines[canonicalLineIndex];
        canonicalLineIndex += 1;
        if (canonicalText.trim() === '') continue;
        records.push({
          canonicalText,
          surfaceKind: 'mdx',
          sourceLine,
          sourceLines: new Set([sourceLine, ...associatedSourceLines]),
        });
      }
    }
    return true;
  }

  function markdownImageAltSource(node) {
    const source = rawSource(node);
    if (!source?.startsWith('![')) return null;
    let depth = 1;
    for (let index = 2; index < source.length; index += 1) {
      if (source[index] === '\\') {
        index += 1;
        continue;
      }
      if (source[index] === '[') depth += 1;
      else if (source[index] === ']') {
        depth -= 1;
        if (depth === 0) return source.slice(2, index);
      }
    }
    return null;
  }

  function quotedAttributeSource(node) {
    const source = rawSource(node);
    if (source === null) return null;
    const equalsIndex = source.indexOf('=');
    if (equalsIndex < 0) return null;
    let openingIndex = equalsIndex + 1;
    while (/\s/u.test(source[openingIndex] ?? '')) openingIndex += 1;
    const quote = source[openingIndex];
    if ((quote !== '"' && quote !== "'") || source.at(-1) !== quote) return null;
    return {
      rawValue: source.slice(openingIndex + 1, -1),
      firstSourceLine:
        sourceLocation(node).sourceLine + source.slice(0, openingIndex + 1).split('\n').length - 1,
    };
  }

  function pushHtmlValue(value, node) {
    const { sourceLine } = sourceLocation(node);
    for (const [index, rawLine] of value.split('\n').entries()) {
      const physicalSourceLine = sourceLine + index;
      pushValue(decodeHTML(rawLine), node, 0, new Set([physicalSourceLine]));
    }
  }

  function pushStaticValue(record, fallbackNode) {
    const sourceLines = record.sourceLines ?? sourceLocation(fallbackNode).sourceLines;
    const literalPhysicalLines = record.literalRaw?.split('\n');
    if (literalPhysicalLines?.length > 1) {
      const quote = literalPhysicalLines[0].at(0);
      if ((quote !== '"' && quote !== "'") || literalPhysicalLines.at(-1).at(-1) !== quote) {
        throw new Error('reader-visible static string literal is missing matching quotes');
      }
      const firstSourceLine = sourceLines.values().next().value;
      const projectedLines = literalPhysicalLines.map((rawLine, index) => {
        let fragment = rawLine;
        if (index === 0) fragment = fragment.slice(1);
        if (index === literalPhysicalLines.length - 1) fragment = fragment.slice(0, -1);
        return {
          ...parseStaticStringFragment(fragment, quote),
          sourceLine: firstSourceLine + index,
        };
      });
      records.push(...continuedPhysicalLineRecords(projectedLines, 'mdx'));
      return;
    }
    const templatePhysicalLines = record.templateRaw?.split('\n');
    if (templatePhysicalLines?.length > 1) {
      const firstSourceLine = sourceLines.values().next().value;
      const projectedLines = templatePhysicalLines.map((rawLine, index) => ({
        ...parseStaticTemplateFragment(rawLine),
        sourceLine: firstSourceLine + index,
      }));
      records.push(...continuedPhysicalLineRecords(projectedLines, 'mdx'));
      return;
    }
    pushValue(record.value, fallbackNode, 0, sourceLines);
  }

  function pushUnresolvedExpression(node, surfaceKind) {
    const { sourceLine, sourceLines } = sourceLocation(node);
    records.push({
      canonicalText: '',
      surfaceKind,
      sourceLine,
      sourceLines,
      unresolvedExpression:
        typeof node.value === 'string'
          ? node.value.trim()
          : typeof node.value?.value === 'string'
            ? node.value.value.trim()
            : '',
    });
  }

  function pushUnsafeExecutable(node, surfaceKind) {
    const { sourceLine, sourceLines } = sourceLocation(node);
    records.push({
      canonicalText: '',
      surfaceKind,
      sourceLine,
      sourceLines,
      unsafeExecutable: rawSource(node)?.trim() ?? '',
    });
  }

  function markdownTitleSource(node, stripContainerCloser = false) {
    const startOffset = node.position?.start?.offset;
    const endOffset = node.position?.end?.offset;
    const startLine = node.position?.start?.line;
    if (
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      !Number.isInteger(startLine)
    ) {
      return null;
    }

    let source = body.slice(startOffset, endOffset).trimEnd();
    if (stripContainerCloser && source.endsWith(')')) source = source.slice(0, -1).trimEnd();
    const closing = source.at(-1);
    let openingIndex = -1;
    if (closing === '"' || closing === "'") {
      for (let index = source.length - 2; index >= 0; index -= 1) {
        if (source[index] !== closing) continue;
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
          backslashes += 1;
        }
        if (backslashes % 2 === 0) {
          openingIndex = index;
          break;
        }
      }
    } else if (closing === ')') {
      let depth = 1;
      for (let index = source.length - 2; index >= 0; index -= 1) {
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
          backslashes += 1;
        }
        if (backslashes % 2 !== 0) continue;
        if (source[index] === ')') depth += 1;
        else if (source[index] === '(') {
          depth -= 1;
          if (depth === 0) {
            openingIndex = index;
            break;
          }
        }
      }
    }
    if (openingIndex < 0) return null;

    const precedingLines = source.slice(0, openingIndex).split('\n').length - 1;
    const titleLineCount = source.slice(openingIndex).split('\n').length;
    const firstLine = bodyStartLine + startLine - 1 + precedingLines;
    return {
      rawValue: source.slice(openingIndex + 1, -1),
      firstSourceLine: firstLine,
      sourceLines: new Set(
        Array.from({ length: titleLineCount }, (_unused, index) => firstLine + index)
      ),
    };
  }

  function pushMarkdownTitle(title, node, titleSource, associatedSourceLines = []) {
    if (!title) return;
    if (titleSource === null) {
      pushValue(
        title,
        node,
        0,
        new Set([...sourceLocation(node).sourceLines, ...associatedSourceLines])
      );
      return;
    }
    if (
      pushDecodedPhysicalValue(
        title,
        node,
        titleSource.rawValue,
        titleSource.firstSourceLine,
        associatedSourceLines
      )
    ) {
      return;
    }
    const physicalTitleLines = [...titleSource.sourceLines];
    const canonicalTitleLines = title.split('\n');
    if (canonicalTitleLines.length !== physicalTitleLines.length) {
      pushValue(title, node, 0, new Set([...physicalTitleLines, ...associatedSourceLines]));
      return;
    }
    for (const [index, line] of canonicalTitleLines.entries()) {
      if (line.trim() === '') continue;
      const sourceLine = physicalTitleLines[index];
      records.push({
        canonicalText: line,
        surfaceKind: 'mdx',
        sourceLine,
        sourceLines: new Set([sourceLine, ...associatedSourceLines]),
      });
    }
  }

  function pushInlineTitle(node) {
    if (!node.title) return;
    pushMarkdownTitle(node.title, node, markdownTitleSource(node, true));
  }

  function pushReferenceTitle(node) {
    const definition = definitions.get(node.identifier);
    if (!definition?.title) return;
    const referenceLines = sourceLocation(node).sourceLines;
    pushMarkdownTitle(
      definition.title,
      definition,
      markdownTitleSource(definition),
      referenceLines
    );
  }

  walk(tree, (node) => {
    if (isNonRenderingNode(node)) return;
    if (node.type === 'text' || node.type === 'inlineCode') {
      if (node.type === 'text' && pushDecodedPhysicalValue(node.value, node, rawSource(node)))
        return;
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
      if (!pushDecodedPhysicalValue(node.alt, node, markdownImageAltSource(node))) {
        pushValue(node.alt, node);
      }
      pushInlineTitle(node);
      return;
    }
    if (node.type === 'imageReference') {
      if (!pushDecodedPhysicalValue(node.alt, node, markdownImageAltSource(node))) {
        pushValue(node.alt, node);
      }
      pushReferenceTitle(node);
      return;
    }
    if (node.type === 'link') {
      pushInlineTitle(node);
      return;
    }
    if (node.type === 'linkReference') {
      pushReferenceTitle(node);
      return;
    }
    if (node.type === 'html') {
      const visibleHtml = stripHtmlCommentsPreservingLines(node.value ?? '');
      if (/<(?:style|script)\b/iu.test(visibleHtml)) {
        pushUnsafeExecutable(node, 'html.executable');
        return;
      }
      pushHtmlValue(visibleHtml, node);
      return;
    }
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      const staticValues = staticStringsFromExpression(node, bodyStartLine);
      if (staticValues === null) pushUnresolvedExpression(node, 'mdx.expression');
      else for (const value of staticValues) pushStaticValue(value, node);
      return;
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      if (typeof node.name === 'string' && /^(?:style|script)$/iu.test(node.name)) {
        pushUnsafeExecutable(node, `mdx.element.${node.name.toLowerCase()}`);
        return false;
      }
      for (const attribute of node.attributes ?? []) {
        if (attribute.type === 'mdxJsxExpressionAttribute') {
          pushUnresolvedExpression(attribute, 'mdx.spread-attribute');
          continue;
        }
        if (attribute.type !== 'mdxJsxAttribute') continue;
        if (typeof attribute.value === 'string') {
          const quotedSource = quotedAttributeSource(attribute);
          if (
            !quotedSource ||
            !pushDecodedPhysicalValue(
              attribute.value,
              attribute,
              quotedSource.rawValue,
              quotedSource.firstSourceLine
            )
          ) {
            pushValue(attribute.value, attribute);
          }
        } else if (attribute.value?.type === 'mdxJsxAttributeValueExpression') {
          const staticValues = staticStringsFromExpression(attribute.value, bodyStartLine);
          if (staticValues === null) {
            pushUnresolvedExpression(attribute, `mdx.attribute.${attribute.name}`);
          } else for (const value of staticValues) pushStaticValue(value, attribute);
        }
      }
    }
  });
  return records;
}

export function collectReaderSurfaceLineRecords(content, { format = 'mdx' } = {}) {
  if (format !== 'md' && format !== 'mdx') {
    throw new Error(`reader-surface format 無效：${JSON.stringify(format)}`);
  }
  const {
    frontmatter,
    frontmatterRaw,
    frontmatterFormat,
    frontmatterStartLine,
    body,
    bodyStartLine,
  } = extractPostParts(content);
  return [
    ...collectFrontmatterRecords({
      frontmatter,
      frontmatterRaw,
      frontmatterFormat,
      frontmatterStartLine,
    }),
    ...collectBodyRecords(body, bodyStartLine, format),
  ];
}
