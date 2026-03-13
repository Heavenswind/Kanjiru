import React, { useImperativeHandle, forwardRef } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;

export interface SwipeableCardRef {
  swipeOut: (direction: 'left' | 'right', onDone?: () => void) => void;
  reset: () => void;
}

interface Props {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  enabled?: boolean;
  reduceMotion?: boolean;
}

const SwipeableCard = forwardRef<SwipeableCardRef, Props>(
  ({ children, onSwipeLeft, onSwipeRight, enabled = true, reduceMotion = false }, ref) => {
    const translateX = useSharedValue(0);

    useImperativeHandle(ref, () => ({
      swipeOut: (direction, onDone) => {
        const target = direction === 'left' ? -SCREEN_WIDTH * 1.5 : SCREEN_WIDTH * 1.5;
        if (reduceMotion) {
          if (onDone) runOnJS(onDone)();
        } else {
          translateX.value = withTiming(target, {duration: 300}, finished => {
            if (finished && onDone) runOnJS(onDone)();
          });
        }
      },
      // Called after content has updated — fly in from right
      reset: () => {
        if (reduceMotion) {
          translateX.value = 0;
        } else {
          translateX.value = SCREEN_WIDTH;
          translateX.value = withSpring(0, {damping: 20, stiffness: 200});
        }
      },
    }));

    const gesture = Gesture.Pan()
      .enabled(enabled)
      .onUpdate(e => {
        translateX.value = e.translationX;
      })
      .onEnd(e => {
        if (e.translationX < -SWIPE_THRESHOLD) {
          translateX.value = reduceMotion ? -SCREEN_WIDTH * 1.5 : withTiming(-SCREEN_WIDTH * 1.5, { duration: 300 });
          if (onSwipeLeft) runOnJS(onSwipeLeft)();
        } else if (e.translationX > SWIPE_THRESHOLD) {
          translateX.value = reduceMotion ? SCREEN_WIDTH * 1.5 : withTiming(SCREEN_WIDTH * 1.5, { duration: 300 });
          if (onSwipeRight) runOnJS(onSwipeRight)();
        } else {
          translateX.value = reduceMotion ? 0 : withSpring(0);
        }
      });

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: translateX.value },
        { rotate: `${(translateX.value / SCREEN_WIDTH) * 15}deg` },
      ],
    }));

    return (
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.card, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    );
  },
);

export default SwipeableCard;

const styles = StyleSheet.create({
  card: {
    width: '100%',
  },
});
