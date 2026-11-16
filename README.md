# dsh-charakuru-studio

面向 DeepSeek Harness 的独立角色制作工作台：整理角色设定、编译 11 张拆件视图提示词、调用生图接口、规划 Tripo Studio 预算、归档 GLB，并通过 [dsh-blender-plugin](https://github.com/sixtysevenlf/dsh-blender-plugin) 生成或运行 Blender 脚本。

**0.1.0 是实验版。** 项目管理、提示词编译、工作流导出、文件校验与本地 HTTP 接口可独立使用。Blender 比例、权重、裙摆骨架和表情生成属于启发式草稿，需人工修整和验收。裙摆脚本目前生成骨架草案，SpringBone joints、碰撞体和服装权重仍需配置；插件没有承诺一键得到可步行成品。

## 安装与入口

测试目标为 **DSH 0.2.2-rc.3 / Node 22+**。通过 DSH 的 **插件 → 添加插件** 选择本地目录或发布包；也可让 Agent 调用：

```json
{"action":"install_bundle","target":"[插件目录或安装包路径]"}
```

启用后，左侧栏会出现 **Charakuru 工作台**（英文为 **Charakuru Studio**）一行；点击即在主区域打开整页工作台（不是弹窗），工作台包含「工程与关卡」「模型与视图」「Tripo 预算」「Blender」「密钥」五个标签页。标题栏的「返回会话」按钮回到对话。默认工作台 API 为 `http://127.0.0.1:9886`，伴随插件为 `http://127.0.0.1:9877`。修改端口后在面板「连接与工程」同步地址。

## 最短使用流程

1. 在「工程与关卡」填写工程目录、角色描述、参考 PNG 路径和账户实际月额度，创建工程。每个工程使用独立状态文件，关卡按顺序审阅。
2. 在「模型与视图」选模型并编译提示词。导出 Qwen Diffusers 批处理脚本或 Anima ComfyUI API 工作流；已有服务和凭据时可点击「立即生图」。导出的 ComfyUI JSON 是 API prompt 格式，可通过 `/prompt` 提交。
3. 检查头部四视图、T-pose 身体四视图和全身比例三视图。通过人工关卡后再投入重建。
4. 在「Tripo 预算」生成手动操作计划。用户在已登录的 Studio 网页操作，下载 GLB 后登记真实积分与远端任务 ID，点击「校验并归档 GLB」。
5. 在「Blender」先生成脚本检查输入，再通过伴随插件运行。所有执行阶段均要求 VRM Add-on 先加载。检查点保存在工程内；启发式步骤返回 `degraded`。
6. 使用伴随插件的 catalog、audit、assembly、gate 与多角度视口检查，人工修整权重、弹簧和表情，再决定关卡通过。VRM 文件校验只证明 GLB 2 容器及 VRM 1 扩展存在，外部查看器兼容性和动作效果需另测。

## 模型与接口

| 驱动 | 使用方式 | 参考图情况 |
| --- | --- | --- |
| 本地 Qwen-Image-2.1 | 导出 Diffusers 脚本，或请求本地 OpenAI 兼容生图服务 | 参考编辑使用导出脚本；兼容生图端点为文生图 |
| 本地 ComfyUI Anima | 基础 / aesthetic / turbo API 工作流 | 内置模板为文生图；aesthetic 需指定 UNet 文件 |
| NovelAI | 图片 API / ZIP 返回解析 | Precise Reference 请求限定 V4.5；V5 按实际模型 ID 使用 |
| OpenAI 兼容网关 | GPT Image、Seedream、FLUX 等候选 | 内置请求为文生图；网关协议需匹配 |
| Gemini | generateContent 内联图像 | 支持参考 PNG |

AA 榜单是 **2026-11-16 的静态快照**，附来源链接和模型提示词建议。显示名、价格、排名及候选 API ID 均应与供应商核对。云端执行强制填写实际 `apiModelOverride`。真实云端请求、计费和所有本地模型版本尚未逐个实测。

Qwen 与 Anima 权重各有许可条件，MIT 覆盖本插件原创代码；模型权重、生成服务与输出的条件分别适用。

## Tripo 额度与归档

默认 `200` 月积分、`95 / 145` 消耗是可编辑的**规划假设**，请按账户页面输入实际值。计划不提交远端任务、不自动点击网页，也不约束其他浏览器会话的并发。Studio 与 OpenAPI 余额分开。

归档验证 GLB 2 头、长度和 JSON chunk，计算 SHA-256 后写入工程。远端任务 ID 用于幂等记账；相同 ID 的内容或消耗冲突会报错。无任务 ID 时按部件和内容摘要去重。它不代表网格语义或拓扑通过验收。

## 工具与配置

提供六个 Agent 工具：`charakuru_aa_models`、`charakuru_project`、`charakuru_generate_views`、`charakuru_tripo_quota`、`charakuru_blender_avatar`、`charakuru_credentials`，以及 `charakuru-vrm-studio` 技能。Agent 可提交审阅，批准与要求修改在工作台完成。凭据工具只读状态；密钥在面板密码框或环境变量配置，避免进入对话参数。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `port` | `9886` | 本地工作台 API |
| `autoStart` | `true` | 启用时启动 API |
| `blenderPluginUrl` | `http://127.0.0.1:9877` | 伴随插件 |
| `comfyuiUrl` | `http://127.0.0.1:8188` | ComfyUI |
| `qwenImageUrl` | `http://127.0.0.1:8000` | Qwen 兼容服务 |
| `openaiCompatBaseUrl` | `https://api.openai.com/v1` | 兼容网关 |
| `defaultImageModel` | `qwen-image-2.1-local` | 默认模型 |
| `tripoMonthlyFreeCredits` | `200` | 初始规划额度，可设为 0 |

云端执行会向所选供应商发送角色提示词及支持的参考图，并可能计费。密钥保存在 DSH Host 凭据库，或读取 `NOVELAI_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY`、`TRIPO_API_KEY` 环境变量。删除 Host 记录仍保留环境变量回退。停用插件会移除工具、工作台入口和本地 API；工程文件与凭据记录继续保留。

## 开发与验证

```bash
npm test
npm run check
npm pack --ignore-scripts
```

`check` 使用 `DSH_CHECK_PYTHON`、`DSH_PYTHON_EXECUTABLE` 或 PATH 中的 Python，检查生成的 5 个 Blender 脚本及两种 Qwen 脚本。Host 与 Client 直接分发 JavaScript，无额外前端构建步骤。

测试包括真实 loopback HTTP、状态锁与版本冲突、人工关卡、幂等记账、PNG / ZIP / GLB 损坏输入、接口超时、密钥隔离及 Blender 回执。网络驱动与成功导出路径使用测试夹具，不构成真实模型或角色效果证明。同一进程内的锁保护输出；请避免多个 DSH 进程同时修改同一工程。

验证记录见 [VALIDATION.md](docs/VALIDATION.md)。工作台的实际亮暗主题、窄屏与键盘操作仍需在已连接 DSH 页面验收。

## 独立实现与许可

MIT。仓库未包含 Charakuru 源码、技能原文、捐赠素材或模型权重；采用独立状态模型、接口与脚本实现。与 nanocle/Charakuru 无隶属或背书关系。仓库远端配置不代表已经发布；提交和推送由维护者执行。
