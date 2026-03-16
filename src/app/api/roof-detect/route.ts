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

  const { lat, lng, zoom = 21 } = await req.json();
  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  // 1. Google Maps Static APIで衛星画像を取得
  const size = 400;
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

  // 2. Gemini APIで屋根形状を検出
  const prompt = `以下の衛星写真の建物屋根を解析し、太陽光パネル設置図面用のデータをJSON形式のみで返してください。

【検出してほしい情報】
1. 屋根各面の輪郭ポリゴン（ピクセル座標、画像サイズは${size}x${size}px）
2. 各面の勾配方向（雨水が流れる方向を0-360度で、北=0）
3. 棟・軒の識別（どの辺が棟でどの辺が軒か）
4. 建物全体の主軸角度（度）

【注意】
- ridge_edge/eave_edgeはpointsの辺インデックス（0=points[0]-points[1]の辺）
- 隣接する面は頂点を共有すること
- 各面は4〜6頂点以内でシンプルに
- 最大6面まで
- 返答はJSONのみ。説明文不要`;

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
            area_m2: { type: "NUMBER" as const },
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
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  interface RoofFace {
    id: string;
    points: number[][];
    slope_direction: number;
    ridge_edge?: number[];
    eave_edge?: number[];
    area_m2?: number;
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

  // 3. ピクセル座標をメートル座標に変換
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

  const centerPx = size / 2;

  const faces = roofData.faces.map((face) => ({
    id: face.id,
    points: face.points.map((p) => ({
      x: (p[0] - centerPx) * metersPerPixel,
      y: (p[1] - centerPx) * metersPerPixel,
    })),
    slope_direction: face.slope_direction,
    ridge_edge: face.ridge_edge,
    eave_edge: face.eave_edge,
    area_m2: face.area_m2,
  }));

  return NextResponse.json({
    building_angle: roofData.building_angle,
    faces,
    metersPerPixel,
    imageSize: size,
  });
}
