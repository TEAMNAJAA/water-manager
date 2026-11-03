import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ReactNode } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

export type Pin = { id: string; lat: number; lon: number; cls: string; text: string; popup: ReactNode };

export function Map({ pins, zoom = 15 }: { pins: Pin[]; zoom?: number }) {
  const pts = pins.filter((p) => p.lat != null && p.lon != null);
  if (!pts.length) return null;
  const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])).pad(0.15);
  return (
    <div className="map">
      <MapContainer bounds={pts.length > 1 ? bounds : undefined} center={pts.length === 1 ? [pts[0].lat, pts[0].lon] : undefined} zoom={zoom} style={{ height: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution="© OpenStreetMap" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {pts.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon]} icon={L.divIcon({ className: "", html: `<div class="marker ${p.cls}">${p.text}</div>`, iconSize: p.cls === "house" ? [12, 12] : [30, 30], iconAnchor: p.cls === "house" ? [6, 6] : [15, 15] })}>
            <Popup>{p.popup}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
