// Native model settings. Project profiles carry only allowlisted non-secret parameters.
function DeskSwitch(props) {
  return h('div',{className:'ck-switch',role:'group','aria-label':props.label},props.options.map(function(entry){
    return h('button',{className:'ck-btn',key:entry[0],type:'button','aria-pressed':props.value===entry[0],disabled:props.disabled,onClick:function(){props.change(entry[0]);}},entry[1]);
  }));
}
function DeskImageConfig(props) {
  var L=props.L,model=props.model,driver=model.driver,profile=props.config;
  var current=React.useState(function(){return Object.assign({},profile);}),draft=current[0],setDraft=current[1];
  var disabled=props.busy||!props.project;
  function set(key,value){setDraft(Object.assign({},draft,{[key]:value}));}
  function sub(group,key,value){set(group,Object.assign({},draft[group],{[key]:value}));}
  function config(){
    var out=Object.assign({},draft);
    if(draft.parameters)out.parameters=Object.fromEntries(Object.entries(draft.parameters).filter(function(e){return e[1]!=='';}).map(function(e){return [e[0],Number(e[1])];}));
    return out;
  }
  function field(k,title,opts){return deskField(title,draft[k]??'',function(v){set(k,v);},Object.assign({disabled:disabled},opts));}
  function number(k,title,min,max,step){return h('div',{key:k},deskField(title,draft.parameters?.[k]??'',function(v){sub('parameters',k,v);},{type:'number',min:min,max:max,step:step,disabled:disabled,placeholder:L('自动','Auto')}));}
  if(driver==='catalog')return h('p',{className:'ck-callout'},L('仅榜单 / 提示词研究。此条目没有执行适配器，也没有伪造的模型参数。','Catalog and prompt research only. No execution adapter or simulated settings.'));
  var comfy=['comfyui_qwen','comfyui_anima'].includes(driver),anima=driver==='comfyui_anima';
  var changed=JSON.stringify(config())!==JSON.stringify(profile);
  return h('div',{className:'ck-ai-strip'},
    !props.project?h('p',{className:'ck-callout'},L('建工程后可保存每模型的参数。','Create a project to save per-model settings.')):null,
    h('p',{className:'ck-help'},L('参数按项目与模型分别保存。仅应用已保存的参数；此处不保存凭据。','Settings are saved per project and model. Only saved values are used. No credentials are stored here.')),
    comfy?h('p',{className:'ck-meta-line'},L('本机 ComfyUI · DSH 配置项 comfyuiUrl','Local ComfyUI · DSH setting comfyuiUrl')+' · '+(props.boot?.endpoints?.comfyuiUrl||'http://127.0.0.1:8188')):null,
    driver==='comfyui_qwen'?h('p',{className:'ck-callout'},props.boot?.imageSetup?.qwenRecipeConfigured?L('宿主已填 Qwen 工作流路径；需要预检确认。','The Qwen workflow path is set. Validate it with preflight.'):L('在 DSH 插件设置 comfyuiQwenWorkflowPath 填写可信的本机 API JSON。可先导出模板，按本机权重修改。','Set comfyuiQwenWorkflowPath in the DSH plugin config to a trusted local API JSON file. Export a starter graph and adapt it to installed weights.')):null,
    props.cloud||driver==='qwen_local'?field('apiModelOverride',L('实际 API 模型 ID','Actual API model ID'),{maxLength:150,placeholder:driver==='qwen_local'?'Qwen/Qwen-Image-2.1':model.apiIdExample||''}):null,
    anima?h('div',{className:'ck-grid'},deskSelect(L('Anima 分支','Anima variant'),draft.animaVariant||'base',[['base','Base'],['aesthetic','Aesthetic'],['turbo','Turbo']],function(v){set('animaVariant',v);},disabled),
      field('artistTag',L('画师标签（可选）','Artist tag (optional)'),{maxLength:180}),['unet','clip','vae'].map(function(k){return h('div',{key:k},deskField(k.toUpperCase()+' · .safetensors',draft.modelFiles?.[k]||'',function(v){sub('modelFiles',k,v);},{disabled:disabled,maxLength:172,placeholder:L('本机文件名；留空用默认','Local filename; blank uses default')}));})):null,
    comfy?h('div',{className:'ck-grid'},number('seed',L('起始 Seed（后续槽 +1）','Base seed (+1 per slot)'),0,4294967280,1),number('steps',L('步数','Steps'),1,100,1),number('cfg','CFG',0,20,.1),
      anima?number('width',L('宽（8 的倍数）','Width (multiple of 8)'),64,2048,8):null,anima?number('height',L('高（与宽同时填写）','Height (set with width)'),64,2048,8):number('denoise',L('去噪强度','Denoise'),.05,1,.05)):null,
    model.nativeRgba?h('label',null,h('input',{type:'checkbox',disabled:disabled,checked:draft.rgbaTransparent!==false,onChange:function(e){set('rgbaTransparent',e.target.checked);}}),L('请求透明背景（以适配器和实际输出为准）','Request transparency (adapter and output dependent)')):null,
    !comfy?h('p',{className:'ck-muted'},L('本适配的精度、采样和尺寸按供应商合同设置，不显示未接线的通用滑杆。','This adapter uses provider-specific sizing and sampling. Unwired sliders are not shown.')):null,
    h('div',{className:'ck-row'},deskButton(L('保存本模型参数','Save settings for this model'),function(){props.save({action:'config',config:config()});},disabled||!changed,true),
      deskButton(L('载入默认值','Load defaults'),function(){setDraft({});},disabled||(!changed&&!Object.keys(profile).length)),changed?h('span',{className:'ck-muted'},L('尚未保存','Unsaved')):null));
}
function DeskPromptEditor(props) {
  var L=props.L,studio=props.studio,project=props.project,profile=props.profile;
  var selected=React.useState(props.slots?.length===1?props.slots[0]:'head_front'),slot=selected[0],setSlot=selected[1];
  var loaded=React.useState(null),record=loaded[0],setRecord=loaded[1];
  var edit=React.useState(null),draft=edit[0],setDraft=edit[1];
  var disabled=props.busy||!project,active=record?.slotId===slot&&record.stateRevision===project?.stateRevision;
  function load(){
    studio.act(function(){return studio.request('/studio/prompts/template',{modelId:props.model.id,projectDir:props.projectDir,slotId:slot});}).then(function(data){
      if(data){setRecord(data);setDraft(data.override||data.defaults);}
    });
  }
  function save(){props.save({action:'prompt',slotId:slot,template:draft}).then(function(result){if(result){setRecord(Object.assign({},record,{override:draft,stateRevision:result.stateRevision}));}});}
  function reset(){props.save({action:'reset_prompt',slotId:slot}).then(function(result){if(result){setDraft(record.defaults);setRecord(Object.assign({},record,{override:null,stateRevision:result.stateRevision}));}});}
  return h('div',{className:'ck-ai-strip'},
    h('p',{className:'ck-help'},L('编辑的是本项目该模型、该槽位的内置提示词副本。预览、导出、执行使用同一份已保存模板；其他槽不受影响。','Edit a copy of the built-in template for this model and slot. Preview, export and generation use the same saved template. Other slots are unchanged.')),
    deskSelect(L('编辑哪个视图槽','Template slot'),slot,props.views.map(function(v){return [v.id,(v['label'+props.lang]||v.id)+(profile.prompts?.[v.id]?' •':'')];}),function(v){setSlot(v);setRecord(null);setDraft(null);},disabled),
    deskButton(L('读取提示词模板','Load prompt template'),load,disabled||!props.views.length,!active),
    active&&draft?h(React.Fragment,null,
      h('p',{className:'ck-muted'},L('可用占位：{character} 角色描述；{reference} 保留原画提示；Anima 可用 {artist}。是否上传参考由生图模式决定，不由提示词决定。','Tokens: {character} = character brief; {reference} = reference-preserving text; {artist} is available for Anima. The generation mode, not the wording, controls whether an image is sent.')),
      deskField(L('正向提示词模板','Positive template'),draft.positive,function(v){setDraft(Object.assign({},draft,{positive:v}));},{multiline:true,maxLength:4500,disabled:disabled}),
      deskField(L('负向提示词模板','Negative template'),draft.negative,function(v){setDraft(Object.assign({},draft,{negative:v}));},{multiline:true,maxLength:2500,disabled:disabled}),
      !['comfyui_anima','comfyui_qwen','novelai'].includes(props.model.driver)?h('p',{className:'ck-muted'},L('此适配器的 HTTP 执行请求不单独发送负向提示词；其值仍用于导出。','This HTTP adapter does not send a separate negative prompt; it remains available for export.')):null,
      h('div',{className:'ck-row'},deskButton(L('保存此槽位提示词','Save template for this slot'),save,disabled||!draft.positive.trim(),true),
        deskButton(L('恢复内置模板','Restore built-in template'),reset,disabled||!record.override))):null);
}
function DeskImageWorkspace(props) {
  var studio=props.studio,t=studio.t,state=props.state,boot=state.boot,form=state.form,project=props.projectState,lang=props.lang,busy=state.busy;
  var L=function(z,e){return deskText(lang,z,e);};
  var models=boot?.aaCatalog?.models||[],model=models.find(function(m){return m.id===form.model;})||models[0];
  var views=boot?.requiredViewSlots||[];
  if(!model)return deskCard(L('图像模型','Image models'),h('p',{className:'ck-callout'},L('先连接 Avatar Studio Host。','Connect the Avatar Studio host first.')));
  var catalog=model.driver==='catalog',cloud=!catalog&&model.deployment==='cloud',qwen=model.driver==='comfyui_qwen';
  var saved=project?.imageProfiles?.[model.id]||{},config=saved.config||{};
  var hasOriginal=project?.characterSpec?.sourceImages?.length===1;
  var imageMode=form.imageMode,usesRef=imageMode==='image_to_image',slotList=form.imageScope==='all'?undefined:['head','body','balance'].includes(form.imageScope)?views.filter(function(v){return v.group===form.imageScope;}).map(function(v){return v.id;}):[form.imageScope];
  var payload={projectDir:boot.activeProjectDir,modelId:model.id,characterPrompt:form.prompt,slots:slotList,imageMode:catalog?'text_to_image':imageMode};
  var key=JSON.stringify([project?.stateRevision,payload]);
  var checked=state.imagePreflight?.key===key?state.imagePreflight.result:null;
  var canReference=qwen||['gemini','openai_gpt','ark_seedream'].includes(model.driver)||model.id==='novelai-v45-reference';
  var result=state.result,receipt=result?.model?.id===model.id&&result.projectDir===boot.activeProjectDir?result:null;
  var promptPack=result?.pack?.model?.id===model.id&&result.previewKey===key?result.pack:null;
  function save(mod){return studio.action('/studio/image/profile',Object.assign({projectDir:boot.activeProjectDir,expectedRevision:project.stateRevision,modelId:model.id},mod),true);}
  function preflight(){studio.act(async function(){var result=await studio.request('/studio/views/preflight',payload);studio.set({imagePreflight:{key:key,result:result}});return result;});}
  function preview(){studio.act(async function(){var data=await studio.request('/studio/prompts/compile',payload);return Object.assign({},data,{previewKey:key});});}
  function newRequestId(){
    if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
    var bytes=new Uint8Array(16);
    if(typeof crypto!=='undefined'&&typeof crypto.getRandomValues==='function')crypto.getRandomValues(bytes);
    else for(var i=0;i<16;i+=1)bytes[i]=Math.floor(Math.random()*256);
    bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
    var hex=Array.from(bytes,function(b){return b.toString(16).padStart(2,'0');}).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function execute(){
    if(cloud&&!window.confirm(model.name+' / '+config.apiModelOverride+' · '+slotList[0]+'\n\n'+t(usesRef?'cloudConfirmRef':'cloudConfirmText')))return;
    var id=form.imageRequestId||newRequestId();if(!form.imageRequestId)studio.put('imageRequestId',id);
    studio.action('/studio/views/generate',Object.assign({},payload,{mode:'execute',requestId:id,expectedRevision:project.stateRevision,cloudConfirmed:cloud}),true).then(function(data){
      if(data&&data.verdict==='pass')studio.put('imageRequestId','');
    });
  }
  var modesOk=catalog||(!usesRef&&!qwen)||(usesRef&&hasOriginal&&(canReference||model.driver==='qwen_local'));
  var panel=form.imagePanel;
  return h('div',{className:'ck-image-workspace'},
    deskSelect(t('model'),model.id,models.map(function(m){return [m.id,m.name];}),function(id){studio.put('model',id);},busy),
    deskCard(model.name,h(React.Fragment,null,
      h('div',{className:'ck-model-stats'},h('span',{className:'ck-pill','data-status':catalog?'pending':'in_progress'},model['adapter'+lang]||model.deployment),
        h('span',{className:'ck-chip'},t(model.weights||'unknown')),h('span',{className:'ck-chip'},'T2I '+(model.aaT2iRank?'#'+model.aaT2iRank:'—')),h('span',{className:'ck-chip'},'Edit '+(model.aaEditRank?'#'+model.aaEditRank:'—'))),
      h(DeskSwitch,{label:L('模型说明与设置','Model information and settings'),value:panel,options:[['tips','Tip'],['params',L('参数','Parameters')],['prompts',L('提示词模板','Prompt templates')]],change:function(v){studio.put('imagePanel',v);},disabled:busy}),
      panel==='tips'?h('div',{className:'ck-ai-strip'},h('p',{className:'ck-muted'},t('snapshot')),h('p',null,model['endpoint'+lang]||''),
        h('p',{className:'ck-muted'},model['stage'+lang]),h('p',{className:'ck-muted'},model.licenseNotice),
        h('ul',{className:'ck-tips'},(model['promptTips'+lang]||[]).map(function(tip,i){return h('li',{key:i},tip);})),
        model.apiIdExample?h('p',{className:'ck-muted'},t('idExample')+' ',h('code',null,model.apiIdExample),' · '+(model.apiIdEvidence==='Official documentation'?t('officialDoc'):t('experimentalDoc'))):null,
        model.sourceUrl?h('a',{className:'ck-btn',href:model.sourceUrl,target:'_blank',rel:'noopener noreferrer'},t('modelDocs')):null):
        panel==='params'?h(DeskImageConfig,{key:JSON.stringify([boot.activeProjectDir,model.id,config]),model:model,config:config,boot:boot,project:project,busy:busy,cloud:cloud,save:save,L:L}):
          h(DeskPromptEditor,{key:boot.activeProjectDir+'|'+model.id,model:model,studio:studio,project:project,projectDir:boot.activeProjectDir,profile:saved,slots:slotList,views:views,lang:lang,busy:busy,L:L,save:save}))),
    deskCard(catalog?L('提示词研究（不执行）','Prompt research (no execution)'):t('imageSettings'),h('div',{className:'ck-ai-strip'},
      !catalog?h(DeskSwitch,{label:L('生图模式','Generation mode'),value:imageMode,options:[['text_to_image',L('文生图','Text to image')],['image_to_image',L('图生图','Image to image')]],change:function(v){studio.put('imageMode',v);},disabled:busy}):null,
      !catalog?h('p',{className:modesOk?'ck-muted':'ck-callout'},usesRef?!hasOriginal?L('图生图需要采用一张工程原画 PNG。没有参考不会退回文生图。','Adopt one original PNG for image-to-image. Missing input never falls back to text-only.'):
        canReference?L('使用已采用的原画 PNG 作为真实输入。','The adopted PNG is passed as an image input.'):
          model.driver==='qwen_local'?L('图生图只可导出本机 Diffusers 脚本。需要在线本机执行时选 ComfyUI Qwen 编辑。','Reference edit is available in the exported Diffusers runner only. Choose Qwen ComfyUI for connected generation.'):
            L('此模型适配器不能接收原画；请选择图生图适配器或明确切换文生图。','This adapter cannot bind a reference. Choose an edit adapter or explicitly switch to text-to-image.'):
        qwen?L('此 Qwen ComfyUI 卡只用于图生图；文生图请选择 Anima 或文本兼容端点。','This Qwen ComfyUI card is edit-only. Choose Anima or a compatible text endpoint.'):
          L('只传提示词，不读取原画。','Send text only; the original image is not read.')):null,
      cloud&&!boot.imageSetup?.cloudEnabled?h('p',{className:'ck-callout'},t('cloudOff')):null,
      project&&usesRef&&!catalog?h(DeskImageChoice,{studio:studio,project:project,slot:'source',lang:lang,busy:busy}):null,
      deskField(t('prompt'),form.prompt,function(v){studio.put('prompt',v);},{multiline:true,maxLength:8000,disabled:busy}),
      deskSelect(t('imageScope'),form.imageScope,[['all',t('allViews')],['head',t('head')],['body',t('body')],['balance',t('balance')]].concat(views.map(function(v){return [v.id,v['label'+lang]||v.id];})),function(v){studio.put('imageScope',v);},busy),
      h('div',{className:'ck-row'},deskButton(t('compile'),preview,busy||!project||!modesOk),
        !catalog?deskButton(t('export'),function(){studio.action('/studio/views/generate',Object.assign({},payload,{mode:'plan_and_export_workflows'}));},busy||!project||!modesOk):null,
        !catalog?deskButton(t('preflight'),preflight,busy||!project):null,
        !catalog?deskButton(t('execute'),execute,busy||!project||!checked?.allowed||!modesOk,true):null),
      !catalog&&checked?h('div',{className:'ck-callout',role:'status','data-ready':checked.allowed},checked.allowed?t('preflightReady'):h('ul',null,(checked.reasons||[]).map(function(r,i){return h('li',{key:i},r);} ))):null,
      !catalog&&form.imageRequestId?h('div',{className:'ck-row'},h('span',{className:'ck-muted'},t('imageRequest')+' ',h('code',null,form.imageRequestId)),
        deskButton(t('resetImageRequest'),function(){if(window.confirm(t('resetImageConfirm')))studio.put('imageRequestId','');},busy)):null)),
    receipt?.mode==='plan_and_export_workflows'?deskCard(t('exportedPlan'),h('ul',{className:'ck-paths'},(receipt.exportedArtifacts||[]).map(function(file){return h('li',{key:file},h('code',null,file));}))):null,
    receipt?.mode==='execute'?deskCard(t('imageReceipt'),h(React.Fragment,null,h('ul',{className:'ck-paths'},(receipt.results||[]).map(function(r){return h('li',{key:r.slotId},r.slotId+' · '+(r.ok?t(r.selected?'imageSelected':'imageCandidate'):r.error)+(r.providerPromptId?' · ComfyUI '+r.providerPromptId:''));})),deskButton(t('assets'),function(){props.selectTab('assets');},busy))):null,
    promptPack?deskCard(t('compiledPrompts'),h('div',{className:'ck-view-grid'},promptPack.views.map(function(v){return h('div',{className:'ck-view-card',key:v.slotId},h('strong',null,v.labelZh&&lang==='Zh'?v.labelZh:v.slotId),h('p',null,v.resolution),h('p',{className:'ck-desk-brief'},v.positivePrompt),h('p',{className:'ck-muted'},v.negativePrompt?'− '+v.negativePrompt:null));}))):null);
}
