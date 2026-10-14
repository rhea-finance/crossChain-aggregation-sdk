/**
 * Debug helper: dump SDK catch sites to the console (browser / Node).
 * Off by default — enable via {@link setSdkCatchLogging} or
 * `SwapClient({ debugCatchLogging: true })`.
 * Filter DevTools by `[cross-chain-aggregation-dex]`.
 */

const MAX_CAUSE_DEPTH = 8;

let catchLoggingEnabled = false;

/** Enable or disable catch-site console dumping. Default: off. */
export function setSdkCatchLogging(enabled: boolean): void {
  catchLoggingEnabled = Boolean(enabled);
}

export function isSdkCatchLoggingEnabled(): boolean {
  return catchLoggingEnabled;
}

function readProp(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

/** Strip URL query strings so secrets never land in console output. */
function redactSensitive(text: string): string {
  return text.replace(/(https?:\/\/[^\s?'"`]+)\?[^\s'"`]*/gi, "$1?[redacted]");
}

function serializeCaughtError(
  error: unknown,
  depth = 0
): Record<string, unknown> {
  if (error === null || error === undefined) {
    return { value: error };
  }
  if (typeof error !== "object") {
    return {
      value: typeof error === "string" ? redactSensitive(error) : error,
    };
  }

  const name =
    typeof readProp(error, "name") === "string"
      ? (readProp(error, "name") as string)
      : undefined;
  const message =
    typeof readProp(error, "message") === "string"
      ? redactSensitive(readProp(error, "message") as string)
      : undefined;
  const code = readProp(error, "code");
  const stage = readProp(error, "stage");
  const details = readProp(error, "details");
  const stack =
    typeof readProp(error, "stack") === "string"
      ? redactSensitive(readProp(error, "stack") as string)
      : undefined;

  // SwapSdkError stores cause on options; native Error may use .cause
  const options = readProp(error, "options");
  const optionsCause =
    typeof options === "object" && options !== null
      ? Reflect.get(options, "cause")
      : undefined;
  const directCause = readProp(error, "cause");
  const cause = optionsCause ?? directCause;

  const out: Record<string, unknown> = {
    ...(name ? { name } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(stack ? { stack } : {}),
  };

  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out.cause = serializeCaughtError(cause, depth + 1);
  } else if (Object.keys(out).length === 0) {
    try {
      out.raw = JSON.parse(
        redactSensitive(JSON.stringify(error) ?? "null")
      );
    } catch {
      out.raw = redactSensitive(String(error));
    }
  }

  return out;
}

export function logSdkCaughtError(scope: string, error: unknown): void {
  if (!catchLoggingEnabled) return;
  const payload = serializeCaughtError(error);
  // Only log the redacted payload — never the raw Error (may embed secrets).
  console.error(`[cross-chain-aggregation-dex] catch:${scope}`, payload);
}
