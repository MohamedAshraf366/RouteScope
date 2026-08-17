import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Feature, FeatureCollection, LineString, MultiLineString, Polygon } from "geojson";
import { pathLength, polygonAreaM2, type LatLng } from "@/lib/geo-area";
import { ROUTE_STYLE } from "@/lib/geo-path";

export type DrawnShape = {
  feature: Feature<Polygon | LineString | MultiLineString>;
  kind: "polygon" | "line";
  areaM2: number;
  lengthM: number;
};

const DRAFT: L.PathOptions = { ...ROUTE_STYLE, fill: false };

/** Style used for in-progress drafts; updated from the page's "new shape" style picker. */
export const draftStyle: { color: string; weight: number } = {
  color: ROUTE_STYLE.color,
  weight: ROUTE_STYLE.weight,
};

type Tool = "none" | "pen" | "pin" | "rect" | "line" | "freeline";

function ring(points: LatLng[]): [number, number][] {
  const r = points.map((p) => [p.lng, p.lat] as [number, number]);
  const first = r[0];
  const last = r[r.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) r.push([first[0], first[1]]);
  return r;
}

export function polygonFeature(points: LatLng[], name: string): DrawnShape {
  return {
    feature: {
      type: "Feature",
      properties: { name },
      geometry: { type: "Polygon", coordinates: [ring(points)] },
    },
    kind: "polygon",
    areaM2: polygonAreaM2(points),
    lengthM: pathLength([...points, points[0]!]),
  };
}

export function lineFeature(points: LatLng[], name: string): DrawnShape {
  return {
    feature: {
      type: "Feature",
      properties: { name },
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    },
    kind: "line",
    areaM2: 0,
    lengthM: pathLength(points),
  };
}

function multiLineFeature(lines: LatLng[][], name: string): DrawnShape {
  return {
    feature: {
      type: "Feature",
      properties: { name },
      geometry: {
        type: "MultiLineString",
        coordinates: lines.map((line) => line.map((point) => [point.lng, point.lat])),
      },
    },
    kind: "line",
    areaM2: 0,
    lengthM: lines.reduce((total, line) => total + pathLength(line), 0),
  };
}

function featureToPoints(f: Feature<Polygon>): LatLng[] {
  const r = f.geometry.coordinates[0] ?? [];
  const pts = r.map(([lng, lat]) => ({ lat: lat as number, lng: lng as number }));
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (pts.length > 1 && a && b && a.lat === b.lat && a.lng === b.lng) pts.pop();
  return pts;
}

function FitBounds({ data, token }: { data: FeatureCollection; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (!data.features.length) return;
    const b = L.geoJSON(data).getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, map]);
  return null;
}

function Resizer({ token }: { token: unknown }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 180);
    return () => clearTimeout(t);
  }, [token, map]);
  return null;
}

/** Drag vertices of the selected polygon; right-click / alt-click removes one. */
function VertexEditor({
  feature,
  onChange,
}: {
  feature: Feature<Polygon>;
  onChange: (points: LatLng[]) => void;
}) {
  const map = useMap();
  const ptsRef = useRef<LatLng[]>(featureToPoints(feature));

  useEffect(() => {
    ptsRef.current = featureToPoints(feature);
    const group = L.layerGroup().addTo(map);
    const outline = L.polygon(
      ptsRef.current.map((p) => [p.lat, p.lng] as [number, number]),
      { color: "#f97316", weight: 2, fill: false },
    ).addTo(group);

    const redraw = () =>
      outline.setLatLngs(ptsRef.current.map((p) => [p.lat, p.lng] as [number, number]));

    ptsRef.current.forEach((p, i) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#f97316",
        fillColor: "#fff",
        fillOpacity: 1,
        weight: 2,
        bubblingMouseEvents: false,
      }).addTo(group);
      let dragging = false;
      m.on("mousedown", () => {
        dragging = true;
        map.dragging.disable();
      });
      const move = (e: L.LeafletMouseEvent) => {
        if (!dragging) return;
        ptsRef.current[i] = { lat: e.latlng.lat, lng: e.latlng.lng };
        m.setLatLng(e.latlng);
        redraw();
      };
      const up = () => {
        if (!dragging) return;
        dragging = false;
        map.dragging.enable();
        onChange([...ptsRef.current]);
      };
      map.on("mousemove", move);
      map.on("mouseup", up);
      m.on("contextmenu", () => {
        if (ptsRef.current.length <= 3) return;
        const next = ptsRef.current.filter((_, k) => k !== i);
        onChange(next);
      });
      m.on("remove", () => {
        map.off("mousemove", move);
        map.off("mouseup", up);
      });
    });

    return () => {
      map.removeLayer(group);
      map.dragging.enable();
    };
  }, [feature, map, onChange]);

  return null;
}

function DrawTools({
  onCreate,
  editing,
}: {
  onCreate: (shape: DrawnShape) => void;
  editing: boolean;
}) {
  const map = useMap();
  const [tool, setTool] = useState<Tool>("none");
  const [pins, setPins] = useState<LatLng[]>([]);
  const [penCount, setPenCount] = useState(0);
  const draftRef = useRef<L.Layer | null>(null);
  const penRef = useRef<LatLng[] | null>(null);
  const completedTracesRef = useRef<LatLng[][]>([]);
  const redoRef = useRef<LatLng[]>([]);
  const pinRedoRef = useRef<LatLng[]>([]);
  const rectRef = useRef<LatLng | null>(null);
  const [savedMessage, setSavedMessage] = useState("");

  const clearDraft = useCallback(() => {
    if (draftRef.current) {
      map.removeLayer(draftRef.current);
      draftRef.current = null;
    }
  }, [map]);

  const selectTool = useCallback(
    (next: Tool) => {
      setPins([]);
      setPenCount(0);
      penRef.current = null;
      completedTracesRef.current = [];
      redoRef.current = [];
      pinRedoRef.current = [];
      rectRef.current = null;
      clearDraft();
      setTool(next);
    },
    [clearDraft],
  );

  const drawPen = useCallback(() => {
    const pts = penRef.current ?? [];
    const traces = [...completedTracesRef.current];
    if (pts.length >= 2) traces.push(pts);
    clearDraft();
    if (!traces.length) return;
    const group = L.layerGroup();
    for (const trace of traces) {
      L.polyline(
        trace.map((point) => [point.lat, point.lng] as [number, number]),
        { ...DRAFT, ...draftStyle },
      ).addTo(group);
    }
    group.addTo(map);
    draftRef.current = group;
  }, [clearDraft, map]);

  // Freehand pen: hold the mouse down and trace a shape
  useEffect(() => {
    if (tool !== "pen" && tool !== "freeline") return;
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    map.dragging.disable();
    let drawing = false;
    let pendingStart: L.LatLng | null = null;
    let pendingPointerId: number | null = null;
    let frame = 0;

    function eventPoint(e: PointerEvent) {
      const bounds = container.getBoundingClientRect();
      return map.containerPointToLatLng([e.clientX - bounds.left, e.clientY - bounds.top]);
    }
    function down(e: PointerEvent) {
      if (e.button !== 0) return;
      const overControl = Array.from(container.querySelectorAll(".leaflet-control")).some(
        (control) => {
          const bounds = control.getBoundingClientRect();
          return (
            e.clientX >= bounds.left &&
            e.clientX <= bounds.right &&
            e.clientY >= bounds.top &&
            e.clientY <= bounds.bottom
          );
        },
      );
      if (overControl) return;
      pendingStart = eventPoint(e);
      pendingPointerId = e.pointerId;
    }
    function move(e: PointerEvent) {
      if (!drawing && pendingStart && pendingPointerId === e.pointerId) {
        const current = eventPoint(e);
        const startPixel = map.latLngToContainerPoint(pendingStart);
        const currentPixel = map.latLngToContainerPoint(current);
        if (startPixel.distanceTo(currentPixel) < 2) return;
        drawing = true;
        penRef.current = [{ lat: pendingStart.lat, lng: pendingStart.lng }];
        redoRef.current = [];
        setPenCount(1);
        if (tool !== "freeline") clearDraft();
      }
      const pts = penRef.current;
      if (!drawing || !pts) return;
      const latlng = eventPoint(e);
      const last = pts[pts.length - 1]!;
      // Distance threshold in pixels keeps point counts low → far smoother tracing
      const a = map.latLngToContainerPoint([last.lat, last.lng]);
      const b = map.latLngToContainerPoint(latlng);
      if (a.distanceTo(b) < 6) return;
      pts.push({ lat: latlng.lat, lng: latlng.lng });
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPenCount(penRef.current?.length ?? 0);
        drawPen();
      });
    }
    function up() {
      pendingStart = null;
      pendingPointerId = null;
      if (!drawing) return;
      drawing = false;
      const completed = penRef.current ?? [];
      if (completed.length >= 2) {
        if (tool === "freeline") completedTracesRef.current.push([...completed]);
        else completedTracesRef.current = [[...completed]];
      }
      penRef.current = null;
      setPenCount(completedTracesRef.current.reduce((total, trace) => total + trace.length, 0));
      drawPen();
    }

    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", up);
    container.addEventListener("pointercancel", up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", up);
      container.removeEventListener("pointercancel", up);
      map.dragging.enable();
      container.style.cursor = "";
    };
  }, [tool, map, clearDraft, drawPen]);

  // Rectangle: drag from corner to corner
  useEffect(() => {
    if (tool !== "rect") return;
    map.dragging.disable();
    function down(e: L.LeafletMouseEvent) {
      rectRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };
    }
    function move(e: L.LeafletMouseEvent) {
      const s = rectRef.current;
      if (!s) return;
      clearDraft();
      draftRef.current = L.rectangle(
        [
          [s.lat, s.lng],
          [e.latlng.lat, e.latlng.lng],
        ],
        { ...DRAFT, ...draftStyle },
      ).addTo(map);
    }
    function up(e: L.LeafletMouseEvent) {
      const s = rectRef.current;
      rectRef.current = null;
      clearDraft();
      if (!s) return;
      const b = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (s.lat === b.lat && s.lng === b.lng) return;
      onCreate(
        polygonFeature(
          [s, { lat: s.lat, lng: b.lng }, b, { lat: b.lat, lng: s.lng }],
          "Rectangle polygon",
        ),
      );
      // Keep the tool active so several shapes can be drawn in a row
      selectTool("rect");
    }
    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
      map.dragging.enable();
    };
  }, [tool, map, clearDraft, onCreate, selectTool]);

  // Pin mode: click each corner, then press Finish
  useEffect(() => {
    if (tool !== "pin" && tool !== "line") return;
    map.doubleClickZoom.disable();
    function click(e: L.LeafletMouseEvent) {
      pinRedoRef.current = [];
      setPins((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    }
    map.on("click", click);
    return () => {
      map.off("click", click);
      map.doubleClickZoom.enable();
    };
  }, [tool, map]);

  // Live preview of the pin polygon in progress
  useEffect(() => {
    if (tool !== "pin" && tool !== "line") return;
    clearDraft();
    if (!pins.length) return;
    const group = L.layerGroup();
    pins.forEach((p) =>
      L.circleMarker([p.lat, p.lng], { radius: 4, color: "#f97316", fillOpacity: 1 }).addTo(group),
    );
    if (pins.length >= 2) {
      L.polyline(
        pins.map((p) => [p.lat, p.lng] as [number, number]),
        { ...DRAFT, ...draftStyle },
      ).addTo(group);
    }
    group.addTo(map);
    draftRef.current = group;
  }, [pins, tool, map, clearDraft]);

  const undo = () => {
    if (tool === "pin" || tool === "line") {
      setPins((prev) => {
        if (!prev.length) return prev;
        pinRedoRef.current.push(prev[prev.length - 1]!);
        return prev.slice(0, -1);
      });
      return;
    }
    const pts = penRef.current;
    if (!pts?.length) return;
    redoRef.current.push(pts.pop()!);
    setPenCount(pts.length);
    drawPen();
  };

  const redo = () => {
    if (tool === "pin" || tool === "line") {
      const p = pinRedoRef.current.pop();
      if (p) setPins((prev) => [...prev, p]);
      return;
    }
    const p = redoRef.current.pop();
    if (!p) return;
    penRef.current = [...(penRef.current ?? []), p];
    setPenCount(penRef.current.length);
    drawPen();
  };

  const finishPen = () => {
    const current = penRef.current ?? [];
    const traces = [...completedTracesRef.current];
    if (current.length >= 2) traces.push(current);
    if (tool === "freeline") {
      if (traces.length === 1) onCreate(lineFeature(traces[0] ?? [], "Freehand line"));
      else if (traces.length > 1) onCreate(multiLineFeature(traces, "Freehand lines"));
    } else {
      const polygon = traces[0] ?? current;
      if (polygon.length >= 3) onCreate(polygonFeature(polygon, "Freehand polygon"));
    }
    if (traces.length) {
      setSavedMessage(
        tool === "freeline"
          ? `Saved and rendered ${traces.length} freehand line${traces.length === 1 ? "" : "s"}.`
          : "Shape saved and rendered on the map.",
      );
      window.setTimeout(() => setSavedMessage(""), 3500);
    }
    // Stay in the same tool: each finished shape is kept, ready for the next one
    selectTool(tool);
  };

  const btn = (t: Tool, label: string) => (
    <button
      type="button"
      onClick={() => selectTool(tool === t ? "none" : t)}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
        tool === t
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background/95 hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );

  const smallBtn =
    "flex-1 rounded-md border border-input bg-background/95 px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-40";

  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: "none" }}>
      <div
        className="leaflet-control m-2 flex w-48 flex-col gap-1.5 rounded-lg border bg-background/95 p-2 shadow-md backdrop-blur"
        style={{ pointerEvents: "auto" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="px-0.5 text-[11px] font-medium text-muted-foreground">
          {editing
            ? "Editing a shape — drag points, right-click a point to delete"
            : "Draw a polygon or line"}
        </p>
        {savedMessage && (
          <p role="status" className="rounded-md bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary">
            ✓ {savedMessage}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {btn("pen", "✎ Pen")}
          {btn("pin", "📍 Pins")}
          {btn("rect", "▭ Box")}
          {btn("line", "／ Line")}
          {btn("freeline", "〰 Free line")}
        </div>
        {tool !== "none" && tool !== "rect" && (
          <div className="flex gap-1.5">
            <button type="button" className={smallBtn} onClick={undo}>
              ↶ Undo
            </button>
            <button type="button" className={smallBtn} onClick={redo}>
              ↷ Redo
            </button>
          </div>
        )}
        {(tool === "pen" || tool === "freeline") && (
          <>
            <p className="text-[11px] text-muted-foreground">
              {penCount
                ? `${penCount} points in ${completedTracesRef.current.length || 1} trace${completedTracesRef.current.length === 1 ? "" : "s"} — draw again to add more.`
                : "Hold the mouse down and trace."}
            </p>
            <button
              type="button"
              onPointerDownCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
                finishPen();
              }}
              disabled={penCount < (tool === "freeline" ? 2 : 3)}
              className="rounded-md border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              ✓ Finish shape
            </button>
          </>
        )}
        {(tool === "pin" || tool === "line") && (
          <>
            <p className="text-[11px] text-muted-foreground">
              {pins.length} point{pins.length === 1 ? "" : "s"} — click the map to add{" "}
              {tool === "line" ? "line points" : "corners"}.
            </p>
            <button
              type="button"
              onClick={() => {
                if (tool === "line") {
                  if (pins.length >= 2) onCreate(lineFeature(pins, "Drawn line"));
                } else if (pins.length >= 3) {
                  onCreate(polygonFeature(pins, "Pin polygon"));
                }
                selectTool(tool);
              }}

              disabled={pins.length < (tool === "line" ? 2 : 3)}
              className="rounded-md border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              ✓ Finish shape
            </button>
          </>
        )}
        {tool !== "none" && (
          <button
            type="button"
            onClick={() => selectTool("none")}
            className="rounded-md border border-input bg-background/95 px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            ✕ Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default function DrawBoard({
  data,
  fitToken,
  resizeToken,
  editFeature,
  onCreate,
  onEditPoints,
}: {
  data: FeatureCollection;
  fitToken: number;
  resizeToken?: unknown;
  editFeature?: Feature<Polygon> | null;
  onCreate: (shape: DrawnShape) => void;
  onEditPoints?: (points: LatLng[]) => void;
}) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  return (
    <MapContainer
      center={[26.8, 30.8]}
      zoom={5}
      preferCanvas
      renderer={renderer}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {data.features.length > 0 && (
        <GeoJSON
          key={`${fitToken}-${data.features.length}-${data.features.reduce((total, feature) => total + JSON.stringify(feature.geometry).length, 0)}-${data.features.map((feature) => `${feature.properties?.["stroke"] ?? ""}:${feature.properties?.["stroke-width"] ?? ""}`).join("|")}`}
          data={data}
          // Lines only — routes render exactly like the route viewer, no filled areas
          style={(feature) =>
            ({
              ...ROUTE_STYLE,
              color: (feature?.properties?.["stroke"] as string) ?? ROUTE_STYLE.color,
              weight: (feature?.properties?.["stroke-width"] as number) ?? ROUTE_STYLE.weight,
              fill: false,
            }) as L.PathOptions
          }
          // Any stray point renders as a tiny canvas dot, never a marker image
          pointToLayer={(_f, latlng) =>
            L.circleMarker(latlng, { radius: 2, color: ROUTE_STYLE.color, weight: 1, renderer })
          }
        />
      )}
      <FitBounds data={data} token={fitToken} />
      <Resizer token={resizeToken} />
      {editFeature && onEditPoints && (
        <VertexEditor feature={editFeature} onChange={onEditPoints} />
      )}
      <DrawTools onCreate={onCreate} editing={!!editFeature} />
    </MapContainer>
  );
}
