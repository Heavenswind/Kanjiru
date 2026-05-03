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
import { VOCAB_PROGRESS_QUERY_KEY } from '../../queries/useVocabProgressQuery';
import { formatReading, uuid } from '../../utils/kanjiUtils';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVocabForKanjiByLevel, useVocabData } from '../../hooks/useVocabData';
import { useMnemonicForKanji } from '../../hooks/useMnemonicsData';
import { ColoredReading, ColoredWord } from '../../components/ui/ColoredReading';
import ChoiceButton from '../../components/quiz/ChoiceButton';
import FlagMnemonicButton from '../../components/ui/FlagMnemonicButton';
import radicalKanjiData from '../../data/radicalKanji.json';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { KanjiEntry, KanjiProgress, VocabProgress } from '../../types/kanji';

const radicalKanji = radicalKanjiData as Record<string, string>;

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

type Phase = 'intro' | 'examples' | 'quiz' | 'enrolling' | 'done';

export default function LearnSessionScreen({ navigation, route }: Props) {
  const { jlptLevel } = route.params;
  const insets = useSafeAreaInsets();
  const grouped = useKanjiGrouped();
  const { data: progress } = useProgressQuery();
  const session = useAuthStore(s => s.session);
  const queryClient = useQueryClient();

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro' as Phase);
  const [pendingVocabCount, setPendingVocabCount] = useState(0);
  const [answerState, setAnswerState] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [selected, setSelected] = useState<string | null>(null);

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
  const levelKanjiIds = React.useMemo(
    () => new Set((grouped[jlptLevel] ?? []).map(k => k.id)),
    [grouped, jlptLevel],
  );
  const exampleVocab = useVocabForKanjiByLevel(current?.character ?? '', levelKanjiIds);
  const mnemonic = useMnemonicForKanji(current?.character ?? '');

  // Pre-build quiz choices for all kanji in the batch
  const allChoicesRef = useRef<string[][] | null>(null);
  if (batch.length > 0 && allChoicesRef.current === null) {
    const allMeanings = Object.values(grouped).flat().map(k => k.meanings[0]);
    allChoicesRef.current = batch.map(k => {
      const distractors = shuffle(
        [...new Set(allMeanings.filter(m => m && m !== k.meanings[0]))]
      ).slice(0, 3);
      return shuffle([k.meanings[0], ...distractors]);
    });
  }

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
      if (index >= next.length) setIndex(Math.max(0, next.length - 1));
      return next;
    });
  }, [index, batch, session, jlptLevel, queryClient]);

  const enroll = useCallback(async () => {
    setPhase('enrolling');
    try {
      const userId = session!.user.id;
      const newProgress = batch.map(k => ({
        id: uuid(),
        ...buildNewProgress(userId, k.id, jlptLevel),
      }));
      await upsertLocalBatch(newProgress);
      queryClient.setQueryData<KanjiProgress[]>(
        [PROGRESS_QUERY_KEY, userId],
        old => [...(old ?? []), ...newProgress],
      );

      const batchIds = new Set(batch.map(k => k.id));
      const allEnrolled = new Set([...enrolledIds, ...batchIds]);
      const allKanjiKnown = (word: string) =>
        [...word].filter(c => c >= '\u4e00' && c <= '\u9fff').every(c => allEnrolled.has(c));

      const vocabItems: VocabProgress[] = batch.flatMap(k => {
        const words = allVocab[k.character] ?? [];
        return words
          .filter(v => allKanjiKnown(v.word))
          .map(v => ({
            id: uuid(), userId,
            vocabWord: v.word, kanjiId: k.id,
            srsLevel: -1, repetitions: 0, easeFactor: 2.5,
            intervalDays: 0, nextReview: new Date(),
            lastReview: null, learnedAt: null,
          }));
      });
      if (vocabItems.length > 0) {
        await upsertVocabProgressBatch(vocabItems);
        queryClient.setQueryData<VocabProgress[]>(
          [VOCAB_PROGRESS_QUERY_KEY, userId],
          old => {
            const map = new Map((old ?? []).map(p => [p.vocabWord, p]));
            for (const v of vocabItems) map.set(v.vocabWord, v);
            return [...map.values()];
          },
        );
        setPendingVocabCount(vocabItems.length);
        Promise.all(vocabItems.map(v => upsertVocabRemote(v))).catch(() => { });
      }

      setPhase('done');
      Promise.all(newProgress.map(p => upsertRemote(p)))
        .then(() => queryClient.invalidateQueries({ queryKey: [PROGRESS_QUERY_KEY] }))
        .catch(() => { });
    } catch (e) {
      console.error('[Enroll] error', e);
      setPhase('done');
    }
  }, [batch, session, jlptLevel, queryClient, enrolledIds, allVocab]);

  const handleNext = useCallback(() => {
    if (phase === 'intro') {
      setPhase('examples');
    } else if (phase === 'examples') {
      if (isLast) {
        setIndex(0);
        setPhase('quiz');
        setAnswerState('idle');
        setSelected(null);
      } else {
        setIndex(i => i + 1);
        setPhase('intro');
      }
    } else if (phase === 'quiz') {
      if (isLast) {
        enroll();
      } else {
        setIndex(i => i + 1);
        setAnswerState('idle');
        setSelected(null);
      }
    }
  }, [isLast, phase, enroll]);

  const handleQuizChoice = useCallback((choice: string) => {
    if (answerState !== 'idle') return;
    setSelected(choice);
    setAnswerState(choice === current?.meanings[0] ? 'correct' : 'wrong');
  }, [answerState, current]);

  // ── Empty / loading states ─────────────────────────────────────────────────

  if (batch.length === 0) {
    return (
      <View style={[styles.container, {paddingTop: insets.top + 16}]}>
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
      <View style={[styles.container, {paddingTop: insets.top + 16}]}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.enrollingText}>Adding to your reviews…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={[styles.container, {paddingTop: insets.top + 16}]}>
        <Text style={styles.doneTitle}>Nice work!</Text>
        <Text style={styles.doneSubtitle}>
          {batch.length} N{jlptLevel} kanji added to your reviews.{'\n'}
          Head to the Review tab to practice them.
        </Text>
        {pendingVocabCount > 0 && (
          <TouchableOpacity
            style={[styles.btn, styles.vocabBtn]}
            onPress={() => navigation.replace('VocabLearnSession', { jlptLevel })}>
            <Text style={styles.btnText}>Learn {pendingVocabCount} vocab words →</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>{pendingVocabCount > 0 ? 'Skip for now' : 'Done'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalSteps = batch.length * 3;
  const currentStep =
    phase === 'intro'    ? index * 3 + 1 :
    phase === 'examples' ? index * 3 + 2 :
                           batch.length * 2 + index + 1;
  const stepLabel = phase === 'intro' ? 'Kanji' : phase === 'examples' ? 'Examples' : 'Quiz';
  const choices = allChoicesRef.current?.[index] ?? [];

  return (
    <View style={[styles.container, {paddingTop: insets.top + 16}]}>
      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.progressHeader}>
          {phase === 'intro' && index > 0 ? (
            <TouchableOpacity onPress={() => { setIndex(i => i - 1); }}>
              <Text style={styles.backText}>‹ Prev</Text>
            </TouchableOpacity>
          ) : phase === 'examples' ? (
            <TouchableOpacity onPress={() => setPhase('intro')}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <View style={styles.progressCenter}>
            <Text style={styles.progressText}>{currentStep} / {totalSteps}</Text>
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
          <View style={[styles.progressFill, { width: `${(currentStep / totalSteps) * 100}%` }]} />
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Intro ── */}
        {phase === 'intro' && (
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
              <View style={styles.mnemonicRow}>
                <MnemonicText text={mnemonic.meaning} style={[styles.mnemonicText, styles.mnemonicFlex]} />
                <FlagMnemonicButton itemKey={current.character} field="meaning" />
              </View>
            ) : null}

            <View style={styles.details}>
              {current.readings_on.length > 0 && (
                <View style={styles.readingSection}>
                  <View style={styles.inlineReadingRow}>
                    <Text style={styles.inlineReadingLabel}>ON</Text>
                    <View style={styles.pillRow}>
                      {current.readings_on.map((r, i) => (
                        <View key={i} style={styles.pill}>
                          <Text style={styles.pillText}>{r}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {mnemonic?.onyomi && mnemonic.onyomi.length > (current.readings_on[0]?.length ?? 0) ? (
                    <View style={styles.mnemonicRow}>
                      <MnemonicText text={mnemonic.onyomi} style={[styles.readingMnemonic, styles.mnemonicFlex]} />
                      <FlagMnemonicButton itemKey={current.character} field="reading" />
                    </View>
                  ) : null}
                </View>
              )}

              {current.readings_kun.length > 0 && (
                <View style={styles.readingSection}>
                  <View style={styles.inlineReadingRow}>
                    <Text style={[styles.inlineReadingLabel, styles.kunLabel]}>KUN</Text>
                    <View style={styles.pillRow}>
                      {[...new Set(current.readings_kun.map(r => formatReading(r)).filter(r => r.length > 0))]
                        .map((r, i) => (
                          <View key={i} style={[styles.pill, styles.kunPill]}>
                            <Text style={styles.pillText}>{r}</Text>
                          </View>
                        ))}
                    </View>
                  </View>
                  {mnemonic?.kunyomi && mnemonic.kunyomi.length > (current.readings_kun[0]?.length ?? 0) ? (
                    <View style={styles.mnemonicRow}>
                      <MnemonicText text={mnemonic.kunyomi} style={[styles.readingMnemonic, styles.mnemonicFlex]} />
                      <FlagMnemonicButton itemKey={current.character} field="reading" />
                    </View>
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

        {/* ── Examples ── */}
        {phase === 'examples' && (
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

        {/* ── Quiz ── */}
        {phase === 'quiz' && (
          <View style={styles.quizContainer}>
            <Text style={styles.readingLabel}>What does this mean?</Text>
            <Text style={styles.quizCharacter}>{current.character}</Text>

            {answerState === 'wrong' && (
              <Text style={styles.quizCorrectReveal}>
                Correct: {current.meanings[0]}
              </Text>
            )}

            <View style={styles.choicesContainer}>
              {choices.map((choice, i) => {
                let state: 'idle' | 'correct' | 'wrong' = 'idle';
                if (answerState !== 'idle') {
                  if (choice === current.meanings[0]) state = 'correct';
                  else if (choice === selected) state = 'wrong';
                }
                return (
                  <ChoiceButton
                    key={i}
                    label={choice}
                    state={state}
                    onPress={() => handleQuizChoice(choice)}
                    disabled={answerState !== 'idle'}
                  />
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom buttons */}
      <View style={styles.bottomRow}>
        {phase === 'intro' && batch.length > 1 && !isLast && (
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.nextBtn,
            phase === 'intro' && batch.length > 1 && !isLast && styles.nextBtnFlex,
            phase === 'quiz' && answerState === 'idle' && styles.nextBtnDisabled,
          ]}
          disabled={phase === 'quiz' && answerState === 'idle'}
          onPress={handleNext}>
          <Text style={styles.nextBtnText}>
            {phase === 'intro'
              ? 'See examples →'
              : phase === 'examples'
              ? isLast ? 'Quiz me →' : 'Next kanji →'
              : answerState === 'idle' ? 'Pick an answer'
              : isLast ? `Add ${batch.length} kanji to reviews` : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center', justifyContent: 'center' },
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
  scroll: { flex: 1, width: '100%' },
  content: { alignItems: 'center', paddingBottom: 24, flexGrow: 1, alignSelf: 'stretch' },
  characterBox: { alignItems: 'center', marginBottom: 16 },
  character: { fontSize: 120, color: '#fff' },
  levelBadge: { color: '#e94560', fontWeight: 'bold', fontSize: 13, marginTop: 4 },
  meaning: { fontSize: 28, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  mnemonicText: { color: '#aaa', fontSize: 14, textAlign: 'center', fontStyle: 'italic', marginBottom: 20, lineHeight: 20, paddingHorizontal: 8 },
  details: { width: '100%', marginTop: 8 },
  readingSection: { marginBottom: 12 },
  inlineReadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineReadingLabel: { color: '#285393', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, width: 34 },
  kunLabel: { color: '#8858b5' },
  readingLabel: { color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: '#16213e', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#285393' },
  kunPill: { borderColor: '#8858b5' },
  pillText: { color: '#fff', fontSize: 16 },
  readingMnemonic: { color: '#888', fontSize: 13, fontStyle: 'italic', marginTop: 8, lineHeight: 18 },
  mnemonicRow: { flexDirection: 'row', alignItems: 'flex-start', width: '100%' },
  mnemonicFlex: { flex: 1 },
  altMeanings: { color: '#aaa', marginTop: 8, marginBottom: 4, textAlign: 'center', fontSize: 13 },
  radicalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radicalPill: { backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', minWidth: 52 },
  radicalSymbol: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  radicalName: { color: '#aaa', fontSize: 11, marginTop: 2 },
  examplesHint: { color: '#666', fontSize: 12, marginBottom: 12 },
  vocabRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8, gap: 12 },
  vocabWord: { alignItems: 'center', minWidth: 64 },
  vocabWordText: { color: '#fff', fontSize: 20 },
  vocabMeaning: { flex: 1, color: '#ccc', fontSize: 14 },
  quizContainer: { width: '100%', alignItems: 'center' },
  quizCharacter: { fontSize: 96, color: '#fff', textAlign: 'center', marginVertical: 16 },
  quizCorrectReveal: { color: '#7eb8f7', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  choicesContainer: { width: '100%' },
  bottomRow: { flexDirection: 'row', width: '100%', gap: 10, marginTop: 16 },
  skipBtn: { borderWidth: 1, borderColor: '#444', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  skipBtnText: { color: '#555', fontSize: 14 },
  nextBtn: { width: '100%', backgroundColor: '#e94560', padding: 18, borderRadius: 12, alignItems: 'center' },
  nextBtnFlex: { flex: 1, width: undefined },
  nextBtnDisabled: { backgroundColor: '#5a2030' },
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  enrollingText: { color: '#aaa', marginTop: 16 },
  doneTitle: { fontSize: 32, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  doneSubtitle: { color: '#aaa', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  btn: { backgroundColor: '#e94560', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12 },
  vocabBtn: { backgroundColor: '#9b59b6', marginBottom: 12 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
