import ClientPage from "@/components/ClientPage";

export default function Home() {
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  return <ClientPage mapsApiKey={mapsApiKey} />;
}
