import type { FeatureCollection, Feature, Geometry, GeoJsonProperties, Position } from "geojson";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function coord(p: Position): string {
  return `${p[0]},${p[1]}${p[2] !== undefined ? "," + p[2] : ""}`;
}
function coords(list: Position[]): string {
  return list.map(coord).join(" ");
}

function propertiesToDescription(properties: GeoJsonProperties): string {
  if (!properties) return "";
  const rows = Object.entries(properties)
    .filter(([key, value]) => key !== "name" && key !== "description" && value !== undefined && value !== null)
    .map(([key, value]) => `${esc(key)}: ${esc(String(value))}`);
  return rows.join("\n");
}

function geomToKml(g: Geometry): string {
  switch (g.type) {
    case "Point":
      return `<Point><coordinates>${coord(g.coordinates)}</coordinates></Point>`;
    case "LineString":
      return `<LineString><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
    case "Polygon":
      return `<Polygon>${g.coordinates
        .map(
          (ring, i) =>
            `<${i === 0 ? "outerBoundaryIs" : "innerBoundaryIs"}><LinearRing><coordinates>${coords(
              ring,
            )}</coordinates></LinearRing></${i === 0 ? "outerBoundaryIs" : "innerBoundaryIs"}>`,
        )
        .join("")}</Polygon>`;
    case "MultiPoint":
      return `<MultiGeometry>${g.coordinates
        .map((c) => `<Point><coordinates>${coord(c)}</coordinates></Point>`)
        .join("")}</MultiGeometry>`;
    case "MultiLineString":
      return `<MultiGeometry>${g.coordinates
        .map((l) => `<LineString><coordinates>${coords(l)}</coordinates></LineString>`)
        .join("")}</MultiGeometry>`;
    case "MultiPolygon":
      return `<MultiGeometry>${g.coordinates
        .map((poly) =>
          geomToKml({ type: "Polygon", coordinates: poly } as Geometry),
        )
        .join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${g.geometries.map(geomToKml).join("")}</MultiGeometry>`;
  }
}

function featureToKml(f: Feature): string {
  const name = (f.properties?.name as string) ?? "";
  const desc = (f.properties?.description as string) ?? propertiesToDescription(f.properties);
  return `<Placemark>${name ? `<name>${esc(name)}</name>` : ""}${
    desc ? `<description>${esc(desc)}</description>` : ""
  }${f.geometry ? geomToKml(f.geometry) : ""}</Placemark>`;
}

export function geoJSONToKml(fc: FeatureCollection): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${fc.features
    .map(featureToKml)
    .join("")}</Document></kml>`;
}
