import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login"];

// Decodes the JWT payload (no signature check - the API does that) just to
// read its expiry. The login cookie outlives the token, so without this a
// stale cookie lets you into pages whose API calls all fail with 401.
function isExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json).exp;
    return typeof exp === "number" && exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("pm_token")?.value;
  if (!token || isExpired(token)) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete("pm_token");
    res.cookies.delete("pm_user");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
