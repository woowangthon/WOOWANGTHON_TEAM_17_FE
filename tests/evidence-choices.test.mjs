import test from 'node:test'
import assert from 'node:assert/strict'
import { getEvidenceChoices } from '../src/features/personal/evidenceChoices.ts'

const assertExactRanges = (source, choices) => {
  assert.ok(choices.length <= 80)
  for (const choice of choices) {
    assert.equal(choice.text, source.slice(choice.start, choice.end))
    assert.ok(choice.start >= 0 && choice.end <= source.length && choice.start < choice.end)
    assert.ok(choice.end - choice.start <= 1000)
    assert.ok([...choice.text].length <= 1000)
    assert.equal(choice.key, `${choice.start}:${choice.end}`)
    assert.notEqual(source[choice.end - 1] === '\r' && source[choice.end] === '\n', true)
    assert.notEqual(source[choice.start - 1] === '\r' && source[choice.start] === '\n', true)
  }
}

const assertMeaningfulCoverage = (source, choices) => {
  for (let index = 0; index < source.length; index += 1) {
    if (/\s/u.test(source[index])) continue
    assert.ok(choices.some(choice => index >= choice.start && index < choice.end), `source index ${index} was omitted`)
  }
}

test('sentence choices retain Korean, fullwidth punctuation, quotes, decimals, and exact spacing', () => {
  const source = '조용한 숲길을 보고 싶어요, 오래 걷는 건 피하고 싶어요.\n“2.5km 코스도 좋아요!” 1,000원 이하입니다!\n다음 문장입니다。'
  const choices = getEvidenceChoices(source)
  assertExactRanges(source, choices)
  assertMeaningfulCoverage(source, choices)
  assert.ok(choices.some(choice => choice.text.includes('2.5km')))
  assert.ok(choices.some(choice => choice.text === '“2.5km 코스도 좋아요!”'))
  assert.ok(choices.some(choice => choice.text === '다음 문장입니다。'))
  assert.ok(choices.some(choice => choice.text === '조용한 숲길을 보고 싶어요,'))
  assert.ok(choices.some(choice => choice.text === '오래 걷는 건 피하고 싶어요.'))
  assert.ok(choices.some(choice => choice.text === '1,000원 이하입니다!'))
})

test('short natural choices stay separate until the bounded-list limit is reached', () => {
  const source = '새우구이가 좋아요. 해안 산책을 원해요. 국수도 먹고 싶어요.'
  const choices = getEvidenceChoices(source)
  assert.deepEqual(choices.map(choice => choice.text), ['새우구이가 좋아요.', '해안 산책을 원해요.', '국수도 먹고 싶어요.'])
})

test('duplicate sentences remain separate source choices with stable offset keys', () => {
  const source = '숲길이 좋아요. 숲길이 좋아요.'
  const choices = getEvidenceChoices(source)
  const duplicates = choices.filter(choice => choice.text.includes('숲길이 좋아요.'))
  assert.equal(duplicates.length, 2)
  assert.notEqual(duplicates[0].key, duplicates[1].key)
  assert.notEqual(duplicates[0].start, duplicates[1].start)
  assertExactRanges(source, choices)
})

test('CRLF boundaries and source spacing are preserved as indivisible line breaks', () => {
  const source = '첫 줄입니다.\r\n  둘째 줄은 2.5km예요.\r\n\r\n셋째 줄입니다.'
  const choices = getEvidenceChoices(source)
  assertExactRanges(source, choices)
  assertMeaningfulCoverage(source, choices)
  for (const choice of choices) assert.ok(!choice.text.includes('\n') || choice.text.includes('\r\n'))
})

test('emoji boundaries stay intact and every choice remains within 1000 UTF-16 units', () => {
  const source = `${'가'.repeat(994)}🌿숲길을 원해요. 끝.`
  const choices = getEvidenceChoices(source)
  assertExactRanges(source, choices)
  assertMeaningfulCoverage(source, choices)
  assert.ok(choices.every(choice => !/[\uD800-\uDBFF]$/u.test(choice.text)))
})

test('a 5000-character unspaced source is fully covered in bounded exact chunks', () => {
  const source = '가'.repeat(5000)
  const choices = getEvidenceChoices(source)
  assertExactRanges(source, choices)
  assertMeaningfulCoverage(source, choices)
  assert.equal(choices.map(choice => choice.text).join(''), source)
})

test('many short sentences are coalesced into a bounded list without losing source text', () => {
  const source = Array.from({ length: 800 }, (_, index) => `문장${index % 10}.`).join(' ')
  const choices = getEvidenceChoices(source)
  assertExactRanges(source, choices)
  assertMeaningfulCoverage(source, choices)
  assert.equal(choices.length, 80)
})

test('only the minimum pair of ordinary choices is merged when the limit is exceeded by one', () => {
  const source = Array.from({ length: 81 }, (_, index) => `조건${index}.`).join(' ')
  const choices = getEvidenceChoices(source)
  assertExactRanges(source, choices)
  assertMeaningfulCoverage(source, choices)
  assert.equal(choices.length, 80)
  assert.equal(choices.filter(choice => choice.text.includes('조건') && (choice.text.match(/조건/gu) ?? []).length === 1).length, 79)
})

test('empty and whitespace-only sources offer no fabricated quote', () => {
  assert.deepEqual(getEvidenceChoices(''), [])
  assert.deepEqual(getEvidenceChoices(' \r\n\t '), [])
})

test('quoted lists retain their surrounding condition while ordinary comma phrases stay selectable', () => {
  for (const source of ['“카페, 공원”은 피하고 싶어요.', '‘카페, 공원’은 피하고 싶어요.', '"카페, 공원"은 피하고 싶어요.', "'카페, 공원'은 피하고 싶어요."]) {
    const choices = getEvidenceChoices(source)
    assertExactRanges(source, choices)
    assert.deepEqual(choices.map(choice => choice.text), [source])
  }
  assert.deepEqual(getEvidenceChoices('카페, 공원').map(choice => choice.text), ['카페,', '공원'])
})
