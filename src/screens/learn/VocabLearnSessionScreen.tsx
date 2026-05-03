import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { LearnStackParamList } from '../../types/navigation';
import { useVocabProgressQuery, VOCAB_PROGRESS_QUERY_KEY } from '../../queries/useVocabProgressQuery';
import { useVocabData } from '../../hooks/useVocabData';
import type { VocabEntry } from '../../hooks/useVocabData';
import { useKanjiData } from '../../hooks/useKanjiData';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useQueryClient } from '@tanstack/react-query';
import { upsertVocabProgressBatch } from '../../services/database/queries';
import { upsertVocabProgress as upsertVocabRemote } from '../../services/supabase/progress';
import { FuriganaWord } from '../../components/ui/ColoredReading';
import ChoiceButton from '../../components/quiz/ChoiceButton';
import type { VocabProgress, KanjiEntry } from '../../types/kanji';
import { uuid } from '../../utils/kanjiUtils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const POS_LABELS: Record<string, string> = {
  'n': 'Noun', 'n-suf': 'Suffix', 'n-pref': 'Prefix', 'n-adv': 'Adv. Noun',
  'v1': 'Verb (ru)', 'v5u': 'Verb (u)', 'v5k': 'Verb (ku)', 'v5g': 'Verb (gu)',
  'v5s': 'Verb (su)', 'v5t': 'Verb (tsu)', 'v5n': 'Verb (nu)', 'v5b': 'Verb (bu)',
  'v5m': 'Verb (mu)', 'v5r': 'Verb (ru)', 'vs': 'Suru Verb', 'vk': 'Kuru Verb',
  'adj-i': 'i-Adjective', 'adj-na': 'na-Adjective', 'adj-no': 'no-Adjective',
  'adv': 'Adverb', 'exp': 'Expression', 'pn': 'Pronoun', 'conj': 'Conjunction',
};

function getPosLabel(pos: string[]): string | null {
  for (const p of pos) {
    if (POS_LABELS[p]) return POS_LABELS[p];
  }
  return null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'VocabLearnSession'>;
  route: RouteProp<LearnStackParamList, 'VocabLearnSession'>;
};

type Phase = 'intro' | 'quiz' | 'enrolling' | 'done';
type QuizType = 'meaning' | 'reading';

export default function VocabLearnSessionScreen({ navigation, route }: Props) {
  const { jlptLevel } = route.params;
  const insets = useSafeAreaInsets();
  const { data: vocabProgress } = useVocabProgressQuery();
  const allVocab = useVocabData();
  const allKanji = useKanjiData();
  const session = useAuthStore(s => s.session);
  const queryClient = useQueryClient();
  const lessonsPerSession = useSettingsStore(s => s.lessonsPerSession);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [quizType, setQuizType] = useState<QuizType>('meaning');
  const [answerState, setAnswerState] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [selected, setSelected] = useState<string | null>(null);

  // Build batch: pending vocab for this level, capped at lessonsPerSession
  const batch = React.useMemo(() => {
    const levelKanjiIds = new Set(
      allKanji.filter(k => k.jlptLevel === jlptLevel).map(k => k.id)
    );
    const pending = (vocabProgress ?? []).filter(
      p => p.srsLevel === -1 && levelKanjiIds.has(p.kanjiId)
    );
    const result: Array<{ progress: VocabProgress; entry: VocabEntry }> = [];
    for (const p of pending) {
      const words = allVocab[p.kanjiId] ?? [];
      const entry = words.find(v => v.word === p.vocabWord);
      if (entry) result.push({ progress: p, entry });
      if (result.length >= lessonsPerSession) break;
    }
    return result;
  }, [vocabProgress, allKanji, allVocab, jlptLevel, lessonsPerSession]);

  // Pre-build meaning + reading choices once for the whole batch
  const allChoicesRef = useRef<{ meaning: string[]; reading: string[] }[] | null>(null);
  if (batch.length > 0 && allChoicesRef.current === null) {
    const allEntries = Object.values(allVocab).flat();
    const allMeanings = allEntries.map(v => v.meaning);
    const allReadings = allEntries.map(v => v.reading);
    allChoicesRef.current = batch.map(({ entry }) => {
      const meaningDistractors = shuffle(
        [...new Set(allMeanings.filter(m => m !== entry.meaning))]
      ).slice(0, 3);
      const readingDistractors = shuffle(
        [...new Set(allReadings.filter(r => r !== entry.reading))]
      ).slice(0, 3);
      return {
        meaning: shuffle([entry.meaning, ...meaningDistractors]),
        reading: shuffle([entry.reading, ...readingDistractors]),
      };
    });
  }

  const current = batch[index];
  const isLast = index === batch.length - 1;

  const handleEnroll = useCallback(async () => {
    setPhase('enrolling');
    try {
      const userId = session!.user.id;
      const now = new Date();
      const enrolled: VocabProgress[] = batch.map(({ progress }) => ({
        ...progress,
        srsLevel: 0,
        learnedAt: now,
        nextReview: now,
      }));
      await upsertVocabProgressBatch(enrolled);
      queryClient.setQueryData<VocabProgress[]>(
        [VOCAB_PROGRESS_QUERY_KEY, userId],
        old => {
          const map = new Map((old ?? []).map(p => [p.vocabWord, p]));
          for (const p of enrolled) map.set(p.vocabWord, p);
          return [...map.values()];
        }
      );
      Promise.all(enrolled.map(p => upsertVocabRemote(p))).catch(() => { });
      setPhase('done');
    } catch (e) {
      console.error('[VocabLearn] enroll error', e);
      setPhase('done');
    }
  }, [batch, session, queryClient]);

  const handleChoice = useCallback((choice: string) => {
    if (answerState !== 'idle') return;
    setSelected(choice);
    const correct = quizType === 'meaning' ? current?.entry.meaning : current?.entry.reading;
    setAnswerState(choice === correct ? 'correct' : 'wrong');
  }, [answerState, quizType, current]);

  const handleNext = useCallback(() => {
    if (phase === 'intro') {
      if (isLast) {
        setIndex(0);
        setQuizType('meaning');
        setPhase('quiz');
        setAnswerState('idle');
        setSelected(null);
      } else {
        setIndex(i => i + 1);
      }
    } else if (phase === 'quiz') {
      if (quizType === 'meaning') {
        // Move to reading quiz for same word
        setQuizType('reading');
        setAnswerState('idle');
        setSelected(null);
      } else if (isLast) {
        handleEnroll();
      } else {
        setIndex(i => i + 1);
        setQuizType('meaning');
        setAnswerState('idle');
        setSelected(null);
      }
    }
  }, [isLast, phase, quizType, handleEnroll]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (batch.length === 0) {
    return (
      <View style={[styles.container, {paddingTop: insets.top + 16}]}>
        <Text style={styles.doneTitle}>All caught up!</Text>
        <Text style={styles.doneSubtitle}>No pending vocabulary for N{jlptLevel}.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'enrolling') {
    return (
      <View style={[styles.container, {paddingTop: insets.top + 16}]}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.enrollingText}>Adding words to reviews…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={[styles.container, {paddingTop: insets.top + 16}]}>
        <Text style={styles.doneTitle}>Nice work!</Text>
        <Text style={styles.doneSubtitle}>
          {batch.length} word{batch.length !== 1 ? 's' : ''} added to your reviews.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isIntro = phase === 'intro';
  const totalSteps = batch.length * 3; // intro + meaning quiz + reading quiz
  const currentStep = isIntro ? index + 1
    : quizType === 'meaning' ? batch.length + index * 2 + 1
    : batch.length + index * 2 + 2;
  const stepLabel = isIntro ? 'Vocabulary' : quizType === 'meaning' ? 'Meaning Quiz' : 'Reading Quiz';

  // Intro: kanji breakdown + mnemonic data
  const kanjiBreakdown = isIntro
    ? [...new Set(current.entry.kanjiUsed)]
        .map(ch => allKanji.find(k => k.character === ch))
        .filter((k): k is KanjiEntry => !!k)
    : [];
  const posLabel = isIntro ? getPosLabel(current.entry.pos) : null;
  const mnemonicParts = kanjiBreakdown.map(k => k.meanings[0]);
  const mnemonic = mnemonicParts.length > 1
    ? mnemonicParts.join(' + ') + ' → ' + current.entry.meaning
    : null;

  const choicesForIndex = allChoicesRef.current?.[index];
  const choices: string[] = choicesForIndex
    ? (quizType === 'meaning' ? choicesForIndex.meaning : choicesForIndex.reading)
    : [];
  const correctAnswer = quizType === 'meaning' ? current.entry.meaning : current.entry.reading;

  return (
    <View style={[styles.container, {paddingTop: insets.top + 16}]}>
      {/* Header */}
      <View style={styles.progressRow}>
        <View style={styles.progressHeader}>
          <View style={styles.headerSpacer} />
          <View style={styles.progressCenter}>
            <Text style={styles.progressText}>{currentStep} / {totalSteps}</Text>
            <Text style={styles.stepText}>{stepLabel}</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Leave Session', 'Leave without enrolling these words?', [
                { text: 'Stay', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
              ])
            }>
            <Text style={styles.exitText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(currentStep / totalSteps) * 100}%` }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Intro ── */}
        {isIntro && (
          <View style={styles.wordContainer}>
            {current.entry.parts
              ? <FuriganaWord parts={current.entry.parts} fontSize={72} />
              : <Text style={styles.wordText}>{current.entry.word}</Text>}
            <Text style={styles.meaning}>{current.entry.meaning}</Text>

            {posLabel && (
              <View style={styles.posPill}>
                <Text style={styles.posText}>{posLabel}</Text>
              </View>
            )}

            {kanjiBreakdown.length > 0 && (
              <View style={styles.breakdownContainer}>
                <Text style={styles.breakdownLabel}>Kanji</Text>
                <View style={styles.breakdownRow}>
                  {kanjiBreakdown.map((k, i) => (
                    <View key={i} style={styles.breakdownCard}>
                      <Text style={styles.breakdownChar}>{k.character}</Text>
                      <Text style={styles.breakdownMeaning}>{k.meanings[0]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {mnemonic && (
              <View style={styles.mnemonicContainer}>
                <Text style={styles.mnemonicText}>{mnemonic}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Quiz ── */}
        {!isIntro && (
          <View style={styles.wordContainer}>
            <Text style={styles.readingLabel}>
              {quizType === 'meaning' ? 'What does this mean?' : 'How do you read this?'}
            </Text>
            <Text style={styles.wordText}>{current.entry.word}</Text>

            {answerState === 'wrong' && (
              <Text style={styles.correctReveal}>Correct: {correctAnswer}</Text>
            )}

            <View style={styles.choicesContainer}>
              {choices.map((choice, i) => {
                let state: 'idle' | 'correct' | 'wrong' = 'idle';
                if (answerState !== 'idle') {
                  if (choice === correctAnswer) state = 'correct';
                  else if (choice === selected) state = 'wrong';
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
          </View>
        )}
      </ScrollView>

      {/* Bottom button */}
      <View style={styles.bottomRow}>
        <TouchableOpacity
          style={[
            styles.nextBtn,
            !isIntro && answerState === 'idle' && styles.nextBtnDisabled,
          ]}
          disabled={!isIntro && answerState === 'idle'}
          onPress={handleNext}>
          <Text style={styles.nextBtnText}>
            {isIntro
              ? isLast ? 'Start Quiz →' : 'Next →'
              : answerState === 'idle' ? 'Pick an answer'
              : quizType === 'meaning' ? 'Next →'
              : isLast ? `Add ${batch.length} words to reviews` : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, alignItems: 'center', justifyContent: 'center' },
  progressRow: { width: '100%', marginBottom: 16 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  progressCenter: { alignItems: 'center' },
  progressText: { color: '#888', fontSize: 13 },
  stepText: { color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  exitText: { color: '#888', fontSize: 18 },
  headerSpacer: { width: 40 },
  progressBar: { width: '100%', height: 4, backgroundColor: '#333', borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: '#e94560', borderRadius: 2 },
  content: { alignItems: 'center', paddingBottom: 24, flexGrow: 1, alignSelf: 'stretch' },
  wordContainer: { width: '100%', alignItems: 'center' },
  wordText: { fontSize: 72, color: '#fff', textAlign: 'center', marginBottom: 8 },
  meaning: { fontSize: 22, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginTop: 16, marginBottom: 8 },
  readingLabel: { color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  correctReveal: { color: '#7eb8f7', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  choicesContainer: { width: '100%' },
  bottomRow: { width: '100%', marginTop: 16 },
  nextBtn: { width: '100%', backgroundColor: '#e94560', padding: 18, borderRadius: 12, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#5a2030' },
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  posPill: { backgroundColor: '#1e3a5f', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginTop: 10 },
  posText: { color: '#7eb8f7', fontSize: 12, fontWeight: '600' },
  breakdownContainer: { width: '100%', marginTop: 24 },
  breakdownLabel: { color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, textAlign: 'center' },
  breakdownRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 10 },
  breakdownCard: { backgroundColor: '#16213e', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', minWidth: 72 },
  breakdownChar: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  breakdownMeaning: { color: '#aaa', fontSize: 12, marginTop: 4, textAlign: 'center' },
  mnemonicContainer: { width: '100%', marginTop: 16, backgroundColor: '#16213e', borderRadius: 10, padding: 14 },
  mnemonicText: { color: '#aaa', fontSize: 14, fontStyle: 'italic', textAlign: 'center', lineHeight: 20 },
  enrollingText: { color: '#aaa', marginTop: 16 },
  doneTitle: { fontSize: 32, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  doneSubtitle: { color: '#aaa', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  btn: { backgroundColor: '#e94560', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
