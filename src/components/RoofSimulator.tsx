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

// 凸包 (Graham scan)
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
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
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

// ポリゴンを少し内側にオフセット（パネル配置用マージン）
function shrinkPolygon(polygon: Point[], amount: number): Point[] {
  if (polygon.length < 3) return polygon;
  // 重心を求めて各頂点を重心方向にamount分縮める
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

// 方位角 → 色 (0=N, 90=E, 180=S, 270=W)
function azimuthColor(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 135 && d <= 225) return "#f59e0b"; // 南：アンバー
  if (d >= 45 && d < 135) return "#3b82f6";   // 東：ブルー
  if (d > 225 && d <= 315) return "#8b5cf6";  // 西：パープル
  return "#6b7280";                            // 北：グレー
}

// 方位角 → ラベル
function azimuthLabel(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 135 && d <= 225) return "南";
  if (d >= 45 && d < 135) return "東";
  if (d > 225 && d <= 315) return "西";
  return "北";
}

interface RoofSegment {
  polygon: Point[];
  azimuth: number;
  pitch: number;
  areaM2: number;
}

export default function RoofSimulator({ insights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [panelCount, setPanelCount] = useState(0);
  const [segmentDetails, setSegmentDetails] = useState<{ dir: string; count: number; color: string }[]>([]);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { roofSegmentStats, solarPanels } = insights.solarPotential;
    const { latitude: cLat, longitude: cLng } = insights.center;

    if (!roofSegmentStats || roofSegmentStats.length === 0) return;

    // Google APIのパネル位置からセグメントごとの凸包を構築
    const segmentPanelPoints: Map<number, Point[]> = new Map();
    const panelW = insights.solarPotential.panelWidthMeters;
    const panelH = insights.solarPotential.panelHeightMeters;

    if (solarPanels && solarPanels.length > 0) {
      for (const panel of solarPanels) {
        const center = latLngToMeters(panel.center.latitude, panel.center.longitude, cLat, cLng);
        // パネルの4隅を追加してより正確な形状を得る
        const hw = (panel.orientation === "LANDSCAPE" ? panelH : panelW) / 2;
        const hh = (panel.orientation === "LANDSCAPE" ? panelW : panelH) / 2;
        const corners: Point[] = [
          { x: center.x - hw, y: center.y - hh },
          { x: center.x + hw, y: center.y - hh },
          { x: center.x + hw, y: center.y + hh },
          { x: center.x - hw, y: center.y + hh },
        ];
        const idx = panel.segmentIndex;
        if (!segmentPanelPoints.has(idx)) segmentPanelPoints.set(idx, []);
        segmentPanelPoints.get(idx)!.push(...corners);
      }
    }

    // セグメントごとにポリゴンを作成
    const segments: RoofSegment[] = roofSegmentStats.map((seg, i) => {
      const points = segmentPanelPoints.get(i);
      let polygon: Point[];

      if (points && points.length >= 3) {
        // パネル位置から凸包で屋根形状を推定
        polygon = convexHull(points);
      } else {
        // フォールバック: バウンディングボックスを使用
        const sw = latLngToMeters(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude, cLat, cLng);
        const ne = latLngToMeters(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude, cLat, cLng);
        polygon = [
          { x: sw.x, y: sw.y },
          { x: ne.x, y: sw.y },
          { x: ne.x, y: ne.y },
          { x: sw.x, y: ne.y },
        ];
      }

      return {
        polygon,
        azimuth: seg.azimuthDegrees,
        pitch: seg.pitchDegrees,
        areaM2: seg.stats.areaMeters2,
      };
    });

    // 全体の範囲を求める
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const seg of segments) {
      for (const p of seg.polygon) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    // マージン追加
    const margin = 1.0; // 1m
    minX -= margin; maxX += margin; minY -= margin; maxY += margin;

    const W = canvas.width;
    const H = canvas.height;
    const padding = 40;
    const scaleX = (W - padding * 2) / (maxX - minX || 1);
    const scaleY = (H - padding * 2) / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY);

    // 中央揃え
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

    // グリッド線（スケール感のため）
    ctx.strokeStyle = "#ffffff08";
    ctx.lineWidth = 0.5;
    const gridStep = 1; // 1m
    for (let gx = Math.ceil(minX); gx <= maxX; gx += gridStep) {
      const cp = toCanvas({ x: gx, y: minY });
      const cp2 = toCanvas({ x: gx, y: maxY });
      ctx.beginPath(); ctx.moveTo(cp.x, cp.y); ctx.lineTo(cp2.x, cp2.y); ctx.stroke();
    }
    for (let gy = Math.ceil(minY); gy <= maxY; gy += gridStep) {
      const cp = toCanvas({ x: minX, y: gy });
      const cp2 = toCanvas({ x: maxX, y: gy });
      ctx.beginPath(); ctx.moveTo(cp.x, cp.y); ctx.lineTo(cp2.x, cp2.y); ctx.stroke();
    }

    // セグメントをポリゴンで描画
    for (const seg of segments) {
      const color = azimuthColor(seg.azimuth);
      const canvasPoly = seg.polygon.map(toCanvas);

      // 塗りつぶし
      ctx.beginPath();
      ctx.moveTo(canvasPoly[0].x, canvasPoly[0].y);
      for (let i = 1; i < canvasPoly.length; i++) {
        ctx.lineTo(canvasPoly[i].x, canvasPoly[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = color + "20";
      ctx.fill();

      // 枠線
      ctx.strokeStyle = color + "aa";
      ctx.lineWidth = 2;
      ctx.stroke();

      // ラベル（重心に表示）
      const cx = canvasPoly.reduce((s, p) => s + p.x, 0) / canvasPoly.length;
      const cy = canvasPoly.reduce((s, p) => s + p.y, 0) / canvasPoly.length;
      ctx.fillStyle = color + "dd";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      const label = `${azimuthLabel(seg.azimuth)} ${seg.pitch.toFixed(0)}°`;
      ctx.fillText(label, cx, cy - 3);
      ctx.font = "9px sans-serif";
      ctx.fillStyle = color + "99";
      ctx.fillText(`${seg.areaM2.toFixed(1)}m²`, cx, cy + 10);
      ctx.textAlign = "start";
    }

    // 各社パネルをセグメント内に敷き詰め
    const pW = company.panelWidthM;
    const pH = company.panelHeightM;
    const gap = 0.05;

    let totalCount = 0;
    const details: { dir: string; count: number; color: string }[] = [];

    for (const seg of segments) {
      const shrunk = shrinkPolygon(seg.polygon, 0.15); // 15cm内側にオフセット
      const color = azimuthColor(seg.azimuth);

      // セグメントのバウンディングボックス
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
          // パネルの4隅がすべてポリゴン内にあるか
          const corners: Point[] = [
            { x: mx, y: my },
            { x: mx + pW, y: my },
            { x: mx + pW, y: my + pH },
            { x: mx, y: my + pH },
          ];
          if (!corners.every((c) => pointInPolygon(c, shrunk))) continue;

          const tl = toCanvas({ x: mx, y: my });
          const br = toCanvas({ x: mx + pW, y: my + pH });

          // パネル本体
          ctx.fillStyle = company.color + "bb";
          ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
          ctx.strokeStyle = company.color;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

          // パネル内の線（セルっぽく）
          const pw = br.x - tl.x;
          const ph = br.y - tl.y;
          ctx.strokeStyle = company.color + "40";
          ctx.lineWidth = 0.3;
          const midX = tl.x + pw / 2;
          ctx.beginPath(); ctx.moveTo(midX, tl.y); ctx.lineTo(midX, br.y); ctx.stroke();

          segCount++;
        }
      }

      if (segCount > 0) {
        details.push({
          dir: `${azimuthLabel(seg.azimuth)}${seg.pitch.toFixed(0)}°`,
          count: segCount,
          color,
        });
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

  }, [insights, company]);

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
        <canvas ref={canvasRef} width={800} height={500} className="w-full h-auto" />

        {/* パネル情報オーバーレイ */}
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
                  <span style={{ color: d.color }}>{d.dir}</span>
                  <span>{d.count}枚</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        ※ Google Solar APIのパネル配置データから屋根形状を推定（凸包）。各社パネルサイズで再配置した参考シミュレーションです。
      </p>
    </div>
  );
}
