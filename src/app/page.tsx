"use client";
import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";

type EstimateResult = {
  severity: string;
  area: string;
  estimate: number;
};

const formatMXN = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

// Type guard SIN any
function isEstimateResult(v: unknown): v is EstimateResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.severity === "string" &&
    typeof o.area === "string" &&
    typeof o.estimate === "number"
  );
}

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // Crear y limpiar el blob URL
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
      setMsg("Primero selecciona una imagen.");
      return;
    }

    const form = new FormData();
    form.append("image", file);

    try {
      setLoading(true);
      const res = await fetch("/api/estimate", { method: "POST", body: form });
      const data: unknown = await res.json();

      if (!res.ok) {
        const errMsg =
          typeof (data as { error?: unknown })?.error === "string"
            ? (data as { error?: unknown }).error
            : "Error en la estimación";
        setMsg(String(errMsg));
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

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">FixItBot — MVP</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={!file || loading}
        >
          {loading ? "Analizando..." : "Analizar daño"}
        </button>
      </form>

      {previewUrl && (
        <section className="mt-6">
          <h2 className="font-semibold">Previsualización</h2>
          <Image
            src={previewUrl}   // blob: URL
            alt="preview"
            width={512}
            height={384}
            unoptimized         // necesario para blob:/data:
            className="mt-2 border rounded object-contain"
          />
        </section>
      )}

      {msg && (
        <p className="mt-4 text-red-600" aria-live="polite">
          {msg}
        </p>
      )}

      {result && (
        <section className="mt-6 border rounded p-4">
          <h2 className="font-semibold">Resultado</h2>
          <p>Severidad: <b>{result.severity}</b></p>
          <p>Zona estimada: <b>{result.area}</b></p>
          <p>Costo aproximado: <b>{formatMXN(result.estimate)}</b></p>
          <p className="text-sm opacity-70 mt-2">
            *Estimación aproximada con fines académicos.
          </p>
        </section>
      )}
    </main>
  );
}
