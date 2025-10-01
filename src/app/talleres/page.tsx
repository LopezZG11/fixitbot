"use client";
import { useMemo, useState } from "react";

type Taller = {
  id: string;
  nombre: string;
  direccion: string;
  telefono?: string;
  whatsapp?: string; // solo números con lada, ej. 523312223344
  lat?: number;
  lng?: number;
  servicios: string[];
  horario?: string;
};

const TALLERES: Taller[] = [
  {
    id: "t1",
    nombre: "Carrocerías Patria",
    direccion: "Av. Patria 123, GDL",
    telefono: "+523311112233",
    whatsapp: "523311112233",
    lat: 20.6736, lng: -103.344,
    servicios: ["pintura", "hojalatería", "pulido"],
    horario: "L–S 9:00–19:00",
  },
  {
    id: "t2",
    nombre: "Detail Pro Circunvalación",
    direccion: "Circunvalación 456, GDL",
    telefono: "+523312224455",
    whatsapp: "523312224455",
    servicios: ["detailing", "plásticos", "pulido"],
    horario: "L–V 10:00–18:00",
  },
  {
    id: "t3",
    nombre: "Hojalatería & Pintura Centro",
    direccion: "5 de Mayo 789, Centro",
    telefono: "+523317778899",
    servicios: ["pintura", "abolladuras", "PDR"],
    horario: "L–S 9:30–18:30",
  },
];

const mapsQuery = (t: Taller) => {
  if (t.lat && t.lng) return `https://www.google.com/maps/search/${encodeURIComponent(t.nombre)}/@${t.lat},${t.lng},16z`;
  return `https://www.google.com/maps/search/${encodeURIComponent(t.nombre + " " + t.direccion)}`;
};

export default function TalleresPage() {
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const nq = q.trim().toLowerCase();
    if (!nq) return TALLERES;
    return TALLERES.filter(t =>
      [t.nombre, t.direccion, t.horario, ...t.servicios].join(" ").toLowerCase().includes(nq)
    );
  }, [q]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Talleres cercanos</h1>

      <div className="mb-6 flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, servicio o zona…"
          className="w-full rounded-xl bg-white/5 px-4 py-2 text-sm ring-1 ring-inset ring-white/10 outline-none focus:ring-white/20"
        />
      </div>

      <div className="space-y-4">
        {list.map((t) => (
          <article key={t.id} className="rounded-2xl border border-white/10 bg-white/5 shadow p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-semibold text-lg">{t.nombre}</h3>
              <div className="ml-auto text-xs opacity-70">{t.horario ?? "Horario no disponible"}</div>
            </div>

            <p className="opacity-90 mt-1">{t.direccion}</p>

            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {t.servicios.map(s => (
                <span key={s} className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-inset ring-white/10">{s}</span>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={mapsQuery(t)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white ring-1 ring-emerald-400/30 hover:bg-emerald-400"
              >
                Cómo llegar
              </a>

              {t.telefono && (
                <a
                  href={`tel:${t.telefono}`}
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 ring-1 ring-inset ring-white/10 hover:bg-white/10"
                >
                  Llamar
                </a>
              )}

              {t.whatsapp && (
                <a
                  href={`https://wa.me/${t.whatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 ring-1 ring-inset ring-white/10 hover:bg-white/10"
                >
                  WhatsApp
                </a>
              )}

              <a
                href={`mailto:contacto@${t.nombre.toLowerCase().replace(/\s+/g, "")}.com?subject=Cita%20FixItBot&body=Hola,%20quiero%20agendar%20una%20cita%20para%20evaluación.`}
                className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white ring-1 ring-indigo-400/30 hover:bg-indigo-400"
              >
                Agendar por correo
              </a>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
