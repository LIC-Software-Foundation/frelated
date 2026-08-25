import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import type { DataStoreShape } from '../domain/models';
import { createSeedStore } from '../data/seed';

class JsonStoreRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  async read(): Promise<DataStoreShape> {
    await this.ensureStoreExists();

    const raw = await fs.readFile(env.dataFilePath, 'utf8');
    return JSON.parse(raw) as DataStoreShape;
  }

  async write(nextStore: DataStoreShape): Promise<void> {
    await this.ensureStoreExists();

    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(
        env.dataFilePath,
        JSON.stringify(nextStore, null, 2),
        'utf8',
      );
    });

    await this.writeQueue;
  }

  async update<T>(recipe: (store: DataStoreShape) => T): Promise<T> {
    const store = await this.read();
    const snapshot = structuredClone(store);
    const result = recipe(snapshot);
    await this.write(snapshot);
    return result;
  }

  private async ensureStoreExists(): Promise<void> {
    const directory = path.dirname(env.dataFilePath);
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.access(env.dataFilePath);
    } catch {
      const seed = createSeedStore();
      await fs.writeFile(
        env.dataFilePath,
        JSON.stringify(seed, null, 2),
        'utf8',
      );
    }
  }
}

export const jsonStore = new JsonStoreRepository();
