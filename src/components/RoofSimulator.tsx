"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BuildingInsights } from "@/types/solar";
import { COMPANIES } from "@/lib/companies";

interface Point {
  x: number;
  y: number;
}

interface RoofSegment {
  points: Point[];
  direction: string;
  label: string;
}

interface Props {
  insights: BuildingInsights;
}

// 点がポリゴン内部にあるか (ray casting)
function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ポリゴンを内側にオフセット
function shrinkPolygon(polygon: Point[], amount: number): Point[] {
  if (polygon.length < 3) return polygon;
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  return polygon.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return p;
    const ratio = Math.max(0, (dist - amount) / dist);
    return { x: cx + dx * ratio, y: cy + dy * ratio };
  });
}

// 方位 → 色
function directionColor(dir: string): string {
  const d = dir.toLowerCase();
  if (d.includes("south") || d.includes("南")) return "#f59e0b";
  if (d.includes("east") || d.includes("東")) return "#3b82f6";
  if (d.includes("west") || d.includes("西")) return "#8b5cf6";
  return "#6b7280";
}

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);
  const [segmentDetails, setSegmentDetails] = useState<{ label: string; count: number; color: string }[]>([]);
  const [roofSegments, setRoofSegments] = useState<RoofSegment[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  // Geminiで屋根形状を検出
  const detectRoof = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      const { latitude: lat, longitude: lng } = insights.center;
      const res = await fetch("/api/roof-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, zoom: 21 }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRoofSegments(data.segments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "屋根検出に失敗しました");
    } finally {
      setDetecting(false);
    }
  }, [insights]);

  // 初回自動検出
  useEffect(() => {
    detectRoof();
  }, [detectRoof]);

  // Canvas描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roofSegments || roofSegments.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // 全体の範囲を求める
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const seg of roofSegments) {
      for (const p of seg.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const margin = 1.5;
    minX -= margin; maxX += margin; minY -= margin; maxY += margin;

    const padding = 40;
    const scaleX = (W - padding * 2) / (maxX - minX || 1);
    const scaleY = (H - padding * 2) / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY);

    const drawnW = (maxX - minX) * scale;
    const drawnH = (maxY - minY) * scale;
    const offsetX = (W - drawnW) / 2;
    const offsetY = (H - drawnH) / 2;

    const toCanvas = (p: Point): Point => ({
      x: (p.x - minX) * scale + offsetX,
      y: (p.y - minY) * scale + offsetY,
    });

    ctx.clearRect(0, 0, W, H);

    // 背景
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // グリッド線（1m）
    ctx.strokeStyle = "#ffffff08";
    ctx.lineWidth = 0.5;
    for (let gx = Math.ceil(minX); gx <= maxX; gx += 1) {
      const c1 = toCanvas({ x: gx, y: minY });
      const c2 = toCanvas({ x: gx, y: maxY });
      ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
    }
    for (let gy = Math.ceil(minY); gy <= maxY; gy += 1) {
      const c1 = toCanvas({ x: minX, y: gy });
      const c2 = toCanvas({ x: maxX, y: gy });
      ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
    }

    // セグメントをポリゴンで描画
    for (const seg of roofSegments) {
      const color = directionColor(seg.direction);
      const canvasPoly = seg.points.map(toCanvas);

      ctx.beginPath();
      ctx.moveTo(canvasPoly[0].x, canvasPoly[0].y);
      for (let i = 1; i < canvasPoly.length; i++) {
        ctx.lineTo(canvasPoly[i].x, canvasPoly[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = color + "20";
      ctx.fill();
      ctx.strokeStyle = color + "cc";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // ラベル
      const cx = canvasPoly.reduce((s, p) => s + p.x, 0) / canvasPoly.length;
      const cy = canvasPoly.reduce((s, p) => s + p.y, 0) / canvasPoly.length;
      ctx.fillStyle = color + "dd";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(seg.label, cx, cy);
      ctx.textAlign = "start";
    }

    // パネル敷き詰め
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05;

    let totalCount = 0;
    const details: { label: string; count: number; color: string }[] = [];

    for (const seg of roofSegments) {
      const shrunk = shrinkPolygon(seg.points, 0.2);
      const color = directionColor(seg.direction);

      let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
      for (const p of shrunk) {
        if (p.x < sMinX) sMinX = p.x;
        if (p.x > sMaxX) sMaxX = p.x;
        if (p.y < sMinY) sMinY = p.y;
        if (p.y > sMaxY) sMaxY = p.y;
      }

      let segCount = 0;
      for (let mx = sMinX; mx + pW <= sMaxX; mx += pW + gap) {
        for (let my = sMinY; my + pH <= sMaxY; my += pH + gap) {
          const corners: Point[] = [
            { x: mx, y: my },
            { x: mx + pW, y: my },
            { x: mx + pW, y: my + pH },
            { x: mx, y: my + pH },
          ];
          if (!corners.every((c) => pointInPolygon(c, shrunk))) continue;

          const tl = toCanvas({ x: mx, y: my });
          const br = toCanvas({ x: mx + pW, y: my + pH });

          ctx.fillStyle = company.color + "bb";
          ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
          ctx.strokeStyle = company.color;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

          // セル風の線
          const pw = br.x - tl.x;
          ctx.strokeStyle = company.color + "40";
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(tl.x + pw / 2, tl.y);
          ctx.lineTo(tl.x + pw / 2, br.y);
          ctx.stroke();

          segCount++;
        }
      }

      if (segCount > 0) {
        details.push({ label: seg.label, count: segCount, color });
      }
      totalCount += segCount;
    }

    setPanelCount(totalCount);
    setSegmentDetails(details);

    // スケールバー
    const scaleBarM = Math.max(1, Math.round((maxX - minX) / 4));
    const scaleBarPx = scaleBarM * scale;
    const sbX = W - padding - scaleBarPx;
    const sbY = H - 16;
    ctx.strokeStyle = "#ffffff60";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(sbX + scaleBarPx, sbY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sbX, sbY - 4); ctx.lineTo(sbX, sbY + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sbX + scaleBarPx, sbY - 4); ctx.lineTo(sbX + scaleBarPx, sbY + 4); ctx.stroke();
    ctx.fillStyle = "#ffffff80";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${scaleBarM}m`, sbX + scaleBarPx / 2, sbY - 6);
    ctx.textAlign = "start";

  }, [roofSegments, company]);

  const totalKw = (panelCount * company.panelWatts) / 1000;

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
      </div>

      {/* Canvas */}
      <div className="bg-slate-900 rounded-xl overflow-hidden relative">
        {detecting && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/90">
            <div className="w-12 h-12 rounded-full border-4 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <p className="text-white/70 text-sm mt-3">AI が屋根形状を解析中...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/90 gap-3">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={detectRoof}
              className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors text-white"
            >
              再試行
            </button>
          </div>
        )}

        <canvas ref={canvasRef} width={800} height={500} className="w-full h-auto" />

        {/* パネル情報オーバーレイ */}
        {roofSegments && roofSegments.length > 0 && (
          <div className="absolute top-3 right-3 bg-black/80 backdrop-blur text-white text-xs px-4 py-3 rounded-lg space-y-1.5 min-w-[160px]">
            <div className="font-bold text-sm" style={{ color: company.color }}>{company.name}</div>
            <div className="text-white/60">{company.modelName}</div>
            <div className="text-white/60">
              {(company.panelWidthM * 1000).toFixed(0)} x {(company.panelHeightM * 1000).toFixed(0)} mm / {company.panelWatts}W
            </div>
            <div className="border-t border-white/10 pt-1.5 mt-1.5">
              <div className="text-xl font-black" style={{ color: company.color }}>
                {panelCount} <span className="text-sm font-normal text-white/60">枚</span>
              </div>
              <div className="text-white/50">{totalKw.toFixed(2)} kW</div>
            </div>
            {segmentDetails.length > 0 && (
              <div className="border-t border-white/10 pt-1.5 mt-1.5 space-y-0.5">
                {segmentDetails.map((d, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span style={{ color: d.color }}>{d.label}</span>
                    <span>{d.count}枚</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          ※ Gemini AIが衛星写真から屋根形状を検出。各社パネルサイズで配置した参考シミュレーションです。
        </p>
        <button
          onClick={detectRoof}
          disabled={detecting}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
        >
          再検出
        </button>
      </div>
    </div>
  );
}
