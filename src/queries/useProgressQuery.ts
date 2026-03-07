import {useQuery} from '@tanstack/react-query';
import {useAuthStore} from '../stores/useAuthStore';
import {fetchProgress} from '../services/supabase/progress';
import {KanjiProgress} from '../types/kanji';

export const PROGRESS_QUERY_KEY = 'kanji_progress';

export function useProgressQuery() {
  const session = useAuthStore(s => s.session);
  const userId = session?.user.id;

  return useQuery<KanjiProgress[]>({
    queryKey: [PROGRESS_QUERY_KEY, userId],
    queryFn: () => fetchProgress(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
