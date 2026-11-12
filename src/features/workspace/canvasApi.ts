import { isCanonicalCanvasUuid, parseCanvasDocument, type CanvasPlaceDetail, type CanvasState, type CanvasDocument } from './canvasModel.ts';
import { parseCanvasRoute, type CanvasRoute, type CanvasRouteInput } from './canvasRoutes.ts';

export class CanvasHttpError extends Error {
  status: number; code: string; current?: CanvasState;
  constructor(status: number, code: string, message: string, current?: CanvasState) { super(message); this.status = status; this.code = code; this.current = current; this.name = 'CanvasHttpError'; }
}
type Options = { signal?: AbortSignal; fetcher?: typeof fetch };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const exactKeys=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const placeKeys=['contentid','title','address','adminCity','category','planningRole','coordinate','overviewText','menuText','openingHoursText','closedDaysText','feeText','bookingText','parkingText','tel','homepageUrl'];
const optionalPlaceKeys=['estimatedStayMinutes','imageUrl','firstimage','priceLabel'];
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null; }
  catch { return null; }
}
function parsePlace(value: unknown): CanvasPlaceDetail | null {
  const hasEstimatedStay = isRecord(value) && Object.hasOwn(value, 'estimatedStayMinutes');
  if (!isRecord(value) || !placeKeys.every(key => Object.hasOwn(value, key))
    || Object.keys(value).some(key => !placeKeys.includes(key) && !optionalPlaceKeys.includes(key))) return null;
  const strings = ['title'] as const; if (!strings.every((key) => typeof value[key] === 'string') || typeof value.contentid !== 'number' || !Number.isInteger(value.contentid) || value.contentid < -2147483648 || value.contentid > 2147483647) return null;
  const nullable = ['address','adminCity','category','planningRole','overviewText','menuText','openingHoursText','closedDaysText','feeText','bookingText','parkingText','tel','homepageUrl'];
  if (!nullable.every((key) => nullableText(value[key]))
    || ['imageUrl','firstimage','priceLabel'].some(key => Object.hasOwn(value, key) && !nullableText(value[key]))) return null;
  const estimatedStay = value.estimatedStayMinutes;
  if (hasEstimatedStay && !(estimatedStay === null || (typeof estimatedStay === 'number' && Number.isInteger(estimatedStay) && estimatedStay >= 1 && estimatedStay <= 1440))) return null;
  let coordinate: CanvasPlaceDetail['coordinate'] = null;
  if (value.coordinate !== null) { if (!isRecord(value.coordinate) || !exactKeys(value.coordinate,['latitude','longitude','crs']) || typeof value.coordinate.latitude !== 'number' || !Number.isFinite(value.coordinate.latitude) || Math.abs(value.coordinate.latitude)>90 || typeof value.coordinate.longitude !== 'number' || !Number.isFinite(value.coordinate.longitude) || Math.abs(value.coordinate.longitude)>180 || value.coordinate.crs !== 'WGS84') return null; coordinate = { latitude: value.coordinate.latitude, longitude: value.coordinate.longitude, crs: 'WGS84' }; }
  const safeHomepage = safeHttpUrl(value.homepageUrl);
  const hasImage = Object.hasOwn(value, 'imageUrl') || Object.hasOwn(value, 'firstimage');
  const safeImage = safeHttpUrl(value.imageUrl ?? value.firstimage);
  return { contentid: value.contentid, title: value.title as string, address: value.address as string | null, adminCity: value.adminCity as string | null, category: value.category as string | null, planningRole: value.planningRole as string | null, coordinate, overviewText: value.overviewText as string | null, menuText: value.menuText as string | null, openingHoursText: value.openingHoursText as string | null, closedDaysText: value.closedDaysText as string | null, feeText: value.feeText as string | null, ...(Object.hasOwn(value, 'priceLabel') ? { priceLabel: value.priceLabel as string | null } : {}), bookingText: value.bookingText as string | null, parkingText: value.parkingText as string | null, tel: value.tel as string | null, homepageUrl: safeHomepage, ...(hasImage ? { imageUrl: safeImage } : {}), ...(hasEstimatedStay ? { estimatedStayMinutes: estimatedStay as number | null } : {}) };
}
export function parseCanvasState(value: unknown): CanvasState | null {
  if (!isRecord(value) || !exactKeys(value,['tripId','revision','document','places','sourcePlan','updatedAt']) || !isCanonicalCanvasUuid(value.tripId) || !Number.isInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.places) || !value.places.every((x) => parsePlace(x)) || !(value.sourcePlan === null || (isRecord(value.sourcePlan) && exactKeys(value.sourcePlan,['planId','versionId'])&&isCanonicalCanvasUuid(value.sourcePlan.planId)&&isCanonicalCanvasUuid(value.sourcePlan.versionId))) || typeof value.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value.updatedAt) || Number.isNaN(Date.parse(value.updatedAt))) return null;
  if(new Set(value.places.map(item=>(item as Record<string,unknown>).contentid)).size!==value.places.length)return null;
  const document = parseCanvasDocument(value.document); if (!document) return null;
  const referencedPlaces=new Set(document.nodes.flatMap(node=>node.kind==='place'?[node.contentid]:[]));if(referencedPlaces.size!==value.places.length||value.places.some(item=>!referencedPlaces.has((item as Record<string,unknown>).contentid as number)))return null;
  return { tripId: value.tripId, revision: value.revision as number, document, places: value.places.map((x) => parsePlace(x)!), sourcePlan: value.sourcePlan as CanvasState['sourcePlan'], updatedAt: value.updatedAt };
}
async function request(path: string, init: RequestInit, options: Options): Promise<unknown> {
  let response: Response;
  try { const fetcher = options.fetcher ?? ((input: RequestInfo | URL, config?: RequestInit) => globalThis.fetch(input, config)); const headers = new Headers(init.headers); headers.set('X-Canvas-Version', '4'); response = await fetcher(path, { ...init, headers, credentials: 'include', cache: 'no-store', signal: options.signal }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new CanvasHttpError(0, 'NETWORK_ERROR', '서버에 연결하지 못했어요. 입력은 이 화면에 보관하고 있어요.'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string' ? body.error.code : 'CANVAS_UNAVAILABLE';
    let isV4CanvasWrite = false;
    if (init.method === 'PUT' && typeof init.body === 'string') {
      try { const sent = JSON.parse(init.body) as unknown; isV4CanvasWrite = isRecord(sent) && isRecord(sent.document) && sent.document.schemaVersion === 4; }
      catch { /* malformed local request keeps the generic validation message */ }
    }
    const message = code === 'VERSION_CONFLICT' ? '다른 참여자가 먼저 저장했어요.'
      : code === 'SCHEMA_VERSION_CONFLICT' ? '저장하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.'
      : code === 'SCHEMA_MIGRATION_REQUIRED' ? 'DB에 날짜 편집 저장 업데이트(005)가 필요해요. 관리자에게 확인해 주세요.'
      : code === 'PLACE_NOT_FOUND' ? '장소 정보를 찾지 못했어요.'
      : code === 'VALIDATION_ERROR' && response.status < 500 && isV4CanvasWrite ? '캔버스 저장 형식을 처리하지 못했어요. 실행 중인 run.py가 이전 버전일 수 있어요. run.py를 다시 시작한 뒤 이 초안을 다시 시도해 주세요. 변경 내용은 보관 중이에요.'
      : code === 'VALIDATION_ERROR' && response.status < 500 && init.method === 'PUT' ? '저장 요청을 확인하지 못했어요. 입력한 변경 내용은 화면에 보관돼 있어요.'
      : response.status >= 500 ? '캔버스 서버를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.'
      : '요청을 처리하지 못했어요.';
    throw new CanvasHttpError(response.status, code, message, isRecord(body) ? parseCanvasState(body.current) ?? undefined : undefined);
  }
  return body;
}
const pathFor = (tripId: string) => `/api/v1/trips/${encodeURIComponent(tripId)}`;
export async function getCanvas(tripId: string, options: Options = {}): Promise<CanvasState> { const value = parseCanvasState(await request(`${pathFor(tripId)}/canvas`, { method: 'GET' }, options)); if (!value || value.tripId !== tripId) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '캔버스 응답을 읽을 수 없어요.'); return value; }
export async function saveCanvas(tripId: string, expectedRevision: number, expectedSourcePlan: CanvasState['sourcePlan'], document: CanvasDocument, idempotencyKey: string, options: Options = {}): Promise<CanvasState> { if(!isCanonicalCanvasUuid(idempotencyKey)||!Number.isInteger(expectedRevision)||expectedRevision<0)throw new CanvasHttpError(400,'VALIDATION_ERROR','저장 요청 정보를 확인해 주세요.');const value = parseCanvasState(await request(`${pathFor(tripId)}/canvas`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedRevision, expectedSourcePlan, document }) }, options)); if (!value || value.tripId !== tripId) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '캔버스 저장 응답을 읽을 수 없어요.'); return value; }
export async function importPlanToCanvas(tripId: string, planId: string, versionId: string, expectedCanvasRevision: number, idempotencyKey: string, options: Options = {}): Promise<CanvasState> {
  if (!isCanonicalCanvasUuid(tripId) || !isCanonicalCanvasUuid(planId) || !isCanonicalCanvasUuid(versionId) || !isCanonicalCanvasUuid(idempotencyKey) || !Number.isSafeInteger(expectedCanvasRevision) || expectedCanvasRevision < 0) throw new CanvasHttpError(400, 'VALIDATION_ERROR', '일정 가져오기 정보를 확인해 주세요.');
  const value = parseCanvasState(await request(`${pathFor(tripId)}/plans/${encodeURIComponent(planId)}/canvas`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ versionId, expectedCanvasRevision }) }, options));
  if (!value || value.tripId !== tripId || value.sourcePlan?.planId !== planId || value.sourcePlan.versionId !== versionId) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '가져온 일정 응답을 확인할 수 없어요.');
  return value;
}
export type PlaceSearchResult = { contentid: number; title: string; address: string | null; category: string | null };
export async function searchPlaces(tripId: string, query: string, signal?: AbortSignal): Promise<PlaceSearchResult[]> {
  const url = `${pathFor(tripId)}/generation/places?q=${encodeURIComponent(query)}&limit=20`;
  const body = await request(url, { method: 'GET' }, { signal });
  const raw = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.places) ? body.places : null;
  if (!raw) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '장소 검색 응답을 읽을 수 없어요.');
  return raw.flatMap((item): PlaceSearchResult[] => isRecord(item) && typeof item.contentid === 'number' && Number.isInteger(item.contentid) && item.contentid >= -2147483648 && item.contentid <= 2147483647 && typeof item.title === 'string' ? [{ contentid: item.contentid, title: item.title, address: typeof item.address === 'string' ? item.address : null, category: typeof item.category === 'string' ? item.category : null }] : []);
}
export async function getPlaceDetail(tripId: string, contentid: number, signal?: AbortSignal): Promise<CanvasPlaceDetail> { const value = parsePlace(await request(`${pathFor(tripId)}/canvas/places/${contentid}`, { method: 'GET' }, { signal })); if (!value||value.contentid!==contentid) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '장소 상세 응답을 읽을 수 없어요.'); return value; }
export async function getCanvasRoute(input: CanvasRouteInput, signal?: AbortSignal, options: Options = {}): Promise<CanvasRoute> {
  if (!isCanonicalCanvasUuid(input.tripId) || !Number.isSafeInteger(input.conditionsVersion) || input.conditionsVersion < 0 || input.conditionsVersion > 4294967295 || !Number.isInteger(input.sourceContentid) || input.sourceContentid < -2147483648 || input.sourceContentid > 2147483647 || !Number.isInteger(input.targetContentid) || input.targetContentid < -2147483648 || input.targetContentid > 2147483647 || !['car', 'walk', 'transit', 'charter', null].includes(input.mode)
    || (input.modeOverride !== undefined && (!['car', 'walk', 'transit', 'charter'].includes(input.modeOverride) || input.modeOverride !== input.mode))) {
    throw new CanvasHttpError(400, 'VALIDATION_ERROR', '경로 조회 정보를 확인해 주세요.');
  }
  const query = new URLSearchParams({ sourceContentid: String(input.sourceContentid), targetContentid: String(input.targetContentid), expectedConditionsVersion: String(input.conditionsVersion) });
  if (input.modeOverride) query.set('mode', input.modeOverride);
  const value = await request(`${pathFor(input.tripId)}/canvas/route?${query}`, { method: 'GET' }, { ...options, signal });
  const route = parseCanvasRoute(value, input);
  if (!route) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '경로 응답의 조건이나 장소가 일치하지 않아요.');
  return route;
}
export async function recommendPlace(tripId: string, prompt: string, dayId: string, excludeContentids: number[], idempotencyKey: string, signal?: AbortSignal): Promise<{ place: CanvasPlaceDetail; alternatives: CanvasPlaceDetail[]; requiresReview: true }> {
  if(!isCanonicalCanvasUuid(tripId)||!isCanonicalCanvasUuid(dayId)||!isCanonicalCanvasUuid(idempotencyKey)||![...prompt].length||[...prompt].length>1000||!excludeContentids.every(id=>Number.isInteger(id)&&id>=-2147483648&&id<=2147483647)||excludeContentids.length>100)throw new CanvasHttpError(400,'VALIDATION_ERROR','추천 요청 정보를 확인해 주세요.');
  const body = await request(`${pathFor(tripId)}/canvas/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ prompt, dayId, excludeContentids }) }, { signal });
  if (!isRecord(body) || body.requiresReview !== true) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '추천 응답을 읽을 수 없어요.');
  const place = parsePlace(body.place); const alternatives = Array.isArray(body.alternatives)&&body.alternatives.length<=5 ? body.alternatives.map(parsePlace) : null; if (!place || !alternatives || alternatives.some((x) => !x)) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '추천 장소를 확인할 수 없어요.');
  return { place, alternatives: alternatives as CanvasPlaceDetail[], requiresReview: true };
}
