import { promises as fs } from "fs";
import path from "path";
import { config } from "./config";
import { Assessment, DiscoveredApp } from "./controls";

export type DiscoveredUpsert = {
  domain: string;
  name?: string;
  methods?: Partial<DiscoveredApp["methods"]>;
  idps?: string[];
  oauth?: DiscoveredApp["oauth"];
  sources?: string[];
  firstSeen?: number;
  lastSeen?: number;
};

export interface Store {
  // assessments
  list(): Promise<Assessment[]>;
  get(id: string): Promise<Assessment | undefined>;
  upsertByApp(record: Assessment): Promise<Assessment>;
  remove(id: string): Promise<void>;
  // discovered apps (from the extension / catalog webhooks)
  listDiscovered(): Promise<DiscoveredApp[]>;
  getDiscovered(domain: string): Promise<DiscoveredApp | undefined>;
  upsertDiscovered(app: DiscoveredUpsert): Promise<DiscoveredApp>;
  removeDiscovered(domain: string): Promise<void>;
  linkAssessment(domain: string, assessmentId: string): Promise<void>;
}

/**
 * JsonStore — zero-dependency persistence for getting started and small teams.
 * For production swap in a Postgres-backed Store (two tables: assessments,
 * discovered) implementing the same interface; nothing else changes.
 */
class JsonStore implements Store {
  private aFile = path.join(config.dataDir, "assessments.json");
  private dFile = path.join(config.dataDir, "discovered.json");
  private aCache: Assessment[] | null = null;
  private dCache: DiscoveredApp[] | null = null;

  private async read<T>(file: string): Promise<T[]> {
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return []; }
  }
  private async write(file: string, data: unknown) {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
  private async loadA() { return (this.aCache ??= await this.read<Assessment>(this.aFile)); }
  private async loadD() { return (this.dCache ??= await this.read<DiscoveredApp>(this.dFile)); }

  async list() {
    return [...(await this.loadA())].sort((a, b) => +new Date(b.assessedAt) - +new Date(a.assessedAt));
  }
  async get(id: string) { return (await this.loadA()).find((a) => a.id === id); }
  async upsertByApp(record: Assessment) {
    const list = await this.loadA();
    this.aCache = [record, ...list.filter((a) => a.app.toLowerCase() !== record.app.toLowerCase())];
    await this.write(this.aFile, this.aCache);
    return record;
  }
  async remove(id: string) {
    this.aCache = (await this.loadA()).filter((a) => a.id !== id);
    await this.write(this.aFile, this.aCache);
  }

  async listDiscovered() {
    return [...(await this.loadD())].sort((a, b) => b.lastSeen - a.lastSeen);
  }
  async getDiscovered(domain: string) { return (await this.loadD()).find((a) => a.domain === domain); }

  async upsertDiscovered(incoming: DiscoveredUpsert) {
    const list = await this.loadD();
    const now = Date.now();
    const i = list.findIndex((a) => a.domain === incoming.domain);
    const blankMethods = { sso: false, social: false, password: false, federated: false, oauthGrant: false };
    if (i === -1) {
      const fresh: DiscoveredApp = {
        domain: incoming.domain,
        name: incoming.name || incoming.domain,
        methods: { ...blankMethods, ...(incoming.methods || {}) },
        idps: (incoming.idps || []).slice(0, 10),
        oauth: (incoming.oauth || []).slice(0, 10),
        sources: (incoming.sources || []).slice(0, 8),
        firstSeen: incoming.firstSeen || now,
        lastSeen: incoming.lastSeen || now,
      };
      this.dCache = [fresh, ...list];
      await this.write(this.dFile, this.dCache);
      return fresh;
    }
    const cur = list[i];
    const m: Partial<DiscoveredApp["methods"]> = incoming.methods || {};
    const merged: DiscoveredApp = {
      ...cur,
      name: incoming.name || cur.name,
      methods: {
        sso: cur.methods.sso || !!m.sso,
        social: cur.methods.social || !!m.social,
        password: cur.methods.password || !!m.password,
        federated: cur.methods.federated || !!m.federated,
        oauthGrant: cur.methods.oauthGrant || !!m.oauthGrant,
      },
      idps: Array.from(new Set([...(cur.idps || []), ...(incoming.idps || [])])).slice(0, 10),
      oauth: [...(incoming.oauth || []), ...(cur.oauth || [])].slice(0, 10),
      sources: Array.from(new Set([...(cur.sources || []), ...(incoming.sources || [])])).slice(0, 8),
      firstSeen: Math.min(cur.firstSeen, incoming.firstSeen || now),
      lastSeen: Math.max(cur.lastSeen, incoming.lastSeen || now),
    };
    list[i] = merged;
    this.dCache = list;
    await this.write(this.dFile, this.dCache);
    return merged;
  }
  async removeDiscovered(domain: string) {
    this.dCache = (await this.loadD()).filter((a) => a.domain !== domain);
    await this.write(this.dFile, this.dCache);
  }
  async linkAssessment(domain: string, assessmentId: string) {
    const list = await this.loadD();
    const app = list.find((a) => a.domain === domain);
    if (app) { app.assessmentId = assessmentId; this.dCache = list; await this.write(this.dFile, list); }
  }
}

export const store: Store = new JsonStore();
