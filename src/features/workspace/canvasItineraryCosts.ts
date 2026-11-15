import type { CanvasItineraryDay } from './canvasItineraryModel.ts';

export type CanvasVisitCost = {
  nodeId: string;
  dayId: string;
  minKrw: number | null;
  maxKrw: number | null;
  approximate: boolean;
  basis: 'free' | 'per-person' | 'per-visit-total' | 'unknown';
  sourceText: string | null;
  reason: string | null;
  note?: string;
};
export type CanvasItineraryCostSummary = {
  minKrw: number | null;
  maxKrw: number | null;
  knownCount: number;
  totalCount: number;
  approximate: boolean;
  rows: CanvasVisitCost[];
};

const numberFormat = new Intl.NumberFormat('ko-KR');
const wonLabel = (amount: number) => `${numberFormat.format(amount)}원`;

export function canvasItineraryCostHeadline(summary: CanvasItineraryCostSummary, pendingCount = 0): string {
  if (summary.totalCount === 0) return '—';
  const { minKrw, maxKrw } = summary;
  const partial = summary.knownCount < summary.totalCount;
  if (minKrw === null || maxKrw === null || (partial && maxKrw === 0)) {
    return pendingCount > 0 ? '요금 확인 중' : '요금 확인 필요';
  }
  if (!partial && maxKrw === 0 && summary.rows.every(row => row.basis === 'free')) return '무료';
  const amount = minKrw === maxKrw ? wonLabel(minKrw) : `${wonLabel(minKrw)}~${wonLabel(maxKrw)}`;
  return partial ? `일부 ${amount}${pendingCount > 0 ? ' · 확인 중' : ''}` : amount;
}

type ParsedAmount = { min: number; max: number; approximate: boolean; basis: 'free' | 'per-person' | 'per-visit-total'; tariffs?: ReadonlyMap<string, number> };
type ParseResult = { value: ParsedAmount; source: string } | { error: string; source: string };
const amountPattern = '(\\d{1,3}(?:,\\d{3})+|\\d+)';
const feePrefix = /^(?:입장료|관람료|시설이용료|이용요금|이용료|요금)\s*[:：]?\s*/u;
const rangeTail = `(?:\\s*원?\\s*(?:~|～|∼|[-–—])\\s*${amountPattern})?`;
const amountWithRange = new RegExp(`^(약\\s*)?${amountPattern}${rangeTail}\\s*원$`, 'u');
const unitPrefix = /^(1인(?:당)?|전체(?:\s*1회)?)\s*/u;
const lodgingPattern = /^1박\s*\d[\d,]*\s*원\s*\(\s*기준\s*\d+\s*명\s*\)$/u;

// Reject overlapping tariffs when there is no way to tell which price applies.
const tariffGroups = new Map<string, string[]>([
  ['성인', ['adult']], ['대인', ['adult']], ['어른', ['adult']],
  ['청소년', ['middle', 'high']], ['중고생', ['middle', 'high']],
  ['중학생', ['middle']], ['고등학생', ['high']],
  ['초등학생', ['child']], ['초등생', ['child']], ['어린이', ['child']], ['소인', ['child']],
  ['군인', ['military']], ['유아', ['infant']],
]);
const ageBand = /\s*\(\s*(?:만\s*)?\d{1,2}(?:세|개월)\s*[~～∼-]\s*(?:만\s*)?\d{1,2}(?:세|개월)\s*\)$/u;
const ageTariffItem = new RegExp(`^(.+?)(?:\\s*[:：]\\s*|\\s+)(?:${amountPattern}\\s*원|(무료))$`, 'u');
const contactOnlyNote = /\s*※\s*자세한\s*사항은\s*(?:홈페이지\s*(?:참고|참조)(?:\s*(?:또는|및)\s*(?:전화|유선)\s*문의)?|(?:전화|유선)\s*문의)(?:\s*요망)?[.]?$/u;

function parseNumber(raw: string): number | null {
  const value = Number(raw.replaceAll(',', ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseAgeTariffs(text: string): ParsedAmount | null {
  const list = text.replace(/^[-–—]\s*/u, '');
  const items = list.split(/(?<=원|무료)\s*[-–—·ㆍ;,]\s*/u);
  if (items.length < 2) return null;
  const tariffs = new Map<string, number>();
  let min = Infinity;
  let max = 0;
  for (const item of items) {
    const match = ageTariffItem.exec(item.trim());
    if (!match) return null;
    const amount = match[3] ? 0 : parseNumber(match[2]);
    if (amount === null) return null;
    for (const category of match[1].split(/\s*[,，、/]\s*/u)) {
      const name = category.replace(ageBand, '').replace(/[\s·ㆍ.]/gu, '');
      const groups = tariffGroups.get(name);
      if (!groups || groups.some(group => tariffs.has(group))) return null;
      for (const group of groups) tariffs.set(group, amount);
    }
    min = Math.min(min, amount);
    max = Math.max(max, amount);
  }
  if (!tariffs.has('adult')) return null;
  return { min, max, approximate: false, basis: 'per-person', tariffs };
}

function parseAmountText(source: string): ParseResult {
  const raw = source.trim().replace(contactOnlyNote, '').trimEnd();
  const text = raw.replace(feePrefix, '');
  if (/^무료(?:\s*(?:입장|관람|이용))?$/u.test(text) || (text === '없음' && text !== raw)) {
    return { value: { min: 0, max: 0, approximate: false, basis: 'free' }, source };
  }
  if (lodgingPattern.test(text)) return { error: '숙박 요금은 숙박일수와 객실 수를 확인할 수 없어 합계에 넣지 않았어요.', source };
  const ageTariffs = parseAgeTariffs(text);
  if (ageTariffs) return { value: ageTariffs, source };
  const unit = unitPrefix.exec(text);
  if (!unit) return { error: /^1회/u.test(text) ? '1회 요금의 인원 기준을 확인해 주세요.' : '금액 기준을 확인할 수 없어 합계에 넣지 않았어요.', source };
  const basis = unit[1].startsWith('1인') ? 'per-person' : 'per-visit-total';
  const labelled = text.slice(unit[0].length);
  const amount = labelled.replace(/^약\s*/u, '').replace(feePrefix, '');
  const match = amountWithRange.exec(amount);
  if (!match) return { error: '금액 표기를 확인할 수 없어 합계에 넣지 않았어요.', source };
  const approximate = labelled.startsWith('약') || Boolean(match[1]);
  const first = parseNumber(match[2]);
  const second = match[3] === undefined ? first : parseNumber(match[3]);
  if (first === null || second === null || second < first) return { error: '금액 표기를 확인할 수 없어 합계에 넣지 않았어요.', source };
  return { value: { min: first, max: second, approximate: approximate || second !== first, basis }, source };
}

function resolvePlaceCost(texts: string[], expectedPeople: number | null): Omit<CanvasVisitCost, 'nodeId' | 'dayId'> {
  if (!texts.length) return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: null, reason: '요금 정보가 없어 합계에 넣지 않았어요.' };
  const parsed = texts.map(parseAmountText);
  const values = parsed.filter((item): item is Extract<ParseResult, { value: ParsedAmount }> => 'value' in item);
  if (values.length !== parsed.length) {
    const lodging = parsed.find((item): item is Extract<ParseResult, { error: string }> => 'error' in item && item.error.startsWith('숙박 요금'));
    const reason = lodging && parsed.length === 1 ? lodging.error
      : parsed.length > 1 && values.length > 0 ? '서로 다른 요금 안내가 있어 합계를 확인할 수 없어요.'
        : parsed.find((item): item is Extract<ParseResult, { error: string }> => 'error' in item)?.error ?? '금액 기준을 확인할 수 없어 합계에 넣지 않았어요.';
    return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: texts[0], reason };
  }
  const first = values[0];
  const tariffs = new Map<string, number>();
  const sameValue = values.every(({ value }) => {
    if (value.min !== first.value.min || value.max !== first.value.max || value.basis !== first.value.basis) return false;
    for (const [group, rate] of value.tariffs ?? []) {
      if (tariffs.has(group) && tariffs.get(group) !== rate) return false;
      tariffs.set(group, rate);
    }
    return true;
  });
  if (!sameValue) return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: texts.join(' / '), reason: '서로 다른 요금 안내가 있어 합계를 확인할 수 없어요.' };
  const amount = { ...first.value, approximate: values.some(item => item.value.approximate) };
  if (amount.basis === 'per-person') {
    if (expectedPeople === null || !Number.isSafeInteger(expectedPeople) || expectedPeople < 1) {
      return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: first.source, reason: '인원 기준 금액이에요. 저장된 예정 인원을 확인해 주세요.' };
    }
    const min = amount.min * expectedPeople; const max = amount.max * expectedPeople;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: first.source, reason: '예상 금액이 너무 커서 합계에 넣지 않았어요.' };
    return { minKrw: min, maxKrw: max, approximate: amount.approximate, basis: amount.basis, sourceText: first.source, reason: null,
      ...(tariffs.size ? { note: '등록된 연령별 요금 범위' } : {}) };
  }
  return { minKrw: amount.min, maxKrw: amount.max, approximate: amount.approximate, basis: amount.basis, sourceText: first.source, reason: null };
}

/** Estimates only full-string, explicitly based KRW fees from the visible visit rows. */
export function canvasItineraryCosts(days: readonly CanvasItineraryDay[], expectedPeople: number | null): CanvasItineraryCostSummary {
  const rows: CanvasVisitCost[] = [];
  for (const day of days) for (const stop of day.stops) {
    const texts = [stop.place?.priceLabel, stop.place?.feeText].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    rows.push({ nodeId: stop.node.id, dayId: day.id, ...resolvePlaceCost(texts, expectedPeople) });
  }
  const known = rows.filter(row => row.minKrw !== null && row.maxKrw !== null);
  if (!known.length) return { minKrw: null, maxKrw: null, knownCount: 0, totalCount: rows.length, approximate: false, rows };
  const minKrw = known.reduce((sum, row) => sum + row.minKrw!, 0);
  const maxKrw = known.reduce((sum, row) => sum + row.maxKrw!, 0);
  if (!Number.isSafeInteger(minKrw) || !Number.isSafeInteger(maxKrw)) {
    for (const row of known) {
      row.minKrw = null; row.maxKrw = null; row.basis = 'unknown'; row.approximate = false;
      row.reason = '예상 합계가 너무 커서 합계에 넣지 않았어요.';
    }
    return { minKrw: null, maxKrw: null, knownCount: 0, totalCount: rows.length, approximate: false, rows };
  }
  return { minKrw, maxKrw, knownCount: known.length, totalCount: rows.length, approximate: known.some(row => row.approximate), rows };
}
