import neo4j, { Neo4jError, type Driver, type ManagedTransaction } from "neo4j-driver";
import { getConfig } from "./config";

/**
 * Neo4j-driver singleton shared by the Next.js server runtime and scripts.
 *
 * CognoDB speaks the Bolt protocol (5.0–5.4), so the official Neo4j driver
 * connects unchanged — only the URI differs from a vanilla Neo4j instance.
 */

let driver: Driver | null = null;
let driverPromise: Promise<Driver> | null = null;

/** Lazily create (and cache) the process-wide driver instance. */
export function getDriver(): Promise<Driver> {
  if (driver) return Promise.resolve(driver);
  if (driverPromise) return driverPromise;

  driverPromise = (async () => {
    const config = getConfig();
    const instance = neo4j.driver(config.COGNODB_URI, neo4j.auth.basic(config.COGNODB_USER, config.COGNODB_PASSWORD), {
      // The free-tier c0 instance allows 200 connections; stay well under it.
      maxConnectionPoolSize: 25,
      // Paused free-tier instances need time to wake: wait out the wake-up
      // instead of failing fast on the first cold query.
      connectionAcquisitionTimeout: 30_000,
      // Plain JS numbers are far easier to serialise to JSON; every value in
      // this domain fits comfortably inside double-precision range.
      disableLosslessIntegers: true,
    });

    // Fail fast with a clear error when the database is unreachable or the
    // credentials are wrong, instead of on the first query.
    await instance.getServerInfo();

    driver = instance;
    return instance;
  })();

  driverPromise.catch(() => {
    // Allow a later call to retry after a transient failure.
    driverPromise = null;
  });

  return driverPromise;
}

/** Run read work in a managed, auto-retried transaction. */
export async function executeRead<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  return run("READ", work);
}

/** Run write work in a managed, auto-retried transaction. */
export async function executeWrite<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  return run("WRITE", work);
}

async function run<T>(mode: "READ" | "WRITE", work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  // Free-tier instances pause when idle and wake slowly: the first query can
  // fail fast (refused) or stall (timeout), so back off and retry instead of
  // surfacing a scary error page for a healthy-but-sleepy database.
  // Total budget ≈ 30s acquisition + 5s + 30s + 10s + 30s — inside the
  // serverless function limit while covering a typical wake-up window.
  // Attempts: immediate, +5s, +15s → 3 total before surfacing the error.
  for (let i = 0; ; i++) {
    try {
      return await attempt(mode, work);
    } catch (error) {
      if (!isRetryable(error) || i >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[i]);
    }
  }
}

async function attempt<T>(mode: "READ" | "WRITE", work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const d = await getDriver();
  const session = d.session({ defaultAccessMode: mode });
  try {
    return mode === "READ" ? await session.executeRead(work) : await session.executeWrite(work);
  } finally {
    await session.close();
  }
}

const RETRY_DELAYS_MS = [5_000, 10_000];

const RETRYABLE_CODES = ["ServiceUnavailable", "SessionExpired", "TransientError", "DatabaseUnavailable"];

function isRetryable(error: unknown): boolean {
  return error instanceof Neo4jError && RETRYABLE_CODES.some((code) => (error.code ?? "").includes(code));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Probe the database with a lightweight round-trip. Rejects when unreachable. */
export async function checkConnection(): Promise<{ agent: string; latencyMs: number }> {
  const started = Date.now();
  const info = await (await getDriver()).getServerInfo();
  return { agent: info.agent ?? "unknown-server", latencyMs: Date.now() - started };
}

/** Close the driver (used by CLI scripts). */
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    driverPromise = null;
  }
}
