"use client";

import { useEffect, useRef } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { BuildingInsights } from "@/types/solar";

interface Props {
  insights: BuildingInsights;
  apiKey: string;
}

// Map sunshine (kWh/kW/year) to a color: blue → green → yellow → red
function sunshineColor(value: number, min: number, max: number): string {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  if (t < 0.5) {
    const s = t / 0.5;
    const r = Math.round(s * 255);
    const g = Math.round(s * 200);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}ff`;
  } else {
    const s = (t - 0.5) / 0.5;
    const g = Math.round((1 - s) * 200);
    const b = Math.round((1 - s) * 255);
    return `#ff${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
}

export default function SolarMap({ insights, apiKey }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const overlaysRef = useRef<(google.maps.Polygon | google.maps.Rectangle)[]>([]);

  useEffect(() => {
    if (!mapRef.current) return;

    setOptions({ key: apiKey, v: "weekly" });

    (async () => {
      const { Map } = await importLibrary("maps");
      const { latitude, longitude } = insights.center;

      const map = new Map(mapRef.current!, {
        center: { lat: latitude, lng: longitude },
        zoom: 20,
        mapTypeId: "satellite",
        tilt: 0,
        disableDefaultUI: true,
        zoomControl: true,
        fullscreenControl: true,
      });

      overlaysRef.current.forEach((p) => p.setMap(null));
      overlaysRef.current = [];

      const { solarPotential } = insights;
      const { roofSegmentStats, solarPanels, panelHeightMeters, panelWidthMeters } = solarPotential;

      // --- Roof segments colored by sunshine ---
      const sunshineValues = roofSegmentStats
        .map((seg) => seg.stats.sunshineQuantiles?.[5] ?? 0)
        .filter((v) => v > 0);
      const minSun = Math.min(...sunshineValues);
      const maxSun = Math.max(...sunshineValues);

      roofSegmentStats.forEach((seg) => {
        const { sw, ne } = seg.boundingBox;
        const sunshine = seg.stats.sunshineQuantiles?.[5] ?? 0;
        const color = sunshineColor(sunshine, minSun, maxSun);

        const rect = new google.maps.Rectangle({
          bounds: {
            south: sw.latitude,
            west: sw.longitude,
            north: ne.latitude,
            east: ne.longitude,
          },
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.35,
          map,
        });
        overlaysRef.current.push(rect);
      });

      // --- Individual panel rectangles ---
      solarPanels.forEach((panel) => {
        const { latitude: pLat, longitude: pLng } = panel.center;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((pLat * Math.PI) / 180);
        const halfH = panelHeightMeters / 2 / metersPerDegreeLat;
        const halfW = panelWidthMeters / 2 / metersPerDegreeLng;
        const isPortrait = panel.orientation === "PORTRAIT";
        const dLat = isPortrait ? halfH : halfW;
        const dLng = isPortrait ? halfW : halfH;

        const polygon = new google.maps.Polygon({
          paths: [
            { lat: pLat - dLat, lng: pLng - dLng },
            { lat: pLat + dLat, lng: pLng - dLng },
            { lat: pLat + dLat, lng: pLng + dLng },
            { lat: pLat - dLat, lng: pLng + dLng },
          ],
          strokeColor: "#FFD700",
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillColor: "#4ade80",
          fillOpacity: 0.5,
          map,
        });
        overlaysRef.current.push(polygon);
      });

      // Center marker
      new google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      });
    })();
  }, [insights, apiKey]);

  return (
    <div
      ref={mapRef}
      className="w-full rounded-xl overflow-hidden"
      style={{ height: "380px" }}
    />
  );
}
