function RenderWorkspace(props) {
  var studio=props.studio,state=props.state,project=props.projectState,boot=state.boot,form=state.form,lang=props.lang,busy=state.busy;
  var L=function(z,e){return deskText(lang,z,e);};
  var editor=project?.editor,active=editor?.revisions.find(function(r){return r.id===editor.activeRevisionId;});
  var presets=boot?.renderPresets||{},requests=(project?.rendering?.requests||[]).slice().reverse();
  var selected=requests.find(function(r){return r.id===form.deskRenderId;})||requests[0];
  var comparison=requests.find(function(r){return r.id===form.deskRenderCompare&&r.id!==selected?.id&&r.revisionId===selected?.revisionId&&r.artifacts?.png;});
  var labels={requested:L('待接力','Awaiting handoff'),rendering:L('执行中 / 待回执','Rendering / awaiting receipt'),queued:L('伴随队列','Companion queue'),ready_for_review:L('待人工审阅','Ready for review'),approved:L('已批准图像','Image approved'),rejected:L('图像已退回','Image rejected'),failed:L('未确认完成','Not confirmed')};
  function field(k,label,opts){return deskField(label,form[k],function(v){studio.put(k,v);},Object.assign({disabled:busy},opts));}
  var canCreate=!!active&&!editor?.pendingJob&&form.deskRenderBrief.trim()&&!busy;
  var gateway=boot?.blenderBridge?.protocol==='gateway-3.1';
  var stale=!!selected&&selected.revisionId!==active?.id;
  function create(useAi){
    var body={projectDir:boot.activeProjectDir,brief:form.deskRenderBrief,expectedRevisionId:active.id};
    var action=useAi?studio.handoffAiEdit('/studio/render/request',body,true):studio.action('/studio/render/request',body,true);
    action.then(function(result){if(result?.request)studio.put('deskRenderId',result.request.id);});
  }
  function phase(r){return (r.revisionId===active?.id?'':L('旧修订 · ','Old revision · '))+(labels[r.status]||r.status);}
  function outputUrl(r){return deskAssetUrl(boot,form,'render',{requestId:r.id,kind:'png'});}
  function image(r){return h('figure',{className:'ck-render-image',key:r.id},h('img',{src:outputUrl(r),alt:L('Blender 静帧 ','Blender still ')+r.id.slice(7,15),referrerPolicy:'no-referrer'}),
    h('figcaption',null,(presets[r.recipe?.preset]?.[lang==='En'?'en':'zh']||r.recipe?.preset)+' · '+r.artifacts.png.width+' × '+r.artifacts.png.height+' · '+phase(r)));}
  function save(r){
    studio.act(async function(){
      var res=await fetch(outputUrl(r),{cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw new Error(L('PNG 指纹校验或读取失败。','PNG validation or download failed.'));
      var href=URL.createObjectURL(await res.blob()),link=document.createElement('a');
      link.href=href;link.download='avatar-'+r.id.slice(7,15)+'.png';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(href);},3000);
      return null;
    });
  }
  function collectBrief(){
    var brief=L('请在原提交的 DSH 会话，用 charakuru_render 收集本机渲染。不要重发。','Collect this local render in the original DSH session with charakuru_render; do not resubmit.')+'\n'+JSON.stringify({action:'collect',projectDir:boot.activeProjectDir,requestId:selected.id});
    if(studio.insertInstructions(brief)!=='ok') {
      studio.set({lastDraft:{id:selected.id,instruction:brief,draftOutcome:'unsupported'}});
      studio.copy(brief);
    }
  }
  function review(decision){studio.action('/studio/render/review',{requestId:selected.id,expectedRevisionId:active.id,decision:decision,note:form.deskRenderNote},true);}
  var header=h('header',{className:'ck-desk-head ck-render-head'},h('div',null,
    h('div',{className:'ck-eyebrow'},'DSH / BLENDER RENDER LAB'),h('h2',null,L('独立 AI 渲染台','AI render studio')),
    h('p',null,L('从活动 Blender 修订布光、取景、渲染。模型、VRM 和制作审批均不改变。','Light, frame and render the active Blender revision. No model, VRM or project review is changed.'))),
    deskButton(L('返回制作工作台','Back to workbench'),function(){props.selectTab('pipeline');},false));
  if(!project) return h('div',{className:'ck-workbench'},header,h('p',{className:'ck-callout'},L('先打开或新建角色工程。','Open or create a character project first.')));
  var controls=deskCard(L('写下目标，交给 AI 调整','Describe the shot; AI adjusts it'),h(React.Fragment,null,
    h('p',{className:'ck-desk-meta'},active?L('活动修订 ','Active revision ')+active.id.slice(0,8)+' · '+active.artifacts.blend.sha256.slice(0,12):L('需先建立 Blender 修订','A Blender revision is required')),
    editor?.pendingJob?h('p',{className:'ck-callout'},L('请先收集编辑作业。','Collect the editor job first.')):null,
    field('deskRenderBrief',L('给 AI 的渲染要求','Render brief for AI'),{multiline:true,maxLength:4000,placeholder:L('例：酒红舞台，冷边缘光，面部不过曝，取半身。','Example: wine stage, cool rim, mid shot, protect face highlights.')}),
    h('details',{className:'ck-inline-details'},h('summary',null,L('学习参考（不作为渲染预设）','Lighting studies (not applied)')),
      h('p',{className:'ck-muted'},L('酒红舞台可以参考高反差剪影与冷边光；冷调室内可参考柔主光和低位补光；中性图便于检查建模。AI 会按本次需求另拟布光。','Wine stages suggest cool rim light and clear silhouettes; cool rooms use soft key and low fill. Neutral stills help inspect geometry. The AI makes a new choice for your request.'))),
    h('div',{className:'ck-row'},deskButton(L('登记并放入 DSH 会话','Record and draft in DSH'),function(){create(true);},!canCreate,true),
      deskButton(L('仅登记','Record only'),function(){create(false);},!canCreate)),
    h('p',{className:'ck-muted'},L('AI 只用受限本机工具产出静帧；会话草稿需你发送。没有图生图替代、自动扣费或自动通过。','AI uses a bounded local still-render tool. Send the draft yourself. No image-generation fallback, automatic charge or approval.'))));
  var history=deskCard(L('本机出图与审阅','Local output & review'),h(React.Fragment,null,
    deskSelect(L('渲染请求','Render request'),selected?.id||'',[['',L('尚无记录','No requests yet')]].concat(requests.map(function(r){return [r.id,r.id.slice(7,15)+' · '+phase(r)];})),function(id){studio.put('deskRenderId',id);studio.put('deskRenderCompare','');},busy),
    selected?h(React.Fragment,null,h('p',{className:'ck-desk-meta'},L('基线 ','Base ')+selected.revisionId.slice(0,8)+' · '+selected.blendHash.slice(0,12)),h('p',{className:'ck-desk-brief'},selected.brief),
      stale?h('p',{className:'ck-callout'},L('旧修订记录仅供查看。重新渲染请为当前修订新建请求。','This record is from an older revision. Create a request for the current revision.')):null,
      state.lastDraft?.id===selected.id?h(DeskHandoffCopy,{studio:studio,result:state.lastDraft,lang:lang,disabled:busy}):null,
      selected.status==='requested'&&!stale?deskButton(L('交给 DSH 会话','Draft for DSH'),function(){studio.handoffAiEdit('/studio/render/handoff',{requestId:selected.id},false);},busy||!!editor?.pendingJob,true):null,
      selected.status==='queued'?h('div',{className:'ck-row'},deskButton(L('接力收集回执','Draft collection handoff'),collectBrief,busy,true),
        !gateway?deskButton(L('收集回执','Collect'),function(){studio.action('/studio/render/collect',{requestId:selected.id},true);},busy):null):null,
      selected.error?h('p',{className:'ck-error-detail'},selected.error):null,
      selected.summary?h('p',{className:'ck-muted'},'Blender '+selected.summary.blenderVersion+' · '+selected.summary.meshes+' meshes · '+(selected.summary.toonMaterials||0)+' Toon'):null,
      selected.artifacts?.png?h('div',{className:'ck-row'},deskButton(L('下载 PNG','Download PNG'),function(){save(selected);},busy),
        h('small',{className:'ck-desk-meta'},selected.artifacts.png.sha256.slice(0,12))):null,
      selected.artifacts?.png?deskSelect(L('对照：同修订的另一张图','Compare another still from this revision'),comparison?.id||'',[['',L('无','None')]].concat(requests.filter(function(r){return r.id!==selected.id&&r.revisionId===selected.revisionId&&r.artifacts?.png;}).map(function(r){return [r.id,r.id.slice(7,15)+' · '+(presets[r.recipe?.preset]?.[lang==='En'?'en':'zh']||'')];})),function(id){studio.put('deskRenderCompare',id);},busy):null,
      !stale&&selected.status==='ready_for_review'?h(React.Fragment,null,
        field('deskRenderNote',L('审阅备注（选填）','Review note (optional)'),{multiline:true,maxLength:1000}),
        h('div',{className:'ck-row'},deskButton(L('批准此图','Approve image'),function(){review('approve');},busy,true),deskButton(L('退回此图','Reject image'),function(){review('reject');},busy))):null,
      selected.review?.note?h('p',{className:'ck-desk-brief'},selected.review.note):null):null));
  return h('div',{className:'ck-workbench','data-view':'render'},header,
    h('div',{className:'ck-desk-split ck-render-split'},h('div',{className:'ck-desk-main'},selected?.artifacts?.png?
      h('div',{className:'ck-render-pictures','data-compare':!!comparison},image(selected),comparison?image(comparison):null):
      h('div',{className:'ck-render-blank'},h('span',{'aria-hidden':'true'},'✦'),h('strong',null,L('等待实际 Blender 静帧','Waiting for a Blender still')),h('p',null,L('查看经过指纹校验的 PNG，而不是生成的概念图。','Only fingerprinted Blender PNGs appear here.')))),
      h('aside',{className:'ck-desk-inspector'},controls,history)));
}
