import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/dm-sans";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./globals.css";

export const metadata: Metadata = { title: "Glyph — Collaborative Type Foundry", description: "A shared type and vector foundry for humans and AI." };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return <html lang="en"><body>{key
    ? <ClerkProvider publishableKey={key} signInUrl="/sign-in" signUpUrl="/sign-up">{children}</ClerkProvider>
    : children}</body></html>;
}
