import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, checkPassword, expectedToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // ignorieren -> leeres Passwort schlaegt fehl
  }

  if (!checkPassword(password)) {
    return NextResponse.json(
      { ok: false, error: "Falsches Passwort." },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await expectedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 Tage
  });
  return res;
}
