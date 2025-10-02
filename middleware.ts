// middleware.ts
import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

// no se ejecuta en ninguna ruta
export const config = { matcher: [] };
