import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&language=ja&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.[0]) {
    return NextResponse.json({ error: "住所が見つかりませんでした" }, { status: 404 });
  }

  const { lat, lng } = data.results[0].geometry.location;
  const formattedAddress = data.results[0].formatted_address;
  return NextResponse.json({ lat, lng, formattedAddress });
}
