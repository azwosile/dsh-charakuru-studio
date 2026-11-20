import { REQUIRED_VIEW_SLOTS } from '../constants.js';

export const AA_SNAPSHOT_META = Object.freeze({
  benchmark: 'Artificial Analysis Image Arena v2.1 (T2I + Image Editing)',
  updatedAt: '2026-11-18',
  snapshot: true,
  apiIdsVerified: false,
  note: 'Selected rows from the overall tables, not pricing or entitlement. API availability and local adapter validation are separate.',
  sourceUrls: [
    'https://artificialanalysis.ai/image/leaderboard/text-to-image',
    'https://artificialanalysis.ai/image/leaderboard/editing',
  ],
});

const qwen = {
  vendor: 'Qwen', deployment: 'local', weights: 'open_weights', nativeRgba: true,
  aaT2iRank: 30, aaT2iElo: 1047, aaEditRank: 32, aaEditElo: 1082,
  licenseNotice: 'Qwen Research License. This plugin does not include model weights.',
  recommendedFor: ['part_split_8views', 'rgba_cutout', 'multi_view_alignment'],
  stageZh: '稳定正面后，逐张转出头/体侧背视图；同色同发长再补比例图。',
  stageEn: 'Lock the front view, edit individual side/rear views, then create balance references.',
  promptTipsZh: ['写明「只改为指定真侧/背视角；保留发色、服饰、头身比和左右不对称」。不要同时生成拼版。', '透明背景可用官方 RGBA 英文首尾句式，但仍须检查 PNG 实际 alpha 与发丝边缘。'],
  promptTipsEn: ['Ask for one orthographic view; preserve color, clothing, anatomy and asymmetry.', 'For alpha, use the RGBA prompt wrapper and inspect the actual PNG channel.'],
  sourceUrl: 'https://huggingface.co/Qwen/Qwen-Image-2.1',
};

const catalog = (row) => ({ driver: 'catalog', deployment: 'cloud', weights: 'closed', adapterZh: '仅榜单与提示词', adapterEn: 'Catalog / prompt only',
  endpointZh: '未接入此供应商接口；可外部生成后手工登记 PNG。', endpointEn: 'No native driver; generate externally and import a PNG.',
  recommendedFor: ['multi_view_alignment'], ...row });

export const IMAGE_MODEL_CATALOG = Object.freeze([
  { ...qwen, id: 'qwen-image-2.1-local', name: 'Qwen-Image-2.1 · Local / Diffusers', driver: 'qwen_local',
    adapterZh: '本地文生图 / 脚本参考编辑', adapterEn: 'Local text-to-image / exportable reference-edit script',
    endpointZh: '宿主 qwenImageUrl → /v1/images/generations；参考编辑导出 Diffusers，不自动启动 Python。',
    endpointEn: 'qwenImageUrl → /v1/images/generations for text only; export a Diffusers script for reference editing.' },
  { ...qwen, id: 'qwen-image-2.1-comfy-edit', name: 'Qwen-Image-2.1 · ComfyUI Edit', driver: 'comfyui_qwen',
    adapterZh: '本地单原画编辑 · 模板需验证', adapterEn: 'Local single-reference edit · validate template',
    endpointZh: '宿主 ComfyUI /upload/image → /prompt → /history → /view。需要导出的 API 模板、模型和一张工程原画。',
    endpointEn: 'ComfyUI /upload/image → /prompt → /history → /view; requires an API recipe, model files, and one registered reference.',
    sourceUrl: 'https://comfy.org/qwen-image-2.1/' },
  { id: 'comfyui-anima-local', name: 'Anima · Local ComfyUI (Base / Aesthetic / Turbo)', vendor: 'CircleStone Labs', deployment: 'local', weights: 'open_weights', driver: 'comfyui_anima',
    adapterZh: '本地文生图 / API 工作流导出', adapterEn: 'Local text-to-image / API workflow export',
    endpointZh: 'ComfyUI /prompt → /history → /view；不上传原画。', endpointEn: 'ComfyUI /prompt → /history → /view; no reference is uploaded.',
    stageZh: '低成本做风格样张、头+发轮廓和材质草案；角色一致性高要求时再用参考编辑。', stageEn: 'Try anime concepts, silhouettes and materials; use reference editing for identity lock.',
    recommendedFor: ['part_split_8views', 'style_exploration'],
    licenseNotice: 'CircleStone Labs Non-Commercial License for weights; review the separate output terms.',
    promptTipsZh: ['用小写空格标签；score_7 保留下划线，Aesthetic 正负都去 score_*；画师标签可选，用 @ 前缀。', 'Base 可用 er_sde / CFG 4 / 30 步起试；Turbo 使用独立 UNet、CFG 1 / 8 步。正侧背逐图检查。'],
    promptTipsEn: ['Use lowercase space-separated tags (except score_*); omit score_* for Aesthetic.', 'Use the dedicated Turbo model at CFG 1 and 8 steps.'],
    sourceUrl: 'https://huggingface.co/circlestone-labs/Anima' },
  { id: 'novelai-v5-cloud', name: 'NovelAI Diffusion V5 Full / Curated', vendor: 'NovelAI', deployment: 'cloud', weights: 'closed', driver: 'novelai', nativeRgba: true,
    adapterZh: 'V5 文生图 · 实验协议', adapterEn: 'V5 text-to-image · experimental protocol',
    endpointZh: 'image.novelai.net /ai/generate-image（multipart、params_version=4），实际账号和模型 ID 自行核对。',
    endpointEn: 'image.novelai.net /ai/generate-image (multipart, params_version=4); verify ID and entitlement.',
    apiIdExample: 'nai-diffusion-5-full', apiIdEvidence: 'Community contract, not a public API guarantee',
    stageZh: '动漫概念、材质色块、文本驱动试样；不用于上传原画锁定身份。', stageEn: 'Anime concepts and text-driven style tests, not reference-based identity lock.',
    recommendedFor: ['style_exploration', 'part_split_8views'],
    promptTipsZh: ['用自然句约束朝向、闭口、遮挡和配色，短标签只补风格；指定透明背景后检验 alpha。', 'V5 不接本插件 Precise Reference。先只做一个槽，核对配额和 Anlas，不假定免费。'],
    promptTipsEn: ['Use natural language plus short tags for pose and style; inspect alpha.', 'V5 reference editing is not enabled in this adapter. Verify usage and cost first.'],
    sourceUrl: 'https://novelai.net/v5' },
  { id: 'novelai-v45-reference', name: 'NovelAI Diffusion V4.5 · Precise Reference', vendor: 'NovelAI', deployment: 'cloud', weights: 'closed', driver: 'novelai',
    adapterZh: 'V4.5 角色参考 · 实验协议', adapterEn: 'V4.5 character reference · experimental protocol',
    endpointZh: 'image.novelai.net /ai/generate-image；仅明确支持的 V4.5 模型 ID 可携带一张参考 PNG。',
    endpointEn: 'image.novelai.net /ai/generate-image; one reference PNG for supported V4.5 IDs.',
    apiIdExample: 'nai-diffusion-4-5-full', apiIdEvidence: 'Community contract, not a public API guarantee',
    stageZh: '优先修一张不一致的部件视图。', stageEn: 'Repair an inconsistent part view before mesh generation.',
    recommendedFor: ['multi_view_alignment'],
    promptTipsZh: ['指定只改视角，保留眼型、发尾与服饰色号。参考强度过高可能保留原姿势；先小样对照，不与 V5 混用。'],
    promptTipsEn: ['Preserve identity and palette; check whether reference strength locks the original pose.'],
    sourceUrl: 'https://docs.novelai.net/en/image/precisereference' },
  { id: 'gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst (max on AA)', vendor: 'OpenAI', deployment: 'cloud', weights: 'closed', driver: 'openai_gpt', nativeRgba: true,
    adapterZh: '官方 Images 接口 · 生成 / 单图编辑', adapterEn: 'Official Images API · generation and single-reference edits',
    endpointZh: 'api.openai.com /v1/images/generations 或 /v1/images/edits；插件不自动选 AA 的 max 档。', endpointEn: 'api.openai.com /v1/images/generations or /v1/images/edits; AA max is not selected automatically.',
    apiIdExample: 'gpt-image-2.6-sunburst', apiIdEvidence: 'Official documentation',
    aaT2iRank: 1, aaT2iElo: 1261, aaEditRank: 2, aaEditElo: 1211,
    stageZh: '复杂不对称与关键部件的单视图精修。', stageEn: 'Precise single-view fixes for complex asymmetry.',
    recommendedFor: ['strict_instruction_following', 'multi_view_alignment'],
    promptTipsZh: ['先列三个保留项（标记的侧别、扣件、色块），再写唯一要变更的视角。俯仰、焦距和镜像分别限定。'],
    promptTipsEn: ['List invariant features, then state the single requested camera change.'],
    sourceUrl: 'https://platform.openai.com/docs/guides/image-generation' },
  { id: 'seedream-5.5', name: 'Seedream 5.5 · 火山方舟 / Ark', nameEn: 'Seedream 5.5 · Volcengine Ark', vendor: 'ByteDance Seed', deployment: 'cloud', weights: 'closed', driver: 'ark_seedream',
    adapterZh: '北京区官方 Ark · 生成 / 单图编辑', adapterEn: 'Official Ark (Beijing) · generation and single-reference edits',
    endpointZh: 'ark.cn-beijing.volces.com /api/v3/images/generations；需要该区域权限，默认保留服务标识。', endpointEn: 'ark.cn-beijing.volces.com /api/v3/images/generations; verify Beijing-region access; watermark retained.',
    apiIdExample: 'doubao-seedream-5-5-261028', apiIdEvidence: 'Official documentation',
    aaT2iRank: 14, aaT2iElo: 1134, aaEditRank: 8, aaEditElo: 1160,
    stageZh: '中文精修服装与发饰，或补单张背面。', stageEn: 'Repair clothing, hair accessories or one rear view.',
    recommendedFor: ['multi_view_alignment', 'material_cleanup'],
    promptTipsZh: ['用中文写服装结构，注明角色自己的左右。说清输出单张、纯色背景；保留水印，投 3D 前判断其影响。'],
    promptTipsEn: ['Specify garment construction, character-relative left/right, and one isolated view. Check watermark placement.'],
    sourceUrl: 'https://docs.volcengine.com/docs/ark/image-generation-tutorial?lang=zh' },
  { id: 'nano-banana-2.1', name: 'Gemini Nano Banana 2.1', vendor: 'Google', deployment: 'cloud', weights: 'closed', driver: 'gemini',
    adapterZh: '官方 Gemini · 生成 / 单图编辑', adapterEn: 'Official Gemini · generation and single-reference edits',
    endpointZh: 'generativelanguage.googleapis.com /v1beta/models/{id}:generateContent；2.1 与原 Gemini 3.1 Flash Image 是不同 ID。', endpointEn: 'Google generateContent; Nano Banana 2.1 and Gemini 3.1 Flash Image have different IDs.',
    apiIdExample: 'gemini-nano-banana-2.1', apiIdEvidence: 'Official documentation',
    aaT2iRank: 8, aaT2iElo: 1176, aaEditRank: 10, aaEditElo: 1152,
    stageZh: '修复单张发尾、领结或衣料走向漂移。', stageEn: 'Repair hair, collar or material drift in one view.',
    recommendedFor: ['multi_view_alignment', 'material_cleanup'],
    promptTipsZh: ['先描述保留项，再用一句话明确改哪一处；不要把「多轮」误作本插件一次可传多图。'],
    promptTipsEn: ['State preserved features and the local change; this adapter takes one reference, not a multi-turn session.'],
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1' },
  catalog({ id: 'mai-image-2.7', name: 'MAI-Image-2.7', vendor: 'Microsoft', aaT2iRank: 4, aaT2iElo: 1214, aaEditRank: 1, aaEditElo: 1215,
    stageZh: '作为精修对照，不从 Elo 推断接入权限。', stageEn: 'A comparison point for precision edits; Elo is not API access.',
    promptTipsZh: ['使用同一正面输入，比较只转朝向时发饰和配色是否漂移。'], promptTipsEn: ['Compare identity drift on the same front image and requested camera turn.'] }),
  catalog({ id: 'kling-image-4.0', name: 'Kling Image 4.0', vendor: 'Kling AI', aaT2iRank: 7, aaT2iElo: 1180, aaEditRank: 6, aaEditElo: 1183,
    stageZh: '外部对比材质或轮廓，不当作已接通的网关。', stageEn: 'Compare material or silhouette externally; no wired gateway.',
    promptTipsZh: ['明确平涂、无投影和可读接缝；逐方向输出，不要转面拼图。'], promptTipsEn: ['Keep albedo flat and seams visible; request one angle, not a collage.'] }),
  catalog({ id: 'minimax-h3-image', name: 'MiniMax H3-Image', vendor: 'MiniMax', deployment: 'hybrid', weights: 'open_weights', aaT2iRank: 27, aaT2iElo: 1066, aaEditRank: 14, aaEditElo: 1135,
    stageZh: '开放权重编辑对照，优先尝试去光影，不部署生产驱动。', stageEn: 'Open-weight editing comparison for delighting; no production driver.',
    promptTipsZh: ['只去除环境光影；保留衣料底色、缝线与边缘。开放权重不自动等于商用许可。'], promptTipsEn: ['Remove illumination only; preserve albedo, seams and edges. Check the model license.'], sourceUrl: 'https://huggingface.co/MiniMaxAI/MiniMax-H3-Image' }),
  catalog({ id: 'fibo-2.0', name: 'Fibo 2.0', vendor: 'Bria', deployment: 'hybrid', weights: 'open_weights', aaT2iRank: 32, aaT2iElo: 1037, aaEditRank: 31, aaEditElo: 1086,
    stageZh: '测试可控的构图和编辑，不默认提交厂商。', stageEn: 'Compare composition control and edits without automatic dispatch.',
    promptTipsZh: ['把相机、目标部件、颜色、背景拆成约束；是否支持结构化字段以服务文档为准。'], promptTipsEn: ['Separate constraints for camera, part, color and background; verify any structured API fields.'], sourceUrl: 'https://huggingface.co/briaai/Fibo-2.0-dev' }),
  catalog({ id: 'flux-3-image', name: 'FLUX 3 Image', vendor: 'Black Forest Labs', aaT2iRank: 21, aaT2iElo: 1115, aaEditRank: 22, aaEditElo: 1119,
    stageZh: '发饰、鞋扣等硬表面轮廓和材质对照。', stageEn: 'External comparison for accessories and clean silhouettes.',
    promptTipsZh: ['用完整句子分开几何形状与材质，不把基础型号和 Klein 榜单成绩混用。'], promptTipsEn: ['Describe geometry and material separately; the base and Klein scores are distinct.'] }),
  catalog({ id: 'flux-3-klein', name: 'FLUX 3 Image Klein', vendor: 'Black Forest Labs', deployment: 'hybrid', weights: 'open_weights', aaT2iRank: 31, aaT2iElo: 1041, aaEditRank: 36, aaEditElo: 1069,
    stageZh: '小件造型/纯底剪影；接入本地之前确认权重许可。', stageEn: 'Accessory concepts and silhouette cleanup; verify the weights license.',
    promptTipsZh: ['单独描述轮廓和边缘厚度，纯背景、无阴影。'], promptTipsEn: ['Specify silhouette, edge thickness and neutral lighting.'], sourceUrl: 'https://huggingface.co/black-forest-labs/flux-3-image-klein' }),
  { id: 'openai-compatible-gateway', name: 'Custom OpenAI-compatible gateway', vendor: 'User configured', deployment: 'cloud', weights: 'unknown', driver: 'openai_compat',
    adapterZh: '自配网关 · 文生图协议', adapterEn: 'User-configured gateway · text-to-image protocol',
    endpointZh: '宿主 openaiCompatBaseUrl + /images/generations；必须返回 PNG b64_json。此项不会把 AA 模型自动映射到网关。', endpointEn: 'Trusted openaiCompatBaseUrl + /images/generations; expects PNG b64_json. No automatic leaderboard mapping.',
    stageZh: '经过供应商协议核对后测试单张，不能发送原画。', stageEn: 'Test one text-only image after verifying the vendor contract.',
    recommendedFor: ['style_exploration'],
    promptTipsZh: ['先写清所需角度、边缘与背景，再根据服务改尺寸和模型 ID。'], promptTipsEn: ['Specify view, bounds and background, then follow the gateway requirements.'] },
]);

/**
 * Convert underscore Danbooru tags to CircleStone Anima's space-separated lowercase syntax,
 * keeping `score_*` underscores and ensuring `@` prefix on artist tags.
 */
const normalizeAnimaTags = (characterSummary,variant) => String(characterSummary)
    .split(',')
    .map((raw) => raw.trim().toLowerCase())
    .filter(Boolean)
    .filter(tag => variant !== 'aesthetic' || !/^score[_ ]/.test(tag))
    .map((tag) => (/^score_\d+$/.test(tag) ? tag : tag.replace(/_/g, ' ')))
    .join(', ');
const normalizeArtist = artist => String(artist||'').trim().toLowerCase().replace(/_/g,' ');

export function formatAnimaTags({
  characterSummary = 'anime girl, school uniform, pleated skirt, blazer, ribbon',
  artist = '',
  variant = 'base',
  viewPrompt = '',
}) {
  const normalizedBody = normalizeAnimaTags(characterSummary,variant);
  const artistClean = normalizeArtist(artist);
  const artistTag = artistClean
    ? artistClean.startsWith('@')
      ? artistClean
      : `@${artistClean}`
    : '';

  const prefix =
    variant === 'aesthetic'
      ? 'masterpiece, best quality, year 2025, newest, highres, safe'
      : 'masterpiece, best quality, score_7, year 2025, newest, highres, safe';

  const parts = [prefix, 'solo', artistTag, normalizedBody, viewPrompt].filter(Boolean);
  const positive = parts.join(', ');
  const negative =
    variant === 'aesthetic'
      ? 'worst quality, low quality, blurry, jpeg artifacts, chromatic aberration, perspective distortion, dramatic shadows, glasses, open mouth, text, watermark'
      : 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration, perspective distortion, harsh shadows, glasses, open mouth, text, watermark';

  return { positive, negative };
}

/**
 * Compile model-tailored 3D turnaround prompts for all 8 part views + 3 full-body balance views.
 */
function compileBuiltInPack({
  modelId = 'qwen-image-2.1-local',
  characterPrompt = 'anime girl with silver-blue twin-tails, navy academy blazer, red neck ribbon, charcoal pleated skirt, white knee-high socks, brown loafers',
  artistTag = '',
  animaVariant = 'base',
  rgbaTransparent = true,
  useProjectReference = false,
  templates = false,
  slots = REQUIRED_VIEW_SLOTS.map((s) => s.id),
} = {}) {
  const model = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown image model: ${modelId}`);
  if (!['base', 'aesthetic', 'turbo'].includes(animaVariant)) throw new Error('Invalid Anima variant');
  if (!Array.isArray(slots) || !slots.length || slots.some(id => !REQUIRED_VIEW_SLOTS.some(s => s.id === id))) throw new Error('slots must contain valid view IDs');
  const selectedSlots = REQUIRED_VIEW_SLOTS.filter((s) => slots.includes(s.id));

  const anglePhrase = {
    front: 'strict front orthographic view, facing straight ahead at camera, symmetrical posture',
    right: 'orthographic profile from the character’s anatomical right, exactly 90 degrees, do not mirror costume details',
    left: 'orthographic profile from the character’s anatomical left, exactly 90 degrees, do not mirror costume details',
    back: 'strict back 180-degree rear orthographic view, facing away from camera, back of hair and outfit clearly visible',
  };

  const compiled = selectedSlots.map((slot) => {
    const isHead = slot.group === 'head';
    const isBody = slot.group === 'body';
    const scopeSpec = isHead
      ? 'isolated head, hair, ears, and upper neck only (cropped cleanly below collarbone, no torso, closed neutral mouth, no glasses or eyewear, flat even albedo lighting)'
      : isBody
        ? 'headless or neutral mannequin neck T-pose full body costume reference, arms stretched straight out horizontally at 90 degrees (strict T-pose), legs straight and slightly apart, flat even studio lighting, no hair occlusion over shoulders'
        : 'full-body neutral standing proportion reference from head to shoes, consistent crown and sole height, flat cel lighting, no drawn rulers';

    const viewCore = `${scopeSpec}, ${anglePhrase[slot.angle] || anglePhrase.front}, one isolated view, no collage`;
    const keep = templates ? '{reference}' : useProjectReference ? REFERENCE_INSTRUCTION : '';

    if (model.driver === 'comfyui_anima') {
      const weightBoost = isBody
        ? '(t-pose:1.8), (arms outstretched:1.6), (orthographic view:1.5), (flat color:1.3), (white background:1.4), standing, full body, no text'
        : isHead
          ? '(cropped shoulders:1.5), (closed mouth:1.5), (no eyewear:1.5), (orthographic view:1.4), (flat color:1.3), (white background:1.4), portrait, no text'
          : '(orthographic turnaround:1.5), (full body:1.5), (flat color:1.3), (white background:1.4), standing, no text';
      const anima = formatAnimaTags({
        characterSummary: characterPrompt,
        artist: artistTag,
        variant: animaVariant,
        viewPrompt: `${viewCore.toLowerCase()}, ${weightBoost}`,
      });
      return {
        slotId: slot.id,
        group: slot.group,
        angle: slot.angle,
        labelZh: slot.labelZh,
        resolution: isHead ? '1024x1024' : '896x1344',
        positivePrompt: templates ? anima.positive.replace('@{artist}, ','{artist}') : anima.positive,
        negativePrompt: anima.negative,
      };
    }

    if (model.driver === 'novelai') {
      const naiTags = isBody
        ? 'masterpiece, best quality, very aesthetic, solo, standing, t-pose, arms outstretched, orthographic, single view, no text, flat lighting, simple white background'
        : isHead
          ? 'masterpiece, best quality, very aesthetic, solo, cropped shoulders, head focus, closed mouth, neutral expression, no eyewear, orthographic, reference sheet, no text, simple white background'
          : 'masterpiece, best quality, very aesthetic, solo, full body, standing, single view, no text, simple white background';
      return {
        slotId: slot.id,
        group: slot.group,
        angle: slot.angle,
        labelZh: slot.labelZh,
        resolution: isHead ? '1024x1024' : '832x1216',
        positivePrompt: `${naiTags}, ${characterPrompt}, ${viewCore}.${keep}${rgbaTransparent && model.nativeRgba ? ' Use a transparent background.' : ''}`,
        negativePrompt: 'lowres, bad anatomy, perspective foreshortening, dutch angle, dramatic rim light, drop shadow, text, watermark, signature, extra limbs, glasses, open mouth',
        preciseReferenceHint: {
          enabledOnV45: true,
          fidelity: 0.9,
          strength: isBody ? 0.5 : 0.58,
          referenceCanvas: '1024x1536',
        },
      };
    }

    // Qwen-Image-2.1 (with optional native RGBA wrapper) & Cloud Natural-Language Models
    const useRgba = Boolean(rgbaTransparent && model.nativeRgba);
    const bodySentence = `Clean orthographic reference of ${characterPrompt} for 3D character modeling. ${viewCore}.${keep} Even diffuse albedo illumination, no cast shadows, crisp garment seams, no typography.`;
    const finalPositive = useRgba
      ? `This is an RGBA image with transparency. ${bodySentence} The image has alpha channel and the background is transparent.`
      : `${bodySentence} Pure solid neutral white background (#FFFFFF).`;

    return {
      slotId: slot.id,
      group: slot.group,
      angle: slot.angle,
      labelZh: slot.labelZh,
      resolution: model.driver.startsWith('qwen_') || model.driver === 'comfyui_qwen' ? (isHead ? '2048x2048' : '1792x2400') : isHead ? '1024x1024' : '1024x1536',
      positivePrompt: finalPositive,
      negativePrompt: 'perspective distortion, fisheye, dramatic shadows, rim lighting, motion blur, depth of field, open mouth, glasses, text, watermark, messy background',
    };
  });

  return {
    benchmarkMeta: AA_SNAPSHOT_META,
    model: {
      id: model.id,
      name: model.name,
      vendor: model.vendor,
      deployment: model.deployment,
      weights: model.weights,
      driver: model.driver,
      nativeRgba: model.nativeRgba,
      adapterZh: model.adapterZh,
      adapterEn: model.adapterEn,
      promptTipsZh: model.promptTipsZh,
      promptTipsEn: model.promptTipsEn,
    },
    global3dPrepChecklistZh: [
      '头部默认闭口、摘眼镜或面具，保留完整发缘和颈口。后续再单独制作配饰、口腔与表情。',
      '身体四视图必须采用【标准水平 90° T-Pose + 去长发遮挡】，防止长发与背部/肩膀粘连成无法拆分的实心块。',
      '正/侧/背视图必须保持【头顶、眼线、肩线、胯线、脚底】五条水平线高度一致，避免多图输入 Tripo 时发生法线重影。',
      '统一使用平涂漫反射（Flat Albedo）与纯白/透明背景，严禁强烈逆光或投影。',
    ],
    views: compiled,
  };
}

export function queryModelCatalog({
  deployment = 'all',
  weights = 'all',
  capability = 'all',
} = {}) {
  const items = IMAGE_MODEL_CATALOG.filter((m) => {
    if (deployment !== 'all' && m.deployment !== deployment && m.deployment !== 'hybrid') return false;
    if (weights !== 'all' && m.weights !== weights) return false;
    if (capability !== 'all' && !m.recommendedFor.includes(capability)) return false;
    return true;
  });
  return {
    benchmark: AA_SNAPSHOT_META,
    total: items.length,
    models: items,
  };
}

const REFERENCE_INSTRUCTION = ' Preserve identity, palette and asymmetry from the reference image; change only the requested view, pose and crop.';
export function validatePromptTemplate(template) {
  if (!template || typeof template!=='object'||Array.isArray(template)||Object.keys(template).some(k=>!['positive','negative'].includes(k)) ||
      typeof template.positive!=='string'||!template.positive.trim()||template.positive.length>4500||typeof template.negative!=='string'||template.negative.length>2500|| /\0/.test(template.positive+template.negative)) throw new Error('Set a positive template (up to 4500 characters) and an optional negative template (up to 2500 characters)');
  return {positive:template.positive,negative:template.negative};
}
export function getTurnaroundPromptTemplates(options) {
  return compileBuiltInPack({...options,templates:true,characterPrompt:'{character}',artistTag:'{artist}'}).views;
}
export function compileTurnaroundPromptPack(options={}) {
  const pack=compileBuiltInPack({...options,templates:false});
  const templates=options.promptTemplates||{};
  if(!Object.keys(templates).length)return pack;
  const isAnima=pack.model.driver==='comfyui_anima';
  const summary=options.characterPrompt||'original character with consistent hair, outfit and palette';
  const artist=isAnima?normalizeArtist(options.artistTag):'';
  const values={character:isAnima?normalizeAnimaTags(summary,options.animaVariant):summary,artist:artist?(artist.startsWith('@')?artist:'@'+artist)+', ':'',reference:options.useProjectReference?REFERENCE_INSTRUCTION:''};
  const expand=text=>text.replace(/\{(character|artist|reference)\}/g,(_token,key)=>values[key]).trim();
  return {...pack,views:pack.views.map(view=>{
    if(!Object.hasOwn(templates,view.slotId))return view;
    const override=validatePromptTemplate(templates[view.slotId]),positive=expand(override.positive);
    if(!positive)throw new Error(`Prompt template for ${view.slotId} is empty after replacing placeholders`);
    return {...view,positivePrompt:positive,negativePrompt:expand(override.negative),templateSource:'project_override'};
  })};
}
