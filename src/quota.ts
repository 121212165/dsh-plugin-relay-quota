/** Pure parsing of OpenAI-compatible relay quota surfaces. Two endpoint families
 * exist in the wild (both verified against a live new-api relay):
 *  - /v1/dashboard/billing/subscription → hard/soft limit (USD major units)
 *  - /v1/dashboard/billing/usage        → total_usage in USD cents (OpenAI legacy shape)
 * Everything is tolerant: a relay that omits a field yields null, not a guess. */

export interface SubscriptionPayload {
  hard_limit_usd?: number;
  soft_limit_usd?: number;
  system_hard_limit_usd?: number;
}

export interface UsagePayload {
  total_usage?: number;
}

export interface QuotaReading {
  provider: string;
  /** limit in USD major units, null when the relay hides it */
  limitMajor: number | null;
  /** used, in the same unit as limitMajor */
  usedMajor: number | null;
  remainingMajor: number | null;
  /** model ids the relay exposes (from /v1/models), when fetched */
  models?: string[];
}

export function parseSubscription(provider: string, payload: unknown): { limitMajor: number | null } {
  if (typeof payload !== 'object' || payload === null) return { limitMajor: null };
  const hard = (payload as SubscriptionPayload).hard_limit_usd;
  const soft = (payload as SubscriptionPayload).soft_limit_usd;
  const system = (payload as SubscriptionPayload).system_hard_limit_usd;
  const candidates = [hard, soft, system].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  // a 1e8 sentinel is the "no real limit" default across relays; report it as unlimited
  const limit = candidates.length ? Math.min(...candidates) : null;
  return { limitMajor: limit !== null && limit >= 1e7 ? null : limit };
}

export function parseUsage(provider: string, payload: unknown): { usedMajor: number | null } {
  if (typeof payload !== 'object' || payload === null) return { usedMajor: null };
  const totalUsage = (payload as UsagePayload).total_usage;
  if (typeof totalUsage !== 'number' || !Number.isFinite(totalUsage) || totalUsage < 0) return { usedMajor: null };
  // OpenAI legacy billing shape reports cents; every relay cloned that shape
  return { usedMajor: totalUsage / 100 };
}

export function composeReading(provider: string, limitMajor: number | null, usedMajor: number | null, models?: string[]): QuotaReading {
  const remainingMajor = limitMajor !== null && usedMajor !== null ? limitMajor - usedMajor : null;
  return { provider, limitMajor, usedMajor, remainingMajor, models };
}

export function renderBar(share: number, width = 24): string {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function renderReading(reading: QuotaReading): string {
  const usd = (value: number | null): string => (value === null ? '?' : `$${value.toFixed(2)}`);
  const used = reading.usedMajor ?? 0;
  const limit = reading.limitMajor;
  const share = limit !== null && limit > 0 ? used / limit : 0;
  const head = `${reading.provider}: 已用 ${usd(reading.usedMajor)} / ${limit === null ? '无上限' : usd(limit)} · 剩余 ${usd(reading.remainingMajor)}`;
  if (limit === null) return head;
  const state = reading.remainingMajor !== null && reading.remainingMajor <= 0 ? ' ❌ 已耗尽' : share > 0.9 ? ' ⚠ 低于10%' : '';
  return `${head}\n  ${renderBar(share)} ${Math.round(share * 100)}%${state}`;
}
