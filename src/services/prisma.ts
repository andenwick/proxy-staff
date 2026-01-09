import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { logger } from '../utils/logger.js';

// Singleton Prisma client instance
let prisma: PrismaClient | null = null;
let pool: pg.Pool | null = null;

/**
 * Get the singleton Prisma client instance.
 * Creates the client on first call.
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,                        // Maximum connections in pool
      idleTimeoutMillis: 30000,       // Close idle connections after 30s (before Railway kills them)
      connectionTimeoutMillis: 5000,  // Fail fast if can't connect in 5s
      allowExitOnIdle: false,         // Keep pool alive
    });

    // Handle unexpected pool errors (e.g., connection drops)
    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected PostgreSQL pool error');
    });

    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

/**
 * Gracefully disconnect the Prisma client.
 * Call this during application shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Export the Prisma client type for use in other modules.
 */
export type { PrismaClient };
