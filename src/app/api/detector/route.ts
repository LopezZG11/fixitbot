// src/app/api/detector/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";

/* ===== Tipos ===== */
type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  score?: number;
};

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

/* ===== Type guards ===== */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isRFPrediction(v: unknown): v is RFPrediction {
  return (
    isObject(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof (v as Record<string, unknown>).class === "string" &&
    (typeof (v as Record<string, unknown>).confidence === "number" ||
      typeof (v as Record<string, unknown>).confidence === "undefined")
  );
}

function isRFResponse(v: unknown): v is RFResponse {
  if (!isObject(v)) return false;
  const preds = (v as Record<string, unknown>)["predictions"];
  const img = (v as Record<string, unknown>)["image"];
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

/* ===== Helpers ===== */
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function normalizeClass(cls: string) {
  return cls.toLowerCase().replace(/\s+/g, "_");
}

function stripDataUriPrefix(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

function envVars() {
  const MODEL = (process.env.ROBOFLOW_MODEL ?? "").trim();
  const VERSION = (process.env.ROBOFLOW_VERSION ?? "1").trim();
  const KEY = (process.env.ROBOFLOW_API_KEY ?? "").trim();
  const CONF = (process.env.ROBOFLOW_CONFIDENCE ?? "0.25").trim();
  const OVLP = (process.env.ROBOFLOW_OVERLAP ?? "0.45").trim();
  return { MODEL, VERSION, KEY, CONF, OVLP };
}

/* ===== Handler ===== */
export async function POST(req: NextRequest) {
  try {
    const { MODEL, VERSION, KEY, CONF, OVLP } = envVars();

    if (!MODEL || !KEY) {
      console.error("[detector] Falta ROBOFLOW_MODEL o ROBOFLOW_API_KEY");
      return NextResponse.json(
        { error: "Faltan variables de entorno de Roboflow." },
        { status: 500 }
      );
    }

    // Aviso común: publishable key (rf_...) no funciona en detect.roboflow.com
    if (KEY.startsWith("rf_")) {
      return NextResponse.json(
        {
          error:
            "La clave 'rf_' es publicable y no sirve para Inference. Usa la Private API Key del Workspace.",
        },
        { status: 400 }
      );
    }

    const url =
      `https://detect.roboflow.com/${encodeURIComponent(MODEL)}/${encodeURIComponent(
        VERSION
      )}` +
      `?api_key=${encodeURIComponent(KEY)}` +
      `&confidence=${encodeURIComponent(CONF)}` +
      `&overlap=${encodeURIComponent(OVLP)}` +
      `&format=json`;

    const ct = req.headers.get("content-type") || "";
    let rfRes: Response;

    if (ct.includes("multipart/form-data")) {
      // === MULTIPART: soporta "file" (recomendado) o "image_base64"
      const form = await req.formData();
      const file = form.get("file");
      const b64Maybe = form.get("image_base64");

      if (file instanceof File) {
        const buf = Buffer.from(await file.arrayBuffer());
        const fd = new FormData();
        fd.append("file", new Blob([buf]), file.name || "upload.jpg");

        rfRes = await fetch(url, {
          method: "POST",
          body: fd,
          cache: "no-store",
          headers: { "User-Agent": "fixitbot-vercel/1.0" },
        });
      } else if (typeof b64Maybe === "string" && b64Maybe.length > 0) {
        const imageB64 = stripDataUriPrefix(b64Maybe);
        rfRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "fixitbot-vercel/1.0",
          },
          body: new URLSearchParams({ image: imageB64 }).toString(),
          cache: "no-store",
        });
      } else {
        return NextResponse.json(
          { error: "No se encontró 'file' ni 'image_base64' en multipart." },
          { status: 400 }
        );
      }
    } else if (ct.includes("application/json")) {
      // === JSON: espera { image_base64 }
      const bodyUnknown: unknown = await req.json();
      const b64 =
        isObject(bodyUnknown) && typeof bodyUnknown["image_base64"] === "string"
          ? (bodyUnknown["image_base64"] as string)
          : "";

      if (!b64) {
        return NextResponse.json(
          { error: "Falta image_base64 en JSON." },
          { status: 400 }
        );
      }

      const imageB64 = stripDataUriPrefix(b64);

      rfRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "fixitbot-vercel/1.0",
        },
        body: new URLSearchParams({ image: imageB64 }).toString(),
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
      console.error("[detector] Roboflow error:", rfRes.status, txt);
      // Mensaje claro para 403
      const hint403 =
        rfRes.status === 403
          ? "Forbidden: suele ser clave privada inválida, revocada o workspace/proyecto sin permisos."
          : undefined;

      return NextResponse.json(
        {
          error: `Roboflow ${rfRes.status}`,
          detail: txt.slice(0, 500),
          hint: hint403,
        },
        { status: 502 }
      );
    }

    const raw: unknown = await rfRes.json();

    if (!isRFResponse(raw)) {
      console.error("[detector] Respuesta no válida de Roboflow:", raw);
      return NextResponse.json(
        { error: "Respuesta de Roboflow no válida" },
        { status: 502 }
      );
    }

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
    return NextResponse.json(
      { error: `Error en detector: ${msg}` },
      { status: 500 }
    );
  }
}
