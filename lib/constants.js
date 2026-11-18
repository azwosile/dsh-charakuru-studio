/**
 * dsh-charakuru-studio — Shared constants, port defaults, pipeline stages, and credential slots.
 */

export const PLUGIN_NAME = 'dsh-charakuru-studio';
export const PLUGIN_VERSION = '0.3.2';

export const DEFAULT_STUDIO_PORT = 9886;
export const DEFAULT_BLENDER_PLUGIN_PORT = 9877;
export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
export const DEFAULT_QWEN_IMAGE_URL = 'http://127.0.0.1:8000';
export const DEFAULT_NOVELAI_IMAGE_URL = 'https://image.novelai.net';
export const DEFAULT_OPENAI_COMPAT_URL = 'https://api.openai.com/v1';
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
    id: '1_concept',
    index: 1,
    titleZh: '原画解析与预算锁定',
    titleEn: 'Concept intake & quota lock',
    checkpointRequired: false,
    summaryZh: '登记角色立绘、头身比目标（默认 6.3 头身 / 0.86× 颈部缩放）与 Tripo 200 免费积分预算策略。',
    summaryEn: 'Register source character art, target head-to-body ratio (6.3 heads / 0.86x neck pivot), and Tripo 200 free-credit budget strategy.',
  },
  {
    id: '2_views',
    index: 2,
    titleZh: '8+3 多视角拆件生图',
    titleEn: '8+3 multi-view turnaround generation',
    checkpointRequired: true,
    checkpointPromptZh: '请核验 8 张拆件视图（头+发四视图：去眼镜/闭口中性表情；无头 T-Pose 身体四视图）与 3 张全身比例参考图的水平对齐与服饰一致性。确认通过后进入 Tripo 3D 生成。',
    summaryZh: '通过本地 Qwen-Image-2.1 / ComfyUI Anima / NovelAI V5 / Seedream 5.5 生成 8 张部件四视图与 3 张全身三视图，避免未过审投入 3D 浪费积分。',
    summaryEn: 'Generate 4 head+hair views (no glasses, closed mouth), 4 headless T-pose body views, and 3 full-body balance views with horizontal landmark QC.',
  },
  {
    id: '3_tripo',
    index: 3,
    titleZh: 'Tripo 免费额度 3D 生成与归档',
    titleEn: 'Tripo free-quota 3D generation & local archive',
    checkpointRequired: true,
    checkpointPromptZh: '请在已本地归档的头部与身体 GLB 候选中选定最终组合（请核对实际消耗，并为所有选定 GLB 完成本地归档）。确认后进入 Blender 装配。',
    summaryZh: '生成串行网页操作手册，跟踪实际积分并校验、归档用户下载的 GLB。账户额度、价格与历史保留期以 Studio 为准。',
    summaryEn: 'Plan serial Studio tasks; record actual cost and archive downloaded GLBs. Verify allowance, prices and retention in your account.',
  },
  {
    id: '4_assembly',
    index: 4,
    titleZh: 'Blender 部件分组与头身比装配',
    titleEn: 'Blender part grouping & neck-pivot assembly',
    checkpointRequired: true,
    checkpointPromptZh: '请通过 dsh-blender-plugin 视口确认头身拼装、5 组贴图划分（发/头/上装/下装/配饰）与颈部枢轴头身比缩放效果。',
    summaryZh: 'VRM-first 导入、按部件标签分组与比例装配；已有骨架需人工复核，通用网格清理交给 companion 操作。',
    summaryEn: 'Link with sixtysevenlf/dsh-blender-plugin to safely enable VRM addon, split 5 texture groups, and scale head/body around the neck pivot.',
  },
  {
    id: '5_rig_spring',
    index: 5,
    titleZh: 'Clean-Room 权重修复与防穿模物理',
    titleEn: 'Clean-room weight fix & skirt spring physics',
    checkpointRequired: true,
    checkpointPromptZh: '请检查 Mixamo 小指对齐、上装下摆大腿权重净化以及 16 链裙摆 SpringBone + 胶囊碰撞体扩径后的步行防穿模表现。',
    summaryZh: '实验性高斯包络骨架权重与裙摆骨架草案；弹簧绑定、碰撞和动作测试必须另行完成验收。',
    summaryEn: 'Experimental Gaussian envelope weights and skirt bone draft; spring binding, collision and animation require separate verification.',
  },
  {
    id: '6_expressions_vrm',
    index: 6,
    titleZh: '闭合网格 23 表情与 VRM 1.0 交付',
    titleEn: 'Closed-mesh 23 expressions & VRM 1.0 export',
    checkpointRequired: true,
    checkpointPromptZh: '请核验 23 个面部形态键（8 眼 / 5 眉 / 10 口）与 VRM 1.0 标准表情预设绑定，填写作者与授权元数据后导出最终 .vrm。',
    summaryZh: '生成 23 个启发式形态键并尝试绑定 VRM 预设；逐表情检查变形，只有真实导出文件通过容器检查才登记产物。',
    summaryEn: 'Generate 23 heuristic morphs and attempt VRM preset binding; inspect every expression and validate the actual export artifact.',
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
    labelZh: 'OpenAI 兼容生图密钥 (GPT Image 2.6 / Seedream / 聚合网关)',
    labelEn: 'OpenAI-Compatible Image API Key (GPT Image 2.6 / Seedream / Gateway)',
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
