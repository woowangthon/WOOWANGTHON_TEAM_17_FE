import test from 'node:test'
import assert from 'node:assert/strict'
import { courseEdgesForPlaces, courseNodesForDay, resolveSelectedCourse, selectCourseDay, totalBudgetSummary } from '../src/features/generation/itineraryPresentation.ts'

const node = (id, kind = 'PLACE') => ({ id, kind })
const day = (date, nodes, edges = []) => ({ date, nodes, edges })

test('course list and edges expose only place-to-place itinerary nodes', () => {
  const rawDay = day('2026-11-14', [node('start', 'START'), node('a'), node('b'), node('end', 'END')], [
    { id: 'start-a', fromNodeId: 'start', toNodeId: 'a' },
    { id: 'a-b', fromNodeId: 'a', toNodeId: 'b' },
    { id: 'b-end', fromNodeId: 'b', toNodeId: 'end' },
  ])
  const courses = courseNodesForDay(rawDay)
  assert.deepEqual(courses.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(courseEdgesForPlaces(rawDay, courses).map((edge) => edge.id), ['a-b'])
})

test('active day and selection recover when date or selected place is missing', () => {
  const days = [day('2026-11-14', [node('a')]), day('2026-11-15', [node('b')])]
  assert.equal(selectCourseDay(days, '2026-11-15')?.date, '2026-11-15')
  assert.equal(selectCourseDay(days, 'removed-date')?.date, '2026-11-14')
  assert.equal(selectCourseDay([], null), null)
  assert.equal(resolveSelectedCourse(days[1].nodes, 'removed-place')?.id, 'b')
  assert.equal(resolveSelectedCourse([], 'removed-place'), null)
})

test('unavailable overall cost never reports a misleading budget remainder', () => {
  assert.deepEqual(totalBudgetSummary(null, 600000), { label: '전체 추정 비용 확인 필요', amount: null, remainder: null })
  assert.deepEqual(totalBudgetSummary(480000, 600000), { label: '전체 추정 비용', amount: 480000, remainder: 120000 })
  assert.equal(totalBudgetSummary(700000, 600000).remainder, -100000)
})
