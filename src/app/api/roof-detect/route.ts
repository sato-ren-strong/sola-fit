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

  const { lat, lng, zoom = 20 } = await req.json();
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

  // 2. メートル/ピクセル計算
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const imageWidthM = (size * metersPerPixel).toFixed(1);

  // 3. Grok Vision APIで屋根形状を検出
  const prompt = `この衛星写真（${size}x${size}px、実寸約${imageWidthM}m四方）の中央にある建物の屋根を解析してください。

【タスク】
太陽光パネル設置図面のため、屋根の各面をポリゴンで検出してください。

【検出ルール】
1. 画像中央の建物の屋根のみを対象とする（隣接建物・影・地面を含めない）
2. 屋根の稜線（棟線・谷線）で面を分割し、各傾斜面を別ポリゴンで返す
3. 座標はピクセル座標（左上原点、右X+、下Y+）
4. 各ポリゴンは4〜8頂点（実際の形状に忠実に、シンプル化しすぎない）
5. 隣接面は頂点を共有させる
6. slope_directionは雨水が流れ落ちる方向（北=0、東=90、南=180、西=270）
7. 画像を注意深く観察し、屋根の色の濃淡・影の方向から各面の傾斜方向を判断すること

【重要：画像を優先すること】
- 事前情報より画像に写っている実際の形状を優先してください
- この建物は複合屋根（寄棟＋切妻の組み合わせ）の可能性があります
- 屋根面の境界線（稜線）を画像から丁寧にトレースしてください

以下のJSON形式のみで返してください。説明文は不要です。
{
  "building_angle": 数値,
  "faces": [
    {
      "id": "face_1",
      "points": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]],
      "slope_direction": 数値,
      "ridge_edge": [辺インデックス],
      "eave_edge": [辺インデックス]
    }
  ]
}`;

  interface RoofFace {
    id: string;
    points: number[][];
    slope_direction: number;
    ridge_edge?: number[];
    eave_edge?: number[];
  }
  interface RoofData {
    building_angle: number;
    faces: RoofFace[];
  }

  let roofData: RoofData;

  try {
    const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${xaiKey}`,
      },
      body: JSON.stringify({
        model: "grok-2-vision-1212",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${imgBase64}`,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 16384,
      }),
    });

    if (!grokRes.ok) {
      const errText = await grokRes.text();
      return NextResponse.json(
        { error: "Grok API error", detail: `${grokRes.status}: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const grokData = await grokRes.json();
    const text = grokData.choices?.[0]?.message?.content ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "Empty Grok response", detail: `finish_reason=${grokData.choices?.[0]?.finish_reason}` },
        { status: 502 }
      );
    }

    // JSONを抽出（```json ... ``` で囲まれている場合に対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "No JSON in Grok response", detail: text.slice(0, 300) },
        { status: 502 }
      );
    }

    roofData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return NextResponse.json(
      { error: "Grok request failed", detail: String(e) },
      { status: 502 }
    );
  }

  if (!roofData.faces || roofData.faces.length === 0) {
    return NextResponse.json(
      { error: "No roof faces detected" },
      { status: 502 }
    );
  }

  // 4. ピクセル座標をメートル座標に変換
  const centerPx = size / 2;

  const faces = roofData.faces.map((face) => {
    const meterPoints = face.points.map((p) => ({
      x: (p[0] - centerPx) * metersPerPixel,
      y: (p[1] - centerPx) * metersPerPixel,
    }));

    // ポリゴン面積を計算 (Shoelace formula)
    let area = 0;
    for (let i = 0; i < meterPoints.length; i++) {
      const j = (i + 1) % meterPoints.length;
      area += meterPoints[i].x * meterPoints[j].y;
      area -= meterPoints[j].x * meterPoints[i].y;
    }
    area = Math.abs(area) / 2;

    return {
      id: face.id,
      points: meterPoints,
      slope_direction: face.slope_direction,
      ridge_edge: face.ridge_edge,
      eave_edge: face.eave_edge,
      area_m2: area,
    };
  });

  return NextResponse.json({
    building_angle: roofData.building_angle,
    faces,
    metersPerPixel,
    imageSize: size,
  });
}
