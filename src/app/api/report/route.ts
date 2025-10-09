// src/app/api/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type { Readable as NodeReadable } from "node:stream";

export const runtime = "nodejs";

/* ======================== Tipos ======================== */
type Severity = "bajo" | "intermedio" | "avanzado" | string;

type EstimateResult = {
  severity: Severity;
  area: string;
  category: string;
  estimate: number;
  diy?: { title: string; videoUrl: string; steps: string[] };
  breakdown?: {
    base: number;
    sevFactor: number;
    areaFactor: number;
    areaPct?: number; // 0..1
  };
};

/* =================== Helpers TIPADOS =================== */
// Type guards
function isWebReadable(obj: unknown): obj is ReadableStream<Uint8Array> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as ReadableStream<Uint8Array>).getReader === "function"
  );
}

function isNodeReadable(obj: unknown): obj is NodeReadable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as NodeReadable).on === "function"
  );
}

// Node Readable -> Web ReadableStream
function nodeToWebStream(nodeStream: NodeReadable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err: unknown) => controller.error(err));
    },
    cancel() {
      const s = nodeStream as NodeReadable & { destroy?: () => void };
      if (typeof s.destroy === "function") s.destroy();
    },
  });
}

// Uint8Array/Buffer -> Web ReadableStream
function bytesToWebStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/* =============== Utilidades de presentación =============== */
function translateCategory(category: string): string {
  const map: Record<string, string> = {
    lamp_broken: "Faro roto",
    scratch: "Rayón / rasguño",
    dent: "Abolladura",
    bumper_damage: "Daño en defensa",
    door_ding: "Golpe de puerta",
    glass_shatter: "Cristal roto",
    paint_damage: "Daño de pintura",
  };
  const known = map[category];
  if (known) return known;
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase()); // Capitaliza palabras
}

function getSeverityInfo(
  severity: Severity
): { text: string; detail: string; color: string } {
  if (severity === "avanzado")
    return {
      text: "AVANZADO",
      detail: "Reparación profesional indispensable.",
      color: "#D32F2F",
    };
  if (severity === "intermedio")
    return {
      text: "INTERMEDIO",
      detail: "Se recomienda evaluación en taller.",
      color: "#F57C00",
    };
  return {
    text: "BAJO",
    detail: "Generalmente reparable con guías DIY.",
    color: "#388E3C",
  };
}

function formatMXN(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function dataUrlToBuffer(dataUrl: string): Buffer | undefined {
  // Acepta "data:image/...;base64,xxxx" o base64 plano
  if (dataUrl.startsWith("data:image")) {
    const [, base64] = dataUrl.split(";base64,");
    if (base64) return Buffer.from(base64, "base64");
  } else {
    // asume base64 plano
    try {
      return Buffer.from(dataUrl, "base64");
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/* ======================== Estilos ======================== */
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 35,
    backgroundColor: "#F8F9FA",
  },
  header: {
    fontSize: 20,
    marginBottom: 18,
    textAlign: "center",
    color: "#2C3E50",
    fontFamily: "Helvetica-Bold",
  },
  subHeader: {
    fontSize: 10,
    textAlign: "center",
    color: "#6B7280",
    marginTop: -8,
    marginBottom: 18,
  },
  section: {
    marginBottom: 14,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    border: "1px solid #E5E7EB",
  },
  sectionTitle: {
    fontSize: 13,
    marginBottom: 10,
    fontFamily: "Helvetica-Bold",
    color: "#2563EB",
  },
  image: {
    width: "100%",
    height: 230,
    objectFit: "contain",
    borderRadius: 4,
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottom: "1px solid #F3F4F6",
  },
  kvKey: { color: "#4B5563" },
  kvVal: { fontFamily: "Helvetica-Bold", maxWidth: "60%", textAlign: "right" },
  sevText: { fontFamily: "Helvetica-Bold" },
  sevDetail: { fontSize: 9, color: "#6B7280", marginTop: 2 },
  dlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  dlText: { maxWidth: "70%" },
  dlAmount: { fontFamily: "Helvetica-Bold" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #D1D5DB",
  },
  totalText: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  totalAmount: { fontFamily: "Helvetica-Bold", fontSize: 14, color: "#059669" },
  note: { fontSize: 9, color: "#6B7280", marginTop: 8, lineHeight: 1.3 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 35,
    right: 35,
    textAlign: "center",
    fontSize: 8,
    color: "#9CA3AF",
  },
});

/* ============== Documento PDF (sin JSX) ============== */
const ReportDocument = ({
  imageBuffer,
  result,
}: {
  imageBuffer?: Buffer;
  result: EstimateResult;
}) => {
  const sevInfo = getSeverityInfo(result.severity);
  const cat = translateCategory(result.category);

  const base = result.breakdown?.base ?? 0;
  const sevFactor = result.breakdown?.sevFactor ?? 1;
  const areaFactor = result.breakdown?.areaFactor ?? 1;
  const areaPct = Math.round(((result.breakdown?.areaPct ?? 0) * 100) || 0);

  const sevAdj = base * (sevFactor - 1);
  const areaAdj = (base + sevAdj) * (areaFactor - 1);

  const pageChildren = [
    React.createElement(
      Text,
      { key: "header", style: styles.header },
      "FixItBot — Reporte de Análisis"
    ),
    React.createElement(
      Text,
      { key: "subheader", style: styles.subHeader },
      "Diagnóstico automático a partir de una fotografía. Estimación informativa."
    ),
    imageBuffer
      ? React.createElement(
          View,
          { key: "imgSec", style: styles.section },
          React.createElement(Text, { style: styles.sectionTitle }, "Evidencia"),
          // En @react-pdf/renderer la prop correcta es `src`
          React.createElement(Image, { style: styles.image, src: imageBuffer })
        )
      : null,

    // Resumen
    React.createElement(
      View,
      { key: "sumSec", style: styles.section },
      React.createElement(Text, { style: styles.sectionTitle }, "Resumen"),
      React.createElement(
        View,
        { style: styles.kvRow },
        React.createElement(Text, { style: styles.kvKey }, "Severidad"),
        React.createElement(
          View,
          { style: { textAlign: "right" } },
          React.createElement(
            Text,
            { style: { ...styles.sevText, color: sevInfo.color } },
            sevInfo.text
          ),
          React.createElement(Text, { style: styles.sevDetail }, sevInfo.detail)
        )
      ),
      React.createElement(
        View,
        { style: styles.kvRow },
        React.createElement(Text, { style: styles.kvKey }, "Zona afectada"),
        React.createElement(Text, { style: styles.kvVal }, result.area)
      ),
      React.createElement(
        View,
        { style: styles.kvRow },
        React.createElement(Text, { style: styles.kvKey }, "Tipo de daño"),
        React.createElement(Text, { style: styles.kvVal }, cat)
      )
    ),

    // Desglose de la estimación (si lo envías en result.breakdown)
    result.breakdown
      ? React.createElement(
          View,
          { key: "dlSec", style: styles.section },
          React.createElement(
            Text,
            { style: styles.sectionTitle },
            "Cómo calculamos esta estimación"
          ),
          React.createElement(
            View,
            { style: styles.dlRow },
            React.createElement(
              Text,
              { style: styles.dlText },
              `1) Costo base por “${cat}”.`
            ),
            React.createElement(Text, { style: styles.dlAmount }, formatMXN(base))
          ),
          React.createElement(
            View,
            { style: styles.dlRow },
            React.createElement(
              Text,
              { style: styles.dlText },
              `2) Ajuste por severidad (${sevInfo.text.toLowerCase()}).`
            ),
            React.createElement(
              Text,
              { style: styles.dlAmount },
              `+ ${formatMXN(sevAdj)}`
            )
          ),
          React.createElement(
            View,
            { style: styles.dlRow },
            React.createElement(
              Text,
              { style: styles.dlText },
              `3) Ajuste por tamaño del área (≈ ${areaPct}%).`
            ),
            React.createElement(
              Text,
              { style: styles.dlAmount },
              `+ ${formatMXN(areaAdj)}`
            )
          ),
          React.createElement(
            View,
            { style: styles.totalRow },
            React.createElement(Text, { style: styles.totalText }, "Total estimado"),
            React.createElement(
              Text,
              { style: styles.totalAmount },
              formatMXN(result.estimate)
            )
          ),
          React.createElement(
            Text,
            { style: styles.note },
            "Notas: La estimación se basa en patrones promedio por tipo de daño y tamaño aparente del área. El costo final puede variar según piezas ocultas, color, repuestos o condiciones del vehículo."
          )
        )
      : null,

    // DIY (si vino en el result)
    result.diy
      ? React.createElement(
          View,
          { key: "diySec", style: styles.section },
          React.createElement(Text, { style: styles.sectionTitle }, "Opción DIY sugerida"),
          React.createElement(Text, null, result.diy.title),
          React.createElement(
            Text,
            { style: styles.note },
            "Si decides reparar por tu cuenta, revisa el video y sigue los pasos con precaución. Para resultados profesionales o daños mayores, recomendamos acudir a un taller."
          ),
          React.createElement(
            Text,
            { style: { marginTop: 6, color: "#2563EB" } },
            result.diy.videoUrl
          )
        )
      : null,

    React.createElement(
      Text,
      { key: "footer", style: styles.footer },
      "Reporte generado por FixItBot — *Estimación preliminar sin efectos de cotización formal."
    ),
  ];

  return React.createElement(
    Document,
    { title: "FixItBot - Reporte de Análisis" },
    React.createElement(Page, { size: "A4", style: styles.page }, ...pageChildren)
  );
};

/* ========================= Handler ========================= */
export async function POST(req: NextRequest) {
  try {
    const { image, result } = (await req.json()) as {
      image?: string;
      result: EstimateResult;
    };

    // Imagen opcional (data URL o base64 plano)
    const imageBuffer = image ? dataUrlToBuffer(image) : undefined;

    // Construye el documento
    const doc = ReportDocument({ imageBuffer, result });

    // Genera PDF → puede retornar Buffer/Uint8Array o stream según entorno
    const raw: unknown = await pdf(doc).toBuffer();

    // Normalizamos a ReadableStream<Uint8Array> (Web) para NextResponse
    let webStream: ReadableStream<Uint8Array>;
    if (raw instanceof Uint8Array) {
      webStream = bytesToWebStream(raw);
    } else if (isWebReadable(raw)) {
      webStream = raw;
    } else if (isNodeReadable(raw)) {
      webStream = nodeToWebStream(raw);
    } else {
      const fallback = Buffer.from(String(raw ?? ""), "utf8");
      webStream = bytesToWebStream(fallback);
    }

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="FixItBot-Reporte-Analisis.pdf"',
        // No fijamos Content-Length para no materializar el Buffer
      },
    });
  } catch (error) {
    console.error("Error generando el PDF:", error);
    return NextResponse.json(
      { error: "No se pudo generar el reporte PDF." },
      { status: 500 }
    );
  }
}
