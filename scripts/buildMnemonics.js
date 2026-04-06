/**
 * Mnemonic generator for kanji, radicals, and vocabulary.
 *
 * Generates in two sequential steps:
 *   1. mnemonic_meaning  — visual/scene mnemonic anchored to the meaning
 *   2. mnemonic_reading  — pronunciation hook that builds on the visual scene
 *
 * Usage:
 *   node scripts/buildMnemonics.js --local 人               # single kanji
 *   node scripts/buildMnemonics.js --local --vocab 人生     # vocabulary word
 *   node scripts/buildMnemonics.js --local --radical Ground # radical by name
 *   node scripts/buildMnemonics.js --local --save 人        # save to mnemonics.json
 *   node scripts/buildMnemonics.js --local --level 5        # batch all N5 kanji
 *   node scripts/buildMnemonics.js --local --level 5 --regen         # overwrite existing
 *   node scripts/buildMnemonics.js --local --level 5 --regen-flagged # overwrite flagged only
 *   node scripts/buildMnemonics.js --local --level 5 --limit 10      # test first 10
 *   node scripts/buildMnemonics.js --local --model qwen3.5:9b 人
 *   GEMINI_API_KEY=AIza... node scripts/buildMnemonics.js 人
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────

const KANJI_JSON    = path.join(__dirname, '../src/data/kanji.json');
const VOCAB_JSON    = path.join(__dirname, '../src/data/vocab.json');
const RADICAL_JSON  = path.join(__dirname, '../src/data/radicalKanji.json');
const IPA_JSON      = path.join(__dirname, './romajiIPA.json');
const CAST_JSON     = path.join(__dirname, './mnemonicCast.json');
const OUT_FILE      = path.join(__dirname, '../src/data/mnemonics.json');
const FLAGGED_FILE  = path.join(__dirname, './mnemonics_flagged.json');

const args          = process.argv.slice(2);
const USE_LOCAL     = args.includes('--local');
const SAVE          = args.includes('--save');
const REGEN         = args.includes('--regen');
const REGEN_FLAGGED = args.includes('--regen-flagged');
const TYPE_VOCAB    = args.includes('--vocab');
const TYPE_RADICAL  = args.includes('--radical');

const modelArg   = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg   = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];
const limitArg   = args.find(a => a.startsWith('--limit=')) ?? args[args.indexOf('--limit') + 1];

const OLLAMA_MODEL  = (USE_LOCAL && modelArg && !modelArg.startsWith('--')) ? modelArg : 'gemma3:12b';
const LEVEL_FILTER  = (levelArg  && !levelArg.startsWith('--'))  ? parseInt(levelArg)  : null;
const LIMIT         = (limitArg  && !limitArg.startsWith('--'))  ? parseInt(limitArg)  : null;
const DELAY_MS      = USE_LOCAL ? 0 : 13000;

// Target string — last non-flag arg (ignored in batch mode)
const INPUT = LEVEL_FILTER ? null
  : args.filter(a => !a.startsWith('--') && a !== modelArg && a !== levelArg && a !== limitArg).pop();

// Load .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!USE_LOCAL && !GEMINI_KEY) { console.error('No GEMINI_API_KEY. Use --local or set GEMINI_API_KEY.'); process.exit(1); }
if (!INPUT && !LEVEL_FILTER)   { console.error('Usage: node scripts/buildMnemonics.js [--local] [--save] [--vocab|--radical] <character>\n       node scripts/buildMnemonics.js [--local] --level 5 [--regen] [--limit N]'); process.exit(1); }

// ─── Reference data ───────────────────────────────────────────────────────────

const IPA  = JSON.parse(fs.readFileSync(IPA_JSON)).mora;
const CAST = Object.fromEntries(
  JSON.parse(fs.readFileSync(CAST_JSON)).cast.map(e => [e.sound, e])
);

// ─── Resolve input ────────────────────────────────────────────────────────────

/**
 * @typedef {{ type: 'kanji'|'radical'|'vocab', key: string, character: string,
 *             meaning: string, reading: string|null, radicals: string[] }} Entry
 */

function resolveKanji(char) {
  const k = JSON.parse(fs.readFileSync(KANJI_JSON)).find(e => e.character === char);
  if (!k) return null;
  const reading = k.readings_on[0] ?? k.readings_kun[0]?.replace(/[.-].*/, '') ?? null;
  return { type: 'kanji', key: char, character: char, meaning: k.meanings[0],
           reading, radicals: k.radicals.slice(0, 4), _raw: k };
}

function resolveVocab(word) {
  const flat = Object.values(JSON.parse(fs.readFileSync(VOCAB_JSON))).flat();
  const v = flat.find(e => e.word === word);
  if (!v) return null;
  return { type: 'vocab', key: word, character: word, meaning: v.meaning,
           reading: v.reading, radicals: [] };
}

function resolveRadical(name) {
  const char = JSON.parse(fs.readFileSync(RADICAL_JSON))[name] ?? null;
  return { type: 'radical', key: name, character: char ?? name,
           meaning: name, reading: null, radicals: [] };
}

function resolveEntry() {
  if (TYPE_VOCAB)   return resolveVocab(INPUT)   ?? { type: 'vocab',   key: INPUT, character: INPUT, meaning: INPUT, reading: null, radicals: [] };
  if (TYPE_RADICAL) return resolveRadical(INPUT)  ?? { type: 'radical', key: INPUT, character: INPUT, meaning: INPUT, reading: null, radicals: [] };
  if (/^\p{Script=Han}$/u.test(INPUT)) return resolveKanji(INPUT);
  return resolveVocab(INPUT) ?? resolveRadical(INPUT) ?? { type: 'kanji', key: INPUT, character: INPUT, meaning: INPUT, reading: null, radicals: [] };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const NUMBER_CHARS = new Set(['一','二','三','四','五','六','七','八','九','十','百','千','万']);

// True when the kanji's only radicals are the meaning itself — no scene props available
function isSelfReferential(entry) {
  return entry.radicals.length > 0 && entry.radicals.every(r => r === entry.meaning);
}

function buildMeaningPrompt(entry) {
  const { type, character, meaning, radicals } = entry;

  // ── Radical ──
  if (type === 'radical') {
    return `Japanese radical mnemonic. Output JSON only. No explanation, just the JSON.

Radical: ${meaning}${character !== meaning ? ` | character: ${character}` : ''}

Look at the shape of the character. In 1-2 sentences describe what the strokes physically look like. Bold **${meaning}** once.

Example — 木 (tree)
{"mnemonic_meaning": "A vertical trunk with two branches spreading up and two roots reaching down — it's a **tree** drawn in four strokes."}

Example — 走 (run)
{"mnemonic_meaning": "A figure leans forward with speed lines flying off its head — someone **running** so fast they're almost airborne."}

{"mnemonic_meaning": "..."}`;
  }

  // ── Vocab ──
  if (type === 'vocab') {
    return `Japanese vocabulary meaning mnemonic. Output JSON only. No explanation, just the JSON.

Word: ${character} | meaning: ${meaning}

Write a vivid 2-3 sentence present-tense scene that makes **${meaning}** instantly memorable. Bold **${meaning}** once.

Example — 月光 | meaning: moonlight
{"mnemonic_meaning": "You step outside at midnight and the whole yard is silver. The **moonlight** is so bright you can read by it — every leaf casts a sharp shadow."}

{"mnemonic_meaning": "..."}`;
  }

  // ── Kanji: pictographic / number (no useful radical props) ──
  if (NUMBER_CHARS.has(character) || isSelfReferential(entry)) {
    return `Japanese kanji meaning mnemonic. Output JSON only. No explanation, just the JSON.

${character} | meaning: ${meaning}

This kanji is pictographic — its strokes form a picture. Describe in 2-3 vivid present-tense sentences what the strokes physically look like and what they draw. Bold **${meaning}** once. Do NOT count things using the meaning word.

Example — 人 | meaning: person
{"mnemonic_meaning": "Two strokes lean against each other like a pair of legs mid-stride — someone is walking. Those two lines ARE a **person**, caught in a single step."}

Example — 山 | meaning: mountain
{"mnemonic_meaning": "Three peaks rise from a flat base, the tallest in the centre flanked by two shorter ones — a **mountain** range drawn in three strokes."}

{"mnemonic_meaning": "..."}`;
  }

  // ── Kanji: radical-based scene ──
  const radList = radicals.join(', ');
  return `Japanese kanji meaning mnemonic. Output JSON only. No explanation, just the JSON.

${character} | meaning: ${meaning} | radicals: ${radList}

Rules:
- Treat each radical as a real physical object or person in a scene
- 2-3 vivid present-tense sentences
- Bold **${meaning}** once where it fits naturally
- No pronunciation sounds

Example — 休 | meaning: rest | radicals: Person, Tree
{"mnemonic_meaning": "A **person** stumbles out of the city and collapses against a **tree**. They close their eyes — this is what true **rest** feels like."}

Example — 明 | meaning: bright | radicals: Sun, Moon
{"mnemonic_meaning": "The **sun** and **moon** are in the sky at the same time, flooding everything with twice the usual light — impossibly **bright**."}

{"mnemonic_meaning": "..."}`;
}

function buildReadingPrompt(entry, visualMnemonic) {
  const { character, meaning, reading } = entry;
  if (!reading) return null;

  const ipa  = IPA[reading] ?? '?';
  const cast = CAST[reading];

  const anchor = cast
    ? `${cast.name} (${cast.description}) walks into the scene. Bold ONLY the part of their name that matches the reading sound ${reading} — e.g. reading じん + name Jinny → write **Jin**ny.`
    : `Introduce a person or object whose name starts with the sound ${ipa}. Bold only the matching sound portion.`;

  return `Japanese reading mnemonic. Output JSON only. No explanation, just the JSON.

${character} | meaning: ${meaning} | reading: ${reading} (${ipa})

Scene so far: "${visualMnemonic}"

${anchor} Continue the scene in 2-3 sentences.

Example — 人 | meaning: person | reading: じん /dʒɪn/
Cast: Jinny → **Jin**ny
{"mnemonic_reading": "**Jin**ny rushes in, nearly colliding with the walking person — she's always in a hurry, that **Jin**ny."}

Example — 山 | meaning: mountain | reading: さん /sɑːn/
Cast: Sandra → **San**dra
{"mnemonic_reading": "**San**dra has been climbing this mountain for three days, boots worn to nothing. She plants her flag at the peak and shouts her own name into the wind."}

{"mnemonic_reading": "..."}`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

function callOllama(prompt, field) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: false,
      format: { type: 'object', properties: { [field]: { type: 'string' } }, required: [field] },
      options: { temperature: 0.7, num_predict: 400, repeat_penalty: 1.4, repeat_last_n: 128, think: false },
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
            const text = parsed.response || parsed.thinking || '';
            if (!text) return reject(new Error(`No response field. Raw: ${data.slice(0, 200)}`));
            resolve(text.trim());
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
      generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
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

function callModel(prompt, field) { return USE_LOCAL ? callOllama(prompt, field) : callGemini(prompt); }

function isRepetitionLoop(text) { return /(\b\w+\b)(?:[-\s]+\1){3,}/i.test(text); }

function parseField(raw, field) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed[field]) return parsed[field];
    } catch {}
  }
  // Fallback for truncated JSON
  const truncated = raw.match(new RegExp(`"${field}"\\s*:\\s*"([^"]{20,})`));
  if (truncated) return truncated[1].trim();
  console.error('\n--- RAW ---\n' + raw.slice(0, 300) + '\n--- END ---');
  throw new Error(`No JSON found in response for "${field}"`);
}

async function callWithRetry(prompt, field, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const value = parseField(await callModel(prompt, field), field);
      if (isRepetitionLoop(value)) throw new Error('Repetition loop detected');
      return value;
    } catch (e) {
      if (attempt < retries) {
        const waitMs = USE_LOCAL ? 2000 : 35000;
        process.stdout.write(`\n  Retry ${attempt + 1}/${retries}: ${e.message.slice(0, 80)} (${Math.round(waitMs / 1000)}s)...`);
        await new Promise(r => setTimeout(r, waitMs));
      } else { throw e; }
    }
  }
}

// ─── Generate one entry ───────────────────────────────────────────────────────

async function generateOne(entry, { silent = false } = {}) {
  if (!silent) {
    const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';
    console.log(`\nGenerating via ${mode} | ${entry.type}: ${entry.character}  meaning: ${entry.meaning}${entry.reading ? `  reading: ${entry.reading}` : ''}`);
    if (entry.radicals?.length) console.log(`  Radicals: ${entry.radicals.join(', ')}`);
    console.log('');
  }

  if (!silent) process.stdout.write('  [1/2] Meaning... ');
  const mnemonic_meaning = await callWithRetry(buildMeaningPrompt(entry), 'mnemonic_meaning');
  if (!silent) console.log('done');

  let mnemonic_reading = null;
  if (entry.reading) {
    if (!silent) process.stdout.write('  [2/2] Reading... ');
    mnemonic_reading = await callWithRetry(buildReadingPrompt(entry, mnemonic_meaning), 'mnemonic_reading');
    if (!mnemonic_reading.includes('**') && !silent) console.warn('\n  Warning: no bold anchor');
    if (!silent) console.log('done');
  } else if (!silent) {
    console.log('  [2/2] Reading: skipped (no reading)');
  }

  return { mnemonic_meaning, ...(mnemonic_reading ? { mnemonic_reading } : {}) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';

  // ── Batch mode ────────────────────────────────────────────────────────────────
  if (LEVEL_FILTER) {
    const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));
    const batch = allKanji.filter(k => k.jlptLevel === LEVEL_FILTER);

    let existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE)) : {};

    if (REGEN_FLAGGED && fs.existsSync(FLAGGED_FILE)) {
      const flagged = JSON.parse(fs.readFileSync(FLAGGED_FILE));
      let cleared = 0;
      for (const char of Object.keys(flagged)) { if (existing[char]) { delete existing[char]; cleared++; } }
      console.log(`--regen-flagged: cleared ${cleared} entries`);
    }

    let todo = (REGEN || REGEN_FLAGGED) ? batch : batch.filter(k => !existing[k.character]);
    if (REGEN_FLAGGED && fs.existsSync(FLAGGED_FILE)) {
      const flagged = JSON.parse(fs.readFileSync(FLAGGED_FILE));
      todo = batch.filter(k => flagged[k.character]);
    }
    if (LIMIT) todo = todo.slice(0, LIMIT);

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

  // ── Single mode ───────────────────────────────────────────────────────────────
  const entry = resolveEntry();
  const result = await generateOne(entry);

  console.log('\n─────────────────────────────────────────');
  console.log(`Meaning:\n  ${result.mnemonic_meaning}`);
  if (result.mnemonic_reading) console.log(`\nReading:\n  ${result.mnemonic_reading}`);
  console.log('─────────────────────────────────────────\n');

  if (SAVE) {
    const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE)) : {};
    existing[entry.key] = result;
    fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    console.log(`Saved under key "${entry.key}"`);
  }
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
