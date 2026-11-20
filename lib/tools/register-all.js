import { readTripoStudioTicket, collectTripoStudioDownload } from '../tripo/studio-handoff.js';
import { queryTripoOpenApiBalance, submitTripoOpenApiTask, pollTripoOpenApiTask } from '../tripo/openapi-client.js';
import { getRenderRequest, listRenderRequests, runRender, settleRender } from '../project/render.js';
import {
  EDITOR_OPERATIONS,
  runEditorOperation,
  cancelEditorJob,
  collectEditorJob,
  createAiEditRequest,
  inspectAiEdit,
  rollbackEditor,
  setEditorChannelPreference,
  checkoutEditorGui,
  checkinEditorGui,
  abortEditorGui,
  resolveProjectVrmFile,
} from '../project/editor.js';
import { inspectVrmMetadata } from '../vrm/metadata-patcher.js';
import { setWorkflowMode, selectFoundation, planTripoParts } from '../project/workflow.js';
import { importProjectMaterial } from '../project/materials.js';
import { importStudioAsset, scanGeneratedViews } from '../project/assets.js';
import { callerFromExecution } from '../blender/transport.js';
/**
 * dsh-charakuru-studio — Consolidated Host Agent Tool Registrations (7 Domain Tools).
 *
 * Follows DSH `tool-design.md`:
 *   - Consolidate related operations with clear `action` discriminators
 *   - Bound output size and sanitize every return value via `losslessSanitize`
 *   - Never return raw API keys
 */

import path from 'node:path';
import { zSafe as z, buildToolRegistration } from '../contracts/schema.js';
import { okEnvelope, errorEnvelope } from '../contracts/lossless.js';
import { queryModelCatalog, compileTurnaroundPromptPack } from '../catalog/aa-image-hub.js';
import {
  initOrUpdateProject,
  loadProjectState,
  updateProjectState,
  transitionStageCheckpoint,
  summarizeProjectProgress,
} from '../project/state.js';
import { createProjectRegistry } from '../project/registry.js';
import { createCredentialManager } from '../host/credentials.js';
import { checkImageSetup, runTurnaroundGeneration } from '../providers/image-router.js';
import { imageModelProfile, readImageTemplates, saveImageProfile } from '../providers/image-profiles.js';
import { createAccountBudget } from '../providers/account-budget.js';
import { planTripoFreeQuotaRun, archiveTripoGlbAsset } from '../tripo/free-quota-scheduler.js';
import { probeBlenderPluginLink, runBlenderAvatarStage, collectBlenderAvatarJob } from '../blender/bridge.js';

export function buildStudioTools({ config = {}, credentialManager, getServer } = {}) {
  const defaultProject = () => {
    const srv = typeof getServer === 'function' ? getServer() : null;
    return srv ? srv.getActiveProjectDir() : path.resolve(process.cwd(), 'charakuru-avatar-project');
  };

  // 1. AA Leaderboard & Multi-Model Prompt Tip Compiler
  const aaModelsTool = buildToolRegistration({
    name: 'charakuru_aa_models',
    description:
      '查询 2026.11 Artificial Analysis (AA v2.1) 闭源/开源生图与图像编辑榜单，对比热门模型（本地 Qwen-Image-2.1、本地 ComfyUI Anima、云端 NovelAI V5 / V4.5 Precise Reference、GPT Image 2.6 Sunburst、Seedream 5.5、Nano Banana 2.1、MiniMax H3-Image、FLUX 3），并为 8+3 角色拆件四视图编译专属提示词包与防翻车 TIP。',
    parameters: z.object({
      action: z
        .union([z.literal('leaderboard'), z.literal('compile_prompts')])
        .default('leaderboard')
        .description('leaderboard=查询榜单与模型参数建议；compile_prompts=按指定模型语法生成8+3全套正反向提示词'),
      projectDir: z
        .string()
        .optional()
        .description('可选角色工程目录，用于读取工程保存的自定义提示词模板'),
      deployment: z
        .union([z.literal('all'), z.literal('local'), z.literal('cloud')])
        .default('all')
        .description('按本地部署或云端 API 筛选'),
      weights: z
        .union([z.literal('all'), z.literal('open_weights'), z.literal('closed')])
        .default('all')
        .description('按开源权重或闭源模型筛选'),
      modelId: z
        .string()
        .default('qwen-image-2.1-local')
        .description('compile_prompts 时的目标模型 ID，如 qwen-image-2.1-local / comfyui-anima-local / novelai-v5-cloud / seedream-5.5'),
      characterPrompt: z
        .string()
        .optional()
        .description('角色外观、发型、服饰与配色描述'),
      artistTag: z
        .string()
        .optional()
        .description('ComfyUI Anima 专属画师风格名（工具会自动补齐强制要求的 @ 前缀并转为空格标签）'),
      animaVariant: z
        .union([z.literal('base'), z.literal('aesthetic'), z.literal('turbo')])
        .default('base')
        .description('Anima 子版本：aesthetic 自动剔除 score_* 标签，turbo 自动切换 CFG=1 / 8步'),
      rgbaTransparent: z
        .boolean()
        .default(true)
        .description('支持原生透明通道的模型（如 Qwen-Image-2.1 / NovelAI V5 / GPT Image 2.6）是否注入 RGBA 透明背景提示词'),
    }),
    async execute(args) {
      try {
        if (args.action === 'compile_prompts') {
          const modelId = args.modelId || config.defaultImageModel || 'qwen-image-2.1-local';
          let promptTemplates;
          let projectCharacterPrompt;
          const candidateDir = args.projectDir ? path.resolve(args.projectDir) : defaultProject();
          if (candidateDir) {
            const loaded = await loadProjectState(candidateDir).catch(() => ({ exists: false, state: null }));
            if (loaded.exists && loaded.state) {
              promptTemplates = imageModelProfile(loaded.state, modelId).prompts;
              projectCharacterPrompt = loaded.state.characterSpec?.characterPrompt;
            }
          }
          const pack = compileTurnaroundPromptPack({
            modelId,
            characterPrompt: args.characterPrompt || projectCharacterPrompt,
            artistTag: args.artistTag || '',
            animaVariant: args.animaVariant || 'base',
            rgbaTransparent: args.rgbaTransparent !== false,
            promptTemplates,
          });
          return okEnvelope({ action: 'compile_prompts', ...pack });
        }
        const catalog = queryModelCatalog({
          deployment: args.deployment || 'all',
          weights: args.weights || 'all',
        });
        return okEnvelope({ action: 'leaderboard', ...catalog });
      } catch (err) {
        return errorEnvelope('AA_MODELS_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  // 2. Clean-Room Project & 6-Stage Checkpoint State Machine
  const projectTool = buildToolRegistration({
    name: 'charakuru_project',
    description:
      '管理 Clean-Room VRM 角色工程（project.charastudio.json）：初始化目录结构、切换原画重建/素体改型双路线、采用素体与规划部件、查看 6 阶段进度与积分账本、提交人工确认关卡（审批在工作台完成）（checkpoint）、以及写入 VRM 1.0 作者/授权元数据。',
    parameters: z.object({
      action: z
        .union([
          z.literal('init'),
          z.literal('status'),
          z.literal('checkpoint'),
          z.literal('set_vrm_meta'),
          z.literal('import_asset'),
          z.literal('scan_views'),
          z.literal('list_materials'),
          z.literal('set_workflow_mode'),
          z.literal('select_foundation'),
          z.literal('plan_tripo_parts'),
          z.literal('import_material'),
          z.literal('inspect_vrm_meta'),
        ])
        .default('status')
        .description('init=创建/更新；status=状态；checkpoint=提交审阅；import_asset=登记PNG/GLB；scan_views=扫描离线11槽位；list_materials=只读列出已登记的外部素材（可按工序过滤）；set_workflow_mode=切换路线1/2；select_foundation=路线2采用素体/头模；plan_tripo_parts=路线2规划部件积分；import_material=按阶段用途导入外部素材；set_vrm_meta=元数据；inspect_vrm_meta=只读检查已导出 VRM 1.0 内嵌元数据'),
      projectDir: z
        .string()
        .optional()
        .description('角色工程根目录路径（省略使用固定默认工程目录）'),
      workflowMode: z
        .union([z.literal('illustration'), z.literal('base_mesh')])
        .optional()
        .description('set_workflow_mode 时的工作流路线：illustration=原画重建，base_mesh=素体改型'),
      mode: z
        .union([z.literal('illustration'), z.literal('base_mesh')])
        .optional()
        .description('set_workflow_mode 时的工作流路线别名（同 workflowMode）'),
      materialId: z
        .string()
        .optional()
        .description('select_foundation 时采用的已登记素材 ID（或头部传 embedded 沿用素体自带头）'),
      role: z
        .string()
        .optional()
        .description('import_material 时的素材用途角色（如 foundation_body, foundation_head, tripo_clothing_reference, tripo_clothing 等）'),
      kinds: z
        .array(z.union([z.literal('clothing'), z.literal('hair'), z.literal('accessory')]))
        .optional()
        .description('plan_tripo_parts 要规划的部件类别列表（clothing/hair/accessory）'),
      quotedCredits: z
        .number()
        .optional()
        .description('plan_tripo_parts 观察到的 Tripo 积分报价'),
      budget: z
        .number()
        .optional()
        .description('plan_tripo_parts 手工预算上限'),
      assetKind: z.union([z.literal('image'), z.literal('glb')]).optional(),
      slotId: z.string().optional(),
      part: z.union([z.literal('head'), z.literal('body'), z.literal('accessory'), z.literal('clothing'), z.literal('hair')]).optional(),
      sourcePath: z.string().optional(),
      label: z.string().optional().description('资产显示标签'),
      expectedRevision: z.number().optional().description('预期工程状态版本号'),
      projectName: z.string().optional().description('角色工程名称'),
      characterPrompt: z.string().optional().description('角色核心设定描述'),
      sourceImage: z.string().optional().description('原始角色立绘 PNG 路径'),
      monthlyCreditAllowance: z.number().optional().description('账户实际月度额度，可设为 0'),
      headBodyRatio: z.number().optional().description('目标头身比（默认 6.3）'),
      neckScaleFactor: z.number().optional().description('颈部枢轴头部缩放倍率（默认 0.86）'),
      preferredImageModel: z.string().optional().description('首选生图模型 ID'),
      tripoStrategy: z
        .union([
          z.literal('studio_free_saver'),
          z.literal('studio_free_2x2'),
          z.literal('openapi_v3_hybrid'),
        ])
        .optional()
        .description('Tripo 积分调度模式（默认 studio_free_saver 免费省流模式）'),
      stageId: z
        .string()
        .optional()
        .description('checkpoint / import_material 目标阶段：1_concept / 2_views / 3_tripo / 4_assembly / 5_rig_spring / 6_expressions_vrm'),
      checkpointAction: z
        .union([
          z.literal('request_review'),
          z.literal('activate'),
        ])
        .default('request_review')
        .description('关卡动作：Agent 跑完本阶段用 request_review 停下请用户检视'),
      notes: z.string().optional().description('关卡备注或复盘记录'),
      vrmTitle: z.string().optional().description('VRM 1.0 模型标题'),
      vrmVersion: z.string().optional().description('VRM 1.0 模型版本号'),
      vrmAuthors: z.array(z.string()).optional().description('VRM 1.0 作者列表'),
      avatarPermission: z.string().optional().description('VRM 1.0 化身使用权限'),
      commercialUsage: z
        .union([
          z.literal('personalNonProfit'),
          z.literal('personalProfit'),
          z.literal('corporation'),
        ])
        .optional()
        .description('VRM 1.0 商用授权范围'),
      allowRedistribution: z.boolean().optional().description('VRM 1.0 是否允许二次分发'),
      creditNotation: z.string().optional().description('VRM 1.0 署名要求'),
      modification: z.string().optional().description('VRM 1.0 修改权限'),
      revisionId: z.string().optional().description('inspect_vrm_meta 时可选的编辑器修订 ID'),
    }),
    async execute(args) {
      try {
        const dir = path.resolve(args.projectDir || defaultProject());

        if (args.action === 'set_workflow_mode') {
          return okEnvelope(await setWorkflowMode({
            projectDir: dir,
            mode: args.workflowMode || args.mode,
            expectedRevision: args.expectedRevision,
          }));
        }
        if (args.action === 'select_foundation') {
          return okEnvelope(await selectFoundation({
            projectDir: dir,
            part: args.part,
            materialId: args.materialId,
            expectedRevision: args.expectedRevision,
          }));
        }
        if (args.action === 'plan_tripo_parts') {
          return okEnvelope(await planTripoParts({
            projectDir: dir,
            kinds: args.kinds,
            quotedCredits: args.quotedCredits,
            budget: args.budget ?? 0,
          }));
        }
        if (args.action === 'import_material') {
          return okEnvelope(await importProjectMaterial({
            projectDir: dir,
            stageId: args.stageId,
            role: args.role,
            slotId: args.slotId,
            part: args.part,
            sourcePath: args.sourcePath,
            expectedRevision: args.expectedRevision,
          }));
        }
        if (args.action === 'import_asset') return okEnvelope(await importStudioAsset({ projectDir: dir, kind: args.assetKind || 'image', slotId: args.slotId, part: args.part, sourcePath: args.sourcePath, label: args.label, expectedRevision: args.expectedRevision }));
        if (args.action === 'scan_views') return okEnvelope(await scanGeneratedViews({ projectDir: dir }));
        if (args.action === 'list_materials') {
          const loaded = await loadProjectState(dir);
          const items = (loaded.state?.materials?.items || []).filter(item => !args.stageId || item.stageId === args.stageId);
          return okEnvelope({ projectDir: loaded.projectDir, exists: loaded.exists, total: items.length, materials: items.slice(-40),
            note: '只读登记记录。PNG/候选的采用由用户完成；如明确获准使用，编辑工具按 materialId 验证工程路径、指纹和用途。' });
        }
        if (args.action === 'init') {
          const saved = await initOrUpdateProject(dir, { monthlyCreditAllowance: config.tripoMonthlyFreeCredits, ...args });
          await createProjectRegistry(config.registryFile).remember(saved.projectDir);
          return okEnvelope({
            projectDir: saved.projectDir,
            stateFile: saved.stateFile,
            summary: summarizeProjectProgress(saved.state),
            stages: saved.state.stages,
          });
        }

        if (args.action === 'checkpoint') {
          const saved = await transitionStageCheckpoint(dir, {
            stageId: args.stageId,
            action: args.checkpointAction || 'request_review',
            notes: args.notes || '',
          });
          return okEnvelope({
            projectDir: saved.projectDir,
            summary: summarizeProjectProgress(saved.state),
            activeStage: saved.state.stages[saved.state.activeStageId],
          });
        }

        if (args.action === 'inspect_vrm_meta') {
          const resolved = await resolveProjectVrmFile(dir, args.revisionId);
          const info = inspectVrmMetadata(resolved.bytes);
          return okEnvelope({
            action: 'inspect_vrm_meta',
            projectDir: resolved.root,
            revisionId: resolved.revisionId,
            fileName: path.basename(resolved.file),
            sha256: resolved.sha256,
            ...info,
            projectVrmMetadata: resolved.state.vrmMetadata,
          });
        }

        if (args.action === 'set_vrm_meta') {
          const saved = await updateProjectState(dir, state => {
            if (args.vrmTitle) state.vrmMetadata.title = args.vrmTitle;
            if (args.vrmVersion) state.vrmMetadata.version = args.vrmVersion;
            if (Array.isArray(args.vrmAuthors)) state.vrmMetadata.authors = args.vrmAuthors;
            if (args.avatarPermission) state.vrmMetadata.avatarPermission = args.avatarPermission;
            if (args.commercialUsage) state.vrmMetadata.commercialUsage = args.commercialUsage;
            if (typeof args.allowRedistribution === 'boolean') state.vrmMetadata.allowRedistribution = args.allowRedistribution;
            if (args.creditNotation) state.vrmMetadata.creditNotation = args.creditNotation;
            if (args.modification) state.vrmMetadata.modification = args.modification;
          });
          return okEnvelope({
            projectDir: saved.projectDir,
            vrmMetadata: saved.state.vrmMetadata,
          });
        }

        const loaded = await loadProjectState(dir);
        return okEnvelope({
          exists: loaded.exists,
          legacyCharakitDetected: Boolean(loaded.legacyDetected),
          projectDir: loaded.projectDir,
          summary: summarizeProjectProgress(loaded.state),
          state: loaded.state,
        });
      } catch (err) {
        return errorEnvelope('PROJECT_STATE_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  // 3. Multi-Model 8+3 View Generation Tool
  const generateViewsTool = buildToolRegistration({
    name: 'charakuru_generate_views',
    description:
      '生成或导出角色 8 张部件四视图（头+发去眼镜闭口四视图 + T-Pose 身体四视图）与 3 张全身三视图。支持前置探活（preflight）、读写每模型配置与提示词模板（get_profile / save_profile）、本地 Qwen-Image-2.1 文生图与 ComfyUI 参考编辑、本地 Anima、跨模型预案。DSH Agent 不发送付费云端请求，请由用户在工作台核对并确认单槽。',
    parameters: z.object({
      action: z
        .union([
          z.literal('generate'),
          z.literal('preflight'),
          z.literal('get_profile'),
          z.literal('save_profile'),
        ])
        .default('generate')
        .description('generate=生成/导出视图；preflight=生图前置探活与兼容性检查；get_profile=读取模型参数与提示词模板；save_profile=保存模型参数或自定义提示词模板'),
      projectDir: z.string().optional().description('角色工程目录'),
      mode: z
        .union([z.literal('plan_and_export_workflows'), z.literal('execute')])
        .default('plan_and_export_workflows')
        .description('plan_and_export_workflows=导出提示词清单与ComfyUI/Qwen本地脚本；execute=立即请求生图接口并落盘 PNG'),
      modelId: z
        .string()
        .default('qwen-image-2.1-local')
        .description('生图模型 ID（见 charakuru_aa_models）'),
      requestId: z.string().optional().description('持久任务 ID，execute 必填；超时后不可换 ID 重发'),
      imageMode:z.union([z.literal('text_to_image'),z.literal('image_to_image')]).optional().description('显式生图模式；图生图缺图或适配器不兼容即拒绝'),
      referenceMode: z.union([z.literal('project'), z.literal('text_only')]).optional().description('旧版字段；优先用 imageMode。未选时沿用保留工程原画策略。'),
      apiModelOverride: z.string().optional().description('云端执行必填：供应商实际 API 模型 ID'),
      animaUnet: z.string().optional().description('可选 Anima diffusion_models 文件名；默认使用对应独立权重'),
      modelFiles: z.any().optional().description('可选本机 ComfyUI 模型权重文件映射（unet/clip/vae）'),
      parameters: z.any().optional().description('可选采样与分辨率参数覆盖'),
      characterPrompt: z.string().optional().description('角色外观描述（省略则读取工程设定）'),
      artistTag: z.string().optional().description('ComfyUI Anima 专属画师标签'),
      animaVariant: z
        .union([z.literal('base'), z.literal('aesthetic'), z.literal('turbo')])
        .optional(),
      rgbaTransparent: z.boolean().optional(),
      slots: z
        .array(z.string())
        .optional()
        .description('可选仅生成部分槽位，如 ["head_front","head_right","head_left","head_back"]'),
      profileAction: z
        .union([z.literal('config'), z.literal('prompt'), z.literal('reset_prompt')])
        .optional()
        .description('save_profile 时的子动作：config=保存模型配置，prompt=保存单槽提示词，reset_prompt=重置单槽提示词'),
      profileConfig: z
        .any()
        .optional()
        .description('save_profile(profileAction=config) 时的配置对象'),
      slotId: z
        .string()
        .optional()
        .description('get_profile / save_profile 时可选的目标视图槽位 ID（如 head_front）'),
      template: z
        .any()
        .optional()
        .description('save_profile(profileAction=prompt) 时的提示词模板 { positive, negative }'),
      expectedRevision: z
        .number()
        .optional()
        .description('save_profile 时必传的当前工程状态版本号'),
    }),
    async execute(args) {
      try {
        const dir = path.resolve(args.projectDir || defaultProject());
        const modelId = args.modelId || config.defaultImageModel || 'qwen-image-2.1-local';
        if (args.action === 'preflight') {
          const manager = credentialManager || createCredentialManager({});
          const preflight = await checkImageSetup({
            ...args,
            projectDir: dir,
            modelId,
            endpoints: {
              comfyuiUrl: config.comfyuiUrl,
              qwenImageUrl: config.qwenImageUrl,
              openaiCompatBaseUrl: config.openaiCompatBaseUrl,
            },
            comfyuiQwenWorkflowPath: config.comfyuiQwenWorkflowPath,
            allowCloudExecution: config.allowCloudExecution === true,
            credentials: await manager.describeAll(),
          });
          return okEnvelope({ action: 'preflight', ...preflight });
        }
        if (args.action === 'get_profile') {
          const { state } = await loadProjectState(dir);
          const profile = imageModelProfile(state, modelId);
          if (args.slotId) {
            const tpl = await readImageTemplates({ projectDir: dir, modelId, slotId: args.slotId });
            return okEnvelope({ action: 'get_profile', ...tpl, profile });
          }
          return okEnvelope({ action: 'get_profile', modelId, profile, stateRevision: state?.stateRevision });
        }
        if (args.action === 'save_profile') {
          const saved = await saveImageProfile({
            projectDir: dir,
            modelId,
            action: args.profileAction || (args.template ? 'prompt' : 'config'),
            config: args.profileConfig ?? (args.parameters || args.modelFiles || args.animaVariant !== undefined || args.artistTag !== undefined || args.rgbaTransparent !== undefined || args.apiModelOverride !== undefined
              ? {
                  ...(args.parameters !== undefined ? { parameters: args.parameters } : {}),
                  ...(args.modelFiles !== undefined ? { modelFiles: args.modelFiles } : {}),
                  ...(args.animaVariant !== undefined ? { animaVariant: args.animaVariant } : {}),
                  ...(args.artistTag !== undefined ? { artistTag: args.artistTag } : {}),
                  ...(args.rgbaTransparent !== undefined ? { rgbaTransparent: args.rgbaTransparent } : {}),
                  ...(args.apiModelOverride !== undefined ? { apiModelOverride: args.apiModelOverride } : {}),
                }
              : {}),
            slotId: args.slotId,
            template: args.template,
            expectedRevision: args.expectedRevision,
          });
          return okEnvelope({ action: 'save_profile', ...saved });
        }
        if (args.mode === 'execute' && !args.requestId) throw new Error('execute 要求持久任务 ID');
        const out = await runTurnaroundGeneration({
          requestId: args.requestId, allowCloudExecution: false, referenceMode: args.referenceMode,imageMode:args.imageMode,
          comfyuiQwenWorkflowPath: config.comfyuiQwenWorkflowPath,
          projectDir: dir,
          modelId,
          apiModelOverride: args.apiModelOverride,
          characterPrompt: args.characterPrompt || '',
          artistTag: args.artistTag,
          animaVariant: args.animaVariant,
          rgbaTransparent: args.rgbaTransparent,
          slots: args.slots,
          mode: args.mode || 'plan_and_export_workflows',
          endpoints: {
            comfyuiUrl: config.comfyuiUrl,
            qwenImageUrl: config.qwenImageUrl,
            openaiCompatBaseUrl: config.openaiCompatBaseUrl,
          },
          modelFiles: args.modelFiles || (args.animaUnet ? { unet: args.animaUnet } : undefined),
          parameters: args.parameters,
        });
        return okEnvelope(out);
      } catch (err) {
        return errorEnvelope('VIEW_GENERATION_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  // 4. Tripo Studio Free Quota Scheduler, OpenAPI v3 Client & 24h Archiver
  const tripoQuotaTool = buildToolRegistration({
    name: 'charakuru_tripo_quota',
    description:
      'Tripo 双通道（OpenAPI v3 + 浏览器接力）预算规划与 GLB 本地归档。95/145 为可配置的方案估算，账户额度与价格以 Studio 为准；浏览器接力先查 studio_status。OpenAPI 余额独立（openapi_balance / openapi_submit / openapi_poll）。归档校验 GLB 2.0 容器与 SHA-256，按远端任务 ID 幂等记账。',
    parameters: z.object({
      action: z
        .union([
          z.literal('plan'),
          z.literal('archive_glb'),
          z.literal('studio_status'),
          z.literal('studio_collect'),
          z.literal('openapi_balance'),
          z.literal('openapi_submit'),
          z.literal('openapi_poll'),
        ])
        .default('plan')
        .description('plan=精算当月剩余免费积分并生成网页端串行操作手册；archive_glb=校验并永久归档下载的 GLB；studio_status/studio_collect=浏览器工单；openapi_balance/openapi_submit/openapi_poll=Tripo OpenAPI v3 通道'),
      projectDir: z.string().optional().description('角色工程目录'),
      ticketId:z.string().optional().description('studio_status/collect：使用工作台草稿给出的工单 ID'),
      fileName:z.string().optional().description('studio_collect：工单回收目录内实际下载的自包含 GLB 文件名；不是路径或 URL'),
      strategyId: z
        .union([
          z.literal('studio_free_saver'),
          z.literal('studio_free_2x2'),
          z.literal('openapi_v3_hybrid'),
        ])
        .default('studio_free_saver'),
      part: z
        .union([z.literal('head'), z.literal('body'), z.literal('accessory'), z.literal('clothing'), z.literal('hair')])
        .default('head')
        .description('archive_glb 或 openapi_submit 时归档/生成的部件类别'),
      sourceGlbPath: z.string().optional().description('archive_glb 时待归档的本地 .glb 路径'),
      remoteTaskId: z.string().optional().description('远端任务 ID，用于防止重复记账'),
      estimatedCredits: z.number().optional().description('按 Studio 实际报价覆盖方案预算'),
      creditsSpent: z.number().default(0).description('本次操作消耗的积分（用于更新月度免费额度账本）'),
      usedFreeRetry: z.boolean().default(false).description('是否使用了 Studio 免费重试（Free Retry）'),
      openapiAction: z
        .string()
        .optional()
        .description('openapi_submit 任务类型：image_to_model / multiview_to_model / mesh_segment / mesh_decimate / models_texture / mesh_complete / models_convert'),
      referenceMaterialIds: z
        .array(z.string())
        .optional()
        .description('openapi_submit 时传入的已登记参考图 materialId 列表'),
      options: z
        .any()
        .optional()
        .description('openapi_submit 参数选项（受参数陷阱防护检查）'),
      requestId: z
        .string()
        .optional()
        .description('openapi_submit / openapi_poll 的幂等请求 ID'),
      taskId: z
        .string()
        .optional()
        .description('openapi_poll 的远端 task_id'),
      expectedRevision: z
        .number()
        .optional()
        .description('openapi_submit 绑定的当前工程版本号'),
      cloudConfirmed: z
        .boolean()
        .optional()
        .description('openapi_submit 用户显式确认云端扣费标记'),
      accountId: z
        .string()
        .optional()
        .description('OpenAPI 预算账本账户别名（默认 default-tripo-api）'),
    }),
    async execute(args) {
      try {
        const dir = path.resolve(args.projectDir || defaultProject());
        if (args.action==='studio_status')return okEnvelope(await readTripoStudioTicket({projectDir:dir,ticketId:args.ticketId}));
        if (args.action==='studio_collect')return okEnvelope(await collectTripoStudioDownload({projectDir:dir,ticketId:args.ticketId,fileName:args.fileName}));
        if (args.action === 'openapi_balance' || args.action === 'openapi_submit' || args.action === 'openapi_poll') {
          const manager = credentialManager || createCredentialManager({});
          const apiKey = await manager.resolveSecret('tripo');
          const budget = createAccountBudget(config.budgetDir);
          const tripoBaseUrl = config.tripoApiUrl || config.tripoApiBaseUrl || '';
          if (args.action === 'openapi_balance') {
            return okEnvelope(await queryTripoOpenApiBalance({
              apiKey,
              ...(tripoBaseUrl ? { baseUrl: tripoBaseUrl } : {}),
            }));
          }
          if (args.action === 'openapi_submit') {
            return okEnvelope(await submitTripoOpenApiTask({
              projectDir: dir,
              action: args.openapiAction || 'image_to_model',
              part: args.part || 'head',
              referenceMaterialIds: args.referenceMaterialIds || [],
              options: args.options || {},
              requestId: args.requestId,
              expectedRevision: args.expectedRevision,
              allowCloudExecution: config.allowCloudExecution === true,
              cloudConfirmed: args.cloudConfirmed === true,
              apiKey,
              budget,
              ...(args.accountId ? { accountId: args.accountId } : {}),
              ...(tripoBaseUrl ? { baseUrl: tripoBaseUrl } : {}),
            }));
          }
          return okEnvelope(await pollTripoOpenApiTask({
            projectDir: dir,
            taskId: args.taskId || args.remoteTaskId,
            requestId: args.requestId,
            apiKey,
            budget,
            ...(args.accountId ? { accountId: args.accountId } : {}),
            ...(tripoBaseUrl ? { baseUrl: tripoBaseUrl } : {}),
          }));
        }
        if (args.action === 'archive_glb') {
          if (!args.sourceGlbPath) {
            return errorEnvelope('MISSING_GLB_PATH', 'sourceGlbPath is required when action="archive_glb"');
          }
          const archived = await archiveTripoGlbAsset({
            projectDir: dir,
            part: args.part || 'head',
            sourceGlbPath: args.sourceGlbPath,
            creditsSpent: args.creditsSpent ?? 0,
            usedFreeRetry: Boolean(args.usedFreeRetry),
            remoteTaskId: args.remoteTaskId,
          });
          return okEnvelope({ action: 'archive_glb', ...archived });
        }
        const plan = await planTripoFreeQuotaRun({
          projectDir: dir,
          strategyId: args.strategyId || 'studio_free_saver',
          estimatedCredits: args.estimatedCredits,
        });
        return okEnvelope({ action: 'plan', ...plan });
      } catch (err) {
        return errorEnvelope('TRIPO_QUOTA_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  // 5. sixtysevenlf/dsh-blender-plugin Deep Bridge & Dual-Channel Clean-Room Blender Stage Runner
  const blenderAvatarTool = buildToolRegistration({
    name: 'charakuru_blender_avatar',
    description:
      '联动 dsh-blender-plugin 与 Computer-Use 双通道执行 Blender 工序：VRM-first 导入、比例装配、骨骼权重与裙摆弹簧、形态键和 VRM 导出，以及 GUI 工作副本签出/签入（checkout_gui / checkin_gui / abort_gui）。脚本执行与资产验收分开记录，实验性阶段返回 degraded 并要求人工与 companion 门复核。',
    parameters: z.object({
      action: z
        .union([
          z.literal('probe'),
          z.literal('run_stage'),
          z.literal('collect_job'),
          z.literal('editor_operation'),
          z.literal('editor_inspect'),
          z.literal('editor_collect'),
          z.literal('editor_cancel'),
          z.literal('editor_rollback'),
          z.literal('checkout_gui'),
          z.literal('checkin_gui'),
          z.literal('abort_gui'),
          z.literal('set_channel_preference'),
        ])
        .default('probe')
        .description('probe=探测 3.0/3.1 实际协议与 doctor；run_stage=生成或执行脚本；collect_job=收集待完成作业；editor_*=不可变修订编辑；checkout_gui/checkin_gui/abort_gui=Computer-Use GUI 隔离工作副本签出/签入；set_channel_preference=设置双通道偏好'),
      projectDir: z.string().optional().description('角色工程目录'),
      editorOperation: z
        .union(EDITOR_OPERATIONS.map(op => z.literal(op)))
        .optional()
        .description('import_blend/import_checkpoint/import_material_scene/append_material_mesh/normalize_material_mesh/apply_material_texture/fit_foundation/append_foundation_head/fit_garment/audit_penetration/rigid_attach/smart_mesh_retexture/apply_mtoon/expression_lab/physics_oscillation_audit/audit/head_scale/transform/materials/transfer_weights/normalize_weights/configure_vrm/spring_setup/pose_check/export_vrm'),
      editorParams: z.any().optional().description('结构化工序参数（不接受任意 Python）；外部素材工序用已登记 materialId，贴图另指定 objects 与 textureSlot。v0.8.0 支持 fit_foundation/append_foundation_head/normalize_material_mesh/append_material_mesh/fit_garment/audit_penetration/rigid_attach/spring_setup/pose_check。v0.9.0 支持 smart_mesh_retexture（groups/textureSize/smartUvAngleDeg/uvMargin/delight/viewImageMaterialIds/separatePhysicsGroup）、apply_mtoon 及 materials(materialMode="mtoon")（shadeColor/shadingShift/shadingToony/matcapMaterialId/matcapFactor/rimColor/rimFresnelPower/rimLift/outlineWidthMode/outlineWidthFactor/outlineColor）、expression_lab（headMesh/presets/excludeHairByBbox/hairVertexGroups/intensity/bindVrm1/overwriteExisting）、physics_oscillation_audit（bodyObject/objects/frames/amplitudeDeg/ignoreModifiers/compareSpringOff）。'),
      editRequestId: z.string().optional().description('工作台发来的 AI 修改请求 ID；editor_inspect 省略此字段时只读审查当前活动修订'),
      expectedRevisionId: z.string().optional(),
      expectedRevision: z.number().optional().description('set_channel_preference 时的预期工程状态版本号'),
      revisionId: z.string().optional(),
      checkoutId: z.string().optional().description('checkin_gui / abort_gui 时的 GUI 签出工作副本 ID'),
      channelPreference: z
        .union([z.literal('auto'), z.literal('plugin'), z.literal('computer_use')])
        .optional()
        .description('Blender 双通道偏好：auto=自动择优，plugin=优先插件契约，computer_use=优先 GUI 桌面操控'),
      exportVrm: z.boolean().optional().description('checkin_gui 时是否同步导出并校验 VRM 1.0'),
      note: z.string().optional().description('checkout_gui / abort_gui 时的备注说明'),
      reason: z.string().optional().description('abort_gui 时的放弃原因'),
      sessionId: z.string().optional().description('Gateway GUI 已 attach 并授权的 Blender session ID；不得臆造'),
      sceneQuery: z.string().optional().description('probe 时过滤 Blender 场景对象的关键字'),
      inputBlendPath: z.string().optional().description('阶段输入 blend；相对工程目录解析'),
      outputBlendPath: z.string().optional().description('阶段输出 blend；相对工程目录解析'),
      outputVrmPath: z.string().optional().description('阶段输出 VRM；相对工程目录解析'),
      vrmAddonPath: z.string().optional().description('可选 VRM Add-on 本地 zip/目录路径'),
      headGlbPath: z.string().optional().description('导入头部 GLB'),
      bodyGlbPath: z.string().optional().description('导入身体 GLB'),
      operation: z
        .union([
          z.literal('stage1_safe_import'),
          z.literal('stage2_assembly_ratio'),
          z.literal('stage3_rig_weights'),
          z.literal('stage4_skirt_springs'),
          z.literal('stage5_expressions_vrm'),
        ])
        .default('stage1_safe_import')
        .description('要生成/执行的 Blender VRM 工序阶段'),
      executeViaPlugin: z
        .boolean()
        .default(false)
        .description('true=经过已审批输入与身份门禁后执行；Gateway headless 返回待收集作业；false=只生成脚本'),
      executionTarget: z
        .union([z.literal('headless'), z.literal('gui_act')])
        .default('headless')
        .description('headless=走 /headless (自动 hardExit=true 规避 5.2 退出崩溃)；gui_act=走 /act 实时驱动已打开的 GUI Blender'),
      neckScaleFactor: z.number().optional().description('stage2 颈部枢轴缩放倍率（默认 0.86，约 6.3 头身）'),
      skirtChains: z.number().optional().description('stage4 裙摆环向弹簧链数量（默认 16）'),
      minSkirtClearanceM: z.number().optional().description('stage4 裙摆与大腿碰撞体最小安全间隙米数（默认 0.018）'),
    }),
    async execute(args, execution) {
      try {
        if (args.action === 'probe') {
          const probe = await probeBlenderPluginLink({
            blenderPluginUrl: config.blenderPluginUrl || '',
            sceneQuery: args.sceneQuery || '',
          });
          return okEnvelope({ action: 'probe', ...probe });
        }
        const dir = path.resolve(args.projectDir || defaultProject());
        if (args.action === 'set_channel_preference') {
          return okEnvelope(await setEditorChannelPreference({
            projectDir: dir,
            channelPreference: args.channelPreference || 'auto',
            expectedRevision: args.expectedRevision,
          }));
        }
        if (args.action === 'checkout_gui') {
          return okEnvelope(await checkoutEditorGui({
            projectDir: dir,
            expectedRevisionId: args.expectedRevisionId,
            note: args.note || '',
          }));
        }
        if (args.action === 'checkin_gui') {
          return okEnvelope(await checkinEditorGui({
            projectDir: dir,
            checkoutId: args.checkoutId,
            expectedRevisionId: args.expectedRevisionId,
            exportVrm: args.exportVrm === true,
            editRequestId: args.editRequestId,
            executionTarget: args.executionTarget || 'headless',
            sessionId: args.sessionId,
            blenderPluginUrl: config.blenderPluginUrl || '',
            caller: callerFromExecution(execution),
            signal: execution?.signal,
          }));
        }
        if (args.action === 'abort_gui') {
          return okEnvelope(await abortEditorGui({
            projectDir: dir,
            checkoutId: args.checkoutId,
            expectedRevisionId: args.expectedRevisionId,
            reason: args.reason || args.note || '',
          }));
        }
        if (args.action === 'editor_inspect') return okEnvelope(await inspectAiEdit({projectDir:dir,requestId:args.editRequestId,blenderPluginUrl:config.blenderPluginUrl||'',caller:callerFromExecution(execution),signal:execution?.signal}));
        if (args.action === 'editor_operation') {
          const params = { ...(args.editorParams || {}), ...(args.vrmAddonPath && !args.editorParams?.vrmAddonPath ? { vrmAddonPath: args.vrmAddonPath } : {}) };
          return okEnvelope(await runEditorOperation({
            projectDir: dir,
            operation: args.editorOperation,
            params,
            expectedRevisionId: args.expectedRevisionId,
            editRequestId: args.editRequestId,
            executionTarget: args.executionTarget || 'headless',
            sessionId: args.sessionId,
            blenderPluginUrl: config.blenderPluginUrl || '',
            caller: callerFromExecution(execution),
            signal: execution?.signal,
          }));
        }
        if (args.action === 'editor_cancel') return okEnvelope(await cancelEditorJob({projectDir:dir,caller:callerFromExecution(execution),signal:execution?.signal}));
        if (args.action === 'editor_collect') return okEnvelope(await collectEditorJob({projectDir:dir,caller:callerFromExecution(execution),signal:execution?.signal}));
        if (args.action === 'editor_rollback') return okEnvelope(await rollbackEditor({projectDir:dir,revisionId:args.revisionId,expectedRevisionId:args.expectedRevisionId}));
        if (args.action === 'collect_job') return okEnvelope(await collectBlenderAvatarJob({ projectDir: dir, caller: callerFromExecution(execution), signal: execution?.signal }));
        const stageOut = await runBlenderAvatarStage({
          caller: callerFromExecution(execution), sessionId: args.sessionId, signal: execution?.signal,
          projectDir: dir,
          operation: args.operation || 'stage1_safe_import',
          executeViaPlugin: Boolean(args.executeViaPlugin),
          executionTarget: args.executionTarget || 'headless',
          blenderPluginUrl: config.blenderPluginUrl || '',
          params: {
            inputBlendPath: args.inputBlendPath,
            outputBlendPath: args.outputBlendPath,
            outputVrmPath: args.outputVrmPath,
            vrmAddonPath: args.vrmAddonPath,
            headGlbPath: args.headGlbPath,
            bodyGlbPath: args.bodyGlbPath,
            neckScaleFactor: args.neckScaleFactor,
            skirtChains: args.skirtChains,
            minSkirtClearanceM: args.minSkirtClearanceM,
          },
        });
        return okEnvelope({ action: 'run_stage', ...stageOut });
      } catch (err) {
        return errorEnvelope('BLENDER_AVATAR_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  // 6. Secure Host Credential Management Tool
  const credentialsTool = buildToolRegistration({
    name: 'charakuru_credentials',
    description:
      '仅查询密钥配置状态。请通过工作台密码框或环境变量录入密钥，避免原始密钥进入对话工具参数。',
    parameters: z.object({
      action: z
        .union([z.literal('status')])
        .default('status'),
      providerId: z
        .union([
          z.literal('novelai'),
          z.literal('openai_compat'),
          z.literal('gemini'),
          z.literal('openai'),
          z.literal('ark'),
          z.literal('tripo'),
        ])
        .optional(),

    }),
    async execute(args) {
      try {
        const manager = credentialManager || createCredentialManager({});
        const all = await manager.describeAll();
        const credentials = args.providerId ? all.filter(c => c.id === args.providerId) : all;
        return okEnvelope({ credentials });
      } catch (err) {
        return errorEnvelope('CREDENTIAL_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  const renderTool=buildToolRegistration({
    name:'charakuru_render',
    description:'只接手独立渲染台写入的本地 Blender 静帧请求。支持 list 列出历史请求，以请求 ID 和活动修订为准，调整相机、引擎、透视/景深、色彩管理、NPR Toon 描边/Face SDF 与辅助通道；只产出 PNG+回执。不能创建请求、上传、改模型或替人审阅。',
    parameters:z.object({
      action:z.union([z.literal('list'),z.literal('status'),z.literal('run'),z.literal('collect'),z.literal('cancel')]),
      projectDir:z.string().optional().description('渲染接力提供的工程目录'),
      requestId:z.string().optional().description('渲染台已登记的请求 ID（status/run/collect/cancel 必传，list 可省略）'),
      expectedRevisionId:z.string().optional().description('run 必传，来自工作台接力'),
      executionTarget:z.union([z.literal('headless'),z.literal('gui_act')]).optional().description('可选执行目标：默认 headless，GUI 探活就绪时可选 gui_act'),
      sessionId:z.string().optional().description('Gateway GUI 已 attach 的 session ID'),
      recipe:z.any().optional().description('AI 需为新请求拟定 preset（custom 可用）、camera、framing、size（draft/review/wide/hd1080/portrait1080/uhd4k/portrait4k）；可选 engine（eevee/cycles）、lensType（ortho/persp）、lens、dof、yawDeg、pitchDeg、transparent、samples、frame、viewTransform（Standard/AgX/Filmic）、look、exposure、key、fill、rim、toon、toonOptions（outline/outlineThickness/outlineColor/faceSdf/faceSdfMaterialId/specularRim/metallicStep）、passes（albedo/normal/depth）与 lighting RGB；不能传路径、材质脚本或 Python'),
    }),
    async execute(args,execution) {
      try {
        const projectDir = path.resolve(args.projectDir || defaultProject());
        if (args.action === 'list') return okEnvelope(await listRenderRequests({ projectDir }));
        if (!args.requestId) throw new Error('requestId is required for render action ' + args.action);
        const common={projectDir,requestId:args.requestId,caller:callerFromExecution(execution),signal:execution?.signal};
        if (args.action==='status') return okEnvelope(await getRenderRequest(common));
        if (args.action==='run') return okEnvelope(await runRender({...common,recipe:args.recipe,expectedRevisionId:args.expectedRevisionId,executionTarget:args.executionTarget||'headless',sessionId:args.sessionId,blenderPluginUrl:config.blenderPluginUrl||''}));
        return okEnvelope(await settleRender({...common,cancel:args.action==='cancel'}));
      } catch(error) { return errorEnvelope('RENDER_ERROR',error instanceof Error ? error.message : String(error)); }
    },
  });

  return [
    aaModelsTool,
    projectTool,
    generateViewsTool,
    tripoQuotaTool,
    blenderAvatarTool,
    renderTool,
    credentialsTool,
  ];
}

function resolveCordisService(ctx, serviceName) {
  if (typeof ctx?.get === 'function') {
    try {
      const svc = ctx.get(serviceName);
      if (svc !== undefined) return svc;
    } catch {
      // fall back to direct property lookup
    }
  }
  try {
    return ctx?.[serviceName];
  } catch {
    return undefined;
  }
}

export function registerAllStudioTools(ctx, deps) {
  const toolsSvc = resolveCordisService(ctx, 'tools');
  const defs = buildStudioTools(deps);
  if (!toolsSvc || typeof toolsSvc.register !== 'function') {
    return () => {};
  }
  const cleanups = defs.map((def) => toolsSvc.register(def));
  return () => {
    for (const dispose of cleanups) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch {
        // ignore dispose error
      }
    }
  };
}
