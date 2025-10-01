// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/react";
import SwClient from "./components/sw-registrar";

export const metadata: Metadata = {
  title: "FixItBot",
  description: "Análisis de daños, cotización aproximada y guías DIY",
  manifest: "/manifest.webmanifest",
  themeColor: "#0b0f19",
  icons: [
    { rel: "icon", url: "/icon-192.png" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-svh bg-zinc-950 text-zinc-100">
        <header className="border-b border-white/10 backdrop-blur supports-[backdrop-filter]:bg-white/5">
          <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400">
                FixItBot
              </span>
            </Link>
            <div className="text-xs md:text-sm opacity-70">
              Visión por computadora • Cotización rápida
            </div>
          </div>
        </header>

        {children}

        <footer className="mx-auto max-w-4xl px-6 pb-8 pt-6 text-xs opacity-60">
          © {new Date().getFullYear()} FixItBot • By MotorsWraps
        </footer>

        <Analytics />
        <SwClient />
      </body>
    </html>
  );
}
