"use client";

import { useEffect, useRef, useState } from "react";
import { BuildingInsights } from "@/types/solar";
import { COMPANIES } from "@/lib/companies";

interface Point {
  x: number;
  y: number;
}

interface Props {
  insights: BuildingInsights;
}

function latLngToMeters(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number
): Point {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  return {
    x: (lng - centerLng) * metersPerDegreeLng,
    y: -((lat - centerLat) * metersPerDegreeLat), // flip Y for canvas
  };
}

// Gift wrapping convex hull
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points;
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < points[start].x) start = i;
  }
  const hull: Point[] = [];
  let current = start;
  do {
    hull.push(points[current]);
    let next = (current + 1) % points.length;
    for (let i = 0; i < points.length; i++) {
      const cross =
        (points[next].x - points[current].x) * (points[i].y - points[current].y) -
        (points[next].y - points[current].y) * (points[i].x - points[current].x);
      if (cross < 0) next = i;
    }
    current = next;
  } while (current !== start && hull.length <= points.length);
  return hull;
}

// Ray casting point-in-polygon
function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { solarPanels, panelHeightMeters, panelWidthMeters } = insights.solarPotential;
    const { latitude: cLat, longitude: cLng } = insights.center;

    // Convert default panel centers to meter coordinates
    const panelPoints: Point[] = solarPanels.map((p) =>
      latLngToMeters(p.center.latitude, p.center.longitude, cLat, cLng)
    );

    if (panelPoints.length === 0) return;

    // Build hull from panel centers + expand by half default panel size to cover edges
    const hull = convexHull(panelPoints);

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of panelPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    // Expand bounds by half of the default panel size
    const halfW = panelWidthMeters / 2;
    const halfH = panelHeightMeters / 2;
    minX -= halfW; maxX += halfW;
    minY -= halfH; maxY += halfH;

    const W = canvas.width;
    const H = canvas.height;
    const padding = 24;
    const scaleX = (W - padding * 2) / (maxX - minX);
    const scaleY = (H - padding * 2) / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);

    const toCanvas = (p: Point) => ({
      x: (p.x - minX) * scale + padding,
      y: (p.y - minY) * scale + padding,
    });

    // Draw
    ctx.clearRect(0, 0, W, H);

    // Roof area (hull)
    const hullCanvas = hull.map(toCanvas);
    ctx.beginPath();
    ctx.moveTo(hullCanvas[0].x, hullCanvas[0].y);
    for (let i = 1; i < hullCanvas.length; i++) ctx.lineTo(hullCanvas[i].x, hullCanvas[i].y);
    ctx.closePath();
    ctx.fillStyle = "#1e293b";
    ctx.fill();
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Expand hull in meter space for panel inclusion check
    const expandedHull = hull.map((p) => ({
      x: p.x + (p.x > 0 ? halfW : -halfW),
      y: p.y + (p.y > 0 ? halfH : -halfH),
    }));

    // Lay out company panels as a grid
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05; // 5cm gap between panels

    let count = 0;
    const startX = minX + halfW;
    const startY = minY + halfH;

    for (let mx = startX; mx + pW <= maxX; mx += pW + gap) {
      for (let my = startY; my + pH <= maxY; my += pH + gap) {
        const centerM: Point = { x: mx + pW / 2, y: my + pH / 2 };
        if (!pointInPolygon(centerM, expandedHull)) continue;

        const tl = toCanvas({ x: mx, y: my });
        const br = toCanvas({ x: mx + pW, y: my + pH });
        const pw = br.x - tl.x;
        const ph = br.y - tl.y;

        ctx.fillStyle = company.color + "cc";
        ctx.fillRect(tl.x, tl.y, pw, ph);
        ctx.strokeStyle = company.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(tl.x, tl.y, pw, ph);
        count++;
      }
    }

    setPanelCount(count);
  }, [insights, company]);

  return (
    <div className="space-y-4">
      {/* Company tabs */}
      <div className="flex flex-wrap gap-2">
        {COMPANIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border"
            style={
              selectedId === c.id
                ? { backgroundColor: c.color, color: "#fff", borderColor: c.color }
                : { backgroundColor: "transparent", color: c.color, borderColor: c.color + "60" }
            }
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div className="bg-slate-900 rounded-xl overflow-hidden relative">
        <canvas
          ref={canvasRef}
          width={640}
          height={400}
          className="w-full h-auto"
        />
        {/* Info overlay */}
        <div className="absolute top-3 right-3 bg-black/70 text-white text-xs px-3 py-2 rounded-lg space-y-1">
          <div className="font-bold" style={{ color: company.color }}>{company.name}</div>
          <div>{company.modelName}</div>
          <div>
            {(company.panelWidthM * 1000).toFixed(0)} × {(company.panelHeightM * 1000).toFixed(0)} mm
          </div>
          <div className="text-lg font-black pt-1" style={{ color: company.color }}>
            {panelCount} 枚
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        ※ Solar APIのパネル設置可能エリア（外周）をもとに各社パネルを敷き詰めた参考シミュレーションです
      </p>
    </div>
  );
}
