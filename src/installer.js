import { fetchWithTimeout } from './utils.js';

const DEFAULT_HOSTS = [
  "https://aiostreams.fortheweak.cloud",
  "https://aio.atbphosting.com",
  "https://aiostreams.12312023.xyz",
  "https://aiostreamsfortheweebsstable.midnightignite.me",
  "https://aiostreams.stremio.ru",
  "https://aiostreams.elfhosted.com",
  "https://aiostreams-stable.forthewizards.uk"
];
const AIOMETADATA_HOSTS = [
  "https://aiometadata.elfhosted.com",
  "https://aiometadata.fortheweak.cloud",
  "https://aiometadata.viren070.me",
  "https://aiometadatafortheweebs.midnightignite.me",
  "https://aiometadata.forthewizards.uk",
  "https://aiomd.atbphosting.com",
  "https://aiometadata.12312023.xyz",
  "https://aiometadatafortheweak.nhyira.dev",
  "https://aiometadata.stremio.ru"
];
function resolveHosts(env, source = "aiostreams") {
  const override = env && (source === "aiometadata" ? env.AIOMETADATA_HOSTS : env.HOSTS);
  if (!override) return source === "aiometadata" ? [...AIOMETADATA_HOSTS] : [...DEFAULT_HOSTS];
  const parsed = override.split(",").map((host) => host.trim()).filter((host) => host.length > 0);
  return parsed;
}
const HOSTS = DEFAULT_HOSTS;
var INSTALL_TIMEOUT_MS = 3e4;
async function downloadAiometadataConfig(host, uuid, password) {
  const baseUrl = host.replace(/\/$/, "");
  const response = await fetchWithTimeout(
    `${baseUrl}/api/config/load/${encodeURIComponent(uuid)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password })
    },
    INSTALL_TIMEOUT_MS,
    true
  );
  const json = await response.json();
  if (!response.ok || !json.success || !json.config) {
    throw new Error(json.error || `Failed to download AIOMetadata config: ${response.status}`);
  }
  return json.config;
}

async function installAiometadataConfig(host, config, password, uuid) {
  const baseUrl = host.replace(/\/$/, "");
  const response = await fetchWithTimeout(
    `${baseUrl}/api/config/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ config, password, ...(uuid ? { userUUID: uuid } : {}) })
    },
    INSTALL_TIMEOUT_MS,
    true
  );
  const json = await response.json();
  const returnUuid = json.userUUID;
  if (!response.ok || !json.success || !returnUuid) {
    throw new Error(json.error || `Failed to install AIOMetadata config: ${response.status}`);
  }
  return {
    uuid: returnUuid,
    encryptedPassword: "",
    manifestUrl: `${baseUrl}/stremio/${returnUuid}/manifest.json`
  };
}

function handleSmartRetryError(err, config) {
  const errorMsg = (err.message || err.toString()).toLowerCase();
  const serviceMatch = errorMsg.match(/services\.(\d+)\.id:\s*invalid option/);
  if (serviceMatch && Array.isArray(config.services)) {
    const index = Number(serviceMatch[1]);
    if (Number.isInteger(index) && index >= 0 && index < config.services.length) {
      config.services.splice(index, 1);
      return;
    }
  }
  const isTorrentioError = errorMsg.includes("torrentio");
  const isMeteorError = errorMsg.includes("meteor");
  const isMediaFusionError = errorMsg.includes("mediafusion");
  const isBitmagnetError = errorMsg.includes("bitmagnet");
  const isSeaDexError = errorMsg.includes("seadex not found");
  let presetType = "";
  if (isTorrentioError) presetType = "torrentio";
  else if (isMeteorError) presetType = "meteor";
  else if (isMediaFusionError) presetType = "mediafusion";
  else if (isBitmagnetError) presetType = "bitmagnet";
  else if (isSeaDexError) presetType = "seadex";
  const hasPreset = presetType && config.presets && config.presets.some((p) => p.type === presetType);
  if (!presetType || !hasPreset) {
    throw err;
  }
  config.presets = config.presets.filter((p) => p.type !== presetType);
}
async function downloadConfig(host, uuid, password) {
  const baseUrl = host.replace(/\/$/, "");
  const url = `${baseUrl}/api/v1/user`;
  const encoded = btoa(`${uuid}:${password}`);
  const response = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Basic ${encoded}` }, redirect: "manual" },
    INSTALL_TIMEOUT_MS,
    true
  );
  if (!response.ok) {
    throw new Error(
      `Failed to download config: ${response.status} ${response.statusText}`
    );
  }
  const json = await response.json();
  if (!json.success || !json.data?.userData) {
    throw new Error("Invalid config response from host");
  }
  return json.data.userData;
}
async function installConfig(host, config, password, uuid) {
  const baseUrl = host.replace(/\/$/, "");
  const targetUrl = `${baseUrl}/api/v1/user`;
  const payload = {
    config,
    password
  };
  if (uuid) {
    payload.uuid = uuid;
  }
  const response = await fetchWithTimeout(
    targetUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    },
    INSTALL_TIMEOUT_MS,
    true
  );
  const json = await response.json();
  if (!response.ok || json.success === false && json.error) {
    let errorMsg = `Server error: ${response.status}`;
    if (typeof json.error === "string") {
      errorMsg = json.error;
    } else if (json.error?.message) {
      errorMsg = json.error.message;
    }
    throw new Error(errorMsg);
  }
  const returnUuid = json.data && json.data.uuid;
  const returnEncrypted = json.data && json.data.encryptedPassword;
  if (!returnUuid || !returnEncrypted) {
    throw new Error(
      "API response did not contain the expected UUID and encrypted password."
    );
  }
  const manifestUrl = `${baseUrl}/stremio/${returnUuid}/${returnEncrypted}/manifest.json`;
  return { uuid: returnUuid, encryptedPassword: returnEncrypted, manifestUrl };
}
async function installConfigWithRetry(host, config, password) {
  const workingConfig = structuredClone(config);
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await installConfig(host, workingConfig, password, null);
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      handleSmartRetryError(err, workingConfig);
    }
  }
}

async function downloadSourceConfig(source, host, uuid, password) {
  return source === "aiometadata"
    ? downloadAiometadataConfig(host, uuid, password)
    : downloadConfig(host, uuid, password);
}

async function installSourceConfig(source, host, config, password, uuid) {
  return source === "aiometadata"
    ? installAiometadataConfig(host, config, password, uuid)
    : installConfigWithRetry(host, config, password);
}

export { HOSTS, AIOMETADATA_HOSTS, resolveHosts, downloadConfig, installConfigWithRetry, downloadSourceConfig, installSourceConfig };
