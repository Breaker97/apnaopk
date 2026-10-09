import { readFile, readdir } from 'node:fs/promises';
import { flattenMessages, messageContract } from './messages.mjs';

const source = flattenMessages(JSON.parse(await readFile('locales/en.json', 'utf8')));
const contracts = new Map(Object.entries(source).map(([key,text])=>[key,messageContract(text)]));
const failures = [];
for (const file of (await readdir('locales')).filter(file=>file.endsWith('.json'))) {
  const messages = flattenMessages(JSON.parse(await readFile(`locales/${file}`, 'utf8')));
  for (const [key, contract] of contracts) {
    if (messages[key] === undefined) { failures.push(`${file}: missing ${key}`); continue; }
    if (source[key].trim() && !messages[key].trim()) failures.push(`${file}: empty ${key}`);
    try {
      if (messageContract(messages[key]) !== contract) failures.push(`${file}: arguments/tags differ at ${key}`);
    } catch { failures.push(`${file}: invalid ICU at ${key}`); }
  }
  // Also validate locale-specific extra messages used by existing UI.
  for (const [key,text] of Object.entries(messages)) {
    if (contracts.has(key)) continue;
    try { messageContract(text); } catch { failures.push(`${file}: invalid ICU at ${key}`); }
  }
}
if (failures.length) {
  console.error(failures.slice(0,50).join('\n'));
  console.error(`${failures.length} localization errors. Run the locale-completeness workflow before building.`);
  process.exitCode=1;
} else {
  console.log(`All locale dictionaries cover ${contracts.size} English keys with valid ICU arguments and tags.`);
}
