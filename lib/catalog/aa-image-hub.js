/**
 * dsh-charakuru-studio — Artificial Analysis (AA v2.1, Nov 2026) Closed & Open-Weights Image Hub
 * + 3D Character Turnaround Prompt Engineering Tip Compiler.
 *
 * Covers:
 *   1) Snapshot AA-Image-T2I v2.1 & AA-Image-Editing v2.1 top models (Closed & Open-Weights)
 *   2) User-prioritized production backends:
 *      - Local Qwen-Image-2.1 (`Qwen/Qwen-Image-2.1` & `Qwen-Image-2.1-Turbo`, native RGBA + 10-ref editing)
 *      - Local ComfyUI Anima (`circlestone-labs/Anima` Base / Aesthetic / Turbo, 2B anime specialist)
 *      - Cloud NovelAI Diffusion V5 Full / Curated & V4.5 Precise Reference
 *      - Cloud Seedream 5.5 / GPT Image 2.6 Sunburst / Nano Banana 2.1 / MiniMax H3-Image / FLUX 3
 */

import { REQUIRED_VIEW_SLOTS } from '../constants.js';

export const AA_SNAPSHOT_META = Object.freeze({
  benchmark: 'Artificial Analysis Image Arena v2.1 (T2I + Image Editing)',
  updatedAt: '2026-11-16',
  snapshot: true,
  apiIdsVerified: false,
  note: 'Leaderboard names are not API model identifiers. Cloud execution requires an explicit model ID from your provider.',
  sourceUrls: [
    'https://artificialanalysis.ai/image/leaderboard/text-to-image',
    'https://artificialanalysis.ai/image/leaderboard/editing',
    'https://huggingface.co/Qwen/Qwen-Image-2.1',
    'https://huggingface.co/circlestone-labs/Anima',
    'https://docs.novelai.net/en/image/models',
    'https://docs.novelai.net/en/image/precisereference',
  ],
});

export const IMAGE_MODEL_CATALOG = Object.freeze([
  // ───────────────────── Featured Local / Open-Weights Anime & 3D Prep Models ─────────────────────
  {
    id: 'qwen-image-2.1-local',
    name: 'Qwen-Image-2.1 (Local / ComfyUI / Diffusers)',
    vendor: 'Alibaba Qwen',
    deployment: 'local',
    weights: 'open_weights',
    driver: 'qwen_local',
    hfRepo: 'Qwen/Qwen-Image-2.1',
    licenseNotice: 'Qwen Research License; model weights are separate from this MIT plugin.',
    aaT2iRank: null,
    aaT2iElo: null,
    aaEditRank: null,
    aaEditElo: null,
    pricePer1kUsd: 0,
    recommendedFor: ['rgba_cutout', 'multi_ref_edit', 'part_split_8views', 'zero_safety_false_positive'],
    nativeRgba: true,
    maxReferenceImages: 10,
    recommendedResolutions: ['1792x2400', '2048x2048', '2400x1792'],
    recommendedSampler: { steps: 40, turboSteps: 8, dtype: 'bfloat16', pipeline: 'QwenImage21Pipeline' },
    badgeZh: '本地首选 · 原生RGBA透明通道 + 10图参考编辑',
    badgeEn: 'Local Flagship · Native RGBA + 10-Ref Editing',
    promptTipsZh: [
      '【原生透明通道秘籍】生成免抠图直接喂给 Tripo 时，必须使用官方 RGBA 句式开头与结尾："This is an RGBA image with transparency. <主体与角度描述>. The image has alpha channel and the background is transparent."',
      '【立绘转 T-Pose 多视图】使用 Image Editing 模式传入原立绘（最多支持 10 张参考图），显式声明保留面部特征与配色，同时强制改写姿态为标准水平手臂 T-Pose 与正交投影（orthographic view, no perspective distortion）。',
      '【推荐分辨率】全身三视图与 T-Pose 体用 3:4（1792×2400），单独头部+发型四视图用 1:1（2048×2048）；显存不足开启 pipe.enable_model_cpu_offload() 或改用 Qwen-Image-2.1-Turbo（8 步）。',
      '【头部拆件铁律】生成头部四视图时必须写明 "closed neutral mouth, no glasses, hair fully visible, neck cleanly visible"，眼镜与张口一律留在 Blender 阶段处理。',
    ],
    promptTipsEn: [
      'Wrap prompts with "This is an RGBA image with transparency. ... The image has alpha channel and the background is transparent." for native alpha cutouts.',
      'Pass the source character sheet via QwenImage21Pipeline(image=input_image) to lock outfit/palette while re-posing into strict orthographic T-pose.',
      'Use 1792x2400 (3:4) for T-pose body/turnaround and 2048x2048 (1:1) for isolated head+hair views; use Qwen-Image-2.1-Turbo at 8 steps for fast iteration.',
    ],
  },
  {
    id: 'comfyui-anima-local',
    name: 'Anima v1.0 Base / Aesthetic / Turbo (Local ComfyUI)',
    vendor: 'CircleStone Labs × Comfy Org',
    deployment: 'local',
    weights: 'open_weights',
    driver: 'comfyui_anima',
    hfRepo: 'circlestone-labs/Anima',
    licenseNotice: 'Anima weights have separate noncommercial terms; consult model license and output terms.',
    aaT2iRank: null,
    aaT2iElo: null,
    aaEditRank: null,
    aaEditElo: null,
    pricePer1kUsd: 0,
    recommendedFor: ['anime_cel_lineart', 'flat_color_for_3d', 'local_comfyui', 'zero_safety_false_positive'],
    nativeRgba: false,
    maxReferenceImages: 2,
    recommendedResolutions: ['1024x1024', '896x1344', '1344x896', '1024x1536'],
    recommendedSampler: {
      steps: 36,
      cfg: 4.5,
      sampler: 'er_sde',
      scheduler: 'normal',
      turbo: { steps: 10, cfg: 1.0, sampler: 'euler' },
      files: {
        unet: 'anima-base-v1.0.safetensors',
        clip: 'qwen_3_06b_base.safetensors',
        vae: 'qwen_image_vae.safetensors',
      },
    },
    badgeZh: '本地二次元专精 · 2B轻量锐利平涂线稿（极利好Tripo建模）',
    badgeEn: 'Local Anime 2B Specialist · Crisp Flat Cel Shading for 3D',
    promptTipsZh: [
      '【空格替代下划线】Anima 使用小写 Gelbooru/Danbooru 标签，除 score_7 等分数词外，所有标签一律用空格不用下划线（如 long hair, pleated skirt, white background）。',
      '【画师标签强制 @ 前缀】指定画风时必须在画师名前加 @（如 @artist name），不加 @ 几乎无效！',
      '【严格标签顺序】[质量/年份/安全词] -> [1girl/1boy] -> [角色/作品] -> [@画师] -> [外观/T-Pose/正交视角标签]；可混写两句以上英文自然语言增强结构描述。',
      '【权重需放大 + 采样器选型】Anima 的括号权重需要比 SDXL 更高才显著，3D 拆件建议写 (t-pose:1.8), (orthographic view:1.5), (flat color:1.3)；采样器首选 er_sde（线条最锐利、平涂色块最干净，Tripo 识别极稳）。',
      '【版本差异】Anima-Base 用 "masterpiece, best quality, score_7, safe"；Anima-Aesthetic 切勿加 score_* 标签（会过饱和）；快速试稿用 Anima-Turbo（CFG=1, 8–12 步）。',
    ],
    promptTipsEn: [
      'Use lowercase Gelbooru tags with SPACES instead of underscores (only score_7 keeps underscore).',
      'Prefix artist tags with @ (e.g. @artist); omitting @ makes style steering very weak.',
      'Use stronger weights than SDXL such as (t-pose:1.8), sampler er_sde at 35-45 steps CFG 4.5 for flat colors and sharp edges; drop score_* tags on Anima-Aesthetic.',
    ],
  },
  {
    id: 'novelai-v5-cloud',
    name: 'NovelAI Diffusion V5 Full / Curated (+ V4.5 Precise Ref)',
    vendor: 'NovelAI (Anlatan)',
    deployment: 'cloud',
    weights: 'closed',
    driver: 'novelai',
    apiModelIds: ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-5-full'],
    aaT2iRank: null,
    aaT2iElo: null,
    aaEditRank: null,
    aaEditElo: null,
    pricePer1kUsd: 15.0,
    recommendedFor: ['anime_character_consistency', 'turnaround_sheet', 'alpha_transparency', 'opus_v45_free'],
    nativeRgba: true,
    maxReferenceImages: 4,
    recommendedResolutions: ['832x1216', '1024x1024', '1024x1536', '1472x1472'],
    recommendedSampler: { steps: 28, cfg: 5.0, sampler: 'k_euler_ancestral', noiseSchedule: 'karras' },
    badgeZh: '云端二次元霸主 · V5多语种透明图 + V4.5精准角色参考/Opus免点',
    badgeEn: 'Cloud Anime Standard · V5 Multi-Lang Alpha + V4.5 Precise Ref',
    promptTipsZh: [
      '【V5 核心升级】参数量翻倍（26.8万 B200 GPU 小时训练），原生支持中/日/英自然语言混写、高达 ~1471 有效 Token（Curated 为 ~703）与原生 Alpha 透明背景标签，角色站位控制大幅重做。',
      '【省钱攻略：Opus 额度分配】V5 首次对 Opus 订阅引入免费生成次数上限；建议先用 V4.5 Full（832×1216 / 1024×1024 无限免费）跑通构图，或用 V4.5 独占的 Precise Reference 锁死立绘一致性！',
      '【Precise Reference 3D 拆件黄金参数】在 V4.5 开启 Character Reference（+5 Anlas/张），将画布垫到 1024×1536 或 1472×1472（可在角落拼一张脸部放大特写）：把 Fidelity 拉高至 0.85–1.0（锁死服装细节），把 Strength 压低至 0.45–0.60（释放姿势自由度，否则角色会死守原立绘斜站姿势不肯摆 T-Pose！）。',
      '【官方三视图/拆件标签组合】搭配 multiple views, turnaround, reference sheet, no text, simple background, standing, arms outstretched；头部特写加 cropped shoulders, closed mouth, no eyewear。注意：Precise Reference 与 Vibe Transfer 互斥。',
    ],
    promptTipsEn: [
      'V5 Full supports ~1471 tokens, multi-language EN/JP/ZH natural prose, and alpha transparency tags; note V5 has an Opus free-gen cap while V4.5 stays unlimited for Opus.',
      'For V4.5 Precise Reference (+5 Anlas): set Fidelity 0.85-1.0 (strict outfit lock) and lower Strength to 0.45-0.60 so the character can change pose into T-pose/back views; pad ref to 1024x1536 or 1472x1472.',
    ],
  },

  // ───────────────────── Live Nov 2026 Artificial Analysis Leaderboard Models ─────────────────────
  {
    id: 'gpt-image-2.6-sunburst',
    name: 'GPT Image 2.6 Sunburst (max)',
    vendor: 'OpenAI',
    deployment: 'cloud',
    weights: 'closed',
    driver: 'openai_compat',
    apiModelIds: ['gpt-image-2.6-sunburst', 'gpt-image-2', 'gpt-image-1.5'],
    aaT2iRank: 1,
    aaT2iElo: 1261,
    aaEditRank: 1,
    aaEditElo: 1211,
    pricePer1kUsd: 210.72,
    recommendedFor: ['strict_instruction_following', 'multi_view_alignment', 'material_brushup'],
    nativeRgba: true,
    maxReferenceImages: 8,
    recommendedResolutions: ['1024x1024', '1024x1536', '1536x1024'],
    recommendedSampler: { quality: 'high', background: 'transparent' },
    badgeZh: 'AA双榜 #1 (T2I 1261 / Edit 1211) · 指令遵循天花板',
    badgeEn: 'AA #1 Overall (T2I 1261 / Edit 1211)',
    promptTipsZh: [
      '【正交对齐最强】直接用结构化分点指令要求同一水平高度参考线（eye line, shoulder line, hip line, ankle line aligned horizontally），正侧背比例漂移极小。',
      '【防安全误杀提示】二次元学院短裙/素体拆件时，明确写 "3D character modeling orthographic costume turnaround sheet, opaque safety shorts under skirt, mannequin-clean studio lighting"，若仍被拦截一键切回本地 Qwen-Image-2.1 或 NovelAI。',
    ],
    promptTipsEn: [
      'Top Elo on both T2I (1261) and Image Editing (1211); specify explicit horizontal alignment landmarks and background="transparent".',
      'To avoid false-positive moderation on anime skirts/body refs, state "orthographic 3D game asset costume turnaround, opaque athletic undershorts" or route to Qwen-Image-2.1 / Anima.',
    ],
  },
  {
    id: 'seedream-5.5',
    name: 'Seedream 5.5',
    vendor: 'ByteDance Seed',
    deployment: 'cloud',
    weights: 'closed',
    driver: 'openai_compat',
    apiModelIds: ['seedream-5.5', 'doubao-seedream-5-5'],
    aaT2iRank: 12,
    aaT2iElo: 1134,
    aaEditRank: 7,
    aaEditElo: 1160,
    pricePer1kUsd: 20.0,
    recommendedFor: ['cost_effective_turnaround', 'image_editing_views', 'east_asian_anime_aesthetics'],
    nativeRgba: false,
    maxReferenceImages: 6,
    recommendedResolutions: ['1024x1024', '1152x1536', '1536x1152'],
    recommendedSampler: { guidance_scale: 4.0 },
    badgeZh: 'AA编辑榜 #7 (1160) · 云端性价比之王 ($20/千张)',
    badgeEn: 'AA Editing #7 (1160) · Best Cloud Value ($20/1k)',
    promptTipsZh: [
      '【中文原生理解极强】可直接输入精确的中文服装结构术语（如“双排扣水手领学院制服、百褶裙独立层次、无透视正交四视图、纯白无阴影背景”），单张成本仅 $0.02。',
      '【图像编辑强项】AA 编辑榜高达 1160 Elo（#7），非常适合喂入正面立绘逐张改出右侧、左侧、背面与去头发颈部结构图。',
    ],
    promptTipsEn: [
      'Ranks #7 globally on AA Image Editing (1160 Elo) at just $20-$28/1k images; excels at turning a single front anime illustration into consistent side and back orthographic views.',
    ],
  },
  {
    id: 'nano-banana-2.1',
    name: 'Nano Banana 2.1 / Gemini 3.1 Flash Image',
    vendor: 'Google',
    deployment: 'cloud',
    weights: 'closed',
    driver: 'gemini',
    apiModelIds: ['nano-banana-2.1', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'],
    aaT2iRank: 7,
    aaT2iElo: 1176,
    aaEditRank: 9,
    aaEditElo: 1152,
    pricePer1kUsd: 33.6,
    recommendedFor: ['multi_turn_view_fix', 'back_hair_completion', 'fast_iteration'],
    nativeRgba: false,
    maxReferenceImages: 8,
    recommendedResolutions: ['1024x1024', '896x1280'],
    recommendedSampler: { responseModalities: ['TEXT', 'IMAGE'] },
    badgeZh: 'AA生图榜 #7 (1176) · 多轮对话局部修图利器',
    badgeEn: 'AA T2I #7 (1176) · Conversational View Repair',
    promptTipsZh: [
      '【多轮修破绽】当背面发尾长度或领结结构与正面不一致时，把正/背两张图同时传入对话："保持左图发长比例，仅修正右图后脑发尾下缘高度至肩胛骨中线，其余像素不动"。',
    ],
    promptTipsEn: [
      'Pass both front and back views in one multimodal turn to repair hair length or collar alignment drift without regenerating the entire sheet.',
    ],
  },
  {
    id: 'minimax-h3-image',
    name: 'MiniMax H3-Image (Open-Weights)',
    vendor: 'MiniMax',
    deployment: 'hybrid',
    weights: 'open_weights',
    driver: 'openai_compat',
    hfRepo: 'MiniMaxAI/MiniMax-H3-Image',
    apiModelIds: ['h3-image', 'h3-image-highspeed'],
    aaT2iRank: null,
    aaT2iElo: null,
    aaEditRank: 13,
    aaEditElo: 1135,
    pricePer1kUsd: 26.54,
    recommendedFor: ['open_weights_editing', 'material_cleanup', 'pose_normalization'],
    nativeRgba: false,
    maxReferenceImages: 4,
    recommendedResolutions: ['1024x1024', '1024x1536'],
    recommendedSampler: { steps: 30 },
    badgeZh: 'AA开源编辑榜 #1 (1135 Elo) · 可私有化部署',
    badgeEn: 'AA #1 Open-Weights Image Editing (1135 Elo)',
    promptTipsZh: [
      '【开源指令编辑榜首】2026年11月登顶 AA 开源权重编辑榜（1135 Elo），适合把带复杂光影/背景的商业立绘“去光影平涂化（delight to flat albedo）”后再喂入 Tripo，显著减少贴图烘焙黑影。',
    ],
    promptTipsEn: [
      'Top-ranked open-weights image editor on AA v2.1 (1135 Elo); ideal for delighting dramatic anime illustrations into flat neutral albedo before 3D reconstruction.',
    ],
  },
  {
    id: 'kling-image-4.0',
    name: 'Kling Image 4.0',
    vendor: 'KlingAI',
    deployment: 'cloud',
    weights: 'closed',
    driver: 'openai_compat',
    apiModelIds: ['kling-image-4.0'],
    aaT2iRank: 6,
    aaT2iElo: 1180,
    aaEditRank: 6,
    aaEditElo: 1183,
    pricePer1kUsd: null,
    recommendedFor: ['costume_fabric_detail', 'character_sheet'],
    nativeRgba: false,
    maxReferenceImages: 4,
    recommendedResolutions: ['1024x1024', '1024x1536'],
    recommendedSampler: {},
    badgeZh: 'AA双榜 #6 (T2I 1180 / Edit 1183) · 东方二次元服饰细节强',
    badgeEn: 'AA #6 Overall (T2I 1180 / Edit 1183)',
    promptTipsZh: [
      '【服饰褶皱与配饰清晰】对学院制服金扣、缎带层次、鞋靴金属扣环刻画极准，生成时务必补充“无景深模糊（no depth of field, sharp focus everywhere）、柔和平光”。',
    ],
    promptTipsEn: [
      'Strong anime/game costume rendering (#6 on both AA T2I and Editing); explicitly request "flat studio lighting, zero depth-of-field blur" for clean 3D photogrammetry.',
    ],
  },
  {
    id: 'flux-3-image',
    name: 'FLUX 3 Image / FLUX 3 Klein (Open-Weights)',
    vendor: 'Black Forest Labs',
    deployment: 'hybrid',
    weights: 'open_weights',
    driver: 'openai_compat',
    apiModelIds: ['flux-3-image', 'flux-3-klein', 'flux-2-dev-turbo'],
    aaT2iRank: 19,
    aaT2iElo: 1115,
    aaEditRank: null,
    aaEditElo: null,
    pricePer1kUsd: 48.0,
    recommendedFor: ['hard_surface_props', 'clean_orthographic_silhouette'],
    nativeRgba: false,
    maxReferenceImages: 4,
    recommendedResolutions: ['1024x1024', '1024x1536'],
    recommendedSampler: { steps: 28, guidance: 3.5 },
    badgeZh: 'AA生图榜 #19 (1115) · Klein版开源轻量高结构精度',
    badgeEn: 'AA T2I #19 (1115) · Crisp Silhouette & Props',
    promptTipsZh: [
      '【硬表面配饰与剪影】用完整英文陈述句描述几何结构与材质（而非碎标签堆砌），对发饰、武器挂件、鞋跟几何对称度控制极佳。',
    ],
    promptTipsEn: [
      'Write descriptive natural-language sentences rather than comma-tag soup; strong geometric symmetry on footwear, hairpins, and structured uniforms.',
    ],
  },
]);

/**
 * Convert underscore Danbooru tags to CircleStone Anima's space-separated lowercase syntax,
 * keeping `score_*` underscores and ensuring `@` prefix on artist tags.
 */
export function formatAnimaTags({
  characterSummary = 'anime girl, school uniform, pleated skirt, blazer, ribbon',
  artist = '',
  variant = 'base',
  viewPrompt = '',
}) {
  const normalizedBody = String(characterSummary)
    .split(',')
    .map((raw) => raw.trim().toLowerCase())
    .filter(Boolean)
    .filter(tag => variant !== 'aesthetic' || !/^score[_ ]/.test(tag))
    .map((tag) => (/^score_\d+$/.test(tag) ? tag : tag.replace(/_/g, ' ')))
    .join(', ');

  const artistClean = String(artist || '').trim().toLowerCase().replace(/_/g, ' ');
  const artistTag = artistClean
    ? artistClean.startsWith('@')
      ? artistClean
      : `@${artistClean}`
    : '';

  const prefix =
    variant === 'aesthetic'
      ? 'masterpiece, best quality, year 2025, newest, highres, safe'
      : 'masterpiece, best quality, score_7, year 2025, newest, highres, safe';

  const parts = [prefix, '1girl, solo', artistTag, normalizedBody, viewPrompt].filter(Boolean);
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
export function compileTurnaroundPromptPack({
  modelId = 'qwen-image-2.1-local',
  characterPrompt = 'anime girl with silver-blue twin-tails, navy academy blazer, red neck ribbon, charcoal pleated skirt, white knee-high socks, brown loafers',
  artistTag = '',
  animaVariant = 'base',
  rgbaTransparent = true,
  slots = REQUIRED_VIEW_SLOTS.map((s) => s.id),
} = {}) {
  const model = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown image model: ${modelId}`);
  if (!['base', 'aesthetic', 'turbo'].includes(animaVariant)) throw new Error('Invalid Anima variant');
  if (!Array.isArray(slots) || !slots.length || slots.some(id => !REQUIRED_VIEW_SLOTS.some(s => s.id === id))) throw new Error('slots must contain valid view IDs');
  const selectedSlots = REQUIRED_VIEW_SLOTS.filter((s) => slots.includes(s.id));

  const anglePhrase = {
    front: 'strict front orthographic view, facing straight ahead at camera, symmetrical posture',
    right: 'strict right-side 90-degree profile orthographic view, facing right',
    left: 'strict left-side 90-degree profile orthographic view, facing left',
    back: 'strict back 180-degree rear orthographic view, facing away from camera, back of hair and outfit clearly visible',
  };

  const compiled = selectedSlots.map((slot) => {
    const isHead = slot.group === 'head';
    const isBody = slot.group === 'body';
    const scopeSpec = isHead
      ? 'isolated head, hair, ears, and upper neck only (cropped cleanly below collarbone, no torso, closed neutral mouth, no glasses or eyewear, flat even albedo lighting)'
      : isBody
        ? 'headless or neutral mannequin neck T-pose full body costume reference, arms stretched straight out horizontally at 90 degrees (strict T-pose), legs straight and slightly apart, flat even studio lighting, no hair occlusion over shoulders'
        : 'full-body standing A-pose / neutral turnaround proportion reference from head to shoes, aligned horizontal head-shoulder-hip-ankle height lines, flat cel lighting';

    const viewCore = `${scopeSpec}, ${anglePhrase[slot.angle] || anglePhrase.front}`;

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
        positivePrompt: anima.positive,
        negativePrompt: anima.negative,
      };
    }

    if (model.driver === 'novelai') {
      const naiTags = isBody
        ? 'masterpiece, best quality, very aesthetic, 1girl, solo, standing, t-pose, arms outstretched, orthographic, turnaround, reference sheet, no text, flat lighting, simple white background'
        : isHead
          ? 'masterpiece, best quality, very aesthetic, 1girl, solo, cropped shoulders, head focus, closed mouth, neutral expression, no eyewear, orthographic, reference sheet, no text, simple white background'
          : 'masterpiece, best quality, very aesthetic, 1girl, solo, full body, standing, turnaround, reference sheet, no text, simple white background';
      return {
        slotId: slot.id,
        group: slot.group,
        angle: slot.angle,
        labelZh: slot.labelZh,
        resolution: isHead ? '1024x1024' : '832x1216',
        positivePrompt: `${naiTags}, ${characterPrompt}, ${viewCore}`,
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
    const bodySentence = `Clean 3D character modeling orthographic reference sheet of ${characterPrompt}. ${viewCore}. Even diffuse albedo illumination, zero cast shadows, zero lens perspective distortion, crisp garment seams, no text or watermarks.`;
    const finalPositive = useRgba
      ? `This is an RGBA image with transparency. ${bodySentence} The image has alpha channel and the background is transparent.`
      : `${bodySentence} Pure solid neutral white background (#FFFFFF).`;

    return {
      slotId: slot.id,
      group: slot.group,
      angle: slot.angle,
      labelZh: slot.labelZh,
      resolution: model.driver === 'qwen_local' ? (isHead ? '2048x2048' : '1792x2400') : isHead ? '1024x1024' : '1024x1536',
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
      recommendedSampler: model.recommendedSampler,
      promptTipsZh: model.promptTipsZh,
      promptTipsEn: model.promptTipsEn,
    },
    global3dPrepChecklistZh: [
      '头部四视图必须【闭口 + 摘除眼镜/面具】，否则 Tripo 会把镜框熔进眼窝网格、把张嘴焊死在基础拓扑上。',
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
