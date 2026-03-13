import {useMutation, useQueryClient} from '@tanstack/react-query';
import {upsertVocabProgress} from '../services/database/queries';
import {upsertVocabProgress as upsertVocabRemote} from '../services/supabase/progress';
import {gradeCard} from '../engine/srs/scheduler';
import {VocabProgress} from '../types/kanji';
import {Grade} from '../engine/srs/sm2';
import {useAuthStore} from '../stores/useAuthStore';
import {uuid} from '../utils/kanjiUtils';

export const VOCAB_PROGRESS_QUERY_KEY = 'vocab_progress';

interface GradeVocabInput {
  vocabWord: string;
  kanjiId: string;
  grade: Grade;
  existing: VocabProgress | undefined;
}

export function useGradeVocabCard() {
  const queryClient = useQueryClient();
  const session = useAuthStore(s => s.session);

  return useMutation({
    mutationFn: async ({vocabWord, kanjiId, grade, existing}: GradeVocabInput) => {
      const userId = session!.user.id;
      let updated: VocabProgress;

      if (existing) {
        const patch = gradeCard(existing as any, grade);
        updated = {...existing, ...patch} as VocabProgress;
      } else {
        const base: VocabProgress = {
          id: uuid(),
          userId,
          vocabWord,
          kanjiId,
          srsLevel: 0,
          repetitions: 0,
          easeFactor: 2.5,
          intervalDays: 0,
          nextReview: new Date(),
          lastReview: null,
          learnedAt: new Date(),
        };
        const patch = gradeCard(base as any, grade);
        updated = {...base, ...patch} as VocabProgress;
      }

      await upsertVocabProgress(updated);
      upsertVocabRemote(updated).catch(() => {});
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [VOCAB_PROGRESS_QUERY_KEY]});
    },
  });
}
