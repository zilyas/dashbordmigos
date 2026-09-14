import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source-level guard for restoreBackupPayload's FK ordering. A restore runs in
 * one transaction against the real DB, so an ordering mistake only ever shows
 * up as a failed production restore — the worst possible place to find it.
 * This reads prisma/schema.prisma, rebuilds the FK graph, and checks the
 * hand-written delete order in backup.ts against it, with no DB required.
 */

const ROOT = process.cwd();
const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf-8");
const source = readFileSync(path.join(ROOT, "src/lib/backup.ts"), "utf-8");

/** Tables deliberately not backed up (pure rate-limit telemetry). */
const EXCLUDED = new Set(["LoginAttempt"]);

function lowerFirst(s: string): string {
  return s[0].toLowerCase() + s.slice(1);
}

/** model name -> models it points at via a non-self FK */
function parseSchema(): { models: string[]; deps: Map<string, Set<string>> } {
  const models: string[] = [];
  const deps = new Map<string, Set<string>>();
  let current: string | null = null;

  for (const line of schema.split("\n")) {
    const model = /^model\s+(\w+)\s*\{/.exec(line);
    if (model) {
      current = model[1];
      models.push(current);
      deps.set(current, new Set());
      continue;
    }
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    if (!current || !line.includes("@relation(fields:")) continue;

    // `  store  Store?  @relation(fields: [storeId], ...)` -> target type
    const target = /^\s*\w+\s+(\w+)\??\s/.exec(line)?.[1];
    if (target && target !== current) deps.get(current)!.add(target);
  }
  return { models, deps };
}

const { models, deps } = parseSchema();
const backed = models.filter((m) => !EXCLUDED.has(m));

/** Order of `tx.<model>.deleteMany()` calls as written in restoreBackupPayload. */
const deleteOrder = [...source.matchAll(/tx\.(\w+)\.deleteMany\(\)/g)].map((m) => m[1]);

describe("backup schema coverage", () => {
  it("dumps every model in the schema", () => {
    const missing = backed.filter(
      (m) => !new RegExp(`prisma\\.${lowerFirst(m)}\\.findMany\\(`).test(source)
    );
    expect(missing).toEqual([]);
  });

  it("deletes every model it dumps", () => {
    const missing = backed.filter((m) => !deleteOrder.includes(lowerFirst(m)));
    expect(missing).toEqual([]);
  });

  it("re-inserts every model it deletes", () => {
    const missing = backed.filter(
      (m) => !new RegExp(`tx\\.${lowerFirst(m)}\\.createMany\\(`).test(source)
    );
    expect(missing).toEqual([]);
  });
});

describe("restore FK ordering", () => {
  it("deletes children before their parents", () => {
    const position = new Map(deleteOrder.map((name, i) => [name, i]));
    const violations: string[] = [];

    for (const child of backed) {
      const childPos = position.get(lowerFirst(child));
      if (childPos === undefined) continue;
      for (const parent of deps.get(child) ?? []) {
        if (EXCLUDED.has(parent)) continue;
        const parentPos = position.get(lowerFirst(parent));
        if (parentPos === undefined) continue;
        if (childPos > parentPos) {
          violations.push(`${child} deleted after its parent ${parent}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("inserts parents before their children", () => {
    // Insert order = first createMany occurrence per model in the source.
    const insertOrder = [...source.matchAll(/tx\.(\w+)\.createMany\(/g)].map((m) => m[1]);
    const position = new Map<string, number>();
    insertOrder.forEach((name, i) => {
      if (!position.has(name)) position.set(name, i);
    });

    const violations: string[] = [];
    for (const child of backed) {
      const childPos = position.get(lowerFirst(child));
      if (childPos === undefined) continue;
      for (const parent of deps.get(child) ?? []) {
        if (EXCLUDED.has(parent)) continue;
        const parentPos = position.get(lowerFirst(parent));
        if (parentPos === undefined) continue;
        if (childPos < parentPos) {
          violations.push(`${child} inserted before its parent ${parent}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
