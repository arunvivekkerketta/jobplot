import { formatHumanNeeded, type NotifyInput } from "@jobpilot/core";

export interface NotifyDeps {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Overrides NOTIFY_WEBHOOK_URL; an empty string means "not configured". */
  url?: string | null;
  audit: (payload: Record<string, unknown>) => Promise<void>;
  timeoutMs?: number;
}

/**
 * Tells the user an application stopped and needs them (M6).
 *
 * The webhook is optional: without one, the audit row is the whole record. Only
 * https endpoints are accepted, so a misconfigured http URL cannot leak the
 * message to the network in clear text. The audit row carries codes, not the
 * message text, because the message is stored nowhere and needs no copy.
 */
export async function notifyHumanNeeded(
  input: NotifyInput,
  deps: NotifyDeps,
): Promise<void> {
  const message = formatHumanNeeded(input);
  const url = deps.url ?? process.env.NOTIFY_WEBHOOK_URL ?? "";

  if (!url) {
    await deps.audit({ delivered: false, reason: "NOT_CONFIGURED", code: input.reason });
    return;
  }
  if (!url.startsWith("https://")) {
    await deps.audit({ delivered: false, reason: "INSECURE_URL", code: input.reason });
    return;
  }

  try {
    const response = await (deps.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `${message.title}\n${message.body}` }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
    });
    await deps.audit({
      delivered: response.ok,
      status: response.status,
      code: input.reason,
    });
  } catch {
    await deps.audit({ delivered: false, reason: "REQUEST_FAILED", code: input.reason });
  }
}
