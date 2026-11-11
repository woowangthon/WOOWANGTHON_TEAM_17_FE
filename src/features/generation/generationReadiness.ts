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
  if (codes.has('MEMBER_COUNT_MISMATCH') || (value.expectedPeople !== null && value.expectedPeople !== value.activeMemberCount)) {
    blockers.push('현재 참여 인원과 예정 인원을 맞춰 주세요.');
  }
  if (codes.has('PREFERENCES_UNCONFIRMED') || value.members.some(member => member.preparationStatus !== 'confirmed')) {
    blockers.push('모든 참여자가 내 취향에서 ‘준비 완료’를 눌러야 해요.');
  }
  if (codes.has('CONDITIONS_INCOMPLETE')) blockers.push('여행 날짜와 예산 등 공통 기본조건을 완성해 주세요.');
  if (!value.conditionsReady && blockers.length === 0) blockers.push('여행 준비 상태를 새로 확인해 주세요.');
  return { memberCountLabel, confirmedCountLabel, blockers };
}
