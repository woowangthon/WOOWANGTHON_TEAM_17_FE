import type { AtomicCondition, AtomicPreferences, PersonalDraft, PreferenceImportance, ScheduleItem, UnresolvedAcknowledgement, UnresolvedAcknowledgements } from '../room/roomData.ts';

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
  clarifications: Array<{ itemId: string; fields: string[]; code: string; candidates: Array<{ contentid: number; title: string; address: string | null }> }>;
  unresolvedAcknowledgements: UnresolvedAcknowledgements | null;
};

export type Interpretation = {
  sourceConditionsVersion: number;
  sourcePreferenceVersion: number;
  suggestions: Omit<PersonalDraft, 'originalText'>;
  needsWalkingAnswer: boolean;
  clarifications: PersonalPreferences['clarifications'];
  analysisMeta?: { requestId: string };
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

type RequestOptions = { signal?: AbortSignal; fetcher?: typeof fetch; analysisReceipt?: string; unresolvedAcknowledgements?: UnresolvedAcknowledgements };
type SaveOptions = RequestOptions & (
  | { sourceOnly: true; analysisReceipt?: never; unresolvedAcknowledgements?: never }
  | { sourceOnly?: false; analysisReceipt?: string; unresolvedAcknowledgements?: UnresolvedAcknowledgements }
);
const keys = ['originalText', 'likes', 'avoid', 'avoidImportance', 'food', 'foodImportance', 'walking'] as const;
const errorKeys = [...keys, 'atomicPreferences'] as const;
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

function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function parseScheduleItems(value: unknown, optional = false): ScheduleItem[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > 20) return invalidDto();
  const ids = new Set<string>();
  const items = value.map((entry): ScheduleItem => {
    if (!record(entry) || Object.keys(entry).sort().join('|') !== ['id','kind','scope','placeQuery','contentid','date','time','endDate','endTime'].sort().join('|') || typeof entry.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(entry.id) || ids.has(entry.id) || (entry.kind !== 'lodging' && entry.kind !== 'appointment') || (entry.scope !== null && entry.scope !== 'personal' && entry.scope !== 'group') || typeof entry.placeQuery !== 'string' || [...entry.placeQuery].length > 200 || (entry.contentid !== null && (!Number.isInteger(entry.contentid) || (entry.contentid as number) < -2147483648 || (entry.contentid as number) > 2147483647)) || !validDate(entry.date) || !validDate(entry.endDate) || ![entry.time, entry.endTime].every(time => time === null || (typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(time)))) return invalidDto();
    ids.add(entry.id);
    return { id: entry.id, kind: entry.kind, scope: entry.scope, placeQuery: entry.placeQuery, contentid: entry.contentid as number | null, date: entry.date as string | null, time: entry.time as string | null, endDate: entry.endDate as string | null, endTime: entry.endTime as string | null };
  });
  return items;
}

function parseDraft(value: unknown): PersonalDraft {
  if (!record(value) || !([Object.keys(value).sort().join('|') === [...keys].sort().join('|'), Object.keys(value).sort().join('|') === [...keys, 'scheduleItems'].sort().join('|'), Object.keys(value).sort().join('|') === [...keys, 'scheduleItems', 'atomicPreferences'].sort().join('|'), Object.keys(value).sort().join('|') === [...keys, 'atomicPreferences'].sort().join('|')].some(Boolean))) return invalidDto();
  if (!validText(value.originalText, textLimits.originalText, true) || !validText(value.likes, textLimits.likes, true) || !validText(value.avoid, textLimits.avoid, true) || !validText(value.food, textLimits.food, true)) return invalidDto();
  if (typeof value.avoidImportance !== 'string' || !importanceValues.includes(value.avoidImportance as PreferenceImportance)) return invalidDto();
  if (typeof value.foodImportance !== 'string' || !importanceValues.includes(value.foodImportance as PreferenceImportance)) return invalidDto();
  if (value.walking !== null && (typeof value.walking !== 'string' || !walkingValues.includes(value.walking as (typeof walkingValues)[number]))) return invalidDto();
  return {
    originalText: value.originalText ?? '', likes: value.likes ?? '', avoid: value.avoid ?? '',
    avoidImportance: value.avoidImportance as PreferenceImportance, food: value.food ?? '',
    foodImportance: value.foodImportance as PreferenceImportance,
    walking: (value.walking ?? '') as PersonalDraft['walking'],
    scheduleItems: parseScheduleItems(value.scheduleItems, true),
    ...(value.atomicPreferences !== undefined ? { atomicPreferences: value.atomicPreferences === null ? null : parseAtomicPreferences(value.atomicPreferences) } : {}),
  };
}

const enums = {
  dimension: ['activity','food','walking','visit_count','meal_plan','atmosphere','accessibility','other'],
  polarity: ['prefer','avoid','limit'], priority: ['required','preferred','unspecified'],
  priorityBasis: ['explicit','unspecified','user'], scope: ['trip','day','segment','unspecified'],
  audience: ['personal','group','unspecified'], origin: ['model','user'],
  frequencyOperator: ['exact','min','max','target'], period: ['trip','day'],
} as const;
function oneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] { return typeof value === 'string' && values.includes(value); }
export function parseAtomicPreferences(value: unknown): AtomicPreferences {
  if (!record(value) || Object.keys(value).sort().join('|') !== ['schemaVersion','sourceDigest','status','conditions','unresolved'].sort().join('|') || value.schemaVersion !== 2 || typeof value.sourceDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sourceDigest) || !oneOf(value.status, ['current','stale'] as const) || !Array.isArray(value.conditions) || value.conditions.length > 80 || !Array.isArray(value.unresolved) || value.unresolved.length > 80) return invalidDto();
  const ids = new Set<string>();
  const conditions = value.conditions.map((item): AtomicCondition => {
    if (!record(item) || Object.keys(item).sort().join('|') !== ['id','dimension','target','polarity','priority','priorityBasis','scope','audience','frequency','value','unit','approximate','evidence','origin'].sort().join('|') || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !oneOf(item.dimension,enums.dimension) || typeof item.target !== 'string' || !item.target.trim() || item.target.length > 240 || !oneOf(item.polarity,enums.polarity) || !oneOf(item.priority,enums.priority) || !oneOf(item.priorityBasis,enums.priorityBasis) || !oneOf(item.scope,enums.scope) || !oneOf(item.audience,enums.audience) || (item.frequency !== null && (!record(item.frequency) || Object.keys(item.frequency).sort().join('|') !== ['count','operator','period'].sort().join('|') || !Number.isSafeInteger(item.frequency.count) || (item.frequency.count as number) < 0 || (item.frequency.count as number) > 365 || !oneOf(item.frequency.operator,enums.frequencyOperator) || !oneOf(item.frequency.period,enums.period))) || !(item.value === null || (typeof item.value === 'number' && Number.isFinite(item.value)) || (typeof item.value === 'string' && item.value.trim().length > 0 && item.value.length <= 160)) || !(item.unit === null || (typeof item.unit === 'string' && item.unit.length <= 40)) || typeof item.approximate !== 'boolean' || typeof item.evidence !== 'string' || item.evidence.length > 1000 || !oneOf(item.origin,enums.origin)) return invalidDto();
    ids.add(item.id);
    return item as unknown as AtomicCondition;
  });
  const unresolved = value.unresolved.map(item => {
    if (!record(item) || Object.keys(item).sort().join('|') !== ['code','evidence','message'].sort().join('|') || typeof item.code !== 'string' || typeof item.evidence !== 'string' || typeof item.message !== 'string' || item.code.length > 48 || item.evidence.length > 1000 || item.message.length > 240) return invalidDto();
    return { code: item.code, evidence: item.evidence, message: item.message };
  });
  return { schemaVersion: 2, sourceDigest: value.sourceDigest, status: value.status, conditions, unresolved };
}

function parseClarifications(value: unknown): PersonalPreferences['clarifications'] {
  const raw = value ?? [];
  if (!Array.isArray(raw) || raw.length > 20) return invalidDto();
  return raw.map((item) => {
    if (!record(item) || typeof item.itemId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(item.itemId) || !Array.isArray(item.fields) || item.fields.some(field => typeof field !== 'string') || typeof item.code !== 'string' || !Array.isArray(item.candidates)) return invalidDto();
    const candidates = item.candidates.map(candidate => {
      if (!record(candidate) || !Number.isInteger(candidate.contentid) || (candidate.contentid as number) < -2147483648 || (candidate.contentid as number) > 2147483647 || typeof candidate.title !== 'string' || (candidate.address !== null && typeof candidate.address !== 'string')) return invalidDto();
      return { contentid: candidate.contentid as number, title: candidate.title, address: candidate.address as string | null };
    });
    return { itemId: item.itemId, fields: item.fields as string[], code: item.code, candidates };
  });
}

export function parsePersonalPreferences(value: unknown): PersonalPreferences {
  if (!record(value) || ![ ['conditionsVersion', 'confirmation', 'draft', 'preferenceVersion'], ['conditionsVersion', 'confirmation', 'draft', 'preferenceVersion', 'clarifications'], ['conditionsVersion', 'confirmation', 'draft', 'preferenceVersion', 'unresolvedAcknowledgements'], ['conditionsVersion', 'confirmation', 'draft', 'preferenceVersion', 'clarifications', 'unresolvedAcknowledgements'] ].some(keys => Object.keys(value).sort().join('|') === [...keys].sort().join('|')) || !validVersion(value.conditionsVersion) || !validVersion(value.preferenceVersion) || !record(value.confirmation)) return invalidDto();
  const confirmation = value.confirmation;
  if (Object.keys(confirmation).sort().join('|') !== ['status', 'confirmedConditionsVersion', 'confirmedPreferenceVersion', 'confirmedAt'].sort().join('|')) return invalidDto();
  if ((confirmation.status !== 'writing' && confirmation.status !== 'confirmed') ||
      !(confirmation.confirmedConditionsVersion === null || validVersion(confirmation.confirmedConditionsVersion)) ||
      !(confirmation.confirmedPreferenceVersion === null || validVersion(confirmation.confirmedPreferenceVersion)) ||
      !(confirmation.confirmedAt === null || (typeof confirmation.confirmedAt === 'string' && !Number.isNaN(Date.parse(confirmation.confirmedAt))))) return invalidDto();
  if (confirmation.status === 'confirmed' && (confirmation.confirmedConditionsVersion !== value.conditionsVersion || confirmation.confirmedPreferenceVersion !== value.preferenceVersion || confirmation.confirmedAt === null)) return invalidDto();
  if (confirmation.status === 'writing' && (confirmation.confirmedConditionsVersion !== null || confirmation.confirmedPreferenceVersion !== null || confirmation.confirmedAt !== null)) return invalidDto();
  const clarifications = parseClarifications(value.clarifications);
  const unresolvedAcknowledgements = value.unresolvedAcknowledgements === undefined || value.unresolvedAcknowledgements === null
    ? null : parseUnresolvedAcknowledgements(value.unresolvedAcknowledgements);
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
    clarifications, unresolvedAcknowledgements,
  };
}

export function parseUnresolvedAcknowledgements(value: unknown): UnresolvedAcknowledgements {
  if (!record(value) || Object.keys(value).sort().join('|') !== ['sourceDigest','items'].sort().join('|') || typeof value.sourceDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sourceDigest) || !Array.isArray(value.items) || value.items.length > 80) return invalidDto();
  const items = value.items.map((entry): UnresolvedAcknowledgement => {
    if (!record(entry) || Object.keys(entry).sort().join('|') !== ['note','disposition'].sort().join('|') || !record(entry.note) || Object.keys(entry.note).sort().join('|') !== ['code','evidence','message'].sort().join('|') || typeof entry.note.code !== 'string' || entry.note.code.length > 48 || typeof entry.note.evidence !== 'string' || entry.note.evidence.length > 1000 || typeof entry.note.message !== 'string' || entry.note.message.length > 240 || (entry.disposition !== 'handled' && entry.disposition !== 'ignored')) return invalidDto();
    return { note: { code: entry.note.code, evidence: entry.note.evidence, message: entry.note.message }, disposition: entry.disposition };
  });
  const unique = new Set(items.map(item => `${item.note.code}\u0000${item.note.evidence}\u0000${item.note.message}`));
  if (unique.size !== items.length) return invalidDto();
  return { sourceDigest: value.sourceDigest, items };
}

export function parseInterpretation(value: unknown): Interpretation {
  const base = ['sourceConditionsVersion','sourcePreferenceVersion','suggestions','needsWalkingAnswer'];
  if (!record(value) || ![base, [...base,'clarifications'], [...base,'analysisMeta'], [...base,'clarifications','analysisMeta'], [...base,'atomicPreferences'], [...base,'clarifications','atomicPreferences'], [...base,'atomicPreferences','analysisMeta'], [...base,'clarifications','atomicPreferences','analysisMeta']].some(keys => Object.keys(value).sort().join('|') === [...keys].sort().join('|')) || !validVersion(value.sourceConditionsVersion) || !validVersion(value.sourcePreferenceVersion) || typeof value.needsWalkingAnswer !== 'boolean' || !record(value.suggestions)) return invalidDto();
  if (Object.keys(value.suggestions).filter(key => key !== 'scheduleItems' && key !== 'atomicPreferences').sort().join('|') !== ['likes', 'avoid', 'avoidImportance', 'food', 'foodImportance', 'walking'].sort().join('|')) return invalidDto();
  const scheduleItems = parseScheduleItems(value.suggestions.scheduleItems, true);
  const atomValue = value.suggestions.atomicPreferences ?? value.atomicPreferences;
  const atomicPreferences = atomValue === undefined ? undefined : parseAtomicPreferences(atomValue);
  const suggestions = parseDraft({ originalText: null, ...value.suggestions, ...(atomicPreferences ? { atomicPreferences } : {}) });
  if (suggestions.originalText !== '' || (atomicPreferences ? value.needsWalkingAnswer !== false : value.needsWalkingAnswer !== (suggestions.walking === ''))) return invalidDto();
  let analysisMeta: { requestId: string } | undefined;
  if (value.analysisMeta !== undefined) {
    if (!record(value.analysisMeta) || typeof value.analysisMeta.requestId !== 'string' || !/^[0-9a-f-]{36}$/u.test(value.analysisMeta.requestId)) return invalidDto();
    analysisMeta = { requestId: value.analysisMeta.requestId };
  }
  return {
    sourceConditionsVersion: value.sourceConditionsVersion,
    sourcePreferenceVersion: value.sourcePreferenceVersion,
    suggestions: {
      likes: suggestions.likes, avoid: suggestions.avoid, avoidImportance: suggestions.avoidImportance,
      food: suggestions.food, foodImportance: suggestions.foodImportance, walking: suggestions.walking,
      scheduleItems, ...(atomicPreferences ? { atomicPreferences } : {}),
    },
    needsWalkingAnswer: value.needsWalkingAnswer,
    clarifications: parseClarifications(value.clarifications),
    ...(analysisMeta ? { analysisMeta } : {}),
  };
}

function normalizeFieldErrors(value: unknown): Partial<Record<keyof PersonalDraft, string>> {
  if (!record(value)) return {};
  const result: Partial<Record<keyof PersonalDraft, string>> = {};
  for (const [field, message] of Object.entries(value)) {
    const normalized = field.startsWith('draft.') ? field.slice(6) : field.startsWith('suggestions.') ? field.slice(12) : field;
    if ((errorKeys as readonly string[]).includes(normalized) && typeof message === 'string') result[normalized as keyof PersonalDraft] = message;
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
  headers['X-Preference-Schema'] = '2';
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

export async function saveMyPreferences(tripId: string, expectedConditionsVersion: number, expectedPreferenceVersion: number, draft: PersonalDraft, options: SaveOptions = {}): Promise<PersonalPreferences> {
  if (!validVersion(expectedConditionsVersion) || !validVersion(expectedPreferenceVersion)) throw new Error('저장 버전을 확인할 수 없어요. 다시 불러와 주세요.');
  // A source write intentionally leaves the server's old extracted profile in place as stale.
  // Ignore profile/receipt metadata even if an untyped caller passes it at runtime.
  const sourceOnly = options.sourceOnly === true;
  const normalized = parseDraft({
    originalText: draft.originalText.trim() || null, likes: draft.likes.trim() || null,
    avoid: draft.avoid.trim() || null, avoidImportance: draft.avoidImportance,
    food: draft.food.trim() || null, foodImportance: draft.foodImportance,
    walking: draft.walking || null, scheduleItems: draft.scheduleItems ?? [],
    ...(!sourceOnly && draft.atomicPreferences !== undefined ? { atomicPreferences: draft.atomicPreferences } : {}),
  });
  const acknowledgementCommand = sourceOnly || options.unresolvedAcknowledgements === undefined ? {} : { unresolvedAcknowledgements: parseUnresolvedAcknowledgements(options.unresolvedAcknowledgements) };
  const payload = await request(path(tripId), 'PUT', { expectedConditionsVersion, expectedPreferenceVersion, ...(!sourceOnly && options.analysisReceipt ? { analysisReceipt: options.analysisReceipt } : {}), ...acknowledgementCommand, draft: {
    originalText: normalized.originalText || null, likes: normalized.likes || null, avoid: normalized.avoid || null,
    avoidImportance: normalized.avoidImportance, food: normalized.food || null, foodImportance: normalized.foodImportance,
    walking: normalized.walking || null,
    scheduleItems: normalized.scheduleItems,
    ...(!sourceOnly && normalized.atomicPreferences !== undefined ? { atomicPreferences: normalized.atomicPreferences } : {}),
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
