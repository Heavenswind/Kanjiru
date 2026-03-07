import {useMutation} from '@tanstack/react-query';
import {logReviewSession} from '../services/supabase/progress';
import {useAuthStore} from '../stores/useAuthStore';

interface SessionInput {
  startedAt: Date;
  endedAt: Date;
  cardsReviewed: number;
  cardsCorrect: number;
  cardsDeferred: number;
  jlptLevel?: number;
}

export function useSessionLog() {
  const session = useAuthStore(s => s.session);

  return useMutation({
    mutationFn: (input: SessionInput) =>
      logReviewSession({userId: session!.user.id, ...input}),
  });
}
