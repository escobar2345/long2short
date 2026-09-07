// Small shared helper for riding out the user's flaky router DNS: domains like
// api.apify.com / api.buffer.com / integrate.api.nvidia.com intermittently fail
// with SERVFAIL/ENOTFOUND even though they resolve seconds later. Every
// outbound network call in this app goes through withRetry so one transient
// blip doesn't kill the whole pipeline.

export function isTransientError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err);
  const statusCode = Number(
    (err as any)?.statusCode ?? (err as any)?.status ?? 0
  );
  return (
    /ENOTFOUND|ESERVFAIL|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR|fetch failed|network|socket hang up|timeout|timed out|empty reply|Too Many Requests|HTTP Error 429|502|503|504/i.test(
      msg
    ) || [429, 502, 503, 504].includes(statusCode)
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 1500
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}
