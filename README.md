# Avatar Studio for DSH

独立、本地优先的角色制作工作台。**0.3.2 是实验构建，不是 P2～P5 全量验收完成版。** 原 npm 包名 `dsh-charakuru-studio`、工具 ID 和工程文件名保留，避免破坏升级；显示品牌为 Avatar Studio。项目与 Charakuru、DSH、Tripo 没有官方隶属或背书关系。

## 已提供的工作流

- 独立原画位和 11 槽参考图库、面板内 PNG 预览、PNG/GLB 文件校验、明确头体选择、最近工程与哈希绑定审批。
- 离线打包的 Three.js / three-vrm 视图：材质、纹理、蒙皮、正侧背相机、参考叠图、对象选择。外部模型资源 URL 被阻止，请嵌入 GLB。
- 现有 Blend 独立导入路线：通过 companion 另存不可变版本，头/发联动缩放、对象变换、回滚；不会覆盖源 Blend。
- AI 修改请求记录工程版本、对象、相机与输入哈希。可直接插入当前 DSH 会话草稿，不自动发送；Agent 使用已绑定的结构化工具执行后回到工作台接受或回退。
- 显式材质检查、同项目源网格权重转移、权重归一化、humanoid 映射、SpringBone/胶囊碰撞/裙骨分支、VRM 导出。错误定位至对象/顶点，结构通过不代表成品质量。
- 跨工程账户账本：手工报价、限额、保留/提交/未知/结算/取消状态；Studio/API 分账。**它没有自动查询供应商余额，也未与全部执行路径联动，不能约束外部网页消费。**

## 安装与运行

使用 DSH **Electron 应用的「插件 → 添加插件」**，输入 `dsh-charakuru-studio-0.3.2.tgz` 的本地完整路径，安装并立即启用。桌面 profile 不支持用 CLI 安装；不要手改 profile 依赖绕过。

目标环境：DSH 0.2.2-rc.3 / Node 22+。本机实测 companion 3.0.6 + Blender 5.3.0；3.1 Gateway 适配只有协议测试，未在该机器验收。companion 未被升级。详见 [安装、升级与卸载](docs/INSTALL-WINDOWS.md)。

打开侧栏 **Avatar Studio 工作台**，默认 API 为 `http://127.0.0.1:9886`。支持同机网页端和桌面端的 DSH 客户端面板；资产、预览和建模工具不需要 CDN。

### 可选：工作台内显示自备 Charakuru

「原版 Charakuru（本机）」只显示用户依照上游许可自行启动的 `http://127.0.0.1:8766/`。点击载入，不跳到外部浏览器。此入口仅支持 DSH 桌面端或在 DSH 主机本机打开的网页端；不会代理远端 Kit、修改 CSP、自动安装原版或同步两边工程。宿主或 Kit 禁止内嵌时请保留安全策略，使用原生工作台。此插件不分发 [上游许可证](https://github.com/nanocle/Charakuru/blob/main/LICENSE) 覆盖的原版应用、Skill 或 donor；原版请求不会被自动接管。

### 最短零云额度路线

1. 建立独立工程目录，导入自己有权使用的 PNG / GLB；不要提交私有素材到公开仓库。
2. 在「三维编辑与生产」选择已有 `.blend`，或点击「从 Blender 检查点接力」载入本工程已指纹校验的检查点；按需配置官方 VRM Add-on。
3. 选择 `head_scale`，参数 `{"factor":0.95,"armature":"你的骨架","headBone":"head","pivotBone":"neck"}`。成功后刷新为新版本；回滚切换版本指针，不删除历史。
4. 保存相机、参考叠图；重载工程核对版本、输入对象和参考图。
5. 按 [工序与故障指南](docs/OPERATIONS.md) 显式处理权重与 VRM。每步检查审计和外观；不要把动作探针当穿模验收。

## 生图与额度边界

`allowCloudExecution` 默认 `false`。本地驱动只允许 HTTP loopback 地址；该限制不能保证你配置的本地代理不会转发到云端。先确认服务确实在本地运行。

Qwen / Anima 本机默认端口本轮不可达，因此没有真实生图样例。NovelAI、OpenAI-compatible、Gemini、Tripo 云端均没有调用，**没有消耗云额度**。接口适配和工作流导出属于实验能力，不公开宣称生产驱动已通过验收。

UI 中生图任务有显式 request ID；重试请保留同一 ID。已开始或计费不明的任务拒绝重新提交；收到结果的相同请求返回已有回执。换 ID 是新任务，必须先核对旧任务。服务重试、供应商退款、生产 429/余额/跨进程云并发还未认证。不要因本地测试通过而启用无人值守付费生成。

## 开发与验证

```bash
npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build:client
npm test
npm run check
```

编辑 `src/client-shell.js` 与 `lib/client-preview.js` 后重新 build；`lib/client.js` 是生成文件。运行时依赖离线内嵌；Three.js、three-vrm 许可证见 [NOTICE](NOTICE)。VRM Add-on、Blender 和 DSH 单独安装，不随包分发。

[发布与验收矩阵](docs/RELEASE-0.3.0.md) · [工序指南](docs/OPERATIONS.md) · [安装升级卸载](docs/INSTALL-WINDOWS.md) · [LICENSE](LICENSE)

MIT 仅覆盖本仓库原创代码及相应许可组件；不授予模型权重、服务、输入角色或输出资产的使用权。不包含受限 Kit、第三方 donor 模型、用户角色、密钥或账户配置。
