// Included inside the lazy DSH module, with React supplied by the host.
function isDshDesktop() {
  var location = typeof window === 'undefined' ? null : window.location;
  return !!location && location.protocol === 'dsh-app:' && location.hostname === 'app';
}

// Use only the official preload bridge for a File returned by a picker/drop.
// Never inspect file.path, enable renderer Node, or synthesize IPC.
function desktopFilePath(file) {
  if (!isDshDesktop()) return '';
  try {
    var bridge = window.__DSH_HOST_PATHS__;
    var value = bridge && typeof bridge.pathFor === 'function' && bridge.pathFor(file);
    return typeof value === 'string' ? value : '';
  } catch (_) { return ''; }
}

function desktopHasFolderPicker() {
  return isDshDesktop() && typeof window.__DSH_DIRECTORY_PICKER__?.pick === 'function';
}

function sendMaterialFile(studio, payload, file) {
  var source = desktopFilePath(file);
  if (source) return studio.request('/studio/materials/import', Object.assign({}, payload, { sourcePath: source }));
  var query = new URLSearchParams(Object.assign({}, payload, { fileName: file.name }));
  return studio.request('/studio/materials/upload?' + query.toString(), null, file);
}

function studioMaterialUrl(form, boot, material) {
  if (!material || !boot) return null;
  return loopback(form.base) + '/studio/materials/content?' + new URLSearchParams({
    projectDir: boot.activeProjectDir, id: material.id, access: boot.sessionToken || ''
  }).toString();
}

var MATERIAL_EDITOR_OPS = { scene: 'import_material_scene', mesh: 'append_material_mesh', texture: 'apply_material_texture' };

function MaterialWorkspace(props) {
  var studio = props.studio, t = studio.t, form = props.state.form, boot = props.state.boot;
  var project = props.projectState, stages = props.stages, lang = props.lang, busy = props.state.busy;
  var card = props.card, go = props.selectTab;
  var drag = React.useState(false), dragging = drag[0], setDragging = drag[1];
  var inputId = React.useId ? React.useId() : 'ck-material-file';
  if (!boot?.materialRoles) return card('materials', h('p', { className: 'ck-callout', role: 'status' }, t('materialUpgradeRequired')));
  var roles = boot.materialRoles;
  var all = project?.materials?.items || [];
  var current = stages.find(function (s) { return s.id === form.materialStage; }) || stages.find(function(s){return s.id===project?.activeStageId;}) || stages[0];
  if (!current) return null;
  var stepRoles = roles.filter(function (r) { return r.stageId === current.id; });
  var role = stepRoles.find(function (r) { return r.id === form.materialRole; }) || stepRoles[0];
  var rows = all.filter(function (m) { return m.stageId === current.id; }).slice().reverse();
  function rName(r) { return r?.['title' + lang] || r?.id || ''; }
  function stageNo(stage) { return String(stage.index).padStart(2, '0'); }
  function setStep(stageId) { studio.put('materialStage', stageId); studio.put('materialRole', ''); }
  function button(label, fn, disabled, variant) {
    return h('button', { key: label, className:'ck-btn', type:'button', disabled:busy || disabled, 'data-variant':variant || 'default', onClick:fn }, t(label));
  }
  function selector(label, value, entries, setter) {
    return h('label',{className:'ck-field'},h('span',null,t(label)),
      h('select',{value:value,disabled:busy || !project,onChange:function(e){ setter(e.target.value); }},
        entries.map(function(e){return h('option',{key:e[0],value:e[0]},e[1]);})));
  }
  function register(file, sourcePath) {
    if (!project || !role || busy) return;
    studio.act(async function () {
      var args = { projectDir: boot.activeProjectDir, expectedRevision: project.stateRevision, stageId: current.id,
        role: role.id, slotId: form.materialSlot, part: form.materialPart };
      if (file && (!file.size || file.size > role.maxBytes || !role.extensions.some(function (ext) { return file.name.toLowerCase().endsWith(ext); }))) {
        throw new Error(t('materialInvalid') + ' ' + role.extensions.join(', ') + ' · ' + role.maxBytes/(1024*1024) + ' MiB');
      }
      var result = file ? await sendMaterialFile(studio, args, file) : await studio.request('/studio/materials/import', Object.assign({}, args, { sourcePath: sourcePath.trim() }));
      await studio.refresh(false);
      studio.put('materialPath', '');
      return result;
    }).then(function (result) { if (result) studio.set({ notice:t(result.duplicate ? 'materialDuplicate' : 'materialRegistered') }); });
  }
  function inputChange(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) register(file);
  }
  function dropped(event) {
    event.preventDefault(); event.stopPropagation(); setDragging(false);
    if (!project || busy) return;
    var files = event.dataTransfer.files;
    if (!files || !files.length) return;
    if (files.length !== 1) { studio.set({error:t('materialSingle')}); return; }
    register(files[0]);
  }
  function activeAsset(material) {
    var asset = project?.assets?.items?.find(function (a) { return a.materialId === material.id; });
    if (!asset) return false;
    if (material.intent === 'original') return project.assets.selected.source === asset.id;
    if (material.intent === 'view') return project.views?.[material.target]?.status === 'ready' && project.views?.[material.target]?.assetId === asset.id;
    if (material.intent === 'candidate') return project.assets.selected[material.target] === asset.id;
    return project.editor?.view?.overlayAssetId === asset.id;
  }
  function adopt(item) {
    studio.act(async function () {
      var result = await studio.request('/studio/materials/use',{projectDir:boot.activeProjectDir,materialId:item.id,expectedRevision:project.stateRevision});
      if (result.usage === 'overlay') {
        await studio.request('/studio/editor/view', { projectDir:boot.activeProjectDir, camera:form.editorCamera, overlayAssetId:result.assetId, overlayOpacity:Number(form.overlayOpacity) });
        studio.put('overlayId', result.assetId);
      }
      var next = await studio.refresh(false);
      if (result.usage === 'original') studio.syncOriginal(next);
      if (result.usage === 'overlay') go('editor');
      return result;
    }).then(function (result) { if (result) studio.set({ notice:t(result.usage === 'overlay' ? 'materialOverlayReady' : 'materialAdopted') }); });
  }
  function openEditor(item) {
    studio.put('editorMaterialId', item.id);
    studio.put('materialTarget', '');
    studio.put('materialTextureSlot', '0');
    go('editor');
  }
  function targetLabel(item) {
    if (item.intent === 'view') {
      var slot = (boot.requiredViewSlots || []).find(function (s) { return s.id === item.target; });
      return slot?.['label' + lang] || item.target;
    }
    return item.intent === 'candidate' ? t(item.target) : '';
  }
  var selectedPreview = all.find(function(m){return m.id === form.materialPreview;});
  var selectedMotion = all.find(function(m){return m.id === form.materialMotionId && m.intent === 'motion';});
  var previewModel = selectedPreview?.extension === '.glb' || selectedPreview?.intent === 'avatar';
  var motionOptions = all.filter(function (m) { return m.intent === 'motion'; });
  var mainTitle = h('div',{className:'ck-intake-title'},
    h('div',null,h('div',{className:'ck-eyebrow'},t('intakeKicker')),h('h2',null,t('materials')),h('p',null,t('materialWorkflow'))),
    h('div',{className:'ck-row'},
      h('span',{className:'ck-chip','data-tone':'brand'},t(isDshDesktop()?'materialDesktop':'materialWeb')),
      button('assets',function(){go('assets');},false)));
  var steps = h('div',{className:'ck-material-steps','aria-label':t('materialStage'),role:'group'}, stages.map(function (step) {
    return h('button',{key:step.id,type:'button','aria-pressed':current.id===step.id,onClick:function(){setStep(step.id);}},
      h('span',{className:'ck-step-no','aria-hidden':'true'},stageNo(step)),h('strong',null,step['title'+lang] || step.id),
      h('small',null,all.filter(function(m){return m.stageId===step.id;}).length));
  }));
  var importBox = !role ? null : card('materialRegister', h(React.Fragment,null,
    selector('materialRole',role.id,stepRoles.map(function (r){return [r.id,rName(r)];}),function(id){studio.put('materialRole',id);}),
    role.intent==='view' ? selector('slotId',form.materialSlot,(boot.requiredViewSlots || []).map(function(v){return [v.id,v['label'+lang] || v.id];}),function(value){studio.put('materialSlot',value);}) : null,
    role.intent==='candidate' ? selector('part',form.materialPart,['head','body','clothing','hair','accessory'].map(function (part){return [part,t(part)];}),function(part){studio.put('materialPart',part);}) : null,
    h('p',{className:'ck-muted ck-material-help'},role['use'+lang]),
    h('div',{className:'ck-intake-drop','data-dragging':dragging,'data-disabled':busy||!project,onDragOver:function(e){e.preventDefault();if(!busy&&project)setDragging(true);},
      onDragEnter:function(e){e.preventDefault();if(!busy&&project)setDragging(true);},onDragLeave:function(e){if(!e.currentTarget.contains(e.relatedTarget))setDragging(false);},onDrop:dropped},
      h('strong',null,t('materialDrop')),h('p',null,role.extensions.join(' / ').toUpperCase()+' · '+role.maxBytes/(1024*1024)+' MiB'),
      h('label',{htmlFor:inputId,className:'ck-material-file-label'},t('materialChooseFile')),
      h('input',{id:inputId,type:'file',accept:role.extensions.join(','),disabled:busy||!project,onChange:inputChange})),
    h('details',{className:'ck-inline-details'},h('summary',null,t('materialLocalPath')),h('label',{className:'ck-field'},h('span',null,t('materialPathLabel')),
      h('input',{type:'text',value:form.materialPath,disabled:busy||!project,onChange:function(e){studio.put('materialPath',e.target.value);}})),
      button('materialRegister',function(){register(null,form.materialPath);},!project||!form.materialPath.trim())),
    h('p',{className:'ck-muted ck-material-help'},t('materialCopyOnly'))
  ));
  var listBox = card('materialInbox',h(React.Fragment,null,
    h('p',{className:'ck-muted ck-material-help'},stageNo(current)+' / '+(current['title'+lang] || current.id)+' · '+rows.length),
    rows.length ? h('ul',{className:'ck-material-list'},rows.map(function(item){
      var spec = roles.find(function(r){return r.id===item.role && r.stageId===item.stageId;});
      var selected = activeAsset(item);
      var bound = item.intent==='original' || item.intent==='view' || item.intent==='candidate' || item.intent==='overlay';
      var applied = project.editor?.revisions?.some(function(rev){return rev.materialInput?.id===item.id;});
      var usage = selected?'materialInUse':applied?'materialInRevision':bound?'materialRegistered':MATERIAL_EDITOR_OPS[item.intent]?'materialAwaitingEdit':'materialReferenceOnly';
      return h('li',{key:item.id,'data-material-id':item.id,className:'ck-material-row'},
        h('span',{className:'ck-file-chip'},item.extension.slice(1).toUpperCase()),
        h('div',{className:'ck-material-info'},h('strong',null,item.fileName),
          h('p',null,[rName(spec),targetLabel(item),Math.ceil(item.bytes/1024)+' KiB',item.sha256.slice(0,10)].filter(Boolean).join(' · ')),
          h('span',{className:'ck-pill','data-status':selected?'completed':'pending'},t(usage))),
        h('div',{className:'ck-material-actions'},
          item.intent==='motion' ? button('materialPlayReference',function(){studio.put('materialMotionId',item.id);studio.set({notice:t('materialMotionChosen')});}) : null,
          item.extension!=='.blend' && item.intent!=='motion' ? button('materialPreview',function(){studio.put('materialPreview',item.id);}) : null,
          bound ? button(item.intent==='overlay'?'materialOverlay':'materialAdopt',function(){adopt(item);},selected,'primary') : null,
          MATERIAL_EDITOR_OPS[item.intent] ? button('materialToEditor',function(){openEditor(item);},false,'primary') : null));
    })) : h('div',{className:'ck-material-empty'},h('strong',null,t('materialEmpty')),h('p',null,t('materialEmptyHint')))));
  var peek = (selectedPreview || selectedMotion) ? card('materialReview',h(React.Fragment,null,
    h('div',{className:'ck-row'}, selectedPreview ? h('strong',null,selectedPreview.fileName) : null,
      selectedPreview?.intent==='avatar' ? h('span',{className:'ck-chip','data-tone':'warn'},t('materialExternalVrm')) : null,
      button('materialClosePreview',function(){studio.put('materialPreview','');studio.put('materialMotionId','');})),
    motionOptions.length ? selector('materialMotion',form.materialMotionId,[['',t('materialNoMotion')]].concat(motionOptions.map(function(m){return [m.id,m.fileName+' · '+(stages.find(function(st){return st.id===m.stageId;})?.['title'+lang] || m.stageId)+' · '+m.sha256.slice(0,8)];})),function(id){studio.put('materialMotionId',id);}) : null,
    selectedMotion && selectedPreview?.intent!=='avatar' ? h('p',{className:'ck-callout'},t('materialMotionNeedsVrm')) : null,
    previewModel ? h(GeometryPreview,{key:selectedPreview.id,lang:lang,url:studioMaterialUrl(form,boot,selectedPreview),camera:'front',
      motionUrl:selectedPreview.intent==='avatar' && selectedMotion ? studioMaterialUrl(form,boot,selectedMotion) : null}) : null,
    selectedPreview?.extension==='.png' ? h('img',{className:'ck-asset-focus',src:studioMaterialUrl(form,boot,selectedPreview),alt:selectedPreview.fileName,referrerPolicy:'no-referrer'}) : null)) : null;
  return h('div',{className:'ck-material-workspace'},mainTitle,steps,
    !project ? h('p',{className:'ck-callout',role:'status'},t('materialNoProject')) : null,
    h('div',{className:'ck-intake-grid'},importBox,listBox),peek);
}
