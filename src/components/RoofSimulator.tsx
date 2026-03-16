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

// --- 座標変換 ---
function latLngToMeters(
  lat: number, lng: number, cLat: number, cLng: number
): Point {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((cLat * Math.PI) / 180);
  return {
    x: (lng - cLng) * mPerLng,
    y: -((lat - cLat) * mPerLat), // Y軸反転（Canvas用）
  };
}

// --- 凸包 (Graham scan) ---
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0)
      upper.pop();
    upper.push(pts[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// --- 最小面積外接矩形 (Rotating Calipers) ---
function minAreaRect(points: Point[]): Point[] {
  const hull = convexHull(points);
  if (hull.length < 2) return hull;
  if (hull.length === 2) {
    const [a, b] = hull;
    return [a, b, b, a]; // 退化ケース
  }

  let bestArea = Infinity;
  let bestRect: Point[] = [];

  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    // この辺の方向ベクトル
    const dx = hull[j].x - hull[i].x;
    const dy = hull[j].y - hull[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;

    // 単位ベクトル（辺方向とその法線）
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;

    // 全点を(u,v)座標に射影
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const pu = p.x * ux + p.y * uy;
      const pv = p.x * vx + p.y * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      // (u,v)座標の4隅をワールド座標に戻す
      bestRect = [
        { x: minU * ux + minV * vx, y: minU * uy + minV * vy },
        { x: maxU * ux + minV * vx, y: maxU * uy + minV * vy },
        { x: maxU * ux + maxV * vx, y: maxU * uy + maxV * vy },
        { x: minU * ux + maxV * vx, y: minU * uy + maxV * vy },
      ];
    }
  }

  return bestRect;
}

// --- ポリゴンの辺の長さ ---
function edgeLength(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// --- 矩形の幅と高さ（短辺・長辺）---
function rectDimensions(rect: Point[]): { width: number; height: number; angle: number } {
  const e0 = edgeLength(rect[0], rect[1]);
  const e1 = edgeLength(rect[1], rect[2]);
  const longEdge = Math.max(e0, e1);
  const shortEdge = Math.min(e0, e1);
  // 長辺の角度
  const ref = e0 >= e1 ? [rect[0], rect[1]] : [rect[1], rect[2]];
  const angle = Math.atan2(ref[1].y - ref[0].y, ref[1].x - ref[0].x);
  return { width: longEdge, height: shortEdge, angle };
}

// --- 点がポリゴン内部にあるか (ray casting) ---
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

// --- ポリゴンを内側にオフセット ---
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

// --- 方位角 → 色 ---
function azimuthColor(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 135 && d <= 225) return "#f59e0b"; // 南
  if (d >= 45 && d < 135) return "#3b82f6";   // 東
  if (d > 225 && d <= 315) return "#8b5cf6";  // 西
  return "#6b7280";                            // 北
}

// --- 方位角 → ラベル ---
function azimuthLabel(deg: number): string {
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

interface RoofFace {
  rect: Point[];        // 回転外接矩形（4頂点、メートル座標）
  azimuth: number;
  pitch: number;
  areaM2: number;
  widthM: number;
  heightM: number;
  angle: number;        // 矩形の回転角（ラジアン）
  panelPoints: Point[]; // 元のパネル位置（デバッグ用）
}

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);
  const [faceDetails, setFaceDetails] = useState<{ label: string; count: number; color: string; widthM: number; heightM: number }[]>([]);
  const [faces, setFaces] = useState<RoofFace[]>([]);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  // Solar APIデータから屋根面を構築
  useEffect(() => {
    const { roofSegmentStats, solarPanels } = insights.solarPotential;
    const { latitude: cLat, longitude: cLng } = insights.center;

    if (!roofSegmentStats || !solarPanels || solarPanels.length === 0) return;

    // パネルをセグメントごとにグループ化
    const segMap = new Map<number, Point[]>();
    const apiPanelW = insights.solarPotential.panelWidthMeters;
    const apiPanelH = insights.solarPotential.panelHeightMeters;

    for (const panel of solarPanels) {
      const center = latLngToMeters(
        panel.center.latitude, panel.center.longitude, cLat, cLng
      );
      // パネル4隅を追加（回転考慮なしだが、外接矩形の精度向上に寄与）
      const hw = (panel.orientation === "LANDSCAPE" ? apiPanelH : apiPanelW) / 2;
      const hh = (panel.orientation === "LANDSCAPE" ? apiPanelW : apiPanelH) / 2;
      const corners: Point[] = [
        { x: center.x - hw, y: center.y - hh },
        { x: center.x + hw, y: center.y - hh },
        { x: center.x + hw, y: center.y + hh },
        { x: center.x - hw, y: center.y + hh },
      ];
      const idx = panel.segmentIndex;
      if (!segMap.has(idx)) segMap.set(idx, []);
      segMap.get(idx)!.push(...corners);
    }

    // 各セグメントの回転最小外接矩形を計算
    const result: RoofFace[] = [];
    for (const [segIdx, points] of segMap) {
      if (points.length < 3) continue;
      const seg = roofSegmentStats[segIdx];
      if (!seg) continue;

      const rect = minAreaRect(points);
      if (rect.length < 4) continue;

      const dims = rectDimensions(rect);

      result.push({
        rect,
        azimuth: seg.azimuthDegrees,
        pitch: seg.pitchDegrees,
        areaM2: seg.stats.areaMeters2,
        widthM: dims.width,
        heightM: dims.height,
        angle: dims.angle,
        panelPoints: points,
      });
    }

    setFaces(result);
  }, [insights]);

  // Canvas描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || faces.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // 全体の範囲
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const face of faces) {
      for (const p of face.rect) {
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
      const color = azimuthColor(face.azimuth);
      const canvasPoly = face.rect.map(toCanvas);

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

      // 寸法線
      for (let i = 0; i < 2; i++) {
        const p1 = canvasPoly[i];
        const p2 = canvasPoly[i + 1];
        const len = edgeLength(face.rect[i], face.rect[i + 1]);
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        // 辺の法線方向にオフセット
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const nl = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / nl * 14, ny = dx / nl * 14;

        ctx.fillStyle = "#ffffffbb";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${len.toFixed(1)}m`, mx + nx, my + ny + 3);
      }

      // ラベル（重心）
      const cx = canvasPoly.reduce((s, p) => s + p.x, 0) / canvasPoly.length;
      const cy = canvasPoly.reduce((s, p) => s + p.y, 0) / canvasPoly.length;

      ctx.fillStyle = color + "ee";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${azimuthLabel(face.azimuth)}面`, cx, cy - 6);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = color + "aa";
      ctx.fillText(`${face.areaM2.toFixed(1)}m² / 傾斜${face.pitch.toFixed(0)}°`, cx, cy + 8);
      ctx.textAlign = "start";
    }

    // パネル敷き詰め（矩形の回転角に合わせて配置）
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05;

    let totalCount = 0;
    const details: { label: string; count: number; color: string; widthM: number; heightM: number }[] = [];

    for (const face of faces) {
      const shrunk = shrinkPolygon(face.rect, 0.25);
      const color = azimuthColor(face.azimuth);

      // 矩形の回転角に沿ってパネルを配置
      const angle = face.angle;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);

      // shrunkポリゴンを回転座標系に変換してバウンディング取得
      const cx = shrunk.reduce((s, p) => s + p.x, 0) / shrunk.length;
      const cy = shrunk.reduce((s, p) => s + p.y, 0) / shrunk.length;

      const rotated = shrunk.map(p => ({
        x: (p.x - cx) * cosA + (p.y - cy) * sinA,
        y: -(p.x - cx) * sinA + (p.y - cy) * cosA,
      }));

      let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
      for (const p of rotated) {
        if (p.x < rMinX) rMinX = p.x;
        if (p.x > rMaxX) rMaxX = p.x;
        if (p.y < rMinY) rMinY = p.y;
        if (p.y > rMaxY) rMaxY = p.y;
      }

      let faceCount = 0;

      // 縦置きと横置き両方試して多い方を採用
      const orientations: [number, number][] = [[pW, pH], [pH, pW]];
      let bestCount = 0;
      let bestPanels: { tl: Point; br: Point }[] = [];

      for (const [pw, ph] of orientations) {
        let count = 0;
        const panels: { tl: Point; br: Point }[] = [];

        for (let lx = rMinX; lx + pw <= rMaxX; lx += pw + gap) {
          for (let ly = rMinY; ly + ph <= rMaxY; ly += ph + gap) {
            // 4隅を回転座標系で生成
            const localCorners = [
              { x: lx, y: ly },
              { x: lx + pw, y: ly },
              { x: lx + pw, y: ly + ph },
              { x: lx, y: ly + ph },
            ];
            // 回転座標系のまま shrunk ポリゴン内判定
            if (!localCorners.every(c => pointInPolygon(c, rotated))) continue;

            // ワールド座標に戻してCanvas描画用に変換
            const worldTl = {
              x: lx * cosA - ly * sinA + cx,
              y: lx * sinA + ly * cosA + cy,
            };
            const worldBr = {
              x: (lx + pw) * cosA - (ly + ph) * sinA + cx,
              y: (lx + pw) * sinA + (ly + ph) * cosA + cy,
            };
            panels.push({ tl: worldTl, br: worldBr });
            count++;
          }
        }

        if (count > bestCount) {
          bestCount = count;
          bestPanels = panels;
        }
      }

      // パネル描画（回転矩形として描画）
      for (const panel of bestPanels) {
        const ct = toCanvas(panel.tl);
        ctx.save();
        ctx.translate(ct.x, ct.y);
        ctx.rotate(-face.angle);
        const pw_px = pW * scale;
        const ph_px = pH * scale;
        ctx.fillStyle = company.color + "bb";
        ctx.fillRect(0, 0, pw_px, ph_px);
        ctx.strokeStyle = company.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(0, 0, pw_px, ph_px);
        // セル線
        ctx.strokeStyle = company.color + "40";
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(pw_px / 2, 0);
        ctx.lineTo(pw_px / 2, ph_px);
        ctx.stroke();
        ctx.restore();
      }

      faceCount = bestCount;

      if (faceCount > 0) {
        details.push({
          label: `${azimuthLabel(face.azimuth)}面`,
          count: faceCount,
          color,
          widthM: face.widthM,
          heightM: face.heightM,
        });
      }
      totalCount += faceCount;
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

  }, [faces, company]);

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
        <span className="text-gray-500">屋根面 {faces.length} 面検出</span>
      </div>

      {/* Canvas */}
      <div className="bg-slate-900 rounded-xl overflow-hidden relative">
        <canvas ref={canvasRef} width={800} height={500} className="w-full h-auto" />

        {/* パネル情報オーバーレイ */}
        {faces.length > 0 && (
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
                    <div className="text-white/40 text-[10px]">
                      {d.widthM.toFixed(1)} x {d.heightM.toFixed(1)} m
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        ※ Solar APIのパネル配置データから回転最小外接矩形で屋根面を推定。実寸メートル座標で各社パネルを配置しています。
      </p>
    </div>
  );
}
