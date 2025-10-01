import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("image");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    }

  // Placeholder simple (luego conectas tu IA real aquí):
  const size = (file as Blob).size;
  const severity = size > 1_000_000 ? "medio" : "leve";
  const area = "defensa/guardafango (estimado)";
  const estimate = severity === "medio" ? 3800 : 1800;

  return NextResponse.json({ severity, area, estimate });
}
