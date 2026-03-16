/**
 * Generates mnemonics for all kanji.
 * Saves progress to src/data/mnemonics.json incrementally — safe to re-run.
 *
 * Each kanji gets a single unified "story" field — one scene that weaves together:
 *   - The kanji's radicals as visual props/characters
 *   - The on-yomi reading anchored via cast character (exact match only) or bold English sound-alike
 *   - The kun-yomi reading anchored the same way if it adds value without cluttering
 *   - The kanji meaning as the natural punchline — never stated directly
 *
 * Sound anchoring rules:
 *   - Cast character: ONLY if their sound exactly matches the on/kun reading
 *   - Sound-alike: English word whose starting phonemes exactly match the reading's IPA
 *   - The anchor is bolded in the output: **Kyu** or **coop**
 *   - IPA is used internally for precision — never appears in output
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
const CAST_JSON = path.join(__dirname, './mnemonicCast.json');
const RADICAL_KANJI_JSON = path.join(__dirname, './radicalKanji.json');
const PHONETIC_JSON = path.join(__dirname, './phoneticComponents.json');
const IPA_JSON = path.join(__dirname, './romajiIPA.json');
const OUT_FILE = path.join(__dirname, '../src/data/mnemonics.json');

const args = process.argv.slice(2);
const USE_LOCAL = args.includes('--local');

const BATCH_SIZE = USE_LOCAL ? 4 : 8;
const REGEN = args.includes('--regen');
const modelArg = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];

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

const RADICAL_KANJI = JSON.parse(fs.readFileSync(RADICAL_KANJI_JSON));
const castData = JSON.parse(fs.readFileSync(CAST_JSON));
const PHONETIC = JSON.parse(fs.readFileSync(PHONETIC_JSON));
const IPA = JSON.parse(fs.readFileSync(IPA_JSON)).mora;

// Cast map: hiragana sound → { name, description }
const CAST = {};
for (const e of castData.cast) CAST[e.sound] = { name: e.name, description: e.description };

// Reverse phonetic map: kanji character → series info
const KANJI_TO_SERIES = {};
for (const [comp, data] of Object.entries(PHONETIC)) {
  for (const c of data.kanji) {
    if (!KANJI_TO_SERIES[c]) KANJI_TO_SERIES[c] = [];
    KANJI_TO_SERIES[c].push({ comp, reading: data.reading, castName: data.castName });
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function formatRadical(name) {
  return RADICAL_KANJI[name] ? `${name} (${RADICAL_KANJI[name]})` : name;
}

const CAST_REFERENCE = castData.cast
  .map(e => `  ${e.sound} → ${e.name}: ${e.description}`)
  .join('\n');

const IPA_REFERENCE = Object.entries(IPA)
  .map(([mora, ipa]) => `  ${mora} = ${ipa}`)
  .join('\n');

// ─── Per-kanji context builder ──────────────────────────────────────────────

function buildReadingHint(r) {
  const ipaStr = IPA[r] || '?';
  const cast = CAST[r];
  if (cast) {
    return `${r} → ${ipaStr} → use cast character **${cast.name}** (${cast.description})`;
  }
  return `${r} → ${ipaStr} → pick English word whose start matches these phonemes`;
}

function buildKanjiContext(k) {
  const onReadings = k.readings_on.slice(0, 2);
  const kunReadings = k.readings_kun.slice(0, 2)
    .map(r => r.replace(/[.-].*/, '')).filter(Boolean);
  const rads = k.radicals.slice(0, 4).map(formatRadical).join(', ') || '—';

  const series = KANJI_TO_SERIES[k.character];
  const phoneticHint = series
    ? series.map(s => `phonetic component ${s.comp} signals reading ${s.reading} → ${buildReadingHint(s.reading)}`).join('; ')
    : null;

  const lines = [
    `character: ${k.character}`,
    `meaning: ${k.meanings[0]}`,
    `radicals: ${rads}`,
    `on-yomi: ${onReadings.map(buildReadingHint).join(' | ') || '—'}`,
    `kun-yomi: ${kunReadings.map(buildReadingHint).join(' | ') || '—'}`,
  ];
  if (phoneticHint) lines.push(`phonetic hint: ${phoneticHint}`);

  return lines.join('\n');
}

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(batch) {
  const kanjiBlocks = batch.map(k => buildKanjiContext(k)).join('\n\n');

  return `You are a Japanese kanji teacher creating memory stories for English speakers.

For each kanji write ONE unified "story" — a single vivid scene (2-3 sentences max) that weaves together:
1. The kanji's RADICALS as physical objects or characters in the scene
2. A SOUND ANCHOR for the on-yomi reading (and kun-yomi if it fits naturally without cluttering)
3. The kanji's MEANING as the natural conclusion — implied by the scene, never spoken aloud

═══ SOUND ANCHOR RULES ═══

Every reading comes with its IPA and — when available — a pre-approved cast character whose name starts with those exact phonemes. Use the IPA to select your anchor:

A. If the kanji context shows "use cast character Name":
   - That character's name already matches the IPA — use them in the scene
   - Bold their name: **Kyu**, **Kofi**, **Ji**

B. If no cast character is given:
   - Use the IPA to find a common English word whose FIRST phonemes exactly match
   - Bold the word: **den**, **hatch**, **sand**, **each**
   - STRICT phoneme match — /kuː/ = "coop/cool/coup" NOT "queue" (/kjuː/), /niː/ = "knee/need" NOT "Ji" (/dʒiː/)

C. Every story MUST have at least one bold anchor — no exceptions.

D. Bold format: exactly one bold element per anchored reading. No other bold text in the story.

E. Kun-yomi: only anchor it if it's distinct from on-yomi AND fits naturally. Skip if it clutters.

═══ STRICT PROHIBITIONS ═══
✗ NEVER write the kanji's meaning word in the story (e.g. for 火 never write "fire" or "flame")
✗ NEVER write the reading in romaji or hiragana in the story
✗ NEVER write "X (漢字)" to label the meaning inline — e.g. never "Fire (火)", "Person (人)", "Rest (休)"
✗ NEVER invent cast characters not in the cast list
✗ NEVER leave a story without a bold anchor

The meaning must emerge from the scene itself — the reader should feel it, not read it.

═══ RADICAL RULES ═══
- Use ONLY the radical names given in the kanji context — do not invent components
- When a radical IS a kanji (e.g. "Sun (日)"), name it naturally: "The Sun (日)..." — this is the radical label, not the meaning reveal
- Treat radicals as physical props or scenery in the scene
- Strange, vivid, or funny scenes stick better than plain descriptions

═══ OUTPUT FORMAT ═══
Respond with ONLY valid JSON. Each key is the kanji character, value has a single "story" field.
No markdown fences, no explanation, no extra fields.

═══ CAST REFERENCE ═══
${CAST_REFERENCE}

═══ IPA REFERENCE (internal use only — never appear in story output) ═══
${IPA_REFERENCE}

═══ EXAMPLES ═══
{
  "一": {
    "story": "An **itch** crawls across the Ground — a single line scratched into the dirt by one fingernail, and that lone mark is enough to divide everything on one side from everything on the other."
  },
  "七": {
    "story": "She pulled the **sheath** off an ancient blade — out fell exactly this many coins, no more, scattered across the floor in a perfect arc."
  },
  "休": {
    "story": "The leader drives the group for hours until **Kyu** finally slumps against the Tree (木) and won't budge — nobody protests, and for the first time all day, the whole group collapses into stillness."
  },
  "電": {
    "story": "Rain hammers the Rice Paddy (田) so hard the Umbrella planted in the field gets struck — the whole **den** surges with crackling blue light, every wire in the building humming."
  },
  "万": {
    "story": "A lone **man** slices a Leaf with his Sword (刀) — and it keeps splitting, again and again, until the fragments pile up like dunes across the entire plain, beyond any hope of counting."
  }
}

═══ KANJI TO PROCESS ═══
${kanjiBlocks}`;
}

// ─── API callers ────────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.7, num_predict: 8000 },
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
      generationConfig: { temperature: 0.7, maxOutputTokens: 8000 },
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
        const entry = result[k.character];
        if (!entry || typeof entry.story !== 'string' || entry.story.trim() === '') {
          throw new Error(`Missing or invalid story for ${k.character}`);
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
    // Migrate old-format entries (had meaning/onyomi/kunyomi instead of story)
    let migrated = 0;
    for (const [char, val] of Object.entries(existing)) {
      if (typeof val === 'string' || (val && !val.story)) {
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

    if (DELAY_MS > 0 && i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\nDone! Generated ${done} new entries in ${totalSec}s. Total: ${Object.keys(existing).length} kanji. File: ${sizeMB} MB`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
