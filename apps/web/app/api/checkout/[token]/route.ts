import { NextResponse } from "next/server";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!/^[a-f0-9]{64}$/.test(token))
    return NextResponse.json(
      { message: "Checkout not found" },
      { status: 404 },
    );
  try {
    const response = await fetch(
      `${process.env.API_ORIGIN || "http://127.0.0.1:4000"}/public/checkout/${token}`,
      { cache: "no-store", signal: AbortSignal.timeout(10000) },
    );
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Payment service temporarily unavailable" },
      { status: 503 },
    );
  }
}
