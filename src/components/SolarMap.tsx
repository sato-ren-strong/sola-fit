"use client";

import { useEffect, useRef } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { BuildingInsights } from "@/types/solar";

interface Props {
  insights: BuildingInsights;
  apiKey: string;
}

export default function SolarMap({ insights, apiKey }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const overlaysRef = useRef<google.maps.Polygon[]>([]);

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

      const { solarPanels, panelHeightMeters, panelWidthMeters } = insights.solarPotential;

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
    <div ref={mapRef} className="w-full rounded-xl overflow-hidden" style={{ height: "380px" }} />
  );
}
