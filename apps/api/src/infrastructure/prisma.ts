import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  prismaClient ??= new PrismaClient();

  return prismaClient;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!prismaClient) {
    return;
  }

  await prismaClient.$disconnect();
  prismaClient = null;
}
