# Claude Work Log

## 2026-03-17

### Added missing cast characters to mnemonicCast.json
**Problem:** The model was using cast characters for wrong sounds (e.g. Ji /dʒiː/ for に /niː/) because many common readings had no cast entry, causing it to hallucinate matches.

**Fixed:** Added 32 new cast characters covering previously missing sounds:
- Single mora: に, く, な, は, も, よ, ら, り, る, ろ, わ, が, げ, ご, ざ, ず, で, ど, ば, ぶ, ぼ
- Compound readings: げん, ごう, だい, だん, にん, くう, なん, げき, どく, ぼく, まく, ろく, よく, もく

**Also added:** Full single-mora coverage — every basic mora (あ-ん + voiced) now has a cast character with a short 1-2 syllable name (Na, Do, Ku, Gi, etc.)

### Rewrote buildVocabData.js (same approach as buildMnemonics)
- One kanji at a time, no batching
- Cast lookup deterministic in code — per mora, injected into prompt as explicit instructions
- Mora splitter handles compound kana, ー, っ
- Returns JSON array, saves after every kanji
- Built buildVocabIPA.js to map full hiragana readings → IPA strings

### Wired mnemonicCast.json into buildMnemonics.js
- Cast lookup by reading sound key — deterministic, no model guessing
- If cast entry exists: prompt says "Bold **Name** (description) — their name starts with /ipa/"
- If no cast entry: prompt says "Bold an English word matching /ipa/, do NOT use any character name"

### Added long-vowel compound mora back to cast + deduped
- じゅう→Ju, じょう→Joe, きゅう→Kyu, きょう→Kyo, しょう→Sho, ちょう→Cho etc. now resolve correctly
- Deduped cast — 108 clean entries total

### Completed cast coverage for all practical mora
- Added へ, ぱ-row, and all compound mora (きゃ、しゃ、じゃ、ちゃ etc.) — 94 entries total
- Remaining gaps (を、ん、びゅ、ぴょ etc.) are too rare in on-yomi to matter

### Trimmed cast to single-mora and compound-mora only
- Removed 64 multi-mora entries (こう, もく, けん, etc.) — those use IPA English word anchors instead
- Cast now covers only 1-mora (に, く, し...) and compound mora (きゅ, しょ, じゅ...) — 72 entries total

### Filled all cast gaps for IPA-equivalent sounds
- Scanned all IPA mora entries vs cast — found 31 missing (including じゅう, きゅ, きょ, しょ, etc.)
- All reuse the same character as their IPA-equivalent (e.g. じゅう → Ju, きゅ → Kyu, ごう → Go)
- Cast now has full coverage for every mora in romajiIPA.json that shares IPA with an existing entry

### Added ipa field to mnemonicCast.json
- Every cast entry now has `ipa` field populated from romajiIPA.json (e.g. Kofi → /koʊ/, Sheila → /ʃiː/)
- All 103 entries updated, none missing

### Rewrote buildMnemonics.js from scratch (minimal IPA-first approach)
- Prompt now only uses: kanji character, meaning, radicals, reading + IPA
- Dropped all cast characters, phonetic series, and reference tables from prompt
- Model is told: bold an English word matching the IPA, use radicals as props, never say the meaning
- One kanji per call, plain text response, immediate bold anchor validation
- Kept --local, --regen, --regen-flagged, --level flags

### Switched buildMnemonics.js to one-at-a-time processing
- Removed batching entirely — each kanji gets its own prompt and API call
- Prompt now requests plain text story (not JSON), validated immediately for bold anchor presence
- Removed extractJson helper (no longer needed)
- Saves after every single kanji — safe to interrupt at any point

### Hardened cast character enforcement in buildMnemonics.js
- `buildReadingHint()` now emits "YOU MUST bold **Name**" or "DO NOT use any cast name" per reading — model has no discretion
- Removed full CAST_REFERENCE and IPA_REFERENCE blocks from prompt — they were noise that let the model browse and mis-match
- Prompt anchor rules simplified to: follow what the per-kanji context says, no exceptions

### Added criticMnemonics.js + --regen-flagged to buildMnemonics.js
- `scripts/criticMnemonics.js` — two-pass auditor: preflight (no LLM) catches NO_ANCHOR and WRONG_CAST by IPA comparison; LLM pass catches MEANING_LEAK
- Outputs `scripts/mnemonics_flagged.json`
- `buildMnemonics.js --regen-flagged` reads that file and clears only the bad entries for regeneration
- Workflow: `node scripts/criticMnemonics.js --local` → `node scripts/buildMnemonics.js --local --regen-flagged`

**Next:** Stories for simple number kanji (一, 二, 三...) are still weak — they leak the meaning through paraphrase. Need to either tighten the prompt or add a critic/rewrite pass. Also need to decide: regenerate all existing stories, or only regenerate the bad ones?

### Rewrote buildVocabData.js to two-pass approach
- **Problem:** Old single-pass approach built anchor instructions from the kanji's on-yomi, not the actual word's reading. E.g. 物語 (ものがたり) was getting anchors based on ぶつ/もの instead of the word's real mora sequence.
- **Fix:** Two-pass generation:
  - Pass 1: `buildWordsPrompt(k)` → model returns JSON array of `{word, reading, meaning}` only
  - Pass 2: for each word, `buildStoryPrompt(entry, kanjiMeaning)` calls `buildAnchorInstructions(entry.reading)` with the real reading, then asks model for just the story text
- Anchor instructions now always match the actual word reading (e.g. ものがたり → Mo+No+Ga+Ta+Ri)
- Story prompt requests plain text (not JSON), shorter output (600 tokens)
- `callWithRetry` extracted as shared helper used by both passes
- Delay applied between pass-2 story calls when using Gemini (rate limit safe)

### Added ColoredReading component + vocabDecomp.json
- **New component:** `src/components/ui/ColoredReading.tsx` — splits a hiragana/katakana reading into mora using the same splitMora logic as the scripts, renders each mora in a cycling color (blue/orange/green/purple). Replaces the plain grey `vocabReading` text in `LearnSessionScreen.tsx`.
- **New script:** `scripts/buildVocabDecomp.js` — greedy decomposition of vocab words into per-kanji reading parts. Output: `scripts/vocabDecomp.json` → `{ "一日": { reading: "いちにち", parts: [{ kanji:"一", reading:"いち", type:"on" }, { kanji:"日", reading:"にち", type:"on" }] } }`. Handles rendaku (voicing), sokuon/geminate (いち→いっ), kun-yomi stripping. 232 words, 34 unknowns (irregular compounds or kanji not in dataset).
- **User intent:** color the reading segments to show which mora come from which kanji — furigana-style decomposition so the user understands the phonetics of each word component.

### Added 分 to kanji.json
- JLPT N5, 4 strokes, inserted after 半 (index 42)
- on: ぶん, ふん, ぶ / kun: わ.ける, わ.け, わ.かれる, わ.かる, わ.かつ
- Meanings: Part, Minute, Understand, Segment
- Radicals: Knife, Eight
- Fixed 5 vocab decompositions (九分, 五分, 十分, 半分, 気分) — unknowns dropped from 34→29

### Refactored LearnSessionScreen to 3-step flow
- **Step 1 (intro):** Kanji + meaning + mnemonic + ON/KUN pills + radicals. Label updated to "ON 音読み" / "KUN 訓読み".
- **Step 2 (examples):** All vocab rows with decomp-based colored readings — on-yomi in blue (#7eb8f7), kun-yomi in orange (#f7a97e), kana/unknown in grey. Legend shown at top.
- **Step 3 (quiz):** One vocab word (preferring words containing the target kanji). 4-choice hiragana picker using ChoiceButton. Distractors drawn from session batch first, global vocab as fallback. Shows correct answer on wrong guess.
- Progress bar stays per-kanji; step position shown as animated dot indicator + label in header.
- Skip button only visible on intro step; "‹ Prev" only on intro step.
- Primary button label changes: "See examples →" / "Quiz me →" / "Next kanji →" / "Add X kanji to reviews".
- `vocabDecomp.json` copied to `src/data/` so it can be statically imported.
- `ColoredReading` extended with `parts: DecompPart[]` prop mode for type-based coloring.

### Replaced LLM vocab with JMdict + JmdictFurigana pipeline
- New script: `scripts/buildVocabFromJMdict.js` — pulls real words from JMdict (215k entries), deduplicates, ranks by `common` flag + jlptLevel + word length, attaches furigana decomposition from JmdictFurigana (230k entries)
- Downloaded `scripts/JmdictFurigana.json` (33MB, gitignored) — maps every word+reading to per-character ruby/rt pairs
- New vocab.json shape per entry: `{ word, reading, meaning, jlptLevel, common, parts: [{text, reading}]|null, kanjiUsed: string[] }`
- 2212 kanji covered, 15 words each
- `parts` replaces `vocabDecomp.json` — decomposition is now embedded per entry
- `useVocabData.ts` updated: new `VocabEntry` and `VocabPart` types, added `useVocabForKanjiFiltered(char, enrolledKanji)` — returns only words whose kanji the user already knows
- `ColoredReading` updated: `parts` mode now uses `VocabPart[]` (text/reading), colors kanji segments by alternating index, kana/okurigana segments grey
- `LearnSessionScreen` updated: uses `useVocabForKanjiFiltered`, passes `v.parts` directly, removed `vocabDecomp` import

## 2026-03-18

### Learn session quiz: meaning question first, then reading question
- `LearnSessionScreen` quiz step now has two sub-steps: `meaning` then `reading`
- Added `quizSubStep: 'meaning' | 'reading'` state; reset to `'meaning'` on each new kanji
- **Meaning sub-step:** shows the big kanji character, asks "What does this kanji mean?" — distractors drawn from other kanji's `meanings[0]` via `grouped`
- **Reading sub-step:** shows a vocab word + meaning hint, asks "What is the reading?" — existing scored distractor logic
- After answering meaning → "Next →" advances to reading sub-step (resets answer state); after answering reading → next kanji / enroll

## Pending / In Progress
- Mnemonic story quality: meaning-leakage in generated stories, especially simple kanji
- Vocab stories: regenerate N5 with `node scripts/buildVocabData.js --local --level 5 --regen`
- Pipeline goal: kanji → radicals/readings → mnemonic story → user reads story to learn kanji