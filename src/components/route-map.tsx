import { useMemo } from "react";

type LatLng = { lat: number; lng: number };
type Props = {
  geometry: LatLng[];
  waypoints: LatLng[];
  currentLocation?: LatLng | null;
  className?: string;
};

type Tile = { key: string; href: string; x: number; y: number };
type PositionedPoint = LatLng & { x: number; y: number };

const WIDTH = 1000;
const HEIGHT = 400;

function worldAtZoom({ lat, lng }: LatLng, zoom: number) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = (safeLat * Math.PI) / 180;
  const scale = 256 * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) / (4 * Math.PI)) * scale,
  };
}

function baseWorld(point: LatLng) {
  return worldAtZoom(point, 0);
}

function buildMap(geometry: LatLng[], waypoints: LatLng[], currentLocation?: LatLng | null) {
  const route = geometry.length > 1 ? geometry : waypoints;
  const points = [...route, ...(currentLocation ? [currentLocation] : [])];
  if (points.length === 0) {
    return { tiles: [] as Tile[], line: [] as PositionedPoint[], markers: [] as PositionedPoint[], vehicle: null };
  }

  const projected = points.map(baseWorld);
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 0.00001);
  const spanY = Math.max(maxY - minY, 0.00001);
  const paddingX = 120;
  const paddingY = 80;
  const fit = Math.min((WIDTH - paddingX * 2) / spanX, (HEIGHT - paddingY * 2) / spanY);
  const zoom = Math.max(3, Math.min(18, Math.floor(Math.log2(Math.max(fit, 1))))) ;
  const zoomScale = 2 ** zoom;
  const centerBaseX = (minX + maxX) / 2;
  const centerBaseY = (minY + maxY) / 2;
  const centerX = centerBaseX * zoomScale;
  const centerY = centerBaseY * zoomScale;
  const position = (point: LatLng): PositionedPoint => {
    const world = worldAtZoom(point, zoom);
    return { ...point, x: world.x - centerX + WIDTH / 2, y: world.y - centerY + HEIGHT / 2 };
  };

  const tileCount = 2 ** zoom;
  const columns = Math.ceil(WIDTH / 256) + 2;
  const rows = Math.ceil(HEIGHT / 256) + 2;
  const startColumn = Math.floor(centerX / 256) - Math.floor(columns / 2);
  const startRow = Math.floor(centerY / 256) - Math.floor(rows / 2);
  const tiles: Tile[] = [];
  for (let row = startRow; row < startRow + rows; row++) {
    if (row < 0 || row >= tileCount) continue;
    for (let column = startColumn; column < startColumn + columns; column++) {
      const wrappedColumn = ((column % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${wrappedColumn}-${row}`,
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedColumn}/${row}.png`,
        x: column * 256 - centerX + WIDTH / 2,
        y: row * 256 - centerY + HEIGHT / 2,
      });
    }
  }

  return {
    tiles,
    line: route.map(position),
    markers: waypoints.map(position),
    vehicle: currentLocation ? position(currentLocation) : null,
  };
}

export function RouteMap({ geometry, waypoints, currentLocation, className }: Props) {
  const map = useMemo(() => buildMap(geometry, waypoints, currentLocation), [geometry, waypoints, currentLocation]);
  if (map.tiles.length === 0) return null;

  const routePoints = map.line.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  return (
    <div className={`relative aspect-[5/2] min-h-[220px] w-full overflow-hidden rounded-xl bg-slate-100 ${className ?? ""}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={map.vehicle ? "Map showing the driving route and current vehicle location" : "Map showing the driving route between pickup, additional stops, and delivery"}
      >
        <rect width={WIDTH} height={HEIGHT} fill="#eef2f3" />
        {map.tiles.map((tile) => (
          <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width="256" height="256" />
        ))}
        {routePoints && (
          <>
            <polyline points={routePoints} fill="none" stroke="white" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={routePoints} fill="none" stroke="#f97316" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {map.markers.map((point, index) => {
          const label = index === 0 ? "P" : index === map.markers.length - 1 ? "D" : String(index);
          const color = index === 0 ? "#059669" : index === map.markers.length - 1 ? "#ea580c" : "#334155";
          return (
            <g key={`${index}-${point.lat}-${point.lng}`}>
              <circle cx={point.x} cy={point.y} r="15" fill="white" opacity="0.95" />
              <circle cx={point.x} cy={point.y} r="11" fill={color} />
              <text x={point.x} y={point.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="white">{label}</text>
            </g>
          );
        })}
        {map.vehicle && (
          <g transform={`translate(${map.vehicle.x}, ${map.vehicle.y})`} aria-label="Current vehicle location">
            <circle r="18" fill="white" stroke="#2563eb" strokeWidth="2" />
            <rect x="-10" y="-7" width="11" height="12" rx="2" fill="#2563eb" />
            <path d="M1 -4h5l4 4v5H1z" fill="#2563eb" />
            <path d="M3 -2h2.5l2 2H3z" fill="white" />
            <circle cx="-6" cy="7" r="2" fill="#1e3a8a" />
            <circle cx="6" cy="7" r="2" fill="#1e3a8a" />
          </g>
        )}
      </svg>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm hover:text-slate-900"
      >
        © OpenStreetMap contributors
      </a>
      <span className="absolute right-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">
        Road route
      </span>
    </div>
  );
}
