export type PersonalDraft = {
  originalText: string;
  likes: string;
  avoid: string;
  avoidImportance: 'required' | 'preferred';
  food: string;
  foodImportance: 'required' | 'preferred';
  walking: string;
};

export type PersonalRecord = {
  conditionsVersion: number;
  preferenceVersion: number;
  draft: PersonalDraft;
  confirmation: { status: 'writing' | 'confirmed'; confirmedConditionsVersion: number | null; confirmedPreferenceVersion: number | null; confirmedAt: string | null };
};

export type PersonalProposal = {
  sourceConditionsVersion: number;
  sourcePreferenceVersion: number;
  suggestions: { likes: string | null; avoid: string | null; avoidImportance: 'required' | 'preferred'; food: string | null; foodImportance: 'required' | 'preferred'; walking: string | null };
  needsWalkingAnswer: boolean;
};

export class PersonalApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function path(tripId: string, suffix: string) { return `/api/v1/trips/${encodeURIComponent(tripId)}${suffix}`; }
function key() { return crypto.randomUUID(); }
async function request<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) {
      const error = record(body) && record(body.error) ? body.error : {};
      const code = typeof error.code === 'string' ? error.code : `HTTP_${response.status}`;
      const message = code === 'VERSION_CONFLICT' ? '다른 곳에서 조건을 변경했어요. 최신 내용을 다시 불러와 주세요.' :
        code === 'STALE_AI_RESULT' ? '조건이 바뀌어 해석 결과를 적용할 수 없어요. 다시 확인해 주세요.' : '요청을 완료하지 못했어요. 입력은 그대로 보관했어요.';
      throw new PersonalApiError(response.status, code, message);
    }
    return body as T;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof PersonalApiError) throw error;
    throw new Error('여행 준비 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  }
}

export async function getPersonal(tripId: string, signal?: AbortSignal): Promise<PersonalRecord> {
  return request(path(tripId, '/preferences/me'), {}, signal);
}
export async function putPersonal(tripId: string, current: PersonalRecord, draft: PersonalDraft, signal?: AbortSignal) {
  return request<PersonalRecord>(path(tripId, '/preferences/me'), { method: 'PUT', body: JSON.stringify({
    expectedConditionsVersion: current.conditionsVersion, expectedPreferenceVersion: current.preferenceVersion,
    draft: { ...draft, originalText: draft.originalText.trim() || null, likes: draft.likes.trim() || null,
      avoid: draft.avoid.trim() || null, food: draft.food.trim() || null, walking: draft.walking.trim() || null },
  }) }, signal);
}
export async function interpretPersonal(tripId: string, current: PersonalRecord, signal?: AbortSignal, idempotencyKey: string = key()): Promise<PersonalProposal> {
  const value = await request<unknown>(path(tripId, '/preferences/me/interpret'), { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({
    expectedConditionsVersion: current.conditionsVersion, expectedPreferenceVersion: current.preferenceVersion,
  }) }, signal);
  if (!record(value) || !record(value.suggestions) || !Number.isInteger(value.sourceConditionsVersion) || !Number.isInteger(value.sourcePreferenceVersion) || typeof value.needsWalkingAnswer !== 'boolean') throw new Error('해석 응답을 읽을 수 없어요. 입력은 저장되어 있어요.');
  const s = value.suggestions;
  const nullableText = (candidate: unknown) => typeof candidate === 'string' ? candidate : candidate === null || candidate === undefined ? null : null;
  return { sourceConditionsVersion: value.sourceConditionsVersion as number, sourcePreferenceVersion: value.sourcePreferenceVersion as number,
    suggestions: { likes: nullableText(s.likes), avoid: nullableText(s.avoid), avoidImportance: s.avoidImportance === 'preferred' ? 'preferred' : 'required', food: nullableText(s.food), foodImportance: s.foodImportance === 'required' ? 'required' : 'preferred', walking: nullableText(s.walking) },
    needsWalkingAnswer: value.needsWalkingAnswer };
}
export async function confirmPersonal(tripId: string, current: PersonalRecord, signal?: AbortSignal): Promise<PersonalRecord> {
  return request(path(tripId, '/preferences/me/confirm'), { method: 'POST', headers: { 'Idempotency-Key': key() }, body: JSON.stringify({
    expectedConditionsVersion: current.conditionsVersion, expectedPreferenceVersion: current.preferenceVersion, reviewed: true,
  }) }, signal);
}

export function parsePersonal(value: unknown): PersonalRecord | null {
  if (!record(value) || !record(value.draft) || !record(value.confirmation) || !Number.isInteger(value.conditionsVersion) || !Number.isInteger(value.preferenceVersion)) return null;
  const d = value.draft;
  const text = (v: unknown) => typeof v === 'string' ? v : '';
  return { conditionsVersion: value.conditionsVersion as number, preferenceVersion: value.preferenceVersion as number,
    draft: { originalText: text(d.originalText), likes: text(d.likes), avoid: text(d.avoid), food: text(d.food), walking: text(d.walking),
      avoidImportance: d.avoidImportance === 'preferred' ? 'preferred' : 'required', foodImportance: d.foodImportance === 'required' ? 'required' : 'preferred' },
    confirmation: { status: value.confirmation.status === 'confirmed' ? 'confirmed' : 'writing',
      confirmedConditionsVersion: Number.isInteger(value.confirmation.confirmedConditionsVersion) ? value.confirmation.confirmedConditionsVersion as number : null,
      confirmedPreferenceVersion: Number.isInteger(value.confirmation.confirmedPreferenceVersion) ? value.confirmation.confirmedPreferenceVersion as number : null,
      confirmedAt: typeof value.confirmation.confirmedAt === 'string' ? value.confirmation.confirmedAt : null } };
}

export function canonicalPersonalDraft(draft: PersonalDraft): PersonalDraft {
  const clean = (value: string) => value.normalize('NFC').trim();
  return { ...draft, originalText: clean(draft.originalText), likes: clean(draft.likes), avoid: clean(draft.avoid), food: clean(draft.food), walking: clean(draft.walking) };
}
export function sameReviewedVersion(displayed: PersonalRecord, latest: PersonalRecord, sharedVersion: number): boolean {
  return displayed.conditionsVersion === sharedVersion && latest.conditionsVersion === displayed.conditionsVersion
    && latest.preferenceVersion === displayed.preferenceVersion
    && JSON.stringify(canonicalPersonalDraft(displayed.draft)) === JSON.stringify(canonicalPersonalDraft(latest.draft));
}
