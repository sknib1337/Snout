import { describe, it, expect } from "vitest";
import { dueForReassessment } from "../src/scheduler";

const at = (iso: string): any => ({ app: iso, assessedAt: iso });

describe("dueForReassessment", () => {
  const now = Date.parse("2026-06-21T00:00:00Z");
  const staleMs = 7 * 24 * 3600e3; // 7 days

  it("selects only stale items, oldest first, capped", () => {
    const items = [
      at("2026-06-20T00:00:00Z"), // 1d — fresh
      at("2026-06-01T00:00:00Z"), // 20d — stale (oldest)
      at("2026-06-10T00:00:00Z"), // 11d — stale
      at("2026-06-13T00:00:00Z"), // 8d — stale
    ];
    const due = dueForReassessment(items, staleMs, now, 2);
    expect(due.map((d) => d.app)).toEqual(["2026-06-01T00:00:00Z", "2026-06-10T00:00:00Z"]);
  });

  it("returns nothing when all are fresh", () => {
    expect(dueForReassessment([at("2026-06-20T00:00:00Z")], staleMs, now, 5)).toHaveLength(0);
  });
});
