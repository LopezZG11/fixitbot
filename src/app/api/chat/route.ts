// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { JWT } from "google-auth-library";

export const runtime = "nodejs";

type ChatRequest = {
  sessionId: string;
  text: string;
};

type DFText = { text?: { text?: string[] } };
type DFQueryResult = { responseMessages?: DFText[] };
type DFDetectIntentResponse = { queryResult?: DFQueryResult };

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

function getJWT(): JWT {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || "";
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  return new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });
}

function buildSessionPath(sessionId: string): string {
  const project = process.env.GOOGLE_PROJECT_ID!;
  const location = process.env.DIALOGFLOW_CX_LOCATION || "global";
  const agent = process.env.DIALOGFLOW_CX_AGENT_ID!;
  return `projects/${project}/locations/${location}/agents/${agent}/sessions/${sessionId}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequest;
    if (!body?.text || !body?.sessionId) {
      return NextResponse.json({ error: "sessionId y text son requeridos." }, { status: 400 });
    }

    const languageCode = process.env.DIALOGFLOW_CX_LANGUAGE || "es";
    const environmentId = process.env.DIALOGFLOW_CX_ENVIRONMENT; // opcional
    const sessionPath = buildSessionPath(body.sessionId);

    const baseUrl = `https://dialogflow.googleapis.com/v3/${sessionPath}:detectIntent`;
    const url =
      environmentId
        ? `${baseUrl}?environment=projects/${process.env.GOOGLE_PROJECT_ID}/locations/${process.env.DIALOGFLOW_CX_LOCATION || "global"}/agents/${process.env.DIALOGFLOW_CX_AGENT_ID}/environments/${environmentId}`
        : baseUrl;

    const jwt = getJWT();
    const token = await jwt.getAccessToken();

    const payload = {
      queryInput: {
        text: { text: body.text },
        languageCode,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token?.token || token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return NextResponse.json({ error: `Dialogflow ${resp.status}: ${t}` }, { status: 502 });
    }

    const data = (await resp.json()) as DFDetectIntentResponse;
    const msgs = data.queryResult?.responseMessages || [];
    const replies: string[] = [];

    for (const m of msgs) {
      const list = m.text?.text || [];
      for (const s of list) replies.push(s);
    }

    return NextResponse.json({ replies, raw: data });
  } catch (err) {
    console.error("Error in /api/chat", err);
    return NextResponse.json({ error: "Fallo en /api/chat" }, { status: 500 });
  }
}
