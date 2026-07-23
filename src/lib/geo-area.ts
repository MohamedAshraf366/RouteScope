/** Lightweight spherical-geometry helpers for the map's area-selection tool.
 *  No external geometry library — everything here is plain math, accurate
 *  enough for city/neighborhood-scale selections. */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters (haversine). */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sum of consecutive haversine distances along an ordered list of points. */
export function pathLength(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineDistance(points[i - 1], points[i]);
  return total;
}

// ---- Point-in-shape tests --------------------------------------------------

export function pointInRectangle(p: LatLng, corner1: LatLng, corner2: LatLng): boolean {
  const minLat = Math.min(corner1.lat, corner2.lat);
  const maxLat = Math.max(corner1.lat, corner2.lat);
  const minLng = Math.min(corner1.lng, corner2.lng);
  const maxLng = Math.max(corner1.lng, corner2.lng);
  return p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng;
}

export function pointInCircle(p: LatLng, center: LatLng, radiusMeters: number): boolean {
  return haversineDistance(p, center) <= radiusMeters;
}

/** Standard ray-casting point-in-polygon test on lat/lng (good enough at
 *  neighborhood scale; ignores the ellipsoid). */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects =
      yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ---- Area calculations (square meters) -------------------------------------

export function rectangleAreaM2(corner1: LatLng, corner2: LatLng): number {
  const width = haversineDistance(
    { lat: corner1.lat, lng: corner1.lng },
    { lat: corner1.lat, lng: corner2.lng },
  );
  const height = haversineDistance(
    { lat: corner1.lat, lng: corner1.lng },
    { lat: corner2.lat, lng: corner1.lng },
  );
  return width * height;
}

export function circleAreaM2(radiusMeters: number): number {
  return Math.PI * radiusMeters * radiusMeters;
}

/** Planar (equirectangular, latitude-scaled) shoelace approximation — fine
 *  for city-scale polygons, not meant for country-scale areas. */
export function polygonAreaM2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const lat0 = toRad(points.reduce((s, p) => s + p.lat, 0) / points.length);
  const xy = points.map((p) => ({
    x: toRad(p.lng) * Math.cos(lat0) * EARTH_RADIUS_M,
    y: toRad(p.lat) * EARTH_RADIUS_M,
  }));
  let sum = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    sum += xy[j].x * xy[i].y - xy[i].x * xy[j].y;
  }
  return Math.abs(sum / 2);
}

export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  return `${m2.toFixed(0)} m²`;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1 min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}
