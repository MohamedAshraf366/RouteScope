import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Polygon,
} from "geojson";
import type { LatLng } from "@/lib/geo-area";

export const ROUTE_STYLE = {
  color: "#2563eb",
  weight: 6,
  opacity: 0.9,
  lineCap: "round" as const,
  lineJoin: "round" as const,
};

export type DecimationFidelity = "low" | "medium" | "high";

const DECIMATION_TOLERANCE: Record<DecimationFidelity, number> = {
  low: 0.000012,
  medium: 0.000003,
  high: 0.00000075,
};

function pointSegmentDistance(p: LatLng, a: LatLng, b: LatLng) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.hypot(p.lng - a.lng, p.lat - a.lat);
  const t = Math.max(
    0,
    Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.lng - (a.lng + t * dx), p.lat - (a.lat + t * dy));
}

/** Ramer–Douglas–Peucker decimation. Endpoints and significant bends are retained. */
export function decimatePath(points: LatLng[], tolerance = 0.000003): LatLng[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const range = stack.pop();
    if (!range) break;
    const [start, end] = range;
    let farthest = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = pointSegmentDistance(points[i], points[start], points[end]);
      if (distance > farthest) {
        farthest = distance;
        index = i;
      }
    }
    if (index > start && farthest > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

function cornerAngle(a: LatLng, b: LatLng, c: LatLng) {
  const ab = { x: a.lng - b.lng, y: a.lat - b.lat };
  const cb = { x: c.lng - b.lng, y: c.lat - b.lat };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denominator) return 180;
  const cosine = Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Smooths small hand jitter while retaining deliberately drawn corners. */
export function processPath(
  points: LatLng[],
  intensity: number,
  fidelity: DecimationFidelity = "medium",
): LatLng[] {
  const amount = Math.max(0, Math.min(100, intensity));
  let result = decimatePath(points, DECIMATION_TOLERANCE[fidelity]);
  const passes = Math.round(amount / 25);
  const blend = amount / 200;
  for (let pass = 0; pass < passes; pass += 1) {
    result = result.map((point, index, path) => {
      const previous = path[index - 1];
      const next = path[index + 1];
      if (!previous || !next || cornerAngle(previous, point, next) < 140) return point;
      return {
        lat: point.lat * (1 - blend) + ((previous.lat + next.lat) / 2) * blend,
        lng: point.lng * (1 - blend) + ((previous.lng + next.lng) / 2) * blend,
      };
    });
  }
  return result;
}

function processCoordinates(
  coordinates: number[][],
  intensity: number,
  fidelity: DecimationFidelity,
  closed = false,
) {
  const source = coordinates.map((position) => ({ lng: position[0] ?? 0, lat: position[1] ?? 0 }));
  if (closed && source.length > 1) source.pop();
  const processed = processPath(source, intensity, fidelity).map((point) => [point.lng, point.lat]);
  const first = processed[0];
  if (closed && first) processed.push([first[0], first[1]]);
  return processed;
}

function processGeometry(
  geometry: Geometry,
  intensity: number,
  fidelity: DecimationFidelity,
): Geometry {
  if (geometry.type === "LineString") {
    return {
      ...geometry,
      coordinates: processCoordinates(geometry.coordinates, intensity, fidelity),
    } as LineString;
  }
  if (geometry.type === "MultiLineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) =>
        processCoordinates(line, intensity, fidelity),
      ),
    } as MultiLineString;
  }
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) =>
        processCoordinates(ring, intensity, fidelity, true),
      ),
    } as Polygon;
  }
  return geometry;
}

export type RouteStyle = { color: string; weight: number };

/** Converts point-only route files into paths and applies the exact geometry used by display/export. */
export function processFeatureCollection(
  fc: FeatureCollection,
  intensity: number,
  fidelity: DecimationFidelity = "medium",
  style?: Partial<RouteStyle>,
): FeatureCollection {
  const stroke = style?.color ?? ROUTE_STYLE.color;
  const weight = style?.weight ?? ROUTE_STYLE.weight;
  const styleProps = {
    stroke,
    "stroke-width": weight,
    "stroke-opacity": ROUTE_STYLE.opacity,
  };
  const points: number[][] = [];
  const features: Feature[] = [];
  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type === "Point") points.push(feature.geometry.coordinates);
    else {
      features.push({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          ...styleProps,
        },
        geometry: processGeometry(feature.geometry, intensity, fidelity),
      });
    }
  }
  if (points.length >= 2) {
    features.push({
      type: "Feature",
      properties: { ...styleProps },
      geometry: {
        type: "LineString",
        coordinates: processCoordinates(points, intensity, fidelity),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

