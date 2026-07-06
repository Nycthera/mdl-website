import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export function proxy(request: NextRequest) {
  // This runs on the edge / serverless function.
  // getToken reads the NextAuth JWT from the request cookies.
  return getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).then(
    (token) => {
      if (!token) {
        const loginUrl = new URL("/login", request.url);
        return NextResponse.redirect(loginUrl);
      }
      return NextResponse.next();
    },
  );
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
