/**
 * Builds src/data/masterData.json — a unified learning item list for
 * radicals, kanji, and vocabulary.
 *
 * Shape:
 *   radical: { type, id, name, character }
 *   kanji:   { type, id, character, jlptLevel, meaning, readings:{on,kun},
 *              primaryReading, primaryReadingIPA, radicals, isPictographic }
 *   vocab:   { type, id, word, jlptLevel, meaning, reading,
 *              decomposition:[{text, reading, readingType, ipa}] }
 *
 * Usage:
 *   node scripts/buildMasterData.js
 */

const fs   = require('fs');
const path = require('path');

const KANJI_JSON       = path.join(__dirname, '../src/data/kanji.json');
const VOCAB_JSON       = path.join(__dirname, '../src/data/vocab.json');
const VOCAB_DECOMP_JSON = path.join(__dirname, '../src/data/vocabDecomp.json');
const RADICAL_JSON     = path.join(__dirname, '../src/data/radicalKanji.json');
const IPA_JSON         = path.join(__dirname, './romajiIPA.json');
const OUT_FILE         = path.join(__dirname, '../src/data/masterData.json');

// ─── Load ─────────────────────────────────────────────────────────────────────

const allKanji   = JSON.parse(fs.readFileSync(KANJI_JSON));
const allVocab   = JSON.parse(fs.readFileSync(VOCAB_JSON));
const vocabDecomp = JSON.parse(fs.readFileSync(VOCAB_DECOMP_JSON));
const radicalKanji = JSON.parse(fs.readFileSync(RADICAL_JSON));  // { name: char }
const IPA        = JSON.parse(fs.readFileSync(IPA_JSON)).mora;

// ─── IPA lookup — longest prefix match ────────────────────────────────────────

// Tokenize a hiragana string into moras, then join their IPAs into one string.
// e.g. はいきゅう → /hɑːiːkjuː/
function readingToIPA(hiragana) {
  if (!hiragana) return null;
  const parts = [];
  let i = 0;
  while (i < hiragana.length) {
    let matched = false;
    // Try longest match first (4 chars covers e.g. きゅう, ひゃく)
    for (let len = Math.min(4, hiragana.length - i); len >= 1; len--) {
      const chunk = hiragana.slice(i, i + len);
      if (IPA[chunk]) {
        // Strip surrounding slashes so we can rejoin cleanly
        parts.push(IPA[chunk].replace(/\//g, ''));
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i++; // skip unrecognised char (e.g. punctuation)
  }
  return parts.length ? `/${parts.join('')}/` : null;
}

// ─── Radicals ─────────────────────────────────────────────────────────────────

const radicals = Object.entries(radicalKanji).map(([name, character]) => ({
  type: 'radical',
  id: `radical:${name}`,
  name,
  character,
}));

// ─── Kanji meaning lookup map ─────────────────────────────────────────────────

const kanjiMeaningsMap = Object.fromEntries(allKanji.map(k => [k.character, k.meanings]));

// ─── Kanji ────────────────────────────────────────────────────────────────────

const NUMBER_CHARS = new Set(['一','二','三','四','五','六','七','八','九','十','百','千','万']);

const kanji = allKanji.map(k => {
  const primaryReading = k.readings_on[0]
    ?? k.readings_kun[0]?.replace(/[.-].*/, '')
    ?? null;
  const isSelfRef = k.radicals.length > 0
    && k.radicals.every(r => r === k.meanings[0]);

  return {
    type: 'kanji',
    id: `kanji:${k.character}`,
    character: k.character,
    jlptLevel: k.jlptLevel,
    meaning: k.meanings[0],
    readings: {
      on:  k.readings_on.map(r => ({ kana: r, ipa: readingToIPA(r) })),
      kun: k.readings_kun.map(r => ({ kana: r, ipa: readingToIPA(r.replace(/[.-].*/, '')) })),
    },
    primaryReading,
    primaryReadingIPA: readingToIPA(primaryReading),
    radicals: k.radicals,
    isPictographic: NUMBER_CHARS.has(k.character) || isSelfRef,
  };
});

// ─── Vocab ────────────────────────────────────────────────────────────────────

const vocabFlat = Object.values(allVocab).flat();

const vocab = vocabFlat.map(v => {
  const decomp = vocabDecomp[v.word];

  let decomposition;
  if (decomp?.parts) {
    // vocabDecomp has richer kanji-specific breakdown
    decomposition = decomp.parts.map(p => ({
      text:        p.kanji,
      reading:     p.reading ?? null,
      readingType: p.type   ?? null,
      ipa:         readingToIPA(p.reading),
      kanjiMeanings: kanjiMeaningsMap[p.kanji] ?? null,
    }));
  } else if (v.parts) {
    // Fall back to vocab.json parts (includes kana segments)
    decomposition = v.parts.map(p => ({
      text:        p.text,
      reading:     p.reading ?? null,
      readingType: null,
      ipa:         readingToIPA(p.reading),
      kanjiMeanings: kanjiMeaningsMap[p.text] ?? null,
    }));
  } else {
    decomposition = [];
  }

  return {
    type: 'vocab',
    id: `vocab:${v.word}`,
    word:        v.word,
    jlptLevel:   v.jlptLevel,
    meaning:     v.meaning,
    reading:     v.reading,
    readingIPA:  readingToIPA(v.reading),
    pos:         v.pos ?? [],
    kanjiUsed:   v.kanjiUsed ?? [],
    decomposition,
  };
});

// ─── Write ────────────────────────────────────────────────────────────────────

// Order: radicals → kanji (N5→N1) → vocab (N5→N1)
const masterData = [
  ...radicals,
  ...kanji.sort((a, b) => b.jlptLevel - a.jlptLevel),
  ...vocab.sort((a, b) => (b.jlptLevel ?? 0) - (a.jlptLevel ?? 0)),
].map((item, i) => ({ ...item, id: i + 1 }));

fs.writeFileSync(OUT_FILE, JSON.stringify(masterData, null, 2));
console.log(`masterData.json written — ${radicals.length} radicals, ${kanji.length} kanji, ${vocab.length} vocab (${masterData.length} total)`);
