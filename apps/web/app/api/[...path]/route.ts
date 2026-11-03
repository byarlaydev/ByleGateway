import { NextRequest, NextResponse } from "next/server";
import {
  authenticated,
  credentialVersion,
  LoginLimiter,
  passwordMatches,
  sessionCookie,
  sessionRequest,
} from "../../../lib/auth";
export const runtime = "nodejs";
const limiter = new LoginLimiter();
function sameOrigin(req: NextRequest) {
  try {
    const origin = new URL(req.headers.get("origin") || "");
    return (
      origin.host === req.headers.get("host") &&
      ["http:", "https:"].includes(origin.protocol)
    );
  } catch {
    return false;
  }
}
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params,
    route = path.join("/"),
    token = req.cookies.get(sessionCookie)?.value;
  const json = (value: unknown, status = 200) =>
    NextResponse.json(value, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  if (req.method !== "GET" && !sameOrigin(req))
    return json({ message: "Invalid origin" }, 403);
  try {
    if (route === "session") {
      if (req.method === "GET")
        return json({ authenticated: await authenticated(token) });
      if (req.method === "DELETE") {
        if (token && /^[a-f0-9]{64}$/.test(token)) {
          const response = await sessionRequest("DELETE", token);
          if (!response.ok)
            return json(
              { message: "Could not revoke the session. Retry sign out." },
              503,
            );
        }
        const response = json({ ok: true });
        response.cookies.delete(sessionCookie);
        return response;
      }
      credentialVersion();
      const client =
        process.env.TRUST_PROXY === "true"
          ? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
            "unknown"
          : "local";
      if (limiter.blocked(client))
        return json(
          {
            message:
              "Too many sign-in attempts from this address. Try again in a minute.",
          },
          429,
        );
      let password: unknown;
      try {
        ({ password } = await req.json());
      } catch {
        return json({ message: "Invalid JSON" }, 400);
      }
      if (!passwordMatches(password)) {
        limiter.failed(client);
        return json({ message: "Incorrect password" }, 401);
      }
      const response = await sessionRequest("POST");
      if (!response.ok)
        return json(
          {
            message: "Sign-in service unavailable. Check the API and database.",
          },
          503,
        );
      const session = await response.json();
      limiter.succeeded(client);
      const result = json({ ok: true });
      result.cookies.set(sessionCookie, session.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 28800,
      });
      return result;
    }
    if (!(await authenticated(token)))
      return json({ message: "Sign in to your workspace" }, 401);
    if (!(
      route === "admin/overview" ||
      route === "admin/setup" ||
      route === "admin/payments/export" ||
      route === "admin/apps" ||
      /^admin\/apps\/[a-f0-9-]+\/(rotate-key|webhook|key)$/.test(route) ||
      /^admin\/payments\/[a-f0-9-]+\/(events|refresh)$/.test(route) ||
      /^admin\/deliveries\/[a-f0-9-]+\/resend$/.test(route)
    ))
      return json({ message: "Not found" }, 404);
    const response = await fetch(
      `${process.env.API_ORIGIN || "http://127.0.0.1:4000"}/${route}${req.nextUrl.search}`,
      {
        method: req.method,
        headers: {
          Authorization: `Bearer ${process.env.OWNER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: req.method === "POST" ? await req.text() : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      },
    );
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Content-Disposition":
          response.headers.get("content-disposition") || "inline",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return json(
      {
        message:
          "Cannot connect to your gateway. Check the API, PostgreSQL, and owner credentials on the server.",
      },
      503,
    );
  }
}
export { handler as GET, handler as POST, handler as DELETE };
