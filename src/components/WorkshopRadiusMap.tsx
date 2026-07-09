import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
} from "react-leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// Fix default marker icons (Vite bundling)
const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const UserIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px #2563eb, 0 2px 6px rgba(0,0,0,0.3)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function FitBounds({
  points,
  radius,
}: {
  points: [number, number][];
  radius: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(15, 18 - Math.log2(Math.max(radius, 50) / 100)));
    } else {
      const b = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
      map.fitBounds(b.pad(0.4), { maxZoom: 18 });
    }
  }, [map, JSON.stringify(points), radius]);
  return null;
}

type Props = {
  workshopLat: number;
  workshopLng: number;
  radius: number;
  userLat?: number | null;
  userLng?: number | null;
  editable?: boolean;
  onWorkshopChange?: (lat: number, lng: number) => void;
  height?: number | string;
};

export default function WorkshopRadiusMap({
  workshopLat,
  workshopLng,
  radius,
  userLat,
  userLng,
  editable = false,
  onWorkshopChange,
  height = 280,
}: Props) {
  const markerRef = useRef<L.Marker | null>(null);

  const distance = useMemo(() => {
    if (userLat == null || userLng == null) return null;
    return haversineMeters(workshopLat, workshopLng, userLat, userLng);
  }, [workshopLat, workshopLng, userLat, userLng]);

  const inside = distance != null ? distance <= radius : null;

  const points: [number, number][] = [[workshopLat, workshopLng]];
  if (userLat != null && userLng != null) points.push([userLat, userLng]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <MapContainer
        center={[workshopLat, workshopLng]}
        zoom={17}
        scrollWheelZoom={false}
        style={{ height, width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Circle
          center={[workshopLat, workshopLng]}
          radius={radius}
          pathOptions={{
            color: inside === false ? "#e11d48" : "#059669",
            fillColor: inside === false ? "#fecdd3" : "#a7f3d0",
            fillOpacity: 0.25,
            weight: 2,
          }}
        />
        <Marker
          position={[workshopLat, workshopLng]}
          draggable={editable}
          ref={markerRef as never}
          eventHandlers={
            editable
              ? {
                  dragend: () => {
                    const m = markerRef.current;
                    if (!m) return;
                    const p = m.getLatLng();
                    onWorkshopChange?.(p.lat, p.lng);
                  },
                }
              : undefined
          }
        />
        {userLat != null && userLng != null && (
          <Marker position={[userLat, userLng]} icon={UserIcon} />
        )}
        <FitBounds points={points} radius={radius} />
      </MapContainer>

      {distance != null && (
        <div
          className={`absolute top-2 left-2 z-[400] rounded-md px-2.5 py-1 text-xs font-semibold shadow ${
            inside
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {inside ? "Di dalam radius" : "Di luar radius"} · {Math.round(distance)} m
        </div>
      )}
      {editable && (
        <div className="absolute bottom-2 left-2 z-[400] rounded-md bg-white/95 backdrop-blur px-2 py-1 text-[11px] text-slate-600 shadow">
          Seret pin untuk memindahkan lokasi workshop
        </div>
      )}
    </div>
  );
}
