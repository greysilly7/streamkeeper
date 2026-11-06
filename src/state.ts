import { resolveHosts } from "./installer";
import type { AccountRecord, Env, HostHealth, HostHealthEntry, JsonData, JsonObject, Source, UserState } from "./types";
import {
  decryptAccountPassword,
  encryptAccountPassword,
  isValidConfig,
  normalizeUserHost,
  revokeStatelessToken,
} from "./utils";

function isPlainRecord(value: JsonData | undefined | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: JsonData | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validHost(value: JsonData | undefined): value is string {
  return typeof value === "string" && normalizeUserHost(value) === value;
}

function validHostList(value: JsonData | undefined): value is string[] {
  return Array.isArray(value) && value.every((host) => validHost(host));
}

function parseAccount(value: JsonData | null): AccountRecord | null {
  if (!isPlainRecord(value) || typeof value.uuid !== "string" || value.uuid.length === 0) return null;
  if (value.source !== undefined && value.source !== "aiostreams" && value.source !== "aiometadata") return null;
  if (
    (value.nickname !== undefined && typeof value.nickname !== "string") ||
    (value.token !== undefined && typeof value.token !== "string") ||
    (value.manifestUrl !== undefined && typeof value.manifestUrl !== "string") ||
    (value.installUrl !== undefined && typeof value.installUrl !== "string") ||
    (value.manageUrl !== undefined && typeof value.manageUrl !== "string") ||
    (value.password !== undefined && (typeof value.password !== "string" || value.password.length === 0)) ||
    (value.passwordCipher !== undefined &&
      (typeof value.passwordCipher !== "string" || value.passwordCipher.length === 0)) ||
    (value.password !== undefined && value.passwordCipher !== undefined) ||
    (value.preferredHost !== undefined && !validHost(value.preferredHost)) ||
    (value.currentHost !== undefined && !validHost(value.currentHost)) ||
    (value.currentUuid !== undefined && typeof value.currentUuid !== "string") ||
    (value.currentEncPwd !== undefined && typeof value.currentEncPwd !== "string") ||
    (value.encryptedPassword !== undefined && typeof value.encryptedPassword !== "string") ||
    (value.installationKey !== undefined && typeof value.installationKey !== "string") ||
    (value.validatedHost !== undefined && !validHost(value.validatedHost)) ||
    (value.validatedUuid !== undefined && typeof value.validatedUuid !== "string") ||
    (value.validatedEncPwd !== undefined && typeof value.validatedEncPwd !== "string") ||
    (value.enabledFallbackHosts !== undefined && !validHostList(value.enabledFallbackHosts)) ||
    (value.cachedConfig !== undefined && !isValidConfig(value.cachedConfig)) ||
    (value.preferredCooldownMs !== undefined && !finiteNumber(value.preferredCooldownMs)) ||
    (value.lastPreferredCheck !== undefined && !finiteNumber(value.lastPreferredCheck)) ||
    (value.lastConfigRefresh !== undefined && !finiteNumber(value.lastConfigRefresh)) ||
    (value.lastCurrentValidationAt !== undefined && !finiteNumber(value.lastCurrentValidationAt)) ||
    (value.cacheRefreshHours !== undefined && !finiteNumber(value.cacheRefreshHours)) ||
    (value.failoverCount !== undefined && !finiteNumber(value.failoverCount)) ||
    (value.lastFailoverAt !== undefined && value.lastFailoverAt !== null && !finiteNumber(value.lastFailoverAt)) ||
    (value.lastFailoverHost !== undefined && value.lastFailoverHost !== null && !validHost(value.lastFailoverHost)) ||
    (value.createdAt !== undefined && value.createdAt !== null && !finiteNumber(value.createdAt))
  )
    return null;
  const account: AccountRecord = { uuid: value.uuid };
  if (typeof value.nickname === "string") account.nickname = value.nickname;
  if (value.source === "aiostreams" || value.source === "aiometadata") account.source = value.source;
  if (typeof value.token === "string") account.token = value.token;
  if (typeof value.manifestUrl === "string") account.manifestUrl = value.manifestUrl;
  if (typeof value.preferredHost === "string") account.preferredHost = value.preferredHost;
  if (typeof value.currentHost === "string") account.currentHost = value.currentHost;
  if (typeof value.currentUuid === "string") account.currentUuid = value.currentUuid;
  if (typeof value.currentEncPwd === "string") account.currentEncPwd = value.currentEncPwd;
  if (typeof value.encryptedPassword === "string") account.encryptedPassword = value.encryptedPassword;
  if (typeof value.preferredCooldownMs === "number") account.preferredCooldownMs = value.preferredCooldownMs;
  if (typeof value.lastPreferredCheck === "number") account.lastPreferredCheck = value.lastPreferredCheck;
  if (typeof value.lastConfigRefresh === "number") account.lastConfigRefresh = value.lastConfigRefresh;
  if (typeof value.lastCurrentValidationAt === "number")
    account.lastCurrentValidationAt = value.lastCurrentValidationAt;
  if (typeof value.validatedHost === "string") account.validatedHost = value.validatedHost;
  if (typeof value.validatedUuid === "string") account.validatedUuid = value.validatedUuid;
  if (typeof value.validatedEncPwd === "string") account.validatedEncPwd = value.validatedEncPwd;
  if (typeof value.installationKey === "string") account.installationKey = value.installationKey;
  if (isValidConfig(value.cachedConfig)) account.cachedConfig = value.cachedConfig;
  if (typeof value.installUrl === "string") account.installUrl = value.installUrl;
  if (typeof value.manageUrl === "string") account.manageUrl = value.manageUrl;
  if (typeof value.password === "string") account.password = value.password;
  if (typeof value.passwordCipher === "string") account.passwordCipher = value.passwordCipher;
  if (validHostList(value.enabledFallbackHosts)) account.enabledFallbackHosts = [...value.enabledFallbackHosts];
  if (typeof value.cacheRefreshHours === "number") account.cacheRefreshHours = value.cacheRefreshHours;
  if (typeof value.failoverCount === "number") account.failoverCount = value.failoverCount;
  if (value.lastFailoverAt === null || typeof value.lastFailoverAt === "number")
    account.lastFailoverAt = value.lastFailoverAt;
  if (value.lastFailoverHost === null || typeof value.lastFailoverHost === "string")
    account.lastFailoverHost = value.lastFailoverHost;
  if (value.createdAt === null || typeof value.createdAt === "number") account.createdAt = value.createdAt;
  return account;
}

function parseHostHealth(value: JsonData | null): HostHealth {
  if (!isPlainRecord(value)) return {};
  const health: HostHealth = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainRecord(entry)) continue;
    const status = entry.status === "healthy" || entry.status === "unhealthy" ? entry.status : null;
    const checkedAt = finiteNumber(entry.checkedAt) ? entry.checkedAt : null;
    const consecutiveFailures = finiteNumber(entry.consecutiveFailures) ? entry.consecutiveFailures : null;
    if (
      !status ||
      checkedAt === null ||
      consecutiveFailures === null ||
      (entry.latencyMs !== undefined && !finiteNumber(entry.latencyMs)) ||
      (entry.source !== undefined && entry.source !== "aiostreams" && entry.source !== "aiometadata") ||
      (entry.host !== undefined && !validHost(entry.host))
    )
      continue;
    const parsed: HostHealthEntry = {
      status,
      checkedAt,
      consecutiveFailures,
      ...(typeof entry.latencyMs === "number" ? { latencyMs: entry.latencyMs } : {}),
      ...(entry.source === "aiostreams" || entry.source === "aiometadata" ? { source: entry.source } : {}),
      ...(typeof entry.host === "string" ? { host: entry.host } : {}),
    };
    health[key] = parsed;
  }
  return health;
}

export function getDefaultUserState(env: Env, source: Source = "aiostreams"): UserState {
  return {
    source,
    uuid: "",
    encryptedPassword: "",
    password: "",
    preferredHost: "",
    currentHost: "",
    currentUuid: "",
    currentEncPwd: "",
    preferredCooldownMs: 30 * 60 * 1e3,
    lastPreferredCheck: 0,
    lastConfigRefresh: 0,
    cacheRefreshHours: 48,
    enabledFallbackHosts: resolveHosts(env, source),
    failoverCount: 0,
    lastFailoverAt: null,
    lastFailoverHost: null,
    createdAt: null,
  };
}

export async function getUserState(env: Env, uuid: string): Promise<UserState | null> {
  const record = await getAccount(env, uuid);
  if (!record?.preferredHost) return null;
  const defaults = getDefaultUserState(env, record.source || "aiostreams");
  return {
    ...defaults,
    ...record,
    source: record.source || defaults.source,
    uuid: record.uuid,
    encryptedPassword: record.encryptedPassword || "",
    password: record.password || "",
    preferredHost: record.preferredHost,
    currentHost: record.currentHost || record.preferredHost,
    currentUuid: record.currentUuid || record.uuid,
    currentEncPwd: record.currentEncPwd || record.encryptedPassword || "",
    preferredCooldownMs: record.preferredCooldownMs ?? defaults.preferredCooldownMs,
    lastPreferredCheck: record.lastPreferredCheck ?? defaults.lastPreferredCheck,
    lastConfigRefresh: record.lastConfigRefresh ?? defaults.lastConfigRefresh,
    cacheRefreshHours: record.cacheRefreshHours ?? defaults.cacheRefreshHours,
    enabledFallbackHosts: record.enabledFallbackHosts || defaults.enabledFallbackHosts,
    failoverCount: record.failoverCount ?? defaults.failoverCount,
    lastFailoverAt: record.lastFailoverAt ?? defaults.lastFailoverAt,
    lastFailoverHost: record.lastFailoverHost ?? defaults.lastFailoverHost,
    createdAt: record.createdAt ?? defaults.createdAt,
  };
}

export async function getAccount(env: Env, uuid: string): Promise<AccountRecord | null> {
  const value = await env.AIO_KV.get<JsonData>(`account:${uuid}`, "json");
  return parseAccount(value);
}

export async function putAccount(env: Env, account: AccountRecord | UserState): Promise<void> {
  let record: AccountRecord = { ...account };
  if (record.cachedConfig !== undefined && !isValidConfig(record.cachedConfig)) delete record.cachedConfig;
  if (typeof record.password === "string" && record.password.length > 0) {
    record = { ...record, passwordCipher: await encryptAccountPassword(env, record.password) };
  }
  delete record.password;
  await env.AIO_KV.put(`account:${record.uuid}`, JSON.stringify(record));
}

type PublicAccount = Pick<
  AccountRecord,
  | "uuid"
  | "nickname"
  | "source"
  | "preferredHost"
  | "currentHost"
  | "installUrl"
  | "manageUrl"
  | "preferredCooldownMs"
  | "cacheRefreshHours"
  | "failoverCount"
  | "lastFailoverAt"
  | "lastFailoverHost"
  | "createdAt"
>;

export function publicAccount(account: AccountRecord): PublicAccount {
  return {
    uuid: account.uuid,
    ...(typeof account.nickname === "string" ? { nickname: account.nickname } : {}),
    ...(account.source ? { source: account.source } : {}),
    ...(typeof account.preferredHost === "string" ? { preferredHost: account.preferredHost } : {}),
    ...(typeof account.currentHost === "string" ? { currentHost: account.currentHost } : {}),
    ...(typeof account.installUrl === "string" ? { installUrl: account.installUrl } : {}),
    ...(typeof account.manageUrl === "string" ? { manageUrl: account.manageUrl } : {}),
    ...(typeof account.preferredCooldownMs === "number" ? { preferredCooldownMs: account.preferredCooldownMs } : {}),
    ...(typeof account.cacheRefreshHours === "number" ? { cacheRefreshHours: account.cacheRefreshHours } : {}),
    ...(typeof account.failoverCount === "number" ? { failoverCount: account.failoverCount } : {}),
    ...(account.lastFailoverAt !== undefined ? { lastFailoverAt: account.lastFailoverAt } : {}),
    ...(account.lastFailoverHost !== undefined ? { lastFailoverHost: account.lastFailoverHost } : {}),
    ...(account.createdAt !== undefined ? { createdAt: account.createdAt } : {}),
  };
}

export async function getAccountPassword(env: Env, account: AccountRecord | UserState): Promise<string> {
  const passwordCipher = "passwordCipher" in account ? account.passwordCipher : undefined;
  if (typeof passwordCipher === "string" && passwordCipher.length > 0) {
    return decryptAccountPassword(env, passwordCipher);
  }
  if (typeof account.password !== "string" || account.password.length === 0) {
    throw new Error("Account password is missing");
  }
  const encrypted = await encryptAccountPassword(env, account.password);
  const migrated: AccountRecord = { ...account, passwordCipher: encrypted };
  delete migrated.password;
  await putAccount(env, migrated);
  return account.password;
}

export async function listAccounts(env: Env): Promise<AccountRecord[]> {
  const keys = await env.AIO_KV.list({ prefix: "account:" });
  const accounts: AccountRecord[] = [];
  for (const key of keys.keys) {
    const account = await getAccount(env, key.name.replace("account:", ""));
    if (account) accounts.push(account);
  }
  return accounts;
}

export async function deleteAccount(env: Env, uuid: string): Promise<void> {
  const account = await getAccount(env, uuid);
  if (account?.token) {
    await revokeStatelessToken(env, account.token);
  } else {
    await env.AIO_KV.put(`banned:${uuid}`, "1", { expirationTtl: 30 * 24 * 60 * 60 });
  }
  await Promise.all([
    env.AIO_KV.delete(`account:${uuid}`),
    env.AIO_KV.delete(`config:${uuid}`),
    env.AIO_KV.delete(`st:${uuid}`),
  ]);
}

export async function getHostHealth(env: Env): Promise<HostHealth> {
  const value = await env.AIO_KV.get<JsonData>("health:hosts", "json");
  return parseHostHealth(value);
}

export async function putHostHealth(env: Env, health: HostHealth): Promise<void> {
  await env.AIO_KV.put(`health:hosts`, JSON.stringify(health), { expirationTtl: 24 * 60 * 60 });
}
