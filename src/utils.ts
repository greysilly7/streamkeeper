import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import type {
  Config,
  Env,
  JsonData,
  JsonObject,
  JsonValue,
  JwtPayload,
  ParsedManifestUrl,
  StatelessTokenPayload,
  StremioPath,
} from "./types";

const DEFAULT_STATELESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_CLOCK_SKEW_SECONDS = 60;
export const MAX_FETCH_RESPONSE_BYTES = 2 * 1024 * 1024;

type StatelessTokenInput = Omit<StatelessTokenPayload, "v"> & {
  iat?: number;
  exp?: number;
  l?: string;
};

interface ValidatedStatelessTokenPayload extends StatelessTokenPayload {
  iat?: number;
  exp?: number;
  l?: string;
}

export class ResponseTooLargeError extends Error {
  public constructor(public readonly maxBytes: number) {
    super(`Upstream response exceeds the ${maxBytes}-byte limit`);
    this.name = "ResponseTooLargeError";
  }
}

function isPlainRecord(value: JsonData | undefined | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: JsonData | undefined): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return true;
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item));
}

function parseJsonData(text: string): JsonData | null {
  try {
    const value = JSON.parse(text) as JsonData;
    return isJsonValue(value) ? value : null;
  } catch {
    return null;
  }
}

function isFiniteTimestamp(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidConfig(value: JsonData | undefined): value is Config {
  if (!isPlainRecord(value)) return false;
  const services = value.services;
  if (
    services !== undefined &&
    (!Array.isArray(services) ||
      !services.every(
        (service): service is JsonObject =>
          isPlainRecord(service) && (service.id === undefined || typeof service.id === "string"),
      ))
  )
    return false;
  const presets = value.presets;
  if (
    presets !== undefined &&
    (!Array.isArray(presets) ||
      !presets.every(
        (preset): preset is JsonObject =>
          isPlainRecord(preset) && (preset.type === undefined || typeof preset.type === "string"),
      ))
  )
    return false;
  return true;
}

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

export async function readResponseBody(response: Response): Promise<ArrayBuffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FETCH_RESPONSE_BYTES) {
    throw new ResponseTooLargeError(MAX_FETCH_RESPONSE_BYTES);
  }
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > MAX_FETCH_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the typed size-limit error if the upstream stream refuses cancellation.
        }
        throw new ResponseTooLargeError(MAX_FETCH_RESPONSE_BYTES);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
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
    const buffer = await readResponseBody(response);
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
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function brotliBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(
    brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }),
  );
}

function unbrotliBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(brotliDecompressSync(bytes));
}

export async function createStatelessToken(env: Env, payload: StatelessTokenInput): Promise<string> {
  const now = Math.floor(Date.now() / 1e3);
  const iat = isFiniteTimestamp(payload.iat) ? Math.floor(payload.iat) : now;
  const exp = isFiniteTimestamp(payload.exp) ? Math.floor(payload.exp) : iat + DEFAULT_STATELESS_TOKEN_TTL_SECONDS;
  if (exp <= iat) throw new Error("Stateless token expiry must be after its issued-at time");
  const lineage = typeof payload.l === "string" && payload.l.length > 0 ? payload.l : crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(lineage)) throw new Error("Invalid stateless token lineage");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getPasswordKey(env);
  const raw = new TextEncoder().encode(JSON.stringify({ ...payload, v: 1, iat, exp, l: lineage }));
  const plaintext = brotliBytes(raw);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return `v2-${base64urlEncode(packed)}`;
}

function parseStatelessPayload(value: JsonData): ValidatedStatelessTokenPayload | null {
  if (!isPlainRecord(value)) return null;
  const source = value.s === "aiometadata" || value.s === "aiostreams" ? value.s : null;
  const config = isValidConfig(value.c) ? value.c : null;
  const hosts = Array.isArray(value.f)
    ? value.f.filter((host): host is string => typeof host === "string" && normalizeUserHost(host) === host)
    : [];
  const preferredHost = typeof value.h === "string" ? normalizeUserHost(value.h) : null;
  const iat = value.iat;
  const exp = value.exp;
  const lineage = value.l;
  const now = Math.floor(Date.now() / 1e3);
  if (
    value.v !== 1 ||
    !source ||
    typeof value.u !== "string" ||
    value.u.length === 0 ||
    typeof value.p !== "string" ||
    typeof value.h !== "string" ||
    preferredHost !== value.h ||
    !Array.isArray(value.f) ||
    hosts.length !== value.f.length ||
    !config ||
    (source !== "aiometadata" && typeof value.e !== "string") ||
    (iat !== undefined && !isFiniteTimestamp(iat)) ||
    (exp !== undefined && !isFiniteTimestamp(exp)) ||
    (iat !== undefined && iat > now + TOKEN_CLOCK_SKEW_SECONDS) ||
    (exp !== undefined && exp <= now) ||
    (iat !== undefined && exp !== undefined && exp <= iat) ||
    (lineage !== undefined && (typeof lineage !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(lineage)))
  )
    return null;
  return {
    v: 1,
    s: source,
    ...(typeof value.n === "string" ? { n: value.n } : {}),
    ...(typeof value.m === "string" ? { m: value.m } : {}),
    u: value.u,
    ...(typeof value.e === "string" ? { e: value.e } : {}),
    p: value.p,
    h: value.h,
    c: config,
    f: hosts,
    ...(typeof value.r === "number" && Number.isFinite(value.r) ? { r: value.r } : {}),
    ...(typeof value.iat === "number" ? { iat: Math.floor(value.iat) } : {}),
    ...(typeof value.exp === "number" ? { exp: Math.floor(value.exp) } : {}),
    ...(typeof lineage === "string" ? { l: lineage } : {}),
  };
}

async function isRevoked(env: Env, key: string): Promise<boolean> {
  try {
    return (await env.AIO_KV.get(key)) !== null;
  } catch {
    return true;
  }
}

export async function revokeStatelessToken(env: Env, token: string, expiresAt?: number): Promise<void> {
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1e3);
  const target =
    typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : now + DEFAULT_STATELESS_TOKEN_TTL_SECONDS;
  const expirationTtl = Math.max(60, Math.ceil(target - now));
  await env.AIO_KV.put(`banned:${hash}`, "1", { expirationTtl });
}

export async function revokeTokenLineage(env: Env, lineage: string, expiresAt?: number): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(lineage)) throw new Error("Invalid token lineage");
  const now = Math.floor(Date.now() / 1e3);
  const target =
    typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : now + DEFAULT_STATELESS_TOKEN_TTL_SECONDS;
  const expirationTtl = Math.max(60, Math.ceil(target - now));
  await env.AIO_KV.put(`banned-lineage:${lineage}`, "1", { expirationTtl });
}

export async function readStatelessToken(env: Env, token: string): Promise<ValidatedStatelessTokenPayload | null> {
  const brotli = token.startsWith("v2-");
  if (!brotli && !token.startsWith("v1-")) return null;
  const hash = await sha256Hex(token).catch(() => null);
  if (!hash || (await isRevoked(env, `banned:${hash}`))) return null;
  try {
    const packed = base64urlDecode(token.slice(3));
    if (packed.length <= 12) return null;
    const key = await getPasswordKey(env);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12)),
    );
    let plaintext: Uint8Array = decrypted;
    try {
      plaintext = brotli ? unbrotliBytes(decrypted) : await gunzipBytes(decrypted);
    } catch {
      // Legacy v1 tokens used uncompressed JSON.
    }
    const parsedJson = parseJsonData(new TextDecoder().decode(plaintext));
    if (!parsedJson) return null;
    const payload = parseStatelessPayload(parsedJson);
    if (!payload || (payload.l && (await isRevoked(env, `banned-lineage:${payload.l}`)))) return null;
    return payload;
  } catch {
    return null;
  }
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function base64urlDecode(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url value");
  }
  let padded = value.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  const third = octets[2] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6(hostname: string): number[] | null {
  if (!hostname.includes(":") || hostname.includes("%")) return null;
  const halves = hostname.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const parts = half.split(":");
    const values: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const octets = part.split(".");
        if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return null;
        const parsed = octets.map(Number);
        values.push(((parsed[0] ?? 0) << 8) | (parsed[1] ?? 0), ((parsed[2] ?? 0) << 8) | (parsed[3] ?? 0));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
        values.push(Number.parseInt(part, 16));
      }
    }
    return values;
  };
  const left = parseHalf(halves[0] || "");
  const right = parseHalf(halves.length === 2 ? halves[1] || "" : "");
  if (
    !left ||
    !right ||
    (halves.length === 1 && left.length !== 8) ||
    (halves.length === 2 && left.length + right.length >= 8)
  )
    return null;
  const values = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
  return values.length === 8 ? values : null;
}

function isPrivateIpv6(hostname: string): boolean {
  const values = parseIpv6(hostname);
  if (!values) return false;
  const first = values[0] || 0;
  const isMapped = values.slice(0, 5).every((value) => value === 0) && values[5] === 0xffff;
  const mappedFirst = values[6] ? values[6] >> 8 : 0;
  const mappedSecond = values[6] ? values[6] & 0xff : 0;
  const mappedThird = values[7] ? values[7] >> 8 : 0;
  const mappedFourth = values[7] ? values[7] & 0xff : 0;
  return (
    values.every((value) => value === 0) ||
    (values.slice(0, 7).every((value) => value === 0) && values[7] === 1) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (isMapped && isPrivateIpv4(`${mappedFirst}.${mappedSecond}.${mappedThird}.${mappedFourth}`))
  );
}

export function normalizeUserHost(value: JsonData | undefined): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const hostnameWithoutDot = hostname.replace(/\.$/, "");
    const blockedName =
      hostnameWithoutDot === "localhost" ||
      hostnameWithoutDot.endsWith(".localhost") ||
      hostnameWithoutDot.endsWith(".local") ||
      hostnameWithoutDot === "metadata.google.internal" ||
      hostnameWithoutDot === "metadata";
    if (blockedName || isPrivateIpv4(hostnameWithoutDot) || isPrivateIpv6(hostnameWithoutDot)) return null;
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
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
}

export async function sha256Hex(data: string): Promise<string> {
  return [...(await sha256(data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getPasswordKey(env: Env): Promise<CryptoKey> {
  const secret = env.PASSWORD_ENCRYPTION_KEY;
  if (!secret) throw new Error("PASSWORD_ENCRYPTION_KEY is not configured");
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
  const signedPayload = {
    ...payload,
    jti: crypto.randomUUID(),
  };
  const encHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(signedPayload)));
  const sig = await hmacSHA256(`${encHeader}.${encPayload}`, secret);
  return `${encHeader}.${encPayload}.${base64urlEncode(sig)}`;
}

export async function revokeJWTSession(env: Env, token: string, expiresAt?: number): Promise<void> {
  if (!token) throw new Error("JWT token is required");
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1e3);
  const target =
    typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : now + DEFAULT_STATELESS_TOKEN_TTL_SECONDS;
  const expirationTtl = Math.max(60, Math.ceil(target - now));
  await env.AIO_KV.put(`revoked:jwt:${hash}`, "1", { expirationTtl });
}

export async function verifyJWT(token: string, secret: Uint8Array): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, sigB64] = parts;
    if (!encHeader || !encPayload || !sigB64) return null;
    const header = parseJsonData(new TextDecoder().decode(base64urlDecode(encHeader)));
    if (!isPlainRecord(header) || header.alg !== "HS256" || header.typ !== "JWT") return null;
    const expectedSig = await hmacSHA256(`${encHeader}.${encPayload}`, secret);
    if (!(await constantTimeEqual(expectedSig, base64urlDecode(sigB64)))) return null;
    const payload = parseJsonData(new TextDecoder().decode(base64urlDecode(encPayload)));
    if (!isPlainRecord(payload)) return null;
    const now = Math.floor(Date.now() / 1e3);
    if (
      (payload.iat !== undefined &&
        (!isFiniteTimestamp(payload.iat) || payload.iat > now + TOKEN_CLOCK_SKEW_SECONDS)) ||
      (payload.exp !== undefined && (!isFiniteTimestamp(payload.exp) || payload.exp <= now)) ||
      (isFiniteTimestamp(payload.iat) && isFiniteTimestamp(payload.exp) && payload.exp <= payload.iat)
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

async function isJWTSessionRevoked(env: Env, token: string): Promise<boolean> {
  try {
    return await isRevoked(env, `revoked:jwt:${await sha256Hex(token)}`);
  } catch {
    return true;
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
  if (!key || !token) return null;
  const payload = await verifyJWT(token, key);
  if (!payload || (await isJWTSessionRevoked(env, token))) return null;
  return payload;
}
