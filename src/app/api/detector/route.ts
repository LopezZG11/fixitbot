// src/app/api/detector/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";

/* ========= Tipos ========= */
type Box = { x: number; y: number; w: number; h: number; cls: string; score?: number; area?: number };

interface RFPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
  confidence?: number;
  area_pct?: number;
}
interface RFImageMeta {
  width?: number;
  height?: number;
}
interface RFResponse {
  predictions: RFPrediction[];
  image?: RFImageMeta;
  weak_signal?: boolean;
  weak_top?: Array<{ cls: string; confidence: number }>;
}

/* ========= Type Guards ========= */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isRFPrediction(v: unknown): v is RFPrediction {
  if (!isObject(v)) return false;
  const x = (v as Record<string, unknown>).x;
  const y = (v as Record<string, unknown>).y;
  const w = (v as Record<string, unknown>).width;
  const h = (v as Record<string, unknown>).height;
  const cls = (v as Record<string, unknown>).class;
  const conf = (v as Record<string, unknown>).confidence;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof w === "number" &&
    typeof h === "number" &&
    typeof cls === "string" &&
    (typeof conf === "number" || typeof conf === "undefined")
  );
}

function isRFResponse(v: unknown): v is RFResponse {
  if (!isObject(v)) return false;
  const preds = (v as Record<string, unknown>).predictions;
  const img = (v as Record<string, unknown>).image;
  const predsOk = Array.isArray(preds) && preds.every(isRFPrediction);
  const imgOk =
    typeof img === "undefined" ||
    (isObject(img) &&
      (typeof (img as Record<string, unknown>).width === "number" ||
        typeof (img as Record<string, unknown>).width === "undefined") &&
      (typeof (img as Record<string, unknown>).height === "number" ||
        typeof (img as Record<string, unknown>).height === "undefined"));
  return predsOk && imgOk;
}

/* ========= Helpers ========= */
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function normalizeClass(cls: string) {
  return cls.toLowerCase().replace(/[\s-]+/g, "_");
}

function stripDataUriPrefix(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

function sanitizeEnv(v: string) {
  return v.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

/* ========= Handler ========= */
export async function POST(req: NextRequest) {
  try {
    const DETECTOR_URL = sanitizeEnv(process.env.DAMAGE_DETECTOR_URL ?? "");
    if (!DETECTOR_URL) {
      return NextResponse.json(
        { error: "Falta DAMAGE_DETECTOR_URL en .env.local (ej: http://127.0.0.1:8001/predict)" },
        { status: 500 }
      );
    }

    const ct = req.headers.get("content-type") || "";
    let svcRes: Response;

    if (ct.includes("multipart/form-data")) {
      // === MULTIPART: aceptamos "file" (preferido) o "image_base64" ===
      const form = await req.formData();
      const file = form.get("file");
      const b64Maybe = form.get("image_base64");

      if (file instanceof File) {
        const buf = Buffer.from(await file.arrayBuffer());
        const fd = new FormData();
        fd.append("file", new Blob([buf]), file.name || "upload.jpg");
        svcRes = await fetch(DETECTOR_URL, { method: "POST", body: fd, cache: "no-store" });
      } else if (typeof b64Maybe === "string" && b64Maybe.length > 0) {
        const imgB64 = stripDataUriPrefix(b64Maybe);
        const buf = Buffer.from(imgB64, "base64");
        const fd = new FormData();
        fd.append("file", new Blob([buf]), "upload.jpg");
        svcRes = await fetch(DETECTOR_URL, { method: "POST", body: fd, cache: "no-store" });
      } else {
        return NextResponse.json(
          { error: "No se encontró 'file' ni 'image_base64' en multipart." },
          { status: 400 }
        );
      }
    } else if (ct.includes("application/json")) {
      // === JSON: { image_base64 } ===
      const bodyUnknown: unknown = await req.json();
      const b64 =
        isObject(bodyUnknown) && typeof bodyUnknown["image_base64"] === "string"
          ? (bodyUnknown["image_base64"] as string)
          : "";

      if (!b64) {
        return NextResponse.json({ error: "Falta 'image_base64' en JSON." }, { status: 400 });
      }

      const imgB64 = stripDataUriPrefix(b64);
      const buf = Buffer.from(imgB64, "base64");
      const fd = new FormData();
      fd.append("file", new Blob([buf]), "upload.jpg");

      svcRes = await fetch(DETECTOR_URL, { method: "POST", body: fd, cache: "no-store" });
    } else {
      return NextResponse.json(
        {
          error: "Content-Type no soportado. Usa multipart/form-data (file) o application/json (image_base64).",
        },
        { status: 415 }
      );
    }

    if (!svcRes.ok) {
      const txt = await svcRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Detector service ${svcRes.status}`, detail: txt.slice(0, 500) },
        { status: 502 }
      );
    }

    const rawUnknown: unknown = await svcRes.json();
    if (!isRFResponse(rawUnknown)) {
      return NextResponse.json({ error: "Respuesta del servicio IA no válida" }, { status: 502 });
    }

    const raw = rawUnknown as RFResponse;
    const iw = raw.image?.width ?? 1;
    const ih = raw.image?.height ?? 1;

    const boxes: Box[] = raw.predictions.map((p) => {
      const x = (p.x - p.width / 2) / iw;
      const y = (p.y - p.height / 2) / ih;
      const w = p.width / iw;
      const h = p.height / ih;
      return {
        x: clamp01(x),
        y: clamp01(y),
        w: clamp01(w),
        h: clamp01(h),
        cls: normalizeClass(p.class),
        score: p.confidence,
        area: typeof p.area_pct === "number" ? clamp01(p.area_pct) : undefined,
      };
    });

    return NextResponse.json({ boxes,
    weak_signal: raw.weak_signal ?? false,
    weak_top: raw.weak_top ?? [], }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Error en detector: ${msg}` }, { status: 500 });
  }
}