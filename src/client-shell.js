/*!
 * dsh-charakuru-studio — Charakuru Studio workbench (DeepSeek Harness web client bundle).
 *
 * Entry model: one workspace sidebar row (`sidebar.panellist`) that selects a full
 * main-column page (`main`, key = PANEL_ID). There is deliberately no conversation
 * header button and no modal: the workbench is a page, so it never traps focus,
 * never covers the transcript, and survives panel switches through its own store.
 *
 * Everything runs inside the module factory (lazy CJS contract): registering the
 * factory has no side effects, so CSS/dictionaries/slots appear on materialization.
 */
window.__ModuleLoader__.load({
  id: 'dsh-charakuru-studio',
  factory: function (require) {
    'use strict';
    var React = require('react');
    var h = React.createElement;
    var NS = 'charakuru-studio-ui';
    var PANEL_ID = 'charakuru-studio';
    var SIDEBAR_ORDER = 20;
    var TABS = ['pipeline', 'assets', 'editor', 'models', 'tripo', 'blender', 'credentials'];
    var TIMEOUT_FAST = 15000;
    var TIMEOUT_SLOW = 300000;

    var dict = {
      en: {
        nativeLabel: 'DSH / NATIVE WORKBENCH',
        workflowTitle: 'From illustration to avatar',
        workflowIntro: 'Use each step below in order. Opening a step never advances its checkpoint.',
        stageArtifact: 'Artifact',
        projectSetup: 'Character brief',
        openStep: 'Open current step',
        viewStep: 'View tools',
        checkpointTitle: 'Human checkpoint',
        checkpointHelp: 'Inspect the selected assets before approval. Structural evidence is not a visual verdict.',
        draftOnly: 'Inserts a DSH draft only. Review it and send manually.',
        imageSettings: 'Generation settings',
        suggestedStage: 'Best used for',
        idExample: 'Model ID example:',
        officialDoc: 'official docs',
        experimentalDoc: 'experimental contract',
        modelDocs: 'Read provider or weights documentation',
        open_weights: 'Open weights',
        closed: 'Closed weights',
        unknown: 'Unspecified weights',
        imageScope: 'Target slots',
        allViews: 'All 11 references',
        referenceMode: 'Reference input',
        projectRef: 'Use project illustration if present',
        textOnly: 'Text only — do not send original',
        textOnlyHelp: 'The original stays in the project and will not be read or sent by this operation.',
        referenceIsSet: 'A project illustration is registered. An incompatible live driver will be blocked.',
        referenceEmpty: 'This project has no reference image. Register its PNG in the asset library if needed.',
        cloudOff: 'Cloud execution is off in Host settings. Prompts and plans still work.',
        cloudConfirmRef: 'This sends one private reference PNG and prompt to the named provider. Verify upload rights and cost. Confirm this single view?',
        cloudConfirmText: 'This sends the prompt to the named provider and may cost credits. Confirm this single view?',
        preflightReady: 'Configuration passes; service, model weights and account have not been tested.',
        imageRequest: 'Persistent request ID:',
        resetImageRequest: 'Start a different request',
        resetImageConfirm: 'Confirm the previous request is settled or was never sent. A timeout does not prove that no charge occurred. Clear this ID?',
        tripoReceipt: 'Budget plan only',
        tripoSeparate: 'Studio and API balances are separate. Check your actual API quote.',
        tripoEstimateLine: 'Est. cost / locally recorded remaining credits:',
        tripoApprovedInputs: 'Approved files in front / right / left / back order. Only upload what your account and asset rights allow.',
        tripoWaitInputs: 'View approval required before listing upload files.',
        exportedPlan: 'Exported plan — not images',
        unboundReference: 'This exported plan does not bind the project illustration to this driver. Use a reference-edit adapter instead.',
        imageReceipt: 'Image receipt',
        compiledPrompts: 'Prompts per view',
        imageSelected: 'Registered and selected',
        imageCandidate: 'Candidate, existing selection unchanged',
        viewReview: 'Review part views together',
        balanceReview: 'Balance references · separate from the eight part views',
        viewReviewHelp: 'Compare head/hair and body at the same angle. Check seams, coverage, silhouette and anatomical left/right.',
        chooseAngle: 'Comparison angle',
        front: 'Front',
        backView: 'Rear',
        left: 'Own left',
        right: 'Own right',
        missingView: 'No selected PNG',
        redoView: 'Prepare this view',
        useBlender: 'Open 3D editor',
        prepBlender: 'Open Blender preparation',
        panel: 'Avatar Studio', open: 'Avatar Studio', title: 'Character → VRM studio', close: 'Close', refresh: 'Load project', backend: 'Studio API URL', project: 'Project directory',
        subtitle: 'A local-first workflow for reference images, mesh candidates, Blender revisions and human review.',
        back: 'Back to conversation', loading: 'Loading project state…', retry: 'Retry', rail: 'Workbench sections',
        timeout: 'The Studio API did not answer in time.', copied: 'Instructions copied — paste them into the composer.',
        noSession: 'No conversation is open; open a session to insert instructions.', idle: 'Ready.',
        activeStage: 'Active stage', progress: 'Progress',
        settingsHint: 'The Studio API is the loopback host this plugin starts on the machine running DeepSeek Harness. Change the port only when you moved it.',
        pipeline: 'Project & reviews', models: 'Models & views', tripo: 'Tripo budget', blender: 'Blender', credentials: 'Credentials',
        editor: '3D editor & production', sourceBlend: 'Source Blend path', editorOperation: 'Operation', editorParams: 'Structured operation parameters (JSON)', editorRun: 'Save as new revision', editorImport: 'Import existing Blend', editorUndo: 'Rollback to previous revision', vrmAddonPath: 'VRM add-on parent directory', aiPrompt: 'AI edit request', aiRequest: 'Record AI edit request', camera: 'Camera', overlay: 'Reference overlay', overlayOpacity: 'Overlay opacity', saveView: 'Save camera / overlay', collectEditor: 'Collect editor job',
        aiDraft: 'Prepare DSH chat draft', aiRecorded: 'Request saved. Open a DSH conversation and prepare the draft again; nothing was sent.',
        aiReviewHint: 'Review and send the draft in DSH. After the Agent completes a Blender operation, load the project and inspect the resulting revision before accepting it.',
        aiRequested: 'Awaiting Agent', aiReady: 'Awaiting visual review', aiApproved: 'Edit accepted', aiRejected: 'Edit rejected',
        checkpointImport: 'Continue from Blender checkpoint',
        aiAccept: 'Accept this edit', aiReject: 'Reject and restore previous revision', sourceSlot: 'Original illustration (not a view slot)',
        assets: 'Asset library', importAsset: 'Import asset', scanViews: 'Scan generated views', sourcePath: 'Local PNG / GLB path', assetKind: 'Asset type', slotId: 'View slot', selectAsset: 'Use this version', openProject: 'Open project', preflight: 'Check capabilities',
        prompt: 'Character description', source: 'Reference PNG path (optional)', allowance: 'Actual monthly Studio allowance', init: 'Create / update project',
        review: 'Request review', approve: 'Approve checkpoint', reject: 'Request changes', notes: 'Review notes', insert: 'Insert stage instructions in composer',
        model: 'Image model', apiModel: 'Provider API model ID (required for cloud execution)', variant: 'Anima variant', unet: 'Custom Anima UNet filename',
        artist: 'Artist tag', compile: 'Preview prompts', export: 'Export plan / workflow', execute: 'Generate selected views',
        cloudHint: 'No automatic cloud fallback. Configuration preflight sends no images, starts no jobs and does not check balance.',
        snapshot: 'AA Image Arena v2.1 · 2026-11-18 · overall ranks. A score is not an API entitlement or a production validation.',
        strategy: 'Budget strategy', estimate: 'Estimated credits (optional override)', plan: 'Build manual Studio plan', part: 'Part', head: 'Head', body: 'Body', accessory: 'Accessory',
        glb: 'Downloaded GLB path', task: 'Remote task ID (recommended for billing identity)', spent: 'Actual credits spent', archive: 'Validate & archive GLB',
        tripoHint: 'Studio operations are performed in the signed-in website. 200 monthly credits and 95/145 costs are editable planning assumptions. Confirm your account terms. OpenAPI balance is separate.',
        probe: 'Probe companion connection', operation: 'Blender operation', blend: 'Input blend path (optional: use last checkpoint)', headGlb: 'Head GLB (optional: use selected asset)', bodyGlb: 'Body GLB (optional: use selected asset)',
        scripts: 'Generate Python script', run: 'Execute through companion', target: 'Execution target',
        blenderHint: 'Requires dsh-blender-plugin and VRM Add-on. Assembly, Gaussian weights, skirt bones and facial morphs are drafts. Skirt spring binding and garment weights remain manual. Run companion mesh, assembly and animation checks before approving.',
        provider: 'Provider', secret: 'API key', saveKey: 'Save in Host credential store', clearKey: 'Delete Host record', configured: 'Configured', missing: 'Not configured',
        keyHint: 'Keys are entered here and sent only to the loopback Host. They are never inserted into the conversation. Deleting a Host record leaves environment variable fallback active.',
        busy: 'Working…', done: 'Operation completed', degraded: 'Review required', failed: 'Operation failed', offline: 'Load the project to see state.',
        notInitialized: 'Project is not initialized yet.', inserted: 'Instructions inserted; review before sending.', draftChanged: 'Composer changed; try inserting again.',
        status: 'Status', result: 'Latest result', noResult: 'Results and generated paths appear here.', views: 'Ready views', credits: 'Remaining budget',
        stage1: 'Import parts', stage2: 'Assemble ratio draft', stage3: 'Gaussian rig draft', stage4: 'Skirt bone draft', stage5: 'Morphs & VRM export attempt',
        in_progress: 'In progress', pending: 'Pending', awaiting_review: 'Awaiting review', completed: 'Completed',
        balance: 'Full body', settings: 'Connection & project', instructions: 'Work in this character project. Read the bundled charakuru-vrm-studio skill and use companion catalog/audit/gate operations. Check the current stage, report actual artifacts and request review after the work. Never infer asset validation from process success.'
      },
      zh: {
        nativeLabel: 'DSH 原生工作台',
        workflowTitle: '从原画到角色模型',
        workflowIntro: '依次准备每一步的产物。打开工序只是查看，不会推进关卡。',
        stageArtifact: '需交付',
        projectSetup: '角色与预算设置',
        openStep: '打开当前工序',
        viewStep: '查看工具',
        checkpointTitle: '人工关卡',
        checkpointHelp: '请先打开预览并核对已采用的素材。结构证据不等于视觉通过。',
        draftOnly: '只准备 DSH 会话草稿；请审阅后自行发送。',
        imageSettings: '生图配置',
        suggestedStage: '建议用于',
        idExample: '模型 ID 示例：',
        officialDoc: '官方文档',
        experimentalDoc: '实验协议',
        modelDocs: '查看接口 / 权重说明',
        open_weights: '开放权重',
        closed: '闭源',
        unknown: '权重类型未定',
        imageScope: '目标槽位',
        allViews: '全部 11 张',
        referenceMode: '参考图选择',
        projectRef: '使用工程原画（如有）',
        textOnly: '仅文字 · 不传原画',
        textOnlyHelp: '原画保留在工程，本次不会读取或发送原画。',
        referenceIsSet: '工程有原画；不支持参考的执行驱动会被阻止。',
        referenceEmpty: '工程暂无原画；需要时请到图库登记 PNG。',
        cloudOff: '宿主默认关闭云端执行，仍可生成提示词和预案。',
        cloudConfirmRef: '本次将向所选服务发送一张工程原画和提示词。请核对权限、隐私和费用。确认执行这一张？',
        cloudConfirmText: '本次向所选服务发送提示词并可能扣费，确认执行这一张？',
        preflightReady: '配置预审通过，尚未验证服务、权重或账户。',
        imageRequest: '持久任务 ID：',
        resetImageRequest: '解除旧 ID 以建立新任务',
        resetImageConfirm: '先核对上一任务已结算或未提交。超时不代表未扣费。确认解除旧 ID？',
        tripoReceipt: '预算预案 · 未提交',
        tripoSeparate: 'Studio 和 API 分账。请核对 API 账户的实际报价。',
        tripoEstimateLine: '预估消耗 / 本地账本余量：',
        tripoApprovedInputs: '按正面、角色右侧、角色左侧、背面列出已审批的真实文件路径；上传前仍须核对授权和报价。',
        tripoWaitInputs: '视图未通过，不列上传文件。',
        exportedPlan: '已导出预案 · 不等于出图',
        unboundReference: '这份预案不会将工程原画绑定到此驱动；如需角色参考，请改用支持参考编辑的适配器。',
        imageReceipt: '图像作业回执',
        compiledPrompts: '逐槽位提示词',
        imageSelected: '已登记并采用',
        imageCandidate: '登记为候选 · 保留现有选择',
        viewReview: '部件图对照',
        balanceReview: '全身比例参考 · 与八张拆件图分开',
        viewReviewHelp: '同方向并排核对头发和身体，检查发缘、接缝、T-Pose 和角色的左右侧。',
        chooseAngle: '部件对照朝向',
        front: '正面',
        backView: '背面',
        left: '角色左侧',
        right: '角色右侧',
        missingView: '未采用 PNG',
        redoView: '补做此图',
        useBlender: '打开三维编辑',
        prepBlender: '打开 Blender 前处理',
        panel: 'Avatar Studio 工作台', open: 'Avatar Studio 工作台', title: '角色立绘 → VRM 工作台', close: '关闭', refresh: '载入工程', backend: 'Studio API 地址', project: '工程目录',
        subtitle: '本地优先：从原画与拆件视图，到网格候选、Blender 版本和人工验收。',
        back: '返回会话', loading: '正在载入工程状态…', retry: '重试', rail: '工作台分区',
        timeout: 'Studio API 未在预期时间内响应。', copied: '指令已复制，请粘贴到输入框。',
        noSession: '当前没有打开的会话，请先打开一个会话再插入指令。', idle: '就绪。',
        activeStage: '当前阶段', progress: '进度',
        settingsHint: 'Studio API 由本插件在运行 DeepSeek Harness 的本机回环启动；只有改过端口时才需要修改。',
        pipeline: '工程与关卡', models: '模型与视图', tripo: 'Tripo 预算', blender: 'Blender', credentials: '密钥',
        editor: '三维编辑与生产', sourceBlend: '源 Blend 文件路径', editorOperation: '工序', editorParams: '结构化工序参数（JSON）', editorRun: '执行并保存新版本', editorImport: '导入已有 Blend', editorUndo: '回滚上一版本', vrmAddonPath: 'VRM 插件所在父目录', aiPrompt: 'AI 修改要求', aiRequest: '登记 AI 修改请求', camera: '相机方向', overlay: '参考图叠加', overlayOpacity: '叠加透明度', saveView: '保存视角与叠图', collectEditor: '收集编辑作业',
        aiDraft: '准备 DSH 会话草稿', aiRecorded: '请求已保存，尚未发送。打开 DSH 会话后可重新准备草稿。',
        aiReviewHint: '在 DSH 会话检查并发送草稿。Agent 完成 Blender 工序后，点击载入工程，预览新版本并决定是否接受。',
        aiRequested: '待 Agent 处理', aiReady: '待视觉审阅', aiApproved: '已接受修改', aiRejected: '已拒绝修改',
        checkpointImport: '从 Blender 检查点接力',
        aiAccept: '接受本次修改', aiReject: '拒绝并恢复前一版本', sourceSlot: '原画（不占视图槽）',
        assets: '图片与模型库', importAsset: '导入资产', scanViews: '扫描生成的视图', sourcePath: '本地 PNG / GLB 文件路径', assetKind: '资产类型', slotId: '视图槽位', selectAsset: '采用此版本', openProject: '打开已有工程', preflight: '执行前能力检查',
        prompt: '角色外观描述', source: '参考 PNG 路径（可选）', allowance: '账户实际月度 Studio 额度', init: '创建 / 更新工程',
        review: '提交审阅', approve: '通过本关', reject: '要求修改', notes: '审阅备注', insert: '将本阶指令插入输入框',
        model: '生图模型', apiModel: '供应商实际 API 模型 ID（云端执行必填）', variant: 'Anima 版本', unet: 'Anima 自定义 UNet 文件名（可选）',
        artist: '画师标签', compile: '预览提示词', export: '导出预案 / 工作流', execute: '生成选定视图',
        cloudHint: '不自动切换云端。预审不上传、不排队、不查询余额，也不能代替模型实机验证。',
        snapshot: 'AA Image Arena v2.1 · 2026-11-18 总榜快照。榜单名次不等于账号开放、真实报价或生产验收。',
        strategy: '预算方案', estimate: '预计消耗（可选覆盖值）', plan: '生成 Studio 手动操作计划', part: '部件', head: '头部', body: '身体', accessory: '配饰',
        glb: '已下载 GLB 路径', task: '远端任务 ID（推荐，用于幂等记账）', spent: '实际消耗积分', archive: '校验并归档 GLB',
        tripoHint: 'Studio 操作由用户在已登录网页完成。月度 200 积分与 95/145 消耗均为可调整的规划假设，请核对账户权益。OpenAPI 余额独立计算。',
        probe: '检测伴随插件', operation: 'Blender 工序', blend: '输入 blend 路径（可选：使用上次检查点）', headGlb: '头部 GLB（可选：使用已选资产）', bodyGlb: '身体 GLB（可选：使用已选资产）',
        scripts: '生成 Python 脚本', run: '通过伴随插件执行', target: '执行通道',
        blenderHint: '需启用 dsh-blender-plugin 与 VRM Add-on。比例装配、高斯权重、裙摆骨架与表情均为草案；裙摆弹簧绑定及服装权重需人工完成。通过网格、装配和动作检查后再批准关卡。',
        provider: '供应商', secret: 'API 密钥', saveKey: '存入 Host 凭据库', clearKey: '删除 Host 记录', configured: '已配置', missing: '未配置',
        keyHint: '密钥仅在密码框录入并发往本机 Host，进入对话的工具仅显示配置状态。删除 Host 记录后，环境变量回退仍可能生效。',
        busy: '执行中…', done: '操作完成', degraded: '仍需复核', failed: '操作失败', offline: '载入工程后显示状态。',
        notInitialized: '工程尚未初始化。', inserted: '指令已插入，请检查后发送。', draftChanged: '输入框已变化，请重新插入。',
        status: '状态', result: '最近结果', noResult: '操作结果与生成路径将在这里显示。', views: '已生成视图', credits: '剩余预算',
        stage1: '导入部件', stage2: '比例装配草案', stage3: '高斯骨架草案', stage4: '裙摆骨架草案', stage5: '表情与 VRM 导出尝试',
        in_progress: '进行中', pending: '待开始', awaiting_review: '待审阅', completed: '已完成',
        balance: '全身', settings: '连接与工程', instructions: '在此角色工程中工作。先读 charakuru-vrm-studio 技能，使用伴随插件 catalog/audit/gate 操作。检查当前阶段，以真实产物与回执汇报，完成后提交人工审阅。脚本成功执行不代表模型通过验收。'
      }
    };

    var css = [
      '.ck-page{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.ck-head{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-start;justify-content:space-between;padding:calc(18px + var(--dsh-frame-top-clearance,0px)) clamp(18px,3vw,32px) 12px}',
      '.ck-heading{min-width:0}',
      '.ck-title{margin:0;font-size:19px;font-weight:600;line-height:26px;letter-spacing:-.01em}',
      '.ck-sub{margin:4px 0 0;max-width:68ch;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.ck-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}',
      '.ck-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}',
      '.ck-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.ck-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.ck-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-on-color)}',
      '.ck-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.ck-btn[data-variant="ghost"]{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '.ck-btn[data-variant="ghost"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ck-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.ck-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:6px}',
      '.ck-strip{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 clamp(18px,3vw,32px) 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.ck-chip{display:inline-flex;align-items:center;gap:6px;max-width:min(100%,38ch);padding:2px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ck-chip[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}',
      '.ck-chip[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.ck-chip[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.ck-chip[data-tone="brand"]{color:var(--dsw-alias-brand-primary)}',
      '.ck-body{display:grid;grid-template-columns:200px minmax(0,1fr);gap:18px;flex:1;min-height:0;padding:14px clamp(18px,3vw,32px) 6px}',
      '.ck-rail{display:flex;flex-direction:column;gap:2px;min-width:0;padding:0 10px 0 0;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.ck-tab{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.ck-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ck-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:500}',
      '.ck-dot{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.45}',
      '.ck-tab[aria-selected="true"] .ck-dot{background:var(--dsw-alias-brand-primary);opacity:1}',
      '.ck-rail-foot{margin-top:auto;padding:10px 0 4px}',
      '.ck-content{display:flex;flex-direction:column;gap:14px;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 6px 18px 0}',
      '.ck-card{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.ck-card-title{margin:0;font-size:13px;font-weight:600;line-height:20px}',
      '.ck-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 14px}',
      '.ck-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.ck-field>span{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.ck-field input,.ck-field select,.ck-field textarea{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}',
      '.ck-field textarea{min-height:72px;resize:vertical}',
      '.ck-field input:disabled,.ck-field select:disabled,.ck-field textarea:disabled{opacity:.6}',
      '.ck-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.ck-muted{color:var(--dsw-alias-label-secondary)}',
      '.ck-error{color:var(--dsw-alias-state-error-primary)}',
      '.ck-stage{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;padding:7px 0 7px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.ck-stage:first-of-type{border-top:0;padding-top:0}',
      '.ck-stage-body{flex:1 1 240px;min-width:0}',
      '.ck-stage-body p{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.ck-pill{flex:none;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:18px}',
      '.ck-pill[data-status="completed"]{color:var(--dsw-alias-state-success-primary)}',
      '.ck-pill[data-status="in_progress"]{color:var(--dsw-alias-brand-primary)}',
      '.ck-pill[data-status="awaiting_review"]{color:var(--dsw-alias-state-warn-primary)}',
      '.ck-pill[data-status="pending"]{color:var(--dsw-alias-label-tertiary)}',
      '.ck-progress{width:100%;height:6px;appearance:none;border:0;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
      '.ck-flow-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:17px 19px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.ck-eyebrow{font-size:10px;letter-spacing:.14em;color:var(--dsw-alias-brand-primary);font-weight:700}',
      '.ck-flow-heading h2{margin:5px 0 4px;font-size:clamp(20px,3vw,29px);letter-spacing:-.035em}',
      '.ck-flow-heading p,.ck-stage-body p{margin:3px 0;font-size:12px;line-height:1.55}',
      '.ck-stage-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}',
      '.ck-stage-list .ck-stage{display:flex;align-items:flex-start;justify-content:flex-start;gap:12px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}',
      '.ck-stage-list .ck-stage[data-active=true]{border-color:var(--dsw-alias-brand-primary)}',
      '.ck-stage-body{min-width:0;flex:1}.ck-stage-artifact{color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.ck-stage-actions{display:flex;flex-wrap:wrap;gap:5px;align-items:center;justify-content:flex-end}.ck-step-no{flex:none;width:27px;height:27px;display:grid;place-items:center;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;font-weight:700;color:var(--dsw-alias-brand-primary)}',
      '.ck-model-stats{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ck-tips,.ck-paths{padding-inline-start:22px;line-height:1.6;overflow-wrap:anywhere}',
      '.ck-callout{border-inline-start:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);padding:9px 12px;border-radius:4px;font-size:12px;line-height:1.6}.ck-callout ul{margin:0;padding-inline-start:18px}',
      '.ck-view-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:9px}.ck-view-card{padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow-wrap:anywhere}.ck-view-card img{width:100%;height:clamp(100px,22vw,220px);object-fit:contain;background:#17202d;border-radius:5px}',
      '@media(max-width:580px){.ck-stage-list .ck-stage{flex-wrap:wrap}.ck-stage-actions{width:100%;justify-content:flex-start;padding-inline-start:39px}}',
      '.ck-progress::-webkit-progress-bar{background:var(--dsw-alias-bg-layer-2)}',
      '.ck-progress::-webkit-progress-value{background:var(--dsw-alias-brand-primary)}',
      '.ck-details{padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.ck-details>summary{padding:10px 0;color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer}',
      '.ck-details[open]>summary{color:var(--dsw-alias-label-primary)}',
      '.ck-details-body{display:flex;flex-direction:column;gap:10px;padding:2px 0 14px}',
      '.ck-pre{margin:0;padding:10px;border-radius:8px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto}',
      '.ck-asset-focus{display:block;width:100%;max-height:62vh;object-fit:contain;background:#18212c;border-radius:8px}',
      '.ck-empty{display:flex;flex-direction:column;gap:10px;align-items:flex-start;justify-content:center;padding:20px 0}',
      '@container (max-width:680px){.ck-body{grid-template-columns:1fr;gap:12px;padding-bottom:0}.ck-rail{flex-direction:row;overflow-x:auto;gap:4px;padding:0 0 8px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.ck-tab{width:auto;white-space:nowrap}.ck-rail-foot{margin:0;padding:0}.ck-content{padding-right:0}}',
      '@media (prefers-reduced-motion:reduce){.ck-btn,.ck-tab{transition:none}}'
    ].join('');

    /**
     * Accept only the loopback Studio host: no credentials, query, hash or sub-path.
     * @param {string} raw - operator-supplied base URL.
     * @returns {string} normalized origin.
     */
    function loopback(raw) {
      var u = new URL(raw);
      if (['127.0.0.1', 'localhost', '[::1]'].indexOf(u.hostname) < 0 || u.protocol !== 'http:' || u.username
        || u.password || u.search || u.hash || u.pathname !== '/') {
        throw new Error('Expected http://localhost:PORT');
      }
      return u.origin;
    }

    /**
     * @param {object} config - plugin config (host port and default image model).
     * @returns {object} form state.
     */
    function createForm(config) {
      var activeProject='';try{activeProject=localStorage.getItem('avatar-studio-active-project')||'';}catch(_){}
      return {
        base: 'http://127.0.0.1:' + (config.port || 9886),
        imageRequestId: '', accountAlias: '', accountLimit: '0', accountChannel: 'tripo_studio', sourceBlend: '', editorOperation: 'audit', editorParams: '{}', vrmAddonPath: '', aiPrompt: '', editorCamera: 'front', overlayId: '', overlayOpacity: '0.35', selectedObject: '', playMotion: false, assetKind: 'image', slotId: 'source', sourcePath: '', previewId: '', projectDir: activeProject, prompt: '', source: '', allowance: '200',
        model: config.defaultImageModel || 'qwen-image-2.1-local',
        apiModel: '', variant: 'base', artist: '', unet: '', imageScope: 'head_front', referenceMode: 'project', compareAngle: 'front',
        strategy: 'studio_free_saver', estimate: '', part: 'head',
        glb: '', task: '', spent: '0', notes: '',
        operation: 'stage1_safe_import', blend: '', headGlb: '', bodyGlb: '',
        target: 'headless', provider: 'novelai', secret: ''
      };
    }

    /**
     * Panel-scoped store: one instance per plugin life, so switching to the
     * conversation and back keeps the tab, the form and the last result.
     * @param {object} ctx - plugin context (locale, services).
     * @param {object} config - plugin config.
     */
    function createStudio(ctx, config) {
      var t = ctx.locale.bind(NS);
      var state = {
        form: createForm(config), boot: null, loaded: false, pending: false, busy: false,
        tab: 'pipeline', imagePreflight: null, result: null, error: '', notice: ''
      };
      var listeners = new Set();
      var controllers = new Set();
      var disposed = false;

      function getSnapshot() { return state; }

      function subscribe(listener) {
        listeners.add(listener);
        return function () { listeners.delete(listener); };
      }

      function set(patch) {
        if (disposed) return;
        state = Object.assign({}, state, patch);
        Array.from(listeners).forEach(function (listener) {
          try { listener(); } catch (error) { console.error(error); }
        });
      }

      function put(key, value) { if(key==='projectDir')try{localStorage.setItem('avatar-studio-active-project',value);}catch(_){} if(key==='imageRequestId')try{localStorage.setItem('avatar-studio-request:'+state.form.projectDir,value);}catch(_){} set({ form: Object.assign({}, state.form, { [key]: value }) }); }

      function verdictLabel(data) {
        if (!data) return '';
        if (data.verdict === 'fail') return t('failed');
        if (data.verdict === 'degraded') return t('degraded');
        if (data.verdict === 'pass' || data.verdict === 'done') return t('done');
        return t('done');
      }

      async function request(route, body) {
        if (typeof fetch !== 'function') throw new Error('fetch is unavailable in this host');
        var controller = new AbortController();
        controllers.add(controller);
        var slow = route.indexOf('/editor/run') >= 0 || route.indexOf('/editor/collect') >= 0 || route.indexOf('generate') >= 0 || route.indexOf('/blender/stage') >= 0;
        var timer = setTimeout(function () { controller.abort(); }, slow ? TIMEOUT_SLOW : TIMEOUT_FAST);
        try {
          var res = await fetch(loopback(state.form.base) + route, {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'X-Charakuru-Session': state.boot && state.boot.sessionToken || '' } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok || (data && data.error)) {
            var message = data && (typeof data.error === 'string' ? data.error : data.error && data.error.message);
            throw new Error(message || 'HTTP ' + res.status);
          }
          return data;
        } catch (error) {
          if (error && error.name === 'AbortError') throw new Error(t('timeout'));
          throw error;
        } finally {
          clearTimeout(timer);
          controllers.delete(controller);
        }
      }

      function hydrateForm(data) {
        if (!data) return;
        var spec = data.projectState && data.projectState.characterSpec;
        var quota = data.projectState && data.projectState.tripoQuota;
        var next = Object.assign({}, state.form);
        if (data.activeProjectDir) {next.projectDir = data.activeProjectDir;try{localStorage.setItem('avatar-studio-active-project',next.projectDir);}catch(_){}}
        try{next.imageRequestId=localStorage.getItem('avatar-studio-request:'+next.projectDir)||'';}catch(_){}
        if (spec) {
          if (spec.preferredImageModel) next.model = spec.preferredImageModel;
          if (spec.characterPrompt) next.prompt = spec.characterPrompt;
          next.source = spec.sourceImages && spec.sourceImages[0] || '';
        }
        var view = data.projectState && data.projectState.editor && data.projectState.editor.view;
        if(view){next.editorCamera=view.camera;next.overlayId=view.overlayAssetId||'';next.overlayOpacity=String(view.overlayOpacity);}
        if (quota && typeof quota.monthlyAllowance === 'number') next.allowance = String(quota.monthlyAllowance);
        set({ form: next });
      }

      async function refresh(hydrate) {
        var dir = state.form.projectDir;
        var data = await request('/studio/bootstrap' + (dir ? '?projectDir=' + encodeURIComponent(dir) : ''));
        set({ boot: data, loaded: true });
        if (hydrate) hydrateForm(data);
        return data;
      }

      function act(task) {
        if (state.pending) return Promise.resolve(undefined);
        set({ pending: true, busy: true, error: '', notice: '' });
        return Promise.resolve()
          .then(task)
          .then(function (data) {
            var patch = { pending: false, busy: false };
            if (data) { patch.result = data; patch.notice = verdictLabel(data); }
            set(patch);
            return data;
          })
          .catch(function (error) {
            set({ pending: false, busy: false, error: (error && error.message) || String(error) });
            return undefined;
          });
      }

      function syncOriginal(data) {
        var project = data.projectState || data.state;
        if (project && project.characterSpec && project.characterSpec.sourceImages) {
          put('source', project.characterSpec.sourceImages[0] || '');
        }
      }

      function action(route, body, refreshAfter) {
        return act(async function () {
          var payload = Object.assign({ projectDir: state.form.projectDir }, body);
          var data = await request(route, payload);
          if (route === '/studio/assets/import' && data.asset && data.asset.slotId === 'source') syncOriginal(data);
          if (route === '/studio/assets/select' && body.assetId && data.state && data.state.assets && data.state.assets.selected.source === body.assetId) syncOriginal(data);
          if (refreshAfter) await refresh(false);
          return data;
        });
      }

      function handoffAiEdit(route, body, refreshAfter) {
        return act(async function () {
          var data = await request(route, Object.assign({ projectDir: state.form.projectDir }, body));
          if (refreshAfter) await refresh(false);
          var outcome = data.instruction ? insertInstructions(data.instruction) : 'unsupported';
          return Object.assign({}, data, { draftOutcome: outcome });
        }).then(function (data) {
          if (data) set({ notice: t(data.draftOutcome === 'ok' ? 'inserted' : 'aiRecorded') });
          return data;
        });
      }

      function autoload() {
        if (state.loaded || state.pending || typeof fetch !== 'function') return;
        void act(function () { return refresh(true); });
      }

      /** Current session id: the one the main view retains (built-in convention). */
      function currentSessionId() {
        var sessions = ctx.get('sessions');
        if (!sessions || !sessions.list) return undefined;
        var list = sessions.list.getSnapshot();
        var byId = (list && list.byId) || {};
        var ids = Object.keys(byId);
        for (var i = 0; i < ids.length; i += 1) {
          var retained = byId[ids[i]].retainedBy || {};
          if ((retained.mainView || 0) > 0) return ids[i];
        }
        return undefined;
      }

      /**
       * Insert the stage brief into the current composer. The workbench is a global
       * page, so it cannot use the session-scoped `inputActions` seat; it goes through
       * the same draft API the workspace navigator uses, then returns to the transcript.
       * @param {string} prompt - text to place in the draft.
       * @returns {'ok'|'no-session'|'blocked'|'unsupported'}
       */
      function insertInstructions(prompt) {
        var sessions = ctx.get('sessions');
        var conversation = ctx.get('conversation');
        if (!sessions || !conversation || !conversation.input
          || typeof conversation.input.requestDraftInitialization !== 'function') return 'unsupported';
        var id = currentSessionId();
        if (id === undefined) return 'no-session';
        var binding = sessions.binding(id);
        if (!binding) return 'no-session';
        var outcome = conversation.input.requestDraftInitialization(binding, { prompt: prompt, whenDraftExists: 'append' });
        if (outcome === 'blocked') return 'blocked';
        back();
        return 'ok';
      }

      /** Return to the transcript (global panels clear the active panel id). */
      function back() {
        var layout = ctx.get('layout');
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null);
      }

      function copy(text) {
        if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) return false;
        try { void navigator.clipboard.writeText(text); return true; } catch (error) { return false; }
      }

      function dispose() {
        disposed = true;
        controllers.forEach(function (controller) { controller.abort(); });
        controllers.clear();
        listeners.clear();
      }

      return {
        t: t, subscribe: subscribe, getSnapshot: getSnapshot, set: set, put: put,
        act: act, action: action, request: request, refresh: refresh, autoload: autoload, syncOriginal: syncOriginal,
        insertInstructions: insertInstructions, handoffAiEdit: handoffAiEdit, currentSessionId: currentSessionId,
        back: back, copy: copy, dispose: dispose
      };
    }

    /**
     * Sidebar row icon: a portrait frame, inheriting the row's color.
     * @param {{size?: number, active?: boolean}} props - seat props from `sidebar.panellist`.
     */
    function StudioIcon(props) {
      var size = (props && props.size) || 18;
      var active = Boolean(props && props.active);
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: active ? 1.9 : 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' }
      },
      h('rect', { x: 5, y: 3.5, width: 14, height: 17, rx: 2.5 }),
      h('circle', { cx: 12, cy: 10, r: 2.6 }),
      h('path', { d: 'M8.6 17.6c.7-1.8 1.9-2.8 3.4-2.8s2.7 1 3.4 2.8' }));
    }

    /**
     * Build the main-column page. All state lives in the studio store, so this
     * component only renders — no local React state, no effects beyond the
     * first-load bootstrap. The store arrives through the registration's inject
     * face (`props.studio`), matching how built-in pages receive their seams.
     * @param {object} ctx - plugin context.
     * @param {object} registered - store created for this plugin life.
     */
    /* PREVIEW_START */
// Original dependency-free GLB geometry preview. Embedded into client.js by scripts/build-client.mjs.
// Not a VRM renderer: no animation, texture, skin deformation, Draco or meshopt decoding.
function GeometryPreview(props) {
  var canvasRef = React.useRef(null);
  var status = React.useState('正在加载几何…'), message = status[0], setMessage = status[1];
  React.useEffect(function () {
    var canvas = canvasRef.current, controller = new AbortController(), gone = false;
    var yaw = 0.4, pitch = 0.1, zoom = 1, drag = null, triangles = [], vertices = [], colors = [];
    var context = canvas.getContext('2d');
    function draw() {
      if (gone || !context) return;
      var w = canvas.width, hgt = canvas.height, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      context.fillStyle = '#18212c'; context.fillRect(0,0,w,hgt);
      var screen = vertices.map(function(v) {
        var x = cy*v[0]+sy*v[2], z = -sy*v[0]+cy*v[2], y = cp*v[1]-sp*z;
        return [w/2+x*zoom*w*0.36,hgt/2-y*zoom*hgt*0.4,sp*v[1]+cp*z];
      });
      triangles.map(function(t,i) { return [t,i,(screen[t[0]][2]+screen[t[1]][2]+screen[t[2]][2])/3]; }).sort(function(a,b){return a[2]-b[2];}).forEach(function(entry) {
        var t=entry[0], a=screen[t[0]], b=screen[t[1]], c=screen[t[2]];
        context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.lineTo(c[0],c[1]);context.closePath();
        context.fillStyle=colors[entry[1]];context.fill();context.strokeStyle='rgba(0,0,0,.08)';context.stroke();
      });
    }
    function multiply(a,b) { var o=Array(16).fill(0);for(var col=0;col<4;col++)for(var row=0;row<4;row++)for(var k=0;k<4;k++)o[col*4+row]+=a[k*4+row]*b[col*4+k];return o; }
    var identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    function matrix(node) {
      if(node.matrix)return node.matrix;
      var q=node.rotation||[0,0,0,1],s=node.scale||[1,1,1],t=node.translation||[0,0,0],x=q[0],y=q[1],z=q[2],w=q[3];
      return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,t[0],t[1],t[2],1];
    }
    fetch(props.url,{signal:controller.signal}).then(function(r){if(!r.ok)throw new Error('资产读取失败：'+r.status);return r.arrayBuffer();}).then(function(buffer) {
      if(gone)return;
      var dv=new DataView(buffer), json, binary;
      for(var offset=12;offset<buffer.byteLength;){var len=dv.getUint32(offset,true),type=dv.getUint32(offset+4,true);if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset+8,len)));if(type===0x004e4942)binary=new DataView(buffer,offset+8,len);offset+=len+8;}
      if(!json||!binary)throw new Error('无内嵌几何数据');
      function accessor(id) {
        var a=json.accessors[id],v=a&&json.bufferViews[a.bufferView];
        if(!v||a.sparse||v.extensions||v.buffer!==0)throw new Error('预览不支持压缩或稀疏 accessor，请用 Blender 导出未压缩 GLB');
        var sizes={5121:1,5123:2,5125:4,5126:4},components={SCALAR:1,VEC3:3},size=sizes[a.componentType],n=components[a.type];
        if(!size||!n||a.count>450000)throw new Error('不支持的几何格式或顶点过多');
        var start=(v.byteOffset||0)+(a.byteOffset||0),step=v.byteStride||size*n,out=[];
        if(start+(a.count-1)*step+size*n>binary.byteLength)throw new Error('Accessor 越界');
        for(var i=0;i<a.count;i++){var row=[];for(var j=0;j<n;j++){var at=start+i*step+j*size;row.push(a.componentType===5126?binary.getFloat32(at,true):a.componentType===5125?binary.getUint32(at,true):a.componentType===5123?binary.getUint16(at,true):binary.getUint8(at));}out.push(row);}
        return out;
      }
      function visit(id,parent,ancestors) {
        if(ancestors.indexOf(id)>=0||ancestors.length>100)throw new Error('循环或过深节点');
        var node=json.nodes[id],m=multiply(parent,matrix(node));
        if(node.mesh!==undefined)(json.meshes[node.mesh].primitives||[]).forEach(function(p) {
          if(p.mode!==undefined&&p.mode!==4||p.extensions)throw new Error('仅支持未压缩三角形网格');
          var values=accessor(p.attributes.POSITION),base=vertices.length;
          if(base+values.length>450000)throw new Error('几何超过预览预算，请在 Blender 查看');
          values.forEach(function(v){vertices.push([m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]]);});
          var indices=p.indices===undefined?values.map(function(_,i){return [i];}):accessor(p.indices);
          var color=json.materials&&json.materials[p.material]&&json.materials[p.material].pbrMetallicRoughness&&json.materials[p.material].pbrMetallicRoughness.baseColorFactor||[0.6,0.75,0.85,1];
          for(var k=0;k+2<indices.length;k+=3){if(triangles.length>=60000)throw new Error('超过 6 万面预览预算，请在 Blender 查看');var t=[indices[k][0],indices[k+1][0],indices[k+2][0]];if(t.some(function(i){return i<0||i>=values.length;}))throw new Error('无效索引');triangles.push(t.map(function(i){return i+base;}));var shade=.76+.24*Math.abs(Math.sin(k*1.3));colors.push('rgb('+color.slice(0,3).map(function(c){return Math.round(c*255*shade);}).join(',')+')');}
        });
        (node.children||[]).forEach(function(child){visit(child,m,ancestors.concat(id));});
      }
      var scene=json.scenes&&json.scenes[json.scene||0];if(!scene)throw new Error('GLB 缺少场景');
      scene.nodes.forEach(function(id){visit(id,identity,[]);});
      if(!triangles.length)throw new Error('无可显示的三角形');
      var min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];vertices.forEach(function(v){v.forEach(function(x,i){if(!Number.isFinite(x))throw new Error('无效顶点');min[i]=Math.min(min[i],x);max[i]=Math.max(max[i],x);});});
      var extent=Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2])||1;
      vertices=vertices.map(function(v){return v.map(function(x,i){return (x-(min[i]+max[i])/2)*2/extent;});});
      setMessage(triangles.length+' 面 · 拖动旋转 / 滚轮缩放 · 仅几何与基础色，不含纹理、骨骼及物理验收');draw();
    }).catch(function(e){if(!gone)setMessage(e.message);});
    function down(e){drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);}
    function move(e){if(!drag)return;yaw+=(e.clientX-drag[0])*.01;pitch+=(e.clientY-drag[1])*.01;drag=[e.clientX,e.clientY];draw();}
    function up(){drag=null;}
    function wheel(e){e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw();}
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('wheel',wheel,{passive:false});
    return function(){gone=true;controller.abort();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('wheel',wheel);};
  },[props.url]);
  return h('div',null,h('canvas',{ref:canvasRef,width:640,height:440,style:{width:'100%',maxWidth:640,touchAction:'none',borderRadius:8},'aria-label':'GLB geometry preview'}),h('p',{className:'ck-muted'},message));
}

    /* PREVIEW_END */
    function makePanel(ctx, registered) {
      return function StudioWorkbench(props) {
        var studio = (props && props.studio) || registered;
        var t = studio.t;
        React.useSyncExternalStore(function (onChange) { return ctx.locale.subscribe(onChange); },
          function () { return ctx.locale.getSnapshot(); });
        var state = React.useSyncExternalStore(studio.subscribe, studio.getSnapshot);
        var uid = React.useId ? React.useId() : 'ck-studio';
        React.useEffect(function () { studio.autoload(); }, []);

        var form = state.form;
        var boot = state.boot;
        var busy = state.busy;
        var lang = ctx.locale.getSnapshot().active.indexOf('zh') === 0 ? 'Zh' : 'En';
        var stages = (boot && boot.stages) || [];
        var projectState = boot && boot.projectExists
          && (!form.projectDir || form.projectDir === boot.activeProjectDir) ? boot.projectState : null;
        var summary = projectState && boot.projectSummary;
        var activeStage = projectState && projectState.stages && projectState.stages[projectState.activeStageId];
        var models = (boot && boot.aaCatalog && boot.aaCatalog.models) || [];
        var selectedModel;
        for (var index = 0; index < models.length; index += 1) {
          if (models[index].id === form.model) selectedModel = models[index];
        }

        function stageName(id) {
          for (var i = 0; i < stages.length; i += 1) if (stages[i].id === id) return stages[i]['title' + lang] || id;
          return id;
        }

        function fieldId(key) { return uid + '-f-' + key; }

        function field(key, name, type) {
          var id = fieldId(key);
          return h('label', { className: 'ck-field', key: key, htmlFor: id },
            h('span', null, t(name || key)),
            h(type === 'textarea' ? 'textarea' : 'input', {
              id: id, value: form[key], type: type === 'textarea' ? undefined : type || 'text',
              autoComplete: key === 'secret' ? 'off' : undefined, disabled: busy,
              onChange: function (event) { studio.put(key, event.target.value); }
            }));
        }

        function select(key, name, options) {
          var id = fieldId(key);
          return h('label', { className: 'ck-field', key: key, htmlFor: id },
            h('span', null, t(name)),
            h('select', {
              id: id, value: form[key], disabled: busy,
              onChange: function (event) { studio.put(key, event.target.value); }
            }, options.map(function (option) { return h('option', { key: option[0], value: option[0] }, option[1]); })));
        }

        function button(key, onClick, disabled, variant) {
          return h('button', {
            key: key, type: 'button', className: 'ck-btn', 'data-variant': variant || 'default',
            disabled: busy || disabled, onClick: onClick
          }, t(key));
        }

        function card(title, children) {
          return h('section', { className: 'ck-card', key: title || undefined },
            title ? h('h3', { className: 'ck-card-title' }, t(title)) : null,
            children);
        }

        function details(title, open) {
          var children = Array.prototype.slice.call(arguments,2);
          return h('details', { className: 'ck-details', open: open || undefined },
            h('summary', null, t(title)),
            h('div', { className: 'ck-details-body' }, children));
        }

        function tabId(key) { return uid + '-tab-' + key; }

        function selectTab(key) {
          var node;
          studio.set({ tab: key });
          if (typeof document !== 'undefined') {
            node = document.getElementById(tabId(key));
            if (node && typeof node.focus === 'function') node.focus();
          }
        }

        function onRailKeyDown(event) {
          var at = TABS.indexOf(state.tab);
          var next = -1;
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (at + 1) % TABS.length;
          else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = TABS.length - 1;
          if (next < 0) return;
          event.preventDefault();
          selectTab(TABS[next]);
        }

        function stageBrief() {
          var project = (boot && boot.activeProjectDir) || form.projectDir || '[PROJECT_DIR]';
          var stageId = (activeStage && projectState.activeStageId) || '[STAGE]';
          var def = stages.find(function(s){return s.id === stageId;});
          var advice = def && (def['handoff' + lang] || def['summary' + lang]);
          var constraint = lang === 'Zh' ? '禁止未授权上传、扣费或改变审批。先报告真实文件和限制，等待人工处理下一步。' : 'Do not upload, charge, or approve on the user’s behalf. Report actual artifacts and stop at the checkpoint.';
          return [t('instructions'), '', 'Project: ' + project, 'Stage: ' + stageId + ' (' + stageName(stageId) + ')', advice || '', constraint].filter(Boolean).join('\n');
        }

        function insert() {
          var brief = stageBrief();
          void studio.act(async function () {
            var outcome = studio.insertInstructions(brief);
            if (outcome === 'ok') { studio.set({ notice: t('inserted') }); return null; }
            if (outcome === 'blocked') { studio.set({ notice: t('draftChanged') }); return null; }
            if (studio.copy(brief)) { studio.set({ notice: t('copied') }); return null; }
            throw new Error(t(outcome === 'no-session' || outcome === 'unsupported' ? 'noSession' : 'draftChanged'));
          });
        }

        var step = stages.find(function(s){return projectState && s.id === projectState.activeStageId;});
        var nextPage = step && step.nextTab;
        var openStage = function(stage) {
          if (stage.id === '1_concept') { studio.put('assetKind', 'image'); studio.put('slotId', 'source'); }
          if (stage.id === '2_views') { studio.put('assetKind', 'image'); studio.put('slotId', 'head_front'); }
          selectTab(stage.nextTab || 'assets');
        };
        var pipeline = [
          h('div', { className: 'ck-flow-heading', key: 'flow' },
            h('div', null, h('div',{className:'ck-eyebrow'},t('nativeLabel')), h('h2', null, t('workflowTitle')), h('p', null, t('workflowIntro'))),
            h('span', {className:'ck-chip','data-tone':'brand'}, projectState ? projectState.projectName || t('pipeline') : t('notInitialized'))),
          !projectState || projectState.activeStageId === '1_concept' ? card('projectSetup', h(React.Fragment, null,
            field('prompt', 'prompt', 'textarea'),
            h('div', { className: 'ck-grid' }, field('source', 'source'), field('allowance', 'allowance', 'number')),
            h('div', { className: 'ck-row' }, button('init', function () {
              studio.action('/studio/project/init', { characterPrompt: form.prompt, sourceImage: form.source,
                monthlyCreditAllowance: Number(form.allowance), preferredImageModel: form.model }, true);
            }, false, 'primary'), projectState ? button('assets',function(){openStage({id:'1_concept',nextTab:'assets'});}) : null))) :
            details('projectSetup', false, field('prompt','prompt','textarea'), h('div',{className:'ck-grid'},field('source','source'),field('allowance','allowance','number')),
              button('init',function(){studio.action('/studio/project/init',{characterPrompt:form.prompt,sourceImage:form.source,monthlyCreditAllowance:Number(form.allowance),preferredImageModel:form.model},true); })),
          projectState ? card(null, h(React.Fragment, null,
            h('div', { className:'ck-row ck-flow-meta' }, h('strong',null, summary.completedStages + '/' + stages.length + ' · ' + t('progress')),
              h('span', {className:'ck-muted'}, t('views') + ' ' + summary.readyViews + '/11 · ' + t('credits') + ' ' + summary.remainingFreeCredits)),
            h('progress', { className: 'ck-progress', value: summary.percent, max: 100, 'aria-label': t('progress') }),
            h('ol', { className:'ck-stage-list' }, stages.map(function (stage) {
              var record = (projectState.stages && projectState.stages[stage.id]) || { status: 'pending' };
              var current = stage.id === projectState.activeStageId;
              return h('li', { className: 'ck-stage', key: stage.id, 'data-active': current, 'aria-current': current ? 'step' : undefined },
                h('span',{className:'ck-step-no','aria-hidden':'true'},String(stage.index).padStart(2,'0')),
                h('div', { className: 'ck-stage-body' },
                  h('strong', null, stage['title' + lang] || stage.id),
                  h('p', null, stage['summary' + lang] || ''),
                  stage['artifact' + lang] ? h('p',{className:'ck-stage-artifact'},t('stageArtifact') + ' · ' + stage['artifact' + lang]) : null),
                h('div',{className:'ck-stage-actions'},h('span', { className: 'ck-pill', 'data-status': record.status || 'pending' }, t(record.status || 'pending')),
                  button(current?'openStep':'viewStep',function(){openStage(stage);},false,current?'primary':'ghost')));
            })))) : null,
          projectState ? card('checkpointTitle', h(React.Fragment, null,
            step ? h('p',{className:'ck-muted'},t('activeStage') + ' · ' + stageName(step.id)) : null,
            boot.reviewReadiness && !boot.reviewReadiness.ready ? h('div', { className: 'ck-callout', role:'status' }, boot.reviewReadiness.reason) :
              h('p',{className:'ck-muted'},t('checkpointHelp')),
            field('notes', 'notes', 'textarea'),
            h('div', { className: 'ck-row' }, ['request_review', 'approve', 'reject'].map(function (name) {
              var status = activeStage ? activeStage.status : '';
              var disabled = !activeStage || (name === 'request_review'
                ? status === 'completed' || boot.reviewReadiness && !boot.reviewReadiness.ready
                : status !== 'awaiting_review' || name === 'approve' && boot.reviewReadiness && !boot.reviewReadiness.ready);
              return button(name === 'request_review' ? 'review' : name, function () {
                studio.action('/studio/project/checkpoint', { action: name, stageId: projectState.activeStageId, notes: form.notes,
                  expectedRevision: projectState.stateRevision }, true);
              }, disabled);
            })),
            h('div', { className: 'ck-row' }, button('insert', insert, !activeStage, 'primary'),
              nextPage && nextPage !== 'assets' && (step.id === '2_views' || step.id === '3_tripo') ? button('assets',function(){selectTab('assets');}) : null),
            h('p',{className:'ck-muted'},t('draftOnly')))) : null
        ];

        var viewDefs = (boot && boot.requiredViewSlots) || [];
        var chosenSlots = form.imageScope === 'all' ? undefined : ['head', 'body', 'balance'].includes(form.imageScope)
          ? viewDefs.filter(function(v) { return v.group === form.imageScope; }).map(function(v) { return v.id; }) : [form.imageScope];
        function viewPayload() {
          return { modelId: form.model, apiModelOverride: form.apiModel, characterPrompt: form.prompt, artistTag: form.artist,
            animaVariant: form.variant, modelFiles: form.unet ? {unet: form.unet} : {}, slots: chosenSlots, referenceMode: form.referenceMode };
        }
        var preflightKey = JSON.stringify([boot && boot.activeProjectDir, projectState && projectState.stateRevision, viewPayload()]);
        var prepared = state.imagePreflight && state.imagePreflight.key === preflightKey ? state.imagePreflight.result : null;
        var imageResult = state.result;
        var cloudModel = selectedModel && selectedModel.deployment === 'cloud' && selectedModel.driver !== 'catalog';
        var catalogOnly = selectedModel && selectedModel.driver === 'catalog';
        var hasOriginal = Boolean(projectState && projectState.characterSpec && projectState.characterSpec.sourceImages && projectState.characterSpec.sourceImages.length);
        var modelsTab = [
          h('p', { className: 'ck-muted', key:'snapshot' }, t('snapshot')),
          select('model', 'model', models.map(function (model) { return [model.id, model.name]; })),
          selectedModel ? card(selectedModel.name, h(React.Fragment, null,
            h('div',{className:'ck-model-stats'},h('span',{className:'ck-pill','data-status':catalogOnly?'pending':'in_progress'},selectedModel['adapter' + lang] || selectedModel.deployment),
              h('span',{className:'ck-chip'},t(selectedModel.weights || 'unknown')), h('span',{className:'ck-chip'},'T2I ' + (selectedModel.aaT2iRank ? '#' + selectedModel.aaT2iRank + ' · ' : '') + (selectedModel.aaT2iElo || '—')),
              h('span',{className:'ck-chip'},'Edit ' + (selectedModel.aaEditRank ? '#' + selectedModel.aaEditRank + ' · ' : '') + (selectedModel.aaEditElo || '—'))),
            h('p', null, selectedModel['endpoint' + lang] || ''),
            h('p', { className: 'ck-muted' }, (selectedModel['stage'+lang] ? t('suggestedStage') + ' · ' + selectedModel['stage'+lang] : '')),
            h('p', { className: 'ck-muted' }, selectedModel.licenseNotice || ''),
            h('ul', { className:'ck-tips' }, (selectedModel['promptTips' + lang] || []).map(function (tip, i) { return h('li', { key: i }, tip); })),
            selectedModel.apiIdExample ? h('p', {className:'ck-muted'},t('idExample') + ' ',h('code',null,selectedModel.apiIdExample),' · ' + (selectedModel.apiIdEvidence === 'Official documentation' ? t('officialDoc') : t('experimentalDoc'))) : null,
            selectedModel.sourceUrl ? h('a',{href:selectedModel.sourceUrl,target:'_blank',rel:'noopener noreferrer'},t('modelDocs')) : null)) : null,
          card('imageSettings',h(React.Fragment,null,
            field('prompt','prompt','textarea'),
            h('div', {className:'ck-grid'},
              select('imageScope','imageScope',[['all',t('allViews')],['head',t('head')],['body',t('body')],['balance',t('balance')]].concat(viewDefs.map(function(v){ return [v.id, v['label'+lang] || v.id]; }))),
              select('referenceMode','referenceMode',[['project',t('projectRef')],['text_only',t('textOnly')]]),
              cloudModel ? field('apiModel', 'apiModel') : null,
              selectedModel && selectedModel.driver === 'comfyui_anima' ? select('variant', 'variant', ['base', 'aesthetic', 'turbo'].map(function (value) { return [value, value]; })) : null,
              selectedModel && selectedModel.driver === 'comfyui_anima' ? field('unet', 'unet') : null,
              selectedModel && selectedModel.driver === 'comfyui_anima' ? field('artist', 'artist') : null),
            h('p',{className:'ck-muted'},form.referenceMode === 'text_only' ? t('textOnlyHelp') : hasOriginal ? t('referenceIsSet') : t('referenceEmpty')),
            h('p', { className:'ck-muted' }, cloudModel && boot && boot.imageSetup && !boot.imageSetup.cloudEnabled ? t('cloudOff') : t('cloudHint')),
            h('div',{className:'ck-row'},
              button('preflight', function () {
                studio.act(async function(){var result = await studio.request('/studio/views/preflight', Object.assign({projectDir:form.projectDir,mode:'execute'}, viewPayload()));
                  studio.set({imagePreflight:{key:preflightKey,result:result}}); return result;});
              }, !projectState),
              button('compile', function () { studio.action('/studio/prompts/compile', Object.assign(viewPayload(),{useProjectReference: hasOriginal && form.referenceMode === 'project'})); }),
              button('export', function () { studio.action('/studio/views/generate', Object.assign(viewPayload(),{mode:'plan_and_export_workflows'})); },!projectState),
              button('execute', function () {
                if (cloudModel && !window.confirm(selectedModel.name + ' / ' + form.apiModel.trim() + ' · ' + chosenSlots[0] + '\n\n' + t(hasOriginal && form.referenceMode === 'project' ? 'cloudConfirmRef' : 'cloudConfirmText'))) return;
                var requestId = form.imageRequestId || crypto.randomUUID();
                if (!form.imageRequestId) studio.put('imageRequestId',requestId);
                studio.action('/studio/views/generate',Object.assign(viewPayload(),{ mode:'execute', requestId:requestId, expectedRevision:projectState.stateRevision, cloudConfirmed:!!cloudModel }),true);
              },!projectState || !selectedModel || catalogOnly || prepared && !prepared.allowed || cloudModel && (!chosenSlots || chosenSlots.length !== 1 || !form.apiModel.trim() || boot && boot.imageSetup && !boot.imageSetup.cloudEnabled),'primary')),
            prepared ? h('div',{className:'ck-callout',role:'status','data-ready':prepared.allowed},prepared.allowed ? t('preflightReady') : h('ul',null,(prepared.reasons || []).map(function(r,i){return h('li',{key:i},r);}))) : null,
            !catalogOnly && form.imageRequestId ? h('div',{className:'ck-row'},h('span',{className:'ck-muted'},t('imageRequest') + ' ',h('code',null,form.imageRequestId)),
              button('resetImageRequest',function(){if(window.confirm(t('resetImageConfirm')))studio.put('imageRequestId','');})) : null)),
          imageResult && imageResult.mode === 'plan_and_export_workflows' ? card('exportedPlan',h(React.Fragment,null,
            imageResult.referencePlan==='reference_requested_not_bound'?h('p',{className:'ck-callout'},t('unboundReference')):null,
            h('ul',{className:'ck-paths'},(imageResult.exportedArtifacts || []).map(function(p){return h('li',{key:p},h('code',null,p));})))) : null,
          imageResult && imageResult.mode === 'execute' ? card('imageReceipt',h(React.Fragment,null,
            h('ul',{className:'ck-paths'},(imageResult.results || []).map(function(r){return h('li',{key:r.slotId},r.slotId + ' · ' + (r.ok ? t(r.selected?'imageSelected':'imageCandidate') : r.error)+(r.providerPromptId ? ' · ComfyUI '+r.providerPromptId : ''));})),
            button('assets',function(){selectTab('assets');}))) : null,
          imageResult && imageResult.pack ? card('compiledPrompts',h('div',{className:'ck-view-grid'},imageResult.pack.views.map(function(v){return h('div',{className:'ck-view-card',key:v.slotId},h('strong',null,v[lang==='Zh'?'labelZh':'slotId']),h('p',null,v.resolution),h('p',null,v.positivePrompt),v.negativePrompt?h('p',{className:'ck-muted'},'− '+v.negativePrompt):null);}))) : null,
        ];

        var tripoResult = projectState && state.result && state.result.estimateOnly && state.result.projectDir === boot.activeProjectDir ? state.result : null;
        var tripoPlan = tripoResult && tripoResult.studioWebPlaybook;
        var tripoTab = [
          card('跨工程账户账本（手工核对，非供应商余额）',h(React.Fragment,null,
            h('p',{className:'ck-muted'},'Studio 与 API 使用不同账号别名。账本不能阻止你在外部网页消费；网络超时不自动视为零扣费。'),
            h('div',{className:'ck-grid'},field('accountAlias','账户别名（不要填密钥）'),field('accountLimit','本月已核对可用预算','number'),select('accountChannel','计费渠道',[['tripo_studio','Tripo Studio'],['tripo_api','Tripo API'],['image_api','图像 API']])),
            h('div',{className:'ck-row'},button('登记本月限额',function(){studio.action('/studio/budget',{action:'configure',accountId:form.accountAlias,channel:form.accountChannel,period:new Date().toISOString().slice(0,7),limit:Number(form.accountLimit),unit:'credits'});},!form.accountAlias),button('查询账户账本',function(){studio.action('/studio/budget',{action:'status',accountId:form.accountAlias});},!form.accountAlias)))),
          h('p', { className: 'ck-muted' }, t('tripoHint')),
          select('strategy', 'strategy', ((boot && boot.tripoStrategies) || []).map(function (strategy) {
            return [strategy.id, strategy['title' + lang] || strategy.id];
          })),
          h('div', { className: 'ck-grid' }, field('estimate', 'estimate', 'number')),
          h('div', { className: 'ck-row' }, button('plan', function () {
            studio.action('/studio/tripo/plan', {
              strategyId: form.strategy,
              estimatedCredits: form.estimate === '' ? undefined : Number(form.estimate)
            });
          }, !projectState)),
          tripoResult ? card('tripoReceipt',h(React.Fragment,null,
            h('p',{className:'ck-muted'},tripoResult.quotaSummary.separateApiBalance ? t('tripoSeparate') : t('tripoEstimateLine') + ' ' + tripoResult.strategy.totalEstimatedCredits + ' / ' + tripoResult.quotaSummary.remainingCredits),
            tripoPlan && (tripoPlan.viewsApproved ? h(React.Fragment,null,h('p',null,t('tripoApprovedInputs')),
              tripoPlan.stages.map(function(part){return h('div',{key:part.part},h('strong',null,t(part.part)),h('ul',{className:'ck-paths'},part.inputFiles.map(function(file,i){return h('li',{key:part.part+':'+i},h('code',null,file));})));}))
              : h('p',{className:'ck-muted'},t('tripoWaitInputs') + ' ' + tripoPlan.blockedReason)))) : null,
          card(null, h(React.Fragment, null,
            h('div', { className: 'ck-grid' },
              select('part', 'part', ['head', 'body', 'accessory'].map(function (part) { return [part, t(part)]; })),
              field('spent', 'spent', 'number')),
            field('glb', 'glb'),
            field('task', 'task'),
            h('div', { className: 'ck-row' }, button('archive', function () {
              studio.action('/studio/tripo/archive', {
                part: form.part, sourceGlbPath: form.glb, remoteTaskId: form.task, creditsSpent: Number(form.spent)
              }, true);
            }, !projectState || !form.glb))))
        ];

        var blenderTab = [
          h('div',{className:'ck-row',key:'editor'},button('useBlender',function(){selectTab('editor');})),
          h('p', { className: 'ck-muted' }, t('blenderHint')),
          h('div', { className: 'ck-row' }, button('probe', function () {
            studio.act(function () { return studio.refresh(false); });
          })),
          h('div', { className: 'ck-grid' },
            select('operation', 'operation', ['stage1_safe_import', 'stage2_assembly_ratio', 'stage3_rig_weights',
              'stage4_skirt_springs', 'stage5_expressions_vrm'].map(function (value, i) { return [value, t('stage' + (i + 1))]; })),
            select('target', 'target', [['headless', 'Headless'], ['gui_act', 'GUI']])),
          field('blend', 'blend'),
          h('div', { className: 'ck-grid' }, field('headGlb', 'headGlb'), field('bodyGlb', 'bodyGlb')),
          h('div', { className: 'ck-row' }, ['scripts', 'run'].map(function (key) {
            return button(key, function () {
              studio.action('/studio/blender/stage', {
                operation: form.operation, executeViaPlugin: key === 'run', executionTarget: form.target,
                params: {
                  inputBlendPath: form.blend || undefined,
                  headGlbPath: form.headGlb || undefined,
                  bodyGlbPath: form.bodyGlb || undefined
                }
              }, true);
            }, !projectState);
          }))
        ];

        var credentialsTab = [
          h('p', { className: 'ck-muted' }, t('keyHint')),
          card(null, h(React.Fragment, null,
            ((boot && boot.credentials) || []).map(function (credential) {
              return h('div', { key: credential.id, className: 'ck-muted' },
                credential.id + ': ' + t(credential.configured ? 'configured' : 'missing') + ' (' + credential.source + ')');
            }),
            h('div', { className: 'ck-grid' },
              select('provider', 'provider', ['novelai', 'openai', 'ark', 'gemini', 'openai_compat', 'tripo'].map(function (value) { return [value, value]; })),
              field('secret', 'secret', 'password')),
            h('div', { className: 'ck-row' }, ['saveKey', 'clearKey'].map(function (key) {
              return button(key, function () {
                studio.act(async function () {
                  var value = form.secret;
                  studio.put('secret', '');
                  var data = await studio.request('/studio/credentials/update', {
                    action: key === 'saveKey' ? 'set' : 'clear',
                    providerId: form.provider,
                    secret: key === 'saveKey' ? value : undefined
                  });
                  await studio.refresh(false);
                  return data;
                });
              }, key === 'saveKey' && !form.secret);
            }))))
        ];

        function assetUrl(asset) {
          return loopback(form.base) + '/studio/assets/content?projectDir=' + encodeURIComponent(form.projectDir || boot.activeProjectDir) + '&id=' + encodeURIComponent(asset.id) + '&access=' + encodeURIComponent(boot.sessionToken || '');
        }
        var assetItems = projectState && projectState.assets && projectState.assets.items || [];
        var chosenPreview = assetItems.find(function(a){return a.id === form.previewId;});
        function chosenViewTile(slot) {
          var current = projectState && projectState.views && projectState.views[slot.id];
          var asset = current && assetItems.find(function(a){return a.id === current.assetId;});
          return h('div',{className:'ck-view-card',key:slot.id},h('strong',null,slot['label'+lang] || slot.id),
            asset ? h('button',{type:'button',className:'ck-btn',onClick:function(){studio.put('previewId',asset.id);}},
              h('img',{src:assetUrl(asset),alt:asset.label,loading:'lazy',referrerPolicy:'no-referrer'})) : h('p',{className:'ck-muted'},t('missingView')),
            asset && current.status!=='ready' ? h('p',{className:'ck-muted'},lang==='Zh'?'原画或设定变化，请重新选择或补图。':'Reference or brief changed; reselect or make a replacement.') : null,
            button('redoView',function(){studio.put('imageScope',slot.id);selectTab('models');}));
        }
        var assetTab = [
          projectState && viewDefs.length ? card('viewReview',h(React.Fragment,null,
            h('p',{className:'ck-muted'},t('viewReviewHelp')),
            select('compareAngle','chooseAngle',[['front',t('front')],['left',t('left')],['right',t('right')],['back',t('backView')]]),
            h('div',{className:'ck-view-grid'},viewDefs.filter(function(v){return v.group!=='balance'&&v.angle===form.compareAngle;}).map(chosenViewTile)),
            h('p',{className:'ck-muted'},t('balanceReview')),
            h('div',{className:'ck-view-grid'},viewDefs.filter(function(v){return v.group==='balance';}).map(chosenViewTile)))) : null,
          h('p', {className:'ck-muted'}, '原画与 11 个视图槽分别登记。GLB 几何预览不等于纹理、骨骼或 VRM 验收。'),
          h('div', {className:'ck-grid'}, select('assetKind','assetKind',[['image','PNG'],['glb','GLB']]),
            form.assetKind === 'image' ? select('slotId','slotId', [['source',t('sourceSlot')]].concat(((boot && boot.requiredViewSlots) || []).map(function(v){return [v.id,v.labelZh || v.id];}))) : select('part','part',[['head',t('head')],['body',t('body')],['accessory',t('accessory')]]), field('sourcePath','sourcePath')),
          h('div', {className:'ck-row'}, button('importAsset',function(){studio.action('/studio/assets/import',{kind:form.assetKind,slotId:form.slotId,part:form.part,sourcePath:form.sourcePath,expectedRevision:projectState.stateRevision},true);}, !projectState),
            button('scanViews',function(){studio.action('/studio/assets/scan',{},true);},!projectState)),
          h('label',{className:'ck-field'},h('span',null,'或选择文件上传（≤20 MiB；大型 GLB 使用路径导入）'),h('input',{type:'file',accept:form.assetKind==='image'?'.png':'.glb',disabled:busy||!projectState,onChange:function(event){
            var file=event.target.files[0];if(!file)return;
            studio.act(async function(){if(file.size>20*1024*1024)throw new Error('文件大于20 MiB，请用本地路径导入');var b64=await new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=reject;reader.onload=function(){resolve(String(reader.result).split(',')[1]);};reader.readAsDataURL(file);});var result=await studio.request('/studio/assets/import',{projectDir:form.projectDir,kind:form.assetKind,slotId:form.slotId,part:form.part,dataBase64:b64,label:file.name,expectedRevision:projectState.stateRevision});if(result.asset&&result.asset.slotId==='source')studio.syncOriginal(result);await studio.refresh(false);return result;});event.target.value='';
          }})),
          chosenPreview ? (chosenPreview.kind === 'glb' ? h(GeometryPreview,{key:chosenPreview.id,url:assetUrl(chosenPreview)})
            : h('img',{className:'ck-asset-focus',src:assetUrl(chosenPreview),alt:chosenPreview.label,referrerPolicy:'no-referrer'})) : null,
          h('div',{className:'ck-grid'}, assetItems.slice().reverse().map(function(asset){
            var selected = asset.kind==='image' && asset.slotId!=='source'
              ? projectState.views[asset.slotId] && projectState.views[asset.slotId].status==='ready' && projectState.views[asset.slotId].assetId===asset.id
              : projectState.assets.selected[asset.slotId || asset.part]===asset.id;
            return h('section',{className:'ck-card',key:asset.id},h('strong',null,(asset.slotId==='source'?t('sourceSlot'):asset.slotId||asset.part)+' · '+(selected?'已采用':'候选')),
              asset.kind==='image'?h('button',{type:'button',className:'ck-btn',onClick:function(){studio.put('previewId',asset.id);}},h('img',{src:assetUrl(asset),alt:asset.label,loading:'lazy',referrerPolicy:'no-referrer',style:{width:'100%',height:180,objectFit:'contain',background:'#18212c',borderRadius:6}})):h('button',{className:'ck-btn',onClick:function(){studio.put('previewId',asset.id);}},'预览 GLB 几何'),
              h('p',{className:'ck-muted'},asset.label+' · '+Math.round(asset.bytes/1024)+' KiB · '+asset.sha256.slice(0,12)),
              button('selectAsset',function(){studio.action('/studio/assets/select',{assetId:asset.id,expectedRevision:projectState.stateRevision},true);},selected||asset.kind==='glb'&&!asset.renderable));
          }))
        ];
        var editorState=projectState&&projectState.editor;
        var blenderCheckpoint=projectState&&projectState.blenderState&&projectState.blenderState.activeBlendFile;
        var editRevision=editorState&&editorState.revisions.find(function(r){return r.id===editorState.activeRevisionId;});
        var overlayAsset=assetItems.find(function(a){return a.id===form.overlayId;});
        function editorUrl(kind){return loopback(form.base)+'/studio/editor/content?projectDir='+encodeURIComponent(form.projectDir||boot.activeProjectDir)+'&revisionId='+editRevision.id+'&kind='+kind+'&access='+encodeURIComponent(boot.sessionToken||'');}
        function editorRun(operation){studio.act(async function(){var params=operation==='import_checkpoint'?{}:JSON.parse(form.editorParams||'{}');if(operation==='import_blend')params.sourceBlend=form.sourceBlend;if(form.vrmAddonPath)params.vrmAddonPath=form.vrmAddonPath;if(form.selectedObject&&!params.objects&&operation==='transform')params.objects=[form.selectedObject];var result=await studio.request('/studio/editor/run',{projectDir:form.projectDir,operation:operation,params:params,expectedRevisionId:editorState&&editorState.activeRevisionId||null});await studio.refresh(false);return result;});}
        var requestStatus = {requested:'aiRequested',ready_for_review:'aiReady',approved:'aiApproved',rejected:'aiRejected'};
        var aiHistory = ((editorState && editorState.requests) || []).slice(-8).reverse().map(function(item) {
          var canReview = !!editRevision && item.status==='ready_for_review' && item.resultRevisionId===editRevision.id;
          function review(decision) {
            studio.action('/studio/editor/ai-review',{requestId:item.id,revisionId:editRevision.id,decision:decision},true);
          }
          return h('section',{className:'ck-card',key:item.id},
            h('strong',null,t(requestStatus[item.status] || 'aiRequested')+' · '+item.id.slice(0,8)),
            h('p',{className:'ck-muted'},item.prompt),
            item.status==='requested' && editRevision && item.baseRevisionId===editRevision.id
              ? button('aiDraft',function(){studio.handoffAiEdit('/studio/editor/ai-handoff',{requestId:item.id},false);},!!editorState.pendingJob) : null,
            canReview ? h('div',{className:'ck-row'},
              button('aiAccept',function(){review('approve');},!!editorState.pendingJob),
              button('aiReject',function(){review('reject');},!!editorState.pendingJob)) : null);
        });
        var editorTab=[
          h('div',{className:'ck-row',key:'prep'},button('prepBlender',function(){selectTab('blender');})),
          h('p',{className:'ck-muted'},'可读取已有 Blend，也可接力本工程通过伴随插件生成的 Blender 检查点。源文件只读，所有工序另存不可变版本；结构检查不代替视觉审批。'),
          h('div',{className:'ck-grid'},field('sourceBlend','sourceBlend'),field('vrmAddonPath','vrmAddonPath')),
          h('div',{className:'ck-row'},button('editorImport',function(){editorRun('import_blend');},!form.sourceBlend||!form.projectDir||!!(editorState&&editorState.pendingJob)),button('checkpointImport',function(){editorRun('import_checkpoint');},!blenderCheckpoint||!!(editorState&&editorState.pendingJob)),button('collectEditor',function(){studio.action('/studio/editor/collect',{},true);},!editorState||!editorState.pendingJob),button('取消编辑作业',function(){studio.action('/studio/editor/cancel',{},true);},!editorState||!editorState.pendingJob)),
          editRevision?h(React.Fragment,null,
            h('div',{className:'ck-grid'},select('editorCamera','camera',[['front','+Z / 正面'],['back','−Z / 背面'],['left','−X / 左面'],['right','+X / 右面'],['perspective','透视']]),select('overlayId','overlay',[['','不叠加']].concat(assetItems.filter(function(a){return a.kind==='image';}).map(function(a){return [a.id,a.label||a.slotId];}))),field('overlayOpacity','overlayOpacity','number')),
            h('div',{className:'ck-row'},button('saveView',function(){studio.action('/studio/editor/view',{camera:form.editorCamera,overlayAssetId:form.overlayId||null,overlayOpacity:Number(form.overlayOpacity)},true);}),h('label',null,h('input',{type:'checkbox',checked:!!form.playMotion,onChange:function(e){studio.put('playMotion',e.target.checked);}}),'VRM 步行动作探针')),
            h(GeometryPreview,{key:editRevision.id,url:editorUrl(editRevision.artifacts.vrm?'vrm':'preview'),camera:form.editorCamera,overlayUrl:overlayAsset?assetUrl(overlayAsset):null,opacity:Number(form.overlayOpacity),playMotion:form.playMotion,onSelect:function(name){studio.put('selectedObject',name);}}),
            h('p',{className:'ck-muted'},'当前版本 '+editRevision.id.slice(0,8)+' · 已选对象 '+(form.selectedObject||'无')+' · '+editRevision.operation),
            select('editorOperation','editorOperation',['audit','head_scale','transform','materials','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','export_vrm'].map(function(op){return [op,op];})),field('editorParams','editorParams','textarea'),
            h('div',{className:'ck-row'},button('editorRun',function(){editorRun(form.editorOperation);},!!editorState.pendingJob),button('editorUndo',function(){studio.action('/studio/editor/rollback',{revisionId:editRevision.parentId,expectedRevisionId:editRevision.id},true);},!editRevision.parentId||!!editorState.pendingJob)),
            field('aiPrompt','aiPrompt','textarea'),
            button('aiDraft',function(){studio.handoffAiEdit('/studio/editor/ai-request',{prompt:form.aiPrompt,
              objects:form.selectedObject?[form.selectedObject]:[],camera:form.editorCamera,expectedRevisionId:editRevision.id},true);},
              !form.aiPrompt.trim()||!!editorState.pendingJob),
            h('p',{className:'ck-muted'},t('aiReviewHint')), aiHistory,
            details('result',false,h('pre',{className:'ck-pre'},JSON.stringify({gates:editRevision.audit.gates,notes:editRevision.audit.notes,revisions:editorState.revisions.map(function(r){return {id:r.id,operation:r.operation,parentId:r.parentId};})},null,2)))
          ):null
        ];
        var bodies = { editor: editorTab, assets: assetTab, pipeline: pipeline, models: modelsTab, tripo: tripoTab, blender: blenderTab, credentials: credentialsTab };
        var statusChip = busy ? h('span', { className: 'ck-chip', 'data-tone': 'brand' }, t('busy'))
          : state.error ? h('span', { className: 'ck-chip', 'data-tone': 'error', role: 'alert' }, state.error)
            : state.notice ? h('span', { className: 'ck-chip', 'data-tone': 'ok', role: 'status' }, state.notice)
              : h('span', { className: 'ck-chip' }, boot ? t('idle') : t('offline'));

        var heading = h('div', { className: 'ck-heading' },
          h('h1', { className: 'ck-title' }, t('title')),
          h('p', { className: 'ck-sub' }, t('subtitle')));

        var toolbar = h('div', { className: 'ck-actions' },
          button('refresh', function () { studio.act(function () { return studio.refresh(true); }); }),
          button('back', function () { studio.back(); }, false, 'ghost'));

        var strip = h('div', { className: 'ck-strip' },
          h('span', { className: 'ck-chip' }, form.base.replace(/^https?:\/\//, '')),
          boot ? h('span', { className: 'ck-chip' }, boot.activeProjectDir || '—') : null,
          activeStage ? h('span', { className: 'ck-chip', 'data-tone': 'brand' }, t('activeStage') + ': ' + stageName(projectState.activeStageId)) : null,
          statusChip);

        var rail = h('nav', {
          className: 'ck-rail', role: 'tablist', 'aria-label': t('rail'), 'aria-orientation': 'vertical', onKeyDown: onRailKeyDown
        }, TABS.map(function (key) {
          return h('button', {
            key: key, id: tabId(key), type: 'button', className: 'ck-tab', role: 'tab',
            'aria-selected': state.tab === key, 'aria-controls': uid + '-panel', tabIndex: state.tab === key ? 0 : -1,
            onClick: function () { selectTab(key); }
          }, h('span', { className: 'ck-dot', 'aria-hidden': 'true' }), t(key));
        }));

        var settingsDrawer = details('settings', !boot,
          h('div', { className: 'ck-grid' }, field('base', 'backend'), field('projectDir', 'project')),
          h('p', { className: 'ck-muted' }, t('settingsHint')),
          button('openProject',function(){studio.action('/studio/project/open',{},true);}),
          h('div',{className:'ck-row'},((boot && boot.recentProjects)||[]).map(function(p){return h('button',{className:'ck-btn',key:p.projectDir,onClick:function(){studio.put('projectDir',p.projectDir);studio.act(function(){return studio.refresh(true);});}},p.projectName||p.projectDir);})));

        var resultDrawer = details('result', false,
          h('pre', { className: 'ck-pre' }, state.result ? JSON.stringify(state.result, null, 2) : t('noResult')));

        var waiting = !boot && !state.error
          ? h('div', { className: 'ck-empty' }, h('span', { className: 'ck-muted' }, t('loading')))
          : null;

        var failure = !boot && state.error
          ? h('div', { className: 'ck-empty' },
            button('retry', function () { studio.act(function () { return studio.refresh(true); }); }, false, 'primary'))
          : null;

        // Project creation and connection fields remain available while bootstrapping.
        var showBody = Boolean(boot) || state.tab === 'pipeline';

        var content = h('div', {
          className: 'ck-content', id: uid + '-panel', role: 'tabpanel', 'aria-labelledby': tabId(state.tab), tabIndex: 0
        }, settingsDrawer, waiting, failure, showBody ? bodies[state.tab] || null : null, resultDrawer);

        var body = h('div', { className: 'ck-body' }, rail, content);

        return h('div', { className: 'ck-page', 'data-studio-panel': PANEL_ID },
          h('style', null, css),
          h('header', { className: 'ck-head' }, heading, toolbar),
          strip,
          body);
      };
    }

    return {
      name: 'dsh-charakuru-studio-client',
      // The web client realm only accepts the array form of `inject`. The object form
      // ({required, optional}) is silently rejected there: the entry stays inactive, so
      // `apply` never runs and the sidebar row never registers (verified live in 0.2.2-rc.3).
      // Every other service is therefore resolved lazily through ctx.get(...) inside the
      // store, which tolerates a missing service instead of blocking activation.
      inject: ['slots', 'locale'],
      apply: function (ctx, config) {
        ctx.effect(function () {
          var disposeDict = ctx.locale.register(NS, dict);
          var studio = createStudio(ctx, config || {});
          var Panel = makePanel(ctx, studio);
          var disposers = [
            ctx.slots.inject('sidebar.panellist', function () {
              return ctx.slots.register({
                name: 'sidebar.panellist', id: PANEL_ID, order: SIDEBAR_ORDER, locale: NS,
                label: function () { return studio.t('panel'); }
              }, StudioIcon);
            }),
            ctx.slots.inject('main', function () {
              return ctx.slots.register({
                name: 'main', key: PANEL_ID, locale: NS,
                inject: function () { return { studio: studio }; }
              }, Panel);
            })
          ];
          return function () {
            for (var i = 0; i < disposers.length; i += 1) disposers[i]();
            studio.dispose();
            disposeDict();
          };
        }, 'dsh-charakuru-studio: sidebar workbench panel');
      }
    };
  }
});
