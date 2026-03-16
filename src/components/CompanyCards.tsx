"use client";

import { useState } from "react";
import { BuildingInsights } from "@/types/solar";
import { COMPANIES } from "@/lib/companies";

// 損失係数 (温度損失 + PCS変換 + 配線 + 汚れ影など)
const PERFORMANCE_RATIO = 0.8;
const LOSS_BREAKDOWN = [
  { label: "温度損失", value: "−5%" },
  { label: "PCS変換損失", value: "−3%" },
  { label: "配線損失", value: "−2%" },
  { label: "汚れ・影など", value: "−10%" },
];

const FAMILY_RANGES = [
  { label: "1〜2人", minKw: 2, maxKw: 3 },
  { label: "3〜4人", minKw: 3, maxKw: 5 },
  { label: "5人以上", minKw: 5, maxKw: 10 },
];

interface Props {
  insights: BuildingInsights;
}

export default function CompanyCards({ insights }: Props) {
  const [familyIndex, setFamilyIndex] = useState<number | null>(null);
  const [showLossDetail, setShowLossDetail] = useState(false);

  const { solarPotential } = insights;
  const roofAreaM2 = solarPotential.maxArrayAreaMeters2;

  // 1. 方位・傾斜補正済みの比発電量を算出
  //    Solar API の各パネル yearlyEnergyDcKwh を合算し、設置容量で割る
  const totalDcKwh = solarPotential.solarPanels.reduce(
    (sum, p) => sum + p.yearlyEnergyDcKwh,
    0
  );
  const defaultCapacityKw =
    (solarPotential.solarPanels.length * solarPotential.panelCapacityWatts) / 1000;
  // kWh/kW/年（方位・傾斜込み）
  const specificYield =
    defaultCapacityKw > 0
      ? totalDcKwh / defaultCapacityKw
      : solarPotential.maxSunshineHoursPerYear;

  const selectedRange = familyIndex !== null ? FAMILY_RANGES[familyIndex] : null;

  const results = COMPANIES.map((company) => {
    const panelArea = company.panelWidthM * company.panelHeightM;
    const count = Math.floor((roofAreaM2 * 0.85) / panelArea);
    const totalKw = (count * company.panelWatts) / 1000;
    // 2. 損失係数 0.8 を適用
    const annualKwh = totalKw * specificYield * PERFORMANCE_RATIO;
    // 3. 家族人数に合うか判定
    const isRecommended = selectedRange
      ? totalKw >= selectedRange.minKw && totalKw <= selectedRange.maxKw
      : false;
    return { company, count, totalKw, annualKwh, isRecommended };
  }).sort((a, b) => b.count - a.count);

  const maxCount = results[0]?.count ?? 1;

  return (
    <div className="space-y-4">
      {/* 家族人数セレクター */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500 font-medium">家族人数：</span>
        {FAMILY_RANGES.map((range, i) => (
          <button
            key={i}
            onClick={() => setFamilyIndex(familyIndex === i ? null : i)}
            className="px-3 py-1 rounded-full text-sm border transition-all"
            style={
              familyIndex === i
                ? { backgroundColor: "#059669", color: "#fff", borderColor: "#059669" }
                : { backgroundColor: "transparent", color: "#6b7280", borderColor: "#d1d5db" }
            }
          >
            {range.label}
          </button>
        ))}
        {familyIndex !== null && (
          <span className="text-xs text-emerald-600 font-medium">
            推奨容量 {FAMILY_RANGES[familyIndex].minKw}〜{FAMILY_RANGES[familyIndex].maxKw} kW
          </span>
        )}
      </div>

      {/* データ概要 + 損失係数 */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <div>
          有効面積：<span className="font-semibold text-gray-800">{roofAreaM2.toFixed(1)} m²</span>
          　比発電量：<span className="font-semibold text-gray-800">{specificYield.toFixed(0)} kWh/kW/年</span>
          <span className="text-xs text-emerald-600 ml-1">（方位・傾斜補正済み）</span>
        </div>
        <button
          onClick={() => setShowLossDetail(!showLossDetail)}
          className="text-xs text-gray-400 underline"
        >
          損失係数 {PERFORMANCE_RATIO} の内訳
        </button>
      </div>

      {showLossDetail && (
        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 flex flex-wrap gap-3 border border-gray-100">
          {LOSS_BREAKDOWN.map((item) => (
            <span key={item.label}>
              {item.label}：<span className="font-semibold text-red-500">{item.value}</span>
            </span>
          ))}
          <span>
            →&nbsp;総合：<span className="font-semibold text-gray-800">×{PERFORMANCE_RATIO}</span>
          </span>
        </div>
      )}

      {/* カード一覧 */}
      {results.map(({ company, count, totalKw, annualKwh, isRecommended }, i) => (
        <div
          key={company.id}
          className="rounded-xl border p-4 transition-shadow hover:shadow-md relative"
          style={{ borderColor: company.color + "40", backgroundColor: company.bgColor }}
        >
          {/* バッジ */}
          <div className="flex gap-1.5 mb-1.5 flex-wrap">
            {i === 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: company.color }}>
                最多
              </span>
            )}
            {isRecommended && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white bg-emerald-500">
                おすすめ
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800">{company.name}</span>
                <span className="text-xs text-gray-400">{company.nameEn}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{company.modelName}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-3xl font-black" style={{ color: company.color }}>{count}</div>
              <div className="text-xs text-gray-500">枚</div>
            </div>
          </div>

          <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: company.color }}
            />
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span>
              合計出力：<span className="font-semibold" style={{ color: company.color }}>{totalKw.toFixed(1)} kW</span>
            </span>
            <span>
              年間発電：<span className="font-semibold" style={{ color: company.color }}>{(annualKwh / 1000).toFixed(1)} MWh</span>
            </span>
            <span>
              パネル：<span className="font-semibold">
                {(company.panelWidthM * 1000).toFixed(0)} × {(company.panelHeightM * 1000).toFixed(0)} mm / {company.panelWatts} W
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
