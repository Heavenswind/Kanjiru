import React from 'react';
import {View, Text, StyleSheet} from 'react-native';

interface Props {
  current: number;
  total: number;
}

export default function ProgressBar({current, total}: Props) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View style={[styles.fill, {width: `${pct}%`}]} />
      </View>
      <Text style={styles.label}>{current}/{total}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10},
  track: {flex: 1, height: 6, backgroundColor: '#333', borderRadius: 3},
  fill: {height: 6, backgroundColor: '#e94560', borderRadius: 3},
  label: {color: '#aaa', fontSize: 12, minWidth: 40, textAlign: 'right'},
});
