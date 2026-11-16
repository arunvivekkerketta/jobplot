import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSameOriginRequest } from "@/lib/origin";

/**
 * One guard for every state-changing route: a session, a same-origin request and
 * a JSON body. Centralising it means a new route cannot silently ship without the
 * cross-site check that only the Auto-Pilot route used to have (M1).
 */
export async function requireUserRequest(
  req: Request,
): Promise<{ userId: string } | Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method !== "GET") {
    if (!isSameOriginRequest(req)) {
      return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
    }
    // A body-less request (a DELETE that carries its target in the query string)
    // has nothing to parse, so it needs no content type.
    const hasBody = Number(req.headers.get("content-length") ?? "0") > 0;
    const contentType = req.headers.get("content-type") ?? "";
    if (hasBody && !contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      );
    }
  }

  return { userId };
}
