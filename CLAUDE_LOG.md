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

## Pending / In Progress
- Mnemonic story quality: meaning-leakage in generated stories, especially simple kanji
- Pipeline goal: kanji → radicals/readings → mnemonic story → user reads story to learn kanji