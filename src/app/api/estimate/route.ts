import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer"; // asegura tipos en runtime Node

export const runtime = "nodejs"; // IMPORTANTE: no usar edge si conviertes a base64

type Severity = "bajo" | "intermedio" | "avanzado";
type ApiResult = {
  severity: Severity;
  area: string;
  category: string;
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
};

const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024; // 5 MB

const DIY_LIBRARY: Record<string, { title: string; videoUrl: string; steps: string[] }> = {
  rayon_ligero: {
    title: "Eliminar rayón ligero con pulido",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: ["Lava el área con agua y jabón neutro.", "Aplica compuesto pulidor con pad de espuma.", "Pulir en circulares sin presionar de más.", "Retira exceso y revisa a contraluz."],
  },
  raspon_parachoques: {
    title: "Retoque rápido en defensa",
    videoUrl: "https://www.youtube.com/watch?v=M3r2XDceM6A",
    steps: ["Desengrasa con alcohol isopropílico.", "Lija suave al agua (grano 2000).", "Aplica pintura de retoque del color.", "Sella con barniz en pluma y pule."],
  },
  abolladura_pequena: {
    title: "Abolladura pequeña sin pintura (PDR casero)",
    videoUrl: "https://www.youtube.com/watch?v=kXYiU_JCYtU",
    steps: ["Calienta suavemente el área (secadora).", "Tracciona con ventosa.", "Golpecitos de perímetro con martillo de goma.", "Revisa reflejos hasta nivelar."],
  },
};

function normalizeCategory(raw: string): string {
  const k = raw.toLowerCase().replace(/\s+/g, "_");
  if (/(ray|pulid)/.test(k)) return "rayon_ligero";
  if (/(raspon|parachoques|defensa|bumper)/.test(k)) return "raspon_parachoques";
  if (/(aboll|pdr|golpe_peque)/.test(k)) return "abolladura_pequena";
  return "rayon_ligero";
}

function estimateCost(category: string, severity: Severity): number {
  const base: Record<string, number> = { rayon_ligero: 1200, raspon_parachoques: 1800, abolladura_pequena: 2200 };
  const b = base[category] ?? 1500;
  if (severity === "bajo") return b;
  if (severity === "intermedio") return Math.round(b * 1.8);
  return Math.round(b * 3.0);
}

/* ---------- IA con OpenAI (GPT-4o mini) ---------- */
async function inferWithOpenAI(file: File): Promise<{ severity?: Severity; category?: string; area?: string }> {
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
          { type: "input_text", text: `Clasifica el daño de la imagen en JSON con:
- severity: "bajo" | "intermedio" | "avanzado"
- category: etiqueta corta (ej. "rayon_ligero", "raspon_parachoques", "abolladura_pequena")
- area: zona afectada (ej. "defensa/guardafango")` },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ],
    response_format: { type: "json_schema", json_schema: schema }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const out = await resp.json();

  let parsed: { severity?: Severity; category?: string; area?: string } | undefined = out?.output_parsed;
  if (!parsed) {
    const text =
      out?.output?.[0]?.content?.[0]?.text ??
      out?.choices?.[0]?.message?.content ?? "";
    if (typeof text === "string" && text.trim()) {
      try { parsed = JSON.parse(text); } catch {}
    }
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

/* ---------- Endpoint propio opcional ---------- */
async function inferWithCustomEndpoint(file: File): Promise<{ severity?: Severity; category?: string; area?: string }> {
  const url = process.env.DAMAGE_MODEL_URL;
  const key = process.env.DAMAGE_MODEL_API_KEY;
  if (!url) return {};
  const buf = Buffer.from(await file.arrayBuffer());
  const b64 = buf.toString("base64");

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ image_base64: b64 }),
  });
  if (!resp.ok) throw new Error(`Model error: ${resp.status}`);
  const data = await resp.json() as { severity?: string; category?: string; area?: string };

  const sev = String(data.severity ?? "").toLowerCase() as Severity;
  const allowed: Severity[] = ["bajo", "intermedio", "avanzado"];
  return {
    severity: allowed.includes(sev) ? sev : undefined,
    category: normalizeCategory(String(data.category ?? "")),
    area: String(data.area ?? "zona estimada"),
  };
}

/* ---------- Fallback demo ---------- */
function fallbackHeuristic(file: File) {
  const size = file.size;
  const severity: Severity = size < 800_000 ? "bajo" : size < 1_600_000 ? "intermedio" : "avanzado";
  const category = size < 800_000 ? "rayon_ligero" : size < 1_600_000 ? "raspon_parachoques" : "abolladura_pequena";
  const area = "defensa/guardafango (estimado)";
  return { severity, category, area };
}

/* ---------- Handler ---------- */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const fileAny = form.get("image");
    if (!(fileAny instanceof Blob)) return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    const file = fileAny as File;

    if (!ALLOWED.includes(file.type || "")) {
      return NextResponse.json({ error: "Formato no soportado. Usa JPG, PNG o WEBP." }, { status: 415 });
    }
    if (file.size > MAX) {
      return NextResponse.json({ error: "Imagen demasiado grande (máx. 5 MB)." }, { status: 413 });
    }

    let sev: Severity | undefined, cat: string | undefined, area: string | undefined;

    // 1) OpenAI si hay clave
    try {
      const r1 = await inferWithOpenAI(file);
      sev = r1.severity; cat = r1.category; area = r1.area;
    } catch {}

    // 2) Endpoint propio si lo configuraste
    if (!sev || !cat || !area) {
      try {
        const r2 = await inferWithCustomEndpoint(file);
        sev = r2.severity ?? sev; cat = r2.category ?? cat; area = r2.area ?? area;
      } catch {}
    }

    // 3) Fallback demo
    if (!sev || !cat || !area) {
      const f = fallbackHeuristic(file);
      sev = f.severity; cat = f.category; area = f.area;
    }

    const estimate = estimateCost(cat!, sev!);
    const diy = sev === "bajo" && DIY_LIBRARY[cat!] ? DIY_LIBRARY[cat!] : undefined;

    const payload: ApiResult = { severity: sev!, category: cat!, area: area!, estimate, diy };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
