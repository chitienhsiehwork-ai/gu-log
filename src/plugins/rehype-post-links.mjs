import { URL } from 'node:url';
import { visit } from 'unist-util-visit';

const SITE_ORIGIN = 'https://gu-log.vercel.app';
const EXTERNAL_MARKER_CLASS = 'external-link-marker';
const COMPONENT_LINK_CLASSES = new Set(['artifact-callout', 'mogu-prefix-link']);

export function classifyPostLink(href) {
  if (typeof href !== 'string' || href.length === 0) return 'internal';

  try {
    const destination = new URL(href, SITE_ORIGIN);
    return destination.origin === SITE_ORIGIN ? 'internal' : 'external';
  } catch {
    return 'internal';
  }
}

function classNames(node) {
  const value = node.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? value.split(/\s+/) : [];
}

function isComponentLink(node) {
  return classNames(node).some((className) => COMPONENT_LINK_CLASSES.has(className));
}

export default function rehypePostLinks() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;

      node.properties ??= {};
      const kind = classifyPostLink(node.properties.href);
      node.properties.dataLinkKind = kind;

      if (kind !== 'external' || isComponentLink(node)) return;
      node.children.push({
        type: 'element',
        tagName: 'span',
        properties: {
          ariaHidden: 'true',
          className: [EXTERNAL_MARKER_CLASS],
        },
        children: [{ type: 'text', value: '\u2060↗' }],
      });
    });
  };
}
