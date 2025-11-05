// src/app/api/estimate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer"; // Para manejar imágenes como Buffer

export const runtime = "nodejs";

/* ===================== Tipos ===================== */
type Severity = "bajo" | "intermedio" | "avanzado" | "Revisión Requerida " | string;

type Box = {
  // Coordenadas NORMALIZADAS 0..1 relativas al ancho/alto de la imagen
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;        // clase normalizada (snake_case, minúsculas)
  score?: number;     // 0..1
};

type DetectorOut = {
  boxes?: Box[];
  area?: string;
  note?: string;
};

type DetailedBreakdownItem = {
  part: string;       // Descripción de la pieza, ej: "faro (derecho)"
  base: number;       // Costo base de reparación para esta pieza
  zone: string;       // Clave de la zona usada en la matriz, ej: "lamp"
};

type ApiResult = {
  severity: Severity;
  area: string;       // Descripción compuesta, ej: "faro (derecho) y salpicadera (derecho)"
  category: string;   // clase dominante del detector (normalizada)
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
  boxes?: Box[];
  areaPct?: number;   // 0..1
  note?: string;      // info extra si el detector falló
  breakdown?: {
    base: number;     // Suma de todos los costos base
    sevFactor: number;
    areaFactor: number;
    areaPct: number;
    zone: string;     // Ahora será "multiple" o la zona única
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
const FRIENDLY_DIY = new Set([
  "scratch", "paint_damage", "bumper_scuff", "dent", "door_ding",
  "paint_transfer", "headlight_restore", "plastic_bumper_crack_small",
  "clearcoat_chip", "rust_corrosion", "flat_tire",
]);

/* ============== DIY curado (ajusta videos) ============== */
const DIY_LIBRARY: Record<string, { title: string; videoUrl: string; steps: string[] }> = {
  // --- Rayones / despintaduras leves ---
  scratch: {
    title: "Pulido de rayón leve (sin traspasar barniz)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza con video real
    steps: [
      "Lava y seca el área para evitar arrastrar suciedad.",
      "Enmascara orillas con cinta para no tocar piezas adyacentes.",
      "Aplica unas gotas de compuesto pulidor (corte medio) en un pad de espuma.",
      "Pulir con movimientos circulares y presión ligera, 30-60 s por pasada.",
      "Retira residuo con microfibra; revisa a contraluz.",
      "Si persiste, repite 1-2 ciclos; finaliza con polish de acabado y cera."
    ],
  },
  paint_damage: {
    title: "Retoque puntual de pintura en defensa/guardafango",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Desengrasa el área con alcohol isopropílico.",
      "Lija muy suave al agua (grano 2000) SOLO si hay rebabas.",
      "Seca; aplica pintura de retoque del color (capa fina).",
      "Espera 10-15 min; aplica 2-3 capas finas hasta cubrir.",
      "Cuando cure, aplica barniz de retoque y deja secar.",
      "Empareja con compound ligero y microfibra."
    ],
  },
  bumper_scuff: {
    title: "Eliminación de marcas superficiales en defensa (plástico pintado)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Lava/Desengrasa el área (APC o isopropílico).",
      "Si la marca es transferencia de otra pintura, frota con clay bar o APC.",
      "Pulido con compuesto suave; dos pasadas controladas.",
      "Si hubo pérdida de pintura, realiza retoque puntual (ver guía “paint_damage”)."
    ],
  },
  // --- Abolladuras pequeñas ---
  dent: {
    title: "PDR casero para abolladura pequeña (sin romper pintura)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Calienta ligeramente el panel (secadora, 30-60 s; no sobrecalientes).",
      "Coloca ventosa o tab de pegamento en el centro del golpe.",
      "Tira con incrementos cortos; revisa reflejos.",
      "Corrige alta/baja con martillo de teflón y puntero de nylon.",
      "Repite hasta nivelar; limpia residuos de pegamento."
    ],
  },
  door_ding: {
    title: "Ding de puerta (pequeño) con kit de ventosa",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Limpia y desengrasa; identifica el centro del ding.",
      "Pega tab pequeño con pegamento caliente; deja 1-2 min.",
      "Tira con el puente/slide hammer con golpes cortos.",
      "Golpecitos muy suaves en el perímetro para “soltar” tensiones.",
      "Repite hasta que el reflejo quede uniforme."
    ],
  },
  // --- Óxido superficial ---
  rust_corrosion: {
    title: "Tratamiento de óxido superficial (antes de que avance)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Lijar puntualmente (grano 320-600) hasta metal sano.",
      "Aspirar/purgar polvo; desengrasar (isopropílico).",
      "Aplicar convertidor de óxido (según fabricante) y dejar curar.",
      "Imprimación anticorrosiva en 1-2 capas; dejar secar.",
      "Color de retoque en capas finas; finalizar con barniz.",
      "Pulido de integración tras curado."
    ],
  },
  // --- Astilla en barniz ---
  clearcoat_chip: {
    title: "Reparación de astilla de barniz (chip pequeño)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Limpia y desengrasa la zona.",
      "Con palillo o micro-brocha, coloca una gota de barniz de retoque en el chip.",
      "Deja nivelar y curar (según producto).",
      "Pulido suave para emparejar brillo."
    ],
  },
  // --- Pinchazo en banda de rodadura ---
  flat_tire: {
    title: "Reparación temporal de pinchazo (mecha) — banda de rodadura",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Ubica el clavo/objeto y márcalo.",
      "Extrae el objeto; agranda el orificio con la herramienta en T.",
      "Inserta mecha con pegamento; gira y retira dejando 1 cm afuera.",
      "Corta excedente; infla a presión recomendada.",
      "Rocía agua jabonosa para comprobar fugas.",
      "Acude a vulcanizadora para reparación permanente."
    ],
  },
  // --- Faros opacos (no faro roto) ---
  headlight_restore: {
    title: "Restauración de faro opaco (pulido + sellado UV)",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Enmascara alrededor del faro.",
      "Lijado progresivo (1000→2000) en húmedo, recto y sin presionar de más.",
      "Pulido con compuesto plástico hasta transparencia.",
      "Aplica sellador UV específico (o barniz apto para policarbonato)."
    ],
  },
  // --- Grieta pequeña en plástico de defensa ---
  plastic_bumper_crack_small: {
    title: "Reparación básica de grieta pequeña en defensa plástica",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Desmonta o libera la sección para trabajar cómodo (si es posible).",
      "Bisela ligeramente la grieta por detrás; limpia y desengrasa.",
      "Aplica resina/epoxi para plástico + malla; deja curar.",
      "Lija y emplasta si requiere; fondo, color y barniz.",
      "Pulido final para integrar."
    ],
  },
  // --- Transferencia de pintura de otro auto ---
  paint_transfer: {
    title: "Quitar transferencia de pintura sin repintar",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // TODO: reemplaza
    steps: [
      "Aplica APC/citrus en la marca; deja actuar 1–2 min.",
      "Frota con clay bar o borrador melamínico MUY suave.",
      "Pulido ligero para recuperar brillo.",
      "Si faltó pintura, usa guía de retoque (‘paint_damage’)."
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
        if (/lamp|headlight/i.test(b.cls)) {
            part = `faro (${side})`;
        } else if (/tire|llanta/i.test(b.cls)) {
            part = `llanta (${side})`;
        } else if (/mirror|espejo/i.test(b.cls)) {
            part = `espejo (${side})`;
        } else if (vPos === "inferior" || /bumper|defensa/.test(b.cls)) {
            part = `defensa (${side})`;
        } else if (/door|puerta/i.test(b.cls)) {
            part = `puerta (${side})`;
        } else if (/fender|salpicadera/i.test(b.cls)) {
            part = `salpicadera (${side})`;
        } else if (/hood|cofre/i.test(b.cls)) {
            part = "cofre";
        } else if (/roof|techo/i.test(b.cls)) {
            part = "techo";
        } else if (/trunk|cajuela/i.test(b.cls)) {
            part = "cajuela";
        } else if (/quarter[_|\s]?panel|costado/.test(b.cls)) {
            part = `costado (${side})`;
        } else {
            part = `panel (${side} ${vPos})`;
        }
        identifiedParts.add(part);
    }
    return Array.from(identifiedParts);
}

// ===================== LÓGICA DE PRECIOS AJUSTADA =====================

function normalizeZoneKey(areaLabel: string): string {
  if (/puerta|door/i.test(areaLabel)) return 'door_panel';
  if (/salpicadera|fender/i.test(areaLabel)) return 'door_panel';
  if (/defensa|bumper/i.test(areaLabel)) return 'bumper';
  if (/cofre|hood/i.test(areaLabel)) return 'hood';
  if (/techo|roof/i.test(areaLabel)) return 'roof';
  if (/costado|quarter_panel/i.test(areaLabel)) return 'side_panel';
  if (/faro|lamp|headlight/i.test(areaLabel)) return 'lamp';
  if (/llanta|tire/i.test(areaLabel)) return 'tire';
  if (/cristal|glass/i.test(areaLabel)) return 'glass';
  if (/espejo|mirror/i.test(areaLabel)) return 'mirror';
  return 'default';
}

function getMatrixCost(category: string, area: string): number {
  const normalizedCategory = normalizeClass(category);
  const normalizedZone = normalizeZoneKey(area);

  /*
   * ========================================================================
   * AJUSTE CLAVE: LÓGICA DE PRECIOS AL ESTILO "MECÁNICO DE BARRIO"
   * ------------------------------------------------------------------------
   * Estos precios base son más bajos y realistas para un taller local.
   * Reflejan el costo de la reparación o el reemplazo con piezas
   * de aftermarket/uso, no con piezas nuevas de agencia.
   * ========================================================================
   */
  const priceMatrix: Record<string, Record<string, number>> = {
    scratch: { bumper: 300, door_panel: 400, hood: 450, side_panel: 500, roof: 600, default: 400 },
    dent: { bumper: 600, door_panel: 750, hood: 1100, side_panel: 1200, roof: 1500, default: 900 },
    door_ding: { door_panel: 500, side_panel: 600, default: 550 },
    paint_damage: { mirror: 400, bumper: 650, door_panel: 900, hood: 1200, side_panel: 1100, roof: 1000, default: 800 },
    // El precio de un faro roto ahora refleja conseguir uno de uso o aftermarket, no nuevo de agencia.
    lamp_broken: { lamp: 1200, default: 1200 },
    glass_shatter: { glass: 1500, default: 1500 },
    crack: { bumper: 950, default: 1100 },
    rust_corrosion: { door_panel: 800, side_panel: 1000, default: 900 },
    flat_tire: { tire: 150, default: 150 },
    // La restauración de faros es un servicio común y económico en un taller.
    headlight_restore: { lamp: 500, default: 500 },
  };

  const categoryPrices = priceMatrix[normalizedCategory];
  if (categoryPrices) {
    return categoryPrices[normalizedZone] || categoryPrices['default'] || 850; // Fallback más bajo
  }
  return 850; // Fallback más bajo
}

// AJUSTE CLAVE: Factores de severidad más moderados, al estilo de taller local.
const sevK = (s: Severity) => (s === "bajo" ? 1.0 : s === "intermedio" ? 1.3 : 1.6);
// AJUSTE CLAVE: Factor de área ligeramente ajustado para no castigar tanto el tamaño.
const areaK = (pct: number) => 1 + Math.min(pct, 0.25) * 1.5;


// ===================== LÓGICA DE DIY Y TALLER (Sin cambios) =====================
function pickDIY(category: string, sev: Severity, areaPct = 0) {
  const allowIntermedioSmall = sev === "intermedio" && areaPct <= 0.03;
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
    const w = (b.w * b.h) * (typeof b.score === "number" ? 0.5 + 0.5 * clamp01(b.score) : 0.5);
    acc.set(cls, (acc.get(cls) ?? 0) + w);
  }
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([cls, weight]) => ({ cls, weight }));
}

function shouldRecommendWorkshop(sev: Severity, pct: number, boxes: Box[]) {
  const hasHard = boxes.some(b => HARD_CLASSES.test(b.cls));
  return sev === "avanzado" || pct > 0.08 || hasHard;
}


/*
 * ========================================================================
 * NUEVA FUNCIÓN: calculateEstimate
 * ------------------------------------------------------------------------
 * Contiene toda la lógica para calcular la cotización y el desglose,
 * basándose en un array de 'boxes' (detectadas o corregidas).
 * ========================================================================
 */
function calculateEstimate(boxes: Box[], fallbackFile?: File): ApiResult {
    let category: string;
    let severity: Severity;
    
    const pct = areaPct(boxes);
    const hasDetections = boxes.length > 0;

    // Si no hay detecciones y se proporciona un archivo de fallback (para la primera carga con errores)
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
    let finalAreaDescription: string;
    const identifiedZones = new Set<string>();

    const detailedAreas = hasDetections ? getDetailedAreaLabels(boxes) : [];

    if (detailedAreas.length > 0 && detailedAreas[0] !== "zona no identificada") {
        finalAreaDescription = detailedAreas.join(' y ');
        for (const singleArea of detailedAreas) {
            const normalizedZone = normalizeZoneKey(singleArea);
            const baseCostForPart = getMatrixCost(category, singleArea); // Usar la categoría general de la imagen por ahora
            totalBaseCost += baseCostForPart;
            detailedBreakdown.push({ part: singleArea, base: baseCostForPart, zone: normalizedZone });
            identifiedZones.add(normalizedZone);
        }
    } else {
        // Fallback si no se identificaron áreas específicas, incluso con boxes
        const f = fallbackFile ? fallbackHeuristic(fallbackFile) : { category: 'scratch', severity: 'bajo', area: 'zona no identificada' } as const;
        category = f.category;
        severity = f.severity;
        finalAreaDescription = f.area;
        const normalizedZone = normalizeZoneKey(finalAreaDescription);
        const baseCost = getMatrixCost(category, finalAreaDescription);
        totalBaseCost = baseCost;
        detailedBreakdown.push({ part: finalAreaDescription, base: baseCost, zone: normalizedZone });
        identifiedZones.add(normalizedZone);
    }
    
    const REPLACEMENT_THRESHOLD = 0.10; // 8% del área de la imagen
    const isReplacementNeeded = severity === 'avanzado' && pct > REPLACEMENT_THRESHOLD;
    let customNote: string | undefined;

    if (isReplacementNeeded) {
        // 1. Identificar la pieza principal (la más grande) para el reemplazo.
        const mainPartZone = identifiedZones.values().next().value || 'default';

        // 2. Definir costos base de REEMPLAZO (más altos que los de reparación).
        //    Estos incluyen la pieza (yonke/aftermarket) + pintura completa.
        const replacementBaseCosts: Record<string, number> = {
            door_panel: 3500,
            bumper: 2800,
            hood: 4000,
            side_panel: 3800,
            lamp: 1800, // Reemplazo de faro completo
            default: 3000,
        };

        // 3. Anular el costo base calculado y usar el de reemplazo.
        totalBaseCost = replacementBaseCosts[mainPartZone] || replacementBaseCosts['default'];
        
        // 4. Actualizar el desglose para reflejar el cambio.
        if (detailedBreakdown.length > 0) {
            detailedBreakdown[0].base = totalBaseCost;
        }

        // 5. Modificar la categoría y añadir una nota para el usuario.
        category = 'reemplazo_de_pieza';
        customNote = `El daño es extenso y severo. Se cotiza el reemplazo de la pieza principal, no la reparación.`;

        // 6. Al ser reemplazo, los factores de severidad y área ya no aplican de la misma forma.
        //    Podemos moderarlos o eliminarlos para que el costo base sea el dominante.
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
      boxes,
      areaPct: pct,
      note: customNote, // Asignamos la nota personalizada aquí
      breakdown: {
        base: totalBaseCost,
        sevFactor,
        areaFactor,
        areaPct: pct,
        zone: identifiedZones.size > 1 ? 'multiple' : (identifiedZones.values().next().value || 'default'),
      },
      detailedBreakdown,
      insights: {
        topClasses: topClasses(boxes).slice(0, 3),
        recommendWorkshop: shouldRecommendWorkshop(severity, pct, boxes),
      },
    };
    return result;
}

/*
 * ========================================================================
 * AJUSTE CLAVE: Función callDetector ahora llama a tu API local /api/detector
 * ------------------------------------------------------------------------
 * Esto asegura que la lógica del detector esté centralizada y sea consistente.
 * ========================================================================
 */
async function callDetector(file: File): Promise<DetectorOut> {
    const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'http://localhost:3000'; 

  const detApiUrl = new URL('/api/detector', baseUrl);
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
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
  return r.json() as Promise<DetectorOut>;
}

function fallbackHeuristic(file: File) { 
  const size = file.size; 
  const severity: Severity = size < 800_000 ? "bajo" : size < 1_600_000 ? "intermedio" : "avanzado";
  const category = size < 800_000 ? "scratch" : size < 1_600_000 ? "paint_damage" : "dent";
  const area = "componente exterior (estimado)";

  return { severity, category, area };
}


export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let result: ApiResult;
    let detectorNote: string | undefined;

    if (contentType.includes("application/json")) {
      const body = await req.json() as { boxes?: Box[], note?: string };
      if (!body.boxes || !Array.isArray(body.boxes)) {
        return NextResponse.json({ error: "Faltan 'boxes' en el cuerpo del JSON para recalcular." }, { status: 400 });
      }
      result = calculateEstimate(body.boxes);
      detectorNote = body.note; 
      
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fAny = form.get("image");
      if (!(fAny instanceof Blob)) {
        return NextResponse.json({ error: "No se subió ninguna imagen." }, { status: 400 });
      }
      const file = fAny as File;

      if (!ALLOWED.includes(file.type || "")) {
        return NextResponse.json({ error: "Formato de imagen no soportado. Usa JPG, PNG o WEBP." }, { status: 415 });
      }
      if (file.size > MAX) {
        return NextResponse.json({ error: `Imagen demasiado grande (máximo ${MAX / (1024 * 1024)} MB).` }, { status: 413 });
      }

      const det = await callDetector(file);
      result = calculateEstimate(det.boxes ?? [], file);
      detectorNote = det.note;

    } else {
      return NextResponse.json({ error: "Content-Type no soportado. Usa application/json o multipart/form-data." }, { status: 415 });
    }

    // Combinar la nota de reemplazo con la nota del detector, si existen.
    const finalNote = [result.note, detectorNote].filter(Boolean).join(' | ');
    result.note = finalNote || undefined;

    return NextResponse.json(result);

  } catch (error) {
    console.error("Error en la API de estimación:", error);
    return NextResponse.json({ error: "Error de servidor interno en la API de estimación." }, { status: 500 });
  }
}
