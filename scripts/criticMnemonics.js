/**
 * Critic pass for mnemonics.json.
 * Checks each story for three failure modes:
 *   1. WRONG_CAST   — story uses a cast character whose sound doesn't match any reading
 *   2. MEANING_LEAK — story states or paraphrases the kanji meaning directly
 *   3. NO_ANCHOR    — story has no bold (**word**) anchor at all
 *
 * Outputs:
 *   scripts/mnemonics_flagged.json  — { char: { story, issues: [...], fix: "rewrite"|"anchor_only" } }
 *
 * Usage:
 *   node scripts/criticMnemonics.js --local
 *   node scripts/criticMnemonics.js --local --model qwen2.5:14b
 *   GEMINI_API_KEY=AIza... node scripts/criticMnemonics.js
 *
 *   # Limit to one JLPT level:
 *   node scripts/criticMnemonics.js --local --level 5
 *
 * After running, feed flagged entries back to buildMnemonics:
 *   node scripts/buildMnemonics.js --local --regen-flagged
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── Config ─────────────────────────────────────────────────────────────────

const KANJI_JSON    = path.join(__dirname, '../src/data/kanji.json');
const MNEMONICS_JSON = path.join(__dirname, '../src/data/mnemonics.json');
const CAST_JSON     = path.join(__dirname, './mnemonicCast.json');
const IPA_JSON      = path.join(__dirname, './romajiIPA.json');
const OUT_FILE      = path.join(__dirname, './mnemonics_flagged.json');

const args       = process.argv.slice(2);
const USE_LOCAL  = args.includes('--local');
const BATCH_SIZE = USE_LOCAL ? 8 : 16;
const modelArg   = args.find(a => a.startsWith('--model=')) ?? args[args.indexOf('--model') + 1];
const levelArg   = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];
const OLLAMA_MODEL = (USE_LOCAL && modelArg && !modelArg.startsWith('--'))
  ? modelArg : 'gemma3:12b';
const DELAY_MS = USE_LOCAL ? 0 : 13000;

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!USE_LOCAL && !GEMINI_KEY) {
  console.error('No GEMINI_API_KEY found. Use --local or set GEMINI_API_KEY.');
  process.exit(1);
}

// ─── Load data ───────────────────────────────────────────────────────────────

const allKanji   = JSON.parse(fs.readFileSync(KANJI_JSON));
const mnemonics  = JSON.parse(fs.readFileSync(MNEMONICS_JSON));
const castData   = JSON.parse(fs.readFileSync(CAST_JSON));
const IPA        = JSON.parse(fs.readFileSync(IPA_JSON)).mora;

// sound → cast name
const CAST = {};
for (const e of castData.cast) CAST[e.sound] = e.name;

// cast name (lowercase) → sound  — for reverse lookup
const CAST_NAME_TO_SOUND = {};
for (const e of castData.cast) CAST_NAME_TO_SOUND[e.name.toLowerCase()] = e.sound;

// ─── Pre-flight checks (no LLM needed) ───────────────────────────────────────

/**
 * Returns list of issue strings detectable without a model:
 *   - NO_ANCHOR if no **bold** text
 *   - WRONG_CAST if a cast name appears bolded but its sound ≠ any reading
 */
function preflightCheck(k, story) {
  const issues = [];

  // Check for bold anchor
  const boldMatches = [...story.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]);
  if (boldMatches.length === 0) {
    issues.push('NO_ANCHOR');
    return issues; // no point checking cast if there's no bold at all
  }

  // Check each bolded word — if it's a cast name, verify the sound matches a reading
  const readings = [
    ...k.readings_on,
    ...k.readings_kun.map(r => r.replace(/[.-].*/, '')).filter(Boolean),
  ];

  for (const bold of boldMatches) {
    const sound = CAST_NAME_TO_SOUND[bold.toLowerCase()];
    if (!sound) continue; // not a cast name — it's a sound-alike word, skip
    if (!readings.includes(sound)) {
      issues.push(`WRONG_CAST:${bold}(${sound})≠[${readings.join(',')}]`);
    }
  }

  return issues;
}

// ─── LLM critic ──────────────────────────────────────────────────────────────

function buildCriticPrompt(batch) {
  const CAST_LIST = castData.cast.map(e => `${e.name} → ${e.sound}`).join(', ');

  const items = batch.map(({ k, story }) => {
    const readings = k.readings_on.slice(0, 2).map(r => `${r}(${IPA[r] ?? '?'})`).join(', ');
    const meaning  = k.meanings[0];
    return `character: ${k.character}
meaning: ${meaning}
readings: ${readings}
story: ${story}`;
  }).join('\n\n---\n\n');

  return `You are auditing Japanese kanji mnemonic stories for two specific failure modes.

For each story below, check ONLY these two things:

1. MEANING_LEAK — Does the story state or closely paraphrase the kanji's meaning?
   - "fire" for 火, "person" for 人, "two parts" for 二, "ninth time" for 九 = FAIL
   - A scene that implies the meaning without naming it = PASS

2. WRONG_CAST — Is a cast character name used in bold (**Name**) whose sound does NOT match the reading?
   Cast list (Name → sound): ${CAST_LIST}
   - **Ji** in a story for に = FAIL (Ji=/dʒiː/, に=/niː/)
   - **Kyu** in a story for きゅう = PASS

Return ONLY valid JSON. Each key is the kanji character. Value is an object with:
  - "pass": true if both checks pass, false if either fails
  - "issues": array of strings — use "MEANING_LEAK" and/or "WRONG_CAST:Name" — empty if pass
  - "reason": one short sentence explaining each issue (empty string if pass)

No markdown, no explanation outside the JSON.

Example output:
{
  "火": { "pass": true, "issues": [], "reason": "" },
  "二": { "pass": false, "issues": ["MEANING_LEAK"], "reason": "Story says 'two distinct parts' which directly states the meaning." },
  "九": { "pass": false, "issues": ["MEANING_LEAK", "WRONG_CAST:Ji"], "reason": "Says 'ninth time' (meaning leak) and uses Ji for に (wrong sound)." }
}

═══ STORIES TO AUDIT ═══
${items}`;
}

// ─── API callers (same as buildMnemonics) ────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: false, format: 'json',
      options: { temperature: 0.1, num_predict: 4000 },
    });
    const req = require('http').request(
      { hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error));
            resolve(parsed.response);
          } catch (e) { reject(new Error(`Ollama parse error: ${e.message}`)); }
        });
      }
    );
    req.on('error', e => reject(new Error(`Ollama error: ${e.message}`)));
    req.write(body); req.end();
  });
}

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
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
            resolve(parsed.candidates[0].content.parts[0].text);
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
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON in: ${text.slice(0, 200)}`);
  return JSON.parse(stripped.slice(start, end + 1));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const levelFilter = levelArg
    ? parseInt(levelArg)
    : (process.env.JLPT_LEVEL ? parseInt(process.env.JLPT_LEVEL) : null);

  // Build list of { k, story } pairs that have a story
  const pairs = allKanji
    .filter(k => levelFilter ? k.jlptLevel === levelFilter : true)
    .filter(k => mnemonics[k.character]?.story)
    .map(k => ({ k, story: mnemonics[k.character].story }));

  console.log(`Auditing ${pairs.length} stories${levelFilter ? ` (JLPT N${levelFilter})` : ''}...`);

  // Load existing flagged output so re-runs skip already-checked entries
  let flagged = {};
  if (fs.existsSync(OUT_FILE)) flagged = JSON.parse(fs.readFileSync(OUT_FILE));

  // ── Step 1: preflight (no LLM) ──
  let preflightFails = 0;
  for (const { k, story } of pairs) {
    const issues = preflightCheck(k, story);
    if (issues.length > 0) {
      flagged[k.character] = { story, issues, reason: issues.join('; '), source: 'preflight' };
      preflightFails++;
    }
  }
  console.log(`Preflight: ${preflightFails} failures (no LLM needed)`);
  fs.writeFileSync(OUT_FILE, JSON.stringify(flagged, null, 2));

  // ── Step 2: LLM critic for meaning leakage ──
  // Only check entries not already flagged by preflight
  const toCheck = pairs.filter(({ k }) => !flagged[k.character]);
  console.log(`LLM critic: checking ${toCheck.length} stories for meaning leakage...`);

  const mode = USE_LOCAL ? `Ollama (${OLLAMA_MODEL})` : 'Gemini 2.5 Flash';
  console.log(`Mode: ${mode}`);

  const startTime = Date.now();
  let done = 0;
  let llmFails = 0;

  for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
    const batch = toCheck.slice(i, i + BATCH_SIZE);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta = done > 0 ? Math.round((elapsed / done) * (toCheck.length - done)) : '?';
    process.stdout.write(`\r[${elapsed}s, ~${eta}s left] ${i + 1}–${Math.min(i + BATCH_SIZE, toCheck.length)} / ${toCheck.length}...  `);

    try {
      const text   = await callModel(buildCriticPrompt(batch));
      const result = extractJson(text);

      for (const { k, story } of batch) {
        const verdict = result[k.character];
        if (!verdict) continue; // model skipped it — leave it unchecked
        if (!verdict.pass) {
          flagged[k.character] = { story, issues: verdict.issues, reason: verdict.reason, source: 'llm' };
          llmFails++;
        }
      }
      done += batch.length;
      fs.writeFileSync(OUT_FILE, JSON.stringify(flagged, null, 2));
    } catch (e) {
      console.error(`\nBatch error (${batch.map(x => x.k.character).join('')}): ${e.message}`);
    }

    if (DELAY_MS > 0 && i + BATCH_SIZE < toCheck.length) await sleep(DELAY_MS);
  }

  const total = preflightFails + llmFails;
  console.log(`\nDone. ${total} stories flagged (${preflightFails} preflight + ${llmFails} LLM).`);
  console.log(`Flagged list: scripts/mnemonics_flagged.json`);
  console.log(`To regenerate flagged entries: node scripts/buildMnemonics.js --local --regen-flagged`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
