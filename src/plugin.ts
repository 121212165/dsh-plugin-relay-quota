/**
 * dsh wiring for the relay-quota plugin: /quota and the quota_check tool hit
 * the OpenAI-compatible billing surface of each configured relay. Endpoints are
 * read-only GETs; a failing relay degrades to an error line, never a crash.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-tools';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { composeReading, composeSummary, parseSubscription, parseUsage, renderReading, renderSectionAlert, type QuotaReading } from './quota.ts';

export const name = 'relay-quota';
export const inject = ['commands', 'tools', 'systemPrompt'];

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

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  summaryPath: Schema.string(),
  alertRatio: Schema.number().min(0).max(1).default(0.1).description('剩余比例 ≤ 此值时 section 注入警告行'),
  providers: Schema.array(
    Schema.object({
      name: Schema.string().required(),
      baseUrl: Schema.string().required(),
      apiKeyEnv: Schema.string().required(),
      listModels: Schema.boolean().default(false),
    }),
  ).default([]),
});

async function fetchJson(url: string, key: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readProvider(provider: RelayProvider): Promise<{ text: string; reading: QuotaReading | null }> {
  const key = process.env[provider.apiKeyEnv]?.trim();
  if (!key) return { text: `${provider.name}: 环境变量 ${provider.apiKeyEnv} 未设置`, reading: null };
  const signal = AbortSignal.timeout(15_000);
  // accept bases with or without the /v1 suffix; the billing surface lives under /v1
  const base = provider.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  let limitMajor: number | null = null;
  let usedMajor: number | null = null;
  let models: string[] | undefined;
  const problems: string[] = [];
  try {
    const subscription = await fetchJson(`${base}/v1/dashboard/billing/subscription`, key, signal);
    limitMajor = parseSubscription(provider.name, subscription).limitMajor;
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const usage = await fetchJson(`${base}/v1/dashboard/billing/usage`, key, signal);
    usedMajor = parseUsage(provider.name, usage).usedMajor;
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (provider.listModels) {
    try {
      const list = (await fetchJson(`${base}/v1/models`, key, signal)) as { data?: { id?: unknown }[] };
      models = (list.data ?? []).map((model) => String(model.id)).slice(0, 30);
    } catch {
      models = undefined;
    }
  }
  if (limitMajor === null && usedMajor === null) {
    return { text: `${provider.name}: 额度面不可读（${problems.join('; ') || 'no data'}）`, reading: null };
  }
  const reading = composeReading(provider.name, limitMajor, usedMajor, models);
  const text = renderReading(reading);
  return { text: models?.length ? `${text}\n  models: ${models.join(', ')}` : text, reading };
}

export function apply(ctx: Context, config: Config): void {
  const log = ctx.logger('relay-quota');
  if (!config.enabled) return void log.info('disabled by config');
  if (!Number.isFinite(config.alertRatio) || config.alertRatio < 0 || config.alertRatio > 1) {
    throw new TypeError('relay-quota: alertRatio must be between 0 and 1');
  }
  // tools/commands stay registered even with zero providers: a missing
  // configuration should answer "not configured", not make the tool vanish

  const summaryPath = config.summaryPath ? expandHome(config.summaryPath) : join(homedir(), '.dsh', 'relay-quota', 'summary.json');

  const writeAtomic = (dest: string, content: string): void => {
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, dest);
  };

  /** Publish the balance contract for the section (quota's summary.json pattern):
   * written when /quota or quota_check actually runs, read-only everywhere else. */
  const publish = async (readings: Array<PromiseSettledResult<{ text: string; reading: QuotaReading | null }>>): Promise<void> => {
    const known = readings.flatMap((result) => (result.status === 'fulfilled' && result.value.reading ? [result.value.reading] : []));
    try {
      writeAtomic(summaryPath, JSON.stringify(composeSummary(known, new Date()), null, 2) + '\n');
    } catch (error) {
      log.warn(`summary publish failed: ${String(error)}`);
    }
  };

  ctx.systemPrompt.section({
    name: 'relay-quota',
    order: 680,
    text: () => {
      try {
        if (!existsSync(summaryPath)) return '';
        const content: unknown = JSON.parse(readFileSync(summaryPath, 'utf8'));
        return renderSectionAlert(content, new Date(), config.alertRatio);
      } catch {
        return '';
      }
    },
  });

  ctx.commands.register({
    name: 'quota',
    description: '查询所有已配置中转的余额与用量',
    handler: async () => {
      const results = await Promise.allSettled(config.providers.map(readProvider));
      await publish(results);
      const lines = results.map((result) => (result.status === 'fulfilled' ? result.value.text : `中转查询失败：${String(result.reason)}`));
      return { kind: 'success', text: lines.length ? lines.join('\n') : '未配置任何中转。在 relay-quota.providers 里加一行。' };
    },
  });

  ctx.tools.register(
    defineTool({
      name: 'quota_check',
      description: '查询已配置中转的剩余额度。任务开始前用户问"还有没有额度"时用。',
      parameters: {},
      output: {
        schema: { type: 'string' } as const,
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: () => ({ card: 'generic' as const, title: '查中转余额', kind: 'fetch' as const }),
      presentResult: (_args, value) => ({
        card: 'generic' as const,
        title: String(value).split('\n')[0]!.slice(0, 60),
        kind: 'fetch' as const,
        rawInput: value,
      }),
      async execute() {
        const results = await Promise.allSettled(config.providers.map(readProvider));
        await publish(results);
        return results.map((result) => (result.status === 'fulfilled' ? result.value.text : `中转查询失败：${String(result.reason)}`)).join('\n');
      },
    }),
  );

  log.info(`mounted · ${config.providers.length} provider(s) · alertRatio=${config.alertRatio}`);
}

export function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}
