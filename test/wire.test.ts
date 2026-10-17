/**
 * Wire-level (assembly layer) tests for relay-quota: mount the real apply()
 * against a scripted cordis context, back providers with a local HTTP fake
 * relay, and exercise the full path /quota (publish → section alert) plus the
 * unconfigured and disabled degrade paths. Template: dsh-plugin-quota/test/harness.ts.
 * @module test/wire
 */
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

interface CapturedCommand { name: string; handler: (args?: { rawInput?: string }) => unknown }
interface CapturedTool { execute: (args?: unknown) => Promise<string> }
interface CapturedSection { name: string; text: () => string }

type Apply = (ctx: unknown, config: Record<string, unknown>) => void;

interface FakeRelay {
  /** subscription total, or 'fail' to return a 500 */
  hardLimitUsd: number | 'fail';
  /** usage in USD cents, or 'fail' */
  totalUsageCents: number | 'fail';
  models?: string[];
}

async function startRelay(fake: FakeRelay): Promise<Promise<{ url: string; stop(): Promise<void> }>> {
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    let payload: unknown = null;
    if (url.includes('/subscription')) payload = fake.hardLimitUsd === 'fail' ? null : { hard_limit_usd: fake.hardLimitUsd };
    else if (url.includes('/usage')) payload = fake.totalUsageCents === 'fail' ? null : { total_usage: fake.totalUsageCents };
    else if (url.includes('/models')) payload = { data: (fake.models ?? []).map((id) => ({ id })) };
    else {
      res.writeHead(404);
      res.end();
      return;
    }
    const broken = (url.includes('/subscription') && fake.hardLimitUsd === 'fail') || (url.includes('/usage') && fake.totalUsageCents === 'fail');
    res.writeHead(broken ? 500 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  process.env.WIRE_TEST_KEY = 'test-key';
  return {
    url: `http://127.0.0.1:${port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function makeCtx() {
  const commands: CapturedCommand[] = [];
  const tools: CapturedTool[] = [];
  const sections: CapturedSection[] = [];
  const ctx = {
    logger() { return { info() {}, warn() {} }; },
    commands: { register(definition: CapturedCommand) { commands.push(definition) } },
    tools: { register(definition: unknown) { tools.push(definition as CapturedTool) } },
    systemPrompt: { section(definition: CapturedSection) { sections.push(definition) } },
  };
  return {
    commands, tools, sections, ctx,
    command(name: string) {
      const found = commands.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`command ${name} was never registered`);
      return found;
    },
    tool(name: string) {
      const found = tools.find((candidate: unknown) => (candidate as { toJSON?: unknown; name?: string } & Record<string, unknown>).name === name);
      if (!found) throw new Error(`tool ${name} was never registered`);
      return found;
    },
    section(name: string) {
      const found = sections.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`section ${name} was never registered`);
      return found;
    },
  };
}

test('fail-loud on an alertRatio outside [0,1]', async () => {
  const { ctx } = makeCtx();
  const { apply } = (await import('../src/plugin.ts')) as unknown as { apply: Apply };
  assert.throws(() => apply(ctx, { enabled: true, alertRatio: 1.5, providers: [] }), /alertRatio must be between 0 and 1/);
});

test('disabled config mounts nothing', async () => {
  const { ctx, commands, sections, tools } = makeCtx();
  const { apply } = (await import('../src/plugin.ts')) as unknown as { apply: Apply };
  apply(ctx, { enabled: false, providers: [] });
  assert.equal(commands.length, 0);
  assert.equal(sections.length, 0);
  assert.equal(tools.length, 0);
});

test('zero providers: /quota answers "not configured" and the section stays quiet', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'relay-wire-'));
  after(() => rmSync(workspace, { recursive: true, force: true }));
  const summaryPath = join(workspace, 'summary.json');
  const bag = makeCtx();
  const { apply } = (await import('../src/plugin.ts')) as unknown as { apply: Apply };
  apply(bag.ctx, { enabled: true, alertRatio: 0.1, providers: [], summaryPath });

  const output = (await bag.command('quota')!.handler()) as { kind: string; text: string };
  assert.ok(output.text.includes('未配置任何中转'), `text: ${output.text}`);
  assert.ok(existsSync(summaryPath), 'summary contract published even with zero providers');

  const mocked = bag.section('relay-quota')!;
  assert.equal(mocked.text(), '');
});

test('one good relay + one broken relay: /quota reads both, publishes the contract, models listed', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'relay-wire-'));
  after(() => rmSync(workspace, { recursive: true, force: true }));
  const summaryPath = join(workspace, 'summary.json');
  const good = await startRelay({ hardLimitUsd: 50, totalUsageCents: 1000, models: ['m-a', 'm-b'] });
  const bad = await startRelay({ hardLimitUsd: 'fail', totalUsageCents: 'fail' });
  after(() => good.stop());
  after(() => bad.stop());

  const bag = makeCtx();
  const { apply } = (await import('../src/plugin.ts')) as unknown as { apply: Apply };
  apply(bag.ctx, {
    enabled: true,
    alertRatio: 0.1,
    summaryPath,
    providers: [
      { name: 'good', baseUrl: good.url, apiKeyEnv: 'WIRE_TEST_KEY', listModels: true },
      { name: 'bad', baseUrl: bad.url, apiKeyEnv: 'WIRE_TEST_KEY', listModels: false },
    ],
  });

  const output = (await bag.command('quota')!.handler()) as { kind: string; text: string };
  assert.ok(output.text.includes('good: 已用 $10.00 / $50.00'), `good reading: ${output.text}`);
  assert.ok(output.text.includes('剩余 $40.00'), `good remaining: ${output.text}`);
  assert.ok(output.text.includes('models: m-a, m-b'), `models appended to the text: ${output.text}`);
  assert.ok(output.text.includes('bad: 额度面不可读'), `bad relay degrades to a line: ${output.text}`);

  const contract = JSON.parse(readFileSync(summaryPath, 'utf8')) as { providers: Array<{ name: string; remainingMajor: number | null }> };
  assert.equal(contract.providers[0]!.name, 'good');
  assert.equal(contract.providers[0]!.remainingMajor, 40);

  const section = bag.section('relay-quota')!;
  assert.equal(section.text(), '');
});

test('low balance contracts float to an injected alert line; junk goes quiet', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'relay-wire-'));
  after(() => rmSync(workspace, { recursive: true, force: true }));
  const summaryPath = join(workspace, 'summary.json');
  const bag = makeCtx();
  const { apply } = (await import('../src/plugin.ts')) as unknown as { apply: Apply };
  apply(bag.ctx, {
    enabled: true,
    alertRatio: 0.1,
    summaryPath,
    providers: [{ name: 'low', baseUrl: 'http://127.0.0.1:1/v1', apiKeyEnv: 'WIRE_TEST_KEY', listModels: false }],
  });
  fakeSummary(summaryPath, [{ name: 'low', limitMajor: 10, usedMajor: 9, remainingMajor: 1 }]);
  assert.ok(bag.section('relay-quota')!.text().includes('仅剩 $1.00'), 'alert fires for a low relay');
  fakeSummary(summaryPath, null);
  assert.equal(bag.section('relay-quota')!.text(), '', 'junk contract renders nothing');
});

/** Hand-write a summary contract (or junk) to drive section reads without the network. */
function fakeSummary(path: string, providers: unknown): void {
  const payload = providers === null
    ? 'not-json{'
    : JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), providers });
  writeFileSync(path, payload, 'utf8');
}

test('quota_check tool publishes the same contract and answers over the wire', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'relay-wire-'));
  after(() => rmSync(workspace, { recursive: true, force: true }));
  const summaryPath = join(workspace, 'summary.json');
  const relay = await startRelay({ hardLimitUsd: 20, totalUsageCents: 500 });
  after(() => relay.stop());
  const bag = makeCtx();
  const { apply } = (await import('../src/plugin.ts')) as unknown as { apply: Apply };
  apply(bag.ctx, {
    enabled: true,
    alertRatio: 0.1,
    summaryPath,
    providers: [{ name: 'solo', baseUrl: relay.url, apiKeyEnv: 'WIRE_TEST_KEY', listModels: false }],
  });
  const tool = bag.tool('quota_check');
  assert.ok(tool, 'quota_check registered');
  const text = await tool.execute({});
  assert.ok(text.includes('solo: 已用 $5.00 / $20.00'), `tool text: ${text}`);
  const contract = JSON.parse(readFileSync(summaryPath, 'utf8')) as { providers: Array<{ name: string }> };
  assert.equal(contract.providers[0]!.name, 'solo');
});

