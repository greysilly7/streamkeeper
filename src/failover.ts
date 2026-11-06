import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";
import { log } from "./utils";

export interface LeaseGrant {
  granted: boolean;
  token: string;
  retryAfterMs: number;
}

interface StoredLease {
  token: string;
  expiresAt: number;
}

const LEASE_TTL_MS = 45_000;
const LEASE_WAIT_MS = 5_000;
const localLeases = new Map<string, Promise<void>>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withLocalLease<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LEASE_WAIT_MS;
  while (true) {
    const existing = localLeases.get(key);
    if (!existing) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Failover coordination timed out");
    await Promise.race([existing, sleep(Math.min(remaining, 100))]);
  }

  let releaseLease: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    releaseLease = resolve;
  });
  localLeases.set(key, held);
  try {
    return await operation();
  } finally {
    releaseLease();
    if (localLeases.get(key) === held) localLeases.delete(key);
  }
}
export async function withFailoverLease<T>(env: Env, key: string, operation: () => Promise<T>): Promise<T> {
  const binding = env.FAILOVER_COORDINATOR;
  if (!binding) return withLocalLease(key, operation);

  const coordinator = binding.getByName(key);
  const deadline = Date.now() + LEASE_WAIT_MS;
  let grant: LeaseGrant = { granted: false, token: "", retryAfterMs: 100 };
  while (Date.now() < deadline) {
    grant = await coordinator.acquire(LEASE_TTL_MS);
    if (grant.granted) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(Math.max(grant.retryAfterMs, 25), remaining));
  }
  if (!grant.granted) throw new Error("Failover coordination timed out");

  try {
    return await operation();
  } finally {
    try {
      await coordinator.release(grant.token);
    } catch (error) {
      log("warn", "Failover", "Lease release failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class FailoverCoordinator extends DurableObject<Env> {
  async acquire(ttlMs: number): Promise<LeaseGrant> {
    const requestedTtl = Number.isFinite(ttlMs) ? Math.max(1_000, Math.min(ttlMs, 120_000)) : LEASE_TTL_MS;
    let result: LeaseGrant = { granted: false, token: "", retryAfterMs: requestedTtl };
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const existing = await this.ctx.storage.get<StoredLease>("lease");
      if (existing && existing.expiresAt > now) {
        result = { granted: false, token: "", retryAfterMs: Math.max(25, existing.expiresAt - now) };
        return;
      }
      const token = crypto.randomUUID();
      await this.ctx.storage.put<StoredLease>("lease", { token, expiresAt: now + requestedTtl });
      result = { granted: true, token, retryAfterMs: 0 };
    });
    return result;
  }

  async release(token: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<StoredLease>("lease");
      if (existing?.token === token) await this.ctx.storage.delete("lease");
    });
  }
}
