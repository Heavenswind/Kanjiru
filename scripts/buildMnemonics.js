/**
 * Generates mnemonics for all kanji.
 * Saves progress to src/data/mnemonics.json incrementally — safe to re-run.
 *
 * Each kanji gets:
 *   - "meaning": visual story for what the kanji means (uses radicals/shape)
 *   - "onyomi":  scene featuring a cast character whose name starts with the
 *                on-yomi sound, or a romaji-grounded sound-alike if no cast match
 *   - "kunyomi": romaji-grounded sound-alike for the kun-yomi reading
 *
 * Usage:
 *
 *   # Ollama (local, recommended for 4070):
 *   node scripts/buildMnemonics.js --local
 *   node scripts/buildMnemonics.js --local --model qwen2.5:14b
 *
 *   # Gemini free tier:
 *   GEMINI_API_KEY=AIza... node scripts/buildMnemonics.js
 *
 *   # Process only one JLPT level:
 *   node scripts/buildMnemonics.js --local --level 5
 *   JLPT_LEVEL=5 GEMINI_API_KEY=AIza... node scripts/buildMnemonics.js
 *
 *   # Wipe existing and regenerate:
 *   node scripts/buildMnemonics.js --local --regen
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── Config ────────────────────────────────────────────────────────────────

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const CAST_JSON  = path.join(__dirname, './mnemonicCast.json');
const OUT_FILE   = path.join(__dirname, '../src/data/mnemonics.json');
const BATCH_SIZE = 10;

const args = process.argv.slice(2);
const USE_LOCAL = args.includes('--local');
const REGEN     = args.includes('--regen');
const modelArg  = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg  = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];

const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--'))
  ? modelArg
  : 'qwen2.5:7b';
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

// ─── Cast system ────────────────────────────────────────────────────────────

const castData = JSON.parse(fs.readFileSync(CAST_JSON));
const CAST = {};
for (const entry of castData.cast) {
  CAST[entry.sound] = { name: entry.name, description: entry.description };
}

const CAST_REFERENCE = castData.cast
  .map(e => `  ${e.sound} → ${e.name}: ${e.description}`)
  .join('\n');

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(batch) {
  const lines = batch.map(k => {
    const on  = k.readings_on.slice(0, 2).join(', ') || '—';
    const kun = k.readings_kun.slice(0, 2).map(r => r.replace(/[.-].*/,'')).filter(Boolean).join(', ') || '—';
    return `${k.character} | ${k.meanings[0]} | on: ${on} | kun: ${kun} | radicals: ${k.radicals.slice(0, 3).join(', ') || '—'}`;
  }).join('\n');

  return `You are a Japanese kanji teacher creating memory aids for English speakers.

For each kanji produce up to three mnemonics:

1. "meaning" — a vivid 1-2 sentence visual story using the kanji's shape or radical components to remember its meaning. Make it strange or funny — emotional scenes stick better.

2. "onyomi" — a 1-2 sentence scene that anchors the on-yomi reading sound. Omit if on-yomi is "—".
   Rules:
   - CAST SYSTEM: recurring characters whose names start with specific Japanese sounds. If the on-yomi exactly matches a cast entry's sound, use that character naturally in the scene — do NOT explain why, just tell the story.
   - If no cast match: use a real English word that starts with the same sounds as the romaji reading (e.g. こう → "coat", ぶん → "boon", すい → "suit"). The English word must genuinely start with those sounds — no loose approximations.
   - The scene should also hint at the kanji's meaning.

3. "kunyomi" — a 1-2 sentence scene that anchors the kun-yomi reading sound. Omit if kun-yomi is "—".
   Rules:
   - Same sound-alike approach as onyomi — cast characters can appear here too if syllables match.
   - Kun readings are often short (1-2 mora) — a single vivid English word starting with those sounds is enough.

Cast reference (hiragana sound → character name: description):
${CAST_REFERENCE}

Respond with ONLY valid JSON — an object where each key is the kanji character and the value is an object with "meaning", and optionally "onyomi" / "kunyomi". No markdown, no explanation.

Example:
{
  "感": {
    "meaning": "A heart (心) picking up signals from the world — it feels everything around it.",
    "onyomi": "Khan rode into the village and everyone felt a wave of emotion — awe, fear, and something they couldn't name.",
    "kunyomi": "Kanzuru — 'can zoo' — you can feel the whole zoo of emotions at once."
  },
  "山": {
    "meaning": "Three peaks rising from flat ground — it draws itself: a mountain.",
    "onyomi": "Sosa hit the ball so hard it flew over the mountain.",
    "kunyomi": "Yama — 'yam' — a giant yam-shaped mountain blocking the road."
  }
}

Kanji (character | meaning | on-yomi | kun-yomi | radicals):
${lines}`;
}

// ─── API callers ────────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {temperature: 0.7, num_predict: 6000},
    });

    const req = require('http').request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/generate',
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
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
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {temperature: 0.7, maxOutputTokens: 6000},
    });
    const model = 'gemini-2.5-flash';
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
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
  const end   = stripped.lastIndexOf('}');
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
        const entry = result[k.character];
        if (!entry || typeof entry.meaning !== 'string' || entry.meaning.trim() === '') {
          throw new Error(`Missing or invalid meaning for ${k.character}`);
        }
      }

      return result;
    } catch (e) {
      if (attempt < retries) {
        const retryMatch = e.message.match(/retry in (\d+(\.\d+)?)s/);
        const waitMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000 : (USE_LOCAL ? 2000 : 35000);
        process.stdout.write(`\n  Retrying (${attempt + 1}/${retries}): ${e.message.slice(0, 80)}... waiting ${Math.round(waitMs/1000)}s`);
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

  const levelFilter = levelArg ? parseInt(levelArg) : (process.env.JLPT_LEVEL ? parseInt(process.env.JLPT_LEVEL) : null);
  const kanji = levelFilter ? allKanji.filter(k => k.jlptLevel === levelFilter) : allKanji;

  let existing = {};
  if (!REGEN && fs.existsSync(OUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUT_FILE));
    // Drop old plain-string entries — regenerate in new format
    let migrated = 0;
    for (const [char, val] of Object.entries(existing)) {
      if (typeof val === 'string') {
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

  if (todo.length === 0) {
    console.log('All done!');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta = done > 0
      ? Math.round((elapsed / done) * (todo.length - done))
      : '?';
    process.stdout.write(`\r[${elapsed}s elapsed, ~${eta}s left] Processing ${i + 1}–${Math.min(i + BATCH_SIZE, todo.length)} / ${todo.length}...  `);

    try {
      const results = await processBatch(batch);
      Object.assign(existing, results);
      done += Object.keys(results).length;
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error(`\nBatch failed (${batch.map(k => k.character).join('')}): ${e.message}`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    }

    if (DELAY_MS > 0 && i + BATCH_SIZE < todo.length) {
      await sleep(DELAY_MS);
    }
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\nDone! Generated ${done} new entries in ${totalSec}s. Total: ${Object.keys(existing).length} kanji. File: ${sizeMB} MB`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
