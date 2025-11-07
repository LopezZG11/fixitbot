import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Step =
  | { step: "base"; status: number; body: string }
  | { step: "detect"; status: number; body: string };

interface EnvInfo {
  model: string;
  version: string;
  keyLen: number;
  keyStartsWith_rf: boolean;
}

interface SelfTestOk {
  ok: true;
  env: EnvInfo;
  steps: Step[];
}

interface SelfTestFail {
  ok: false;
  env: EnvInfo;
  steps: Step[];
  error: string;
}

function makeEnv(): EnvInfo {
  const model = (process.env.ROBOFLOW_MODEL ?? "").trim();
  const version = (process.env.ROBOFLOW_VERSION ?? "1").trim();
  const keyRaw = process.env.ROBOFLOW_API_KEY ?? "";
  const key = keyRaw.trim();
  return {
    model,
    version,
    keyLen: key.length,
    keyStartsWith_rf: key.startsWith("rf_"),
  };
}

export async function GET() {
  const env = makeEnv();
  const steps: Step[] = [];
  const key = (process.env.ROBOFLOW_API_KEY ?? "").trim();

  try {
    // Paso 1: base API (debe decir "Welcome...")
    const baseRes = await fetch(
      `https://api.roboflow.com/?api_key=${encodeURIComponent(key)}`,
      { cache: "no-store" }
    );
    const baseTxt = await baseRes.text();
    steps.push({ step: "base", status: baseRes.status, body: baseTxt.slice(0, 200) });

    if (!baseRes.ok) {
      const fail: SelfTestFail = {
        ok: false,
        env,
        steps,
        error: "Roboflow base API no responde 200 (clave inválida o mal pegada).",
      };
      return NextResponse.json(fail, { status: 500 });
    }

    // Paso 2: intento de detect sin archivo (para validar auth -> NO debería dar 403)
    const url = `https://detect.roboflow.com/${env.model}/${env.version}?api_key=${encodeURIComponent(
      key
    )}&format=json`;
    const fd = new FormData(); // sin file, sólo prueba de auth
    const detRes = await fetch(url, {
      method: "POST",
      body: fd,
      headers: { "User-Agent": "fixitbot-vercel/1.0" },
      cache: "no-store",
    });
    const detTxt = await detRes.text();
    steps.push({ step: "detect", status: detRes.status, body: detTxt.slice(0, 200) });

    const ok: SelfTestOk = { ok: true, env, steps };
    return NextResponse.json(ok, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fail: SelfTestFail = { ok: false, env, steps, error: msg };
    return NextResponse.json(fail, { status: 500 });
  }
}
