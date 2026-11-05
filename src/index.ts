import { downloadSourceConfig, resolveHosts, verifySourceHosts } from "./installer";
import { probe, routeRequest } from "./routing";
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
import type { AccountRecord, Config, Env, HostHealthEntry, JsonData, JsonObject, Source, UserState } from "./types";
import { isRecord } from "./types";
import { accountCardHtml, dashboardPage, statelessManagePage, statelessSetupPage } from "./ui/templates";
import {
  authenticateRequest,
  corsHeaders,
  createJWT,
  createStatelessToken,
  errorMessage,
  getSigningKey,
  jsonError,
  log,
  normalizeUserHost,
  normalizeUserHosts,
  parseManifestUrl,
  parseStremioPath,
  readStatelessToken,
  sha256Hex,
  verifyJWT,
  verifyPassword,
} from "./utils";

const requestAttempts = new Map<string, { count: number; startedAt: number }>();
const THROTTLE_LIMIT = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1e3;
const THROTTLE_MAX_ENTRIES = 5000;
function throttleByIp(
  request: Request,
  limit = THROTTLE_LIMIT,
  windowMs = THROTTLE_WINDOW_MS,
): { blocked: boolean; ip: string } {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unidentified";
  const now = Date.now();
  if (requestAttempts.size > THROTTLE_MAX_ENTRIES) {
    for (const [key, value] of requestAttempts) {
      if (now - value.startedAt >= windowMs) requestAttempts.delete(key);
    }
    if (requestAttempts.size > THROTTLE_MAX_ENTRIES) requestAttempts.clear();
  }
  const entry = requestAttempts.get(ip);
  if (entry && now - entry.startedAt < windowMs && entry.count >= limit) {
    return { blocked: true, ip };
  }
  if (!entry || now - entry.startedAt >= windowMs) {
    requestAttempts.set(ip, { startedAt: now, count: 0 });
  }
  const current = requestAttempts.get(ip);
  if (current) current.count++;
  return { blocked: false, ip };
}

async function handleStatelessManage(request: Request, env: Env, tokenString: string): Promise<Response> {
  const payload = await readStatelessToken(env, tokenString);
  if (!payload) return jsonError(404, "Invalid or expired install token");
  if (request.method === "GET") {
    return new Response(statelessManagePage(payload), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method !== "POST") return jsonError(405, "Method not allowed");
  const gate = throttleByIp(request, 20, 15 * 60 * 1e3);
  if (gate.blocked) return jsonError(429, "Too many requests");
  let body: JsonObject;
  try {
    const parsedBody: JsonData = await request.json();
    if (!isRecord(parsedBody)) return jsonError(400, "Invalid JSON body");
    body = parsedBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const manifestUrl = String(body.manifestUrl || payload.m).trim();
  const password = String(body.password || payload.p || "");
  const parsed = parseManifestUrl(manifestUrl);
  const source: Source = parsed?.source || payload.s || "aiostreams";
  const preferredHost = normalizeUserHost(parsed ? parsed.host : "");
  const fallbackHosts = normalizeUserHosts(body.enabledFallbackHosts || payload.f);
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
  }
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
  });
  const origin = new URL(request.url).origin;
  const nextInstallUrl = `${origin}/stremio/${nextToken}/manifest.json`;
  const nextManageUrl = `${origin}/stremio/${nextToken}/configure`;
  const oldHash = await sha256Hex(tokenString);
  const existingRecord = await env.AIO_KV.get<AccountRecord>(`account:${oldHash}`, "json").catch(() => null);
  const nextHash = await sha256Hex(nextToken);
  if (existingRecord) {
    await Promise.all([
      env.AIO_KV.delete(`account:${oldHash}`),
      env.AIO_KV.delete(`st:${oldHash}`),
      env.AIO_KV.put(
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
      ),
    ]);
  }
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
    const gate = throttleByIp(request, 20, 15 * 60 * 1e3);
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
    const saved = await env.AIO_KV.get<Partial<UserState>>(`st:${tokenHash}`, "json").catch(() => null);
    const source: Source = token.s || "aiostreams";
    const state: UserState = {
      ...getDefaultUserState(env, source),
      source,
      installationKey: tokenHash,
      uuid: token.u,
      encryptedPassword: token.e || "",
      password: token.p,
      preferredHost: token.h,
      currentHost: token.h,
      currentUuid: token.u,
      currentEncPwd: token.e || "",
      cachedConfig: token.c,
      enabledFallbackHosts: token.f,
      cacheRefreshHours: token.r || 48,
      ...(saved || {}),
    };
    return await routeRequest(
      request,
      state,
      { uuid: token.u, encryptedPassword: token.e || "" },
      (newState: UserState) =>
        env.AIO_KV.put(
          `st:${tokenHash}`,
          JSON.stringify({
            source: newState.source,
            installationKey: tokenHash,
            currentHost: newState.currentHost,
            currentUuid: newState.currentUuid,
            currentEncPwd: newState.currentEncPwd,
            failoverCount: newState.failoverCount,
            lastFailoverAt: newState.lastFailoverAt,
            lastFailoverHost: newState.lastFailoverHost,
            lastPreferredCheck: newState.lastPreferredCheck,
            lastCurrentValidationAt: newState.lastCurrentValidationAt,
            validatedHost: newState.validatedHost,
            validatedUuid: newState.validatedUuid,
            validatedEncPwd: newState.validatedEncPwd,
          }),
        ),
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
  const token = parseCookie(request, "aio_token");
  if (!token) {
    return Response.redirect(new URL("/", request.url), 302);
  }
  const key = await getSigningKey(env);
  if (!key) {
    return Response.redirect(new URL("/", request.url), 302);
  }
  const payload = await verifyJWT(token, key);
  if (!payload) {
    return Response.redirect(new URL("/", request.url), 302);
  }
  return new Response(dashboardPage(resolveHosts(env, "aiostreams"), resolveHosts(env, "aiometadata")), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
async function handleManageAccount(request: Request, env: Env, uuid: string): Promise<Response> {
  const token = parseCookie(request, "aio_token");
  if (!token) return Response.redirect(new URL("/", request.url), 302);
  const key = await getSigningKey(env);
  if (!key) return Response.redirect(new URL("/", request.url), 302);
  const payload = await verifyJWT(token, key);
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
    return handleLogout();
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
  return `aio_token=${token}; HttpOnly; Secure; Path=/dashboard; SameSite=Lax; Max-Age=${maxAge}`;
}
function handleLogout(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Set-Cookie": cookieHeader("", 0),
      ...corsHeaders(),
    },
  });
}
async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: JsonObject;
  try {
    const parsedBody: JsonData = await request.json();
    if (!isRecord(parsedBody)) return jsonError(400, "Invalid JSON body");
    body = parsedBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return jsonError(400, "password is required");
  if (!env.ADMIN_PASSWORD) {
    return jsonError(401, "Invalid password");
  }
  const gate = throttleByIp(request);
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
  requestAttempts.delete(gate.ip);
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
  let body: JsonObject;
  try {
    const parsedBody: JsonData = await request.json();
    if (!isRecord(parsedBody)) return jsonError(400, "Invalid JSON body");
    body = parsedBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
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
  const [token, saved] = await Promise.all([
    readStatelessToken(env, account.token),
    env.AIO_KV.get(`st:${account.uuid}`, "json").catch(() => null),
  ]);
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
  await deleteAccount(env, uuid);
  // Revoke the stateless token: readStatelessToken rejects banned: hashes.
  await Promise.all([env.AIO_KV.delete(`st:${uuid}`), env.AIO_KV.put(`banned:${uuid}`, "1")]);
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
  let body: JsonObject;
  try {
    const parsedBody: JsonData = await request.json();
    if (!isRecord(parsedBody)) return jsonError(400, "Invalid JSON body");
    body = parsedBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const nickname = typeof body.nickname === "string" ? body.nickname : "";
  const cacheRefreshHours = typeof body.cacheRefreshHours === "number" ? body.cacheRefreshHours : undefined;
  const enabledFallbackHosts = body.enabledFallbackHosts;
  if (!nickname) return jsonError(400, "nickname is required");
  const existing = await getAccount(env, uuid);
  if (!existing) return jsonError(404, "Account not found");
  const updated: AccountRecord = { ...existing, nickname };
  if (cacheRefreshHours !== undefined) {
    updated.cacheRefreshHours = Math.min(72, Math.max(1, Math.round(cacheRefreshHours)));
  }
  if (Array.isArray(enabledFallbackHosts)) {
    const normalized = normalizeUserHosts(enabledFallbackHosts);
    if (normalized.length) {
      try {
        await verifySourceHosts(existing.source || "aiostreams", normalized);
      } catch (err) {
        return jsonError(
          400,
          "One or more fallback hosts do not support this source",
          errorMessage(err instanceof Error ? err : String(err)),
        );
      }
      updated.enabledFallbackHosts = normalized;
    }
  }
  await putAccount(env, updated);
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
      const online = await probe(host);
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
  for (const result of results) health[`${result.source}:${result.host}`] = result;
  await putHostHealth(env, health);
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
let healthCache: { data: HealthResponse | null; expires: number } = { data: null, expires: 0 };
async function handleHealth(env: Env): Promise<Response> {
  const now = Date.now();
  if (healthCache.data && healthCache.expires > now) {
    return new Response(JSON.stringify(healthCache.data), {
      headers: { "content-type": "application/json", ...corsHeaders() },
    });
  }
  const sources: Source[] = ["aiostreams", "aiometadata"];
  const targets: Array<{ source: Source; host: string }> = sources.flatMap((source) =>
    resolveHosts(env, source).map((host) => ({ source, host })),
  );
  const results = await Promise.allSettled(
    targets.map(async ({ source, host }) => {
      const ok = await probe(host);
      return { source, host, status: ok ? ("up" as const) : ("down" as const) };
    }),
  );
  const hosts: HealthResponse["hosts"] = results.map((result) =>
    result.status === "fulfilled" ? result.value : { source: "unavailable", host: "", status: "error" },
  );
  const up = hosts.filter((host) => host.status === "up").length;
  const data: HealthResponse = { hosts, total: hosts.length, up, down: hosts.length - up, timestamp: now };
  healthCache = { data, expires: now + 3e4 };
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
