// middleware.ts
// import { NextResponse } from "next/server";
// import { Ratelimit } from "@upstash/ratelimit";
// import { Redis } from "@upstash/redis";

// const redis = Redis.fromEnv();
// const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") }); // 10 req/min por IP

// export async function middleware(req: Request) {
//   if (new URL(req.url).pathname !== "/api/estimate") return NextResponse.next();
//   const ip = req.headers.get("x-forwarded-for") ?? "ip_unknown";
//   const { success } = await limiter.limit(ip);
//   if (!success) return new NextResponse("Too Many Requests", { status: 429 });
//   return NextResponse.next();
// }
// middleware.ts
import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

// no se ejecuta en ninguna ruta
export const config = { matcher: [] };
