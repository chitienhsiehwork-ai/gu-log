import eslintPluginAstro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

const ASTRO_PARSER = eslintPluginAstro.configs.base.find((config) => config.languageOptions?.parser)
  .languageOptions.parser;
const UNKNOWN = Object.freeze({ known: false });
const PROTOTYPE_SENSITIVE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function known(value) {
  return { known: true, value };
}

function evaluateBinaryOperator(operator, left, right) {
  switch (operator) {
    case '+':
      return known(left + right);
    case '-':
      return known(left - right);
    case '*':
      return known(left * right);
    case '/':
      return known(left / right);
    case '%':
      return known(left % right);
    case '**':
      return known(left ** right);
    case '<<':
      return known(left << right);
    case '>>':
      return known(left >> right);
    case '>>>':
      return known(left >>> right);
    case '|':
      return known(left | right);
    case '^':
      return known(left ^ right);
    case '&':
      return known(left & right);
    case '==':
      return known(left == right);
    case '!=':
      return known(left != right);
    case '===':
      return known(left === right);
    case '!==':
      return known(left !== right);
    case '<':
      return known(left < right);
    case '<=':
      return known(left <= right);
    case '>':
      return known(left > right);
    case '>=':
      return known(left >= right);
    default:
      return UNKNOWN;
  }
}

function evaluateUnaryOperator(operator, argument) {
  switch (operator) {
    case '+':
      return known(+argument);
    case '-':
      return known(-argument);
    case '!':
      return known(!argument);
    case '~':
      return known(~argument);
    case 'typeof':
      return known(typeof argument);
    case 'void':
      return known(undefined);
    default:
      return UNKNOWN;
  }
}

function normalizeStaticPropertyKey(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function readStaticMember(receiver, key) {
  const property = normalizeStaticPropertyKey(key);
  if (property === null || PROTOTYPE_SENSITIVE_KEYS.has(property)) {
    return UNKNOWN;
  }
  if (Array.isArray(receiver)) {
    if (property === 'length') return known(receiver.length);
    return /^(?:0|[1-9]\d*)$/.test(property) && Number(property) < receiver.length
      ? known(receiver[Number(property)])
      : UNKNOWN;
  }
  if (typeof receiver === 'string') {
    if (property === 'length') return known(receiver.length);
    return /^(?:0|[1-9]\d*)$/.test(property) && Number(property) < receiver.length
      ? known(receiver[Number(property)])
      : UNKNOWN;
  }
  if (
    receiver &&
    typeof receiver === 'object' &&
    Object.getPrototypeOf(receiver) === null &&
    Object.hasOwn(receiver, property)
  ) {
    return known(receiver[property]);
  }
  return UNKNOWN;
}

function evaluateStaticValue(node, bindings, resolving = new Set()) {
  if (!node) return UNKNOWN;
  if (
    [
      'ParenthesizedExpression',
      'TSAsExpression',
      'TSNonNullExpression',
      'TSSatisfiesExpression',
      'TSTypeAssertion',
    ].includes(node.type)
  ) {
    return evaluateStaticValue(node.expression, bindings, resolving);
  }
  if (node.type === 'Literal') {
    return ['string', 'number', 'boolean'].includes(typeof node.value) || node.value === null
      ? known(node.value)
      : UNKNOWN;
  }
  if (node.type === 'TemplateLiteral') {
    let value = '';
    for (let index = 0; index < node.quasis.length; index += 1) {
      const cooked = node.quasis[index]?.value?.cooked;
      if (typeof cooked !== 'string') return UNKNOWN;
      value += cooked;
      if (index >= node.expressions.length) continue;
      const expression = evaluateStaticValue(node.expressions[index], bindings, resolving);
      if (!expression.known) return UNKNOWN;
      value += String(expression.value);
    }
    return known(value);
  }
  if (node.type === 'Identifier') {
    const binding = bindings.get(node.name);
    if (!binding || resolving.has(node.name)) return UNKNOWN;
    const nextResolving = new Set(resolving);
    nextResolving.add(node.name);
    return evaluateStaticValue(binding, bindings, nextResolving);
  }
  if (node.type === 'BinaryExpression') {
    const left = evaluateStaticValue(node.left, bindings, resolving);
    const right = evaluateStaticValue(node.right, bindings, resolving);
    return left.known && right.known
      ? evaluateBinaryOperator(node.operator, left.value, right.value)
      : UNKNOWN;
  }
  if (node.type === 'LogicalExpression') {
    const left = evaluateStaticValue(node.left, bindings, resolving);
    if (!left.known) return UNKNOWN;
    if (node.operator === '&&') {
      return left.value ? evaluateStaticValue(node.right, bindings, resolving) : left;
    }
    if (node.operator === '||') {
      return left.value ? left : evaluateStaticValue(node.right, bindings, resolving);
    }
    if (node.operator === '??') {
      return left.value === null || left.value === undefined
        ? evaluateStaticValue(node.right, bindings, resolving)
        : left;
    }
    return UNKNOWN;
  }
  if (node.type === 'UnaryExpression') {
    const argument = evaluateStaticValue(node.argument, bindings, resolving);
    return argument.known ? evaluateUnaryOperator(node.operator, argument.value) : UNKNOWN;
  }
  if (node.type === 'ConditionalExpression') {
    const test = evaluateStaticValue(node.test, bindings, resolving);
    if (!test.known) return UNKNOWN;
    return evaluateStaticValue(test.value ? node.consequent : node.alternate, bindings, resolving);
  }
  if (node.type === 'ArrayExpression') {
    const values = [];
    for (const element of node.elements) {
      if (element === null) {
        values.push(undefined);
        continue;
      }
      const value = evaluateStaticValue(
        element.type === 'SpreadElement' ? element.argument : element,
        bindings,
        resolving
      );
      if (!value.known) return UNKNOWN;
      if (element.type === 'SpreadElement') {
        if (!Array.isArray(value.value) && typeof value.value !== 'string') return UNKNOWN;
        values.push(...value.value);
      } else {
        values.push(value.value);
      }
    }
    return known(values);
  }
  if (node.type === 'ObjectExpression') {
    const value = Object.create(null);
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const spread = evaluateStaticValue(property.argument, bindings, resolving);
        if (
          !spread.known ||
          !spread.value ||
          typeof spread.value !== 'object' ||
          Object.getPrototypeOf(spread.value) !== null
        ) {
          return UNKNOWN;
        }
        for (const [key, entry] of Object.entries(spread.value)) {
          if (PROTOTYPE_SENSITIVE_KEYS.has(key)) {
            throw new Error(`prototype-sensitive static object key is not trusted: ${key}`);
          }
          value[key] = entry;
        }
        continue;
      }
      if (property.type !== 'Property' || property.kind !== 'init' || property.method)
        return UNKNOWN;
      const key = property.computed
        ? evaluateStaticValue(property.key, bindings, resolving)
        : known(property.key.type === 'Identifier' ? property.key.name : property.key.value);
      const entry = evaluateStaticValue(property.value, bindings, resolving);
      const normalizedKey = key.known ? normalizeStaticPropertyKey(key.value) : null;
      if (normalizedKey === null || !entry.known) {
        return UNKNOWN;
      }
      if (PROTOTYPE_SENSITIVE_KEYS.has(normalizedKey)) {
        throw new Error(`prototype-sensitive static object key is not trusted: ${normalizedKey}`);
      }
      value[normalizedKey] = entry.value;
    }
    return known(value);
  }
  if (node.type === 'MemberExpression' && !node.optional) {
    const receiver = evaluateStaticValue(node.object, bindings, resolving);
    const property = node.computed
      ? evaluateStaticValue(node.property, bindings, resolving)
      : known(node.property.type === 'Identifier' ? node.property.name : null);
    return receiver.known && property.known
      ? readStaticMember(receiver.value, property.value)
      : UNKNOWN;
  }
  if (node.type !== 'CallExpression' || node.optional) {
    return UNKNOWN;
  }

  const values = [];
  for (const argument of node.arguments) {
    const result = evaluateStaticValue(
      argument.type === 'SpreadElement' ? argument.argument : argument,
      bindings,
      resolving
    );
    if (!result.known) return UNKNOWN;
    if (argument.type === 'SpreadElement') {
      if (!Array.isArray(result.value) && typeof result.value !== 'string') return UNKNOWN;
      values.push(...result.value);
    } else {
      values.push(result.value);
    }
  }
  if (
    node.callee.type === 'Identifier' &&
    ['atob', 'decodeURI', 'decodeURIComponent', 'unescape'].includes(node.callee.name) &&
    values.length === 1 &&
    typeof values[0] === 'string'
  ) {
    try {
      if (node.callee.name === 'atob') return known(globalThis.atob(values[0]));
      if (node.callee.name === 'decodeURI') return known(decodeURI(values[0]));
      if (node.callee.name === 'decodeURIComponent') return known(decodeURIComponent(values[0]));
      return known(globalThis.unescape(values[0]));
    } catch {
      return UNKNOWN;
    }
  }
  if (node.callee.type === 'Identifier' && node.callee.name === 'Number' && values.length <= 1) {
    return known(Number(values[0]));
  }
  if (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'parseInt' &&
    values.length >= 1 &&
    values.length <= 2
  ) {
    return known(Number.parseInt(values[0], values[1]));
  }
  if (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'parseFloat' &&
    values.length === 1
  ) {
    return known(Number.parseFloat(values[0]));
  }
  if (node.callee.type === 'Identifier' && node.callee.name === 'String' && values.length <= 1) {
    return known(String(values[0] ?? ''));
  }
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.optional ||
    node.callee.computed ||
    node.callee.property.type !== 'Identifier'
  ) {
    return UNKNOWN;
  }
  const method = node.callee.property.name;
  if (node.callee.object.type === 'Identifier' && node.callee.object.name === 'JSON') {
    if (method !== 'parse' || values.length !== 1 || typeof values[0] !== 'string') return UNKNOWN;
    try {
      return known(JSON.parse(values[0]));
    } catch {
      return UNKNOWN;
    }
  }
  if (node.callee.object.type === 'Identifier' && node.callee.object.name === 'String') {
    if (method === 'fromCharCode' && values.every(Number.isInteger)) {
      return known(String.fromCharCode(...values));
    }
    if (method === 'fromCodePoint' && values.every(Number.isInteger)) {
      try {
        return known(String.fromCodePoint(...values));
      } catch {
        return UNKNOWN;
      }
    }
    return UNKNOWN;
  }

  const receiver = evaluateStaticValue(node.callee.object, bindings, resolving);
  if (!receiver.known) return UNKNOWN;
  if (method === 'concat' && typeof receiver.value === 'string') {
    return known(receiver.value.concat(...values));
  }
  if (method === 'join' && Array.isArray(receiver.value) && values.length <= 1) {
    return known(receiver.value.join(values[0] ?? ','));
  }
  return UNKNOWN;
}

export function collectTrustedComponentStaticStrings(source, filePath = 'trusted-component.astro') {
  const parsed = ASTRO_PARSER.parseForESLint(String(source), {
    ecmaVersion: 'latest',
    filePath,
    parser: tseslint.parser,
    sourceType: 'module',
  });
  const bindings = new Map();
  for (const statement of parsed.ast.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type === 'Identifier' && declaration.init) {
        bindings.set(declaration.id.name, declaration.init);
      }
    }
  }
  const values = new Set();
  ASTRO_PARSER.traverseNodes(parsed.ast, {
    visitorKeys: parsed.visitorKeys,
    enterNode(node) {
      if (
        ![
          'BinaryExpression',
          'CallExpression',
          'ConditionalExpression',
          'LogicalExpression',
          'MemberExpression',
          'ObjectExpression',
          'TemplateLiteral',
          'UnaryExpression',
        ].includes(node.type)
      ) {
        return;
      }
      const result = evaluateStaticValue(node, bindings);
      if (result.known && typeof result.value === 'string') values.add(result.value);
    },
    leaveNode() {},
  });
  return [...values];
}
