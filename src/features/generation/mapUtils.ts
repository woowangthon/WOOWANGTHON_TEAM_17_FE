import type { Coordinate, RoutePoint } from './generationApi';

export function isValidWgs84(value: Coordinate | null | undefined): value is Coordinate {
  return Boolean(value && value.crs === 'WGS84' && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180);
}

export function verifiedEdgeGeometry(edge: { status: string; geometry: RoutePoint[] }): RoutePoint[] | null {
  return edge.status === 'verified' && edge.geometry.length > 1 && edge.geometry.every((point) =>
    point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180) ? edge.geometry : null;
}
