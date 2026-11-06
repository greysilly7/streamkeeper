import { withFailoverLease } from "./failover";
import { downloadSourceConfig, installSourceConfig, updateSourceConfig } from "./installer";
import type {
  Env,
  HealthStore,
  HostHealthEntry,
  Config,
  JsonData,
  JsonObject,
  PutState,
  RequestCredentials,
  Source,
  SourceInstallResult,
  UserState,
} from "./types";
import { isRecord } from "./types";
import { corsHeaders, fetchWithTimeout, jsonError, log, readResponseBody } from "./utils";

const PROBE_TIMEOUT_MS = 2_000;
const STREAM_TIMEOUT_MS = 7_500;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const CURRENT_VALIDATION_TTL_MS = 10 * 1000;
const MAX_FAILOVER_ATTEMPTS = 4;
const MAX_FAILOVER_CANDIDATES = 8;

type ProvisionResult = { host: string; result: SourceInstallResult };
type BodyResult = { tooLarge: boolean; body?: ArrayBuffer };

let healthWriteQueue: Promise<void> | null = null;

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
        await reader.cancel().catch(() => undefined);
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
    const text = new TextDecoder().decode(await readResponseBody(response));
    const value: JsonData = JSON.parse(text) as JsonData;
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

async function probeAiometadataApi(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/config/load/__streamkeeper_probe__`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password: "" }),
      },
      PROBE_TIMEOUT_MS,
      true,
    );
    if (response.status >= 500 || !(response.headers.get("content-type") || "").includes("application/json"))
      return false;
    const text = new TextDecoder().decode(await readResponseBody(response));
    const value: JsonData = JSON.parse(text) as JsonData;
    return isRecord(value) && typeof value.success === "boolean";
  } catch {
    return false;
  }
}

export async function probe(host: string, source: Source = "aiostreams", uuid?: string, encPwd = ""): Promise<boolean> {
  const baseUrl = host.replace(/\/$/, "");
  if (source === "aiometadata" && uuid) return isSourceValid(baseUrl, source, uuid, encPwd);
  if (source === "aiometadata") return probeAiometadataApi(baseUrl);
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

function canonicalJson(value: JsonData): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as JsonObject;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`)
    .join(",")}}`;
}

async function verifyAiometadataConfig(host: string, config: Config, uuid: string, password: string): Promise<void> {
  const restored = await downloadSourceConfig("aiometadata", host, uuid, password);
  if (canonicalJson(config) !== canonicalJson(restored)) {
    throw new Error("AIOMetadata fallback did not preserve the complete configuration");
  }
}
function errorText(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

class StatePersistenceError extends Error {
  constructor() {
    super("Unable to persist failover state");
  }
}

async function persistState(state: UserState, putState: PutState): Promise<void> {
  try {
    await putState(state);
  } catch (error) {
    log("error", "Routing", "State persistence failed", {
      error: errorText(error instanceof Error ? error : String(error)),
    });
    throw new StatePersistenceError();
  }
}

function isEndpointFailure(response: Response): boolean {
  return response.status >= 500 || response.status === 408 || response.status === 429;
}

async function proxyOrFailover(
  request: Request,
  host: string,
  source: Source,
  uuid: string,
  encryptedPassword: string,
  path: string,
  timeoutMs: number,
  bodyBuffer: ArrayBuffer | undefined,
  ctx: ExecutionContext | undefined,
): Promise<Response> {
  const response = await proxyRequest(request, host, source, uuid, encryptedPassword, path, timeoutMs, bodyBuffer, ctx);
  if (!isEndpointFailure(response)) return response;
  await response.body?.cancel().catch(() => undefined);
  throw new Error(`Upstream endpoint failed with status ${response.status}`);
}

export async function updateHostHealth(
  healthStore: HealthStore | undefined,
  source: Source,
  host: string,
  entry: HostHealthEntry,
): Promise<void> {
  if (!healthStore) return;
  const previous = healthWriteQueue || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const health = await healthStore.get();
      const key = `${source}:${host}`;
      const old = health[key] || health[host];
      health[key] = { ...(old || { consecutiveFailures: 0 }), ...entry, source, host };
      await healthStore.put(health);
    });
  healthWriteQueue = next;
  try {
    await next;
  } finally {
    if (healthWriteQueue === next) healthWriteQueue = null;
  }
}

async function safeUpdateHostHealth(
  healthStore: HealthStore | undefined,
  source: Source,
  host: string,
  entry: HostHealthEntry,
): Promise<void> {
  try {
    await updateHostHealth(healthStore, source, host, entry);
  } catch (error) {
    log("warn", "Routing", "Health state update failed", {
      host,
      error: errorText(error instanceof Error ? error : String(error)),
    });
  }
}

async function healthSnapshot(healthStore: HealthStore | undefined): Promise<Record<string, HostHealthEntry>> {
  if (!healthStore) return {};
  try {
    return await healthStore.get();
  } catch (error) {
    log("warn", "Routing", "Health state read failed", {
      error: errorText(error instanceof Error ? error : String(error)),
    });
    return {};
  }
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
        await persistState(state, putState);
      }
    }

    const validationFresh = Boolean(
      state.lastCurrentValidationAt &&
        Date.now() - state.lastCurrentValidationAt < CURRENT_VALIDATION_TTL_MS &&
        state.validatedHost === currentHost &&
        state.validatedUuid === currentUuid &&
        state.validatedEncPwd === currentEncPwd,
    );
    if (validationFresh) {
      try {
        return await proxyOrFailover(
          request,
          currentHost,
          source,
          currentUuid,
          currentEncPwd,
          suffix,
          timeout,
          bodyBuffer,
          ctx,
        );
      } catch (error) {
        log("warn", "Routing", "Current endpoint failed", {
          host: currentHost,
          error: errorText(error instanceof Error ? error : String(error)),
        });
        state.lastCurrentValidationAt = 0;
      }
    } else if (await isSourceValid(currentHost, source, currentUuid, currentEncPwd)) {
      state.lastCurrentValidationAt = Date.now();
      state.validatedHost = currentHost;
      state.validatedUuid = currentUuid;
      state.validatedEncPwd = currentEncPwd;
      try {
        return await proxyOrFailover(
          request,
          currentHost,
          source,
          currentUuid,
          currentEncPwd,
          suffix,
          timeout,
          bodyBuffer,
          ctx,
        );
      } catch (error) {
        log("warn", "Routing", "Current endpoint failed", {
          host: currentHost,
          error: errorText(error instanceof Error ? error : String(error)),
        });
        state.lastCurrentValidationAt = 0;
      }
    }

    const config = state.cachedConfig || null;
    if (config && (await probe(currentHost, source))) {
      try {
        const result = await withFailoverLease(env, installationKey, () =>
          updateSourceConfig(source, currentHost, config, state.password, currentUuid, currentEncPwd),
        );
        if (source === "aiometadata") await verifyAiometadataConfig(currentHost, config, result.uuid, state.password);
        state.currentUuid = result.uuid;
        state.currentEncPwd = result.encryptedPassword;
        state.cachedConfig = config;
        state.lastCurrentValidationAt = Date.now();
        state.validatedHost = currentHost;
        state.validatedUuid = result.uuid;
        state.validatedEncPwd = result.encryptedPassword;
        await persistState(state, putState);
        await invalidateManifestCache(currentHost, source, result.uuid, result.encryptedPassword);
        try {
          return await proxyOrFailover(
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
          log("warn", "Routing", "Repaired endpoint failed", {
            host: currentHost,
            error: errorText(error instanceof Error ? error : String(error)),
          });
        }
      } catch (error) {
        if (error instanceof StatePersistenceError) return jsonError(503, error.message);
        log("error", "Routing", "Current host config repair failed", {
          host: currentHost,
          error: errorText(error instanceof Error ? error : String(error)),
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
    const enabledHosts = state.enabledFallbackHosts;
    if (!enabledHosts.length) return jsonError(502, "All fallback hosts are disabled");
    const candidates = enabledHosts
      .filter((host) => host !== currentHost && host !== state.preferredHost)
      .slice(0, MAX_FAILOVER_CANDIDATES);
    if (!candidates.length) return jsonError(502, "All instances unavailable", "No fallback host is reachable");

    const health = await healthSnapshot(healthStore);
    const probedCandidates = await Promise.all(
      candidates.map(async (host) => {
        const started = Date.now();
        const online = await probe(host, source);
        return { host, online, latencyMs: Date.now() - started };
      }),
    );
    for (const candidate of probedCandidates) {
      const previous = health[`${source}:${candidate.host}`] || health[candidate.host];
      const entry: HostHealthEntry = {
        ...(previous || { consecutiveFailures: 0 }),
        status: candidate.online ? "healthy" : "unhealthy",
        checkedAt: Date.now(),
        latencyMs: candidate.latencyMs,
        source,
        host: candidate.host,
        consecutiveFailures: candidate.online ? 0 : (previous?.consecutiveFailures || 0) + 1,
      };
      health[`${source}:${candidate.host}`] = entry;
      await safeUpdateHostHealth(healthStore, source, candidate.host, entry);
    }
    const healthyCandidates = probedCandidates.filter((candidate) => candidate.online);
    const orderedCandidates =
      healthyCandidates.length > 0
        ? [...healthyCandidates, ...probedCandidates.filter((candidate) => !candidate.online)].slice(
            0,
            MAX_FAILOVER_ATTEMPTS,
          )
        : [];
    if (!orderedCandidates.length) return jsonError(502, "All instances unavailable", "No fallback host is reachable");

    let fallbackResult: ProvisionResult;
    try {
      fallbackResult = await withFailoverLease(env, installationKey, async () => {
        for (const candidate of orderedCandidates) {
          const host = candidate.host;
          try {
            const result =
              source === "aiometadata" && (await isSourceValid(host, source, state.uuid, ""))
                ? {
                    uuid: state.uuid,
                    encryptedPassword: "",
                    manifestUrl: `${host}/stremio/${state.uuid}/manifest.json`,
                  }
                : await installSourceConfig(
                    source,
                    host,
                    cachedConfig,
                    state.password,
                    source === "aiometadata" ? state.uuid : undefined,
                  );
            if (source === "aiometadata")
              await verifyAiometadataConfig(host, cachedConfig, result.uuid, state.password);
            const key = `${source}:${host}`;
            const previous = health[key] || health[host];
            const entry: HostHealthEntry = {
              ...(previous || { consecutiveFailures: 0 }),
              status: "healthy",
              checkedAt: Date.now(),
              consecutiveFailures: 0,
              source,
              host,
            };
            health[key] = entry;
            await safeUpdateHostHealth(healthStore, source, host, entry);
            return { host, result };
          } catch (error) {
            const key = `${source}:${host}`;
            const previous = health[key] || health[host];
            const entry: HostHealthEntry = {
              ...(previous || { consecutiveFailures: 0 }),
              status: "unhealthy",
              checkedAt: Date.now(),
              consecutiveFailures: (previous?.consecutiveFailures || 0) + 1,
              source,
              host,
            };
            health[key] = entry;
            await safeUpdateHostHealth(healthStore, source, host, entry);
            log("error", "Routing", "Failover attempt failed", {
              host,
              error: errorText(error instanceof Error ? error : String(error)),
            });
          }
        }
        throw new Error("Failover exhausted all reachable hosts");
      });
    } catch (error) {
      log("error", "Routing", "Failover provisioning failed", {
        error: errorText(error instanceof Error ? error : String(error)),
      });
      return jsonError(502, "All instances unavailable");
    }

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
    try {
      await persistState(state, putState);
    } catch (error) {
      if (error instanceof StatePersistenceError) return jsonError(503, error.message);
      throw error;
    }
    try {
      return await proxyOrFailover(
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
      log("error", "Routing", "Fallback endpoint failed", {
        host: state.currentHost,
        error: errorText(error instanceof Error ? error : String(error)),
      });
      return jsonError(502, "All instances unavailable");
    }
  } catch (error) {
    if (error instanceof StatePersistenceError) return jsonError(503, error.message);
    log("error", "Routing", "Route failed", { error: errorText(error instanceof Error ? error : String(error)) });
    return jsonError(502, "All instances unavailable");
  }
}

async function invalidateManifestCache(
  host: string,
  source: Source,
  uuid: string,
  encryptedPassword: string,
): Promise<void> {
  if (source === "aiometadata") return;
  const target = `${host.replace(/\/$/, "")}${sourcePrefix(source, uuid, encryptedPassword)}/manifest.json`;
  try {
    await caches.default.delete(new Request(target, { method: "GET" }));
  } catch (error) {
    log("warn", "Routing", "Manifest cache invalidation failed", {
      host,
      error: errorText(error instanceof Error ? error : String(error)),
    });
  }
}

async function fetchWithBodyTimeout(targetUrl: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, { ...options, signal: controller.signal });
    if (!response.body) {
      clearTimeout(timer);
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const next = await reader.read();
          if (next.done) {
            clearTimeout(timer);
            streamController.close();
          } else {
            streamController.enqueue(next.value);
          }
        } catch (error) {
          clearTimeout(timer);
          streamController.error(error);
        }
      },
      async cancel(reason) {
        clearTimeout(timer);
        await reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(`Upstream request timed out after ${timeoutMs}ms`);
    throw error;
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
    const response = await fetchWithBodyTimeout(targetUrl, fetchOptions, timeoutMs);
    log("info", "Routing", "Upstream response", { host: baseUrl, path, status: response.status });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    for (const [key, value] of Object.entries(corsHeaders())) responseHeaders.set(key, value);
    if (cacheManifest && response.status === 200) {
      const buffer = await readResponseBody(response);
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
      error: errorText(error instanceof Error ? error : String(error)),
    });
    throw error;
  }
}
