export type GenerationLoadingPhase = 'checking' | 'generating' | 'routing' | 'opening' | 'complete';

const completed: Record<GenerationLoadingPhase, number> = {
  checking: 0,
  generating: 1,
  routing: 2,
  opening: 3,
  complete: 4,
};

export function generationStageProgress(phase: GenerationLoadingPhase, hasError = false) {
  const stagesCompleted = hasError ? Math.min(completed[phase], 3) : completed[phase];
  return {
    stagesCompleted,
    fraction: stagesCompleted / 4,
    label: hasError ? '진행을 확인해 주세요' : `${stagesCompleted}/4 단계 완료`,
  };
}
