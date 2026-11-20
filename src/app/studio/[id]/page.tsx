import type { Metadata } from "next";
import { StudioRoute } from "@/components/studio/studio-route";
import { guestStudio } from "@/lib/foundry/studio-source";

export const metadata: Metadata = { title: "Studio | Glyph" };

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudioRoute key={id} id={id} guest={guestStudio(id)} />;
}
