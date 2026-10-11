import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaselineFiles } from "../baselineStore";
import { DateStore, validSourceDates } from "../dateStore";
import { hashContent } from "../sync";

/** In-memory files, as `baselineStore.test.ts` uses. */
function memoryFiles(): BaselineFiles & { names: () => string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    exists: async (name) => files.has(name),
    read: async (name) => {
      const data = files.get(name);
      if (!data) {
        throw new Error("missing");
      }
      return data;
    },
    write: async (name, data) => {
      files.set(name, data);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    delete: async (name) => {
      files.delete(name);
    },
    list: async () => [...files.keys()],
    names: () => [...files.keys()],
  };
}

const hash = hashContent("a\nb\nc");

describe("DateStore", () => {
  it("keeps one date per line and reads them back", async () => {
    const files = memoryFiles();
    const store = new DateStore(files, () => undefined);
    assert.equal(await store.has(hash), false);
    assert.equal(await store.write(hash, ["140321", "0", "200102"]), true);
    assert.equal(await store.has(hash), true);
    assert.deepEqual(await store.read(hash), ["140321", "0", "200102"]);
    assert.deepEqual(files.names(), [hash]);
  });

  it("refuses values that aren't source dates, and ignores a damaged file", async () => {
    const files = memoryFiles();
    const log: string[] = [];
    const store = new DateStore(files, (message) => log.push(message));
    assert.equal(await store.write(hash, ["2014-03-21"]), false);
    assert.match(log[0], /Could not keep/);
    await files.write(hash, Buffer.from("140321\nnope"));
    assert.equal(await store.read(hash), undefined);
    assert.match(log[1], /damaged/);
    assert.equal(validSourceDates(["0", "140321"]), true);
    assert.equal(validSourceDates(["14032"]), false);
  });

  it("keeps nothing without files, and prunes what no checkout refers to", async () => {
    const none = new DateStore(undefined, () => undefined);
    assert.equal(await none.write(hash, ["0"]), false);
    assert.equal(await none.read(hash), undefined);
    const files = memoryFiles();
    const store = new DateStore(files, () => undefined);
    const other = hashContent("x");
    await store.write(hash, ["0"]);
    await store.write(other, ["0"]);
    await files.write(`${other}.tmp`, Buffer.from("0"));
    assert.equal(await store.prune(new Set([hash])), 1);
    assert.deepEqual(files.names().sort(), [hash, `${other}.tmp`].sort());
  });

  it("rejects a name that isn't a hash", async () => {
    const store = new DateStore(memoryFiles(), () => undefined);
    assert.equal(await store.read("../etc/passwd"), undefined);
    assert.equal(await store.write("../x", ["0"]), false);
  });
});
