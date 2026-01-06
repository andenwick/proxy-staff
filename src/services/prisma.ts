import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// Singleton Prisma client instance
let prisma: PrismaClient | null = null;

/**
 * Get the singleton Prisma client instance.
 * Creates the client on first call.
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
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
}

/**
 * Export the Prisma client type for use in other modules.
 */
export type { PrismaClient };
