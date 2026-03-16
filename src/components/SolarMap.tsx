"use client";

import { useEffect, useRef } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { BuildingInsights } from "@/types/solar";
import { fromArrayBuffer } from "geotiff";

interface Props {
  insights: BuildingInsights;
  apiKey: string;
}

// Solar flux colormap: black → red → yellow → white
function fluxToRgba(value: number, min: number, max: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  if (t < 0.33) {
    const s = t / 0.33;
    return [Math.round(s * 255), 0, 0];
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    return [255, Math.round(s * 255), 0];
  } else {
    const s = (t - 0.66) / 0.34;
    return [255, 255, Math.round(s * 255)];
  }
}

async function renderFluxOverlay(
  fluxTileUrl: string,
  maskTileUrl: string
): Promise<{ canvas: HTMLCanvasElement; bounds: { north: number; south: number; east: number; west: number } } | null> {
  try {
    const [fluxRes, maskRes] = await Promise.all([
      fetch(`/api/solar-layers?tileUrl=${encodeURIComponent(fluxTileUrl)}`),
      fetch(`/api/solar-layers?tileUrl=${encodeURIComponent(maskTileUrl)}`),
    ]);
    if (!fluxRes.ok || !maskRes.ok) return null;

    const [fluxBuf, maskBuf] = await Promise.all([fluxRes.arrayBuffer(), maskRes.arrayBuffer()]);

    const fluxTiff = await fromArrayBuffer(fluxBuf);
    const maskTiff = await fromArrayBuffer(maskBuf);

    const fluxImage = await fluxTiff.getImage();
    const maskImage = await maskTiff.getImage();

    const fluxData = (await fluxImage.readRasters())[0] as Float32Array;
    const maskData = (await maskImage.readRasters())[0] as Uint8Array;

    const width = fluxImage.getWidth();
    const height = fluxImage.getHeight();
    const bbox = fluxImage.getBoundingBox(); // [west, south, east, north]

    // Compute min/max of valid (masked) pixels
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < fluxData.length; i++) {
      if (maskData[i] > 0 && isFinite(fluxData[i])) {
        if (fluxData[i] < min) min = fluxData[i];
        if (fluxData[i] > max) max = fluxData[i];
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(width, height);

    for (let i = 0; i < fluxData.length; i++) {
      const masked = maskData[i] > 0;
      const idx = i * 4;
      if (masked && isFinite(fluxData[i])) {
        const [r, g, b] = fluxToRgba(fluxData[i], min, max);
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 200; // semi-transparent
      } else {
        imageData.data[idx + 3] = 0; // transparent
      }
    }

    ctx.putImageData(imageData, 0, 0);

    return {
      canvas,
      bounds: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
    };
  } catch (e) {
    console.error("flux overlay error", e);
    return null;
  }
}

export default function SolarMap({ insights, apiKey }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<google.maps.Polygon[]>([]);
  const groundOverlayRef = useRef<google.maps.GroundOverlay | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    setOptions({ key: apiKey, v: "weekly" });

    (async () => {
      const { Map, GroundOverlay } = await importLibrary("maps");
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

      mapInstanceRef.current = map;

      // Clear previous overlays
      overlaysRef.current.forEach((p) => p.setMap(null));
      overlaysRef.current = [];
      if (groundOverlayRef.current) {
        groundOverlayRef.current.setMap(null);
        groundOverlayRef.current = null;
      }

      // --- Existing panel rectangles (kept as-is) ---
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

      // Center marker
      new google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map,
        title: "解析対象の建物",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      });

      // --- DataLayers flux overlay ---
      try {
        const layersRes = await fetch(`/api/solar-layers?lat=${latitude}&lng=${longitude}`);
        if (layersRes.ok) {
          const layers = await layersRes.json();
          if (layers.annualFluxUrl && layers.maskUrl) {
            const overlay = await renderFluxOverlay(layers.annualFluxUrl, layers.maskUrl);
            if (overlay) {
              const { canvas, bounds } = overlay;
              const dataUrl = canvas.toDataURL("image/png");
              const groundOverlay = new GroundOverlay(dataUrl, bounds, { opacity: 0.8 });
              groundOverlay.setMap(map);
              groundOverlayRef.current = groundOverlay;
            }
          }
        }
      } catch (e) {
        console.warn("dataLayers overlay failed", e);
      }
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
