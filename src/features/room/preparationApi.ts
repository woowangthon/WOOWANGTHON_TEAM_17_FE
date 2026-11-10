import type { RoomDraft } from './roomData.ts';
import { validateRoomDraft } from './roomData.ts';

export type ServerConditions = {
  region: string | null;
  startDate: string | null;
  endDate: string | null;
  expectedPeople: number | null;
  budget: number | null;
  transport: 'car' | 'transit' | 'charter' | 'walk' | null;
  departure: string | null;
  departureTime: string;
  departureContentid: number | null;
  returnRoute: string | null;
  lodging: string | null;
  fixedSchedule: string | null;
};

export type Preparation = {
  trip: { id: string; name: string; status: 'OPEN'; inviteCode: string };
  currentMember: { id: string; nickname: string; role: 'OWNER' | 'MEMBER' };
  canEditConditions: boolean;
  conditionsVersion: number;
  conditions: ServerConditions;
  activeMemberCount: number;
  members: Array<{ id: string; nickname: string; role: 'OWNER' | 'MEMBER'; preparationStatus: 'writing' | 'confirmed' }>;
  readiness: {
    conditionsReady: boolean;
    reasons: Array<{
      code: 'CONDITIONS_INCOMPLETE' | 'MEMBER_COUNT_MISMATCH' | 'PREFERENCES_UNCONFIRMED';
      fields?: Array<keyof ServerConditions>;
      memberId?: string;
    }>;
  };
};

export class PreparationHttpError extends Error {
  status: number;
  code: string;
  fieldErrors: Partial<Record<keyof RoomDraft, string>>;
  currentConditionsVersion?: number;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: Partial<Record<keyof RoomDraft, string>>;
    currentConditionsVersion?: number;
  }) {
    super(args.message);
    this.name = 'PreparationHttpError';
    this.status = args.status;
    this.code = args.code;
    this.fieldErrors = args.fieldErrors ?? {};
    this.currentConditionsVersion = args.currentConditionsVersion;
  }
}

type RequestOptions = { signal?: AbortSignal; fetcher?: typeof fetch };
const conditionFields = [
  'region', 'startDate', 'endDate', 'expectedPeople', 'budget', 'transport',
  'departure', 'departureTime', 'departureContentid', 'returnRoute', 'lodging', 'fixedSchedule',
] as const satisfies readonly (keyof ServerConditions)[];
const draftTextLimits = { region: 100, departure: 100, returnRoute: 100, lodging: 200, fixedSchedule: 500 } as const;
const roleValues = ['OWNER', 'MEMBER'] as const;
const transportValues = ['car', 'transit', 'charter', 'walk'] as const;
const readinessCodes = ['CONDITIONS_INCOMPLETE', 'MEMBER_COUNT_MISMATCH', 'PREFERENCES_UNCONFIRMED'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function invalidDto(): never {
  throw new Error('여행 준비 응답을 확인할 수 없어요. 다시 불러와 주세요.');
}

function parseConditions(value: unknown): ServerConditions {
  if (!isRecord(value)) return invalidDto();
const textFields = ['region', 'startDate', 'endDate', 'departure', 'returnRoute', 'lodging', 'fixedSchedule'] as const;
  for (const field of textFields) {
    const item = value[field];
    if (item !== null && typeof item !== 'string') return invalidDto();
  }
  const expectedPeople = value.expectedPeople;
  const budget = value.budget;
  if (expectedPeople !== null && (!Number.isInteger(expectedPeople) || (expectedPeople as number) < 1 || (expectedPeople as number) > 50)) return invalidDto();
  if (budget !== null && (!Number.isInteger(budget) || (budget as number) < 1 || (budget as number) > 1_000_000_000)) return invalidDto();
  const transport = value.transport;
  if (transport !== null && (typeof transport !== 'string' || !transportValues.includes(transport as (typeof transportValues)[number]))) return invalidDto();
  const departureTime = value.departureTime === undefined ? '09:00' : value.departureTime;
  const departureContentid = value.departureContentid === undefined ? null : value.departureContentid;
  if (typeof departureTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(departureTime) || (departureContentid !== null && (!Number.isInteger(departureContentid) || (departureContentid as number) < -2147483648 || (departureContentid as number) > 2147483647))) return invalidDto();
  const conditions: ServerConditions = {
    region: value.region as string | null,
    startDate: value.startDate as string | null,
    endDate: value.endDate as string | null,
    expectedPeople: expectedPeople as number | null,
    budget: budget as number | null,
    transport: transport as ServerConditions['transport'],
    departure: value.departure as string | null,
    departureTime,
    departureContentid: departureContentid as number | null,
    returnRoute: value.returnRoute as string | null,
    lodging: value.lodging as string | null,
    fixedSchedule: value.fixedSchedule as string | null,
  };
  for (const [field, limit] of Object.entries(draftTextLimits) as Array<[keyof typeof draftTextLimits, number]>) {
    const item = conditions[field];
    if (item !== null && [...item].length > limit) return invalidDto();
  }
  if (Boolean(conditions.startDate) !== Boolean(conditions.endDate)) return invalidDto();
  if (conditions.startDate && (!validDate(conditions.startDate) || !validDate(conditions.endDate ?? ''))) return invalidDto();
  if (conditions.startDate && conditions.endDate && conditions.startDate > conditions.endDate) return invalidDto();
  return conditions;
}

function parseMember(value: unknown): Preparation['members'][number] {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.nickname) || typeof value.role !== 'string' || !roleValues.includes(value.role as (typeof roleValues)[number]) || (value.preparationStatus !== 'writing' && value.preparationStatus !== 'confirmed')) return invalidDto();
  return { id: value.id, nickname: value.nickname, role: value.role as 'OWNER' | 'MEMBER', preparationStatus: value.preparationStatus };
}

function parsePreparation(value: unknown): Preparation {
  if (!isRecord(value) || !isRecord(value.trip) || !isRecord(value.currentMember) || !isRecord(value.readiness)) return invalidDto();
  const tripValue = value.trip;
  const memberValue = value.currentMember;
  if (!isNonEmptyString(tripValue.id) || !isNonEmptyString(tripValue.name) || tripValue.status !== 'OPEN' || !isNonEmptyString(tripValue.inviteCode)) return invalidDto();
  if (!isNonEmptyString(memberValue.id) || !isNonEmptyString(memberValue.nickname) || typeof memberValue.role !== 'string' || !roleValues.includes(memberValue.role as (typeof roleValues)[number])) return invalidDto();
  if (typeof value.canEditConditions !== 'boolean' || value.canEditConditions !== (memberValue.role === 'OWNER')) return invalidDto();
  if (!Number.isInteger(value.conditionsVersion) || (value.conditionsVersion as number) < 0) return invalidDto();
  const conditions = parseConditions(value.conditions);
  if (!Array.isArray(value.members)) return invalidDto();
  const members = value.members.map(parseMember);
  if (members.length === 0 || !Number.isInteger(value.activeMemberCount) || value.activeMemberCount !== members.length) return invalidDto();
  const ids = new Set(members.map(({ id }) => id));
  if (ids.size !== members.length || !ids.has(memberValue.id)) return invalidDto();
  if (typeof value.readiness.conditionsReady !== 'boolean' || !Array.isArray(value.readiness.reasons)) return invalidDto();
  const reasons: Preparation['readiness']['reasons'] = value.readiness.reasons.map((reason) => {
    if (!isRecord(reason) || typeof reason.code !== 'string' || !readinessCodes.includes(reason.code as (typeof readinessCodes)[number])) return invalidDto();
    if (reason.fields !== undefined && (!Array.isArray(reason.fields) || reason.fields.some((field) => typeof field !== 'string' || !conditionFields.includes(field as (typeof conditionFields)[number])))) return invalidDto();
    if (reason.memberId !== undefined && !isNonEmptyString(reason.memberId)) return invalidDto();
    return {
      code: reason.code as (typeof readinessCodes)[number],
      ...(reason.fields !== undefined ? { fields: reason.fields as Array<keyof ServerConditions> } : {}),
      ...(reason.memberId !== undefined ? { memberId: reason.memberId } : {}),
    };
  });
  return {
    trip: { id: tripValue.id, name: tripValue.name, status: 'OPEN', inviteCode: tripValue.inviteCode },
    currentMember: { id: memberValue.id, nickname: memberValue.nickname, role: memberValue.role as 'OWNER' | 'MEMBER' },
    canEditConditions: value.canEditConditions,
    conditionsVersion: value.conditionsVersion as number,
    conditions,
    activeMemberCount: members.length,
    members,
    readiness: { conditionsReady: value.readiness.conditionsReady, reasons },
  };
}

function conditionsToDraft(conditions: ServerConditions): RoomDraft {
  return {
    region: conditions.region ?? '',
    startDate: conditions.startDate ?? '',
    endDate: conditions.endDate ?? '',
    expectedPeople: conditions.expectedPeople === null ? '' : String(conditions.expectedPeople),
    budget: conditions.budget === null ? '' : String(conditions.budget),
    transport: conditions.transport ?? 'undecided',
    departure: conditions.departure ?? '',
    departureTime: conditions.departureTime || '09:00',
    departureContentid: conditions.departureContentid === null ? '' : String(conditions.departureContentid),
    returnRoute: conditions.returnRoute ?? '',
    lodging: conditions.lodging ?? '',
    fixedSchedule: conditions.fixedSchedule ?? '',
  };
}

function draftToConditions(draft: RoomDraft): ServerConditions {
  const errors = validateRoomDraft(draft);
  for (const field of Object.keys(draftTextLimits) as Array<keyof typeof draftTextLimits>) {
    if ([...(draft[field] as string).trim()].length > draftTextLimits[field]) errors[field] = `최대 ${draftTextLimits[field]}자까지 입력할 수 있어요.`;
  }
  if (Object.keys(errors).length > 0) {
    throw new PreparationHttpError({ status: 400, code: 'INVALID_CONDITIONS', message: '입력한 여행 조건을 확인해 주세요.', fieldErrors: errors });
  }
  const integerOrNull = (raw: string): number | null => raw.trim() === '' ? null : Number(raw.trim());
  const departureContentid = integerOrNull(draft.departureContentid);
  if (draft.departureTime && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(draft.departureTime)) errors.departureTime = '출발 시간을 확인해 주세요.';
  if (draft.departureContentid.trim() && (!/^-?\d+$/u.test(draft.departureContentid.trim()) || departureContentid === null || departureContentid < -2147483648 || departureContentid > 2147483647)) errors.departureContentid = '장소 검색 결과를 선택해 주세요.';
  return {
    region: draft.region.trim() || null,
    startDate: draft.startDate.trim() || null,
    endDate: draft.endDate.trim() || null,
    expectedPeople: integerOrNull(draft.expectedPeople),
    budget: integerOrNull(draft.budget),
    transport: draft.transport === 'undecided' ? null : draft.transport,
    departure: draft.departure.trim() || null,
    departureTime: draft.departureTime || '09:00',
    departureContentid,
    returnRoute: draft.returnRoute.trim() || null,
    lodging: draft.lodging.trim() || null,
    fixedSchedule: draft.fixedSchedule.trim() || null,
  };
}

export { conditionsToDraft, draftToConditions };

function normalizeFieldErrors(value: unknown): Partial<Record<keyof RoomDraft, string>> {
  if (!isRecord(value)) return {};
  const normalized: Partial<Record<keyof RoomDraft, string>> = {};
  for (const [rawField, message] of Object.entries(value)) {
    const field = rawField.startsWith('conditions.') ? rawField.slice('conditions.'.length) : rawField;
    if ((conditionFields as readonly string[]).includes(field) && typeof message === 'string') normalized[field as keyof RoomDraft] = message;
  }
  return normalized;
}

async function responseError(response: Response): Promise<PreparationHttpError> {
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  const body = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const code = typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
  const message = typeof body.message === 'string' && body.message.trim() ? body.message : '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
  const version = body.currentConditionsVersion;
  return new PreparationHttpError({
    status: response.status,
    code,
    message,
    fieldErrors: normalizeFieldErrors(body.fieldErrors),
    ...(Number.isInteger(version) && (version as number) >= 0 ? { currentConditionsVersion: version as number } : {}),
  });
}

function abortError(signal?: AbortSignal): DOMException {
  if (signal?.reason instanceof DOMException && signal.reason.name === 'AbortError') return signal.reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function requestJson(path: string, init: RequestInit, options: RequestOptions): Promise<unknown> {
  if (options.signal?.aborted) throw abortError(options.signal);
  try {
    const response = await (options.fetcher ?? fetch)(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: options.signal });
    if (!response.ok) throw await responseError(response);
    return await response.json();
  } catch (error) {
    if (error instanceof PreparationHttpError) throw error;
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError(options.signal);
    if (error instanceof SyntaxError) throw new Error('서버 응답을 읽을 수 없어요. 잠시 후 다시 시도해 주세요.');
    throw new Error('여행 준비 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  }
}

function tripPath(tripId: string): string {
  if (!tripId.trim()) throw new Error('여행방 정보를 확인할 수 없어요. 다시 시도해 주세요.');
  return `/api/v1/trips/${encodeURIComponent(tripId)}`;
}

export async function fetchPreparation(tripId: string, options: RequestOptions = {}): Promise<Preparation> {
  const payload = await requestJson(`${tripPath(tripId)}/preparation`, { method: 'GET' }, options);
  return parsePreparation(payload);
}

export async function saveSharedConditions(
  tripId: string,
  expectedVersion: number,
  draft: RoomDraft,
  options: RequestOptions = {},
): Promise<{ conditionsVersion: number; conditions: ServerConditions; requiresReconfirmation: boolean }> {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('여행 조건 버전을 확인할 수 없어요. 다시 불러와 주세요.');
  const conditions = draftToConditions(draft);
  const payload = await requestJson(`${tripPath(tripId)}/conditions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedConditionsVersion: expectedVersion, conditions }),
  }, options);
  if (!isRecord(payload) || !Number.isInteger(payload.conditionsVersion) || (payload.conditionsVersion as number) < 0 || typeof payload.requiresReconfirmation !== 'boolean') return invalidDto();
  return {
    conditionsVersion: payload.conditionsVersion as number,
    conditions: parseConditions(payload.conditions),
    requiresReconfirmation: payload.requiresReconfirmation,
  };
}
