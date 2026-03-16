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
  points: Point[];          // メートル座標
  pixelPoints: number[][];  // Grokが返した生ピクセル座標
  slope_direction: number;
  ridge_edge?: number[];
  eave_edge?: number[];
  area_m2: number;
}

interface RoofDetectResult {
  building_angle: number;
  faces: RoofFace[];
  metersPerPixel: number;
  imageSize: number;
  satelliteImage: string; // data:image/png;base64,...
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
  if (d >= 135 && d <= 225) return "#f59e0b";
  if (d >= 45 && d < 135) return "#3b82f6";
  if (d > 225 && d <= 315) return "#8b5cf6";
  return "#6b7280";
}

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

// ポリゴンの主軸角度
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

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);
  const [faceDetails, setFaceDetails] = useState<{ label: string; count: number; color: string; areaM2: number }[]>([]);
  const [roofResult, setRoofResult] = useState<RoofDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  const detectRoof = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      const { latitude: lat, longitude: lng } = insights.center;
      const res = await fetch("/api/roof-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, zoom: 20 }),
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

  useEffect(() => {
    detectRoof();
  }, [detectRoof]);

  // Canvas描画 — 衛星写真の上にGrokのピクセル座標を重ねて描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roofResult || roofResult.faces.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { faces, imageSize, metersPerPixel, satelliteImage } = roofResult;
    const W = canvas.width;
    const H = canvas.height;

    // 衛星画像(imageSize x imageSize)をCanvas(W x H)にフィット
    const imgScale = Math.min(W / imageSize, H / imageSize);
    const imgOffX = (W - imageSize * imgScale) / 2;
    const imgOffY = (H - imageSize * imgScale) / 2;

    // Grokのピクセル座標をCanvas座標に変換（衛星画像と同じスケール）
    const toCanvas = (px: number, py: number): Point => ({
      x: px * imgScale + imgOffX,
      y: py * imgScale + imgOffY,
    });

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // 衛星写真を背景に描画
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, imgOffX, imgOffY, imageSize * imgScale, imageSize * imgScale);
      drawOverlay();
    };
    img.src = satelliteImage;

    function drawOverlay() {
      if (!ctx) return;

    // 屋根面を描画（ピクセル座標そのまま）
    for (const face of faces) {
      const color = slopeColor(face.slope_direction);
      const pts = face.pixelPoints.map(p => toCanvas(p[0], p[1]));

      // 塗りつぶし
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = color + "22";
      ctx.fill();

      // 枠線
      ctx.strokeStyle = color + "cc";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 棟線（赤太線）
      if (face.ridge_edge && face.ridge_edge.length > 0) {
        ctx.strokeStyle = "#ef4444cc";
        ctx.lineWidth = 3;
        for (const ei of face.ridge_edge) {
          const p1 = pts[ei];
          const p2 = pts[(ei + 1) % pts.length];
          if (p1 && p2) {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          }
        }
      }

      // 軒線（シアン破線）
      if (face.eave_edge && face.eave_edge.length > 0) {
        ctx.strokeStyle = "#22d3eecc";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        for (const ei of face.eave_edge) {
          const p1 = pts[ei];
          const p2 = pts[(ei + 1) % pts.length];
          if (p1 && p2) {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          }
        }
        ctx.setLineDash([]);
      }

      // 各辺の長さ（メートル）
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const dx = (face.pixelPoints[j][0] - face.pixelPoints[i][0]) * metersPerPixel;
        const dy = (face.pixelPoints[j][1] - face.pixelPoints[i][1]) * metersPerPixel;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) continue;
        const mx = (pts[i].x + pts[j].x) / 2;
        const my = (pts[i].y + pts[j].y) / 2;
        const edx = pts[j].x - pts[i].x;
        const edy = pts[j].y - pts[i].y;
        const nl = Math.sqrt(edx * edx + edy * edy) || 1;
        const nx = -edy / nl * 12, ny = edx / nl * 12;
        ctx.fillStyle = "#ffffff99";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${len.toFixed(1)}m`, mx + nx, my + ny + 3);
      }

      // ラベル（重心）
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      ctx.fillStyle = color + "ee";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${slopeLabel(face.slope_direction)}面`, cx, cy - 4);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = color + "aa";
      ctx.fillText(`${face.area_m2.toFixed(1)}m²`, cx, cy + 10);
      ctx.textAlign = "start";
    }

    // パネル敷き詰め（メートル座標で計算）
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05;

    let totalCount = 0;
    const details: { label: string; count: number; color: string; areaM2: number }[] = [];

    for (const face of faces) {
      const shrunk = shrinkPolygon(face.points, 0.25);
      const angle = polygonAngle(face.points);
      const cosA = Math.cos(angle), sinA = Math.sin(angle);

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

      let bestCount = 0;
      let bestPanels: { wx: number; wy: number; pw: number; ph: number }[] = [];

      for (const [pw, ph] of [[pW, pH], [pH, pW]] as [number, number][]) {
        let count = 0;
        const panels: { wx: number; wy: number; pw: number; ph: number }[] = [];
        for (let lx = rMinX; lx + pw <= rMaxX; lx += pw + gap) {
          for (let ly = rMinY; ly + ph <= rMaxY; ly += ph + gap) {
            const corners = [
              { x: lx, y: ly }, { x: lx + pw, y: ly },
              { x: lx + pw, y: ly + ph }, { x: lx, y: ly + ph },
            ];
            if (!corners.every(c => pointInPolygon(c, rotated))) continue;
            const wx = lx * cosA - ly * sinA + fcx;
            const wy = lx * sinA + ly * cosA + fcy;
            panels.push({ wx, wy, pw, ph });
            count++;
          }
        }
        if (count > bestCount) {
          bestCount = count;
          bestPanels = panels;
        }
      }

      // パネル描画（メートル座標→ピクセル座標→キャンバス座標）
      const centerPx = imageSize / 2;
      for (const panel of bestPanels) {
        const px = panel.wx / metersPerPixel + centerPx;
        const py = panel.wy / metersPerPixel + centerPx;
        const ct = toCanvas(px, py);
        ctx.save();
        ctx.translate(ct.x, ct.y);
        ctx.rotate(-angle);
        const pwPx = panel.pw / metersPerPixel * imgScale;
        const phPx = panel.ph / metersPerPixel * imgScale;
        ctx.fillStyle = company.color + "bb";
        ctx.fillRect(0, 0, pwPx, phPx);
        ctx.strokeStyle = company.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(0, 0, pwPx, phPx);
        ctx.strokeStyle = company.color + "40";
        ctx.lineWidth = 0.3;
        ctx.beginPath(); ctx.moveTo(pwPx / 2, 0); ctx.lineTo(pwPx / 2, phPx); ctx.stroke();
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
    const scaleBarM = Math.max(1, Math.round(imageSize * metersPerPixel / 4));
    const scaleBarCanvasPx = (scaleBarM / metersPerPixel) * imgScale;
    const sbX = W - 20 - scaleBarCanvasPx;
    const sbY = H - 16;
    ctx.strokeStyle = "#ffffff90";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(sbX + scaleBarCanvasPx, sbY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sbX, sbY - 4); ctx.lineTo(sbX, sbY + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sbX + scaleBarCanvasPx, sbY - 4); ctx.lineTo(sbX + scaleBarCanvasPx, sbY + 4); ctx.stroke();
    ctx.fillStyle = "#ffffffcc";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${scaleBarM}m`, sbX + scaleBarCanvasPx / 2, sbY - 6);
    ctx.textAlign = "start";

    // 凡例
    ctx.font = "10px sans-serif";
    ctx.strokeStyle = "#ef4444cc"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(12, 16); ctx.lineTo(32, 16); ctx.stroke();
    ctx.fillStyle = "#ffffffee"; ctx.textAlign = "start";
    ctx.fillText("棟", 36, 19);
    ctx.strokeStyle = "#22d3eecc"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(60, 16); ctx.lineTo(80, 16); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText("軒", 84, 19);

    } // drawOverlay end

  }, [roofResult, company]);

  const totalKw = (panelCount * company.panelWatts) / 1000;

  return (
    <div className="space-y-4">
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
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          ※ Grok AIが衛星写真から屋根形状を検出。各社パネルを配置した参考シミュレーションです。
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
