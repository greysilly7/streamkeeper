import { installSourceConfig, resolveHosts, updateSourceConfig } from "./installer";
import type {
  Env,
  HealthStore,
  JsonData,
  PutState,
  RequestCredentials,
  Source,
  SourceInstallResult,
  UserState,
} from "./types";
import { isRecord } from "./types";
import { corsHeaders, fetchWithTimeout, jsonError, log } from "./utils";

const PROBE_TIMEOUT_MS = 2_000;
const STREAM_TIMEOUT_MS = 7_500;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const CURRENT_VALIDATION_TTL_MS = 10 * 1000;
type ProvisionResult = SourceInstallResult | { host: string; result: SourceInstallResult };
const provisionLocks = new Map<string, Promise<ProvisionResult>>();

// ponytail: process-local lock; Durable Objects if cross-isolate serialization is required.
function withProvisionLock<T extends ProvisionResult>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = provisionLocks.get(key);
  if (existing) return existing as Promise<T>;
  const promise = Promise.resolve().then(operation);
  provisionLocks.set(key, promise);
  const cleanup = (): void => {
    if (provisionLocks.get(key) === promise) provisionLocks.delete(key);
  };
  promise.then(
    () => setTimeout(cleanup, 1_000),
    () => setTimeout(cleanup, 1_000),
  );
  return promise;
}

type BodyResult = { tooLarge: boolean; body?: ArrayBuffer };

async function readBodyWithLimit(request: Request): Promise<BodyResult> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared >= 0 && declared > MAX_BODY_BYTES) return { tooLarge: true };
  if (!request.body) return { tooLarge: false, body: new ArrayBuffer(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, body: body.buffer };
}

async function isStremioManifest(response: Response): Promise<boolean> {
  if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) return false;
  try {
    const value: JsonData = await response.json();
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.version === "string" &&
      typeof value.name === "string" &&
      Array.isArray(value.resources) &&
      Array.isArray(value.types)
    );
  } catch {
    return false;
  }
}

export async function probe(host: string): Promise<boolean> {
  const baseUrl = host.replace(/\/$/, "");
  try {
    const response = await fetchWithTimeout(`${baseUrl}/manifest.json`, { method: "GET" }, PROBE_TIMEOUT_MS, true);
    return isStremioManifest(response);
  } catch {
    return false;
  }
}

function sourcePrefix(source: Source, uuid: string, encPwd: string): string {
  return source === "aiometadata" ? `/stremio/${uuid}` : `/stremio/${uuid}/${encPwd}`;
}

async function isSourceValid(host: string, source: Source, uuid: string, encPwd: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${host.replace(/\/$/, "")}${sourcePrefix(source, uuid, encPwd)}/manifest.json`,
      { method: "GET" },
      PROBE_TIMEOUT_MS,
      true,
    );
    return isStremioManifest(response);
  } catch {
    return false;
  }
}

function shouldCheckPreferred(state: UserState): boolean {
  if (!state.preferredHost || state.currentHost === state.preferredHost) return false;
  if (!state.lastPreferredCheck) return true;
  return Date.now() - state.lastPreferredCheck >= (state.preferredCooldownMs || 30 * 60 * 1e3);
}

export async function routeRequest(
  request: Request,
  state: UserState,
  urlCredentials: RequestCredentials | undefined,
  putState: PutState,
  healthStore: HealthStore | undefined,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const source = state.source || "aiostreams";
  const prefixPattern = source === "aiometadata" ? /^\/stremio\/[^/]+\// : /^\/stremio\/(?:v[12]-[^/]+|[^/]+\/[^/]+)\//;
  const prefixMatch = url.pathname.match(prefixPattern);
  const suffix = prefixMatch ? url.pathname.slice(prefixMatch[0].length - 1) + url.search : url.pathname + url.search;
  const isStream = suffix.includes("/stream/");
  const timeout = isStream ? STREAM_TIMEOUT_MS : PROBE_TIMEOUT_MS;
  let bodyBuffer: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    try {
      const result = await readBodyWithLimit(request);
      if (result.tooLarge)
        return jsonError(413, "Request body too large", `Maximum body size is ${MAX_BODY_BYTES} bytes`);
      bodyBuffer = result.body;
    } catch {
      return jsonError(400, "Unable to read request body");
    }
  }
  try {
    let currentHost = state.currentHost || state.preferredHost;
    let currentUuid = state.currentUuid || urlCredentials?.uuid || state.uuid;
    let currentEncPwd = state.currentEncPwd || urlCredentials?.encryptedPassword || state.encryptedPassword || "";
    const installationKey = state.installationKey || state.uuid || urlCredentials?.uuid || currentUuid;
    if (shouldCheckPreferred(state)) {
      const preferredValid = await isSourceValid(
        state.preferredHost,
        source,
        state.uuid,
        state.encryptedPassword || "",
      );
      state.lastPreferredCheck = Date.now();
      if (preferredValid) {
        state.currentHost = state.preferredHost;
        state.currentUuid = state.uuid;
        state.currentEncPwd = state.encryptedPassword || "";
        currentHost = state.currentHost;
        currentUuid = state.currentUuid;
        currentEncPwd = state.currentEncPwd;
        state.lastCurrentValidationAt = Date.now();
        state.validatedHost = currentHost;
        state.validatedUuid = currentUuid;
        state.validatedEncPwd = currentEncPwd;
        await putState(state);
      }
    }
    const validationFresh = Boolean(
      state.lastCurrentValidationAt &&
        Date.now() - state.lastCurrentValidationAt < CURRENT_VALIDATION_TTL_MS &&
        state.validatedHost === currentHost &&
        state.validatedUuid === currentUuid &&
        state.validatedEncPwd === currentEncPwd,
    );
    if (validationFresh)
      return proxyRequest(request, currentHost, source, currentUuid, currentEncPwd, suffix, timeout, bodyBuffer, ctx);
    if (!validationFresh) {
      if (!(await isSourceValid(currentHost, source, currentUuid, currentEncPwd))) {
        state.lastCurrentValidationAt = 0;
      } else {
        state.lastCurrentValidationAt = Date.now();
        state.validatedHost = currentHost;
        state.validatedUuid = currentUuid;
        state.validatedEncPwd = currentEncPwd;
        return proxyRequest(request, currentHost, source, currentUuid, currentEncPwd, suffix, timeout, bodyBuffer, ctx);
      }
    }
    const config = state.cachedConfig || null;
    if (config && (await probe(currentHost))) {
      try {
        const result =
          currentHost === state.preferredHost
            ? await updateSourceConfig(source, currentHost, config, state.password, state.uuid, currentEncPwd)
            : await withProvisionLock(`${source}:${installationKey}:${currentHost}`, () =>
                installSourceConfig(
                  source,
                  currentHost,
                  config,
                  state.password,
                  source === "aiometadata" ? currentUuid : undefined,
                ),
              );
        state.currentHost = currentHost;
        state.currentUuid = result.uuid;
        state.currentEncPwd = result.encryptedPassword;
        state.cachedConfig = config;
        state.lastCurrentValidationAt = Date.now();
        state.validatedHost = currentHost;
        state.validatedUuid = result.uuid;
        state.validatedEncPwd = result.encryptedPassword;
        return proxyRequest(
          request,
          currentHost,
          source,
          result.uuid,
          result.encryptedPassword,
          suffix,
          timeout,
          bodyBuffer,
          ctx,
        );
      } catch (error) {
        log("error", "Routing", "Current host config repair failed", {
          host: currentHost,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const cachedConfig = state.cachedConfig || null;
    if (!cachedConfig)
      return jsonError(
        502,
        "Current host down and no cached config for failover",
        "Could not download or cache a config for this user",
      );
    const enabledHosts = state.enabledFallbackHosts.length ? state.enabledFallbackHosts : resolveHosts(env, source);
    if (!enabledHosts.length) return jsonError(502, "All fallback hosts are disabled");
    const candidates = enabledHosts.filter((host) => host !== currentHost && host !== state.preferredHost);
    const health = healthStore ? await healthStore.get() : {};
    const now = Date.now();
    const healthyCandidates = candidates.filter((host) => {
      const entry = health[`${source}:${host}`] || health[host];
      return entry?.status === "healthy" && now - entry.checkedAt < 5 * 60 * 1e3;
    });
    let orderedCandidates = healthyCandidates;
    if (!orderedCandidates.length) {
      const probedCandidates = await Promise.all(candidates.map(async (host) => ({ host, online: await probe(host) })));
      for (const candidate of probedCandidates) {
        const key = `${source}:${candidate.host}`;
        const previous = health[key] || health[candidate.host];
        health[key] = {
          ...(previous || { consecutiveFailures: 0 }),
          status: candidate.online ? "healthy" : "unhealthy",
          checkedAt: Date.now(),
          consecutiveFailures: candidate.online ? 0 : (previous?.consecutiveFailures || 0) + 1,
        };
      }
      if (healthStore) await healthStore.put(health);
      orderedCandidates = probedCandidates.filter((candidate) => candidate.online).map((candidate) => candidate.host);
    }
    if (!orderedCandidates.length) return jsonError(502, "All instances unavailable", "No fallback host is reachable");
    const fallbackResult = await withProvisionLock(`${source}:${installationKey}`, async () => {
      for (const host of orderedCandidates) {
        try {
          const result =
            source === "aiometadata" && (await isSourceValid(host, source, state.uuid, ""))
              ? { uuid: state.uuid, encryptedPassword: "", manifestUrl: `${host}/stremio/${state.uuid}/manifest.json` }
              : await installSourceConfig(
                  source,
                  host,
                  cachedConfig,
                  state.password,
                  source === "aiometadata" ? state.uuid : undefined,
                );
          if (!(await isSourceValid(host, source, result.uuid, result.encryptedPassword)))
            throw new Error("Fallback manifest validation failed");
          const key = `${source}:${host}`;
          health[key] = {
            ...(health[key] || health[host] || { consecutiveFailures: 0 }),
            status: "healthy",
            checkedAt: Date.now(),
            consecutiveFailures: 0,
          };
          if (healthStore) await healthStore.put(health);
          return { host, result };
        } catch (error) {
          const key = `${source}:${host}`;
          const previous = health[key] || health[host];
          health[key] = {
            ...(previous || { consecutiveFailures: 0 }),
            status: "unhealthy",
            checkedAt: Date.now(),
            consecutiveFailures: (previous?.consecutiveFailures || 0) + 1,
          };
          if (healthStore) await healthStore.put(health);
          log("error", "Routing", "Failover attempt failed", {
            host,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      throw new Error("Failover exhausted all reachable hosts");
    });
    state.failoverCount += 1;
    state.lastFailoverAt = Date.now();
    state.lastFailoverHost = state.currentHost;
    state.currentHost = fallbackResult.host;
    state.currentUuid = fallbackResult.result.uuid;
    state.currentEncPwd = fallbackResult.result.encryptedPassword;
    state.lastCurrentValidationAt = Date.now();
    state.validatedHost = state.currentHost;
    state.validatedUuid = state.currentUuid;
    state.validatedEncPwd = state.currentEncPwd;
    return proxyRequest(
      request,
      state.currentHost,
      source,
      state.currentUuid,
      state.currentEncPwd,
      suffix,
      timeout,
      bodyBuffer,
      ctx,
    );
  } catch (error) {
    log("error", "Routing", "Route failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonError(502, "All instances unavailable");
  }
}

async function proxyRequest(
  request: Request,
  host: string,
  source: Source,
  uuid: string,
  encryptedPassword: string,
  path: string,
  timeoutMs: number,
  bodyBuffer?: ArrayBuffer,
  ctx?: ExecutionContext,
): Promise<Response> {
  const baseUrl = host.replace(/\/$/, "");
  const targetUrl = `${baseUrl}${sourcePrefix(source, uuid, encryptedPassword)}${path}`;
  const method = request.method;
  const body = ["GET", "HEAD"].includes(method) ? undefined : (bodyBuffer ?? request.body);
  const headers = new Headers();
  for (const name of [
    "Accept",
    "Accept-Language",
    "Range",
    "If-None-Match",
    "If-Modified-Since",
    "User-Agent",
    "Content-Type",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const isManifest = path.includes("/manifest.json");
  const cacheManifest = method === "GET" && isManifest && source !== "aiometadata";
  const cacheKey = new Request(targetUrl, { method: "GET" });
  try {
    if (cacheManifest) {
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;
    }
    const fetchOptions: RequestInit = { method, redirect: "manual", headers };
    if (body !== undefined) fetchOptions.body = body as BodyInit;
    const response = await fetchWithTimeout(targetUrl, fetchOptions, timeoutMs);
    log("info", "Routing", "Upstream response", { host: baseUrl, path, status: response.status });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    for (const [key, value] of Object.entries(corsHeaders())) responseHeaders.set(key, value);
    if (cacheManifest && response.status === 200) {
      const buffer = await response.arrayBuffer();
      responseHeaders.set("cache-control", "public, s-maxage=900, max-age=900");
      const toReturn = new Response(buffer, { status: response.status, headers: responseHeaders });
      const cacheWrite = caches.default.put(cacheKey, toReturn.clone()).catch((error: Error) => {
        log("warn", "Routing", "Manifest cache write failed", { host: baseUrl, error: error.message });
      });
      if (ctx) ctx.waitUntil(cacheWrite);
      else await cacheWrite;
      return toReturn;
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    log("error", "Routing", "Upstream request failed", {
      host: baseUrl,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
