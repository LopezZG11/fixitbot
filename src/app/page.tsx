"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { track } from "@vercel/analytics";
import * as Sentry from "@sentry/nextjs";

/* =================== Tipos =================== */
type Severity = "bajo" | "intermedio" | "avanzado" | "Revisión Requerida " | string;

type Box = {
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
  boxes?: Box[];
  areaPct?: number;
  breakdown?: { base: number; sevFactor: number; areaFactor: number; areaPct?: number };
};

/* ================= Utilidades ================= */
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

const fileToDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function severityBadge(sev: Severity) {
  if (sev === "avanzado") return "bg-red-500/15 text-red-400 ring-red-500/30";
  if (sev === "intermedio") return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
  return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
}

/* =============== Componente =============== */
export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // Cámara
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Preview del archivo (evita mostrar cuando la cámara está abierta)
  useEffect(() => {
    if (!file || isCameraOpen) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isCameraOpen]);

  // Manejo del stream de cámara
  useEffect(() => {
    if (isCameraOpen) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          const v = videoRef.current;
          if (v) {
            v.srcObject = stream;
          }
        })
        .catch((err) => {
          console.error("Error al acceder a la cámara:", err);
          Sentry.captureException(err);
          setMsg("No se pudo acceder a la cámara. Revisa los permisos.");
          setIsCameraOpen(false);
        });
    } else {
      const v = videoRef.current;
      if (v && v.srcObject) {
        const stream = v.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }
    }
  }, [isCameraOpen]);

  // Capturar foto desde la cámara
  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const captured = new File([blob], `captura-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          setFile(captured);
          setMsg("");
          setResult(null);
        }
        setIsCameraOpen(false);
      },
      "image/jpeg",
      0.95
    );
  };

  // Enviar a /api/estimate
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
      track("analyze_click");

      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/estimate", { method: "POST", body: form });
      const data: unknown = await res.json();

      if (!res.ok) {
        const errMsg = (data as { error?: unknown })?.error;
        setMsg(typeof errMsg === "string" ? errMsg : "Error en la estimación");
        track("analyze_error", { status: res.status });
        return;
      }

      if (isEstimateResult(data)) {
        setResult(data);
        track("analyze_result", {
          severity: data.severity,
          estimate: data.estimate,
        });
      } else {
        setMsg("Respuesta inesperada del servidor.");
        track("analyze_error", { reason: "unexpected_response" });
      }
    } catch (err) {
      Sentry.captureException(err);
      setMsg("No se pudo conectar con la API.");
      track("analyze_error", { reason: "network" });
    } finally {
      setLoading(false);
    }
  };

  // Reset
  const reset = () => {
    setIsCameraOpen(false);
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setMsg("");
    track("reset_click");
  };

  // Descargar PDF desde /api/report
  const downloadReport = async () => {
    if (!result || !file) return;
    setDownloadingPdf(true);
    track("report_download_click");

    try {
      const imageAsDataUrl = await fileToDataURL(file);
      const resp = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // el backend acepta data URL o base64 plano en la clave "image"
        body: JSON.stringify({ image: imageAsDataUrl, result }),
      });

      if (!resp.ok) throw new Error("Error al generar el PDF");

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "FixItBot-reporte.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      Sentry.captureException(error);
      setMsg("No se pudo descargar el reporte.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Agendar por WhatsApp
  const bookWhatsApp = () => {
    if (!result) return;
    track("booking_click", { channel: "whatsapp" });
    const tel = process.env.NEXT_PUBLIC_BOOKING_WHATSAPP;
    if (!tel) {
      setMsg("El número de WhatsApp no está configurado.");
      return;
    }
    const txt = encodeURIComponent(
      `Hola, vengo de FixItBot para agendar una cita.\n\nResumen del Análisis:\n- Severidad: ${result.severity}\n- Tipo de Daño: ${result.category}\n- Zona Afectada: ${result.area}\n- Costo Estimado: ${formatMXN(
        result.estimate
      )}`
    );
    window.open(`https://wa.me/${tel}?text=${txt}`, "_blank");
  };

  // Agendar en Calendly
  const bookCalendly = () => {
    track("booking_click", { channel: "calendly" });
    const url = process.env.NEXT_PUBLIC_CALENDLY_URL;
    if (!url) {
      setMsg("La agenda de Calendly no está configurada.");
      return;
    }
    window.open(url, "_blank");
  };

  /* ================== Render ================== */
  return (
    <div className="min-h-svh bg-zinc-950 text-zinc-100 font-sans">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-emerald-400">
              FixItBot
            </span>
            <span className="text-zinc-500 font-light ml-2">
              Análisis Automotriz
            </span>
          </h1>
          <div className="hidden md:flex items-center gap-4 text-sm text-zinc-400">
            <span>Detección por IA</span>
            <span className="h-4 w-px bg-zinc-700" />
            <span>Cotización instantánea</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="grid gap-8 lg:grid-cols-2 items-start">
          {/* Columna 1: Uploader/Cámara */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-2xl shadow-black/20 flex flex-col h-full">
            <div className="p-5 flex items-center gap-3 border-b border-zinc-800">
              <div className="grid place-items-center h-8 w-8 rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-lg">
                1
              </div>
              <h2 className="text-lg font-semibold">Sube la Evidencia</h2>
            </div>

            <form onSubmit={onSubmit} className="p-5 flex flex-col gap-5 flex-1">
              {isCameraOpen ? (
                <div className="flex flex-col items-center justify-center gap-3 h-56">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover rounded-xl bg-zinc-800 border-2 border-dashed border-zinc-700"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              ) : (
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
                  className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-800/50 p-6 text-center transition-colors duration-300 hover:border-sky-500 hover:bg-zinc-800/80 h-56"
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-zinc-500"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                  <div className="text-sm">
                    <b>Arrastra y suelta</b> una foto del daño
                    <br />
                    <span className="text-zinc-400">
                      o haz clic para seleccionar
                    </span>
                  </div>
                  {file && (
                    <div className="mt-2 text-xs text-emerald-400 font-mono">
                      Archivo: {file.name}
                    </div>
                  )}
                </label>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-3">
                {isCameraOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={handleCapture}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:bg-red-500"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white"
                      >
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                      <span>Capturar Foto</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCameraOpen(false)}
                      className="inline-flex items-center justify-center rounded-xl bg-zinc-700/50 px-5 py-2.5 text-sm font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition-colors hover:bg-zinc-700"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 ring-1 ring-inset ring-indigo-500/50 transition-all duration-300 hover:bg-indigo-500 hover:scale-105 active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={!file || loading}
                    >
                      {loading ? (
                        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M10.4 2.2a2.3 2.3 0 0 1 3.2 0l7.3 8.4a2.3 2.3 0 0 1-1.6 3.9H4.7a2.3 2.3 0 0 1-1.6-3.9Z" />
                          <path d="m12 17-1-4-4 3 5-10 5 10-4-3-1 4Z" />
                        </svg>
                      )}
                      <span>{loading ? "Analizando..." : "Analizar Daño"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsCameraOpen(true);
                        setFile(null);
                        setResult(null);
                        setMsg("");
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600/50 px-5 py-2.5 text-sm font-medium text-sky-300 ring-1 ring-inset ring-sky-700 transition-colors hover:bg-sky-700"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path>
                        <circle cx="12" cy="13" r="3"></circle>
                      </svg>
                      <span>Tomar Foto</span>
                    </button>

                    <button
                      type="button"
                      onClick={reset}
                      className="ml-auto inline-flex items-center justify-center rounded-xl bg-zinc-700/50 px-5 py-2.5 text-sm font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition-colors hover:bg-zinc-700"
                    >
                      Limpiar
                    </button>
                  </>
                )}

                {msg && !isCameraOpen && (
                  <span
                    role="status"
                    aria-live="polite"
                    className="ml-auto text-sm text-red-400"
                  >
                    {msg}
                  </span>
                )}
              </div>
            </form>
          </section>

          {/* Columna 2: Previsualización + Resultados */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-2xl shadow-black/20 flex flex-col h-full">
            <div className="p-5 flex items-center gap-3 border-b border-zinc-800">
              <div className="grid place-items-center h-8 w-8 rounded-full bg-sky-500/20 text-sky-400 font-bold text-lg">
                2
              </div>
              <h2 className="text-lg font-semibold">Diagnóstico y Acciones</h2>
            </div>

            <div className="p-5 flex flex-col gap-5 flex-1">
              {!previewUrl && !loading && (
                <div className="flex-1 w-full rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-800/50 grid place-items-center text-sm text-zinc-500">
                  Esperando imagen para análisis...
                </div>
              )}

              {previewUrl && (
                <div className="relative w-full overflow-hidden rounded-xl border border-zinc-800">
                  <Image
                    src={previewUrl}
                    alt="Previsualización del daño"
                    width={1280}
                    height={720}
                    unoptimized
                    className="h-auto w-full object-contain"
                    priority
                  />
                  {result?.boxes?.map((b, i) => (
                    <div
                      key={i}
                      className="absolute border-2 border-emerald-400 bg-emerald-400/10 rounded-md"
                      style={{
                        left: `${b.x * 100}%`,
                        top: `${b.y * 100}%`,
                        width: `${b.w * 100}%`,
                        height: `${b.h * 100}%`,
                        boxShadow: "0 0 10px rgba(45, 212, 191, 0.5)",
                      }}
                      title={`${b.cls}${
                        b.score ? ` (${(b.score * 100).toFixed(0)}%)` : ""
                      }`}
                    />
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-zinc-400">
                  <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-sky-400" />
                  <p className="font-medium">Procesando imagen con IA...</p>
                  <p className="text-xs text-zinc-500">
                    Esto puede tardar unos segundos.
                  </p>
                </div>
              )}

              {result && !loading && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-base font-semibold">
                        Resumen del Diagnóstico
                      </h3>
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 capitalize ${severityBadge(
                          result.severity
                        )}`}
                        title={`Severidad: ${result.severity}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {result.severity}
                      </span>
                    </div>

                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-zinc-800/50 p-3 ring-1 ring-inset ring-zinc-700/50">
                        <dt className="text-xs text-zinc-400">Zona Afectada</dt>
                        <dd className="font-semibold text-white">
                          {result.area}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-zinc-800/50 p-3 ring-1 ring-inset ring-zinc-700/50">
                        <dt className="text-xs text-zinc-400">
                          Costo de Reparación (Aprox.)
                        </dt>
                        <dd className="font-semibold text-emerald-400">
                          {formatMXN(result.estimate)}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Acciones */}
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                    <h3 className="text-base font-semibold mb-3">
                      Siguientes Pasos
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={bookWhatsApp}
                        className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white ring-1 ring-emerald-500/50 transition-all duration-300 hover:bg-emerald-500 hover:scale-105 active:scale-100"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                        Agendar por WhatsApp
                      </button>
                      <button
                        onClick={bookCalendly}
                        className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white ring-1 ring-sky-500/50 transition-all duration-300 hover:bg-sky-500 hover:scale-105 active:scale-100"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                          <line x1="16" x2="16" y1="2" y2="6" />
                          <line x1="8" x2="8" y1="2" y2="6" />
                          <line x1="3" x2="21" y1="10" y2="10" />
                        </svg>
                        Agendar en Calendly
                      </button>
                      <button
                        onClick={downloadReport}
                        disabled={downloadingPdf}
                        className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-700/80 px-4 py-2 text-sm font-semibold text-zinc-200 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-wait"
                      >
                        {downloadingPdf ? (
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" x2="12" y1="15" y2="3" />
                          </svg>
                        )}
                        <span>
                          {downloadingPdf ? "Generando..." : "Descargar Reporte"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {result.diy && (
                    <div className="mt-1 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                      <h3 className="text-base font-semibold mb-2">
                        Guía DIY Sugerida
                      </h3>
                      <p className="text-sm font-medium text-amber-400 mb-3">
                        {result.diy.title}
                      </p>
                      <div className="aspect-video w-full overflow-hidden rounded-lg border border-zinc-700">
                        <iframe
                          src={result.diy.videoUrl.replace("watch?v=", "embed/")}
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          title="DIY video"
                        />
                      </div>
                      <ol className="mt-4 list-decimal pl-5 text-sm text-zinc-300 space-y-1.5">
                        {result.diy.steps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <p className="mt-2 text-center text-xs text-zinc-500">
                    *Esta es una estimación preliminar con fines informativos y
                    no representa una cotización formal.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
