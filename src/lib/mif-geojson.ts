import type { FeatureCollection, Feature, Geometry, Position } from "geojson";

/** Minimal MapInfo MIF (text) ↔ GeoJSON conversion.
 *  Supports POINT, LINE, PLINE, REGION. Attributes from MID are ignored on parse. */
export function mifToGeoJSON(mif: string): FeatureCollection {
  const lines = mif.split(/\r?\n/);
  const features: Feature[] = [];
  let i = 0;
  // Skip header until "Data"
  while (i < lines.length && !/^\s*Data\b/i.test(lines[i])) i++;
  i++;

  const readCoord = (s: string): Position => {
    const [x, y] = s.trim().split(/\s+/).map(Number);
    return [x, y];
  };

  while (i < lines.length) {
    const raw = lines[i]?.trim() ?? "";
    if (!raw) { i++; continue; }
    const upper = raw.toUpperCase();

    if (upper.startsWith("POINT")) {
      const parts = raw.split(/\s+/);
      features.push(geomFeature({ type: "Point", coordinates: [+parts[1], +parts[2]] }));
      i++;
    } else if (upper.startsWith("LINE ")) {
      const p = raw.split(/\s+/);
      features.push(
        geomFeature({
          type: "LineString",
          coordinates: [[+p[1], +p[2]], [+p[3], +p[4]]],
        }),
      );
      i++;
    } else if (upper.startsWith("PLINE")) {
      i++;
      const n = parseInt(lines[i].trim(), 10);
      i++;
      const pts: Position[] = [];
      for (let k = 0; k < n; k++, i++) pts.push(readCoord(lines[i]));
      features.push(geomFeature({ type: "LineString", coordinates: pts }));
    } else if (upper.startsWith("REGION")) {
      const numPolys = parseInt(raw.split(/\s+/)[1], 10);
      i++;
      const polys: Position[][][] = [];
      for (let p = 0; p < numPolys; p++) {
        const n = parseInt(lines[i].trim(), 10);
        i++;
        const ring: Position[] = [];
        for (let k = 0; k < n; k++, i++) ring.push(readCoord(lines[i]));
        if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]))
          ring.push(ring[0]);
        polys.push([ring]);
      }
      features.push(
        geomFeature(
          polys.length === 1
            ? { type: "Polygon", coordinates: polys[0] }
            : { type: "MultiPolygon", coordinates: polys },
        ),
      );
    } else {
      i++;
    }
  }
  return { type: "FeatureCollection", features };
}

function geomFeature(geometry: Geometry): Feature {
  return { type: "Feature", geometry, properties: {} };
}

export function geoJSONToMif(fc: FeatureCollection): { mif: string; mid: string } {
  const out: string[] = [
    "Version 300",
    'Charset "WindowsLatin1"',
    "Delimiter \",\"",
    "CoordSys Earth Projection 1, 104",
    "Columns 1",
    "  name Char(64)",
    "Data",
    "",
  ];
  const mid: string[] = [];
  const writeGeom = (g: Geometry) => {
    switch (g.type) {
      case "Point":
        out.push(`Point ${g.coordinates[0]} ${g.coordinates[1]}`);
        break;
      case "LineString":
        out.push(`Pline ${g.coordinates.length}`);
        for (const c of g.coordinates) out.push(`  ${c[0]} ${c[1]}`);
        break;
      case "Polygon":
        out.push(`Region ${g.coordinates.length}`);
        for (const ring of g.coordinates) {
          out.push(`  ${ring.length}`);
          for (const c of ring) out.push(`    ${c[0]} ${c[1]}`);
        }
        break;
      case "MultiPolygon": {
        const flat = g.coordinates.flatMap((poly) => poly);
        out.push(`Region ${flat.length}`);
        for (const ring of flat) {
          out.push(`  ${ring.length}`);
          for (const c of ring) out.push(`    ${c[0]} ${c[1]}`);
        }
        break;
      }
      case "MultiLineString":
        for (const line of g.coordinates) writeGeom({ type: "LineString", coordinates: line });
        break;
      case "MultiPoint":
        for (const p of g.coordinates) writeGeom({ type: "Point", coordinates: p });
        break;
      case "GeometryCollection":
        for (const sub of g.geometries) writeGeom(sub);
        break;
    }
  };
  for (const f of fc.features) {
    if (!f.geometry) continue;
    writeGeom(f.geometry);
    const name = (f.properties?.name as string) ?? "";
    mid.push(`"${name.replace(/"/g, '""')}"`);
  }
  return { mif: out.join("\n"), mid: mid.join("\n") };
}
