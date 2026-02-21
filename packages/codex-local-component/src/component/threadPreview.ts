export const UNTITLED_THREAD_PREVIEW = "Untitled thread";

type LifecyclePreviewEvent = {
  kind: string;
  payloadJson: string;
};

function trimToNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readThreadNameFromPayload(payloadJson: string): string | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    void error;
    return undefined;
  }
  const record = asObject(parsed);
  if (!record) {
    return undefined;
  }

  const directPrimary = trimToNonEmpty(record.threadName);
  const directSecondary = trimToNonEmpty(record.thread_name);
  const direct = directPrimary !== null ? directPrimary : directSecondary;
  if (direct) {
    return direct;
  }

  const params = asObject(record.params);
  if (!params) {
    return undefined;
  }

  if ("threadName" in params || "thread_name" in params) {
    const paramPrimary = trimToNonEmpty(params.threadName);
    const paramSecondary = trimToNonEmpty(params.thread_name);
    if (paramPrimary !== null) {
      return paramPrimary;
    }
    if (paramSecondary !== null) {
      return paramSecondary;
    }
    return null;
  }

  return undefined;
}

function resolveThreadNameFromLifecycle(events: LifecyclePreviewEvent[]): string | null {
  for (const event of events) {
    if (event.kind !== "thread/name/updated") {
      continue;
    }
    const parsed = readThreadNameFromPayload(event.payloadJson);
    if (parsed === undefined) {
      return null;
    }
    return parsed;
  }
  return null;
}

export function deriveThreadPreview(args: {
  lifecycleEvents: LifecyclePreviewEvent[];
  firstUserMessageText?: string | null;
}): string {
  const threadName = resolveThreadNameFromLifecycle(args.lifecycleEvents);
  if (threadName) {
    return threadName;
  }
  const fallbackFromMessage = trimToNonEmpty(args.firstUserMessageText);
  if (fallbackFromMessage) {
    return fallbackFromMessage;
  }
  return UNTITLED_THREAD_PREVIEW;
}
