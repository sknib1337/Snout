import { promises as fs } from "fs";
import path from "path";
import { config } from "./config";
import { Assessment } from "./controls";

export interface Store {
  list(): Promise<Assessment[]>;
  get(id: string): Promise<Assessment | undefined>;
  /** Insert, replacing any prior assessment of the same app (case-insensitive). */
  upsertByApp(record: Assessment): Promise<Assessment>;
  remove(id: string): Promise<void>;
}

/**
 * JsonStore — zero-dependency persistence for getting started and small teams.
 * Last-write-wins, single file, fine into the low thousands of records.
 *
 * For production swap in a Postgres-backed Store: one `assessments` table with a
 * JSONB `data` column keyed by id, plus a unique lower(app) index for upsert.
 * Implement the same four methods and pass it to the routes — nothing else changes.
 */
class JsonStore implements Store {
  private file = path.join(config.dataDir, "assessments.json");
  private cache: Assessment[] | null = null;

  private async load(): Promise<Assessment[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.cache = JSON.parse(raw);
    } catch {
      this.cache = [];
    }
    return this.cache!;
  }

  private async flush() {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.cache, null, 2));
  }

  async list() {
    return [...(await this.load())].sort(
      (a, b) => +new Date(b.assessedAt) - +new Date(a.assessedAt),
    );
  }
  async get(id: string) {
    return (await this.load()).find((a) => a.id === id);
  }
  async upsertByApp(record: Assessment) {
    const list = await this.load();
    this.cache = [record, ...list.filter((a) => a.app.toLowerCase() !== record.app.toLowerCase())];
    await this.flush();
    return record;
  }
  async remove(id: string) {
    const list = await this.load();
    this.cache = list.filter((a) => a.id !== id);
    await this.flush();
  }
}

export const store: Store = new JsonStore();
