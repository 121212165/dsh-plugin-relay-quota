/**
 * Money is always an integer count of micro-units (1e-6 of the billing currency).
 *
 * The identity that makes this cheap: a price quoted "per 1M tokens" times a token
 * count is already in micro-units, since (tokens / 1e6) * price * 1e6 = tokens * price.
 */
export declare const MICROS_PER_MAJOR = 1000000;
export type Micros = number;
export type Currency = 'CNY' | 'USD' | (string & {});
export declare function microsForTokens(tokens: number, pricePerMillion: number): Micros;
export declare function sumMicros(...values: Micros[]): Micros;
export declare function toMajor(micros: Micros): number;
export declare function fromMajor(major: number): Micros;
export declare function symbolFor(currency: Currency): string;
export declare function formatMoney(micros: Micros, currency?: Currency): string;
/** "¥3.84 / ¥5.00 (77%)" — the string a budget warning is made of. */
export declare function formatSpentOf(spent: Micros, budget: Micros, currency: Currency): string;
export declare function ratioOf(part: Micros, whole: Micros): number;
//# sourceMappingURL=money.d.ts.map