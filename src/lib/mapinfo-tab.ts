import type { FeatureCollection } from "geojson";

/** Native MapInfo TAB read/write, backed by a real GDAL build (gdal3.js,
 *  WebAssembly) running entirely in the browser. This produces/consumes
 *  genuine .tab/.map/.dat/.id files — the same binary format MapInfo Pro
 *  and GDAL/ogr2ogr itself write — instead of a hand-rolled approximation. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gdal = any;

let gdalPromise: Promise<Gdal> | null = null;

const GDAL_CDN = "https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package";

/** Classic Workers can't be constructed from a cross-origin URL, so we wrap
 *  any cross-origin worker script in a same-origin blob that `importScripts`
 *  the real script. Subsequent fetches from inside the worker (wasm, data)
 *  are plain cross-origin fetches, which jsdelivr allows via CORS. */
function patchWorkerForCrossOrigin() {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    Worker: typeof Worker;
    __gdalWorkerPatched?: boolean;
  };
  if (w.__gdalWorkerPatched) return;
  const Original = w.Worker;
  class PatchedWorker extends Original {
    constructor(url: string | URL, opts?: WorkerOptions) {
      const src = typeof url === "string" ? url : url.href;
      try {
        const abs = new URL(src, window.location.href);
        if (abs.origin !== window.location.origin) {
          const blob = new Blob([`importScripts(${JSON.stringify(abs.href)});`], {
            type: "application/javascript",
          });
          super(URL.createObjectURL(blob), opts);
          return;
        }
      } catch {
        // fall through
      }
      super(url, opts);
    }
  }
  w.Worker = PatchedWorker as unknown as typeof Worker;
  w.__gdalWorkerPatched = true;
}

async function getGdal(): Promise<Gdal> {
  if (!gdalPromise) {
    gdalPromise = (async () => {
      patchWorkerForCrossOrigin();
      const { default: initGdalJs } = await import("gdal3.js");
      return initGdalJs({ path: GDAL_CDN });
    })();
  }
  return gdalPromise;
}

export type NamedFile = { name: string; bytes: Uint8Array<ArrayBuffer> };

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.slice();
}

/** MapInfo TAB files hold a SINGLE geometry type per table. A mixed
 *  FeatureCollection (points + lines + polygons) must be split into one
 *  TAB per geometry family, otherwise ogr2ogr silently drops the geometries
 *  that don't match the first feature — which is why roads/buildings were
 *  missing and only points showed up in MapInfo Pro. */
function splitByGeometryFamily(fc: FeatureCollection): Record<string, FeatureCollection> {
  const groups: Record<string, FeatureCollection> = {};
  for (const feature of fc.features) {
    const t = feature.geometry?.type;
    if (!t) continue;
    let family: "points" | "lines" | "polygons";
    if (t === "Point" || t === "MultiPoint") family = "points";
    else if (t === "LineString" || t === "MultiLineString") family = "lines";
    else if (t === "Polygon" || t === "MultiPolygon") family = "polygons";
    else continue;
    if (!groups[family]) groups[family] = { type: "FeatureCollection", features: [] };
    groups[family].features.push(feature);
  }
  return groups;
}

async function convertOne(
  Gdal: Gdal,
  fc: FeatureCollection,
  baseName: string,
): Promise<NamedFile[]> {
  const file = new File([JSON.stringify(fc)], `${baseName}.geojson`, {
    type: "application/geo+json",
  });
  const { datasets, errors } = await Gdal.open([file]);
  if (!datasets.length) {
    throw new Error(errors?.[0]?.message ?? "Failed to read GeoJSON for MapInfo export.");
  }
  const dataset = datasets[0];
  try {
    const output = await Gdal.ogr2ogr(dataset, ["-f", "MapInfo File"], baseName);
    const files: NamedFile[] = [];
    for (const f of output.all as { local: string }[]) {
      const bytes: Uint8Array = await Gdal.getFileBytes(f.local);
      files.push({ name: f.local.split("/").pop() as string, bytes: toArrayBufferBytes(bytes) });
    }
    return files;
  } finally {
    Gdal.close(dataset);
  }
}

/** Convert a GeoJSON FeatureCollection to native MapInfo TAB datasets, one
 *  per geometry family (points/lines/polygons). Returns all sibling files. */
export async function geoJSONToTab(fc: FeatureCollection, baseName: string): Promise<NamedFile[]> {
  const Gdal = await getGdal();
  const groups = splitByGeometryFamily(fc);
  const familyNames = Object.keys(groups);
  if (familyNames.length === 0) return [];
  if (familyNames.length === 1) {
    return convertOne(Gdal, groups[familyNames[0]], baseName);
  }
  const results: NamedFile[] = [];
  for (const family of familyNames) {
    const part = await convertOne(Gdal, groups[family], `${baseName}_${family}`);
    results.push(...part);
  }
  return results;
}

/** Convert a native MapInfo TAB dataset (the .tab plus its sibling
 *  .map/.dat/.id/.ind files) into a GeoJSON FeatureCollection. */
export async function tabToGeoJSON(files: File[]): Promise<FeatureCollection> {
  const Gdal = await getGdal();
  const { datasets, errors } = await Gdal.open(files);
  if (!datasets.length) {
    throw new Error(
      errors?.[0]?.message ??
        "Failed to open the MapInfo TAB set. Make sure all of " +
          ".TAB/.MAP/.DAT/.ID are selected together.",
    );
  }
  const dataset = datasets[0];
  try {
    const output = await Gdal.ogr2ogr(dataset, ["-f", "GeoJSON"]);
    const bytes: Uint8Array = await Gdal.getFileBytes(output.local);
    const text = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(text) as FeatureCollection;
  } finally {
    Gdal.close(dataset);
  }
}
