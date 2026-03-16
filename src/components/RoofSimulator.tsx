"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BuildingInsights } from "@/types/solar";
import { COMPANIES } from "@/lib/companies";

interface Point {
  x: number;
  y: number;
}

interface RoofFace {
  id: string;
  points: Point[];
  slope_direction: number;
  ridge_edge?: number[];
  eave_edge?: number[];
  area_m2: number;
}

interface RoofDetectResult {
  building_angle: number;
  faces: RoofFace[];
  metersPerPixel: number;
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

// 勾配方向(0-360) → 色
function slopeColor(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 135 && d <= 225) return "#f59e0b"; // 南
  if (d >= 45 && d < 135) return "#3b82f6";   // 東
  if (d > 225 && d <= 315) return "#8b5cf6";  // 西
  return "#6b7280";                            // 北
}

// 勾配方向 → ラベル
function slopeLabel(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 157.5 && d <= 202.5) return "南";
  if (d > 202.5 && d <= 247.5) return "南西";
  if (d > 247.5 && d <= 292.5) return "西";
  if (d > 292.5 && d <= 337.5) return "北西";
  if (d > 337.5 || d <= 22.5) return "北";
  if (d > 22.5 && d <= 67.5) return "北東";
  if (d > 67.5 && d <= 112.5) return "東";
  return "南東";
}

// ポリゴンの主軸角度を求める（長辺の角度）
function polygonAngle(polygon: Point[]): number {
  let maxDist = 0;
  let angle = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const dx = polygon[j].x - polygon[i].x;
    const dy = polygon[j].y - polygon[i].y;
    const dist = dx * dx + dy * dy;
    if (dist > maxDist) {
      maxDist = dist;
      angle = Math.atan2(dy, dx);
    }
  }
  return angle;
}

// 辺の長さ
function edgeLength(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);
  const [faceDetails, setFaceDetails] = useState<{ label: string; count: number; color: string; areaM2: number }[]>([]);
  const [roofResult, setRoofResult] = useState<RoofDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  // Geminiで屋根形状を検出
  const detectRoof = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      const { latitude: lat, longitude: lng } = insights.center;

      // Solar APIデータからヒント情報を生成
      const segs = insights.solarPotential.roofSegmentStats;
      const directions = segs
        .map((s) => `${slopeLabel(s.azimuthDegrees)}(${s.stats.areaMeters2.toFixed(0)}m²)`)
        .join(", ");
      const roofHint = {
        totalAreaM2: segs.reduce((s, seg) => s + seg.stats.groundAreaMeters2, 0).toFixed(0),
        segmentCount: segs.length,
        directions,
      };

      const res = await fetch("/api/roof-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, zoom: 20, roofHint }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(`${body.error ?? `HTTP ${res.status}`}${body.detail ? ` (${body.detail})` : ""}`);
      }
      const data = await res.json();
      setRoofResult(data);
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
    if (!canvas || !roofResult || roofResult.faces.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { faces } = roofResult;
    const W = canvas.width;
    const H = canvas.height;

    // 全体の範囲
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const face of faces) {
      for (const p of face.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const margin = 2.0;
    minX -= margin; maxX += margin; minY -= margin; maxY += margin;

    const padding = 50;
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

    // 屋根面を描画
    for (const face of faces) {
      const color = slopeColor(face.slope_direction);
      const canvasPoly = face.points.map(toCanvas);

      // 塗りつぶし
      ctx.beginPath();
      ctx.moveTo(canvasPoly[0].x, canvasPoly[0].y);
      for (let i = 1; i < canvasPoly.length; i++) {
        ctx.lineTo(canvasPoly[i].x, canvasPoly[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = color + "22";
      ctx.fill();
      ctx.strokeStyle = color + "cc";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 棟線（ridge）を赤太線で
      if (face.ridge_edge && face.ridge_edge.length > 0) {
        ctx.strokeStyle = "#ef4444cc";
        ctx.lineWidth = 3;
        for (const edgeIdx of face.ridge_edge) {
          const p1 = canvasPoly[edgeIdx];
          const p2 = canvasPoly[(edgeIdx + 1) % canvasPoly.length];
          if (p1 && p2) {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          }
        }
      }

      // 軒線（eave）をシアン破線で
      if (face.eave_edge && face.eave_edge.length > 0) {
        ctx.strokeStyle = "#22d3eecc";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        for (const edgeIdx of face.eave_edge) {
          const p1 = canvasPoly[edgeIdx];
          const p2 = canvasPoly[(edgeIdx + 1) % canvasPoly.length];
          if (p1 && p2) {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          }
        }
        ctx.setLineDash([]);
      }

      // 寸法線（各辺に長さを表示）
      for (let i = 0; i < canvasPoly.length; i++) {
        const j = (i + 1) % canvasPoly.length;
        const len = edgeLength(face.points[i], face.points[j]);
        if (len < 0.5) continue; // 短すぎる辺はスキップ
        const mx = (canvasPoly[i].x + canvasPoly[j].x) / 2;
        const my = (canvasPoly[i].y + canvasPoly[j].y) / 2;
        const dx = canvasPoly[j].x - canvasPoly[i].x;
        const dy = canvasPoly[j].y - canvasPoly[i].y;
        const nl = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / nl * 12, ny = dx / nl * 12;

        ctx.fillStyle = "#ffffff99";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${len.toFixed(1)}m`, mx + nx, my + ny + 3);
      }

      // ラベル（重心）
      const cx = canvasPoly.reduce((s, p) => s + p.x, 0) / canvasPoly.length;
      const cy = canvasPoly.reduce((s, p) => s + p.y, 0) / canvasPoly.length;

      ctx.fillStyle = color + "ee";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${slopeLabel(face.slope_direction)}面`, cx, cy - 4);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = color + "aa";
      ctx.fillText(`${face.area_m2.toFixed(1)}m²`, cx, cy + 10);
      ctx.textAlign = "start";
    }

    // パネル敷き詰め（各面の主軸に沿って回転配置）
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05;

    let totalCount = 0;
    const details: { label: string; count: number; color: string; areaM2: number }[] = [];

    for (const face of faces) {
      const shrunk = shrinkPolygon(face.points, 0.25);
      const angle = polygonAngle(face.points);
      const cosA = Math.cos(angle), sinA = Math.sin(angle);

      // shrunkポリゴンを回転座標系に変換
      const fcx = shrunk.reduce((s, p) => s + p.x, 0) / shrunk.length;
      const fcy = shrunk.reduce((s, p) => s + p.y, 0) / shrunk.length;

      const rotated = shrunk.map(p => ({
        x: (p.x - fcx) * cosA + (p.y - fcy) * sinA,
        y: -(p.x - fcx) * sinA + (p.y - fcy) * cosA,
      }));

      let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
      for (const p of rotated) {
        if (p.x < rMinX) rMinX = p.x;
        if (p.x > rMaxX) rMaxX = p.x;
        if (p.y < rMinY) rMinY = p.y;
        if (p.y > rMaxY) rMaxY = p.y;
      }

      // 縦置き・横置き両方試す
      let bestCount = 0;
      let bestPanels: Point[] = [];
      let bestPw = pW, bestPh = pH;

      for (const [pw, ph] of [[pW, pH], [pH, pW]] as [number, number][]) {
        let count = 0;
        const panels: Point[] = [];

        for (let lx = rMinX; lx + pw <= rMaxX; lx += pw + gap) {
          for (let ly = rMinY; ly + ph <= rMaxY; ly += ph + gap) {
            const corners = [
              { x: lx, y: ly },
              { x: lx + pw, y: ly },
              { x: lx + pw, y: ly + ph },
              { x: lx, y: ly + ph },
            ];
            if (!corners.every(c => pointInPolygon(c, rotated))) continue;

            // ワールド座標に戻す（tl位置のみ）
            const wx = lx * cosA - ly * sinA + fcx;
            const wy = lx * sinA + ly * cosA + fcy;
            panels.push({ x: wx, y: wy });
            count++;
          }
        }

        if (count > bestCount) {
          bestCount = count;
          bestPanels = panels;
          bestPw = pw;
          bestPh = ph;
        }
      }

      // パネル描画
      for (const tl of bestPanels) {
        const ct = toCanvas(tl);
        ctx.save();
        ctx.translate(ct.x, ct.y);
        ctx.rotate(-angle);
        const pwPx = bestPw * scale;
        const phPx = bestPh * scale;
        ctx.fillStyle = company.color + "bb";
        ctx.fillRect(0, 0, pwPx, phPx);
        ctx.strokeStyle = company.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(0, 0, pwPx, phPx);
        ctx.strokeStyle = company.color + "40";
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(pwPx / 2, 0);
        ctx.lineTo(pwPx / 2, phPx);
        ctx.stroke();
        ctx.restore();
      }

      if (bestCount > 0) {
        details.push({
          label: `${slopeLabel(face.slope_direction)}面`,
          count: bestCount,
          color: slopeColor(face.slope_direction),
          areaM2: face.area_m2,
        });
      }
      totalCount += bestCount;
    }

    setPanelCount(totalCount);
    setFaceDetails(details);

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

    // 凡例
    const legY = 16;
    ctx.font = "10px sans-serif";
    ctx.strokeStyle = "#ef4444cc";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(12, legY); ctx.lineTo(32, legY); ctx.stroke();
    ctx.fillStyle = "#ffffffaa";
    ctx.textAlign = "start";
    ctx.fillText("棟", 36, legY + 3);
    ctx.strokeStyle = "#22d3eecc";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(60, legY); ctx.lineTo(80, legY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText("軒", 84, legY + 3);

  }, [roofResult, company]);

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
            <p className="text-white/70 text-sm mt-3">Grok が屋根形状を解析中...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/90 gap-3 px-6">
            <p className="text-red-400 text-sm text-center break-all">{error}</p>
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
        {roofResult && roofResult.faces.length > 0 && (
          <div className="absolute top-3 right-3 bg-black/80 backdrop-blur text-white text-xs px-4 py-3 rounded-lg space-y-1.5 min-w-[180px]">
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
            {faceDetails.length > 0 && (
              <div className="border-t border-white/10 pt-1.5 mt-1.5 space-y-1">
                {faceDetails.map((d, i) => (
                  <div key={i}>
                    <div className="flex justify-between gap-3">
                      <span style={{ color: d.color }}>{d.label}</span>
                      <span>{d.count}枚</span>
                    </div>
                    <div className="text-white/40 text-[10px]">{d.areaM2.toFixed(1)}m²</div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-white/10 pt-1.5 mt-1.5 text-white/40">
              建物角度: {roofResult.building_angle}°
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          ※ Grok AIが衛星写真から屋根形状を検出。棟/軒を識別し各社パネルを配置した参考シミュレーションです。
        </p>
        <button
          onClick={detectRoof}
          disabled={detecting}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50 whitespace-nowrap ml-2"
        >
          再検出
        </button>
      </div>
    </div>
  );
}
