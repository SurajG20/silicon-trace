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
      connectionAcquisitionTimeout: 10_000,
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
  try {
    return await attempt(mode, work);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    // Free-tier instances pause when idle: the first query wakes them and
    // times out, so one delayed retry covers the wake-up window instead of
    // surfacing a scary error page for a healthy-but-sleepy database.
    await sleep(RETRY_DELAY_MS);
    return attempt(mode, work);
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

const RETRY_DELAY_MS = 3000;

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
