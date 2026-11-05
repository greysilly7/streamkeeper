import type { Config, Env, JsonData, PresetConfig, Source, SourceInstallResult } from "./types";
import { isRecord } from "./types";
import { fetchWithTimeout, normalizeUserHost } from "./utils";

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

interface UserApiResponse {
  success?: boolean;
  error?: string | { message?: string };
  data?: {
    uuid?: string;
    encryptedPassword?: string;
    userData?: Config;
  };
}

interface AiometadataApiResponse {
  success?: boolean;
  error?: string;
  config?: Config;
  userUUID?: string;
}

function sourceApiResponse(value: JsonData): UserApiResponse | AiometadataApiResponse {
  if (!isRecord(value)) throw new Error("Invalid JSON response from source host");
  return value as UserApiResponse | AiometadataApiResponse;
}

async function readJson(response: Response): Promise<UserApiResponse | AiometadataApiResponse> {
  return sourceApiResponse(await response.json());
}

function apiError(error: string | { message?: string } | undefined, fallback: string): string {
  return typeof error === "string" ? error : error?.message || fallback;
}

export function resolveHosts(env: Env | undefined, source: Source = "aiostreams"): string[] {
  const override = env?.[source === "aiometadata" ? "AIOMETADATA_HOSTS" : "HOSTS"];
  const hosts = override ? override.split(",") : source === "aiometadata" ? DEFAULT_AIOMETADATA_HOSTS : DEFAULT_HOSTS;
  return [...new Set(hosts.map(normalizeUserHost).filter((host): host is string => host !== null))];
}

export const HOSTS = DEFAULT_HOSTS;
export const AIOMETADATA_HOSTS = DEFAULT_AIOMETADATA_HOSTS;

async function downloadAiometadataConfig(host: string, uuid: string, password: string): Promise<Config> {
  const baseUrl = host.replace(/\/$/, "");
  const response = await fetchWithTimeout(
    `${baseUrl}/api/config/load/${encodeURIComponent(uuid)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password }),
    },
    INSTALL_TIMEOUT_MS,
    true,
  );
  const json = (await readJson(response)) as AiometadataApiResponse;
  if (!response.ok || !json.success || !json.config)
    throw new Error(apiError(json.error, `Failed to download AIOMetadata config: ${response.status}`));
  return json.config;
}

async function installAiometadataConfig(
  host: string,
  config: Config,
  password: string,
  uuid?: string,
): Promise<SourceInstallResult> {
  const baseUrl = host.replace(/\/$/, "");
  const response = await fetchWithTimeout(
    `${baseUrl}/api/config/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ config, password, ...(uuid ? { userUUID: uuid } : {}) }),
    },
    INSTALL_TIMEOUT_MS,
    true,
  );
  const json = (await readJson(response)) as AiometadataApiResponse;
  if (!response.ok || !json.success || !json.userUUID)
    throw new Error(apiError(json.error, `Failed to install AIOMetadata config: ${response.status}`));
  return {
    uuid: json.userUUID,
    encryptedPassword: "",
    manifestUrl: `${baseUrl}/stremio/${json.userUUID}/manifest.json`,
  };
}

export async function verifySourceHost(source: Source, host: string): Promise<void> {
  if (source !== "aiometadata") return;
  const baseUrl = normalizeUserHost(host);
  if (!baseUrl) throw new Error(`Invalid ${source} host`);
  const options = await fetchWithTimeout(
    `${baseUrl}/api/config/save`,
    { method: "OPTIONS", headers: { Accept: "application/json" } },
    Math.min(INSTALL_TIMEOUT_MS, 5_000),
    true,
  );
  if (options.status >= 500) throw new Error(`AIOMetadata config API unavailable: ${baseUrl}`);
  const response = await fetchWithTimeout(
    `${baseUrl}/api/config/load/__streamkeeper_probe__`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password: "" }),
    },
    Math.min(INSTALL_TIMEOUT_MS, 5_000),
    true,
  );
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error(`Host does not expose the AIOMetadata config API: ${baseUrl}`);
  }
  let payload: JsonData;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Host does not expose the AIOMetadata config API: ${baseUrl}`);
  }
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
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

function handleSmartRetryError(error: Error | string, config: Config): void {
  const errorMsg = error instanceof Error ? error.message.toLowerCase() : error.toLowerCase();
  const serviceMatch = errorMsg.match(/services\.(\d+)\.id:\s*invalid option/);
  if (serviceMatch && Array.isArray(config.services)) {
    const index = Number(serviceMatch[1]);
    if (Number.isInteger(index) && index >= 0 && index < config.services.length) {
      config.services.splice(index, 1);
      return;
    }
  }
  const presetType = ["torrentio", "meteor", "mediafusion", "bitmagnet", "seadex"].find((type) =>
    errorMsg.includes(type === "seadex" ? "seadex not found" : type),
  );
  const presets = config.presets;
  const hasPreset =
    presetType && Array.isArray(presets) && presets.some((preset: PresetConfig) => preset.type === presetType);
  if (!presetType || !hasPreset || !presets) throw error;
  config.presets = presets.filter((preset: PresetConfig) => preset.type !== presetType);
}

export async function downloadConfig(host: string, uuid: string, password: string): Promise<Config> {
  const baseUrl = host.replace(/\/$/, "");
  const encoded = btoa(`${uuid}:${password}`);
  const response = await fetchWithTimeout(
    `${baseUrl}/api/v1/user`,
    { headers: { Authorization: `Basic ${encoded}` }, redirect: "manual" },
    INSTALL_TIMEOUT_MS,
    true,
  );
  if (!response.ok) throw new Error(`Failed to download config: ${response.status} ${response.statusText}`);
  const json = (await readJson(response)) as UserApiResponse;
  if (!json.success || !json.data?.userData) throw new Error("Invalid config response from host");
  return json.data.userData;
}

async function installConfig(
  host: string,
  config: Config,
  password: string,
  uuid?: string,
): Promise<SourceInstallResult> {
  const baseUrl = host.replace(/\/$/, "");
  const payload: { config: Config; password: string; uuid?: string } = { config, password };
  if (uuid) payload.uuid = uuid;
  const response = await fetchWithTimeout(
    `${baseUrl}/api/v1/user`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    },
    INSTALL_TIMEOUT_MS,
    true,
  );
  const json = (await readJson(response)) as UserApiResponse;
  if (!response.ok || (json.success === false && json.error))
    throw new Error(apiError(json.error, `Server error: ${response.status}`));
  const returnUuid = json.data?.uuid;
  const returnEncrypted = json.data?.encryptedPassword;
  if (!returnUuid || !returnEncrypted)
    throw new Error("API response did not contain the expected UUID and encrypted password.");
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
  const workingConfig: Config = structuredClone(config);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await installConfig(host, workingConfig, password);
    } catch (error) {
      if (attempt >= 4) throw error;
      handleSmartRetryError(error instanceof Error ? error : String(error), workingConfig);
    }
  }
  throw new Error("Unreachable install retry state");
}

async function updateConfig(
  host: string,
  config: Config,
  password: string,
  uuid: string,
  encryptedPassword: string,
): Promise<SourceInstallResult> {
  const baseUrl = host.replace(/\/$/, "");
  const response = await fetchWithTimeout(
    `${baseUrl}/api/v1/user`,
    {
      method: "PUT",
      headers: {
        Authorization: `Basic ${btoa(`${uuid}:${password}`)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ config }),
    },
    INSTALL_TIMEOUT_MS,
    true,
  );
  const json = (await readJson(response)) as UserApiResponse;
  if (!response.ok || json.success === false)
    throw new Error(apiError(json.error, `Failed to update AIOStreams config: ${response.status}`));
  return { uuid, encryptedPassword, manifestUrl: `${baseUrl}/stremio/${uuid}/${encryptedPassword}/manifest.json` };
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
