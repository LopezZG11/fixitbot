// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SessionsClient } from "@google-cloud/dialogflow";

export const runtime = "nodejs";

type ChatRequest = {
  sessionId: string;
  text: string;
};

// --- PASO 1: Configurar el Cliente ---
// Estas son las 3 variables que necesitas en Vercel
const projectId = process.env.DIALOGFLOW_PROJECT_ID || "";
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || "";
// Esto arregla la clave privada que viene de Vercel
const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const credentials = {
  client_email: clientEmail,
  private_key: privateKey,
};

// Creamos el cliente de Dialogflow ES (no CX)
const sessionClient = new SessionsClient({
  projectId,
  credentials,
});

// --- PASO 2: Función Principal (POST) ---
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequest;
    const { sessionId, text } = body;

    if (!sessionId || !text) {
      return NextResponse.json({ error: "sessionId y text son requeridos." }, { status: 400 });
    }

    // Definimos la ruta de la sesión para Dialogflow ES (es más simple que CX)
    const sessionPath = sessionClient.projectAgentSessionPath(
      projectId,
      sessionId
    );

    // Creamos la solicitud para enviar a Dialogflow
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: text,
          languageCode: "es", // Idioma "quemado" en el código
        },
      },
    };

    // Enviamos el texto del usuario a Dialogflow ES
    const [response] = await sessionClient.detectIntent(request);
    const result = response.queryResult;

    // Devolvemos la respuesta del bot
    if (result && result.fulfillmentText) {
      const replies = [result.fulfillmentText];
      return NextResponse.json({ replies });
    } else {
      // Respuesta de fallback por si algo falla
      return NextResponse.json({ replies: ["No entendí, ¿puedes repetirlo?"] });
    }

  } catch (err) {
    // Manejo de errores
    console.error("Error in /api/chat (Dialogflow ES)", err);
    const errorMessage = (err as Error).message;
    return NextResponse.json({ error: `Fallo en /api/chat: ${errorMessage}` }, { status: 500 });
  }
}
