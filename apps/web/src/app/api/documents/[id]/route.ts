import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@jobpilot/db";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  // Scope by userId: a document id alone must never grant access (I7).
  const document = await prisma.document.findFirst({ where: { id, userId } });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";
  const metadata = (document.metadata ?? {}) as { filename?: string };
  const contentType =
    CONTENT_TYPES[document.format] ?? "application/octet-stream";
  const body = Buffer.from(document.content, "base64");

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(body.length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${
      metadata.filename ?? `resume.${document.format}`
    }"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  // Rendered HTML is escaped, but never let an inline preview run script.
  if (document.format === "html") {
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
  }

  return new Response(new Uint8Array(body), { headers });
}
