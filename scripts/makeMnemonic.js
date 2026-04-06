/**
 * On-demand mnemonic generator for kanji, radicals, and vocabulary.
 *
 * Generates in two sequential steps:
 *   1. mnemonic_meaning  — visual scene anchored to the meaning
 *   2. mnemonic_reading  — pronunciation hook that BUILDS on the visual scene
 *
 * Usage:
 *   node scripts/makeMnemonic.js 人                      # kanji (auto-detected)
 *   node scripts/makeMnemonic.js --vocab 人生            # vocabulary word
 *   node scripts/makeMnemonic.js --radical Ground       # radical by English name
 *   node scripts/makeMnemonic.js --local 人             # use local Ollama
 *   node scripts/makeMnemonic.js --local --model llama3 人
 *   node scripts/makeMnemonic.js --save 人              # write result to mnemonics.json
 *   node scripts/makeMnemonic.js --local --level 5      # batch all N5 kanji
 *   node scripts/makeMnemonic.js --local --level 5 --regen  # re-generate existing
 *   GEMINI_API_KEY=AIza... node scripts/makeMnemonic.js 人
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────

const KANJI_JSON   = path.join(__dirname, '../src/data/kanji.json');
const VOCAB_JSON   = path.join(__dirname, '../src/data/vocab.json');
const RADICAL_JSON = path.join(__dirname, '../src/data/radicalKanji.json');
const IPA_JSON     = path.join(__dirname, './romajiIPA.json');
const CAST_JSON    = path.join(__dirname, './mnemonicCast.json');
const OUT_FILE     = path.join(__dirname, '../src/data/mnemonics.json');

const args = process.argv.slice(2);
const USE_LOCAL    = args.includes('--local');
const SAVE         = args.includes('--save');
const REGEN        = args.includes('--regen');
const TYPE_VOCAB   = args.includes('--vocab');
const TYPE_RADICAL = args.includes('--radical');

const modelArg  = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg  = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];
const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--')) ? modelArg : 'gemma4:e4b';
const LEVEL_FILTER = (levelArg && !levelArg.startsWith('--')) ? parseInt(levelArg) : null;
const DELAY_MS     = USE_LOCAL ? 0 : 13000;

// The target string is the last non-flag argument (ignored in batch mode)
const INPUT = LEVEL_FILTER ? null : args.filter(a => !a.startsWith('--') && a !== modelArg && a !== levelArg).pop();

// Load .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!USE_LOCAL && !GEMINI_KEY) {
  console.error('No GEMINI_API_KEY. Use --local or set GEMINI_API_KEY.');
  process.exit(1);
}

if (!INPUT && !LEVEL_FILTER) {
  console.error('Usage: node scripts/makeMnemonic.js [--local] [--save] [--vocab|--radical] <character>');
  console.error('       node scripts/makeMnemonic.js [--local] --level 5 [--regen]');
  process.exit(1);
}

// ─── Load reference data ─────────────────────────────────────────────────────

const IPA  = JSON.parse(fs.readFileSync(IPA_JSON)).mora;
const CAST = Object.fromEntries(
  JSON.parse(fs.readFileSync(CAST_JSON)).cast.map(e => [e.sound, e])
);

// ─── Resolve input to a structured entry ─────────────────────────────────────

/**
 * @typedef {{ type: 'kanji'|'radical'|'vocab', key: string, character: string,
 *             meaning: string, reading: string|null, radicals: string[] }} Entry
 */

function resolveKanji(char) {
  const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));
  const k = allKanji.find(e => e.character === char);
  if (!k) return null;
  const reading = k.readings_on[0] ?? k.readings_kun[0]?.replace(/[.-].*/, '') ?? null;
  return { type: 'kanji', key: char, character: char, meaning: k.meanings[0],
           reading, radicals: k.radicals.slice(0, 4) };
}

function resolveVocab(word) {
  const allVocab = JSON.parse(fs.readFileSync(VOCAB_JSON));
  // vocab.json is keyed by kanji; flatten all entries
  const flat = Object.values(allVocab).flat();
  const v = flat.find(e => e.word === word);
  if (!v) return null;
  return { type: 'vocab', key: word, character: word, meaning: v.meaning,
           reading: v.reading, radicals: [] };
}

function resolveRadical(name) {
  // radicalKanji.json maps English name → kanji char
  const radMap = JSON.parse(fs.readFileSync(RADICAL_JSON));
  const char = radMap[name] ?? null;
  return { type: 'radical', key: name, character: char ?? name,
           meaning: name, reading: null, radicals: [] };
}

function resolveAuto(input) {
  // Try kanji first (single CJK character), then vocab
  const isSingleKanji = /^\p{Script=Han}$/u.test(input);
  if (isSingleKanji) return resolveKanji(input);
  const vocabResult = resolveVocab(input);
  if (vocabResult) return vocabResult;
  // Fall back to treating it as a radical name
  return resolveRadical(input);
}

function resolveEntry() {
  if (TYPE_VOCAB)   return resolveVocab(INPUT)   ?? { type: 'vocab',   key: INPUT, character: INPUT, meaning: INPUT, reading: null, radicals: [] };
  if (TYPE_RADICAL) return resolveRadical(INPUT)  ?? { type: 'radical', key: INPUT, character: INPUT, meaning: INPUT, reading: null, radicals: [] };
  return resolveAuto(INPUT) ?? { type: 'kanji', key: INPUT, character: INPUT, meaning: INPUT, reading: null, radicals: [] };
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildVisualPrompt(entry) {
  const { type, character, meaning, radicals } = entry;

  if (type === 'kanji') {
    const radList = radicals.length ? radicals.join(', ') : '—';
    return `Japanese kanji visual mnemonic. Output JSON only.

${character} | meaning: ${meaning} | radicals: ${radList}

Use the radicals as props in a vivid 1-2 sentence scene. The scene should make the meaning obvious. No pronunciation sounds.

{"mnemonic_meaning": "..."}`;
  }

  if (type === 'radical') {
    return `Japanese kanji radical visual mnemonic. Output JSON only.

Radical name: ${meaning}${character !== meaning ? ` | character: ${character}` : ''}

Describe the visual shape of this radical in a vivid, memorable 1-2 sentence scene. Make the reader see the shape and remember the name.

{"mnemonic_meaning": "..."}`;
  }

  // vocab
  return `Japanese vocabulary visual mnemonic. Output JSON only.

Word: ${character} | meaning: ${meaning}

Create a vivid 1-2 sentence scene that makes the meaning of this word instantly memorable. No pronunciation sounds.

{"mnemonic_meaning": "..."}`;
}

function buildPronunciationPrompt(entry, visualMnemonic) {
  const { character, meaning, reading } = entry;
  if (!reading) return null;

  const ipa  = IPA[reading] ?? '?';
  const cast = CAST[reading];

  const anchor = cast
    ? `Use **${cast.name}** (${cast.description}) as the main character. Bold their name.`
    : `Bold an English word whose START sounds like ${ipa}.`;

  return `Japanese pronunciation mnemonic. Output JSON only.

${character} | meaning: ${meaning} | reading: ${reading} (${ipa})

Continue this visual scene: "${visualMnemonic}"

${anchor} Add 1-2 sentences that connect the sound to the scene and reinforce the meaning.

{"mnemonic_reading": "..."}`;
}

// ─── API calls ───────────────────────────────────────────────────────────────

function callOllama(prompt, field) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: false,
      format: { type: 'object', properties: { [field]: { type: 'string' } }, required: [field] },
      options: { temperature: 0.7, num_predict: 200 },
    });
    const req = http.request(
      { hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 300000 },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            if (!data) return reject(new Error('Empty response from Ollama'));
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error));
            if (!parsed.response) return reject(new Error(`No response field. Raw: ${data.slice(0, 200)}`));
            resolve(parsed.response.trim());
          } catch (e) { reject(new Error(`Ollama parse error: ${e.message}`)); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timed out')); });
    req.on('error', e => reject(new Error(`Ollama error: ${e.message}`)));
    req.write(body); req.end();
  });
}

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
    });
    const req = https.request(
      { hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            resolve(parsed.candidates[0].content.parts[0].text.trim());
          } catch (e) { reject(new Error(`Gemini parse error: ${e.message}`)); }
        });
      }
    );
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function callModel(prompt, field) {
  return USE_LOCAL ? callOllama(prompt, field) : callGemini(prompt);
}

function parseField(raw, field) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON found in response for "${field}"`);
  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed[field]) throw new Error(`Missing "${field}" in response`);
  return parsed[field];
}

async function callWithRetry(prompt, field, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await callModel(prompt, field);
      return parseField(raw, field);
    } catch (e) {
      if (attempt < retries) {
        const waitMs = USE_LOCAL ? 2000 : 35000;
        process.stdout.write(`\n  Retry ${attempt + 1}/${retries}: ${e.message.slice(0, 80)} (${Math.round(waitMs / 1000)}s)...`);
        await new Promise(r => setTimeout(r, waitMs));
      } else {
        throw e;
      }
    }
  }
}

// ─── Generate one entry ───────────────────────────────────────────────────────

async function generateOne(entry, { silent = false } = {}) {
  if (!silent) {
    const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';
    console.log(`\nGenerating mnemonics via ${mode}`);
    console.log(`  Type    : ${entry.type}`);
    console.log(`  Input   : ${entry.character}${entry.character !== entry.key ? ` (${entry.key})` : ''}`);
    console.log(`  Meaning : ${entry.meaning}`);
    if (entry.reading) {
      const ipa = IPA[entry.reading] ?? '?';
      const cast = CAST[entry.reading];
      console.log(`  Reading : ${entry.reading} (${ipa})${cast ? ` → cast: ${cast.name}` : ''}`);
    }
    if (entry.radicals?.length) console.log(`  Radicals: ${entry.radicals.join(', ')}`);
    console.log('');
  }

  // Step 1: visual mnemonic
  if (!silent) process.stdout.write('  [1/2] Visual... ');
  const mnemonic_meaning = await callWithRetry(buildVisualPrompt(entry), 'mnemonic_meaning');
  if (!silent) console.log('done');

  // Step 2: pronunciation mnemonic — sequential, builds on visual
  let mnemonic_reading = null;
  if (entry.reading) {
    if (!silent) process.stdout.write('  [2/2] Pronunciation... ');
    mnemonic_reading = await callWithRetry(buildPronunciationPrompt(entry, mnemonic_meaning), 'mnemonic_reading');
    if (!mnemonic_reading.includes('**') && !silent) console.warn('\n  Warning: no bold anchor');
    if (!silent) console.log('done');
  } else if (!silent) {
    console.log('  [2/2] Pronunciation: skipped (no reading)');
  }

  return { mnemonic_meaning, ...(mnemonic_reading ? { mnemonic_reading } : {}) };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';

  // ── Batch mode (--level N) ──────────────────────────────────────────────────
  if (LEVEL_FILTER) {
    const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));
    const batch = allKanji.filter(k => k.jlptLevel === LEVEL_FILTER);

    let existing = {};
    if (fs.existsSync(OUT_FILE)) existing = JSON.parse(fs.readFileSync(OUT_FILE));

    const todo = REGEN ? batch : batch.filter(k => !existing[k.character]);
    console.log(`Mode: ${mode} | N${LEVEL_FILTER} kanji: ${batch.length} | Done: ${batch.length - todo.length} | Remaining: ${todo.length}`);
    if (todo.length === 0) { console.log('All done!'); return; }

    const startTime = Date.now();
    let done = 0;

    for (let i = 0; i < todo.length; i++) {
      const k = todo[i];
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const eta = done > 0 ? Math.round((elapsed / done) * (todo.length - done)) : '?';
      process.stdout.write(`\r[${elapsed}s ~${eta}s left] ${i + 1}/${todo.length} ${k.character}   `);

      const reading = k.readings_on[0] ?? k.readings_kun[0]?.replace(/[.-].*/, '') ?? null;
      const entry = { type: 'kanji', key: k.character, character: k.character,
                      meaning: k.meanings[0], reading, radicals: k.radicals.slice(0, 4) };
      try {
        existing[k.character] = await generateOne(entry, { silent: true });
        done++;
        fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
      } catch (e) {
        console.error(`\nFailed ${k.character}: ${e.message}`);
      }

      if (DELAY_MS > 0 && i < todo.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const totalSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone! ${done} new mnemonics in ${totalSec}s. Total: ${Object.keys(existing).length}`);
    return;
  }

  // ── Single mode ─────────────────────────────────────────────────────────────
  const entry = resolveEntry();
  const result = await generateOne(entry);

  console.log('\n─────────────────────────────────────────');
  console.log(`Visual:\n  ${result.mnemonic_meaning}`);
  if (result.mnemonic_reading) console.log(`\nPronunciation:\n  ${result.mnemonic_reading}`);
  console.log('─────────────────────────────────────────\n');

  if (SAVE) {
    let existing = {};
    if (fs.existsSync(OUT_FILE)) existing = JSON.parse(fs.readFileSync(OUT_FILE));
    existing[entry.key] = result;
    fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    console.log(`Saved to mnemonics.json under key "${entry.key}"`);
  }
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
