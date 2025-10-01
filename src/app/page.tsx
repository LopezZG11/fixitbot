"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";

/* ===================== Tipos ===================== */
type EstimateResult = {
  severity: "leve" | "medio" | "severo" | string;
  area: string;
  estimate: number;
};

/* ===================== Utils ===================== */
const formatMXN = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function isEstimateResult(v: unknown): v is EstimateResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.severity === "string" &&
    typeof o.area === "string" &&
    typeof o.estimate === "number"
  );
}

function severityColor(sev: EstimateResult["severity"]) {
  if (sev === "severo") return "bg-red-500/15 text-red-400 ring-red-500/30";
  if (sev === "medio") return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
  return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"; // leve / default
}

/* ===================== Página ===================== */
export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // Crear/limpiar URL de previsualización
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* ------------- Handlers ------------- */
  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) {
      setFile(f);
      setMsg("");
      setResult(null);
    } else {
      setMsg("Arrastra una imagen válida (jpg, png, etc.).");
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg("");
    setResult(null);

    if (!file) {
      setMsg("Primero selecciona o arrastra una imagen.");
      return;
    }

    const form = new FormData();
    form.append("image", file);

    try {
      setLoading(true);
      const res = await fetch("/api/estimate", { method: "POST", body: form });
      const data: unknown = await res.json();

      if (!res.ok) {
        const err = (data as { error?: unknown })?.error;
        setMsg(typeof err === "string" ? err : "Error en la estimación");
        return;
      }
      if (isEstimateResult(data)) {
        setResult(data);
      } else {
        setMsg("Respuesta inesperada del servidor.");
      }
    } catch {
      setMsg("No se pudo conectar con la API.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setMsg("");
  };

  /* ------------- UI ------------- */
  return (
    <div className="min-h-svh bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur supports-[backdrop-filter]:bg-white/5">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400">
              FixItBot
            </span>{" "}
            — MVP
          </h1>
          <div className="text-xs md:text-sm opacity-70">
            Visión por computadora • Cotización rápida
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto max-w-4xl px-6 py-8 grid lg:grid-cols-2 gap-6">
        {/* Card: Uploader */}
        <section className="rounded-2xl border border-white/10 bg-white/5 shadow-xl overflow-hidden">
          <div className="p-5 border-b border-white/10">
            <h2 className="font-medium">1) Sube o arrastra una imagen</h2>
          </div>

          <form onSubmit={onSubmit} className="p-5 space-y-5">
            {/* Dropzone */}
            <label
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={onDrop}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-center transition hover:border-white/25 hover:bg-white/10"
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && !f.type.startsWith("image/")) {
                    setMsg("Selecciona una imagen válida.");
                    return;
                  }
                  setFile(f);
                  setMsg("");
                  setResult(null);
                }}
                className="sr-only"
              />
              <div className="text-4xl leading-none">🖼️</div>
              <div className="text-sm">
                <b>Arrastra y suelta</b> una foto de la carrocería
                <br />
                <span className="opacity-70">o haz clic para seleccionar</span>
              </div>
              {file && (
                <div className="text-xs opacity-70">
                  Seleccionado: <b>{file.name}</b>
                </div>
              )}
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow ring-1 ring-inset ring-indigo-400/30 transition hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!file || loading}
              >
                {loading ? "Analizando…" : "Analizar daño"}
              </button>

              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 ring-1 ring-inset ring-white/10 transition hover:bg-white/10"
              >
                Limpiar
              </button>

              {msg && (
                <span
                  role="status"
                  aria-live="polite"
                  className="ml-auto text-xs text-red-400"
                >
                  {msg}
                </span>
              )}
            </div>
          </form>
        </section>

        {/* Card: Previsualización */}
        <section className="rounded-2xl border border-white/10 bg-white/5 shadow-xl overflow-hidden">
          <div className="p-5 border-b border-white/10">
            <h2 className="font-medium">2) Previsualización</h2>
          </div>

          <div className="p-5">
            {!previewUrl && (
              <div className="h-72 w-full rounded-xl border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-900/70 grid place-items-center text-sm opacity-70">
                Sin imagen seleccionada
              </div>
            )}

            {previewUrl && (
              <div className="relative w-full overflow-hidden rounded-xl border border-white/10">
                <Image
                  src={previewUrl}          // blob: URL
                  alt="Previsualización"
                  width={1280}
                  height={720}
                  unoptimized               // necesario para blob:/data:
                  className="h-auto w-full object-cover"
                  priority
                />
              </div>
            )}

            {/* Loader */}
            {loading && (
              <div className="mt-4 flex items-center gap-3 text-sm">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Procesando imagen…
              </div>
            )}

            {/* Resultado */}
            {result && !loading && (
              <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Resultado</h3>
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ${severityColor(
                      result.severity
                    )}`}
                    title={`Severidad: ${result.severity}`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                    {result.severity}
                  </span>
                </div>

                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-lg bg-white/5 p-3 ring-1 ring-inset ring-white/10">
                    <dt className="opacity-70">Zona estimada</dt>
                    <dd className="font-medium">{result.area}</dd>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3 ring-1 ring-inset ring-white/10">
                    <dt className="opacity-70">Costo aproximado</dt>
                    <dd className="font-medium">{formatMXN(result.estimate)}</dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs opacity-70">
                  *Estimación aproximada con fines académicos.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-4xl px-6 pb-8 pt-2 text-xs opacity-60">
        © {new Date().getFullYear()} FixItBot • Demo educativa
      </footer>
    </div>
  );
}
