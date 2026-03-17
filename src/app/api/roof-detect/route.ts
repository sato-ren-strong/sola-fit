import { NextRequest, NextResponse } from "next/server";

// Edge Runtime互換のbase64エンコード
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function POST(req: NextRequest) {
  const xaiKey = process.env.XAI_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!xaiKey || !mapsKey) {
    return NextResponse.json(
      { error: "API keys not configured", detail: `xai=${!!xaiKey}, maps=${!!mapsKey}` },
      { status: 500 }
    );
  }

  const { lat, lng, zoom = 21 } = await req.json();
  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  // 1. Google Maps Static APIで衛星画像を取得
  const size = 640;
  const staticMapUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${lat},${lng}&zoom=${zoom}&size=${size}x${size}` +
    `&maptype=satellite&key=${mapsKey}`;

  let imgBase64: string;
  try {
    const imgRes = await fetch(staticMapUrl);
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch satellite image", detail: `status=${imgRes.status}` },
        { status: 502 }
      );
    }
    const imgBuffer = await imgRes.arrayBuffer();
    imgBase64 = arrayBufferToBase64(imgBuffer);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to fetch satellite image", detail: String(e) },
      { status: 502 }
    );
  }

  // 2. Grok Imagine APIで屋根の線を引いた画像を生成
  try {
    const grokRes = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${xaiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt: "この衛星写真の画像中央にある1棟の建物の屋根のみに、明るい黄色の線で輪郭を描いてください。屋根の稜線（棟線・谷線）も黄色い線で描いてください。中央の建物以外（隣の家・地面・駐車場など）には絶対に線を引かないでください。元の衛星写真はそのまま残し、線だけを追加してください。",
        image: {
          url: `data:image/png;base64,${imgBase64}`,
          type: "image_url",
        },
      }),
    });

    if (!grokRes.ok) {
      const errText = await grokRes.text();
      return NextResponse.json(
        { error: "Grok Imagine API error", detail: `${grokRes.status}: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const grokData = await grokRes.json();

    // レスポンスから生成画像URLまたはbase64を取得
    const outputUrl = grokData.data?.[0]?.url ?? grokData.data?.[0]?.b64_json;

    if (!outputUrl) {
      return NextResponse.json(
        { error: "No image in Grok response", detail: JSON.stringify(grokData).slice(0, 300) },
        { status: 502 }
      );
    }

    // URLの場合はfetchしてbase64に変換
    let annotatedBase64: string;
    if (outputUrl.startsWith("http")) {
      const imgFetch = await fetch(outputUrl);
      const buf = await imgFetch.arrayBuffer();
      annotatedBase64 = `data:image/png;base64,${arrayBufferToBase64(buf)}`;
    } else {
      annotatedBase64 = `data:image/png;base64,${outputUrl}`;
    }

    // メートル/ピクセル計算
    const metersPerPixel =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

    return NextResponse.json({
      annotatedImage: annotatedBase64,
      originalImage: `data:image/png;base64,${imgBase64}`,
      metersPerPixel,
      imageSize: size,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Grok request failed", detail: String(e) },
      { status: 502 }
    );
  }
}
