import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';

function log(level, component, message, context) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const prefix = `[${level.toUpperCase()}] [${component}]`;
  if (context) {
    console[level === "error" ? "error" : "log"](`${ts} ${prefix} ${message}`, JSON.stringify(context));
  } else {
    console[level === "error" ? "error" : "log"](`${ts} ${prefix} ${message}`);
  }
}
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST, PUT",
    "Access-Control-Allow-Headers": "*"
  };
}
function jsonError(status, message, detail) {
  return new Response(
    JSON.stringify({ error: message, ...detail ? { detail } : {} }),
    {
      status,
      headers: { "content-type": "application/json", ...corsHeaders() }
    }
  );
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 3e4, readBody = false) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
      // wire the abort signal to fetch
    });
    if (!readBody) {
      clearTimeout(id);
      return response;
    }
    // Keep the timeout armed until the body is fully received, then re-wrap.
    const buffer = await response.arrayBuffer();
    clearTimeout(id);
    return new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    clearTimeout(id);
    if (error.name === "AbortError") {
      let safeUrl = String(url);
      try {
        const parsed = new URL(safeUrl);
        safeUrl = `${parsed.origin}${parsed.pathname}`;
      } catch {}
      throw new Error(`Request timed out after ${timeoutMs}ms: ${safeUrl}`);
    }
    throw error;
  }
}
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function parseStremioPath(pathname) {
  const tokenMatch = pathname.match(/^\/stremio\/([^/]+)\/(.*)$/);
  if (tokenMatch && (tokenMatch[1].startsWith("v1-") || tokenMatch[1].startsWith("v2-"))) {
    return { prefix: "stremio", token: tokenMatch[1] };
  }
  const match = pathname.match(/\/(stremio)\/([^/]+)\/([^/]+)\//);
  if (match) {
    return { prefix: match[1], uuid: match[2], encryptedPassword: match[3] };
  }
  return null;
}
function parseManifestUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parseStremioPath(parsed.pathname);
    if (!parts) return null;
    return {
      host: `${parsed.protocol}//${parsed.host}`,
      uuid: parts.uuid,
      encPwd: parts.encryptedPassword
    };
  } catch {
    return null;
  }
}
async function gunzipBytes(bytes) {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
function brotliBytes(bytes) {
  return new Uint8Array(brotliCompressSync(bytes, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 }
  }));
}
function unbrotliBytes(bytes) {
  return new Uint8Array(brotliDecompressSync(bytes));
}
async function createStatelessToken(env, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getPasswordKey(env);
  const raw = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
  const plaintext = brotliBytes(raw);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return `v2-${base64urlEncode(packed)}`;
}
async function readStatelessToken(env, token) {
  const brotli = token.startsWith("v2-");
  if (!brotli && !token.startsWith("v1-")) return null;
  const hash = await sha256Hex(token).catch(() => null);
  if (hash && env?.AIO_KV) {
    try {
      if (await env.AIO_KV.get(`banned:${hash}`)) return null;
    } catch {}
  }
  try {
    const packed = base64urlDecode(token.slice(3));
    if (packed.length <= 12) return null;
    const key = await getPasswordKey(env);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12)));
    let plaintext = decrypted;
    try {
      plaintext = brotli ? unbrotliBytes(decrypted) : await gunzipBytes(decrypted);
    } catch {
      // Legacy v1 tokens used uncompressed JSON.
    }
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    if (payload.v !== 1 || !payload.u || !payload.e || !payload.p || !payload.h || !Array.isArray(payload.f) || !payload.c) return null;
    return payload;
  } catch {
    return null;
  }
}
function base64urlEncode(data) {
  let binary = "";
  for (let i = 0; i < data.length; i += 32768) {
    binary += String.fromCharCode(...data.subarray(i, i + 32768));
  }
  const base64 = btoa(binary);
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function normalizeUserHost(value) {
  try {
    const parsed = new URL(String(value).trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isPrivateIpv4 = /^(10|127|169\.254|192\.168)\./.test(hostname) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) || /^100\.(6[4-9]|[78]\d)\./.test(hostname);
    const isPrivateIpv6 = hostname === "::1" || /^(fc|fd|fe80):/i.test(hostname) || /^::ffff:(10|127|169\.254|192\.168)\./i.test(hostname);
    const blockedName = hostname === "localhost" || hostname.endsWith(".local") || hostname === "metadata.google.internal" || hostname === "metadata";
    if (blockedName || isPrivateIpv4 || isPrivateIpv6) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
function normalizeUserHosts(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeUserHost).filter(Boolean))];
}
async function sha256(data) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return new Uint8Array(hash);
}
async function sha256Hex(data) {
  return [...new Uint8Array(await sha256(data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function getPasswordKey(env) {
  const secret = env.PASSWORD_ENCRYPTION_KEY || env.ADMIN_PASSWORD;
  if (!secret) throw new Error("PASSWORD_ENCRYPTION_KEY is not configured");
  if (!env.PASSWORD_ENCRYPTION_KEY) {
    log("warn", "Utils", "PASSWORD_ENCRYPTION_KEY unset; deriving encryption key from ADMIN_PASSWORD");
  }
  return crypto.subtle.importKey("raw", await sha256(secret), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptAccountPassword(env, password) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getPasswordKey(env);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(password)));
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return base64urlEncode(packed);
}
async function decryptAccountPassword(env, ciphertext) {
  const packed = base64urlDecode(ciphertext);
  if (packed.length <= 12) throw new Error("Invalid encrypted account password");
  const key = await getPasswordKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
  return new TextDecoder().decode(plaintext);
}
async function hmacSHA256(message, keyBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}
async function constantTimeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
async function getSigningKey(env) {
  if (!env.ADMIN_PASSWORD) return null;
  return sha256(env.ADMIN_PASSWORD);
}
async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sigInput = `${encHeader}.${encPayload}`;
  const sig = await hmacSHA256(sigInput, secret);
  return `${encHeader}.${encPayload}.${base64urlEncode(sig)}`;
}
async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, sigB64] = parts;
    const sigInput = `${encHeader}.${encPayload}`;
    const expectedSig = await hmacSHA256(sigInput, secret);
    if (!await constantTimeEqual(expectedSig, base64urlDecode(sigB64))) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encPayload)));
    if (payload.exp && Math.floor(Date.now() / 1e3) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
async function verifyPassword(provided, expected) {
  if (!expected) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
function extractBearerToken(request) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}
async function authenticateRequest(request, env) {
  const key = await getSigningKey(env);
  if (!key) return null;
  const token = extractBearerToken(request);
  if (!token) return null;
  return verifyJWT(token, key);
}


export { log, corsHeaders, jsonError, fetchWithTimeout, shuffleArray, parseStremioPath, parseManifestUrl, normalizeUserHost, normalizeUserHosts, sha256, sha256Hex, base64urlEncode, base64urlDecode, hmacSHA256, constantTimeEqual, getSigningKey, createJWT, verifyJWT, verifyPassword, authenticateRequest, createStatelessToken, readStatelessToken, encryptAccountPassword, decryptAccountPassword };
