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
