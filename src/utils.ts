import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import type {
  Config,
  Env,
  JsonData,
  JsonObject,
  JwtPayload,
  ParsedManifestUrl,
  StatelessTokenPayload,
  StremioPath,
} from "./types";
import { errorMessage, isRecord } from "./types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, component: string, message: string, context?: JsonObject): void {
  const ts = new Date().toISOString();
  const prefix = `[${level.toUpperCase()}] [${component}]`;
  const writer = level === "error" ? console.error : console.log;
  if (context) writer(`${ts} ${prefix} ${message}`, JSON.stringify(context));
  else writer(`${ts} ${prefix} ${message}`);
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST, PUT",
    "Access-Control-Allow-Headers": "*",
  };
}

export function jsonError(status: number, message: string, detail?: string): Response {
  return new Response(JSON.stringify({ error: message, ...(detail ? { detail } : {}) }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
  readBody = false,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!readBody) {
      clearTimeout(id);
      return response;
    }
    const buffer = await response.arrayBuffer();
    clearTimeout(id);
    return new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    clearTimeout(id);
    if (error instanceof DOMException && error.name === "AbortError") {
      let safeUrl = url;
      try {
        const parsed = new URL(url);
        safeUrl = `${parsed.origin}${parsed.pathname}`;
      } catch {
        // Keep the original URL when it cannot be parsed.
      }
      throw new Error(`Request timed out after ${timeoutMs}ms: ${safeUrl}`);
    }
    throw error;
  }
}

export function shuffleArray<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const left = result.at(i);
    const right = result.at(j);
    if (left === undefined || right === undefined) continue;
    [result[i], result[j]] = [right, left];
  }
  return result;
}

export function parseStremioPath(pathname: string): StremioPath | null {
  const tokenMatch = pathname.match(/^\/stremio\/([^/]+)\/(.*)$/);
  const token = tokenMatch?.[1];
  if (token && (token.startsWith("v1-") || token.startsWith("v2-"))) {
    return { prefix: "stremio", token };
  }
  const aiometadataMatch = pathname.match(/^\/stremio\/([^/]+)\/(manifest\.json|configure)\/?$/);
  const aiometadataUuid = aiometadataMatch?.[1];
  if (aiometadataUuid) {
    return { prefix: "stremio", source: "aiometadata", uuid: aiometadataUuid, encryptedPassword: "" };
  }
  const match = pathname.match(/^\/stremio\/([^/]+)\/([^/]+)\//);
  const uuid = match?.[1];
  const encryptedPassword = match?.[2];
  if (uuid && encryptedPassword) {
    return { prefix: "stremio", source: "aiostreams", uuid, encryptedPassword };
  }
  return null;
}

export function parseManifestUrl(url: string | undefined): ParsedManifestUrl | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parseStremioPath(parsed.pathname);
    if (!parts || "token" in parts || !/\/manifest\.json\/?$/.test(parsed.pathname)) return null;
    return {
      host: `${parsed.protocol}//${parsed.host}`,
      source: parts.source,
      uuid: parts.uuid,
      encPwd: parts.encryptedPassword,
    };
  } catch {
    return null;
  }
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(toArrayBuffer(bytes));
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer()) as Uint8Array;
}

function brotliBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(
    brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }),
  );
}

function unbrotliBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(brotliDecompressSync(bytes)) as Uint8Array;
}

export async function createStatelessToken(env: Env, payload: Omit<StatelessTokenPayload, "v">): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getPasswordKey(env);
  const raw = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
  const plaintext = brotliBytes(raw);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return `v2-${base64urlEncode(packed)}`;
}

function parseStatelessPayload(value: JsonData): StatelessTokenPayload | null {
  if (!isRecord(value)) return null;
  const source = value.s === "aiometadata" || value.s === "aiostreams" ? value.s : null;
  const config = value.c;
  if (
    value.v !== 1 ||
    !source ||
    typeof value.u !== "string" ||
    typeof value.p !== "string" ||
    typeof value.h !== "string" ||
    !Array.isArray(value.f) ||
    !isRecord(config)
  )
    return null;
  const hosts = value.f.filter((host): host is string => typeof host === "string");
  if (source !== "aiometadata" && typeof value.e !== "string") return null;
  if (hosts.length !== value.f.length) return null;
  return {
    v: 1,
    s: source,
    ...(typeof value.n === "string" ? { n: value.n } : {}),
    ...(typeof value.m === "string" ? { m: value.m } : {}),
    u: value.u,
    ...(typeof value.e === "string" ? { e: value.e } : {}),
    p: value.p,
    h: value.h,
    c: config as Config,
    f: hosts,
    ...(typeof value.r === "number" ? { r: value.r } : {}),
  };
}

export async function readStatelessToken(env: Env, token: string): Promise<StatelessTokenPayload | null> {
  const brotli = token.startsWith("v2-");
  if (!brotli && !token.startsWith("v1-")) return null;
  const hash = await sha256Hex(token).catch(() => null);
  if (!hash) return null;
  try {
    if (await env.AIO_KV.get(`banned:${hash}`)) return null;
  } catch {
    return null;
  }
  try {
    const packed = base64urlDecode(token.slice(3));
    if (packed.length <= 12) return null;
    const key = await getPasswordKey(env);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12)),
    );
    let plaintext: Uint8Array = decrypted as Uint8Array;
    try {
      plaintext = brotli ? unbrotliBytes(decrypted) : await gunzipBytes(decrypted);
    } catch {
      // Legacy v1 tokens used uncompressed JSON.
    }
    return parseStatelessPayload(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    return null;
  }
}

export function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 32_768) binary += String.fromCharCode(...data.subarray(i, i + 32_768));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64urlDecode(value: string): Uint8Array {
  let padded = value.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function normalizeUserHost(value: JsonData | undefined): string | null {
  try {
    const parsed = new URL(String(value).trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isPrivateIpv4 =
      /^(10|127|169\.254|192\.168)\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      /^100\.(6[4-9]|[78]\d)\./.test(hostname);
    const isPrivateIpv6 =
      hostname === "::1" || /^(fc|fd|fe80):/i.test(hostname) || /^::ffff:(10|127|169\.254|192\.168)\./i.test(hostname);
    const blockedName =
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "metadata.google.internal" ||
      hostname === "metadata";
    if (blockedName || isPrivateIpv4 || isPrivateIpv6) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function normalizeUserHosts(values: JsonData | undefined): string[] {
  return [
    ...new Set(
      (Array.isArray(values) ? values : []).map(normalizeUserHost).filter((host): host is string => host !== null),
    ),
  ];
}

export async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))) as Uint8Array;
}

export async function sha256Hex(data: string): Promise<string> {
  return [...(await sha256(data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getPasswordKey(env: Env): Promise<CryptoKey> {
  const secret = env.PASSWORD_ENCRYPTION_KEY || env.ADMIN_PASSWORD;
  if (!secret) throw new Error("PASSWORD_ENCRYPTION_KEY is not configured");
  if (!env.PASSWORD_ENCRYPTION_KEY)
    log("warn", "Utils", "PASSWORD_ENCRYPTION_KEY unset; deriving encryption key from ADMIN_PASSWORD");
  return crypto.subtle.importKey("raw", toArrayBuffer(await sha256(secret)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptAccountPassword(env: Env, password: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getPasswordKey(env);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(new TextEncoder().encode(password))),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return base64urlEncode(packed);
}

export async function decryptAccountPassword(env: Env, ciphertext: string): Promise<string> {
  const packed = base64urlDecode(ciphertext);
  if (packed.length <= 12) throw new Error("Invalid encrypted account password");
  const key = await getPasswordKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(packed.slice(0, 12)) },
    key,
    toArrayBuffer(packed.slice(12)),
  );
  return new TextDecoder().decode(plaintext);
}

async function hmacSHA256(message: string, keyBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function constantTimeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

export async function getSigningKey(env: Env): Promise<Uint8Array | null> {
  return env.ADMIN_PASSWORD ? sha256(env.ADMIN_PASSWORD) : null;
}

export async function createJWT(payload: JwtPayload, secret: Uint8Array): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSHA256(`${encHeader}.${encPayload}`, secret);
  return `${encHeader}.${encPayload}.${base64urlEncode(sig)}`;
}

export async function verifyJWT(token: string, secret: Uint8Array): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, sigB64] = parts;
    if (!encHeader || !encPayload || !sigB64) return null;
    const expectedSig = await hmacSHA256(`${encHeader}.${encPayload}`, secret);
    if (!(await constantTimeEqual(expectedSig, base64urlDecode(sigB64)))) return null;
    const payload: JsonData = JSON.parse(new TextDecoder().decode(base64urlDecode(encPayload)));
    if (!isRecord(payload)) return null;
    if (typeof payload.exp === "number" && Math.floor(Date.now() / 1e3) > payload.exp) return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

export async function verifyPassword(provided: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  return constantTimeEqual(new TextEncoder().encode(provided), new TextEncoder().encode(expected));
}

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function authenticateRequest(request: Request, env: Env): Promise<JwtPayload | null> {
  const key = await getSigningKey(env);
  const token = extractBearerToken(request);
  return key && token ? verifyJWT(token, key) : null;
}

export { errorMessage };
