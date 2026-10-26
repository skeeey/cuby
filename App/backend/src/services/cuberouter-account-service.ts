/** Cuberouter account service module. */
import {
  isTextChatModelId,
  type CuberouterAuthInput,
  type CuberouterAuthResult,
  type OkResponse
} from "@memmy/local-api-contracts";
import {
  DESKTOP_TOKEN_NAME,
  type CuberouterClient,
  type CuberouterCurrencySettings,
  type CuberouterErrorCode,
  type CuberouterOrganization,
  type CuberouterPersonalToken,
  type CuberouterRegistrationRequirements
} from "../adapters/outbound/cuberouter-client/index.js";
import type { AccountSessionRepository } from "../infrastructure/app-state-store/repositories/account-session-repo.js";
import type { CuberouterAccountNodeRepository } from "../infrastructure/app-state-store/repositories/cuberouter-account-node-repo.js";
import type { ApiErrorCode } from "./error-envelope.js";
import { FALLBACK_NODE_ID, type CuberouterNodeRouter } from "./cuberouter-node-router.js";
import { imageGenerationModelIds, textChatModelIds } from "./cuberouter-model-kinds.js";

/** Renew this long before the deadline, so a call in flight cannot outlive its token. */
const ACCESS_TOKEN_RENEWAL_SKEW_SECONDS = 60;

/**
 * What the panel shows when `/api/status` cannot be read: the raw quota, never a currency the
 * instance did not name.
 */
const FALLBACK_CURRENCY: CuberouterCurrencySettings = {
  displayType: "TOKENS",
  quotaPerUnit: 500_000,
  usdToCurrencyRate: 1,
  symbol: ""
};

const CUBEROUTER_ERROR_CODES: Record<CuberouterErrorCode, ApiErrorCode> = {
  two_factor_required: "invalid_argument",
  rejected: "invalid_argument",
  // Transport failures keep their own code rather than folding into "internal": the desktop
  // renders business messages only for codes it knows, so "internal" would swallow the
  // "cannot reach cuberouter" copy that the spec promises on the most likely failure.
  service_unavailable: "cuberouter_unavailable",
  // The send-code rate limit is a 429 on the wire, so it maps onto the existing 429 code
  // and keeps cuberouter's own "wait N seconds" message.
  email_code_throttled: "rate_limited",
  // No provisioned key, or no permission to read it: the member has to ask an administrator.
  organization_token_unavailable: "cuberouter_key_unavailable",
  // The access token was refused. Its own 401 code, so the desktop can tell "log in again"
  // apart from the retryable failures it renders for everything else.
  session_expired: "unauthorized"
};

/**
 * The cuberouter error code a failure carries, when the adapter gave it one. Read raw rather than
 * through the mapped `ApiErrorCode`: several cuberouter codes map onto one local code, and the
 * caller here needs to tell them apart.
 */
function cuberouterCode(error: unknown): CuberouterErrorCode | undefined {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: CuberouterErrorCode }).code
    : undefined;
}

/**
 * Maps cuberouter's own codes onto the local API contract on the way out of a service call.
 *
 * Without this, `withErrorEnvelope` sees a code it does not know and answers a flat 500
 * "internal", so a refused token, a rejected key and an unreachable instance all reached the
 * desktop looking like a crash — and none of them could say which.
 */
function asApiErrors<TArgs extends unknown[], TResult>(
  run: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    try {
      return await run(...args);
    } catch (error) {
      throw toApiError(error);
    }
  };
}

/**
 * Maps a cuberouter adapter failure onto the local API error contract, keeping the
 * server's own message. Without this every cuberouter rejection surfaces as HTTP 500
 * "internal" (see `withErrorEnvelope`'s unknown-code fallback), so a wrong password
 * would be indistinguishable from a crash.
 */
function toApiError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = cuberouterCode(error);
  return Object.assign(new Error(message), { code: code ? CUBEROUTER_ERROR_CODES[code] : "internal" });
}

export interface CuberouterModelChoices {
  account: { username: string; organizationName: string | null };
  /** The current line's OpenAI-compatible base (`<线路>/v1`) the panel reads and writes against. */
  apiBase: string;
  keys: Array<{
    scope: "organization" | "personal";
    id: number;
    name: string;
    secret?: string;
    status?: number;
    usable: boolean;
    billing:
      | { kind: "personal"; remainingQuota: number | null }
      | { kind: "organization"; organizationName: string; remainingQuota: number | null };
  }>;
  models: string[];
  /** How this line wants its quota shown; raw quota when the status read failed. */
  currency: CuberouterCurrencySettings;
}

export interface CuberouterAccountService {
  register(input: CuberouterAuthInput & { nodeId?: string }): Promise<CuberouterAuthResult>;
  login(input: { username: string; password: string; nodeId?: string }): Promise<CuberouterAuthResult>;
  /** Probes the target instance so the form matches what it will accept. */
  getRegistrationRequirements(nodeId?: string): Promise<CuberouterRegistrationRequirements>;
  /** Asks the target instance to email a verification code, for the line the caller picked. */
  sendEmailVerificationCode(email: string, nodeId?: string): Promise<{ ok: true }>;
  /** The configured lines and the one currently in effect. */
  getNodes(): Promise<{
    nodes: string[];
    currentNodeId: string | null;
    /** Node id to base URL, used by the desktop to identify endpoints it owns. */
    nodeUrls: Record<string, string>;
  }>;
  /** Measures every line and reports which one a first registration should use. */
  probeNodes(): Promise<{ nodes: string[]; defaultNodeId: string | null }>;
  /** The desktop's model page data: my keys with their billing, the selectable models, balance. */
  readModelChoices(): Promise<CuberouterModelChoices>;
  /** The models one selected key may call, read through the instance's relay model list. */
  getKeyModels(input: { scope: "organization" | "personal"; id: number }): Promise<{
    models: string[];
    imageModels: string[];
  }>;
  /** One personal key's plaintext, read at the moment the user selects it. */
  getPersonalKey(tokenId: number): Promise<{ key: string }>;
  /**
   * Changes the signed-in account's password. The instance verifies the current password and
   * rotates this session's access token; every other session is revoked.
   */
  changePassword(input: { originalPassword: string; newPassword: string }): Promise<OkResponse>;
  /** Re-runs the instance-side find-or-create of the signed-in account's key, without a login. */
  reprovisionKey(): Promise<{ apiKey: string; apiBase: string; model: string }>;
  logout(): Promise<{ ok: true }>;
}

export interface CreateCuberouterAccountServiceOptions {
  /** Builds a client for one node's URL. */
  clientFor: (url: string) => CuberouterClient;
  /** Account session repository. */
  accountSessionRepository: AccountSessionRepository;
  /** Which line each account was registered on. */
  accountNodes: CuberouterAccountNodeRepository;
  /** Node table, probing and the current line. */
  nodeRouter: CuberouterNodeRouter;
  /** Fixed model provisioned for the desktop. */
  model: string;
  log?: (message: string) => void;
}

/**
 * Handles to cuberouter account uuid. The node is part of the identity: the same username (and
 * even the same numeric user id) on two deployments is two different accounts.
 */
export function toCuberouterAccountUuid(nodeId: string, userId: string): string {
  return `cuberouter:${nodeId}:${userId}`;
}

/**
 * The organization token an account reads. One key per person, named after the account, so the
 * instance's console attributes a key to whoever holds it instead of pooling everyone behind one
 * name. Usernames are email addresses on these deployments, and the domain says nothing about
 * which person is asking; the local part is the part an administrator recognizes.
 *
 * Case and punctuation are kept exactly as the instance stores them: cuberouter usernames are
 * case-sensitive, so a folded name would simply not match the key that was created.
 */
export function toDesktopTokenName(username: string, prefix: string = DESKTOP_TOKEN_NAME): string {
  const trimmed = username.trim();
  const domain = trimmed.indexOf("@");
  const local = domain > 0 ? trimmed.slice(0, domain) : trimmed;
  return `${prefix}-${local.trim()}`;
}

/** Creates create cuberouter account service. */
export function createCuberouterAccountService(
  options: CreateCuberouterAccountServiceOptions
): CuberouterAccountService {
  const log = options.log ?? (() => undefined);

  /** Resolves a node id to its URL and client. An id outside the table is a caller bug. */
  function clientForNode(nodeId: string): { client: CuberouterClient; url: string } {
    const url = options.nodeRouter.getNodeUrl(nodeId);
    if (!url) {
      throw Object.assign(new Error("未知的线路"), { code: "invalid_argument" as const });
    }
    return { client: options.clientFor(url), url };
  }

  /**
   * Applies the build's fallback rule to a probe result: nothing reachable means the default
   * line, and a single-node table (pinned URL) has only itself to offer. Returns null when the
   * table holds nothing usable — a caller that cannot offer any line must say so, never name one
   * that does not exist.
   */
  function withFallback(probed: string | null): string | null {
    if (options.nodeRouter.getNodeUrl(probed ?? "")) {
      return probed!;
    }
    if (options.nodeRouter.getNodeUrl(FALLBACK_NODE_ID)) {
      return FALLBACK_NODE_ID;
    }
    return options.nodeRouter.listNodes()[0]?.id ?? null;
  }

  /** Where a first registration should go when the caller did not pick: the probed default. */
  async function defaultNodeId(): Promise<string> {
    const resolved = withFallback((await options.nodeRouter.probe()).defaultNodeId);
    if (!resolved) {
      throw Object.assign(new Error("没有可用的 cuberouter 线路"), { code: "invalid_argument" as const });
    }
    return resolved;
  }

  /** The line a returning caller is already on: the stored one, else the probed default. */
  async function currentOrProbedNodeId(): Promise<string> {
    const preferred = await options.nodeRouter.getPreferredNodeId();
    return options.nodeRouter.getNodeUrl(preferred ?? "") ? preferred! : await defaultNodeId();
  }

  /**
   * Login candidates, most likely first: the remembered line, the current line, then the
   * probed default and the build's fallback. Only the first two are tried — the two deployments
   * hold separate accounts, so a third attempt would only add latency and login rate-limit risk.
   */
  async function loginOrder(username: string, pickedNodeId?: string): Promise<string[]> {
    const inTable = (nodeId: string | null | undefined): nodeId is string =>
      Boolean(nodeId) && options.nodeRouter.getNodeUrl(nodeId!) !== null;
    const known = [
      pickedNodeId,
      options.accountNodes.get(username),
      await options.nodeRouter.getPreferredNodeId()
    ].filter(inTable);

    // With a line already known the first slot is decided, and the second is whatever else the
    // table holds — measuring the lines could not change the order, so it must not cost the user
    // its latency (up to four status calls) before the first login attempt.
    if (known.length > 0) {
      return [...new Set([...known, ...options.nodeRouter.listNodes().map((node) => node.id)])].slice(0, 2);
    }

    const probed = withFallback((await options.nodeRouter.probe()).defaultNodeId);
    return [...new Set([probed, FALLBACK_NODE_ID, ...options.nodeRouter.listNodes().map((node) => node.id)])]
      .filter(inTable)
      .slice(0, 2);
  }

  /**
   * The access token to authenticate a call with.
   *
   * The instance issues a 15-minute access token and a 30-day refresh token. Until this
   * renewed, a session only ever sent the login-time token, so a quarter of an hour in every
   * call came back 401 and the model page showed its retry state — which could never succeed,
   * because retrying resent the same dead token.
   */
  async function resolveAccessToken(client: CuberouterClient): Promise<string> {
    const credential = options.accountSessionRepository.getCuberouterCredential();
    if (!credential) {
      // Sessions that logged in before the credential was stored have nothing to renew with;
      // they keep their old behaviour until the next login writes one.
      const legacy = options.accountSessionRepository.getCloudUuid();
      if (!legacy) {
        throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
      }
      return legacy;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds < credential.accessExpiresAt - ACCESS_TOKEN_RENEWAL_SKEW_SECONDS) {
      return credential.accessToken;
    }

    if (!credential.refreshToken) {
      throw Object.assign(new Error("登录已过期，请重新登录"), { code: "session_expired" as const });
    }

    const renewed = await client.refreshSession(credential.refreshToken);
    options.accountSessionRepository.setCuberouterCredential(renewed);
    return renewed.accessToken;
  }

  /** Runs one login against one node and records it as the account's line. */
  async function loginOnNode(
    nodeId: string,
    username: string,
    password: string,
    createDirectly: boolean
  ): Promise<CuberouterAuthResult> {
    const { client, url } = clientForNode(nodeId);
    const session = await client.login({ username, password });
    const { apiKey, apiBase, model, organizationName, models } = await provisionKey(
      client,
      url,
      session.accessToken,
      session.username,
      createDirectly
    );
    // "New" is a question about this machine, and the account row is the wrong place to ask it:
    // a row whose uuid was written under a different spelling re-appears as new, and "new"
    // resets the guidance. The line memory is per username, survives a logout, and is written
    // by every successful login — so it answers exactly this.
    const seenBefore = options.accountNodes.get(username) !== null;
    const projection = options.accountSessionRepository.upsert({
      uuid: toCuberouterAccountUuid(nodeId, session.userId),
      cloudUuid: session.accessToken,
      isNewUser: !seenBefore,
      authChannel: "cuberouter",
      profile: {
        userId: session.userId,
        email: null,
        phoneNumber: null,
        nickname: session.displayName,
        avatarUrl: null,
        planType: null,
        hasFinishedGuide: null,
        region: null,
        registeredAt: null,
        identityProvider: "cuberouter",
        // What the sidebar renders for this identity, and what survives restarts in the raw
        // profile below.
        username: session.username,
        organizationName,
        rawProfile: {
          username: session.username,
          displayName: session.displayName,
          ...(organizationName ? { organizationName } : {})
        }
      }
    });
    // After the upsert, never before: the credential is keyed to the active account, and on a
    // first login the row that becomes active does not exist until this call creates it.
    options.accountSessionRepository.setCuberouterCredential({
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt,
      refreshToken: session.refreshToken
    });
    options.accountNodes.set(username, nodeId);
    await options.nodeRouter.setPreferredNodeId(nodeId);
    log(`[cuberouter] ${username} is on ${nodeId} (${url})`);

    return {
      session: projection,
      provisioning: { apiKey, apiBase, model, models }
    };
  }

  /**
   * The account's key on one line, plus what the desktop writes it with: at login this is the
   * find-or-create behind `provisioning`, and 「重新获取 key」 runs exactly it again without a login.
   */
  async function provisionKey(
    client: CuberouterClient,
    url: string,
    accessToken: string,
    username: string,
    createDirectly: boolean
  ): Promise<{ apiKey: string; apiBase: string; model: string; organizationName: string | null; models: string[] | null }> {
    // The organization comes from the membership list, never from a build setting: the same
    // organization has a different id on each deployment, and the list is already per instance.
    const organizations = await client.listOrganizations(accessToken);
    if (organizations.length > 1) {
      log(`[cuberouter] ${username} belongs to ${organizations.length} organizations, using ${organizations[0]!.name}`);
    }
    const organization = organizations[0] ?? null;
    // The name comes from what the instance reports, never from the typed string: an alias would
    // name a key nobody created.
    const tokenName = toDesktopTokenName(username);
    const apiKey = organization
      ? await ensureOrganizationKey(client, accessToken, organization.id, tokenName)
      : await ensurePersonalKey(client, accessToken, tokenName, createDirectly);
    // The key's own list is keyed to its group and model limits; the account-level list is not.
    // A relay outage must not fail login: the caller falls back to the account list.
    const models = await client.getKeyModels(apiKey).then(textChatModelIds).catch((error) => {
      log(`[cuberouter] reading key models failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    return {
      apiKey,
      apiBase: `${url}/v1`,
      model: options.model,
      organizationName: organization?.name ?? null,
      models
    };
  }

  /**
   * The account's key inside one organization, read back when it exists and created when it
   * does not. The name is the account's (see `toDesktopTokenName`), so an administrator's
   * hand-provisioned key and this account's own key are the same key.
   */
  async function ensureOrganizationKey(
    client: CuberouterClient,
    accessToken: string,
    organizationId: string,
    tokenName: string
  ): Promise<string> {
    const tokens = await client.listOrganizationTokens(accessToken, organizationId, tokenName);
    // Exact match after the server's name filter: the filter is a substring match, so a longer
    // name that merely starts with this account's (a second key, say) is not ours.
    const provisioned = tokens.find((token) => token.name === tokenName);
    if (provisioned) {
      return provisioned.key;
    }

    try {
      const created = await client.createOrganizationToken(accessToken, organizationId, {
        name: tokenName,
        unlimitedQuota: true
      });
      log(`[cuberouter] created organization key ${tokenName}`);
      return created.key;
    } catch (error) {
      // Say what the desktop was doing, and keep the instance's own sentence: the same refusal
      // ("permission denied") means something different at login than at creation, and the
      // reason — not a membership, a name too long, the key limit reached — lives in that text.
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`创建组织 API Key（${tokenName}）失败：${message}`), {
        code: "organization_token_unavailable" as const
      });
    }
  }

  /**
   * The account's personal key, for a member of no organization. The list endpoint masks keys,
   * so the plaintext is read per row; a create answers without an id, so the row is found by
   * name afterwards either way.
   */
  async function ensurePersonalKey(
    client: CuberouterClient,
    accessToken: string,
    tokenName: string,
    createDirectly: boolean
  ): Promise<string> {
    try {
      // A fresh registration cannot have a key yet, so it skips the first look; a returning
      // account looks first and reuses whatever it — or an operator — left behind.
      let provisioned = createDirectly ? null : await findPersonalToken(client, accessToken, tokenName);
      if (!provisioned) {
        await client.createPersonalToken(accessToken, { name: tokenName });
        log(`[cuberouter] created personal key ${tokenName}`);
        provisioned = await findPersonalToken(client, accessToken, tokenName);
      }
      if (!provisioned) {
        throw new Error("创建后未能按名字找到这把密钥");
      }
      return await client.getPersonalTokenKey(accessToken, provisioned.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`创建个人 API Key（${tokenName}）失败：${message}`), {
        code: "organization_token_unavailable" as const
      });
    }
  }

  /** Finds one reusable personal token by exact name; the server's filter is a LIKE pattern, so compare again. */
  async function findPersonalToken(
    client: CuberouterClient,
    accessToken: string,
    tokenName: string
  ): Promise<CuberouterPersonalToken | null> {
    const tokens = await client.searchPersonalTokens(accessToken, tokenName);
    // Only an enabled key is worth provisioning: the personal search cannot filter by status on
    // the server (the organization path can), and a disabled or exhausted one would be written
    // into the model config and every request would fail. An instance that does not report the
    // field reads as enabled; creating a second key under the same name is allowed, so a miss
    // self-heals on the next line below.
    return tokens.find(
      (token) => token.name === tokenName && (token.status === undefined || token.status === 1)
    ) ?? null;
  }

  /** The desktop's model page data: my keys with their billing, the selectable models, balance. */
  async function readModelChoices(): Promise<CuberouterModelChoices> {
    const session = options.accountSessionRepository.get();
    if (!session.authenticated) {
      throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
    }
    const { client, url } = clientForNode(await currentOrProbedNodeId());
    const accessToken = await resolveAccessToken(client);

    // Core reads propagate: the panel must show its retry state, not an empty key list that looks
    // like "the account has no keys". Only the balance and the display currency degrade, because
    // they are decoration.
    const [organizations, currency] = await Promise.all([
      client.listOrganizations(accessToken),
      client.getCurrencySettings().catch((error) => {
        log(`[cuberouter] reading currency settings failed: ${error instanceof Error ? error.message : String(error)}`);
        return FALLBACK_CURRENCY;
      })
    ]);
    const organization = organizations[0] ?? null;
    // The instance numbers users, and a profile without a usable id must not be sent as one:
    // 0 is the instance's own "no server-side filter", and the row filter below decides instead.
    const ownerUserId = Number(session.profile.userId);
    const hasOwner = Number.isFinite(ownerUserId) && ownerUserId > 0;
    const organizationTokens = organization
      ? await client.listMyOrganizationTokens(accessToken, organization.id, hasOwner ? ownerUserId : 0)
      : [];
    const personalTokens = await client.listPersonalTokens(accessToken);
    const models = (await client.getUserModels(accessToken)).filter(isTextChatModelId);
    const self = await client.getSelf(accessToken).catch((error) => {
      log(`[cuberouter] reading self quota failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });

    const personalQuota = self?.quota ?? null;
    const organizationQuota = organization && organization.quota !== undefined && organization.usedQuota !== undefined
      ? organization.quota - organization.usedQuota
      : null;

    return {
      account: { username: session.profile.username ?? "", organizationName: organization?.name ?? null },
      apiBase: `${url}/v1`,
      keys: [
        ...organizationTokens
          // A plain member's list includes the organization's public keys, held by other people.
          .filter(
            (token) =>
              token.responsibleUserId === undefined || (hasOwner && token.responsibleUserId === ownerUserId)
          )
          .map((token) => ({
            scope: "organization" as const,
            id: token.id,
            name: token.name,
            secret: token.key,
            ...(token.status === undefined ? {} : { status: token.status }),
            usable: token.status === undefined || token.status === 1,
            billing: {
              kind: "organization" as const,
              organizationName: organization?.name ?? "",
              remainingQuota: organizationQuota
            }
          })),
        ...personalTokens.map((token) => ({
          scope: "personal" as const,
          id: token.id,
          name: token.name,
          ...(token.status === undefined ? {} : { status: token.status }),
          usable: token.status === undefined || token.status === 1,
          billing: { kind: "personal" as const, remainingQuota: personalQuota }
        }))
      ],
      models,
      currency
    };
  }

  /** One personal key's plaintext, read at the moment the user selects it. */
  async function getPersonalKey(tokenId: number): Promise<{ key: string }> {
    if (!options.accountSessionRepository.get().authenticated) {
      throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
    }
    const { client } = clientForNode(await currentOrProbedNodeId());
    const accessToken = await resolveAccessToken(client);
    return { key: await client.getPersonalTokenKey(accessToken, tokenId) };
  }

  /**
   * The models one selected key may call. The relay's `/v1/models` applies the token's group,
   * model limits and the member allow list, which `/api/user/models` does not.
   */
  async function getKeyModels(input: {
    scope: "organization" | "personal";
    id: number;
  }): Promise<{ models: string[]; imageModels: string[] }> {
    const session = options.accountSessionRepository.get();
    if (!session.authenticated) {
      throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
    }
    const { client } = clientForNode(await currentOrProbedNodeId());
    const accessToken = await resolveAccessToken(client);

    let apiKey: string;
    if (input.scope === "personal") {
      apiKey = await client.getPersonalTokenKey(accessToken, input.id);
    } else {
      const organization = (await client.listOrganizations(accessToken))[0] ?? null;
      if (!organization) {
        throw Object.assign(new Error("当前账号不属于任何组织"), {
          code: "organization_token_unavailable" as const
        });
      }
      const ownerUserId = Number(session.profile.userId);
      const hasOwner = Number.isFinite(ownerUserId) && ownerUserId > 0;
      const tokens = await client.listMyOrganizationTokens(
        accessToken,
        organization.id,
        hasOwner ? ownerUserId : 0
      );
      const token = tokens.find((item) => item.id === input.id);
      if (!token?.key) {
        throw Object.assign(new Error("未找到该组织 Key"), {
          code: "organization_token_unavailable" as const
        });
      }
      apiKey = token.key;
    }

    const models = await client.getKeyModels(apiKey);
    return {
      models: textChatModelIds(models),
      imageModels: imageGenerationModelIds(models)
    };
  }

  /**
   * Changes the account password. The instance invalidates the old access token as part of the
   * change, so the rotated one it answers with has to replace the stored credential before the
   * next call — otherwise every request after a successful change would answer 401.
   */
  async function changePassword(input: {
    originalPassword: string;
    newPassword: string;
  }): Promise<OkResponse> {
    if (!options.accountSessionRepository.get().authenticated) {
      throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
    }
    const { client } = clientForNode(await currentOrProbedNodeId());
    const accessToken = await resolveAccessToken(client);
    const rotated = await client.changePassword(accessToken, input);
    const credential = options.accountSessionRepository.getCuberouterCredential();
    options.accountSessionRepository.setCuberouterCredential({
      accessToken: rotated.accessToken,
      accessExpiresAt: rotated.accessExpiresAt,
      // The refresh token is not rotated by a password change, and a session that predates
      // credentials stays without one — renewal then reports an expired session, as before.
      refreshToken: credential?.refreshToken ?? null
    });
    return { ok: true };
  }

  return {
    async register(input) {
      // Resolved once, before the try: the account must be created and then logged into on the
      // SAME node, and an unknown node id has to keep its own error code (the adapter mapping
      // below only knows cuberouter's codes and would fold anything else into internal).
      const nodeId = input.nodeId ?? await defaultNodeId();
      const { client, url } = clientForNode(nodeId);

      try {
        await client.register({
          username: input.username,
          password: input.password,
          ...(input.email ? { email: input.email } : {}),
          ...(input.verificationCode ? { verificationCode: input.verificationCode } : {})
        });
        return await loginOnNode(nodeId, input.username, input.password, true);
      } catch (error) {
        log(`[cuberouter] register/login on ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
        throw toApiError(error);
      }
    },

    async getRegistrationRequirements(nodeId) {
      // The two deployments can differ (email verification, Turnstile), so this reads the line
      // the caller is looking at rather than whatever was read last.
      const { client } = clientForNode(nodeId ?? await currentOrProbedNodeId());
      try {
        return await client.getRegistrationRequirements();
      } catch (error) {
        throw toApiError(error);
      }
    },

    async sendEmailVerificationCode(email, nodeId) {
      // The code is instance-local, so it must be requested from the line the account will be
      // created on — the current line would produce a code the selected one cannot validate.
      const { client } = clientForNode(nodeId ?? await currentOrProbedNodeId());
      try {
        await client.sendEmailVerificationCode(email);
        return { ok: true as const };
      } catch (error) {
        throw toApiError(error);
      }
    },

    async getNodes() {
      const configured = options.nodeRouter.listNodes();
      const nodes = configured.map((node) => node.id);
      const preferred = await options.nodeRouter.getPreferredNodeId();
      return {
        nodes,
        currentNodeId: preferred && nodes.includes(preferred) ? preferred : null,
        nodeUrls: Object.fromEntries(configured.map((node) => [node.id, node.url]))
      };
    },

    async probeNodes() {
      const nodes = options.nodeRouter.listNodes().map((node) => node.id);
      // The UI preselects whatever this returns, so the fallback (nothing reachable → the
      // build's default line) is applied here rather than left for the caller to guess.
      return { nodes, defaultNodeId: withFallback((await options.nodeRouter.probe()).defaultNodeId) };
    },

    async login(input) {
      const order = await loginOrder(input.username, input.nodeId);
      if (order.length === 0) {
        throw Object.assign(new Error("没有可用的 cuberouter 线路"), { code: "invalid_argument" as const });
      }

      let lastError: Error | null = null;
      // Held back rather than reported: see the rule below the loop.
      let rejection: Error | null = null;
      for (const nodeId of order) {
        try {
          return await loginOnNode(nodeId, input.username, input.password, false);
        } catch (error) {
          const apiError = toApiError(error);
          // A rejection only means "wrong credentials" when nothing else went wrong. The lines
          // hold separate accounts, so the line this one is not on answers with a rejection every
          // time — reporting it would tell a visitor who typed the right password that it is
          // wrong, and bury the failure they could have acted on.
          if (cuberouterCode(error) === "rejected") {
            rejection = apiError;
          } else {
            lastError = apiError;
          }
          log(
            `[cuberouter] login on ${nodeId} failed, trying the next line: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      // With both lines rejecting, wrong credentials remain the likeliest reading: the account
      // exists on one of them, and the visitor is on the wrong one just as often.
      throw lastError ?? rejection ?? Object.assign(new Error("cuberouter 登录失败"), { code: "internal" as const });
    },

    readModelChoices: asApiErrors(readModelChoices),

    getKeyModels: asApiErrors(getKeyModels),

    getPersonalKey: asApiErrors(getPersonalKey),

    changePassword: asApiErrors(changePassword),

    reprovisionKey: asApiErrors(async () => {
      const session = options.accountSessionRepository.get();
      if (!session.authenticated) {
        throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
      }
      const { client, url } = clientForNode(await currentOrProbedNodeId());
      const accessToken = await resolveAccessToken(client);
      // Look first, as a re-login does: the desktop calls this to refresh a key that already
      // exists, and creating a second one under the same name would pool two keys for one account.
      const { apiKey, apiBase, model } = await provisionKey(
        client,
        url,
        accessToken,
        session.profile.username ?? "",
        false
      );
      return { apiKey, apiBase, model };
    }),

    async logout() {
      options.accountSessionRepository.clear();
      return { ok: true };
    }
  };
}
