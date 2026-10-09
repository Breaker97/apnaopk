import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { flattenMessages, setMessage, messageContract } from './messages.mjs';

/**
 * Reuse only unambiguous translations of the exact same source message.
 * @param {Record<string, unknown>} english
 * @param {Record<string, unknown>} target
 * @param {Array<{english: Record<string, unknown>, locale: Record<string, unknown>}>} references
 */
export function reuseTranslations(english, target, references = []) {
  const source = flattenMessages(english);
  const local = flattenMessages(target);
  const candidates = new Map();
  function index(referenceEnglish, referenceLocale) {
    const referenceSource = flattenMessages(referenceEnglish);
    const translated = flattenMessages(referenceLocale);
    for (const [key, original] of Object.entries(referenceSource)) {
      const text = translated[key];
      if (!text?.trim() || text === original) continue;
      try {
        if (messageContract(original) !== messageContract(text)) continue;
      } catch { continue; }
      const choices = candidates.get(original) ?? new Set();
      choices.add(text); candidates.set(original, choices);
    }
  }
  index(english, target);
  // Existing in-repo translations take precedence; reference projects only
  // contribute messages with no candidate in this project's dictionary.
  const existing = new Set(candidates.keys());
  for (const reference of references) {
    const filtered = {};
    for (const [key, text] of Object.entries(flattenMessages(reference.english))) {
      if (!existing.has(text)) setMessage(filtered, key, text);
    }
    index(filtered, reference.locale);
  }
  let reused = 0;
  for (const [key, original] of Object.entries(source)) {
    let valid = false;
    try { valid = Boolean(local[key]?.trim()) && messageContract(original) === messageContract(local[key]); } catch {}
    if (valid && local[key] !== original) continue;
    const choices = candidates.get(original);
    if (choices?.size !== 1) continue;
    setMessage(target, key, [...choices][0]); reused++;
  }
  return reused;
}

async function main() {
  const english = JSON.parse(await readFile('locales/en.json', 'utf8'));
  const references = [];
  for (const root of ['../storify-admin', '../storify-store', '../storify-api/src/legacy']) {
    try { references.push({ root, english: JSON.parse(await readFile(`${root}/locales/en.json`, 'utf8')) }); } catch {}
  }
  const languages = ['bn','ar','es','fr','de','tr','hi','nl','zh','ja','zu','xh','af','sw','ha','yo','ig'];
  for (const language of languages) {
    const target = JSON.parse(await readFile(`locales/${language}.json`, 'utf8'));
    const localReferences = [];
    for (const reference of references) {
      try { localReferences.push({ english: reference.english, locale: JSON.parse(await readFile(`${reference.root}/locales/${language}.json`, 'utf8')) }); } catch {}
    }
    const reused = reuseTranslations(english, target, localReferences);
    const temporary = `locales/${language}.json.i18n-tmp`;
    await writeFile(temporary, JSON.stringify(target, null, 2) + '\n');
    await rename(temporary, `locales/${language}.json`);
    console.log(`${language}: reused ${reused} existing translations`);
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
