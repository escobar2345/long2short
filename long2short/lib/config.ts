// Human-readable setup diagnostics: which env vars are set and which are
// missing, so the UI can tell the user EXACTLY what to configure instead of
// surfacing a bare 500 when the pipeline's credentials aren't there yet.

export interface ConfigItem {
  key: string;
  label: string;
  hint: string; // where to get it
  set: boolean;
}

export interface ConfigStatus {
  items: ConfigItem[];
  missing: ConfigItem[];
  complete: boolean;
}

const REQUIRED: Array<{ key: string; label: string; hint: string }> = [
  {
    key: "APIFY_TOKEN",
    label: "Apify API token",
    hint: "console.apify.com → Settings → Integrations",
  },
  {
    key: "APIFY_YOUTUBE_ACTOR_ID",
    label: "Apify YouTube actor ID",
    hint: "apify.com/store (e.g. a transcript + video-download actor)",
  },
  {
    key: "NVIDIA_API_KEY",
    label: "NVIDIA build API key",
    hint: "build.nvidia.com → your API key",
  },
  {
    key: "NEXT_PUBLIC_BASE_URL",
    label: "Public base URL (posts need it)",
    hint: "your deployed URL — NOT localhost",
  },
];

export function getConfigStatus(): ConfigStatus {
  const items: ConfigItem[] = REQUIRED.map((r) => ({
    ...r,
    set: Boolean(process.env[r.key] && String(process.env[r.key]).trim()),
  }));
  const missing = items.filter((i) => !i.set);
  return { items, missing, complete: missing.length === 0 };
}