import { log, corsHeaders, jsonError, parseStremioPath, parseManifestUrl, normalizeUserHost, normalizeUserHosts, sha256Hex, getSigningKey, createJWT, verifyJWT, verifyPassword, authenticateRequest, createStatelessToken, readStatelessToken } from './utils.js';
import { resolveHosts, downloadConfig, installConfigWithRetry } from './installer.js';
import { probe, routeRequest } from './routing.js';
import { getDefaultUserState, getUserState, setCachedConfig, refreshConfig, getAccount, putAccount, publicAccount, getAccountPassword, listAccounts, deleteAccount, getHostHealth, putHostHealth } from './state.js';
import { adminScript } from './ui/admin.js';
import { THEME_CSS } from './ui/styles.js';
import { mascotSmHtml, pageHeadHtml, htmlEsc, confirmModalHtml, toastContainerHtml, newAccountModalHtml, newAccountModalScript, accountCardHtml, statelessSetupPage, statelessManagePage, landingPage, dashboardPage } from './ui/templates.js';
const requestAttempts = new Map();
const THROTTLE_LIMIT = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1e3;
const THROTTLE_MAX_ENTRIES = 5000;
function throttleByIp(request, limit = THROTTLE_LIMIT, windowMs = THROTTLE_WINDOW_MS) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "unknown";
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
  requestAttempts.get(ip).count++;
  return { blocked: false, ip };
}

async function handleStatelessManage(request, env, tokenString) {
  const payload = await readStatelessToken(env, tokenString);
  if (!payload) return jsonError(404, "Invalid or expired install token");
  if (request.method === "GET") {
    return new Response(statelessManagePage(tokenString, payload), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method !== "POST") return jsonError(405, "Method not allowed");
  const gate = throttleByIp(request, 20, 15 * 60 * 1e3);
  if (gate.blocked) return jsonError(429, "Too many requests");
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const manifestUrl = String(body.manifestUrl || payload.m).trim();
  const password = String(body.password || payload.p || "");
  const parsed = parseManifestUrl(manifestUrl);
  const preferredHost = normalizeUserHost(body.preferredHost || (parsed ? parsed.host : ""));
  const fallbackHosts = normalizeUserHosts(body.enabledFallbackHosts || payload.f);
  if (!parsed || !preferredHost || !fallbackHosts.length || !password) return jsonError(400, "Manifest, password, and HTTPS host values are required");
  let config = payload.c;
  if (!config || manifestUrl !== payload.m || parsed.uuid !== payload.u || parsed.encPwd !== payload.e) {
    try {
      config = await downloadConfig(parsed.host, parsed.uuid, password);
    } catch {
      return jsonError(502, "Verification failed");
    }
  }
  const nextToken = await createStatelessToken(env, { n: payload.n || "", m: manifestUrl, u: parsed.uuid, e: parsed.encPwd, p: password, h: preferredHost, f: fallbackHosts, c: config, r: payload.r || 48 });
  const origin = new URL(request.url).origin;
  const nextInstallUrl = `${origin}/stremio/${nextToken}/manifest.json`;
  const nextManageUrl = `${origin}/stremio/${nextToken}/configure`;
  const oldHash = await sha256Hex(tokenString);
  const existingRecord = await env.AIO_KV.get(`account:${oldHash}`, "json").catch(() => null);
  const nextHash = await sha256Hex(nextToken);
  if (existingRecord) {
    await Promise.all([
      env.AIO_KV.delete(`account:${oldHash}`),
      env.AIO_KV.delete(`st:${oldHash}`),
      env.AIO_KV.put(`account:${nextHash}`, JSON.stringify({
        uuid: nextHash,
        token: nextToken,
        nickname: existingRecord.nickname || payload.n || "Streamkeeper install",
        installUrl: nextInstallUrl,
        manageUrl: nextManageUrl,
        createdAt: existingRecord.createdAt || Date.now()
      }))
    ]);
  }
  return new Response(JSON.stringify({ installUrl: nextInstallUrl, manageUrl: nextManageUrl }), {
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
function parseCookie(request, name) {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name + "=")) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const safePath = url.pathname.startsWith("/stremio/") ? "/stremio/[token]" : url.pathname;
  log("info", "Index", "Request received", { method: request.method, path: safePath });
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (url.pathname === "/setup" && request.method === "GET") {
    return new Response(statelessSetupPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
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
  if (manageMatch) {
    return handleManageAccount(request, env, manageMatch[1]);
  }
  const tokenConfigureMatch = url.pathname.match(/^\/stremio\/([^/]+)\/(?:configure|manage)\/?$/);
  if (tokenConfigureMatch && (tokenConfigureMatch[1].startsWith("v1-") || tokenConfigureMatch[1].startsWith("v2-"))) {
    return handleStatelessManage(request, env, tokenConfigureMatch[1]);
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
  if (parsed.token) {
    const token = await readStatelessToken(env, parsed.token);
    if (!token) return jsonError(404, "Invalid or expired install token");
    const tokenHash = await sha256Hex(parsed.token);
    // Ponytail: sticky failover state keyed by token hash; without this every
    // request replays the full failover sequence when the preferred host is down.
    const saved = await env.AIO_KV.get(`st:${tokenHash}`, "json").catch(() => null);
    const state = {
      ...getDefaultUserState(env),
      uuid: token.u,
      encryptedPassword: token.e,
      password: token.p,
      preferredHost: token.h,
      currentHost: token.h,
      currentUuid: token.u,
      currentEncPwd: token.e,
      cachedConfig: token.c,
      enabledFallbackHosts: token.f,
      cacheRefreshHours: token.r || 48,
      ...(saved || {})
    };
    return await routeRequest(
      request,
      state,
      { uuid: token.u, encryptedPassword: token.e },
      (newState) => env.AIO_KV.put(`st:${tokenHash}`, JSON.stringify({
        currentHost: newState.currentHost,
        currentUuid: newState.currentUuid,
        currentEncPwd: newState.currentEncPwd,
        failoverCount: newState.failoverCount,
        lastFailoverAt: newState.lastFailoverAt,
        lastFailoverHost: newState.lastFailoverHost,
        lastPreferredCheck: newState.lastPreferredCheck
      })),
      { get: () => getHostHealth(env), put: (health) => putHostHealth(env, health) },
      env
    );
  }
  let state = await getUserState(env, parsed.uuid);
  if (!state) {
    const account = await getAccount(env, parsed.uuid);
    if (!account) {
      return jsonError(404, "Account not found", "Initialize accounts via landing page or POST /admin/accounts");
    }
    const parsedUrl = parseManifestUrl(account.manifestUrl);
    if (!parsedUrl) {
      return jsonError(500, "Invalid account configuration", "Manifest URL in account record is invalid");
    }
    let config;
    try {
      config = await downloadConfig(parsedUrl.host, parsedUrl.uuid, await getAccountPassword(env, account));
    } catch (err) {
      log("error", "Index", "Config download failed", { error: err.message });
      return jsonError(502, "Failed to download config from account host");
    }
    state = getDefaultUserState(env);
    state.uuid = parsedUrl.uuid;
    state.encryptedPassword = parsedUrl.encPwd;
    state.password = await getAccountPassword(env, account);
    state.preferredHost = parsedUrl.host;
    state.currentHost = parsedUrl.host;
    state.currentUuid = parsedUrl.uuid;
    state.currentEncPwd = parsedUrl.encPwd;
    state.cachedConfig = config;
    state.lastConfigRefresh = Date.now();
    const record = { ...account, ...state };
    await setCachedConfig(env, parsedUrl.uuid, config);
    await putAccount(env, record);
    state = record;
  }
  state.password = await getAccountPassword(env, state);
  const refreshHours = state.cacheRefreshHours || 48;
  const clampedHours = Math.min(72, Math.max(1, refreshHours));
  const refreshMs = clampedHours * 60 * 60 * 1e3;
  if (state.cachedConfig && state.lastConfigRefresh && Date.now() - state.lastConfigRefresh >= refreshMs) {
    refreshConfig(env, state).catch(
      (err) => log("error", "Index", "Background refresh failed", { error: err.message })
    );
  }
  return await routeRequest(
    request,
    state,
    parsed,
    (newState) => putAccount(env, newState),
    { get: () => getHostHealth(env), put: (health) => putHostHealth(env, health) },
    env
  );
}
async function handleDashboard(request, env) {
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
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return new Response(
    dashboardPage(baseUrl),
    {
      headers: { "content-type": "text/html; charset=utf-8" }
    }
  );
}
async function handleManageAccount(request, env, uuid) {
  const token = parseCookie(request, "aio_token");
  if (!token) return Response.redirect(new URL("/", request.url), 302);
  const key = await getSigningKey(env);
  if (!key) return Response.redirect(new URL("/", request.url), 302);
  const payload = await verifyJWT(token, key);
  if (!payload) return Response.redirect(new URL("/", request.url), 302);
  const account = await getAccount(env, uuid);
  if (account && account.token) {
    return Response.redirect(new URL(`/stremio/${account.token}/configure`, request.url), 302);
  }
  return jsonError(410, "Persistent accounts are disabled; use a stateless install token");
}
async function handleAdmin(request, env) {
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
  if (deleteMatch && request.method === "DELETE") {
    const uuid = deleteMatch[1];
    return handleDeleteAccount(env, uuid);
  }
  const getMatch = path.match(/^\/admin\/accounts\/([^/]+)$/);
  if (getMatch && request.method === "GET") {
    const uuid = getMatch[1];
    return handleGetAccount(env, uuid);
  }
  const putMatch = path.match(/^\/admin\/accounts\/([^/]+)$/);
  if (putMatch && request.method === "PUT") {
    const uuid = putMatch[1];
    return handleUpdateAccount(request, env, uuid);
  }
  if (path === "/admin/health" && request.method === "GET") {
    return handleHealth();
  }
  if (path === "/admin/stats" && request.method === "GET") {
    return handleStats(env);
  }
  return jsonError(404, "Admin endpoint not found");
}
function cookieHeader(token, maxAge) {
  return `aio_token=${token}; HttpOnly; Secure; Path=/dashboard; SameSite=Lax; Max-Age=${maxAge}`;
}
function handleLogout() {
  return new Response(null, {
    status: 200,
    headers: {
      "Set-Cookie": cookieHeader("", 0),
      ...corsHeaders()
    }
  });
}
async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const { password } = body;
  if (!password) {
    return jsonError(400, "password is required");
  }
  if (!env.ADMIN_PASSWORD) {
    return jsonError(401, "Invalid password");
  }
  const gate = throttleByIp(request);
  if (gate.blocked) {
    return new Response(JSON.stringify({ error: "Too many login attempts. Try again later." }), {
      status: 429,
      headers: { "content-type": "application/json", "Retry-After": "900", ...corsHeaders() }
    });
  }
  const match = await verifyPassword(password, env.ADMIN_PASSWORD);
  if (!match) {
    return jsonError(401, "Invalid password");
  }
  requestAttempts.delete(gate.ip);
  const key = await getSigningKey(env);
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    sub: "admin",
    iat: now,
    exp: now + 30 * 24 * 60 * 60
  };
  const token = await createJWT(payload, key);
  return new Response(
    JSON.stringify({ token, expiresAt: payload.exp }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "Set-Cookie": cookieHeader(token, 30 * 24 * 60 * 60),
        ...corsHeaders()
      }
    }
  );
}
async function handleCreateAccount(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const { manifestUrl, password, preferredHost, enabledFallbackHosts, cacheRefreshHours } = body;
  const nickname = String(body.nickname || "Streamkeeper install").trim();
  if (!manifestUrl || !password) {
    return jsonError(400, "manifestUrl and password are required");
  }
  const parsed = parseManifestUrl(manifestUrl);
  if (!parsed) {
    return jsonError(400, "Invalid manifest URL format");
  }
  const manifestHost = normalizeUserHost(parsed.host);
  const selectedHost = normalizeUserHost(preferredHost || parsed.host);
  const fallbackHosts = normalizeUserHosts(enabledFallbackHosts || resolveHosts(env));
  if (!manifestHost || !selectedHost || !fallbackHosts.length) {
    return jsonError(400, "Preferred and fallback hosts must be valid HTTPS origins");
  }
  let config;
  try {
    config = await downloadConfig(parsed.host, parsed.uuid, password);
  } catch (err) {
    log("error", "Index", "Config verification failed", { error: err.message });
    return jsonError(502, "Verification failed");
  }
  const statelessToken = await createStatelessToken(env, {
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
  await env.AIO_KV.put(`account:${tokenHash}`, JSON.stringify({
    uuid: tokenHash,
    token: statelessToken,
    nickname,
    installUrl,
    manageUrl,
    createdAt: Date.now()
  }));
  log("info", "Index", "Stateless install token created", { nickname });
  return new Response(JSON.stringify({ nickname, installUrl, manageUrl, token: statelessToken }), {
    status: 201,
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
async function handleListAccounts(env) {
  const accounts = (await listAccounts(env)).map(publicAccount);
  return new Response(JSON.stringify({ accounts }), {
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
async function handleDeleteAccount(env, uuid) {
  await deleteAccount(env, uuid);
  // Revoke the stateless token: readStatelessToken rejects banned: hashes.
  await Promise.all([
    env.AIO_KV.delete(`st:${uuid}`),
    env.AIO_KV.put(`banned:${uuid}`, "1")
  ]);
  log("info", "Index", "Account deleted", { uuid });
  return new Response(null, { status: 204, headers: corsHeaders() });
}
async function handleGetAccount(env, uuid) {
  const account = await getAccount(env, uuid);
  if (!account) {
    return jsonError(404, "Account not found");
  }
  return new Response(JSON.stringify({ account: publicAccount(account) }), {
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
async function handleUpdateAccount(request, env, uuid) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const { nickname, cacheRefreshHours, enabledFallbackHosts } = body;
  if (!nickname) {
    return jsonError(400, "nickname is required");
  }
  const existing = await getAccount(env, uuid);
  if (!existing) {
    return jsonError(404, "Account not found");
  }
  const updated = { ...existing, nickname };
  if (cacheRefreshHours !== void 0) {
    updated.cacheRefreshHours = Math.min(72, Math.max(1, Math.round(cacheRefreshHours)));
  }
  if (Array.isArray(enabledFallbackHosts)) {
    const normalized = normalizeUserHosts(enabledFallbackHosts);
    if (normalized.length) updated.enabledFallbackHosts = normalized;
  }
  await putAccount(env, updated);
  log("info", "Index", "Account updated", { nickname, uuid });
  return new Response(JSON.stringify({ uuid, nickname }), {
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
async function handleScheduled(env) {
  const health = await getHostHealth(env);
  const results = await Promise.all(
    resolveHosts(env).map(async (host) => {
      const started = Date.now();
      const online = await probe(host);
      return {
        host,
        status: online ? "healthy" : "unhealthy",
        checkedAt: Date.now(),
        latencyMs: Date.now() - started,
        consecutiveFailures: online ? 0 : (health[host]?.consecutiveFailures || 0) + 1
      };
    })
  );
  for (const result of results) health[result.host] = result;
  await putHostHealth(env, health);
  log("info", "Index", "Host health refreshed", { healthy: results.filter((result) => result.status === "healthy").length, total: results.length });
}
var healthCache = { data: null, expires: 0 };
async function handleHealth() {
  const now = Date.now();
  if (healthCache.data && healthCache.expires > now) {
    return new Response(JSON.stringify(healthCache.data), {
      headers: { "content-type": "application/json", ...corsHeaders() }
    });
  }
  const results = await Promise.allSettled(resolveHosts(env).map(async (host) => {
    const ok = await probe(host);
    return { host, status: ok ? "up" : "down" };
  }));
  const hosts = results.map((r) => r.status === "fulfilled" ? r.value : { host: "unknown", status: "error" });
  const upCount = hosts.filter((h) => h.status === "up").length;
  const data = { hosts, total: hosts.length, up: upCount, down: hosts.length - upCount, timestamp: now };
  healthCache = { data, expires: now + 3e4 };
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
async function handleStats(env) {
  const accounts = await listAccounts(env);
  const total = accounts.length;
  let totalFailovers = 0;
  let failoverAccounts = 0;
  for (const acc of accounts) {
    const count = acc.failoverCount || 0;
    totalFailovers += count;
    if (count > 0) failoverAccounts++;
  }
  return new Response(JSON.stringify({ total, totalFailovers, failoverAccounts }), {
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
async function handleLanding(request, env) {
  return new Response(statelessSetupPage(), {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
async function handleAccountsPartial(request, env) {
  const auth = await authenticateRequest(request, env);
  if (!auth) return jsonError(401, "Authentication required");
  const accounts = (await listAccounts(env)).map(publicAccount);
  return new Response(accounts.map((account, index) => accountCardHtml(account, index)).join(""), {
    headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders() }
  });
}
const index_default = {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
  async scheduled(controller, env) {
    return handleScheduled(env);
  }
};
export default index_default;