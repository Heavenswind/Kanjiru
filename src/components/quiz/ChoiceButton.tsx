import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

type State = 'idle' | 'correct' | 'wrong';

interface Props {
  label: string;
  state: State;
  onPress: () => void;
  disabled?: boolean;
}

export default function ChoiceButton({ label, state, onPress, disabled }: Props) {
  const bgColor =
    state === 'correct' ? '#2e7d32' : state === 'wrong' ? '#c62828' : '#16213e';
  const borderColor =
    state === 'correct' ? '#4caf50' : state === 'wrong' ? '#ef5350' : '#333';

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: bgColor, borderColor }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    padding: 11,
    marginVertical: 4,
    borderWidth: 1,
    alignItems: 'center',
  },
  label: { color: '#fff', fontSize: 17, fontWeight: '500' },
});
