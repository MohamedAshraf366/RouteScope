import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import { kmlToGeoJSON } from "@/lib/kml-to-geojson";
import { extractKmlText } from "@/lib/extract-kml";
import { totalRouteLengthKm, formatDuration } from "@/lib/route-stats";
import { useApp } from "@/lib/app-context";
import { AppShell } from "@/components/AppShell";
import type { AreaSelection } from "@/components/AreaTravelTool";
import { formatArea } from "@/lib/geo-area";
import { geoJSONToKml } from "@/lib/geojson-to-kml";
import { geoJSONToTab } from "@/lib/mapinfo-tab";
import { zipSync, strToU8 } from "fflate";
import { Upload } from "lucide-react";

const KmlMap = lazy(() => import("@/components/KmlMap"));

type ExportFormat = "json" | "kml" | "kmz" | "tab";

function downloadBlob(name: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RouteScope — Visualize KML/KMZ routes" },
      {
        name: "description",
        content:
          "Upload a .kml or .kmz file to view the route on a map and estimate drive time by speed.",
      },
      { property: "og:title", content: "RouteScope — Route viewer" },
      {
        property: "og:description",
        content: "Inspect KML/KMZ routes and estimate drive time in the browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { t } = useApp();
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [speed, setSpeed] = useState<number>(50);
  const [busyMultiplier, setBusyMultiplier] = useState<number>(1.8);
  const [loading, setLoading] = useState(false);
  const [areaSelection, setAreaSelection] = useState<AreaSelection | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>("");

  async function exportSelection() {
    if (!areaSelection) return;
    setExportError("");
    setExporting(true);
    try {
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: [areaSelection.feature],
      };
      const base = (fileName.replace(/\.[^.]+$/, "") || "selection") + "-selection";
      if (exportFormat === "json") {
        downloadBlob(`${base}.json`, JSON.stringify(fc, null, 2), "application/json");
      } else if (exportFormat === "kml") {
        downloadBlob(`${base}.kml`, geoJSONToKml(fc), "application/vnd.google-earth.kml+xml");
      } else if (exportFormat === "kmz") {
        const zipped = zipSync({ "doc.kml": strToU8(geoJSONToKml(fc)) });
        downloadBlob(`${base}.kmz`, zipped, "application/vnd.google-earth.kmz");
      } else {
        const tabFiles = await geoJSONToTab(fc, base);
        const zipped = zipSync(Object.fromEntries(tabFiles.map((f) => [f.name, f.bytes])));
        downloadBlob(`${base}-mapinfo.zip`, zipped, "application/zip");
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const fullDistanceKm = useMemo(() => (data ? totalRouteLengthKm(data) : 0), [data]);
  const distanceKm = areaSelection ? areaSelection.distanceM / 1000 : fullDistanceKm;
  const durationHours = speed > 0 ? distanceKm / speed : 0;
  const busyDurationHours = durationHours * busyMultiplier;

  async function handleFile(file: File) {
    setError("");
    setFileName(file.name);
    if (!/\.(kml|kmz)$/i.test(file.name)) {
      setError(t("invalidDrop"));
      setData(null);
      return;
    }
    setLoading(true);
    setData(null);
    setAreaSelection(null);
    try {
      const text = await extractKmlText(file);
      await new Promise((r) => setTimeout(r, 0));
      setData(kmlToGeoJSON(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <AppShell
      title="Route viewer"
      subtitle={fileName ? `${t("loaded")}: ${fileName}` : t("tagline")}
      actions={
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-gradient-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-glow transition-transform hover:-translate-y-px">
          <Upload className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t("chooseFile")}</span>
          <span className="sm:hidden">KML/KMZ</span>
          <input
            type="file"
            accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`w-full overflow-hidden rounded-2xl border bg-muted shadow-elevated transition-colors h-[70vh] ${
          dragOver ? "border-primary ring-2 ring-primary/40" : ""
        }`}
      >
        {loading ? (
          <Placeholder text={t("reading")} />
        ) : data ? (
          <ClientOnly fallback={<Placeholder text={t("loadingMap")} />}>
            <Suspense fallback={<Placeholder text={t("loadingMap")} />}>
              <KmlMap data={data} onAreaSelectionChange={setAreaSelection} />
            </Suspense>
          </ClientOnly>
        ) : (
          <Placeholder text={dragOver ? t("dropNow") : t("dropHere")} />
        )}
      </div>

      {data && (fullDistanceKm > 0 || areaSelection) && (
        <section className="mt-6 rounded-2xl border bg-card p-5 shadow-elevated bg-gradient-surface">
          {areaSelection ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
              <span>
                Selected area:{" "}
                <span className="font-medium text-foreground">
                  {formatArea(areaSelection.areaM2)}
                </span>
                {" · "}
                <span className="font-medium text-foreground">{areaSelection.pointCount}</span>{" "}
                route points inside
              </span>
              <button
                type="button"
                onClick={() => setAreaSelection(null)}
                className="rounded-md border border-input bg-background px-2 py-1 font-medium hover:bg-accent"
              >
                Show whole route instead
              </button>
            </div>
          ) : (
            <p className="mb-4 text-xs text-muted-foreground">
              Showing the whole route. Draw a square, circle, or pin shape on the map to estimate
              just that area instead.
            </p>
          )}

          {areaSelection && (
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-input bg-background/60 px-3 py-2">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground">
                  Export selected area as
                </label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  className="mt-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                >
                  <option value="json">GeoJSON (.json)</option>
                  <option value="kml">KML (.kml)</option>
                  <option value="kmz">KMZ (.kmz)</option>
                  <option value="tab">MapInfo native TAB (.tab + .map + .dat + .id)</option>
                </select>
              </div>
              <button
                type="button"
                onClick={exportSelection}
                disabled={exporting}
                className="rounded-md bg-gradient-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow-glow hover:brightness-110 disabled:opacity-60"
              >
                {exporting ? "Exporting…" : "Download selection"}
              </button>
              {exportError && <span className="text-xs text-destructive">{exportError}</span>}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-background/60 p-3">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("speed")}
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-display text-lg font-semibold outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="rounded-xl border bg-background/60 p-3">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Busy-hour slowdown ×
              </label>
              <input
                type="number"
                min={1}
                step={0.1}
                value={busyMultiplier}
                onChange={(e) => setBusyMultiplier(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-display text-lg font-semibold outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="rounded-xl border bg-background/60 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("distance")}
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-foreground">
                {distanceKm.toFixed(2)}{" "}
                <span className="text-sm font-medium text-muted-foreground">km</span>
              </p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-gradient-brand p-3 text-brand-foreground shadow-glow">
              <p className="text-[11px] font-medium uppercase tracking-wider text-brand-foreground/75">
                {t("eta")}
              </p>
              <p className="mt-1 font-display text-2xl font-bold">
                {formatDuration(busyDurationHours)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Estimate only — based on straight-line route distance and the speeds above, not live
            traffic data.
          </p>
        </section>
      )}

      {data && data.features.length > 0 && fullDistanceKm === 0 && !areaSelection && (
        <p className="mt-4 text-sm text-muted-foreground">{t("noRoute")}</p>
      )}
    </AppShell>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-input bg-background/60 text-primary">
        <Upload className="h-6 w-6" aria-hidden />
      </div>
      <p className="max-w-sm">{text}</p>
    </div>
  );
}
