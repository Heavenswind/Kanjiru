import React, {useMemo} from 'react';
import {View, Text, ScrollView, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useKanjiData} from '../../hooks/useKanjiData';
import {JLPT_LEVELS, getSrsLabel, SRS_LEVEL_COLORS} from '../../utils/kanjiUtils';

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const allKanji = useKanjiData();
  const {data: progress} = useProgressQuery();

  const stats = useMemo(() => {
    const map: Record<string, number> = {};
    (progress ?? []).forEach(p => { map[p.kanjiId] = p.srsLevel; });

    return JLPT_LEVELS.map(level => {
      const kanji = allKanji.filter(k => k.jlptLevel === level);
      const learned = kanji.filter(k => (map[k.id] ?? 0) > 0);
      const byStage = [0, 1, 2, 3, 4, 5, 6, 7].map(stage => ({
        stage,
        count: kanji.filter(k => (map[k.id] ?? 0) === stage).length,
        color: SRS_LEVEL_COLORS[stage],
      }));
      return {level, total: kanji.length, learned: learned.length, byStage};
    });
  }, [progress, allKanji]);

  const totalLearned = useMemo(
    () => (progress ?? []).filter(p => p.srsLevel > 0).length,
    [progress],
  );

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <Text style={styles.header}>Progress</Text>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.totalCard}>
          <Text style={styles.totalValue}>{totalLearned}</Text>
          <Text style={styles.totalLabel}>Total Kanji Learned</Text>
        </View>

        {stats.map(({level, total, learned, byStage}) => (
          <View key={level} style={styles.levelCard}>
            <View style={styles.levelHeader}>
              <Text style={styles.levelTitle}>N{level}</Text>
              <Text style={styles.levelProgress}>{learned}/{total}</Text>
            </View>

            <View style={styles.distributionBar}>
              {byStage.filter(s => s.count > 0 && s.stage > 0).map(({stage, count, color}) => (
                <View
                  key={stage}
                  style={[styles.distributionSegment, {flex: count, backgroundColor: color}]}
                />
              ))}
              {(() => {
                const enrolled = byStage.filter(s => s.stage > 0).reduce((acc, s) => acc + s.count, 0);
                const remaining = total - enrolled;
                return remaining > 0 ? (
                  <View style={[styles.distributionSegment, {flex: remaining, backgroundColor: 'transparent'}]} />
                ) : null;
              })()}
            </View>

            <View style={styles.legend}>
              {byStage.filter(s => s.count > 0).map(({stage, count, color}) => (
                <View key={stage} style={styles.legendItem}>
                  <View style={[styles.legendDot, {backgroundColor: color}]} />
                  <Text style={styles.legendText}>
                    {getSrsLabel(stage)}: {count}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  header: {fontSize: 28, color: '#fff', fontWeight: 'bold', paddingHorizontal: 20, paddingVertical: 16},
  content: {paddingHorizontal: 20, paddingBottom: 20},
  totalCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
  },
  totalValue: {fontSize: 64, color: '#e94560', fontWeight: 'bold'},
  totalLabel: {color: '#aaa'},
  levelCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  levelHeader: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12},
  levelTitle: {color: '#fff', fontSize: 20, fontWeight: 'bold'},
  levelProgress: {color: '#aaa'},
  distributionBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#333',
    marginBottom: 12,
  },
  distributionSegment: {height: 12},
  legend: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 4},
  legendDot: {width: 8, height: 8, borderRadius: 4},
  legendText: {color: '#888', fontSize: 12},
});
