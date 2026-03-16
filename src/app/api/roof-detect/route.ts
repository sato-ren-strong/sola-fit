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
  const geminiKey = process.env.GEMINI_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!geminiKey || !mapsKey) {
    return NextResponse.json(
      { error: "API keys not configured", detail: `gemini=${!!geminiKey}, maps=${!!mapsKey}` },
      { status: 500 }
    );
  }

  const { lat, lng, zoom = 20, roofHint } = await req.json();
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

  // 3. Gemini APIで屋根形状を検出
  void roofHint; // Solar APIヒントは現在未使用（画像優先）

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
- 屋根面の境界線（稜線）を画像から丁寧にトレースしてください`;

  const responseSchema = {
    type: "OBJECT" as const,
    properties: {
      building_angle: { type: "NUMBER" as const },
      faces: {
        type: "ARRAY" as const,
        items: {
          type: "OBJECT" as const,
          properties: {
            id: { type: "STRING" as const },
            points: {
              type: "ARRAY" as const,
              items: {
                type: "ARRAY" as const,
                items: { type: "NUMBER" as const },
              },
            },
            slope_direction: { type: "NUMBER" as const },
            ridge_edge: {
              type: "ARRAY" as const,
              items: { type: "NUMBER" as const },
            },
            eave_edge: {
              type: "ARRAY" as const,
              items: { type: "NUMBER" as const },
            },
          },
          required: ["id", "points", "slope_direction"],
        },
      },
    },
    required: ["building_angle", "faces"],
  };

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

  const geminiBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: "image/png",
              data: imgBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

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
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json(
        { error: "Gemini API error", detail: `${geminiRes.status}: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "Empty Gemini response", detail: `finishReason=${geminiData.candidates?.[0]?.finishReason}` },
        { status: 502 }
      );
    }

    roofData = JSON.parse(text);
  } catch (e) {
    return NextResponse.json(
      { error: "Gemini request failed", detail: String(e) },
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
