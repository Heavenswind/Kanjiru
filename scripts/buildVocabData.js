/**
 * Generates vocabulary examples for all kanji.
 * Saves incrementally to src/data/vocab.json — safe to re-run.
 *
 * Two-pass approach:
 *   Pass 1: get word + reading + meaning (JSON, 3 entries)
 *   Pass 2: for each word, build story using the word's ACTUAL reading — cast/IPA anchors
 *           are resolved in code from the real reading, then injected into the story prompt.
 *
 * Usage:
 *   node scripts/buildVocabData.js --local
 *   node scripts/buildVocabData.js --local --model qwen2.5:14b
 *   GEMINI_API_KEY=AIza... node scripts/buildVocabData.js
 *   node scripts/buildVocabData.js --local --level 5
 *   node scripts/buildVocabData.js --local --regen
 */

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const IPA_JSON   = path.join(__dirname, './romajiIPA.json');
const CAST_JSON  = path.join(__dirname, './mnemonicCast.json');
const OUT_FILE   = path.join(__dirname, '../src/data/vocab.json');

const args         = process.argv.slice(2);
const USE_LOCAL    = args.includes('--local');
const REGEN        = args.includes('--regen');
const modelArg     = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg     = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];
const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--')) ? modelArg : 'gemma3:12b';
const DELAY_MS     = USE_LOCAL ? 0 : 4000; // between API calls (pass 1 + pass 2 × 3 = 4 calls per kanji)

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

// ─── Load data ───────────────────────────────────────────────────────────────

const IPA  = JSON.parse(fs.readFileSync(IPA_JSON)).mora;
const CAST = Object.fromEntries(
  JSON.parse(fs.readFileSync(CAST_JSON)).cast.map(e => [e.sound, e])
);

// ─── Mora splitter ───────────────────────────────────────────────────────────

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょァィゥェォャュョ');

function toHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function splitMora(reading) {
  const hira = toHiragana(reading);
  const mora = [];
  let i = 0;
  while (i < hira.length) {
    const cur = hira[i], next = hira[i + 1];
    if (next && SMALL_KANA.has(next)) { mora.push(cur + next); i += 2; }
    else { mora.push(cur); i++; }
  }
  return mora;
}

// ─── Reading → anchor instructions ───────────────────────────────────────────

/**
 * For a full hiragana reading, returns a list of anchor instructions —
 * one per mora that has either a cast character or an IPA entry.
 * The model is told exactly what to bold for each mora, in order.
 */
function buildAnchorInstructions(reading) {
  const mora = splitMora(reading);
  const instructions = [];

  for (const m of mora) {
    if (m === 'ー' || m === 'っ' || m === 'ッ') continue; // structural, not anchored
    const cast = CAST[m];
    const ipa  = IPA[m];
    if (cast) {
      instructions.push(`"${m}" → YOU MUST bold **${cast.name}** (${cast.description}, IPA: ${cast.ipa})`);
    } else if (ipa) {
      instructions.push(`"${m}" → bold an English word starting with ${ipa} — NOT a cast name`);
    }
  }

  return instructions;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildPrompt(k) {
  const meaning = k.meanings[0];
  const onReadings = k.readings_on.join(', ') || '—';
  const kunReadings = k.readings_kun.map(r => r.replace(/[.\-].*/g, '').replace(/^-/, '')).filter(Boolean).join(', ') || '—';

  return `You are a Japanese language teacher creating vocabulary study cards.

For the kanji ${k.character} (meaning: ${meaning}), provide exactly 5 common vocabulary words.

Known readings:
- On-yomi (used in compound nouns): ${onReadings}
- Kun-yomi (native Japanese words): ${kunReadings}

RULES:
- EVERY word MUST contain the kanji ${k.character} — no exceptions
- Cover as many different readings as possible across the 5 words
- Include both on-yomi compounds and kun-yomi words where they exist
- Prefer high-frequency words a JLPT N5/N4 learner would encounter
- Readings must be accurate hiragana only
- Meaning: concise English translation, 2-5 words, Title Case
- No duplicates

OUTPUT FORMAT:
Respond with ONLY a JSON array of exactly 5 objects. No markdown, no explanation.
[{"word":"...","reading":"...","meaning":"..."},...]`;
}

// ─── API ─────────────────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: false,
      options: { temperature: 0.6, num_predict: 600 },
    });
    const req = http.request(
      { hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error));
            resolve(parsed.response.trim());
          } catch (e) { reject(new Error(`Ollama parse error: ${e.message}`)); }
        });
      }
    );
    req.on('error', e => reject(new Error(`Ollama error: ${e.message} — is Ollama running?`)));
    req.write(body); req.end();
  });
}

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 600 },
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

function callModel(prompt) { return USE_LOCAL ? callOllama(prompt) : callGemini(prompt); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  const start = stripped.indexOf('[');
  const end   = stripped.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`No JSON array in: ${text.slice(0, 200)}`);
  return JSON.parse(stripped.slice(start, end + 1));
}

async function callWithRetry(prompt, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callModel(prompt);
    } catch (e) {
      if (attempt < retries) {
        const retryMatch = e.message.match(/retry in (\d+(\.\d+)?)s/);
        const waitMs = retryMatch
          ? Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000
          : (USE_LOCAL ? 2000 : 35000);
        process.stdout.write(`\n  Retry ${attempt + 1}/${retries}: ${e.message.slice(0, 80)} (${Math.round(waitMs/1000)}s)`);
        await sleep(waitMs);
      } else {
        throw e;
      }
    }
  }
}

// ─── Process one kanji ───────────────────────────────────────────────────────

async function processOne(k) {
  const text    = await callWithRetry(buildPrompt(k));
  const entries = extractJson(text);

  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('Empty or invalid array');

  for (const e of entries) {
    if (!e.word || !e.reading || !e.meaning)
      throw new Error(`Malformed entry: ${JSON.stringify(e)}`);
    if (!e.word.includes(k.character))
      throw new Error(`Word "${e.word}" does not contain kanji ${k.character}`);
  }

  return entries;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));

  const levelFilter = levelArg
    ? parseInt(levelArg)
    : (process.env.JLPT_LEVEL ? parseInt(process.env.JLPT_LEVEL) : null);
  const kanji = levelFilter ? allKanji.filter(k => k.jlptLevel === levelFilter) : allKanji;

  let existing = {};
  if (!REGEN && fs.existsSync(OUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUT_FILE));
    let dropped = 0;
    for (const [char, entries] of Object.entries(existing)) {
      if (!Array.isArray(entries) || entries.some(e => !e.word || !e.reading || !e.meaning)) {
        delete existing[char]; dropped++;
      }
    }
    if (dropped > 0) console.log(`Dropped ${dropped} malformed entries`);
  }

  const todo = kanji.filter(k => !existing[k.character]);
  const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';
  console.log(`Mode: ${mode} | Total: ${kanji.length} | Done: ${kanji.length - todo.length} | Remaining: ${todo.length}`);
  if (levelFilter) console.log(`JLPT N${levelFilter} only`);
  if (todo.length === 0) { console.log('All done!'); return; }

  const startTime = Date.now();
  let done = 0;

  for (let i = 0; i < todo.length; i++) {
    const k = todo[i];
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta = done > 0 ? Math.round((elapsed / done) * (todo.length - done)) : '?';
    process.stdout.write(`\r[${elapsed}s ~${eta}s left] ${i + 1}/${todo.length} ${k.character}   `);

    try {
      const entries = await processOne(k);
      existing[k.character] = entries;
      done++;
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error(`\nFailed ${k.character}: ${e.message}`);
    }

    if (DELAY_MS > 0 && i < todo.length - 1) await sleep(DELAY_MS);
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone! ${done} kanji vocab generated in ${totalSec}s. Total: ${Object.keys(existing).length}`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
