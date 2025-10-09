// src/app/api/detector/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/* ========= Tipos ========= */
type Box = { x: number; y: number; w: number; h: number; cls: string; score?: number };
type RfPrediction = {
  x: number; y: number; width: number; height: number;
  class?: string; confidence?: number;
  image_width?: number; image_height?: number;
};
type RfResponse = { image?: { width?: number; height?: number }; predictions?: RfPrediction[] };

/* ========= Utils ========= */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const stripDataUrlPrefix = (b64: string) => {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
};

/* ========= Handler ========= */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { image_base64?: string } | null;
    const raw = body?.image_base64 ? stripDataUrlPrefix(body.image_base64) : undefined;
    if (!raw) {
      return NextResponse.json(
        { ok: false, message: "Falta image_base64", hint: "Puede ir con o sin prefijo data:image/...;base64," },
        { status: 400 }
      );
    }

    // Mock opcional para pruebas sin Roboflow
    if (process.env.MOCK_DETECTOR === "1") {
      const boxes: Box[] = [{ x: 0.32, y: 0.28, w: 0.36, h: 0.34, cls: "dent", score: 0.7 }];
      return NextResponse.json({ boxes, note: "MOCK_DETECTOR=1" });
    }

    const MODEL   = process.env.ROBOFLOW_MODEL;
    const VERSION = process.env.ROBOFLOW_VERSION;
    const KEY     = process.env.ROBOFLOW_API_KEY;
    if (!MODEL || !VERSION || !KEY) {
      return NextResponse.json({ error: "Faltan ROBOFLOW_MODEL / ROBOFLOW_VERSION / ROBOFLOW_API_KEY" }, { status: 500 });
    }

    const GATEWAY    = (process.env.ROBOFLOW_GATEWAY ?? "serverless").toLowerCase();
    const CONF       = process.env.ROBOFLOW_CONFIDENCE ?? "0.45";
    const OVERLAP    = process.env.ROBOFLOW_OVERLAP ?? "0.45";

    // Construye URL según gateway elegido
    const base =
      GATEWAY === "detect"
        ? "https://detect.roboflow.com"
        : "https://serverless.roboflow.com"; // default

    const url =
      `${base}/${encodeURIComponent(MODEL)}/${encodeURIComponent(VERSION)}` +
      `?api_key=${encodeURIComponent(KEY)}&format=json&confidence=${encodeURIComponent(CONF)}&overlap=${encodeURIComponent(OVERLAP)}`;

    // Hosted API acepta el base64 crudo en el body con este content-type
    const rf = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: raw,
      cache: "no-store",
    });

    if (!rf.ok) {
      const t = await rf.text().catch(() => "");
      return NextResponse.json(
        { boxes: [] as Box[], note: `Roboflow ${rf.status}${t ? `: ${t}` : ""}` },
        { status: 502 }
      );
    }

    const data = (await rf.json()) as RfResponse;

    // Dimensiones: usa image.width/height o, si no vienen, toma de la primera predicción
    const W = data.image?.width  ?? data.predictions?.[0]?.image_width  ?? 1000;
    const H = data.image?.height ?? data.predictions?.[0]?.image_height ?? 1000;

    const boxes: Box[] = (data.predictions ?? []).map((p): Box => {
      const x1 = (p.x - p.width  / 2) / W;
      const y1 = (p.y - p.height / 2) / H;
      const w  =  p.width  / W;
      const h  =  p.height / H;
      return {
        x: clamp01(x1),
        y: clamp01(y1),
        w: clamp01(w),
        h: clamp01(h),
        cls: String(p.class ?? "damage"),
        score: typeof p.confidence === "number" ? p.confidence : undefined,
      };
    });

    return NextResponse.json({ boxes });
  } catch {
    return NextResponse.json({ error: "Error en detector" }, { status: 500 });
  }
}

// GET de ayuda (si abres /api/detector en el navegador)
export function GET() {
  return NextResponse.json(
    {
      ok: false,
      message: "Usa POST con JSON: { image_base64: <base64> }",
      hint: "image_base64 puede ser con o sin prefijo data:image/...;base64,",
    },
    { status: 405 }
  );
}
