import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isValidToken } from "@/lib/auth";

// Next 16: "middleware" heisst jetzt "proxy". Schuetzt das gesamte
// Dashboard. Nur /login und der Login-Endpunkt sind ohne gueltiges
// Cookie erreichbar.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = pathname === "/login" || pathname === "/api/login";
  if (isPublic) return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidToken(token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
