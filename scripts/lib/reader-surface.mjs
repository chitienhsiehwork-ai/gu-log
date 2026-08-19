import { createProcessor } from '@mdx-js/mdx';
import { decodeHTML } from 'entities';
import { DecodingMode, EntityDecoder, htmlDecodeTree } from 'entities/decode';
import { fromHtml } from 'hast-util-from-html';
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

const TOML_ESCAPE_VALUES = Object.freeze({
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  e: '\x1b',
  '"': '"',
  '\\': '\\',
});

function decodeTomlEscape(source, backslashIndex) {
  const kind = source[backslashIndex + 1];
  const digits = kind === 'x' ? 2 : kind === 'u' ? 4 : kind === 'U' ? 8 : 0;
  if (digits > 0) {
    const hex = source.slice(backslashIndex + 2, backslashIndex + 2 + digits);
    if (/^[0-9a-f]+$/iu.test(hex) && hex.length === digits) {
      return {
        value: String.fromCodePoint(Number.parseInt(hex, 16)),
        nextIndex: backslashIndex + 2 + digits,
      };
    }
  }
  return {
    value: TOML_ESCAPE_VALUES[kind] ?? kind ?? '',
    nextIndex: backslashIndex + Math.min(2, source.length - backslashIndex),
  };
}

function firstTomlKey(source) {
  const trimmed = source.trimStart();
  if (trimmed.startsWith('"')) {
    let value = '';
    for (let index = 1; index < trimmed.length;) {
      if (trimmed[index] === '"') return value;
      if (trimmed[index] === '\\') {
        const decoded = decodeTomlEscape(trimmed, index);
        value += decoded.value;
        index = decoded.nextIndex;
      } else {
        value += trimmed[index];
        index += 1;
      }
    }
    return '';
  }
  if (trimmed.startsWith("'")) {
    const endIndex = trimmed.indexOf("'", 1);
    return endIndex < 0 ? '' : trimmed.slice(1, endIndex);
  }
  return trimmed.match(/^[A-Za-z0-9_-]+/u)?.[0] ?? '';
}

function tomlEqualsIndex(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote !== null) {
      if (quote === '"' && character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '=') return index;
    else if (character === '#') return -1;
  }
  return -1;
}

function tomlTableTopKey(line) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('[')) return null;
  const openingLength = trimmed.startsWith('[[') ? 2 : 1;
  return firstTomlKey(trimmed.slice(openingLength));
}

function projectTomlValueLine(rawLine, state) {
  let index = 0;
  let canonicalText = '';
  let continuesOnNextLine = false;
  if (state.trimLeadingWhitespace) {
    while (/[ \t]/u.test(rawLine[index] ?? '')) index += 1;
    if (index === rawLine.length) {
      return { canonicalText: '', continuesOnNextLine: true };
    }
    state.trimLeadingWhitespace = false;
  } else if (state.quote === null) {
    while (/[ \t]/u.test(rawLine[index] ?? '')) index += 1;
  }

  while (index < rawLine.length) {
    if (state.quote === null) {
      if (rawLine[index] === '#') break;
      if (rawLine.startsWith('"""', index)) {
        state.quote = 'multiline-basic';
        index += 3;
        continue;
      }
      if (rawLine.startsWith("'''", index)) {
        state.quote = 'multiline-literal';
        index += 3;
        continue;
      }
      if (rawLine[index] === '"') {
        state.quote = 'basic';
        index += 1;
        continue;
      }
      if (rawLine[index] === "'") {
        state.quote = 'literal';
        index += 1;
        continue;
      }
      if (rawLine[index] === '[' || rawLine[index] === '{') state.depth += 1;
      else if (rawLine[index] === ']' || rawLine[index] === '}') state.depth -= 1;
      canonicalText += rawLine[index];
      index += 1;
      continue;
    }

    if (state.quote === 'multiline-basic' && rawLine.startsWith('"""', index)) {
      state.quote = null;
      index += 3;
      continue;
    }
    if (state.quote === 'multiline-literal' && rawLine.startsWith("'''", index)) {
      state.quote = null;
      index += 3;
      continue;
    }
    if (state.quote === 'basic' && rawLine[index] === '"') {
      state.quote = null;
      index += 1;
      continue;
    }
    if (state.quote === 'literal' && rawLine[index] === "'") {
      state.quote = null;
      index += 1;
      continue;
    }
    if (state.quote === 'basic' || state.quote === 'multiline-basic') {
      if (rawLine[index] === '\\') {
        if (state.quote === 'multiline-basic' && /^[ \t]*$/u.test(rawLine.slice(index + 1))) {
          state.trimLeadingWhitespace = true;
          continuesOnNextLine = true;
          break;
        }
        const decoded = decodeTomlEscape(rawLine, index);
        canonicalText += decoded.value;
        index = decoded.nextIndex;
        continue;
      }
    }
    canonicalText += rawLine[index];
    index += 1;
  }
  return { canonicalText: canonicalText.trimEnd(), continuesOnNextLine };
}

function tomlFrontmatterLineRecords(frontmatterRaw, frontmatterStartLine) {
  const records = [];
  const lines = frontmatterRaw.split('\n');
  let currentTableKey = null;
  let currentTableHeaderLines = new Set();
  let statement = null;

  function flushStatement() {
    if (!statement) return;
    if (READER_VISIBLE_FRONTMATTER_KEY_SET.has(statement.topLevelKey)) {
      for (const record of continuedPhysicalLineRecords(
        statement.projectedLines,
        `frontmatter.${statement.topLevelKey}`
      )) {
        records.push({
          ...record,
          sourceLines: new Set([
            ...(record.sourceLines ?? [record.sourceLine]),
            ...statement.tableHeaderLines,
          ]),
        });
      }
    }
    statement = null;
  }

  for (const [lineIndex, rawLine] of lines.entries()) {
    const sourceLine = frontmatterStartLine + lineIndex;
    if (statement === null) {
      const tableKey = tomlTableTopKey(rawLine);
      if (tableKey !== null) {
        currentTableKey = tableKey;
        currentTableHeaderLines = new Set([sourceLine]);
        continue;
      }
      const equalsIndex = tomlEqualsIndex(rawLine);
      if (equalsIndex < 0) continue;
      statement = {
        topLevelKey: currentTableKey ?? firstTomlKey(rawLine),
        tableHeaderLines: currentTableHeaderLines,
        state: { quote: null, depth: 0, trimLeadingWhitespace: false },
        projectedLines: [],
      };
      const projected = projectTomlValueLine(rawLine.slice(equalsIndex + 1), statement.state);
      statement.projectedLines.push({ ...projected, sourceLine });
    } else {
      const projected = projectTomlValueLine(rawLine, statement.state);
      statement.projectedLines.push({ ...projected, sourceLine });
    }

    if (statement.state.quote === null && statement.state.depth === 0) flushStatement();
  }
  flushStatement();
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

function collectFrontmatterRecords({ frontmatterRaw, frontmatterFormat, frontmatterStartLine }) {
  if (!frontmatterRaw) return [];
  if (frontmatterFormat === 'toml') {
    return tomlFrontmatterLineRecords(frontmatterRaw, frontmatterStartLine);
  }
  const lineCounter = new LineCounter();
  const document = parseDocument(frontmatterRaw, { keepSourceTokens: true, lineCounter });
  if (document.errors.length > 0) throw document.errors[0];
  if (!isMap(document.contents)) return [];

  const records = [];
  const emittedKeys = new Set();
  const visitedMaps = new Set();

  function yamlKeyInfo(node) {
    if (isScalar(node)) {
      return {
        key: String(node.value),
        sourceLines: new Set(),
      };
    }
    if (isAlias(node)) {
      const target = node.resolve(document);
      if (!isScalar(target)) return { key: '', sourceLines: new Set() };
      return {
        key: String(target.value),
        sourceLines: new Set([
          ...sourceLinesForYamlNode(target, lineCounter, frontmatterStartLine),
          ...sourceLinesForYamlNode(node, lineCounter, frontmatterStartLine),
        ]),
      };
    }
    return { key: '', sourceLines: new Set() };
  }

  function collectVisiblePair(pair, topLevelKey, inheritedSourceLines) {
    const firstRecordIndex = records.length;
    collectYamlValueRecords(
      pair.value,
      `frontmatter.${topLevelKey}`,
      lineCounter,
      document,
      records,
      frontmatterStartLine
    );
    for (const record of records.slice(firstRecordIndex)) {
      record.sourceLines = new Set([
        ...(record.sourceLines ?? [record.sourceLine]),
        ...inheritedSourceLines,
      ]);
    }
    emittedKeys.add(topLevelKey);
  }

  function collectMergedValue(node, inheritedSourceLines) {
    if (isAlias(node)) {
      const aliasSourceLines = sourceLinesForYamlNode(node, lineCounter, frontmatterStartLine);
      const target = node.resolve(document);
      if (isMap(target)) {
        collectEffectiveMap(target, new Set([...inheritedSourceLines, ...aliasSourceLines]));
      }
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) collectMergedValue(item, inheritedSourceLines);
      return;
    }
    if (isMap(node)) collectEffectiveMap(node, inheritedSourceLines);
  }

  function collectEffectiveMap(map, inheritedSourceLines = new Set()) {
    if (visitedMaps.has(map)) return;
    visitedMaps.add(map);

    // Explicit keys override every merged source, regardless of source order.
    for (const pair of map.items) {
      const keyInfo = yamlKeyInfo(pair.key);
      const topLevelKey = keyInfo.key;
      if (
        topLevelKey === '<<' ||
        emittedKeys.has(topLevelKey) ||
        !READER_VISIBLE_FRONTMATTER_KEY_SET.has(topLevelKey)
      ) {
        continue;
      }
      collectVisiblePair(
        pair,
        topLevelKey,
        new Set([...inheritedSourceLines, ...keyInfo.sourceLines])
      );
    }

    // YAML merge sequences give earlier maps precedence over later maps.
    for (const pair of map.items) {
      const keyInfo = yamlKeyInfo(pair.key);
      const topLevelKey = keyInfo.key;
      if (topLevelKey !== '<<') continue;
      const mergeKeySourceLines = isScalar(pair.key)
        ? sourceLinesForYamlNode(pair.key, lineCounter, frontmatterStartLine)
        : keyInfo.sourceLines;
      collectMergedValue(pair.value, new Set([...inheritedSourceLines, ...mergeKeySourceLines]));
    }
  }

  collectEffectiveMap(document.contents);
  return records;
}

function stripHtmlCommentsPreservingLines(value) {
  const tree = fromHtml(value, { fragment: true });
  const ranges = [];
  walk(tree, (node) => {
    if (node.type !== 'comment') return;
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (Number.isInteger(start) && Number.isInteger(end)) ranges.push({ start, end });
  });

  let visibleValue = value;
  for (const { start, end } of ranges.sort((left, right) => right.start - left.start)) {
    const masked = visibleValue.slice(start, end).replace(/[^\n]/gu, ' ');
    visibleValue = `${visibleValue.slice(0, start)}${masked}${visibleValue.slice(end)}`;
  }
  return visibleValue;
}

function hasPotentiallyRenderingImport(node) {
  const program = node.data?.estree;
  return (
    program?.type === 'Program' &&
    program.body?.some((statement) => {
      const source = typeof statement.source?.value === 'string' ? statement.source.value : '';
      if (/\.(?:css|scss|sass|less|styl|stylus)(?:[?#]|$)/iu.test(source)) return true;
      return statement.type === 'ImportDeclaration' && statement.specifiers?.length === 0;
    })
  );
}

function isNonRenderingNode(node) {
  if (node.type === 'mdxjsEsm') return !hasPotentiallyRenderingImport(node);
  if (node.type === 'html') {
    return stripHtmlCommentsPreservingLines(node.value ?? '').trim() === '';
  }
  if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return false;
  const program = node.data?.estree;
  return program?.type === 'Program' && program.body?.length === 0;
}

const EXECUTABLE_URL_ATTRIBUTE_NAMES = new Set([
  'action',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'xlink:href',
  'xlinkhref',
]);

function decodeHtmlWithRawOffsets(value) {
  const raw = String(value);
  let decoded = '';
  const rawStarts = [];
  const rawEnds = [];
  let entityStart = 0;

  function append(fragment, rawStart, rawEnd, oneToOne = false) {
    decoded += fragment;
    for (let index = 0; index < fragment.length; index += 1) {
      rawStarts.push(oneToOne ? rawStart + index : rawStart);
      rawEnds.push(oneToOne ? rawStart + index + 1 : rawEnd);
    }
  }

  const decoder = new EntityDecoder(htmlDecodeTree, (codePoint, consumed) => {
    append(String.fromCodePoint(codePoint), entityStart, entityStart + consumed);
  });
  let lastIndex = 0;
  let offset = 0;
  while ((offset = raw.indexOf('&', offset)) >= 0) {
    append(raw.slice(lastIndex, offset), lastIndex, offset, true);
    entityStart = offset;
    decoder.startEntity(DecodingMode.Legacy);
    let consumed = decoder.write(raw, offset + 1);
    if (consumed < 0) {
      consumed = decoder.end();
      lastIndex = offset + consumed;
      break;
    }
    lastIndex = offset + consumed;
    offset = consumed === 0 ? lastIndex + 1 : lastIndex;
  }
  append(raw.slice(lastIndex), lastIndex, raw.length, true);
  return { decoded, rawStarts, rawEnds };
}

function srcsetCandidateUrls(value) {
  const { decoded: source, rawStarts, rawEnds } = decodeHtmlWithRawOffsets(value);
  const urls = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/u.test(source[index])) index += 1;
    const start = index;
    while (index < source.length && !/\s/u.test(source[index])) index += 1;
    let url = source.slice(start, index);
    const endedWithComma = url.endsWith(',');
    url = url.replace(/,+$/u, '');
    if (url) {
      const decodedEnd = start + url.length;
      urls.push({
        url,
        start: rawStarts[start],
        end: rawEnds[decodedEnd - 1],
      });
    }
    if (endedWithComma) continue;

    let parentheses = 0;
    while (index < source.length) {
      if (source[index] === '(') parentheses += 1;
      else if (source[index] === ')' && parentheses > 0) parentheses -= 1;
      else if (source[index] === ',' && parentheses === 0) {
        index += 1;
        break;
      }
      index += 1;
    }
  }
  return urls;
}

function unsafeSrcsetCandidateRanges(value, elementName = '') {
  return srcsetCandidateUrls(value).filter(({ url }) =>
    isExecutableReaderAttribute('src', url, elementName)
  );
}

function isExecutableReaderAttribute(name, value = '', elementName = '') {
  const normalizedName = String(name).toLowerCase();
  const normalizedElementName = String(elementName).toLowerCase();
  if (
    normalizedName === 'style' ||
    normalizedName === 'srcdoc' ||
    normalizedName === 'dangerouslysetinnerhtml' ||
    normalizedName.startsWith('on')
  ) {
    return true;
  }
  if (normalizedName === 'srcset') {
    return unsafeSrcsetCandidateRanges(value, normalizedElementName).length > 0;
  }
  if (!EXECUTABLE_URL_ATTRIBUTE_NAMES.has(normalizedName)) return false;
  const normalizedValue = Array.from(decodeHTML(String(value)))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 0x20 && codePoint !== 0x7f;
    })
    .join('')
    .toLowerCase();
  if (
    /^(?:iframe|frame|object|embed)$/u.test(normalizedElementName) &&
    normalizedValue.startsWith('data:')
  ) {
    return true;
  }
  return /^(?:javascript:|data:(?:text\/(?:html|css)|application\/xhtml\+xml|image\/svg\+xml)(?:[;,]|$))/u.test(
    normalizedValue
  );
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

  function pushUnsafePhysicalRanges(rawValue, firstSourceLine, ranges, surfaceKind) {
    for (const range of ranges) {
      const sourceLine =
        firstSourceLine + (rawValue.slice(0, range.start).match(/\n/gu)?.length ?? 0);
      const endSourceLine =
        firstSourceLine + (rawValue.slice(0, range.end).match(/\n/gu)?.length ?? 0);
      records.push({
        canonicalText: '',
        surfaceKind,
        sourceLine,
        sourceLines: new Set(
          Array.from(
            { length: endSourceLine - sourceLine + 1 },
            (_unused, index) => sourceLine + index
          )
        ),
        unsafeExecutable: rawValue.slice(range.start, range.end),
      });
    }
  }

  function staticStringPhysicalProjection(record) {
    const firstSourceLine = record.sourceLines?.values().next().value;
    if (!Number.isInteger(firstSourceLine)) return null;

    let projectedLines;
    let preservesPhysicalNewlines = false;
    if (typeof record.literalRaw === 'string') {
      const physicalLines = record.literalRaw.split('\n');
      const quote = physicalLines[0].at(0);
      if ((quote !== '"' && quote !== "'") || physicalLines.at(-1).at(-1) !== quote) return null;
      projectedLines = physicalLines.map((rawLine, index) => {
        let fragment = rawLine;
        if (index === 0) fragment = fragment.slice(1);
        if (index === physicalLines.length - 1) fragment = fragment.slice(0, -1);
        return {
          ...parseStaticStringFragment(fragment, quote),
          sourceLine: firstSourceLine + index,
        };
      });
    } else if (typeof record.templateRaw === 'string') {
      preservesPhysicalNewlines = true;
      projectedLines = record.templateRaw.split('\n').map((rawLine, index) => ({
        ...parseStaticTemplateFragment(rawLine),
        sourceLine: firstSourceLine + index,
      }));
    } else {
      return null;
    }

    let canonicalText = '';
    const sourceLineByIndex = [];
    for (const [index, line] of projectedLines.entries()) {
      canonicalText += line.canonicalText;
      sourceLineByIndex.push(...Array(line.canonicalText.length).fill(line.sourceLine));
      if (
        preservesPhysicalNewlines &&
        index < projectedLines.length - 1 &&
        !line.continuesOnNextLine
      ) {
        canonicalText += '\n';
        sourceLineByIndex.push(line.sourceLine);
      }
    }
    return canonicalText === record.value ? { canonicalText, sourceLineByIndex } : null;
  }

  function pushStaticSrcsetExecutables(staticValues, elementName) {
    let pushed = false;
    for (const value of staticValues) {
      const projection = staticStringPhysicalProjection(value);
      if (projection === null) {
        if (!isExecutableReaderAttribute('srcset', value.value, elementName)) continue;
        const sourceLines = value.sourceLines;
        const sourceLine = sourceLines?.values().next().value;
        if (!sourceLines || !Number.isInteger(sourceLine)) {
          throw new Error('static srcset expression is missing a source range');
        }
        records.push({
          canonicalText: '',
          surfaceKind: 'mdx.attribute.executable',
          sourceLine,
          sourceLines,
          unsafeExecutable: value.value,
        });
        pushed = true;
        continue;
      }

      for (const range of unsafeSrcsetCandidateRanges(projection.canonicalText, elementName)) {
        const sourceLines = new Set(projection.sourceLineByIndex.slice(range.start, range.end));
        const sourceLine = sourceLines.values().next().value;
        if (!Number.isInteger(sourceLine)) {
          throw new Error('static srcset candidate is missing a source line');
        }
        records.push({
          canonicalText: '',
          surfaceKind: 'mdx.attribute.executable',
          sourceLine,
          sourceLines,
          unsafeExecutable: projection.canonicalText.slice(range.start, range.end),
        });
        pushed = true;
      }
    }
    return pushed;
  }

  function rawHtmlAttributeRanges(value, elementStartOffset) {
    const ranges = [];
    let index = elementStartOffset;
    if (value[index] !== '<') return ranges;
    index += 1;
    if (value[index] === '/') index += 1;
    while (/\s/u.test(value[index] ?? '')) index += 1;
    while (!/[\s/>]/u.test(value[index] ?? '>')) index += 1;

    while (index < value.length) {
      while (/\s/u.test(value[index] ?? '')) index += 1;
      if (value[index] === '>' || (value[index] === '/' && value[index + 1] === '>')) break;

      const start = index;
      while (!/[\s=/>]/u.test(value[index] ?? '>')) index += 1;
      const name = value.slice(start, index).toLowerCase();
      let rawValue = '';
      let valueStart = index;
      while (/\s/u.test(value[index] ?? '')) index += 1;
      if (value[index] === '=') {
        index += 1;
        while (/\s/u.test(value[index] ?? '')) index += 1;
        const quote = value[index];
        if (quote === '"' || quote === "'") {
          index += 1;
          valueStart = index;
          while (index < value.length && value[index] !== quote) index += 1;
          rawValue = value.slice(valueStart, index);
          if (value[index] === quote) index += 1;
        } else {
          valueStart = index;
          while (!/[\s>]/u.test(value[index] ?? '>')) index += 1;
          rawValue = value.slice(valueStart, index);
        }
      }
      ranges.push({ start, end: index, name, rawValue, valueStart });
      if (index === start) index += 1;
    }
    return ranges;
  }

  function pushRawHtmlUnsafeRange(value, node, range, surfaceKind) {
    const nodeSourceLine = sourceLocation(node).sourceLine;
    const sourceLine = nodeSourceLine + (value.slice(0, range.start).match(/\n/gu)?.length ?? 0);
    const endSourceLine = nodeSourceLine + (value.slice(0, range.end).match(/\n/gu)?.length ?? 0);
    records.push({
      canonicalText: '',
      surfaceKind,
      sourceLine,
      sourceLines: new Set(
        Array.from(
          { length: endSourceLine - sourceLine + 1 },
          (_unused, index) => sourceLine + index
        )
      ),
      unsafeExecutable: value.slice(range.start, range.end),
    });
  }

  function projectRawHtmlExecutables(value, node) {
    const htmlTree = fromHtml(value, { fragment: true });
    const executableRanges = [];
    walk(htmlTree, (htmlNode) => {
      if (htmlNode.type !== 'element') return;
      const start = htmlNode.position?.start?.offset;
      const end = htmlNode.position?.end?.offset;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return;

      if (/^(?:style|script)$/iu.test(htmlNode.tagName)) {
        const range = { start, end };
        pushRawHtmlUnsafeRange(value, node, range, 'html.executable');
        executableRanges.push(range);
        return false;
      }

      for (const attributeRange of rawHtmlAttributeRanges(value, start)) {
        if (attributeRange.name === 'srcset') {
          for (const candidateRange of unsafeSrcsetCandidateRanges(
            attributeRange.rawValue,
            htmlNode.tagName
          )) {
            const range = {
              start: attributeRange.valueStart + candidateRange.start,
              end: attributeRange.valueStart + candidateRange.end,
            };
            pushRawHtmlUnsafeRange(value, node, range, 'html.attribute.executable');
            executableRanges.push(range);
          }
          continue;
        }
        if (
          !isExecutableReaderAttribute(
            attributeRange.name,
            attributeRange.rawValue,
            htmlNode.tagName
          )
        ) {
          continue;
        }
        pushRawHtmlUnsafeRange(value, node, attributeRange, 'html.attribute.executable');
        executableRanges.push(attributeRange);
      }
    });

    let scanValue = value;
    for (const { start, end } of executableRanges.sort((left, right) => right.start - left.start)) {
      const masked = scanValue.slice(start, end).replace(/[^\n]/gu, ' ');
      scanValue = `${scanValue.slice(0, start)}${masked}${scanValue.slice(end)}`;
    }
    return scanValue;
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

  function markdownDestinationLocation(node) {
    const source = rawSource(node);
    if (source === null) return null;
    let index = 0;

    if (node.type === 'definition') {
      const labelEnd = source.indexOf(']');
      if (labelEnd < 0) return null;
      index = source.indexOf(':', labelEnd + 1);
      if (index < 0) return null;
      index += 1;
    } else if (source.startsWith('<') && source.endsWith('>')) {
      index = 1;
    } else {
      const labelStart = source.startsWith('![') ? 2 : source.startsWith('[') ? 1 : -1;
      if (labelStart < 0) return null;
      let depth = 1;
      index = labelStart;
      for (; index < source.length; index += 1) {
        if (source[index] === '\\') {
          index += 1;
          continue;
        }
        if (source[index] === '[') depth += 1;
        else if (source[index] === ']') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      index += 1;
      while (/\s/u.test(source[index] ?? '')) index += 1;
      if (source[index] !== '(') return null;
      index += 1;
    }

    while (/\s/u.test(source[index] ?? '')) index += 1;
    const wrapped = source[index] === '<';
    if (wrapped) index += 1;
    const start = index;
    let nestedParentheses = 0;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (wrapped) {
        if (source[index] === '>') break;
      } else {
        if (source[index] === '(') nestedParentheses += 1;
        else if (source[index] === ')') {
          if (nestedParentheses === 0) break;
          nestedParentheses -= 1;
        } else if (/\s/u.test(source[index])) {
          break;
        }
      }
      index += 1;
    }
    if (index <= start) return null;

    const nodeSourceLine = sourceLocation(node).sourceLine;
    const sourceLine = nodeSourceLine + source.slice(0, start).split('\n').length - 1;
    const endSourceLine = nodeSourceLine + source.slice(0, index).split('\n').length - 1;
    return {
      sourceLine,
      sourceLines: new Set(
        Array.from(
          { length: endSourceLine - sourceLine + 1 },
          (_unused, lineIndex) => sourceLine + lineIndex
        )
      ),
    };
  }

  function pushMarkdownDestination(url, node, associatedSourceLines = []) {
    if (!isExecutableReaderAttribute('href', url)) return;
    const location = markdownDestinationLocation(node) ?? sourceLocation(node);
    records.push({
      canonicalText: '',
      surfaceKind: 'markdown.link.executable',
      sourceLine: location.sourceLine,
      sourceLines: new Set([...location.sourceLines, ...associatedSourceLines]),
      unsafeExecutable: url,
    });
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

  function pushReferenceDestination(node) {
    const definition = definitions.get(node.identifier);
    if (!definition?.url) return;
    pushMarkdownDestination(definition.url, definition, sourceLocation(node).sourceLines);
  }

  walk(tree, (node) => {
    if (isNonRenderingNode(node)) return;
    if (node.type === 'mdxjsEsm') {
      pushUnsafeExecutable(node, 'mdx.esm.side-effect-import');
      return;
    }
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
      pushMarkdownDestination(node.url, node);
      pushInlineTitle(node);
      return;
    }
    if (node.type === 'imageReference') {
      if (!pushDecodedPhysicalValue(node.alt, node, markdownImageAltSource(node))) {
        pushValue(node.alt, node);
      }
      pushReferenceDestination(node);
      pushReferenceTitle(node);
      return;
    }
    if (node.type === 'link') {
      pushMarkdownDestination(node.url, node);
      pushInlineTitle(node);
      return;
    }
    if (node.type === 'linkReference') {
      pushReferenceDestination(node);
      pushReferenceTitle(node);
      return;
    }
    if (node.type === 'html') {
      const visibleHtml = stripHtmlCommentsPreservingLines(node.value ?? '');
      pushHtmlValue(projectRawHtmlExecutables(visibleHtml, node), node);
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
        const attributeName = String(attribute.name ?? '').toLowerCase();
        const quotedSource =
          typeof attribute.value === 'string' ? quotedAttributeSource(attribute) : null;
        if (attributeName === 'srcset' && quotedSource) {
          const unsafeRanges = unsafeSrcsetCandidateRanges(quotedSource.rawValue, node.name);
          if (unsafeRanges.length > 0) {
            pushUnsafePhysicalRanges(
              quotedSource.rawValue,
              quotedSource.firstSourceLine,
              unsafeRanges,
              'mdx.attribute.executable'
            );
            continue;
          }
        }
        if (
          isExecutableReaderAttribute(
            attributeName,
            typeof attribute.value === 'string' ? attribute.value : '',
            node.name
          )
        ) {
          pushUnsafeExecutable(attribute, 'mdx.attribute.executable');
          continue;
        }
        if (typeof attribute.value === 'string') {
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
          } else if (
            attributeName === 'srcset' &&
            pushStaticSrcsetExecutables(staticValues, node.name)
          ) {
            continue;
          } else if (
            staticValues.some((value) =>
              isExecutableReaderAttribute(attributeName, value.value, node.name)
            )
          ) {
            pushUnsafeExecutable(attribute, 'mdx.attribute.executable');
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
  const { frontmatterRaw, frontmatterFormat, frontmatterStartLine, body, bodyStartLine } =
    extractPostParts(content);
  return [
    ...collectFrontmatterRecords({
      frontmatterRaw,
      frontmatterFormat,
      frontmatterStartLine,
    }),
    ...collectBodyRecords(body, bodyStartLine, format),
  ];
}
