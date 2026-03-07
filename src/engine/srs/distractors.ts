import {KanjiEntry} from '../../types/kanji';
import {QuestionType} from '../../types/review';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateChoices(
  target: KanjiEntry,
  pool: KanjiEntry[],
  type: QuestionType,
): {correctAnswer: string; choices: string[]} {
  if (type === 'meaning') {
    const correctAnswer = target.meanings[0];
    const distractors = pool
      .filter(k => k.id !== target.id)
      .filter(k => !k.meanings.some(m => target.meanings.includes(m)))
      .map(k => k.meanings[0])
      .filter(Boolean);

    const picked = shuffle(distractors).slice(0, 3);
    // If not enough distractors, fall back to any from pool
    while (picked.length < 3) {
      picked.push(`(unknown ${picked.length})`);
    }
    return {correctAnswer, choices: shuffle([correctAnswer, ...picked])};
  } else if (type === 'onyomi') {
    const correctAnswer = target.readings_on[0] ?? '';
    const distractors = pool
      .filter(k => k.id !== target.id)
      .flatMap(k => k.readings_on)
      .filter(r => r && r !== correctAnswer);

    const unique = [...new Set(distractors)];
    const picked = shuffle(unique).slice(0, 3);
    while (picked.length < 3) {
      picked.push(`(unknown ${picked.length})`);
    }
    return {correctAnswer, choices: shuffle([correctAnswer, ...picked])};
  } else {
    // kunyomi
    const correctAnswer = stripOkurigana(target.readings_kun[0] ?? '');
    const distractors = pool
      .filter(k => k.id !== target.id)
      .flatMap(k => k.readings_kun.map(stripOkurigana))
      .filter(r => r && r !== correctAnswer);

    const unique = [...new Set(distractors)];
    const picked = shuffle(unique).slice(0, 3);
    while (picked.length < 3) {
      picked.push(`(unknown ${picked.length})`);
    }
    return {correctAnswer, choices: shuffle([correctAnswer, ...picked])};
  }
}

export function stripOkurigana(reading: string): string {
  // Remove leading - (alternate form marker) then strip okurigana after . or -
  return reading.replace(/^-/, '').replace(/[.-].*/g, '').replace(/[!]/g, '');
}
