import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, Polyline, useMap } from "react-leaflet";
import type { FeatureCollection, Position } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import AreaTravelTool, { type AreaSelection } from "@/components/AreaTravelTool";
import type { LatLng } from "@/lib/geo-area";
import { ROUTE_STYLE } from "@/lib/geo-path";

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
  }, [bounds, map]);
  return null;
}

export default function KmlMap({
  data,
  onAreaSelectionChange,
}: {
  data: FeatureCollection;
  onAreaSelectionChange?: (selection: AreaSelection | null) => void;
}) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const ref = useRef<L.Map | null>(null);

  // Extract sequential points to draw a lightweight route polyline
  const routeLatLngs = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    for (const f of data.features) {
      const g = f.geometry;
      if (g?.type === "Point") {
        const [lng, lat] = g.coordinates as Position;
        pts.push([lat, lng]);
      }
    }
    return pts;
  }, [data]);

  // Non-point features (lines/polygons) rendered normally via GeoJSON on canvas
  const nonPointData = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: data.features.filter((f) => f.geometry && f.geometry.type !== "Point"),
    }),
    [data],
  );

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const b = L.latLngBounds([]);
    routeLatLngs.forEach((ll) => b.extend(ll));
    if (nonPointData.features.length) {
      const gb = L.geoJSON(nonPointData).getBounds();
      if (gb.isValid()) b.extend(gb);
    }
    return b.isValid() ? b : null;
  }, [routeLatLngs, nonPointData]);

  const geoKey = useMemo(() => JSON.stringify(nonPointData).length.toString(), [nonPointData]);

  const routePointObjs = useMemo<LatLng[]>(
    () => routeLatLngs.map(([lat, lng]) => ({ lat, lng })),
    [routeLatLngs],
  );

  return (
    <MapContainer
      ref={ref}
      center={[0, 0]}
      zoom={2}
      style={{ height: "100%", width: "100%" }}
      preferCanvas
      renderer={renderer}
    >
      <TileLayer
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {routeLatLngs.length >= 2 && (
        <Polyline positions={routeLatLngs} pathOptions={ROUTE_STYLE} renderer={renderer} />
      )}
      {nonPointData.features.length > 0 && (
        <GeoJSON
          key={geoKey}
          data={nonPointData}
          style={{ ...ROUTE_STYLE, fill: false } as L.PathOptions}
        />
      )}
      <FitBounds bounds={bounds} />
      <AreaTravelTool
        routePoints={routePointObjs}
        onSelectionChange={onAreaSelectionChange ?? (() => {})}
      />
    </MapContainer>
  );
}
