"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { BuildingInsights } from "@/types/solar";

const SolarMap = dynamic(() => import("@/components/SolarMap"), { ssr: false });
const CompanyCards = dynamic(() => import("@/components/CompanyCards"), { ssr: false });
const RoofSimulator = dynamic(() => import("@/components/RoofSimulator"), { ssr: false });

type Status = "idle" | "locating" | "fetching" | "done" | "error";

interface Props {
  mapsApiKey: string;
}

export default function ClientPage({ mapsApiKey }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [insights, setInsights] = useState<BuildingInsights | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const addressRef = useRef<HTMLInputElement>(null);

  const fetchSolar = useCallback(async (lat: number, lng: number) => {
    setStatus("fetching");
    const res = await fetch(`/api/solar?lat=${lat}&lng=${lng}`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<BuildingInsights>;
  }, []);

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
        try {
          const data = await fetchSolar(pos.coords.latitude, pos.coords.longitude);
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
  }, [fetchSolar]);

  const handleAddressSearch = useCallback(async () => {
    const address = addressRef.current?.value.trim();
    if (!address) return;

    setStatus("locating");
    setInsights(null);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "住所が見つかりませんでした");
      }
      const { lat, lng } = await res.json();
      const data = await fetchSolar(lat, lng);
      setInsights(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "不明なエラー");
      setStatus("error");
    }
  }, [fetchSolar]);

  const reset = useCallback(() => {
    setStatus("idle");
    setInsights(null);
    setErrorMsg("");
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white">
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
        {status === "idle" && (
          <div className="text-center py-12 space-y-8">
            <div className="space-y-2">
              <h2 className="text-4xl font-black tracking-tight">
                あなたの屋根に
                <br />
                <span className="text-emerald-400">何枚貼れる？</span>
              </h2>
              <p className="text-white/60 text-lg">
                位置情報または住所から、各社の太陽光パネル設置枚数をシミュレーション
              </p>
            </div>

            {/* Address input */}
            <div className="max-w-lg mx-auto space-y-3">
              <div className="flex gap-2">
                <input
                  ref={addressRef}
                  type="text"
                  placeholder="住所を入力（例：東京都渋谷区1-1-1）"
                  onKeyDown={(e) => e.key === "Enter" && handleAddressSearch()}
                  className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 focus:bg-white/15 transition-all text-sm"
                />
                <button
                  onClick={handleAddressSearch}
                  className="bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold px-5 py-3 rounded-xl shadow-lg shadow-emerald-500/30 transition-all text-sm whitespace-nowrap"
                >
                  検索
                </button>
              </div>

              <div className="flex items-center gap-3 text-white/30 text-xs">
                <div className="flex-1 h-px bg-white/10" />
                または
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <button
                onClick={handleLocate}
                className="w-full inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-semibold text-sm px-6 py-3 rounded-xl border border-white/20 transition-all"
              >
                <span>📍</span>
                現在地を自動取得
              </button>
            </div>

            <p className="text-white/30 text-xs">
              Google Solar API を使用。位置情報はサーバーに保存されません。
            </p>
          </div>
        )}

        {(status === "locating" || status === "fetching") && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <p className="text-white/70 font-medium">
              {status === "locating" ? "📍 住所を検索中..." : "☀ 屋根を解析中..."}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
            <p className="text-red-400 font-semibold">エラーが発生しました</p>
            <p className="text-white/60 text-sm">{errorMsg}</p>
            <button onClick={reset} className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors">
              もう一度試す
            </button>
          </div>
        )}

        {status === "done" && insights && (
          <>
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
                  {insights.imageryDate.year}/{insights.imageryDate.month}/{insights.imageryDate.day}
                </div>
              </div>
              <div className="ml-auto">
                <button onClick={reset} className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors">
                  再取得
                </button>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-xl">
              <div className="bg-white/5 px-4 py-2.5 border-b border-white/10 text-xs text-white/50 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                衛星写真 — 緑色がパネル設置候補エリア
              </div>
              <SolarMap insights={insights} apiKey={mapsApiKey} />
            </div>

            {/* Roof simulator */}
            <div>
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <span className="text-emerald-400">🏠</span>
                屋根シミュレーター
              </h3>
              <div className="bg-slate-800 border border-white/10 rounded-2xl p-5 shadow-xl">
                <RoofSimulator insights={insights} />
              </div>
            </div>

            {/* Company cards */}
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
