import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useApp } from "@/lib/app-context";
import { AppShell } from "@/components/AppShell";
import type { FeatureCollection } from "geojson";
import type { AreaSelection } from "@/components/AreaTravelTool";
import { formatArea } from "@/lib/geo-area";
import { geoJSONToTab } from "@/lib/mapinfo-tab";
import {
  createSelectionRasterOverlay,
  geoJSONToKmlWithGroundOverlay,
  mapInfoRasterTab,
  resolveQuality,
  estimateOutputMB,
  type QualityPreset,
  type ProgressInfo,
  type RasterOverlay,
} from "@/lib/map-raster-export";
import { zipSync, strToU8 } from "fflate";
import { Database, Search, MapPin, Layers } from "lucide-react";

const ExploreMap = lazy(() => import("@/components/ExploreMap"));

export const BASEMAPS = {
  OpenStreetMap: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    subdomains: "abc",
  },
  BingMap: {
    url: "https://ecn.t{s}.tiles.virtualearth.net/tiles/r{q}.jpeg?g=1",
    attribution: "© Microsoft Bing Maps",
    subdomains: "0123",
  },
  BingSatelliteMap: {
    url: "https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1",
    attribution: "© Microsoft Bing Maps",
    subdomains: "0123",
  },
  BingHybridMap: {
    url: "https://ecn.t{s}.tiles.virtualearth.net/tiles/h{q}.jpeg?g=1",
    attribution: "© Microsoft Bing Maps",
    subdomains: "0123",
  },
  GoogleMap: {
    url: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    attribution: "© Google Maps",
    subdomains: "0123",
  },
  GoogleSatelliteMap: {
    url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    attribution: "© Google Maps",
    subdomains: "0123",
  },
  GoogleHybridMap: {
    url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    attribution: "© Google Maps",
    subdomains: "0123",
  },
  GoogleTerrainMap: {
    url: "https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    attribution: "© Google Maps",
    subdomains: "0123",
  },
} as const;

export type BasemapKey = keyof typeof BASEMAPS;

type SearchResult = {
  lat: number;
  lon: number;
  display_name: string;
  boundingbox?: [string, string, string, string];
};

type ExportFormat = "json" | "kml" | "kmz" | "tab";

function downloadBlob(name: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore Map — RouteScope" },
      {
        name: "description",
        content:
          "Explore an interactive map. Search by governorate or place and switch between Bing, Google, and OpenStreetMap layers.",
      },
      { property: "og:title", content: "Explore Map — RouteScope" },
      {
        property: "og:description",
        content: "Search places and switch between Bing, Google, and OSM basemaps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExplorePage,
});

function ExplorePage() {
  const [basemap, setBasemap] = useState<BasemapKey>("OpenStreetMap");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<{ lat: number; lon: number; zoom: number; label: string } | null>(
    null,
  );
  const [areaSelection, setAreaSelection] = useState<AreaSelection | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [quality, setQuality] = useState<QualityPreset>("auto");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  useApp();

  async function createRasterFallback(
    onProgress: (p: ProgressInfo) => void,
  ): Promise<RasterOverlay | null> {
    const q = resolveQuality(quality);
    try {
      if (!areaSelection) return null;
      return await createSelectionRasterOverlay(areaSelection.feature, BASEMAPS[basemap], {
        quality: q,
        onProgress,
      });
    } catch (primaryError) {
      if (!areaSelection || basemap === "OpenStreetMap") {
        throw primaryError;
      }
      return createSelectionRasterOverlay(areaSelection.feature, BASEMAPS.OpenStreetMap, {
        quality: q,
        onProgress,
      });
    }
  }

  async function exportSelection() {
    if (!areaSelection) return;
    setExportError("");
    setProgress({ loaded: 0, total: 0, percent: 0, etaSeconds: 0 });
    setExporting(true);
    try {
      const boundaryFeature = {
        ...areaSelection.feature,
        properties: {
          ...(areaSelection.feature.properties ?? {}),
          name: "Selection boundary",
          export_role: "selection_boundary",
          area_m2: Math.round(areaSelection.areaM2),
        },
      };
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: [boundaryFeature],
      };
      const base = "explore-selection";
      let rasterOverlay: RasterOverlay | null = null;
      let rasterError = "";
      try {
        rasterOverlay = await createRasterFallback(setProgress);
      } catch (e) {
        rasterError = e instanceof Error ? e.message : "Raster map export failed.";
      }

      if (!rasterOverlay) throw new Error(`Raster map export failed: ${rasterError}`);
      const ext = rasterOverlay.mimeType === "image/jpeg" ? "jpg" : "png";
      const imgName = `selection-basemap.${ext}`;

      if (exportFormat === "json") {
        const zipped = zipSync({
          [`${base}.json`]: strToU8(JSON.stringify(fc, null, 2)),
          [imgName]: rasterOverlay.bytes,
        });
        downloadBlob(`${base}-geojson.zip`, zipped, "application/zip");
      } else if (exportFormat === "kml") {
        const kml = geoJSONToKmlWithGroundOverlay(fc, {
          ...rasterOverlay,
          kmlHref: `data:${rasterOverlay.mimeType};base64,${bytesToBase64(rasterOverlay.bytes)}`,
        });
        downloadBlob(`${base}.kml`, kml, "application/vnd.google-earth.kml+xml");
      } else if (exportFormat === "kmz") {
        const overlay = { ...rasterOverlay, kmlHref: `files/${imgName}` };
        const zipped = zipSync({
          "doc.kml": strToU8(geoJSONToKmlWithGroundOverlay(fc, overlay)),
          [overlay.kmlHref]: rasterOverlay.bytes,
        });
        downloadBlob(`${base}.kmz`, zipped, "application/vnd.google-earth.kmz");
      } else {
        const tabFiles = await geoJSONToTab(fc, base);
        const files: Record<string, Uint8Array> = Object.fromEntries(
          tabFiles.map((f) => [f.name, f.bytes]),
        );
        files[imgName] = rasterOverlay.bytes;
        files["selection-basemap.tab"] = strToU8(mapInfoRasterTab(rasterOverlay, imgName));
        const zipped = zipSync(files);
        downloadBlob(`${base}-mapinfo.zip`, zipped, "application/zip");
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError("");
    setResults([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = (await res.json()) as SearchResult[];
      setResults(data);
      if (data[0]) pickResult(data[0]);
      else setError("No matches found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r: SearchResult) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    let zoom = 12;
    if (r.boundingbox) {
      const [s, n, w, e] = r.boundingbox.map(Number);
      const span = Math.max(Math.abs(n - s), Math.abs(e - w));
      if (span > 5) zoom = 6;
      else if (span > 1) zoom = 8;
      else if (span > 0.2) zoom = 10;
      else if (span > 0.05) zoom = 12;
      else zoom = 14;
    }
    setTarget({ lat, lon, zoom, label: r.display_name });
  }

  return (
    <AppShell
      title="Explore map"
      subtitle="Search any place — swap between OSM, Bing and Google layers."
    >
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <form
            onSubmit={runSearch}
            className="rounded-2xl border bg-card p-4 shadow-elevated bg-gradient-surface space-y-3"
          >
            <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Search place / governorate
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cairo, Giza, Alexandria…"
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="w-full rounded-md bg-gradient-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-glow hover:brightness-110 disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search"}
            </button>
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </form>

          <div className="rounded-2xl border bg-card p-4 shadow-elevated bg-gradient-surface space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3.5 w-3.5" /> Basemap
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.keys(BASEMAPS).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBasemap(k as BasemapKey)}
                  className={`rounded-md border px-2 py-1.5 text-left text-[11px] font-medium transition-colors ${
                    basemap === k
                      ? "border-primary bg-primary text-primary-foreground shadow-glow"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {k.replace(/Map$/, "")}
                </button>
              ))}
            </div>
          </div>

          {results.length > 1 && (
            <div className="rounded-2xl border bg-card p-3 shadow-elevated text-sm">
              <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Other matches
              </p>
              <ul className="max-h-52 overflow-auto">
                {results.map((r, i) => (
                  <li key={`${r.lat}-${r.lon}-${i}`}>
                    <button
                      type="button"
                      onClick={() => pickResult(r)}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="line-clamp-2">{r.display_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {areaSelection && (
            <div className="rounded-2xl border bg-card p-4 shadow-elevated bg-gradient-surface space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Selection
              </p>
              <p className="font-display text-lg font-semibold">
                {formatArea(areaSelection.areaM2)}
              </p>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Export as
              </label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="json">GeoJSON (.json)</option>
                <option value="kml">KML (.kml)</option>
                <option value="kmz">KMZ (.kmz)</option>
                <option value="tab">MapInfo TAB (.tab + .map + .dat + .id)</option>
              </select>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualityPreset)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="standard">Standard — ~{estimateOutputMB(resolveQuality("standard"))} MB, fastest</option>
                <option value="high">High — ~{estimateOutputMB(resolveQuality("high"))} MB</option>
                <option value="ultra">Ultra — ~{estimateOutputMB(resolveQuality("ultra"))} MB, slowest</option>
              </select>
              <button
                type="button"
                onClick={exportSelection}
                disabled={exporting}
                className="w-full rounded-md bg-gradient-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow-glow hover:brightness-110 disabled:opacity-60"
              >
                {exporting
                  ? progress && progress.total > 0
                    ? `Rendering ${progress.percent}% (${progress.loaded}/${progress.total} tiles, ~${progress.etaSeconds}s)`
                    : "Preparing download…"
                  : "Download map image"}
              </button>
              {exporting && progress && progress.total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-gradient-brand transition-[width] duration-200"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              )}
              <div className="flex items-start gap-2 rounded-md border border-input bg-background/70 px-2.5 py-2 text-[11px] text-muted-foreground">
                <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  Exports the selection boundary plus a high-resolution georeferenced map image
                  (JPEG-compressed to keep the download small).
                </span>
              </div>
              {exportError && <p className="text-xs text-destructive">{exportError}</p>}
            </div>
          )}
        </aside>

        <div className="w-full overflow-hidden rounded-2xl border bg-muted shadow-elevated h-[calc(100vh-9rem)] min-h-[520px]">
          <ClientOnly
            fallback={
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                Loading map…
              </div>
            }
          >
            <Suspense
              fallback={
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  Loading map…
                </div>
              }
            >
              <ExploreMap
                basemap={basemap}
                target={target}
                onAreaSelectionChange={setAreaSelection}
              />
            </Suspense>
          </ClientOnly>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Search powered by OpenStreetMap Nominatim. Basemap tiles are subject to each provider's
        terms of use.
      </p>
    </AppShell>
  );
}
