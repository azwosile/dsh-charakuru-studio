# Avatar Studio 0.10.0 · 验证报告与实测边界（内部迭代版）

> **定位声明**：`0.10.0` 为实机兼容加固与内部验收预备版本，尚未进入公开分发或对外宣传阶段。

## 1. 运行环境与探测实况（Windows）

| 检查项 | 本轮实际观测结果 |
| --- | --- |
| Node.js | `v24.19.0` |
| Python（AST / `symtable` 校验） | `Python 3.13.0` |
| 系统 `PATH` 及常见目录中的 `blender` | 沙箱内未检出可执行文件（`where.exe blender` 退出码 `1`，`C:\Program Files\Blender Foundation` 与 Steam 目录不存在；仅探测到 `AppData\Roaming\Blender Foundation\Blender\{5.2,5.3}` 扩展缓存目录；本轮以 Python AST / `symtable` 全局符号表、静态兼容契约及确定性 Mock companion 覆盖校验） |
| `127.0.0.1:9877` / `39877` 伴随端口 | `netstat -ano` 未检出监听进程；外部 `@dsh-external/dsh-blender-plugin` 在沙箱下权限受限，未作外部进程实机联调 |

## 2. 可重复自动化校验结果

1. **`npm run build:client`**：退出码 `0`（`Built offline Three.js / VRM viewport into the lazy DSH client factory`）。
2. **`npm run check`**：退出码 `0`（`Python AST: 10 generated scripts passed`；`JavaScript syntax: 62 files passed; package resource paths passed`，含 `assets/motions/cleanroom_walk_loop.vrma` 校验、`package.json`/`PLUGIN_VERSION`/`CLIENT_VERSION = '0.10.0'` 与 `lib/client.js` 逐字节一致性、`locale/en.json` 零 CJK 校验）。
3. **Python `symtable` 全局符号表扫描（已纳入 `tests/phase5-v0100.test.mjs` 自动化单测）**：覆盖全部 3 个 `.py` 文件（`studio-pipeline.py`、`inspect-foundation.py`、`render-studio.py`）与 5 个 `cleanroom-scripts.js` 生成阶段脚本，**8/8 全部 `ast=OK, undef=[]`（0 个未定义全局符号）**。
4. **`npm test`（16 个测试文件，共 124 项测试）**：
   - 沙箱内执行：共 **124** 项测试，**111** 项通过，**12** 项失败（全部 12 项均为沙箱拦截本地回环连接导致的 `connect EACCES 127.0.0.1:*`），**1** 项跳过（非提权 Windows 环境下预期的符号链接权限跳过），**0** 项真实代码或逻辑失败。
   - 非沙箱执行（放行本机回环 HTTP）：退出码 `0`，**共 124 项测试，123 项通过，0 项失败，1 项跳过**（`P1 realpath protects asset reads against project symlink escape # Windows symlink privilege unavailable`，耗时 `2564.8308ms`）。
5. **本地打包与零泄漏校验（`npm pack --ignore-scripts --pack-destination releases` / `tar -tf` / `git status --ignored -s`）**：
   - 输出至 `releases/dsh-charakuru-studio-0.10.0.tgz`（包含 `docs/VERIFICATION-0.10.0.md`、`tests/phase5-v0100.test.mjs` 等白名单文件），确认 **0 个** `docs/HANDOFF-NEXT-AI.md`（在 `git status --ignored -s` 中维持 `!!` 忽略）、`swarm/`、`scripts/generate-builtin-vrma.mjs` 或私有 `.blend`/`.vrm`/`.png` 泄漏；实际包大小、文件总数、SHA-1 与 SHA-256 由定稿打包命令实测核对。

## 3. `v0.10.0` 新增兼容加固与验证矩阵

| 模块 | 覆盖范围（自动化单测 + 静态契约 / AST / 符号表校验 + Mock 伴随 / 真实回环 HTTP） | 对应测试文件 |
| --- | --- | --- |
| **Blender 4.2 LTS / 5.x & VRM Add-on 脚本加固** | `studio-pipeline.py` 修复 `None in arm.data.bones` `TypeError`、`_smart_uv_project_object` 清除 `hide_viewport` + `temp_override`、`fit_garment` 复制笼体清除 `shape_keys` + 单用户网格 + `surfacedeform_bind` 选中/可见性守卫、`_armature_edit_mode` 异常安全上下文、`_set_enum_safely` 大小写无关 VRM 枚举赋值、`BSDF_PRINCIPLED` 按节点类型查找与 `pack_all` 容错；`render-studio.py` 修复 Cycles 反壳描边黑壳（`Geometry.Backfacing` + `MixShader` + `Transparent BSDF`）、多材质槽末尾追加 `material_offset`、跳过已启用 MToon 内置描边网格、VRM 0.x 头部骨骼回退、`Face SDF` `RGBToBW` 连接与 `px_height > 0` 校验；`cleanroom-scripts.js` 显式 `load_ui=False, use_scripts=False`、安全 `ensure_parent_dir`、0 骨骨架保护与 `kb.relative_key`；全部 8 个脚本 AST + `symtable` 0 未定义符号 | `tests/phase5-v0100.test.mjs`, `tests/phase4-v090.test.mjs`, `tests/phase3-v080.test.mjs`, `scripts/check.mjs` |
| **Host 服务端安全、GLB 2.0 UTF-8 边界与 Cordis 4 严格代理** | `lib/host/server.js` 畸形/缺失 `Host` 返回 `403 HOST_DENIED`、全部 5 个 GET 二进制端点统一带 `Referrer-Policy: no-referrer`、JSON 超限返回 `413`、`application/octet-stream; charset=...` 兼容与 `/studio/fs/mkdir` 拒绝尾部点号/空格及 Windows 保留设备名；`lib/vrm/metadata-patcher.js` 多字节 UTF-8（中文/日文/Emoji）`0x20` 4 字节对齐、无 BIN chunk、`extraChunks` 保留与严格拒绝回归；`src/client-shell.js` `safeGetService` 与严格 Cordis 4 `Proxy` 客户端挂载回归 | `tests/phase5-v0100.test.mjs`, `tests/client-panel.test.mjs`, `tests/lifecycle.test.mjs` |
| **3D 视口竞态、UI 门禁、双主题对比度与英文零 CJK** | `lib/client-preview.js` 修复 `rebuildTriViews` 过期 `targetHeightM` 闭包与异步 `fetch` 竞态（`triViewSeq`），VRMA 加载失败保留模型摘要；`src/client-workbench.js` 修复 `DeskVrmMetadataExport` 在活动修订无 VRM 时误传 `revisionId`、`guiCheckout` 期间禁用校准/物理审计/表情工坊按钮、`WorkbenchWorkspace` 补齐 `materialMotionNeedsVrm` 提示；`src/client-workbench.css` 修复激活按钮悬停权重与 `.ck-expr-chip` 深色主题显式文字色；`seedream-5.5` 补齐 `nameEn` 且 `reviews.js` 补齐纯英文 `reasonEn` | `tests/client-panel.test.mjs`, `tests/phase5-v0100.test.mjs` |
| **桥接、Tripo 幂等与 Qwen 采样器修复** | `lib/project/editor.js` `inspectAiEdit` 在 GUI 签出期间允许写回 `donorInspection`；`lib/blender/transport.js` `collectCompanionJob` 键序无关 `caller` 字段比对；`lib/tripo/openapi-client.js` 阻断终态失败/取消的 `requestId` 穿透发起上传或下单并为 `pollTripoOpenApiTask` 绑定 `AbortController` 超时；`lib/providers/comfy-qwen.js` 与 `image-router.js` 防止 `resolution` 泄漏入 `KSampler.inputs` | `tests/phase5-v0100.test.mjs`, `tests/dual-channel-v070.test.mjs`, `tests/native-images.test.mjs` |
| **版本号与文档同步（内部实验版）** | `package.json`、`lib/constants.js`、`src/client-shell.js`、`lib/client.js`、`locale/{en,zh}.json`、`README.md`、`docs/DETAIL.{zh,en}.md`、`docs/OPERATIONS.md`、`docs/INSTALL-WINDOWS.md`、`skills/charakuru-vrm-studio/SKILL.md` 统一升级至 `0.10.0`（保留 `schemaVersion: '1.0.0'` 与 VRM 资产默认 `'1.0.0'`，无公开分发宣传措辞） | `tests/phase5-v0100.test.mjs`, `tests/client-panel.test.mjs`, `scripts/check.mjs` |

## 4. 诚实边界（仍需实机验证 — 严禁误判为已实机通过）

1. **真实 Blender 4.2 LTS / 5.x + `dsh-blender-plugin`（3.0.6 `9877` / 3.1 Gateway `39877`）端到端实机联调**：本轮环境未检测到可执行的本地 `blender` 二进制与活跃伴随服务，所有 Blender 建模、烘焙、MToon、Cycles/EEVEE 反壳描边与 VRM Add-on 实机属性写入结果仍需在安装有真实 Blender 与 VRM Add-on 的主机上完成端到端实测。
2. **DSH Desktop（`dsh-app://app`）与同机 DSH Web 实机安装与视觉回归**：需由用户在 DSH UI 插件管理器手动选择 `releases/dsh-charakuru-studio-0.10.0.tgz` 安装启用（严禁对 `desktop` profile 执行 `dsh plugin --profile desktop ...` CLI 命令），核对浅/深双主题、3D 三视图参考平面与目标身高联动、内置 `builtin:walk` 播放及免 Agent VRM 元数据导出。
3. **真实云端生图 / Tripo OpenAPI v3 实单冒烟与外部 VRM 1.0 查看器验收**：未触发任何外部付费 API 调用，也未在外部 VRM 1.0 查看器（VSeeFace / Warudo / Three-VRM Viewer / UniVRM）中实机检验导出模型。
