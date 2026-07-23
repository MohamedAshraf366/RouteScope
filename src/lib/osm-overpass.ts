import type { Feature, FeatureCollection, Geometry, GeoJsonProperties, Polygon } from "geojson";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  center?: { lat: number; lon: number };
  members?: Array<{
    type: string;
    role?: string;
    ref: number;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
  remark?: string;
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function closeRing(coords: number[][]): number[][] {
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) return coords;
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, [first[0], first[1]]];
}

function isClosed(coords: number[][]): boolean {
  const first = coords[0];
  const last = coords[coords.length - 1];
  return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
}

function polygonToOverpassPoly(feature: Feature<Polygon>): string {
  const outerRing = feature.geometry.coordinates[0] ?? [];
  return outerRing
    .slice(0, outerRing.length > 1 ? -1 : undefined)
    .map(([lng, lat]) => `${lat} ${lng}`)
    .join(" ");
}

function buildQuery(poly: string): string {
  // Narrow to useful vector layers so the query completes on public Overpass
  // servers (the catch-all [~"."~"."] regex frequently times out with 504).
  const filters = [
    "highway",
    "railway",
    "waterway",
    "building",
    "landuse",
    "natural",
    "leisure",
    "amenity",
    "shop",
    "tourism",
    "man_made",
    "power",
    "aeroway",
    "boundary",
    "place",
  ];
  const nodeQ = filters.map((k) => `  node(poly:"${poly}")["${k}"];`).join("\n");
  const wayQ = filters.map((k) => `  way(poly:"${poly}")["${k}"];`).join("\n");
  const relQ = filters
    .map((k) => `  relation(poly:"${poly}")["${k}"];`)
    .join("\n");
  return `[out:json][timeout:90];
(
${nodeQ}
${wayQ}
${relQ}
);
out tags geom center qt;`;
}

function safePropertyName(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return safe.length > 56 ? safe.slice(0, 56) : safe;
}

function displayName(tags: Record<string, string>): string {
  return (
    tags.name ??
    tags["name:en"] ??
    tags.ref ??
    tags.highway ??
    tags.building ??
    tags.amenity ??
    tags.landuse ??
    tags.natural ??
    "OSM feature"
  );
}

function propertiesFor(element: OverpassElement): GeoJsonProperties {
  const tags = element.tags ?? {};
  const props: Record<string, string | number> = {
    name: displayName(tags),
    osm_id: `${element.type}/${element.id}`,
    osm_type: element.type,
  };

  for (const [key, value] of Object.entries(tags)) {
    props[safePropertyName(key)] = value;
  }

  return props;
}

function coordsFromGeometry(geometry: Array<{ lat: number; lon: number }>): number[][] {
  return geometry.map((p) => [p.lon, p.lat]);
}

function elementGeometry(element: OverpassElement): Geometry | null {
  if (element.type === "node") {
    if (element.lon === undefined || element.lat === undefined) return null;
    return { type: "Point", coordinates: [element.lon, element.lat] };
  }

  if (element.type === "way" && element.geometry && element.geometry.length >= 2) {
    const coords = coordsFromGeometry(element.geometry);
    if (coords.length >= 4 && isClosed(coords)) {
      return { type: "Polygon", coordinates: [closeRing(coords)] };
    }
    return { type: "LineString", coordinates: coords };
  }

  if (element.type === "relation") {
    const outerRings =
      element.members
        ?.filter((member) => member.geometry && (!member.role || member.role === "outer"))
        .map((member) => closeRing(coordsFromGeometry(member.geometry as Array<{ lat: number; lon: number }>)))
        .filter((ring) => ring.length >= 4) ?? [];

    if (outerRings.length > 0 && (element.tags?.type === "multipolygon" || element.tags?.type === "boundary")) {
      return { type: "MultiPolygon", coordinates: outerRings.map((ring) => [ring]) };
    }

    const lines =
      element.members
        ?.filter((member) => member.geometry && member.geometry.length >= 2)
        .map((member) => coordsFromGeometry(member.geometry as Array<{ lat: number; lon: number }>)) ?? [];
    if (lines.length === 1) return { type: "LineString", coordinates: lines[0] };
    if (lines.length > 1) return { type: "MultiLineString", coordinates: lines };

    if (element.center) {
      return { type: "Point", coordinates: [element.center.lon, element.center.lat] };
    }
  }

  return null;
}

function elementToFeature(element: OverpassElement): Feature | null {
  const geometry = elementGeometry(element);
  if (!geometry) return null;
  return {
    type: "Feature",
    properties: propertiesFor(element),
    geometry,
  };
}

export async function fetchOsmDetailsForPolygon(
  selectionFeature: Feature<Polygon>,
): Promise<FeatureCollection> {
  const poly = polygonToOverpassPoly(selectionFeature);
  if (!poly) throw new Error("The selected area is not a valid polygon.");

  const query = buildQuery(poly);
  let lastError = "OpenStreetMap detail request failed.";

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: query }),
      });

      const text = await response.text();
      if (!response.ok) {
        lastError = `OpenStreetMap detail request failed (${response.status}): ${text.slice(0, 240)}`;
        continue;
      }

      const data = JSON.parse(text) as OverpassResponse;
      if (data.remark) lastError = data.remark;
      const features = (data.elements ?? [])
        .map(elementToFeature)
        .filter((feature): feature is Feature => Boolean(feature));

      return { type: "FeatureCollection", features };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  throw new Error(lastError);
}