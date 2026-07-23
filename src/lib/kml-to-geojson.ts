import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

function parseCoordinates(text: string): Position[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((triplet) => {
      const [lng, lat, alt] = triplet.split(",").map(Number);
      return alt !== undefined && !Number.isNaN(alt) ? [lng, lat, alt] : [lng, lat];
    });
}

function geomFromPlacemark(pm: Element): Geometry | null {
  const point = pm.getElementsByTagName("Point")[0];
  if (point) {
    const c = parseCoordinates(point.getElementsByTagName("coordinates")[0]?.textContent ?? "");
    if (c[0]) return { type: "Point", coordinates: c[0] };
  }
  const line = pm.getElementsByTagName("LineString")[0];
  if (line) {
    const c = parseCoordinates(line.getElementsByTagName("coordinates")[0]?.textContent ?? "");
    return { type: "LineString", coordinates: c };
  }
  const poly = pm.getElementsByTagName("Polygon")[0];
  if (poly) {
    const outer = poly.getElementsByTagName("outerBoundaryIs")[0];
    const inners = Array.from(poly.getElementsByTagName("innerBoundaryIs"));
    const rings: Position[][] = [];
    const outerCoords = outer?.getElementsByTagName("coordinates")[0]?.textContent;
    if (outerCoords) rings.push(parseCoordinates(outerCoords));
    for (const inner of inners) {
      const t = inner.getElementsByTagName("coordinates")[0]?.textContent;
      if (t) rings.push(parseCoordinates(t));
    }
    return { type: "Polygon", coordinates: rings };
  }
  const multi = pm.getElementsByTagName("MultiGeometry")[0];
  if (multi) {
    const geoms: Geometry[] = [];
    for (const child of Array.from(multi.children)) {
      const wrapper = pm.ownerDocument!.createElement("Placemark");
      wrapper.appendChild(child.cloneNode(true));
      const g = geomFromPlacemark(wrapper);
      if (g) geoms.push(g);
    }
    return { type: "GeometryCollection", geometries: geoms };
  }
  return null;
}

export function kmlToGeoJSON(kmlText: string): FeatureCollection {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) throw new Error("Invalid KML/XML file");

  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const features: Feature[] = [];
  for (const pm of placemarks) {
    const geometry = geomFromPlacemark(pm);
    if (!geometry) continue;
    const name = pm.getElementsByTagName("name")[0]?.textContent ?? null;
    const description = pm.getElementsByTagName("description")[0]?.textContent ?? null;
    features.push({
      type: "Feature",
      geometry,
      properties: { name, description },
    });
  }
  return { type: "FeatureCollection", features };
}
