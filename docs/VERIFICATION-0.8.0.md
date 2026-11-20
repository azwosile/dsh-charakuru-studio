# Avatar Studio 0.8.0 · 验证报告与实测边界

## 1. 运行环境与探测实况（Windows）

| 检查项 | 本轮实际观测结果 |
| --- | --- |
| Node.js | `v24.19.0` |
| Python（AST / `symtable` 校验） | `Python 3.13.0` |
| 系统 `PATH` 及常见目录中的 `blender` | 未检出（`PATH`、常见系统/用户安装目录、Steam、注册表、`scoop` 与 `chocolatey` 均未发现 `blender`；本轮仅运行自动化契约、AST/符号表及 Mock/回环 HTTP 测试） |
| `127.0.0.1:9877` (legacy 3.0.6 companion) | 未监听（`Get-NetTCPConnection -LocalPort 9877 -State Listen` 为空） |
| `127.0.0.1:39877` (Gateway 3.1 companion) | 未监听（`Get-NetTCPConnection -LocalPort 39877 -State Listen` 为空） |

## 2. 可重复自动化校验结果

以下结果均为修复 `lib/blender/studio-pipeline.py` 第 426 行 `src_weights = []` 初始化并完成全部代码与测试合入后实测所得：

1. **`npm run build:client`**：退出码 `0`（成功构建离线 Three.js / `@pixiv/three-vrm` / `@pixiv/three-vrm-animation` 视口并写入懒加载 DSH 客户端模块 `lib/client.js`）。
2. **`npm run check`**（沙箱内执行）：退出码 `0`：
   - JavaScript / ESM 语法检查（`node --check`）：**58 个文件全部通过**。
   - Python 脚本 AST 校验（含 `studio-pipeline.py`、`render-studio.py`、`inspect-foundation.py`、5 个 Clean-Room 阶段脚本及 2 份 Qwen Diffusers 脚本）：**10 个脚本全部通过**。
   - Python `symtable` 全局符号表扫描（`studio-pipeline.py`、`inspect-foundation.py`、`render-studio.py`）：**0 个未定义全局符号**。
   - 版本与资源一致性校验：`package.json` (`0.8.0`)、`lib/constants.js` (`PLUGIN_VERSION = '0.8.0'`)、`src/client-shell.js` (`CLIENT_VERSION = '0.8.0'`) 与 `lib/client.js` 源码逐字节同步校验通过；`locale/en.json` 零 CJK 字符校验与 `docs/DETAIL.en.md` / `docs/DETAIL.zh.md` 路径校验通过。
3. **`npm test`**：
   - 沙箱内执行：共 **109** 项测试，98 项通过，10 项失败（全部 10 项均为沙箱禁止本地回环连接导致的 `connect EACCES 127.0.0.1:*`），1 项跳过（非提权 Windows 环境下预期的符号链接权限跳过）。
   - 非沙箱执行（允许本机回环 HTTP）：**共 109 项测试，108 项通过，0 项失败，1 项跳过**（`P1 realpath protects asset reads against project symlink escape # Windows symlink privilege unavailable`）。
4. **`npm pack --ignore-scripts --dry-run --json`**（本文档定稿前打包清单核验）：生成 `dsh-charakuru-studio-0.8.0.tgz` 清单（**91 个文件**），确认包内 **0 个** `.blend`/`.vrm`/`.glb`/`.fbx`/私有 `.png`、0 份内部交接草稿、0 条本机个人路径与 0 项密钥；最终输出至 `releases/dsh-charakuru-studio-0.8.0.tgz` 的实际包大小与 `shasum` 由发布打包阶段基于定稿文件实测记录，不在此处预填文档修改前的旧包摘要。

## 3. `v0.8.0` 新增修复与验证矩阵

| 模块 | 覆盖范围（自动化单测 + 静态契约 / AST / 符号表校验 + Mock 伴随 / 回环 HTTP） | 对应测试文件 |
| --- | --- | --- |
| **Cordis 4 服务解析与 Anima 16 倍数** | 保持 `inject` 为数组形式，`resolveCordisService` 优先走 `ctx.get(...)` 并容错回退，严格 Cordis-4 Proxy 回归测试（含 `webServer` 存在与缺失两种情况，零 `cannot get property "webServer" without inject` 报错）；Anima 在 `image-profiles.js` 与 `buildAnimaComfyWorkflow` 双端强制 16 的倍数（`512x768` 通过、`520x768` / `999` 拒绝） | `tests/lifecycle.test.mjs`, `tests/phase3-v080.test.mjs`, `tests/providers.test.mjs` |
| **Route 2 素体全栈编辑工序** | `AI_EDIT_INTENTS` 扩展（`foundation_fit`、`foundation_head`、`placement`、`rigging`、`general`、`delivery`）；`fit_foundation` 支持正负 `shapeValues` (`[-10..10]`)、多网格 `mesh`/`syncMeshes`、C1 连续 `regionScaling` 与 `applyScale`（清理 `Studio_FoundationFit*`）；`append_foundation_head` 支持 `snapNeckRim` / `preserveFacialBones` 及供体 `inspect-foundation.py` 扩展字段；新增 `normalize_material_mesh`（`.fbx`/Draco GLB 标准化与未压缩 `normalized.glb` 校验）、`fit_garment`、`audit_penetration`、`rigid_attach` 参数边界校验与 Mock 执行；`spring_setup` 严格 `params.skirt`（`excludeVertexGroups`、`minRadius`/`maxRadius`、`frontStiffnessMultiplier`、`mode`）与顶层 `mode`；`pose_check`（`poses`、`highKickDeg`、`boneMap`、`captureScreenshots` 与 0-骨失败阻断）；Python `symtable` 验证 `_build_surface_weight_sampler` 等全函数无未定义符号 | `tests/phase3-v080.test.mjs`, `tests/workflow-render.test.mjs`, `tests/editor-budget.test.mjs` |
| **NPR 渲染台与 Blender 4.2–5.x 兼容** | `render.js` 支持 `engine` (`eevee`/`cycles`)、`lensType`、`lens`、`dof`、`yawDeg`、`pitchDeg`、`transparent`、`samples`、`frame`、`viewTransform`、`look`、`toonOptions`、`faceSdfMaterialId`（校验工程 `.png` 并转发 `faceSdfPath`）、`passes`、`hd1080`/`portrait1080`/`uhd4k`/`portrait4k`；未显式传入新字段时不注入默认键；`transport.js` 向 `/headless` 与 Gateway `/job` 转发 `engine`；`render-studio.py` 静态/AST 检查（`ShaderNodeMix` 替代 `ShaderNodeMixRGB`、`BLENDER_EEVEE_NEXT` + `BLENDER_EEVEE`、`Standard` + `Medium High Contrast`、`Solidify` 描边掩码与 MToon/透明材质保留） | `tests/phase3-v080.test.mjs`, `tests/workflow-render.test.mjs` |
| **前端工作台 `0.8.0` 与零 CJK 审计** | `package.json`、`lib/constants.js`、`src/client-shell.js`、`locale/*.json` 全线升级至 `0.8.0`；`src/client-render.js` 在 `selected.summary` 显示 `engine`、`viewTransform`、`lensType`、`toonMaterials`、`outlineMeshes`、`faceSdfMaterials`；英文模式全 9 标签及渲染摘要行零 CJK 字符泄漏 | `tests/client-panel.test.mjs` |

## 4. 诚实边界（本轮未实机验证项 — 严禁误判为已完成）

1. **真实 Blender 4.2 LTS / 5.x + `dsh-blender-plugin` 实机运行**：本机未检出 `blender` 二进制且 `9877`/`39877` 伴随端口未监听，所有 Blender 建模与渲染测试均使用 Python AST/`symtable` 静态校验与确定性 Mock companion 响应；实际 Blender 内执行 C1 区域变形、`Solidify` 描边、Face SDF 节点与 `BVHTree` 穿模修正在真机环境中仍需独立验收。
2. **真实 DSH Electron / Web 窗口视觉回归**：未在运行中的 DSH 客户端做浅/深主题截屏与真实主机端口联调。
3. **外部云端图像驱动与 Tripo OpenAPI v3 付费调用**：未向外部供应商发送真实付费请求。
4. **外部 VRM 1.0 查看器动作与 SpringBone 物理表现**：高抬腿极限动作、裙摆碰撞和第三方查看器兼容性须结合具体模型资产手工目视验收。
