# Avatar Studio 0.7.0 · 验证报告与实测边界

## 1. 运行环境与探测实况（Windows）

| 检查项 | 本轮实际观测结果 |
| --- | --- |
| Node.js | `v24.19.0` |
| Python（AST 校验） | `Python 3.13.0` |
| 系统 `PATH` 中的 `blender` | 未在系统 `PATH` 检出（本轮仅运行自动化契约与回环 HTTP 测试） |
| `http://127.0.0.1:9877/health` (legacy 3.0.6 companion) | 请求超时（未运行） |
| `http://127.0.0.1:39877/health` (Gateway 3.1 companion) | 请求超时（未运行） |

## 2. 可重复自动化校验结果

所有命令均在仓库根目录按顺序执行并通过：

1. **`npm run build:client`**：成功构建离线 Three.js / `@pixiv/three-vrm` / `@pixiv/three-vrm-animation` 视口并写入懒加载 DSH 客户端模块 `lib/client.js`。
2. **`npm run check`**：
   - JavaScript / ESM 语法检查（`node --check`）：**57 个文件全部通过**。
   - Python 脚本 AST 校验（含 `studio-pipeline.py`、`render-studio.py`、`inspect-foundation.py`、5 个 Clean-Room 阶段脚本及 2 份 Qwen Diffusers 脚本）：**10 个脚本全部通过**。
   - 版本与资源一致性校验：`package.json` (`0.7.0`)、`lib/constants.js` (`PLUGIN_VERSION = '0.7.0'`)、`src/client-shell.js` (`CLIENT_VERSION = '0.7.0'`) 与 `lib/client.js` 源码逐字节同步校验通过；`locale/en.json` 零中文字符校验与 `docs/DETAIL.en.md` / `docs/DETAIL.zh.md` 路径校验通过。
3. **`npm test`**：**共 98 项测试，97 项通过，0 项失败，1 项跳过**（`tests/p0p1.test.mjs` 中的 Windows 符号链接权限测试在非提权 Windows 环境下按预期 `skip`）。
4. **`npm pack --dry-run --ignore-scripts`**：生成干净的 `dsh-charakuru-studio-0.7.0.tgz` 清单（89 个文件），确认包内 **0 个** `.blend`/`.vrm`/私有 `.png`、0 份内部交接草稿、0 条本机绝对路径与 0 项密钥。

## 3. `v0.7.0` 新增自动化与回环 HTTP 验证矩阵

| 模块 | 已验证覆盖范围（自动化单测 + 真实本机回环 HTTP） | 对应测试文件 |
| --- | --- | --- |
| **前端重构与双语/双端** | 3 主工作区 + 1 全局设置抽屉入口、向后兼容 9 标签导航与键盘焦点环绕、DSH 浅/深主题变量样式、**英文模式全 9 标签深度渲染零 CJK 字符泄漏（`/[\u4e00-\u9fff]/` = 0）**、Tripo 桌面原生路径选择与 Web 二进制上传切换、Web 本机目录浏览按钮、Blender 双通道控制栏及 `0.7.0` 宿主版本锁 | `tests/client-panel.test.mjs` |
| **Blender 双通道混合架构** | `checkout_gui` 拷贝不可变修订至隔离区 `editor/working/<id>/scene.blend` 与 `checkout.lock.json`、签出锁定期间拒绝并发 `editor_operation` / 重复签出、修改工作副本后经 `checkin_gui`（含 `exportVrm=true`）产出带 `channel: 'computer_use'` 的新不可变修订并清理锁文件、保持源修订与原始 `.blend` 不变并支持 `rollbackEditor`、`abort_gui` 释放锁与清理工作副本、`setEditorChannelPreference`、`probeBlenderPluginLink` 查询 `/host/scene-items`（含不支持时的降级容错）、无 `requestId` 只读 `editor_inspect`、`charakuru_render(action='list')` 及全部对应回环 HTTP 路由 | `tests/dual-channel-v070.test.mjs`, `tests/blender.test.mjs`, `tests/editor-budget.test.mjs`, `tests/workflow-render.test.mjs` |
| **Tripo 双通道架构** | `queryTripoOpenApiBalance`（独立余额标记）、`submitTripoOpenApiTask` 参数陷阱拦截（后处理任务禁用 `export_orientation`；`generate_parts=true` 与 `texture`/`pbr`/`quad`/`smart_low_poly` 互斥；`multiview_to_model` 强制 `front` 与 ≥2 视角）、云端与预算门禁（`allowCloudExecution`/`cloudConfirmed`/`reserve`）、轮询 `running` → `success` 时按 5 分钟 URL 规则即时下载（签名链接不携带 `Authorization`）并归档结算、HTTP 400 取消预留、网络异常转 `uncertain` 并阻止换 ID 自动重试；`base_mesh` 1–4 张多视角 `referenceMaterialIds` 网页工单、`confirm_quote` 直接返回 `inbox`、`POST /studio/tripo/studio/upload` 流式上传 `.glb` 与 `.fbx`、以及 `POST /studio/tripo/openapi` 与 `charakuru_tripo_quota` 工具动作 | `tests/dual-channel-v070.test.mjs`, `tests/studio-061.test.mjs`, `tests/materials.test.mjs` |
| **同机 Web 目录浏览与新工具动作** | `POST /studio/fs/browse`（Session 鉴权、`isProject` 识别、拒绝 UNC 路径）与 `POST /studio/fs/mkdir`（安全建目录、拦截路径穿越）；`charakuru_project` 新增 `set_workflow_mode` / `select_foundation` / `plan_tripo_parts` / `import_material`；`charakuru_generate_views` 新增 `preflight` / `get_profile` / `save_profile`；`charakuru_project` 全 6 关证据审阅与状态机 | `tests/dual-channel-v070.test.mjs`, `tests/p0p1.test.mjs`, `tests/core.test.mjs`, `tests/lifecycle.test.mjs` |

## 4. 诚实边界（本轮未实机验证项 — 严禁误判为已完成）

以下项目依赖运行中的外部图形/云端环境，本轮自动化验证未覆盖，需在真实宿主环境中独立验收：

1. **真实 Blender 4.2 LTS / 5.x + `dsh-blender-plugin`（3.0.6 与 3.1 Gateway）实机联调**：本机验证时 `9877` 与 `39877` 伴随服务未启动，因此尚未执行真实 Blender GUI Computer-Use 操作、`checkout_gui` → 手工雕塑/刷权重 → `checkin_gui` 实角闭环、以及 3.1 Gateway 真实队列与会话权限联调。
2. **真实 DSH Electron（`dsh-app://app`）与同机 DSH Web 浏览器视觉回归**：未在运行中的 DSH 窗口中做浅/深主题视觉截屏、Explorer 物理拖拽与 150% DPI 排版实看。
3. **真实云端生图与真实 Tripo OpenAPI v3 / Studio 消费闭环**：所有云端图像驱动与 Tripo OpenAPI v3 均通过本地确定性回环 Mock 验证契约与账本防呆，本轮未向外部厂商发送付费请求。
4. **外部 VRM 1.0 查看器动作与物理验收**：真实角色高抬腿/抬臂穿模检查、SpringBone 物理振荡与第三方 VRM 查看器兼容性需结合实际模型资产单独验收。
