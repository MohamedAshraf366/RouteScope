import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import type { FeatureCollection } from "geojson";
import { kmlToGeoJSON } from "@/lib/kml-to-geojson";
import { extractKmlText } from "@/lib/extract-kml";
import { geoJSONToKml } from "@/lib/geojson-to-kml";
import { mifToGeoJSON } from "@/lib/mif-geojson";
import { geoJSONToTab, tabToGeoJSON } from "@/lib/mapinfo-tab";
import { zipSync, strToU8 } from "fflate";
import { useApp } from "@/lib/app-context";
import { AppShell } from "@/components/AppShell";
import { ArrowLeftRight, Upload, CheckCircle2 } from "lucide-react";

const KmlMap = lazy(() => import("@/components/KmlMap"));

export const Route = createFileRoute("/convert")({
  head: () => ({
    meta: [
      { title: "Convert KML / KMZ / MIF ↔ GeoJSON JSON" },
      {
        name: "description",
        content:
          "Convert between KML, KMZ, MapInfo MIF and GeoJSON JSON directly in your browser.",
      },
      { property: "og:title", content: "Geo File Converter — RouteScope" },
      {
        property: "og:description",
        content: "KML · KMZ · GeoJSON · MapInfo MIF · native MapInfo TAB — all in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Convert,
});

type OutFormat = "json" | "kml" | "kmz" | "tab";

function download(name: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function baseName(n: string) {
  return n.replace(/\.[^.]+$/, "") || "converted";
}

function Convert() {
  const { t } = useApp();
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<OutFormat>("json");
  const [preview, setPreview] = useState<FeatureCollection | null>(null);
  const [previewName, setPreviewName] = useState<string>("");

  async function handle(files: File[]) {
    setErr("");
    setMsg("");
    setPreview(null);
    setBusy(true);
    try {
      const first = files[0];
      const name = first.name.toLowerCase();
      let fc: FeatureCollection;

      const exts = new Set(files.map((f) => f.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ""));
      const isTabSet = [".tab", ".map", ".dat", ".id"].some((e) => exts.has(e));

      if (/\.(kml|kmz)$/i.test(name)) {
        fc = kmlToGeoJSON(await extractKmlText(first));
      } else if (/\.(json|geojson)$/i.test(name)) {
        const parsed = JSON.parse(await first.text());
        fc =
          parsed.type === "FeatureCollection"
            ? parsed
            : { type: "FeatureCollection", features: [parsed] };
      } else if (exts.has(".mif")) {
        const mif = files.find((f) => /\.mif$/i.test(f.name))!;
        fc = mifToGeoJSON(await mif.text());
      } else if (isTabSet) {
        const missing = [".tab", ".map", ".dat", ".id"].filter((e) => !exts.has(e));
        if (missing.length) {
          throw new Error(
            `MapInfo TAB set is incomplete — missing ${missing.join(", ").toUpperCase()}. Select all four files (.TAB, .MAP, .DAT, .ID) together.`,
          );
        }
        fc = await tabToGeoJSON(files);
      } else {
        throw new Error(
          "Unsupported file type. Use .kml, .kmz, .json/.geojson, .mif/.mid, or a MapInfo .tab/.map/.dat/.id set.",
        );
      }

      const base = baseName(first.name);
      if (target === "json") {
        download(`${base}.json`, JSON.stringify(fc, null, 2), "application/json");
      } else if (target === "kml") {
        download(`${base}.kml`, geoJSONToKml(fc), "application/vnd.google-earth.kml+xml");
      } else if (target === "kmz") {
        const zipped = zipSync({ "doc.kml": strToU8(geoJSONToKml(fc)) });
        download(`${base}.kmz`, zipped, "application/vnd.google-earth.kmz");
      } else {
        const tabFiles = await geoJSONToTab(fc, base);
        const zipped = zipSync(Object.fromEntries(tabFiles.map((f) => [f.name, f.bytes])));
        download(`${base}-mapinfo.zip`, zipped, "application/zip");
      }
      setPreview(fc);
      setPreviewName(first.name);
      setMsg(`Converted ${first.name} → ${target.toUpperCase()} (${fc.features.length} features)`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setBusy(false);
    }
  }

  const formats: { key: OutFormat; label: string; hint: string }[] = [
    { key: "json", label: "GeoJSON", hint: ".json" },
    { key: "kml", label: "KML", hint: ".kml" },
    { key: "kmz", label: "KMZ", hint: ".kmz" },
    { key: "tab", label: "MapInfo TAB", hint: ".tab + .map + .dat + .id" },
  ];

  return (
    <AppShell title={t("convTitle")} subtitle={t("convSub")}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="rounded-2xl border bg-card p-5 shadow-elevated bg-gradient-surface space-y-4">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" /> {t("convertTo")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {formats.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTarget(f.key)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  target === f.key
                    ? "border-primary bg-gradient-brand text-brand-foreground shadow-glow"
                    : "border-input bg-background hover:bg-accent"
                }`}
              >
                <p className="font-display text-sm font-semibold">{f.label}</p>
                <p className={`mt-0.5 text-[11px] ${target === f.key ? "text-brand-foreground/80" : "text-muted-foreground"}`}>
                  {f.hint}
                </p>
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-background/70 px-4 py-8 text-center transition-colors hover:border-primary hover:bg-accent/40">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-brand text-brand-foreground shadow-glow">
              <Upload className="h-5 w-5" />
            </div>
            <span className="font-display text-sm font-semibold">
              {busy ? t("converting") : t("chooseAny")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              KML · KMZ · GeoJSON · MIF · TAB set
            </span>
            <input
              type="file"
              accept=".kml,.kmz,.json,.geojson,.mif,.mid,.tab,.map,.dat,.id"
              multiple
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                if (fs.length) handle(fs);
                e.currentTarget.value = "";
              }}
            />
          </label>

          {msg && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{msg}</span>
            </div>
          )}
          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          )}

          <div className="rounded-xl border bg-background/50 p-3 text-[11px] text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">{t("supported")}</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>KML / KMZ ↔ GeoJSON</li>
              <li>MapInfo MIF/MID → GeoJSON (POINT, PLINE, REGION)</li>
              <li>Native MapInfo TAB (.tab + .map + .dat + .id) ↔ GeoJSON</li>
            </ul>
            <p className="mt-2">
              TAB uses a real GDAL engine (WebAssembly, ~40MB, downloaded on first use). Nothing
              leaves your device.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-elevated bg-gradient-surface space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Preview
              </p>
              <p className="font-display text-sm font-semibold">
                {previewName || "No file yet"}
              </p>
            </div>
            {preview && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                {preview.features.length} features
              </span>
            )}
          </div>
          <div className="h-[480px] overflow-hidden rounded-xl border bg-muted">
            {preview ? (
              <ClientOnly
                fallback={
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">
                    Loading map…
                  </div>
                }
              >
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center text-sm text-muted-foreground">
                      Loading map…
                    </div>
                  }
                >
                  <KmlMap data={preview} />
                </Suspense>
              </ClientOnly>
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
                Pick a target format and drop a file — the converted geometry previews here.
              </div>
            )}
          </div>
          {preview &&
            preview.features.some((f) => f.properties && Object.keys(f.properties).length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Attributes (first 20 features)
                </summary>
                <div className="mt-2 max-h-64 overflow-auto rounded border bg-muted/30 p-2 font-mono">
                  {preview.features.slice(0, 20).map((f, i) => (
                    <div key={i} className="border-b border-border/40 py-1 last:border-0">
                      <span className="text-muted-foreground">
                        #{i + 1} {f.geometry?.type}
                      </span>{" "}
                      {JSON.stringify(f.properties ?? {})}
                    </div>
                  ))}
                </div>
              </details>
            )}
        </section>
      </div>
    </AppShell>
  );
}
