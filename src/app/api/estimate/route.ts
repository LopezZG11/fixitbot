import { NextRequest, NextResponse } from "next/server";

type Severity = "bajo" | "intermedio" | "avanzado";
type ApiResult = {
  severity: Severity;
  area: string;
  category: string; // ej. "rayon_ligero" | "raspon_parachoques" | "abolladura_pequena"
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
};

// --- Config ---
const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024; // 5 MB

// Mapea categorías -> video/steps DIY (se usa cuando severity === "bajo")
const DIY_LIBRARY: Record<
  string,
  { title: string; videoUrl: string; steps: string[] }
> = {
  rayon_ligero: {
    title: "Eliminar rayón ligero con pulido",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Lava el área con agua y jabón neutro.",
      "Aplica compuesto pulidor con pad de espuma.",
      "Pulir en circulares sin presionar de más.",
      "Retira exceso y revisa a contraluz."
    ],
  },
  raspon_parachoques: {
    title: "Retoque rápido en defensa",
    videoUrl: "https://www.youtube.com/watch?v=M3r2XDceM6A",
    steps: [
      "Desengrasa con alcohol isopropílico.",
      "Lija suave al agua (grano 2000).",
      "Aplica pintura de retoque del color.",
      "Sella con barniz en pluma y pule."
    ],
  },
  abolladura_pequena: {
    title: "Abolladura pequeña sin pintura (PDR casero)",
    videoUrl: "https://www.youtube.com/watch?v=kXYiU_JCYtU",
    steps: [
      "Calienta suavemente el área (secadora).",
      "Tracciona con ventosa.",
      "Golpecitos de perímetro con martillo de goma.",
      "Revisa reflejos hasta nivelar."
    ],
  },
};

// Estimación simple (ejemplo). Ajusta a tus tablas reales.
function estimateCost(category: string, severity: Severity): number {
  const base: Record<string, number> = {
    rayon_ligero: 1200,
    raspon_parachoques: 1800,
    abolladura_pequena: 2200,
  };
  const b = base[category] ?? 1500;
  if (severity === "bajo") return b;
  if (severity === "intermedio") return Math.round(b * 1.8);
  return Math.round(b * 3.0); // avanzado
}

// === Ejemplo de integración con un endpoint de IA ===
// Pon en Vercel → Project → Settings → Environment Variables:
//   DAMAGE_MODEL_URL   (ej. tu endpoint HTTPS que clasifica la imagen)
//   DAMAGE_MODEL_API_KEY
async function callVisionModel(file: File): Promise<{
  severity?: Severity;
  category?: string;
  area?: string;
}> {
  const url = process.env.DAMAGE_MODEL_URL;
  const key = process.env.DAMAGE_MODEL_API_KEY;

  if (!url || !key) return {}; // sin config → que entre fallback local

  // Enviamos la imagen como base64 (simple y compatible)
  const buf = Buffer.from(await file.arrayBuffer());
  const b64 = buf.toString("base64");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ image_base64: b64 }),
  });

  // Esperamos un JSON como:
  // { "severity": "bajo|intermedio|avanzado", "category": "rayon_ligero", "area": "defensa/guardafango" }
  if (!resp.ok) throw new Error(`Model error: ${resp.status}`);
  const data = (await resp.json()) as {
    severity?: string;
    category?: string;
    area?: string;
  };

  // Sanitiza/mapea a nuestro tipo
  const sev = (data.severity ?? "").toLowerCase() as Severity;
  const cat = (data.category ?? "rayon_ligero").toLowerCase().replace(/\s+/g, "_");
  const area = data.area ?? "zona estimada";

  const allowedSev: Severity[] = ["bajo", "intermedio", "avanzado"];
  return {
    severity: allowedSev.includes(sev) ? sev : undefined,
    category: cat,
    area,
  };
}

// === Fallback local si no hay IA configurada ===
function fallbackHeuristic(file: File): { severity: Severity; category: string; area: string } {
  // Heurística tonta: tamaño de archivo ~ severidad (sólo para demo)
  const size = file.size;
  const severity: Severity = size < 800_000 ? "bajo" : size < 1_600_000 ? "intermedio" : "avanzado";
  const category = size < 800_000 ? "rayon_ligero" : size < 1_600_000 ? "raspon_parachoques" : "abolladura_pequena";
  const area = "defensa/guardafango (estimado)";
  return { severity, category, area };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const fileAny = form.get("image");

    if (!(fileAny instanceof Blob)) {
      return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    }

    const file = fileAny as File;

    if (!ALLOWED.includes(file.type || "")) {
      return NextResponse.json(
        { error: "Formato no soportado. Usa JPG, PNG o WEBP." },
        { status: 415 }
      );
    }
    if (file.size > MAX) {
      return NextResponse.json(
        { error: "Imagen demasiado grande (máx. 5 MB)." },
        { status: 413 }
      );
    }

    // 1) Intentar IA real
    let sev: Severity | undefined;
    let cat: string | undefined;
    let area: string | undefined;
    try {
      const out = await callVisionModel(file);
      sev = out.severity;
      cat = out.category;
      area = out.area;
    } catch {
      // si falla la llamada al modelo, seguimos a fallback
    }

    // 2) Fallback si no hay IA o faltan datos
    if (!sev || !cat || !area) {
      const f = fallbackHeuristic(file);
      sev = f.severity;
      cat = f.category;
      area = f.area;
    }

    // 3) Calcular cotización y DIY (si bajo)
    const estimate = estimateCost(cat!, sev!);
    const diy =
      sev === "bajo" && DIY_LIBRARY[cat!]
        ? DIY_LIBRARY[cat!]
        : undefined;

    const payload: ApiResult = {
      severity: sev!,
      category: cat!,
      area: area!,
      estimate,
      diy,
    };

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
