/**
 * Builds a hiragana/katakana reading → IPA string mapping for all vocab readings.
 * Outputs scripts/vocabIPA.json — { "いちにち": "/iːtʃiniːtʃi/", ... }
 *
 * Handles:
 *   - Compound mora (きゅ, しゃ, etc.) — matched before single mora
 *   - Long vowel mark ー — extends the previous vowel
 *   - Geminate っ/ッ — doubled next consonant (approximated as short pause /ː/ prefix)
 *   - Katakana → hiragana normalization before lookup
 *
 * Usage:
 *   node scripts/buildVocabIPA.js
 */

const fs   = require('fs');
const path = require('path');

const VOCAB_JSON = path.join(__dirname, '../src/data/vocab.json');
const IPA_JSON   = path.join(__dirname, './romajiIPA.json');
const OUT_FILE   = path.join(__dirname, './vocabIPA.json');

// ─── Load ────────────────────────────────────────────────────────────────────

const vocab   = JSON.parse(fs.readFileSync(VOCAB_JSON));
const IPA_MAP = JSON.parse(fs.readFileSync(IPA_JSON)).mora;

// ─── Katakana → hiragana ─────────────────────────────────────────────────────

function toHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// ─── Mora splitter ───────────────────────────────────────────────────────────

// Small kana that combine with the preceding mora (compound mora second char)
const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょァィゥェォャュョ');

function splitMora(hiragana) {
  const mora = [];
  let i = 0;
  while (i < hiragana.length) {
    const cur = hiragana[i];
    const next = hiragana[i + 1];
    // Compound mora: current char + small kana (e.g. き+ゅ = きゅ)
    if (next && SMALL_KANA.has(next)) {
      mora.push(cur + next);
      i += 2;
    } else {
      mora.push(cur);
      i++;
    }
  }
  return mora;
}

// ─── Reading → IPA ───────────────────────────────────────────────────────────

// Extract just the vowel IPA symbol from a mora's IPA string
// e.g. "/koʊ/" → "oʊ", "/niː/" → "iː", "/ʃiː/" → "iː"
function extractVowel(ipaStr) {
  // Match the vowel nucleus — last vowel sequence before the closing /
  const m = ipaStr.match(/([aeiouɑɔʊɛæiːuːeɪoʊɑː]+[ː]?)(?=[^aeiouɑɔʊɛæiːuːeɪoʊɑː]*\/$)/);
  return m ? m[1] : null;
}

function readingToIPA(reading) {
  const hira = toHiragana(reading);
  const mora = splitMora(hira);
  const parts = [];
  let prevVowel = null;

  for (let i = 0; i < mora.length; i++) {
    const m = mora[i];

    // Long vowel mark ー — extend previous vowel
    if (m === 'ー') {
      if (prevVowel) {
        // Add long marker to previous part if not already long
        const last = parts[parts.length - 1];
        if (last && !last.endsWith('ː')) {
          parts[parts.length - 1] = last + 'ː';
        }
      }
      continue;
    }

    // Geminate っ/ッ — mark next consonant as doubled (we prepend the next mora's consonant)
    if (m === 'っ' || m === 'ッ') {
      parts.push('(っ)'); // placeholder, resolved below
      continue;
    }

    const ipaStr = IPA_MAP[m];
    if (!ipaStr) {
      parts.push(`?${m}?`);
      prevVowel = null;
      continue;
    }

    // Strip surrounding slashes for inline use
    const inner = ipaStr.replace(/^\//,'').replace(/\/$/,'');
    parts.push(inner);
    prevVowel = extractVowel(ipaStr);
  }

  // Resolve っ placeholders — double the first consonant of the following part
  const resolved = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '(っ)') {
      const next = parts[i + 1];
      if (next) {
        // Get first consonant cluster of next part
        const consonant = next.match(/^([^aeiouɑɔʊɛæiːuːeɪoʊɑː]+)/)?.[1] ?? next[0];
        resolved.push(consonant);
      }
    } else {
      resolved.push(parts[i]);
    }
  }

  return '/' + resolved.join('') + '/';
}

// ─── Build table ─────────────────────────────────────────────────────────────

const result = {};
let total = 0;
let errors = 0;

for (const entries of Object.values(vocab)) {
  for (const entry of entries) {
    const reading = entry.reading;
    if (!reading || result[reading]) continue;

    const ipa = readingToIPA(reading);
    result[reading] = ipa;
    total++;
    if (ipa.includes('?')) errors++;
  }
}

// Sort keys for readability
const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 2));

console.log(`Done. ${total} readings mapped, ${errors} with unknown mora.`);
console.log(`Output: scripts/vocabIPA.json`);

// Show a few examples including the biiru/biru distinction
const examples = ['いちにち', 'さいしょ', 'ビール', 'ビル', 'がっこう', 'にほん'];
console.log('\nExamples:');
for (const r of examples) {
  const hira = toHiragana(r);
  const ipa = result[hira] ?? result[r] ?? readingToIPA(r);
  console.log(`  ${r} → ${ipa}`);
}
