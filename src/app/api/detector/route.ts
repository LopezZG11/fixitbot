// src/app/api/detector/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/* ========= Tipos ========= */
type Box = { x: number; y: number; w: number; h: number; cls: string; score?: number };

interface RFPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
  confidence?: number;
}

interface RFImageMeta {
  width?: number;
  height?: number;
}

interface RFResponse {
  predictions: RFPrediction[];
  image?: RFImageMeta;
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
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function normalizeClass(cls: string) {
  return cls.toLowerCase().replace(/[\s-]+/g, "_");
}

function stripDataUriPrefix(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

function sanitizeEnv(v: string) {
  // Quita espacios y comillas pegadas al guardar en Vercel
  return v.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

/* ========= Handler ========= */
export async function POST(req: NextRequest) {
  try {
    // Envs saneadas
    const MODEL = sanitizeEnv(process.env.ROBOFLOW_MODEL ?? "");
    const VERSION = sanitizeEnv(process.env.ROBOFLOW_VERSION ?? "1");
    const KEY = sanitizeEnv(process.env.ROBOFLOW_API_KEY ?? "");
    const CONF = sanitizeEnv(process.env.ROBOFLOW_CONFIDENCE ?? "0.25");
    const OVLP = sanitizeEnv(process.env.ROBOFLOW_OVERLAP ?? "0.45");

    if (!MODEL || !KEY) {
      console.error("[detector] Falta ROBOFLOW_MODEL o ROBOFLOW_API_KEY");
      return NextResponse.json(
        { error: "Faltan variables de entorno de Roboflow." },
        { status: 500 }
      );
    }
    if (KEY.startsWith("rf_")) {
      return NextResponse.json(
        {
          error:
            "La clave 'rf_' es publicable (client-side) y no sirve para detect.roboflow.com. Usa tu Private API Key.",
        },
        { status: 400 }
      );
    }

    const detectUrl =
      `https://detect.roboflow.com/${encodeURIComponent(MODEL)}/${encodeURIComponent(VERSION)}` +
      `?api_key=${encodeURIComponent(KEY)}` +
      `&confidence=${encodeURIComponent(CONF)}` +
      `&overlap=${encodeURIComponent(OVLP)}` +
      `&format=json`;

    const ct = req.headers.get("content-type") || "";
    let rfRes: Response;

    if (ct.includes("multipart/form-data")) {
      // === MULTIPART: aceptamos "file" (preferido) o "image_base64" ===
      const form = await req.formData();
      const file = form.get("file");
      const b64Maybe = form.get("image_base64");

      if (file instanceof File) {
        const buf = Buffer.from(await file.arrayBuffer());
        const fd = new FormData();
        fd.append("file", new Blob([buf]), file.name || "upload.jpg");
        rfRes = await fetch(detectUrl, { method: "POST", body: fd, cache: "no-store" });
      } else if (typeof b64Maybe === "string" && b64Maybe.length > 0) {
        const imgB64 = stripDataUriPrefix(b64Maybe);
        rfRes = await fetch(detectUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ image: imgB64 }).toString(),
          cache: "no-store",
        });
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
        return NextResponse.json(
          { error: "Falta 'image_base64' en JSON." },
          { status: 400 }
        );
      }

      const imgB64 = stripDataUriPrefix(b64);
      rfRes = await fetch(detectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ image: imgB64 }).toString(),
        cache: "no-store",
      });
    } else {
      return NextResponse.json(
        {
          error:
            "Content-Type no soportado. Usa multipart/form-data (file) o application/json (image_base64).",
        },
        { status: 415 }
      );
    }

    if (!rfRes.ok) {
      const txt = await rfRes.text().catch(() => "");
      const hint =
        rfRes.status === 403
          ? "Forbidden: Private API Key inválida (comillas/espacios), rota, o slug/versión del modelo no coincide con Roboflow."
          : undefined;
      console.error("[detector] Roboflow error:", rfRes.status, txt);
      return NextResponse.json(
        { error: `Roboflow ${rfRes.status}`, detail: txt.slice(0, 500), hint },
        { status: 502 }
      );
    }

    const rawUnknown: unknown = await rfRes.json();
    if (!isRFResponse(rawUnknown)) {
      console.error("[detector] Respuesta no válida de Roboflow:", rawUnknown);
      return NextResponse.json(
        { error: "Respuesta de Roboflow no válida" },
        { status: 502 }
      );
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
      };
    });

    return NextResponse.json({ boxes }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[detector] Crash:", msg);
    return NextResponse.json({ error: `Error en detector: ${msg}` }, { status: 500 });
  }
}
