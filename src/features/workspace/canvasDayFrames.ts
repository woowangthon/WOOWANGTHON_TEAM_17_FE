import type { CanvasDay, CanvasDocument, CanvasNode, CanvasPlaceNode } from './canvasModel.ts';

export type CanvasFrameLayout = {
  dayId: string;
  position: { x: number; y: number };
  origin: { x: number; y: number };
  scale: { x: number; y: number };
  width: number;
  height: number;
  projectedNodePositions?: ReadonlyMap<string, { x: number; y: number }>;
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
export type CanvasDayTone = 'lime' | 'sky' | 'rose' | 'amber' | 'sage' | 'lavender';
const DAY_TONES: CanvasDayTone[] = ['lime', 'sky', 'rose', 'amber', 'sage', 'lavender'];

export function canvasDayTone(dayId: string): CanvasDayTone {
  let hash = 0x811c9dc5;
  for (const char of dayId) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return DAY_TONES[hash % DAY_TONES.length];
}

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
    const previous = positioned.days[index];
    let id = previous?.id ?? stableDateId(date);
    while (ids.has(id)) id = stableDateId(`${date}:${ids.size}`);
    ids.add(id);
    return { id, date, ...(previous?.position ? { position: previous.position } : {}) };
  });
  for (const extra of positioned.days.slice(dates.length)) {
    const dayDate = extra.date && !dates.includes(extra.date) ? extra.date : null;
    days.push({ id: extra.id, date: dayDate, ...(extra.position ? { position: extra.position } : {}) });
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

function isUnmodifiedImportedThreePlaceRoute(frameNodes: CanvasNode[], placeNodes: CanvasPlaceNode[]): boolean {
  if (frameNodes.length !== 3 || placeNodes.length !== 3 || placeNodes.some(node => node.intent !== 'route' || !node.source)) return false;
  const source = placeNodes[0].source!;
  if (placeNodes.some(node => node.source!.planId !== source.planId || node.source!.versionId !== source.versionId)) return false;
  const [first, second, third] = placeNodes;
  const near = (left: number, right: number) => Math.abs(left - right) <= 1;
  if (!near(second.position.x - first.position.x, 270) || !near(second.position.y, first.position.y)) return false;
  const importedLinear = near(third.position.x - second.position.x, 270) && near(third.position.y, second.position.y);
  const importedSnake = near(third.position.x, second.position.x) && near(third.position.y - second.position.y, 185);
  return importedLinear || importedSnake;
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
    const placeNodes = frameNodes.filter((node): node is CanvasPlaceNode => node.kind === 'place');
    const alignedGeneratedThree = isUnmodifiedImportedThreePlaceRoute(frameNodes, placeNodes);
    let projectedNodePositions: Map<string, { x: number; y: number }> | undefined;
    let projectedWidth = 0;
    let projectedHeight = 0;
    if (alignedGeneratedThree) {
      const orderedPlaces = [...placeNodes].sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y);
      const cards = orderedPlaces.map(node => ({ node, size: validMeasuredSize(measuredSizes?.get(node.id)) ? measuredSizes!.get(node.id)! : estimatedNodeSize(node) }));
      const gap = 28;
      const left = FRAME_PADDING;
      const top = HEADER_HEIGHT + FRAME_PADDING;
      const firstRowHeight = Math.max(cards[0].size.height, cards[1].size.height);
      const bottomY = top + firstRowHeight + gap;
      const totalWidth = cards[0].size.width + gap + cards[1].size.width;
      projectedWidth = Math.max(FRAME_WIDTH, totalWidth + FRAME_PADDING * 2, Math.max(...cards.map(card => card.size.width)) + FRAME_PADDING * 2);
      projectedHeight = bottomY + cards[2].size.height + FRAME_PADDING;
      projectedNodePositions = new Map([
        [cards[0].node.id, { x: left, y: top }],
        [cards[1].node.id, { x: left + cards[0].size.width + gap, y: top }],
        [cards[2].node.id, { x: (projectedWidth - cards[2].size.width) / 2, y: bottomY }],
      ]);
    }
    const width = projectedNodePositions ? projectedWidth : bounds.length ? Math.max(FRAME_WIDTH, maxX - minX + FRAME_PADDING * 2) : FRAME_WIDTH;
    const height = projectedNodePositions ? projectedHeight : bounds.length ? Math.max(EMPTY_FRAME_HEIGHT, HEADER_HEIGHT + FRAME_PADDING * 2 + maxY - minY) : EMPTY_FRAME_HEIGHT;
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, height));
    return { day, index, row, width, height, minX, minY, projectedNodePositions };
  });
  const rowY = new Map<number, number>();
  for (let row = 0; row < Math.ceil(document.days.length / FRAME_COLUMNS); row += 1) {
    const previousY = row === 0 ? 0 : (rowY.get(row - 1) ?? 0) + (rowHeights.get(row - 1) ?? 300) + FRAME_GAP_Y;
    rowY.set(row, previousY);
  }
  for (const group of daySizes) {
    const origin = { x: group.minX - FRAME_PADDING, y: group.minY - HEADER_HEIGHT - FRAME_PADDING };
    const scale = { x: 1, y: 1 };
    let x = daySizes.filter(item => item.row === group.row && item.index < group.index).reduce((sum, item) => sum + item.width + FRAME_GAP_X, 0);
    layouts.set(group.day.id, {
      dayId: group.day.id,
      position: group.day.position ? { x: group.day.position.x, y: group.day.position.y } : { x, y: rowY.get(group.row) ?? 0 },
      origin,
      scale,
      width: group.width,
      height: group.height,
      ...(group.projectedNodePositions ? { projectedNodePositions: group.projectedNodePositions } : {}),
    });
  }
  const placed = daySizes.filter(group => Boolean(group.day.position)).map(group => layouts.get(group.day.id)!);
  for (const group of daySizes.filter(item => !item.day.position)) {
    const frame = layouts.get(group.day.id)!;
    while (true) {
      const overlaps = placed.filter(other => frame.position.x < other.position.x + other.width + FRAME_GAP_X
        && frame.position.x + frame.width + FRAME_GAP_X > other.position.x
        && frame.position.y < other.position.y + other.height + FRAME_GAP_Y
        && frame.position.y + frame.height + FRAME_GAP_Y > other.position.y);
      if (!overlaps.length) break;
      frame.position.y = Math.max(...overlaps.map(other => other.position.y + other.height + FRAME_GAP_Y));
    }
    placed.push(frame);
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
  const projected = frame.projectedNodePositions?.get(node.id);
  if (projected) return { ...projected };
  return { x: (node.position.x - frame.origin.x) * frame.scale.x, y: (node.position.y - frame.origin.y) * frame.scale.y };
}

export function canvasDocumentPosition(nodePosition: { x: number; y: number }, frame: CanvasFrameLayout, anchor?: CanvasNode): { x: number; y: number } {
  const projected = anchor && frame.projectedNodePositions?.get(anchor.id);
  if (projected) return { x: nodePosition.x / frame.scale.x + frame.origin.x, y: nodePosition.y / frame.scale.y + frame.origin.y };
  return { x: nodePosition.x / frame.scale.x + frame.origin.x, y: nodePosition.y / frame.scale.y + frame.origin.y };
}

export function materializeProjectedDay(document: CanvasDocument, dayId: string, measuredSizes?: ReadonlyMap<string, CanvasMeasuredSize>, preserveNodeId?: string): CanvasDocument {
  const frame = layoutCanvasDayFrames(document, measuredSizes).get(dayId);
  if (!frame?.projectedNodePositions) return document;
  return {
    ...document,
    nodes: document.nodes.map(node => {
      const displayed = frame.projectedNodePositions!.get(node.id);
      if (!displayed || node.id === preserveNodeId) return node;
      return { ...node, position: canvasDocumentPosition(displayed, frame) };
    }),
  };
}

export function arrangeDayPlaces(document: CanvasDocument, dayId: string, measuredSizes?: ReadonlyMap<string, CanvasMeasuredSize>): CanvasDocument | null {
  if (!document.days.some(day => day.id === dayId)) return null;
  const places = document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place' && node.dayId === dayId);
  if (!places.length) return null;
  const columns = places.length === 1 ? 1 : 2;
  const gapX = 28;
  const gapY = 28;
  const sizes = places.map(node => validMeasuredSize(measuredSizes?.get(node.id)) ? measuredSizes!.get(node.id)! : estimatedNodeSize(node));
  const rowGroups: Array<{ start: number; count: number; width: number; height: number }> = [];
  for (let start = 0; start < places.length; start += columns) {
    const count = Math.min(columns, places.length - start);
    const row = sizes.slice(start, start + count);
    rowGroups.push({ start, count, width: row.reduce((sum, size) => sum + size.width, 0) + gapX * (count - 1), height: Math.max(...row.map(size => size.height)) });
  }
  const untouched = document.nodes.filter(node => node.dayId === dayId && node.kind !== 'place');
  const commentBounds = untouched.map(node => {
    const size = validMeasuredSize(measuredSizes?.get(node.id)) ? measuredSizes!.get(node.id)! : estimatedNodeSize(node);
    return { left: node.position.x, top: node.position.y, right: node.position.x + size.width, bottom: node.position.y + size.height };
  });
  const minX = commentBounds.length ? Math.min(0, ...commentBounds.map(bound => bound.left)) : 0;
  const minY = commentBounds.length ? Math.min(0, ...commentBounds.map(bound => bound.top)) : 0;
  const origin = { x: minX - FRAME_PADDING, y: minY - HEADER_HEIGHT - FRAME_PADDING };
  const commentWidth = commentBounds.length ? Math.max(0, ...commentBounds.map(bound => bound.right - origin.x)) + FRAME_PADDING : 0;
  const frameWidth = Math.max(FRAME_WIDTH, ...rowGroups.map(row => row.width + FRAME_PADDING * 2), commentWidth);
  const positions = new Map<string, { x: number; y: number }>();
  let cursorY = HEADER_HEIGHT + FRAME_PADDING;
  for (const row of rowGroups) {
    const centerRow = row.count === 1 && places.length > 1;
    let x = centerRow || row.count === 2 ? (frameWidth - row.width) / 2 : FRAME_PADDING;
    for (let offset = 0; offset < row.count; offset += 1) {
      positions.set(places[row.start + offset].id, { x: x + origin.x, y: cursorY + origin.y });
      x += sizes[row.start + offset].width + gapX;
    }
    cursorY += row.height + gapY;
  }
  return { ...document, nodes: document.nodes.map(node => node.dayId === dayId && positions.has(node.id)
    ? { ...node, position: positions.get(node.id)! } : node) };
}

export function frameForPoint(layouts: Map<string, CanvasFrameLayout>, point: { x: number; y: number }): CanvasFrameLayout | null {
  for (const frame of layouts.values()) {
    if (point.x >= frame.position.x && point.x <= frame.position.x + frame.width
      && point.y >= frame.position.y && point.y <= frame.position.y + frame.height) return frame;
  }
  return null;
}

export function resolveCanvasDrop(point: { x: number; y: number }, layouts: Map<string, CanvasFrameLayout>, fallbackDayId: string, anchor?: CanvasNode): { dayId: string; position: { x: number; y: number } } | null {
  const fallback = layouts.get(fallbackDayId);
  const destination = frameForPoint(layouts, point) ?? fallback;
  if (!destination) return null;
  const inverseAnchor = anchor?.dayId === destination.dayId ? anchor : undefined;
  return { dayId: destination.dayId, position: canvasDocumentPosition({ x: point.x - destination.position.x, y: point.y - destination.position.y }, destination, inverseAnchor) };
}

export function dayLabel(day: CanvasDay, index: number): string {
  if (!day.date) return `${index + 1}일차`;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day.date);
  return match ? `${index + 1}일차 · ${Number(match[2])}월 ${Number(match[3])}일` : `${index + 1}일차`;
}
