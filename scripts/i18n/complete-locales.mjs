import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { flattenMessages, setMessage, messageContract } from './messages.mjs';

// Run explicitly: node --env-file=.env scripts/i18n/complete-locales.mjs
// Generates source files only. Never connects to the application's database.
const languages = { bn:'Bengali', ar:'Arabic', es:'Spanish', fr:'French', de:'German', tr:'Turkish', hi:'Hindi', nl:'Dutch', zh:'Simplified Chinese', ja:'Japanese', zu:'Zulu', xh:'Xhosa', af:'Afrikaans', sw:'Swahili', ha:'Hausa', yo:'Yoruba', ig:'Igbo' };
const client = new OpenAI({ maxRetries: 2, timeout: 180000 });
const source = flattenMessages(JSON.parse(await readFile('locales/en.json', 'utf8')));
const cacheDir = process.env.I18N_CACHE_DIR || '.codex/i18n-translations';
await mkdir(cacheDir, { recursive: true });
const model = process.env.I18N_TRANSLATION_MODEL || 'gpt-4.1-mini';
const jobs = [], documents = new Map(), stats = { batches:0, translated:0, failed:0, inputTokens:0, outputTokens:0 };
const cache = new Map();
const saves = new Map();
async function persistLocale(locale) {
  // Serialize writes per locale. Each queued write snapshots the latest
  // document, so overlapping batches cannot replace newer translations.
  const save = (saves.get(locale) ?? Promise.resolve()).then(async () => {
    const cacheTemp = join(cacheDir, `${locale}.json.tmp`);
    const documentTemp = join(cacheDir, `${locale}.document.json.tmp`);
    await writeFile(cacheTemp, JSON.stringify(cache.get(locale)));
    await rename(cacheTemp, join(cacheDir, `${locale}.json`));
    await writeFile(documentTemp, JSON.stringify(documents.get(locale), null, 2) + '\n');
    await rename(documentTemp, `locales/${locale}.json`);
  });
  saves.set(locale, save);
  await save;
}
const errors = [];
const unchanged = [];
// Uppercase UI words such as SALE or FREE still need translation.
const technicalIdentifiers = new Set(['API','AI','CSV','JSON','PDF','SKU','ID','URL','HTTP','HTTPS','SMTP','SSL','TLS','DNS','IP','UTC','GMT','POS','OTP','2FA','MFA','KYC','GST','VAT','USD','EUR','GBP','BDT','INR','BTC','PNG','JPG','JPEG','WEBP','SVG','ICO','SMS','S3','SEO','ICU']);
const knownTechnical = { test: text => technicalIdentifiers.has(text) || /^(?:[\d\s.,%:+/×–—−-]+|(?:https?:\/\/|www\.)\S+|#[0-9a-fA-F]{3,8})$/.test(text) };
const valid = (english, translated) => {
  try { return typeof translated === 'string' && translated.trim().length > 0 && messageContract(english) === messageContract(translated); }
  catch { return false; }
};
for (const [locale, language] of Object.entries(languages)) {
  const path = `locales/${locale}.json`;
  const document = JSON.parse(await readFile(path, 'utf8'));
  documents.set(locale, document);
  const local = flattenMessages(document), entries = new Map();
  const cachePath = join(cacheDir, `${locale}.json`);
  let cached = {};
  try { cached = JSON.parse(await readFile(cachePath, 'utf8')); } catch {}
  cache.set(locale, cached);
  for (const [key, english] of Object.entries(source)) {
    // Preserve existing translations. Repair absent messages, untranslated
    // English copy and argument/tag mismatches instead of copying English.
    if (local[key] !== undefined && local[key] !== english && valid(english, local[key])) continue;
    if (!english.trim() || knownTechnical.test(english)) { setMessage(document,key,english); continue; }
    const hash = createHash('sha256').update(english).digest('hex');
    if (valid(english, cached[hash])) { setMessage(document,key,cached[hash]); continue; }
    const entry = entries.get(hash) ?? { hash, english, keys:[] };
    entry.keys.push(key); entries.set(hash, entry);
  }
  const pending = [...entries.values()];
  for (let at=0; at<pending.length; at+=80) jobs.push({ locale, language, entries:pending.slice(at,at+80) });
  console.log(JSON.stringify({ locale, uniqueMessages:pending.length }));
}
const total = jobs.length;
let cursor = 0;
async function run(job) {
  const { locale, language, entries } = job;
  const schema = { type:'object', properties:Object.fromEntries(entries.map((_,index)=>[String(index),{type:'string'}])), required:entries.map((_,index)=>String(index)), additionalProperties:false };
  const input = Object.fromEntries(entries.map((entry,index)=>[String(index), {context:entry.keys[0],text:entry.english}]));
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response = await client.responses.create({
        model, store:false, temperature:0.2, max_output_tokens:16000,
        instructions:`You are a professional e-commerce software localizer. Translate every input text from English to ${language} (${locale}). Context is the message key in Storify, a multi-vendor commerce platform. Return natural, accurate, concise UI language appropriate for merchants and shoppers. Translate whole sentences and common UI words; never leave English descriptions untranslated. Keep only proper names, brand names, file names, URLs, technical code examples and protocol identifiers unchanged when appropriate. Preserve ALL ICU syntax exactly: argument names inside braces, plural/select selectors, number/date styles, # plural markers, and rich text tag names (<link>, <q>, <b> etc). Translate text INSIDE plural branches and rich tags. Do not translate enum values, paths or code samples. Preserve apostrophe escaping in ICU. Return only the translations using the numeric keys in the schema.`,
        input:JSON.stringify(input),
        text:{format:{type:'json_schema', name:'translations', strict:true, schema}},
      });
      stats.inputTokens += response.usage?.input_tokens ?? 0;
      stats.outputTokens += response.usage?.output_tokens ?? 0;
      if (response.status !== 'completed') throw new Error(`Incomplete response: ${response.status}`);
      const output = JSON.parse(response.output_text);
      const failed=[];
      for (const [index,entry] of entries.entries()) {
        const value = output[String(index)];
        if (!valid(entry.english,value)) { failed.push(entry); continue; }
        cache.get(locale)[entry.hash] = value;
        for (const key of entry.keys) setMessage(documents.get(locale),key,value);
        stats.translated += entry.keys.length;
        if (value === entry.english) unchanged.push({locale,key:entry.keys[0],text:value});
      }
      await persistLocale(locale);
      if (failed.length) {
        // Retry only the messages whose ICU contract failed validation.
        if (entries.length > failed.length) { await run({...job,entries:failed}); return; }
        throw new Error(`${failed.length} translations failed ICU/argument validation`);
      }
      stats.batches++;
      if (stats.batches % 10 === 0) console.log(JSON.stringify({progress:`${stats.batches}/${total}`, ...stats}));
      return;
    } catch(error) {
      if ([401,403].includes(error.status) || error.code === 'insufficient_quota' || /no credits remaining|insufficient quota/i.test(error.message)) throw new Error('Translation provider has no credits available; add credits or configure another provider before resuming.');
      if (attempt===2) { stats.failed+=entries.length; errors.push({locale,keys:entries.map(e=>e.keys),error:error.message}); console.log(JSON.stringify({locale, failedMessages:entries.length, error:error.message})); await persistLocale(locale); return; }
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
  }
}
const interval=setInterval(()=>console.log(JSON.stringify({progress:`${stats.batches}/${total}`,activeCursor:cursor,...stats})),30000);
try {
  await Promise.all(Array.from({length:Math.min(Number(process.env.I18N_CONCURRENCY || 16),jobs.length)},async()=>{
    while(cursor<jobs.length) {const job=jobs[cursor++];await run(job);}
  }));
} finally {clearInterval(interval);}
for (const locale of documents.keys()) await persistLocale(locale);
await writeFile(join(cacheDir,'report.json'),JSON.stringify({model,...stats,errors,unchanged},null,2));
console.log(JSON.stringify({finished:true,...stats,errors:errors.length,unchanged:unchanged.length}));
if (errors.length) process.exitCode=1;
