import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { useKanjiGrouped } from '../../hooks/useKanjiData';
import { useProgressQuery } from '../../queries/useProgressQuery';
import { useAuthStore } from '../../stores/useAuthStore';
import { buildNewProgress, buildKnownProgress } from '../../engine/srs/scheduler';
import { upsertProgressBatch as upsertLocalBatch, upsertVocabProgressBatch } from '../../services/database/queries';
import { upsertProgress as upsertRemote, upsertVocabProgress as upsertVocabRemote } from '../../services/supabase/progress';
import { useQueryClient } from '@tanstack/react-query';
import { PROGRESS_QUERY_KEY } from '../../queries/useProgressQuery';
import { formatReading, uuid } from '../../utils/kanjiUtils';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVocabForKanjiByLevel, useVocabData } from '../../hooks/useVocabData';
import type { VocabEntry } from '../../hooks/useVocabData';
import { useMnemonicForKanji } from '../../hooks/useMnemonicsData';
import { ColoredReading, ColoredWord } from '../../components/ui/ColoredReading';
import ChoiceButton from '../../components/quiz/ChoiceButton';
import radicalKanjiData from '../../data/radicalKanji.json';
import type { KanjiEntry, KanjiProgress, VocabProgress } from '../../types/kanji';

const radicalKanji = radicalKanjiData as Record<string, string>;

// Splits text into spans so CJK characters aren't rendered in italic (Android italic fonts lack CJK glyphs → □)
function MnemonicText({ text, style }: { text: string; style: any }) {
  const parts = text.split(/([^\u0000-\u007F\u0020-\u007E]+)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /[\u4e00-\u9fff\u3040-\u30ff]/.test(part)
          ? <Text key={i} style={{ fontStyle: 'normal' }}>{part}</Text>
          : part
      )}
    </Text>
  );
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
  navigation: StackNavigationProp<LearnStackParamList, 'LearnSession'>;
  route: RouteProp<LearnStackParamList, 'LearnSession'>;
};

type Phase = 'loading' | 'studying' | 'enrolling' | 'done' | 'empty';
type KanjiStep = 'intro' | 'examples' | 'vocab-intro' | 'quiz';

export default function LearnSessionScreen({ navigation, route }: Props) {
  const { jlptLevel } = route.params;
  const grouped = useKanjiGrouped();
  const { data: progress } = useProgressQuery();
  const session = useAuthStore(s => s.session);
  const queryClient = useQueryClient();

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('studying');
  // Keyed by index so step is always 'intro' for any new index value
  const [stepByIndex, setStepByIndex] = useState<Record<number, KanjiStep>>({});
  const [quizSubStep, setQuizSubStep] = useState<'meaning' | 'reading' | 'word-meaning'>('meaning');
  const [quizAnswerState, setQuizAnswerState] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [quizSelected, setQuizSelected] = useState<string | null>(null);

  const kanjiStep: KanjiStep = stepByIndex[index] ?? 'intro';

  const setKanjiStep = useCallback((step: KanjiStep) => {
    setStepByIndex(prev => ({ ...prev, [index]: step }));
  }, [index]);

  const resetKanjiStep = useCallback((nextIndex: number) => {
    setStepByIndex(prev => {
      const next = { ...prev };
      delete next[nextIndex];
      return next;
    });
    setQuizSubStep('meaning');
    setQuizAnswerState('idle');
    setQuizSelected(null);
  }, []);

  const enrolledIds = React.useMemo(
    () => new Set((progress ?? []).map(p => p.kanjiId)),
    [progress],
  );

  const lessonsPerSession = useSettingsStore(s => s.lessonsPerSession);
  const initialBatch = React.useMemo<KanjiEntry[]>(() => {
    const levelKanji = grouped[jlptLevel] ?? [];
    return levelKanji
      .filter(k => !enrolledIds.has(k.id))
      .slice(0, lessonsPerSession);
  }, [grouped, jlptLevel, enrolledIds]);

  const [batch, setBatch] = useState<KanjiEntry[]>([]);
  useEffect(() => { setBatch(initialBatch); }, [initialBatch]);

  const current = batch[index];
  const isLast = index === batch.length - 1;

  const allVocab = useVocabData();
  // All kanji IDs in this JLPT level — used for examples
  const levelKanjiIds = React.useMemo(
    () => new Set((grouped[jlptLevel] ?? []).map(k => k.id)),
    [grouped, jlptLevel],
  );
  const exampleVocab = useVocabForKanjiByLevel(current?.character ?? '', levelKanjiIds);
  const mnemonic = useMnemonicForKanji(current?.character ?? '');

  // Quiz data: frozen per kanji+index — stored in a ref so choices never reshuffle mid-step
  const quizDataRef = useRef<{
    forChar: string;
    forIndex: number;
    hasGoodQuizWord: boolean;
    isSoloWord: boolean;
    quizWord: VocabEntry;
    correctMeaning: string;
    meaningChoices: string[];
    correctReading: string;
    readingChoices: string[];
    correctWordMeaning: string;
    wordMeaningChoices: string[];
  } | null>(null);

  const NUMBER_KANJI = new Set('一二三四五六七八九十');
  const isNumberKanji = current ? NUMBER_KANJI.has(current.character) : false;

  if (current && exampleVocab.length > 0 &&
    (quizDataRef.current?.forChar !== current.character || quizDataRef.current?.forIndex !== index)) {
    const prevSeenKanji = new Set([...enrolledIds, ...batch.slice(0, index).map(k => k.id)]);
    const candidates = exampleVocab.filter(v => v.word.includes(current.character));
    const kunReadings = new Set(current.readings_kun.map(r => r.replace(/[.-].*/,'')).filter(Boolean));
    const hasKunYomi = kunReadings.size > 0;
    // If the kanji has kun-yomi, use it as a standalone word
    const soloEntry = candidates.find(v => v.word === current.character && kunReadings.has(v.reading) && v.pos.includes('n') && !v.pos.includes('n-suf') && !v.pos.includes('n-pref'));
    // Otherwise pick the best compound: most known kanji, then most common (exampleVocab is already common-sorted)
    const bestCompound = !hasKunYomi && candidates.length > 0
      ? candidates.reduce((best, v) => {
          const knownCount = (e: typeof v) => e.kanjiUsed.filter(k => k === current.character || prevSeenKanji.has(k)).length;
          const diff = knownCount(v) - knownCount(best);
          return diff > 0 ? v : best; // higher known count wins; ties keep earlier (more common) entry
        })
      : undefined;
    const isSoloWord = !!soloEntry;
    const quizWord = soloEntry ?? bestCompound ?? exampleVocab[0];
    const hasGoodQuizWord = !isNumberKanji && !!(soloEntry ?? bestCompound);

    // Kanji meaning choices
    const correctMeaning = current.meanings[0];
    const allKanjiMeanings = Object.values(grouped).flat().map(k => k.meanings[0]).filter(m => m && m !== correctMeaning);
    const meaningChoices = shuffle([correctMeaning, ...shuffle([...new Set(allKanjiMeanings)]).slice(0, 3)]);

    // Reading choices (kun-yomi of the solo word, e.g. やま for 山)
    const correctReading = quizWord.reading;
    const allReadings = Object.values(allVocab).flat().map(v => v.reading).filter(r => r !== correctReading);
    const readingChoices = shuffle([correctReading, ...shuffle([...new Set(allReadings)]).slice(0, 3)]);

    // Word meaning choices — show word + reading, ask what it means
    const correctWordMeaning = quizWord.meaning;
    const allWordMeanings = Object.values(allVocab).flat().map(v => v.meaning).filter(m => m && m !== correctWordMeaning);
    const wordMeaningChoices = shuffle([correctWordMeaning, ...shuffle([...new Set(allWordMeanings)]).slice(0, 3)]);

    quizDataRef.current = { forChar: current.character, forIndex: index, hasGoodQuizWord, isSoloWord, quizWord, correctMeaning, meaningChoices, correctReading, readingChoices, correctWordMeaning, wordMeaningChoices };
  }

  const quizData = (current && quizDataRef.current?.forChar === current.character)
    ? quizDataRef.current
    : null;

  // Skip vocab-intro and quiz steps if no vocab available
  useEffect(() => {
    if (kanjiStep === 'vocab-intro' && (quizData === null || !quizData.hasGoodQuizWord)) {
      handleNext();
    }
  }, [kanjiStep, quizData]);

  const handleSkip = useCallback(async () => {
    const skipped = batch[index];
    if (skipped && session) {
      const p = { id: uuid(), ...buildKnownProgress(session.user.id, skipped.id, jlptLevel) };
      upsertLocalBatch([p]).catch(() => { });
      upsertRemote(p).catch(() => { });
      queryClient.invalidateQueries({ queryKey: [PROGRESS_QUERY_KEY] });
    }
    setBatch(b => {
      const next = b.filter((_, i) => i !== index);
      const nextIndex = index >= next.length ? Math.max(0, next.length - 1) : index;
      resetKanjiStep(nextIndex);
      if (index >= next.length) setIndex(nextIndex);
      return next;
    });
  }, [index, batch, session, jlptLevel, queryClient, resetKanjiStep]);

  const handleNext = useCallback(async () => {
    if (isLast) {
      setPhase('enrolling');
      try {
        const userId = session!.user.id;
        const newProgress = batch.map(k => ({
          id: uuid(),
          ...buildNewProgress(userId, k.id, jlptLevel),
        }));
        await upsertLocalBatch(newProgress);

        // Immediately update cache so next session sees these as enrolled
        queryClient.setQueryData<KanjiProgress[]>(
          [PROGRESS_QUERY_KEY, session!.user.id],
          old => [...(old ?? []), ...newProgress],
        );

        // Enroll vocab words whose kanji are all enrolled
        const batchIds = new Set(batch.map(k => k.id));
        const allEnrolled = new Set([...enrolledIds, ...batchIds]);
        const allKanjiKnown = (word: string) =>
          [...word].filter(c => c >= '\u4e00' && c <= '\u9fff').every(c => allEnrolled.has(c));

        const vocabItems: VocabProgress[] = batch.flatMap(k => {
          const words = allVocab[k.character] ?? [];
          return words
            .filter(v => allKanjiKnown(v.word))
            .map(v => ({
              id: uuid(),
              userId,
              vocabWord: v.word,
              kanjiId: k.id,
              srsLevel: 0,
              repetitions: 0,
              easeFactor: 2.5,
              intervalDays: 0,
              nextReview: new Date(),
              lastReview: null,
              learnedAt: new Date(),
            }));
        });
        if (vocabItems.length > 0) {
          await upsertVocabProgressBatch(vocabItems);
          Promise.all(vocabItems.map(v => upsertVocabRemote(v))).catch(() => { });
        }

        setPhase('done');
        // Fire-and-forget remote sync; invalidate after so cache refreshes from remote eventually
        Promise.all(newProgress.map(p => upsertRemote(p)))
          .then(() => queryClient.invalidateQueries({ queryKey: [PROGRESS_QUERY_KEY] }))
          .catch(() => { });
      } catch (e) {
        console.error('[Enroll] error', e);
        setPhase('done');
      }
    } else {
      const nextIndex = index + 1;
      resetKanjiStep(nextIndex);
      setIndex(nextIndex);
    }
  }, [isLast, index, batch, session, jlptLevel, queryClient, enrolledIds, resetKanjiStep]);

  const handleQuizChoice = useCallback((choice: string) => {
    if (quizAnswerState !== 'idle') return;
    setQuizSelected(choice);
    const correct =
      quizSubStep === 'meaning' ? quizData?.correctMeaning :
      quizSubStep === 'reading' ? quizData?.correctReading :
      quizData?.correctWordMeaning;
    setQuizAnswerState(choice === correct ? 'correct' : 'wrong');
  }, [quizAnswerState, quizSubStep, quizData]);

  // ─── Empty / loading states ───────────────────────────────────────────────

  if (batch.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.doneTitle}>All caught up!</Text>
        <Text style={styles.doneSubtitle}>
          You've enrolled all N{jlptLevel} kanji. Keep reviewing to master them.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'enrolling') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.enrollingText}>Adding to your reviews…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.container}>
        <Text style={styles.doneTitle}>Nice work!</Text>
        <Text style={styles.doneSubtitle}>
          {batch.length} N{jlptLevel} kanji added to your reviews.{'\n'}
          Head to the Review tab to practice them.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Step label ───────────────────────────────────────────────────────────

  const stepLabel =
    kanjiStep === 'intro' ? 'Kanji' :
      kanjiStep === 'examples' ? 'Examples' :
        kanjiStep === 'vocab-intro' ? 'Vocabulary' :
          'Quiz';

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.progressHeader}>
          {index > 0 && kanjiStep === 'intro' ? (
            <TouchableOpacity onPress={() => setIndex(i => i - 1)}>
              <Text style={styles.backText}>‹ Prev</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <View style={styles.progressCenter}>
            <Text style={styles.progressText}>{index + 1} / {batch.length}</Text>
            <Text style={styles.stepText}>{stepLabel}</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Leave Session', 'Leave without enrolling these kanji?', [
                { text: 'Stay', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
              ])
            }>
            <Text style={styles.exitText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((index + 1) / batch.length) * 100}%` }]} />
        </View>
        {/* Step dots */}
        <View style={styles.stepDots}>
          {(['intro', 'examples', 'vocab-intro', 'quiz'] as KanjiStep[]).map(s => (
            <View
              key={s}
              style={[styles.dot, kanjiStep === s && styles.dotActive]}
            />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Step 1: Intro ── */}
        {kanjiStep === 'intro' && (
          <>
            <View style={styles.characterBox}>
              <Text style={styles.character}>{current.character}</Text>
              <Text style={styles.levelBadge}>N{jlptLevel}</Text>
            </View>

            <Text style={styles.meaning}>{current.meanings[0]}</Text>
            {current.meanings.length > 1 && (
              <Text style={styles.altMeanings}>
                Also: {current.meanings.slice(1).join(', ')}
              </Text>
            )}

            {mnemonic?.meaning ? (
              <MnemonicText text={mnemonic.meaning} style={styles.mnemonicText} />
            ) : null}

            <View style={styles.details}>
              {current.readings_on.length > 0 && (
                <View style={styles.readingSection}>
                  <Text style={styles.readingLabel}>ON 音読み</Text>
                  <View style={styles.pillRow}>
                    {current.readings_on.map((r, i) => (
                      <View key={i} style={styles.pill}>
                        <Text style={styles.pillText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                  {mnemonic?.onyomi && mnemonic.onyomi.length > (current.readings_on[0]?.length ?? 0) ? (
                    <MnemonicText text={mnemonic.onyomi} style={styles.readingMnemonic} />
                  ) : null}
                </View>
              )}

              {current.readings_kun.length > 0 && (
                <View style={styles.readingSection}>
                  <Text style={styles.readingLabel}>KUN 訓読み</Text>
                  <View style={styles.pillRow}>
                    {[...new Set(current.readings_kun.map(r => formatReading(r)).filter(r => r.length > 0))]
                      .map((r, i) => (
                        <View key={i} style={[styles.pill, styles.kunPill]}>
                          <Text style={styles.pillText}>{r}</Text>
                        </View>
                      ))}
                  </View>
                  {mnemonic?.kunyomi && mnemonic.kunyomi.length > (current.readings_kun[0]?.length ?? 0) ? (
                    <MnemonicText text={mnemonic.kunyomi} style={styles.readingMnemonic} />
                  ) : null}
                </View>
              )}



              {current.radicals.some(r => radicalKanji[r]) && (
                <View style={styles.readingSection}>
                  <Text style={styles.readingLabel}>Radicals</Text>
                  <View style={styles.radicalRow}>
                    {current.radicals.filter(r => radicalKanji[r]).map((r, i) => (
                      <View key={i} style={styles.radicalPill}>
                        <Text style={styles.radicalSymbol}>{radicalKanji[r]}</Text>
                        <Text style={styles.radicalName}>{r}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </>
        )}

        {/* ── Step 2: Examples ── */}
        {kanjiStep === 'examples' && (
          <View style={styles.details}>
            <Text style={styles.readingLabel}>Examples</Text>
            <Text style={styles.examplesHint}>
              Colors show how each kanji is read in this word
            </Text>
            {exampleVocab.slice(0, 5).map((v, i) => (
              <View key={i} style={styles.vocabRow}>
                <View style={styles.vocabWord}>
                  {v.parts
                    ? <ColoredWord parts={v.parts} fontSize={20} />
                    : <Text style={styles.vocabWordText}>{v.word}</Text>}
                  {v.parts
                    ? <ColoredReading parts={v.parts} fontSize={13} />
                    : <ColoredReading reading={v.reading} fontSize={13} />}
                </View>
                <Text style={styles.vocabMeaning}>{v.meaning}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Step 3: Vocab Intro ── */}
        {kanjiStep === 'vocab-intro' && quizData && (
          <View style={styles.quizContainer}>
            <Text style={styles.readingLabel}>Vocabulary</Text>
            {quizData.isSoloWord && (
              <Text style={styles.soloWordNote}>This kanji is also a word by itself</Text>
            )}
            <Text style={styles.quizWord}>{quizData.quizWord.word}</Text>
            {quizData.quizWord.parts
              ? <ColoredReading parts={quizData.quizWord.parts} fontSize={18} />
              : <ColoredReading reading={quizData.quizWord.reading} fontSize={18} />}
            <Text style={[styles.quizMeaning, { marginTop: 12, fontSize: 18, color: '#fff' }]}>{quizData.quizWord.meaning}</Text>
          </View>
        )}

        {/* ── Step 4: Quiz ── */}
        {kanjiStep === 'quiz' && quizData && (() => {
          const correctAnswer =
            quizSubStep === 'meaning' ? quizData.correctMeaning :
            quizSubStep === 'reading' ? quizData.correctReading :
            quizData.correctWordMeaning;
          const choices =
            quizSubStep === 'meaning' ? quizData.meaningChoices :
            quizSubStep === 'reading' ? quizData.readingChoices :
            quizData.wordMeaningChoices;
          const label =
            quizSubStep === 'meaning' ? 'Kanji Meaning' :
            quizSubStep === 'reading' ? 'How to say it' :
            'Word Meaning';
          const prompt =
            quizSubStep === 'meaning' ? 'What does this kanji mean?' :
            quizSubStep === 'reading' ? `How do you say ${quizData.quizWord.word}?` :
            'What does this word mean?';
          return (
            <View style={styles.quizContainer}>
              <Text style={styles.readingLabel}>{label}</Text>
              <Text style={styles.quizWord}>{quizSubStep === 'meaning' ? current.character : quizData.quizWord.word}</Text>
              {quizSubStep === 'word-meaning' && (
                quizData.quizWord.parts
                  ? <ColoredReading parts={quizData.quizWord.parts} fontSize={16} />
                  : <ColoredReading reading={quizData.quizWord.reading} fontSize={16} />
              )}
              <Text style={styles.quizPrompt}>{prompt}</Text>

              {quizAnswerState === 'wrong' && (
                <Text style={styles.quizCorrectReveal}>
                  Correct: {correctAnswer}
                </Text>
              )}

              <View style={styles.choicesContainer}>
                {choices.map((choice: string, i: number) => {
                  let state: 'idle' | 'correct' | 'wrong' = 'idle';
                  if (quizAnswerState !== 'idle') {
                    if (choice === correctAnswer) state = 'correct';
                    else if (choice === quizSelected) state = 'wrong';
                  }
                  return (
                    <ChoiceButton
                      key={i}
                      label={choice}
                      state={state}
                      onPress={() => handleQuizChoice(choice)}
                      disabled={quizAnswerState !== 'idle'}
                    />
                  );
                })}
              </View>
            </View>
          );
        })()}
      </ScrollView>

      {/* Bottom buttons */}
      <View style={styles.bottomRow}>
        {kanjiStep === 'intro' && batch.length > 1 && !isLast && (
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.nextBtn,
            kanjiStep === 'intro' && batch.length > 1 && !isLast && styles.nextBtnFlex,
            kanjiStep === 'quiz' && quizAnswerState === 'idle' && styles.nextBtnDisabled,
          ]}
          disabled={kanjiStep === 'quiz' && quizAnswerState === 'idle'}
          onPress={
            kanjiStep === 'intro' ? () => setKanjiStep('examples') :
            kanjiStep === 'examples' ? () => setKanjiStep(quizData?.hasGoodQuizWord ? 'vocab-intro' : 'quiz') :
            kanjiStep === 'vocab-intro' ? () => setKanjiStep('quiz') :
            quizSubStep === 'meaning' && quizData?.isSoloWord ? () => { setQuizSubStep('reading'); setQuizAnswerState('idle'); setQuizSelected(null); } :
            quizSubStep === 'meaning' && quizData?.hasGoodQuizWord ? () => { setQuizSubStep('word-meaning'); setQuizAnswerState('idle'); setQuizSelected(null); } :
            quizSubStep === 'reading' ? () => { setQuizSubStep('word-meaning'); setQuizAnswerState('idle'); setQuizSelected(null); } :
            handleNext
          }>
          <Text style={styles.nextBtnText}>
            {kanjiStep === 'intro' ? 'See examples →' :
              kanjiStep === 'examples' ? (quizData?.hasGoodQuizWord ? 'Learn a word →' : 'Quiz me →') :
              kanjiStep === 'vocab-intro' ? 'Quiz me →' :
              quizAnswerState === 'idle' ? 'Pick an answer' :
              (quizSubStep === 'meaning' || quizSubStep === 'reading') && (quizData?.isSoloWord || quizData?.hasGoodQuizWord) ? 'Next →' :
              isLast ? `Add ${batch.length} kanji to reviews` : 'Next kanji →'}
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
  backText: { color: '#888', fontSize: 13 },
  exitText: { color: '#888', fontSize: 18 },
  headerSpacer: { width: 40 },
  progressBar: { width: '100%', height: 4, backgroundColor: '#333', borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: '#e94560', borderRadius: 2 },
  stepDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#333' },
  dotActive: { backgroundColor: '#e94560', width: 18 },
  content: { alignItems: 'center', paddingBottom: 24, flexGrow: 1, alignSelf: 'stretch' },
  characterBox: { alignItems: 'center', marginBottom: 16 },
  character: { fontSize: 120, color: '#fff' },
  levelBadge: { color: '#e94560', fontWeight: 'bold', fontSize: 13, marginTop: 4 },
  meaning: { fontSize: 28, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  mnemonicText: { color: '#aaa', fontSize: 14, textAlign: 'center', fontStyle: 'italic', marginBottom: 20, lineHeight: 20, paddingHorizontal: 8 },
  details: { width: '100%', marginTop: 8 },
  readingSection: { marginBottom: 16 },
  readingLabel: { color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#285393',
  },
  kunPill: { borderColor: '#8858b5' },
  pillText: { color: '#fff', fontSize: 16 },
  readingMnemonic: { color: '#888', fontSize: 13, fontStyle: 'italic', marginTop: 8, lineHeight: 18 },
  altMeanings: { color: '#aaa', marginTop: 8, marginBottom: 4, textAlign: 'center', fontSize: 13 },
  radicalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radicalPill: {
    backgroundColor: '#1e3a5f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 52,
  },
  radicalSymbol: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  radicalName: { color: '#aaa', fontSize: 11, marginTop: 2 },
  examplesHint: { color: '#666', fontSize: 12, marginBottom: 12 },
  onColor: { color: '#7eb8f7' },
  kunColor: { color: '#f7a97e' },
  vocabSection: { marginTop: 8 },
  vocabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  vocabWord: { alignItems: 'center', minWidth: 64 },
  vocabWordText: { color: '#fff', fontSize: 20 },
  vocabMeaning: { flex: 1, color: '#ccc', fontSize: 14 },
  quizContainer: { width: '100%', alignItems: 'center' },
  soloWordNote: { color: '#e94560', fontSize: 13, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  quizWord: { fontSize: 64, color: '#fff', textAlign: 'center', marginVertical: 12 },
  quizMeaning: { color: '#aaa', fontSize: 14, marginBottom: 4 },
  quizPrompt: { color: '#888', fontSize: 14, marginBottom: 20 },
  quizCorrectReveal: { color: '#7eb8f7', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  choicesContainer: { width: '100%' },
  bottomRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginTop: 16,
  },
  skipBtn: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtnText: { color: '#555', fontSize: 14 },
  nextBtn: {
    width: '100%',
    backgroundColor: '#e94560',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  nextBtnFlex: { flex: 1, width: undefined },
  nextBtnDisabled: { backgroundColor: '#5a2030' },
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  enrollingText: { color: '#aaa', marginTop: 16 },
  doneTitle: { fontSize: 32, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  doneSubtitle: { color: '#aaa', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  btn: { backgroundColor: '#e94560', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
