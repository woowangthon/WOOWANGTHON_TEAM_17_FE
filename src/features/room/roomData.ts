// The entry API is a plain browser module bundled as-is from public/.
// @ts-expect-error The shared browser API intentionally ships without project TS declarations.
import { reconnectTrip } from '../../../public/assets/live-entry/api.js';

export type RoomEntry = {
  trip: { id: string; name: string; status: 'OPEN'; inviteCode: string };
  member: { id: string; nickname: string; role: 'OWNER' | 'MEMBER'; status: 'ACTIVE' };
  alreadyJoined: boolean;
};

export function parseRoomEntry(value: unknown): RoomEntry {
  if (!value || typeof value !== 'object') throw new Error('여행방 정보를 확인할 수 없어요. 다시 불러와 주세요.');
  const candidate = value as Partial<RoomEntry>;
  const trip = candidate.trip;
  const member = candidate.member;
  if (!trip || typeof trip !== 'object' || typeof trip.id !== 'string' || !trip.id.trim() || typeof trip.name !== 'string' || !trip.name.trim() || typeof trip.inviteCode !== 'string' || !trip.inviteCode.trim() || trip.status !== 'OPEN') {
    throw new Error('여행방 정보가 올바르지 않아요. 다시 불러와 주세요.');
  }
  if (!member || typeof member !== 'object' || typeof member.id !== 'string' || !member.id.trim() || typeof member.nickname !== 'string' || !member.nickname.trim() || !['OWNER', 'MEMBER'].includes(member.role) || member.status !== 'ACTIVE' || typeof candidate.alreadyJoined !== 'boolean') {
    throw new Error('내 참여 정보를 확인할 수 없어요. 다시 불러와 주세요.');
  }
  return value as RoomEntry;
}

export async function loadRoomEntry(tripId: string): Promise<RoomEntry> {
  return parseRoomEntry(await reconnectTrip(tripId));
}

export type RoomDraft = {
  region: string;
  startDate: string;
  endDate: string;
  expectedPeople: string;
  budget: string;
  transport: 'undecided' | 'car' | 'transit' | 'charter' | 'walk';
  departure: string;
  departureTime: string;
  departureContentid: string;
  returnRoute: string;
  lodging: string;
  fixedSchedule: string;
};

export const emptyRoomDraft: RoomDraft = {
  region: '', startDate: '', endDate: '', expectedPeople: '', budget: '', transport: 'undecided',
  departure: '', departureTime: '09:00', departureContentid: '', returnRoute: '', lodging: '', fixedSchedule: '',
};

export function validateRoomDraft(draft: RoomDraft): Partial<Record<keyof RoomDraft, string>> {
  const errors: Partial<Record<keyof RoomDraft, string>> = {};
  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (Boolean(draft.startDate) !== Boolean(draft.endDate)) errors.startDate = '여행 시작일과 마지막 날을 모두 입력해 주세요.';
  else if (draft.startDate && !isValidDate(draft.startDate)) errors.startDate = '올바른 여행 시작일을 입력해 주세요.';
  else if (draft.endDate && !isValidDate(draft.endDate)) errors.endDate = '올바른 여행 마지막 날을 입력해 주세요.';
  else if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) errors.endDate = '마지막 날은 시작일과 같거나 이후여야 해요.';
  if (draft.expectedPeople && (!/^\d+$/u.test(draft.expectedPeople) || Number(draft.expectedPeople) < 1 || Number(draft.expectedPeople) > 50)) errors.expectedPeople = '예정 인원은 1명부터 50명 사이로 입력해 주세요.';
  if (draft.budget && (!/^\d+$/u.test(draft.budget) || Number(draft.budget) < 1 || Number(draft.budget) > 1_000_000_000)) errors.budget = '전체 예산은 1원부터 10억 원 사이의 정수로 입력해 주세요.';
  if (!['undecided', 'car', 'transit', 'charter', 'walk'].includes(draft.transport)) errors.transport = '이동 방법을 선택해 주세요.';
  return errors;
}

export type PreferenceImportance = 'required' | 'preferred';
export type AtomicCondition = {
  id: string; dimension: 'activity' | 'food' | 'walking' | 'visit_count' | 'meal_plan' | 'atmosphere' | 'accessibility' | 'other';
  target: string; polarity: 'prefer' | 'avoid' | 'limit'; priority: 'required' | 'preferred' | 'unspecified';
  priorityBasis: 'explicit' | 'unspecified' | 'user'; scope: 'trip' | 'day' | 'segment' | 'unspecified';
  audience: 'personal' | 'group' | 'unspecified'; frequency: null | { count: number; operator: 'exact' | 'min' | 'max' | 'target'; period: 'trip' | 'day' };
  value: number | string | null; unit: string | null; approximate: boolean; evidence: string; origin: 'model' | 'user';
};
export type AtomicPreferences = { schemaVersion: 2; sourceDigest: string; status: 'current' | 'stale'; conditions: AtomicCondition[]; unresolved: Array<{ code: string; evidence: string; message: string }> };
export type UnresolvedNote = AtomicPreferences['unresolved'][number];
export type UnresolvedAcknowledgement = { note: UnresolvedNote; disposition: 'handled' | 'ignored' };
export type UnresolvedAcknowledgements = { sourceDigest: string; items: UnresolvedAcknowledgement[] };
export function isVerbatimEvidence(source: string, evidence: string): boolean {
  return evidence.trim().length > 0 && evidence.length <= 1000 && [...evidence].length <= 1000 && source.includes(evidence);
}
export function validateUserAtomicCondition(condition: AtomicCondition, source: string, frequencyEnabled: boolean, frequencyInput: string): string | null {
  if (!condition.target.trim() || condition.target.length > 240) return '조건 내용을 입력해 주세요.';
  if (!isVerbatimEvidence(source, condition.evidence)) return '원문에서 근거 문장을 그대로 선택하거나 입력해 주세요.';
  if (frequencyEnabled) {
    if (!/^(0|[1-9]\d*)$/u.test(frequencyInput) || Number(frequencyInput) > 365 || !condition.frequency || condition.frequency.count !== Number(frequencyInput)) return '횟수는 0부터 365 사이의 정수로 입력해 주세요.';
  }
  if (typeof condition.value === 'number' && !Number.isFinite(condition.value)) return '값은 유효한 숫자로 입력해 주세요.';
  if (typeof condition.value === 'string' && (!condition.value.trim() || condition.value.length > 160)) return '문자 값은 1자부터 160자 사이로 입력해 주세요.';
  if (condition.unit && condition.unit.length > 40) return '단위는 40자 이내로 입력해 주세요.';
  return null;
}
function koreanParticle(value: string, vowel: string, consonant: string): string {
  const last = [...value.trim()].at(-1) ?? '';
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (jong === 0 || (vowel === '로' && jong === 8)) return vowel;
    return consonant;
  }
  return consonant;
}
function countPhrase(condition: AtomicCondition): string {
  const frequency = condition.frequency!;
  const unit = condition.unit && ['번', '회', '곳', '군데', '끼', '개'].includes(condition.unit)
    ? condition.unit : condition.dimension === 'visit_count' ? '곳' : condition.dimension === 'meal_plan' ? '끼' : '회';
  const count = `${frequency.count}${unit}`;
  if (frequency.operator === 'min') return `최소 ${condition.approximate ? '약 ' : ''}${count}`;
  if (frequency.operator === 'max') return `최대 ${condition.approximate ? '약 ' : ''}${count}`;
  if (frequency.operator === 'target') return `${count} 정도`;
  if (condition.approximate) return `약 ${count} (정확히)`;
  return `정확히 ${count}`;
}
function neutralConditionSummary(condition: AtomicCondition, target: string): string {
  const polarity = condition.polarity === 'avoid' ? '회피' : condition.polarity === 'limit' ? '제한' : '선호';
  const isCompleteSentence = /[.!?。！？]$/u.test(target.trim())
    || /(?:싶어요|원해요|좋아요|필요해요|피해요|않아요|싶습니다|원합니다|좋습니다|필요합니다|피합니다|않습니다|입니다|합니다|됩니다|있습니다|없습니다|한다|된다|있다|없다|좋다|필요하다|피한다|싶다)$/u.test(target.trim());
  const numericTarget = /^\d+(?:\.\d+)?$/u.test(target);
  const summary = isCompleteSentence
    ? `조건 문장 · ${target} · ${polarity}`
    : condition.dimension === 'walking' && numericTarget && condition.value !== null && Number(target) === Number(condition.value) && condition.unit === '분'
      ? `걷기 ${target}분 · ${polarity}`
    : numericTarget && condition.dimension === 'other'
      ? `입력한 값 ${target} · ${polarity}`
      : `${target} · ${polarity}`;
  const qualifiers: string[] = [];
  if (condition.frequency) {
    const time = condition.frequency.period === 'day' ? '하루' : '여행 중';
    const scope = condition.scope === 'segment' ? '일부 일정에서 ' : '';
    qualifiers.push(`${time} ${scope}${countPhrase(condition)}`);
  }
  if (condition.value !== null && !countValueRepresentedByFrequency(condition)) {
    const valueText = `${condition.approximate ? '약 ' : ''}${condition.value}${condition.unit ? ` ${condition.unit}` : ''}`;
    if (!(numericTarget && condition.dimension === 'other' && Number(target) === Number(condition.value) && !condition.unit)
      && !(condition.dimension === 'walking' && numericTarget && Number(target) === Number(condition.value) && condition.unit === '분')) {
      qualifiers.push(`값 ${valueText}`);
    }
  }
  const result = `${summary}${qualifiers.length ? ` · ${qualifiers.join(' · ')}` : ''}`;
  return `${result}.`;
}
export function formatAtomicCondition(condition: AtomicCondition): string {
  const target = condition.target.trim() || '조건 내용';
  if (condition.dimension === 'walking' || condition.dimension === 'other') {
    return neutralConditionSummary(condition, target);
  }
  const topic = target + koreanParticle(target, '는', '은');
  const object = target + koreanParticle(target, '를', '을');
  let sentence: string;
  if (condition.dimension === 'visit_count') {
    if (condition.frequency) {
      const period = condition.frequency.period === 'day' ? '하루' : condition.scope === 'segment' ? '일부 일정에서' : '여행 중';
      const count = countPhrase(condition);
      const unitOnly = target === '곳' || target === '군데';
      const visits = unitOnly ? `${period} ${count}` : `${period} ${topic} ${count}`;
      sentence = condition.polarity === 'avoid'
        ? `${visits}${koreanParticle(count, '는', '은')} 원하지 않아요`
        : condition.polarity === 'limit'
          ? `${visits}${koreanParticle(count, '로', '으로')} 제한하고 싶어요`
          : unitOnly ? `${visits} 방문하고 싶어요` : `${visits}${koreanParticle(count, '를', '을')} 원해요`;
    } else sentence = condition.polarity === 'avoid' ? `${topic} 피하고 싶어요` : condition.polarity === 'limit' ? `${object} 횟수를 제한하고 싶어요` : `${object} 원해요`;
  } else if (condition.dimension === 'meal_plan') {
    const period = condition.frequency?.period === 'day' ? '매일 ' : '';
    const meals = target.replace(/\s+/gu, '·');
    if (condition.frequency) {
      const count = countPhrase(condition);
      if (condition.polarity === 'avoid') sentence = `${period}${meals}, ${count} 식사는 피하고 싶어요`;
      else if (condition.polarity === 'limit') sentence = `${period}${meals}, ${count}${koreanParticle(count, '로', '으로')} 제한하고 싶어요`;
      else sentence = `${period}${meals}, ${count} 식사하고 싶어요`;
    } else sentence = condition.polarity === 'avoid' ? `${meals}은 피하고 싶어요` : condition.polarity === 'limit' ? `${meals} 식사는 제한하고 싶어요` : `${meals}을 챙겨 먹고 싶어요`;
  } else if (condition.dimension === 'food') {
    const period = condition.frequency?.period === 'day' ? '하루 ' : condition.scope === 'segment' ? '일부 일정에서 ' : condition.frequency ? '여행 중 ' : '';
    if (condition.frequency) {
      sentence = condition.polarity === 'avoid' ? `${period}${topic} ${countPhrase(condition)} 먹는 건 피하고 싶어요` : condition.polarity === 'limit' ? `${period}${target} 섭취 횟수를 ${countPhrase(condition)}로 제한하고 싶어요` : `${period}${object} ${countPhrase(condition)} 먹고 싶어요`;
    } else sentence = condition.polarity === 'avoid' ? `${topic} 먹지 않으려 해요` : condition.polarity === 'limit' ? `${object} 제한하고 싶어요` : `${object} 먹고 싶어요`;
  } else if (condition.dimension === 'activity') {
    sentence = condition.polarity === 'avoid' ? `${topic} 피하고 싶어요` : condition.polarity === 'limit' ? `${topic} 제한하고 싶어요` : `${target}에 가고 싶어요`;
  } else if (condition.dimension === 'atmosphere') sentence = condition.polarity === 'avoid' ? `${topic} 피하고 싶어요` : condition.polarity === 'limit' ? `${target} 분위기를 제한하고 싶어요` : `${target} 분위기를 원해요`;
  else if (condition.dimension === 'accessibility') sentence = condition.polarity === 'avoid' ? `${topic} 피하고 싶어요` : condition.polarity === 'limit' ? `${object} 제한하고 싶어요` : `${target}이 필요해요`;
  else sentence = condition.polarity === 'avoid' ? `${topic} 피하고 싶어요` : condition.polarity === 'limit' ? `${object} 제한하고 싶어요` : `${object} 원해요`;
  if (condition.frequency && condition.dimension !== 'visit_count' && condition.dimension !== 'meal_plan' && condition.dimension !== 'food') {
    const time = condition.frequency.period === 'day' ? '하루' : condition.scope === 'segment' ? '일부 일정에서' : '여행 중';
    sentence = `${time} ${sentence.replace(/요$/u, '')} (${countPhrase(condition)})요`;
  }
  if (condition.frequency && condition.value !== null && !countValueRepresentedByFrequency(condition)) sentence += ` · 값 ${condition.approximate ? '약 ' : ''}${condition.value}${condition.unit ? ` ${condition.unit}` : ''}`;
  else if (!condition.frequency && condition.value !== null) sentence += ` · ${condition.approximate ? '약 ' : ''}${condition.value}${condition.unit ? ` ${condition.unit}` : ''}`;
  return `${sentence}.`;
}
export function atomicConditionTags(condition: AtomicCondition): string[] {
  return [
    condition.scope === 'segment' ? '일부 일정' : condition.scope === 'day' && condition.frequency?.period !== 'day' ? '하루 기준' : condition.scope === 'unspecified' ? '범위 미정' : '',
    condition.audience === 'group' ? '일행 공통' : condition.audience === 'unspecified' ? '대상 미정' : '',
    condition.priority === 'required' ? '필수' : condition.priority === 'unspecified' ? '중요도 미정' : '',
  ].filter(Boolean);
}
const countUnits = new Set(['번', '회', '곳', '군데', '끼', '개']);
export function countValueRepresentedByFrequency(condition: AtomicCondition): boolean {
  return Boolean(condition.frequency && condition.value === condition.frequency.count && condition.unit && countUnits.has(condition.unit));
}
export function editAtomicCondition(condition: AtomicCondition, patch: Partial<AtomicCondition>): AtomicCondition {
  const next = { ...condition, ...patch, origin: 'user' as const };
  if (patch.priority !== undefined) next.priorityBasis = 'user';
  if (patch.frequency && condition.frequency) {
    const frequency = { ...condition.frequency, ...patch.frequency };
    next.frequency = frequency;
    if (patch.frequency.count !== undefined && countValueRepresentedByFrequency(condition)) next.value = frequency.count;
    if (patch.frequency.period !== undefined) next.scope = frequency.period === 'day' ? 'day' : 'trip';
  }
  if (patch.frequency === null && countValueRepresentedByFrequency(condition)) { next.value = null; next.unit = null; }
  return next;
}
export function projectInterpretedWalking(
  savedWalking: PersonalDraft['walking'],
  suggestedWalking: PersonalDraft['walking'],
  needsWalkingAnswer: boolean,
  profile?: AtomicPreferences,
): PersonalDraft['walking'] {
  if (!profile) return needsWalkingAnswer || !suggestedWalking ? savedWalking : suggestedWalking;
  const walking = profile.conditions.find(condition => condition.dimension === 'walking');
  if (!walking || typeof walking.value !== 'number' || walking.unit !== '분') return '';
  if (walking.value === 20) return '20';
  if (walking.value === 40) return '40';
  return '';
}
export function draftChangeInvalidatesAtomicProfile(key: keyof PersonalDraft): boolean {
  return key === 'originalText';
}
export type ScheduleItem = {
  id: string;
  kind: 'lodging' | 'appointment';
  scope: 'personal' | 'group' | null;
  placeQuery: string;
  contentid: number | null;
  date: string | null;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
};
export type PersonalDraft = {
  originalText: string;
  likes: string;
  avoid: string;
  avoidImportance: PreferenceImportance;
  food: string;
  foodImportance: PreferenceImportance;
  walking: '20' | '40' | 'unlimited' | '';
  scheduleItems: ScheduleItem[];
  atomicPreferences?: AtomicPreferences | null;
};

export const emptyPersonalDraft: PersonalDraft = {
  originalText: '', likes: '', avoid: '', avoidImportance: 'required',
  food: '', foodImportance: 'preferred', walking: '', scheduleItems: [],
};

export const previewPersonalDraft: PersonalDraft = {
  originalText: '자연 풍경과 조용한 카페가 좋아요. 사진을 찍으며 여유롭게 쉬고 싶고, 오래 걷는 코스는 피하고 싶어요.\n\n식사는 너무 맵지 않으면 좋겠어요.',
  likes: '자연 풍경, 조용한 카페, 여유로운 휴식',
  avoid: '긴 도보 이동', avoidImportance: 'required', food: '맵지 않은 음식',
  foodImportance: 'preferred', walking: '20', scheduleItems: [],
};

export function personalDraftComplete(draft: PersonalDraft): boolean {
  return Boolean(draft.likes.trim() && draft.walking && draft.originalText.trim());
}

export function formatDraftDate(start: string, end: string): string {
  if (!start || !end) return '아직 정하지 않았어요';
  const format = (date: string) => {
    const [year, month, day] = date.split('-');
    return `${year}.${month}.${day}`;
  };
  return `${format(start)} – ${format(end)}`;
}

export function formatDraftBudget(budget: string): string {
  if (!budget) return '아직 정하지 않았어요';
  return `${Number(budget).toLocaleString('ko-KR')}원`;
}

export function formatDraftPeople(people: string): string {
  return people ? `${people}명 예정` : '아직 정하지 않았어요';
}

export function formatDraftTransport(transport: RoomDraft['transport']): string {
  return ({ undecided: '아직 정하지 않았어요', car: '자가용', transit: '대중교통', charter: '전세버스', walk: '도보' })[transport];
}

export function roomConditionsStarted(draft: RoomDraft): boolean {
  return Boolean(draft.region || draft.startDate || draft.endDate || draft.expectedPeople || draft.budget || draft.departure || draft.departureContentid || draft.returnRoute || draft.lodging || draft.fixedSchedule || draft.transport !== 'undecided');
}
