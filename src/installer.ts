import type { Config, Env, JsonData, JsonObject, Source, SourceInstallResult } from "./types";
import { isRecord } from "./types";
import { normalizeUserHost } from "./utils";

const DEFAULT_HOSTS = [
  "https://aiostreams.fortheweak.cloud",
  "https://aio.atbphosting.com",
  "https://aiostreams.12312023.xyz",
  "https://aiostreamsfortheweebsstable.midnightignite.me",
  "https://aiostreams.stremio.ru",
  "https://aiostreams.elfhosted.com",
  "https://aiostreams-stable.forthewizards.uk",
];
const DEFAULT_AIOMETADATA_HOSTS = [
  "https://aiometadata.elfhosted.com",
  "https://aiometadata.fortheweak.cloud",
  "https://aiometadata.viren070.me",
  "https://aiometadatafortheweebs.midnightignite.me",
  "https://aiometadata.forthewizards.uk",
  "https://aiomd.atbphosting.com",
  "https://aiometadata.12312023.xyz",
  "https://aiometadatafortheweak.nhyira.dev",
  "https://aiometadata.stremio.ru",
];
const INSTALL_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_FIELD_LENGTH = 4_096;
const MAX_ERROR_LENGTH = 512;

function isPlainRecord(value: JsonData | undefined | null): value is JsonObject {
  return isRecord(value) && !Array.isArray(value);
}

function isJsonArray(value: JsonData | undefined | null): value is JsonData[] {
  return Array.isArray(value);
}

function isConfigRecord(value: JsonData | undefined | null): boolean {
  if (!isPlainRecord(value)) return false;
  const id = value.id;
  return id === undefined || (typeof id === "string" && id.length <= MAX_FIELD_LENGTH);
}

function isConfig(value: JsonData | undefined | null): value is Config {
  if (!isPlainRecord(value)) return false;
  const services = value.services;
  const presets = value.presets;
  if (services !== undefined && (!isJsonArray(services) || !services.every((item) => isConfigRecord(item))))
    return false;
  if (presets !== undefined && (!isJsonArray(presets) || !presets.every((item) => isConfigRecord(item)))) return false;
  for (const preset of isJsonArray(presets) ? presets : []) {
    if (!isPlainRecord(preset)) return false;
    const type = preset.type;
    if (type !== undefined && (typeof type !== "string" || type.length > MAX_FIELD_LENGTH)) return false;
  }
  return true;
}

function requireInputString(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function requireResponseString(value: JsonData | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    throw new Error(`Invalid ${label} in source response`);
  }
  return value;
}

function responseObject(value: JsonData): JsonObject {
  if (!isPlainRecord(value)) throw new Error("Invalid JSON response from source host");
  return value;
}

function apiError(payload: JsonObject, fallback: string): string {
  const error = payload.error;
  let message: string | undefined;
  if (typeof error === "string") {
    message = error;
  } else if (isPlainRecord(error) && typeof error.message === "string") {
    message = error.message;
  }
  if (!message) return fallback;
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}...` : message;
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function readResponseBody(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new Error("Invalid source response length");
    }
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Source response is too large");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error("Source response is too large");
    return body;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Source response is too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchResponse(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    await readResponseBody(response);
    return response;
  } catch (error) {
    if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${safeUrl(url)}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(
  url: string,
  options: RequestInit,
  timeoutMs = INSTALL_TIMEOUT_MS,
): Promise<{ response: Response; payload: JsonData }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const bytes = await readResponseBody(response);
    let payload: JsonData;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as JsonData;
    } catch {
      throw new Error("Invalid JSON response from source host");
    }
    return { response, payload };
  } catch (error) {
    if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${safeUrl(url)}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requireHost(host: string, source: Source): string {
  const normalized = normalizeUserHost(host);
  if (!normalized) throw new Error(`Invalid ${source} host`);
  return normalized;
}

function requireConfig(config: Config): Config {
  if (!isConfig(config)) throw new Error("Invalid config");
  return config;
}

export function resolveHosts(env: Env | undefined, source: Source = "aiostreams"): string[] {
  const override = env?.[source === "aiometadata" ? "AIOMETADATA_HOSTS" : "HOSTS"];
  const hosts = override ? override.split(",") : source === "aiometadata" ? DEFAULT_AIOMETADATA_HOSTS : DEFAULT_HOSTS;
  return [...new Set(hosts.map(normalizeUserHost).filter((host): host is string => host !== null))];
}

export const HOSTS = DEFAULT_HOSTS;
export const AIOMETADATA_HOSTS = DEFAULT_AIOMETADATA_HOSTS;

async function downloadAiometadataConfig(host: string, uuid: string, password: string): Promise<Config> {
  const baseUrl = requireHost(host, "aiometadata");
  const userUuid = requireInputString(uuid, "AIOMetadata UUID");
  const userPassword = requireInputString(password, "AIOMetadata password");
  const { response, payload } = await fetchJson(`${baseUrl}/api/config/load/${encodeURIComponent(userUuid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ password: userPassword }),
  });
  const json = responseObject(payload);
  if (!response.ok || json.success !== true || !isConfig(json.config)) {
    throw new Error(apiError(json, `Failed to download AIOMetadata config: ${response.status}`));
  }
  return json.config;
}

async function installAiometadataConfig(
  host: string,
  config: Config,
  password: string,
  uuid?: string,
): Promise<SourceInstallResult> {
  const baseUrl = requireHost(host, "aiometadata");
  const sourceConfig = requireConfig(config);
  const userPassword = requireInputString(password, "AIOMetadata password");
  const userUuid = uuid === undefined ? undefined : requireInputString(uuid, "AIOMetadata UUID");
  const endpoint = userUuid ? `/api/config/update/${encodeURIComponent(userUuid)}` : "/api/config/save";
  const payload = { config: sourceConfig, password: userPassword };
  const { response, payload: responsePayload } = await fetchJson(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const json = responseObject(responsePayload);
  if (!response.ok || json.success !== true) {
    throw new Error(apiError(json, `Failed to install AIOMetadata config: ${response.status}`));
  }
  const returnUuid = userUuid || requireResponseString(json.userUUID, "AIOMetadata UUID");
  return {
    uuid: returnUuid,
    encryptedPassword: "",
    manifestUrl: `${baseUrl}/stremio/${returnUuid}/manifest.json`,
  };
}

export async function verifySourceHost(source: Source, host: string): Promise<void> {
  if (source !== "aiometadata") return;
  const baseUrl = requireHost(host, source);
  const options = await fetchResponse(
    `${baseUrl}/api/config/save`,
    { method: "OPTIONS", headers: { Accept: "application/json" } },
    PROBE_TIMEOUT_MS,
  );
  if (options.status < 200 || options.status >= 500) {
    throw new Error(`AIOMetadata config API unavailable: ${baseUrl}`);
  }

  const { response, payload } = await fetchJson(
    `${baseUrl}/api/config/load/__streamkeeper_probe__`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password: "" }),
    },
    PROBE_TIMEOUT_MS,
  );
  if (response.status < 200 || response.status >= 500) {
    throw new Error(`Host does not expose the AIOMetadata config API: ${baseUrl}`);
  }
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error(`Host does not expose the AIOMetadata config API: ${baseUrl}`);
  }
  const json = responseObject(payload);
  if (typeof json.success !== "boolean") {
    throw new Error(`Host does not expose the AIOMetadata config API: ${baseUrl}`);
  }
}

export async function verifySourceHosts(source: Source, hosts: string[]): Promise<void> {
  if (source !== "aiometadata") return;
  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        await verifySourceHost(source, host);
        return null;
      } catch (error) {
        return { host, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  const failed = results.filter((result): result is { host: string; error: string } => result !== null);
  if (failed.length)
    throw new Error(`Invalid AIOMetadata fallback host(s): ${failed.map((item) => item.host).join(", ")}`);
}

export async function downloadConfig(host: string, uuid: string, password: string): Promise<Config> {
  const baseUrl = requireHost(host, "aiostreams");
  const userUuid = requireInputString(uuid, "AIOStreams UUID");
  const userPassword = requireInputString(password, "AIOStreams password");
  const encoded = btoa(`${userUuid}:${userPassword}`);
  const { response, payload } = await fetchJson(`${baseUrl}/api/v1/user`, {
    headers: { Authorization: `Basic ${encoded}` },
    redirect: "manual",
  });
  const json = responseObject(payload);
  const data = json.data;
  if (!response.ok || json.success !== true || !isPlainRecord(data) || !isConfig(data.userData)) {
    throw new Error(apiError(json, `Failed to download config: ${response.status} ${response.statusText}`));
  }
  return data.userData;
}

async function installConfig(
  host: string,
  config: Config,
  password: string,
  uuid?: string,
): Promise<SourceInstallResult> {
  const baseUrl = requireHost(host, "aiostreams");
  const sourceConfig = requireConfig(config);
  const userPassword = requireInputString(password, "AIOStreams password");
  const userUuid = uuid === undefined ? undefined : requireInputString(uuid, "AIOStreams UUID");
  const payload: { config: Config; password: string; uuid?: string } = { config: sourceConfig, password: userPassword };
  if (userUuid !== undefined) payload.uuid = userUuid;
  const { response, payload: responsePayload } = await fetchJson(`${baseUrl}/api/v1/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const json = responseObject(responsePayload);
  if (!response.ok || json.success !== true) {
    throw new Error(apiError(json, `Server error: ${response.status}`));
  }
  const data = json.data;
  if (!isPlainRecord(data)) throw new Error("API response did not contain the expected UUID and encrypted password.");
  const returnUuid = requireResponseString(data.uuid, "AIOStreams UUID");
  const returnEncrypted = requireResponseString(data.encryptedPassword, "AIOStreams encrypted password");
  return {
    uuid: returnUuid,
    encryptedPassword: returnEncrypted,
    manifestUrl: `${baseUrl}/stremio/${returnUuid}/${returnEncrypted}/manifest.json`,
  };
}

export async function installConfigWithRetry(
  host: string,
  config: Config,
  password: string,
): Promise<SourceInstallResult> {
  // POST creates a user and has no idempotency key; retrying can silently create duplicates.
  return installConfig(host, config, password);
}

async function updateConfig(
  host: string,
  config: Config,
  password: string,
  uuid: string,
  encryptedPassword: string,
): Promise<SourceInstallResult> {
  const baseUrl = requireHost(host, "aiostreams");
  const sourceConfig = requireConfig(config);
  const userPassword = requireInputString(password, "AIOStreams password");
  const userUuid = requireInputString(uuid, "AIOStreams UUID");
  const encrypted = requireInputString(encryptedPassword, "AIOStreams encrypted password");
  const { response, payload } = await fetchJson(`${baseUrl}/api/v1/user`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${userUuid}:${userPassword}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ config: sourceConfig }),
  });
  const json = responseObject(payload);
  if (!response.ok || json.success !== true) {
    throw new Error(apiError(json, `Failed to update AIOStreams config: ${response.status}`));
  }
  return {
    uuid: userUuid,
    encryptedPassword: encrypted,
    manifestUrl: `${baseUrl}/stremio/${userUuid}/${encrypted}/manifest.json`,
  };
}

export async function updateSourceConfig(
  source: Source,
  host: string,
  config: Config,
  password: string,
  uuid: string,
  encryptedPassword: string,
): Promise<SourceInstallResult> {
  return source === "aiometadata"
    ? installAiometadataConfig(host, config, password, uuid)
    : updateConfig(host, config, password, uuid, encryptedPassword);
}

export async function downloadSourceConfig(
  source: Source,
  host: string,
  uuid: string,
  password: string,
): Promise<Config> {
  return source === "aiometadata"
    ? downloadAiometadataConfig(host, uuid, password)
    : downloadConfig(host, uuid, password);
}

export async function installSourceConfig(
  source: Source,
  host: string,
  config: Config,
  password: string,
  uuid?: string,
): Promise<SourceInstallResult> {
  return source === "aiometadata"
    ? installAiometadataConfig(host, config, password, uuid)
    : installConfigWithRetry(host, config, password);
}
