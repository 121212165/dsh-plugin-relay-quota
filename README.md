# dsh-plugin-relay-quota

**EN** · Reads remaining quota and usage straight from any OpenAI-compatible relay's billing surface (new-api style) via `/quota` or the `quota_check` tool, handling the 1e8 unlimited sentinel and cent→currency conversion. · endpoint shapes verified with curl against a real relay · parsing and rendering under test · plugin itself not live-mounted.

DeepSeek Harness (dsh) 插件：查询任意 OpenAI 兼容中转（new-api / one-api / OpenAI legacy billing 形状）的余额与用量。`/quota` 一次看所有已配置中转，agent 也能通过 `quota_check` 工具自己查。

同系列：[cost-ledger](https://github.com/121212165/dsh-plugin-cost-ledger)（本地花费台账）、[session-insights](https://github.com/121212165/dsh-plugin-session-insights)（跨会话统计）、[transcript](https://github.com/121212165/dsh-plugin-transcript)（会话归档）、[price-aware](https://github.com/121212165/dsh-plugin-price-aware)（官方端点的余额与预算门禁）。本插件补的是**中转站**这块 price-aware 够不到的面。

## 功能

- **`/quota`**：逐个中转输出"已用 / 上限 / 剩余 + 占比条 + 耗尽/低于10% 标记"，可选列出该中转的模型清单。
- **`quota_check` 模型工具**：agent 在大任务开始前自查额度。
- **容错**：端点缺字段输出 `?` 而不是猜数；1e8 哨兵上限识别为"无上限"；某个中转挂了只影响自己那一行。

## 数据来源（已对真实中转验证）

- `GET /v1/dashboard/billing/subscription` → `hard_limit_usd` / `soft_limit_usd`（USD 元）
- `GET /v1/dashboard/billing/usage` → `total_usage`（**美分**，OpenAI legacy 形状，new-api/one-api 均克隆了它）
- 可选 `GET /v1/models`

## 配置

```yaml
- insert:
    - id: relay-quota
      name: dsh-plugin-relay-quota
      config:
        enabled: true
        providers:
          - name: my-relay
            baseUrl: http://localhost:3002/v1
            apiKeyEnv: RELAY_API_KEY   # key 放环境变量，不落配置
            listModels: true
```

## 安装

三步，实测于 `@deepseek-ai/dsh@0.1.7-alpha.1`（需 `pnpm` 在 PATH 上）：

```sh
# ① 装进 profile：dsh plugin 把参数原样转发给 pnpm，git 包会自动跑 prepare 构建 lib/
dsh plugin --profile web add github:121212165/dsh-plugin-relay-quota
```

② 把本仓库根目录 `cordis.patch.yml` 的内容**并进** `$DSH_HOME/profiles/web/cordis.patch.yml`。
该文件默认是 `[]`，所以要么整份替换，要么把 insert 条目并进同一个数组；**不要直接追加**——
追加会形成两个 YAML 文档，启动即报
`failed to parse overlay ... end of the stream or a document separator is expected`（本机实测踩过）。

③ 重启 dsh。配置层与 client 半都要重启才生效（客户端按 boot 时算出的内容 rev 下发，硬刷新浏览器没用）。

自检挂载：`dsh --profile web --dump-config | grep dsh-plugin-relay-quota`，应看到该条目。
## 验证状态

- 端点形状已对真实 new-api 中转用 curl 验证（含 1e8 哨兵、美分换算）。
- 纯函数解析/渲染有 node --test 测试；host 接线与其他已 mount 验证的同系列插件同构。
- 未在运行中的 dsh 里 live mount 验证本插件自身。
