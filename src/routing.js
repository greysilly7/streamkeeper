import { log, fetchWithTimeout, corsHeaders, jsonError } from './utils.js';
import { resolveHosts, downloadConfig, installConfigWithRetry } from './installer.js';

var PROBE_TIMEOUT_MS = 2e3;
var STREAM_TIMEOUT_MS = 7500;
async function probe(host) {
  const baseUrl = host.replace(/\/$/, "");
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/manifest.json`,
      { method: "GET" },
      PROBE_TIMEOUT_MS
    );
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return false;
    return true;
  } catch {
    return false;
  }
}
async function isEncPwdValid(host, uuid, encPwd) {
  try {
    const url = `${host.replace(/\/$/, "")}/stremio/${uuid}/${encPwd}/manifest.json`;
    const res = await fetchWithTimeout(url, { method: "GET" }, PROBE_TIMEOUT_MS);
    return res.ok;
  } catch {
    return false;
  }
}
function shouldCheckPreferred(state) {
  if (!state.preferredHost) return false;
  if (!state.lastPreferredCheck) return true;
  const cooldown = state.preferredCooldownMs || 30 * 60 * 1e3;
  return Date.now() - state.lastPreferredCheck >= cooldown;
}
async function routeRequest(request, state, urlCredentials, putState, healthStore, env) {
  const url = new URL(request.url);
  const prefixMatch = url.pathname.match(/^\/stremio\/(?:v[12]-[^/]+|[^/]+\/[^/]+)\//);
  const suffix = prefixMatch ? url.pathname.slice(prefixMatch[0].length - 1) + url.search : url.pathname + url.search;
  const isStream = suffix.includes("/stream/");
  const timeout = isStream ? STREAM_TIMEOUT_MS : PROBE_TIMEOUT_MS;
  // Buffer non-GET bodies once so failover retries can reuse them (streams are single-use).
  let bodyBuffer;
  if (!["GET", "HEAD"].includes(request.method)) {
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared <= 10 * 1024 * 1024) {
      try {
        bodyBuffer = await request.arrayBuffer();
      } catch {
        bodyBuffer = null;
      }
    }
  }
  try {
    if (shouldCheckPreferred(state)) {
      const preferredOnline = await probe(state.preferredHost);
      state.lastPreferredCheck = Date.now();
      if (preferredOnline) {
        state.currentHost = state.preferredHost;
        state.currentUuid = state.uuid;
        state.currentEncPwd = state.encryptedPassword;
        await putState(state);
      }
    }
    let currentHost = state.currentHost || state.preferredHost;
    let currentUuid = state.currentUuid || urlCredentials?.uuid || state.uuid;
    let currentEncPwd = state.currentEncPwd || urlCredentials?.encryptedPassword || state.encryptedPassword;
    const currentOnline = await probe(currentHost);
    if (currentOnline) {
      const valid = await isEncPwdValid(currentHost, currentUuid, currentEncPwd);
      if (valid) {
        return await proxyRequest(request, currentHost, currentUuid, currentEncPwd, suffix, timeout, bodyBuffer);
      }
      log("info", "Routing", `encPwd stale on ${currentHost}, re-installing config`);
      let config = state.cachedConfig || null;
      if (!config) {
        try {
          config = await downloadConfig(currentHost, currentUuid, state.password);
        } catch {
          config = null;
        }
      }
      if (config) {
        const result = await installConfigWithRetry(currentHost, config, state.password);
        state.currentHost = currentHost;
        state.currentUuid = result.uuid;
        state.currentEncPwd = result.encryptedPassword;
        state.cachedConfig = config;
        await putState(state);
        return await proxyRequest(request, currentHost, result.uuid, result.encryptedPassword, suffix, timeout, bodyBuffer);
      }
    }
    const cachedConfig = state.cachedConfig || null;
    if (!cachedConfig) {
      return jsonError(502, "Current host down and no cached config for failover", "Could not download or cache a config for this user");
    }
    const enabledHosts = state.enabledFallbackHosts && state.enabledFallbackHosts.length > 0 ? state.enabledFallbackHosts : resolveHosts(env);
    if (!enabledHosts.length) {
      return jsonError(502, "All fallback hosts are disabled");
    }
    const candidates = enabledHosts.filter(
      (h) => h !== currentHost && h !== state.preferredHost
    );
    const health = healthStore ? await healthStore.get() : {};
    const now = Date.now();
    const healthTtlMs = 5 * 60 * 1e3;
    const healthyCandidates = candidates.filter((host) => {
      const record = health[host];
      return record?.status === "healthy" && now - (record.checkedAt || 0) < healthTtlMs;
    });
    let orderedCandidates = healthyCandidates;
    if (!orderedCandidates.length) {
      const probedCandidates = await Promise.all(
        candidates.map(async (host) => ({ host, online: await probe(host) }))
      );
      for (const candidate of probedCandidates) {
        health[candidate.host] = {
          ...(health[candidate.host] || {}),
          status: candidate.online ? "healthy" : "unhealthy",
          checkedAt: Date.now(),
          consecutiveFailures: candidate.online ? 0 : (health[candidate.host]?.consecutiveFailures || 0) + 1
        };
      }
      if (healthStore) await healthStore.put(health);
      const reachableCandidates = probedCandidates.filter((candidate) => candidate.online).map((candidate) => candidate.host);
      orderedCandidates = reachableCandidates.length ? reachableCandidates : candidates;
    } else {
      orderedCandidates = [...healthyCandidates, ...candidates.filter((host) => !healthyCandidates.includes(host))];
    }
    for (const host of orderedCandidates) {
      try {
        const config = cachedConfig || await downloadConfig(host, state.uuid, state.password);
        const result = await installConfigWithRetry(
          host,
          config,
          state.password
        );
        state.failoverCount = (state.failoverCount || 0) + 1;
        state.lastFailoverAt = Date.now();
        state.lastFailoverHost = state.currentHost;
        state.currentHost = host;
        state.currentUuid = result.uuid;
        state.currentEncPwd = result.encryptedPassword;
        health[host] = { ...(health[host] || {}), status: "healthy", checkedAt: Date.now(), consecutiveFailures: 0 };
        if (healthStore) await healthStore.put(health);
        await putState(state);
        return await proxyRequest(
          request,
          host,
          result.uuid,
          result.encryptedPassword,
          suffix,
          timeout,
          bodyBuffer
        );
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
async function proxyRequest(request, host, uuid, encryptedPassword, path, timeoutMs, bodyBuffer) {
  const baseUrl = host.replace(/\/$/, "");
  const targetUrl = `${baseUrl}/stremio/${uuid}/${encryptedPassword}${path}`;
  const method = request.method;
  const body = ["GET", "HEAD"].includes(method) ? void 0 : bodyBuffer ?? request.body;
  const headers = new Headers();
  for (const name of ["Accept", "Accept-Language", "Range", "If-None-Match", "If-Modified-Since", "User-Agent", "Content-Type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const isManifest = path.includes("/manifest.json");
  try {
    if (isManifest) {
      const cached = await caches.default.match(targetUrl);
      if (cached) return cached;
    }
    const response = await fetchWithTimeout(
      targetUrl,
      {
        method,
        body,
        redirect: "manual",
        headers
      },
      timeoutMs
    );
    log("info", "Routing", "Upstream response", { host: baseUrl, path, status: response.status });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    for (const [k, v] of Object.entries(corsHeaders())) {
      responseHeaders.set(k, v);
    }
    if (isManifest && response.status === 200) {
      // Cache manifests only; stream chunks must pass through fresh.
      const buffer = await response.arrayBuffer();
      responseHeaders.set("cache-control", "public, max-age=900");
      const toReturn = new Response(buffer, { status: response.status, headers: responseHeaders });
      await caches.default.put(targetUrl, toReturn.clone());
      return toReturn;
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (err) {
    log("error", "Routing", "Upstream request failed", { host: baseUrl, path, error: err.message });
    throw err;
  }
}


export { probe, routeRequest };
