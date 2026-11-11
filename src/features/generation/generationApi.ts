import { GenerationDeadlineError, withGenerationDeadline } from './generationDeadline.ts';

export type RoutePoint = { latitude: number; longitude: number };
export type Coordinate = { latitude: number; longitude: number; crs: 'WGS84' };
export type Location = { label: string; coordinate: Coordinate };
export type CommonReview = { field: 'lodging' | 'fixedSchedule'; reviewed: true; anchors: Array<{ date: string; contentid: number; position: number; startTime: string | null; endTime: string | null; arrivalDeadline: string | null; stayMinutes: number | null }> };
export type Settings = { activityWindow: { start: string; end: string }; departureAnchor: Location | null; returnAnchor: Location | null; reviewedCommonFields: CommonReview[] };
export type GenerationState = { conditionsVersion: number; inputToken: string; settingsVersion: number; settings: Settings; reviewMembers: Array<{ id: string; nickname: string; status: 'reviewNeeded' | 'reviewed' | 'stale' }>; preparationMembers?: Array<{ id: string; nickname: string; status: 'writing' | 'confirmed' }>; readyForGeneration: boolean; reasons: Array<{ code: string }>; latestJob: Job | null; latestPlan: { planId: string; versionId: string; status: string } | null };
export type Job = { id: string; kind: 'GENERATE'; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'STALE'; phase: string; planId: string | null; errorCode: string | null; createdAt: string; updatedAt: string };
export type Place = { contentid: number; title: string; address: string; planningRole: string; coordinate: Coordinate };
export type Plan = { planId: string; versionId: string; status: 'DRAFT' | 'SAVED'; lockVersion: number; versionNo: number | null; savedAt: string | null; stale: boolean; canSave: boolean; document: { days: Array<{ date: string; nodes: Array<{ id: string; nodeKey: string; kind: 'START' | 'PLACE' | 'END'; contentid: number | null; title: string; coordinate: Coordinate | null; estimatedStartAt: string | null; estimatedEndAt: string | null; estimatedCostKrw: number | null; feeLabel: string; stayMinutes: number | null; openingHoursText?: string; locked: boolean }>; edges: Array<{ id: string; fromNodeId: string; toNodeId: string; status: 'verified' | 'unknown'; geometry: RoutePoint[]; reasonCodes: string[] }> }>; validation: { status: 'verified' | 'unknown' | 'violated'; violations: Array<{ code: string; date?: string; contentid?: number }>; warnings: string[]; totalCostKrw: number | null; knownCostKrw: number } } };
export type SelfDto = { conditionsVersion: number; preferenceVersion: number; catalogDigest: string; normalization: null | { id: string; terms: Array<{ id: string; field: 'likes' | 'avoid' | 'food'; tag: string; polarity: string; importance: string; evidence: string }>; unmapped: Array<{ field: string; text: string; importance: string; reason: string }>; walking: { maxMinutes: number | null; unlimited: boolean }; needsReview: boolean }; reviewVersion: number; review: null | { acceptedTermIds: string[]; reviewedFields: Array<{ field: string; termIds: string[]; scope: string; fullyReviewed: boolean }> }; stale: boolean; preparationIssues?: Array<{ field: 'likes'|'avoid'|'food'|'walking'; code: string }> };

export class GenerationError extends Error { readonly status: number; readonly code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; } }
const base = (id: string) => `/api/v1/trips/${encodeURIComponent(id)}`;
const uuid = () => crypto.randomUUID();
async function request<T>(url: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  try {
    const send = async (requestSignal?: AbortSignal): Promise<T> => {
      const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal: requestSignal ?? signal, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
      const data: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const body = data && typeof data === 'object' && 'error' in data ? (data as { error?: { code?: string } }).error : undefined;
        const code = body?.code ?? `HTTP_${response.status}`;
        const message = code === 'VERSION_CONFLICT' || code === 'STALE_GENERATION_INPUT' ? '여행 조건이 바뀌었어요. 최신 상태를 불러온 뒤 다시 확인해 주세요.' :
          code === 'REVIEW_REQUIRED' ? '아직 확인이 필요한 조건이 있어요. 개인 조건과 공통 조건을 확인해 주세요.' :
          code === 'UNVERIFIED_ACK_REQUIRED' ? '검증되지 않은 항목이 있어요. 내용을 확인하고 저장 동의를 선택해 주세요.' :
          code === 'VALIDATION_FAILED' ? '일정 위반을 해결한 뒤 저장할 수 있어요.' : '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
        throw new GenerationError(response.status, code, message);
      }
      return data as T;
    };
    return timeoutMs ? await withGenerationDeadline(signal, timeoutMs, send) : await send(signal);
  } catch (error) {
    if (signal?.aborted || error instanceof GenerationError) throw error;
    if (error instanceof GenerationDeadlineError) throw new GenerationError(504, 'REQUEST_TIMEOUT', '서버 응답이 늦어져 요청을 멈췄어요. 다시 확인해 주세요.');
    throw new Error('여행 일정 정보를 불러오지 못했어요. 연결을 확인해 주세요.');
  }
}
export const getGeneration = (id: string, signal?: AbortSignal) => request<GenerationState>(`${base(id)}/generation`, {}, signal, 8_000);
export const getSelfReview = (id: string, signal?: AbortSignal) => request<SelfDto>(`${base(id)}/generation/preferences/me`, {}, signal);
export async function getSelfPreparationIssues(id: string, expectedConditionsVersion: number, signal?: AbortSignal): Promise<SelfDto['preparationIssues']> {
  const value = await request<SelfDto>(`${base(id)}/generation/preferences/me`, {}, signal, 6_000);
  if (value.conditionsVersion !== expectedConditionsVersion || !Array.isArray(value.preparationIssues)) return undefined;
  const fields = new Set(['likes', 'avoid', 'food', 'walking']);
  const issues = value.preparationIssues.filter(item => item?.code !== 'PERSONAL_SCHEDULE_NOT_SHARED');
  if (issues.some(item => !item || !fields.has(item.field) || typeof item.code !== 'string')) throw new GenerationError(502, 'INVALID_RESPONSE', '개인 준비 상태를 확인할 수 없어요.');
  return issues;
}
export const normalizeSelf = (id: string, cv: number, pv: number, signal?: AbortSignal) => request<SelfDto>(`${base(id)}/generation/preferences/me`, { method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: JSON.stringify({ expectedConditionsVersion: cv, expectedPreferenceVersion: pv }) }, signal);
export const putSelfReview = (id: string, body: unknown, signal?: AbortSignal) => request<SelfDto>(`${base(id)}/generation/preferences/me/review`, { method: 'PUT', body: JSON.stringify(body) }, signal);
export const saveSettings = (id: string, cv: number, sv: number, settings: Settings, signal?: AbortSignal) => request<{ settingsVersion: number; conditionsVersion: number; settings: Settings }>(`${base(id)}/generation/settings`, { method: 'PUT', body: JSON.stringify({ expectedConditionsVersion: cv, expectedSettingsVersion: sv, settings }) }, signal);
export const searchPlaces = (id: string, q: string, signal?: AbortSignal) => request<{ places: Place[] }>(`${base(id)}/generation/places?q=${encodeURIComponent(q)}&limit=20`, {}, signal);
export const createJob = (id: string, token: string, sv: number, idempotencyKey: string, signal?: AbortSignal) => request<Job>(`${base(id)}/generation/jobs`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedInputToken: token, expectedSettingsVersion: sv }) }, signal, 12_000);
export const getJob = (id: string, jobId: string, signal?: AbortSignal) => request<Job>(`${base(id)}/generation/jobs/${encodeURIComponent(jobId)}`, {}, signal, 8_000);
export const getPlan = (id: string, planId: string, signal?: AbortSignal) => request<Plan>(`${base(id)}/plans/${encodeURIComponent(planId)}`, {}, signal, 8_000);
export const savePlan = (id: string, plan: Plan, acknowledgeUnverified: boolean, signal?: AbortSignal) => request<Plan>(`${base(id)}/plans/${encodeURIComponent(plan.planId)}/save`, { method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: JSON.stringify({ versionId: plan.versionId, expectedLockVersion: plan.lockVersion, acknowledgeUnverified }) }, signal);
