import { useEffect, useState } from 'react';
import { getPlan } from './generationApi.ts';
import { handoffWarningsForSource, readGenerationPlanWarningCodes, type GenerationPlanWarningCode } from './generationWarnings.ts';
import type { CanvasHandoff } from '../workspace/canvasHandoff.ts';

type SourcePlan = { planId: string; versionId: string } | null | undefined;
type LoadedWarnings = { key: string; codes: GenerationPlanWarningCode[] };

/** Reads generation-time warnings only for the source plan/version behind this shared canvas. */
export function useGenerationPlanWarnings(
  tripId: string,
  preview: boolean,
  sourcePlan: SourcePlan,
  handoff?: CanvasHandoff | null,
): GenerationPlanWarningCode[] {
  const planId = sourcePlan?.planId ?? '';
  const versionId = sourcePlan?.versionId ?? '';
  const key = planId && versionId ? `${tripId}:${planId}:${versionId}` : '';
  const handoffWarnings = !preview && key ? handoffWarningsForSource(tripId, sourcePlan, handoff) : null;
  const [loaded, setLoaded] = useState<LoadedWarnings | null>(null);

  useEffect(() => {
    if (preview || !key || handoffWarnings !== null) return;
    const controller = new AbortController();
    void getPlan(tripId, planId, controller.signal).then(plan => {
      if (controller.signal.aborted || plan.planId !== planId || plan.versionId !== versionId) return;
      setLoaded({ key, codes: readGenerationPlanWarningCodes(plan.document?.validation?.warnings) });
    }).catch(() => {
      // Plan access can be unavailable to a room viewer; the notice is optional.
    });
    return () => controller.abort();
  }, [handoffWarnings, key, planId, preview, tripId, versionId]);

  if (preview || !key) return [];
  if (handoffWarnings !== null) return handoffWarnings;
  return loaded?.key === key ? loaded.codes : [];
}
