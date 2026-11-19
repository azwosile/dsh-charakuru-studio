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
    var TABS = ['pipeline', 'assets', 'editor', 'render', 'materials', 'models', 'tripo', 'blender', 'credentials'];
    var CLIENT_VERSION = '0.7.0';
    var TIMEOUT_FAST = 15000;
    var TIMEOUT_SLOW = 300000;

    var dict = {
      en: {
        materials: "External materials",
        intakeKicker: "MATERIAL INTAKE / PROJECT LOCAL",
        materialWorkflow: "Choose a step and register its inputs. Registration, adoption and execution are separate.",
        materialDesktop: "DSH Desktop · local files",
        materialWeb: "Local Web · file upload",
        materialStage: "Material step",
        materialRole: "Material role",
        materialRegister: "Register external material",
        materialInbox: "Materials at this step",
        materialDrop: "Drop one external file here",
        materialChooseFile: "Choose a file",
        materialLocalPath: "Import from a local path",
        materialPathLabel: "Absolute path on this computer",
        materialCopyOnly: "A fingerprinted copy stays in this project. Source files and review state do not change on import.",
        materialInvalid: "Wrong type, empty file or size over limit. Expected:",
        materialSingle: "Choose a single file. Change the role or slot before importing another one.",
        materialEmpty: "No materials registered here",
        materialEmptyHint: "Upload a file or enter a local path. Preview and adoption become available after it is registered.",
        materialRegistered: "Registered · not adopted",
        materialDuplicate: "Already registered for this role. No new version was created.",
        materialInUse: "In use",
        materialInRevision: "Used in an editor revision",
        materialAwaitingEdit: "Registered · not applied in Blender",
        materialReferenceOnly: "Preview material · not a deliverable",
        materialAdopt: "Adopt for this step",
        materialAdopted: "Input adopted. Review checkpoints are still separate.",
        materialOverlay: "Use as overlay",
        materialOverlayReady: "Editor overlay prepared. Open a revision to see it.",
        materialToEditor: "Open in Blender editor",
        materialPreview: "Preview locally",
        materialReview: "Material preview",
        materialClosePreview: "Close preview",
        materialExternalVrm: "External VRM · not a project export",
        materialMotion: "VRMA to play",
        materialNoMotion: "No external motion",
        materialPlayReference: "Use for motion preview",
        materialMotionChosen: "Motion selected for the preview. It has not changed the model.",
        materialMotionNeedsVrm: "Select a VRM 1.0 model to play this motion, or open an exported VRM revision in the editor.",
        materialNoProject: "Choose and initialize a project before importing files.",
        materialUpgradeRequired: "This Host has no stage material endpoints. Load the 0.7.0 Host and verify the workbench port.",
        materialSelected: "Registered editor input",
        materialTarget: "Mesh object with UVs",
        materialTextureSlot: "Material slot (0-based)",
        materialExecute: "Create revision from this material",
        materialNoSelection: "Choose a registered Blend, GLB or texture",
        materialExecHint: "Blend opens a separate revision; mesh appends; texture changes the explicit material slot only. Inspect the result before continuing.",
        materialNeedBase: "Open a Blender scene before applying this file.",
        materialTrustBlend: "Only open a trusted, packed Blend. This saves a separate revision but does not make an untrusted Blender file safe. Continue?",
        materialInclude: "Import at this step",
        pickProjectFolder: "Choose project folder",
        browseLocalFolders: "Browse local folders",
        folderUp: "Parent folder",
        useThisFolder: "Use this folder",
        closeBrowser: "Close browser",
        newSubfolder: "New subfolder name",
        createSubfolder: "Create subfolder",
        projectDetected: "Avatar Studio project detected",
        noSubfolders: "No visible subdirectories here.",
        copyFailed: "Clipboard unavailable; expand manual copy below.",
        workspaceNav: "Primary workspaces",
        wsWorkbench: "1. Workbench",
        wsRender: "2. Render Lab",
        wsLibrary: "3. Assets & Materials",
        wsSettings: "⚙ Global Settings",
        settingsModules: "Global settings modules",
        techDetails: "Technical details",
        tripoLedgerTitle: "Cross-project account ledger (manual verification, not provider balance)",
        tripoLedgerHint: "Studio and API use separate account aliases. The ledger cannot block external browser spending; network timeouts do not imply zero charge.",
        accountAlias: "Account alias (never enter API key)",
        accountLimit: "Verified monthly available budget",
        accountChannel: "Billing channel",
        imageApi: "Image API",
        recordMonthlyLimit: "Save monthly limit",
        queryAccountLedger: "Query account ledger",
        tripoOpenApiTitle: "Tripo OpenAPI v3 (direct API channel)",
        tripoOpenApiHint: "Check independent OpenAPI v3 balance or poll existing task receipts. Paid submissions require cloud execution enabled and explicit confirmation.",
        queryTripoBalance: "Check OpenAPI v3 balance",
        pollTripoTask: "Poll & collect task",
        blenderDualChannelTitle: "Blender dual-channel (dsh-blender-plugin + Computer-Use GUI)",
        draftBlenderStage: "Draft this stage for DSH",
        adoptedBadge: "Adopted",
        candidateBadge: "Candidate",
        previewGlb: "Preview GLB geometry",
        editorIntro: "Load an existing Blend or continue from a companion Blender checkpoint in this project. Source files stay read-only and every operation saves an immutable revision; structural checks do not replace visual review.",
        cancelEditor: "Cancel editor job",
        camFront: "+Z / Front",
        camBack: "−Z / Back",
        camLeft: "−X / Left",
        camRight: "+X / Right",
        camPersp: "Perspective",
        noOverlay: "No overlay",
        vrmWalkProbe: "VRM walk motion probe",
        currentRevision: "Current revision",
        selectedObj: "Selected object",
        noneObj: "None",
        clothing: "Clothing",
        hair: "Hair",
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
        hostVersionMismatch: 'Host version does not match this workbench. Check the local port, then load the project again.',
        settingsHint: 'The Studio API is the loopback host this plugin starts on the machine running DeepSeek Harness. Change the port only when you moved it.',
        pipeline: 'Workbench', render: 'Render studio', models: 'Models & views', tripo: 'Tripo budget', blender: 'Blender', credentials: 'Credentials',
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
        status: 'Status', result: 'Technical details & latest result', noResult: 'Results and generated paths appear here.', views: 'Ready views', credits: 'Remaining budget',
        stage1: 'Import parts', stage2: 'Assemble ratio draft', stage3: 'Gaussian rig draft', stage4: 'Skirt bone draft', stage5: 'Morphs & VRM export attempt',
        in_progress: 'In progress', pending: 'Pending', awaiting_review: 'Awaiting review', completed: 'Completed',
        balance: 'Full body', settings: 'Global settings & connection', instructions: 'Work in this character project. Read the bundled charakuru-vrm-studio skill and use companion catalog/audit/gate operations. Check the current stage, report actual artifacts and request review after the work. Never infer asset validation from process success.'
      },
      zh: {
        materials: "外部素材",
        intakeKicker: "MATERIAL INTAKE / 工程内素材",
        materialWorkflow: "先选择工序，再登记相应文件。登记、采用与执行是三件事。",
        materialDesktop: "DSH 桌面 · 本机文件",
        materialWeb: "同机网页 · 文件上传",
        materialStage: "素材所属工序",
        materialRole: "素材用途",
        materialRegister: "登记外部素材",
        materialInbox: "这一工序的素材",
        materialDrop: "拖放一个外部文件至此",
        materialChooseFile: "选择文件",
        materialLocalPath: "从本机路径导入",
        materialPathLabel: "本机磁盘绝对路径",
        materialCopyOnly: "素材指纹副本留在本工程。单纯导入不修改原文件或审批状态。",
        materialInvalid: "类型不符、空文件或超过限制。需要：",
        materialSingle: "一次登记一个文件。更改用途或槽位后再导入下一件。",
        materialEmpty: "还没有登记素材",
        materialEmptyHint: "选择文件、拖放或填写本机路径。登记后可预览，之后再决定是否采用。",
        materialRegistered: "已登记 · 待采用",
        materialDuplicate: "此用途已登记相同文件，未重复创建版本。",
        materialInUse: "正在使用",
        materialInRevision: "已有使用此素材的编辑修订",
        materialAwaitingEdit: "已登记 · 未在 Blender 应用",
        materialReferenceOnly: "预览素材 · 非交付产物",
        materialAdopt: "采用为本步输入",
        materialAdopted: "已采用输入。工序仍需独立审阅。",
        materialOverlay: "设为参考叠图",
        materialOverlayReady: "已准备参考叠图，打开编辑修订后可查看。",
        materialToEditor: "带到 Blender 编辑器",
        materialPreview: "本机预览",
        materialReview: "外部素材预览",
        materialClosePreview: "关闭预览",
        materialExternalVrm: "外部 VRM · 非本项目导出",
        materialMotion: "预览用 VRMA 动作",
        materialNoMotion: "不播放外部动作",
        materialPlayReference: "设为预览动作",
        materialMotionChosen: "已选择预览动作，没有改动模型。",
        materialMotionNeedsVrm: "先选一个 VRM 1.0，或在编辑器打开已导出 VRM 的修订，再播放此动作。",
        materialNoProject: "请先选择工程目录并初始化，再登记素材。",
        materialUpgradeRequired: "当前 Host 没有素材接口。请启用 0.7.0 并核对工作台连接端口。",
        materialSelected: "已登记的编辑输入",
        materialTarget: "有 UV 的网格对象",
        materialTextureSlot: "材质槽（从 0 开始）",
        materialExecute: "从此素材创建修订",
        materialNoSelection: "选择已登记的 Blend、GLB 或贴图",
        materialExecHint: "Blend 开新修订；GLB 追加对象；贴图仅修改指定材质槽。检查产物后再继续。",
        materialNeedBase: "应用此素材前，请先打开一个 Blender 场景。",
        materialTrustBlend: "请只打开可信且已打包依赖的 Blend。另存修订不等于能安全打开不可信文件。继续？",
        materialInclude: "导入本步素材",
        pickProjectFolder: "选择工程文件夹",
        browseLocalFolders: "浏览本机目录",
        folderUp: "上一级",
        useThisFolder: "使用此目录",
        closeBrowser: "关闭目录浏览",
        newSubfolder: "新建子目录名称",
        createSubfolder: "新建子目录",
        projectDetected: "检测到 Avatar Studio 工程",
        noSubfolders: "此目录下没有可见子目录。",
        copyFailed: "剪贴板不可用，请展开下方手动复制。",
        workspaceNav: "主工作区",
        wsWorkbench: "1. 主工作台",
        wsRender: "2. 独立渲染台",
        wsLibrary: "3. 统一资产与素材库",
        wsSettings: "⚙ 全局设置",
        settingsModules: "全局设置模块",
        techDetails: "技术详情",
        tripoLedgerTitle: "跨工程账户账本（手工核对，非供应商余额）",
        tripoLedgerHint: "Studio 与 API 使用不同账号别名。账本不能阻止你在外部网页消费；网络超时不自动视为零扣费。",
        accountAlias: "账户别名（不要填密钥）",
        accountLimit: "本月已核对可用预算",
        accountChannel: "计费渠道",
        imageApi: "图像 API",
        recordMonthlyLimit: "登记本月限额",
        queryAccountLedger: "查询账户账本",
        tripoOpenApiTitle: "Tripo OpenAPI v3（直连 API 通道）",
        tripoOpenApiHint: "查询独立 OpenAPI v3 余额或轮询已有任务回执。发起付费任务需先开启云端执行并显式确认。",
        queryTripoBalance: "查询 OpenAPI v3 余额",
        pollTripoTask: "轮询并回收任务",
        blenderDualChannelTitle: "Blender 双通道（插件契约 + Computer-Use GUI）",
        draftBlenderStage: "交给 DSH 运行此工序",
        adoptedBadge: "已采用",
        candidateBadge: "候选",
        previewGlb: "预览 GLB 几何",
        editorIntro: "可读取已有 Blend，也可接力本工程通过伴随插件生成的 Blender 检查点。源文件只读，所有工序另存不可变版本；结构检查不代替视觉审批。",
        cancelEditor: "取消编辑作业",
        camFront: "+Z / 正面",
        camBack: "−Z / 背面",
        camLeft: "−X / 左面",
        camRight: "+X / 右面",
        camPersp: "透视",
        noOverlay: "不叠加",
        vrmWalkProbe: "VRM 步行动作探针",
        currentRevision: "当前版本",
        selectedObj: "已选对象",
        noneObj: "无",
        clothing: "服装",
        hair: "头发",
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
        hostVersionMismatch: 'Host 版本与当前工作台不匹配。请核对本机端口，再载入工程。',
        settingsHint: 'Studio API 由本插件在运行 DeepSeek Harness 的本机回环启动；只有改过端口时才需要修改。',
        pipeline: '制作工作台', render: '独立渲染', models: '模型与视图', tripo: 'Tripo 预算', blender: 'Blender', credentials: '密钥',
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
        status: '状态', result: '技术详情与最近结果', noResult: '操作结果与生成路径将在这里显示。', views: '已生成视图', credits: '剩余预算',
        stage1: '导入部件', stage2: '比例装配草案', stage3: '高斯骨架草案', stage4: '裙摆骨架草案', stage5: '表情与 VRM 导出尝试',
        in_progress: '进行中', pending: '待开始', awaiting_review: '待审阅', completed: '已完成',
        balance: '全身', settings: '全局设置与工程连接', instructions: '在此角色工程中工作。先读 charakuru-vrm-studio 技能，使用伴随插件 catalog/audit/gate 操作。检查当前阶段，以真实产物与回执汇报，完成后提交人工审阅。脚本成功执行不代表模型通过验收。'
      }
    };

    var css = /* WORKBENCH_CSS */ [
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
      '.ck-page[data-shell="desktop"] .ck-head{padding-top:calc(15px + var(--dsh-frame-top-clearance,0px))}',
      '.ck-material-workspace{display:grid;gap:14px;min-width:0;--ck-mb:var(--dsw-alias-border-l2,GrayText);--ck-mtext:var(--dsw-alias-label-primary,CanvasText);--ck-mmuted:var(--dsw-alias-label-secondary,GrayText);--ck-maccent:var(--dsw-alias-brand-primary,Highlight);--ck-mbg:var(--dsw-alias-bg-layer-2,Canvas);color:var(--ck-mtext)}',
      '.ck-intake-title{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:18px 20px;border:1px solid var(--ck-mb);border-radius:13px;background:linear-gradient(112deg,color-mix(in srgb,var(--ck-maccent) 9%,var(--ck-mbg)),var(--ck-mbg) 67%)}.ck-intake-title h2{font-size:clamp(21px,4cqw,30px);line-height:1.2;margin:5px 0}.ck-intake-title p{margin:5px 0 0;color:var(--ck-mmuted)}',
      '.ck-material-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.ck-material-steps button{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;min-width:0;min-height:43px;padding:6px 8px;text-align:left;color:inherit;background:var(--dsw-alias-bg-layer-1,Canvas);border:1px solid var(--ck-mb);border-radius:9px;font:inherit;cursor:pointer}.ck-material-steps button[aria-pressed=true]{border-color:var(--ck-maccent);background:color-mix(in srgb,var(--ck-maccent) 10%,var(--ck-mbg))}.ck-material-steps strong{font-size:12px;overflow-wrap:anywhere}.ck-material-steps small{font-variant-numeric:tabular-nums;color:var(--ck-mmuted)}',
      '.ck-intake-grid{display:grid;grid-template-columns:minmax(230px,.9fr) minmax(0,1.2fr);gap:12px;align-items:start}.ck-intake-grid>.ck-card{min-width:0}.ck-material-help{margin:0;line-height:1.6;overflow-wrap:anywhere}',
      '.ck-intake-drop{display:grid;justify-items:start;gap:5px;padding:14px;border:1px dashed var(--ck-mb);border-radius:9px;background:var(--ck-mbg);transition:border-color .14s,background .14s;min-width:0}.ck-intake-drop p{margin:0;color:var(--ck-mmuted);font-size:12px;font-variant-numeric:tabular-nums}.ck-intake-drop[data-dragging=true]{border-color:var(--ck-maccent);background:color-mix(in srgb,var(--ck-maccent) 12%,var(--ck-mbg))}.ck-intake-drop[data-disabled=true]{opacity:.64}.ck-intake-drop input{min-width:0;max-width:100%;font:inherit;color:inherit}.ck-intake-drop input::file-selector-button{font:inherit;padding:7px 9px;border-radius:7px;margin-inline-end:7px;background:Canvas;color:CanvasText;border:1px solid var(--ck-mb);cursor:pointer}.ck-material-file-label{color:var(--ck-mmuted);font-size:12px}',
      '.ck-inline-details summary{cursor:pointer;color:var(--ck-mmuted);padding:4px 0}.ck-inline-details>.ck-btn{margin-top:6px}.ck-material-list{display:grid;gap:7px;list-style:none;margin:0;padding:0;max-height:400px;overflow:auto}.ck-material-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 8px;padding:8px;border:1px solid var(--ck-mb);border-radius:8px;min-width:0}.ck-file-chip{font:700 10px/1.3 ui-monospace,Consolas,monospace;padding:5px;border-radius:6px;color:var(--ck-maccent);background:var(--ck-mbg);align-self:start}.ck-material-info{min-width:0}.ck-material-info strong,.ck-material-info p{overflow-wrap:anywhere}.ck-material-info p{margin:1px 0 4px;font-size:11px;color:var(--ck-mmuted)}.ck-material-actions{grid-column:2;display:flex;gap:5px;flex-wrap:wrap}.ck-material-empty{border:1px dashed var(--ck-mb);border-radius:8px;padding:14px;color:var(--ck-mmuted)}.ck-material-empty p{margin:3px 0 0}',
      '@container (max-width:820px){.ck-intake-grid{grid-template-columns:1fr}}@container (max-width:480px){.ck-material-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.ck-intake-title{padding:12px}.ck-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr))}.ck-material-actions{grid-column:1/-1}.ck-stage-actions{width:100%;justify-content:flex-start;padding-inline-start:4px}}',
      '.ck-error-detail{width:100%;color:var(--dsw-alias-state-error-primary,#b53043);overflow-wrap:anywhere}',
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
      var activeProject='', base='http://127.0.0.1:'+((typeof window !== 'undefined' && window.__DSH_CHARAKURU_PORT__) || config.port || 9886);
      try {
        activeProject=localStorage.getItem('avatar-studio-active-project') || '';
        var saved=localStorage.getItem('avatar-studio-loopback');
        if(saved)base=loopback(saved);
      } catch (_) {}
      return {
        base: base,
        materialStage: '', materialRole: '', materialSlot: 'head_front', materialPart: 'head', materialPath: '', materialPreview: '', materialMotionId: '', editorMaterialId: '', materialTarget: '', materialTextureSlot: '0',
        deskAiBriefs:{},deskInitialMode:'illustration',deskStage:'',deskBaseStep:'base',deskAngle:'front',deskImageGuides:true,deskPart:'head',deskCandidate:'',
        studioObjectPart:'clothing',studioRefId:'',studioRefIds:[],studioCap:'',studioQuote:'',studioDownload:'',studioPartPreview:'',deskReviewOriginal:false,
        blenderChannel:'auto',newFolderName:'',guiCheckoutNote:'',guiExportVrm:false,
        deskRenderId:'',deskRenderCompare:'',deskRenderBrief:'',deskRenderNote:'',
        imageRequestId: '', accountAlias: '', accountLimit: '0', accountChannel: 'tripo_studio', sourceBlend: '', vrmAddonPath: '', editorCamera: 'front', overlayId: '', overlayOpacity: '0.35', selectedObject: '', playMotion: false, assetKind: 'image', slotId: 'source', sourcePath: '', previewId: '', projectDir: activeProject, prompt: '', source: '', allowance: '200',
        model: config.defaultImageModel || 'qwen-image-2.1-local',
        imageScope:'head_front',imageMode:'image_to_image',imagePanel:'tips',compareAngle:'front',
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
        tab: 'pipeline', settingsOpen: false, folderBrowser: null, lastDraft:null, imagePreflight: null, result: null, error: '', notice: ''
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

      function put(key, value) {
        if(key==='projectDir')try{localStorage.setItem('avatar-studio-active-project',value);}catch(_){}
        if(key==='imageRequestId')try{localStorage.setItem('avatar-studio-request:'+state.form.projectDir,value);}catch(_){}
        var patch={form:Object.assign({},state.form,{[key]:value})};
        if(key==='base' && value!==state.form.base) Object.assign(patch,{boot:null,loaded:false,notice:'',error:'',result:null,lastDraft:null,folderBrowser:null});
        if(key==='projectDir'&&value!==state.form.projectDir){patch.lastDraft=null;patch.form.studioRefId='';patch.form.studioRefIds=[];patch.form.studioPartPreview='';patch.form.selectedObject='';patch.form.deskAiBriefs={};patch.form.deskReviewOriginal=false;
          patch.form.imageRequestId='';try{patch.form.imageRequestId=localStorage.getItem('avatar-studio-request:'+value)||'';}catch(_){}
        }
        set(patch);
      }

      function verdictLabel(data) {
        if (!data) return '';
        if (data.verdict === 'fail') return t('failed');
        if (data.verdict === 'degraded') return t('degraded');
        if (data.verdict === 'pass' || data.verdict === 'done') return t('done');
        return t('done');
      }

      async function request(route, body, file) {
        if (typeof fetch !== 'function') throw new Error('fetch is unavailable in this host');
        var controller = new AbortController();
        controllers.add(controller);
        var slow = file || route.indexOf('/materials/') >= 0 || route.indexOf('/tripo/studio/collect')>=0 || route.indexOf('/tripo/studio/upload')>=0 || route.indexOf('/tripo/openapi')>=0 || route.indexOf('/render/collect') >= 0 || route.indexOf('/editor/run') >= 0 || route.indexOf('/editor/collect') >= 0 || route.indexOf('/editor/gui-checkin') >= 0 || route.indexOf('generate') >= 0 || route.indexOf('/blender/stage') >= 0;
        var timer = setTimeout(function () { controller.abort(); }, slow ? TIMEOUT_SLOW : TIMEOUT_FAST);
        try {
          var res = await fetch(loopback(state.form.base) + route, {
            method: body || file ? 'POST' : 'GET',
            headers: body || file ? { 'Content-Type': file ? 'application/octet-stream' : 'application/json', 'X-Charakuru-Session': state.boot?.sessionToken || '' } : {},
            body: file || (body ? JSON.stringify(body) : undefined),
            signal: controller.signal, redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'
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
        var editor = data.projectState && data.projectState.editor;
        var view = editor && editor.view;
        if(view){next.editorCamera=view.camera;next.overlayId=view.overlayAssetId||'';next.overlayOpacity=String(view.overlayOpacity);}
        if(editor && editor.channelPreference){next.blenderChannel=editor.channelPreference;}
        if (quota && typeof quota.monthlyAllowance === 'number') next.allowance = String(quota.monthlyAllowance);
        set({ form: next });
      }

      async function refresh(hydrate) {
        var dir = state.form.projectDir;
        var base = loopback(state.form.base);
        var data = await request('/studio/bootstrap' + (dir ? '?projectDir=' + encodeURIComponent(dir) : ''));
        if (base!==loopback(state.form.base) || dir!==state.form.projectDir) return null;
        if (data.version && data.version!==CLIENT_VERSION) {
          set({boot:null,loaded:false,result:null});
          throw new Error(t('hostVersionMismatch')+' Host '+data.version+' / UI '+CLIENT_VERSION);
        }
        if (data.version===CLIENT_VERSION) try { localStorage.setItem('avatar-studio-loopback',base); } catch (_) {}
        set({ boot: data, loaded: true });
        if (hydrate) hydrateForm(data);
        else if (data.activeProjectDir && data.activeProjectDir!==dir) put('projectDir',data.activeProjectDir);
        return data;
      }

      function act(task) {
        if (state.pending) return Promise.resolve(undefined);
        set({ pending: true, busy: true, error: '', notice: '' });
        return Promise.resolve()
          .then(task)
          .then(function (data) {
            var patch = { pending: false, busy: false };
            if (data) { patch.result = Object.fromEntries(Object.entries(data).filter(function(e){return e[0]!=='sessionToken';})); patch.notice = verdictLabel(data); }
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
          if (route === '/studio/assets/clear-image') {if(body.slotId==='source')syncOriginal(data);if(body.slotId==='overlay')put('overlayId','');}
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
          if (data) set({notice:t(data.draftOutcome==='ok'?'inserted':'aiRecorded'),lastDraft:data.instruction?{instruction:data.instruction,draftOutcome:data.draftOutcome,id:data.request?.id||data.ticket?.id}:null});
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
        if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) {
          set({ notice: t('copyFailed') });
          return false;
        }
        try {
          Promise.resolve(navigator.clipboard.writeText(text)).then(function () {
            set({ notice: t('copied') });
          }).catch(function () {
            set({ notice: t('copyFailed') });
          });
          return true;
        } catch (error) {
          set({ notice: t('copyFailed') });
          return false;
        }
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
    /* PREVIEW_START *//* PREVIEW_END */
    /* MATERIALS_START */
    /* MATERIALS_END */
    /* WORKBENCH_START */
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
        var activeStage = projectState && projectState.stages && projectState.stages[projectState.activeStageId];
        function stageName(id) {
          var entry=stages.find(function(s){return s.id===id;});return entry?.['title'+lang]||id;
        }
        function fieldId(key){return uid+'-f-'+key;}
        function field(key,name,type) {
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
          var materialNote = boot?.materialRoles ? (lang === 'Zh' ? '外部素材先用 charakuru_project 的 list_materials 读取当前工序的已登记条目；编辑时只用明确允许的 materialId，不凭文件名猜权限。' : 'Read registered inputs with charakuru_project (list_materials) for this step. Use only an explicitly authorized materialId for an edit.') : '';
          var constraint = lang === 'Zh' ? '禁止未授权上传、扣费或改变审批。先报告真实文件和限制，等待人工处理下一步。' : 'Do not upload, charge, or approve on the user’s behalf. Report actual artifacts and stop at the checkpoint.';
          return [t('instructions'), '', 'Project: ' + project, 'Stage: ' + stageId + ' (' + stageName(stageId) + ')', advice || '', materialNote, constraint].filter(Boolean).join('\n');
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

        function openIntake(stageId) {
          studio.put('materialStage',stageId || '');studio.put('materialRole','');selectTab('materials');
        }
        var viewDefs = (boot && boot.requiredViewSlots) || [];
        var modelsTab=h(DeskImageWorkspace,{studio:studio,state:state,projectState:projectState,lang:lang,selectTab:selectTab});
        function registerRole(stage,role) { openIntake(stage);studio.put('materialRole',role); }
        function openSettingsDrawer() {
          studio.set({ settingsOpen: true });
          if (typeof document !== 'undefined') {
            var x = document.querySelector('.ck-content > .ck-details');
            if (x) { x.open = true; x.querySelector('input')?.focus(); }
          }
        }
        var editorState=projectState&&projectState.editor;
        var blenderCheckpoint=projectState&&projectState.blenderState&&projectState.blenderState.activeBlendFile;
        var editRevision=editorState&&editorState.revisions.find(function(r){return r.id===editorState.activeRevisionId;});

        var tripoResult = projectState && state.result && state.result.estimateOnly && state.result.projectDir === boot.activeProjectDir ? state.result : null;
        var tripoPlan = tripoResult && tripoResult.studioWebPlaybook;
        var openApiTasks = (projectState && projectState.tripoQuota && projectState.tripoQuota.openapiTasks) || [];
        var tripoTab = [
          h(DeskTripoStudio,{key:'browser',studio:studio,state:state,projectState:projectState,lang:lang,register:registerRole}),
          card('tripoOpenApiTitle',h(React.Fragment,null,
            h('p',{className:'ck-muted'},t('tripoOpenApiHint')),
            h('div',{className:'ck-row'},
              button('queryTripoBalance',function(){studio.action('/studio/tripo/openapi',{action:'balance'});},!boot)),
            openApiTasks.length ? h('ul',{className:'ck-paths'},openApiTasks.slice(-6).reverse().map(function(task){
              return h('li',{key:task.taskId||task.requestId},
                (task.part||'')+' · '+(task.action||'')+' · '+(task.status||'')+' · '+String(task.taskId||task.requestId||'').slice(0,14)+' ',
                task.taskId && ['submitted','queued','running','uncertain'].indexOf(task.status)>=0 ? h('button',{type:'button',className:'ck-btn',disabled:busy,onClick:function(){studio.action('/studio/tripo/openapi',{action:'poll',taskId:task.taskId,requestId:task.requestId},true);}},t('pollTripoTask')) : null);
            })) : null)),
          card('tripoLedgerTitle',h(React.Fragment,null,
            h('p',{className:'ck-muted'},t('tripoLedgerHint')),
            h('div',{className:'ck-grid'},field('accountAlias','accountAlias'),field('accountLimit','accountLimit','number'),select('accountChannel','accountChannel',[['tripo_studio','Tripo Studio'],['tripo_api','Tripo API'],['image_api',t('imageApi')]])),
            h('div',{className:'ck-row'},button('recordMonthlyLimit',function(){studio.action('/studio/budget',{action:'configure',accountId:form.accountAlias,channel:form.accountChannel,period:new Date().toISOString().slice(0,7),limit:Number(form.accountLimit),unit:'credits'});},!form.accountAlias),button('queryAccountLedger',function(){studio.action('/studio/budget',{action:'status',accountId:form.accountAlias});},!form.accountAlias)))),
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
              select('part', 'part', ['head', 'body', 'clothing', 'hair', 'accessory'].map(function (part) { return [part, t(part)]; })),
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
          projectState ? card('blenderDualChannelTitle',h(DeskBlenderChannelControls,{studio:studio,state:state,projectState:projectState,revision:editRevision,lang:lang})) : null,
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
          h('div',{className:'ck-row'},button('scripts',function(){studio.action('/studio/blender/stage',{operation:form.operation,executeViaPlugin:false,executionTarget:form.target,
            params:{inputBlendPath:form.blend||undefined,headGlbPath:form.headGlb||undefined,bodyGlbPath:form.bodyGlb||undefined}});},!projectState),
            button('draftBlenderStage',function(){
              var brief=(lang==='Zh'?'请用已审批、已核验的本机输入执行此 Blender 工序。确认可用参数和文件后用工具运行；不要修改源文件、上传或自行审批。':'Use reviewed, fingerprinted local inputs for this Blender stage. Check the inputs before running. Do not overwrite sources, upload or approve results.')+'\n'+
                'charakuru_blender_avatar '+JSON.stringify({action:'run_stage',projectDir:boot.activeProjectDir,operation:form.operation,executeViaPlugin:true,executionTarget:form.target});
              if(studio.insertInstructions(brief)!=='ok')studio.set({lastDraft:{id:'blender-stage',instruction:brief,draftOutcome:'unsupported'},notice:t('noSession')});
            },!projectState,'primary')),
          state.lastDraft?.id==='blender-stage'?h(DeskHandoffCopy,{studio:studio,result:state.lastDraft,lang:lang,disabled:busy}):null
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
            h(DeskImageChoice,{studio:studio,project:projectState,lang:lang,slot:slot.id,busy:busy}),
            button('redoView',function(){studio.put('imageScope',slot.id);selectTab('models');}));
        }
        var assetTab = [
          projectState && viewDefs.length ? card('viewReview',h(React.Fragment,null,
            h('p',{className:'ck-muted'},t('viewReviewHelp')),
            select('compareAngle','chooseAngle',[['front',t('front')],['left',t('left')],['right',t('right')],['back',t('backView')]]),
            h('div',{className:'ck-view-grid'},viewDefs.filter(function(v){return v.group!=='balance'&&v.angle===form.compareAngle;}).map(chosenViewTile)),
            h('p',{className:'ck-muted'},t('balanceReview')),
            h('div',{className:'ck-view-grid'},viewDefs.filter(function(v){return v.group==='balance';}).map(chosenViewTile)))) : null,
          h('div',{className:'ck-row'},button('materialInclude',function(){openIntake(projectState?.activeStageId);},!projectState,'primary'),
            button('scanViews',function(){studio.action('/studio/assets/scan',{},true);},!projectState)),
          chosenPreview ? (chosenPreview.kind === 'glb' ? h(GeometryPreview,{key:chosenPreview.id,lang:lang,url:assetUrl(chosenPreview)})
            : h('img',{className:'ck-asset-focus',src:assetUrl(chosenPreview),alt:chosenPreview.label,referrerPolicy:'no-referrer'})) : null,
          h('div',{className:'ck-grid'}, assetItems.slice().reverse().map(function(asset){
            var selected = asset.kind==='image' && asset.slotId!=='source'
              ? projectState.views[asset.slotId] && projectState.views[asset.slotId].status==='ready' && projectState.views[asset.slotId].assetId===asset.id
              : projectState.assets.selected[asset.slotId || asset.part]===asset.id;
            return h('section',{className:'ck-card',key:asset.id},h('strong',null,(asset.slotId==='source'?t('sourceSlot'):asset.slotId||asset.part)+' · '+t(selected?'adoptedBadge':'candidateBadge')),
              asset.kind==='image'?h('button',{type:'button',className:'ck-btn',onClick:function(){studio.put('previewId',asset.id);}},h('img',{src:assetUrl(asset),alt:asset.label,loading:'lazy',referrerPolicy:'no-referrer',style:{width:'100%',height:180,objectFit:'contain',background:'#141b26',borderRadius:6}})):h('button',{type:'button',className:'ck-btn',onClick:function(){studio.put('previewId',asset.id);}},t('previewGlb')),
              h('p',{className:'ck-muted'},asset.label+' · '+Math.round(asset.bytes/1024)+' KiB · '+asset.sha256.slice(0,12)),
              asset.kind==='image'&&selected ? deskButton(lang==='Zh'?'取消采用':'Clear selection',function(){studio.action('/studio/assets/clear-image',{slotId:asset.slotId,expectedAssetId:asset.id,expectedRevision:projectState.stateRevision},true);},busy) : asset.slotId === 'overlay' ? button('materialOverlay', function(){studio.put('overlayId',asset.id);selectTab('editor');}) : button('selectAsset',function(){studio.action('/studio/assets/select',{assetId:asset.id,expectedRevision:projectState.stateRevision},true);},selected||asset.kind==='glb'&&!asset.renderable));
          }))
        ];
        var projectMaterials=projectState?.materials?.items || [];
        var editMaterial=projectMaterials.find(function(m){return m.id===form.editorMaterialId && MATERIAL_EDITOR_OPS[m.intent];});
        var previewMotion=projectMaterials.find(function(m){return m.id===form.materialMotionId && m.intent==='motion';});
        var textureMeshes=(editRevision?.audit?.objects || []).filter(function(o){return o.type==='MESH' && !o.helper;});
        var textureTarget=form.materialTarget || form.selectedObject;
        var overlayAsset=assetItems.find(function(a){return a.id===form.overlayId;});
        function editorUrl(kind){return loopback(form.base)+'/studio/editor/content?projectDir='+encodeURIComponent(form.projectDir||boot.activeProjectDir)+'&revisionId='+editRevision.id+'&kind='+kind+'&access='+encodeURIComponent(boot.sessionToken||'');}
        function editorRun(operation){
          if(operation==='import_blend'&&!window.confirm(t('materialTrustBlend')))return;
          var params=operation==='import_blend'?{sourceBlend:form.sourceBlend}:{};
          if(form.vrmAddonPath)params.vrmAddonPath=form.vrmAddonPath;
          studio.action('/studio/editor/run',{operation:operation,params:params,expectedRevisionId:editorState?.activeRevisionId||null},true);
        }
        function applyRegisteredMaterial() {
          if (!editMaterial) return;
          if (editMaterial.intent==='scene' && !window.confirm(t('materialTrustBlend'))) return;
          var params={materialId:editMaterial.id};
          if (editMaterial.intent==='texture') {params.objects=[textureTarget];params.textureSlot=Number(form.materialTextureSlot);}
          if (form.vrmAddonPath) params.vrmAddonPath=form.vrmAddonPath;
          studio.action('/studio/editor/run',{operation:MATERIAL_EDITOR_OPS[editMaterial.intent],params:params,expectedRevisionId:editRevision?.id || null},true);
        }
        var editorTab=[
          h('div',{className:'ck-row',key:'prep'},button('prepBlender',function(){selectTab('blender');})),
          h('p',{className:'ck-muted'},t('editorIntro')),
          projectState && !editRevision ? card('blenderDualChannelTitle',h(DeskBlenderChannelControls,{studio:studio,state:state,projectState:projectState,revision:null,lang:lang})) : null,
          boot?.materialRoles ? card('materialSelected',h(React.Fragment,null,
            h('p',{className:'ck-muted'},t('materialExecHint')),
            select('editorMaterialId','materialSelected',[['',t('materialNoSelection')]].concat(projectMaterials.filter(function(m){return MATERIAL_EDITOR_OPS[m.intent];}).map(function(m){return [m.id,m.fileName+' · '+stageName(m.stageId)];}))),
            editMaterial?.intent==='texture' ? h('div',{className:'ck-grid'},select('materialTarget','materialTarget',[['',t('materialTarget')]].concat(textureMeshes.map(function(o){return [o.name,o.name];}))),field('materialTextureSlot','materialTextureSlot','number')) : null,
            editMaterial && editMaterial.intent!=='scene' && !editRevision ? h('p',{className:'ck-muted'},t('materialNeedBase')) : null,
            h('div',{className:'ck-row'},button('materialInclude',function(){openIntake('4_assembly');},!projectState),
              button('materialExecute',applyRegisteredMaterial,!editMaterial || !!editorState?.pendingJob || editMaterial.intent!=='scene'&&!editRevision || editMaterial.intent==='texture'&&(!textureMeshes.some(function(o){return o.name===textureTarget;})||form.materialTextureSlot===''||!Number.isInteger(Number(form.materialTextureSlot))||Number(form.materialTextureSlot)<0||Number(form.materialTextureSlot)>127),'primary')))) : null,
          h('div',{className:'ck-grid'},field('sourceBlend','sourceBlend'),field('vrmAddonPath','vrmAddonPath')),
          h('div',{className:'ck-row'},button('editorImport',function(){editorRun('import_blend');},!form.sourceBlend||!form.projectDir||!!(editorState&&editorState.pendingJob)),button('checkpointImport',function(){editorRun('import_checkpoint');},!blenderCheckpoint||!!(editorState&&editorState.pendingJob)),button('collectEditor',function(){studio.action('/studio/editor/collect',{},true);},!editorState||!editorState.pendingJob),button('cancelEditor',function(){studio.action('/studio/editor/cancel',{},true);},!editorState||!editorState.pendingJob)),
          editRevision?h(React.Fragment,null,
            h('div',{className:'ck-grid'},select('editorCamera','camera',[['front',t('camFront')],['back',t('camBack')],['left',t('camLeft')],['right',t('camRight')],['perspective',t('camPersp')]]),select('overlayId','overlay',[['',t('noOverlay')]].concat(assetItems.filter(function(a){return a.kind==='image';}).map(function(a){return [a.id,a.label||a.slotId];}))),field('overlayOpacity','overlayOpacity','number')),
            h('div',{className:'ck-row'},button('saveView',function(){studio.action('/studio/editor/view',{camera:form.editorCamera,overlayAssetId:form.overlayId||null,overlayOpacity:Number(form.overlayOpacity),expectedRevision:projectState.stateRevision},true);}),h('label',null,h('input',{type:'checkbox',checked:!!form.playMotion,onChange:function(e){studio.put('playMotion',e.target.checked);}}),t('vrmWalkProbe'))),
            projectMaterials.some(function(m){return m.intent==='motion';}) ? select('materialMotionId','materialMotion',[['',t('materialNoMotion')]].concat(projectMaterials.filter(function(m){return m.intent==='motion';}).map(function(m){return [m.id,m.fileName+' · '+stageName(m.stageId)+' · '+m.sha256.slice(0,8)];}))) : null,
            previewMotion && !editRevision.artifacts.vrm ? h('p',{className:'ck-callout'},t('materialMotionNeedsVrm')) : null,
            h(GeometryPreview,{key:editRevision.id,lang:lang,url:editorUrl(editRevision.artifacts.vrm?'vrm':'preview'),camera:form.editorCamera,overlayUrl:overlayAsset?assetUrl(overlayAsset):null,opacity:Number(form.overlayOpacity),playMotion:form.playMotion,motionUrl:previewMotion && editRevision.artifacts.vrm ? studioMaterialUrl(form,boot,previewMotion) : null,onSelect:function(name){studio.put('selectedObject',name);}}),
            h('p',{className:'ck-muted'},t('currentRevision')+' '+editRevision.id.slice(0,8)+' · '+t('selectedObj')+' '+(form.selectedObject||t('noneObj'))+' · '+editRevision.operation),
            h(DeskAiJob,{studio:studio,state:state,projectState:projectState,revision:editRevision,lang:lang,intent:'general',showAll:true,
              objects:form.selectedObject&&(editRevision.audit?.objects||[]).some(function(o){return o.name===form.selectedObject;})?[form.selectedObject]:[]}),
            button('editorUndo',function(){studio.action('/studio/editor/rollback',{revisionId:editRevision.parentId,expectedRevisionId:editRevision.id},true);},!editRevision.parentId||!!editorState.pendingJob),
            details('techDetails',false,h('pre',{className:'ck-pre'},JSON.stringify({gates:editRevision.audit.gates,notes:editRevision.audit.notes,revisions:editorState.revisions.map(function(r){return {id:r.id,operation:r.operation,parentId:r.parentId};})},null,2)))
          ):null
        ];
        var bodies = { render:h(RenderWorkspace,{studio:studio,state:state,projectState:projectState,lang:lang,selectTab:selectTab}), materials: h(MaterialWorkspace,{studio:studio,state:state,projectState:projectState,stages:stages,lang:lang,selectTab:selectTab,card:card}), editor: editorTab, assets: assetTab, pipeline:h(WorkbenchWorkspace,{studio:studio,state:state,projectState:projectState,stages:stages,lang:lang,selectTab:selectTab,handoff:insert,openSettings:openSettingsDrawer}), models: modelsTab, tripo: tripoTab, blender: blenderTab, credentials: credentialsTab };
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

        var isSettingsTab = ['models', 'tripo', 'blender', 'credentials'].indexOf(state.tab) >= 0;
        var workspaceBar = h('div', { className: 'ck-workspace-bar', role: 'navigation', 'aria-label': t('workspaceNav') },
          h('button', { type: 'button', className: 'ck-btn', 'aria-pressed': state.tab === 'pipeline' || state.tab === 'editor', onClick: function () { selectTab('pipeline'); } }, t('wsWorkbench')),
          h('button', { type: 'button', className: 'ck-btn', 'aria-pressed': state.tab === 'render', onClick: function () { selectTab('render'); } }, t('wsRender')),
          h('button', { type: 'button', className: 'ck-btn', 'aria-pressed': state.tab === 'materials' || state.tab === 'assets', onClick: function () { selectTab('materials'); } }, t('wsLibrary')),
          h('button', { type: 'button', className: 'ck-btn', 'aria-pressed': isSettingsTab || state.settingsOpen, onClick: openSettingsDrawer }, t('wsSettings')));

        var strip = h('div', { className: 'ck-strip' },
          workspaceBar,
          h('span', { className: 'ck-chip' }, form.base.replace(/^https?:\/\//, '')),
          boot ? h('span', { className: 'ck-chip' }, boot.activeProjectDir || '—') : null,
          boot?.version ? h('span',{className:'ck-chip'},'v'+boot.version) : null,
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

        function browseFolders(targetDir) {
          studio.act(async function () {
            var data = await studio.request('/studio/fs/browse', { dirPath: targetDir || undefined });
            studio.set({ folderBrowser: data });
            return data;
          });
        }
        function createSubfolder() {
          var fb = state.folderBrowser;
          var name = (form.newFolderName || '').trim();
          if (!fb || !name) return;
          studio.act(async function () {
            var created = await studio.request('/studio/fs/mkdir', { parentDir: fb.currentDir, name: name });
            studio.put('newFolderName', '');
            if (created && created.createdDir) {
              var refreshed = await studio.request('/studio/fs/browse', { dirPath: created.createdDir });
              studio.set({ folderBrowser: refreshed });
            }
            return created;
          });
        }
        var fb = state.folderBrowser;
        var settingsDrawer = details('settings', !boot || state.settingsOpen,
          h('div', { className: 'ck-grid' }, field('base', 'backend'), field('projectDir', 'project')),
          h('p', { className: 'ck-muted' }, t('settingsHint')),
          h('div',{className:'ck-row'},
            desktopHasFolderPicker() ? button('pickProjectFolder',function(){studio.act(async function(){
              var folder = await window.__DSH_DIRECTORY_PICKER__.pick();
              if (typeof folder !== 'string' || !folder) return null;
              studio.put('projectDir',folder);studio.put('materialPath','');studio.put('editorMaterialId','');
              return studio.refresh(true);
            });},false,'primary') : button('browseLocalFolders',function(){browseFolders(form.projectDir);},!boot,'primary'),
            button('openProject',function(){studio.action('/studio/project/open',{},true);})),
          !desktopHasFolderPicker() && fb ? h('div', { className: 'ck-folder-browser' },
            h('div', { className: 'ck-row' },
              h('code', null, fb.currentDir),
              fb.isProject ? h('span', { className: 'ck-chip', 'data-tone': 'ok' }, t('projectDetected')) : null),
            h('div', { className: 'ck-row' },
              fb.parentDir ? button('folderUp', function () { browseFolders(fb.parentDir); }) : null,
              button('useThisFolder', function () {
                studio.put('projectDir', fb.currentDir); studio.put('materialPath', ''); studio.put('editorMaterialId', '');
                studio.set({ folderBrowser: null });
                studio.act(function () { return studio.refresh(true); });
              }, false, 'primary'),
              button('closeBrowser', function () { studio.set({ folderBrowser: null }); })),
            (fb.directories && fb.directories.length) ? h('div', { className: 'ck-folder-list' }, fb.directories.map(function (entry) {
              return h('button', { type: 'button', className: 'ck-btn', key: entry.path, disabled: busy, onClick: function () { browseFolders(entry.path); } }, entry.name);
            })) : h('p', { className: 'ck-muted' }, t('noSubfolders')),
            h('div', { className: 'ck-row' },
              field('newFolderName', 'newSubfolder'),
              button('createSubfolder', createSubfolder, !(form.newFolderName || '').trim()))) : null,
          h('div', { className: 'ck-row' },
            h('span', { className: 'ck-muted' }, t('settingsModules') + ':'),
            ['models', 'tripo', 'blender', 'credentials'].map(function (key) {
              return h('button', { type: 'button', className: 'ck-btn', key: 'cfg-' + key, 'aria-pressed': state.tab === key, onClick: function () { selectTab(key); } }, t(key));
            })),
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
        }, settingsDrawer, waiting, failure, boot && state.error ? h('p',{className:'ck-error-detail',role:'alert'},state.error) : null, showBody ? bodies[state.tab] || null : null, resultDrawer);

        var body = h('div', { className: 'ck-body' }, rail, content);

        return h('div', { className: 'ck-page', 'data-studio-panel': PANEL_ID, 'data-shell': isDshDesktop() ? 'desktop' : 'web' },
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
