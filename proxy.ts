import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getNextAuthSecret } from "@/lib/auth";

export function proxy(request: NextRequest) {
  // This runs on the edge / serverless function.
  // getToken reads the NextAuth JWT from the request cookies. The secret
  // must match the one NextAuth used to sign the JWT — share the resolver
  // with lib/auth.ts so they can never drift.
  return getToken({ req: request, secret: getNextAuthSecret() }).then(
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
