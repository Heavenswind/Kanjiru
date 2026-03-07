import {useMutation, useQueryClient} from '@tanstack/react-query';
import {upsertProgress as upsertLocal} from '../services/database/queries';
import {upsertProgress as upsertRemote} from '../services/supabase/progress';
import {buildNewProgress} from '../engine/srs/scheduler';
import {KanjiEntry, KanjiProgress} from '../types/kanji';
import {useAuthStore} from '../stores/useAuthStore';
import {PROGRESS_QUERY_KEY} from './useProgressQuery';
import {uuid} from '../utils/kanjiUtils';

const BATCH_SIZE = 10;

interface EnrollInput {
  level: number;
  allKanji: KanjiEntry[];
  enrolledIds: Set<string>;
}

export function useEnrollKanji() {
  const queryClient = useQueryClient();
  const session = useAuthStore(s => s.session);

  return useMutation({
    mutationFn: async ({level, allKanji, enrolledIds}: EnrollInput) => {
      const userId = session!.user.id;

      const newKanji = allKanji
        .filter(k => k.jlptLevel === level && !enrolledIds.has(k.id))
        .slice(0, BATCH_SIZE);

      if (newKanji.length === 0) return 0;

      const batch: KanjiProgress[] = newKanji.map(k => ({
        id: uuid(),
        ...buildNewProgress(userId, k.id, level),
      }));

      await Promise.all(batch.map(p => upsertLocal(p)));
      await Promise.all(batch.map(p => upsertRemote(p)));

      return batch.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [PROGRESS_QUERY_KEY]});
    },
  });
}
