import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASEMAPS, type BasemapKey } from "@/routes/explore";
import AreaTravelTool, { type AreaSelection } from "@/components/AreaTravelTool";
import type { LatLng } from "@/lib/geo-area";

// Fix default marker icons under bundlers
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Bing tile URLs use a quadkey ({q}) instead of x/y/z.
function quadKey(x: number, y: number, z: number): string {
  let key = "";
  for (let i = z; i > 0; i--) {
    let d = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) d++;
    if ((y & mask) !== 0) d += 2;
    key += d.toString();
  }
  return key;
}

const QuadKeyLayer = L.TileLayer.extend({
  getTileUrl(coords: L.Coords) {
    const data = {
      s: (this as L.TileLayer & { _getSubdomain: (c: L.Coords) => string })._getSubdomain(coords),
      q: quadKey(coords.x, coords.y, coords.z),
    };
    return L.Util.template(
      (this as unknown as { _url: string })._url,
      L.Util.extend(data, {}),
    );
  },
});

function BasemapLayer({ basemap }: { basemap: BasemapKey }) {
  const map = useMap();
  useEffect(() => {
    const cfg = BASEMAPS[basemap];
    const isQuad = cfg.url.includes("{q}");
    const layer = isQuad
      ? new (QuadKeyLayer as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer)(
          cfg.url,
          {
            subdomains: cfg.subdomains.split(""),
            attribution: cfg.attribution,
            maxZoom: 19,
          },
        )
      : L.tileLayer(cfg.url, {
          subdomains: cfg.subdomains.split(""),
          attribution: cfg.attribution,
          maxZoom: 20,
        });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [basemap, map]);
  return null;
}

function FlyTo({ target }: { target: { lat: number; lon: number; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], target.zoom, { duration: 1.2 });
  }, [target, map]);
  return null;
}

export default function ExploreMap({
  basemap,
  target,
  onAreaSelectionChange,
}: {
  basemap: BasemapKey;
  target: { lat: number; lon: number; zoom: number; label: string } | null;
  onAreaSelectionChange?: (selection: AreaSelection | null) => void;
}) {
  const emptyRoutePoints = useMemo<LatLng[]>(() => [], []);
  const handleSelection = useMemo(
    () => onAreaSelectionChange ?? (() => {}),
    [onAreaSelectionChange],
  );
  return (
    <MapContainer center={[26.8206, 30.8025]} zoom={5} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        // Placeholder that BasemapLayer will replace; kept so MapContainer has an initial layer.
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
        opacity={0}
      />
      <BasemapLayer basemap={basemap} />
      <FlyTo target={target} />
      {target && (
        <Marker position={[target.lat, target.lon]}>
          <Popup>{target.label}</Popup>
        </Marker>
      )}
      <AreaTravelTool routePoints={emptyRoutePoints} onSelectionChange={handleSelection} />
    </MapContainer>
  );
}