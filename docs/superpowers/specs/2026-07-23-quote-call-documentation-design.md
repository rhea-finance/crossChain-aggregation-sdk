# Quote 调用文档设计

## 目标

为 `SwapClient.quote()`、`SwapClient.quoteRaw()` 和底层
`POST /api/swap/quote` 提供一份按业务场景组织的中文调用文档。调用方应能在不阅读
SDK 源码的前提下判断使用哪一种请求结构，并正确传入链、Token、金额、账户和 MCA
扩展参数。

## 文档范围

新建 `docs/QUOTE.md`，覆盖以下四种请求：

1. 普通 Swap。
2. MCA Deposit。
3. MCA Withdraw 到绑定的 NEAR account。
4. MCA Withdraw 经 multichain relayer 到其他目标账户。

文档同时覆盖推荐的标准 SDK 接口和保留后端字段结构的 raw/HTTP 接口。交易构建、
钱包执行、report、order status 和 history 只说明 quote 之后的入口，不重复现有完整
流程文档。

`README.md` 只增加文档入口，不在首页复制整篇参数说明。已有
`docs/MCA_SWAP_API.md` 和 `docs/MCA_SWAP_HTTP_API.md` 继续承担完整 MCA 生命周期说明，
新文档聚焦 quote 请求参数。

## 信息架构

`docs/QUOTE.md` 按以下顺序组织：

1. 接口选择：说明 `quote()` 与 `quoteRaw()` 的区别。
2. 场景判断表：根据资金来源和目标是否属于 MCA 选择四种结构之一。
3. 公共参数规则：链、Token、金额、滑点、账户和请求选项。
4. 四个场景的独立调用章节。
5. SDK 到 HTTP 的字段转换总表。
6. 返回值和 quote 后续使用方式。
7. 常见错误检查表。

每个场景章节采用相同模板：

- 适用条件。
- `client.quote()` 的完整 TypeScript 请求。
- 参数表，包含类型、必填条件和值的来源。
- `client.quoteRaw()` 的完整 TypeScript/JSON 请求。
- SDK 字段到 HTTP 字段的转换说明。
- 返回类型、`executionMode`（如适用）和后续调用。

## 参数表达规则

标准 SDK 示例使用公开类型中的 camelCase 字段：

- `fromChain`、`toChain` 使用 `ChainRef`，例如 `eip155:1`、
  `near:mainnet`。
- `tokenIn`、`tokenOut` 使用 `AssetRef`，包括 `chain`、`address`，并按需
  提供 `symbol`、`decimals` 和 `isNative`。
- `amountIn` 使用 Token 最小单位的十进制字符串。
- `slippageBps` 使用基点，`50` 表示 0.5%。
- `sender` 表示资金来源账户；`recipient` 表示最终收款账户。文档按场景给出具体取值，
  不使用“通常传钱包地址”之类的模糊描述。
- 第二个参数使用 `ApiRequestOptions`，说明 `signal` 和 `idempotencyKey`；其中 quote
  是只读操作，主要示例使用 `signal` 取消过时请求。

raw/HTTP 示例使用 `SwapQuoteRequestRaw` 中的后端字段：

- `fromChain`、`toChain` 使用 API chain ID，例如 `1`、`near`。
- `tokenIn`、`tokenOut` 使用 token address/id 字符串。
- `slippage` 与 `slippageBps` 使用相同的基点数值；例如
  `slippageBps: 50` 序列化为 `slippage: 50`。
- 原生币最终序列化为各链的 API token id；例如空地址且
  `isNative: true` 的 EVM Token 序列化为零地址，其他链使用 SDK 内置映射。
- `extensions` 透传到 raw 请求的顶层。

最终字段名和转换值必须以 `src/types/quote.ts`、`src/api/rawTypes.ts`、
`src/normalizers/quote.ts`、`src/mca/quote.ts` 以及相应测试为准。

## MCA 分支规则

普通 Swap 不传 `flow`、`mcaAccountId`、`signer`、`collateral` 或 raw `mca`。

MCA Deposit：

- `flow` 固定为 `deposit`。
- `mcaAccountId` 是目标 MCA account。
- `recipient` 传目标 MCA account。
- `signer` 标识来源钱包。
- `collateral.useAsCollateral` 明确表示存入后是否作为抵押物。

MCA Withdraw 到绑定 NEAR：

- `flow` 固定为 `withdraw`。
- `sender` 是 MCA account。
- 推荐让 `recipient` 和 `boundNearAccountId` 传同一个绑定 NEAR account，并使用
  `executionPreference: "auto"`。
- `auto` 只在目标链是 NEAR 且 `recipient === boundNearAccountId` 时选择 NEAR 直提；
  强制使用 `near` 时 SDK 不复核绑定关系，应用必须先自行验证。
- `collateral` 明确提供 `needDecrease`、`decreaseAmountBurrow`，并按需提供
  `withdrawAll`。

MCA Withdraw 经 relayer：

- `flow` 固定为 `withdraw`。
- `sender` 是 MCA account，`recipient` 是目标链收款地址。
- `executionPreference` 使用 `relayer`。
- `signer` 必须是 MCA 已绑定且当前连接的钱包；执行阶段需要
  `signMessage`。
- `signMessage` 是本地函数，SDK 只把 `chain` 和 `identityKey` 序列化到 raw
  `mca.signer`。

`executionPreference` 和 `boundNearAccountId` 只参与 SDK 本地执行模式选择，不会进入
raw/HTTP quote 请求。直接调用 `quoteRaw()` 的调用方需要自行根据响应中的
`nearMcaWithdrawTx` 或 `mcaWithdrawToIntents` 处理后续流程。

`decreaseAmountBurrow` 使用 lending portfolio 的 Burrow decimal balance string，
允许小数点，不应当套用 Token 最小单位换算规则。

## 返回与错误说明

文档说明 `quote()` 返回标准化 `Quote` 或 `McaQuote`，其中 MCA 调用方可根据
`executionMode` 判断 `deposit`、`withdraw-near` 或 `withdraw-relayer`。调用方应把返回的
quote 原样传给 `buildSwap({ quote })` 或 `swap({ quote })`，不手工拼接 build 字段。

常见错误章节至少覆盖：

- 混用 SDK `ChainRef` 与 raw API chain ID。
- 使用 UI 专用的 `mca:` asset key 作为 Token address。
- 使用可产生精度损失的 JavaScript number 传金额。
- 把 `slippageBps: 50` 或 raw `slippage: 50` 错写成百分比值 `0.5`。
- 普通 Swap 错传 `mca`。
- MCA 请求缺少 signer identity 或 collateral 决策。
- NEAR 直提时 `recipient` 与 `boundNearAccountId` 不一致。
- 将 `signMessage` 函数误认为会被发送到服务器。

## 验证方案

实施完成后执行以下检查：

1. 对照公开类型和两个 serializer，逐项核对字段名、必填性和转换规则。
2. 对照 `tests/normalizers/quote.test.ts` 与 `tests/mca/quote.test.ts` 核对示例值。
3. 运行项目类型检查和测试。
4. 搜索文档中的旧字段、占位符和互相矛盾的金额/滑点说明。
5. 检查 README 链接能解析到 `docs/QUOTE.md`。

## 非目标

- 不改变 SDK 类型、序列化或运行时行为。
- 不新增 API endpoint。
- 不承诺任意 Token pair 一定存在可执行路由。
- 不重复 executor、wallet adapter 或完整 MCA 生命周期的实现说明。
