import { randomUUID } from 'node:crypto';
import { DEFAULT_SEED_PASSWORD, seedUserDefinitions } from '../src/data/seed';
import { prismaStore } from '../src/repositories/prismaStore';
import { hashPassword } from '../src/services/passwords';

async function main() {
  for (const [index, user] of seedUserDefinitions.entries()) {
    const credentials = hashPassword(
      DEFAULT_SEED_PASSWORD,
      `seed-salt-${index}`,
    );

    await prismaStore.seedUserIfMissing({
      id: randomUUID(),
      name: user.name,
      email: user.email.toLowerCase(),
      joinedAt: new Date().toISOString(),
      passwordHash: credentials.passwordHash,
      passwordSalt: credentials.passwordSalt,
      organization: user.organization,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
