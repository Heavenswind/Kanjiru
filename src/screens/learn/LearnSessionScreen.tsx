import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RouteProp} from '@react-navigation/native';
import {LearnStackParamList} from '../../types/navigation';
import {useKanjiGrouped} from '../../hooks/useKanjiData';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useAuthStore} from '../../stores/useAuthStore';
import {buildNewProgress} from '../../engine/srs/scheduler';
import {upsertProgressBatch as upsertLocalBatch, upsertVocabProgressBatch} from '../../services/database/queries';
import {upsertProgress as upsertRemote, upsertVocabProgress as upsertVocabRemote} from '../../services/supabase/progress';
import {useQueryClient} from '@tanstack/react-query';
import {PROGRESS_QUERY_KEY} from '../../queries/useProgressQuery';
import {formatReading, uuid} from '../../utils/kanjiUtils';
import {useSettingsStore} from '../../stores/useSettingsStore';
import {useVocabForKanji} from '../../hooks/useVocabData';
import {useMnemonicForKanji} from '../../hooks/useMnemonicsData';
import type {KanjiEntry, VocabProgress} from '../../types/kanji';

// Splits text into spans so CJK characters aren't rendered in italic (Android italic fonts lack CJK glyphs → □)
function MnemonicText({text, style}: {text: string; style: any}) {
  const parts = text.split(/([^\u0000-\u007F\u0020-\u007E]+)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /[\u4e00-\u9fff\u3040-\u30ff]/.test(part)
          ? <Text key={i} style={{fontStyle: 'normal'}}>{part}</Text>
          : part
      )}
    </Text>
  );
}

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'LearnSession'>;
  route: RouteProp<LearnStackParamList, 'LearnSession'>;
};

type Phase = 'loading' | 'studying' | 'enrolling' | 'done' | 'empty';

export default function LearnSessionScreen({navigation, route}: Props) {
  const {jlptLevel} = route.params;
  const grouped = useKanjiGrouped();
  const {data: progress} = useProgressQuery();
  const session = useAuthStore(s => s.session);
  const queryClient = useQueryClient();
  const lessonsPerSession = useSettingsStore(s => s.lessonsPerSession);
  const autoShowReadings = useSettingsStore(s => s.autoShowReadings);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('studying');
  const [showDetails, setShowDetails] = useState(autoShowReadings);

  useEffect(() => {
    setShowDetails(autoShowReadings);
  }, [index, autoShowReadings]);

  const enrolledIds = React.useMemo(
    () => new Set((progress ?? []).map(p => p.kanjiId)),
    [progress],
  );

  const initialBatch = React.useMemo<KanjiEntry[]>(() => {
    const levelKanji = grouped[jlptLevel] ?? [];
    return levelKanji
      .filter(k => !enrolledIds.has(k.id))
      .slice(0, lessonsPerSession);
  }, [grouped, jlptLevel, enrolledIds, lessonsPerSession]);

  const [batch, setBatch] = useState<KanjiEntry[]>([]);
  useEffect(() => { setBatch(initialBatch); }, [initialBatch]);

  const current = batch[index];
  const isLast = index === batch.length - 1;

  const handleSkip = useCallback(() => {
    setBatch(b => {
      const next = b.filter((_, i) => i !== index);
      // If we removed the last item, step index back
      if (index >= next.length) setIndex(Math.max(0, next.length - 1));
      return next;
    });
  }, [index]);

  const vocab = useVocabForKanji(current?.character ?? '');
  const mnemonic = useMnemonicForKanji(current?.character ?? '');

  const handleNext = useCallback(async () => {
    if (isLast) {
      setPhase('enrolling');
      try {
        console.log('[Enroll] session:', session?.user.id ?? 'NULL');
        const userId = session!.user.id;
        const newProgress = batch.map(k => ({
          id: uuid(),
          ...buildNewProgress(userId, k.id, jlptLevel),
        }));
        console.log('[Enroll] starting upsertLocalBatch', newProgress.length);
        await upsertLocalBatch(newProgress);
        console.log('[Enroll] upsertLocalBatch done');

        // Enroll vocab words — only words whose kanji are all enrolled
        const allVocab = (await import('../../data/vocab.json')).default as Record<string, {word: string; reading: string; meaning: string}[]>;
        // Build the full set of enrolled kanji after this batch
        const batchIds = new Set(batch.map(k => k.id));
        const allEnrolled = new Set([...enrolledIds, ...batchIds]);
        // Helper: does every CJK character in the word have enrolled progress?
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
          console.log('[Enroll] vocab enrolled:', vocabItems.length);
          Promise.all(vocabItems.map(v => upsertVocabRemote(v))).catch(() => {});
        }

        queryClient.invalidateQueries({queryKey: [PROGRESS_QUERY_KEY]});
        console.log('[Enroll] invalidated, setting done');
        setPhase('done');
        Promise.all(newProgress.map(p => upsertRemote(p))).catch(() => {});
      } catch (e) {
        console.error('[Enroll] error', e);
        setPhase('done');
      }
    } else {
      setIndex(i => i + 1);
    }
  }, [isLast, batch, session, jlptLevel, queryClient]);

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

  return (
    <View style={styles.container}>
      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.progressHeader}>
          {index > 0 ? (
            <TouchableOpacity onPress={() => { setIndex(i => i - 1); }}>
              <Text style={styles.backText}>‹ Prev</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <Text style={styles.progressText}>{index + 1} / {batch.length}</Text>
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Leave Session', 'Leave without enrolling these kanji?', [
                {text: 'Stay', style: 'cancel'},
                {text: 'Leave', style: 'destructive', onPress: () => navigation.goBack()},
              ])
            }>
            <Text style={styles.exitText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, {width: `${((index + 1) / batch.length) * 100}%`}]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Kanji character */}
        <View style={styles.characterBox}>
          <Text style={styles.character}>{current.character}</Text>
          <Text style={styles.levelBadge}>N{jlptLevel}</Text>
        </View>

        {/* Primary meaning — always shown */}
        <Text style={styles.meaning}>{current.meanings[0]}</Text>

        {/* Meaning mnemonic — always shown if available */}
        {mnemonic?.meaning ? (
          <MnemonicText text={mnemonic.meaning} style={styles.mnemonicText} />
        ) : null}

        {/* Tap to reveal readings */}
        {!showDetails ? (
          <TouchableOpacity style={styles.revealBtn} onPress={() => setShowDetails(true)}>
            <Text style={styles.revealText}>Show readings & examples</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.details}>
            {current.readings_on.length > 0 && (
              <View style={styles.readingSection}>
                <Text style={styles.readingLabel}>On-yomi</Text>
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
                <Text style={styles.readingLabel}>Kun-yomi</Text>
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
            {current.meanings.length > 1 && (
              <Text style={styles.altMeanings}>
                Also: {current.meanings.slice(1).join(', ')}
              </Text>
            )}

            {/* Vocab examples */}
            {vocab.length > 0 && (
              <View style={styles.vocabSection}>
                <Text style={styles.readingLabel}>Examples</Text>
                {vocab.map((v, i) => (
                  <View key={i} style={styles.vocabRow}>
                    <View style={styles.vocabWord}>
                      <Text style={styles.vocabWordText}>{v.word}</Text>
                      <Text style={styles.vocabReading}>{v.reading}</Text>
                    </View>
                    <Text style={styles.vocabMeaning}>{v.meaning}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomRow}>
        {batch.length > 1 && !isLast && (
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.nextBtn, batch.length > 1 && !isLast && styles.nextBtnFlex]} onPress={handleNext}>
          <Text style={styles.nextBtnText}>
            {isLast ? `Add ${batch.length} kanji to reviews` : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e', padding: 24, alignItems: 'center', justifyContent: 'center'},
  progressRow: {width: '100%', marginBottom: 24},
  progressHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6},
  progressText: {color: '#888', fontSize: 13},
  backText: {color: '#888', fontSize: 13},
  exitText: {color: '#888', fontSize: 18},
  headerSpacer: {width: 40},
  progressBar: {width: '100%', height: 4, backgroundColor: '#333', borderRadius: 2},
  progressFill: {height: 4, backgroundColor: '#e94560', borderRadius: 2},
  content: {alignItems: 'center', paddingBottom: 24, flexGrow: 1, alignSelf: 'stretch'},
  characterBox: {alignItems: 'center', marginBottom: 16},
  character: {fontSize: 120, color: '#fff'},
  levelBadge: {color: '#e94560', fontWeight: 'bold', fontSize: 13, marginTop: 4},
  meaning: {fontSize: 28, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 8},
  mnemonicText: {color: '#aaa', fontSize: 14, textAlign: 'center', fontStyle: 'italic', marginBottom: 20, lineHeight: 20, paddingHorizontal: 8},
  revealBtn: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 8,
  },
  revealText: {color: '#888', fontSize: 15},
  details: {width: '100%', marginTop: 8},
  readingSection: {marginBottom: 16},
  readingLabel: {color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8},
  pillRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  pill: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#285393',
  },
  kunPill: {borderColor: '#8858b5'},
  pillText: {color: '#fff', fontSize: 16},
  readingMnemonic: {color: '#888', fontSize: 13, fontStyle: 'italic', marginTop: 8, lineHeight: 18},
  altMeanings: {color: '#aaa', marginTop: 8, textAlign: 'center'},
  vocabSection: {marginTop: 8},
  vocabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  vocabWord: {alignItems: 'center', minWidth: 64},
  vocabWordText: {color: '#fff', fontSize: 20},
  vocabReading: {color: '#888', fontSize: 12, marginTop: 2},
  vocabMeaning: {flex: 1, color: '#ccc', fontSize: 14},
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
  skipBtnText: {color: '#555', fontSize: 14},
  nextBtn: {
    width: '100%',
    backgroundColor: '#e94560',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  nextBtnFlex: {flex: 1, width: undefined},
  nextBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
  enrollingText: {color: '#aaa', marginTop: 16},
  doneTitle: {fontSize: 32, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 12},
  doneSubtitle: {color: '#aaa', textAlign: 'center', marginBottom: 32, lineHeight: 22},
  btn: {backgroundColor: '#e94560', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12},
  btnText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
});
