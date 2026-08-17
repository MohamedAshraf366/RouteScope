import type { FeatureCollection, Position } from "geojson";

const R = 6371; // km

function haversine(a: Position, b: Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function lineLength(coords: Position[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/** Total length in kilometers across all LineString / MultiLineString features.
 *  Falls back to connecting sequential Point features in file order when no line geometry exists. */
export function totalRouteLengthKm(fc: FeatureCollection): number {
  let total = 0;
  const pts: Position[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      total += lineLength(g.coordinates);
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) total += lineLength(line);
    } else if (g.type === "Point") {
      pts.push(g.coordinates);
    } else if (g.type === "GeometryCollection") {
      for (const sub of g.geometries) {
        if (sub.type === "LineString") total += lineLength(sub.coordinates);
        else if (sub.type === "MultiLineString")
          for (const line of sub.coordinates) total += lineLength(line);
      }
    }
  }
  // Sequential Points are drawn as a single blue polyline on the map — include them too.
  if (pts.length >= 2) total += lineLength(pts);
  return total;
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${m.toString().padStart(2, "0")} min`;
}
