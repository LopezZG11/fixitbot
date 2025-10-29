"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Tipos
type Bubble = { id: string; from: "bot" | "user"; text: string };

function makeSessionId(): string {
  // Reutiliza una por pestaña
  if (typeof window !== "undefined") {
    const existing = sessionStorage.getItem("fixitbot_session_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("fixitbot_session_id", id);
    return id;
  }
  return Math.random().toString(36).slice(2);
}

export default function ChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<Bubble[]>([
    {
      id: "hi",
      from: "bot",
      text:
        "¡Hola! Soy FixItBot 🤖. Puedo responder dudas y guiarte. Escríbeme algo o pregunta: “¿Qué tan precisa es la cotización?”",
    },
  ]);

  const sessionId = useMemo(makeSessionId, []);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, open]);

  async function sendMessage(text: string) {
    if (!text.trim() || busy) return;

    setError(null);
    setBusy(true);

    // pinta burbuja del usuario
    const userMsg: Bubble = { id: crypto.randomUUID(), from: "user", text };
    setChat((old) => [...old, userMsg]);
    setInput("");

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text }),
      });

      const data: unknown = await resp.json();

      if (!resp.ok) {
        const errText =
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "No se pudo contactar al agente.";
        setError(errText);
        const errBubble: Bubble = {
          id: crypto.randomUUID(),
          from: "bot",
          text: "Lo siento, hubo un problema al consultar al agente. Intenta de nuevo.",
        };
        setChat((old) => [...old, errBubble]);
        return;
      }

      // Formatea respuestas
      const replies = (data as { replies?: string[] }).replies || [];
      if (replies.length === 0) {
        setChat((old) => [
          ...old,
          { id: crypto.randomUUID(), from: "bot", text: "…" },
        ]);
      } else {
        setChat((old) => [
          ...old,
          ...replies.map<Bubble>((t) => ({
            id: crypto.randomUUID(),
            from: "bot",
            text: t,
          })),
        ]);
      }
    } catch {
      setError("Error de red.");
      setChat((old) => [
        ...old,
        {
          id: crypto.randomUUID(),
          from: "bot",
          text: "No pude conectarme. Revisa tu conexión e inténtalo otra vez.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Botón flotante */}
      {!open && (
        <button
          aria-label="Abrir chat de ayuda"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[100] h-14 w-14 rounded-full bg-indigo-600 text-white shadow-xl hover:bg-indigo-500 transition-transform hover:scale-110"
        >
          💬
        </button>
      )}

      {/* Ventana del chat */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[100] w-[92vw] max-w-[360px] rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-lg">FixItBot</span>
              <span className="ml-1 text-xs text-emerald-400">• en línea</span>
            </div>
            <button
              aria-label="Cerrar chat"
              onClick={() => setOpen(false)}
              className="rounded-full bg-zinc-700/60 px-2 py-1 text-sm hover:bg-zinc-700"
            >
              ✕
            </button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto p-3 space-y-3">
            {chat.map((b) => (
              <div
                key={b.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  b.from === "user"
                    ? "ml-auto bg-indigo-600 text-white"
                    : "mr-auto bg-zinc-800"
                }`}
              >
                {b.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="px-3 pb-1 text-xs text-red-400">{error}</div>
          )}

          <form
            className="flex items-center gap-2 p-3 border-t border-zinc-800"
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
          >
            <input
              className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none ring-1 ring-inset ring-zinc-700 focus:ring-indigo-500"
              placeholder="Escribe tu mensaje…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "…" : "Enviar"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
