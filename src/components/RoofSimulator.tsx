"use client";

import { useState, useCallback, useEffect } from "react";
import { BuildingInsights } from "@/types/solar";
import { COMPANIES } from "@/lib/companies";

interface Props {
  insights: BuildingInsights;
}

interface RoofDetectResult {
  annotatedImage: string;
  originalImage: string;
  metersPerPixel: number;
  imageSize: number;
}

export default function RoofSimulator({ insights }: Props) {
  const [selectedId, setSelectedId] = useState(COMPANIES[0].id);
  const [roofResult, setRoofResult] = useState<RoofDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const company = COMPANIES.find((c) => c.id === selectedId)!;

  // Solar APIデータからパネル枚数を計算
  const totalRoofArea = insights.solarPotential.roofSegmentStats.reduce(
    (s, seg) => s + seg.stats.groundAreaMeters2, 0
  );
  const usableArea = totalRoofArea * 0.85;
  const panelArea = company.panelWidthM * company.panelHeightM;
  const panelCount = Math.floor(usableArea / panelArea);
  const totalKw = (panelCount * company.panelWatts) / 1000;

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

      {/* 屋根画像 */}
      <div className="bg-slate-900 rounded-xl overflow-hidden relative">
        {detecting && (
          <div className="aspect-square max-h-[500px] flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full border-4 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <p className="text-white/70 text-sm mt-3">Grok が屋根の線を描画中...</p>
          </div>
        )}

        {error && (
          <div className="aspect-square max-h-[500px] flex flex-col items-center justify-center gap-3 px-6">
            <p className="text-red-400 text-sm text-center break-all">{error}</p>
            <button
              onClick={detectRoof}
              className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors text-white"
            >
              再試行
            </button>
          </div>
        )}

        {roofResult && !detecting && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={showOriginal ? roofResult.originalImage : roofResult.annotatedImage}
              alt="屋根解析結果"
              className="w-full h-auto"
            />
            {/* 切り替えボタン */}
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              className="absolute top-3 left-3 bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-black/90 transition-colors"
            >
              {showOriginal ? "線あり" : "元画像"}
            </button>
          </>
        )}

        {/* パネル情報オーバーレイ */}
        {roofResult && !detecting && (
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
            <div className="border-t border-white/10 pt-1.5 mt-1.5 text-white/40">
              <div>有効屋根面積: {usableArea.toFixed(1)}m²</div>
              <div>総屋根面積: {totalRoofArea.toFixed(1)}m²</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          ※ Grok AIが衛星写真に屋根の輪郭線を描画。枚数はSolar APIの屋根面積から算出した参考値です。
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
