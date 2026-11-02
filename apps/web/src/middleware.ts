import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth wall (gate 1.4): every route except /login, the auth API and static
 * assets requires a session cookie. Cookie presence is checked here for a
 * cheap redirect; the token itself is verified server-side via auth().
 */
const PUBLIC_PATHS = ["/login", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const sessionCookie =
    req.cookies.get("authjs.session-token") ??
    req.cookies.get("__Secure-authjs.session-token");
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", req.url), 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)"],
};
