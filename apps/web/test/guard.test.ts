import { beforeEach, describe, expect, it, vi } from "vitest";

// The guard asks NextAuth for the session; nothing else in the module is reached,
// because the mock replaces it before it is imported.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { requireUserRequest } from "@/lib/guard";

const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

/**
 * `auth()` is NextAuth's overloaded session reader; the guard only uses the
 * zero-argument form, so the mock is installed against that signature.
 */
const mockedAuth = auth as unknown as { mockResolvedValue: (value: unknown) => void };

function signedInAs(userId = "user_1"): void {
  mockedAuth.mockResolvedValue({ user: { id: userId } });
}

function signedOut(): void {
  mockedAuth.mockResolvedValue(null);
}

/**
 * A real `Request` with the headers a browser would actually send. Node's
 * `Request` does not materialise `content-length` for a string body (a real
 * connection always carries it), so a body-bearing request states it here.
 */
function request(
  method: string,
  headers: Record<string, string> = {},
  body?: string,
): Request {
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = body;
    headers["content-length"] = String(body.length);
  }
  return new Request(`${ORIGIN}/api/applications/app_1/result`, init);
}

/** The guard's success branch: a plain `{ userId }`, not a `Response`. */
function userIdOf(result: { userId: string } | Response): string {
  expect(result).not.toBeInstanceOf(Response);
  return (result as { userId: string }).userId;
}

function statusOf(result: { userId: string } | Response): number {
  expect(result).toBeInstanceOf(Response);
  return (result as Response).status;
}

describe("requireUserRequest: the session is the first thing checked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a read with no session", async () => {
    signedOut();

    const result = await requireUserRequest(request("GET"));

    expect(statusOf(result)).toBe(401);
    await expect((result as Response).json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("refuses a mutation with no session before it looks at the origin", async () => {
    signedOut();

    // A foreign origin would be a 403 once a session exists; without one the
    // answer must not reveal which of the two rules a request tripped.
    const result = await requireUserRequest(
      request("POST", { origin: "https://evil.example" }, "{}"),
    );

    expect(statusOf(result)).toBe(401);
  });

  it("lets a signed-in read through with no headers at all", async () => {
    signedInAs("user_read");

    const result = await requireUserRequest(request("GET"));

    expect(userIdOf(result)).toBe("user_read");
  });

  it("does not require a same-origin origin for a read", async () => {
    signedInAs("user_read");

    // Reads change nothing, so the cross-site write protection does not apply to
    // them; the session alone decides (documented in the guard).
    const result = await requireUserRequest(
      request("GET", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    );

    expect(userIdOf(result)).toBe("user_read");
  });
});

describe("requireUserRequest: mutations must come from this site", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedInAs();
  });

  it("refuses a foreign Origin even with a JSON body", async () => {
    const result = await requireUserRequest(
      request(
        "POST",
        { host: HOST, origin: "https://evil.example", "content-type": "application/json" },
        JSON.stringify({ consent: true }),
      ),
    );

    expect(statusOf(result)).toBe(403);
    await expect((result as Response).json()).resolves.toEqual({
      error: "Cross-origin request refused",
    });
  });

  it("refuses a request the browser labels cross-site when Origin is absent", async () => {
    const result = await requireUserRequest(
      request(
        "POST",
        {
          host: HOST,
          "sec-fetch-site": "cross-site",
          "content-type": "application/json",
        },
        JSON.stringify({ consent: true }),
      ),
    );

    expect(statusOf(result)).toBe(403);
  });

  it("refuses an origin it cannot parse", async () => {
    const result = await requireUserRequest(
      request("POST", { host: HOST, origin: "not a url", "content-type": "application/json" }, "{}"),
    );

    expect(statusOf(result)).toBe(403);
  });

  it("refuses a same-origin origin when the request carries no Host", async () => {
    const result = await requireUserRequest(
      request("POST", { origin: ORIGIN, "content-type": "application/json" }, "{}"),
    );

    expect(statusOf(result)).toBe(403);
  });

  it("accepts the same-origin host that matches Origin", async () => {
    const result = await requireUserRequest(
      request(
        "POST",
        { host: HOST, origin: ORIGIN, "content-type": "application/json; charset=utf-8" },
        JSON.stringify({ consent: true }),
      ),
    );

    expect(userIdOf(result)).toBe("user_1");
  });
});

describe("requireUserRequest: a mutation with a body must be JSON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedInAs();
  });

  it("refuses a body that is not JSON", async () => {
    const result = await requireUserRequest(
      request(
        "POST",
        { host: HOST, origin: ORIGIN, "content-type": "text/plain" },
        "consent=true",
      ),
    );

    expect(statusOf(result)).toBe(415);
    await expect((result as Response).json()).resolves.toEqual({
      error: "Content-Type must be application/json",
    });
  });

  it("refuses a body that declares no content type", async () => {
    const result = await requireUserRequest(
      request("POST", { host: HOST, origin: ORIGIN }, JSON.stringify({ consent: true })),
    );

    expect(statusOf(result)).toBe(415);
  });

  it("accepts a body-less DELETE that carries its target in the query string", async () => {
    const result = await requireUserRequest(
      request("DELETE", { host: HOST, origin: ORIGIN }),
    );

    expect(userIdOf(result)).toBe("user_1");
  });

  it("accepts a POST that explicitly declares a zero-length body", async () => {
    const result = await requireUserRequest(
      request("POST", { host: HOST, origin: ORIGIN, "content-length": "0" }),
    );

    expect(userIdOf(result)).toBe("user_1");
  });

  it("treats a missing content-length as no body", async () => {
    // No content-length and no content-type, as Node's Request has when it is
    // built without one: there is nothing to parse, so nothing to refuse.
    const result = await requireUserRequest(request("PUT", { host: HOST, origin: ORIGIN }));

    expect(userIdOf(result)).toBe("user_1");
  });
});
