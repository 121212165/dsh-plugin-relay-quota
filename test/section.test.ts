/** Section + summary contract tests: pure alert rendering over the published
 * summary.json shape, plus a wire test that /quota really publishes it and the
 * section really reads it — the network never enters the section path.
 * @module test/section */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

import { composeSummary, renderSectionAlert, SUMMARY_MAX_AGE_MS } from '../src/quota.ts';
import { apply } from '../src/plugin.ts';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-quota-section-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('composeSummary keeps only the published fields, v1 envelope stamped', () => {
  const summary = composeSummary(
    [
      { provider: 'main', limitMajor: 100, usedMajor: 95, remainingMajor: 5 },
      { provider: 'spare', limitMajor: 50, usedMajor: 1, remainingMajor: 49, models: ['gpt-x'] },
    ],
    NOW,
  );
  assert.equal(summary.v, 1);
  assert.equal(summary.updatedAt, NOW.toISOString());
  assert.deepEqual(summary.providers[0], { name: 'main', limitMajor: 100, usedMajor: 95, remainingMajor: 5 });
  assert.ok(!('models' in summary.providers[1]!), 'model lists are display-only, not contract');
});

test('renderSectionAlert: quiet when healthy, loud at the line, silent when stale or junk', () => {
  const fresh = (providers: unknown[]): string => JSON.stringify({ v: 1, updatedAt: NOW.toISOString(), providers });

  // under the line (10%): one alert per low relay, exhausted named outright
  const text = renderSectionAlert(JSON.parse(fresh([{ name: 'main', limitMajor: 100, remainingMajor: 5 }, { name: 'empty', limitMajor: 100, remainingMajor: 0 }, { name: 'ok', limitMajor: 100, remainingMajor: 50 }])), NOW, 0.1);
  assert.ok(text.includes('⚠ 中转余额告急'), text);
  assert.ok(text.includes('main 仅剩 $5.00（5%）'), text);
  assert.ok(text.includes('empty 余额已耗尽'), text);
  assert.ok(!text.includes('ok'), text);

  // above the line, stale beyond 30 minutes, wrong envelope, junk: all quiet
  assert.equal(renderSectionAlert(JSON.parse(fresh([{ name: 'main', limitMajor: 100, remainingMajor: 50 }])), NOW, 0.1), '');
  const stale = JSON.parse(fresh([{ name: 'main', limitMajor: 100, remainingMajor: 1 }]));
  (stale as { updatedAt: string }).updatedAt = new Date(NOW.getTime() - SUMMARY_MAX_AGE_MS - 1_000).toISOString();
  assert.equal(renderSectionAlert(stale, NOW, 0.1), '');
  assert.equal(renderSectionAlert({ v: 2, updatedAt: NOW.toISOString(), providers: [] }, NOW, 0.1), '');
  assert.equal(renderSectionAlert('not json', NOW, 0.1), '');
  assert.equal(renderSectionAlert(null, NOW, 0.1), '');
});

type Cmd = { name: string; handler: (args: { rawInput?: string }) => Promise<{ kind: string; text: string }> | { kind: string; text: string } };
type Section = { name: string; order: number; text: () => string };

test('the wire: /quota publishes summary.json, the section reads only the file', async () => {
  const root = tempDir();
  const summaryPath = join(root, 'summary.json');
  const commands: Cmd[] = [];
  const sections: Section[] = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {}, debug() {} }),
    commands: { register: (definition: Cmd) => void commands.push(definition) },
    tools: { register: () => {} },
    systemPrompt: { section: (section: Section) => void sections.push(section) },
  } as never;
  apply(ctx, { enabled: true, alertRatio: 0.1, summaryPath, providers: [] } as never);

  const section = sections.find((candidate) => candidate.name === 'relay-quota');
  assert.ok(section, 'section registered');
  assert.equal(section!.order, 680);
  assert.equal(section!.text(), '', 'no file, no injection');

  const quota = commands.find((command) => command.name === 'quota');
  assert.ok(quota, '/quota registered');
  const out = await quota!.handler({});
  assert.ok(out.text.includes('未配置任何中转'), out.text);

  const published = JSON.parse(readFileSync(summaryPath, 'utf8'));
  assert.equal(published.v, 1);
  assert.deepEqual(published.providers, []);

  // a hand-written low-balance contract injects the warning — no network involved
  writeFileSync(summaryPath, JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), providers: [{ name: 'main', limitMajor: 100, usedMajor: 99.5, remainingMajor: 0.5 }] }), 'utf8');
  assert.match(section!.text(), /main 仅剩 \$0\.50（1%）/);
});
