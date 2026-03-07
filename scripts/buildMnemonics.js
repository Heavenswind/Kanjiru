/**
 * Generates mnemonics for all kanji using the Gemini API (free tier).
 * Saves progress to src/data/mnemonics.json incrementally.
 * Safe to re-run — skips already-generated entries.
 *
 * Get a free API key at: https://aistudio.google.com/apikey
 *
 * Usage:
 *   GEMINI_API_KEY=AIza... node scripts/buildMnemonics.js
 *
 * Optional: process only one JLPT level
 *   JLPT_LEVEL=5 GEMINI_API_KEY=AIza... node scripts/buildMnemonics.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load .env file
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
}

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const OUT_FILE = path.join(__dirname, '../src/data/mnemonics.json');
const BATCH_SIZE = 10;  // kanji per API call (smaller = fits in maxOutputTokens)
const DELAY_MS = 13000; // 13s between calls = ~4.6 req/min (free tier limit: 5/min)

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY not found in .env or environment');
  process.exit(1);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {temperature: 0.7, maxOutputTokens: 4096},
    });

    const model = 'gemini-2.5-flash';
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${API_KEY}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
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
            reject(new Error(`Parse error: ${e.message}\nRaw: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(batch) {
  const lines = batch
    .map(k => {
      const on = k.readings_on.slice(0, 2).join(', ') || '—';
      const kun = k.readings_kun
        .slice(0, 2)
        .map(r => r.replace(/[.-].*/, ''))
        .filter(Boolean)
        .join(', ') || '—';
      return `${k.character} | ${k.meanings[0]} | on: ${on} | kun: ${kun} | radicals: ${k.radicals.slice(0, 3).join(', ') || '—'}`;
    })
    .join('\n');

  return `You are a Japanese kanji teacher. For each kanji below, write a short memorable mnemonic (1-2 sentences max) that helps an English speaker remember the meaning. Use the radical components and/or the shape of the kanji to build a vivid visual story. Keep it concise and imaginative.

Format your response as valid JSON only — an object where each key is the kanji character and the value is the mnemonic string. No markdown, no explanation, just the JSON object.

Kanji (character | meaning | on-yomi | kun-yomi | radicals):
${lines}`;
}

async function processBatch(batch, retries = 3) {
  const prompt = buildPrompt(batch);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await callGemini(prompt);
      // Strip markdown code fences if present
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Extract retry delay from quota error message if present
      const retryMatch = e.message.match(/retry in (\d+(\.\d+)?)s/);
      const waitMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000 : 35000;
      if (attempt < retries) {
        process.stdout.write(`\n  Rate limited, waiting ${Math.round(waitMs / 1000)}s...`);
        await sleep(waitMs);
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));

  // Filter by JLPT level if requested
  const levelFilter = process.env.JLPT_LEVEL ? parseInt(process.env.JLPT_LEVEL) : null;
  const kanji = levelFilter ? allKanji.filter(k => k.jlptLevel === levelFilter) : allKanji;

  // Load existing progress
  let existing = {};
  if (fs.existsSync(OUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUT_FILE));
  }

  const todo = kanji.filter(k => !existing[k.character]);
  console.log(`Total: ${kanji.length} | Already done: ${kanji.length - todo.length} | Remaining: ${todo.length}`);

  if (todo.length === 0) {
    console.log('All done!');
    return;
  }

  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    process.stdout.write(`\rProcessing ${i + 1}–${Math.min(i + BATCH_SIZE, todo.length)} / ${todo.length}...`);

    try {
      const results = await processBatch(batch);
      Object.assign(existing, results);
      done += Object.keys(results).length;

      // Save after every batch
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error(`\nBatch failed (${batch.map(k => k.character).join('')}):`, e.message);
      // Save what we have and continue
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    }

    if (i + BATCH_SIZE < todo.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone! Generated ${done} new mnemonics. Total: ${Object.keys(existing).length}`);
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`File size: ${sizeMB} MB`);
}

main().catch(console.error);
