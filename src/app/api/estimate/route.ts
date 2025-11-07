// src/app/api/estimate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";

/* ===================== Tipos ===================== */
type Severity = "bajo" | "intermedio" | "avanzado" | string;

type Box = {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
  cls: string;
  score?: number; // 0..1
};

type DetectorOut = {
  boxes?: Box[];
  area?: string;
  note?: string;
};

type DetailedBreakdownItem = {
  part: string;
  base: number;
  zone: string;
};

type ApiResult = {
  severity: Severity;
  area: string;
  category: string;
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
  boxes?: Box[];
  areaPct?: number;
  note?: string;
  breakdown?: {
    base: number;
    sevFactor: number;
    areaFactor: number;
    areaPct: number;
    zone: string;
  };
  detailedBreakdown?: DetailedBreakdownItem[];
  insights?: {
    topClasses: Array<{ cls: string; weight: number }>;
    recommendWorkshop: boolean;
  };
};

/* ===================== Constantes ===================== */
const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024; // 5 MB
const HARD_CLASSES = /(crack|lamp(_|\s)?broken|rust|corri?s(i|o)n|flat(_|\s)?tire|glass(_|\s)?shatter)/i;

const FRIENDLY_DIY = new Set<string>([
  "scratch",
  "paint_damage",
  "bumper_scuff",
  "dent",
  "door_ding",
  "paint_transfer",
  "headlight_restore",
  "plastic_bumper_crack_small",
  "clearcoat_chip",
  "rust_corrosion",
  "flat_tire",
]);

/* ---- Post-procesado anti–falsos positivos ---- */
const MIN_SCORE = 0.60;   // súbelo si aún hay FPs (0.65–0.70)
const MIN_AREA  = 0.015;  // 1.5% del frame; súbelo si salen cajitas muy pequeñas
const ALLOWED_CLASSES = new Set([
  "dent",
  "scratch",
  "paint_damage",
  "door_ding",
  "bumper_damage",
  "front-bumper-dent"
]);

/* ============== DIY curado (puedes extenderlo libremente) ============== */
const DIY_LIBRARY: Record<string, { title: string; videoUrl: string; steps: string[] }> = {
  scratch: {
    title: "Pulido de rayón leve (sin traspasar barniz)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Lava y seca el área.",
      "Enmascara orillas con cinta.",
      "Aplica compuesto pulidor (corte medio) en pad de espuma.",
      "Pulir con presión ligera, 30–60 s por pasada.",
      "Microfibra para retirar residuo y revisar.",
    ],
  },
  paint_damage: {
    title: "Retoque puntual de pintura",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Desengrasa con isopropílico.",
      "Lija suave si hay rebabas (grano 2000).",
      "Aplica capas finas de pintura de retoque.",
      "Cura y sella con barniz.",
      "Pulido ligero de integración.",
    ],
  },
  dent: {
    title: "PDR casero (golpe pequeño sin romper pintura)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Calienta ligeramente el panel.",
      "Coloca ventosa/tab en el centro del golpe.",
      "Tira con incrementos cortos.",
      "Corrige alta/baja con martillo de teflón.",
    ],
  },
  door_ding: {
    title: "Ding de puerta con kit de ventosa",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Limpia y marca el centro.",
      "Pega tab pequeño con pegamento.",
      "Tira con golpes cortos.",
      "Corrige perímetro con puntero.",
    ],
  },
  headlight_restore: {
    title: "Restauración de faro opaco",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Enmascara el contorno.",
      "Lija progresivo 1000→2000 en húmedo.",
      "Pulido plástico hasta transparencia.",
      "Sellador UV para proteger.",
    ],
  },
  paint_transfer: {
    title: "Quitar transferencia de pintura sin repintar",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "APC/citrus en la marca, 1–2 min.",
      "Frota con clay bar o borrador melamínico suave.",
      "Pulido suave para recuperar brillo.",
    ],
  },
  rust_corrosion: {
    title: "Tratamiento de óxido superficial",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Lija hasta metal sano.",
      "Desengrasa.",
      "Convertidor de óxido y primer anticorrosivo.",
      "Color y barniz; pulido final.",
    ],
  },
  plastic_bumper_crack_small: {
    title: "Grieta pequeña en defensa plástica",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Bisela por detrás; desengrasa.",
      "Resina/epoxi + malla; curar.",
      "Lijar/emplastar; fondo, color, barniz.",
    ],
  },
  clearcoat_chip: {
    title: "Astilla de barniz (chip)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Limpia y desengrasa.",
      "Gota de barniz en el chip.",
      "Curado y pulido suave.",
    ],
  },
  flat_tire: {
    title: "Reparación temporal de pinchazo (mecha)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    steps: [
      "Marca y extrae el objeto.",
      "Agranda con herramienta en T.",
      "Inserta mecha con pegamento.",
      "Corta excedente; infla y revisa fugas.",
    ],
  },
};

/* ===================== Utilidades ===================== */
function normalizeClass(raw: string): string {
  const k = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (/paint/.test(k)) return "paint_damage";
  if (/lamp/.test(k) && /broken/.test(k)) return "lamp_broken";
  if (/flat/.test(k) && /tire/.test(k)) return "flat_tire";
  if (/rust/.test(k) || /corri?s(i|o)n/.test(k)) return "rust_corrosion";
  if (/scratch/.test(k)) return "scratch";
  if (/dent/.test(k)) return "dent";
  if (/crack/.test(k)) return "crack";
  if (/glass/.test(k) && /shatter/.test(k)) return "glass_shatter";
  if (/bumper/.test(k) && /damage/.test(k)) return "bumper_damage";
  if (/door/.test(k) && /ding/.test(k)) return "door_ding";
  return k;
}

function mapToDIYKey(raw: string): string {
  const k = normalizeClass(raw);
  if (/(transfer)/.test(k)) return "paint_transfer";
  if (/(bumper).*scuff|(^|_)scuff/.test(k)) return "bumper_scuff";
  if (/(door).*ding|(^|_)ding/.test(k)) return "door_ding";
  if (/(headlight|faro|haze|yellow)/.test(k)) return "headlight_restore";
  if (/(clearcoat|chip)/.test(k)) return "clearcoat_chip";
  if (/(plastic).*crack|bumper.*crack/.test(k)) return "plastic_bumper_crack_small";
  return k;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sumArea = (boxes: Box[]) => boxes.reduce((s, b) => s + b.w * b.h, 0);
const areaPct = (boxes: Box[]) => Math.min(1, sumArea(boxes));

function classByArea(boxes: Box[]): string {
  const acc = new Map<string, number>();
  for (const b of boxes) {
    const cls = normalizeClass(b.cls);
    acc.set(cls, (acc.get(cls) ?? 0) + b.w * b.h);
  }
  let best = "scratch";
  let bestA = 0;
  for (const [k, v] of acc) if (v > bestA) { best = k; bestA = v; }
  return best;
}

function inferSeverityFrom(boxes: Box[]): Severity {
  const scoreArea = boxes.reduce((s, b) => {
    const conf = typeof b.score === "number" ? clamp01(b.score) : 0.5;
    return s + (0.5 + 0.5 * conf) * (b.w * b.h);
  }, 0);
  const hasHard = boxes.some(b => HARD_CLASSES.test(b.cls));
  if (hasHard && scoreArea > 0.03) return "avanzado";
  if (scoreArea < 0.02) return "bajo";
  if (scoreArea < 0.06) return "intermedio";
  return "avanzado";
}

function getDetailedAreaLabels(boxes: Box[]): string[] {
  if (boxes.length === 0) return ["zona no identificada"];
  const identifiedParts = new Set<string>();
  for (const b of boxes) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const side = cx < 0.33 ? "izquierdo" : cx > 0.66 ? "derecho" : "central";
    const vPos = cy < 0.4 ? "superior" : cy > 0.7 ? "inferior" : "media";
    let part: string;
    if (/lamp|headlight/i.test(b.cls)) part = `faro (${side})`;
    else if (/tire|llanta/i.test(b.cls)) part = `llanta (${side})`;
    else if (/mirror|espejo/i.test(b.cls)) part = `espejo (${side})`;
    else if (vPos === "inferior" || /bumper|defensa/.test(b.cls)) part = `defensa (${side})`;
    else if (/door|puerta/i.test(b.cls)) part = `puerta (${side})`;
    else if (/fender|salpicadera/i.test(b.cls)) part = `salpicadera (${side})`;
    else if (/hood|cofre/i.test(b.cls)) part = "cofre";
    else if (/roof|techo/i.test(b.cls)) part = "techo";
    else if (/trunk|cajuela/i.test(b.cls)) part = "cajuela";
    else if (/quarter[_|\s]?panel|costado/.test(b.cls)) part = `costado (${side})`;
    else part = `panel (${side} ${vPos})`;
    identifiedParts.add(part);
  }
  return Array.from(identifiedParts);
}

/* ===================== Precios estilo “taller local” ===================== */
function normalizeZoneKey(areaLabel: string): string {
  if (/puerta|door/i.test(areaLabel)) return "door_panel";
  if (/salpicadera|fender/i.test(areaLabel)) return "door_panel";
  if (/defensa|bumper/i.test(areaLabel)) return "bumper";
  if (/cofre|hood/i.test(areaLabel)) return "hood";
  if (/techo|roof/i.test(areaLabel)) return "roof";
  if (/costado|quarter_panel/i.test(areaLabel)) return "side_panel";
  if (/faro|lamp|headlight/i.test(areaLabel)) return "lamp";
  if (/llanta|tire/i.test(areaLabel)) return "tire";
  if (/cristal|glass/i.test(areaLabel)) return "glass";
  if (/espejo|mirror/i.test(areaLabel)) return "mirror";
  return "default";
}

function getMatrixCost(category: string, area: string): number {
  const normalizedCategory = normalizeClass(category);
  const normalizedZone = normalizeZoneKey(area);

  const priceMatrix: Record<string, Record<string, number>> = {
    scratch: { bumper: 300, door_panel: 400, hood: 450, side_panel: 500, roof: 600, default: 400 },
    dent: { bumper: 600, door_panel: 750, hood: 1100, side_panel: 1200, roof: 1500, default: 900 },
    door_ding: { door_panel: 500, side_panel: 600, default: 550 },
    paint_damage: { mirror: 400, bumper: 650, door_panel: 900, hood: 1200, side_panel: 1100, roof: 1000, default: 800 },
    lamp_broken: { lamp: 1200, default: 1200 },
    glass_shatter: { glass: 1500, default: 1500 },
    crack: { bumper: 950, default: 1100 },
    rust_corrosion: { door_panel: 800, side_panel: 1000, default: 900 },
    flat_tire: { tire: 150, default: 150 },
    headlight_restore: { lamp: 500, default: 500 },
  };

  const categoryPrices = priceMatrix[normalizedCategory];
  if (categoryPrices) {
    return categoryPrices[normalizedZone] || categoryPrices["default"] || 850;
  }
  return 850;
}

const sevK = (s: Severity) => (s === "bajo" ? 1.0 : s === "intermedio" ? 1.3 : 1.6);
const areaK = (pct: number) => 1 + Math.min(pct, 0.25) * 1.5;

/* ===================== DIY/Taller helpers ===================== */
function pickDIY(category: string, sev: Severity, area = 0) {
  const allowIntermedioSmall = sev === "intermedio" && area <= 0.03;
  if (!(sev === "bajo" || allowIntermedioSmall)) return undefined;
  const key = mapToDIYKey(category);
  if (!FRIENDLY_DIY.has(key)) return undefined;
  const item = DIY_LIBRARY[key];
  return item?.videoUrl?.startsWith("http") ? item : undefined;
}

function topClasses(boxes: Box[]) {
  const acc = new Map<string, number>();
  for (const b of boxes) {
    const cls = normalizeClass(b.cls);
    const w = b.w * b.h * (typeof b.score === "number" ? 0.5 + 0.5 * clamp01(b.score) : 0.5);
    acc.set(cls, (acc.get(cls) ?? 0) + w);
  }
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([cls, weight]) => ({ cls, weight }));
}

function shouldRecommendWorkshop(sev: Severity, pct: number, boxes: Box[]) {
  const hasHard = boxes.some(b => HARD_CLASSES.test(b.cls));
  return sev === "avanzado" || pct > 0.08 || hasHard;
}

/* ===================== Herramientas de formulario ===================== */
function pickFileFromForm(form: FormData): File | undefined {
  const keys = ["file", "image"];
  for (const k of keys) {
    const v = form.get(k);
    if (v instanceof File) return v;
  }
  return undefined;
}

function pickBase64FromForm(form: FormData): string | undefined {
  const raw = form.get("image_base64");
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/* ===================== Detector calls ===================== */
async function callDetectorFromFile(file: File): Promise<DetectorOut> {
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  const detApiUrl = new URL("/api/detector", baseUrl);

  const buf = Buffer.from(await file.arrayBuffer());
  const fd = new FormData();
  fd.append("file", new Blob([buf]), file.name || "upload.jpg");

  const r = await fetch(detApiUrl, { method: "POST", body: fd, cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { boxes: [], note: `Error al llamar al detector: ${r.status}${t ? `: ${t}` : ""}` };
  }
  return (await r.json()) as DetectorOut;
}

async function callDetectorFromBase64(b64: string): Promise<DetectorOut> {
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  const detApiUrl = new URL("/api/detector", baseUrl);

  const r = await fetch(detApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: b64 }),
    cache: "no-store",
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { boxes: [], note: `Error al llamar al detector: ${r.status}${t ? `: ${t}` : ""}` };
  }
  return (await r.json()) as DetectorOut;
}

/* ===================== Heurística de fallback ===================== */
function fallbackHeuristic(file: File) {
  const size = file.size;
  const severity: Severity = size < 800_000 ? "bajo" : size < 1_600_000 ? "intermedio" : "avanzado";
  const category = size < 800_000 ? "scratch" : size < 1_600_000 ? "paint_damage" : "dent";
  const area = "componente exterior (estimado)";
  return { severity, category, area };
}

/* ===================== Filtro anti-FP ===================== */
function postFilter(boxes: Box[]): Box[] {
  return boxes
    .filter(b => (b.score ?? 0) >= MIN_SCORE)
    .filter(b => (b.w * b.h) >= MIN_AREA)
    .filter(b => {
      const raw = (b.cls || "").toLowerCase();
      const norm = normalizeClass(raw);
      return ALLOWED_CLASSES.has(raw) || ALLOWED_CLASSES.has(norm);
    });
}

/* ===================== Cálculo principal ===================== */
function calculateEstimate(inputBoxes: Box[], fallbackFile?: File): ApiResult {
  // Centralizamos el post-filtro aquí para TODOS los caminos
  const boxes = postFilter(inputBoxes);

  const pct = areaPct(boxes);
  const hasDetections = boxes.length > 0;

  let category: string;
  let severity: Severity;

  if (!hasDetections && fallbackFile) {
    const f = fallbackHeuristic(fallbackFile);
    severity = f.severity;
    category = f.category;
  } else {
    severity = inferSeverityFrom(boxes);
    category = classByArea(boxes);
  }

  let sevFactor = sevK(severity);
  const areaFactor = areaK(pct);

  let totalBaseCost = 0;
  const detailedBreakdown: DetailedBreakdownItem[] = [];
  const identifiedZones = new Set<string>();

  const detailedAreas = hasDetections ? getDetailedAreaLabels(boxes) : [];
  let finalAreaDescription: string;

  if (detailedAreas.length > 0 && detailedAreas[0] !== "zona no identificada") {
    finalAreaDescription = detailedAreas.join(" y ");
    for (const singleArea of detailedAreas) {
      const normalizedZone = normalizeZoneKey(singleArea);
      const baseCostForPart = getMatrixCost(category, singleArea);
      totalBaseCost += baseCostForPart;
      detailedBreakdown.push({ part: singleArea, base: baseCostForPart, zone: normalizedZone });
      identifiedZones.add(normalizedZone);
    }
  } else {
    const f = fallbackFile
      ? fallbackHeuristic(fallbackFile)
      : ({ category: "scratch", severity: "bajo", area: "zona no identificada" } as const);
    category = f.category;
    severity = f.severity;
    finalAreaDescription = f.area;
    const normalizedZone = normalizeZoneKey(finalAreaDescription);
    const baseCost = getMatrixCost(category, finalAreaDescription);
    totalBaseCost = baseCost;
    detailedBreakdown.push({ part: finalAreaDescription, base: baseCost, zone: normalizedZone });
    identifiedZones.add(normalizedZone);
  }

  // Reemplazo si hay daño muy grande y severo
  const REPLACEMENT_THRESHOLD = 0.10;
  const isReplacementNeeded = severity === "avanzado" && pct > REPLACEMENT_THRESHOLD;
  let customNote: string | undefined;

  if (isReplacementNeeded) {
    const mainPartZone = identifiedZones.values().next().value || "default";
    const replacementBaseCosts: Record<string, number> = {
      door_panel: 3500,
      bumper: 2800,
      hood: 4000,
      side_panel: 3800,
      lamp: 1800,
      default: 3000,
    };
    totalBaseCost = replacementBaseCosts[mainPartZone] ?? replacementBaseCosts["default"];
    if (detailedBreakdown.length > 0) detailedBreakdown[0].base = totalBaseCost;
    category = "reemplazo_de_pieza";
    customNote = "El daño es extenso y severo: se cotiza el reemplazo de la pieza principal.";
    sevFactor = 1.0;
  }

  const estimate = Math.round(totalBaseCost * sevFactor * areaFactor);
  const diy = pickDIY(category, severity, pct);

  const result: ApiResult = {
    severity,
    category,
    area: finalAreaDescription,
    estimate,
    diy,
    boxes,               // ya filtradas
    areaPct: pct,
    note: customNote,
    breakdown: {
      base: totalBaseCost,
      sevFactor,
      areaFactor,
      areaPct: pct,
      zone: identifiedZones.size > 1 ? "multiple" : (identifiedZones.values().next().value || "default"),
    },
    detailedBreakdown,
    insights: {
      topClasses: topClasses(boxes).slice(0, 3),
      recommendWorkshop: shouldRecommendWorkshop(severity, pct, boxes),
    },
  };

  return result;
}

/* ===================== Handler ===================== */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // Recalcular con boxes (JSON) o llamar detector con image_base64
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { boxes?: Box[]; note?: string; image_base64?: string };
      if (Array.isArray(body.boxes) && body.boxes.length > 0) {
        const result = calculateEstimate(body.boxes);
        if (body.note) result.note = result.note ? `${result.note} | ${body.note}` : body.note;
        return NextResponse.json(result);
      }
      if (typeof body.image_base64 === "string" && body.image_base64.length > 0) {
        const det = await callDetectorFromBase64(body.image_base64);
        const result = calculateEstimate(det.boxes ?? []);
        const finalNote = [result.note, det.note].filter(Boolean).join(" | ");
        result.note = finalNote || undefined;
        return NextResponse.json(result);
      }
      return NextResponse.json(
        { error: "Faltan 'boxes' o 'image_base64' en JSON." },
        { status: 400 }
      );
    }

    // Subida por formulario (multipart)
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();

      // 1) archivo
      const file = pickFileFromForm(form);
      if (file) {
        if ((file.type && !ALLOWED.includes(file.type)) && file.size > 0) {
          return NextResponse.json(
            { error: "Formato de imagen no soportado. Usa JPG, PNG o WEBP." },
            { status: 415 }
          );
        }
        if (file.size > MAX) {
          return NextResponse.json(
            { error: `Imagen demasiado grande (máximo ${MAX / (1024 * 1024)} MB).` },
            { status: 413 }
          );
        }
        const det = await callDetectorFromFile(file);
        const result = calculateEstimate(det.boxes ?? [], file);
        const finalNote = [result.note, det.note].filter(Boolean).join(" | ");
        result.note = finalNote || undefined;
        return NextResponse.json(result);
      }

      // 2) base64 en formulario
      const b64 = pickBase64FromForm(form);
      if (typeof b64 === "string") {
        const det = await callDetectorFromBase64(b64);
        const result = calculateEstimate(det.boxes ?? []);
        const finalNote = [result.note, det.note].filter(Boolean).join(" | ");
        result.note = finalNote || undefined;
        return NextResponse.json(result);
      }

      return NextResponse.json(
        { error: "No se subió ningun 'file'/'image' ni 'image_base64'." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Content-Type no soportado. Usa application/json o multipart/form-data." },
      { status: 415 }
    );
  } catch (error) {
    console.error("[estimate] crash:", error);
    return NextResponse.json(
      { error: "Error de servidor interno en la API de estimación." },
      { status: 500 }
    );
  }
}
