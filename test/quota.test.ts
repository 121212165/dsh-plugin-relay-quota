import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeReading, parseSubscription, parseUsage, renderReading } from '../src/quota.ts';

test('subscription picks the smallest positive limit and treats 1e8 sentinels as unlimited', () => {
  assert.equal(parseSubscription('r', { hard_limit_usd: 100 }).limitMajor, 100);
  assert.equal(parseSubscription('r', { soft_limit_usd: 50, hard_limit_usd: 100 }).limitMajor, 50);
  assert.equal(parseSubscription('r', { hard_limit_usd: 100_000_000, soft_limit_usd: 100_000_000 }).limitMajor, null);
  assert.equal(parseSubscription('r', {}).limitMajor, null);
  assert.equal(parseSubscription('r', 'garbage').limitMajor, null);
});

test('usage converts legacy cents to major units and rejects junk', () => {
  assert.equal(parseUsage('r', { total_usage: 19816.8432 }).usedMajor, 198.168432);
  assert.equal(parseUsage('r', { total_usage: -1 }).usedMajor, null);
  assert.equal(parseUsage('r', {}).usedMajor, null);
});

test('compose fills remaining only when both sides are known', () => {
  assert.equal(composeReading('r', 100, 40).remainingMajor, 60);
  assert.equal(composeReading('r', null, 40).remainingMajor, null);
  assert.equal(composeReading('r', 100, null).remainingMajor, null);
});

test('rendering shows a bar and flags exhaustion', () => {
  const exhausted = renderReading(composeReading('relay-a', 1, 1.5));
  assert.ok(exhausted.includes('已耗尽'));
  assert.ok(exhausted.includes('█'));
  const unlimited = renderReading(composeReading('relay-b', null, 3));
  assert.ok(unlimited.includes('无上限'));
  assert.ok(!unlimited.includes('█')); // no bar without a limit
  const tenPercent = renderReading(composeReading('relay-c', 100, 95));
  assert.ok(tenPercent.includes('低于10%'));
});
