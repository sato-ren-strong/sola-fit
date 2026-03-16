"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { BuildingInsights } from "@/types/solar";

const SolarMap = dynamic(() => import("@/components/SolarMap"), { ssr: false });
const CompanyCards = dynamic(() => import("@/components/CompanyCards"), { ssr: false });

type Status = "idle" | "locating" | "fetching" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [insights, setInsights] = useState<BuildingInsights | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg("このブラウザは位置情報をサポートしていません");
      setStatus("error");
      return;
    }

    setStatus("locating");
    setInsights(null);
    setErrorMsg("");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setStatus("fetching");

        try {
          const res = await fetch(`/api/solar?lat=${lat}&lng=${lng}`);
          if (!res.ok) {
            const body = await res.json();
            throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
          }
          const data: BuildingInsights = await res.json();
          setInsights(data);
          setStatus("done");
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : "不明なエラー");
          setStatus("error");
        }
      },
      (err) => {
        setErrorMsg(`位置情報の取得に失敗しました: ${err.message}`);
        setStatus("error");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-400/20 flex items-center justify-center text-emerald-400 text-lg">
            ☀
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight">SolaFit</h1>
            <p className="text-xs text-white/50">屋根の太陽光パネル設置シミュレーター</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Hero + Button */}
        {status === "idle" && (
          <div className="text-center py-16 space-y-6">
            <div className="space-y-2">
              <h2 className="text-4xl font-black tracking-tight">
                あなたの屋根に
                <br />
                <span className="text-emerald-400">何枚貼れる？</span>
              </h2>
              <p className="text-white/60 text-lg">
                位置情報を取得するだけで、各社の太陽光パネルの設置可能枚数をシミュレーション
              </p>
            </div>
            <button
              onClick={handleLocate}
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-lg shadow-emerald-500/30 transition-all"
            >
              <span className="text-xl">📍</span>
              現在地を取得して解析
            </button>
            <p className="text-white/30 text-sm">
              Google Solar API を使用。位置情報はサーバーに保存されません。
            </p>
          </div>
        )}

        {/* Loading states */}
        {(status === "locating" || status === "fetching") && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <p className="text-white/70 font-medium">
              {status === "locating" ? "📍 位置情報を取得中..." : "☀ 屋根を解析中..."}
            </p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
            <p className="text-red-400 font-semibold">エラーが発生しました</p>
            <p className="text-white/60 text-sm">{errorMsg}</p>
            <button
              onClick={() => setStatus("idle")}
              className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors"
            >
              もう一度試す
            </button>
          </div>
        )}

        {/* Results */}
        {status === "done" && insights && (
          <>
            {/* Summary Banner */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-wrap gap-6">
              <div>
                <div className="text-xs text-white/40 uppercase tracking-wider">解析場所</div>
                <div className="font-semibold text-sm mt-1">
                  {insights.administrativeArea}{" "}
                  <span className="text-white/50 text-xs">〒{insights.postalCode}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-white/40 uppercase tracking-wider">最大パネル枚数</div>
                <div className="font-black text-emerald-400 text-2xl mt-0.5">
                  {insights.solarPotential.maxArrayPanelsCount}
                  <span className="text-sm font-normal text-white/60 ml-1">枚 (API標準)</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-white/40 uppercase tracking-wider">年間日照時間</div>
                <div className="font-semibold mt-1">
                  {insights.solarPotential.maxSunshineHoursPerYear.toFixed(0)} h
                </div>
              </div>
              <div>
                <div className="text-xs text-white/40 uppercase tracking-wider">撮影日</div>
                <div className="font-semibold mt-1 text-sm">
                  {insights.imageryDate.year}/{insights.imageryDate.month}/
                  {insights.imageryDate.day}
                </div>
              </div>
              <div className="ml-auto">
                <button
                  onClick={() => {
                    setStatus("idle");
                    setInsights(null);
                  }}
                  className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors"
                >
                  再取得
                </button>
              </div>
            </div>

            {/* Map */}
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-xl">
              <div className="bg-white/5 px-4 py-2.5 border-b border-white/10 text-xs text-white/50 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                衛星写真 — 緑色がパネル設置候補エリア
              </div>
              <SolarMap insights={insights} apiKey={apiKey} />
            </div>

            {/* Company Comparison */}
            <div>
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <span className="text-emerald-400">⚡</span>
                メーカー別シミュレーション
              </h3>
              <div className="bg-white rounded-2xl p-5 shadow-xl">
                <CompanyCards insights={insights} />
              </div>
            </div>

            <p className="text-white/20 text-xs text-center pb-4">
              ※ 枚数はパネルサイズと有効面積（係数0.85）から算出した参考値です。実際の設置枚数は現地調査により異なります。
            </p>
          </>
        )}
      </div>
    </main>
  );
}
