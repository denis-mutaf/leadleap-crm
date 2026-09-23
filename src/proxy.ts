import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  const { response, userId } = await updateSession(request);

  const isLoginPage = pathname === "/login";

  function redirectWithSession(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  if (!userId && pathname.startsWith("/api/")) {
    const unauthorized = NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    response.cookies
      .getAll()
      .forEach((cookie) => unauthorized.cookies.set(cookie));
    return unauthorized;
  }

  if (!userId && !isLoginPage) {
    return redirectWithSession("/login");
  }

  if (userId && isLoginPage) {
    return redirectWithSession("/deals");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
