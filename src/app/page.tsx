"use client";
import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";


type Severity = "bajo" | "intermedio" | "avanzado" | string;

type Box = {
  // Coordenadas normalizadas 0..1 (relativas al ancho/alto de la imagen)
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  score?: number;
};

type EstimateResult = {
  severity: Severity;
  area: string;
  category: string;
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
  boxes?: Box[];     // opcional: si el backend devuelve detecciones
  areaPct?: number;  // opcional: % de área dañada (0..1)
};

const formatMXN = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function isEstimateResult(v: unknown): v is EstimateResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.severity === "string" &&
    typeof o.area === "string" &&
    typeof o.category === "string" &&
    typeof o.estimate === "number"
  );
}

function severityBadge(sev: Severity) {
  if (sev === "avanzado") return "bg-red-500/15 text-red-400 ring-red-500/30";
  if (sev === "intermedio") return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
  return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
}

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg("");
    setResult(null);
    if (!file) {
      setMsg("Primero selecciona o arrastra una imagen.");
      return;
    }
    try {
      setLoading(true);
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/estimate", { method: "POST", body: form });
      const data: unknown = await res.json();

      if (!res.ok) {
        const err = (data as { error?: unknown })?.error;
        setMsg(typeof err === "string" ? err : "Error en la estimación");
        return;
      }
      if (isEstimateResult(data)) setResult(data);
      else setMsg("Respuesta inesperada del servidor.");
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

  const openNearbyWorkshops = () => {
    const query = encodeURIComponent("taller de hojalatería y pintura");
    const fallback = () =>
      window.open(`https://www.google.com/maps/search/${query}`, "_blank");
    if (!navigator.geolocation) return fallback();
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        window.open(
          `https://www.google.com/maps/search/${query}/@${coords.latitude},${coords.longitude},14z`,
          "_blank"
        );
      },
      fallback,
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-2 items-stretch">
        {/* Tarjeta: Uploader */}
        <section className="rounded-2xl border border-white/10 bg-white/5 shadow-xl overflow-hidden flex flex-col h-full">
          <div className="p-5 border-b border-white/10">
            <h2 className="font-medium">1) Sube o arrastra una imagen</h2>
          </div>

          <form onSubmit={onSubmit} className="p-5 flex flex-col gap-5 flex-1">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith("image/")) {
                  setFile(f);
                  setMsg("");
                  setResult(null);
                } else {
                  setMsg("Arrastra una imagen válida (jpg, png, etc.).");
                }
              }}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-center transition hover:border-white/25 hover:bg-white/10 h-56"
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

            <div className="mt-auto flex flex-wrap items-center gap-3">
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

        {/* Tarjeta: Previsualización + Resultado */}
        <section className="rounded-2xl border border-white/10 bg-white/5 shadow-xl overflow-hidden flex flex-col h-full">
          <div className="p-5 border-b border-white/10">
            <h2 className="font-medium">2) Previsualización</h2>
          </div>

          <div className="p-5 flex flex-col gap-5 flex-1">
            {!previewUrl && (
              <div className="h-56 w-full rounded-xl border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-900/70 grid place-items-center text-sm opacity-70">
                Sin imagen seleccionada
              </div>
            )}

            {previewUrl && (
              <div className="relative w-full overflow-hidden rounded-xl border border-white/10">
                <Image
                  src={previewUrl}
                  alt="Previsualización"
                  width={1280}
                  height={720}
                  unoptimized
                  className="h-auto w-full object-cover"
                  priority
                />

                {/* Overlay de cajas si el backend envía detecciones */}
                {result?.boxes?.map((b, i) => (
                  <div
                    key={i}
                    className="absolute border-2 border-emerald-400/80 rounded"
                    style={{
                      left: `${b.x * 100}%`,
                      top: `${b.y * 100}%`,
                      width: `${b.w * 100}%`,
                      height: `${b.h * 100}%`,
                      boxShadow: "0 0 0 1px rgba(16,185,129,.5) inset",
                    }}
                    title={`${b.cls}${b.score ? ` (${(b.score * 100).toFixed(0)}%)` : ""}`}
                  />
                ))}
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-3 text-sm">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Procesando imagen…
              </div>
            )}

            {result && !loading && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Resultado</h3>
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ${severityBadge(
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

                {/* DIY inline solo para 'bajo' */}
                {result?.diy && (
                  <div className="mt-4 rounded-lg bg-white/5 ring-1 ring-inset ring-white/10 p-3">
                    <div className="mb-2 text-sm opacity-75">Guía DIY sugerida</div>
                    <div className="font-medium">{result.diy.title}</div>
                    <div className="mt-2 aspect-video w-full overflow-hidden rounded-lg border border-white/10">
                      <iframe
                        src={result.diy.videoUrl.replace("watch?v=", "embed/")}
                        className="h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        title="DIY video"
                      />
                    </div>
                    <ol className="mt-3 list-decimal pl-5 text-sm opacity-90 space-y-1">
                      {result.diy.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={openNearbyWorkshops}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white ring-1 ring-emerald-400/30 hover:bg-emerald-400"
                  >
                    Ver talleres cercanos
                  </button>
                </div>

                <p className="mt-3 text-xs opacity-70">
                  *Estimación preliminar con fines informativos.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
