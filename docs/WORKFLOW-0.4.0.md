# 0.4.0 · DSH 原生流程（实验）

本版删除原版内嵌入口；不安装原版、启动原版服务、复制它的 Skill 或使用它的 donor。旧 `project.charastudio.json` 可继续打开。照本库工作台实际状态走，不把 0.3.x README 或原版教程当操作说明。

## 首轮推荐

1. 另开项目，用图片库登记一张授权 PNG，核对 SHA 对应原图。输入角色描述，明确服装版本和不对称侧别。绘图先锁一个正面，不从不同设计拼接同一套四视图。
2. 工作台「模型与视图」默认单槽；选 `head` / `body` / `balance` 或 `all` 才为一组编译预案。本机生成也建议单槽试跑。预审读配置并核对驱动条件，不联网、不查询余额。导出只创建 `views/workflows/` 预案。
3. 在图库并排核对同方向头、身体。验收点：闭口、无眼镜、发丝边缘和颈口；T-Pose 水平臂、全身无裁切、无头发遮肩；脚底、头顶/肩/胯线与左右配饰。全身正/角色右/背独立审比。通过后才交候选环节。
4. 若没有 Tripo 上传与额度授权，走已有 GLB 或已有 Blend；没有两者时不要用测试夹具冒充样例角色。预案只在视图审批有效时列出实际选图路径；不从固定文件名猜素材。Tripo 手工生成后下载自包含 GLB，在工作台归档并单独选头体。已有 Blend 的显式修订路线不依赖 Tripo。
5. 工作台「打开当前工序」只切区，不改变审阅状态。`插入指令` 或版本级 `准备 DSH 会话草稿` 只填草稿。使用者发送后按 `charakuru-vrm-studio` Skill 操作；通过或驳回仍是使用者决定。模型结构和 Viewer 动画检查分开。

## 本机设置

- `comfyuiUrl` 默认 `http://127.0.0.1:8188`；`qwenImageUrl` 默认 `http://127.0.0.1:8000`。这是运行 DSH Host 的同机回环，不是远程浏览器自己的 GPU。不会自动安装 GPU 软件或模型、不跟随重定向、不转云。
- **Qwen ComfyUI Edit**：先在该卡点「导出预案」，得到 `qwen_image_21_edit.template.api.json`。它是 API 请求格式，不是编辑器画布。保持 `__DSH_REFERENCE__` / `__DSH_PROMPT__` / `__DSH_OUTPUT__`，若需要改权重路径则另存，向 `comfyuiQwenWorkflowPath` 填该本机文件的绝对路径。所需核心节点包括 `TextEncodeQwenImage21`；默认 int8 diffusion / encoder 与 bf16 VAE 文件名参见模板和 [官方模型部署说明](https://comfy.org/qwen-image-2.1/)。不送自定义/联网节点；一个 LoadImage、一个 SaveImage。首张检查参考实际进入图、PNG 真能预览、alpha 与输出尺寸；ComfyUI 按参考与模板决定实际尺寸。ComfyUI input/output 留本机副本，完成后按本机隐私要求管理。
- **Qwen Diffusers**：Local/Diffusers 卡导出 `run_qwen_image_21_views.py`，需要本机 Python/CUDA、兼容 diffusers `QwenImage21Pipeline` 与权重。先人工检查环境、授权与路径，仅运行自生成脚本；脚本可写 `views/<group>/<slot>.png`，之后用图库扫描登记；已有同名文件时，脚本另存带后缀的 PNG，在图库按实际路径导入新候选。工作台直接生成也使用独立文件名，不覆盖旧文件。兼容 HTTP 端点仅文生图。
- **Anima**：内置基础图用原生 CLIPLoader/EmptyLatentImage，模型文件默认为 `anima-base-v1.0.safetensors`、`anima-aesthetic-v1.0.safetensors` 或 `anima-turbo-v1.0.safetensors`，辅助 `qwen_3_06b_base.safetensors`、`qwen_image_vae.safetensors`。Turbo 是独立权重，CFG 1/8 步；不是旧 LoRA 路径。文件名与变体须匹配。若已有原画且只做风格草稿，明确选「仅文字」；不会读取或发送原画。
- Qwen-Image-2.1 的 Research License 默认只授予非商业研究/评估用途；商用需另获许可，Anima 权重也需核其非商业条款。提示词要求保留朝向、体型和服饰，不等于模型能自动保证。用非私密、合法样图先测单张；低显存用支持的 offload、参考分辨率和精度，不用整批压满显存。

## 云端实验设置

1. 默认不启用。先确认模型权限、使用条款、上传内容、账号报价及输出许可；仅通过可信 Host 配置 `allowCloudExecution`。插件不保存密码，不需要登录密码分享。
2. 按选定适配录入专用 API 凭据（OpenAI `OPENAI_API_KEY`，Gemini `GEMINI_API_KEY`，方舟 `ARK_API_KEY`，NovelAI `NOVELAI_API_KEY`，自配网关 `CHARAKURU_IMAGE_API_KEY`）。单独输入实际 API ID。网关需另设可信 HTTPS `openaiCompatBaseUrl`，不能劫持官方路线。参数及 CLI 上下文不可用来替代人工确认。
3. 本版云端一次只做一个槽，确认框列出服务、API ID、槽位和是否发送原画，并绑定当前工程版本；项目改变后要重新载入确认。NovelAI 只支持当前适配的 V5/V4.5 ID，V5 是实验 multipart 文生图，V4.5 是独立实验参考接口，未获得在线认证。方舟只实现北京区固定域和单参考；保留服务标识。Gemini 只登记最终 PNG；返回非 PNG 或只给下载 URL 时，请用供应商合法下载、转 PNG 后导入。
4. 调用失败或超时，核对原请求 ID 和供应商状态。不因错误换驱动、不自动重发，不把手工账本当服务余额。

## 已有能力与尚未验收

- 前三关的实物证据与人工批准由项目状态控制；后三关保留人工工具与不可变修订，不开放“成品通过”按钮。最新版不提供原版那样的语义拆件、自动 5 组 4K 重贴图、三视图等高/水平独立锁定界面、.charakit fork、自动 VRMA 默认动作验收或合规结论。
- Windows 和 Linux 有测试夹具，含真实 loopback HTTP、两类 renderer 契约模拟、配置预审、独立供应商请求构造、PNG/GLB 文件校验与回滚。接口测试不是实机推理、账户确认或视觉验收。
- 正式分发前须分别验证 DSH 同机网页和实际 Electron renderer、真实 DSH Agent 发送/回读、真实本机生图、陪伴插件 GUI / headless 差异、合法角色端到端、动作和外部查看器。0.4.0 包只作为实验安装包。
