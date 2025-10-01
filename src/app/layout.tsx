// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Image from "next/image";
import { Analytics } from "@vercel/analytics/react";
import SwClient from "./components/sw-registrar"; // ajusta si tu ruta es distinta

export const metadata: Metadata = {
  title: "FixItBot",
  description: "Análisis de daños, cotización aproximada y guías DIY",
  manifest: "/manifest.webmanifest",
  icons: [
    { rel: "icon", url: "/icon-192.png" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
  ],
};
export const viewport: Viewport = {
  // una sola
  themeColor: "#0b0f19",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-svh bg-zinc-950 text-zinc-100">
        {/* Header sin leyenda */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
          <div className="mx-auto max-w-5xl px-6">
            <div className="flex items-center justify-between py-3">
              {/* Izquierda: MotorsWraps (logo 1cm x 1cm) */}
              <div className="flex items-center gap-3">
                <Image
                  src="/LogoMW.png"
                  alt="MotorsWraps"
                  width={40}
                  height={40}
                  priority
                  style={{ width: "3cm", height: "3cm" }}
                  className="rounded-md object-contain"
                />
                <span className="text-base md:text-lg font-semibold">MotorsWraps</span>
              </div>

              {/* Derecha: FixItBot (más legible) */}
              <Image
                src="/LogoFixitbot.png"
                alt="FixItBot"
                width={200}
                height={60}
                priority
                className="h-22 w-auto"  // ~48px de alto; ajusta a h-14 si lo quieres aún mayor
              />
            </div>
          </div>
        </header>

        {children}

        <footer className="mx-auto max-w-2xl px-6 pb-8 pt-6 text-xs opacity-60">
          © {new Date().getFullYear()} FixItBot • By MotorsWraps
        </footer>

        <Analytics />
        <SwClient />
      </body>
    </html>
  );
}
