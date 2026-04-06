/**
 * Audits mnemonics.json for quality issues.
 * Writes flagged entries to mnemonics_flagged.json for use with --regen-flagged.
 *
 * Checks:
 *   1. Missing mnemonics (kanji in kanji.json but not in mnemonics.json)
 *   2. Meaning mnemonic contains the meaning word verbatim
 *   3. Reading anchor (bold word) not phonetically close to the primary reading
 *
 * Phonetic check: uses eSpeak-NG to get IPA of the bold word, then compares
 * the first N phonemes against the Japanese reading's IPA from romajiIPA.json.
 *
 * Usage:
 *   node scripts/auditMnemonics.js
 *   node scripts/auditMnemonics.js --level 5
 *   node scripts/auditMnemonics.js --no-phonetic   (skip eSpeak check)
 *   node scripts/auditMnemonics.js --write          (write mnemonics_flagged.json)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────

const KANJI_JSON    = path.join(__dirname, '../src/data/kanji.json');
const MNEMONICS_JSON = path.join(__dirname, '../src/data/mnemonics.json');
const IPA_JSON      = path.join(__dirname, './romajiIPA.json');
const FLAGGED_FILE  = path.join(__dirname, './mnemonics_flagged.json');

const args            = process.argv.slice(2);
const SKIP_PHONETIC   = args.includes('--no-phonetic');
const WRITE_FLAGGED   = args.includes('--write');
const levelArg        = args.find(a => a.startsWith('--level=')) ?? args[args.indexOf('--level') + 1];
const LEVEL_FILTER    = levelArg && !levelArg.startsWith('--') ? parseInt(levelArg) : null;

// How many IPA characters must overlap at the start to be considered a match
const PHONEME_MATCH_THRESHOLD = 2;

// ─── Load data ───────────────────────────────────────────────────────────────

const allKanji   = JSON.parse(fs.readFileSync(KANJI_JSON));
const mnemonics  = JSON.parse(fs.readFileSync(MNEMONICS_JSON));
const IPA        = JSON.parse(fs.readFileSync(IPA_JSON)).mora;

const kanji = LEVEL_FILTER
  ? allKanji.filter(k => k.jlptLevel === LEVEL_FILTER)
  : allKanji;

// ─── eSpeak ──────────────────────────────────────────────────────────────────

const espeakCache = {};

function getEnglishIPA(word) {
  if (espeakCache[word]) return espeakCache[word];
  try {
    const raw = execSync(`espeak-ng --ipa -q "${word.replace(/"/g, '')}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    // Strip stress markers and syllable separators for comparison
    const cleaned = raw.replace(/[ˈˌ.]/g, '').trim();
    espeakCache[word] = cleaned;
    return cleaned;
  } catch {
    return null;
  }
}

// ─── IPA similarity ──────────────────────────────────────────────────────────

// Strip slashes and stress markers from romajiIPA values
function cleanIPA(ipa) {
  return ipa.replace(/[\/ˈˌ.]/g, '').trim();
}

// Check if englishIPA starts with (or closely matches) the Japanese reading IPA
function ipaMatches(englishIPA, japaneseIPA) {
  const eng = englishIPA.toLowerCase();
  const jpn = cleanIPA(japaneseIPA).toLowerCase();

  // Check if english starts with the japanese phonemes
  if (eng.startsWith(jpn.slice(0, PHONEME_MATCH_THRESHOLD))) return true;

  // Check if japanese starts with the english phonemes (e.g. short readings)
  if (jpn.startsWith(eng.slice(0, PHONEME_MATCH_THRESHOLD))) return true;

  // Check for shared prefix of at least PHONEME_MATCH_THRESHOLD chars
  let shared = 0;
  for (let i = 0; i < Math.min(eng.length, jpn.length); i++) {
    if (eng[i] === jpn[i]) shared++;
    else break;
  }
  return shared >= PHONEME_MATCH_THRESHOLD;
}

// ─── Extract bold word ───────────────────────────────────────────────────────

function extractBoldWord(text) {
  const match = text.match(/\*\*([^*]+)\*\*/);
  return match ? match[1].trim() : null;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

const issues = {};
const stats = { missing: 0, meaning_leak: 0, phonetic_fail: 0, no_anchor: 0, ok: 0 };

function flag(char, type, detail) {
  if (!issues[char]) issues[char] = [];
  issues[char].push({ type, detail });
  stats[type] = (stats[type] || 0) + 1;
}

console.log(`Auditing ${kanji.length} kanji${LEVEL_FILTER ? ` (N${LEVEL_FILTER})` : ''}...`);
if (SKIP_PHONETIC) console.log('Skipping phonetic check (--no-phonetic)');
console.log('');

for (const k of kanji) {
  const char = k.character;
  const entry = mnemonics[char];

  // 1. Missing entirely
  if (!entry || !entry.mnemonic_meaning || !entry.mnemonic_reading) {
    flag(char, 'missing', 'No mnemonic entry');
    stats.missing++;
    continue;
  }

  let hasIssue = false;

  // 2. Meaning mnemonic leaks the meaning word
  const meaning = k.meanings[0].toLowerCase();
  const meaningText = entry.mnemonic_meaning.toLowerCase();
  if (meaningText.includes(meaning)) {
    flag(char, 'meaning_leak', `"${k.meanings[0]}" appears verbatim in mnemonic_meaning`);
    hasIssue = true;
  }

  // 3. Reading anchor phonetic check
  const boldWord = extractBoldWord(entry.mnemonic_reading);
  if (!boldWord) {
    flag(char, 'no_anchor', 'No bold word found in mnemonic_reading');
    hasIssue = true;
  } else if (!SKIP_PHONETIC) {
    const primaryReading = k.readings_on[0] ?? k.readings_kun[0]?.replace(/[.-].*/, '');
    const jpnIPA = IPA[primaryReading];

    if (!jpnIPA) {
      flag(char, 'phonetic_fail', `No IPA entry for reading "${primaryReading}"`);
      hasIssue = true;
    } else {
      const engIPA = getEnglishIPA(boldWord);
      if (!engIPA) {
        flag(char, 'phonetic_fail', `eSpeak failed for "${boldWord}"`);
        hasIssue = true;
      } else if (!ipaMatches(engIPA, jpnIPA)) {
        flag(char, 'phonetic_fail',
          `"${boldWord}" (${engIPA}) doesn't match reading "${primaryReading}" (${cleanIPA(jpnIPA)})`);
        hasIssue = true;
      }
    }
  }

  if (!hasIssue) stats.ok++;
}

// ─── Report ──────────────────────────────────────────────────────────────────

const flaggedChars = Object.keys(issues);

console.log('═'.repeat(60));
console.log(`RESULTS: ${kanji.length} kanji audited`);
console.log(`  ✓ OK:             ${stats.ok}`);
console.log(`  ✗ Missing:        ${stats.missing}`);
console.log(`  ✗ Meaning leak:   ${stats.meaning_leak || 0}`);
console.log(`  ✗ No anchor:      ${stats.no_anchor || 0}`);
console.log(`  ✗ Phonetic fail:  ${stats.phonetic_fail || 0}`);
console.log(`  Total flagged:    ${flaggedChars.length}`);
console.log('═'.repeat(60));
console.log('');

for (const [char, charIssues] of Object.entries(issues)) {
  const k = allKanji.find(k => k.character === char);
  const reading = k?.readings_on[0] ?? k?.readings_kun[0]?.replace(/[.-].*/, '');
  console.log(`${char} (${reading ?? '?'}) — ${k?.meanings[0] ?? '?'}`);
  for (const issue of charIssues) {
    console.log(`  [${issue.type}] ${issue.detail}`);
  }
  if (mnemonics[char]?.mnemonic_reading) {
    console.log(`  reading mnemonic: ${mnemonics[char].mnemonic_reading}`);
  }
  console.log('');
}

// ─── Write flagged file ───────────────────────────────────────────────────────

if (WRITE_FLAGGED) {
  const flaggedObj = {};
  for (const char of flaggedChars) {
    flaggedObj[char] = issues[char];
  }
  fs.writeFileSync(FLAGGED_FILE, JSON.stringify(flaggedObj, null, 2));
  console.log(`Wrote ${flaggedChars.length} flagged entries to ${path.basename(FLAGGED_FILE)}`);
  console.log(`Run: node scripts/buildMnemonics.js --regen-flagged`);
}
