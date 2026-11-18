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
function DeskViewport(props) {
  var L=function(zh,en){return deskText(props.lang,zh,en);};
  var camera=React.useState('front'),wire=React.useState(false),guide=React.useState(false),fit=React.useState(0);
  var directions=[['front',L('正','Front')],['left',L('左','Left')],['right',L('右','Right')],['back',L('背','Back')],['top',L('顶','Top')],['perspective','3D']];
  return h('div',{className:'ck-desk-viewport'},
    h('div',{className:'ck-desk-views','aria-label':L('视角与显示','Viewport controls')},directions.map(function(d){return h('button',{type:'button',key:d[0],'aria-pressed':camera[0]===d[0],onClick:function(){camera[1](d[0]);}},d[1]);}),
      h('button',{type:'button',onClick:function(){fit[1](fit[0]+1);}},L('适配','Fit')),
      h('button',{type:'button','aria-pressed':wire[0],onClick:function(){wire[1](!wire[0]);}},L('线框','Wire')),
      h('button',{type:'button','aria-pressed':guide[0],onClick:function(){guide[1](!guide[0]);}},L('导线','Guides'))),
    props.url?h(GeometryPreview,{url:props.url,lang:props.lang,camera:camera[0],fitSignal:fit[0],orthographic:true,wireframe:wire[0],guides:guide[0],motionUrl:props.motionUrl,overlayUrl:props.overlayUrl,onSelect:props.onSelect}):
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
      var saved=await studio.request('/studio/project/init',{projectDir:form.projectDir,characterPrompt:form.prompt,sourceImage:form.source,monthlyCreditAllowance:Number(form.allowance)});
      var fresh=await studio.refresh(false);
      if(form.deskInitialMode==='base_mesh') {
        await studio.request('/studio/workflow/mode',{projectDir:fresh.activeProjectDir,mode:'base_mesh',expectedRevision:fresh.projectState.stateRevision});
        await studio.refresh(false);
      }
      return saved;
    });
  }
  function versionUrl(kind) {return rev?deskAssetUrl(boot,form,'editor',{kind:kind,revisionId:rev.id}):null;}
  function A(id) {return assets.find(function(a){return a.id===id;});}
  function assetUrl(a) {return a?deskAssetUrl(boot,form,'assets',{id:a.id}):null;}
  function run(operation,params) {studio.action('/studio/editor/run',{operation:operation,params:params,expectedRevisionId:rev?.id||null},true);}
  function saveSpec() {studio.action('/studio/project/init',{characterPrompt:form.prompt,sourceImage:form.source,monthlyCreditAllowance:Number(form.allowance)},true);}
  function localField(key,label,opts) {return deskField(label,form[key],function(v){studio.put(key,v);},Object.assign({disabled:busy},opts));}
  var selectedRoute=project?route:form.deskInitialMode;
  var header=h('header',{className:'ck-desk-head'},h('div',null,h('div',{className:'ck-eyebrow'},'DSH / AVATAR STUDIO'),h('h2',null,L('角色制作工作台','Character workbench')),h('p',null,project?project.projectName:L('先打开项目目录，再创建或选择制作路线。','Open a project folder, then choose your production route.'))),
    h('div',{className:'ck-row'},deskButton(L('项目文件','Project files'),props.openSettings,false),project?deskButton(L('渲染台 ↗','Render studio ↗'),function(){go('render');},false):null));
  var modeTabs=h('div',{className:'ck-desk-modes',role:'group','aria-label':L('制作路线','Production route')},
    [['illustration','01',L('原画重建','Illustration rebuild'),L('四视图 · 候选 · 装配','Views · candidates · assembly')],['base_mesh','02',L('素体改型','Base mesh tailoring'),L('沿用拓扑 · Tripo 衣 / 发 / 饰','Keep topology · Tripo parts')]].map(function(x){return h('button',{type:'button',key:x[0],'aria-pressed':selectedRoute===x[0],disabled:busy||running,onClick:function(){mode(x[0]);}},h('span',null,x[1]),h('strong',null,x[2]),h('small',null,x[3]));}));
  var setup=h(React.Fragment,null,localField('prompt',L('角色与验收目标','Character brief'),{multiline:true,id:'workbench-f-prompt'}),
    h('div',{className:'ck-grid'},localField('source',L('原画 PNG 本地路径（可选）','Local PNG path (optional)'),{}),localField('allowance',L('每月额度假设','Monthly allowance assumption'),{type:'number',min:0})),
    h('div',{className:'ck-row'},deskButton(project?L('保存设定','Save brief'):L('新建此工程','Create project here'),project?saveSpec:init,busy||!boot||!form.projectDir||form.allowance===''||Number(form.allowance)<0,true)));
  if (!project) return h('div',{className:'ck-workbench'},header,modeTabs,deskCard(L('新建工程','New project'),setup));
  function pic(title,a,missing,add) {
    return h('figure',{className:'ck-desk-image'},h('figcaption',null,title),a?h('img',{src:assetUrl(a),alt:title,referrerPolicy:'no-referrer'}):h('div',{className:'ck-desk-blank'},missing||L('未采用','Not adopted')),
      add?deskButton(a?L('替换素材','Replace input'):L('登记素材','Register input'),add,busy):null);
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
  var activePreview=rev?h(DeskViewport,{lang:lang,url:versionUrl(rev.artifacts.vrm?'vrm':'preview'),motionUrl:rev.artifacts.vrm&&motion?studioMaterialUrl(form,boot,motion):null,
    onSelect:function(n){studio.put('selectedObject',n);}}):h(DeskViewport,{lang:lang,empty:L('尚无活动 Blender 修订。','No active Blender revision yet.')});

  if (route==='illustration') {
    var stepLabels=[L('原画','Original'),L('拆件视图','Part views'),L('头体候选','Candidates'),L('装配比例','Assembly'),L('权重动作','Motion'),L('VRM 复核','VRM review')];
    var rail=h('nav',{className:'ck-desk-phases','aria-label':L('原画重建六关','Six illustration stages')},stageRows.map(function(s,i){return h('button',{type:'button',key:s.id,'aria-pressed':s.id===step,'aria-current':s.id===project.activeStageId?'step':undefined,'data-status':project.stages?.[s.id]?.status||'pending','data-done':project.stages?.[s.id]?.status==='completed',onClick:function(){studio.put('deskStage',s.id);}},h('span',null,'0'+(i+1)),stepLabels[i]||s['title'+lang]||s.id);}));
    var main,right;
    if (step==='1_concept') {
      main=h('div',{className:'ck-desk-columns'},pic(L('原画','Original'),source,L('导入后另行采用；原画不占 11 个槽。','Adopt after import. The original is separate from the 11 views.'),function(){intake(step,'original');}),deskCard(L('设定与预算','Brief and budget'),setup));
      right=verifyCard();
    } else if(step==='2_views') {
      var views=boot.requiredViewSlots||[],angle=form.deskAngle;
      function slot(key){var slotId=key+'_'+angle,v=views.find(function(x){return x.id===slotId;}),current=project.views?.[slotId];
        return v?pic(v['label'+lang],current?.status==='ready'?A(current.assetId):null,current?.status==='stale'?L('原画已改，请重新采用','Source changed; re-adopt'):null,function(){intake(step,'turnaround',slotId);}):null;
      }
      var ready=views.filter(function(v){return project.views?.[v.id]?.status==='ready';}).length;
      main=h('div',{className:'ck-desk-gallery'},pic(L('原画','Original'),source,null,function(){intake('1_concept','original');}),
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
        deskButton(L('检查 Tripo 费用与账本','Check Tripo quote and ledger'),function(){go('tripo');},busy))),verifyCard());
    } else {
      main=activePreview;
      var fitOptions=(rev?.audit?.objects||[]).filter(function(o){return o.type==='MESH'&&!o.helper;});
      var placement=step==='4_assembly'&&rev?deskCard(L('显式部件对位','Part placement'),h(React.Fragment,null,
        deskSelect(L('部件对象','Mesh object'),form.selectedObject,[['',L('选择部件','Choose a part')]].concat(fitOptions.map(function(o){return [o.name,o.name];})),function(n){studio.put('selectedObject',n);},busy||running),
        localField('deskAssemblyScale',L('本次统一倍率','Relative scale'),{type:'number',min:.1,max:10,step:.01}),
        h('div',{className:'ck-grid'},['X','Y','Z'].map(function(a){return h('div',{key:a},localField('deskAssembly'+a,a+' (m)',{type:'number',min:-10,max:10,step:.01}));})),
        deskButton(L('另存对位修订','Save placement revision'),function(){run('transform',{objects:[form.selectedObject],scale:[1,1,1].map(function(){return Number(form.deskAssemblyScale);}),translation:['X','Y','Z'].map(function(a){return Number(form['deskAssembly'+a]);})});},busy||running||!fitOptions.some(function(o){return o.name===form.selectedObject;}),true),
        h('p',{className:'ck-muted'},L('只变更所选网格。已有骨架时请在编辑器使用明确颈/头骨的比例操作，不在此随意缩放已蒙皮的头。','Transforms the selected mesh only. On a rigged avatar, use the explicit neck/head scaling operation instead.')))):null;
      right=h(React.Fragment,null,placement,deskCard(stage['title'+lang],h(React.Fragment,null,
        h('p',{className:'ck-muted'},stage['artifact'+lang]),
        h('p',{className:'ck-desk-meta'},rev?rev.id.slice(0,8)+' · '+rev.operation:L('无活动修订','No active revision')),
        h('div',{className:'ck-row'},deskButton(L('打开模型编辑','Open model editor'),function(){go('editor');},busy,true),
          deskButton(L('准备 Blender','Prepare Blender'),function(){go('blender');},busy)),
        step==='4_assembly'&&project.blenderState?.activeBlendFile?deskButton(L('接入已核验的检查点','Import verified checkpoint'),function(){run('import_checkpoint',{});},busy||running):null,
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
  var meshes=rev?.audit?.objects?.filter(function(o){return o.type==='MESH'&&!o.helper;})||[],rigs=rev?.audit?.objects?.filter(function(o){return o.type==='ARMATURE';})||[];
  var bodyObject=meshes.find(function(o){return o.name===form.deskBody;})||meshes.find(function(o){return /yumeka_body|sotai|skin/i.test(o.name);});
  var rig=rigs.find(function(o){return o.name===form.deskRig;})||(rigs.length===1?rigs[0]:null);
  var pending=busy||running;
  var baseStep=form.deskBaseStep;
  function adopt(part,id) {if(id)studio.action('/studio/workflow/foundation',{part:part,materialId:id,expectedRevision:project.stateRevision},true);}
  function bodyOptions(role) {return items.filter(function(i){return i.role===role;}).map(function(i){return [i.id,i.fileName+' · '+i.sha256.slice(0,8)];});}
  function importBase(){if(window.confirm(studio.t('materialTrustBlend')))run('import_material_scene',{materialId:body.id});}
  function objectNames(value){return value.split('\n').map(function(s){return s.trim();}).filter(Boolean);}
  function fitBody() {
    var params={bodyObject:bodyObject.name,armature:rig.name,scale:['deskScaleX','deskScaleY','deskScaleZ'].map(function(k){return Number(form[k]);})};
    var kept=objectNames(form.deskKeep);
    if(kept.length)params.keepMeshes=Array.from(new Set([bodyObject.name].concat(kept)));
    if(form.deskShape&&bodyObject.shapeKeys?.some(function(k){return k.name===form.deskShape;}))params.shapeValues=[{key:form.deskShape,value:Number(form.deskShapeValue)}];
    run('fit_foundation',params);
  }
  function graft() {
    if(!window.confirm(studio.t('materialTrustBlend')))return;
    var params={materialId:foundation.head,objects:objectNames(form.deskDonor),armature:rig.name,headBone:form.deskBone,
      scale:[1,1,1].map(function(){return Number(form.deskHeadScale);}),translation:['deskHeadX','deskHeadY','deskHeadZ'].map(function(k){return Number(form[k]);})};
    if(objectNames(form.deskReplace).length)params.replaceHeadObjects=objectNames(form.deskReplace);
    run('append_foundation_head',params);
  }
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
  var rigPicker=deskSelect(L('活动骨架','Active rig'),rig?.name||'',[['',L('选择骨架','Choose a rig')]].concat(rigs.map(function(o){return [o.name,o.name];})),function(k){studio.put('deskRig',k);},pending);
  var fitCard=deskCard(L('保拓扑拉伸与塑形','Topology-preserving fit'),h(React.Fragment,null,
    !isBase?h('p',{className:'ck-callout'},L('先打开采用的素体。切换路线不自动切换历史修订。','Open the adopted body first. Switching routes does not change the current revision.')):null,
    rigPicker,
    deskSelect(L('素体网格','Body mesh'),bodyObject?.name||'',[['',L('请选择','Choose')]].concat(meshes.map(function(o){return [o.name,o.name+' · '+o.vertices+' v / '+(o.uvLayers??'?')+' UV'];})),function(k){studio.put('deskBody',k);studio.put('deskShape','');},pending),
    h('div',{className:'ck-grid'},['X','Y','Z'].map(function(axis){return h('div',{key:axis},localField('deskScale'+axis,L('整架缩放 ','Rig stretch ')+axis,{type:'number',min:.75,max:1.3,step:.01}));})),
    deskSelect(L('已有形态键','Existing shape key'),form.deskShape,[['',L('不改变形态键','Leave morphs unchanged')]].concat((bodyObject?.shapeKeys||[]).map(function(s){return [s.name,s.name+' · '+s.value];})),function(k){studio.put('deskShape',k);},pending),
    form.deskShape?localField('deskShapeValue',L('形态键值 0–1','Shape weight 0–1'),{type:'number',min:0,max:1,step:.05}):null,
    h('details',{className:'ck-inline-details'},h('summary',null,L('仅保留下列网格（可选）','Keep only named rig meshes (optional)')),
      localField('deskKeep',L('每行一个对象名；空白则不隐藏','One object per line; blank hides nothing'),{multiline:true,placeholder:'Body\nYumeka_Body'}),
      h('p',{className:'ck-muted'},meshes.map(function(o){return o.name;}).join(' / '))),
    deskButton(L('生成新比例修订','Create fitted revision'),fitBody,pending||!isBase||!bodyObject||!rig,true),
    h('p',{className:'ck-muted'},L('整架与其网格绕脚底相对缩放，不重造网格；外衣若已追加请复查对版。新旧眼、口、耳、颈缝和形态键冲突都要人工检查。','Stretch the rig and bound parts around the feet without remeshing. Recheck separate clothes, eyes, mouth, ears, neck seam and morph interactions.'))));
  var graftCard=foundation.head&&foundation.head!=='embedded'?deskCard(L('跨源头模对版','Fit a separate donor head'),h(React.Fragment,null,
    h('p',{className:'ck-muted'},L('显式指定脸、眼球、口腔等对象（原文件内名称）。仅刚性跟随头骨，不转移原眼骨/表情控制器、不缝颈。','Name face, eye and mouth meshes explicitly as in the source Blend. Rigid head-bone follow only; not eye-rig retargeting or a neck weld.')),
    localField('deskDonor',L('外部头部网格名（每行一个）','Donor mesh names, one per line'),{multiline:true}),
    localField('deskReplace',L('隐藏旧头网格（可选，每行一个）','Hide existing head meshes (optional, one per line)'),{multiline:true}),
    deskSelect(L('目标头骨','Target head bone'),form.deskBone,[['',L('选择骨骼','Choose a bone')]].concat((rig?.bones||[]).map(function(n){return [n,n];})),function(n){studio.put('deskBone',n);},pending),
    h('div',{className:'ck-grid'},localField('deskHeadScale',L('头模倍率','Head scale'),{type:'number',min:.5,max:2,step:.01}),['X','Y','Z'].map(function(a){return h('div',{key:a},localField('deskHead'+a,a+' (m)',{type:'number',min:-1,max:1,step:.01}));})),
    deskButton(L('绑定头模并建立修订','Bind head in a new revision'),graft,pending||!isBase||!rig||!form.deskBone||!form.deskDonor.trim(),true))):null;
  var kitKinds=[['clothing',L('服装','Clothing')],['hair',L('头发','Hair')],['accessory',L('配饰','Accessory')]];
  var kit=state.result?.mode==='manual_parts_only'&&state.result.projectDir===boot.activeProjectDir?state.result:null;
  function plan(){studio.action('/studio/workflow/tripo-parts',{kinds:form.deskKit,budget:Number(form.deskBudget),quotedCredits:form.deskQuote===''?undefined:Number(form.deskQuote)});}
  var partsCard=deskCard(L('Tripo 零件工单','Tripo part jobs'),h(React.Fragment,null,
    h('p',{className:'ck-callout'},L('只把隔离的服装、头发或配饰参考交给 Tripo；不要上传私有素体、头模或工程。这里只做单次预案，提交和消费由人确认。','Only give Tripo isolated clothing, hair or accessory references. Do not upload the private foundations or project. This plans only; submission and cost are manual.')),
    h('div',{className:'ck-row'},kitKinds.map(function(k){return h('label',{key:k[0]},h('input',{type:'checkbox',checked:form.deskKit.includes(k[0]),disabled:busy,onChange:function(e){studio.put('deskKit',e.target.checked?form.deskKit.concat(k[0]):form.deskKit.filter(function(x){return x!==k[0];}));}}),k[1]);})),
    h('div',{className:'ck-grid'},localField('deskBudget',L('本次积分上限（手填）','Manual credit cap'),{type:'number',min:0,step:1}),localField('deskQuote',L('Tripo 实际合计报价（可留空）','Actual Tripo quote (optional)'),{type:'number',min:0,step:1})),
    deskButton(L('生成不执行工单','Plan only'),plan,busy||!body||!form.deskKit.length,true),
    kit?h('div',{className:'ck-desk-kit'},h('p',null,L('预案上限 / 报价','Plan cap / quote')+' '+kit.cap+' / '+(kit.quotedCredits??'—')+' · '+(kit.withinManualCap?L('额度内（仍需人工确认）','Within cap (manual confirmation still required)'):L('未确认可执行','Not cleared for execution'))),
      kit.tasks.map(function(job){return h('article',{key:job.kind},h('strong',null,lang==='En'?job.en:job.zh),h('p',null,job.brief),deskButton(L('复制零件工单','Copy part brief'),function(){if(studio.copy(job.brief))studio.set({notice:studio.t('copied')});},busy));})):null,
    deskButton(L('打开 Tripo 人工账本','Open manual Tripo ledger'),function(){go('tripo');},busy),
    kitKinds.map(function(k){var role='tripo_'+k[0],returned=items.filter(function(i){return i.role===role;});return h('div',{className:'ck-desk-parts',key:k[0]},h('strong',null,k[1]),
      deskButton(L('登记返回的 GLB','Register returned GLB'),function(){intake('4_assembly',role);},busy),
      returned.slice(-6).map(function(m){return h('div',{className:'ck-row',key:m.id},h('span',{className:'ck-desk-meta'},m.fileName),deskButton(L('追加到素体修订','Append to base revision'),function(){run('append_material_mesh',{materialId:m.id});},pending||!isBase));}));})));
  var review=deskCard(L('动作、权重与导出','Motion, weights and export'),h(React.Fragment,null,
    h('p',{className:'ck-muted'},L('检查肩肘、胸腰、颈缝、眼口与穿模。服装与发型后绑；静态结构通过不等于可交付。','Check shoulders, elbows, torso, neck, eyes and mouth in motion. Rig clothes and hair separately. Structural checks do not certify a model.')),
    deskSelect(L('VRMA 动作参考','VRMA reference'),form.materialMotionId,[['',L('不加载','None')]].concat(items.filter(function(x){return x.intent==='motion';}).map(function(x){return [x.id,x.fileName];})),function(id){studio.put('materialMotionId',id);},pending),
    h('div',{className:'ck-row'},deskButton(L('权重、对位与导出编辑器','Weight, fit and export editor'),function(){go('editor');},busy,true),
      deskButton(L('导入动作','Import motion'),function(){intake('5_rig_spring','rig_motion');},busy),
      deskButton(L('去独立渲染台','Open render studio'),function(){go('render');},!rev))));
  return h('div',{className:'ck-workbench','data-workflow':'base_mesh'},header,modeTabs,phase,
    h('div',{className:'ck-desk-split'},h('div',{className:'ck-desk-main'},isBase?activePreview:h(DeskViewport,{lang:lang,empty:L('请先打开当前采用的素体。','Open the adopted foundation to begin.')})),
      h('aside',{className:'ck-desk-inspector'},rev?h('span',{className:'ck-chip'},L('活动修订','Active revision')+' '+rev.id.slice(0,8)):null,
        running?deskButton(L('收集 Blender 编辑作业','Collect editor job'),function(){studio.action('/studio/editor/collect',{},true);},busy):null,
        baseStep==='base'?foundationCard:baseStep==='fit'?h(React.Fragment,null,fitCard,graftCard):baseStep==='parts'?partsCard:review)));
}
