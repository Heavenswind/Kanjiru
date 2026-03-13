# Kanjiru — Claude Context

## What This App Is

**漢字る (Kanjiru)** — A WaniKani-inspired Japanese kanji learning app built with React Native. Android-first, dark edge-to-edge UI.
Goal: teach kanji through spaced repetition with mnemonics, stroke order, and vocab examples.

## Tech Stack

| Layer | Library |
|---|---|
| Framework | React Native 0.76.9 (New Architecture + Hermes) |
| Language | TypeScript |
| Navigation | React Navigation 7 (Stack + Bottom Tabs) |
| Animations | React Native Reanimated 3 + Gesture Handler |
| SVG | react-native-svg |
| State | Zustand 5 |
| Local DB | op-sqlite + Drizzle ORM (SQLite) |
| Storage | react-native-mmkv |
| Server state | TanStack Query 5 |
| Backend | Supabase (auth + remote progress sync) |

## Project Structure

```
KanjiApp/
├── src/
│   ├── app/App.tsx
│   ├── components/
│   │   ├── cards/SwipeableCard.tsx       — gesture swipe card
│   │   ├── kanji/StrokeOrderDiagram.tsx  — animated SVG stroke player
│   │   └── quiz/
│   │       ├── ChoiceButton.tsx          — 4-choice answer button
│   │       └── ProgressBar.tsx           — review session progress bar
│   ├── data/
│   │   ├── kanji.json                    — all kanji entries
│   │   ├── mnemonics.json                — meaning/onyomi/kunyomi mnemonics
│   │   ├── strokes.json                  — KanjiVG SVG paths keyed by character
│   │   └── vocab.json                    — example vocabulary per kanji
│   ├── engine/srs/
│   │   ├── sm2.ts                        — SM-2 algorithm
│   │   ├── scheduler.ts                  — gradeCard, buildNewProgress, isDue
│   │   └── distractors.ts               — generateChoices for 4-option quiz
│   ├── hooks/
│   │   ├── useKanjiData.ts
│   │   ├── useMnemonicsData.ts
│   │   └── useVocabData.ts
│   ├── navigation/
│   │   ├── RootNavigator.tsx             — Auth vs Main gate
│   │   ├── MainTabs.tsx                  — 5 bottom tabs
│   │   ├── LearnStack.tsx
│   │   ├── ReviewStack.tsx
│   │   └── SearchStack.tsx
│   ├── queries/
│   │   ├── useEnrollKanji.ts
│   │   ├── useGradeCard.ts
│   │   ├── useProgressQuery.ts
│   │   └── useSessionLog.ts
│   ├── screens/
│   │   ├── auth/                         (Login, Register, ForgotPassword)
│   │   ├── learn/
│   │   │   ├── LevelPickerScreen.tsx     — JLPT level cards with progress bars
│   │   │   ├── KanjiListScreen.tsx       — 5-col grid of kanji for a level
│   │   │   ├── KanjiDetailScreen.tsx     — stroke order + meanings + readings
│   │   │   └── LearnSessionScreen.tsx    — core lesson flow (card-by-card)
│   │   ├── review/
│   │   │   ├── ReviewHomeScreen.tsx      — due count, start button
│   │   │   ├── ReviewSessionScreen.tsx   — 4-choice quiz with swipe cards
│   │   │   └── ReviewSummaryScreen.tsx   — session results
│   │   ├── search/SearchScreen.tsx + SearchDetailScreen.tsx
│   │   ├── progress/ProgressScreen.tsx
│   │   └── settings/SettingsScreen.tsx
│   ├── services/
│   │   ├── database/                     — op-sqlite + Drizzle schema/migrations
│   │   └── supabase/                     — auth client + sync
│   ├── stores/
│   │   ├── useAuthStore.ts
│   │   ├── useReviewStore.ts             — Zustand, session queue state
│   │   └── useSettingsStore.ts           — MMKV-persisted settings
│   ├── types/
│   │   ├── kanji.ts                      — KanjiEntry, KanjiProgress
│   │   ├── navigation.ts                 — all stack param lists
│   │   └── review.ts                     — QuestionType, QuizQuestion, ReviewSession
│   └── utils/
│       ├── kanjiUtils.ts                 — SRS colors/labels, stripOkurigana, etc.
│       └── romaji.ts                     — romaji-to-hiragana conversion
├── scripts/
│   ├── buildKanjiData.js
│   ├── buildMnemonics.js
│   ├── buildStrokeData.js                — downloads KanjiVG SVGs, extracts paths
│   └── kanjivg/                          — SVG cache (gitignored)
```

## Navigation Tree

```
RootNavigator
├── AuthStack (Login / Register / ForgotPassword)
└── MainTabs (5 tabs, icons are kanji chars: 学 復 探 進 設)
    ├── LearnStack:   LevelPicker → LearnSession | KanjiList → KanjiDetail
    ├── ReviewStack:  ReviewHome → ReviewSession → ReviewSummary
    ├── SearchStack:  Search → SearchDetail
    ├── ProgressScreen
    └── SettingsScreen
```

## Data Shapes

### kanji.json entry
```json
{
  "id": "人",
  "character": "人",
  "jlptLevel": 5,
  "strokes": 2,
  "meanings": ["Person"],
  "readings_on": ["じん", "にん"],
  "readings_kun": ["ひと", "-り", "-と"],
  "radicals": ["Person"]
}
```
- `jlptLevel`: 5 = easiest (N5), 1 = hardest (N1)
- Kun readings use `.` and `-` as okurigana markers — strip with `stripOkurigana()`

### mnemonics.json entry
```json
{
  "人": {
    "meaning": "A walking person...",
    "onyomi": "Khan led his army...",
    "kunyomi": "Hito — 'He toe' — ..."
  }
}
```
`onyomi` and `kunyomi` are optional.

### KanjiProgress (SQLite + Supabase)
```
id, userId, kanjiId, jlptLevel,
srsLevel (0-8), repetitions, easeFactor (default 2.5),
intervalDays, nextReview, lastReview, learnedAt
```
SRS levels: 0=New, 1-2=Apprentice, 3-4=Guru, 5=Master, 6=Enlightened, 7+=Burned

## Design System

No shared theme file — colors/styles are inline `StyleSheet.create` per screen. Consistent palette:

| Role | Color |
|---|---|
| Background primary | `#1a1a2e` |
| Background card | `#16213e` |
| Background tab bar | `#0f0f1a` |
| Accent / primary action | `#e94560` (red-pink) |
| On-yomi | `#285393` (blue) |
| Kun-yomi | `#8858b5` (purple) |
| Correct | `#4caf50` / `#2e7d32` |
| Wrong | `#ef5350` / `#c62828` |
| Text primary | `#fff` |
| Text secondary | `#aaa` |
| Text tertiary | `#888` |

Level accent colors: N5=`#e94560`, N4=`#dd7e1b`, N3=`#8858b5`, N2=`#285393`, N1=`#0a7abf`

Safe area: always `useSafeAreaInsets()` — never `SafeAreaView`. Edge-to-edge, transparent status/nav bars.

## Key Behaviors

### LearnSessionScreen
- Batch of up to 10 un-enrolled kanji, shown one by one
- Shows: giant char (120px) → meaning → mnemonic → "Show readings" reveal → on-yomi pills (blue) + mnemonic → kun-yomi pills (purple) + mnemonic → vocab examples
- Final screen: "Add N kanji to reviews" → batch-enrolls to SQLite, syncs Supabase in background

### ReviewSessionScreen
- Question types cycle: meaning (0) → onyomi (1, if exists) → kunyomi (2, if exists)
- Hint shown: meaning question shows reading hint; reading question shows meaning hint
- SwipeableCard: swipe left/right = defer ("Later")
- 4 ChoiceButtons: correct=green, wrong=red
- Auto-advance setting; "Next →" / "Finish" button
- Practice mode: no SRS grading

### Distractors (engine/srs/distractors.ts)
Generates 3 wrong choices + 1 correct for the 4-choice quiz.

## Pending Work (from MEMORY)

- **Stroke order numbers** on `StrokeOrderDiagram` — show small numerals at stroke start points during animation. strokes.json regeneration may still be in progress.
- strokes.json had a bug where nested `<g>` groups caused only the first radical's strokes to be extracted for compound kanji (e.g. 語 only showed 言). Fixed by scanning all `<path>` elements from StrokePaths group start.

## Scripts

```bash
npm start           # Metro bundler
npm run android     # Build & install on Android

node scripts/buildStrokeData.js    # Regenerate strokes.json from KanjiVG
node scripts/buildKanjiData.js     # Regenerate kanji.json
node scripts/buildMnemonics.js     # Regenerate mnemonics.json
```
SVGs cached in `scripts/kanjivg/` (gitignored) — reruns are instant.
