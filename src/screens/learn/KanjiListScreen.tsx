import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RouteProp} from '@react-navigation/native';
import {LearnStackParamList} from '../../types/navigation';
import {useKanjiByLevel} from '../../hooks/useKanjiData';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {SRS_LEVEL_COLORS, getSrsLabel} from '../../utils/kanjiUtils';

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'KanjiList'>;
  route: RouteProp<LearnStackParamList, 'KanjiList'>;
};

export default function KanjiListScreen({navigation, route}: Props) {
  const {jlptLevel} = route.params;
  const kanji = useKanjiByLevel(jlptLevel);
  const {data: progress} = useProgressQuery();

  const progressByKanji = React.useMemo(() => {
    const map: Record<string, number> = {};
    (progress ?? []).forEach(p => {
      map[p.kanjiId] = p.srsLevel;
    });
    return map;
  }, [progress]);

  return (
    <FlatList
      style={styles.container}
      data={kanji}
      numColumns={5}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.grid}
      renderItem={({item}) => {
        const srsLevel = progressByKanji[item.id] ?? 0;
        const color = SRS_LEVEL_COLORS[srsLevel];
        return (
          <TouchableOpacity
            style={[styles.cell, {borderColor: color}]}
            onPress={() =>
              navigation.navigate('KanjiDetail', {
                kanjiId: item.id,
                jlptLevel,
              })
            }>
            <Text style={styles.kanjiChar}>{item.character}</Text>
            {srsLevel > 0 && (
              <View style={[styles.dot, {backgroundColor: color}]} />
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  grid: {padding: 8},
  cell: {
    flex: 1,
    aspectRatio: 1,
    margin: 4,
    backgroundColor: '#16213e',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  kanjiChar: {fontSize: 24, color: '#fff'},
  dot: {width: 6, height: 6, borderRadius: 3, marginTop: 4},
});
