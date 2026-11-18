import { runEditorOperation, cancelEditorJob, collectEditorJob, createAiEditRequest, rollbackEditor } from '../project/editor.js';
import { importStudioAsset, scanGeneratedViews } from '../project/assets.js';
import { callerFromExecution } from '../blender/transport.js';
/**
 * dsh-charakuru-studio — Consolidated Host Agent Tool Registrations (6 Domain Tools).
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
import { runTurnaroundGeneration } from '../providers/image-router.js';
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
          const pack = compileTurnaroundPromptPack({
            modelId: args.modelId || config.defaultImageModel || 'qwen-image-2.1-local',
            characterPrompt: args.characterPrompt,
            artistTag: args.artistTag || '',
            animaVariant: args.animaVariant || 'base',
            rgbaTransparent: args.rgbaTransparent !== false,
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
      '管理 Clean-Room VRM 角色工程（project.charastudio.json）：初始化目录结构、查看 6 阶段进度与积分账本、提交人工确认关卡（审批在工作台完成）（checkpoint）、以及写入 VRM 1.0 作者/授权元数据。',
    parameters: z.object({
      action: z
        .union([
          z.literal('init'),
          z.literal('status'),
          z.literal('checkpoint'),
          z.literal('set_vrm_meta'),
          z.literal('import_asset'),
          z.literal('scan_views'),
        ])
        .default('status')
        .description('init=创建/更新；status=状态；checkpoint=提交审阅；import_asset=登记PNG/GLB；scan_views=扫描离线11槽位；set_vrm_meta=元数据'),
      projectDir: z
        .string()
        .optional()
        .description('角色工程根目录路径（省略使用固定默认工程目录）'),
      assetKind: z.union([z.literal('image'), z.literal('glb')]).optional(),
      slotId: z.string().optional(),
      part: z.union([z.literal('head'), z.literal('body'), z.literal('accessory')]).optional(),
      sourcePath: z.string().optional(),
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
        .description('checkpoint 目标阶段：1_concept / 2_views / 3_tripo / 4_assembly / 5_rig_spring / 6_expressions_vrm'),
      checkpointAction: z
        .union([
          z.literal('request_review'),
          z.literal('activate'),
        ])
        .default('request_review')
        .description('关卡动作：Agent 跑完本阶段用 request_review 停下请用户检视'),
      notes: z.string().optional().description('关卡备注或复盘记录'),
      vrmTitle: z.string().optional().description('VRM 1.0 模型标题'),
      vrmAuthors: z.array(z.string()).optional().description('VRM 1.0 作者列表'),
      commercialUsage: z
        .union([
          z.literal('personalNonProfit'),
          z.literal('personalProfit'),
          z.literal('corporation'),
        ])
        .optional()
        .description('VRM 1.0 商用授权范围'),
    }),
    async execute(args) {
      try {
        const dir = path.resolve(args.projectDir || defaultProject());

        if (args.action === 'import_asset') return okEnvelope(await importStudioAsset({ projectDir: dir, kind: args.assetKind || 'image', slotId: args.slotId, part: args.part, sourcePath: args.sourcePath }));
        if (args.action === 'scan_views') return okEnvelope(await scanGeneratedViews({ projectDir: dir }));
        if (args.action === 'init') {
          const saved = await initOrUpdateProject(dir, { monthlyCreditAllowance: config.tripoMonthlyFreeCredits, ...args });
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

        if (args.action === 'set_vrm_meta') {
          const saved = await updateProjectState(dir, state => {
          if (args.vrmTitle) state.vrmMetadata.title = args.vrmTitle;
          if (Array.isArray(args.vrmAuthors)) state.vrmMetadata.authors = args.vrmAuthors;
          if (args.commercialUsage) state.vrmMetadata.commercialUsage = args.commercialUsage;
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
      '生成或导出角色 8 张部件四视图（头+发去眼镜闭口四视图 + T-Pose 身体四视图）与 3 张全身三视图。支持本地 Qwen-Image-2.1（自动产出 Diffusers 批处理脚本或连本地服务）、本地 ComfyUI Anima（自动产出可拖拽 .comfy.json 节点流或直推 :8188）、云端 NovelAI V5/V4.5、Seedream 5.5、GPT Image 2.6 与 Gemini Nano Banana 2.1。',
    parameters: z.object({
      projectDir: z.string().optional().description('角色工程目录'),
      mode: z
        .union([z.literal('plan_and_export_workflows'), z.literal('execute')])
        .default('plan_and_export_workflows')
        .description('plan_and_export_workflows=导出提示词清单与ComfyUI/Qwen本地脚本；execute=立即请求生图接口并落盘 PNG'),
      modelId: z
        .string()
        .default('qwen-image-2.1-local')
        .description('生图模型 ID（见 charakuru_aa_models）'),
      requestId: z.string().optional().description('Persistent request ID for idempotent execution; retain it after timeout'),
      apiModelOverride: z.string().optional().description('云端执行必填：供应商实际 API 模型 ID'),
      animaUnet: z.string().optional().description('Anima 自定义 diffusion_models 文件名；aesthetic 必填'),
      characterPrompt: z.string().optional().description('角色外观描述（省略则读取工程设定）'),
      artistTag: z.string().optional().description('ComfyUI Anima 专属画师标签'),
      animaVariant: z
        .union([z.literal('base'), z.literal('aesthetic'), z.literal('turbo')])
        .default('base'),
      rgbaTransparent: z.boolean().default(true),
      slots: z
        .array(z.string())
        .optional()
        .description('可选仅生成部分槽位，如 ["head_front","head_right","head_left","head_back"]'),
    }),
    async execute(args) {
      try {
        const dir = path.resolve(args.projectDir || defaultProject());
        const secrets = credentialManager ? await credentialManager.resolveAllSecrets() : {};
        const out = await runTurnaroundGeneration({
          requestId: args.requestId, allowCloudExecution:config.allowCloudExecution===true,
          projectDir: dir,
          modelId: args.modelId || config.defaultImageModel || 'qwen-image-2.1-local',
          apiModelOverride: args.apiModelOverride || '',
          characterPrompt: args.characterPrompt || '',
          artistTag: args.artistTag || '',
          animaVariant: args.animaVariant || 'base',
          rgbaTransparent: args.rgbaTransparent !== false,
          slots: args.slots,
          mode: args.mode || 'plan_and_export_workflows',
          endpoints: {
            comfyuiUrl: config.comfyuiUrl,
            qwenImageUrl: config.qwenImageUrl,
            openaiCompatBaseUrl: config.openaiCompatBaseUrl,
          },
          secrets,
          modelFiles: { unet: args.animaUnet },
        });
        return okEnvelope(out);
      } catch (err) {
        return errorEnvelope('VIEW_GENERATION_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  // 4. Tripo Studio Free Quota Scheduler & 24h Archiver
  const tripoQuotaTool = buildToolRegistration({
    name: 'charakuru_tripo_quota',
    description:
      'Tripo Studio 预算规划与 GLB 本地归档。95/145 为可配置的方案估算，账户额度与价格以 Studio 为准；网页步骤需用户执行，OpenAPI 余额独立。归档校验 GLB 2.0 容器与 SHA-256，按远端任务 ID 幂等记账。',
    parameters: z.object({
      action: z
        .union([z.literal('plan'), z.literal('archive_glb')])
        .default('plan')
        .description('plan=精算当月剩余免费积分并生成网页端串行操作手册；archive_glb=校验并永久归档下载的 GLB 防止24h历史丢失'),
      projectDir: z.string().optional().description('角色工程目录'),
      strategyId: z
        .union([
          z.literal('studio_free_saver'),
          z.literal('studio_free_2x2'),
          z.literal('openapi_v3_hybrid'),
        ])
        .default('studio_free_saver'),
      part: z
        .union([z.literal('head'), z.literal('body'), z.literal('accessory')])
        .default('head')
        .description('archive_glb 时归档的部件类别'),
      sourceGlbPath: z.string().optional().description('archive_glb 时待归档的本地 .glb 路径'),
      remoteTaskId: z.string().optional().description('远端任务 ID，用于防止重复记账'),
      estimatedCredits: z.number().optional().description('按 Studio 实际报价覆盖方案预算'),
      creditsSpent: z.number().default(0).description('本次操作消耗的积分（用于更新月度免费额度账本）'),
      usedFreeRetry: z.boolean().default(false).description('是否使用了 Studio 免费重试（Free Retry）'),
    }),
    async execute(args) {
      try {
        const dir = path.resolve(args.projectDir || defaultProject());
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

  // 5. sixtysevenlf/dsh-blender-plugin Deep Bridge & Clean-Room Blender 5.2 Stage Runner
  const blenderAvatarTool = buildToolRegistration({
    name: 'charakuru_blender_avatar',
    description:
      '联动 dsh-blender-plugin 生成或运行独立 Blender 工序：VRM-first 导入、比例装配、实验性骨骼权重与裙摆骨架、23 个启发式形态键和 VRM 导出。脚本执行与资产验收分开记录，实验性阶段返回 degraded 并要求人工与 companion 门复核。',
    parameters: z.object({
      action: z
        .union([z.literal('probe'), z.literal('run_stage'), z.literal('collect_job'), z.literal('editor_operation'), z.literal('editor_collect'), z.literal('editor_cancel'), z.literal('editor_rollback')])
        .default('probe')
        .description('probe=探测 3.0/3.1 实际协议与 doctor；run_stage=生成或执行脚本；collect_job=收集当前工程待完成作业并核验文件'),
      projectDir: z.string().optional().description('角色工程目录'),
      editorOperation: z.string().optional().description('import_blend/import_checkpoint/audit/head_scale/transform/materials/transfer_weights/normalize_weights/configure_vrm/spring_setup/pose_check/export_vrm'),
      editorParams: z.any().optional().description('结构化工序参数；不接受任意 Python'),
      editRequestId: z.string().optional().description('工作台发来的 AI 修改请求 ID；与 expectedRevisionId 一同使用，成功后进入人工审阅'),
      expectedRevisionId: z.string().optional(),
      revisionId: z.string().optional(),
      sessionId: z.string().optional().description('Gateway GUI 已 attach 并授权的 Blender session ID；不得臆造'),
      sceneQuery: z.string().optional().description('probe 时过滤 Blender 场景对象的关键字'),
      inputBlendPath: z.string().optional().description('阶段输入 blend；相对工程目录解析'),
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
        if (args.action === 'editor_operation') return okEnvelope(await runEditorOperation({projectDir:dir,operation:args.editorOperation,params:args.editorParams||{},expectedRevisionId:args.expectedRevisionId,editRequestId:args.editRequestId,blenderPluginUrl:config.blenderPluginUrl||'',caller:callerFromExecution(execution),signal:execution?.signal}));
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
            inputBlendPath: args.inputBlendPath, headGlbPath: args.headGlbPath, bodyGlbPath: args.bodyGlbPath,
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
          z.literal('tripo'),
        ])
        .optional(),

    }),
    async execute(args) {
      try {
        if (!credentialManager) {
          return errorEnvelope('NO_CREDENTIAL_MANAGER', 'Credential manager is not initialized');
        }
        return okEnvelope({ credentials: await credentialManager.describeAll() });
      } catch (err) {
        return errorEnvelope('CREDENTIAL_ERROR', err instanceof Error ? err.message : String(err));
      }
    },
  });

  return [
    aaModelsTool,
    projectTool,
    generateViewsTool,
    tripoQuotaTool,
    blenderAvatarTool,
    credentialsTool,
  ];
}

export function registerAllStudioTools(ctx, deps) {
  const toolsSvc = ctx?.tools || ctx?.get?.('tools');
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
