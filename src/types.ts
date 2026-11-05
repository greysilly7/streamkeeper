export type Source = "aiostreams" | "aiometadata";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonData = JsonValue | object;
export interface JsonObject {
  [key: string]: JsonValue;
}
export interface JwtPayload extends JsonObject {
  sub?: string;
  iat?: number;
  exp?: number;
}
export interface ServiceConfig extends JsonObject {
  id?: string;
}
export interface PresetConfig extends JsonObject {
  type?: string;
}
export interface Config extends JsonObject {
  services?: ServiceConfig[];
  presets?: PresetConfig[];
}

export interface Env {
  AIO_KV: KVNamespace;
  ADMIN_PASSWORD?: string;
  PASSWORD_ENCRYPTION_KEY?: string;
  HOSTS?: string;
  AIOMETADATA_HOSTS?: string;
}
export interface ParsedStremioPath {
  prefix: "stremio";
  source: Source;
  uuid: string;
  encryptedPassword: string;
  token?: never;
}

export interface ParsedStatelessPath {
  prefix: "stremio";
  token: string;
  source?: never;
  uuid?: never;
  encryptedPassword?: never;
}

export type StremioPath = ParsedStremioPath | ParsedStatelessPath;

export interface ParsedManifestUrl {
  host: string;
  source: Source;
  uuid: string;
  encPwd: string;
}

export interface RequestCredentials {
  uuid: string;
  encryptedPassword: string;
}

export interface StatelessTokenPayload {
  v: 1;
  s: Source;
  n?: string;
  m?: string;
  u: string;
  e?: string;
  p: string;
  h: string;
  f: string[];
  c: Config;
  r?: number;
}

export interface UserState {
  source: Source;
  uuid: string;
  encryptedPassword: string;
  password: string;
  preferredHost: string;
  currentHost: string;
  currentUuid: string;
  currentEncPwd: string;
  preferredCooldownMs: number;
  lastPreferredCheck: number;
  lastConfigRefresh: number;
  lastCurrentValidationAt?: number;
  validatedHost?: string;
  validatedUuid?: string;
  validatedEncPwd?: string;
  cacheRefreshHours: number;
  enabledFallbackHosts: string[];
  failoverCount: number;
  lastFailoverAt: number | null;
  lastFailoverHost: string | null;
  createdAt: number | null;
  installationKey?: string;
  cachedConfig?: Config;
}

export interface AccountRecord {
  uuid: string;
  nickname?: string;
  source?: Source;
  token?: string;
  manifestUrl?: string;
  preferredHost?: string;
  currentHost?: string;
  currentUuid?: string;
  currentEncPwd?: string;
  encryptedPassword?: string;
  preferredCooldownMs?: number;
  lastPreferredCheck?: number;
  lastConfigRefresh?: number;
  lastCurrentValidationAt?: number;
  validatedHost?: string;
  validatedUuid?: string;
  validatedEncPwd?: string;
  installationKey?: string;
  cachedConfig?: Config;
  installUrl?: string;
  manageUrl?: string;
  password?: string;
  passwordCipher?: string;
  enabledFallbackHosts?: string[];
  cacheRefreshHours?: number;
  failoverCount?: number;
  lastFailoverAt?: number | null;
  lastFailoverHost?: string | null;
  createdAt?: number | null;
}

export interface HostHealthEntry {
  status: "healthy" | "unhealthy";
  checkedAt: number;
  consecutiveFailures: number;
  latencyMs?: number;
  source?: Source;
  host?: string;
}

export type HostHealth = Record<string, HostHealthEntry>;

export interface HealthStore {
  get(): Promise<HostHealth>;
  put(health: HostHealth): Promise<void>;
}

export type PutState = (state: UserState) => Promise<void>;

export interface SourceInstallResult {
  uuid: string;
  encryptedPassword: string;
  manifestUrl: string;
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  resources: JsonValue[];
  types: string[];
  [key: string]: JsonValue;
}

export function isRecord(value: JsonData | undefined | null): value is JsonObject {
  return typeof value === "object" && value !== null;
}

export function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

declare global {
  interface CacheStorage {
    default: Cache;
  }
}
