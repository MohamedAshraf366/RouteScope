import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import {
  type LatLng,
  pathLength,
  pointInRectangle,
  pointInCircle,
  pointInPolygon,
  rectangleAreaM2,
  circleAreaM2,
  polygonAreaM2,
} from "@/lib/geo-area";
import type { Feature, Polygon } from "geojson";

type Tool = "none" | "rectangle" | "circle" | "polygon";

type Shape =
  | { kind: "rectangle"; corner1: LatLng; corner2: LatLng }
  | { kind: "circle"; center: LatLng; radius: number }
  | { kind: "polygon"; points: LatLng[] };

export type AreaSelection = {
  areaM2: number;
  pointCount: number;
  distanceM: number;
  feature: Feature<Polygon>;
};

const SHAPE_STYLE: L.PathOptions = {
  color: "#f97316",
  weight: 2,
  fillColor: "#f97316",
  fillOpacity: 0.15,
};
const DRAFT_STYLE: L.PathOptions = { ...SHAPE_STYLE, dashArray: "6 6" };

function toLL(e: L.LatLng): LatLng {
  return { lat: e.lat, lng: e.lng };
}

function computeSelection(shape: Shape, routePoints: LatLng[]): AreaSelection {
  const test = (p: LatLng): boolean => {
    if (shape.kind === "rectangle") return pointInRectangle(p, shape.corner1, shape.corner2);
    if (shape.kind === "circle") return pointInCircle(p, shape.center, shape.radius);
    return pointInPolygon(p, shape.points);
  };
  const areaM2 =
    shape.kind === "rectangle"
      ? rectangleAreaM2(shape.corner1, shape.corner2)
      : shape.kind === "circle"
        ? circleAreaM2(shape.radius)
        : polygonAreaM2(shape.points);

  const selected = routePoints.filter(test);
  return {
    areaM2,
    pointCount: selected.length,
    distanceM: pathLength(selected),
    feature: shapeToFeature(shape),
  };
}

function shapeToFeature(shape: Shape): Feature<Polygon> {
  let ring: [number, number][];
  let name: string;
  if (shape.kind === "rectangle") {
    const { corner1: a, corner2: b } = shape;
    const minLat = Math.min(a.lat, b.lat), maxLat = Math.max(a.lat, b.lat);
    const minLng = Math.min(a.lng, b.lng), maxLng = Math.max(a.lng, b.lng);
    ring = [
      [minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat],
    ];
    name = "Rectangle selection";
  } else if (shape.kind === "circle") {
    const { center, radius } = shape;
    const N = 64;
    const R = 6371008.8;
    const lat1 = (center.lat * Math.PI) / 180;
    const lng1 = (center.lng * Math.PI) / 180;
    const d = radius / R;
    ring = [];
    for (let i = 0; i <= N; i++) {
      const brg = ((i % N) * 2 * Math.PI) / N;
      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg),
      );
      const lng2 =
        lng1 +
        Math.atan2(
          Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
          Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
        );
      ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    name = "Circle selection";
  } else {
    ring = shape.points.map((p) => [p.lng, p.lat] as [number, number]);
    const first = ring[0], last = ring[ring.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      if (first) ring.push([first[0], first[1]]);
    }
    name = "Polygon selection";
  }
  return {
    type: "Feature",
    properties: { name },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/** Draws rectangle / circle / freeform-polygon selections on the map and
 *  reports the selected area's stats (size, point count, distance) up to
 *  the parent, which owns the actual speed / ETA calculation UI. */
export default function AreaTravelTool({
  routePoints,
  onSelectionChange,
}: {
  routePoints: LatLng[];
  onSelectionChange: (selection: AreaSelection | null) => void;
}) {
  const map = useMap();
  const [tool, setTool] = useState<Tool>("none");
  const [shape, setShape] = useState<Shape | null>(null);
  const [polyDraft, setPolyDraft] = useState<LatLng[]>([]);

  const finalLayerRef = useRef<L.Layer | null>(null);
  const draftLayerRef = useRef<L.Layer | null>(null);
  const dragStateRef = useRef<{ start: LatLng } | null>(null);

  const clearDraftLayer = useCallback(() => {
    if (draftLayerRef.current) {
      map.removeLayer(draftLayerRef.current);
      draftLayerRef.current = null;
    }
  }, [map]);

  const clearFinalLayer = useCallback(() => {
    if (finalLayerRef.current) {
      map.removeLayer(finalLayerRef.current);
      finalLayerRef.current = null;
    }
  }, [map]);

  const reset = useCallback(() => {
    setShape(null);
    setPolyDraft([]);
    dragStateRef.current = null;
    clearDraftLayer();
    clearFinalLayer();
    onSelectionChange(null);
  }, [clearDraftLayer, clearFinalLayer, onSelectionChange]);

  function selectTool(next: Tool) {
    reset();
    setTool(next);
  }

  // Draw the finalized shape, and report its stats to the parent
  useEffect(() => {
    clearFinalLayer();
    if (!shape) return;
    let layer: L.Layer;
    if (shape.kind === "rectangle") {
      layer = L.rectangle(
        [
          [shape.corner1.lat, shape.corner1.lng],
          [shape.corner2.lat, shape.corner2.lng],
        ],
        SHAPE_STYLE,
      );
    } else if (shape.kind === "circle") {
      layer = L.circle([shape.center.lat, shape.center.lng], {
        radius: shape.radius,
        ...SHAPE_STYLE,
      });
    } else {
      layer = L.polygon(
        shape.points.map((p) => [p.lat, p.lng] as [number, number]),
        SHAPE_STYLE,
      );
    }
    layer.addTo(map);
    finalLayerRef.current = layer;
    onSelectionChange(computeSelection(shape, routePoints));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, map]);

  // Re-run the calculation if the underlying route data changes while a shape is active
  useEffect(() => {
    if (shape) onSelectionChange(computeSelection(shape, routePoints));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints]);

  // Rectangle & circle: drag-to-draw via native Leaflet mouse events
  useEffect(() => {
    if (tool !== "rectangle" && tool !== "circle") return;

    function onDown(e: L.LeafletMouseEvent) {
      map.dragging.disable();
      dragStateRef.current = { start: toLL(e.latlng) };
      clearDraftLayer();
    }
    function onMove(e: L.LeafletMouseEvent) {
      const start = dragStateRef.current?.start;
      if (!start) return;
      clearDraftLayer();
      if (tool === "rectangle") {
        draftLayerRef.current = L.rectangle(
          [
            [start.lat, start.lng],
            [e.latlng.lat, e.latlng.lng],
          ],
          DRAFT_STYLE,
        ).addTo(map);
      } else {
        const radius = map.distance([start.lat, start.lng], e.latlng);
        draftLayerRef.current = L.circle([start.lat, start.lng], {
          radius,
          ...DRAFT_STYLE,
        }).addTo(map);
      }
    }
    function onUp(e: L.LeafletMouseEvent) {
      const start = dragStateRef.current?.start;
      map.dragging.enable();
      dragStateRef.current = null;
      clearDraftLayer();
      if (!start) return;
      if (tool === "rectangle") {
        const end = toLL(e.latlng);
        if (start.lat === end.lat && start.lng === end.lng) return; // ignore plain click
        setShape({ kind: "rectangle", corner1: start, corner2: end });
      } else {
        const radius = map.distance([start.lat, start.lng], e.latlng);
        if (radius < 1) return;
        setShape({ kind: "circle", center: start, radius });
      }
      setTool("none");
    }

    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    return () => {
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      map.dragging.enable();
    };
  }, [tool, map, clearDraftLayer]);

  // Polygon: click to place pins, double-click (or Finish button) to close
  useEffect(() => {
    if (tool !== "polygon") return;
    map.doubleClickZoom.disable();

    function onClick(e: L.LeafletMouseEvent) {
      setPolyDraft((prev) => [...prev, toLL(e.latlng)]);
    }
    function onDblClick(e: L.LeafletMouseEvent) {
      L.DomEvent.stop(e);
      setPolyDraft((prev) => {
        // The two clicks of the dblclick have already appended two points.
        // Close the polygon if we now have at least 3 vertices.
        if (prev.length >= 3) {
          setShape({ kind: "polygon", points: prev });
          setTool("none");
          return [];
        }
        return prev;
      });
    }

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
    };
  }, [tool, map]);

  const finishPolygon = useCallback(() => {
    if (polyDraft.length >= 3) {
      setShape({ kind: "polygon", points: polyDraft });
      setPolyDraft([]);
      setTool("none");
    }
  }, [polyDraft]);

  // Live preview of the polygon-in-progress (pins + connecting line)
  useEffect(() => {
    clearDraftLayer();
    if (polyDraft.length === 0) return;
    const group = L.layerGroup();
    polyDraft.forEach((p) =>
      L.circleMarker([p.lat, p.lng], { radius: 4, color: "#f97316", fillOpacity: 1 }).addTo(group),
    );
    if (polyDraft.length >= 2) {
      L.polyline(
        polyDraft.map((p) => [p.lat, p.lng] as [number, number]),
        DRAFT_STYLE,
      ).addTo(group);
    }
    group.addTo(map);
    draftLayerRef.current = group;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyDraft, map]);

  const btn = (t: Tool, label: string) => (
    <button
      type="button"
      onClick={() => (tool === t ? selectTool("none") : selectTool(t))}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
        tool === t
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background/95 hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: "none" }}>
      <div
        className="leaflet-control m-2 flex flex-col gap-1.5 rounded-lg border bg-background/95 p-2 shadow-md backdrop-blur"
        style={{ pointerEvents: "auto" }}
      >
        <p className="px-0.5 text-[11px] font-medium text-muted-foreground">Select area</p>
        <div className="flex gap-1.5">
          {btn("rectangle", "▭ Square")}
          {btn("circle", "◯ Circle")}
          {btn("polygon", "📍 Pin shape")}
        </div>
        {tool === "polygon" && (
          <>
            <p className="pt-1 text-[11px] text-muted-foreground">
              {polyDraft.length} pin{polyDraft.length === 1 ? "" : "s"} — click to add, then Finish
            </p>
            <button
              type="button"
              onClick={finishPolygon}
              disabled={polyDraft.length < 3}
              className="rounded-md border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm disabled:opacity-50"
            >
              ✓ Finish shape
            </button>
          </>
        )}
        {(shape || tool !== "none") && (
          <button
            type="button"
            onClick={() => {
              reset();
              setTool("none");
            }}
            className="rounded-md border border-input bg-background/95 px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  );
}
