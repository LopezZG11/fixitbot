import { NextRequest, NextResponse } from "next/server";

// Usa runtime Node por defecto (más permisivo con tamaño)
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("image");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
  }

  const f = file as File;
  const type = f.type || "application/octet-stream";
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!allowed.includes(type)) {
    return NextResponse.json(
      { error: "Formato no soportado. Usa JPG, PNG o WEBP." },
      { status: 415 }
    );
  }

  const MAX = 5 * 1024 * 1024; // 5 MB
  if (f.size > MAX) {
    return NextResponse.json(
      { error: "Imagen demasiado grande (máx. 5 MB)." },
      { status: 413 }
    );
  }

  // Placeholder simple: mapea tamaño → severidad
  const severity = f.size > 1.5 * 1024 * 1024 ? "medio" : "leve";
  const area = "defensa/guardafango (estimado)";
  const estimate = severity === "medio" ? 3800 : 1800;

  return NextResponse.json({ severity, area, estimate });
}
