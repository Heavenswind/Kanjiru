import React, {useEffect, useCallback} from 'react';
import {View, TouchableOpacity, Text, StyleSheet} from 'react-native';
import Svg, {Path, Text as SvgText} from 'react-native-svg';
import {useSettingsStore} from '../../stores/useSettingsStore';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

// KanjiVG viewBox is 109x109
const VIEWBOX = 109;
const BASE_MS_PER_UNIT = 4;  // ms per path-length unit at speed multiplier 1
const MIN_DURATION = 700;    // minimum ms for very short strokes
const MAX_DURATION = 2500;   // cap for very long strokes
const STROKE_DELAY = 200;    // ms gap between strokes
const AUTOPLAY_DELAY = 600;  // ms to wait after mount before starting
// Large enough to cover any KanjiVG path (109x109 viewBox, longest strokes can exceed 1000 units)
const DASH_LENGTH = 3000;

// Extract the start point (first M command) from a path string
function getStartPoint(d: string): {x: number; y: number} {
  const m = d.match(/M\s*([\d.]+)[,\s]([\d.]+)/);
  if (!m) return {x: 0, y: 0};
  return {x: parseFloat(m[1]), y: parseFloat(m[2])};
}

// Rough SVG path length estimator (good enough for timing without a DOM)
function estimatePathLength(d: string): number {
  const nums = d.match(/[-\d.]+/g);
  if (!nums || nums.length < 4) return 200;
  let len = 0;
  let cx = 0, cy = 0;
  const parts = d.trim().split(/(?=[MmCcQqLlHhVvZzAa])/);
  for (const part of parts) {
    const cmd = part[0];
    const args = (part.slice(1).match(/[-\d.]+/g) ?? []).map(Number);
    if (cmd === 'M') { cx = args[0]; cy = args[1]; }
    else if (cmd === 'L') { len += Math.hypot(args[0]-cx, args[1]-cy); cx = args[0]; cy = args[1]; }
    else if (cmd === 'C') { len += Math.hypot(args[4]-cx, args[5]-cy) * 1.5; cx = args[4]; cy = args[5]; }
    else if (cmd === 'Q') { len += Math.hypot(args[2]-cx, args[3]-cy) * 1.3; cx = args[2]; cy = args[3]; }
  }
  return Math.max(len, 50);
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedSvgText = Animated.createAnimatedComponent(SvgText);

interface StrokeProps {
  d: string;
  index: number;
  delay: number;
  duration: number;
  animate: boolean;
}

function AnimatedStroke({d, index, delay, duration, animate}: StrokeProps) {
  const progress = useSharedValue(animate ? 0 : 1);
  const labelOpacity = useSharedValue(0);
  const {x, y} = getStartPoint(d);

  useEffect(() => {
    if (animate) {
      progress.value = 0;
      labelOpacity.value = 0;
      progress.value = withDelay(
        delay,
        withTiming(1, {duration, easing: Easing.inOut(Easing.cubic)}),
      );
      // Fade number in at stroke start, then stay visible
      labelOpacity.value = withDelay(
        delay,
        withTiming(1, {duration: 200}),
      );
    } else {
      progress.value = 1;
      labelOpacity.value = 0;
    }
  }, [animate, delay, duration, progress, labelOpacity]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: (1 - progress.value) * DASH_LENGTH,
  }));

  const labelProps = useAnimatedProps(() => ({
    opacity: labelOpacity.value,
  }));

  return (
    <>
      <AnimatedPath
        d={d}
        stroke="#e94560"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={DASH_LENGTH}
        animatedProps={animatedProps}
      />
      <AnimatedSvgText
        x={x}
        y={y - 2}
        fontSize="5"
        fontWeight="bold"
        fill="#ffcc00"
        textAnchor="middle"
        animatedProps={labelProps}>
        {index + 1}
      </AnimatedSvgText>
    </>
  );
}

interface Props {
  strokes: string[];
  size?: number;
  autoPlay?: boolean;
}

export default function StrokeOrderDiagram({strokes, size = 160, autoPlay = false}: Props) {
  const [playing, setPlaying] = React.useState(autoPlay);
  const [key, setKey] = React.useState(0);
  // startOffset: extra delay before first stroke (AUTOPLAY_DELAY on initial autoplay, 0 on manual replay)
  const [startOffset, setStartOffset] = React.useState(autoPlay ? AUTOPLAY_DELAY : 0);
  const strokeSpeed = useSettingsStore(s => s.strokeSpeed);

  const handlePlay = useCallback(() => {
    setKey(k => k + 1);
    setStartOffset(0);
    setPlaying(true);
  }, []);

  // Pre-compute per-stroke duration and cumulative delay
  const strokeTimings = React.useMemo(() => {
    const msPerUnit = BASE_MS_PER_UNIT * strokeSpeed;
    let cumDelay = startOffset;
    return strokes.map(d => {
      const len = estimatePathLength(d);
      const duration = Math.min(MAX_DURATION * strokeSpeed, Math.max(MIN_DURATION * strokeSpeed, len * msPerUnit));
      const delay = cumDelay;
      cumDelay += duration + STROKE_DELAY;
      return {duration, delay};
    });
  }, [strokes, startOffset, strokeSpeed]);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.canvas, {width: size, height: size}]}>
        <View style={[styles.hLine, {top: size / 2}]} />
        <View style={[styles.vLine, {left: size / 2}]} />

        <Svg
          key={key}
          width={size}
          height={size}
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          style={StyleSheet.absoluteFill}>
          {strokes.map((d, i) =>
            playing ? (
              <AnimatedStroke
                key={i}
                d={d}
                index={i}
                delay={strokeTimings[i].delay}
                duration={strokeTimings[i].duration}
                animate={true}
              />
            ) : (
              <Path
                key={i}
                d={d}
                stroke="#e94560"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ),
          )}
        </Svg>
      </View>

      {/* Stroke count + play button */}
      <View style={styles.controls}>
        <Text style={styles.countText}>{strokes.length} strokes</Text>
        <TouchableOpacity style={styles.playBtn} onPress={handlePlay}>
          <Text style={styles.playText}>Animate</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {alignItems: 'center', marginBottom: 8},
  canvas: {
    borderRadius: 12,
    backgroundColor: '#0f0f1e',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    overflow: 'hidden',
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#2a2a4a',
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#2a2a4a',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 10,
  },
  countText: {color: '#666', fontSize: 13},
  playBtn: {
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  playText: {color: '#e94560', fontSize: 13, fontWeight: '600'},
});
