import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const tileUrl = searchParams.get("tileUrl"); // proxy mode

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  // Proxy mode: fetch GeoTIFF and return as binary
  if (tileUrl) {
    const url = `${tileUrl}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: "fetch failed" }, { status: 502 });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/tiff",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const url =
    `https://solar.googleapis.com/v1/dataLayers:get` +
    `?location.latitude=${lat}&location.longitude=${lng}` +
    `&radiusMeters=50&view=ANNUAL_FLUX&requiredQuality=LOW&key=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `DataLayers API error: ${res.status}`, detail: body }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
