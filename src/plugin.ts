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

import { composeReading, parseSubscription, parseUsage, renderReading } from './quota.ts';

export const name = 'relay-quota';
export const inject = ['commands', 'tools'];

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
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
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

async function readProvider(provider: RelayProvider): Promise<string> {
  const key = process.env[provider.apiKeyEnv]?.trim();
  if (!key) return `${provider.name}: 环境变量 ${provider.apiKeyEnv} 未设置`;
  const signal = AbortSignal.timeout(15_000);
  const base = provider.baseUrl.replace(/\/+$/, '');
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
    return `${provider.name}: 额度面不可读（${problems.join('; ') || 'no data'}）`;
  }
  const reading = composeReading(provider.name, limitMajor, usedMajor, models);
  const text = renderReading(reading);
  return models?.length ? `${text}\n  models: ${models.join(', ')}` : text;
}

export function apply(ctx: Context, config: Config): void {
  const log = ctx.logger('relay-quota');
  if (!config.enabled) return void log.info('disabled by config');
  if (!config.providers.length) return void log.info('no providers configured');

  ctx.commands.register({
    name: 'quota',
    description: '查询所有已配置中转的余额与用量',
    handler: async () => {
      const lines = await Promise.all(config.providers.map(readProvider));
      return { kind: 'success', text: lines.join('\n') };
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
      async execute() {
        const lines = await Promise.all(config.providers.map(readProvider));
        return lines.join('\n');
      },
    }),
  );

  log.info(`mounted · ${config.providers.length} provider(s)`);
}
