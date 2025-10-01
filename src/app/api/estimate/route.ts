// src/app/api/estimate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";

type Severity = "bajo" | "intermedio" | "avanzado";

type Box = {
  // coordenadas normalizadas 0..1 sobre el ancho/alto de la imagen
  x: number; y: number; w: number; h: number;
  cls: string; score?: number;
};

type ApiResult = {
  severity: Severity;
  area: string;
  category: string;
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
  boxes?: Box[];      // opcional: si tu detector devuelve cajas
  areaPct?: number;   // opcional: % de área dañada (0..1)
};

const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024;

// Biblioteca de guías DIY (se muestra solo cuando severity === "bajo")
const DIY_LIBRARY: Record<string, { title: string; videoUrl: string; steps: string[] }> = {
  rayon_ligero: {
    title: "Eliminar rayón ligero con pulido",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: ["Lava el área", "Aplica pulidor con pad", "Pulir en círculos", "Revisar a contraluz"],
  },
  raspon_parachoques: {
    title: "Retoque rápido en defensa",
    videoUrl: "https://www.youtube.com/watch?v=M3r2XDceM6A",
    steps: ["Desengrasar", "Lijar 2000 al agua", "Pintura de retoque", "Barniz y pulido"],
  },
  abolladura_pequena: {
    title: "PDR casero (abolladura pequeña)",
    videoUrl: "https://www.youtube.com/watch?v=kXYiU_JCYtU",
    steps: ["Calentar suave", "Ventosa", "Golpecitos perímetro", "Revisión de reflejos"],
  },
};

// Normaliza categorías libres a nuestras llaves internas
function normalizeCategory(raw: string): string {
  const k = raw.toLowerCase().replace(/\s+/g, "_");
  if (/(ray|pulid)/.test(k)) return "rayon_ligero";
  if (/(raspon|parachoques|defensa|bumper)/.test(k)) return "raspon_parachoques";
  if (/(aboll|pdr|golpe_peque)/.test(k)) return "abolladura_pequena";
  return "rayon_ligero";
}

// Estimador con base por categoría + severidad + ajuste por área dañada
function estimateCost(category: string, severity: Severity, areaPct = 0): number {
  const base: Record<string, number> = { rayon_ligero: 1200, raspon_parachoques: 1800, abolladura_pequena: 2200 };
  const sevK: Record<Severity, number> = { bajo: 1, intermedio: 1.8, avanzado: 3.0 };
  const areaK = 1 + Math.min(areaPct, 0.2) * 2; // hasta +40% si el daño es grande (cap 20%)
  return Math.round((base[category] ?? 1500) * sevK[severity] * areaK);
}

function boxesAreaPct(boxes?: Box[]): number {
  if (!boxes?.length) return 0;
  const sum = boxes.reduce((acc, b) => acc + b.w * b.h, 0);
  return Math.min(sum, 1); // cap por solapamientos
}

/* ================== IA #1: OpenAI (clasificación rápida) ================== */
async function inferWithOpenAI(
  file: File
): Promise<{ severity?: Severity; category?: string; area?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return {};

  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buf.toString("base64")}`;

  const schema = {
    name: "DamageAssessment",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        severity: { type: "string", enum: ["bajo", "intermedio", "avanzado"] },
        category: { type: "string" },
        area: { type: "string" }
      },
      required: ["severity", "category", "area"]
    },
    strict: true
  };

  const body = {
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
`Clasifica el daño de la imagen en JSON con:
- severity: "bajo" | "intermedio" | "avanzado"
- category: etiqueta corta (ej. "rayon_ligero", "raspon_parachoques", "abolladura_pequena")
- area: zona afectada (ej. "defensa/guardafango")`
          },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ],
    response_format: { type: "json_schema", json_schema: schema }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const out = await resp.json();

  let parsed: { severity?: string; category?: string; area?: string } | undefined = out?.output_parsed;
  if (!parsed) {
    const text = out?.output?.[0]?.content?.[0]?.text ?? out?.choices?.[0]?.message?.content ?? "";
    if (typeof text === "string" && text.trim()) { try { parsed = JSON.parse(text); } catch {} }
  }
  if (!parsed) return {};

  const sev = String(parsed.severity ?? "").toLowerCase() as Severity;
  const allowed: Severity[] = ["bajo", "intermedio", "avanzado"];
  return {
    severity: allowed.includes(sev) ? sev : undefined,
    category: normalizeCategory(String(parsed.category ?? "")),
    area: String(parsed.area ?? "zona estimada"),
  };
}

/* ========== IA #2: Detector opcional (cajas) ==========
   Configura en Vercel: DETECTOR_URL (+ DETECTOR_API_KEY opcional)
   Espera JSON: { boxes: [{x,y,w,h,cls,score}], area?: "defensa/..." }
*/
async function inferWithDetector(file: File): Promise<{ boxes?: Box[]; area?: string }> {
  const url = process.env.DETECTOR_URL;
  if (!url) return {};
  const key = process.env.DETECTOR_API_KEY;

  const buf = Buffer.from(await file.arrayBuffer());
  const b64 = buf.toString("base64");

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ image_base64: b64 })
  });
  if (!resp.ok) throw new Error(`Detector ${resp.status}`);

  const data = await resp.json() as { boxes?: Box[]; area?: string };
  const boxes = (data.boxes ?? []).map(b => ({
    x: Math.max(0, Math.min(1, b.x)),
    y: Math.max(0, Math.min(1, b.y)),
    w: Math.max(0, Math.min(1, b.w)),
    h: Math.max(0, Math.min(1, b.h)),
    cls: String(b.cls ?? "daño"),
    score: typeof b.score === "number" ? b.score : undefined
  }));
  return { boxes, area: data.area };
}

/* ================== Fallback demo ================== */
function fallbackHeuristic(file: File) {
  const size = file.size;
  const severity: Severity = size < 800_000 ? "bajo" : size < 1_600_000 ? "intermedio" : "avanzado";
  const category = size < 800_000 ? "rayon_ligero" : size < 1_600_000 ? "raspon_parachoques" : "abolladura_pequena";
  const area = "defensa/guardafango (estimado)";
  return { severity, category, area };
}

/* ================== Handler ================== */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const fAny = form.get("image");
    if (!(fAny instanceof Blob)) return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    const file = fAny as File;

    if (!ALLOWED.includes(file.type || "")) {
      return NextResponse.json({ error: "Formato no soportado. Usa JPG, PNG o WEBP." }, { status: 415 });
    }
    if (file.size > MAX) {
      return NextResponse.json({ error: "Imagen demasiado grande (máx. 5 MB)." }, { status: 413 });
    }

    // 1) Clasificación con OpenAI (si hay clave)
    let sev: Severity | undefined, cat: string | undefined, area: string | undefined;
    try {
      const c = await inferWithOpenAI(file);
      sev = c.severity; cat = c.category; area = c.area;
    } catch {}

    // 2) Detector de daños (cajas) si lo configuraste
    let boxes: Box[] | undefined;
    try {
      const d = await inferWithDetector(file);
      boxes = d.boxes;
      area = area ?? d.area;
    } catch {}

    // 3) Fallback si faltan datos
    if (!sev || !cat || !area) {
      const f = fallbackHeuristic(file);
      sev ??= f.severity; cat ??= f.category; area ??= f.area;
    }

    const areaPct = boxesAreaPct(boxes);
    const estimate = estimateCost(cat!, sev!, areaPct);
    const diy = sev === "bajo" ? DIY_LIBRARY[cat!] : undefined;

    const payload: ApiResult = { severity: sev!, category: cat!, area: area!, estimate, diy, boxes, areaPct };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
