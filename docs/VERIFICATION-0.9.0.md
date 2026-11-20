# Avatar Studio 0.9.0 · 验证报告与实测边界

## 1. 运行环境与探测实况（Windows）

| 检查项 | 本轮实际观测结果 |
| --- | --- |
| Node.js | `v24.19.0` |
| Python（AST / `symtable` 校验） | `Python 3.13.0` |
| 系统 `PATH` 及常见目录中的 `blender` | 未检出（`Get-Command blender` 退出码 `1`，沙箱 `PATH` 与 `C:\Program Files\Blender Foundation`、`C:\Program Files (x86)\Steam\steamapps\common\Blender` 均未发现 `blender`；本轮仅运行自动化契约、AST/符号表及 Mock/回环 HTTP 测试） |
| `127.0.0.1:9877` / `39877` 伴随端口 | 未针对外部进程实机联调（以确定性 Mock companion 覆盖协议与负载契约） |

## 2. 可重复自动化校验结果

1. **`npm run build:client`**：退出码 `0`（`Built offline Three.js / VRM viewport into the lazy DSH client factory`）。
2. **`npm run check`**：退出码 `0`（`Python AST: 10 generated scripts passed`；`JavaScript syntax: 61 files passed; package resource paths passed`，含 `assets/motions/cleanroom_walk_loop.vrma` 校验、`package.json`/`PLUGIN_VERSION`/`CLIENT_VERSION = '0.9.0'` 与 `lib/client.js` 一致性、`locale/en.json` 零 CJK 校验）。
3. **Python `symtable` 全局符号表扫描**：覆盖 3 个 `.py` 文件（`studio-pipeline.py`、`inspect-foundation.py`、`render-studio.py`）与 5 个 `cleanroom-scripts.js` 生成阶段脚本，**8/8 全部 `ast=OK, undef=[]`（0 个未定义全局符号）**。
4. **`npm test`**：
   - 沙箱内执行：共 **114** 项测试，**102** 项通过，**11** 项失败（全部 11 项均为沙箱禁止本地回环连接导致的 `connect EACCES 127.0.0.1:*`），**1** 项跳过（非提权 Windows 环境下预期的符号链接权限跳过）。
   - 非沙箱执行（`BypassSandbox: true`，允许本机回环 HTTP）：退出码 `0`，**共 114 项测试，113 项通过，0 项失败，1 项跳过**（`P1 realpath protects asset reads against project symlink escape # Windows symlink privilege unavailable`，耗时 `2709.0788ms`）。
5. **发布打包与零泄漏校验（`npm pack --ignore-scripts --dry-run --json` / `tar -tf` / `git status --ignored -s`）**：
   - 本文档定稿前 `npm pack` 清单校验包含 **95 个文件**（含 `assets/motions/cleanroom_walk_loop.vrma`、`lib/vrm/metadata-patcher.js`、`docs/VERIFICATION-0.9.0.md` 等），确认 **0 个** `docs/HANDOFF-NEXT-AI.md`（在 `git status --ignored -s` 中为 `!!` 忽略）、`swarm/`、`scripts/generate-builtin-vrma.mjs` 或私有 `.blend`/`.vrm`/`.png` 资产泄漏；最终定稿后输出至 `releases/dsh-charakuru-studio-0.9.0.tgz` 的实际字节数、SHA-1 与 SHA-256 由发布打包校验步骤基于定稿文件实测输出，不在此处硬编码本文档定稿前的旧包哈希。

## 3. `v0.9.0` 新增修复与验证矩阵

| 模块 | 覆盖范围（自动化单测 + 静态契约 / AST / 符号表校验 + Mock 伴随 / 回环 HTTP） | 对应测试文件 |
| --- | --- | --- |
| **Clean-Room 5 项核心缺陷修复** | `headless_body` 不再被误判为头部、`fix_mixamo_pinky_drift` 可达性与左右腿 X 符号隔离、Blender `-Y` 前向裙摆锚点角度（`angle=0` 为 `0°`）、真实 VRM 1.0 `spring_bone1` 配置、`preset.happy` 绑定双眼与 `mouth_smile` + 全部 23 表情键及发/脸包围盒分离 | `tests/phase4-v090.test.mjs`, `scripts/check.mjs` |
| **GLB 2.0 VRM 元数据修补器与无 Agent 导出** | `lib/vrm/metadata-patcher.js` `inspectVrmMetadata` / `patchVrmMetadata` 往返修补与 BIN 块逐字节保真校验、畸形/非 VRM 1.0 拒绝、`POST /studio/vrm/export-meta` 回环路由 | `tests/phase4-v090.test.mjs` |
| **内置 MIT/CC0 VRMA 与回环路由** | `assets/motions/cleanroom_walk_loop.vrma` 二进制校验（GLB 2.0 + `VRMC_vrm_animation` 1.0 + 15 人形骨与通道）及 `GET /studio/motions/builtin` 回环路由 | `tests/phase4-v090.test.mjs`, `scripts/check.mjs` |
| **25 项编辑器工序与 Python AST/符号表** | `smart_mesh_retexture`、`apply_mtoon`、`materials` (`'mtoon'`)、`expression_lab`、`physics_oscillation_audit` 参数校验与 Mock 执行；放行 `expressions: 'expression_lab'` 与 `AI_EDIT_INTENTS.expressions`；`studio-pipeline.py` AST + `symtable` 零未定义全局符号 | `tests/phase4-v090.test.mjs`, `tests/phase3-v080.test.mjs`, `tests/editor-budget.test.mjs` |
| **前端工作台 `0.9.0` 与零 CJK 审计** | `package.json`（含 `"assets"`）、`lib/constants.js`、`src/client-shell.js`（`CLIENT_VERSION = '0.9.0'`，数组形式 `inject`）、`locale/*.json` 升级至 `0.9.0`；3D 世界空间三视图、`Y=0` 身高标尺、头身比/颈缩放撤销重做、内置漫步 VRMA 选项、物理 ON/OFF 触发、Expression Lab 与无 Agent VRM 元数据导出面板在英文模式下零 CJK | `tests/client-panel.test.mjs` |

## 4. 诚实边界（本轮未实机验证项 — 严禁误判为已完成）

1. **真实 Blender 4.2 LTS / 5.x + `dsh-blender-plugin` 实机运行**：本机沙箱未检出 `blender` 二进制，所有 Blender 建模工序（含 Smart Mesh 4K 烘焙、MToon 节点、Expression Lab 形态键与 SpringBone ON/OFF 振荡）均仅通过 Python AST/`symtable` 静态校验与确定性 Mock companion 验证，真机执行结果仍需独立实测。
2. **真实 DSH Electron / Web 窗口与外部 VRM 查看器视觉回归**：未在运行中的 DSH 桌面端/网页端截取 3D 三视图平面、`Y=0` 身高标尺、内置漫步 VRMA 动画或导出 VRM 元数据后的外部查看器实机画面。
3. **外部云端图像驱动与 Tripo OpenAPI v3 付费调用**：未向外部供应商发送真实付费请求。
