import type { PersonalDraft, PreferenceImportance } from '../room/roomData.ts';

export type PersonalConfirmation = {
  status: 'writing' | 'confirmed';
  confirmedConditionsVersion: number | null;
  confirmedPreferenceVersion: number | null;
  confirmedAt: string | null;
};

export type PersonalPreferences = {
  conditionsVersion: number;
  preferenceVersion: number;
  draft: PersonalDraft;
  confirmation: PersonalConfirmation;
};

export type Interpretation = {
  sourceConditionsVersion: number;
  sourcePreferenceVersion: number;
  suggestions: Omit<PersonalDraft, 'originalText'>;
  needsWalkingAnswer: boolean;
};

export class PersonalApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Partial<Record<keyof PersonalDraft, string>>;
  currentConditionsVersion?: number;
  currentPreferenceVersion?: number;
  uncertain: boolean;

  constructor(args: { status: number; code: string; message: string; fieldErrors?: Partial<Record<keyof PersonalDraft, string>>; currentConditionsVersion?: number; currentPreferenceVersion?: number; uncertain?: boolean }) {
    super(args.message);
    this.name = 'PersonalApiError';
    this.status = args.status;
    this.code = args.code;
    this.fieldErrors = args.fieldErrors ?? {};
    this.currentConditionsVersion = args.currentConditionsVersion;
    this.currentPreferenceVersion = args.currentPreferenceVersion;
    this.uncertain = args.uncertain ?? false;
  }
}

type RequestOptions = { signal?: AbortSignal; fetcher?: typeof fetch };
const keys = ['originalText', 'likes', 'avoid', 'avoidImportance', 'food', 'foodImportance', 'walking'] as const;
const importanceValues = ['required', 'preferred'] as const satisfies readonly PreferenceImportance[];
const walkingValues = ['20', '40', 'unlimited'] as const;
const textLimits = { originalText: 5000, likes: 500, avoid: 500, food: 500 } as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidDto(): never {
  throw new Error('개인 준비 응답을 확인할 수 없어요. 다시 불러와 주세요.');
}

function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validText(value: unknown, limit: number, multiline: boolean): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || [...value].length > limit) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) return false;
    if (multiline ? ((code < 0x20 && char !== '\n') || (code >= 0x7f && code <= 0x9f)) : (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029)) return false;
  }
  return true;
}

function parseDraft(value: unknown): PersonalDraft {
  if (!record(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) return invalidDto();
  if (!validText(value.originalText, textLimits.originalText, true) || !validText(value.likes, textLimits.likes, true) || !validText(value.avoid, textLimits.avoid, true) || !validText(value.food, textLimits.food, true)) return invalidDto();
  if (typeof value.avoidImportance !== 'string' || !importanceValues.includes(value.avoidImportance as PreferenceImportance)) return invalidDto();
  if (typeof value.foodImportance !== 'string' || !importanceValues.includes(value.foodImportance as PreferenceImportance)) return invalidDto();
  if (value.walking !== null && (typeof value.walking !== 'string' || !walkingValues.includes(value.walking as (typeof walkingValues)[number]))) return invalidDto();
  return {
    originalText: value.originalText ?? '', likes: value.likes ?? '', avoid: value.avoid ?? '',
    avoidImportance: value.avoidImportance as PreferenceImportance, food: value.food ?? '',
    foodImportance: value.foodImportance as PreferenceImportance,
    walking: (value.walking ?? '') as PersonalDraft['walking'],
  };
}

export function parsePersonalPreferences(value: unknown): PersonalPreferences {
  if (!record(value) || Object.keys(value).sort().join('|') !== ['conditionsVersion', 'confirmation', 'draft', 'preferenceVersion'].sort().join('|') || !validVersion(value.conditionsVersion) || !validVersion(value.preferenceVersion) || !record(value.confirmation)) return invalidDto();
  const confirmation = value.confirmation;
  if (Object.keys(confirmation).sort().join('|') !== ['status', 'confirmedConditionsVersion', 'confirmedPreferenceVersion', 'confirmedAt'].sort().join('|')) return invalidDto();
  if ((confirmation.status !== 'writing' && confirmation.status !== 'confirmed') ||
      !(confirmation.confirmedConditionsVersion === null || validVersion(confirmation.confirmedConditionsVersion)) ||
      !(confirmation.confirmedPreferenceVersion === null || validVersion(confirmation.confirmedPreferenceVersion)) ||
      !(confirmation.confirmedAt === null || (typeof confirmation.confirmedAt === 'string' && !Number.isNaN(Date.parse(confirmation.confirmedAt))))) return invalidDto();
  if (confirmation.status === 'confirmed' && (confirmation.confirmedConditionsVersion !== value.conditionsVersion || confirmation.confirmedPreferenceVersion !== value.preferenceVersion || confirmation.confirmedAt === null)) return invalidDto();
  if (confirmation.status === 'writing' && (confirmation.confirmedConditionsVersion !== null || confirmation.confirmedPreferenceVersion !== null || confirmation.confirmedAt !== null)) return invalidDto();
  return {
    conditionsVersion: value.conditionsVersion,
    preferenceVersion: value.preferenceVersion,
    draft: parseDraft(value.draft),
    confirmation: {
      status: confirmation.status,
      confirmedConditionsVersion: confirmation.confirmedConditionsVersion,
      confirmedPreferenceVersion: confirmation.confirmedPreferenceVersion,
      confirmedAt: confirmation.confirmedAt,
    },
  };
}

export function parseInterpretation(value: unknown): Interpretation {
  if (!record(value) || Object.keys(value).sort().join('|') !== ['sourceConditionsVersion', 'sourcePreferenceVersion', 'suggestions', 'needsWalkingAnswer'].sort().join('|') || !validVersion(value.sourceConditionsVersion) || !validVersion(value.sourcePreferenceVersion) || typeof value.needsWalkingAnswer !== 'boolean' || !record(value.suggestions)) return invalidDto();
  if (Object.keys(value.suggestions).sort().join('|') !== ['likes', 'avoid', 'avoidImportance', 'food', 'foodImportance', 'walking'].sort().join('|')) return invalidDto();
  const suggestions = parseDraft({ originalText: null, ...value.suggestions });
  if (suggestions.originalText !== '' || value.needsWalkingAnswer !== (suggestions.walking === '')) return invalidDto();
  return {
    sourceConditionsVersion: value.sourceConditionsVersion,
    sourcePreferenceVersion: value.sourcePreferenceVersion,
    suggestions: {
      likes: suggestions.likes, avoid: suggestions.avoid, avoidImportance: suggestions.avoidImportance,
      food: suggestions.food, foodImportance: suggestions.foodImportance, walking: suggestions.walking,
    },
    needsWalkingAnswer: value.needsWalkingAnswer,
  };
}

function normalizeFieldErrors(value: unknown): Partial<Record<keyof PersonalDraft, string>> {
  if (!record(value)) return {};
  const result: Partial<Record<keyof PersonalDraft, string>> = {};
  for (const [field, message] of Object.entries(value)) {
    const normalized = field.startsWith('draft.') ? field.slice(6) : field.startsWith('suggestions.') ? field.slice(12) : field;
    if ((keys as readonly string[]).includes(normalized) && typeof message === 'string') result[normalized as keyof PersonalDraft] = message;
  }
  return result;
}

async function errorFromResponse(response: Response): Promise<PersonalApiError> {
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  const body = record(payload) && record(payload.error) ? payload.error : {};
  const code = typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
  const safeMessage = typeof body.message === 'string' && body.message.trim() ? body.message : '개인 준비 정보를 저장하지 못했어요. 다시 확인해 주세요.';
  return new PersonalApiError({
    status: response.status, code, message: safeMessage, fieldErrors: normalizeFieldErrors(body.fieldErrors),
    ...(validVersion(body.currentConditionsVersion) ? { currentConditionsVersion: body.currentConditionsVersion } : {}),
    ...(validVersion(body.currentPreferenceVersion) ? { currentPreferenceVersion: body.currentPreferenceVersion } : {}),
  });
}

function abortError(): DOMException { return new DOMException('The operation was aborted.', 'AbortError'); }

async function request(path: string, method: string, body: unknown, options: RequestOptions, idempotencyKey?: string): Promise<unknown> {
  if (options.signal?.aborted) throw abortError();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  try {
    const response = await (options.fetcher ?? fetch)(path, {
      method, ...(Object.keys(headers).length ? { headers } : {}), ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    return await response.json();
  } catch (error) {
    if (error instanceof PersonalApiError) throw error;
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
    if (error instanceof SyntaxError) throw new PersonalApiError({ status: 0, code: 'INVALID_RESPONSE', message: '서버 응답을 확인할 수 없어요. 다시 불러와 주세요.', uncertain: method !== 'GET' });
    throw new PersonalApiError({ status: 0, code: 'NETWORK_ERROR', message: method === 'GET' ? '개인 준비 정보를 불러오지 못했어요. 연결을 확인해 주세요.' : '저장 결과를 확인할 수 없어요. 입력을 보존했어요. 다시 불러와 주세요.', uncertain: method !== 'GET' });
  }
}

function path(tripId: string): string {
  if (!tripId.trim()) throw new Error('여행방 정보를 확인할 수 없어요. 다시 시도해 주세요.');
  return `/api/v1/trips/${encodeURIComponent(tripId)}/preferences/me`;
}

export async function fetchMyPreferences(tripId: string, options: RequestOptions = {}): Promise<PersonalPreferences> {
  return parsePersonalPreferences(await request(path(tripId), 'GET', undefined, options));
}

export async function saveMyPreferences(tripId: string, expectedConditionsVersion: number, expectedPreferenceVersion: number, draft: PersonalDraft, options: RequestOptions = {}): Promise<PersonalPreferences> {
  if (!validVersion(expectedConditionsVersion) || !validVersion(expectedPreferenceVersion)) throw new Error('저장 버전을 확인할 수 없어요. 다시 불러와 주세요.');
  const normalized = parseDraft({
    originalText: draft.originalText.trim() || null, likes: draft.likes.trim() || null,
    avoid: draft.avoid.trim() || null, avoidImportance: draft.avoidImportance,
    food: draft.food.trim() || null, foodImportance: draft.foodImportance,
    walking: draft.walking || null,
  });
  const payload = await request(path(tripId), 'PUT', { expectedConditionsVersion, expectedPreferenceVersion, draft: {
    originalText: normalized.originalText || null, likes: normalized.likes || null, avoid: normalized.avoid || null,
    avoidImportance: normalized.avoidImportance, food: normalized.food || null, foodImportance: normalized.foodImportance,
    walking: normalized.walking || null,
  } }, options);
  try { return parsePersonalPreferences(payload); }
  catch { throw new PersonalApiError({ status: 0, code: 'INVALID_WRITE_RESPONSE', message: '저장 결과를 확인할 수 없어요. 입력은 유지했어요. 새로고침해 최신 상태를 확인해 주세요.', uncertain: true }); }
}

export async function confirmMyPreferences(tripId: string, expectedConditionsVersion: number, expectedPreferenceVersion: number, options: RequestOptions = {}): Promise<PersonalPreferences> {
  if (!validVersion(expectedConditionsVersion) || !validVersion(expectedPreferenceVersion)) throw new Error('확인 버전을 확인할 수 없어요. 다시 불러와 주세요.');
  const payload = await request(`${path(tripId)}/confirm`, 'POST', {
    expectedConditionsVersion, expectedPreferenceVersion, reviewed: true,
  }, options);
  try {
    const result = parsePersonalPreferences(payload);
    if (result.confirmation.status !== 'confirmed' ||
        result.conditionsVersion !== expectedConditionsVersion ||
        result.preferenceVersion !== expectedPreferenceVersion ||
        result.confirmation.confirmedConditionsVersion !== expectedConditionsVersion ||
        result.confirmation.confirmedPreferenceVersion !== expectedPreferenceVersion) return invalidDto();
    return result;
  } catch {
    throw new PersonalApiError({ status: 0, code: 'INVALID_CONFIRM_RESPONSE', message: '확인 결과를 확인할 수 없어요. 최신 상태를 다시 불러와 주세요.', uncertain: true });
  }
}

export async function interpretMyPreferences(tripId: string, expectedConditionsVersion: number, expectedPreferenceVersion: number, options: RequestOptions = {}): Promise<Interpretation> {
  if (!validVersion(expectedConditionsVersion) || !validVersion(expectedPreferenceVersion)) throw new Error('해석 버전을 확인할 수 없어요. 다시 불러와 주세요.');
  const idempotencyKey = globalThis.crypto?.randomUUID?.();
  if (!idempotencyKey) throw new Error('안전한 요청 키를 만들 수 없어요. 다시 시도해 주세요.');
  return parseInterpretation(await request(`${path(tripId)}/interpret`, 'POST', { expectedConditionsVersion, expectedPreferenceVersion }, options, idempotencyKey));
}
