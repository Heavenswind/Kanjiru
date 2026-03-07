import React, {useEffect, useRef, useState, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RouteProp} from '@react-navigation/native';
import {ReviewStackParamList} from '../../types/navigation';
import {useReviewStore} from '../../stores/useReviewStore';
import {useGradeCard} from '../../queries/useGradeCard';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useSessionLog} from '../../queries/useSessionLog';
import {generateChoices} from '../../engine/srs/distractors';
import {useKanjiData} from '../../hooks/useKanjiData';
import SwipeableCard, {SwipeableCardRef} from '../../components/cards/SwipeableCard';
import ChoiceButton from '../../components/quiz/ChoiceButton';
import ProgressBar from '../../components/quiz/ProgressBar';
import {QuestionType} from '../../types/review';

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewSession'>;
  route: RouteProp<ReviewStackParamList, 'ReviewSession'>;
};

type AnswerState = 'idle' | 'correct' | 'wrong';

export default function ReviewSessionScreen({navigation}: Props) {
  const allKanji = useKanjiData();
  const {data: progress} = useProgressQuery();
  const {mutate: gradeCard} = useGradeCard();
  const {mutate: logSession} = useSessionLog();
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

  const current = queue[currentIndex];
  const isSessionDone = currentIndex >= queue.length;

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

  const {correctAnswer, choices} = useMemo(() => {
    if (!current) return {correctAnswer: '', choices: []};
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

    // Grade via SRS
    if (current) {
      gradeCard({
        kanjiId: current.id,
        jlptLevel: current.jlptLevel,
        grade: correct ? 4 : 1,
        existing: progressByKanji[current.id],
      });
    }
  }

  function handleNext() {
    if (currentIndex + 1 >= queue.length && deferred.length === 0) {
      finishSession();
    } else {
      advance();
    }
  }

  function handleDefer() {
    deferCurrent();
    cardRef.current?.swipeOut('left');
    setTimeout(() => advance(), 300);
  }

  function finishSession() {
    const allAnswers = Object.values(answers);
    const correct = allAnswers.filter(a => a.some(x => x.correct)).length;
    const incorrect = allAnswers.filter(a => a.every(x => !x.correct)).length;

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
    });
    resetSession();
  }

  if (isSessionDone) return null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ProgressBar
          current={currentIndex}
          total={queue.length + deferred.length}
        />
        <TouchableOpacity onPress={handleDefer} style={styles.deferBtn}>
          <Text style={styles.deferText}>Later →</Text>
        </TouchableOpacity>
      </View>

      {/* Card */}
      <SwipeableCard
        ref={cardRef}
        onSwipeLeft={handleDefer}
        enabled={answerState === 'idle'}>
        <View style={styles.card}>
          <Text style={styles.questionType}>
            {questionType === 'meaning'
              ? 'Meaning'
              : questionType === 'onyomi'
              ? 'On\'yomi  音読み'
              : 'Kun\'yomi  訓読み'}
          </Text>
          <Text style={styles.kanji}>{current?.character}</Text>
          {current && (
            <Text style={styles.hint}>
              {questionType === 'meaning'
                ? current.readings_on[0] ?? current.readings_kun[0] ?? ''
                : current.meanings[0]}
            </Text>
          )}
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

      {/* Next button after answering */}
      {answerState !== 'idle' && (
        <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
          <Text style={styles.nextText}>
            {currentIndex + 1 >= queue.length && deferred.length === 0
              ? 'Finish'
              : 'Next →'}
          </Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e', padding: 16},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  deferBtn: {paddingHorizontal: 12, paddingVertical: 6},
  deferText: {color: '#888'},
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    minHeight: 200,
    justifyContent: 'center',
  },
  questionType: {color: '#e94560', fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase'},
  kanji: {fontSize: 96, color: '#fff'},
  hint: {color: '#666', marginTop: 12, fontSize: 16},
  choices: {gap: 2},
  nextBtn: {
    backgroundColor: '#e94560',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  nextText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
});
