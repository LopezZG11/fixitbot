// src/app/api/detector/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// ===== Tipos =====
type Box = {
  x: number; y: number; w: number; h: number;
  cls: string; score?: number;
};

// Respuesta de Roboflow (shape típico)
type RfPrediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  class?: string;
  confidence?: number;
  image_width?: number;
  image_height?: number;
};

type RfResponse = {
  image?: { width?: number; height?: number };
  predictions?: RfPrediction[];
};

// ===== Handler =====
export async function POST(req: NextRequest) {
  try {
    const { image_base64 } = (await req.json()) as { image_base64?: string };
    if (!image_base64) {
      return NextResponse.json({ error: "Falta image_base64" }, { status: 400 });
    }

    // Modo mock (opcional mientras tu modelo termina de entrenar)
    if (process.env.MOCK_DETECTOR === "1") {
      const boxes: Box[] = [{ x: 0.35, y: 0.35, w: 0.3, h: 0.3, cls: "damage", score: 0.5 }];
      return NextResponse.json({ boxes, area: "zona estimada" });
    }

    const model = process.env.ROBOFLOW_MODEL;
    const version = process.env.ROBOFLOW_VERSION;
    const key = process.env.ROBOFLOW_API_KEY;

    if (!model || !version || !key) {
      return NextResponse.json({ error: "Faltan variables ROBOFLOW_*" }, { status: 500 });
    }

    // Puedes ajustar confidence/overlap si lo necesitas
    const url =
      `https://detect.roboflow.com/${model}/${version}` +
      `?api_key=${key}&format=json&confidence=0.45&overlap=0.45`;

    const form = new FormData();
    form.append("image", `data:image/jpeg;base64,${image_base64}`);

    const rf = await fetch(url, { method: "POST", body: form });

    if (!rf.ok) {
      const t = await rf.text();
      // No lanzamos error para no romper el flujo del MVP
      return NextResponse.json({
        boxes: [] as Box[],
        area: "zona estimada",
        note: `Roboflow ${rf.status}: ${t}`,
      });
    }

    // ⬇️ Tipado explícito: sin 'any'
    const data: RfResponse = await rf.json();

    const W =
      data.image?.width ??
      data.predictions?.[0]?.image_width ??
      1000;

    const H =
      data.image?.height ??
      data.predictions?.[0]?.image_height ??
      1000;

    const clamp = (v: number) => Math.max(0, Math.min(1, v));

    // ⬇️ Tipar el parámetro del map y el retorno como Box
    const boxes: Box[] = (data.predictions ?? []).map((p: RfPrediction): Box => ({
      x: clamp((p.x - p.width / 2) / W),
      y: clamp((p.y - p.height / 2) / H),
      w: clamp(p.width / W),
      h: clamp(p.height / H),
      cls: String(p.class ?? "damage"),
      score: typeof p.confidence === "number" ? p.confidence : undefined,
    }));

    return NextResponse.json({ boxes, area: "zona estimada" });
  } catch {
    return NextResponse.json({ error: "Error en detector" }, { status: 500 });
  }
}
