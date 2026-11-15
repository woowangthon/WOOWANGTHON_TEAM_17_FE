import type { CanvasPlaceNode } from './canvasModel.ts';

export type CanvasVisitTime = { startAt: string; endAt: string } | { startTime: string; endTime: string };
export type CanvasClockRange = { startTime: string; endTime: string };

const kstOffsetMs = 9 * 60 * 60 * 1000;
const nativeClock = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function utcMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) || value.startsWith('0000-')) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return ms;
}

function kstIso(utc: string): string {
  const ms = utcMillis(utc);
  if (ms === null) return '';
  const iso = new Date(ms + kstOffsetMs).toISOString();
  return iso.startsWith('+') ? '' : iso;
}

export const getCanvasKstDate = (utc: string): string => kstIso(utc).slice(0, 10);
export const getCanvasKstClock = (utc: string): string => kstIso(utc).slice(11, 16);

export function toCanvasKstUtc(dayDate: string, hhmm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dayDate) || !nativeClock.test(hhmm)) return null;
  const local = utcMillis(`${dayDate}T${hhmm}:00Z`);
  if (local === null) return null;
  const utc = new Date(local - kstOffsetMs).toISOString();
  return utc.startsWith('0000-') ? null : utc;
}

export function canEditCanvasVisitTime(node: Pick<CanvasPlaceNode, 'schedule'>): boolean {
  return node.schedule?.locked !== true;
}

function completeUnlockedImport(node: Pick<CanvasPlaceNode, 'source' | 'schedule'>): boolean {
  return Boolean(node.source && node.schedule?.locked === false && node.schedule.startAt && node.schedule.endAt
    && getCanvasKstDate(node.schedule.startAt) && getCanvasKstDate(node.schedule.endAt));
}

export function parseCanvasVisitTime(node: Pick<CanvasPlaceNode, 'source' | 'schedule' | 'visitTime'>, value: unknown, markerVersion: 1 | 2): CanvasVisitTime | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const fields = Object.keys(item);
  if (fields.length === 2 && Object.hasOwn(item, 'startAt') && Object.hasOwn(item, 'endAt') && completeUnlockedImport(node)) {
    const start = utcMillis(item.startAt);
    const end = utcMillis(item.endAt);
    if (start === null || end === null || end <= start) return null;
    const startAt = new Date(start).toISOString();
    const endAt = new Date(end).toISOString();
    if (getCanvasKstDate(startAt) !== getCanvasKstDate(node.schedule!.startAt!)
      || getCanvasKstDate(endAt) !== getCanvasKstDate(node.schedule!.endAt!)) return null;
    return { startAt, endAt };
  }
  if (markerVersion !== 2 || fields.length !== 2 || !Object.hasOwn(item, 'startTime') || !Object.hasOwn(item, 'endTime')
    || typeof item.startTime !== 'string' || typeof item.endTime !== 'string' || !nativeClock.test(item.startTime)
    || !nativeClock.test(item.endTime) || item.endTime <= item.startTime || !canEditCanvasVisitTime(node) || completeUnlockedImport(node)) return null;
  return { startTime: item.startTime, endTime: item.endTime };
}

export function getCanvasVisitClocks(node: CanvasPlaceNode): CanvasClockRange {
  const visit = node.visitTime;
  if (visit && 'startTime' in visit) return { startTime: visit.startTime, endTime: visit.endTime };
  const interval = visit ?? node.schedule;
  return { startTime: interval?.startAt ? getCanvasKstClock(interval.startAt) : '', endTime: interval?.endAt ? getCanvasKstClock(interval.endAt) : '' };
}

export function createCanvasVisitTime(node: CanvasPlaceNode, clocks: CanvasClockRange): CanvasVisitTime | null {
  const { startTime, endTime } = clocks;
  if (!nativeClock.test(startTime) || !nativeClock.test(endTime) || !canEditCanvasVisitTime(node)) return null;
  if (completeUnlockedImport(node)) {
    const current = node.visitTime && 'startAt' in node.visitTime ? node.visitTime : node.schedule!;
    const currentStart = current.startAt;
    const currentEnd = current.endAt;
    const startAt = currentStart && getCanvasKstClock(currentStart) === startTime
      ? new Date(utcMillis(currentStart)!).toISOString()
      : toCanvasKstUtc(getCanvasKstDate(node.schedule!.startAt!), startTime);
    const endAt = currentEnd && getCanvasKstClock(currentEnd) === endTime
      ? new Date(utcMillis(currentEnd)!).toISOString()
      : toCanvasKstUtc(getCanvasKstDate(node.schedule!.endAt!), endTime);
    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return null;
    return { startAt, endAt };
  }
  return endTime > startTime ? { startTime, endTime } : null;
}

const clockMinutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const minutesClock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function moveCanvasVisitStart(node: CanvasPlaceNode, base: CanvasVisitTime, startClock: string): CanvasVisitTime | null {
  if (!canEditCanvasVisitTime(node) || !nativeClock.test(startClock)) return null;
  const validBase = parseCanvasVisitTime(node, base, 2);
  if (!validBase) return null;
  if ('startTime' in validBase) {
    if (startClock === validBase.startTime) return base;
    const endMinutes = clockMinutes(startClock) + clockMinutes(validBase.endTime) - clockMinutes(validBase.startTime);
    return endMinutes >= 1440 ? null : { startTime: startClock, endTime: minutesClock(endMinutes) };
  }
  if (getCanvasKstClock(validBase.startAt) === startClock) return base;
  const startAt = toCanvasKstUtc(getCanvasKstDate(node.schedule!.startAt!), startClock);
  if (!startAt) return null;
  const duration = Date.parse(validBase.endAt) - Date.parse(validBase.startAt);
  const endAt = new Date(Date.parse(startAt) + duration).toISOString();
  return parseCanvasVisitTime(node, { startAt, endAt }, 2);
}

export function getCanvasVisitTime(node: CanvasPlaceNode): CanvasVisitTime | { startAt: string | null; endAt: string | null } | undefined {
  const interval = node.visitTime ?? node.schedule;
  return interval && ('startTime' in interval
    ? { startTime: interval.startTime, endTime: interval.endTime }
    : { startAt: interval.startAt, endAt: interval.endAt });
}

export function sameCanvasVisitTime(left: ReturnType<typeof getCanvasVisitTime>, right: ReturnType<typeof getCanvasVisitTime>): boolean {
  if (!left || !right) return left === right;
  if ('startTime' in left || 'startTime' in right) {
    return 'startTime' in left && 'startTime' in right && left.startTime === right.startTime && left.endTime === right.endTime;
  }
  return utcMillis(left.startAt) === utcMillis(right.startAt) && utcMillis(left.endAt) === utcMillis(right.endAt);
}

export function canvasStayMinutes(node: CanvasPlaceNode, estimate?: number | null): number | null {
  const interval = node.visitTime ?? node.schedule;
  if (interval && 'startTime' in interval) {
    if (nativeClock.test(interval.startTime) && nativeClock.test(interval.endTime) && interval.endTime > interval.startTime) {
      return clockMinutes(interval.endTime) - clockMinutes(interval.startTime);
    }
  } else {
    const start = utcMillis(interval?.startAt);
    const end = utcMillis(interval?.endAt);
    if (start !== null && end !== null && end > start) return Math.round((end - start) / 60000);
  }
  return typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0 ? estimate : null;
}
