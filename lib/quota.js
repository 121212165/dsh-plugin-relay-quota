/** Pure parsing of OpenAI-compatible relay quota surfaces. Two endpoint families
 * exist in the wild (both verified against a live new-api relay):
 *  - /v1/dashboard/billing/subscription → hard/soft limit (USD major units)
 *  - /v1/dashboard/billing/usage        → total_usage in USD cents (OpenAI legacy shape)
 * Everything is tolerant: a relay that omits a field yields null, not a guess. */
export function parseSubscription(_provider, payload) {
    if (typeof payload !== 'object' || payload === null)
        return { limitMajor: null };
    const hard = payload.hard_limit_usd;
    const soft = payload.soft_limit_usd;
    const system = payload.system_hard_limit_usd;
    const candidates = [hard, soft, system].filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    // a 1e8 sentinel is the "no real limit" default across relays; report it as unlimited
    const limit = candidates.length ? Math.min(...candidates) : null;
    return { limitMajor: limit !== null && limit >= 1e7 ? null : limit };
}
export function parseUsage(_provider, payload) {
    if (typeof payload !== 'object' || payload === null)
        return { usedMajor: null };
    const totalUsage = payload.total_usage;
    if (typeof totalUsage !== 'number' || !Number.isFinite(totalUsage) || totalUsage < 0)
        return { usedMajor: null };
    // OpenAI legacy billing shape reports cents; every relay cloned that shape
    return { usedMajor: totalUsage / 100 };
}
export function composeReading(provider, limitMajor, usedMajor, models) {
    const remainingMajor = limitMajor !== null && usedMajor !== null ? limitMajor - usedMajor : null;
    return { provider, limitMajor, usedMajor, remainingMajor, models };
}
export function renderBar(share, width = 24) {
    const filled = Math.round(Math.max(0, Math.min(1, share)) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}
export function renderReading(reading) {
    const usd = (value) => (value === null ? '?' : `$${value.toFixed(2)}`);
    const used = reading.usedMajor ?? 0;
    const limit = reading.limitMajor;
    const share = limit !== null && limit > 0 ? used / limit : 0;
    const head = `${reading.provider}: 已用 ${usd(reading.usedMajor)} / ${limit === null ? '无上限' : usd(limit)} · 剩余 ${usd(reading.remainingMajor)}`;
    if (limit === null)
        return head;
    const state = reading.remainingMajor !== null && reading.remainingMajor <= 0 ? ' ❌ 已耗尽' : share > 0.9 ? ' ⚠ 低于10%' : '';
    return `${head}\n  ${renderBar(share)} ${Math.round(share * 100)}%${state}`;
}
export function composeSummary(readings, now) {
    return {
        v: 1,
        updatedAt: now.toISOString(),
        providers: readings.map(({ provider, limitMajor, usedMajor, remainingMajor }) => ({ name: provider, limitMajor, usedMajor, remainingMajor })),
    };
}
/** Older than this, the section goes quiet: a stale balance must not read as a live one. */
export const SUMMARY_MAX_AGE_MS = 30 * 60_000;
/** The one injected line when a relay runs low. Tolerant: missing file, junk,
 * future stamp, or nothing below the line all render '' (no injection). */
export function renderSectionAlert(content, now, alertRatio) {
    if (typeof content !== 'object' || content === null)
        return '';
    const value = content;
    if (value.v !== 1)
        return '';
    if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
        return '';
    if (now.getTime() - Date.parse(value.updatedAt) > SUMMARY_MAX_AGE_MS)
        return '';
    if (!Array.isArray(value.providers) || !value.providers.length)
        return '';
    const alerts = [];
    for (const row of value.providers) {
        if (typeof row !== 'object' || row === null)
            continue;
        const entry = row;
        if (typeof entry.name !== 'string' || !entry.name)
            continue;
        if (typeof entry.remainingMajor !== 'number' || !Number.isFinite(entry.remainingMajor))
            continue;
        if (entry.remainingMajor <= 0) {
            alerts.push(`${entry.name} 余额已耗尽`);
            continue;
        }
        if (typeof entry.limitMajor === 'number' && Number.isFinite(entry.limitMajor) && entry.limitMajor > 0 && entry.remainingMajor / entry.limitMajor <= alertRatio) {
            alerts.push(`${entry.name} 仅剩 $${entry.remainingMajor.toFixed(2)}（${Math.round((entry.remainingMajor / entry.limitMajor) * 100)}%）`);
        }
    }
    return alerts.length ? `⚠ 中转余额告急：${alerts.join('；')}（/quota 详情）` : '';
}
//# sourceMappingURL=quota.js.map