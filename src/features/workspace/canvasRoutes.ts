export type CanvasTravelMode = 'car' | 'walk' | 'transit' | 'charter' | null;
export type CanvasRouteStatus = 'verified' | 'unknown';
export type CanvasRoute = {
  sourceContentid: number;
  targetContentid: number;
  conditionsVersion: number;
  mode: CanvasTravelMode;
  status: CanvasRouteStatus;
  durationSeconds: number | null;
  distanceMeters: number | null;
  checkedAt: string;
  reasonCodes: string[];
};
export type CanvasRouteInput = {
  tripId: string;
  sourceContentid: number;
  targetContentid: number;
  conditionsVersion: number;
  mode: CanvasTravelMode;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validContentid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const validConditionsVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4294967295;
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u.test(value)) return false;
  const date = value.slice(0, 10);
  try { return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date && !Number.isNaN(Date.parse(value)); }
  catch { return false; }
}
const modes: CanvasTravelMode[] = ['car', 'walk', 'transit', 'charter', null];

export function parseCanvasRoute(value: unknown, expected: CanvasRouteInput): CanvasRoute | null {
  if (!record(value) || !exactKeys(value, ['sourceContentid', 'targetContentid', 'conditionsVersion', 'mode', 'status', 'durationSeconds', 'distanceMeters', 'checkedAt', 'reasonCodes'])) return null;
  if (!validContentid(value.sourceContentid) || value.sourceContentid !== expected.sourceContentid || !validContentid(value.targetContentid) || value.targetContentid !== expected.targetContentid) return null;
  if (!validConditionsVersion(value.conditionsVersion) || value.conditionsVersion !== expected.conditionsVersion || !validConditionsVersion(expected.conditionsVersion) || !modes.includes(value.mode as CanvasTravelMode) || value.mode !== expected.mode) return null;
  if (value.status !== 'verified' && value.status !== 'unknown') return null;
  const metric = (item: unknown) => item === null || (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0);
  if (!metric(value.durationSeconds) || !metric(value.distanceMeters) || !validTimestamp(value.checkedAt)) return null;
  if (value.status === 'verified' && (value.durationSeconds === null || value.distanceMeters === null)) return null;
  if (value.status === 'unknown' && (value.durationSeconds !== null || value.distanceMeters !== null)) return null;
  const durationSeconds = value.durationSeconds as number | null;
  const distanceMeters = value.distanceMeters as number | null;
  if ((durationSeconds !== null && durationSeconds > 4294967295) || (distanceMeters !== null && distanceMeters > 4294967295)) return null;
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length > 20 || !value.reasonCodes.every(code => typeof code === 'string' && code.length > 0 && code.length <= 80)) return null;
  return {
    sourceContentid: value.sourceContentid,
    targetContentid: value.targetContentid,
    conditionsVersion: value.conditionsVersion as number,
    mode: value.mode as CanvasTravelMode,
    status: value.status,
    durationSeconds,
    distanceMeters,
    checkedAt: value.checkedAt,
    reasonCodes: [...value.reasonCodes] as string[],
  };
}

export function canvasRouteKey(input: CanvasRouteInput): string {
  return JSON.stringify([input.tripId, input.conditionsVersion, input.mode, input.sourceContentid, input.targetContentid]);
}

export function formatCanvasRouteLabel(route: CanvasRoute | null | undefined, loading = false): string {
  if (loading) return '조회 중';
  if (!route || route.status !== 'verified' || route.durationSeconds === null) return '시간 미확인';
  const minutes = Math.ceil(route.durationSeconds / 60);
  const amount = minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
  const mode = route.mode === 'car' ? '차량' : route.mode === 'walk' ? '도보' : route.mode === 'transit' ? '대중교통' : route.mode === 'charter' ? '전세버스' : '이동';
  return `${mode} ${amount}`;
}

export type CanvasRouteRequest = CanvasRouteInput & { edgeIds: string[] };
export function collectCanvasRouteRequests(
  tripId: string, conditionsVersion: number | null, mode: CanvasTravelMode, document: { nodes: Array<{ id: string; kind: string; dayId: string; contentid?: number }>; edges: Array<{ id: string; source: string; target: string }> } | null,
  activeDayId: string,
): CanvasRouteRequest[] {
  if (!document || conditionsVersion === null || !validConditionsVersion(conditionsVersion)) return [];
  const nodes = new Map(document.nodes.filter(node => node.kind === 'place' && node.dayId === activeDayId && validContentid(node.contentid)).map(node => [node.id, { dayId: node.dayId, contentid: node.contentid as number }]));
  const byKey = new Map<string, CanvasRouteRequest>();
  for (const edge of document.edges) {
    const source = nodes.get(edge.source); const target = nodes.get(edge.target);
    if (!source || !target || source.dayId !== target.dayId) continue;
    const input = { tripId, sourceContentid: source.contentid, targetContentid: target.contentid, conditionsVersion, mode };
    const key = canvasRouteKey(input); const current = byKey.get(key);
    if (current) current.edgeIds.push(edge.id);
    else byKey.set(key, { ...input, edgeIds: [edge.id] });
  }
  return [...byKey.values()];
}

type Job<T> = { key: string; run: (signal: AbortSignal) => Promise<T>; resolve: (value: T | null) => void; controller: AbortController; started: boolean };
/** A bounded, per-view queue. Aborted active jobs keep their slot until the underlying request settles. */
export class CanvasRouteController<T> {
  private readonly limit: number;
  private scope = '';
  private active = 0;
  private readonly queue: Job<T>[] = [];
  private readonly jobs = new Map<string, Job<T>>();
  private readonly cache = new Map<string, T>();
  constructor(limit = 2) { this.limit = limit; }

  setScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.queue.splice(0).forEach(job => { this.jobs.delete(job.key); job.resolve(null); });
    for (const job of [...this.jobs.values()]) {
      job.controller.abort();
      if (job.started) this.jobs.delete(job.key);
    }
    this.cache.clear();
  }

  retainKeys(keys: ReadonlySet<string>): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const job = this.queue[index];
      if (!keys.has(job.key)) {
        this.queue.splice(index, 1);
        this.jobs.delete(job.key);
        job.resolve(null);
      }
    }
    for (const job of [...this.jobs.values()]) {
      if (job.started && !keys.has(job.key)) {
        job.controller.abort();
        this.jobs.delete(job.key);
      }
    }
  }

  load(key: string, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key)!);
    const existing = this.jobs.get(key);
    if (existing) return new Promise(resolve => {
      const original = existing.resolve;
      existing.resolve = value => { original(value); resolve(value); };
    });
    return new Promise(resolve => {
      const job: Job<T> = { key, run, resolve, controller: new AbortController(), started: false };
      this.jobs.set(key, job);
      this.queue.push(job);
      this.pump();
    });
  }

  retry(key: string): void { this.cache.delete(key); }

  private pump(): void {
    while (this.active < this.limit && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.controller.signal.aborted) continue;
      job.started = true;
      this.active += 1;
      void job.run(job.controller.signal).then(value => {
        if (!job.controller.signal.aborted && this.jobs.get(job.key) === job) this.cache.set(job.key, value);
        job.resolve(value);
      }, () => { job.resolve(null); }).finally(() => {
        this.active -= 1;
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.pump();
      });
    }
  }
}
