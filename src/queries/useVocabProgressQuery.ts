import {useQuery} from '@tanstack/react-query';
import {useAuthStore} from '../stores/useAuthStore';
import {fetchVocabProgress} from '../services/supabase/progress';
import {VocabProgress} from '../types/kanji';

export const VOCAB_PROGRESS_QUERY_KEY = 'vocab_progress';

export function useVocabProgressQuery() {
  const session = useAuthStore(s => s.session);
  const userId = session?.user.id;

  return useQuery<VocabProgress[]>({
    queryKey: [VOCAB_PROGRESS_QUERY_KEY, userId],
    queryFn: () => fetchVocabProgress(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}
