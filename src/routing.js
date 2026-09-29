import { log, fetchWithTimeout, corsHeaders, jsonError } from './utils.js';
import { resolveHosts, downloadSourceConfig, installSourceConfig } from './installer.js';

var PROBE_TIMEOUT_MS = 2e3;
var STREAM_TIMEOUT_MS = 7500;
async function probe(host) {
  const baseUrl = host.replace(/\/$/, "");
  try {
    const response = await fetchWithTimeout(`${baseUrl}/manifest.json`, { method: "GET" }, PROBE_TIMEOUT_MS);
    return response.ok && (response.headers.get("content-type") || "").includes("application/json");
  } catch {
    return false;
  }
}
function sourcePrefix(source, uuid, encPwd) {
  return source === "aiometadata" ? `/stremio/${uuid}` : `/stremio/${uuid}/${encPwd}`;
}
async function isSourceValid(host, source, uuid, encPwd) {
  try {
    const url = `${host.replace(/\/$/, "")}${sourcePrefix(source, uuid, encPwd)}/manifest.json`;
    const res = await fetchWithTimeout(url, { method: "GET" }, PROBE_TIMEOUT_MS);
    return res.ok && (res.headers.get("content-type") || "").includes("application/json");
  } catch {
    return false;
  }
}
function shouldCheckPreferred(state) {
  if (!state.preferredHost || state.currentHost === state.preferredHost) return false;
  if (!state.lastPreferredCheck) return true;
  const cooldown = state.preferredCooldownMs || 30 * 60 * 1e3;
  return Date.now() - state.lastPreferredCheck >= cooldown;
}
async function routeRequest(request, state, urlCredentials, putState, healthStore, env) {
  const url = new URL(request.url);
  const source = state.source || "aiostreams";
  const prefixPattern = source === "aiometadata"
    ? /^\/stremio\/[^/]+\//
    : /^\/stremio\/(?:v[12]-[^/]+|[^/]+\/[^/]+)\//;
  const prefixMatch = url.pathname.match(prefixPattern);
  const suffix = prefixMatch ? url.pathname.slice(prefixMatch[0].length - 1) + url.search : url.pathname + url.search;
  const isStream = suffix.includes("/stream/");
  const timeout = isStream ? STREAM_TIMEOUT_MS : PROBE_TIMEOUT_MS;
  let bodyBuffer;
  if (!["GET", "HEAD"].includes(request.method)) {
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared <= 10 * 1024 * 1024) {
      try { bodyBuffer = await request.arrayBuffer(); } catch { bodyBuffer = null; }
    }
  }
  try {
    let currentHost = state.currentHost || state.preferredHost;
    let currentUuid = state.currentUuid || urlCredentials?.uuid || state.uuid;
    let currentEncPwd = state.currentEncPwd || urlCredentials?.encryptedPassword || state.encryptedPassword || "";
    if (shouldCheckPreferred(state)) {
      const preferredValid = await isSourceValid(state.preferredHost, source, state.uuid, state.encryptedPassword || "");
      state.lastPreferredCheck = Date.now();
      if (preferredValid) {
        state.currentHost = state.preferredHost;
        state.currentUuid = state.uuid;
        state.currentEncPwd = state.encryptedPassword || "";
        currentHost = state.currentHost;
        currentUuid = state.currentUuid;
        currentEncPwd = state.currentEncPwd;
        await putState(state);
      }
    }
    if (await isSourceValid(currentHost, source, currentUuid, currentEncPwd)) {
      return await proxyRequest(request, currentHost, source, currentUuid, currentEncPwd, suffix, timeout, bodyBuffer);
    }
    const config = state.cachedConfig || null;
    if (config && await probe(currentHost)) {
      const result = await installSourceConfig(source, currentHost, config, state.password, source === "aiometadata" ? currentUuid : null);
      state.currentHost = currentHost;
      state.currentUuid = result.uuid;
      state.currentEncPwd = result.encryptedPassword;
      state.cachedConfig = config;
      await putState(state);
      return await proxyRequest(request, currentHost, source, result.uuid, result.encryptedPassword, suffix, timeout, bodyBuffer);
    }
    const cachedConfig = state.cachedConfig || null;
    if (!cachedConfig) return jsonError(502, "Current host down and no cached config for failover", "Could not download or cache a config for this user");
    const enabledHosts = state.enabledFallbackHosts?.length ? state.enabledFallbackHosts : resolveHosts(env, source);
    if (!enabledHosts.length) return jsonError(502, "All fallback hosts are disabled");
    const candidates = enabledHosts.filter((h) => h !== currentHost && h !== state.preferredHost);
    const health = healthStore ? await healthStore.get() : {};
    const now = Date.now();
    const healthyCandidates = candidates.filter((host) => health[host]?.status === "healthy" && now - (health[host].checkedAt || 0) < 5 * 60 * 1e3);
    let orderedCandidates = healthyCandidates;
    if (!orderedCandidates.length) {
      const probedCandidates = await Promise.all(candidates.map(async (host) => ({ host, online: await probe(host) })));
      for (const candidate of probedCandidates) {
        health[candidate.host] = { ...(health[candidate.host] || {}), status: candidate.online ? "healthy" : "unhealthy", checkedAt: Date.now(), consecutiveFailures: candidate.online ? 0 : (health[candidate.host]?.consecutiveFailures || 0) + 1 };
      }
      if (healthStore) await healthStore.put(health);
      const reachable = probedCandidates.filter((candidate) => candidate.online).map((candidate) => candidate.host);
      orderedCandidates = reachable.length ? reachable : candidates;
    } else {
      orderedCandidates = [...healthyCandidates, ...candidates.filter((host) => !healthyCandidates.includes(host))];
    }
    for (const host of orderedCandidates) {
      try {
        const result = source === "aiometadata" && await isSourceValid(host, source, state.uuid, "")
          ? { uuid: state.uuid, encryptedPassword: "" }
          : await installSourceConfig(source, host, cachedConfig, state.password, source === "aiometadata" ? state.uuid : null);
        if (!await isSourceValid(host, source, result.uuid, result.encryptedPassword)) throw new Error("Fallback manifest validation failed");
        state.failoverCount = (state.failoverCount || 0) + 1;
        state.lastFailoverAt = Date.now();
        state.lastFailoverHost = state.currentHost;
        state.currentHost = host;
        state.currentUuid = result.uuid;
        state.currentEncPwd = result.encryptedPassword;
        health[host] = { ...(health[host] || {}), status: "healthy", checkedAt: Date.now(), consecutiveFailures: 0 };
        if (healthStore) await healthStore.put(health);
        await putState(state);
        return await proxyRequest(request, host, source, result.uuid, result.encryptedPassword, suffix, timeout, bodyBuffer);
      } catch (err) {
        health[host] = { ...(health[host] || {}), status: "unhealthy", checkedAt: Date.now(), consecutiveFailures: (health[host]?.consecutiveFailures || 0) + 1 };
        if (healthStore) await healthStore.put(health);
        log("error", "Routing", "Failover attempt failed", { host, error: err.message });
      }
    }
    return jsonError(502, "All instances unavailable", "Failover exhausted all hosts");
  } catch (err) {
    log("error", "Routing", "Route failed", { error: err.message });
    return jsonError(502, "All instances unavailable");
  }
}
async function proxyRequest(request, host, source, uuid, encryptedPassword, path, timeoutMs, bodyBuffer) {
  const baseUrl = host.replace(/\/$/, "");
  const targetUrl = `${baseUrl}${sourcePrefix(source, uuid, encryptedPassword)}${path}`;
  const method = request.method;
  const body = ["GET", "HEAD"].includes(method) ? void 0 : bodyBuffer ?? request.body;
  const headers = new Headers();
  for (const name of ["Accept", "Accept-Language", "Range", "If-None-Match", "If-Modified-Since", "User-Agent", "Content-Type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const isManifest = path.includes("/manifest.json");
  const cacheManifest = isManifest && source !== "aiometadata";
  try {
    if (cacheManifest) {
      const cached = await caches.default.match(targetUrl);
      if (cached) return cached;
    }
    const response = await fetchWithTimeout(targetUrl, { method, body, redirect: "manual", headers }, timeoutMs);
    log("info", "Routing", "Upstream response", { host: baseUrl, path, status: response.status });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    for (const [k, v] of Object.entries(corsHeaders())) responseHeaders.set(k, v);
    if (cacheManifest && response.status === 200) {
      const buffer = await response.arrayBuffer();
      responseHeaders.set("cache-control", "public, max-age=900");
      const toReturn = new Response(buffer, { status: response.status, headers: responseHeaders });
      await caches.default.put(targetUrl, toReturn.clone());
      return toReturn;
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (err) {
    log("error", "Routing", "Upstream request failed", { host: baseUrl, path, error: err.message });
    throw err;
  }
}


export { probe, routeRequest };
