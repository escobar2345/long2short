// Next.js instrumentation hook — runs once when the server boots (dev + prod).
// Patches dns.lookup process-wide so EVERY outbound connection (NVIDIA, Apify,
// Buffer, YouTube CDNs) resolves via 1.1.1.1 / 8.8.8.8 first, with the system
// resolver as fallback. See lib/resilientDns.ts for why: the router's DNS on
// this machine intermittently fails lookups (EAI_AGAIN), and retrying the
// same resolver just fails again.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { patchDnsLookup } = await import("./lib/resilientDns");
    patchDnsLookup();
    console.log("[long2short] resilient DNS installed (1.1.1.1/8.8.8.8 direct, system fallback)");
  }
}