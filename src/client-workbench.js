// DSH native workflow surfaces; packaged with the bundled viewport, not an embedded app.
function deskText(lang, zh, en) { return lang==='En' ? en : zh; }
function deskSelect(label,value,options,change,disabled) {
  return h('label',{className:'ck-field'},h('span',null,label),h('select',{value:value,disabled:disabled,onChange:function(e){change(e.target.value);}},options.map(function(p){return h('option',{key:p[0],value:p[0]},p[1]);})));
}
function deskField(label,value,change,options) {
  options=options||{};
  var tag=options.multiline?'textarea':'input';
  return h('label',{className:'ck-field'},h('span',null,label),h(tag,{value:value,id:options.id,type:tag==='input'?(options.type||'text'):undefined,min:options.min,max:options.max,step:options.step,placeholder:options.placeholder,disabled:options.disabled,maxLength:options.maxLength,onChange:function(e){change(e.target.value);}}));
}
function deskButton(label,action,disabled,primary) {
  return h('button',{className:'ck-btn',type:'button','data-variant':primary?'primary':'default',onClick:action,disabled:!!disabled},label);
}
function deskCard(label,children) {
  return h('section',{className:'ck-card ck-desk-card'},label?h('h3',{className:'ck-card-title'},label):null,children);
}
function deskAssetUrl(boot,form,route,query) {
  return loopback(form.base)+'/studio/'+route+'/content?'+new URLSearchParams(Object.assign({projectDir:boot.activeProjectDir,access:boot.sessionToken},query)).toString();
}
function DeskHandoffCopy(props) {
  var r=props.result,L=function(z,e){return deskText(props.lang,z,e);};
  if(!r?.instruction||r.draftOutcome==='ok')return null;
  return h('details',{className:'ck-inline-details'},h('summary',null,L('手动复制 DSH 会话草稿','Copy the DSH draft manually')),
    h('pre',{className:'ck-pre'},r.instruction),deskButton(L('复制草稿','Copy draft'),function(){props.studio.copy(r.instruction);},props.disabled));
}
function DeskBlenderChannelControls(props) {
  var studio=props.studio,state=props.state,project=props.projectState,revision=props.revision,form=state.form;
  var L=function(z,e){return deskText(props.lang,z,e);};
  if(!project)return null;
  var editor=project.editor||{};
  var channelPref=editor.channelPreference||form.blenderChannel||'auto';
  var guiCheckout=editor.guiCheckout&&editor.guiCheckout.status==='checked_out'?editor.guiCheckout:null;
  var locked=state.busy||!!editor.pendingJob||props.disabled;
  function setChannel(v){
    studio.put('blenderChannel',v);
    studio.action('/studio/editor/channel',{channelPreference:v,expectedRevision:project.stateRevision},true);
  }
  function checkoutGui(){
    studio.action('/studio/editor/gui-checkout',{expectedRevisionId:revision.id,note:(form.guiCheckoutNote||'').trim()||undefined},true);
  }
  function checkinGui(){
    studio.action('/studio/editor/gui-checkin',{checkoutId:guiCheckout.id,expectedRevisionId:revision.id,exportVrm:!!form.guiExportVrm},true);
  }
  function abortGui(){
    studio.action('/studio/editor/gui-abort',{checkoutId:guiCheckout.id,expectedRevisionId:revision.id},true);
  }
  return h('div',{className:'ck-config-row','data-blender-channels':'true'},
    deskSelect(L('Blender 通道偏好','Blender channel preference'),channelPref,[
      ['auto',L('自动择优（插件 / GUI 混合）','Auto select (plugin / GUI hybrid)')],
      ['plugin',L('dsh-blender-plugin 契约','dsh-blender-plugin contract')],
      ['computer_use',L('Computer-Use GUI 操控','Computer-Use GUI')]
    ],setChannel,state.busy||!!editor.pendingJob),
    revision?h('div',{className:'ck-config-row'},
      guiCheckout?h(React.Fragment,null,
        h('p',{className:'ck-callout'},L('GUI 工作副本已签出：','GUI working copy checked out: '),h('code',null,guiCheckout.workingBlendPath||guiCheckout.id.slice(0,8))),
        h('label',{className:'ck-row'},h('input',{type:'checkbox',checked:!!form.guiExportVrm,disabled:locked,onChange:function(e){studio.put('guiExportVrm',e.target.checked);}}),L('签入时导出 VRM','Export VRM on checkin')),
        h('div',{className:'ck-row'},
          deskButton(L('签入 GUI 修订','Check in GUI revision'),checkinGui,locked,true),
          deskButton(L('放弃 GUI 签出','Abort GUI checkout'),abortGui,locked))):
        h('div',{className:'ck-row'},
          deskButton(L('签出 GUI 工作副本','Check out GUI working copy'),checkoutGui,locked||!revision))):null);
}
function DeskAiJob(props) {
  var studio=props.studio,state=props.state,project=props.projectState,revision=props.revision,intent=props.intent||'general',form=state.form;
  var L=function(z,e){return deskText(props.lang,z,e);};
  var guiCheckedOut=project.editor?.guiCheckout?.status==='checked_out';
  var disabled=state.busy||!!project.editor?.pendingJob||props.disabled;
  var channelPref=project.editor?.channelPreference||form.blenderChannel||'auto';
  var brief=form.deskAiBriefs[intent]===undefined?(props.defaultBrief||''):form.deskAiBriefs[intent];
  var needsReview=(project.editor?.requests||[]).some(function(r){return r.status==='ready_for_review'&&r.resultRevisionId===revision?.id;});
  var requests=(project.editor?.requests||[]).filter(function(r){return props.showAll||(r.intent||'general')===intent;}).slice(-4).reverse();
  function draft(){studio.handoffAiEdit('/studio/editor/ai-request',{prompt:brief,objects:props.objects||[],camera:form.editorCamera||'front',expectedRevisionId:revision.id,intent:intent,channelPreference:channelPref},true);}
  return deskCard(props.title||L('AI 建模接力','AI modeling handoff'),h('div',{className:'ck-ai-strip'},
    props.info?h('p',{className:'ck-muted'},props.info):null,
    !revision||props.disabled?h('p',{className:'ck-callout'},props.missing||L('先打开本项目当前要编辑的 Blender 修订。','Open the Blender revision you intend to edit.')):null,
    h(DeskBlenderChannelControls,{studio:studio,state:state,projectState:project,revision:revision,lang:props.lang,disabled:props.disabled||needsReview}),
    deskField(L('告诉 AI 想改成什么样','Describe the change to the AI'),brief,function(v){studio.put('deskAiBriefs',Object.assign({},form.deskAiBriefs,{[intent]:v}));},{multiline:true,maxLength:8000,placeholder:props.placeholder,disabled:disabled||!revision||needsReview||guiCheckedOut}),
    deskButton(props.button||L('交给 DSH 中的 AI','Draft for AI in DSH'),draft,disabled||!revision||needsReview||guiCheckedOut||!brief.trim(),true),
    h('p',{className:'ck-muted'},L('你写需求，AI 决定对象与参数并生成新修订。会话草稿需要你发送，出稿后再人工审阅。','Describe the goal. The agent chooses objects and parameters and creates a new revision. Send the draft and review the result yourself.')),
    requests.map(function(r){var ready=r.status==='ready_for_review'&&r.resultRevisionId===revision?.id;var active=r.status==='requested'&&r.baseRevisionId===revision?.id;
      function review(decision){studio.action('/studio/editor/ai-review',{requestId:r.id,revisionId:revision.id,decision:decision},true);}
      return h('section',{className:'ck-desk-parts',key:r.id},h('strong',null,studio.t({requested:'aiRequested',ready_for_review:'aiReady',approved:'aiApproved',rejected:'aiRejected'}[r.status]||'aiRequested')+' · '+r.id.slice(0,8)),h('p',{className:'ck-desk-brief'},r.prompt),
        state.lastDraft?.id===r.id?h(DeskHandoffCopy,{studio:studio,result:state.lastDraft,lang:props.lang,disabled:disabled}):null,
        active?deskButton(L('再次准备同一草稿','Draft this request again'),function(){studio.handoffAiEdit('/studio/editor/ai-handoff',{requestId:r.id},false);},disabled):null,
        ready?h('div',{className:'ck-row'},deskButton(L('批准此修订','Approve this revision'),function(){review('approve');},disabled,true),deskButton(L('退回并恢复原修订','Reject and restore parent'),function(){review('reject');},disabled)):null);})));
}
function DeskImageChoice(props) {
  var L=function(z,e){return deskText(props.lang,z,e);},p=props.project,slot=props.slot,id=slot==='source'?p.assets?.selected?.source:slot==='overlay'?p.editor?.view?.overlayAssetId:p.views?.[slot]?.assetId;
  var choices=(p.assets?.items||[]).filter(function(a){return a.kind==='image'&&a.slotId===slot;});
  var legacy=slot==='source'&&!id&&!!p.characterSpec?.sourceImages?.length;
  if(!choices.length&&!legacy)return null;
  function clear(){props.studio.action('/studio/assets/clear-image',{slotId:slot,expectedAssetId:id||null,expectedRevision:p.stateRevision},true);}
  return h('div',{className:'ck-config-row'},deskSelect(L('采用哪一张','Active image'),id|| (legacy?'legacy':''),[['',L('不选图','No image selected')]].concat(legacy?[['legacy',L('旧工程路径原画','Legacy path original')]]:[],choices.map(function(a){return [a.id,(a.label||a.id)+' · '+(a.sha256||a.id).slice(0,7)];})),function(v){if(!v){if(id||legacy)clear();}else if(v!=='legacy')props.studio.action('/studio/assets/select',{assetId:v,expectedRevision:p.stateRevision},true);},props.busy),
    p.views?.[slot]?.status==='stale'&&id?deskButton(L('重新采用此图','Re-adopt this image'),function(){props.studio.action('/studio/assets/select',{assetId:id,expectedRevision:p.stateRevision},true);},props.busy):null,
    id||legacy?deskButton(L('取消采用（保留图片）','Clear selection (keep image)'),clear,props.busy):null);
}
function DeskViewport(props) {
  var L=function(zh,en){return deskText(props.lang,zh,en);};
  var camera=React.useState('front'),wire=React.useState(false),guide=React.useState(false),fit=React.useState(0);
  var directions=[['front',L('正','Front')],['left',L('左','Left')],['right',L('右','Right')],['back',L('背','Back')],['top',L('顶','Top')],['perspective','3D']];
  return h('div',{className:'ck-desk-viewport'},
    h('div',{className:'ck-desk-views','aria-label':L('视角与显示','Viewport controls')},directions.map(function(d){return h('button',{type:'button',key:d[0],'aria-pressed':camera[0]===d[0],onClick:function(){camera[1](d[0]);}},d[1]);}),
      h('button',{type:'button',onClick:function(){fit[1](fit[0]+1);}},L('适配','Fit')),
      h('button',{type:'button','aria-pressed':wire[0],onClick:function(){wire[1](!wire[0]);}},L('线框','Wire')),
      h('button',{type:'button','aria-pressed':guide[0],onClick:function(){guide[1](!guide[0]);}},L('导线','Guides'))),
    props.url?h(GeometryPreview,{url:props.url,lang:props.lang,camera:camera[0],fitSignal:fit[0],orthographic:true,wireframe:wire[0],guides:guide[0],motionUrl:props.motionUrl,overlayUrl:props.overlayUrl,playMotion:props.playMotion,onSelect:props.onSelect}):
      h('div',{className:'ck-desk-placeholder'},h('span',{'aria-hidden':'true'},'◇'),h('p',null,props.empty||L('选取可预览的素材后，在此检查。','Choose a previewable input to inspect it here.'))));
}
function WorkbenchWorkspace(props) {
  var studio=props.studio,state=props.state,boot=state.boot,form=state.form,project=props.projectState;
  var lang=props.lang,L=function(z,e){return deskText(lang,z,e);},busy=state.busy,go=props.selectTab;
  var stageRows=props.stages,assets=project?.assets?.items||[],items=project?.materials?.items||[];
  var route=project?.workflow?.mode||'illustration',editor=project?.editor,rev=editor?.revisions.find(function(r){return r.id===editor.activeRevisionId;});
  var running=!!editor?.pendingJob;
  var stage=stageRows.find(function(s){return s.id===(form.deskStage||project?.activeStageId);})||stageRows[0]||{id:'1_concept'};
  var step=stage?.id||'1_concept';
  function intake(stageId,role,slot,part) {
    studio.put('materialStage',stageId);studio.put('materialRole',role);if(slot)studio.put('materialSlot',slot);if(part)studio.put('materialPart',part);go('materials');
  }
  function mode(m) {
    studio.put('deskStage','');studio.put('deskBaseStep','base');
    if (!project) {studio.put('deskInitialMode',m);return;}
    if (m!==route) studio.action('/studio/workflow/mode',{mode:m,expectedRevision:project.stateRevision},true);
  }
  function init() {
    studio.act(async function(){
      var saved=await studio.request('/studio/project/init',{projectDir:form.projectDir,characterPrompt:form.prompt,monthlyCreditAllowance:Number(form.allowance)});
      var fresh=await studio.refresh(false);
      if(form.deskInitialMode==='base_mesh') {
        await studio.request('/studio/workflow/mode',{projectDir:fresh.activeProjectDir,mode:'base_mesh',expectedRevision:fresh.projectState.stateRevision});
        await studio.refresh(false);
      }
      return saved;
    });
  }
  function A(id) {return assets.find(function(a){return a.id===id;});}
  function assetUrl(a) {return a?deskAssetUrl(boot,form,'assets',{id:a.id}):null;}
  function run(operation,params) {studio.action('/studio/editor/run',{operation:operation,params:params,expectedRevisionId:rev?.id||null},true);}
  function saveSpec() {studio.action('/studio/project/init',{characterPrompt:form.prompt,monthlyCreditAllowance:Number(form.allowance)},true);}
  function localField(key,label,opts) {return deskField(label,form[key],function(v){studio.put(key,v);},Object.assign({disabled:busy},opts));}
  var selectedRoute=project?route:form.deskInitialMode;
  var header=h('header',{className:'ck-desk-head'},h('div',null,h('div',{className:'ck-eyebrow'},'DSH / AVATAR STUDIO'),h('h2',null,L('角色制作工作台','Character workbench')),h('p',null,project?project.projectName:L('先打开项目目录，再创建或选择制作路线。','Open a project folder, then choose your production route.'))),
    h('div',{className:'ck-row'},
      deskButton(L('独立渲染台 ↗','Render Lab ↗'),function(){go('render');},!project),
      deskButton(L('资产与素材库','Assets & Materials'),function(){go('materials');},false),
      deskButton(L('⚙ 全局设置','⚙ Global Settings'),props.openSettings,false)));
  var modeTabs=h('div',{className:'ck-desk-modes',role:'group','aria-label':L('制作路线','Production route')},
    [['illustration','01',L('原画重建','Illustration rebuild'),L('四视图 · 候选 · 装配','Views · candidates · assembly')],['base_mesh','02',L('素体改型','Base mesh tailoring'),L('沿用拓扑 · Tripo 衣 / 发 / 饰','Keep topology · Tripo parts')]].map(function(x){return h('button',{type:'button',key:x[0],'aria-pressed':selectedRoute===x[0],disabled:busy||running,onClick:function(){mode(x[0]);}},h('span',null,x[1]),h('strong',null,x[2]),h('small',null,x[3]));}));
  var setup=h(React.Fragment,null,localField('prompt',L('角色与验收目标','Character brief'),{multiline:true,id:'workbench-f-prompt'}),
    h('div',{className:'ck-grid'},localField('allowance',L('每月额度假设','Monthly allowance assumption'),{type:'number',min:0})),
    h('div',{className:'ck-row'},deskButton(project?L('保存设定','Save brief'):L('新建此工程','Create project here'),project?saveSpec:init,busy||!boot||!form.projectDir||form.allowance===''||Number(form.allowance)<0,true)));
  if (!project) return h('div',{className:'ck-workbench'},header,modeTabs,deskCard(L('新建工程','New project'),setup));
  function pic(title,a,missing,add,slotId) {
    return h('figure',{className:'ck-desk-image'},h('figcaption',null,title),a?h('img',{src:assetUrl(a),alt:title,referrerPolicy:'no-referrer'}):h('div',{className:'ck-desk-blank'},missing||L('未采用','Not adopted')),
      slotId?h(DeskImageChoice,{studio:studio,project:project,lang:lang,slot:slotId,busy:busy}):null,
      add?deskButton(a?L('登记另一张','Register another image'):L('登记素材','Register input'),add,busy):null);
  }
  function verifyCard() {
    var active=project.activeStageId===step,record=project.stages?.[step]||{status:'pending'},ready=active&&boot.reviewReadiness?.ready;
    function checkpoint(action){studio.action('/studio/project/checkpoint',{action:action,stageId:step,notes:form.notes,expectedRevision:project.stateRevision},true);}
    return deskCard(L('人工验收','Human checkpoint'),h(React.Fragment,null,
      h('span',{className:'ck-pill','data-status':record.status},studio.t(record.status)||record.status),
      h('p',{className:'ck-muted'},stage['checkpointPrompt'+lang]||stage['summary'+lang]),
      !active?h('p',{className:'ck-muted'},L('可浏览，先完成当前检查点。','Browse only until this is the active checkpoint.')):!ready?h('p',{className:'ck-muted'},boot.reviewReadiness?.reason):null,
      active?localField('notes',L('审阅记录','Review note'),{multiline:true}):null,
      h('div',{className:'ck-row'},deskButton(L('送审','Request review'),function(){checkpoint('request_review');},busy||!ready||record.status==='awaiting_review'),
        deskButton(L('批准','Approve'),function(){checkpoint('approve');},busy||!ready||record.status!=='awaiting_review',true),
        record.status==='awaiting_review'&&active?deskButton(L('退回','Reject'),function(){checkpoint('reject');},busy):null,
        active?deskButton(L('交给 DSH 会话','Draft stage in DSH'),props.handoff,busy):null)));
  }
  var source=A(project.assets?.selected?.source);
  var motion=items.find(function(i){return i.id===form.materialMotionId&&i.intent==='motion';});
  var sibling=rev?.parentId&&editor?.revisions.find(function(r){return r.id===rev.parentId;});
  var underReview=(editor?.requests||[]).some(function(r){return r.status==='ready_for_review'&&r.resultRevisionId===rev?.id;});
  var shown=form.deskReviewOriginal&&underReview&&sibling?sibling:rev;
  var activePreview=shown?h(React.Fragment,null,
    underReview&&sibling?h(DeskSwitch,{label:L('审阅前后修订','Compare before and after'),value:shown.id===rev.id?'after':'before',options:[['before',L('修改前','Before')],['after',L('AI 修改后','AI draft')]],change:function(v){studio.put('deskReviewOriginal',v==='before');},disabled:busy}):null,
    h(DeskViewport,{lang:lang,url:deskAssetUrl(boot,form,'editor',{revisionId:shown.id,kind:shown.artifacts.vrm?'vrm':'preview'}),motionUrl:shown.artifacts.vrm&&motion?studioMaterialUrl(form,boot,motion):null,
    overlayUrl:shown && form.overlayId ? assetUrl(A(form.overlayId)) : null,playMotion:Boolean(form.playMotion),
    onSelect:function(n){studio.put('selectedObject',shown.id===rev.id?n:'');}})):h(DeskViewport,{lang:lang,empty:L('尚无活动 Blender 修订。','No active Blender revision yet.')});

  if (route==='illustration') {
    var stepLabels=[L('原画','Original'),L('拆件视图','Part views'),L('头体候选','Candidates'),L('装配比例','Assembly'),L('权重动作','Motion'),L('VRM 复核','VRM review')];
    var rail=h('nav',{className:'ck-desk-phases','aria-label':L('原画重建六关','Six illustration stages')},stageRows.map(function(s,i){return h('button',{type:'button',key:s.id,'aria-pressed':s.id===step,'aria-current':s.id===project.activeStageId?'step':undefined,'data-status':project.stages?.[s.id]?.status||'pending','data-done':project.stages?.[s.id]?.status==='completed',onClick:function(){studio.put('deskStage',s.id);}},h('span',null,'0'+(i+1)),stepLabels[i]||s['title'+lang]||s.id);}));
    var main,right;
    if (step==='1_concept') {
      main=h('div',{className:'ck-desk-columns'},pic(L('原画','Original'),source,L('导入后另行采用；原画不占 11 个槽。','Adopt after import. The original is separate from the 11 views.'),function(){intake(step,'original');},'source'),deskCard(L('设定与预算','Brief and budget'),setup));
      right=verifyCard();
    } else if(step==='2_views') {
      var views=boot.requiredViewSlots||[],angle=form.deskAngle;
      function slot(key){var slotId=key+'_'+angle,v=views.find(function(x){return x.id===slotId;}),current=project.views?.[slotId];
        return v?pic(v['label'+lang],current?.status==='ready'?A(current.assetId):null,current?.status==='stale'?L('原画已改，请重新采用','Source changed; re-adopt'):null,function(){intake(step,'turnaround',slotId);},slotId):null;
      }
      var ready=views.filter(function(v){return project.views?.[v.id]?.status==='ready';}).length;
      main=h('div',{className:'ck-desk-gallery'},pic(L('原画','Original'),source,null,function(){intake('1_concept','original');},'source'),
        deskCard(L('同角度头体对照','Shared-angle head/body comparison'),h(React.Fragment,null,
          h('div',{className:'ck-desk-views'},[['front',L('正面','Front')],['right',L('右侧','Right')],['left',L('左侧','Left')],['back',L('背面','Back')]].map(function(x){return h('button',{type:'button',key:x[0],'aria-pressed':x[0]===angle,onClick:function(){studio.put('deskAngle',x[0]);}},x[1]);})),
          h('div',{className:'ck-desk-pair','data-guides':form.deskImageGuides},slot('head'),slot('body')),
          h('label',null,h('input',{type:'checkbox',checked:form.deskImageGuides,onChange:function(e){studio.put('deskImageGuides',e.target.checked);}}),L('显示水平对照线（不变换原图）','Show horizontal guides (no image transforms)')),
          slot('balance'))));
      right=h(React.Fragment,null,deskCard(L('图像准备','Image prep'),h(React.Fragment,null,h('strong',null,ready+' / 11'),h('progress',{className:'ck-progress',max:11,value:ready}),
        h('p',{className:'ck-muted'},L('先对正面，头发随头，无头身体严格 T-Pose；比例图在正 / 右 / 背三角度单独导入。','Align the front first; include hair with the head, omit the head from the T-pose body. Import three balance views separately.')),
        deskButton(L('Qwen / Anima / NovelAI 与 AA','Qwen / Anima / NovelAI and AA'),function(){go('models');},busy,true))),verifyCard());
    } else if(step==='3_tripo') {
      var part=form.deskPart,list=assets.filter(function(a){return a.kind==='glb' && a.part===part && a.renderable;});
      var picked=list.find(function(a){return a.id===form.deskCandidate;})||list.find(function(a){return a.id===project.assets?.selected?.[part];})||list[0];
      main=h(DeskViewport,{lang:lang,url:assetUrl(picked)});
      right=h(React.Fragment,null,deskCard(L('候选编号与采用','Candidate selection'),h(React.Fragment,null,
        deskSelect(L('对照部位','Part'),part,[['head',L('头 + 发','Head + hair')],['body',L('无头 T-Pose 身体','Headless T-pose body')]],function(k){studio.put('deskPart',k);studio.put('deskCandidate','');},busy),
        deskSelect(L('浏览候选','Browse candidate'),picked?.id||'',[['',L('无可用模型','No model')]].concat(list.map(function(a,i){return [a.id,'#'+(i+1)+' · '+(a.label||a.id.slice(0,14))];})),function(id){studio.put('deskCandidate',id);},busy),
        h('div',{className:'ck-row'},deskButton(L('登记 GLB','Register GLB'),function(){intake(step,'part_candidate',null,part);},busy),
          deskButton(L('采用当前候选','Adopt candidate'),function(){studio.action('/studio/assets/select',{assetId:picked.id,expectedRevision:project.stateRevision},true);},busy||!picked||project.assets?.selected?.[part]===picked.id,true)),
        h('p',{className:'ck-muted'},L('头 / 体已采用','Adopted head / body')+' · '+['head','body'].map(function(k){return A(project.assets?.selected?.[k])?.label||'—';}).join(' / ')),
        deskButton(L('检查 Tripo 费用与账本','Check Tripo quote and ledger'),function(){go('tripo');},busy))),h(DeskTripoStudio,{studio:studio,state:state,projectState:project,lang:lang,register:intake}),verifyCard());
    } else {
      main=activePreview;
      var editIntent=step==='4_assembly'?'placement':step==='5_rig_spring'?'rigging':'delivery';
      var placement=h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:editIntent,
        title:step==='4_assembly'?L('AI 装配对位','AI part placement'):step==='5_rig_spring'?L('AI 权重与动作检查','AI weight and motion checks'):L('AI 导出接力','AI delivery handoff'),
        objects:form.selectedObject&&(rev?.audit?.objects||[]).some(function(o){return !o.helper&&o.name===form.selectedObject;})?[form.selectedObject]:[],
        defaultBrief:step==='4_assembly'?L('检查头、身与颈部的位置和比例；选合适的工序小幅对位，在新修订上保留可回退基线。','Inspect head, body and neck alignment, then make a conservative placement draft.'):''});
      right=h(React.Fragment,null,placement,deskCard(stage['title'+lang],h(React.Fragment,null,
        h('p',{className:'ck-muted'},stage['artifact'+lang]),
        h('p',{className:'ck-desk-meta'},rev?rev.id.slice(0,8)+' · '+rev.operation:L('无活动修订','No active revision')),
        h('div',{className:'ck-row'},deskButton(L('打开模型编辑','Open model editor'),function(){go('editor');},busy,true),
          deskButton(L('准备 Blender','Prepare Blender'),function(){go('blender');},busy)),
        step==='4_assembly'&&project.blenderState?.activeBlendFile?deskButton(L('接入已核验的检查点','Import verified checkpoint'),function(){run('import_checkpoint',form.vrmAddonPath ? { vrmAddonPath: form.vrmAddonPath } : {});},busy||running):null,
        step!=='4_assembly'?deskSelect(L('动作参考 VRMA','VRMA motion reference'),form.materialMotionId,[['',L('不加载','None')]].concat(items.filter(function(x){return x.intent==='motion';}).map(function(x){return [x.id,x.fileName];})),function(id){studio.put('materialMotionId',id);},busy):null,
        step==='6_expressions_vrm'?deskButton(L('另开渲染台','Open independent render studio'),function(){go('render');},!rev):null)),verifyCard());
    }
    return h('div',{className:'ck-workbench','data-workflow':'illustration'},header,modeTabs,h('div',{className:'ck-row'},rail,deskButton(L('导入本步素材','Register stage inputs'),function(){intake(step,'');},busy)),h('div',{className:'ck-desk-split'},h('div',{className:'ck-desk-main'},main),h('aside',{className:'ck-desk-inspector'},right)));
  }

  var foundation=project.workflow?.foundation||{body:null,head:null},body=items.find(function(m){return m.id===foundation.body;});
  var isBase=false,walk=rev,seen=new Set();
  while (walk&&!seen.has(walk.id)) {
    if(['import_blend','import_checkpoint','import_material_scene'].includes(walk.operation)){isBase=walk.materialInput?.role==='foundation_body'&&walk.materialInput.id===foundation.body;break;}
    seen.add(walk.id);walk=editor?.revisions.find(function(r){return r.id===walk.parentId;});
  }
  var pending=busy||running;
  var baseStep=form.deskBaseStep;
  function adopt(part,id) {if(id)studio.action('/studio/workflow/foundation',{part:part,materialId:id,expectedRevision:project.stateRevision},true);}
  function bodyOptions(role) {return items.filter(function(i){return i.role===role;}).map(function(i){return [i.id,i.fileName+' · '+i.sha256.slice(0,8)];});}
  function importBase(){if(window.confirm(studio.t('materialTrustBlend')))run('import_material_scene',Object.assign({ materialId: body.id }, form.vrmAddonPath ? { vrmAddonPath: form.vrmAddonPath } : {}));}
  var phase=h('nav',{className:'ck-desk-phases','aria-label':L('素体改型步骤','Base mesh phases')},[
    ['base',L('选体与头','Foundations')],['fit',L('拉伸和塑形','Proportions')],['parts',L('Tripo 衣 / 发 / 饰','Tripo parts')],['review',L('动作 / VRM','Motion / VRM')]
  ].map(function(x,i){return h('button',{type:'button',key:x[0],'aria-pressed':x[0]===baseStep,onClick:function(){studio.put('deskBaseStep',x[0]);}},h('span',null,'0'+(i+1)),x[1]);}));
  var foundationCard=deskCard(L('本机素体与头模','Local body and head foundations'),h(React.Fragment,null,
    h('p',{className:'ck-desk-meta'},'YUMEKA · Yumeka_Body + Body'),
    h('p',{className:'ck-muted'},L('优先同骨架的素体与面部，保留 UV、眼部权重和表情键。未附任何参考模型；请自行登记可信、贴图已打包的 Blend。','Prefer the same rig and face to retain UVs, eye weights and expressions. No donor models are distributed; register a trusted Blend with packed textures.')),
    deskButton(L('登记素体 Blend','Register body Blend'),function(){intake('4_assembly','foundation_body');},pending),
    deskSelect(L('采用素体（不打开场景）','Adopt body (without opening it)'),foundation.body||'',[['',L('先登记','Register first')]].concat(bodyOptions('foundation_body')),function(id){adopt('body',id);},pending),
    deskButton(L('读取采用的素体，建 Blender 修订','Open adopted body as a Blender revision'),importBase,!body||pending,true),
    deskButton(L('登记外部头模 Blend','Register donor head Blend'),function(){intake('4_assembly','foundation_head');},pending),
    deskSelect(L('采用头模','Adopt head'),foundation.head||'',[['',L('未选择','Not selected')],['embedded',L('保留随素体的同源面部','Keep the embedded matching face')]].concat(bodyOptions('foundation_head')),function(id){adopt('head',id);},pending),
    h('p',{className:'ck-muted'},L('备选：RINNE 轻拓扑无完整脸。跨源先查颈圈、比例、眼球与口腔，不自动缝合。','Reserve: light-topology RINNE body without a complete face. A different head needs neck, scale, eyes and mouth checks; no automatic weld.'))));
  var fitCard=h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:'foundation_fit',disabled:!isBase,
    title:L('AI 保拓扑拉伸与塑形','AI topology-preserving fit'),button:L('让 AI 拉伸与塑形','Ask AI to fit proportions'),
    info:L('AI 会读取当前骨架、网格、尺寸与形态键，决定保拓扑的缩放或塑形。你不用填写 XYZ 或选键。','The agent checks the current rig, mesh, dimensions and morphs before deciding how to fit. No manual XYZ or key picking.'),
    placeholder:L('例：身形稍高、肩窄一点，保持头模、骨架、UV 和脚底位置。','Example: make the body slightly taller with narrower shoulders, keeping the face, rig, UVs and foot placement.')});
  var graftCard=foundation.head&&foundation.head!=='embedded'?h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:'foundation_head',disabled:!isBase,
    title:L('AI 评估与对版外部头模','AI donor head assessment and fit'),info:L('AI 先核对已采用供体与眼口、颈圈。若无法识别对象或确认不兼容，停下说明；不会自动称为无缝焊接或眼骨重绑。','The agent checks the adopted donor and the eyes, mouth and neck. If parts cannot be identified or do not fit, it stops; no claim of seamless welding or eye-rig retarget.') }):null;
  var kitKinds=[['clothing',L('服装','Clothing')],['hair',L('头发','Hair')],['accessory',L('配饰','Accessory')]];
  var materialParts=items.filter(function(m){return m.role==='tripo_'+form.studioObjectPart;});
  var returnPick=materialParts.find(function(m){return m.id===form.studioPartPreview;});
  var partsCard=h(React.Fragment,null,h(DeskTripoStudio,{studio:studio,state:state,projectState:project,lang:lang,register:intake}),
    deskCard(L('比较 GLB 并追加选中的部件','Compare GLBs and append the chosen part'),h(React.Fragment,null,
      deskSelect(L('比较哪类部件','Part to compare'),form.studioObjectPart,kitKinds,function(v){studio.put('studioObjectPart',v);studio.put('studioPartPreview','');},busy),
      deskSelect(L('预览返回的 GLB','Preview a returned GLB'),returnPick?.id||'',[['',L('查看当前素体','View current base')]].concat(materialParts.map(function(m){return [m.id,m.fileName+' · '+m.sha256.slice(0,8)];})),function(v){studio.put('studioPartPreview',v);},busy),
      deskButton(L('追加此候选到素体修订','Append this candidate to base revision'),function(){run('append_material_mesh',{materialId:returnPick.id});},pending||!returnPick||!isBase,true),
      deskButton(L('登记外部 GLB（不采用）','Register external GLB without adoption'),function(){intake('4_assembly','tripo_'+form.studioObjectPart);},busy),
      deskButton(L('打开 Tripo 人工账本','Open manual Tripo ledger'),function(){go('tripo');},busy))));
  var review=deskCard(L('动作、权重与导出','Motion, weights and export'),h(React.Fragment,null,
    h('p',{className:'ck-muted'},L('检查肩肘、胸腰、颈缝、眼口与穿模。服装与发型后绑；静态结构通过不等于可交付。','Check shoulders, elbows, torso, neck, eyes and mouth in motion. Rig clothes and hair separately. Structural checks do not certify a model.')),
    deskSelect(L('VRMA 动作参考','VRMA reference'),form.materialMotionId,[['',L('不加载','None')]].concat(items.filter(function(x){return x.intent==='motion';}).map(function(x){return [x.id,x.fileName];})),function(id){studio.put('materialMotionId',id);},pending),
    h('div',{className:'ck-row'},deskButton(L('权重、对位与导出编辑器','Weight, fit and export editor'),function(){go('editor');},busy,true),
      deskButton(L('导入动作','Import motion'),function(){intake('5_rig_spring','rig_motion');},busy),
      deskButton(L('去独立渲染台','Open render studio'),function(){go('render');},!rev))));
  return h('div',{className:'ck-workbench','data-workflow':'base_mesh'},header,modeTabs,phase,
    h('div',{className:'ck-desk-split'},h('div',{className:'ck-desk-main'},baseStep==='parts'&&returnPick?h(DeskViewport,{lang:lang,url:studioMaterialUrl(form,boot,returnPick)}):isBase?activePreview:h(DeskViewport,{lang:lang,empty:L('请先打开当前采用的素体。','Open the adopted foundation to begin.')})),
      h('aside',{className:'ck-desk-inspector'},rev?h('span',{className:'ck-chip'},L('活动修订','Active revision')+' '+rev.id.slice(0,8)):null,
        running?deskButton(L('收集 Blender 编辑作业','Collect editor job'),function(){studio.action('/studio/editor/collect',{},true);},busy):null,
        baseStep==='base'?foundationCard:baseStep==='fit'?h(React.Fragment,null,fitCard,graftCard):baseStep==='parts'?partsCard:h(React.Fragment,null,review,h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:'rigging',disabled:!isBase,title:L('AI 检修权重和动作','AI rig and motion repair')}),h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:'delivery',disabled:!isBase,title:L('AI 准备 VRM 导出','AI VRM delivery')})))));
}
