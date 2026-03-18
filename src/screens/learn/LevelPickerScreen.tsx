import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {StackNavigationProp} from '@react-navigation/stack';
import {LearnStackParamList} from '../../types/navigation';
import {useKanjiGrouped} from '../../hooks/useKanjiData';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useVocabProgressQuery} from '../../queries/useVocabProgressQuery';
import {JLPT_LEVELS} from '../../utils/kanjiUtils';
import {useSettingsStore} from '../../stores/useSettingsStore';

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'LevelPicker'>;
};

const LEVEL_COLORS: Record<number, string> = {
  5: '#e94560',
  4: '#dd7e1b',
  3: '#8858b5',
  2: '#285393',
  1: '#0a7abf',
};

export default function LevelPickerScreen({navigation}: Props) {
  const insets = useSafeAreaInsets();
  const grouped = useKanjiGrouped();
  const {data: progress} = useProgressQuery();
  const {data: vocabProgress} = useVocabProgressQuery();
  const progressiveUnlock = useSettingsStore(s => s.progressiveUnlock);

  const enrolledIds = React.useMemo(
    () => new Set((progress ?? []).map(p => p.kanjiId)),
    [progress],
  );

  const progressByKanji = React.useMemo(() => {
    const map: Record<string, number> = {};
    (progress ?? []).forEach(p => {
      map[p.kanjiId] = p.srsLevel;
    });
    return map;
  }, [progress]);

  const pendingVocabByLevel = React.useMemo(() => {
    const map: Record<number, number> = {};
    for (const level of JLPT_LEVELS) {
      const levelKanjiIds = new Set((grouped[level] ?? []).map(k => k.id));
      map[level] = (vocabProgress ?? []).filter(
        p => p.srsLevel === -1 && levelKanjiIds.has(p.kanjiId),
      ).length;
    }
    return map;
  }, [vocabProgress, grouped]);

  const isLevelLocked = React.useCallback(
    (level: number): boolean => {
      if (!progressiveUnlock) return false;
      const idx = JLPT_LEVELS.indexOf(level as typeof JLPT_LEVELS[number]);
      if (idx <= 0) return false;
      const prevLevel = JLPT_LEVELS[idx - 1];
      const prevKanji = grouped[prevLevel] ?? [];
      return prevKanji.some(k => !enrolledIds.has(k.id));
    },
    [progressiveUnlock, grouped, enrolledIds],
  );

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <Text style={styles.header}>Choose a Level</Text>
      <ScrollView contentContainerStyle={styles.content}>
        {JLPT_LEVELS.map(level => {
          const kanji = grouped[level] ?? [];
          const learned = kanji.filter(k => progressByKanji[k.id] > 0).length;
          const remaining = kanji.filter(k => !enrolledIds.has(k.id)).length;
          const color = LEVEL_COLORS[level];
          const locked = isLevelLocked(level);
          const pendingVocab = pendingVocabByLevel[level] ?? 0;

          return (
            <View key={level} style={[styles.card, {borderLeftColor: locked ? '#333' : color}, locked && styles.cardLocked]}>

              {/* Level header */}
              <View style={styles.cardHeader}>
                <View>
                  <Text style={[styles.levelLabel, {color: locked ? '#555' : color}]}>N{level}</Text>
                  <Text style={styles.kanjiCount}>{kanji.length} kanji</Text>
                </View>
                {!locked && (
                  <View style={styles.progressBlock}>
                    <Text style={styles.progressText}>{learned}/{kanji.length} learned</Text>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${kanji.length > 0 ? (learned / kanji.length) * 100 : 0}%`,
                            backgroundColor: color,
                          },
                        ]}
                      />
                    </View>
                  </View>
                )}
                {locked && (
                  <Text style={styles.lockedText}>🔒 Complete N{level + 1} first</Text>
                )}
              </View>

              {/* Lesson rows */}
              {!locked && (
                <View style={styles.lessonRows}>
                  {/* Kanji row */}
                  <TouchableOpacity
                    style={[styles.lessonRow, remaining === 0 && styles.lessonRowDone]}
                    disabled={remaining === 0}
                    onPress={() => navigation.navigate('LearnSession', {jlptLevel: level})}>
                    <View style={styles.lessonIcon}>
                      <Text style={[styles.lessonIconText, {color: remaining > 0 ? color : '#444'}]}>字</Text>
                    </View>
                    <View style={styles.lessonInfo}>
                      <Text style={[styles.lessonTitle, remaining === 0 && styles.lessonTitleDone]}>Kanji Lessons</Text>
                      <Text style={styles.lessonSub}>
                        {remaining > 0 ? `${remaining} remaining` : 'All enrolled'}
                      </Text>
                    </View>
                    {remaining > 0 && (
                      <View style={[styles.badge, {backgroundColor: color}]}>
                        <Text style={styles.badgeText}>{remaining}</Text>
                      </View>
                    )}
                    {remaining === 0 && <Text style={styles.doneCheck}>✓</Text>}
                  </TouchableOpacity>

                  {/* Vocab row */}
                  <TouchableOpacity
                    style={[styles.lessonRow, styles.lessonRowLast, pendingVocab === 0 && styles.lessonRowDone]}
                    disabled={pendingVocab === 0}
                    onPress={() => navigation.navigate('VocabLearnSession', {jlptLevel: level})}>
                    <View style={styles.lessonIcon}>
                      <Text style={[styles.lessonIconText, {color: pendingVocab > 0 ? '#9b59b6' : '#444'}]}>語</Text>
                    </View>
                    <View style={styles.lessonInfo}>
                      <Text style={[styles.lessonTitle, pendingVocab === 0 && styles.lessonTitleDone]}>Vocab Lessons</Text>
                      <Text style={styles.lessonSub}>
                        {pendingVocab > 0 ? `${pendingVocab} pending` : 'Nothing pending'}
                      </Text>
                    </View>
                    {pendingVocab > 0 && (
                      <View style={[styles.badge, {backgroundColor: '#9b59b6'}]}>
                        <Text style={styles.badgeText}>{pendingVocab}</Text>
                      </View>
                    )}
                    {pendingVocab === 0 && <Text style={styles.doneCheck}>✓</Text>}
                  </TouchableOpacity>
                </View>
              )}

              {/* Browse link */}
              <TouchableOpacity
                style={styles.browseLink}
                disabled={locked}
                onPress={() => navigation.navigate('KanjiList', {jlptLevel: level})}>
                <Text style={[styles.browseLinkText, locked && styles.browseLinkLocked]}>Browse all kanji</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  header: {fontSize: 28, color: '#fff', fontWeight: 'bold', paddingHorizontal: 20, paddingVertical: 16},
  content: {paddingHorizontal: 20, paddingBottom: 20},
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    overflow: 'hidden',
  },
  cardLocked: {opacity: 0.55},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingBottom: 16,
  },
  levelLabel: {fontSize: 32, fontWeight: 'bold'},
  kanjiCount: {color: '#aaa', marginTop: 2, fontSize: 13},
  progressBlock: {flex: 1, marginLeft: 16},
  progressText: {color: '#aaa', fontSize: 12, marginBottom: 6, textAlign: 'right'},
  progressBar: {width: '100%', height: 5, backgroundColor: '#0f0f1a', borderRadius: 3},
  progressFill: {height: 5, borderRadius: 3},
  lockedText: {color: '#555', fontSize: 13},
  lessonRows: {
    marginHorizontal: 12,
    marginBottom: 4,
    borderRadius: 8,
    backgroundColor: '#0f0f1a',
    overflow: 'hidden',
  },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  lessonRowLast: {borderBottomWidth: 0},
  lessonRowDone: {opacity: 0.45},
  lessonIcon: {width: 36, alignItems: 'center'},
  lessonIconText: {fontSize: 22, fontWeight: 'bold'},
  lessonInfo: {flex: 1, marginLeft: 10},
  lessonTitle: {color: '#fff', fontSize: 14, fontWeight: '600'},
  lessonTitleDone: {color: '#555'},
  lessonSub: {color: '#666', fontSize: 12, marginTop: 2},
  badge: {borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, minWidth: 28, alignItems: 'center'},
  badgeText: {color: '#fff', fontSize: 12, fontWeight: 'bold'},
  doneCheck: {color: '#444', fontSize: 16},
  browseLink: {paddingHorizontal: 20, paddingVertical: 12},
  browseLinkText: {color: '#555', fontSize: 13},
  browseLinkLocked: {color: '#333'},
});
