import fs from 'node:fs/promises';
async function patch(file,pairs) { let s=await fs.readFile(file,'utf8'); for (const [a,b] of pairs) { if(!s.includes(a)) throw new Error(`Missing ${file}: ${a.slice(0,70)}`); s=s.replace(a,b); } await fs.writeFile(file,s); }
await patch('lib/tools/register-all.js', [
 ['  saveProjectState,','  updateProjectState,'],
 ["          z.literal('approve'),\n          z.literal('reject'),\n",''],
 ["        const srv = typeof getServer === 'function' ? getServer() : null;\n        if (srv) srv.setActiveProjectDir(dir);\n",''],
 ['await initOrUpdateProject(dir, args)', 'await initOrUpdateProject(dir, { monthlyCreditAllowance: config.tripoMonthlyFreeCredits, ...args })'],
 ["          const loaded = await loadProjectState(dir);\n          if (!loaded.state) throw new Error(`Project not initialized at ${dir}`);\n          const state = structuredClone(loaded.state);", "          const saved = await updateProjectState(dir, state => {"],
 ['          const saved = await saveProjectState(dir, state);', '          });'],
 ["      sourceImage: z.string().optional().description('原始角色立绘路径'),", "      sourceImage: z.string().optional().description('原始角色立绘 PNG 路径'),\n      monthlyCreditAllowance: z.number().optional().description('账户实际月度额度，可设为 0'),"],
 ["      apiModelOverride: z.string().optional().description('可选覆盖底层 API 模型名，如 nai-diffusion-4-5-full'),", "      apiModelOverride: z.string().optional().description('云端执行必填：供应商实际 API 模型 ID'),\n      animaUnet: z.string().optional().description('Anima 自定义 diffusion_models 文件名；aesthetic 必填'),"],
 ['          secrets,', '          secrets,\n          modelFiles: { unet: args.animaUnet },'],
 ["      creditsSpent: z.number().default(0)", "      remoteTaskId: z.string().optional().description('远端任务 ID，用于防止重复记账'),\n      estimatedCredits: z.number().optional().description('按 Studio 实际报价覆盖方案预算'),\n      creditsSpent: z.number().default(0)"],
 ['            usedFreeRetry: Boolean(args.usedFreeRetry),','            usedFreeRetry: Boolean(args.usedFreeRetry),\n            remoteTaskId: args.remoteTaskId,'],
 ["          strategyId: args.strategyId || 'studio_free_saver',", "          strategyId: args.strategyId || 'studio_free_saver',\n          estimatedCredits: args.estimatedCredits,"],
 ["      neckScaleFactor: z.number().optional()", "      inputBlendPath: z.string().optional().description('明确指定阶段输入 blend'),\n      headGlbPath: z.string().optional().description('导入头部 GLB'),\n      bodyGlbPath: z.string().optional().description('导入身体 GLB'),\n      neckScaleFactor: z.number().optional()"],
 ['            neckScaleFactor: args.neckScaleFactor,','            inputBlendPath: args.inputBlendPath, headGlbPath: args.headGlbPath, bodyGlbPath: args.bodyGlbPath,\n            neckScaleFactor: args.neckScaleFactor,'],
 [".union([z.literal('status'), z.literal('set'), z.literal('clear')])", ".union([z.literal('status')])"],
 ["      secret: z.string().optional().description('action=\"set\" 时写入的 API Token（写入后不会在回执中回显）'),",''],
]);
let t=await fs.readFile('lib/tools/register-all.js','utf8');
const s=t.indexOf("        if (args.action === 'set')"); const e=t.indexOf('        return okEnvelope({ credentials:',s);
t=t.slice(0,s)+t.slice(e);
t=t.replace(/\/ 10步/g,'/ 8步').replace('提交或审批人工确认关卡','提交人工确认关卡（审批在工作台完成）').replace('省略则使用工作台当前活动工程目录','省略使用固定默认工程目录');
t=t.replace(/'Tripo Studio 免费额度（200 积分\/月[^\n]+/, "'Tripo Studio 预算规划与 GLB 本地归档。95/145 为可配置的方案估算，账户额度与价格以 Studio 为准；网页步骤需用户执行，OpenAPI 余额独立。归档校验 GLB 2.0 容器与 SHA-256，按远端任务 ID 幂等记账。',");
t=t.replace(/'深度联动 sixtysevenlf\/dsh-blender-plugin \(127[^\n]+/, "'联动 dsh-blender-plugin 生成或运行独立 Blender 工序：VRM-first 导入、比例装配、实验性骨骼权重与裙摆骨架、23 个启发式形态键和 VRM 导出。脚本执行与资产验收分开记录，实验性阶段返回 degraded 并要求人工与 companion 门复核。',");
t=t.replace(/'安全查看或配置生图\/3D 服务密钥[^\n]+/, "'仅查询密钥配置状态。请通过工作台密码框或环境变量录入密钥，避免原始密钥进入对话工具参数。',");
await fs.writeFile('lib/tools/register-all.js',t);
await patch('lib/index.js', [
 ["Number(process.env.DSH_CHARAKURU_PORT || config.port || DEFAULT_STUDIO_PORT)", "Number(process.env.DSH_CHARAKURU_PORT ?? config.port ?? DEFAULT_STUDIO_PORT)"],
 ["        .catch(() => {\n          // Port already occupied by another fiber or standalone test; tools continue working directly\n        });", "        .catch((err) => {\n          console.error('[dsh-charakuru-studio] Studio startup failed:', err.message);\n        });"],
]);
let c=await fs.readFile('lib/constants.js','utf8');
const cs=c.indexOf('/**\n * Tripo Studio Free Tier'); const ce=c.indexOf('/**\n * 6 Clean-Room',cs);
c=c.slice(0,cs)+`// User-adjustable planning assumptions; confirm account terms and prices in Studio.
export const TRIPO_FREE_TIER_DEFAULTS = Object.freeze({ plan: 'studio_free', monthlyCreditAllowance: 200, maxConcurrency: 1, historyRetentionHours: 24, estimateOnly: true });

`+c.slice(ce);
c=c.replace('免费额度已确保单并发排队并在 24 小时历史过期前落盘','请核对实际消耗，并为所有选定 GLB 完成本地归档');
c=c.replace(/summaryZh: '按单并发[^\n]+/, "summaryZh: '生成串行网页操作手册，跟踪实际积分并校验、归档用户下载的 GLB。账户额度、价格与历史保留期以 Studio 为准。',");
c=c.replace(/summaryEn: 'Run serial[^\n]+/, "summaryEn: 'Plan serial Studio tasks; record actual cost and archive downloaded GLBs. Verify allowance, prices and retention in your account.',");
c=c.replace(/summaryZh: '联动 sixtysevenlf[^\n]+/, "summaryZh: 'VRM-first 导入、按部件标签分组与比例装配；已有骨架需人工复核，通用网格清理交给 companion 操作。',");
c=c.replace(/summaryZh: '执行程序化骨骼[^\n]+/, "summaryZh: '实验性高斯包络骨架权重与裙摆骨架草案；弹簧绑定、碰撞和动作测试必须另行完成验收。',");
c=c.replace(/summaryEn: 'Run clean-room envelope[^\n]+/, "summaryEn: 'Experimental Gaussian envelope weights and skirt bone draft; spring binding, collision and animation require separate verification.',");
c=c.replace(/summaryZh: '针对 Tripo[^\n]+/, "summaryZh: '生成 23 个启发式形态键并尝试绑定 VRM 预设；逐表情检查变形，只有真实导出文件通过容器检查才登记产物。',");
c=c.replace(/summaryEn: 'Author 23[^\n]+/, "summaryEn: 'Generate 23 heuristic morphs and attempt VRM preset binding; inspect every expression and validate the actual export artifact.',");
await fs.writeFile('lib/constants.js',c);
console.log('Integration contracts repaired');
