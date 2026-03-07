import {useMutation, useQueryClient} from '@tanstack/react-query';
import {upsertProgress} from '../services/supabase/progress';
import {upsertProgress as upsertLocal} from '../services/database/queries';
import {gradeCard, buildNewProgress} from '../engine/srs/scheduler';
import {KanjiProgress} from '../types/kanji';
import {Grade} from '../engine/srs/sm2';
import {useAuthStore} from '../stores/useAuthStore';
import {PROGRESS_QUERY_KEY} from './useProgressQuery';
import {uuid} from '../utils/kanjiUtils';

interface GradeInput {
  kanjiId: string;
  jlptLevel: number;
  grade: Grade;
  existing: KanjiProgress | undefined;
}

export function useGradeCard() {
  const queryClient = useQueryClient();
  const session = useAuthStore(s => s.session);

  return useMutation({
    mutationFn: async ({kanjiId, jlptLevel, grade, existing}: GradeInput) => {
      const userId = session!.user.id;
      let updated: KanjiProgress;

      if (existing) {
        const patch = gradeCard(existing, grade);
        updated = {...existing, ...patch} as KanjiProgress;
      } else {
        const base = buildNewProgress(userId, kanjiId, jlptLevel);
        const baseProgress: KanjiProgress = {id: uuid(), ...base};
        const patch = gradeCard(baseProgress, grade);
        updated = {...baseProgress, ...patch} as KanjiProgress;
      }

      // Write to local SQLite first (fast, offline-safe)
      await upsertLocal(updated);
      // Then sync to Supabase
      await upsertProgress(updated);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [PROGRESS_QUERY_KEY]});
    },
  });
}
