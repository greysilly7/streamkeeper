import { downloadSourceConfig, resolveHosts, verifySourceHosts } from "./installer";
import { probe, routeRequest, updateHostHealth } from "./routing";
import {
  deleteAccount,
  getAccount,
  getAccountPassword,
  getDefaultUserState,
  getHostHealth,
  getUserState,
  listAccounts,
  publicAccount,
  putAccount,
  putHostHealth,
} from "./state";
import type {
  AccountRecord,
  Config,
  Env,
  HealthStore,
  HostHealth,
  HostHealthEntry,
  JsonData,
  JsonObject,
  JwtPayload,
  Source,
  UserState,
} from "./types";
import { errorMessage, isRecord } from "./types";
import { accountCardHtml, dashboardPage, statelessManagePage, statelessSetupPage } from "./ui/render";
import {
  authenticateRequest,
  corsHeaders,
  createJWT,
  createStatelessToken,
  getSigningKey,
  jsonError,
  log,
  normalizeUserHost,
  normalizeUserHosts,
  parseManifestUrl,
  parseStremioPath,
  readStatelessToken,
  revokeJWTSession,
  revokeStatelessToken,
  revokeTokenLineage,
  sha256Hex,
  verifyPassword,
} from "./utils";

export { FailoverCoordinator } from "./failover";

const THROTTLE_LIMIT = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1e3;

function requestIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unidentified"
  );
}

async function throttleByIp(
  request: Request,
  env: Env,
  limit = THROTTLE_LIMIT,
  windowMs = THROTTLE_WINDOW_MS,
): Promise<{ blocked: boolean; ip: string }> {
  const ip = requestIp(request);
  const key = `throttle:${await sha256Hex(ip)}`;
  const now = Date.now();
  try {
    const saved = await env.AIO_KV.get<JsonData>(key, "json");
    const record =
      isRecord(saved) &&
      typeof saved.count === "number" &&
      Number.isSafeInteger(saved.count) &&
      saved.count >= 0 &&
      typeof saved.resetAt === "number" &&
      Number.isFinite(saved.resetAt)
        ? { count: saved.count, resetAt: saved.resetAt }
        : null;
    if (record && record.resetAt > now && record.count >= limit) return { blocked: true, ip };
    const next =
      record && record.resetAt > now
        ? { count: record.count + 1, resetAt: record.resetAt }
        : { count: 1, resetAt: now + windowMs };
    await env.AIO_KV.put(key, JSON.stringify(next), {
      expirationTtl: Math.max(60, Math.ceil((next.resetAt - now) / 1e3)),
    });
    return { blocked: false, ip };
  } catch {
    return { blocked: true, ip };
  }
}

async function resetThrottle(env: Env, ip: string): Promise<void> {
  await env.AIO_KV.delete(`throttle:${await sha256Hex(ip)}`);
}

const MAX_PUBLIC_BODY_BYTES = 1 * 1024 * 1024;

type LimitedJsonBody = { body?: JsonObject; tooLarge: boolean };

async function readJsonObjectWithLimit(request: Request): Promise<LimitedJsonBody> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared >= 0 && declared > MAX_PUBLIC_BODY_BYTES) return { tooLarge: true };
  if (!request.body) return { tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PUBLIC_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { tooLarge: false };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: JsonData = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(value) ? { tooLarge: false, body: value } : { tooLarge: false };
  } catch {
    return { tooLarge: false };
  }
}

function parsePersistedRoutingState(value: JsonData | null): Partial<UserState> {
  if (!isRecord(value)) return {};
  const result: Partial<UserState> = {};
  const currentHost = typeof value.currentHost === "string" ? normalizeUserHost(value.currentHost) : null;
  if (currentHost) result.currentHost = currentHost;
  if (typeof value.currentUuid === "string" && value.currentUuid.length > 0 && value.currentUuid.length <= 4096) {
    result.currentUuid = value.currentUuid;
  }
  if (typeof value.currentEncPwd === "string" && value.currentEncPwd.length <= 4096) {
    result.currentEncPwd = value.currentEncPwd;
  }
  const validatedHost = typeof value.validatedHost === "string" ? normalizeUserHost(value.validatedHost) : null;
  if (validatedHost) result.validatedHost = validatedHost;
  if (typeof value.validatedUuid === "string" && value.validatedUuid.length > 0 && value.validatedUuid.length <= 4096) {
    result.validatedUuid = value.validatedUuid;
  }
  if (typeof value.validatedEncPwd === "string" && value.validatedEncPwd.length <= 4096) {
    result.validatedEncPwd = value.validatedEncPwd;
  }
  for (const key of ["lastPreferredCheck", "lastCurrentValidationAt", "lastFailoverAt"] as const) {
    if (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  if (
    typeof value.failoverCount === "number" &&
    Number.isSafeInteger(value.failoverCount) &&
    value.failoverCount >= 0
  ) {
    result.failoverCount = value.failoverCount;
  }
  if (typeof value.lastFailoverHost === "string") {
    const lastFailoverHost = normalizeUserHost(value.lastFailoverHost);
    if (lastFailoverHost) result.lastFailoverHost = lastFailoverHost;
  }
  if (Array.isArray(value.enabledFallbackHosts))
    result.enabledFallbackHosts = normalizeUserHosts(value.enabledFallbackHosts);
  if (
    typeof value.cacheRefreshHours === "number" &&
    Number.isFinite(value.cacheRefreshHours) &&
    value.cacheRefreshHours >= 1 &&
    value.cacheRefreshHours <= 72
  ) {
    result.cacheRefreshHours = value.cacheRefreshHours;
  }
  return result;
}

async function handleStatelessManage(request: Request, env: Env, tokenString: string): Promise<Response> {
  const payload = await readStatelessToken(env, tokenString);
  if (!payload) return jsonError(404, "Invalid or expired install token");
  if (request.method === "GET") {
    return new Response(statelessManagePage(payload), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method !== "POST") return jsonError(405, "Method not allowed");
  const parsedResult = await readJsonObjectWithLimit(request);
  if (parsedResult.tooLarge) return jsonError(413, "Request body too large");
  const body = parsedResult.body;
  if (!body) return jsonError(400, "Invalid JSON body");
  const manifestUrl = typeof body.manifestUrl === "string" ? body.manifestUrl.trim() : payload.m || "";
  const password = typeof body.password === "string" && body.password ? body.password : payload.p || "";
  const parsed = parseManifestUrl(manifestUrl);
  const source: Source = parsed?.source || payload.s || "aiostreams";
  const preferredHost = normalizeUserHost(parsed?.host);
  const submittedFallbacks = body.enabledFallbackHosts;
  const fallbackInput =
    submittedFallbacks !== undefined
      ? submittedFallbacks
      : source === payload.s
        ? payload.f
        : resolveHosts(env, source);
  const fallbackHosts = normalizeUserHosts(fallbackInput);
  if (!parsed || !preferredHost || !fallbackHosts.length || !password)
    return jsonError(400, "Manifest, password, and HTTPS host values are required");
  try {
    await verifySourceHosts(source, fallbackHosts);
  } catch (err) {
    return jsonError(
      400,
      "One or more fallback hosts do not support this source",
      errorMessage(err instanceof Error ? err : String(err)),
    );
  }
  let config = payload.c;
  try {
    config = await downloadSourceConfig(source, parsed.host, parsed.uuid, password);
  } catch (err) {
    log("error", "Index", "Manage re-issue config refresh failed", {
      error: errorMessage(err instanceof Error ? err : String(err)),
    });
    if (source !== payload.s) return jsonError(502, "Unable to download source config");
  }
  const tokenExpiry = "exp" in payload && typeof payload.exp === "number" ? payload.exp : undefined;
  const tokenLineage = "l" in payload && typeof payload.l === "string" ? payload.l : undefined;
  const nextToken = await createStatelessToken(env, {
    s: source,
    n: payload.n || "",
    m: manifestUrl,
    u: parsed.uuid,
    e: parsed.encPwd,
    p: password,
    h: preferredHost,
    f: fallbackHosts,
    c: config,
    r: payload.r || 48,
    ...(tokenLineage ? { l: tokenLineage } : {}),
  });
  const origin = new URL(request.url).origin;
  const nextInstallUrl = `${origin}/stremio/${nextToken}/manifest.json`;
  const nextManageUrl = `${origin}/stremio/${nextToken}/configure`;
  const oldHash = await sha256Hex(tokenString);
  const existingRecord = await env.AIO_KV.get<AccountRecord>(`account:${oldHash}`, "json").catch(() => null);
  const nextHash = await sha256Hex(nextToken);
  if (existingRecord) {
    await env.AIO_KV.put(
      `account:${nextHash}`,
      JSON.stringify({
        uuid: nextHash,
        token: nextToken,
        nickname: existingRecord.nickname || payload.n || "Streamkeeper install",
        source,
        preferredHost,
        currentHost: preferredHost,
        installUrl: nextInstallUrl,
        manageUrl: nextManageUrl,
        failoverCount: 0,
        createdAt: existingRecord.createdAt || Date.now(),
      }),
    );
  }
  try {
    await revokeStatelessToken(env, tokenString, tokenExpiry);
  } catch (error) {
    log("error", "Index", "Stateless token rotation revocation failed", {
      error: errorMessage(error instanceof Error ? error : String(error)),
    });
    return jsonError(503, "Unable to revoke previous install token");
  }
  await Promise.all([env.AIO_KV.delete(`account:${oldHash}`), env.AIO_KV.delete(`st:${oldHash}`)]);
  return new Response(JSON.stringify({ installUrl: nextInstallUrl, manageUrl: nextManageUrl }), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
function parseCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

async function authenticateCookieOrBearer(request: Request, env: Env): Promise<JwtPayload | null> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : parseCookie(request, "aio_token");
  if (!token) return null;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return authenticateRequest(new Request(request, { headers }), env);
}
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const safePath = url.pathname.startsWith("/stremio/") ? "/stremio/[token]" : url.pathname;
  log("info", "Index", "Request received", { method: request.method, path: safePath });
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (url.pathname === "/setup" && request.method === "GET") {
    const source = url.searchParams.get("source") === "aiometadata" ? "aiometadata" : "aiostreams";
    return new Response(statelessSetupPage(source, resolveHosts(env, source)), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (url.pathname === "/setup" && request.method === "POST") {
    const gate = await throttleByIp(request, env, 20, 15 * 60 * 1e3);
    if (gate.blocked) return jsonError(429, "Too many requests");
    return handleCreateAccount(request, env);
  }
  if (url.pathname === "/" || url.pathname === "") {
    return handleLanding(request, env);
  }
  if (url.pathname === "/dashboard") {
    return handleDashboard(request, env);
  }
  const manageMatch = url.pathname.match(/^\/dashboard\/account\/([^/]+)$/);
  const accountId = manageMatch?.[1];
  if (accountId) {
    return handleManageAccount(request, env, accountId);
  }
  const tokenConfigureMatch = url.pathname.match(/^\/stremio\/([^/]+)\/(?:configure|manage)\/?$/);
  const statelessToken = tokenConfigureMatch?.[1];
  if (statelessToken && (statelessToken.startsWith("v1-") || statelessToken.startsWith("v2-"))) {
    return handleStatelessManage(request, env, statelessToken);
  }
  const configureMatch = url.pathname.match(/^\/(stremio)\/([^/]+)\/([^/]+)\/configure\/?$/);
  if (configureMatch) {
    return jsonError(410, "Persistent accounts are disabled; use a stateless install token");
  }
  if (url.pathname === "/accounts/partial" && request.method === "GET") {
    return handleAccountsPartial(request, env);
  }
  if (url.pathname.startsWith("/admin/")) {
    return handleAdmin(request, env);
  }
  const parsed = parseStremioPath(url.pathname);
  if (!parsed) {
    return new Response("Not found", { status: 404 });
  }
  if ("token" in parsed) {
    const token = await readStatelessToken(env, parsed.token);
    if (!token) return jsonError(404, "Invalid or expired install token");
    const tokenHash = await sha256Hex(parsed.token);
    // Ponytail: sticky failover state keyed by token hash; without this every
    // request replays the full failover sequence when the preferred host is down.
    const savedValue = await env.AIO_KV.get<JsonData>(`st:${tokenHash}`, "json").catch(() => null);
    const saved = parsePersistedRoutingState(savedValue);
    const source: Source = token.s || "aiostreams";
    const state: UserState = {
      ...getDefaultUserState(env, source),
      source,
      installationKey: tokenHash,
      uuid: token.u,
      encryptedPassword: token.e || "",
      password: token.p,
      currentHost: token.h,
      currentUuid: token.u,
      currentEncPwd: token.e || "",
      cachedConfig: token.c,
      enabledFallbackHosts: token.f,
      cacheRefreshHours: token.r || 48,
      ...saved,
    };
    return await routeRequest(
      request,
      state,
      { uuid: token.u, encryptedPassword: token.e || "" },
      async (newState: UserState) => {
        const latestValue = await env.AIO_KV.get<JsonData>(`st:${tokenHash}`, "json").catch(() => null);
        const latest = parsePersistedRoutingState(latestValue);
        return env.AIO_KV.put(
          `st:${tokenHash}`,
          JSON.stringify({
            source: newState.source,
            installationKey: tokenHash,
            preferredHost: newState.preferredHost,
            currentHost: newState.currentHost,
            currentUuid: newState.currentUuid,
            currentEncPwd: newState.currentEncPwd,
            enabledFallbackHosts: latest.enabledFallbackHosts || newState.enabledFallbackHosts,
            cacheRefreshHours: latest.cacheRefreshHours ?? newState.cacheRefreshHours,
            lastFailoverAt: newState.lastFailoverAt,
            lastFailoverHost: newState.lastFailoverHost,
            lastPreferredCheck: newState.lastPreferredCheck,
            lastCurrentValidationAt: newState.lastCurrentValidationAt,
            validatedHost: newState.validatedHost,
            validatedUuid: newState.validatedUuid,
            validatedEncPwd: newState.validatedEncPwd,
          }),
        );
      },
      { get: () => getHostHealth(env), put: (health) => putHostHealth(env, health) },
      env,
      ctx,
    );
  }
  let state: UserState | null = await getUserState(env, parsed.uuid);
  if (!state) {
    const account = await getAccount(env, parsed.uuid);
    if (!account) {
      return jsonError(404, "Account not found", "Initialize accounts via landing page or POST /admin/accounts");
    }
    const parsedUrl = parseManifestUrl(account.manifestUrl);
    if (!parsedUrl) {
      return jsonError(500, "Invalid account configuration", "Manifest URL in account record is invalid");
    }
    let config: Config;
    try {
      config = await downloadSourceConfig(
        parsedUrl.source || "aiostreams",
        parsedUrl.host,
        parsedUrl.uuid,
        await getAccountPassword(env, account),
      );
    } catch (err) {
      log("error", "Index", "Config download failed", {
        error: errorMessage(err instanceof Error ? err : String(err)),
      });
      return jsonError(502, "Failed to download config from account host");
    }
    state = getDefaultUserState(env, parsedUrl.source || "aiostreams");
    state.source = parsedUrl.source || "aiostreams";
    state.installationKey = account.uuid || parsed.uuid;
    state.enabledFallbackHosts = resolveHosts(env, state.source);
    state.uuid = parsedUrl.uuid;
    state.encryptedPassword = parsedUrl.encPwd;
    state.password = await getAccountPassword(env, account);
    state.preferredHost = parsedUrl.host;
    state.currentHost = parsedUrl.host;
    state.currentUuid = parsedUrl.uuid;
    state.currentEncPwd = parsedUrl.encPwd;
    state.cachedConfig = config;
    const record = { ...account, ...state };
    await putAccount(env, record);
    state = { ...state, ...record, cachedConfig: config };
  }
  state.password = await getAccountPassword(env, state);
  return await routeRequest(
    request,
    state,
    { uuid: parsed.uuid, encryptedPassword: parsed.encryptedPassword },
    (newState: UserState) => putAccount(env, newState),
    { get: () => getHostHealth(env), put: (health) => putHostHealth(env, health) },
    env,
    ctx,
  );
}
async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const payload = await authenticateCookieOrBearer(request, env);
  if (!payload) return Response.redirect(new URL("/", request.url), 302);
  return new Response(dashboardPage(resolveHosts(env, "aiostreams"), resolveHosts(env, "aiometadata")), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
async function handleManageAccount(request: Request, env: Env, uuid: string): Promise<Response> {
  const payload = await authenticateCookieOrBearer(request, env);
  if (!payload) return Response.redirect(new URL("/", request.url), 302);
  const account = await getAccount(env, uuid);
  if (account?.token) {
    return Response.redirect(new URL(`/stremio/${account.token}/configure`, request.url), 302);
  }
  return jsonError(410, "Persistent accounts are disabled; use a stateless install token");
}
async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/admin/login" && request.method === "POST") {
    return handleLogin(request, env);
  }
  if (path === "/admin/logout" && request.method === "POST") {
    return handleLogout(request, env);
  }
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return jsonError(401, "Invalid or missing authentication");
  }
  if (path === "/admin/accounts" && request.method === "POST") {
    return handleCreateAccount(request, env);
  }
  if (path === "/admin/accounts" && request.method === "GET") {
    return handleListAccounts(env);
  }
  const deleteMatch = path.match(/^\/admin\/accounts\/([^/]+)$/);
  const deleteUuid = deleteMatch?.[1];
  if (deleteUuid && request.method === "DELETE") {
    return handleDeleteAccount(env, deleteUuid);
  }
  const getMatch = path.match(/^\/admin\/accounts\/([^/]+)$/);
  const getUuid = getMatch?.[1];
  if (getUuid && request.method === "GET") {
    return handleGetAccount(env, getUuid);
  }
  const putMatch = path.match(/^\/admin\/accounts\/([^/]+)$/);
  const putUuid = putMatch?.[1];
  if (putUuid && request.method === "PUT") {
    return handleUpdateAccount(request, env, putUuid);
  }
  if (path === "/admin/health" && request.method === "GET") {
    return handleHealth(env);
  }
  if (path === "/admin/stats" && request.method === "GET") {
    return handleStats(env);
  }
  return jsonError(404, "Admin endpoint not found");
}
function cookieHeader(token: string, maxAge: number): string {
  return `aio_token=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}
async function handleLogout(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get("Authorization");
  const token =
    parseCookie(request, "aio_token") ||
    (authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "");
  if (token) {
    try {
      await revokeJWTSession(env, token);
    } catch (error) {
      log("error", "Index", "JWT session revocation failed", {
        error: errorMessage(error instanceof Error ? error : String(error)),
      });
      return jsonError(503, "Unable to revoke session");
    }
  }
  return new Response(null, {
    status: 200,
    headers: {
      "Set-Cookie": cookieHeader("", 0),
      ...corsHeaders(),
    },
  });
}
async function handleLogin(request: Request, env: Env): Promise<Response> {
  const parsedResult = await readJsonObjectWithLimit(request);
  if (parsedResult.tooLarge) return jsonError(413, "Request body too large");
  const body = parsedResult.body;
  if (!body) return jsonError(400, "Invalid JSON body");
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return jsonError(400, "password is required");
  if (!env.ADMIN_PASSWORD) {
    return jsonError(401, "Invalid password");
  }
  const gate = await throttleByIp(request, env);
  if (gate.blocked) {
    return new Response(JSON.stringify({ error: "Too many login attempts. Try again later." }), {
      status: 429,
      headers: { "content-type": "application/json", "Retry-After": "900", ...corsHeaders() },
    });
  }
  const match = await verifyPassword(password, env.ADMIN_PASSWORD);
  if (!match) {
    return jsonError(401, "Invalid password");
  }
  await resetThrottle(env, gate.ip);
  const key = await getSigningKey(env);
  if (!key) return jsonError(500, "Signing key unavailable");
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    sub: "admin",
    iat: now,
    exp: now + 30 * 24 * 60 * 60,
  };
  const token = await createJWT(payload, key);
  return new Response(JSON.stringify({ token, expiresAt: payload.exp }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Set-Cookie": cookieHeader(token, 30 * 24 * 60 * 60),
      ...corsHeaders(),
    },
  });
}
async function handleCreateAccount(request: Request, env: Env): Promise<Response> {
  const parsedResult = await readJsonObjectWithLimit(request);
  if (parsedResult.tooLarge) return jsonError(413, "Request body too large");
  const body = parsedResult.body;
  if (!body) return jsonError(400, "Invalid JSON body");
  const manifestUrl = typeof body.manifestUrl === "string" ? body.manifestUrl.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const enabledFallbackHosts = body.enabledFallbackHosts;
  const cacheRefreshHours = typeof body.cacheRefreshHours === "number" ? body.cacheRefreshHours : 48;
  const nickname = String(body.nickname || "Streamkeeper install").trim();
  if (!manifestUrl || !password) {
    return jsonError(400, "manifestUrl and password are required");
  }
  const parsed = parseManifestUrl(manifestUrl);
  if (!parsed) {
    try {
      if (new URL(manifestUrl).pathname.replace(/\/+$/, "") === "/configure") {
        return jsonError(400, "Paste the generated AIOMetadata manifest URL, not the /configure page");
      }
    } catch {}
    return jsonError(400, "Invalid manifest URL format");
  }
  const source: Source = parsed.source || "aiostreams";
  const manifestHost = normalizeUserHost(parsed.host);
  const fallbackHosts = normalizeUserHosts(enabledFallbackHosts || resolveHosts(env, source));
  if (!manifestHost || !fallbackHosts.length) {
    return jsonError(400, "Preferred and fallback hosts must be valid HTTPS origins");
  }
  const selectedHost = manifestHost;
  try {
    await verifySourceHosts(source, fallbackHosts);
  } catch (err) {
    return jsonError(
      400,
      "One or more fallback hosts do not support this source",
      errorMessage(err instanceof Error ? err : String(err)),
    );
  }
  let config: Config;
  try {
    config = await downloadSourceConfig(source, parsed.host, parsed.uuid, password);
  } catch (err) {
    log("error", "Index", "Config verification failed", {
      error: errorMessage(err instanceof Error ? err : String(err)),
    });
    return jsonError(502, "Verification failed");
  }
  const statelessToken = await createStatelessToken(env, {
    s: source,
    n: nickname,
    m: manifestUrl,
    u: parsed.uuid,
    e: parsed.encPwd,
    p: password,
    h: selectedHost,
    f: fallbackHosts,
    c: config,
    r: Math.min(72, Math.max(1, Math.round(cacheRefreshHours || 48))),
  });
  const baseUrl = new URL(request.url);
  const installUrl = `${baseUrl.protocol}//${baseUrl.host}/stremio/${statelessToken}/manifest.json`;
  const manageUrl = `${baseUrl.protocol}//${baseUrl.host}/stremio/${statelessToken}/configure`;
  const tokenHash = await sha256Hex(statelessToken);
  // Library record for the dashboard; deletion revokes the token via readStatelessToken's ban check.
  await env.AIO_KV.put(
    `account:${tokenHash}`,
    JSON.stringify({
      uuid: tokenHash,
      token: statelessToken,
      nickname,
      source,
      preferredHost: selectedHost,
      currentHost: selectedHost,
      installUrl,
      manageUrl,
      failoverCount: 0,
      createdAt: Date.now(),
    }),
  );
  log("info", "Index", "Stateless install token created", { nickname });
  return new Response(JSON.stringify({ nickname, installUrl, manageUrl, token: statelessToken }), {
    status: 201,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
async function hydrateDashboardAccount(env: Env, account: AccountRecord): Promise<AccountRecord> {
  if (!account.token) return account;
  const [token, savedValue] = await Promise.all([
    readStatelessToken(env, account.token),
    env.AIO_KV.get<JsonData>(`st:${account.uuid}`, "json").catch(() => null),
  ]);
  const saved = parsePersistedRoutingState(savedValue);
  return {
    ...account,
    source: token?.s || account.source || "aiostreams",
    preferredHost: token?.h || account.preferredHost || "",
    ...(saved || {}),
  };
}
async function getDashboardAccounts(env: Env): Promise<AccountRecord[]> {
  const accounts = await listAccounts(env);
  return Promise.all(accounts.map((account) => hydrateDashboardAccount(env, account)));
}
async function handleListAccounts(env: Env): Promise<Response> {
  const accounts = (await getDashboardAccounts(env)).map(publicAccount);
  return new Response(JSON.stringify({ accounts }), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
async function handleDeleteAccount(env: Env, uuid: string): Promise<Response> {
  const account = await getAccount(env, uuid);
  if (account?.token) {
    const payload = await readStatelessToken(env, account.token);
    const tokenExpiry = "exp" in (payload || {}) && typeof payload?.exp === "number" ? payload.exp : undefined;
    const tokenLineage = "l" in (payload || {}) && typeof payload?.l === "string" ? payload.l : undefined;
    try {
      if (tokenLineage) await revokeTokenLineage(env, tokenLineage, tokenExpiry);
      await revokeStatelessToken(env, account.token, tokenExpiry);
    } catch (error) {
      log("error", "Index", "Account token revocation failed", {
        uuid,
        error: errorMessage(error instanceof Error ? error : String(error)),
      });
      return jsonError(503, "Unable to revoke account token");
    }
  }
  await deleteAccount(env, uuid);
  log("info", "Index", "Account deleted", { uuid });
  return new Response(null, { status: 204, headers: corsHeaders() });
}
async function handleGetAccount(env: Env, uuid: string): Promise<Response> {
  const account = await getAccount(env, uuid);
  if (!account) {
    return jsonError(404, "Account not found");
  }
  return new Response(JSON.stringify({ account: publicAccount(account) }), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
async function handleUpdateAccount(request: Request, env: Env, uuid: string): Promise<Response> {
  const parsedResult = await readJsonObjectWithLimit(request);
  if (parsedResult.tooLarge) return jsonError(413, "Request body too large");
  const body = parsedResult.body;
  if (!body) return jsonError(400, "Invalid JSON body");
  const nickname = typeof body.nickname === "string" ? body.nickname : "";
  const cacheRefreshHours = typeof body.cacheRefreshHours === "number" ? body.cacheRefreshHours : undefined;
  const enabledFallbackHosts = body.enabledFallbackHosts;
  if (!nickname) return jsonError(400, "nickname is required");
  const existing = await getAccount(env, uuid);
  if (!existing) return jsonError(404, "Account not found");
  const tokenPayload = existing.token ? await readStatelessToken(env, existing.token) : null;
  const accountSource = tokenPayload?.s || existing.source || "aiostreams";
  const updated: AccountRecord = { ...existing, nickname };
  if (cacheRefreshHours !== undefined) {
    updated.cacheRefreshHours = Math.min(72, Math.max(1, Math.round(cacheRefreshHours)));
  }
  let normalizedFallbacks: string[] | undefined;
  if (Array.isArray(enabledFallbackHosts)) {
    const normalized = normalizeUserHosts(enabledFallbackHosts);
    if (enabledFallbackHosts.length > 0 && normalized.length === 0)
      return jsonError(400, "No valid fallback hosts supplied");
    try {
      await verifySourceHosts(accountSource, normalized);
    } catch (err) {
      return jsonError(
        400,
        "One or more fallback hosts do not support this source",
        errorMessage(err instanceof Error ? err : String(err)),
      );
    }
    normalizedFallbacks = normalized;
    updated.enabledFallbackHosts = normalized;
  }
  await putAccount(env, updated);
  if (existing.token && (normalizedFallbacks || cacheRefreshHours !== undefined)) {
    await env.AIO_KV.put(
      `st:${uuid}`,
      JSON.stringify({
        ...(tokenPayload?.s ? { source: tokenPayload.s } : {}),
        ...(normalizedFallbacks ? { enabledFallbackHosts: normalizedFallbacks } : {}),
        ...(cacheRefreshHours !== undefined ? { cacheRefreshHours: updated.cacheRefreshHours } : {}),
      }),
    );
  }
  log("info", "Index", "Account updated", { nickname, uuid });
  return new Response(JSON.stringify({ uuid, nickname }), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
async function handleScheduled(env: Env): Promise<void> {
  const health = await getHostHealth(env);
  const sources: Source[] = ["aiostreams", "aiometadata"];
  const targets: Array<{ source: Source; host: string }> = sources.flatMap((source) =>
    resolveHosts(env, source).map((host) => ({ source, host })),
  );
  const results = await Promise.all(
    targets.map(async ({ source, host }): Promise<HostHealthEntry> => {
      const started = Date.now();
      const online = await probe(host, source);
      const key = `${source}:${host}`;
      const previous = health[key] || health[host];
      return {
        source,
        host,
        status: online ? "healthy" : "unhealthy",
        checkedAt: Date.now(),
        latencyMs: Date.now() - started,
        consecutiveFailures: online ? 0 : (previous?.consecutiveFailures || 0) + 1,
      };
    }),
  );
  const healthStore: HealthStore = {
    get: () => getHostHealth(env),
    put: (value: HostHealth) => putHostHealth(env, value),
  };
  await Promise.all(
    results.map(async (result) => {
      try {
        await updateHostHealth(healthStore, result.source || "aiostreams", result.host || "", result);
      } catch (error) {
        log("warn", "Index", "Scheduled health update failed", {
          error: errorMessage(error instanceof Error ? error : String(error)),
        });
      }
    }),
  );
  log("info", "Index", "Host health refreshed", {
    healthy: results.filter((result) => result.status === "healthy").length,
    total: results.length,
  });
}
type HealthResponse = {
  hosts: Array<{ source: string; host: string; status: "up" | "down" | "error" }>;
  total: number;
  up: number;
  down: number;
  timestamp: number;
};
async function handleHealth(env: Env): Promise<Response> {
  const now = Date.now();
  const sources: Source[] = ["aiostreams", "aiometadata"];
  const targets: Array<{ source: Source; host: string }> = sources.flatMap((source) =>
    resolveHosts(env, source).map((host) => ({ source, host })),
  );
  const results = await Promise.allSettled(
    targets.map(async ({ source, host }) => {
      const ok = await probe(host, source);
      return { source, host, status: ok ? ("up" as const) : ("down" as const) };
    }),
  );
  const hosts: HealthResponse["hosts"] = results.map((result) =>
    result.status === "fulfilled" ? result.value : { source: "unavailable", host: "", status: "error" },
  );
  const up = hosts.filter((host) => host.status === "up").length;
  const data: HealthResponse = { hosts, total: hosts.length, up, down: hosts.length - up, timestamp: now };
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
async function handleStats(env: Env): Promise<Response> {
  const accounts = await getDashboardAccounts(env);
  const total = accounts.length;
  let totalFailovers = 0;
  let failoverAccounts = 0;
  for (const acc of accounts) {
    const count = acc.failoverCount || 0;
    totalFailovers += count;
    if (count > 0) failoverAccounts++;
  }
  return new Response(JSON.stringify({ total, totalFailovers, failoverAccounts }), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
async function handleLanding(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get("source") === "aiometadata" ? "aiometadata" : "aiostreams";
  return new Response(statelessSetupPage(source, resolveHosts(env, source)), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
async function handleAccountsPartial(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) return jsonError(401, "Authentication required");
  const accounts = await getDashboardAccounts(env);
  return new Response(accounts.map((account, index) => accountCardHtml(account, index)).join(""), {
    headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders() },
  });
}
const index_default = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    return handleScheduled(env);
  },
};
export default index_default;
