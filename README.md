# Avatar Studio for DSH

**0.7.0 · 实验版。** 这是一个独立的 DSH 角色制作工作台（包名 `dsh-charakuru-studio`），面向同机 DSH Desktop（`dsh-app://app`）与同机 DSH Web（`http://127.0.0.1:*` / `http://localhost:*` / `http://[::1]:*`）提供从 2D 设定或本地素体到 VRM 1.0 的人机协作流水线。不打开、内嵌或代理原版 Charakuru，也不随包分发任何第三方专有模型。

## 核心架构（v0.7.0）

- **3 主工作区 + 1 全局设置抽屉**：
  - **主工作台（Workbench）**：Canvas-First 布局，整合路线切换（01 原画重建 / 02 素体改型）、6 关进度条、Three.js / VRM 1.0 离线视口（正侧背相机、参考叠图、VRMA 步行探针）与右侧精简检查器（当前主行动卡、AI 协作与 Blender 通道选择卡、阶段验收卡），底层哈希与原始 JSON 收纳进折叠「技术详情」。
  - **独立渲染台（Render Lab）**：锁定不可变 Blend 修订，由 DSH 会话内的 Agent 拟定镜头与受界打光配方（`charakuru_render`），在本机 Blender Eevee 出图并支持历史记录查询（`action="list"`）与独立审阅。
  - **资产库（Asset Library）**：统一管理原画、11 视图、Tripo 候选、素体、衣/发/饰、贴图与 VRMA 动作，同时支持 Desktop 原生路径桥与同机 Web 二进制上传。
  - **全局设置抽屉（Settings Drawer）**：集中管理 15 条 AA v2.1 图像模型与逐槽提示词模板、6 家云服务凭据与跨工程预算账本、Tripo 双通道、Blender 双通道诊断及同机 Web 本地目录浏览/新建（`/studio/fs/browse`、`/studio/fs/mkdir`）。
- **浅/深双主题自适应与全量 i18n**：全面跟随 DSH 主题变量（`--dsw-alias-*`），仅在 3D 视口与图像预览画布保留深色中性底；实现英文模式零中文字符（Zero CJK Leak）全覆盖。
- **Blender 双通道混合架构（`dsh-blender-plugin` × Agent Computer-Use）**：
  - **通道 1（插件契约层）**：对接 `sixtysevenlf/dsh-blender-plugin`（3.0.6 `9877` 与 3.1 Gateway `39877`），支持 `/host/scene-items` 实时对象检索、17 项结构化建模工序（含欧拉角 `rotation`、求值表面 `transfer_weights`、刚性骨绑定豁免审计、VRM-first 扩展自动发现）及 Headless / GUI `/act` 执行。
  - **通道 2（Computer-Use GUI 签出/签入）**：通过 `checkout_gui` 将不可变修订签出至隔离工作副本 `editor/working/<id>/scene.blend` 供桌面 Blender GUI 自由精修，完成后经 `checkin_gui` 自动打包贴图、导出 `preview.glb` / `avatar.vrm`、运行结构审计并固化为新修订（或通过 `abort_gui` 安全放弃）。
- **Tripo 双通道架构（OpenAPI v3 × 多视角浏览器工单）**：
  - **通道 A（OpenAPI v3）**：支持 `GET /v3/account/balance` 独立余额查询、`image_to_model` / `multiview_to_model` 及后处理任务提交与轮询、参数陷阱防呆拦截、5 分钟签名 URL 即时流式下载归档，以及 `account-budget.js` 预留/结算/未明对账联动。
  - **通道 B（浏览器多视角工单）**：路线 1 绑定 4 张已审视图，路线 2 支持绑定 **1–4 张**同部件多视角参考 PNG（`referenceMaterialIds`）；`confirm_quote` 直接返回 `inbox` 回收目录，并支持同机 Web 二进制直接上传 `.glb`/`.fbx` 候选（`POST /studio/tripo/studio/upload`）。

## 六关全流程与双路线门禁

1. **`1_concept`（原画与设定）**：登记工程内参考图（或纯文生图设定）、角色外观描述与预算上限。
2. **`2_views`（拆件图 / 素体规划）**：原画路线生成或导入头部四视图、身体四视图与三张全身比例参考图（共 11 槽）；素体路线登记并采用 `foundation_body`（及可选 `foundation_head`）并规划衣/发/饰部件。
3. **`3_tripo`（3D 候选生成与选定）**：通过 Tripo OpenAPI v3 或浏览器工单归档自包含 GLB 候选，在视口预览后显式采用。
4. **`4_assembly`（装配与比例）**：导入检查点或素体，执行 `fit_foundation`、`append_foundation_head`、`append_material_mesh`、`transform`（含 `rotation`）与 `audit`，绑定活动修订指纹送审。
5. **`5_rig_spring`（权重、弹簧与姿态探针）**：执行 `transfer_weights`、`normalize_weights`、`configure_vrm`、`spring_setup` 与 `pose_check`，确认 `gates.weights` 通过后送审。
6. **`6_expressions_vrm`（VRM 1.0 导出与复核）**：核对作者与许可元数据，执行 `export_vrm` 产出 VRM 1.0 并自动同步 `vrmMetadata.exportedVrmPath`，结合 VRMA 步行探针与外部查看器完成终审。

**全 6 关均支持哈希绑定的人工审阅**（`request_review` → 工作台批准或退回 → `reopen_stage`）。

## 生图驱动与费用门禁

| 驱动选项 | 适配能力 | 默认安全边界 |
| --- | --- | --- |
| Qwen-Image-2.1 Local / Diffusers | 本地兼容端点文生图；导出离线 Diffusers 参考图编辑脚本 | 导出脚本不自动执行 |
| Qwen-Image-2.1 ComfyUI Edit | 校验并执行单参考图 ComfyUI 工作流（支持 GGUF / LoRA / 缩放节点与 subfolder） | 需本机配置 `comfyuiQwenWorkflowPath` 与权重 |
| Anima Base / Aesthetic / Turbo | 本机 ComfyUI 文生图工作流（16 倍数分辨率校验，按分支匹配 sampler/CFG） | 内置图仅用于文生图 |
| NovelAI V5 / V4.5 | V5 文生图（支持动态/自定 seed）；V4.5 Precise Reference 参考图自动安全缩放填充 | 需用户显式确认云端单槽执行 |
| OpenAI / Google Gemini / 火山方舟 | `gpt-image-*` 原生透明背景、`nano-banana-2.1` 多格式转 PNG、`seedream-5.5` 无水印比例适配 | `allowCloudExecution` 默认关闭；单槽确认后调用 |
| 自配网关 (`openai_compat`) & AA 榜单 | 支持同机回环 `http://` 与远端 `https://` 兼容网关；收录 15 条 AA v2.1 模型目录 | 超时保留 `requestId` 对账，禁止换 ID 自动重发 |

详细文档见：[使用指南](docs/WORKBENCH-0.6.1.md) · [建模与双通道工序](docs/OPERATIONS.md) · [安装、升级与卸载](docs/INSTALL-WINDOWS.md) · [0.7.0 验证报告](docs/VERIFICATION-0.7.0.md) · [0.6.0 历史验证](docs/VERIFICATION-0.6.0.md)。

## 安装与开发验证

目标环境：DSH `0.2.2-rc.3` / Node `22+`。请从 DSH 应用「插件 → 添加插件」选择本地 `dsh-charakuru-studio-0.7.0.tgz` 安装并启用（**切勿**对 `desktop` profile 运行 CLI `dsh plugin --profile desktop ...` 命令）。工作台默认回环端口为 `9886`，配合 `dsh-blender-plugin`（`9877` legacy 或 `39877` Gateway）、Blender 4.2 LTS / 5.x 及官方 VRM Add-on 使用。

```bash
npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build:client
npm run check
npm test
```

修改 `src/client-*.js`、`src/client-workbench.css` 或 `lib/client-preview.js` 后须运行 `npm run build:client` 更新 `lib/client.js`。内置离线 Three.js / `@pixiv/three-vrm` / `@pixiv/three-vrm-animation` 许可证见 [NOTICE](NOTICE)。
