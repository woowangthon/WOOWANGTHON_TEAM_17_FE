import type { SelfDto } from './generationApi';

export type ReviewField = 'likes' | 'avoid' | 'food';
export type ReviewFieldChoice = { scope: 'all' | 'meal' | 'stay'; fully: boolean };
export type ReviewChoices = Record<ReviewField, ReviewFieldChoice>;

export const emptyReviewChoices: ReviewChoices = {
  likes: { scope: 'all', fully: false },
  avoid: { scope: 'all', fully: false },
  food: { scope: 'meal', fully: false },
};

export const reviewFieldName: Record<ReviewField, string> = {
  likes: '좋아하는 항목', avoid: '피하고 싶은 항목', food: '음식 조건',
};

export function restoreReviewChoices(dto: SelfDto): { accepted: string[]; fields: ReviewChoices } {
  const fields: ReviewChoices = { ...emptyReviewChoices };
  for (const reviewed of dto.review?.reviewedFields ?? []) {
    if (reviewed.field === 'likes' || reviewed.field === 'avoid' || reviewed.field === 'food') {
      fields[reviewed.field] = {
        scope: reviewed.scope === 'meal' || reviewed.scope === 'stay' ? reviewed.scope : 'all',
        fully: reviewed.fullyReviewed === true,
      };
    }
  }
  return { accepted: dto.review?.acceptedTermIds ?? [], fields };
}

/** Mirrors the BE rule: every represented field needs an accepted term and a full field review. */
export function getReviewIssues(dto: SelfDto, accepted: string[], choices: ReviewChoices): string[] {
  const normalization = dto.normalization;
  if (!normalization) return ['AI 해석을 먼저 진행해 주세요.'];
  const issues: string[] = [];
  const allowedFields = new Set<ReviewField>(['likes', 'avoid', 'food']);
  const fields = new Set<ReviewField>([
    ...normalization.terms.map((term) => term.field),
    ...normalization.unmapped.map((item) => item.field).filter((field): field is ReviewField => allowedFields.has(field as ReviewField)),
  ]);
  for (const field of fields) {
    const terms = normalization.terms.filter((term) => term.field === field);
    const acceptedForField = terms.filter((term) => accepted.includes(term.id));
    if (!terms.length) {
      issues.push(`${reviewFieldName[field]}에 적용할 수 있는 태그가 없어 원문을 수정한 뒤 다시 해석해 주세요.`);
      continue;
    }
    if (!acceptedForField.length) issues.push(`${reviewFieldName[field]}에서 일정에 반영할 항목을 하나 이상 선택해 주세요.`);
    if (!choices[field].fully) issues.push(`${reviewFieldName[field]}의 전체 의미와 적용 범위를 확인해 주세요.`);
  }
  return issues;
}

export function getUnmappedReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    uncovered: '해석 결과에서 다루지 못함',
    coverage_unverified: '선택한 태그가 원문의 전체 의미를 담는지 확인 필요',
    unsupported: '지원하지 않는 조건',
  };
  return labels[reason] ?? '자동으로 해석할 수 없음';
}
