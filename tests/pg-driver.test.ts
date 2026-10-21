import { expect, mock, test } from "bun:test";

// A fake postgres.js: each query waits for the test to settle it, so a request can be left hanging on purpose.
const pending: { text: string; settle: (rows: unknown[]) => void }[] = [];
mock.module("postgres", () => ({
  default: () => {
    const sql: any = { unsafe: (text: string) => new Promise((settle) => pending.push({ text, settle })) };
    sql.begin = async (fn: (tx: unknown) => unknown) => fn(sql);
    sql.end = async () => {};
    return sql;
  },
}));

const { postgresDriver, MAX_INFLIGHT } = await import("../gate/pg-driver");

const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<"timeout">((done) => setTimeout(() => done("timeout"), ms))]);

test("a request whose queries hang does not hold the query slots of the next request (Cloudflare 1101)", async () => {
  const hung = postgresDriver("postgres://hung");
  for (let i = 0; i < MAX_INFLIGHT + 2; i += 1) hung.driver.query("select 'hung'", []);
  const next = postgresDriver("postgres://next");
  const answer = next.driver.query("select 'next'", []);
  await Promise.resolve();
  const sent = pending.find((q) => q.text === "select 'next'");
  sent?.settle([{ ok: 1 }]);
  expect(await within(answer, 500)).toEqual({ rows: [{ ok: 1 }], count: 1 });
});

test("one request still runs at most MAX_INFLIGHT queries at once", async () => {
  pending.length = 0;
  const one = postgresDriver("postgres://one");
  const all = Array.from({ length: MAX_INFLIGHT + 3 }, (_, i) => one.driver.query("select " + i, []));
  await new Promise((done) => setTimeout(done, 0));
  expect(pending.length).toBe(MAX_INFLIGHT);
  while (pending.length) pending.shift()!.settle([]);
  await new Promise((done) => setTimeout(done, 0));
  while (pending.length) pending.shift()!.settle([]);
  expect((await Promise.all(all)).length).toBe(MAX_INFLIGHT + 3);
});
