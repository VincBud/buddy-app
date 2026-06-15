import { isSupabaseConfigured } from '../lib/config/env';
import { supabase } from '../lib/supabase/client';

export const insertReview = async (params: {
  jobId: string;
  reviewerId: string;
  revieweeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body?: string;
}): Promise<void> => {
  if (!isSupabaseConfigured || !params.reviewerId || !params.revieweeId) return;
  try {
    const { error } = await supabase.from('reviews').insert({
      job_id: params.jobId,
      reviewer_id: params.reviewerId,
      reviewee_id: params.revieweeId,
      rating: params.rating,
      body: params.body?.trim() || null,
    });
    // 23505 = unique_violation — duplicate review, idempotent no-op
    if (error && error.code !== '23505') {
      console.warn('[reviews.service] insert failed:', error.message);
    }
  } catch (e) {
    console.warn('[reviews.service] insertReview error:', e);
  }
};
