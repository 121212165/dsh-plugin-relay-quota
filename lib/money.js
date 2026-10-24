/**
 * Money is always an integer count of micro-units (1e-6 of the billing currency).
 *
 * The identity that makes this cheap: a price quoted "per 1M tokens" times a token
 * count is already in micro-units, since (tokens / 1e6) * price * 1e6 = tokens * price.
 */
export const MICROS_PER_MAJOR = 1_000_000;
export function microsForTokens(tokens, pricePerMillion) {
    if (!Number.isFinite(tokens) || tokens < 0)
        return 0;
    return Math.round(tokens * pricePerMillion);
}
export function sumMicros(...values) {
    return values.reduce((a, b) => a + b, 0);
}
export function toMajor(micros) {
    return micros / MICROS_PER_MAJOR;
}
export function fromMajor(major) {
    return Math.round(major * MICROS_PER_MAJOR);
}
const SYMBOLS = { CNY: '¥', RMB: '¥', USD: '$', EUR: '€' };
export function symbolFor(currency) {
    return SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
}
export function formatMoney(micros, currency = 'CNY') {
    const sign = micros < 0 ? '-' : '';
    const abs = Math.abs(micros);
    const digits = abs >= 100_000 ? 2 : abs >= 10_000 ? 3 : 4;
    return `${sign}${symbolFor(currency)}${toMajor(abs).toFixed(digits)}`;
}
/** "¥3.84 / ¥5.00 (77%)" — the string a budget warning is made of. */
export function formatSpentOf(spent, budget, currency) {
    const ratio = budget > 0 ? spent / budget : 0;
    return `${formatMoney(spent, currency)} / ${formatMoney(budget, currency)} (${Math.round(ratio * 100)}%)`;
}
export function ratioOf(part, whole) {
    return whole > 0 ? part / whole : 0;
}
//# sourceMappingURL=money.js.map