import type { FeatureCollection } from "geojson";
import { zipSync, strToU8 } from "fflate";
import { geoJSONToKml } from "@/lib/geojson-to-kml";
import { geoJSONToTab } from "@/lib/mapinfo-tab";

export type ExportFormat = "json" | "kml" | "kmz" | "tab";

export const EXPORT_FORMATS: { key: ExportFormat; label: string; hint: string }[] = [
  { key: "json", label: "GeoJSON", hint: ".json" },
  { key: "kml", label: "KML", hint: ".kml" },
  { key: "kmz", label: "KMZ", hint: ".kmz" },
  { key: "tab", label: "MapInfo TAB", hint: ".tab + .map + .dat + .id (zipped)" },
];

export function downloadBlob(name: string, content: BlobPart | Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeBase(name: string) {
  return (name.replace(/\.[^.]+$/, "").replace(/[^\w\-. ]+/g, "_").trim() || "export").slice(0, 60);
}

/** Build the byte payload(s) for one feature collection in the chosen format. */
export async function buildExportFiles(
  fc: FeatureCollection,
  base: string,
  format: ExportFormat,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (format === "json") {
    return [{ name: `${base}.json`, bytes: strToU8(JSON.stringify(fc, null, 2)) }];
  }
  if (format === "kml") {
    return [{ name: `${base}.kml`, bytes: strToU8(geoJSONToKml(fc)) }];
  }
  if (format === "kmz") {
    return [
      { name: `${base}.kmz`, bytes: zipSync({ "doc.kml": strToU8(geoJSONToKml(fc)) }) },
    ];
  }
  return geoJSONToTab(fc, base);
}

const MIME: Record<ExportFormat, string> = {
  json: "application/json",
  kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz",
  tab: "application/zip",
};

/** Download a single feature collection. TAB is delivered as a zip of its 4 parts. */
export async function downloadFeatureCollection(
  fc: FeatureCollection,
  name: string,
  format: ExportFormat,
) {
  const base = safeBase(name);
  const files = await buildExportFiles(fc, base, format);
  if (format === "tab") {
    const zipped = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])));
    downloadBlob(`${base}-mapinfo.zip`, zipped, MIME.tab);
    return;
  }
  const only = files[0]!;
  downloadBlob(only.name, only.bytes, MIME[format]);
}

/** Download several items at once as a single zip (one folder-free file per item). */
export async function downloadAllAsZip(
  items: { name: string; fc: FeatureCollection }[],
  format: ExportFormat,
  zipName = "routescope-export.zip",
) {
  const entries: Record<string, Uint8Array> = {};
  for (const [i, item] of items.entries()) {
    const base = `${String(i + 1).padStart(2, "0")}-${safeBase(item.name)}`;
    const files = await buildExportFiles(item.fc, base, format);
    for (const f of files) {
      entries[format === "tab" ? `${base}/${f.name}` : f.name] = f.bytes;
    }
  }
  downloadBlob(zipName, zipSync(entries), "application/zip");
}

/** Merge every item into one feature collection and download it as one file. */
export async function downloadMerged(
  items: { name: string; fc: FeatureCollection }[],
  format: ExportFormat,
  name = "routescope-merged",
) {
  const merged: FeatureCollection = {
    type: "FeatureCollection",
    features: items.flatMap((item) =>
      item.fc.features.map((f) => ({
        ...f,
        properties: { name: item.name, ...(f.properties ?? {}) },
      })),
    ),
  };
  await downloadFeatureCollection(merged, name, format);
}
