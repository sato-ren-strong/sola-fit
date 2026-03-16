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

以下のルールに従ってください：
- 屋根の各面（セグメント）をポリゴンとして返してください
- 座標は画像のピクセル座標で返してください（画像サイズは${size}x${size}ピクセル）
- 各セグメントに推定される方位（north/south/east/west）を含めてください
- JSONのみ返してください。説明文は不要です

以下のJSON形式で返してください：
{
  "segments": [
    {
      "points": [{"x": 100, "y": 100}, {"x": 200, "y": 100}, {"x": 200, "y": 200}, {"x": 100, "y": 200}],
      "direction": "south",
      "label": "南面"
    }
  ],
  "building_center": {"x": 320, "y": 320}
}`;

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!geminiRes.ok) {
    const body = await geminiRes.text();
    return NextResponse.json(
      { error: `Gemini API error: ${geminiRes.status}`, detail: body },
      { status: 502 }
    );
  }

  const geminiData = await geminiRes.json();
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // JSONを抽出（```json ... ``` で囲まれている場合に対応）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: "Failed to parse Gemini response", raw: text },
      { status: 502 }
    );
  }

  let roofData;
  try {
    roofData = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON from Gemini", raw: text },
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
