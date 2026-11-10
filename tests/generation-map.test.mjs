import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidWgs84, verifiedEdgeGeometry } from '../src/features/generation/mapUtils.ts'

test('map coordinates must be valid WGS84 and only verified route geometry is drawn', () => {
  const start = { latitude: 36.635, longitude: 127.491, crs: 'WGS84' }
  const end = { latitude: 36.8, longitude: 127.6, crs: 'WGS84' }
  assert.equal(isValidWgs84(start), true)
  assert.equal(isValidWgs84({ latitude: 91, longitude: 127, crs: 'WGS84' }), false)
  assert.equal(isValidWgs84({ latitude: 36, longitude: 127, crs: 'EPSG:4326' }), false)
  assert.deepEqual(verifiedEdgeGeometry({ status: 'verified', geometry: [start, end] }), [start, end])
  assert.equal(verifiedEdgeGeometry({ status: 'unknown', geometry: [start, end] }), null)
  assert.equal(verifiedEdgeGeometry({ status: 'verified', geometry: [start] }), null)
  assert.equal(verifiedEdgeGeometry({ status: 'verified', geometry: [start, { latitude: 100, longitude: 127, crs: 'WGS84' }] }), null)
})

test('BE route geometry has no per-point CRS field', () => { const points = [{latitude:36.6,longitude:127.4},{latitude:36.7,longitude:127.5}]; assert.deepEqual(verifiedEdgeGeometry({status:'verified',geometry:points}),points) })
