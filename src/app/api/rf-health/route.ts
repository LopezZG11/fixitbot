// src/app/api/rf-health/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitize(v: string) {
  // quita espacios y comillas pegadas al guardar en Vercel
  return v.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

export async function GET() {
  try {
    const rawMODEL   = process.env.ROBOFLOW_MODEL ?? "";
    const rawVERSION = process.env.ROBOFLOW_VERSION ?? "1";
    const rawKEY     = process.env.ROBOFLOW_API_KEY ?? "";

    const MODEL   = sanitize(rawMODEL);
    const VERSION = sanitize(rawVERSION);
    const KEY     = sanitize(rawKEY);

    // 1) Ping a Roboflow raíz (debe decir "Welcome…")
    const ping = await fetch(`https://api.roboflow.com/?api_key=${encodeURIComponent(KEY)}`, {
      cache: "no-store",
      headers: { "User-Agent": "fixitbot-health/1.0" },
    });
    const pingText = await ping.text();

    return NextResponse.json({
      ok: true,
      // NO devolvemos la key, solo pistas seguras
      model: MODEL,
      version: VERSION,
      key_len: KEY.length,
      key_prefix: KEY.slice(0, 4),
      key_suffix: KEY.slice(-4),
      looks_publishable: KEY.startsWith("rf_"),
      ping_status: ping.status,
      ping_preview: pingText.slice(0, 80),
      hint:
        "Si ping_status !== 200 o ping_preview no contiene 'Welcome', la key es inválida/en mal formato.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
