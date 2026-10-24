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
    models?: string[] | undefined;
}
export declare function parseSubscription(_provider: string, payload: unknown): {
    limitMajor: number | null;
};
export declare function parseUsage(_provider: string, payload: unknown): {
    usedMajor: number | null;
};
export declare function composeReading(provider: string, limitMajor: number | null, usedMajor: number | null, models?: string[] | undefined): QuotaReading;
export declare function renderBar(share: number, width?: number): string;
export declare function renderReading(reading: QuotaReading): string;
/** The published contract (quota's summary.json pattern): the /quota command and
 * quota_check tool write it when they run; the system-prompt section only ever
 * reads this file, never the network — a section is evaluated every model step
 * and must not turn into a polling loop against the relay. */
export interface RelaySummary {
    v: 1;
    updatedAt: string;
    providers: Array<{
        name: string;
        limitMajor: number | null;
        usedMajor: number | null;
        remainingMajor: number | null;
    }>;
}
export declare function composeSummary(readings: QuotaReading[], now: Date): RelaySummary;
/** Older than this, the section goes quiet: a stale balance must not read as a live one. */
export declare const SUMMARY_MAX_AGE_MS: number;
/** The one injected line when a relay runs low. Tolerant: missing file, junk,
 * future stamp, or nothing below the line all render '' (no injection). */
export declare function renderSectionAlert(content: unknown, now: Date, alertRatio: number): string;
//# sourceMappingURL=quota.d.ts.map