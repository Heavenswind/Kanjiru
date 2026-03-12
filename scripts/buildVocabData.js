/**
 * Generates vocabulary examples for all kanji.
 * Saves progress to src/data/vocab.json incrementally — safe to re-run.
 *
 * Each kanji gets 3 example words: word, reading (hiragana), meaning (English).
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
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── Config ────────────────────────────────────────────────────────────────

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const OUT_FILE   = path.join(__dirname, '../src/data/vocab.json');
const BATCH_SIZE = 10; // kanji per API call

// Parse CLI args
const args = process.argv.slice(2);
const USE_LOCAL  = args.includes('--local');
const modelArg   = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg   = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];

const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--'))
  ? modelArg
  : 'qwen2.5:7b';
const OLLAMA_URL  = 'http://localhost:11434/api/generate';
const DELAY_MS    = USE_LOCAL ? 0 : 13000; // no delay for local; 13s for Gemini free tier

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

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(batch) {
  const lines = batch.map(k => {
    const on  = k.readings_on.slice(0, 2).join(', ') || '—';
    const kun = k.readings_kun.slice(0, 2).map(r => r.replace(/[.-].*/,'')).filter(Boolean).join(', ') || '—';
    return `${k.character} | ${k.meanings[0]} | on: ${on} | kun: ${kun}`;
  }).join('\n');

  return `You are a Japanese language teacher. For each kanji below, provide exactly 3 common Japanese vocabulary words that use this kanji. Choose words that clearly demonstrate the kanji's core meaning and are commonly used.

For each word provide:
- "word": the Japanese word (kanji + kana as normally written)
- "reading": the full hiragana reading of the word
- "meaning": a concise English translation (3-6 words)

Rules:
- Prefer simple, high-frequency words over obscure ones
- The word MUST contain the given kanji character
- Readings must be accurate hiragana (no romaji)
- For N5/N4 kanji, prefer words learnable at beginner level

Respond with ONLY valid JSON — an object where each key is the kanji character and the value is an array of 3 word objects. No markdown, no explanation.

Example format:
{
  "一": [
    {"word": "一つ", "reading": "ひとつ", "meaning": "one thing"},
    {"word": "一日", "reading": "いちにち", "meaning": "one day"},
    {"word": "一人", "reading": "ひとり", "meaning": "one person, alone"}
  ]
}

Kanji (character | primary meaning | on-yomi | kun-yomi):
${lines}`;
}

// ─── API callers ────────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {temperature: 0.3, num_predict: 4096},
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
      generationConfig: {temperature: 0.3, maxOutputTokens: 4096},
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
  // Strip markdown fences
  const stripped = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  // Find outermost { ... }
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

      // Validate: each kanji should have an array of word objects
      for (const k of batch) {
        const entries = result[k.character];
        if (!Array.isArray(entries) || entries.length === 0) {
          throw new Error(`Missing or empty entries for ${k.character}`);
        }
        for (const e of entries) {
          if (!e.word || !e.reading || !e.meaning) {
            throw new Error(`Malformed entry for ${k.character}: ${JSON.stringify(e)}`);
          }
        }
      }

      return result;
    } catch (e) {
      if (attempt < retries) {
        // Gemini rate limit: parse retry delay from message
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
  if (fs.existsSync(OUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUT_FILE));
  }

  const todo = kanji.filter(k => !existing[k.character]);
  const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';
  console.log(`Mode: ${mode}`);
  console.log(`Total: ${kanji.length} | Done: ${kanji.length - todo.length} | Remaining: ${todo.length}`);
  if (levelFilter) console.log(`Filtering to JLPT N${levelFilter}`);

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
