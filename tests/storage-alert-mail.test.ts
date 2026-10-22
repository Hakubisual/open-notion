import { expect, test } from "bun:test";
import { storageAlertMail } from "../gate/_worker.js";
import { assembleWorkerSource } from "./assemble-worker";

const env = { OWNER_ALERT_EMAIL: "owner@example.com", RESEND_API_KEY: "re_test" };

test("the real alert mails keep their subjects; the admin test mail carries [테스트] and today's usage", () => {
  expect(storageAlertMail(env, 8.1e9, false).subject).toBe("[Acard] 파일 저장 공간 8GB 넘음");
  expect(storageAlertMail(env, 9.5e9, true).subject).toBe("[Acard] 파일 저장 공간 업로드 중지");
  const test = storageAlertMail(env, 203_740_776, false, true);
  expect(test).toMatchObject({ to: ["owner@example.com"], from: "Acard <beta@send.notes.example.com>", subject: "[테스트] [Acard] 파일 저장 공간 8GB 넘음" });
  expect(test.text).toContain("0.20GB");
  expect(storageAlertMail({ ...env, MAIL_FROM: "X <x@send.notes.example.com>" }, 1, false).from).toBe("X <x@send.notes.example.com>");
});

test("storageAlertTest sends one [테스트] mail to OWNER_ALERT_EMAIL, returns Resend's id, and leaves the ledger and its alert flag alone", async () => {
  const worker = new Function(assembleWorkerSource())();
  const calls: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return Response.json({ id: "email-123" }); }) as any;
  const ledger = { used: 203_740_776, alerted: 0, mediaUsage: async (delta: number) => { ledger.used += delta; return { ok: true, used: ledger.used, alerted: ledger.alerted }; }, mediaMarkAlerted: async () => { ledger.alerted = 9; return true; } };
  try {
    const sent = await worker.acardHost.storageAlertTest({ ...env, WORKSPACE: { idFromName: (n: string) => n, get: () => ledger } });
    expect(sent).toEqual({ used: 203_740_776, to: "owner@example.com", ok: true, status: 200, id: "email-123" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.resend.com/emails", auth: "Bearer re_test", body: { to: ["owner@example.com"], subject: "[테스트] [Acard] 파일 저장 공간 8GB 넘음" } });
    expect([ledger.used, ledger.alerted]).toEqual([203_740_776, 0]);
    globalThis.fetch = (async () => Response.json({ message: "domain not verified" }, { status: 403 })) as any;
    expect(await worker.acardHost.storageAlertTest({ ...env })).toMatchObject({ ok: false, status: 403, id: null });
    expect(await worker.acardHost.storageAlertTest({ OWNER_ALERT_EMAIL: "x@y" })).toMatchObject({ ok: false });
  } finally {
    globalThis.fetch = realFetch;
  }
});
