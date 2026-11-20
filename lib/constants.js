/**
 * dsh-charakuru-studio — Shared constants, port defaults, pipeline stages, and credential slots.
 */

export const PLUGIN_NAME = 'dsh-charakuru-studio';
export const PLUGIN_VERSION = '0.10.0';

export const DEFAULT_STUDIO_PORT = 9886;
export const DEFAULT_BLENDER_PLUGIN_PORT = 9877;
export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
export const DEFAULT_QWEN_IMAGE_URL = 'http://127.0.0.1:8000';
export const DEFAULT_NOVELAI_IMAGE_URL = 'https://image.novelai.net';
export const DEFAULT_TRIPO_API_URL = 'https://openapi.tripo3d.com/v3';

export const PROJECT_FILENAME = 'project.charastudio.json';
export const LEGACY_CHARAKIT_FILENAME = 'project.charakit';

// User-adjustable planning assumptions; confirm account terms and prices in Studio.
export const TRIPO_FREE_TIER_DEFAULTS = Object.freeze({ plan: 'studio_free', monthlyCreditAllowance: 200, maxConcurrency: 1, historyRetentionHours: 24, estimateOnly: true });

/**
 * 6 Clean-Room Human-in-the-Loop Stages for 2D Illustration -> Expressive VRM 1.0 Avatar.
 */
export const PIPELINE_STAGES = Object.freeze([
  {
    id: '1_concept', index: 1, nextTab: 'assets', checkpointRequired: true,
    titleZh: '原画与制作目标', titleEn: 'Illustration & production brief',
    summaryZh: '登记有权使用的原画或写明角色设定；说明外观、服饰和交付用途。额度未知时可先按 0 规划。',
    summaryEn: 'Register permitted artwork or enter a character brief. Describe the look, outfit and intended use. Use a zero budget when allowance is unknown.',
    artifactZh: '原画 PNG、角色设定与预算假设', artifactEn: 'Original PNG, character brief and budget assumptions',
    handoffZh: '读取 charakuru_project status，核对原画权利和设定。不要因教程示例而新增人物特征或假定余额。',
    handoffEn: 'Use charakuru_project status to verify the source and brief; do not assume asset rights or credits.',
  },
  {
    id: '2_views', index: 2, nextTab: 'models', checkpointRequired: true,
    titleZh: '拆件参考与图像审阅', titleEn: 'Part views & image review',
    checkpointPromptZh: '核对头+发 / T-Pose 身体各四张，并单独检查全身比例三图。',
    checkpointPromptEn: 'Check all 4 head+hair views, 4 T-pose body views, and 3 full-body balance views separately.',
    summaryZh: '先确认正面，再补两侧与背面。头部闭口无遮挡，身体水平 T-Pose；比例图独立核对。',
    summaryEn: 'Lock the front first, then sides and back. Head views are closed-mouth and unobstructed; body views use a strict T-pose.',
    artifactZh: '头+发 4 张、身体 4 张、比例 3 张，以及逐槽提示词', artifactEn: '4 head/hair, 4 body, 3 balance PNGs and prompts',
    handoffZh: '先用 charakuru_aa_models 查询能力、charakuru_generate_views 导出预案。视图必须实际登记，缺一张就补一个槽；需要云端时停下来请用户确认。',
    handoffEn: 'Use charakuru_aa_models and export a generation plan. Register real PNGs; repair individual slots. Pause for the user if a cloud request is needed.',
  },
  {
    id: '3_tripo', index: 3, nextTab: 'tripo', checkpointRequired: true,
    titleZh: '头体候选与费用核对', titleEn: 'Head/body candidates & cost review',
    checkpointPromptZh: '请预览并采用头、体 GLB，核对实际积分与归档。',
    checkpointPromptEn: 'Preview and adopt head and body GLB candidates, then verify actual credits and archives.',
    summaryZh: '核对 Studio 报价与公开性，或导入已有自包含 GLB。归档后仍需手工选头、体一对。',
    summaryEn: 'Verify Studio quotes and visibility, or import existing embedded GLBs. Archiving never selects a candidate.',
    artifactZh: '可预览的头体 GLB、明确选择、人工账本（如适用）', artifactEn: 'Previewable head/body GLBs, explicit selection and optional ledger',
    handoffZh: '用 charakuru_tripo_quota 只做预算；使用者亲自提交外部作业。导入并比对候选，未经审批不执行装配。',
    handoffEn: 'Plan via charakuru_tripo_quota; the user submits any external tasks. Compare downloaded candidates and wait for approval.',
  },
  {
    id: '4_assembly', index: 4, nextTab: 'editor', checkpointRequired: true,
    titleZh: '装配、材质与比例', titleEn: 'Assembly, materials & proportions',
    checkpointPromptZh: '检查颈缝、头身比、发型对位、纹理与材质；结构检查不代替视觉验收。',
    checkpointPromptEn: 'Inspect neck seam, head-body ratio, hair alignment, textures and materials; structural checks do not replace visual review.',
    summaryZh: '从已批准候选做 Blender 导入，或接力合法的已有 Blend；检查头、发、身相对位置与参考叠图。',
    summaryEn: 'Prepare approved parts in Blender or continue a permitted Blend; inspect head, hair and body against references.',
    artifactZh: '新 Blend 修订、几何或材质预览及审计', artifactEn: 'New Blend revision, geometry/material preview and audit',
    handoffZh: '先 probe companion。新 GLB 从 Blender 前处理接力；已有 rig 用 editor_operation 明确对象和版本。保留源文件；不称启发式分组等于重贴图。',
    handoffEn: 'Probe the companion first. Use preflight imports for new GLBs; for an existing rig bind explicit objects and revision. Preserve input files.',
  },
  {
    id: '5_rig_spring', index: 5, nextTab: 'editor', checkpointRequired: true,
    titleZh: '骨架、权重与动态检修', titleEn: 'Rig, weights & motion repair',
    checkpointPromptZh: '检查 humanoid、两侧关节、发束与服装碰撞，真实动作下目视查穿模。',
    checkpointPromptEn: 'Inspect humanoid bones, left/right joints, hair strands and garment collisions visually under real motion.',
    summaryZh: '有 rig 就保留；显式映射、权重归一、弹簧碰撞与姿态探针后人工验收。',
    summaryEn: 'Preserve a valid rig; use explicit bone mapping, weight checks, springs and pose probes before visual review.',
    artifactZh: '修订 Blend、骨骼映射、诊断与真实动作记录', artifactEn: 'Rigged Blend revision, mappings, diagnostics and real motion review',
    handoffZh: '用 charakuru_blender_avatar 的 revision 工序检查权重和 SpringBone。改动前记对象与版本；姿态探针不能代替行走、极限扭转和碰撞检查。',
    handoffEn: 'Use revision-scoped Blender operations. Record affected objects and versions; probes do not substitute for walking and collision checks.',
  },
  {
    id: '6_expressions_vrm', index: 6, nextTab: 'editor', checkpointRequired: true,
    titleZh: 'VRM 导出与交付复核', titleEn: 'VRM export & delivery review',
    checkpointPromptZh: '核对作者、使用条款、要求的表情与外部查看器动作，保留可编辑 Blend。',
    checkpointPromptEn: 'Verify authors, license terms, requested expressions and external viewer playback while keeping an editable Blend.',
    summaryZh: '以检查过的修订导出 VRM 1.0。表情实验不是必做项；结构有效仍需外观、动作和许可验收。',
    summaryEn: 'Export VRM 1.0 from a checked revision. Verify metadata, requested expressions and external playback; structural success is not shipping approval.',
    artifactZh: 'VRM 1.0、可编辑 Blend、元数据和视觉验收记录', artifactEn: 'VRM 1.0, editable Blend, metadata and visual review notes',
    handoffZh: '从真实修订 export_vrm，检查格式、作者、授权与外部动作。不要虚报正式交付或自动通过后续关卡。',
    handoffEn: 'Export from a verified revision. Check format, author, rights and playback; do not claim shipment or bypass review.',
  },
]);

/**
 * Required 8+3 view slots for clean 3D reconstruction.
 */
export const REQUIRED_VIEW_SLOTS = Object.freeze([
  { id: 'head_front', group: 'head', angle: 'front', labelZh: '头+发 正面（闭口/去眼镜）', labelEn: 'Head+Hair Front (closed mouth, no glasses)' },
  { id: 'head_right', group: 'head', angle: 'right', labelZh: '头+发 右侧', labelEn: 'Head+Hair Right' },
  { id: 'head_left', group: 'head', angle: 'left', labelZh: '头+发 左侧', labelEn: 'Head+Hair Left' },
  { id: 'head_back', group: 'head', angle: 'back', labelZh: '头+发 背面', labelEn: 'Head+Hair Back' },
  { id: 'body_front', group: 'body', angle: 'front', labelZh: 'T-Pose 素体服饰 正面', labelEn: 'T-Pose Body Front' },
  { id: 'body_right', group: 'body', angle: 'right', labelZh: 'T-Pose 素体服饰 右侧', labelEn: 'T-Pose Body Right' },
  { id: 'body_left', group: 'body', angle: 'left', labelZh: 'T-Pose 素体服饰 左侧', labelEn: 'T-Pose Body Left' },
  { id: 'body_back', group: 'body', angle: 'back', labelZh: 'T-Pose 素体服饰 背面', labelEn: 'T-Pose Body Back' },
  { id: 'balance_front', group: 'balance', angle: 'front', labelZh: '全身比例三视图 正面', labelEn: 'Full-Body Balance Front' },
  { id: 'balance_right', group: 'balance', angle: 'right', labelZh: '全身比例三视图 右侧', labelEn: 'Full-Body Balance Right' },
  { id: 'balance_back', group: 'balance', angle: 'back', labelZh: '全身比例三视图 背面', labelEn: 'Full-Body Balance Back' },
]);

/**
 * Credential provider slots managed through DSH Host `credentials` service.
 */
export const CREDENTIAL_PROVIDERS = Object.freeze([
  {
    id: 'novelai',
    recordKey: 'dsh-charakuru-studio:novelai',
    envName: 'NOVELAI_API_KEY',
    labelZh: 'NovelAI Persistent API Token (V5 / V4.5)',
    labelEn: 'NovelAI Persistent API Token (V5 / V4.5)',
  },
  {
    id: 'openai_compat',
    recordKey: 'dsh-charakuru-studio:openai-compat',
    envName: 'CHARAKURU_IMAGE_API_KEY',
    labelZh: '自配兼容网关密钥',
    labelEn: 'Custom gateway key',
  },
  {
    id: 'openai', recordKey: 'dsh-charakuru-studio:openai', envName: 'OPENAI_API_KEY',
    labelZh: 'OpenAI 官方 Images 密钥', labelEn: 'Official OpenAI Images API key',
  },
  {
    id: 'ark', recordKey: 'dsh-charakuru-studio:ark', envName: 'ARK_API_KEY',
    labelZh: '火山方舟北京区生图密钥', labelEn: 'Volcano Ark Beijing image API key',
  },
  {
    id: 'gemini',
    recordKey: 'dsh-charakuru-studio:gemini',
    envName: 'GEMINI_API_KEY',
    labelZh: 'Google Gemini 生图密钥 (Nano Banana 2.1 / Gemini 3.1 Flash)',
    labelEn: 'Google Gemini Image API Key (Nano Banana 2.1 / Gemini 3.1 Flash)',
  },
  {
    id: 'tripo',
    recordKey: 'dsh-charakuru-studio:tripo',
    envName: 'TRIPO_API_KEY',
    labelZh: 'Tripo OpenAPI v3 密钥（可选，Studio 免费网页模式无需此项）',
    labelEn: 'Tripo OpenAPI v3 Key (optional; not required for Studio Free web mode)',
  },
]);
