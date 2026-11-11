import type { CanvasDay, CanvasDocument, CanvasNode } from './canvasModel.ts';

export type CanvasFrameLayout = {
  dayId: string;
  position: { x: number; y: number };
  origin: { x: number; y: number };
  scale: { x: number; y: number };
  width: number;
  height: number;
};

const FRAME_WIDTH = 560;
const FRAME_GAP_X = 36;
const FRAME_GAP_Y = 36;
const FRAME_COLUMNS = 3;
const HEADER_HEIGHT = 72;
const NODE_WIDTH = 250;
const NODE_HEIGHT = 150;
const CELL_GAP_X = 18;
const CELL_GAP_Y = 18;
const FRAME_PADDING = 22;

export function ensureCanvasDateRange(
  document: CanvasDocument,
  startDate?: string | null,
  endDate?: string | null,
  hasImportedSource = false,
): CanvasDocument {
  const positioned = document;
  if (hasImportedSource || positioned.days.some(day => day.date !== null) || !startDate || !endDate) return positioned;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && Number.isFinite(new Date(`${value}T12:00:00Z`).valueOf())
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(startDate) || !validDate(endDate)) return positioned;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end < start || (end.valueOf() - start.valueOf()) / 86_400_000 >= 31) return positioned;
  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end && dates.length < 31; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  if (!dates.length || dates.length > 31) return positioned;
  const ids = new Set<string>();
  const days: CanvasDay[] = dates.map((date, index) => {
    let id = positioned.days[index]?.id ?? stableDateId(date);
    while (ids.has(id)) id = stableDateId(`${date}:${ids.size}`);
    ids.add(id);
    return { id, date };
  });
  for (const extra of positioned.days.slice(dates.length)) {
    const dayDate = extra.date && !dates.includes(extra.date) ? extra.date : null;
    days.push({ id: extra.id, date: dayDate });
  }
  if (JSON.stringify(days) === JSON.stringify(positioned.days)) return positioned;
  return { ...positioned, days };
}

function stableDateId(seed: string): string {
  const hash = (input: string, salt: number) => {
    let value = (0x811c9dc5 ^ salt) >>> 0;
    for (const char of input) { value ^= char.charCodeAt(0); value = Math.imul(value, 0x01000193) >>> 0; }
    return value.toString(16).padStart(8, '0');
  };
  const first = hash(seed, 0); const second = hash(seed, 1); const third = hash(seed, 2); const fourth = hash(seed, 3);
  return `${first}-${second.slice(0, 4)}-4${second.slice(5, 8)}-8${third.slice(1, 4)}-${third.slice(4, 8)}${fourth}`;
}

export function layoutCanvasDayFrames(document: CanvasDocument): Map<string, CanvasFrameLayout> {
  const layouts = new Map<string, CanvasFrameLayout>();
  const rowHeights = new Map<number, number>();
  const daySizes = document.days.map((day, index) => {
    const row = Math.floor(index / FRAME_COLUMNS);
    const frameNodes = document.nodes.filter(node => node.dayId === day.id);
    const columns = Math.max(1, Math.ceil(Math.sqrt(frameNodes.length)));
    const rows = Math.max(1, Math.ceil(frameNodes.length / columns));
    const xs = frameNodes.map(node => node.position.x);
    const ys = frameNodes.map(node => node.position.y);
    const width = Math.max(FRAME_WIDTH, FRAME_PADDING * 2 + columns * NODE_WIDTH + Math.max(0, columns - 1) * CELL_GAP_X, (xs.length ? Math.max(...xs) : 0) + FRAME_PADDING * 2 + NODE_WIDTH);
    const height = Math.max(300, HEADER_HEIGHT + FRAME_PADDING + rows * NODE_HEIGHT + Math.max(0, rows - 1) * CELL_GAP_Y, (ys.length ? Math.max(...ys) : 0) + HEADER_HEIGHT + FRAME_PADDING * 2 + NODE_HEIGHT);
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, height));
    return { day, index, row, width, height, frameNodes };
  });
  const rowY = new Map<number, number>();
  for (let row = 0; row < Math.ceil(document.days.length / FRAME_COLUMNS); row += 1) {
    const previousY = row === 0 ? 0 : (rowY.get(row - 1) ?? 0) + (rowHeights.get(row - 1) ?? 300) + FRAME_GAP_Y;
    rowY.set(row, previousY);
  }
  for (const group of daySizes) {
    const origin = { x: -FRAME_PADDING, y: -HEADER_HEIGHT - FRAME_PADDING };
    const scale = { x: 1, y: 1 };
    const x = daySizes.filter(item => item.row === group.row && item.index < group.index).reduce((sum, item) => sum + item.width + FRAME_GAP_X, 0);
    layouts.set(group.day.id, {
      dayId: group.day.id,
      position: { x, y: rowY.get(group.row) ?? 0 },
      origin,
      scale,
      width: group.width,
      height: group.height,
    });
  }
  return layouts;
}

export function canvasFrameNodePosition(node: CanvasNode, frame: CanvasFrameLayout): { x: number; y: number } {
  return { x: (node.position.x - frame.origin.x) * frame.scale.x, y: (node.position.y - frame.origin.y) * frame.scale.y };
}

export function canvasDocumentPosition(nodePosition: { x: number; y: number }, frame: CanvasFrameLayout): { x: number; y: number } {
  return { x: nodePosition.x / frame.scale.x + frame.origin.x, y: nodePosition.y / frame.scale.y + frame.origin.y };
}

export function frameForPoint(layouts: Map<string, CanvasFrameLayout>, point: { x: number; y: number }): CanvasFrameLayout | null {
  for (const frame of layouts.values()) {
    if (point.x >= frame.position.x && point.x <= frame.position.x + frame.width
      && point.y >= frame.position.y && point.y <= frame.position.y + frame.height) return frame;
  }
  return null;
}

export function resolveCanvasDrop(point: { x: number; y: number }, layouts: Map<string, CanvasFrameLayout>, fallbackDayId: string): { dayId: string; position: { x: number; y: number } } | null {
  const fallback = layouts.get(fallbackDayId);
  const destination = frameForPoint(layouts, point) ?? fallback;
  if (!destination) return null;
  return { dayId: destination.dayId, position: canvasDocumentPosition({ x: point.x - destination.position.x, y: point.y - destination.position.y }, destination) };
}

export function dayLabel(day: CanvasDay, index: number): string {
  if (!day.date) return `${index + 1}일차`;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day.date);
  return match ? `${index + 1}일차 · ${Number(match[2])}월 ${Number(match[3])}일` : `${index + 1}일차`;
}
