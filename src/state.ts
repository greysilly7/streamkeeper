import { resolveHosts } from "./installer";
import type { AccountRecord, Env, HostHealth, Source, UserState } from "./types";
import { decryptAccountPassword, encryptAccountPassword } from "./utils";

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
  return env.AIO_KV.get<AccountRecord>(`account:${uuid}`, "json");
}

export async function putAccount(env: Env, account: AccountRecord | UserState): Promise<void> {
  let record: AccountRecord = { ...account };
  delete record.cachedConfig;
  if (record.password) {
    record = { ...record, passwordCipher: await encryptAccountPassword(env, record.password) };
    delete record.password;
  }
  await env.AIO_KV.put(`account:${record.uuid}`, JSON.stringify(record));
}

export function publicAccount(account: AccountRecord): Omit<AccountRecord, "password" | "passwordCipher" | "token"> {
  const { password: _password, passwordCipher: _passwordCipher, token: _token, ...safe } = account;
  return safe;
}

export async function getAccountPassword(env: Env, account: AccountRecord | UserState): Promise<string> {
  const passwordCipher = "passwordCipher" in account ? account.passwordCipher : undefined;
  if (passwordCipher) return decryptAccountPassword(env, passwordCipher);
  if (!account.password) throw new Error("Account password is missing");
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
  await Promise.all([env.AIO_KV.delete(`account:${uuid}`), env.AIO_KV.delete(`config:${uuid}`)]);
}

export async function getHostHealth(env: Env): Promise<HostHealth> {
  return (await env.AIO_KV.get<HostHealth>("health:hosts", "json")) || {};
}

export async function putHostHealth(env: Env, health: HostHealth): Promise<void> {
  await env.AIO_KV.put("health:hosts", JSON.stringify(health), { expirationTtl: 24 * 60 * 60 });
}
