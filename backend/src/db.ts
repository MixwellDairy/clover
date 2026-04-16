import { Pool } from "pg";
import Redis from "ioredis";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.postgresUrl });

export const redis = config.redisUrl ? new Redis(config.redisUrl, { lazyConnect: true }) : null;
if (redis) {
  redis.connect().catch(() => undefined);
}

export const query = async <T = unknown>(text: string, params: unknown[] = []): Promise<T[]> => {
  const result = await pool.query(text, params);
  return result.rows as T[];
};
