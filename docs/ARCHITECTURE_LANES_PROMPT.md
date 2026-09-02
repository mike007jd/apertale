# Apertale 架构加深 · 多 lane 执行 prompt（第五轮）

> 用法：新 session 中 `@docs/ARCHITECTURE_LANES_PROMPT.md`。
> 来源：2026-09-02 架构审查（8 个加深候选）+ ponytail 审计（22 项裁剪）。第一轮（两波五 lane）已于同日合入 main（`05eaad1..2fc00ef`，13 个提交）。第二轮（Lane F–I）、第三轮（Lane J、K）、第四轮（Lane L、M）与第五轮（Lane N）也已合入。本文件是第六轮的 handoff，已内含全部结论，不依赖外部报告。

## 你的角色

你是编排者。你不直接改代码；你为每个 lane 启动一个 `isolation: "worktree"` 的子代理（subagent_type `general-purpose`，model `opus`），把该 lane 的完整文本加「全局规则」作为 prompt 发给它，同一波的 lane 在一条消息里并行启动，等全部返回后按合并顺序合并、验证、汇报。项目提交历史里已有 `worktree-agent-*` 分支合并的惯例，沿用它。合并完成后 `git worktree remove --force` 并 `git branch -d`。

## 开始前必做：worktree 基线

`isolation: "worktree"` 从 **`origin/main`** 建分支，不是本地 main。第一轮五个 lane 全部落后本地 main 13 个提交，一个 lane 因此找不到刚合入的文件。二选一：
- 启动前 `git push origin main`（需用户点头；本仓库 main 平时不 push）；或
- 每个 lane prompt 的第 0 步写明：`在 worktree 里先 git merge main（本地分支），再开始`。默认用这条。

## 沿用的决策（用户未改口则按此执行）

1. **2D fallback（FallbackBook.tsx）保留。** `app/AGENTS.md` 明文要求「preserving the 2D fallback and reduced-motion path」。
2. **publish reconcile / resume 状态机保留。** `app/src/publishingClient.ts` 的 reconcile 路由涉及 share-token 复用。

## 全局规则（每个 lane 的 prompt 都要原样包含）

- 第 0 步：在 worktree 里 `git merge main`，然后 `npm test` 记录起始用例数（当前 main：33 文件 / 361 用例；`test:sites` 46）。
- 工作目录 `app/`。改任何函数、类、方法前先运行 GitNexus `impact({target, direction: "upstream"})`；提交前运行 `detect_changes()`。这是根目录 `AGENTS.md` 的硬要求。索引落后于重构时以 grep 为准并在报告里注明；`detect_changes` 会因行位移报出没碰过的符号，列出真实改动的符号即可。
- 验证命令固定为 `npm run typecheck && npm test`。改到 worker 或 scripts 时追加 `npm run test:sites`。`npm run audit:cutouts` 有 41 个已知样本资产失败，不作为门槛。
- 行为不变：所有 lane 都是纯重构。结束时必须能说「测试数量 ≥ 开始时」或明确列出删掉了哪些测试以及为什么它们是重复的。
- 只改本 lane「拥有」的文件与区域。需要改「只读」文件时停下，在返回报告里写出需要的改动，由编排者决定。
- 词汇：module / interface / seam / adapter / depth / locality / leverage。域名用根目录 `CONTEXT.md` 的：Page-turn session、Reader shell、WebMCP tool catalog、Asset registry、Creation workshop session、Creation brief readiness、Authoring quality lifecycle、Authoring presentation、Book element grammar、Project artifact、Publishing schema。
- 每个 lane 一次提交（或少量语义提交），提交信息用祈使句描述行为不变的重构，末尾附
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 返回报告格式：改了什么（文件 + 行数增减）、验证命令输出的最后 5 行、跳过了什么以及原因、需要编排者处理的跨 lane 事项、分支名与提交 hash。
- 浏览器验证：端口 5173 被占，用 `npm run dev -- --port 5391`；WebMCP 工具用 Playwright `addInitScript` stub `document.modelContext`（`registerTool` 返回 Promise）直接调用。不可用时用布局测量或断言代替目视，并如实标注。

---

## 第一轮已完成（不要重做）

| Lane | 结果 | 关键产物 |
|---|---|---|
| A · Book element grammar | 合并 | `src/bookElementGrammar.ts` 唯一真源；webmcp parser/schema、engine 校验从它派生；worker 读构建时生成的 `worker/bookElementGrammar.json`（`scripts/sync-book-element-grammar.mjs`，build 时校验新鲜度）；`image/*` 集合与 TOKEN/BOOK_ID 正则并入 |
| C · Reader shell + pageTurn 拆分 | 合并 | `pageDeformation.ts`（纯数学）+ `pageTurnSession.ts`；`readerShell.ts` 的 `useReaderShell` 供 App 与 SharedBookApp 共用；`?openProgress=` / `?motionAudit=` 已删；clamp 统一到 `design/curves.ts` |
| E · 小裁剪 | 合并 8/10 | diagnostics 不再镜像进 DOM；`QUALITY_RUBRIC_VERSION` 并入 `QUALITY_CONTRACT_VERSION`；`deleteBookEverywhere` 内联；9 个死 export 去掉。**第 9、10 项未做**（见下 Lane F） |
| B · 单一 mutation 入口 | 部分 | `revisionConflict()` helper（计数 12→8）；`humanCommand()`；depth/scale 字面量接 grammar。**单一 `mutate` 入口与私有化成对方法未做**（见下「不再追」） |
| D · Presentation protocol | 合并 | `src/authoringPresentation.ts`：`present(request, signal)` + `observe(state)` + `dispose()`，4 成员 adapter；App 的 readiness effect 依赖数组 24 → 2；`authoringSurface.ts` 删除 |

三处刻意的行为差异已合入，用户知情：翻页途中 revision 变化会中止翻页（Lane C，退路是把 `navigationKey` 拆成 `turnKey` / `readinessKey`）；2D fallback 下翻页立即提交；同一 `requestId` 重试时旧超时不再误杀新尝试（Lane D）。

**不再追**：Lane B 的单一 `mutate(command, precondition, actor)` 入口。理由：`dispatchCoordinated(command, source, signal)` 已是该形状（前置条件嵌在 command 的 `expectedDocumentId/expectedRevision`），四个 lifecycle 操作（adoptCreationBrief / beginQualityReview / recordQualityReview / recordRenderEvidence）改成 command 要重写调度核心，upstream impact HIGH，收益只是少一个方法名后缀。若用户仍要，单独开一个 lane，并授权改 `src/webmcp.test.ts` 里两处直接调用 `bookEngine.recordRenderEvidence` 的断言。

---

## 第二轮第一波已完成（2026-09-02 合入 main，不要重做）

| Lane | 结果 | 关键产物 / 偏差 |
|---|---|---|
| F · 卸掉 motion | 合并 | `motion` 依赖已移除；Panel/Toast 常驻 + `data-open` + `@starting-style` / `allow-discrete`；Switch marker 用测量式 `left/width` 过渡；`WorkspaceTransition` 用 `Element.animate`。Reduced Motion 沿用既有 `data-motion="reduced"` 与媒体查询。jsdom / testing-library **保留**（两个组件测试断言的是行为，不是包装标记）。源码净 +1 行，减法在 lock（−67）。`tokens.ts` 的死 `motion` 导出已由编排者删除 |
| G · Creation brief readiness | 合并 | `workshopBookContract(state)` + `PHOTO_USE_CONTRACT` 表是 bookType/photoPolicy 唯一决定点；`buildCreationBrief` 只校验（新增 `supportedBookType` 硬校验）与渲染。`webmcp.ts` 未动：它走的是 `assessCreationReadiness`，不是 `buildCreationBrief` |
| H · Publishing grammar 进 worker | 合并 | 前提修正：worker 侧本无角色 → use 表（那些规则依赖发布边界拿不到的 `StoredAssetMetadata`）。真正重复的是七条 asset-reference 规则的 separation 词汇与消息文本，现为 `BOOK_ASSET_REFERENCE_RULES` → `worker/bookAssetReferenceRules.json`（同步脚本已泛化为双产物）。resting-frame-mismatch 检查从 `validateElement` 移到 `validateBookAssetReferences`，同时违反多条规则时报错顺序可能不同，状态码不变 |

**H 留下的线索**：`worker/bookShareApi.js` 仍手抄 `ELEMENT_KINDS`、`PAGES`、`PROVENANCE`、`PROCEDURAL_ASSET_PATTERN`（worker 的 `^procedural:hotspot:(amber|aqua|jade|rose)$` 比 src 的 `procedural:` 前缀更严，是真实分歧）以及 12 spread / 24 element 上限；真源在 `src/types.ts`，应并入 Book element grammar 产物。可作为第二波候选。

---

## 第二轮 · 第一波（已完成，保留作记录）

### Lane F · 卸掉 `motion`（审计 9、10 项，第一轮因跨文件而搁置）

**目标**：`design/primitives.tsx` 的 Panel/Toast/Switch 用 CSS 动效替代 `motion`；`SharedBookApp.tsx` 的 `MotionConfig` 去掉；`package.json` 移除 `motion`；若两个组件测试只断言包装标记，一并删掉 jsdom 与 testing-library。

**拥有的文件**：`src/design/primitives.tsx`、`src/SharedBookApp.tsx`（只动 `MotionConfig` 三行）、`src/App.tsx`（只动 `motion/react` import 与 `MotionConfig` 若还在；先 grep，第一轮后 App.tsx 已无 `AnimatePresence`）、`src/ElementAgentCard.test.tsx`、`src/workshopControls.test.tsx`、`package.json`、`package-lock.json`、vitest 配置、`src/styles.css`。

**只读**：其它一切。

**证据**：`grep -rn "motion/react" src` → `SharedBookApp.tsx:3`、`design/primitives.tsx:29`；primitives 里 `useReducedMotionConfig` 四处（:61、:129、:172、:209），`AnimatePresence` 一处（:211，Toast）。

**步骤**
1. Panel/Toast 进出场改 CSS `@starting-style` + `transition-behavior: allow-discrete`；Switch 的 `layoutId` 改单元素 `translateX`。Reduced Motion 用 `prefers-reduced-motion` 媒体查询替代 `useReducedMotionConfig`，但 SharedBookApp 目前把 `reducedMotion` 当 prop 传给 `MotionConfig`，先看 prop 从哪来（`?reducedMotion=1` 或系统偏好），保证两条来源都还生效；必要时用一个 `data-reduced-motion` 属性挂在根元素上。
2. `grep -rn "from \"motion" src` 为零后从 package.json 移除 `motion`，`npm install` 更新 lock。
3. 两个组件测试若只断言包装标记就删，并移除 jsdom、@testing-library/react、@testing-library/dom、vitest 的 jsdom environment。否则保留并报告。
4. 浏览器里目视 Toast 进出、Panel 打开关闭、Switch 切换各一次；Reduced Motion 下确认无过渡。

**停止条件**：`npm run typecheck && npm test` 全绿；`git diff --stat` 净减少；`package.json` 无 `motion`。任何一处做不到等价效果就保留 `motion`，报告原因。

---

### Lane G · Creation brief readiness 收编（架构候选 6）

**目标**：`creationWorkshop.ts` 里的 bookType / photoPolicy 推断与 `creationBrief.ts` 的重复校验合成一处，Creation brief readiness 只有一个真源。

**拥有的文件**：`src/creationWorkshop.ts`、`src/creationBrief.ts`、两者的测试、`CONTEXT.md`（仓库根目录）（Creation brief readiness 条目）。`src/App.tsx` 与 `src/webmcp.ts` 里对这两个 module 的调用点只改 import 与调用形式，先 grep 定位并在报告里列出行号。

**只读**：`src/authoringContract.ts`、`src/types.ts`、其余一切。

**证据**：`creationWorkshop.ts:197-215` 从 `state.photoUse` 推 `bookType` 与 `photoPolicy`；`creationBrief.ts:46-87` 的 `invalid()` / `isAuthoringMode` / `normalizeSourceAssets` 与 `buildCreationBrief` 再校验一遍同类字段。开始前用 `context({name: "buildCreationBrief"})` 与 `context({name: 相应 workshop 导出})` 看两边的调用者，确认重复的具体字段。

**步骤**
1. 列出两边对同一概念（authoring mode、photo use、source assets）的校验与推断，逐条标「重复 / 只此一处」。
2. 保留一处，另一处改为调用它。推断结果作为 brief 的输入而不是在 brief 里再推一遍。
3. 测试：两边对同一拒绝的重复断言保留一侧完整、另一侧留一条冒烟。

**停止条件**：`npm run typecheck && npm test` 全绿；报告里给出「重复项 → 去向」表。

---

### Lane H · Publishing grammar 进 worker（架构候选 7）

**目标**：asset-reference 的规则集从 `bookAssetContract.ts` 与 `bookShareApi.js` 两处手抄收成一处，沿 Lane A 的做法用构建时 JSON 产物送进 worker；worker 自己的校验函数保留（信任边界），只共享规则表。

**拥有的文件**：`src/bookAssetContract.ts`（`bookAssetReferenceFindings` :270 起、`bookAssetReferenceIssues` :338、各 `*AssetRoleIssues` :99-245）、`worker/bookShareApi.js`（`validateBookAssetReferences` :259-305、`assertAssetReference` :93）、`scripts/sync-book-element-grammar.mjs`（可扩展成同一脚本产出第二个 JSON，或新建一个仿它）、`scripts/prepare-sites-build.mjs` 的 `jsonModules`、`src/bookAssetContract.test.ts`、`tests/book-sharing.test.mjs`、`CONTEXT.md`（仓库根目录）。

**只读**：`src/bookElementGrammar.ts`（可以 import，不改）、其余一切。

**证据**：先并排读 `bookAssetReferenceFindings` 与 `validateBookAssetReferences`，列出四条规则（cover、full-spread、foreground、frame-sequence / background pair）在两边的表达；只有能表达为数据（角色 → 允许的 use、数量上下限）的部分才共享，逻辑分支留在各自函数里。

**步骤**
1. 把可数据化的规则抽成 `src/bookAssetContract.ts` 导出的一个常量表（或放进 `bookElementGrammar.ts`，若语义上属于同一 grammar）。
2. 同步脚本把它写成 `worker/*.json`，build 时校验新鲜度。
3. `validateBookAssetReferences` 改读该表。
4. 测试去重同 Lane A 第 6 步。

**停止条件**：`npm run typecheck && npm test && npm run test:sites` 全绿；两边不再各有一份角色 → use 的手抄表。

---

## 第二轮第一波合并

顺序：F → G → H。F 最少与他人重叠；G 与 H 都可能碰 `CONTEXT.md`（仓库根目录），手动合并那一个文件。每合一个跑 `npm run typecheck && npm test`；合完 H 跑 `npm run test:sites`。

---

## 第二轮第二波已完成（2026-09-02 合入 main，不要重做）

| Lane | 结果 | 关键产物 / 偏差 |
|---|---|---|
| I · worker 手抄词汇并入 grammar | 合并（`90ffb3a`） | `types.ts` 新增 `BOOK_ELEMENT_KINDS` / `BOOK_PAGES` / `BOOK_PROVENANCE` / `MAX_SPREAD_ELEMENTS` / `PROCEDURAL_ASSET_ID_PATTERN_SOURCE`，`BookElement` 三个联合从它们派生（导出名不变）；grammar 多了 `elementKinds`、`pages`、`provenance`、`spreads {1,12}`、`elementsPerSpread {24}`、`proceduralAsset {prefix, idPatternSource}`；worker 五处常量改读 `bookElementGrammar.json`；`tests/book-sharing.test.mjs` 新增一条 JSON 词汇与 worker 拒绝一致的断言（已验证可失败）。**procedural 分歧刻意保留**：src 侧 `isProceduralAssetId` 仍用前缀（它是分类器，`impact` CRITICAL，外部导入的 `procedural:hotspot:teal` 今天能渲染），worker 仍用四 tone 全匹配；两者现在是 grammar 里并列的两个字段并带注释 |

词汇放在 `types.ts` 而不是 grammar 字面量里，因为 `bookElementGrammar.ts` 已 import `types.ts`，反向会成环。

---

## 第三轮已完成（2026-09-02 合入 main，不要重做）

| Lane | 结果 | 关键产物 / 偏差 |
|---|---|---|
| J · engine / webmcp 内联词汇接 grammar | 合并（`ae96136`） | `bookEngine.ts` 与 `webmcp.ts` 里的 `["left","right"]`、`["embedded","lifted","decoration"]`、`24` / `23` 全部改读已 import 的 `BOOK_ELEMENT_GRAMMAR.pages / .elementKinds / .elementsPerSpread.max`，消息文本与 tool description 用模板插值；`pick(...)` 类型推断未退化。**刻意未动**：`webmcp.ts` 的 `creationBriefSchema.sourceAssets.maxItems: 24`（Creation brief readiness 的素材条数上限，与 spread 元素数同为 24 是巧合；真源是 `creationBrief.ts` 的 `CREATION_SOURCE_ASSET_LIMIT`，可作第四轮小项）和 `evidence.maxItems: 24`（quality evidence 上限） |
| K · sourceAssets 三层校验 | 合并（`1517a2e`，merge `6eb3692`） | 结论：brief 层（抛错）与 contract 层（软阻塞）语义不同，控制流不合并。只有「单条目形状合法」三条规则（是对象 / id 非空 / name 非空）是同一规则两种写法，收成 `authoringContract.ts` 导出的纯谓词 `checkSourceAsset(value)`，返回 `{ok, asset}` 或 `{ok:false, reason}`；`normalizeSourceAssets` 把 reason 映射回原文案，`briefAssets` 照旧丢弃并收 blocker。远程 URL、唯一性、数量上限只在 brief 层；`isStoredAssetId`、已验证 id、≥1 张照片只在 contract 层。`CONTEXT.md` 加了一句。`assessCreationReadiness` upstream impact CRITICAL，签名与 blocker 语义未动 |

第三轮总计 5 文件 +49/−27；测试 361 → 361；`verify:release` 退出码 0。无行为差异。

---

## 第三轮（已完成，保留作记录）

### Lane J · `bookEngine.ts` / `webmcp.ts` 的内联词汇接 grammar

Lane I 的直接后续。证据（main `90ffb3a`）：
```
src/bookEngine.ts:175   !["left", "right"].includes(layer.page)
src/bookEngine.ts:176   !["embedded", "lifted", "decoration"].includes(layer.kind)
src/bookEngine.ts:1502  command.operations.length > 24   （及 :1503 消息文本里的 1–24）
src/bookEngine.ts:1572  elements.length >= 24
src/bookEngine.ts:1596  !["embedded", "lifted", "decoration"].includes(operation.kind)
src/webmcp.ts:303       optionalBoundedNumber(value, "index", 0, 23)
src/webmcp.ts:319       pick(value.page, "page", ["left", "right"] as const)
src/webmcp.ts:333       pick(value.kind, "kind", ["embedded", "lifted", "decoration"] as const)
```
拥有：`src/bookEngine.ts`、`src/webmcp.ts`（只动上述行）、两者测试。只读：`src/types.ts`、`src/bookElementGrammar.ts`（import 即可）。改法：读 `BOOK_ELEMENT_KINDS` / `BOOK_PAGES` / `MAX_SPREAD_ELEMENTS`（或 `BOOK_ELEMENT_GRAMMAR.elementsPerSpread.max`），消息文本用模板插值。`pick(..., as const)` 的类型推断要保住，否则 `as const` 数组换成 grammar 常量时 `kind` 会退化成 `string`。停止条件：`grep -n '"embedded"\|"left", "right"\|\b24\b\|\b23\b' src/bookEngine.ts src/webmcp.ts` 只剩 `kind: "lifted"` 这类默认值赋值；`npm run typecheck && npm test` 全绿。

### Lane K · sourceAssets 三层校验收成两层（Lane G 遗留）

证据：workshop `uniqueAssets`（UI 容量规则，`creationWorkshop.ts`）→ brief `normalizeSourceAssets`（抛错，`creationBrief.ts:57`）→ contract `briefAssets` + `isStoredAssetId`（软阻塞，`authoringContract.ts:103`、`:171-180`）。第一层语义不同不动；看二、三层是否同一规则两种表达。若 `assessCreationReadiness` 的软阻塞语义（收集 blocker 而非抛错）必须保留，只共享「合法 source asset」谓词，不合并控制流。拥有：`src/creationBrief.ts`、`src/authoringContract.ts`、两者测试。只读：`src/webmcp.ts`、`src/App.tsx`。先用 `impact({target:"assessCreationReadiness"})`，它在 WebMCP 信任边界上。

## 第四轮已完成（2026-09-02 合入 main，不要重做）

| Lane | 结果 | 关键产物 / 偏差 |
|---|---|---|
| L · sourceAssets 上限接真源 | 合并（`890b4b7`，merge `f9d5fbe`） | `creationBrief.ts` 的 `CREATION_SOURCE_ASSET_LIMIT` 改为 `export`；`webmcp.ts` 新增 `import { CREATION_SOURCE_ASSET_LIMIT } from "./creationBrief"`（此前 webmcp 只 import authoringContract，未 import creationBrief；creationBrief 只 import authoringContract + types，无环），`creationBriefSchema.sourceAssets.maxItems` 改读它。`evidence.maxItems: 24`（quality evidence 上限）与 `:787` 的 `creationBrief.sourceAssets` locator 字符串未动。测试里的字面量 24 保留（独立确认常量值）。2 文件 +3/−2 |
| M · contract 簇依赖方向图 | 只报告，未合并 | 结论：**`checkSourceAsset` 留在 `authoringContract.ts`**。消费者只有 `briefAssets`（同文件）与 `creationBrief.ts` 的 `normalizeSourceAssets`；依赖 `briefString` / `CreationSourceAsset` / `SourceAssetRejection` 全在 authoringContract；移到 creationBrief 会让 authoringContract 反向 import 产生运行时环，移到 types 会把现有 type-only 环升级成运行时环。`assessCreationReadiness` upstream CRITICAL（17 符号 / 8 flow / 5 直接调用者），不做无收益手术。**不开 lane** |

Lane M 的依赖图要点（grep 为准，GitNexus 索引未含第三轮符号）：

- 分层：L0 `types` / `interaction` / `assetId` → L1 `bookElementGrammar` / `authoringContract` → L2 `bookAssetContract` / `creationBrief` / `projectArtifact` / `assetStore` → L3 `qualityContract` → L4 `qualityLifecycle` / `creationWorkshop` / `authoringPresentation` / `publishingClient` → L5 `bookEngine` / `webmcp` / `App` / `workshopControls`。没有 `publishingSchema.ts`，Publishing schema 本体在 `worker/` 与同步脚本生成物里。
- 唯一的环：`types.ts:1` `import type { CreationBriefPayload, CreationReadinessAssessment } from "./authoringContract"`，type-only，编译期擦除；`types.ts:207/:240` 两个 command-result 类型需要它，反向搬会成运行时环。**保留**，建议在 types.ts 顶部加一行注释说明这是刻意的 type-only 边。
- **两条真反向边**：`assetStore.ts:6` 与 `bookAssetContract.ts:4` 各自从 `authoringContract` 拿的**唯一一项**是 `MAX_BOOK_PUBLISHABLE_ASSETS`。它与 `MAX_BOOK_SPREADS` / `MAX_SPREAD_ELEMENTS` 同类，第一轮把那两个放进 `types.ts` 时漏了这个。这是第五轮 Lane N（见下）。
- 单一消费者的文件（locality 好，不动）：`creationBrief`→creationWorkshop；`qualityLifecycle`→bookEngine；`authoringPresentation`→App。
- 生产代码零外部消费者的导出：`authoringContract.ts` 的 `AUTHORING_HARD_GATE_IDS` / `PHOTO_TRUTH_REQUIREMENT` / `authoringHardGates`（`:290/:306/:412`，只为测试可见）与 `SourceAssetRejection`（`:103`）。

第四轮总计 2 文件 +3/−2；测试 361 → 361；`verify:release` 退出码 0。无行为差异。

---

## 第五轮已完成（2026-09-02 合入 main，不要重做）

| Lane | 结果 | 关键产物 / 偏差 |
|---|---|---|
| N · `MAX_BOOK_PUBLISHABLE_ASSETS` 下沉 | 合并（`25b2059`） | 常量定义（含 doc comment）移到 `types.ts`，紧挨 `MAX_BOOK_SPREADS`；`authoringContract.ts` 改从 `./types` 取，**未 re-export**；`assetStore.ts:6` 与 `bookAssetContract.ts:4` 两条反向边整行删除，其余 7 个消费者（含两个测试）并入各自已有的 `./types` import；`SourceAssetRejection` 去掉 `export`；`types.ts:1` 上方加两行注释说明 type-only 边是刻意保留的。GitNexus `impact` 对常量引用边返回 0，以 grep 为准。11 文件 +17/−20 |

**顺带评估、决定不做**：「above the publishable limit of N」文案实为 6 处（`bookAssetContract.ts:411`、`qualityContract.ts:271`、`bookEngine.ts:1426/1657/1765`、`webmcp.ts:1066`），共享后缀但主语各异。构造器能保住逐字文本，但 helper 本体 + 4 条新 import 大于 5 处各省的不到一行，净行数增加；且 helper 放任何 module 都给四个消费者引入新的跨 module 边，正好抵消本 lane 删掉的两条。**不开 lane**。

第五轮总计 11 文件 +17/−20；测试 361 → 361；`verify:release` 退出码 0。无行为差异。

---

## 第五轮（已完成，保留作记录）

### Lane N · `MAX_BOOK_PUBLISHABLE_ASSETS` 下沉到 `types.ts`（Lane M 建议，值得开）

**目标**：把 `MAX_BOOK_PUBLISHABLE_ASSETS` 从 `src/authoringContract.ts` 下沉到 `src/types.ts`，与 `MAX_BOOK_SPREADS` / `MAX_SPREAD_ELEMENTS` 并列；删除 `assetStore.ts → authoringContract.ts` 与 `bookAssetContract.ts → authoringContract.ts` 这两条只为一个常量存在的反向边。顺带删 `authoringContract.ts:103` `SourceAssetRejection` 的 `export`（外部零引用，`checkSourceAsset` 返回类型是结构化推导的）。

**拥有的文件**：`src/types.ts`、`src/authoringContract.ts`、`src/assetStore.ts`、`src/bookAssetContract.ts`、`src/creationBrief.ts`、`src/qualityContract.ts`、`src/bookEngine.ts`、`src/webmcp.ts`、`src/App.tsx` 中**仅限 import 语句与该常量的引用行**，及对应 `*.test.ts` 的 import 行（`qualityContract.test.ts`、`authoringContract.test.ts` 有引用）。

**只读**：`worker/`、`scripts/`、`site-manifest.json`，上述文件的其它逻辑。

**证据**（main `f9d5fbe`）：`grep -rln MAX_BOOK_PUBLISHABLE_ASSETS app/src` → App.tsx、assetStore.ts、webmcp.ts、qualityContract(.test).ts、authoringContract(.test).ts、bookEngine.ts、bookAssetContract.ts、creationBrief.ts；`app/scripts` 与 `app/worker` 零引用。

**步骤**
1. 第 0 步。`impact({target: "MAX_BOOK_PUBLISHABLE_ASSETS", direction: "upstream"})`，索引落后以 grep 为准。
2. 常量定义（含 doc comment，与 `MAX_BOOK_SPREADS` 同风格）移到 `types.ts`；`authoringContract.ts` 改为从 `./types` import（它已从 types 取 `MOTION_PRESETS`，不新增边）。
3. `assetStore.ts:6`、`bookAssetContract.ts:4` **整行删除**并改从 `./types` 取；其余消费者并入各自已有的 `./types` import。
4. **不要**在 `authoringContract.ts` re-export，否则边留在原地。
5. 删 `SourceAssetRejection` 的 `export`。
6. `npm run typecheck && npm test`；不改 worker/scripts 时跳过 `test:sites`。

**停止条件**：`grep -n "from \"./authoringContract\"" app/src/assetStore.ts app/src/bookAssetContract.ts` 为空；typecheck + test 全绿，用例数 ≥ 361；一次提交。若 typecheck 暴露 `types.ts` 因此出现新的运行时环，停下报告，不要强行绕。

## 第六轮候选

### 其它候选（Lane M 顺带发现，每条一行，无新证据默认不启动）

- `authoringContract.ts:290/:306/:412` 三个只为测试 export 的符号：改为通过 `buildAuthoringGuide()` 输出断言后去掉 export。
- `authoringContract.ts:387` `creationReportRequirements` 唯一生产消费者是 `creationBrief.ts`，可下沉，但会带走 `AuthoringCountSpec`，先评估。
- `assetStore.ts:2` 从 `bookElementGrammar` 取 `SUPPORTED_IMAGE_TYPES`：Asset registry 依赖 Book element grammar，该常量本质是封闭词汇，可与 Lane N 合并评估是否下沉到 types。
- 同一条去重/上限规则四段近似自然语言（`authoringContract.ts:266/:377/:444`、`creationBrief.ts:186`），prompt 文案层重复，可单独一个 lane 统一。

### 仍待定（无新证据，默认不启动）

- **候选 4(b)** ThreeBook 命令式 scene controller：拥有 `src/ThreeBook.tsx` 与 `src/readerShell.ts`，只读 `bookEngine.ts`。先 `impact` 看 `ThreeBook` props 上游。
- **候选 8** Asset registry keyed lease set：只在 lease 泄漏真的出现时做。
- Lane F 留下的 Switch marker 亚像素差（`offsetLeft` 整数 vs 原 `inset:0` 的 77.47）：视觉不可见，不追。

## 最终汇报

按 lane 列：合并了 / 跳过了 / 需要用户决策；`git diff <起点> --stat` 总计；`npm run verify:release` 最后 10 行原样贴出；测试数量前后对比（第六轮起点 33 / 361，`test:sites` 46）；任何刻意的行为差异单列。
