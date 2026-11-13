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
};
export type CanvasItineraryCostSummary = {
  minKrw: number | null;
  maxKrw: number | null;
  knownCount: number;
  totalCount: number;
  approximate: boolean;
  rows: CanvasVisitCost[];
};

type ParsedAmount = { min: number; max: number; approximate: boolean; basis: 'free' | 'per-person' | 'per-visit-total' };
type ParseResult = { value: ParsedAmount; source: string } | { error: string; source: string };
const amountPattern = '(\\d{1,3}(?:,\\d{3})+|\\d+)';
const feeLabel = '(?:(?:입장료|요금|이용료)\\s*[:：]?\\s*)?';
const rangeTail = `(?:\\s*원?\\s*(?:~|～|∼|[-–—])\\s*${amountPattern})?`;
const perPersonPattern = new RegExp(`^1인\\s*(약\\s*)?${feeLabel}${amountPattern}${rangeTail}\\s*원$`, 'u');
const visitTotalPattern = new RegExp(`^전체\\s*(?:1회\\s*)?(약\\s*)?${feeLabel}${amountPattern}${rangeTail}\\s*원$`, 'u');
const lodgingPattern = /^1박\s*\d[\d,]*\s*원\s*\(\s*기준\s*\d+\s*명\s*\)$/u;

function parseAmountText(source: string): ParseResult {
  const text = source.trim();
  if (/^(?:(?:입장료|요금|이용료)\s*[:：]?\s*)?무료$/u.test(text)) return { value: { min: 0, max: 0, approximate: false, basis: 'free' }, source };
  if (lodgingPattern.test(text)) return { error: '숙박 요금은 숙박일수와 객실 수를 확인할 수 없어 합계에 넣지 않았어요.', source };
  let match: RegExpExecArray | null = perPersonPattern.exec(text);
  let basis: ParsedAmount['basis'] = 'per-person';
  if (!match) { match = visitTotalPattern.exec(text); basis = 'per-visit-total'; }
  if (!match) return { error: /^1회/u.test(text) ? '1회 요금의 인원 기준을 확인해 주세요.' : '금액 기준을 확인할 수 없어 합계에 넣지 않았어요.', source };
  const approx = Boolean(match[1]);
  const firstRaw = match[2]; const secondRaw = match[3];
  const parseNumber = (raw: string | undefined) => {
    if (!raw || !/^(?:\d{1,3}(?:,\d{3})+|\d+)$/u.test(raw)) return null;
    const value = Number(raw.replaceAll(',', ''));
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const first = parseNumber(firstRaw); const second = secondRaw === undefined ? first : parseNumber(secondRaw);
  if (first === null || second === null || second < first) return { error: '금액 표기를 확인할 수 없어 합계에 넣지 않았어요.', source };
  return { value: { min: first, max: second, approximate: approx || second !== first, basis }, source };
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
  const sameValue = values.every(item => item.value.min === first.value.min && item.value.max === first.value.max && item.value.basis === first.value.basis);
  if (!sameValue) return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: texts.join(' / '), reason: '서로 다른 요금 안내가 있어 합계를 확인할 수 없어요.' };
  const amount = { ...first.value, approximate: values.some(item => item.value.approximate) };
  if (amount.basis === 'per-person') {
    if (expectedPeople === null || !Number.isSafeInteger(expectedPeople) || expectedPeople < 1) {
      return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: first.source, reason: '인원 기준 금액이에요. 저장된 예정 인원을 확인해 주세요.' };
    }
    const min = amount.min * expectedPeople; const max = amount.max * expectedPeople;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return { minKrw: null, maxKrw: null, approximate: false, basis: 'unknown', sourceText: first.source, reason: '예상 금액이 너무 커서 합계에 넣지 않았어요.' };
    return { minKrw: min, maxKrw: max, approximate: amount.approximate, basis: amount.basis, sourceText: first.source, reason: null };
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
