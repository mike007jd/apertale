# Apertale 架构加深 · 多 lane 执行 prompt（第二轮）

> 用法：新 session 中 `@docs/ARCHITECTURE_LANES_PROMPT.md`。
> 来源：2026-09-02 架构审查（8 个加深候选）+ ponytail 审计（22 项裁剪）。第一轮（两波五 lane）已于同日合入 main（`05eaad1..2fc00ef`，13 个提交）。本文件是第二轮的 handoff，已内含全部结论，不依赖外部报告。

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

- 第 0 步：在 worktree 里 `git merge main`，然后 `npm test` 记录起始用例数（当前 main：33 文件 / 359 用例）。
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

## 第二轮第二波（可选，视第一波结果与用户意愿）

- **候选 4(b)** ThreeBook 命令式 scene controller：Reader shell 已稳定一轮，可以做。拥有 `src/ThreeBook.tsx` 与 `src/readerShell.ts`，只读 `bookEngine.ts`。先用 `impact` 看 `ThreeBook` 的 props 上游。
- **候选 8** Asset registry keyed lease set：只在 lease 泄漏真的出现时做；目前无证据，默认不启动。
- **contract 簇**（types / authoringContract / qualityContract / qualityLifecycle / bookAssetContract / creationBrief / projectArtifact / interaction）方向整理：等 G 与 H 合入后再看依赖方向图，再决定要不要开。

## 最终汇报

按 lane 列：合并了 / 跳过了 / 需要用户决策；`git diff <起点> --stat` 总计；`npm run verify:release` 最后 10 行原样贴出；测试数量前后对比（起点 33 / 359）；任何刻意的行为差异单列。
