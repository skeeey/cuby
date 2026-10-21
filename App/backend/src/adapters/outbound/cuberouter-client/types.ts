/** Cuberouter client types. */

export type CuberouterErrorCode =
  | "two_factor_required"
  | "service_unavailable"
  | "rejected"
  /** The send-code endpoint's own rate limit (two sends per IP per 30s). */
  | "email_code_throttled"
  /** No provisioned organization key, or no permission to read it. */
  | "organization_token_unavailable"
  /** The instance rejected the access token: it expired, or the session was revoked. */
  | "session_expired";

/**
 * The instance's rotating credentials. The access token is short-lived (15 minutes on the
 * instance this was built against), so it has to be renewed from the refresh token rather
 * than reused for the life of the login.
 */
export interface CuberouterAccess {
  accessToken: string;
  /** Epoch seconds, as the instance reports it in `access_expires_at`. */
  accessExpiresAt: number;
  /** Absent when the instance issues no refresh cookie, so renewal stays impossible. */
  refreshToken: string | null;
}

export interface CuberouterSession extends CuberouterAccess {
  userId: string;
  username: string;
  displayName: string;
}

/** What the target instance requires before it will accept a registration. */
export interface CuberouterRegistrationRequirements {
  emailVerificationRequired: boolean;
  turnstileRequired: boolean;
  /**
   * The URL the instance names itself with (`server_address`). Admin-configured, so it is only
   * ever a soft signal: a probe compares it against the URL it dialed and logs a mismatch.
   */
  serverAddress: string | null;
}

/** How the instance's public status says quotas should be shown. */
export type CuberouterCurrencyDisplayType = "USD" | "CNY" | "TOKENS" | "CUSTOM";

/**
 * The display currency the instance publishes on `/api/status`. The instance stores quota in
 * units where `quotaPerUnit` equals one USD; every money display is
 * `quota / quotaPerUnit * usdToCurrencyRate`.
 */
export interface CuberouterCurrencySettings {
  displayType: CuberouterCurrencyDisplayType;
  /** Quota units that equal one USD (500,000 on the instances this was built against). */
  quotaPerUnit: number;
  /** 1 USD in the display currency; 1 for USD, `usd_exchange_rate` for CNY, custom rate otherwise. */
  usdToCurrencyRate: number;
  /** `$`, `¥`, the configured custom symbol (HKD), or empty when displaying raw quota. */
  symbol: string;
}

/** An organization the signed-in member belongs to, as that instance numbers it. */
export interface CuberouterOrganization {
  id: string;
  name: string;
  /** The organization's pool (`quota`) and how much of it is spent, when the instance reports them. */
  quota?: number;
  usedQuota?: number;
}

/** The signed-in member's own quota, as `GET /api/user/self` reports it. */
export interface CuberouterSelfSummary {
  /** Remaining quota, the number the instance spends from. */
  quota: number;
  /** Quota already consumed; display only. */
  usedQuota: number;
}

/** One organization token, with the plaintext key the instance returns to permitted members. */
export interface CuberouterOrganizationToken {
  id: number;
  name: string;
  key: string;
  /** The instance's token state (1 enabled, 2 disabled, 3 expired, 4 exhausted). */
  status?: number;
  /** The member this key is held by; the picker keeps only the caller's own rows. */
  responsibleUserId?: number;
}

/** One of the member's own (personal) tokens. The list masks the key, so only id/name are usable. */
export interface CuberouterPersonalToken {
  id: number;
  name: string;
  /** The instance's key state (1 enabled, 2 disabled, 3 expired, 4 exhausted). */
  status?: number;
}

/** Default prefix of the per-account organization token names the desktop provisions from. */
export const DESKTOP_TOKEN_NAME = "cuby-desktop";

export interface CuberouterClient {
  register(input: {
    username: string;
    password: string;
    /** Required by the instance when it has email verification enabled. */
    email?: string;
    verificationCode?: string;
  }): Promise<void>;
  login(input: { username: string; password: string }): Promise<CuberouterSession>;
  /**
   * Changes the signed-in account's password. Cuberouter verifies `originalPassword` and
   * returns a new access token for this session; every other session is revoked.
   */
  changePassword(
    accessToken: string,
    input: { originalPassword: string; newPassword: string }
  ): Promise<{ accessToken: string; accessExpiresAt: number }>;
  /**
   * Renews the access token from the refresh cookie the login handed back. The instance
   * rotates the cookie on every call, so the returned one replaces the stored one.
   */
  refreshSession(refreshToken: string): Promise<CuberouterAccess>;
  /** Reads the instance's public status so the form can match what it will accept. */
  getRegistrationRequirements(options?: { timeoutMs?: number }): Promise<CuberouterRegistrationRequirements>;
  /** Reads the quota display currency the model panel uses for balances. */
  getCurrencySettings(): Promise<CuberouterCurrencySettings>;
  /** Asks the instance to email a verification code. */
  sendEmailVerificationCode(email: string): Promise<void>;
  /**
   * Lists the organization's enabled tokens (name-filtered) as the signed-in member. The key is
   * the provisioned API key: organizations hand the full secret to permitted members, which is
   * why the desktop no longer mints a personal token of its own.
   */
  /**
   * Lists the member's organizations. Ids are per instance: the same organization has a different
   * id on each deployment, which is why a build names it and each instance resolves the id.
   */
  listOrganizations(accessToken: string): Promise<CuberouterOrganization[]>;
  listOrganizationTokens(
    accessToken: string,
    organizationId: string,
    tokenName: string
  ): Promise<CuberouterOrganizationToken[]>;
  /**
   * Creates an organization token held by the signed-in member, and returns its secret. The
   * instance lets a member create only their own private keys, so those two facts are the
   * request's shape and not parameters: a public key or another holder is refused with
   * `permission denied` (see `ensureOrganizationTokenVisibilityAllowed`).
   */
  createOrganizationToken(
    accessToken: string,
    organizationId: string,
    input: { name: string; unlimitedQuota: boolean }
  ): Promise<CuberouterOrganizationToken>;
  /**
   * Lists the member's personal tokens whose name matches. The instance's keyword filter is an
   * exact full match unless it contains `%`, and it is a LIKE pattern either way — the caller
   * still compares the returned names exactly.
   */
  searchPersonalTokens(accessToken: string, tokenName: string): Promise<CuberouterPersonalToken[]>;
  /**
   * Creates a personal token. The instance answers a create with `{success:true}` and nothing
   * else, so the caller finds the new row through `searchPersonalTokens`.
   */
  createPersonalToken(accessToken: string, input: { name: string }): Promise<void>;
  /** Reads one personal token's plaintext key, which the list endpoint never returns. */
  getPersonalTokenKey(accessToken: string, tokenId: number): Promise<string>;
  /** The member's own quota, for the model page's balance annotation. */
  getSelf(accessToken: string): Promise<CuberouterSelfSummary>;
  /** The model names the member's groups may call. No capability metadata: names only. */
  getUserModels(accessToken: string): Promise<string[]>;
  /** Every personal token of the member (masked), newest first, one page. */
  listPersonalTokens(accessToken: string): Promise<CuberouterPersonalToken[]>;
  /**
   * The organization tokens held by one member — the picker's "my keys". A plain member is
   * scoped to their own tokens by the instance anyway; naming the member makes a manager's call
   * mean the same thing instead of listing the whole organization.
   */
  listMyOrganizationTokens(
    accessToken: string,
    organizationId: string,
    responsibleUserId: number
  ): Promise<CuberouterOrganizationToken[]>;
}
