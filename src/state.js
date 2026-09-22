import { resolveHosts } from './installer.js';
import { encryptAccountPassword, decryptAccountPassword } from './utils.js';

function getDefaultUserState(env) {
  return {
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
    enabledFallbackHosts: resolveHosts(env),
    failoverCount: 0,
    lastFailoverAt: null,
    lastFailoverHost: null,
    createdAt: null
  };
}
async function getUserState(env, uuid) {
  const rec = await getAccount(env, uuid);
  if (!rec || !rec.preferredHost) return null;
  return rec;
}
async function getAccount(env, uuid) {
  const raw = await env.AIO_KV.get(`account:${uuid}`, "json");
  return raw || null;
}
async function putAccount(env, account) {
  let record = account;
  // Configs embed third-party API keys; never store them at rest in KV.
  // The sealed config lives only in user-held stateless tokens.
  delete record.cachedConfig;
  if (record.password) {
    record = { ...record, passwordCipher: await encryptAccountPassword(env, record.password) };
    delete record.password;
  }
  await env.AIO_KV.put(`account:${record.uuid}`, JSON.stringify(record));
}
function publicAccount(account) {
  const safe = { ...account };
  delete safe.password;
  delete safe.passwordCipher;
  delete safe.token;
  return safe;
}
async function getAccountPassword(env, account) {
  if (account.passwordCipher) return decryptAccountPassword(env, account.passwordCipher);
  if (!account.password) throw new Error("Account password is missing");
  const passwordCipher = await encryptAccountPassword(env, account.password);
  const migrated = { ...account, passwordCipher };
  delete migrated.password;
  await putAccount(env, migrated);
  return account.password;
}
async function listAccounts(env) {
  const keys = await env.AIO_KV.list({ prefix: "account:" });
  const accounts = [];
  for (const key of keys.keys) {
    const account = await getAccount(env, key.name.replace("account:", ""));
    if (account) accounts.push(account);
  }
  return accounts;
}
async function deleteAccount(env, uuid) {
  await Promise.all([
    env.AIO_KV.delete(`account:${uuid}`),
    env.AIO_KV.delete(`config:${uuid}`)
  ]);
}
async function getHostHealth(env) {
  return await env.AIO_KV.get("health:hosts", "json") || {};
}
async function putHostHealth(env, health) {
  await env.AIO_KV.put("health:hosts", JSON.stringify(health), { expirationTtl: 24 * 60 * 60 });
}

export { getDefaultUserState, getUserState, getAccount, putAccount, publicAccount, getAccountPassword, listAccounts, deleteAccount, getHostHealth, putHostHealth };


