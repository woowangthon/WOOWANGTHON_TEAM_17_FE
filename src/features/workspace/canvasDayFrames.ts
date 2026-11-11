import type { CanvasDay, CanvasDocument, CanvasNode } from './canvasModel.ts';

export type CanvasFrameLayout = {
  dayId: string;
  position: { x: number; y: number };
  origin: { x: number; y: number };
  scale: { x: number; y: number };
  width: number;
  height: number;
  connectorToNext?: { points: Array<{ x: number; y: number }> };
};

const FRAME_WIDTH = 560;
const FRAME_GAP_X = 36;
const FRAME_GAP_Y = 36;
const FRAME_COLUMNS = 3;
const HEADER_HEIGHT = 72;
const FRAME_PADDING = 22;
const EMPTY_FRAME_HEIGHT = 300;
const ESTIMATED_NODE_WIDTH = 250;
const ESTIMATED_PLACE_HEIGHT = 220;
const ESTIMATED_COMMENT_LINE_HEIGHT = 19;
const ESTIMATED_COMMENT_BASE_HEIGHT = 84;
const ESTIMATED_COMMENT_INNER_WIDTH = 196;

export type CanvasMeasuredSize = { width: number; height: number };

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

function estimatedNodeSize(node: CanvasNode): CanvasMeasuredSize {
  if (node.kind === 'place') return { width: ESTIMATED_NODE_WIDTH, height: ESTIMATED_PLACE_HEIGHT };
  const textLines = node.text.split('\n').reduce((sum, line) => {
    const width = Array.from(line).reduce((lineWidth, char) => lineWidth + (/[\u0000-\u00ff]/u.test(char) ? 7 : 13), 0);
    return sum + Math.max(1, Math.ceil(width / ESTIMATED_COMMENT_INNER_WIDTH));
  }, 0);
  return {
    width: ESTIMATED_NODE_WIDTH,
    height: Math.max(96, ESTIMATED_COMMENT_BASE_HEIGHT + textLines * ESTIMATED_COMMENT_LINE_HEIGHT),
  };
}

function validMeasuredSize(size: CanvasMeasuredSize | undefined): size is CanvasMeasuredSize {
  return Boolean(size && Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0);
}

export function layoutCanvasDayFrames(
  document: CanvasDocument,
  measuredSizes?: ReadonlyMap<string, CanvasMeasuredSize>,
): Map<string, CanvasFrameLayout> {
  const layouts = new Map<string, CanvasFrameLayout>();
  const rowHeights = new Map<number, number>();
  const daySizes = document.days.map((day, index) => {
    const row = Math.floor(index / FRAME_COLUMNS);
    const frameNodes = document.nodes.filter(node => node.dayId === day.id);
    const bounds = frameNodes.map(node => {
      const measured = measuredSizes?.get(node.id);
      const size = validMeasuredSize(measured) ? measured : estimatedNodeSize(node);
      return { left: node.position.x, top: node.position.y, right: node.position.x + size.width, bottom: node.position.y + size.height };
    });
    const minX = bounds.length ? Math.min(0, ...bounds.map(item => item.left)) : 0;
    const minY = bounds.length ? Math.min(0, ...bounds.map(item => item.top)) : 0;
    const maxX = bounds.length ? Math.max(0, ...bounds.map(item => item.right)) : 0;
    const maxY = bounds.length ? Math.max(0, ...bounds.map(item => item.bottom)) : 0;
    const width = bounds.length ? Math.max(FRAME_WIDTH, maxX - minX + FRAME_PADDING * 2) : FRAME_WIDTH;
    const height = bounds.length ? Math.max(EMPTY_FRAME_HEIGHT, HEADER_HEIGHT + FRAME_PADDING * 2 + maxY - minY) : EMPTY_FRAME_HEIGHT;
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, height));
    return { day, index, row, width, height, minX, minY };
  });
  const rowY = new Map<number, number>();
  for (let row = 0; row < Math.ceil(document.days.length / FRAME_COLUMNS); row += 1) {
    const previousY = row === 0 ? 0 : (rowY.get(row - 1) ?? 0) + (rowHeights.get(row - 1) ?? 300) + FRAME_GAP_Y;
    rowY.set(row, previousY);
  }
  for (const group of daySizes) {
    const origin = { x: group.minX - FRAME_PADDING, y: group.minY - HEADER_HEIGHT - FRAME_PADDING };
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
  for (let index = 0; index < daySizes.length - 1; index += 1) {
    const current = daySizes[index];
    const next = daySizes[index + 1];
    const from = layouts.get(current.day.id)!;
    const to = layouts.get(next.day.id)!;
    const startCenterX = from.position.x + from.width / 2;
    const endCenterX = to.position.x + to.width / 2;
    if (current.row === next.row) {
      const connectorY = from.position.y + HEADER_HEIGHT / 2;
      from.connectorToNext = { points: [
        { x: from.position.x + from.width, y: connectorY },
        { x: to.position.x, y: connectorY },
      ] };
    } else {
      const rowBottom = from.position.y + (rowHeights.get(current.row) ?? from.height);
      const gutterY = rowBottom + FRAME_GAP_Y / 2;
      from.connectorToNext = { points: [
        { x: startCenterX, y: from.position.y + from.height },
        { x: startCenterX, y: gutterY },
        { x: endCenterX, y: gutterY },
        { x: endCenterX, y: to.position.y },
      ] };
    }
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
