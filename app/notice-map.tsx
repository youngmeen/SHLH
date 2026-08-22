"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// 공급주택(진한 초록)과 자치구 재고(회색)를 OpenStreetMap 위에 찍는다.
// 이 파일은 window를 만지는 Leaflet 때문에 page.tsx에서 ssr: false로만 불러온다.

export type MapPoint = {
  lat: number;
  lng: number;
  label: string;
  detail: string;
  kind: "supply" | "inventory";
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export default function NoticeMap({ points }: { points: MapPoint[] }) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    map.setView([37.5665, 126.978], 11); // 서울 시청 — 점이 잡히면 fitBounds가 덮는다
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    if (points.length === 0) return;

    for (const point of points) {
      const supply = point.kind === "supply";
      L.circleMarker([point.lat, point.lng], {
        radius: supply ? 9 : 6,
        color: supply ? "#0b6e55" : "#8b8b8b",
        weight: 2,
        fillColor: supply ? "#17a67e" : "#c2c2c2",
        fillOpacity: 0.85,
      })
        .bindPopup(`<strong>${escapeHtml(point.label)}</strong><br/>${escapeHtml(point.detail)}`)
        .addTo(layer);
    }

    map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number])), {
      padding: [28, 28],
      maxZoom: 15,
    });
  }, [points]);

  return <div ref={divRef} style={{ height: 380, borderRadius: 12, overflow: "hidden" }} aria-label="공급주택과 재고 위치 지도" />;
}
