"use client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Guide = {
  id: string;
  title: string;
  difficulty: "Fácil" | "Media" | "Difícil";
  time: string;             // ej. "25–40 min"
  videoId: string;          // YouTube ID
  steps: string[];
  tags: string[];
  thumb?: string;           // opcional: URL imagen
};

const GUIDES: Guide[] = [
  {
    id: "rayon-ligero",
    title: "Eliminar rayón ligero con pulido",
    difficulty: "Fácil",
    time: "20–30 min",
    videoId: "dQw4w9WgXcQ",
    steps: [
      "Lavar área con agua y jabón neutro",
      "Aplicar compuesto pulidor con pad de espuma",
      "Pulir en movimientos circulares sin presionar de más",
      "Retirar exceso y revisar a contraluz"
    ],
    tags: ["pintura", "pulido", "rayón"],
  },
  {
    id: "raspon-parachoques",
    title: "Raspones en defensa (retoque rápido)",
    difficulty: "Media",
    time: "35–50 min",
    videoId: "M3r2XDceM6A",
    steps: [
      "Desengrasar con alcohol isopropílico",
      "Lijar suave (grano 2000) en húmedo",
      "Aplicar pintura de retoque del color",
      "Sellar con barniz en pluma y pulir"
    ],
    tags: ["parachoques", "barniz", "retoque"],
  },
  {
    id: "abolladura-pequena",
    title: "Abolladura pequeña sin pintura (PDR casero)",
    difficulty: "Media",
    time: "25–40 min",
    videoId: "kXYiU_JCYtU",
    steps: [
      "Calentar suavemente el área (secadora de pelo)",
      "Usar ventosa/plunger para traccionar",
      "Golpecitos por perímetro con martillo de goma",
      "Revisar reflejos hasta nivelar"
    ],
    tags: ["PDR", "abolladura", "carrocería"],
  },
  {
    id: "piedritas-cofre",
    title: "Piedritas en cofre (retoque puntual)",
    difficulty: "Fácil",
    time: "15–25 min",
    videoId: "eVTXPUF4Oz4",
    steps: [
      "Limpiar con desengrasante",
      "Aplicar primer en microgota",
      "Pintura base con palillo",
      "Sellar con gota de barniz UV"
    ],
    tags: ["cofre", "retoque", "primer"],
  },
  {
    id: "plastico-negro",
    title: "Restaurar plásticos negros exteriores",
    difficulty: "Fácil",
    time: "10–20 min",
    videoId: "ktvTqknDobU",
    steps: [
      "Limpieza profunda con APC",
      "Aplicar restaurador en capa fina",
      "Dejar curar 10–15 min",
      "Repetir si es necesario"
    ],
    tags: ["detailing", "plástico", "exteriores"],
  },
  {
    id: "mancha-resina",
    title: "Quitar resina/contaminación sin dañar pintura",
    difficulty: "Media",
    time: "20–30 min",
    videoId: "YQHsXMglC9A",
    steps: [
      "Aplicar descontaminante (tar/bug) localmente",
      "Esperar el tiempo indicado",
      "Retirar con microfibra limpia",
      "Proteger con sellador"
    ],
    tags: ["resina", "contaminación", "detailing"],
  },
];

const YT = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export default function DIYPage() {
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  // cargar guardados de localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("fixitbot_diy_saved");
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, []);

  const toggleSave = (id: string) => {
    const next = { ...saved, [id]: !saved[id] };
    setSaved(next);
    localStorage.setItem("fixitbot_diy_saved", JSON.stringify(next));
  };

  const list = useMemo(() => {
    const nq = q.trim().toLowerCase();
    if (!nq) return GUIDES;
    return GUIDES.filter(g =>
      [g.title, g.difficulty, g.time, ...g.tags, ...g.steps]
        .join(" ")
        .toLowerCase()
        .includes(nq)
    );
  }, [q]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Guías DIY</h1>

      <div className="mb-6 flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por título, etiqueta o paso…"
          className="w-full rounded-xl bg-white/5 px-4 py-2 text-sm ring-1 ring-inset ring-white/10 outline-none focus:ring-white/20"
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((g) => (
          <article
            key={g.id}
            className="rounded-2xl border border-white/10 bg-white/5 shadow overflow-hidden flex flex-col"
          >
            {/* Thumb o placeholder */}
            <div className="relative h-40 w-full border-b border-white/10 bg-zinc-800/50">
              {g.thumb ? (
                <Image
                  src={g.thumb}
                  alt={g.title}
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-zinc-400 text-4xl">🛠️</div>
              )}
            </div>

            <div className="p-4 flex-1 flex flex-col gap-3">
              <h3 className="font-semibold">{g.title}</h3>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-inset ring-white/10">
                  {g.difficulty}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-inset ring-white/10">
                  {g.time}
                </span>
                <div className="ml-auto flex gap-1">
                  {g.tags.slice(0, 3).map(t => (
                    <span key={t} className="rounded bg-white/5 px-2 py-1 ring-1 ring-inset ring-white/10">{t}</span>
                  ))}
                </div>
              </div>

              <ol className="list-decimal pl-5 text-sm opacity-90 space-y-1">
                {g.steps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
              </ol>

              <div className="mt-auto flex items-center gap-2">
                <a
                  href={YT(g.videoId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white ring-1 ring-indigo-400/30 hover:bg-indigo-400"
                >
                  Ver video
                </a>

                <button
                  onClick={() => toggleSave(g.id)}
                  className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition
                    ${saved[g.id]
                      ? "bg-emerald-500 text-white ring-emerald-400/30 hover:bg-emerald-400"
                      : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10"}`}
                >
                  {saved[g.id] ? "Guardado ✓" : "Guardar"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
