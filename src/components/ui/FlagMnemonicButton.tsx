import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useFlaggedMnemonicsStore } from '../../stores/useFlaggedMnemonicsStore';

type Props = {
  itemKey: string;   // kanji character or vocab word
  field: 'meaning' | 'reading';
};

export default function FlagMnemonicButton({ itemKey, field }: Props) {
  const isFlagged = useFlaggedMnemonicsStore(s =>
    field === 'meaning' ? s.isMeaningFlagged(itemKey) : s.isReadingFlagged(itemKey),
  );
  const toggle = useFlaggedMnemonicsStore(s =>
    field === 'meaning' ? s.toggleMeaning : s.toggleReading,
  );

  return (
    <TouchableOpacity
      style={[styles.btn, isFlagged && styles.btnFlagged]}
      onPress={() => toggle(itemKey)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={[styles.icon, isFlagged && styles.iconFlagged]}>
        {isFlagged ? '⚑' : '⚐'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginLeft: 8,
    padding: 4,
    borderRadius: 6,
  },
  btnFlagged: {
    backgroundColor: '#3a1a10',
  },
  icon: {
    fontSize: 16,
    color: '#555',
  },
  iconFlagged: {
    color: '#e94560',
  },
});
