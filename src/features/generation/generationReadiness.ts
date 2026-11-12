export type PreparationReadinessInput = {
  expectedPeople: number | null;
  activeMemberCount: number;
  members: Array<{ preparationStatus: 'writing' | 'confirmed' }>;
  reasons: Array<{ code: string }>;
  conditionsReady: boolean;
};

export type PreparationReadinessSummary = {
  memberCountLabel: string;
  confirmedCountLabel: string;
  blockers: string[];
};

export function summarizePreparationReadiness(value: PreparationReadinessInput | null | undefined): PreparationReadinessSummary {
  if (!value) return { memberCountLabel: '', confirmedCountLabel: '', blockers: [] };
  const codes = new Set(value.reasons.map(reason => reason.code));
  const confirmed = value.members.filter(member => member.preparationStatus === 'confirmed').length;
  const memberCountLabel = value.expectedPeople === null ? `현재 참여 ${value.activeMemberCount}명` : `현재 참여 ${value.activeMemberCount}명 / 예정 ${value.expectedPeople}명`;
  const confirmedCountLabel = `준비 완료 ${confirmed}/${value.activeMemberCount}명`;
  const blockers: string[] = [];
  if (codes.has('CONDITIONS_INCOMPLETE')) blockers.push('여행 날짜와 예산 등 공통 기본조건을 완성해 주세요.');
  if (!value.conditionsReady && !blockers.length && codes.has('CONDITIONS_UNCONFIRMED')) blockers.push('공통 여행 조건을 먼저 저장해 주세요.');
  const onlyInformational = codes.size > 0 && [...codes].every(code => ['MEMBER_COUNT_MISMATCH', 'PREFERENCES_UNCONFIRMED'].includes(code));
  if (!value.conditionsReady && !blockers.length && !onlyInformational && !codes.has('CONDITIONS_UNCONFIRMED')) blockers.push('공통 여행 조건을 다시 확인해 주세요.');
  return { memberCountLabel, confirmedCountLabel, blockers };
}

export function readinessMessage(state: { reasons: Array<{ code: string }> }): string {
  const codes = new Set(state.reasons.map(reason => reason.code));
  if (codes.has('CONDITIONS_INCOMPLETE')) return '여행 날짜와 예산 등 기본조건을 저장해 주세요.';
  if (codes.has('REVIEW_REQUIRED') && !codes.has('PREFERENCES_UNCONFIRMED') && !codes.has('PREPARATION_INCOMPLETE')) return '공통 조건과 고정 일정을 다시 확인해 주세요.';
  if (codes.has('SCHEDULE_WINDOW_INFEASIBLE')) return '확정된 약속과 실제 이동 시간을 포함하면 설정한 활동 종료 시각까지 일정을 마치기 어려워요. 약속 시간이나 활동 시간을 조정해 주세요.';
  if (codes.has('REQUIRED_PREFERENCE_UNSUPPORTED') || codes.has('REQUIRED_PREFERENCE_UNSATISFIED') || codes.has('UNSATISFIED')) return '내 취향에 생성 조건으로 반영할 수 없는 필수 항목이 있어요. 내 취향 입력을 확인해 주세요.';
  if (codes.has('DEPARTURE_UNRESOLVED')) return '출발 장소를 장소 검색에서 선택해 주세요.';
  if (codes.has('RETURN_UNRESOLVED')) return '복귀 장소를 장소 검색에서 선택해 주세요.';
  if (codes.has('LODGING_ANCHOR_REQUIRED') || codes.has('FIXED_SCHEDULE_ANCHOR_REQUIRED') || codes.has('COMMON_REVIEW_REQUIRED') || codes.has('LEGACY_ANCHOR_REQUIRED') || codes.has('LODGING_REVIEW_REQUIRED') || codes.has('FIXED_SCHEDULE_REVIEW_REQUIRED')) return '기존 숙소 또는 고정 약속 정보를 장소와 시간으로 확인해 주세요.';
  return '여행 준비 상태를 확인하고 빠진 조건을 저장해 주세요.';
}
