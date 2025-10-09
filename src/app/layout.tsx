// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Image from "next/image";
import { Analytics } from "@vercel/analytics/react";
import SwClient from "./components/sw-registrar";
import ChatbotWidget from "./components/ChatbotWidget"; // ⬅️ Chatbot

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
  themeColor: "#0b0f19",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-svh bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
          <div className="mx-auto max-w-5xl px-6">
            <div className="flex h-16 items-center justify-between">
              {/* Izquierda: MotorsWraps */}
              <div className="flex h-full items-center gap-3">
                <Image
                  src="/LogoMW.png"
                  alt="MotorsWraps"
                  width={40}
                  height={60}
                  priority
                  className="h-full w-auto rounded-md object-contain"
                />
                <span className="text-base md:text-lg font-semibold">MotorsWraps</span>
              </div>

              {/* Derecha: FixItBot */}
              <Image
                src="/LogoFixitbot.png"
                alt="FixItBot"
                width={200}
                height={60}
                priority
                className="h-12 w-auto"
              />
            </div>
          </div>
        </header>

        {children}

        <footer className="mx-auto max-w-2xl px-6 pb-8 pt-6 text-xs opacity-60">
          © {new Date().getFullYear()} FixItBot • By MotorsWraps
        </footer>

        {/* Widgets cliente */}
        <Analytics />
        <SwClient />
        <ChatbotWidget /> {/* ⬅️ Bot flotante en la esquina */}
      </body>
    </html>
  );
}
