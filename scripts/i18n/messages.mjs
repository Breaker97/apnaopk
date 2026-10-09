import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const intlRequire = createRequire(require.resolve('next-intl/plugin'));
const { parse } = await import(intlRequire.resolve('@formatjs/icu-messageformat-parser'));

/**
 * @param {Record<string, unknown>} messages
 * @param {string} prefix
 * @param {Record<string, string>} output
 * @returns {Record<string, string>}
 */
export function flattenMessages(messages, prefix = '', output = {}) {
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') output[path] = value;
    else if (value && typeof value === 'object') flattenMessages(value, path, output);
  }
  return output;
}

export function setMessage(messages, key, value) {
  const parts = key.split('.');
  let node = messages;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/** Message arguments and rich-text tags must survive translation. */
/** @param {string} message */
export function messageContract(message) {
  const parts = new Set();
  const visit = nodes => {
    for (const node of nodes) {
      if (node.type === 7) parts.add('7:#');
      else if (node.type !== 0) {
        // Select branches name application states and must match exactly.
        // Plural categories may differ by language (Arabic needs more than
        // English); retain explicit numeric branches and the required other.
        const optionNames = node.options ? Object.keys(node.options) : [];
        const selectors = node.options
          ? `:${optionNames.filter(key => node.type === 5 || key === 'other' || key.startsWith('=')).sort().join(',')}`
          : '';
        const plural = node.type === 6 ? `:${node.pluralType}:${node.offset}` : '';
        parts.add(`${node.type}:${node.value}${selectors}${plural}`);
      }
      if (node.children) visit(node.children);
      if (node.options) for (const option of Object.values(node.options)) visit(option.value);
    }
  };
  visit(parse(message));
  return [...parts].sort().join('|');
}
