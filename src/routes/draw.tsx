import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import {
  Upload,
  Trash2,
  Download,
  PenLine,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
  Pencil,
  Eye,
  EyeOff,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageGuide } from "@/components/PageGuide";
import { kmlToGeoJSON } from "@/lib/kml-to-geojson";
import { extractKmlText } from "@/lib/extract-kml";
import { mifToGeoJSON } from "@/lib/mif-geojson";
import { tabToGeoJSON } from "@/lib/mapinfo-tab";
import { formatArea, formatDistance, polygonAreaM2, type LatLng } from "@/lib/geo-area";
import {
  EXPORT_FORMATS,
  downloadAllAsZip,
  downloadFeatureCollection,
  downloadMerged,
  type ExportFormat,
} from "@/lib/geo-export";
import type { DrawnShape } from "@/components/DrawBoard";
import { draftStyle } from "@/components/DrawBoard";
import {
  processFeatureCollection,
  ROUTE_STYLE,
  type DecimationFidelity,
  type RouteStyle,
} from "@/lib/geo-path";

const PRESET_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#9333ea", "#0f172a"];

const DrawBoard = lazy(() => import("@/components/DrawBoard"));

export const Route = createFileRoute("/draw")({
  head: () => ({
    meta: [
      { title: "Draw & Upload Polygons — RouteScope" },
      {
        name: "description",
        content:
          "Batch-upload routes and polygons, trace new shapes freehand with undo/redo, edit vertices, then download each shape separately or all together as GeoJSON, KML, KMZ or MapInfo TAB.",
      },
      { property: "og:title", content: "Draw & Upload Polygons — RouteScope" },
      {
        property: "og:description",
        content: "Trace polygons on the map and export them in any supported geo format.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DrawPage,
});

type Item = {
  id: string;
  name: string;
  source: "uploaded" | "drawn";
  fc: FeatureCollection;
  info: string;
  style: RouteStyle;
};

const TAB_PARTS = [".tab", ".map", ".dat", ".id"];

function ext(name: string) {
  return name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
}

function countGeometries(fc: FeatureCollection) {
  return fc.features.filter((f) => f?.geometry).length;
}

/** Parse one logical upload (a single file, or a full MapInfo TAB set). */
async function parseGroup(files: File[]): Promise<FeatureCollection> {
  const first = files[0]!;
  const e = ext(first.name);
  let fc: FeatureCollection;

  if (e === ".kml" || e === ".kmz") {
    const text = await extractKmlText(first);
    if (!text.trim()) throw new Error("the file is empty");
    fc = kmlToGeoJSON(text);
  } else if (e === ".json" || e === ".geojson") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await first.text());
    } catch {
      throw new Error("it is not valid JSON");
    }
    const p = parsed as FeatureCollection | Feature;
    if (!p || typeof p !== "object" || !("type" in p)) throw new Error("it is not valid GeoJSON");
    fc =
      p.type === "FeatureCollection" ? p : { type: "FeatureCollection", features: [p as Feature] };
  } else if (e === ".mif") {
    fc = mifToGeoJSON(await first.text());
  } else if (TAB_PARTS.includes(e)) {
    const have = new Set(files.map((f) => ext(f.name)));
    const missing = TAB_PARTS.filter((p) => !have.has(p));
    if (missing.length) {
      throw new Error(
        `the MapInfo TAB set is incomplete — missing ${missing.join(", ").toUpperCase()}. Select all four files together.`,
      );
    }
    fc = await tabToGeoJSON(files);
  } else {
    throw new Error(
      "the format is not supported (use .kml, .kmz, .json/.geojson, .mif or a full .tab set)",
    );
  }

  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("no readable features were found");
  }
  if (countGeometries(fc) === 0) throw new Error("it contains no geometry");
  return fc;
}

/** Split a multi-file selection into logical uploads: TAB parts group by base name. */
function groupFiles(files: File[]): { key: string; files: File[] }[] {
  const groups = new Map<string, File[]>();
  for (const f of files) {
    const e = ext(f.name);
    if (e === ".mid") continue; // companion of .mif
    const key = TAB_PARTS.includes(e)
      ? `tab:${f.name.replace(/\.[^.]+$/, "").toLowerCase()}`
      : f.name;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, files: list }));
}

function DrawPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<ExportFormat>("kml");
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [unselected, setUnselected] = useState<Record<string, true>>({});
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const [newStyle, setNewStyle] = useState<RouteStyle>({
    color: ROUTE_STYLE.color,
    weight: ROUTE_STYLE.weight,
  });
  const [fidelity, setFidelity] = useState<DecimationFidelity>("medium");

  const past = useRef<Item[][]>([]);
  const future = useRef<Item[][]>([]);
  const [histTick, setHistTick] = useState(0);

  const commit = useCallback((next: Item[] | ((prev: Item[]) => Item[])) => {
    setItems((prev) => {
      past.current.push(prev);
      if (past.current.length > 50) past.current.shift();
      future.current = [];
      return typeof next === "function" ? (next as (p: Item[]) => Item[])(prev) : next;
    });
    setHistTick((t) => t + 1);
  }, []);

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    setItems((cur) => {
      future.current.push(cur);
      return prev;
    });
    setHistTick((t) => t + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    setItems((cur) => {
      past.current.push(cur);
      return next;
    });
    setHistTick((t) => t + 1);
  };

  const busy = progress !== null;
  const processedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        fc: processFeatureCollection(item.fc, 0, fidelity, item.style),
      })),
    [items, fidelity],
  );
  const selected = useMemo(
    () => processedItems.filter((i) => !unselected[i.id] && !hidden[i.id]),
    [processedItems, unselected, hidden],
  );
  const toggle = (id: string) =>
    setUnselected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  const setStyle = (id: string, patch: Partial<RouteStyle>) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, style: { ...i.style, ...patch } } : i)),
    );
  const setAll = (on: boolean) =>
    setUnselected(on ? {} : Object.fromEntries(items.map((i) => [i.id, true as const])));

  // Render uploaded data like the Route viewer: point sequences become a single
  // line per item (no marker icons), which is also far lighter for the renderer.
  const allData = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const item of processedItems) {
      if (hidden[item.id]) continue;
      features.push(...item.fc.features);
    }
    return { type: "FeatureCollection", features };
  }, [processedItems, hidden]);

  const editItem = editId ? items.find((i) => i.id === editId) : undefined;
  const editFeature =
    editItem && editItem.fc.features[0]?.geometry?.type === "Polygon"
      ? (editItem.fc.features[0] as Feature<Polygon>)
      : null;

  async function onUpload(files: File[]) {
    setErrors([]);
    const groups = groupFiles(files);
    const added: Item[] = [];
    const failed: string[] = [];
    setProgress({ label: "Reading files", done: 0, total: groups.length });
    for (const [i, g] of groups.entries()) {
      setProgress({ label: `Processing ${g.files[0]!.name}`, done: i, total: groups.length });
      // Yield so the progress window can paint between files
      await new Promise((r) => setTimeout(r));
      try {
        const fc = await parseGroup(g.files);
        added.push({
          id: crypto.randomUUID(),
          name: g.files[0]!.name.replace(/\.[^.]+$/, ""),
          source: "uploaded",
          fc,
          style: { ...newStyle },
          info: `${fc.features.length} feature${fc.features.length === 1 ? "" : "s"}`,
        });
      } catch (e) {
        failed.push(
          `${g.files[0]!.name}: could not be parsed — ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }
    }
    setProgress(null);
    if (added.length) {
      commit((prev) => [...prev, ...added]);
      setFitToken((t) => t + 1);
    }
    setErrors(failed);
  }

  function onCreate(shape: DrawnShape) {
    commit((prev) => {
      const n = prev.filter((i) => i.source === "drawn").length + 1;
      const label = shape.kind === "line" ? `Line ${n}` : `Shape ${n}`;
      const feature: Feature = {
        ...shape.feature,
        properties: { ...(shape.feature.properties ?? {}), name: label },
      };
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: shape.kind === "line" ? `line-${n}` : `shape-${n}`,
          source: "drawn",
          fc: { type: "FeatureCollection", features: [feature] },
          style: { ...newStyle },
          info:
            shape.kind === "line"
              ? `Line · ${formatDistance(shape.lengthM)}`
              : formatArea(shape.areaM2),
        },
      ];
    });
  }

  const onEditPoints = useCallback(
    (points: LatLng[]) => {
      if (!editId) return;
      const ring: [number, number][] = points.map((p) => [p.lng, p.lat]);
      const first = ring[0];
      if (first) ring.push([first[0], first[1]]);
      commit((prev) =>
        prev.map((i) =>
          i.id === editId
            ? {
                ...i,
                info: formatArea(polygonAreaM2(points)),
                fc: {
                  type: "FeatureCollection",
                  features: [
                    {
                      ...(i.fc.features[0] as Feature),
                      geometry: { type: "Polygon", coordinates: [ring] },
                    },
                  ],
                },
              }
            : i,
        ),
      );
    },
    [editId, commit],
  );

  async function run(label: string, fn: () => Promise<void>) {
    setErrors([]);
    setProgress({ label, done: 0, total: 0 });
    await new Promise((r) => setTimeout(r));
    try {
      await fn();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Export failed"]);
    } finally {
      setProgress(null);
    }
  }

  const mapPanel = (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 bg-background"
          : "relative h-[70vh] overflow-hidden rounded-2xl border bg-muted shadow-elevated"
      }
    >
      <button
        type="button"
        onClick={() => setFullscreen((v) => !v)}
        className="absolute left-16 top-3 z-[1000] inline-flex items-center gap-1.5 rounded-md border border-input bg-background/95 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
        style={{ position: "absolute" }}
      >
        {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        {fullscreen ? "Exit full screen" : "Full screen"}
      </button>
      <ClientOnly fallback={<MapFallback />}>
        <Suspense fallback={<MapFallback />}>
          <DrawBoard
            data={allData}
            fitToken={fitToken}
            resizeToken={fullscreen}
            editFeature={editFeature}
            onCreate={onCreate}
            onEditPoints={onEditPoints}
          />
        </Suspense>
      </ClientOnly>
    </div>
  );

  return (
    <AppShell
      title="Draw & upload"
      subtitle="Trace polygons on the map, or bring your own routes, then export"
      actions={
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-gradient-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-glow transition-transform hover:-translate-y-px">
          <Upload className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Upload routes / polygons</span>
          <span className="sm:hidden">Upload</span>
          <input
            type="file"
            multiple
            accept=".kml,.kmz,.json,.geojson,.mif,.mid,.tab,.map,.dat,.id"
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length) onUpload(fs);
              e.currentTarget.value = "";
            }}
          />
        </label>
      }
    >
      <PageGuide
        what="Build a set of shapes: batch-upload as many route or polygon files as you like, and/or draw brand-new polygons directly on the map with the pen, pins, or box tool. Every shape becomes an item you can download on its own, or together with the rest in any supported format."
        steps={[
          {
            title: "Add your data (optional)",
            body: "Drop or select several KML, KMZ, GeoJSON, MIF or MapInfo TAB sets at once. Each file becomes its own item; anything that can't be parsed is reported with the reason.",
          },
          {
            title: "Draw on the map",
            body: "Over your uploaded route you can add more geometry: Pen traces a freehand polygon, Pins adds corner by corner, Box drags a rectangle, Line clicks a path point by point and Free line traces a path freehand. Use Full screen for more room.",
          },
          {
            title: "Edit a shape",
            body: "Press the pencil on a drawn polygon to drag its vertices; right-click a vertex to delete it. Undo/Redo at the top of the list reverses any change.",
          },
          {
            title: "Download",
            body: "Choose an output format, then download one shape at a time, all shapes as a zip, or everything merged into a single file.",
          },
        ]}
        notes={[
          "Freehand pen works with a mouse or a stylus; on touch screens use Pins.",
          "Everything runs in your browser — no file is ever uploaded to a server.",
        ]}
      />

      {errors.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const fs = Array.from(e.dataTransfer.files ?? []);
          if (fs.length) onUpload(fs);
        }}
        className={`mb-6 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-6 py-7 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-input bg-background/60 hover:bg-accent/40"
        }`}
      >
        <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">
          Drop one or many route / polygon files here, or click to browse
        </p>
        <p className="text-[11px] text-muted-foreground">
          KML · KMZ · GeoJSON · MIF · full MapInfo TAB set (.tab + .map + .dat + .id)
        </p>
        <input
          type="file"
          multiple
          accept=".kml,.kmz,.json,.geojson,.mif,.mid,.tab,.map,.dat,.id"
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) onUpload(fs);
            e.currentTarget.value = "";
          }}
        />
      </label>

      <div className="relative space-y-6">{mapPanel}</div>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-md border bg-background/60 px-4 py-3">
        <span className="text-xs font-medium">New shape style</span>
        <div className="flex items-center gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use colour ${c}`}
              onClick={() => {
                setNewStyle((s) => ({ ...s, color: c }));
                draftStyle.color = c;
              }}
              style={{ background: c }}
              className={`h-5 w-5 rounded-full border-2 ${
                newStyle.color === c ? "border-foreground" : "border-transparent"
              }`}
            />
          ))}
          <input
            type="color"
            value={newStyle.color}
            aria-label="Custom colour for new shapes"
            onChange={(e) => {
              setNewStyle((s) => ({ ...s, color: e.target.value }));
              draftStyle.color = e.target.value;
            }}
            className="h-6 w-8 cursor-pointer rounded border border-input bg-background p-0.5"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          Width
          <input
            type="range"
            min={1}
            max={14}
            step={1}
            value={newStyle.weight}
            onChange={(e) => {
              const weight = Number(e.target.value);
              setNewStyle((s) => ({ ...s, weight }));
              draftStyle.weight = weight;
            }}
            className="w-28 accent-primary"
          />
          <span className="w-6 tabular-nums text-muted-foreground">{newStyle.weight}</span>
        </label>
        <div className="h-5 w-px bg-border" aria-hidden />
        <label htmlFor="fidelity" className="text-xs font-medium">
          Decimation fidelity
        </label>
        <select
          id="fidelity"
          value={fidelity}
          onChange={(event) => setFidelity(event.target.value as DecimationFidelity)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        >
          <option value="low">Low — fastest</option>
          <option value="medium">Medium — balanced</option>
          <option value="high">High — most detail</option>
        </select>
        <p className="text-[11px] text-muted-foreground">
          Applies to shapes you add next; change colour and width of existing items in the list
          below.
        </p>
      </div>

      <section className="mt-6 rounded-2xl border bg-card p-5 shadow-elevated bg-gradient-surface space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-2">
              <PenLine className="h-3.5 w-3.5" /> Shapes ({selected.length}/{items.length} visible and selected)
            </span>
            {items.length > 0 && (
              <span className="flex items-center gap-1.5 normal-case tracking-normal">
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setAll(true)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setAll(false)}
                >
                  None
                </button>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5" data-hist={histTick}>
            <button
              type="button"
              onClick={undo}
              disabled={!past.current.length}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!future.current.length}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
            >
              <Redo2 className="h-3.5 w-3.5" /> Redo
            </button>
          </div>
        </div>

        <div className="sm:max-w-sm">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Download format
          </label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} — {f.hint}
              </option>
            ))}
          </select>
        </div>

        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input bg-background/60 p-4 text-center text-xs text-muted-foreground">
            Nothing yet. Upload files or draw a polygon on the map.
          </p>
        ) : (
          <ul className="grid max-h-72 gap-2 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex items-center gap-2 rounded-xl border bg-background/60 px-3 py-2 ${
                  item.id === editId ? "border-primary" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={!unselected[item.id]}
                  onChange={() => toggle(item.id)}
                  title="Include in downloads"
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {item.source === "drawn" ? "Drawn" : "Uploaded"} · {item.info}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={item.style.color}
                      aria-label={`Colour for ${item.name}`}
                      title="Line colour"
                      onChange={(e) => setStyle(item.id, { color: e.target.value })}
                      className="h-5 w-7 cursor-pointer rounded border border-input bg-background p-0.5"
                    />
                    <input
                      type="range"
                      min={1}
                      max={14}
                      step={1}
                      value={item.style.weight}
                      aria-label={`Line width for ${item.name}`}
                      title="Line width"
                      onChange={(e) => setStyle(item.id, { weight: Number(e.target.value) })}
                      className="h-1 w-20 accent-primary"
                    />
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {item.style.weight}px
                    </span>
                  </div>
                </div>
                {item.source === "drawn" && (
                  <button
                    type="button"
                    title="Edit vertices"
                    onClick={() => setEditId((cur) => (cur === item.id ? null : item.id))}
                    className={`grid h-8 w-8 place-items-center rounded-md border ${
                      item.id === editId
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input hover:bg-accent"
                    }`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  title={hidden[item.id] ? "Show on map" : "Hide on map"}
                  aria-label={
                    hidden[item.id] ? `Show ${item.name} on map` : `Hide ${item.name} on map`
                  }
                  onClick={() =>
                    setHidden((previous) => {
                      const next = { ...previous };
                      if (next[item.id]) delete next[item.id];
                      else next[item.id] = true;
                      return next;
                    })
                  }
                  className="grid h-8 w-8 place-items-center rounded-md border border-input hover:bg-accent"
                >
                  {hidden[item.id] ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  title={
                    hidden[item.id]
                      ? "Show this item on the map before downloading"
                      : "Download this shape"
                  }
                  disabled={busy || Boolean(hidden[item.id])}
                  onClick={() =>
                    run("Preparing download", () =>
                      downloadFeatureCollection(
                        processedItems.find((processed) => processed.id === item.id)?.fc ?? item.fc,
                        item.name,
                        format,
                      ),
                    )
                  }
                  className="grid h-8 w-8 place-items-center rounded-md border border-input hover:bg-accent disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Remove"
                  onClick={() => {
                    if (editId === item.id) setEditId(null);
                    setHidden((previous) => {
                      const next = { ...previous };
                      delete next[item.id];
                      return next;
                    });
                    commit((prev) => prev.filter((i) => i.id !== item.id));
                  }}
                  className="grid h-8 w-8 place-items-center rounded-md border border-input text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!selected.length || busy}
            onClick={() => run("Building zip", () => downloadAllAsZip(selected, format))}
            className="rounded-md bg-gradient-brand px-3 py-2 text-xs font-medium text-brand-foreground shadow-glow hover:brightness-110 disabled:opacity-50"
          >
            Download selected — separate files (.zip)
          </button>
          <button
            type="button"
            disabled={!selected.length || busy}
            onClick={() => run("Merging shapes", () => downloadMerged(selected, format))}
            className="rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Download selected — merged into one file
          </button>

          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                setHidden({});
                commit([]);
              }}
              className="rounded-md px-3 py-1.5 text-[11px] text-muted-foreground hover:text-destructive"
            >
              Clear everything
            </button>
          )}
        </div>
      </section>

      {progress && (
        <div className="fixed inset-0 z-[2000] grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="w-72 rounded-2xl border bg-card p-5 text-center shadow-elevated">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
            <p className="truncate text-sm font-medium">{progress.label}…</p>
            {progress.total > 0 && (
              <>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {progress.done} of {progress.total} files
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function MapFallback() {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading map…</div>
  );
}
