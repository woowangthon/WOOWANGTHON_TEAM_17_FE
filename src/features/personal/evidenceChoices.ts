export type EvidenceChoice = { start: number; end: number; text: string; key: string };

const MAX_CHOICE_UNITS = 1000;
const MAX_CHOICES = 80;
const sentenceStops = new Set(['.', '!', '?', '。', '！', '？', '…']);
const closingMarks = new Set(['"', "'", '”', '’', '」', '』', '》', '〉', '】', ')', ']', '}', '〉', '》']);

function isHighSurrogate(code: number): boolean { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

function trimRange(source: string, start: number, end: number): { start: number; end: number } | null {
  while (start < end && /\s/u.test(source[start]!)) {
    if (source[start] === '\r' && source[start + 1] === '\n') start += 2;
    else start += 1;
  }
  while (end > start && /\s/u.test(source[end - 1]!)) {
    if (source[end - 2] === '\r' && source[end - 1] === '\n') end -= 2;
    else end -= 1;
  }
  return start < end ? { start, end } : null;
}

function safeEnd(source: string, start: number, desiredEnd: number): number {
  let end = Math.min(source.length, desiredEnd);
  if (end < source.length && end > start && isHighSurrogate(source.charCodeAt(end - 1)) && isLowSurrogate(source.charCodeAt(end))) end -= 1;
  if (end < source.length && end > start && source[end - 1] === '\r' && source[end] === '\n') end -= 1;
  return end > start ? end : Math.min(source.length, start + 2);
}

function sentenceRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const quotedRanges = [...source.matchAll(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"|(?<![\p{L}\p{N}])'[^']*'/gu)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }));
  let sentenceStart = 0;
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    let end = index + 1;
    let stop = false;
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') end += 1;
      stop = true;
    } else if (char === ',' || char === '，') {
      if (/\s/u.test(source[index + 1] ?? '') && !quotedRanges.some(range => index > range.start && index < range.end)) stop = true;
    } else if (sentenceStops.has(char)) {
      const decimal = char === '.' && /\d/u.test(source[index - 1] ?? '') && /\d/u.test(source[index + 1] ?? '');
      if (!decimal) {
        while (sentenceStops.has(source[end] ?? '')) end += 1;
        while (closingMarks.has(source[end] ?? '')) end += 1;
        stop = true;
      }
    }
    if (stop) {
      const range = trimRange(source, sentenceStart, end);
      if (range) ranges.push(range);
      sentenceStart = end;
      index = end;
    } else {
      const code = source.charCodeAt(index);
      index += code >= 0xd800 && code <= 0xdbff && isLowSurrogate(source.charCodeAt(index + 1)) ? 2 : 1;
    }
  }
  const tail = trimRange(source, sentenceStart, source.length);
  if (tail) ranges.push(tail);
  return ranges;
}

function splitRange(source: string, range: { start: number; end: number }): Array<{ start: number; end: number }> {
  const pieces: Array<{ start: number; end: number }> = [];
  let start = range.start;
  while (start < range.end) {
    let end = safeEnd(source, start, Math.min(range.end, start + MAX_CHOICE_UNITS));
    if (end < range.end) {
      const whitespace = source.lastIndexOf(' ', end - 1);
      const newline = Math.max(source.lastIndexOf('\n', end - 1), source.lastIndexOf('\r', end - 1));
      const boundary = Math.max(whitespace, newline);
      if (boundary >= start + Math.floor(MAX_CHOICE_UNITS * 0.65)) {
        end = boundary;
        if (source[end] === '\r' && source[end + 1] === '\n') end += 2;
        else if (source[end] === '\n' && source[end - 1] === '\r') end += 1;
      }
    }
    const piece = trimRange(source, start, end);
    if (piece) pieces.push(piece);
    start = end;
  }
  return pieces;
}

function boundedRanges(source: string): Array<{ start: number; end: number }> {
  const pieces = sentenceRanges(source).flatMap(range => splitRange(source, range));
  if (pieces.length <= MAX_CHOICES) return pieces;

  // Keep ordinary sentences separate. Only merge the shortest adjacent pairs needed
  // to bring an unusually long chooser down to its 80-option limit.
  const packed = pieces.map(piece => ({ ...piece }));
  while (packed.length > MAX_CHOICES) {
    let bestIndex = -1;
    let bestSize = Infinity;
    for (let index = 0; index < packed.length - 1; index += 1) {
      const combinedSize = packed[index + 1]!.end - packed[index]!.start;
      if (combinedSize <= MAX_CHOICE_UNITS && combinedSize < bestSize) {
        bestIndex = index;
        bestSize = combinedSize;
      }
    }
    // The source has a finite input limit, so a pair should always fit. If a caller
    // supplies a larger source, preserve every choice rather than silently dropping it.
    if (bestIndex < 0) return packed;
    packed[bestIndex]!.end = packed[bestIndex + 1]!.end;
    packed.splice(bestIndex + 1, 1);
  }
  return packed;
}

export function getEvidenceChoices(source: string): EvidenceChoice[] {
  const ranges = boundedRanges(source);
  return ranges.map(({ start, end }) => ({ start, end, text: source.slice(start, end), key: `${start}:${end}` }));
}
