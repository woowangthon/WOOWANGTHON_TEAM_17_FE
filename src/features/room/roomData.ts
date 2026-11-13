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
    if (patch.frequency.count !== undefined && countValueRepresentedByFrequency(condition)) {
      next.value = frequency.count;
    }
    if (patch.frequency.operator === 'target') next.approximate = true;
    if (patch.frequency.operator === 'exact') next.approximate = false;
    if (patch.frequency.period !== undefined) next.scope = frequency.period === 'day' ? 'day' : 'trip';
  }
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
