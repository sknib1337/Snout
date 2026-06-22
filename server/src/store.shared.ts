import { DiscoveredApp, DiscoveredEvent } from "./controls";

// Keep at most this many history events per app so the store can't grow
// unbounded from a chatty sensor. Oldest events fall off first.
export const EVENT_CAP = 50;

export type DiscoveredUpsert = {
  domain: string;
  name?: string;
  methods?: Partial<DiscoveredApp["methods"]>;
  idps?: string[];
  oauth?: DiscoveredApp["oauth"];
  sources?: string[];
  firstSeen?: number;
  lastSeen?: number;
  events?: DiscoveredEvent[];
};

const blankMethods = { sso: false, social: false, password: false, federated: false, oauthGrant: false };

/**
 * Pure merge of an incoming discovery upsert onto the current record (or a fresh
 * record when `cur` is undefined). Shared by the JSON and Postgres stores so the
 * dedupe/merge semantics are identical regardless of backend.
 */
export function applyDiscoveredUpsert(
  cur: DiscoveredApp | undefined,
  incoming: DiscoveredUpsert,
  now: number,
): DiscoveredApp {
  if (!cur) {
    return {
      domain: incoming.domain,
      name: incoming.name || incoming.domain,
      methods: { ...blankMethods, ...(incoming.methods || {}) },
      idps: (incoming.idps || []).slice(0, 10),
      oauth: (incoming.oauth || []).slice(0, 10),
      sources: (incoming.sources || []).slice(0, 8),
      firstSeen: incoming.firstSeen || now,
      lastSeen: incoming.lastSeen || now,
      events: (incoming.events || []).slice(-EVENT_CAP),
    };
  }
  const m: Partial<DiscoveredApp["methods"]> = incoming.methods || {};
  return {
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
    events: [...(cur.events || []), ...(incoming.events || [])].slice(-EVENT_CAP),
  };
}
