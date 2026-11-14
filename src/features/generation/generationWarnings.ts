export const generationPlanWarningLabels = {
  REQUESTED_ACTIVITY_UNFULFILLED: '요청한 활동 일부를 담지 못했어요.',
  REQUESTED_FOOD_UNFULFILLED: '원한 음식을 먹을 곳을 일정에 충분히 담지 못했어요.',
  MEAL_SLOT_UNFILLED: '일부 식사 시간대에 식당을 배치하지 못했어요.',
  TRANSFER_TIME_ESTIMATED: '일부 이동 시간은 예상값이에요.',
  STAY_TIME_ESTIMATED: '일부 체류 시간은 예상값이에요.',
} as const;

export type GenerationPlanWarningCode = keyof typeof generationPlanWarningLabels;

export const generationPlanWarningCodes = Object.keys(generationPlanWarningLabels) as GenerationPlanWarningCode[];

const generationNoticeCodes = [
  'REQUESTED_ACTIVITY_UNFULFILLED',
  'REQUESTED_FOOD_UNFULFILLED',
  'MEAL_SLOT_UNFILLED',
] as const satisfies readonly GenerationPlanWarningCode[];

export function readGenerationPlanWarningCodes(value: unknown): GenerationPlanWarningCode[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((code): code is GenerationPlanWarningCode =>
    typeof code === 'string' && generationPlanWarningCodes.includes(code as GenerationPlanWarningCode)))];
}

export function handoffWarningsForSource(
  tripId: string,
  sourcePlan: { planId: string; versionId: string } | null | undefined,
  handoff: { tripId: string; planId: string; versionId: string; warningCodes?: readonly string[] } | null | undefined,
): GenerationPlanWarningCode[] | null {
  if (!sourcePlan || !handoff || handoff.tripId !== tripId || handoff.planId !== sourcePlan.planId
    || handoff.versionId !== sourcePlan.versionId || handoff.warningCodes === undefined) return null;
  return readGenerationPlanWarningCodes(handoff.warningCodes);
}

export function generationWarningLabel(code: string): string | null {
  return Object.hasOwn(generationPlanWarningLabels, code)
    ? generationPlanWarningLabels[code as GenerationPlanWarningCode]
    : null;
}

export function generationNoticeLabels(codes: readonly string[]): string[] {
  return [...new Set(codes.filter((code): code is typeof generationNoticeCodes[number] =>
    (generationNoticeCodes as readonly string[]).includes(code)))].map(code => generationPlanWarningLabels[code]);
}
