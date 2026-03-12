import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { ReviewStackParamList } from '../../types/navigation';
import { useReviewStore } from '../../stores/useReviewStore';
import { useGradeCard } from '../../queries/useGradeCard';
import { useProgressQuery } from '../../queries/useProgressQuery';
import { useSessionLog } from '../../queries/useSessionLog';
import { generateChoices } from '../../engine/srs/distractors';
import { useKanjiData } from '../../hooks/useKanjiData';
import SwipeableCard, { SwipeableCardRef } from '../../components/cards/SwipeableCard';
import ChoiceButton from '../../components/quiz/ChoiceButton';
import ProgressBar from '../../components/quiz/ProgressBar';
import { QuestionType } from '../../types/review';
import { useSettingsStore } from '../../stores/useSettingsStore';

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewSession'>;
  route: RouteProp<ReviewStackParamList, 'ReviewSession'>;
};

type AnswerState = 'idle' | 'correct' | 'wrong';

export default function ReviewSessionScreen({ navigation, route }: Props) {
  const practiceMode = route.params?.practiceMode ?? false;
  const insets = useSafeAreaInsets();
  const allKanji = useKanjiData();
  const { data: progress } = useProgressQuery();
  const { mutate: gradeCard } = useGradeCard();
  const { mutate: logSession } = useSessionLog();
  const {
    queue,
    currentIndex,
    deferred,
    answers,
    sessionStartedAt,
    answerCurrent,
    deferCurrent,
    advance,
    resetSession,
  } = useReviewStore();

  const cardRef = useRef<SwipeableCardRef>(null);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [questionType, setQuestionType] = useState<QuestionType>('meaning');

  const autoAdvanceOnCorrect = useSettingsStore(s => s.autoAdvanceOnCorrect);

  const current = queue[currentIndex];
  const isSessionDone = currentIndex >= queue.length;

  // Auto-advance on correct (when setting is enabled)
  useEffect(() => {
    if (answerState !== 'correct' || !autoAdvanceOnCorrect) return;
    const t = setTimeout(() => handleNext(), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerState, autoAdvanceOnCorrect]);

  // Cycle: meaning → onyomi → kunyomi, skipping if no readings available
  useEffect(() => {
    if (!current) return;
    const cycle = currentIndex % 3;
    if (cycle === 0) {
      setQuestionType('meaning');
    } else if (cycle === 1) {
      setQuestionType(current.readings_on.length > 0 ? 'onyomi' : 'meaning');
    } else {
      setQuestionType(current.readings_kun.length > 0 ? 'kunyomi' : 'meaning');
    }
    setAnswerState('idle');
    setSelectedChoice(null);
    cardRef.current?.reset();
  }, [currentIndex, current]);

  const { correctAnswer, choices } = useMemo(() => {
    if (!current) return { correctAnswer: '', choices: [] };
    const pool = allKanji.filter(k => k.jlptLevel === current.jlptLevel);
    return generateChoices(current, pool, questionType);
  }, [current, questionType, allKanji]);

  const progressByKanji = useMemo(() => {
    const map: Record<string, any> = {};
    (progress ?? []).forEach(p => { map[p.kanjiId] = p; });
    return map;
  }, [progress]);

  function handleChoice(choice: string) {
    if (answerState !== 'idle') return;
    const correct = choice === correctAnswer;
    setSelectedChoice(choice);
    setAnswerState(correct ? 'correct' : 'wrong');
    answerCurrent(correct, questionType);

    // Grade via SRS (skip in practice mode)
    if (current && !practiceMode) {
      gradeCard({
        kanjiId: current.id,
        jlptLevel: current.jlptLevel,
        grade: correct ? 4 : 1,
        existing: progressByKanji[current.id],
      });
    }
  }

  function handleNext() {
    cardRef.current?.swipeOut('right');
    setTimeout(() => {
      if (currentIndex + 1 >= queue.length && deferred.length === 0) {
        finishSession();
      } else {
        advance();
      }
    }, 300);
  }

  function handleEndSession() {
    Alert.alert('End Session', 'End the session and see your results?', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'End', style: 'destructive', onPress: finishSession},
    ]);
  }

  function handleDefer(animateCard = true) {
    deferCurrent();
    if (animateCard) cardRef.current?.swipeOut('left');
    setTimeout(() => advance(), 300);
  }

  function finishSession() {
    const allAnswers = Object.entries(answers);
    const correct = allAnswers.filter(([, a]) => a.some(x => x.correct)).length;
    const incorrect = allAnswers.filter(([, a]) => a.every(x => !x.correct)).length;
    const kanjiWrong = allAnswers.filter(([, a]) => a.some(x => !x.correct)).map(([id]) => id);

    logSession({
      startedAt: sessionStartedAt ?? new Date(),
      endedAt: new Date(),
      cardsReviewed: Object.keys(answers).length,
      cardsCorrect: correct,
      cardsDeferred: deferred.length,
    });

    navigation.replace('ReviewSummary', {
      correct,
      incorrect,
      deferred: deferred.length,
      kanjiReviewed: Object.keys(answers),
      kanjiWrong,
    });
    resetSession();
  }

  if (isSessionDone) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleEndSession} style={styles.endBtn}>
          <Text style={styles.endText}>✕</Text>
        </TouchableOpacity>
        <ProgressBar
          current={Object.keys(answers).length}
          total={queue.length}
        />
        <TouchableOpacity onPress={() => handleDefer()} style={styles.deferBtn}>
          <Text style={styles.deferText}>Later →</Text>
        </TouchableOpacity>
      </View>

      {/* Card */}
      <SwipeableCard
        ref={cardRef}
        onSwipeLeft={() => handleDefer(false)}
        onSwipeRight={() => handleDefer(false)}
        enabled={answerState === 'idle'}>
        <View style={styles.card}>
          {answerState === 'correct' && (
            <Text style={styles.checkmark}>✓</Text>
          )}
          <Text style={styles.kanji}>{current?.character}</Text>
          {current && (
            <Text style={[
              styles.hint,
              questionType === 'meaning' && current.readings_on[0]
                ? { color: '#4a90d9' }
                : questionType === 'meaning'
                  ? { color: '#9b59b6' }
                  : null,
            ]}>
              {questionType === 'meaning'
                ? current.readings_on[0] ?? current.readings_kun[0] ?? ''
                : current.meanings[0]}
            </Text>
          )}
          <Text style={[
            styles.questionType,
            questionType === 'onyomi' ? { color: '#4a90d9' } : questionType === 'kunyomi' ? { color: '#9b59b6' } : null,
          ]}>
            {questionType === 'meaning'
              ? 'Meaning'
              : questionType === 'onyomi'
                ? 'On\'yomi  音読み'
                : 'Kun\'yomi  訓読み'}
          </Text>
        </View>
      </SwipeableCard>

      {/* Choices */}
      <View style={styles.choices}>
        {choices.map((choice, i) => {
          let state: 'idle' | 'correct' | 'wrong' = 'idle';
          if (answerState !== 'idle') {
            if (choice === correctAnswer) state = 'correct';
            else if (choice === selectedChoice) state = 'wrong';
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

      {/* Next button — shown on wrong, or on correct when auto-advance is off */}
      {answerState !== 'idle' && (answerState === 'wrong' || !autoAdvanceOnCorrect) && (
        <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
          <Text style={styles.nextText}>
            {currentIndex + 1 >= queue.length && deferred.length === 0
              ? 'Finish'
              : 'Next →'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  endBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  endText: { color: '#888', fontSize: 18 },
  deferBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  deferText: { color: '#888' },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    minHeight: 200,
    justifyContent: 'center',
  },
  questionType: { color: '#e94560', fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginTop: 12, textTransform: 'uppercase' },
  kanji: { fontSize: 96, color: '#fff' },
  hint: { color: '#666', marginTop: 12, fontSize: 16 },
  choices: { gap: 2 },
  nextBtn: {
    backgroundColor: '#e94560',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  nextText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  checkmark: { position: 'absolute', top: 12, right: 16, fontSize: 20, color: '#4caf50', fontWeight: 'bold' },
});
