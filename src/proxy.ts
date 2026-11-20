import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkKeys } from "./server/config";

const withClerk = clerkMiddleware();
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  return clerkKeys() ? withClerk(req, event) : NextResponse.next();
}
// API requests authenticate independently in Hono.
export const config = { matcher: ["/", "/sign-in/:path*", "/sign-up/:path*", "/demo", "/dashboard", "/studio/:path*"] };
