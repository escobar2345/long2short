// Client-safe types shared by the UI components. These mirror what the API
// routes actually return (tokens are masked server-side — see
// lib/accounts.ts publicAccount()).

export interface PublicAccount {
  id: string;
  name: string;
  organizationId: string;
  addedAt: string;
  tokenMask: string;
}

export interface ClientChannel {
  id: string;
  service: string;
  displayName: string;
}

/** One account + its channels, as returned by GET /api/buffer/channels. */
export interface AccountChannels {
  account: PublicAccount;
  channels: ClientChannel[];
  error?: string;
}

export interface PostTargetResult {
  accountId: string;
  channelId: string;
  ok: boolean;
  post?: unknown;
  error?: string;
}

export interface PostResponse {
  results: PostTargetResult[];
  summary: { total: number; succeeded: number; failed: number };
}