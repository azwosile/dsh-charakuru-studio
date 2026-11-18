function DeskTripoStudio(props) {
  var studio=props.studio,state=props.state,form=state.form,project=props.projectState,busy=state.busy,boot=state.boot;
  var lang=props.lang,L=function(z,e){return deskText(lang,z,e);};
  if(!project)return null;
  var base=project.workflow?.mode==='base_mesh';
  var parts=base?[['clothing',L('服装','Clothing')],['hair',L('头发','Hair')],['accessory',L('配饰','Accessory')]]:[['head',L('头 + 发','Head + hair')],['body',L('无头 T-Pose 身体','Headless T-pose body')]];
  var ticketList=(project.tripoStudio?.tickets||[]).slice().reverse();
  var ticket=ticketList.find(function(t){return ['draft','upload_authorized','generation_confirmed'].includes(t.status);});
  var part=ticket?.part||(base?form.studioObjectPart:form.deskPart);
  var refs=(project.materials?.items||[]).filter(function(m){return m.role==='tripo_'+part+'_reference';});
  var chosenRef=refs.find(function(m){return m.id===form.studioRefId;});
  var revision=project.stateRevision;
  var canPlan=base?!!project.workflow.foundation.body&&!!chosenRef:project.stages?.['1_concept']?.status==='completed'&&project.stages?.['2_views']?.status==='completed';
  var result=state.result?.ticket?.id===ticket?.id&&state.result?.stateRevision===revision?state.result:null;
  var statusLabels={draft:L('待确认上传','Upload not authorized'),upload_authorized:L('已授权指定图片 · 等待实际报价','Upload permitted · waiting for quote'),generation_confirmed:L('已确认报价 · 网页手动生成','Quote confirmed · submit manually'),closed_with_candidates:L('已关闭 · 有本机候选','Closed with local candidates'),closed_without_download:L('已关闭 · 无回执','Closed without download')};
  var target='https://studio.tripo3d.ai/';
  var validCap=form.studioCap.trim()!==''&&Number(form.studioCap)>=0&&Number(form.studioCap)<=1000000;
  var quote=Number(form.studioQuote),quoteOk=form.studioQuote.trim()!==''&&quote>=0&&quote<=ticket?.creditCap;
  function field(name,label,options){return deskField(label,form[name],function(v){studio.put(name,v);},Object.assign({disabled:busy},options));}
  function make(){studio.action('/studio/tripo/studio/new',{part:part,referenceMaterialId:base?chosenRef?.id:undefined,creditCap:Number(form.studioCap),expectedRevision:revision},true).then(function(r){if(r){studio.put('studioQuote','');studio.put('studioDownload','');}});}
  function transition(action,warning){if(!window.confirm(warning))return;studio.action('/studio/tripo/studio/transition',{ticketId:ticket.id,action:action,expectedRevision:revision,confirmed:true,quotedCredits:action==='confirm_quote'?quote:undefined},true);}
  function status(){studio.action('/studio/tripo/studio/status',{ticketId:ticket.id});}
  function collect(source){studio.action('/studio/tripo/studio/collect',{ticketId:ticket.id,expectedRevision:revision,sourceGlbPath:source||undefined,fileName:source?undefined:form.studioDownload.trim()},true).then(function(r){if(r)studio.put('studioDownload','');});}
  function chooseFile(file){var source=file&&desktopFilePath(file);if(source)collect(source);else if(file)studio.set({notice:L('此端取不到文件路径；请粘贴路径，或把 GLB 放入工单回收目录后填文件名。','This renderer has no file path. Paste the local path or use the ticket inbox and filename.')});}
  function draft(){studio.handoffAiEdit('/studio/tripo/studio/handoff',{ticketId:ticket.id},false);}
  return deskCard(L('Tripo 官方浏览器接力','Tripo Studio browser handoff'),h('div',{className:'ck-ai-strip'},
    h('div',{className:'ck-row'},h('a',{className:'ck-btn','data-variant':'primary',href:target,target:'_blank',rel:'noopener noreferrer'},L('在浏览器打开 Tripo Studio ↗','Open Tripo Studio in browser ↗'))),
    h('p',{className:'ck-muted'},L('使用你已登录的浏览器，不在 DSH 内嵌。可让 DSH 的浏览器工具协助读界面、上传已授权图和回收 GLB；没有浏览器工具时，按同一工单手动做。','Use your signed-in browser, not an iframe. A browser tool attached to DSH can help inspect the page, upload the authorized PNGs and collect GLBs. The same ticket works manually without a browser tool.')),
    !ticket?h(React.Fragment,null,
      deskSelect(L('本次只做一个部件','One part per ticket'),part,parts,function(v){studio.put(base?'studioObjectPart':'deskPart',v);studio.put('studioRefId','');studio.put('deskCandidate','');},busy),
      base?h(React.Fragment,null,
        deskSelect(L('独立部件参考 PNG','Isolated part reference PNG'),chosenRef?.id||'',[['',L('未选图','No image selected')]].concat(refs.map(function(m){return [m.id,m.fileName+' · '+m.sha256.slice(0,7)];})),function(v){studio.put('studioRefId',v);},busy),
        chosenRef?h('img',{className:'ck-ticket-reference',src:studioMaterialUrl(form,boot,chosenRef),alt:chosenRef.fileName,referrerPolicy:'no-referrer'}):null,
        props.register?deskButton(L('登记独立部件 PNG','Register isolated part PNG'),function(){props.register('4_assembly','tripo_'+part+'_reference');},busy):null,
        h('p',{className:'ck-muted'},L('只使用独立服装、头发或配饰，不发私有身体、头模、Blend 或整套工程。','Use isolated clothing, hair or accessory images only — never private bodies, heads, Blend files or whole projects.'))):
        !canPlan?h('p',{className:'ck-callout'},L('先批准原画与全部拆件视图；每次只从已批准视图取该部件四张。','Approve the original and views first. Each ticket uses the four reviewed PNGs for one part.')):null,
      field('studioCap',L('本工单积分上限（不是余额）','Ticket credit cap (not balance)'),{type:'number',min:0,max:1000000,step:'any'}),
      deskButton(L('新建浏览器工单（不上传）','Create browser ticket (no upload)'),make,busy||!canPlan||!validCap,true)):
      h(React.Fragment,null,
        h('strong',null,(parts.find(function(p){return p[0]===part;})?.[1]||part)+' · '+ticket.id.slice(0,8)),
        h('p',{className:'ck-callout'},statusLabels[ticket.status]+' · '+L('上限','Cap')+' '+ticket.creditCap+(ticket.quotedCredits!==null?' / '+L('报价','Quote')+' '+ticket.quotedCredits:'')),
        h('ul',{className:'ck-paths'},ticket.inputs.map(function(a){return h('li',{key:a.id},a.slotId+' · '+a.label+' · '+a.sha256.slice(0,8));})),
        h('div',{className:'ck-row'},deskButton(L('准备 DSH 接力草稿','Draft browser handoff in DSH'),draft,busy,true),deskButton(L('核对工单与回收目录','Check ticket and inbox'),status,busy)),
        result?.blockedReason?h('p',{className:'ck-callout'},result.blockedReason):null,
        result?.inputFiles?.length?h('details',{className:'ck-inline-details'},h('summary',null,L('已授权的本机文件（供浏览器选择）','Authorized local file paths')),h('ul',{className:'ck-paths'},result.inputFiles.map(function(a){return h('li',{key:a.id},h('code',null,a.file));}))):null,
        h(DeskHandoffCopy,{studio:studio,result:state.lastDraft?.id===ticket.id?state.lastDraft:null,lang:lang,disabled:busy}),
        ticket.status==='draft'?deskButton(L('确认可上传这组 PNG','Authorize these PNG uploads'),function(){transition('authorize_upload',L('允许只将上列图片交给 Tripo？批准不等于生成或扣费。','Allow only the listed PNGs to be uploaded to Tripo? This does not authorize generation or charges.'));},busy||!!result?.blockedReason):null,
        ticket.status==='upload_authorized'?h('div',{className:'ck-config-row'},field('studioQuote',L('网页显示的本次报价（积分）','Current quote shown in Studio (credits)'),{type:'number',min:0,step:'any'}),
          deskButton(L('确认报价，允许我手动生成一次','Confirm quote for one manual generation'),function(){transition('confirm_quote',L('确认网页对该部件的实际报价是 '+quote+' 积分，且未提交过？请自己到浏览器点一次 Generate；DSH 不会代点。','Confirm the shown quote is '+quote+' credits and it has not been submitted? Click Generate once in the browser; DSH will not click it.'));},busy||!quoteOk||!!result?.blockedReason,true)):null,
        ticket.status==='generation_confirmed'?h('div',{className:'ck-config-row'},
          h('p',{className:'ck-muted'},L('完成后导出自包含、未压缩 GLB。逐个回收，不自动采用、不自动记账。不确定是否扣费时先查网页历史，不重试。','Export embedded, uncompressed GLBs. Collect them one at a time, without auto-adoption or billing. If a charge is uncertain, check Studio history before retrying.')),
          result?.inbox?h('p',{className:'ck-meta-line'},L('回收目录：','Inbox: '),h('code',null,result.inbox)):null,
          isDshDesktop()?h('label',{className:'ck-field'},h('span',null,L('选择浏览器下载的 GLB','Choose downloaded GLB')),h('input',{type:'file',accept:'.glb',disabled:busy,onChange:function(e){chooseFile(e.target.files?.[0]);e.target.value='';}})):null,
          field('studioDownload',L('GLB 本机绝对路径，或回收目录中的文件名','GLB absolute path, or filename in the inbox'),{maxLength:4096}),
          deskButton(L('回收为候选（不采用）','Collect a candidate (do not adopt)'),function(){var s=form.studioDownload.trim();collect(/[\\/]/.test(s)?s:'');},busy||!form.studioDownload.trim(),true),
          h('ul',{className:'ck-paths'},ticket.downloads.map(function(d){return h('li',{key:d.id},d.fileName+' · '+d.sha256.slice(0,10));}))):null,
        deskButton(L('关闭工单（不代表退款）','Close ticket (no implied refund)'),function(){transition('close',L('关闭只是停止接力。未确认的扣费需去官方网页核对。','Closing stops the handoff; reconcile uncertain charges in Studio.'));},busy)),
    ticketList.some(function(t){return t.closedAt;})?h('details',{className:'ck-inline-details'},h('summary',null,L('已关闭工单','Closed tickets')),
      h('ul',{className:'ck-paths'},ticketList.filter(function(t){return t.closedAt;}).slice(0,10).map(function(t){return h('li',{key:t.id},t.part+' · '+t.id.slice(0,8)+' · '+statusLabels[t.status]+' · GLB × '+t.downloads.length);}))):null));
}
