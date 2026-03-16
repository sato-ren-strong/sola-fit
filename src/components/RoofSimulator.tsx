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
    y: -((lat - centerLat) * metersPerDegreeLat),
  };
}

function pointInRect(p: Point, sw: Point, ne: Point): boolean {
  const minX = Math.min(sw.x, ne.x);
  const maxX = Math.max(sw.x, ne.x);
  const minY = Math.min(sw.y, ne.y);
  const maxY = Math.max(sw.y, ne.y);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

// 方位角 → 色 (0=N, 90=E, 180=S, 270=W)
function azimuthColor(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 135 && d <= 225) return "#f59e0b"; // 南：アンバー
  if (d >= 45 && d < 135) return "#3b82f6";   // 東：ブルー
  if (d > 225 && d <= 315) return "#8b5cf6";  // 西：パープル
  return "#6b7280";                            // 北：グレー
}

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { roofSegmentStats } = insights.solarPotential;
    const { latitude: cLat, longitude: cLng } = insights.center;

    if (!roofSegmentStats || roofSegmentStats.length === 0) return;

    setSegmentCount(roofSegmentStats.length);

    // 各セグメントのバウンディングボックスをメートル座標に変換
    type SegRect = { sw: Point; ne: Point; azimuth: number; pitch: number };
    const segments: SegRect[] = roofSegmentStats.map((seg) => ({
      sw: latLngToMeters(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude, cLat, cLng),
      ne: latLngToMeters(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude, cLat, cLng),
      azimuth: seg.azimuthDegrees,
      pitch: seg.pitchDegrees,
    }));

    // 全体の範囲を求める
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const seg of segments) {
      for (const p of [seg.sw, seg.ne]) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const W = canvas.width;
    const H = canvas.height;
    const padding = 32;
    const scaleX = (W - padding * 2) / (maxX - minX || 1);
    const scaleY = (H - padding * 2) / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY);

    const toCanvas = (p: Point): Point => ({
      x: (p.x - minX) * scale + padding,
      y: (p.y - minY) * scale + padding,
    });

    ctx.clearRect(0, 0, W, H);

    // 背景
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // セグメントを方位別カラーで描画
    for (const seg of segments) {
      const sw = toCanvas(seg.sw);
      const ne = toCanvas(seg.ne);
      const rx = Math.min(sw.x, ne.x);
      const ry = Math.min(sw.y, ne.y);
      const rw = Math.abs(ne.x - sw.x);
      const rh = Math.abs(ne.y - sw.y);
      const color = azimuthColor(seg.azimuth);

      ctx.fillStyle = color + "25";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = color + "99";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, ry, rw, rh);

      // 傾斜ラベル
      ctx.fillStyle = color + "cc";
      ctx.font = "10px sans-serif";
      ctx.fillText(`${seg.pitch.toFixed(0)}°`, rx + 4, ry + 13);
    }

    // 各社パネルをセグメント内に敷き詰め
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05;

    let count = 0;
    for (let mx = minX; mx + pW <= maxX; mx += pW + gap) {
      for (let my = minY; my + pH <= maxY; my += pH + gap) {
        const center: Point = { x: mx + pW / 2, y: my + pH / 2 };
        if (!segments.some((seg) => pointInRect(center, seg.sw, seg.ne))) continue;

        const tl = toCanvas({ x: mx, y: my });
        const br = toCanvas({ x: mx + pW, y: my + pH });
        ctx.fillStyle = company.color + "cc";
        ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.strokeStyle = company.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
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

      {/* 方位凡例 */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
        {[
          { label: "南向き", color: "#f59e0b" },
          { label: "東向き", color: "#3b82f6" },
          { label: "西向き", color: "#8b5cf6" },
          { label: "北向き", color: "#6b7280" },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
        <span className="text-gray-500">屋根面 {segmentCount} 面検出</span>
      </div>

      {/* Canvas */}
      <div className="bg-slate-900 rounded-xl overflow-hidden relative">
        <canvas ref={canvasRef} width={640} height={400} className="w-full h-auto" />
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
        ※ 各色の矩形はSolar APIの屋根面セグメント（方位別・数値は傾斜角）。その中に各社パネルを敷き詰めた参考シミュレーションです
      </p>
    </div>
  );
}
