import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!geminiKey || !mapsKey) {
    return NextResponse.json({ error: "API keys not configured" }, { status: 500 });
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

  const imgRes = await fetch(staticMapUrl);
  if (!imgRes.ok) {
    return NextResponse.json({ error: "Failed to fetch satellite image" }, { status: 502 });
  }

  const imgBuffer = await imgRes.arrayBuffer();
  const imgBase64 = Buffer.from(imgBuffer).toString("base64");

  // 2. Gemini APIで屋根形状を検出
  const prompt = `この衛星写真の中央にある建物の屋根の形状を検出してください。
屋根の各面（セグメント）をポリゴンとして返してください。
座標は画像のピクセル座標（画像サイズは${size}x${size}ピクセル）で返してください。
各セグメントに推定される方位を含めてください。`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      segments: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            points: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  x: { type: "NUMBER" },
                  y: { type: "NUMBER" },
                },
                required: ["x", "y"],
              },
            },
            direction: {
              type: "STRING",
              enum: ["north", "south", "east", "west", "southeast", "southwest", "northeast", "northwest"],
            },
            label: { type: "STRING" },
          },
          required: ["points", "direction", "label"],
        },
      },
      building_center: {
        type: "OBJECT",
        properties: {
          x: { type: "NUMBER" },
          y: { type: "NUMBER" },
        },
        required: ["x", "y"],
      },
    },
    required: ["segments", "building_center"],
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
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  // リトライ（最大2回）
  let roofData: { segments: { points: { x: number; y: number }[]; direction: string; label: string }[]; building_center: { x: number; y: number } } | null = null;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!geminiRes.ok) {
      lastError = `Gemini API error: ${geminiRes.status} - ${await geminiRes.text()}`;
      continue;
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    try {
      roofData = JSON.parse(text);
      break;
    } catch {
      lastError = `JSON parse failed: ${text.slice(0, 200)}`;
    }
  }

  if (!roofData || !roofData.segments) {
    return NextResponse.json(
      { error: "Failed to detect roof", detail: lastError },
      { status: 502 }
    );
  }

  // 3. ピクセル座標をメートル座標に変換
  // Google Maps Static APIのズームレベルから1ピクセルあたりのメートルを計算
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

  const centerPx = roofData.building_center ?? { x: size / 2, y: size / 2 };

  const segments = (roofData.segments ?? []).map(
    (seg: { points: { x: number; y: number }[]; direction: string; label: string }) => ({
      points: seg.points.map((p: { x: number; y: number }) => ({
        x: (p.x - centerPx.x) * metersPerPixel,
        y: (p.y - centerPx.y) * metersPerPixel,
      })),
      direction: seg.direction,
      label: seg.label,
    })
  );

  return NextResponse.json({
    segments,
    metersPerPixel,
    imageBase64: imgBase64,
    imageSize: size,
  });
}
