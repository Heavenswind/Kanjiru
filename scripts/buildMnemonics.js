/**
 * Generates mnemonic stories for all kanji.
 * Saves incrementally to src/data/mnemonics.json — safe to re-run.
 *
 * Each story anchors the on-yomi reading using its IPA, and weaves in the
 * kanji's radicals as scene props. The meaning is never stated — it emerges.
 *
 * Usage:
 *   node scripts/buildMnemonics.js --local
 *   node scripts/buildMnemonics.js --local --model qwen2.5:14b
 *   GEMINI_API_KEY=AIza... node scripts/buildMnemonics.js
 *   node scripts/buildMnemonics.js --local --level 5
 *   node scripts/buildMnemonics.js --local --regen
 *   node scripts/buildMnemonics.js --local --regen-flagged
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────

const KANJI_JSON   = path.join(__dirname, '../src/data/kanji.json');
const IPA_JSON     = path.join(__dirname, './romajiIPA.json');
const CAST_JSON    = path.join(__dirname, './mnemonicCast.json');
const OUT_FILE     = path.join(__dirname, '../src/data/mnemonics.json');
const FLAGGED_FILE = path.join(__dirname, './mnemonics_flagged.json');

const args = process.argv.slice(2);
const USE_LOCAL = args.includes('--local');
const REGEN = args.includes('--regen');
const REGEN_FLAGGED = args.includes('--regen-flagged');
const modelArg = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];
const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--')) ? modelArg : 'gemma3:12b';
const DELAY_MS = USE_LOCAL ? 0 : 13000;

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

// ─── Load data ───────────────────────────────────────────────────────────────

const IPA  = JSON.parse(fs.readFileSync(IPA_JSON)).mora;
const CAST = Object.fromEntries(
  JSON.parse(fs.readFileSync(CAST_JSON)).cast.map(e => [e.sound, e])
);

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(k) {
  const reading  = k.readings_on[0] ?? k.readings_kun[0]?.replace(/[.-].*/, '');
  const ipa      = IPA[reading] ?? '?';
  const cast     = CAST[reading];
  const radicals = k.radicals.slice(0, 4).join(', ') || '—';
  const meaning  = k.meanings[0];

  const anchorInstruction = cast
    ? `Bold the name **${cast.name}** (${cast.description}) — their name starts with ${ipa}, which matches this reading exactly.`
    : `Bold an English word whose first sounds match ${ipa}. Do NOT use any character name.`;

  return `Write a single mnemonic story (2-3 sentences) for this Japanese kanji.

Kanji: ${k.character}
Meaning: ${meaning}
Radicals: ${radicals}
Reading: ${reading} (${ipa})

Rules:
1. Sound anchor: ${anchorInstruction}
2. Use the radicals as physical objects or characters in the scene.
3. NEVER write the meaning "${meaning}" or any synonym. It must emerge from the scene.
4. Vivid and concrete. 2-3 sentences max.

Respond with ONLY the story. No labels, no explanation.`;
}

// ─── API ─────────────────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: false,
      options: { temperature: 0.7, num_predict: 300 },
    });
    const req = http.request(
      {
        hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
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
      generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
    });
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
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

// ─── Process one kanji ───────────────────────────────────────────────────────

async function processOne(k, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const story = await callModel(buildPrompt(k));
      if (!story) throw new Error('Empty response');
      if (!story.includes('**')) throw new Error('No bold anchor in story');
      return story;
    } catch (e) {
      if (attempt < retries) {
        const retryMatch = e.message.match(/retry in (\d+(\.\d+)?)s/);
        const waitMs = retryMatch
          ? Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000
          : (USE_LOCAL ? 2000 : 35000);
        process.stdout.write(`\n  Retry ${attempt + 1}/${retries}: ${e.message.slice(0, 80)} (${Math.round(waitMs / 1000)}s)`);
        await sleep(waitMs);
      } else {
        throw e;
      }
    }
  }
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
    // Drop old-format entries
    let dropped = 0;
    for (const [char, val] of Object.entries(existing)) {
      if (!val?.story) { delete existing[char]; dropped++; }
    }
    if (dropped > 0) console.log(`Dropped ${dropped} old-format entries`);
  }

  if (REGEN_FLAGGED && fs.existsSync(FLAGGED_FILE)) {
    const flagged = JSON.parse(fs.readFileSync(FLAGGED_FILE));
    let cleared = 0;
    for (const char of Object.keys(flagged)) {
      if (existing[char]) { delete existing[char]; cleared++; }
    }
    console.log(`--regen-flagged: cleared ${cleared} entries`);
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
      const story = await processOne(k);
      existing[k.character] = { story };
      done++;
      fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error(`\nFailed ${k.character}: ${e.message}`);
    }

    if (DELAY_MS > 0 && i < todo.length - 1) await sleep(DELAY_MS);
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone! ${done} new stories in ${totalSec}s. Total: ${Object.keys(existing).length}`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
