import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./globals.css";

export const metadata: Metadata = { title: "Glyph — Collaborative Type Foundry", description: "A shared type and vector foundry for humans and AI." };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
