/**
 * dsh wiring for the relay-quota plugin: /quota and the quota_check tool hit
 * the OpenAI-compatible billing surface of each configured relay. Endpoints are
 * read-only GETs; a failing relay degrades to an error line, never a crash.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "relay-quota";
export declare const inject: string[];
export interface RelayProvider {
    name: string;
    baseUrl: string;
    apiKeyEnv: string;
    /** request /v1/models and list the relay's models */
    listModels: boolean;
}
export interface Config {
    enabled: boolean;
    providers: RelayProvider[];
    /** where the published balance contract lives; the section reads this file, never the network */
    summaryPath?: string;
    /** remaining/limit at or below which the section injects a warning line */
    alertRatio: number;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    enabled: Schema<boolean, boolean>;
    summaryPath: Schema<string, string>;
    alertRatio: Schema<number, number>;
    providers: Schema<({
        name?: string | null;
        baseUrl?: string | null;
        apiKeyEnv?: string | null;
        listModels?: boolean | null;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        name: Schema<string, string>;
        baseUrl: Schema<string, string>;
        apiKeyEnv: Schema<string, string>;
        listModels: Schema<boolean, boolean>;
    }>[]>;
}>, Schemastery.ObjectT<{
    enabled: Schema<boolean, boolean>;
    summaryPath: Schema<string, string>;
    alertRatio: Schema<number, number>;
    providers: Schema<({
        name?: string | null;
        baseUrl?: string | null;
        apiKeyEnv?: string | null;
        listModels?: boolean | null;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        name: Schema<string, string>;
        baseUrl: Schema<string, string>;
        apiKeyEnv: Schema<string, string>;
        listModels: Schema<boolean, boolean>;
    }>[]>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
export declare function expandHome(path: string): string;
//# sourceMappingURL=plugin.d.ts.map