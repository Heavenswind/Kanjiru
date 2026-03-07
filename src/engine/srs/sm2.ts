export interface SrsItem {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
}

// Grade 0-5: 0=blackout, 3=correct with difficulty, 4=correct, 5=perfect
// For 4-choice quiz: correct=4, incorrect=1
export type Grade = 0 | 1 | 2 | 3 | 4 | 5;

export function sm2(item: SrsItem, grade: Grade): SrsItem {
  let {repetitions, intervalDays, easeFactor} = item;

  if (grade >= 3) {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;
  } else {
    repetitions = 0;
    intervalDays = 1;
  }

  // SM-2 EF formula
  const newEF =
    easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  easeFactor = Math.max(1.3, parseFloat(newEF.toFixed(2)));

  return {repetitions, intervalDays, easeFactor};
}

export function nextReviewDate(intervalDays: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + intervalDays);
  return date;
}
