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
function deskTriViewUrls(boot,form,project,assetUrlFn,fallbackOverlayUrl) {
  var assets=project?.assets?.items||[],views=project?.views||{};
  function viewUrl(slotId) {
    var rec=views[slotId];
    if(!rec||rec.status!=='ready'||!rec.assetId)return null;
    var a=assets.find(function(x){return x.id===rec.assetId;});
    return a?assetUrlFn(a):null;
  }
  var out={front:viewUrl('balance_front'),right:viewUrl('balance_right'),back:viewUrl('balance_back')};
  if(!out.front&&!out.right&&!out.back&&fallbackOverlayUrl)out.front=fallbackOverlayUrl;
  return out;
}
function deskMotionUrl(boot,form,items,rev) {
  if(!rev?.artifacts?.vrm)return null;
  if(form.materialMotionId==='builtin:walk')return loopback(form.base)+'/studio/motions/builtin?access='+encodeURIComponent(boot?.sessionToken||'');
  var motion=(items||[]).find(function(i){return i.id===form.materialMotionId&&i.intent==='motion';});
  return motion?studioMaterialUrl(form,boot,motion):null;
}
function DeskCalibrationCard(props) {
  var studio=props.studio,state=props.state,project=props.projectState,rev=props.revision,form=state.form,busy=state.busy;
  var L=function(z,e){return deskText(props.lang,z,e);};
  var hist=form.calibrationHistory||{past:[],future:[]};
  var ratio=Number(form.headBodyRatio||6.3),neck=Number(form.neckScaleFactor||0.86);
  function applyValues(nextRatio,nextNeck,pushHistory) {
    var r=Math.min(8.5,Math.max(4.5,Number(nextRatio)||6.3));
    var n=Math.min(1.25,Math.max(0.6,Number(nextNeck)||0.86));
    var nextHist=pushHistory?{past:hist.past.concat([{headBodyRatio:form.headBodyRatio,neckScaleFactor:form.neckScaleFactor}]).slice(-24),future:[]}:hist;
    studio.set({form:Object.assign({},form,{headBodyRatio:r.toFixed(2),neckScaleFactor:n.toFixed(2),calibrationHistory:nextHist})});
  }
  function onRatioChange(val) {
    var r=Number(val);
    var n=form.linkHeadNeck?Math.min(1.25,Math.max(0.6,0.86*(6.3/Math.max(3.5,r)))):neck;
    applyValues(r,n,true);
  }
  function onNeckChange(val) { applyValues(ratio,Number(val),true); }
  function undo() {
    if(!hist.past.length)return;
    var prev=hist.past[hist.past.length-1];
    studio.set({form:Object.assign({},form,{headBodyRatio:prev.headBodyRatio,neckScaleFactor:prev.neckScaleFactor,calibrationHistory:{past:hist.past.slice(0,-1),future:[{headBodyRatio:form.headBodyRatio,neckScaleFactor:form.neckScaleFactor}].concat(hist.future).slice(0,24)}})});
  }
  function redo() {
    if(!hist.future.length)return;
    var nxt=hist.future[0];
    studio.set({form:Object.assign({},form,{headBodyRatio:nxt.headBodyRatio,neckScaleFactor:nxt.neckScaleFactor,calibrationHistory:{past:hist.past.concat([{headBodyRatio:form.headBodyRatio,neckScaleFactor:form.neckScaleFactor}]).slice(-24),future:hist.future.slice(1)}})});
  }
  function saveProjectRatios() {
    studio.action('/studio/project/init',{headBodyRatio:ratio,neckScaleFactor:neck},true);
  }
  function draftRatioOp() {
    var isBaseRoute=(project?.workflow?.mode||'illustration')==='base_mesh';
    var opHint=isBaseRoute?'fit_foundation':'head_scale';
    var channelPref=project?.editor?.channelPreference||form.blenderChannel||'auto';
    var prompt=L('请按目标头身比 '+ratio.toFixed(2)+'、颈部缩放 '+neck.toFixed(2)+' 与目标身高 '+Number(form.targetHeightM||1.6).toFixed(2)+'m，在当前修订执行 '+opHint+' 保拓扑校准。','Calibrate proportions in the active revision using '+opHint+' toward headBodyRatio='+ratio.toFixed(2)+', neckScaleFactor='+neck.toFixed(2)+', targetHeightM='+Number(form.targetHeightM||1.6).toFixed(2)+'m.');
    studio.handoffAiEdit('/studio/editor/ai-request',{prompt:prompt,objects:[],camera:form.editorCamera||'front',expectedRevisionId:rev.id,intent:isBaseRoute?'foundation_fit':'placement',channelPreference:channelPref},true);
  }
  var guiCheckedOut=project?.editor?.guiCheckout?.status==='checked_out';
  return deskCard(L('3D 比例校准与参考对齐','3D proportion calibration & alignment'),h('div',{className:'ck-config-row'},
    h('div',{className:'ck-grid'},
      h('label',{className:'ck-field'},h('span',null,L('头身比 ('+ratio.toFixed(2)+')','Head-body ratio ('+ratio.toFixed(2)+')')),
        h('input',{type:'range',min:'4.5',max:'8.5',step:'0.05',value:String(ratio),disabled:busy,onChange:function(e){onRatioChange(e.target.value);}})),
      h('label',{className:'ck-field'},h('span',null,L('颈部缩放 ('+neck.toFixed(2)+'x)','Neck scale ('+neck.toFixed(2)+'x)')),
        h('input',{type:'range',min:'0.60',max:'1.25',step:'0.01',value:String(neck),disabled:busy,onChange:function(e){onNeckChange(e.target.value);}}))),
    h('div',{className:'ck-grid'},
      deskField(L('目标身高 (m)','Target height (m)'),form.targetHeightM||'1.60',function(v){studio.put('targetHeightM',v);},{type:'number',min:'0.5',max:'3.0',step:'0.01',disabled:busy}),
      h('label',{className:'ck-field'},h('span',null,L('3D 三视图透明度 ('+Number(form.triViewOpacity||0.35).toFixed(2)+')','3D tri-view opacity ('+Number(form.triViewOpacity||0.35).toFixed(2)+')')),
        h('input',{type:'range',min:'0.05',max:'1.00',step:'0.05',value:String(form.triViewOpacity||0.35),disabled:busy,onChange:function(e){studio.put('triViewOpacity',e.target.value);}}))),
    h('label',{className:'ck-row'},h('input',{type:'checkbox',checked:!!form.linkHeadNeck,disabled:busy,onChange:function(e){studio.put('linkHeadNeck',e.target.checked);}}),L('联动头身比与颈部缩放','Link head-body ratio and neck scale')),
    h('div',{className:'ck-row'},
      deskButton(L('撤销','Undo'),undo,busy||!hist.past.length),
      deskButton(L('重做','Redo'),redo,busy||!hist.future.length),
      deskButton(L('保存比例设定','Save project ratios'),saveProjectRatios,busy||!project),
      rev?deskButton(L('生成比例校准草稿','Draft ratio calibration'),draftRatioOp,busy||!!project?.editor?.pendingJob||guiCheckedOut,true):null)));
}
function DeskPhysicsAuditCard(props) {
  var studio=props.studio,state=props.state,project=props.projectState,rev=props.revision,form=state.form,busy=state.busy;
  var L=function(z,e){return deskText(props.lang,z,e);};
  var guiCheckedOut=project?.editor?.guiCheckout?.status==='checked_out';
  var pending=busy||!!project?.editor?.pendingJob||guiCheckedOut||!rev;
  function draftPhysicsAudit() {
    var channelPref=project?.editor?.channelPreference||form.blenderChannel||'auto';
    var prompt=L('请对当前修订执行 physics_oscillation_audit（frames=24, amplitudeDeg=30, compareSpringOff=true），对比 SpringBone ON/OFF 摆幅与穿模变化。','Run physics_oscillation_audit (frames=24, amplitudeDeg=30, compareSpringOff=true) on the active revision to compare SpringBone ON vs OFF oscillation and overlaps.');
    studio.handoffAiEdit('/studio/editor/ai-request',{prompt:prompt,objects:[],camera:form.editorCamera||'front',expectedRevisionId:rev.id,intent:'rigging',channelPreference:channelPref},true);
  }
  return deskCard(L('物理 ON/OFF 抖动与穿模对比','Physics ON/OFF oscillation audit'),h('div',{className:'ck-config-row'},
    h('p',{className:'ck-muted'},L('对比 SpringBone 开启与关闭时的受控摆动幅度和 BVHTree 穿模数。','Compare SpringBone ON vs OFF bone displacement and BVHTree overlap counts across a controlled oscillation sweep.')),
    deskButton(L('生成物理 ON/OFF 排查草稿','Draft Physics ON/OFF Check'),draftPhysicsAudit,pending,true)));
}
function DeskExpressionLab(props) {
  var studio=props.studio,state=props.state,project=props.projectState,rev=props.revision,form=state.form,busy=state.busy;
  var L=function(z,e){return deskText(props.lang,z,e);};
  var groups=[
    {id:'blink',label:L('眨眼','Blink'),keys:['blink','blinkLeft','blinkRight']},
    {id:'visemes',label:L('口型','Visemes'),keys:['aa','ih','ou','ee','oh']},
    {id:'emotions',label:L('情绪','Emotions'),keys:['happy','angry','sad','relaxed','surprised','neutral']},
  ];
  var allKeys=groups.reduce(function(acc,g){return acc.concat(g.keys);},[]);
  var selected=Array.isArray(form.expressionPresets)?form.expressionPresets:allKeys;
  function toggle(k) {
    var next=selected.includes(k)?selected.filter(function(x){return x!==k;}):selected.concat([k]);
    studio.put('expressionPresets',next);
  }
  function draftExpressions() {
    var channelPref=project?.editor?.channelPreference||form.blenderChannel||'auto';
    var list=selected.length?selected:allKeys;
    var prompt=L('请使用 Clean-Room 表情实验室（expression_lab）为当前修订创建独立表情形态键并绑定 VRM 1.0 预设（排除头发顶点避免面部偏移），预设清单：','Run Clean-Room Expression Lab (expression_lab) on the active revision with hair-isolated face bounding box and VRM 1.0 preset binding for: ')+list.join(', ');
    studio.handoffAiEdit('/studio/editor/ai-request',{prompt:prompt,objects:[],camera:form.editorCamera||'front',expectedRevisionId:rev.id,intent:'expressions',channelPreference:channelPref},true);
  }
  var guiCheckedOut=project?.editor?.guiCheckout?.status==='checked_out';
  var disabled=busy||!!project?.editor?.pendingJob||guiCheckedOut||!rev;
  return deskCard(L('Clean-Room 表情实验室','Clean-Room Expression Lab'),h('div',{className:'ck-config-row'},
    h('p',{className:'ck-muted'},L('使用脸部隔离包围盒生成眨眼、口型与情绪形态键并绑定 VRM 1.0（排除头发顶点）。','Generate isolated blink, viseme and emotion shape keys (excluding hair vertices) and bind VRM 1.0 expression presets.')),
    h('div',{className:'ck-row'},
      deskButton(L('全选 14 项','All 14'),function(){studio.put('expressionPresets',allKeys.slice());},busy),
      deskButton(L('眨眼 + 口型','Blink + Visemes'),function(){studio.put('expressionPresets',['blink','blinkLeft','blinkRight','aa','ih','ou','ee','oh']);},busy),
      deskButton(L('情绪','Emotions'),function(){studio.put('expressionPresets',['happy','angry','sad','relaxed','surprised','neutral']);},busy)),
    groups.map(function(g){
      return h('div',{key:g.id,className:'ck-config-row'},
        h('small',{className:'ck-desk-meta'},g.label),
        h('div',{className:'ck-expr-chips'},g.keys.map(function(k){
          var active=selected.includes(k);
          return h('button',{type:'button',key:k,className:'ck-expr-chip','data-selected':active,'aria-pressed':active,disabled:busy,onClick:function(){toggle(k);}},k);
        })));
    }),
    deskButton(L('生成表情实验室草稿','Draft Expression Lab'),draftExpressions,disabled||!selected.length,true)));
}
function DeskVrmMetadataExport(props) {
  var studio=props.studio,state=props.state,boot=state.boot,project=props.projectState,rev=props.revision,form=state.form,busy=state.busy;
  var L=function(z,e){return deskText(props.lang,z,e);};
  var hasVrm=Boolean(rev?.artifacts?.vrm||project?.vrmMetadata?.exportedVrmPath);
  function exportPatched() {
    studio.act(async function () {
      var authors=String(form.vrmMetaAuthors||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
      var res=await studio.request('/studio/vrm/export-meta',{
        projectDir:boot?.activeProjectDir||form.projectDir,
        revisionId:rev?.artifacts?.vrm?rev.id:undefined,
        saveToProject:true,
        meta:{
          title:(form.vrmMetaTitle||project?.projectName||'MyVrmAvatar').trim(),
          version:(form.vrmMetaVersion||'1.0.0').trim(),
          authors:authors.length?authors:['Avatar Studio User'],
          commercialUsage:form.vrmMetaCommercialUsage||'personalNonProfit',
          allowRedistribution:Boolean(form.vrmMetaAllowRedistribution),
          modification:form.vrmMetaModification||'prohibited',
        },
      });
      if(res?.vrmBase64 && typeof atob==='function' && typeof Blob==='function' && typeof document!=='undefined'){
        var binStr=atob(res.vrmBase64),bytes=new Uint8Array(binStr.length);
        for(var i=0;i<binStr.length;i++)bytes[i]=binStr.charCodeAt(i);
        var blob=new Blob([bytes],{type:'model/gltf-binary'});
        var href=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=href;link.download=res.fileName||'avatar.vrm';document.body.appendChild(link);link.click();link.remove();
        setTimeout(function(){URL.revokeObjectURL(href);},3000);
      }
      await studio.refresh(false);
      return res;
    });
  }
  return deskCard(L('无 Agent 一键写入 VRM 元数据并导出','One-click VRM metadata export (agent-free)'),h('div',{className:'ck-config-row'},
    h('p',{className:'ck-muted'},L('直接修补 GLB 2.0 中的 VRMC_vrm 1.0 JSON 元数据并保留 BIN 网格字节不变，无需经过 Blender 或 Agent。','Patch VRMC_vrm 1.0 JSON metadata in-place with verbatim BIN chunk preservation and download the .vrm directly.')),
    !hasVrm?h('p',{className:'ck-callout'},L('先在工作台或编辑器导出一次 VRM 1.0（export_vrm），即可直接修补元数据并下载。','Export a VRM 1.0 revision first before patching and downloading metadata.')):null,
    h('div',{className:'ck-grid'},
      deskField(L('角色标题 (Title)','Title'),form.vrmMetaTitle||'',function(v){studio.put('vrmMetaTitle',v);},{disabled:busy}),
      deskField(L('版本号 (Version)','Version'),form.vrmMetaVersion||'1.0.0',function(v){studio.put('vrmMetaVersion',v);},{disabled:busy})),
    deskField(L('作者列表（逗号分隔）','Authors (comma-separated)'),form.vrmMetaAuthors||'',function(v){studio.put('vrmMetaAuthors',v);},{disabled:busy,placeholder:'Creator A, Creator B'}),
    h('div',{className:'ck-grid'},
      deskSelect(L('商业用途 (Commercial Usage)','Commercial Usage'),form.vrmMetaCommercialUsage||'personalNonProfit',[
        ['personalNonProfit',L('个人非营利','Personal non-profit')],
        ['personalProfit',L('个人营利','Personal profit')],
        ['corporation',L('企业/商业','Corporation')],
      ],function(v){studio.put('vrmMetaCommercialUsage',v);},busy),
      deskSelect(L('允许二次修改 (Modification)','Modification'),form.vrmMetaModification||'prohibited',[
        ['prohibited',L('禁止修改','Prohibited')],
        ['allowModification',L('允许修改','Allow modification')],
        ['allowModificationRedistribution',L('允许修改与再分发','Allow modification & redistribution')],
      ],function(v){studio.put('vrmMetaModification',v);},busy)),
    h('label',{className:'ck-row'},h('input',{type:'checkbox',checked:!!form.vrmMetaAllowRedistribution,disabled:busy,onChange:function(e){studio.put('vrmMetaAllowRedistribution',e.target.checked);}}),L('允许再分发 (Allow Redistribution)','Allow redistribution')),
    deskButton(L('写入元数据并下载 .vrm','Export Patched VRM'),exportPatched,busy||!hasVrm,true)));
}
function DeskViewport(props) {
  var L=function(zh,en){return deskText(props.lang,zh,en);};
  var camera=React.useState('front'),wire=React.useState(false),guide=React.useState(false),fit=React.useState(0);
  var localTri=React.useState(false),localRuler=React.useState(true);
  var studio=props.studio,form=studio?studio.getSnapshot().form:null;
  var triOn=form?Boolean(form.triView3d):localTri[0];
  var rulerOn=form?Boolean(form.heightRuler):localRuler[0];
  function toggleTri(){if(studio)studio.put('triView3d',!triOn);else localTri[1](!triOn);}
  function toggleRuler(){if(studio)studio.put('heightRuler',!rulerOn);else localRuler[1](!rulerOn);}
  var directions=[['front',L('正','Front')],['left',L('左','Left')],['right',L('右','Right')],['back',L('背','Back')],['top',L('顶','Top')],['perspective','3D']];
  return h('div',{className:'ck-desk-viewport'},
    h('div',{className:'ck-desk-views','aria-label':L('视角与显示','Viewport controls')},directions.map(function(d){return h('button',{type:'button',key:d[0],'aria-pressed':camera[0]===d[0],onClick:function(){camera[1](d[0]);}},d[1]);}),
      h('button',{type:'button',onClick:function(){fit[1](fit[0]+1);}},L('适配','Fit')),
      h('button',{type:'button','aria-pressed':wire[0],onClick:function(){wire[1](!wire[0]);}},L('线框','Wire')),
      h('button',{type:'button','aria-pressed':guide[0],onClick:function(){guide[1](!guide[0]);}},L('导线','Guides')),
      h('button',{type:'button','aria-pressed':triOn,onClick:toggleTri},L('3D 三视图','3D Tri-View')),
      h('button',{type:'button','aria-pressed':rulerOn,onClick:toggleRuler},L('Y=0 标尺','Y=0 Ruler'))),
    props.url?h(GeometryPreview,{url:props.url,lang:props.lang,camera:camera[0],fitSignal:fit[0],orthographic:true,wireframe:wire[0],guides:guide[0],motionUrl:props.motionUrl,overlayUrl:props.overlayUrl,opacity:props.opacity,triView3d:triOn,triViewUrls:props.triViewUrls,triViewOpacity:props.triViewOpacity,heightRuler:rulerOn,targetHeightM:props.targetHeightM,headBodyRatio:props.headBodyRatio,neckScaleFactor:props.neckScaleFactor,playMotion:props.playMotion,onSelect:props.onSelect}):
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
      !active?h('p',{className:'ck-muted'},L('可浏览，先完成当前检查点。','Browse only until this is the active checkpoint.')):!ready?h('p',{className:'ck-muted'},(lang==='En'&&boot.reviewReadiness?.reasonEn)?boot.reviewReadiness.reasonEn:boot.reviewReadiness?.reason):null,
      active?localField('notes',L('审阅记录','Review note'),{multiline:true}):null,
      h('div',{className:'ck-row'},deskButton(L('送审','Request review'),function(){checkpoint('request_review');},busy||!ready||record.status==='awaiting_review'),
        deskButton(L('批准','Approve'),function(){checkpoint('approve');},busy||!ready||record.status!=='awaiting_review',true),
        record.status==='awaiting_review'&&active?deskButton(L('退回','Reject'),function(){checkpoint('reject');},busy):null,
        active?deskButton(L('交给 DSH 会话','Draft stage in DSH'),props.handoff,busy):null)));
  }
  var source=A(project.assets?.selected?.source);
  var overlayUrl=form.overlayId ? assetUrl(A(form.overlayId)) : null;
  var triViewUrls=deskTriViewUrls(boot,form,project,assetUrl,overlayUrl);
  var motionUrl=deskMotionUrl(boot,form,items,rev);
  var hasCustomOrBuiltinMotion=Boolean(form.materialMotionId==='builtin:walk'||items.some(function(x){return x.id===form.materialMotionId&&x.intent==='motion';}));
  var sibling=rev?.parentId&&editor?.revisions.find(function(r){return r.id===rev.parentId;});
  var underReview=(editor?.requests||[]).some(function(r){return r.status==='ready_for_review'&&r.resultRevisionId===rev?.id;});
  var shown=form.deskReviewOriginal&&underReview&&sibling?sibling:rev;
  var activePreview=shown?h(React.Fragment,null,
    underReview&&sibling?h(DeskSwitch,{label:L('审阅前后修订','Compare before and after'),value:shown.id===rev.id?'after':'before',options:[['before',L('修改前','Before')],['after',L('AI 修改后','AI draft')]],change:function(v){studio.put('deskReviewOriginal',v==='before');},disabled:busy}):null,
    h(DeskViewport,{studio:studio,lang:lang,url:deskAssetUrl(boot,form,'editor',{revisionId:shown.id,kind:shown.artifacts.vrm?'vrm':'preview'}),motionUrl:shown.id===rev?.id?motionUrl:null,
    overlayUrl:shown ? overlayUrl : null,opacity:Number(form.overlayOpacity||0.35),triViewUrls:triViewUrls,triViewOpacity:Number(form.triViewOpacity||form.overlayOpacity||0.35),
    targetHeightM:Number(form.targetHeightM||1.6),headBodyRatio:Number(form.headBodyRatio||6.3),neckScaleFactor:Number(form.neckScaleFactor||0.86),playMotion:Boolean(form.playMotion),
    onSelect:function(n){studio.put('selectedObject',shown.id===rev.id?n:'');}})):h(DeskViewport,{studio:studio,lang:lang,empty:L('尚无活动 Blender 修订。','No active Blender revision yet.')});

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
      right=h(React.Fragment,null,placement,
        step==='4_assembly'?h(DeskCalibrationCard,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}):null,
        step==='5_rig_spring'?h(DeskPhysicsAuditCard,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}):null,
        step==='6_expressions_vrm'?h(React.Fragment,null,
          h(DeskExpressionLab,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}),
          h(DeskVrmMetadataExport,{studio:studio,state:state,projectState:project,revision:rev,lang:lang})):null,
        deskCard(stage['title'+lang],h(React.Fragment,null,
        h('p',{className:'ck-muted'},stage['artifact'+lang]),
        h('p',{className:'ck-desk-meta'},rev?rev.id.slice(0,8)+' · '+rev.operation:L('无活动修订','No active revision')),
        h('div',{className:'ck-row'},deskButton(L('打开模型编辑','Open model editor'),function(){go('editor');},busy,true),
          deskButton(L('准备 Blender','Prepare Blender'),function(){go('blender');},busy)),
        step==='4_assembly'&&project.blenderState?.activeBlendFile?deskButton(L('接入已核验的检查点','Import verified checkpoint'),function(){run('import_checkpoint',form.vrmAddonPath ? { vrmAddonPath: form.vrmAddonPath } : {});},busy||running):null,
        step!=='4_assembly'?deskSelect(L('动作参考 VRMA','VRMA motion reference'),form.materialMotionId,[['',L('不加载','None')],['builtin:walk',L('内置漫步参考 (MIT/CC0)','Built-in walk loop (MIT/CC0)')]].concat(items.filter(function(x){return x.intent==='motion';}).map(function(x){return [x.id,x.fileName];})),function(id){studio.put('materialMotionId',id);},busy):null,
        step!=='4_assembly'&&hasCustomOrBuiltinMotion&&!rev?.artifacts?.vrm?h('p',{className:'ck-callout'},studio.t('materialMotionNeedsVrm')):null,
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
    deskSelect(L('VRMA 动作参考','VRMA reference'),form.materialMotionId,[['',L('不加载','None')],['builtin:walk',L('内置漫步参考 (MIT/CC0)','Built-in walk loop (MIT/CC0)')]].concat(items.filter(function(x){return x.intent==='motion';}).map(function(x){return [x.id,x.fileName];})),function(id){studio.put('materialMotionId',id);},pending),
    hasCustomOrBuiltinMotion&&!rev?.artifacts?.vrm?h('p',{className:'ck-callout'},studio.t('materialMotionNeedsVrm')):null,
    h('div',{className:'ck-row'},deskButton(L('权重、对位与导出编辑器','Weight, fit and export editor'),function(){go('editor');},busy,true),
      deskButton(L('导入动作','Import motion'),function(){intake('5_rig_spring','rig_motion');},busy),
      deskButton(L('去独立渲染台','Open render studio'),function(){go('render');},!rev))));
  return h('div',{className:'ck-workbench','data-workflow':'base_mesh'},header,modeTabs,phase,
    h('div',{className:'ck-desk-split'},h('div',{className:'ck-desk-main'},baseStep==='parts'&&returnPick?h(DeskViewport,{studio:studio,lang:lang,url:studioMaterialUrl(form,boot,returnPick)}):isBase?activePreview:h(DeskViewport,{studio:studio,lang:lang,empty:L('请先打开当前采用的素体。','Open the adopted foundation to begin.')})),
      h('aside',{className:'ck-desk-inspector'},rev?h('span',{className:'ck-chip'},L('活动修订','Active revision')+' '+rev.id.slice(0,8)):null,
        running?deskButton(L('收集 Blender 编辑作业','Collect editor job'),function(){studio.action('/studio/editor/collect',{},true);},busy):null,
        baseStep==='base'?foundationCard:baseStep==='fit'?h(React.Fragment,null,h(DeskCalibrationCard,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}),fitCard,graftCard):baseStep==='parts'?partsCard:h(React.Fragment,null,review,h(DeskPhysicsAuditCard,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}),h(DeskExpressionLab,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}),h(DeskVrmMetadataExport,{studio:studio,state:state,projectState:project,revision:rev,lang:lang}),h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:'rigging',disabled:!isBase,title:L('AI 检修权重和动作','AI rig and motion repair')}),h(DeskAiJob,{studio:studio,state:state,projectState:project,revision:rev,lang:lang,intent:'delivery',disabled:!isBase,title:L('AI 准备 VRM 导出','AI VRM delivery')})))));
}
