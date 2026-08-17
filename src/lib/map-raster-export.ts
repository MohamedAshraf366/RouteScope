import type { Feature, FeatureCollection, Polygon } from "geojson";
import { geoJSONToKml } from "@/lib/geojson-to-kml";

export type RasterBasemapConfig = {
  url: string;
  attribution: string;
  subdomains: string;
};

export type RasterBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RasterOverlay = {
  bytes: Uint8Array;
  bounds: RasterBounds;
  width: number;
  height: number;
  kmlHref: string;
  mimeType: string;
};

export type QualityPreset = "standard" | "high" | "ultra" | "auto";

export type QualitySettings = {
  maxZoom: number;
  maxPixels: number;
  maxTiles: number;
  format: "image/png" | "image/jpeg";
  quality: number;
  concurrency: number;
};

const PRESETS: Record<Exclude<QualityPreset, "auto">, QualitySettings> = {
  standard: { maxZoom: 18, maxPixels: 4096, maxTiles: 256, format: "image/jpeg", quality: 0.82, concurrency: 6 },
  high:     { maxZoom: 19, maxPixels: 8192, maxTiles: 1024, format: "image/jpeg", quality: 0.88, concurrency: 8 },
  ultra:    { maxZoom: 21, maxPixels: 16384, maxTiles: 4096, format: "image/jpeg", quality: 0.92, concurrency: 10 },
};

export function resolveQuality(preset: QualityPreset): QualitySettings {
  if (preset !== "auto") return PRESETS[preset];
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const mem = (nav as unknown as { deviceMemory?: number })?.deviceMemory ?? 4;
  const cores = nav?.hardwareConcurrency ?? 4;
  if (mem >= 8 && cores >= 8) return PRESETS.ultra;
  if (mem >= 4 && cores >= 4) return PRESETS.high;
  return PRESETS.standard;
}

export function estimateOutputMB(s: QualitySettings): number {
  // rough megabytes for the encoded image
  const px = s.maxPixels * s.maxPixels;
  const bpp = s.format === "image/jpeg" ? 0.25 : 2;
  return Math.round((px * bpp) / (1024 * 1024));
}

export type ProgressInfo = {
  loaded: number;
  total: number;
  percent: number;
  etaSeconds: number;
};

const TILE_SIZE = 256;

function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToWorldY(lat: number, zoom: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    TILE_SIZE *
    2 ** zoom
  );
}

function worldXToLon(x: number, zoom: number): number {
  return (x / (TILE_SIZE * 2 ** zoom)) * 360 - 180;
}

function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * 2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function boundsForPolygon(feature: Feature<Polygon>): RasterBounds {
  const ring = feature.geometry.coordinates[0] ?? [];
  if (ring.length < 4) throw new Error("The selected area is not a valid closed polygon.");
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) {
    throw new Error("The selected area has invalid coordinates.");
  }
  if (west === east || south === north) throw new Error("The selected area is too small to export.");
  return { west, south, east, north };
}

function quadKey(x: number, y: number, z: number): string {
  let key = "";
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    key += digit.toString();
  }
  return key;
}

function tileUrl(config: RasterBasemapConfig, x: number, y: number, z: number): string {
  const subdomains = config.subdomains || "abc";
  const s = subdomains[Math.abs(x + y + z) % subdomains.length] ?? subdomains[0] ?? "a";
  return config.url
    .replace("{s}", s)
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{z}", String(z))
    .replace("{q}", quadKey(x, y, z));
}

function chooseZoom(
  bounds: RasterBounds,
  maxZoom: number,
  maxPixels: number,
  maxTiles: number,
): number {
  for (let zoom = maxZoom; zoom >= 1; zoom--) {
    const left = lonToWorldX(bounds.west, zoom);
    const right = lonToWorldX(bounds.east, zoom);
    const top = latToWorldY(bounds.north, zoom);
    const bottom = latToWorldY(bounds.south, zoom);
    const width = Math.ceil(Math.abs(right - left));
    const height = Math.ceil(Math.abs(bottom - top));
    const minTileX = Math.floor(Math.min(left, right) / TILE_SIZE);
    const maxTileX = Math.floor((Math.max(left, right) - 1) / TILE_SIZE);
    const minTileY = Math.floor(Math.min(top, bottom) / TILE_SIZE);
    const maxTileY = Math.floor((Math.max(top, bottom) - 1) / TILE_SIZE);
    const tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
    if (width <= maxPixels && height <= maxPixels && tileCount <= maxTiles) return zoom;
  }
  return 1;
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to render the selected map image."));
      },
      mime,
      quality,
    );
  });
}

async function fetchTileImage(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

export async function createSelectionRasterOverlay(
  feature: Feature<Polygon>,
  basemap: RasterBasemapConfig,
  options: {
    quality?: QualitySettings;
    kmlHref?: string;
    onProgress?: (p: ProgressInfo) => void;
  } = {},
): Promise<RasterOverlay> {
  const bounds = boundsForPolygon(feature);
  const q = options.quality ?? resolveQuality("auto");
  const zoom = chooseZoom(bounds, q.maxZoom, q.maxPixels, q.maxTiles);

  const left = lonToWorldX(bounds.west, zoom);
  const right = lonToWorldX(bounds.east, zoom);
  const top = latToWorldY(bounds.north, zoom);
  const bottom = latToWorldY(bounds.south, zoom);
  const minX = Math.min(left, right);
  const maxX = Math.max(left, right);
  const minY = Math.min(top, bottom);
  const maxY = Math.max(top, bottom);
  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not available in this browser.");
  // Smoothing on to reduce visible seams between tiles at fractional offsets.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const minTileX = Math.floor(minX / TILE_SIZE);
  const maxTileX = Math.floor((maxX - 1) / TILE_SIZE);
  const minTileY = Math.floor(minY / TILE_SIZE);
  const maxTileY = Math.floor((maxY - 1) / TILE_SIZE);

  const jobs: { x: number; y: number }[] = [];
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) jobs.push({ x, y });
  }
  const total = jobs.length;
  let done = 0;
  let drawnTiles = 0;
  const started = performance.now();

  const concurrency = Math.max(1, Math.min(q.concurrency, total));
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const { x, y } = jobs[i];
      const image = await fetchTileImage(tileUrl(basemap, x, y, zoom));
      if (image) {
        // Draw with 1px overlap on right/bottom edges to hide seams.
        const dx = Math.round(x * TILE_SIZE - minX);
        const dy = Math.round(y * TILE_SIZE - minY);
        ctx.drawImage(image, dx, dy, TILE_SIZE + 1, TILE_SIZE + 1);
        image.close();
        drawnTiles += 1;
      }
      done += 1;
      if (options.onProgress) {
        const elapsed = (performance.now() - started) / 1000;
        const rate = done / Math.max(elapsed, 0.001);
        const etaSeconds = Math.max(0, Math.round((total - done) / Math.max(rate, 0.001)));
        options.onProgress({ loaded: done, total, percent: Math.round((done / total) * 100), etaSeconds });
      }
    }
  });
  await Promise.all(workers);

  if (drawnTiles === 0) throw new Error("No basemap tiles were available for the selected area.");

  const ring = feature.geometry.coordinates[0] ?? [];
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ring.forEach(([lng, lat], index) => {
    const x = lonToWorldX(lng, zoom) - minX;
    const y = latToWorldY(lat, zoom) - minY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const blob = await canvasBlob(canvas, q.format, q.quality);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = q.format === "image/jpeg" ? "jpg" : "png";

  return {
    bytes,
    width,
    height,
    kmlHref: options.kmlHref ?? `files/selection-basemap.${ext}`,
    mimeType: q.format,
    bounds: {
      west: worldXToLon(minX, zoom),
      east: worldXToLon(maxX, zoom),
      north: worldYToLat(minY, zoom),
      south: worldYToLat(maxY, zoom),
    },
  };
}

export function geoJSONToKmlWithGroundOverlay(
  fc: FeatureCollection,
  overlay: RasterOverlay,
): string {
  const { west, south, east, north } = overlay.bounds;
  const groundOverlay = `<GroundOverlay><name>Selected map image</name><Icon><href>${overlay.kmlHref}</href></Icon><LatLonBox><north>${north}</north><south>${south}</south><east>${east}</east><west>${west}</west></LatLonBox></GroundOverlay>`;
  return geoJSONToKml(fc).replace("</Document>", `${groundOverlay}</Document>`);
}

export function mapInfoRasterTab(overlay: RasterOverlay, imageName: string): string {
  const { west, south, east, north } = overlay.bounds;
  return `!table
!version 300
!charset WindowsLatin1

Definition Table
  File "${imageName}"
  Type "RASTER"
  (${west},${north}) (0,0) Label "Pt 1",
  (${east},${north}) (${overlay.width},0) Label "Pt 2",
  (${east},${south}) (${overlay.width},${overlay.height}) Label "Pt 3",
  (${west},${south}) (0,${overlay.height}) Label "Pt 4"
  CoordSys Earth Projection 1, 104
  Units "degree"
`;
}