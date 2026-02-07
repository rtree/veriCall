/**
 * Cloud SQL Database Client
 *
 * Uses @google-cloud/cloud-sql-connector for IAM authentication.
 * No passwords — ADC (Application Default Credentials) handles auth.
 *
 * Cloud Run → Cloud SQL Auth Proxy (Unix socket) → PostgreSQL
 * Local dev → Direct TCP with password fallback
 */

import pg from 'pg';
import { Connector, IpAddressTypes, AuthTypes } from '@google-cloud/cloud-sql-connector';

const { Pool } = pg;

// ─── Config ────────────────────────────────────────────────────

const INSTANCE_CONNECTION_NAME =
  process.env.CLOUD_SQL_CONNECTION_NAME || 'ethglobal-479011:us-central1:vericall-db';

const DB_NAME = process.env.DB_NAME || 'vericall';
const DB_USER = process.env.DB_IAM_USER || 'vericall-deploy@ethglobal-479011.iam';

// ─── Pool Singleton ───────────────────────────────────────────

let _pool: pg.Pool | null = null;
let _connector: Connector | null = null;

/**
 * Get the database connection pool.
 * Uses Cloud SQL Connector with IAM auth in production,
 * falls back to direct connection with password for local dev.
 */
export async function getPool(): Promise<pg.Pool> {
  if (_pool) return _pool;

  // Local dev: use DATABASE_URL or direct connection with password
  if (process.env.DATABASE_URL) {
    console.log('🗄️ [DB] Using DATABASE_URL (direct connection)');
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return _pool;
  }

  // Production: Cloud SQL Connector with IAM authentication
  console.log(`🗄️ [DB] Connecting via Cloud SQL Connector (IAM auth)`);
  console.log(`🗄️ [DB] Instance: ${INSTANCE_CONNECTION_NAME}`);
  console.log(`🗄️ [DB] User: ${DB_USER}`);

  _connector = new Connector();
  const clientOpts = await _connector.getOptions({
    instanceConnectionName: INSTANCE_CONNECTION_NAME,
    ipType: IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
  });

  _pool = new Pool({
    ...clientOpts,
    user: DB_USER,
    database: DB_NAME,
    max: 5,
  });

  // Test connection
  const client = await _pool.connect();
  const res = await client.query('SELECT NOW() as now');
  console.log(`🗄️ [DB] Connected! Server time: ${res.rows[0].now}`);
  client.release();

  return _pool;
}

/**
 * Run a query against the database.
 */
export async function query(text: string, params?: any[]): Promise<pg.QueryResult> {
  const pool = await getPool();
  return pool.query(text, params);
}

/**
 * Graceful shutdown — close pool and connector.
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  if (_connector) {
    _connector.close();
    _connector = null;
  }
}
