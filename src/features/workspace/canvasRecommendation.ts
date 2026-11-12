export type RecommendationRequest = { prompt: string; dayId: string; exclude: number[]; key: string };

/** Reuse the exact request identity and body until a result is known. */
export function retainRecommendationRequest(existing: RecommendationRequest | null, prompt: string, dayId: string, exclude: number[]): RecommendationRequest {
  if (existing) return existing;
  return {
    prompt,
    dayId,
    exclude: [...new Set(exclude)].sort((left, right) => left - right).slice(0, 100),
    key: crypto.randomUUID(),
  };
}
