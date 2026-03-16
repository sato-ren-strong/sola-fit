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
  const prompt = `この衛星写真の中央にある建物の屋根の形状を検出してください。
屋根の各面（セグメント）をポリゴンとして返してください。
座標は画像のピクセル座標（画像サイズは${size}x${size}ピクセル）で返してください。
各セグメントに推定される方位を含めてください。`;

  const responseSchema = {
    type: "OBJECT" as const,
    properties: {
      segments: {
        type: "ARRAY" as const,
        items: {
          type: "OBJECT" as const,
          properties: {
            points: {
              type: "ARRAY" as const,
              items: {
                type: "OBJECT" as const,
                properties: {
                  x: { type: "NUMBER" as const },
                  y: { type: "NUMBER" as const },
                },
                required: ["x", "y"],
              },
            },
            direction: {
              type: "STRING" as const,
              enum: ["north", "south", "east", "west", "southeast", "southwest", "northeast", "northwest"],
            },
            label: { type: "STRING" as const },
          },
          required: ["points", "direction", "label"],
        },
      },
      building_center: {
        type: "OBJECT" as const,
        properties: {
          x: { type: "NUMBER" as const },
          y: { type: "NUMBER" as const },
        },
        required: ["x", "y"],
      },
    },
    required: ["segments", "building_center"],
  };

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;

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
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  interface RoofPoint { x: number; y: number }
  interface RoofSegment { points: RoofPoint[]; direction: string; label: string }
  interface RoofData { segments: RoofSegment[]; building_center: RoofPoint }

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

  if (!roofData.segments || roofData.segments.length === 0) {
    return NextResponse.json(
      { error: "No roof segments detected" },
      { status: 502 }
    );
  }

  // 3. ピクセル座標をメートル座標に変換
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

  const centerPx = roofData.building_center ?? { x: size / 2, y: size / 2 };

  const segments = roofData.segments.map((seg) => ({
    points: seg.points.map((p) => ({
      x: (p.x - centerPx.x) * metersPerPixel,
      y: (p.y - centerPx.y) * metersPerPixel,
    })),
    direction: seg.direction,
    label: seg.label,
  }));

  return NextResponse.json({
    segments,
    metersPerPixel,
    imageSize: size,
  });
}
