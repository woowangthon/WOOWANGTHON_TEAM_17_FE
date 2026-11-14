import { generationNoticeLabels } from './generationWarnings.ts';
import type { GenerationPlanWarningCode } from './generationWarnings.ts';
import '../../styles/generation-plan-notice.css';

export function GenerationPlanNotice({ codes }: { codes: readonly GenerationPlanWarningCode[] }) {
  const labels = generationNoticeLabels(codes);
  if (!labels.length) return null;
  return <p className="generation-plan-notice" role="status">
    <strong>일정을 만들 때</strong>{' '}{labels.join(' ')}
  </p>;
}
