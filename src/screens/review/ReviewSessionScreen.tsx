import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { ReviewStackParamList } from '../../types/navigation';
import { useReviewStore } from '../../stores/useReviewStore';
import { useGradeCard } from '../../queries/useGradeCard';
import { useGradeVocabCard } from '../../queries/useGradeVocabCard';
import { useProgressQuery } from '../../queries/useProgressQuery';
import { useVocabProgressQuery } from '../../queries/useVocabProgressQuery';
import { useSessionLog } from '../../queries/useSessionLog';
import { generateChoices } from '../../engine/srs/distractors';
import { useKanjiData } from '../../hooks/useKanjiData';
import SwipeableCard, { SwipeableCardRef } from '../../components/cards/SwipeableCard';
import ChoiceButton from '../../components/quiz/ChoiceButton';
import ProgressBar from '../../components/quiz/ProgressBar';
import { QuestionType } from '../../types/review';
import { useSettingsStore } from '../../stores/useSettingsStore';
import vocabData from '../../data/vocab.json';

const allVocab = vocabData as Record<string, { word: string; reading: string; meaning: string; jlptLevel: number }[]>;

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewSession'>;
  route: RouteProp<ReviewStackParamList, 'ReviewSession'>;
};

type AnswerState = 'idle' | 'correct' | 'wrong';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょっァィゥェォャュョッ');
function moraCount(reading: string): number {
  let count = 0;
  for (let i = 0; i < reading.length; i++) {
    if (!SMALL_KANA.has(reading[i])) count++;
  }
  return count;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deriveQuestionType(
  item: NonNullable<ReturnType<typeof useReviewStore.getState>['queue'][number]>,
  index: number,
): QuestionType {
  if (item.kind === 'vocab') return item.questionType;
  const cycle = index % 3;
  if (cycle === 0) return 'meaning';
  if (cycle === 1) return item.kanji.readings_on.length > 0 ? 'onyomi' : 'meaning';
  return item.kanji.readings_kun.length > 0 ? 'kunyomi' : 'meaning';
}

export default function ReviewSessionScreen({ navigation, route }: Props) {
  const practiceMode = route.params?.practiceMode ?? false;
  const insets = useSafeAreaInsets();
  const allKanji = useKanjiData();
  const { data: progress } = useProgressQuery();
  const { data: vocabProgress } = useVocabProgressQuery();
  const { mutate: gradeCard } = useGradeCard();
  const { mutate: gradeVocabCard } = useGradeVocabCard();
  const { mutate: logSession } = useSessionLog();
  const {
    queue,
    currentIndex,
    deferred,
    answers,
    sessionStartedAt,
    answerCurrent,
    deferCurrent,
    advance,
    resetSession,
  } = useReviewStore();

  const cardRef = useRef<SwipeableCardRef>(null);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [questionType, setQuestionType] = useState<QuestionType>('meaning');
  // displayedIndex is the single source of truth for what the card renders.
  // It only advances inside the swipe-out callback so the card is already
  // off-screen before any state changes, eliminating mid-render flicker.
  const [displayedIndex, setDisplayedIndex] = useState(0);

  const autoAdvanceOnCorrect = useSettingsStore(s => s.autoAdvanceOnCorrect);
  const reduceMotion = useSettingsStore(s => s.reduceMotion);

  // Session-done check is based on store's currentIndex (source of truth for
  // SRS progress), not displayedIndex.
  const isSessionDone = currentIndex >= queue.length;

  // All card rendering is driven by displayedIndex.
  const displayedItem = queue[displayedIndex];
  const isVocab = displayedItem?.kind === 'vocab';

  // Helper: reset card state for a given queue index. Called in one
  // synchronous block so React batches everything into a single render.
  function loadCard(index: number, q: typeof queue) {
    const item = q[index];
    if (!item) return;
    setQuestionType(deriveQuestionType(item, index));
    setAnswerState('idle');
    setSelectedChoice(null);
  }

  // Auto-advance on correct
  useEffect(() => {
    if (answerState !== 'correct' || !autoAdvanceOnCorrect) return;
    const t = setTimeout(() => handleNext(), reduceMotion ? 0 : 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerState, autoAdvanceOnCorrect]);

  // Build choices — depends on displayedItem, not current store index
  const { correctAnswer, choices } = useMemo(() => {
    if (!displayedItem) return { correctAnswer: '', choices: [] };

    if (displayedItem.kind === 'vocab') {
      if (displayedItem.questionType === 'reading') {
        const correct = displayedItem.vocab.reading;
        const targetLevel = displayedItem.vocab.jlptLevel;
        const correctMora = moraCount(correct);

        const isVerbReading = displayedItem.vocab.meaning.startsWith('To ');

        const VERB_ENDINGS = new Set('うくぐすつぬぶむる');
        const allReadings = Object.values(allVocab)
          .flat()
          .filter(v => v.jlptLevel === targetLevel && v.meaning.startsWith('To ') === isVerbReading)
          .map(v => v.reading)
          .filter(r => r !== correct)
          .filter(r => !isVerbReading || VERB_ENDINGS.has(r[r.length - 1]));

        const unique = [...new Set(allReadings)];
        // Score: same mora count = best; same first char = bonus
        const scored = unique.map(r => ({
          r,
          score: Math.abs(moraCount(r) - correctMora) * 2 - (r[0] === correct[0] ? 1 : 0),
        })).sort((a, b) => a.score - b.score);

        const distractors = shuffle(scored.slice(0, 20).map(x => x.r)).slice(0, 3);

        if (distractors.length < 3) {
          const fallback = shuffle(unique.filter(r => !distractors.includes(r)))
            .slice(0, 3 - distractors.length);
          distractors.push(...fallback);
        }
        while (distractors.length < 3) distractors.push(`(unknown ${distractors.length})`);
        return { correctAnswer: correct, choices: shuffle([correct, ...distractors]) };
      }
      const correct = cap(displayedItem.vocab.meaning);
      const targetLevel = displayedItem.vocab.jlptLevel;
      const isVerb = correct.startsWith('To ');
      // Content words from correct answer (length > 3, skip "to/a/the/of")
      const STOP = new Set(['to', 'a', 'the', 'of', 'in', 'on', 'at', 'be', 'do']);
      const correctKeyWords = new Set(
        correct.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)),
      );

      const allMeanings = Object.values(allVocab)
        .flat()
        .filter(v => v.jlptLevel === targetLevel)
        .map(v => cap(v.meaning))
        .filter(m => m !== correct)
        // Same part-of-speech: verbs vs non-verbs
        .filter(m => isVerb ? m.startsWith('To ') : !m.startsWith('To '))
        // Exclude meanings sharing a content word with the correct answer
        .filter(m => {
          const mWords = m.toLowerCase().split(/\s+/);
          return !mWords.some(w => w.length > 3 && !STOP.has(w) && correctKeyWords.has(w));
        });

      const correctWordCount = correct.split(/\s+/).length;
      const unique = [...new Set(allMeanings)];
      // Sort by similarity of word count, then shuffle within same-score buckets
      const scored = unique.map(m => ({
        m,
        score: Math.abs(m.split(/\s+/).length - correctWordCount),
      })).sort((a, b) => a.score - b.score);

      // Take top 20 candidates (similar length) and shuffle for variety
      const distractors = shuffle(scored.slice(0, 20).map(x => x.m)).slice(0, 3);

      // Fallback: relax POS filter if not enough
      if (distractors.length < 3) {
        const fallback = shuffle([...new Set(
          Object.values(allVocab).flat()
            .filter(v => v.jlptLevel === targetLevel)
            .map(v => cap(v.meaning))
            .filter(m => m !== correct && !distractors.includes(m)),
        )]).slice(0, 3 - distractors.length);
        distractors.push(...fallback);
      }
      while (distractors.length < 3) distractors.push(`(unknown ${distractors.length})`);
      return { correctAnswer: correct, choices: shuffle([correct, ...distractors]) };
    }

    const pool = allKanji.filter(k => k.jlptLevel === displayedItem.kanji.jlptLevel);
    return generateChoices(displayedItem.kanji, pool, questionType);
  }, [displayedItem, questionType, allKanji]);

  const progressByKanji = useMemo(() => {
    const map: Record<string, any> = {};
    (progress ?? []).forEach(p => { map[p.kanjiId] = p; });
    return map;
  }, [progress]);

  const vocabProgressByWord = useMemo(() => {
    const map: Record<string, any> = {};
    (vocabProgress ?? []).forEach(p => { map[p.vocabWord] = p; });
    return map;
  }, [vocabProgress]);

  function handleChoice(choice: string) {
    if (answerState !== 'idle') return;
    const correct = choice === correctAnswer;
    setSelectedChoice(choice);
    setAnswerState(correct ? 'correct' : 'wrong');
    answerCurrent(correct, questionType);

    if (!practiceMode) {
      if (displayedItem?.kind === 'kanji') {
        gradeCard({
          kanjiId: displayedItem.kanji.id,
          jlptLevel: displayedItem.kanji.jlptLevel,
          grade: correct ? 4 : 1,
          existing: progressByKanji[displayedItem.kanji.id],
        });
      } else if (displayedItem?.kind === 'vocab') {
        gradeVocabCard({
          vocabWord: displayedItem.vocab.word,
          kanjiId: displayedItem.kanjiId,
          grade: correct ? 4 : 1,
          existing: vocabProgressByWord[displayedItem.vocab.word],
        });
      }
    }
  }

  function handleNext() {
    const proceed = () => {
      const nextIdx = currentIndex + 1;
      if (nextIdx >= queue.length && deferred.length === 0) {
        finishSession();
        return;
      }
      advance();
      // Read queue from store *after* advance() so deferred items are included
      const newQueue = useReviewStore.getState().queue;
      setDisplayedIndex(nextIdx);
      loadCard(nextIdx, newQueue);
      cardRef.current?.reset();
    };
    cardRef.current?.swipeOut('right', proceed);
  }

  function handleEndSession() {
    Alert.alert('End Session', 'End the session and see your results?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: finishSession },
    ]);
  }

  function handleDefer(animateCard = true) {
    deferCurrent();
    const proceed = () => {
      const nextIdx = currentIndex + 1;
      advance();
      const newQueue = useReviewStore.getState().queue;
      setDisplayedIndex(nextIdx);
      loadCard(nextIdx, newQueue);
      cardRef.current?.reset();
    };
    if (animateCard) {
      cardRef.current?.swipeOut('left', proceed);
    } else {
      proceed();
    }
  }

  function finishSession() {
    const allAnswers = Object.entries(answers);
    const correct = allAnswers.filter(([, a]) => a.some(x => x.correct)).length;
    const incorrect = allAnswers.filter(([, a]) => a.every(x => !x.correct)).length;
    const kanjiWrong = allAnswers
      .filter(([id, a]) => !id.startsWith('vocab:') && a.some(x => !x.correct))
      .map(([id]) => id);

    logSession({
      startedAt: sessionStartedAt ?? new Date(),
      endedAt: new Date(),
      cardsReviewed: Object.keys(answers).length,
      cardsCorrect: correct,
      cardsDeferred: deferred.length,
    });

    navigation.replace('ReviewSummary', {
      correct,
      incorrect,
      deferred: deferred.length,
      kanjiReviewed: Object.keys(answers).filter(id => !id.startsWith('vocab:')),
      kanjiWrong,
    });
    resetSession();
  }

  if (isSessionDone) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleEndSession} style={styles.endBtn}>
          <Text style={styles.endText}>✕</Text>
        </TouchableOpacity>
        <ProgressBar
          current={Object.keys(answers).length}
          total={queue.length}
        />
        <TouchableOpacity onPress={() => handleDefer()} style={styles.deferBtn}>
          <Text style={styles.deferText}>Later →</Text>
        </TouchableOpacity>
      </View>

      {/* Card */}
      <SwipeableCard
        ref={cardRef}
        onSwipeLeft={() => handleDefer(false)}
        onSwipeRight={() => handleDefer(false)}
        enabled={answerState === 'idle'}
        reduceMotion={reduceMotion}>
        <View style={[styles.card, isVocab && styles.vocabCard]}>
          {answerState === 'correct' && (
            <Text style={styles.checkmark}>✓</Text>
          )}

          {displayedItem?.kind === 'kanji' ? (
            <>
              <Text style={styles.kanji}>{displayedItem.kanji.character}</Text>
              <Text style={styles.hint}>
                {questionType === 'meaning'
                  ? displayedItem.kanji.readings_on[0] ?? displayedItem.kanji.readings_kun[0] ?? ''
                  : displayedItem.kanji.meanings[0]}
              </Text>
            </>
          ) : displayedItem?.kind === 'vocab' ? (
            <>
              <Text style={styles.vocabWord}>{displayedItem.vocab.word}</Text>
              {displayedItem.questionType === 'reading' && (
                <Text style={[styles.vocabMeaningHint, answerState === 'idle' && { opacity: 0 }]}>
                  {cap(displayedItem.vocab.meaning)}
                </Text>
              )}
            </>
          ) : null}
        </View>
      </SwipeableCard>

      {/* Question prompt */}
      <Text style={[
        styles.prompt,
        questionType === 'onyomi' ? { color: '#4a90d9' } :
          questionType === 'kunyomi' ? { color: '#9b59b6' } :
            questionType === 'reading' ? { color: '#4a90d9' } : null,
      ]}>
        {questionType === 'meaning' ? 'Meaning 意味' :
          questionType === 'onyomi' ? "On'yomi  音読み" :
            questionType === 'kunyomi' ? "Kun'yomi  訓読み" :
              'Reading  読み方'}
      </Text>

      {/* Choices */}
      <View style={styles.choices}>
        {choices.map((choice, i) => {
          let state: 'idle' | 'correct' | 'wrong' = 'idle';
          if (answerState !== 'idle') {
            if (choice === correctAnswer) state = 'correct';
            else if (choice === selectedChoice) state = 'wrong';
          }
          return (
            <ChoiceButton
              key={i}
              label={choice}
              state={state}
              onPress={() => handleChoice(choice)}
              disabled={answerState !== 'idle'}
            />
          );
        })}
      </View>

      {/* Next button */}
      {answerState !== 'idle' && (answerState === 'wrong' || !autoAdvanceOnCorrect) && (
        <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
          <Text style={styles.nextText}>
            {currentIndex + 1 >= queue.length && deferred.length === 0
              ? 'Finish'
              : 'Next →'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  endBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  endText: { color: '#888', fontSize: 18 },
  deferBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  deferText: { color: '#888' },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    minHeight: 200,
    justifyContent: 'center',
  },
  vocabCard: {
    borderColor: '#4a3a6e',
    borderWidth: 1,
  },
  questionType: { color: '#e94560', fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginTop: 12, textTransform: 'uppercase' },
  kanji: { fontSize: 96, color: '#fff' },
  hint: { color: '#666', marginTop: 12, fontSize: 16 },
  vocabWord: { fontSize: 72, color: '#fff', fontWeight: '300' },
  vocabReading: { color: '#9b59b6', fontSize: 18, marginTop: 8 },
  vocabBadge: { color: '#9b59b6', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginTop: 12 },
  vocabMeaningHint: { color: '#888', fontSize: 14, marginTop: 10, fontStyle: 'italic' },
  choices: { gap: 2 },
  nextBtn: {
    backgroundColor: '#e94560',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  nextText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  checkmark: { position: 'absolute', top: 12, right: 16, fontSize: 20, color: '#4caf50', fontWeight: 'bold' },
  prompt: { color: '#e94560', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginBottom: 8 },
});
