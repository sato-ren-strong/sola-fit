"use client";

import { BuildingInsights } from "@/types/solar";
import { COMPANIES } from "@/lib/companies";

interface Props {
  insights: BuildingInsights;
}

export default function CompanyCards({ insights }: Props) {
  const { solarPotential } = insights;
  const roofAreaM2 = solarPotential.maxArrayAreaMeters2;
  const maxSunshineH = solarPotential.maxSunshineHoursPerYear;

  const results = COMPANIES.map((company) => {
    const panelArea = company.panelWidthM * company.panelHeightM;
    const count = Math.floor((roofAreaM2 * 0.85) / panelArea);
    const totalKw = (count * company.panelWatts) / 1000;
    const annualKwh = totalKw * maxSunshineH * 0.75;
    return { company, count, totalKw, annualKwh };
  }).sort((a, b) => b.count - a.count);

  const maxCount = results[0]?.count ?? 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-500">
          屋根の有効面積:{" "}
          <span className="font-semibold text-gray-800">{roofAreaM2.toFixed(1)} m²</span>
        </div>
        <div className="text-sm text-gray-500">
          年間日照:{" "}
          <span className="font-semibold text-gray-800">{maxSunshineH.toFixed(0)} h</span>
        </div>
      </div>

      {results.map(({ company, count, totalKw, annualKwh }, i) => (
        <div
          key={company.id}
          className="rounded-xl border p-4 transition-shadow hover:shadow-md"
          style={{ borderColor: company.color + "40", backgroundColor: company.bgColor }}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              {i === 0 && (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full text-white mb-1 inline-block"
                  style={{ backgroundColor: company.color }}
                >
                  最多
                </span>
              )}
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

          <div className="flex gap-4 text-xs text-gray-500">
            <span>
              合計出力:{" "}
              <span className="font-semibold" style={{ color: company.color }}>
                {totalKw.toFixed(1)} kW
              </span>
            </span>
            <span>
              年間発電:{" "}
              <span className="font-semibold" style={{ color: company.color }}>
                {(annualKwh / 1000).toFixed(1)} MWh
              </span>
            </span>
            <span>
              パネル:{" "}
              <span className="font-semibold">
                {(company.panelWidthM * 1000).toFixed(0)} × {(company.panelHeightM * 1000).toFixed(0)} mm / {company.panelWatts} W
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
