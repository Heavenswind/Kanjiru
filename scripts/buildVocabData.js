/**
 * Generates vocabulary examples for all kanji.
 * Saves progress to src/data/vocab.json incrementally — safe to re-run.
 *
 * Each kanji gets 3 example words: word, reading (hiragana), meaning (English),
 * and a unified "story" mnemonic that weaves together:
 *   - The word's reading anchored mora-by-mora via cast character (exact match only)
 *     or bold English sound-alike (IPA-matched)
 *   - The kanji meanings in the word as visual backdrop
 *   - The word's meaning as the natural punchline
 *
 * Usage:
 *
 *   # Ollama (local, recommended for 4070):
 *   node scripts/buildVocabData.js --local
 *   node scripts/buildVocabData.js --local --model qwen2.5:14b
 *
 *   # Gemini free tier:
 *   GEMINI_API_KEY=AIza... node scripts/buildVocabData.js
 *
 *   # Process only one JLPT level:
 *   node scripts/buildVocabData.js --local --level 5
 *   JLPT_LEVEL=5 GEMINI_API_KEY=AIza... node scripts/buildVocabData.js
 *
 *   # Wipe existing and regenerate:
 *   node scripts/buildVocabData.js --local --regen
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── Config ────────────────────────────────────────────────────────────────

const KANJI_JSON  = path.join(__dirname, '../src/data/kanji.json');
const CAST_JSON   = path.join(__dirname, './mnemonicCast.json');
const IPA_JSON    = path.join(__dirname, './romajiIPA.json');
const OUT_FILE    = path.join(__dirname, '../src/data/vocab.json');
const BATCH_SIZE  = 6;

const args = process.argv.slice(2);
const USE_LOCAL = args.includes('--local');
const REGEN     = args.includes('--regen');
const modelArg  = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg  = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];

const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--'))
  ? modelArg : 'gemma3:12b';
const DELAY_MS = USE_LOCAL ? 0 : 13000;

// Load .env for Gemini key
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!USE_LOCAL && !GEMINI_KEY) {
  console.error('No GEMINI_API_KEY found. Use --local for Ollama or set GEMINI_API_KEY.');
  process.exit(1);
}

// ─── Load reference data ────────────────────────────────────────────────────

const castData  = JSON.parse(fs.readFileSync(CAST_JSON));
const IPA       = JSON.parse(fs.readFileSync(IPA_JSON)).mora;
const kanjiData = JSON.parse(fs.readFileSync(KANJI_JSON));

const CAST = {};
for (const e of castData.cast) CAST[e.sound] = { name: e.name, description: e.description };

const KANJI_MEANINGS = {};
for (const k of kanjiData) KANJI_MEANINGS[k.character] = k.meanings[0];

const CAST_REFERENCE = castData.cast
  .map(e => `  ${e.sound} -> ${e.name}: ${e.description}`)
  .join('\n');

const IPA_REFERENCE = Object.entries(IPA)
  .map(([mora, ipa]) => `  ${mora} = ${ipa}`)
  .join('\n');

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(batch) {
  const lines = batch.map(k => {
    const on  = k.readings_on.slice(0, 2).join(', ') || '-';
    const kun = k.readings_kun.slice(0, 2).map(r => r.replace(/[.-].*/,'')).filter(Boolean).join(', ') || '-';
    return `${k.character} | ${k.meanings[0]} | on: ${on} | kun: ${kun}`;
  }).join('\n');

  return `You are a Japanese language teacher creating vocabulary study cards for English speakers.

For each kanji, provide exactly 3 common vocabulary words. Each word object needs:
- "word": the Japanese word (kanji + kana as normally written)
- "reading": the full hiragana reading
- "meaning": a concise English translation (capitalize each word, 2-5 words, e.g. "Electric Train", "One Day")
- "story": a single vivid scene (1-2 sentences) that anchors the reading AND implies the meaning

STORY RULES:

Anchor the word's reading mora-by-mora using the rules below, working through each mora in order:

A. CAST CHARACTER - use when a mora in the reading exactly matches a cast entry's sound:
   - Drop the character naturally into the scene - bold their name: **Kyu**, **Kofi**, **Ji**
   - EXACT mora match only - never approximate

B. ENGLISH SOUND-ALIKE - use when no cast match exists for a mora:
   - Consult the IPA table for the mora's exact phonemes
   - Find a common English word whose FIRST phonemes exactly match that IPA
   - Bold it: **den**, **coop**, **gin**
   - STRICT phoneme match: /kuu/ = "coop/cool/coup", NOT "queue" (which is /kjuu/)

C. Bold format: one bold element per anchored mora. No other bold text in the story.
D. The word's meaning is the scene's natural conclusion - never state it directly.
E. Use the kanji meanings in the word as visual props or imagery in the scene.
F. Never explain the sound system - just tell the story naturally.

VOCAB RULES:
- The word MUST contain the given kanji character
- Readings must be accurate hiragana (no romaji)
- Prefer high-frequency, real words - no obscure vocabulary
- For N5/N4 kanji prefer beginner-level words
- Capitalize each word in the meaning field

OUTPUT FORMAT:
Respond with ONLY valid JSON. Each key is the kanji character, value is an array of exactly 3 word objects.
No markdown fences, no explanation.

CAST REFERENCE:
${CAST_REFERENCE}

IPA REFERENCE (internal use only - never appear in story output):
${IPA_REFERENCE}

EXAMPLES:
{
  "人": [
    {
      "word": "人口",
      "reading": "じんこう",
      "meaning": "Population",
      "story": "Every **gin**-soaked night, **Kofi** counts the Mouths lining up at his bar - more Persons through the door every week, the whole neighborhood packed in."
    },
    {
      "word": "人気",
      "reading": "にんき",
      "meaning": "Popularity, Fame",
      "story": "A **knee**-deep crowd surrounds **Kiki**, laughing at everything she says - this Person has an Energy nobody can resist."
    }
  ],
  "空": [
    {
      "word": "空港",
      "reading": "くうこう",
      "meaning": "Airport",
      "story": "The **coop** on the roof explodes open just as **Kofi** arrives - birds everywhere, total chaos - turns out he built the terminal right on their nesting ground."
    }
  ]
}

KANJI TO PROCESS:
${lines}`;
}

// ─── API callers ────────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.5, num_predict: 8000 },
    });
    const req = require('http').request(
      {
        hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error));
            resolve(parsed.response);
          } catch (e) {
            reject(new Error(`Ollama parse error: ${e.message}\nRaw: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', e => reject(new Error(`Ollama connection error: ${e.message}\nIs Ollama running? Try: ollama serve`)));
    req.write(body);
    req.end();
  });
}

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 8000 },
    });
    const model = 'gemini-2.5-flash';
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            resolve(parsed.candidates[0].content.parts[0].text);
          } catch (e) {
            reject(new Error(`Gemini parse error: ${e.message}\nRaw: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callModel(prompt) {
  return USE_LOCAL ? callOllama(prompt) : callGemini(prompt);
}

// ─── Batch processor ────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON object found in: ${text.slice(0, 200)}`);
  return JSON.parse(stripped.slice(start, end + 1));
}

async function processBatch(batch, retries = 3) {
  const prompt = buildPrompt(batch);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await callModel(prompt);
      const result = extractJson(text);

      for (const k of batch) {
        const entries = result[k.character];
        if (!Array.isArray(entries) || entries.length === 0) {
          throw new Error(`Missing or empty entries for ${k.character}`);
        }
        for (const e of entries) {
          if (!e.word || !e.reading || !e.meaning || !e.story) {
            throw new Error(`Malformed entry for ${k.character}: ${JSON.stringify(e)}`);
          }
        }
      }

      return result;
    } catch (e) {
      if (attempt < retries) {
        const retryMatch = e.message.match(/retry in (\d+(\.\d+)?)s/);
        const waitMs = retryMatch
          ? Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000
          : (USE_LOCAL ? 2000 : 35000);
        process.stdout.write(`\n  Retrying (${attempt + 1}/${retries}): ${e.message.slice(0, 80)}... waiting ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
      } else {
        throw e;
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));

  const levelFilter = levelArg
    ? parseInt(levelArg)
    : (process.env.JLPT_LEVEL ? parseInt(process.env.JLPT_LEVEL) : null);
  const kanji = levelFilter ? allKanji.filter(k => k.jlptLevel === levelFilter) : allKanji;

  let existing = {};
  if (!REGEN && fs.existsSync(OUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUT_FILE));
    let migrated = 0;
    for (const [char, entries] of Object.entries(existing)) {
      if (Array.isArray(entries) && entries.some(e => !e.story)) {
        delete existing[char];
        migrated++;
      }
    }
    if (migrated > 0) console.log(`Dropped ${migrated} old-format entries (will regenerate)`);
  }

  const todo = kanji.filter(k => !existing[k.character]);
  const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';
  console.log(`Mode: ${mode}`);
  console.log(`Total: ${kanji.length} | Done: ${kanji.length - todo.length} | Remaining: ${todo.length}`);
  if (levelFilter) console.log(`Filtering to JLPT N${levelFilter}`);
  if (REGEN) console.log('--regen flag: starting fresh');

  if (todo.length === 0) { console.log('All done!'); return; }

  const startTime = Date.now();
  let done = 0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta = done > 0 ? Math.round((elapsed / done) * (todo.length - done)) : '?';
    process.stdout.write(`\r[${elapsed}s elapsed, ~${eta}s left] Processing ${i + 1}-${Math.min(i + BATCH_SIZE, todo.length)} / ${todo.length}...  `);

    try {
      const results = await processBatch(batch);
      Object.assign(existing, results);
      done += Object.keys(results).length;
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error(`\nBatch failed (${batch.map(k => k.character).join('')}): ${e.message}`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    }

    if (DELAY_MS > 0 && i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\nDone! Generated ${done} new entries in ${totalSec}s. Total: ${Object.keys(existing).length} kanji. File: ${sizeMB} MB`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
