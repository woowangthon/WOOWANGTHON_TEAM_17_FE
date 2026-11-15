import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVisitClockField } from '../src/features/workspace/canvasVisitTimeClock.ts';

test('parses compact 24-hour values into normalized HH:mm without AM/PM ambiguity', () => {
  for (const [input, expected] of [
    ['10', '10:00'], ['9', '09:00'], ['0937', '09:37'], ['937', '09:37'],
    ['09:37', '09:37'], ['9:5', '09:05'], ['00', '00:00'], ['12', '12:00'],
    ['23:59', '23:59'], ['14', '14:00'], ['21:05', '21:05'], ['1012', '10:12'], ['1017', '10:17'],
  ]) assert.equal(parseVisitClockField(input), expected, input);
});

test('rejects invalid hours, minutes, and non-clock text', () => {
  for (const input of ['', '24', '37', '24:00', '9:60', '9:', ':37', 'abc', '12345', '오후 2:30']) {
    assert.equal(parseVisitClockField(input), '', input);
  }
});
