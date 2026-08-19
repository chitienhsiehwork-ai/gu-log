import eslintPluginAstro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

const ASTRO_PARSER = eslintPluginAstro.configs.base.find((config) => config.languageOptions?.parser)
  .languageOptions.parser;
const UNKNOWN = Object.freeze({ known: false });

function known(value) {
  return { known: true, value };
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
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = evaluateStaticValue(node.left, bindings, resolving);
    const right = evaluateStaticValue(node.right, bindings, resolving);
    return left.known && right.known ? known(left.value + right.value) : UNKNOWN;
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
      if (element.type === 'SpreadElement') return UNKNOWN;
      const value = evaluateStaticValue(element, bindings, resolving);
      if (!value.known) return UNKNOWN;
      values.push(value.value);
    }
    return known(values);
  }
  if (
    node.type !== 'CallExpression' ||
    node.optional ||
    node.arguments.some((arg) => arg.type === 'SpreadElement')
  ) {
    return UNKNOWN;
  }

  const args = node.arguments.map((argument) => evaluateStaticValue(argument, bindings, resolving));
  if (args.some((arg) => !arg.known)) return UNKNOWN;
  const values = args.map((arg) => arg.value);
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
          'TemplateLiteral',
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
