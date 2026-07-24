# SDK Direct Chain ID Design

## 目标

SDK 的所有公开输入、输出和 executor 接口只使用统一 Swap API 的直接 chain id。
应用不再需要构造或理解 `eip155:`、`:mainnet` 等命名空间。

```ts
const quote = await client.quote({
  fromChain: "8453",
  toChain: "solana",
  tokenIn: {
    chain: "8453",
    address: "0x...",
    symbol: "USDC",
    decimals: 6,
  },
  tokenOut: {
    chain: "solana",
    address: "...",
    symbol: "USDC",
    decimals: 6,
  },
  amountIn: "619627",
  slippageBps: 50,
  sender: "0x...",
  recipient: "...",
});
```

这是明确的 breaking change。旧格式 `eip155:8453`、`solana:mainnet`、
`near:mainnet` 等不再作为 SDK 公共输入接受。

## Canonical Chain IDs

EVM chain id 使用正十进制字符串：

- Ethereum: `"1"`
- Base: `"8453"`
- Arbitrum: `"42161"`
- 其他 EVM 链同样使用其十进制 chain id

非 EVM 链使用统一 Swap API 的 canonical id：

- Solana: `"solana"`
- Aptos: `"aptos"`
- NEAR: `"near"`
- Tron: `"tron"`
- Bitcoin: `"btc"`
- Zcash: `"zcash"`
- Sui: `"sui"`

公共 SDK 不输出 `sol`、`trx`、`bitcoin`、`zec`、十六进制 EVM id 或
CAIP 风格 id。后端 raw response 若返回已知别名，SDK 可以在解析边界将其
规范化为上述 canonical id，但别名不进入公共对象。

## Public Type Surface

保留 `ChainRef` 类型名，避免引入与本次目标无关的类型重命名；它的语义改为
“统一 Swap API chain id”。

以下字段全部使用同一套直接 chain id：

- `QuoteRequest.fromChain` / `toChain`
- `AssetRef.chain`
- `Quote.fromChain` / `toChain`
- `SwapBuild.fromChain` / `toChain`
- `SwapExecution.chain`
- `SwapHistoryRecord.fromChain` / `toChain`
- lifecycle sign preview 的 `chain`
- 非 EVM wallet adapter 的 `getChain()`

`tokenIn.chain` 必须等于 `fromChain`，`tokenOut.chain` 必须等于
`toChain`，比较时使用 canonical id。

## Normalization Boundary

移除公共 API 对 `toApiChain()` / `fromApiChain()` 转换模型的依赖。

SDK 内部保留两个职责明确的边界：

1. 公共请求校验只接受 canonical chain id。CAIP 风格和非 canonical
   别名抛出 `SwapSdkError`，错误码为 `UNSUPPORTED_CHAIN`。
2. 后端 raw response 解析允许识别历史别名和十六进制 EVM id，但必须立即
   转成 canonical chain id，再进入 `Quote`、`SwapBuild`、history 或
   execution 对象。

发送 `/api/swap/quote` 和 `/api/swap/swap` 时直接透传 canonical chain
id，不再先构造 CAIP id、随后又转回 API id。

## Execution Dispatch

execution 的 `kind` 继续负责选择 executor，chain id 只用于链匹配和结果描述。

- 十进制 chain id 表示 EVM execution lane。
- `"solana"`、`"aptos"`、`"near"`、`"tron"`、`"btc"`、`"zcash"`、
  `"sui"` 映射到各自 execution lane。
- EVM executor 将钱包返回的数值 chain id 转成十进制字符串后，与
  `execution.chain` 比较。
- 非 EVM adapter 的 `getChain()` 直接返回 canonical id，例如
  `"solana"` 或 `"near"`。
- executor registry 仍按 `execution.kind` 自动分发，应用不增加条件分支。

## Native Asset Handling

原生币占位地址映射改为以 canonical chain id 为 key：

- EVM 十进制 chain id → zero address
- `"solana"` → wrapped SOL canonical address
- `"near"` → `wrap.near`
- `"btc"` → `btc`
- 其他非 EVM 链沿用当前统一 Swap API 占位地址

显式传入的 token address 继续原样保留。

## MCA Behavior

MCA 不保留第二套 chain 表示：

- NEAR 判断使用 `fromChain === "near"` 或 `toChain === "near"`。
- MCA deposit、bound-NEAR withdraw 和 relayer withdraw 都把 direct chain
  id 放入 quote、build、report 和 status 上下文。
- signer chain（`"evm"`、`"near"` 等钱包类型）仍是 signer family，不是
  network chain id；本次不修改 `McaSignerChain`。

## Error Handling

以下输入必须在发 HTTP 请求之前失败：

- `eip155:8453`
- `solana:mainnet`
- 空字符串
- `"0"` 或带符号、空格、小数形式的 EVM chain id
- SDK 不支持且无法识别 execution lane 的 chain id

后端返回无法识别的 chain id 时，build/history normalization 应返回
`INVALID_API_RESPONSE` 或现有最接近的 SDK 错误，而不是把非 canonical 值
泄漏给应用。

## Compatibility and Release

不提供 legacy alias、兼容转换或 deprecated 过渡期。调用方必须一次性把
公共输入迁移到 direct chain id。

因为输入值、输出值和 wallet adapter 契约都会变化，发布时应视为 breaking
release，并在 changelog/README 中给出迁移示例：

```text
eip155:8453   -> 8453
solana:mainnet -> solana
near:mainnet   -> near
bitcoin:mainnet -> btc
```

## Tests

实施采用 TDD，并覆盖：

1. quote request 直接接受 `"8453"` 和 `"solana"`，HTTP body 原样发送。
2. quote request 拒绝所有旧命名空间格式。
3. token chain 与 from/to chain 使用 direct id 做一致性校验。
4. build normalizer 对 EVM、Solana、Aptos、NEAR、Tron、Bitcoin、Zcash 和
   Sui 都输出 canonical id。
5. 后端十六进制 EVM id 和已知历史别名只在 raw boundary 被规范化。
6. EVM executor 使用十进制字符串执行 chain mismatch 校验。
7. 所有非 EVM executor adapter 使用 direct chain id。
8. MCA 三种执行路径仅使用 direct chain id。
9. history、report 和 lifecycle event 不再出现 CAIP 风格值。
10. public API、README 和 SDK 文档不再展示命名空间格式。
11. 全量 test、type-check、lint 和 package build 通过。

## Out of Scope

- 不修改统一 Swap HTTP API 的字段名或 payload 结构。
- 不修改 signer family（例如 `McaSignerChain`）。
- 不新增链或 RPC 配置。
- 不修改应用侧余额查询逻辑。
