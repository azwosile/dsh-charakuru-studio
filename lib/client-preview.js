// Offline Three.js / optional VRM renderer. StudioThree is bundled into the lazy client factory.
function GeometryPreview(props) {
  var isEn = props.lang !== 'Zh';
  var ref = React.useRef(null), sceneRef = React.useRef(null);
  var status = React.useState(isEn ? 'Loading model…' : '正在加载模型…'), message = status[0], setMessage = status[1];
  var motion = React.useState({ ready:false, playing:false }), motionState = motion[0], setMotionState = motion[1];
  var metricsState = React.useState({ heightM: null, headBodyRatio: Number(props.headBodyRatio || 6.3), neckScaleFactor: Number(props.neckScaleFactor || 0.86) });
  var metrics = metricsState[0], setMetrics = metricsState[1];
  var calState = React.useState(function () {
    var r = Number(props.headBodyRatio || 6.3), n = Number(props.neckScaleFactor || 0.86);
    return { past: [], present: { headBodyRatio: r, neckScaleFactor: n }, future: [] };
  });
  var cal = calState[0], setCal = calState[1];

  React.useEffect(function () {
    var r = Number(props.headBodyRatio || 6.3), n = Number(props.neckScaleFactor || 0.86);
    setCal(function (prev) {
      if (Math.abs(prev.present.headBodyRatio - r) < 1e-4 && Math.abs(prev.present.neckScaleFactor - n) < 1e-4) return prev;
      return { past: prev.past, present: { headBodyRatio: r, neckScaleFactor: n }, future: prev.future };
    });
  }, [props.headBodyRatio, props.neckScaleFactor]);

  var activeRatio = props.headBodyRatio !== undefined ? Number(props.headBodyRatio) : cal.present.headBodyRatio;
  var activeNeck = props.neckScaleFactor !== undefined ? Number(props.neckScaleFactor) : cal.present.neckScaleFactor;

  function commitCalibration(nextRatio, nextNeck) {
    var clampedRatio = Math.min(8.5, Math.max(4.5, Number(nextRatio) || 6.3));
    var clampedNeck = Math.min(1.25, Math.max(0.60, Number(nextNeck) || 0.86));
    setCal(function (prev) {
      return {
        past: prev.past.concat([prev.present]).slice(-24),
        present: { headBodyRatio: clampedRatio, neckScaleFactor: clampedNeck },
        future: [],
      };
    });
    if (typeof props.onCalibrationChange === 'function') {
      props.onCalibrationChange({ headBodyRatio: clampedRatio, neckScaleFactor: clampedNeck });
    }
  }
  function undoCalibration() {
    setCal(function (prev) {
      if (!prev.past.length) return prev;
      var previous = prev.past[prev.past.length - 1];
      if (typeof props.onCalibrationChange === 'function') props.onCalibrationChange(previous);
      return { past: prev.past.slice(0, -1), present: previous, future: [prev.present].concat(prev.future).slice(0, 24) };
    });
  }
  function redoCalibration() {
    setCal(function (prev) {
      if (!prev.future.length) return prev;
      var next = prev.future[0];
      if (typeof props.onCalibrationChange === 'function') props.onCalibrationChange(next);
      return { past: prev.past.concat([prev.present]).slice(-24), present: next, future: prev.future.slice(1) };
    });
  }

  var triUrls = props.triViewUrls || (props.triView3d && props.overlayUrl ? { front: props.overlayUrl } : null);
  var triKey = triUrls ? [triUrls.front || '', triUrls.right || '', triUrls.back || ''].join('|') : '';
  var showTriPlanes = Boolean(props.triView3d && (triUrls?.front || triUrls?.right || triUrls?.back));

  React.useEffect(function () {
    setMotionState({ready:false,playing:false});
    setMetrics(function (prev) { return Object.assign({}, prev, { heightM: null }); });
    setMessage(props.lang!=='Zh'?'Loading model…':'正在加载模型…');
    var T = StudioThree, host = ref.current, abort = new AbortController(), disposed = false, frame = 0;
    if (!host || typeof document === 'undefined') return undefined;
    var renderer, controls, scene, camera, orth, persp, wireMat, span=1, avatar = null, root = null, mixer = null, bounds, center, radius;
    var triViewGroup = new T.Group(), rulerGroup = new T.Group(), baseScales = null, triViewSeq = 0;
    triViewGroup.name = 'StudioTriViewPlanes';
    rulerGroup.name = 'StudioHeightRuler';
    try { renderer = new T.WebGLRenderer({antialias:true,alpha:true}); }
    catch(error) {setMessage((props.lang!=='Zh'?'WebGL unavailable: ':'WebGL 不可用：')+error.message);return;}
    renderer.setPixelRatio(Math.min(typeof devicePixelRatio!=='undefined'?devicePixelRatio:1,2));renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x141e2b,1);
    Object.assign(renderer.domElement.style,{width:'100%',height:'100%',display:'block'});
    host.appendChild(renderer.domElement);scene=new T.Scene();persp=new T.PerspectiveCamera(35,1,.01,2000);orth=new T.OrthographicCamera(-1,1,1,-1,.01,2000);camera=persp;
    wireMat=new T.MeshBasicMaterial({color:0x8fd9f8,wireframe:true});
    scene.add(new T.HemisphereLight(0xffffff,0x607080,2.5));var light=new T.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
    scene.add(triViewGroup);
    scene.add(rulerGroup);
    controls=new T.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(280,host.clientHeight);renderer.setSize(w,h,false);var aspect=w/h;persp.aspect=aspect;persp.updateProjectionMatrix();var fit=Math.min(1,aspect);orth.left=-span*aspect/fit;orth.right=span*aspect/fit;orth.top=span/fit;orth.bottom=-span/fit;orth.updateProjectionMatrix();}
    var observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):{observe:function(){},disconnect:function(){}};observer.observe(host);resize();
    function pose(name) {
      if(!center)return;
      var directions={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,0],perspective:[1,.5,1]};var v=directions[name]||directions.perspective;
      camera=props.orthographic&&name!=='perspective'?orth:persp;controls.object=camera;camera.zoom=1;camera.up.set(0,name==='top'?0:1,name==='top'?-1:0);span=radius*1.10;resize();
      camera.position.copy(center).add(new T.Vector3(v[0],v[1],v[2]).normalize().multiplyScalar(radius*3.5));camera.near=Math.max(.001,radius/1000);camera.far=Math.max(100,radius*100);camera.updateProjectionMatrix();controls.target.copy(center);controls.update();
    }
    function clearGroup(grp) {
      while (grp.children.length) {
        var child = grp.children.pop();
        child.geometry?.dispose?.();
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.filter(Boolean).forEach(function (m) {
          if (m.map?.dispose) m.map.dispose();
          m.dispose?.();
        });
      }
    }
    function rebuildHeightRuler(enabled, targetHeightM) {
      clearGroup(rulerGroup);
      rulerGroup.visible = Boolean(enabled);
      if (!enabled || !bounds || !center) return;
      var modelH = Math.max(0.01, bounds.max.y - bounds.min.y);
      var maxY = Math.max(2.0, Math.ceil(Math.max(bounds.max.y, Number(targetHeightM) || 0, modelH) * 5) / 5);
      var xPole = bounds.min.x - 0.28, zPole = center.z;
      var verts = [];
      // Y=0 floor lock frame + crosshair
      var fw = Math.max(0.45, (bounds.max.x - bounds.min.x) * 0.75);
      var fd = Math.max(0.45, (bounds.max.z - bounds.min.z) * 0.75);
      verts.push(center.x - fw, 0, center.z - fd, center.x + fw, 0, center.z - fd);
      verts.push(center.x + fw, 0, center.z - fd, center.x + fw, 0, center.z + fd);
      verts.push(center.x + fw, 0, center.z + fd, center.x - fw, 0, center.z + fd);
      verts.push(center.x - fw, 0, center.z + fd, center.x - fw, 0, center.z - fd);
      // Vertical ruler spine anchored at Y=0
      verts.push(xPole, 0, zPole, xPole, maxY, zPole);
      var dmCount = Math.round(maxY * 10);
      for (var i = 0; i <= dmCount; i += 1) {
        var yy = i / 10;
        var tickLen = (i % 10 === 0) ? 0.16 : (i % 5 === 0) ? 0.11 : 0.055;
        verts.push(xPole, yy, zPole, xPole + tickLen, yy, zPole);
      }
      var lineGeom = new T.BufferGeometry();
      lineGeom.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
      rulerGroup.add(new T.LineSegments(lineGeom, new T.LineBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.78 })));
      // Current top marker
      var topGeom = new T.BufferGeometry();
      topGeom.setAttribute('position', new T.Float32BufferAttribute([xPole, bounds.max.y, zPole, bounds.max.x + 0.15, bounds.max.y, zPole], 3));
      rulerGroup.add(new T.LineSegments(topGeom, new T.LineBasicMaterial({ color: 0x8fd9f8 })));
      if (Number(targetHeightM) > 0) {
        var th = Number(targetHeightM);
        var tgtGeom = new T.BufferGeometry();
        tgtGeom.setAttribute('position', new T.Float32BufferAttribute([xPole, th, zPole, bounds.max.x + 0.2, th, zPole], 3));
        rulerGroup.add(new T.LineSegments(tgtGeom, new T.LineBasicMaterial({ color: 0xffb84d })));
      }
    }
    function rebuildTriViews(enabled, urls, opacityVal, targetHeightM) {
      var seq = (triViewSeq += 1);
      clearGroup(triViewGroup);
      triViewGroup.visible = Boolean(enabled);
      if (!enabled || !bounds || !center || !urls) return;
      var modelH = Math.max(0.01, bounds.max.y - bounds.min.y);
      var planeH = Number(targetHeightM) > 0 ? Number(targetHeightM) : modelH;
      var padX = Math.max(0.35, (bounds.max.x - bounds.min.x) * 0.65);
      var padZ = Math.max(0.35, (bounds.max.z - bounds.min.z) * 0.65);
      var specs = [
        { key: 'front', url: urls.front, rotY: 0, pos: [center.x, planeH / 2, bounds.min.z - padZ * 0.45] },
        { key: 'right', url: urls.right, rotY: Math.PI / 2, pos: [bounds.min.x - padX * 0.45, planeH / 2, center.z] },
        { key: 'back', url: urls.back, rotY: Math.PI, pos: [center.x, planeH / 2, bounds.max.z + padZ * 0.45] },
      ];
      var op = Number.isFinite(Number(opacityVal)) ? Math.min(1, Math.max(0.05, Number(opacityVal))) : 0.35;
      specs.forEach(function (spec) {
        if (!spec.url) return;
        fetch(spec.url, { signal: abort.signal, redirect: 'error', referrerPolicy: 'no-referrer' })
          .then(function (r) { if (!r.ok) throw Error('Image load failed'); return r.blob(); })
          .then(function (blob) {
            if (disposed || seq !== triViewSeq) return null;
            if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
            return new Promise(function (resolve, reject) {
              var objUrl = URL.createObjectURL(blob), img = new Image();
              img.onload = function () { URL.revokeObjectURL(objUrl); resolve(img); };
              img.onerror = function (err) { URL.revokeObjectURL(objUrl); reject(err); };
              img.src = objUrl;
            });
          })
          .then(function (bitmap) {
            if (!bitmap) return;
            if (disposed || seq !== triViewSeq) { bitmap.close?.(); return; }
            var aspect = (bitmap.width && bitmap.height) ? (bitmap.width / bitmap.height) : 0.6;
            var geom = new T.PlaneGeometry(planeH * aspect, planeH);
            var tex = new T.Texture(bitmap);
            tex.colorSpace = T.SRGBColorSpace;
            tex.needsUpdate = true;
            var mat = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, side: T.DoubleSide });
            var plane = new T.Mesh(geom, mat);
            plane.name = 'StudioTriView_' + spec.key;
            plane.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
            plane.rotation.y = spec.rotY;
            plane.renderOrder = -1;
            triViewGroup.add(plane);
          })
          .catch(function () {});
      });
    }
    function setTriViewOpacity(opacityVal) {
      var op = Number.isFinite(Number(opacityVal)) ? Math.min(1, Math.max(0.05, Number(opacityVal))) : 0.35;
      triViewGroup.children.forEach(function (plane) {
        if (plane.material) { plane.material.opacity = op; plane.material.needsUpdate = true; }
      });
    }
    function applyCalibration(ratioVal, neckVal) {
      if (!root) return;
      var ratioFactor = Math.min(1.35, Math.max(0.7, 6.3 / Math.max(3.5, Number(ratioVal) || 6.3)));
      var neckFactor = Math.min(1.35, Math.max(0.65, (Number(neckVal) || 0.86) / 0.86));
      if (avatar?.humanoid) {
        var headNode = avatar.humanoid.getRawBoneNode?.('head') || avatar.humanoid.getNormalizedBoneNode?.('head');
        var neckNode = avatar.humanoid.getRawBoneNode?.('neck') || avatar.humanoid.getNormalizedBoneNode?.('neck');
        if (!baseScales) {
          baseScales = {
            head: headNode ? headNode.scale.clone() : null,
            neck: neckNode ? neckNode.scale.clone() : null,
          };
        }
        if (headNode && baseScales.head) {
          headNode.scale.set(baseScales.head.x * ratioFactor, baseScales.head.y * ratioFactor, baseScales.head.z * ratioFactor);
        }
        if (neckNode && baseScales.neck) {
          neckNode.scale.set(baseScales.neck.x * neckFactor, baseScales.neck.y, baseScales.neck.z * neckFactor);
        }
      }
    }
    var elapsed=0,last=performance.now();
    function tick(now){if(disposed)return;var dt=Math.min(.05,(now-last)/1000);last=now;elapsed+=dt;controls.update();
      if(avatar){if(mixer){if(sceneRef.current.externalPlaying)mixer.update(dt);}else if(sceneRef.current?.playMotion){var h=avatar.humanoid;[['leftUpperLeg',1],['rightUpperLeg',-1],['leftUpperArm',-1],['rightUpperArm',1]].forEach(function(pair){var bone=h.getNormalizedBoneNode(pair[0]);if(bone)bone.rotation.x=Math.sin(elapsed*4)*.22*pair[1];});}else avatar.humanoid.resetNormalizedPose();avatar.update(dt);}
      scene.overrideMaterial=sceneRef.current?.wireframe?wireMat:null;renderer.render(scene,camera);frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    sceneRef.current={
      pose:pose,wireframe:props.wireframe,playMotion:props.playMotion,externalPlaying:false,
      resetMotion:function(){if(mixer){mixer.setTime(0);avatar.update(0);}},
      rebuildHeightRuler:rebuildHeightRuler,rebuildTriViews:rebuildTriViews,
      setTriViewOpacity:setTriViewOpacity,applyCalibration:applyCalibration,
    };
    function fetchModel(url, Plugin) {
      return fetch(url,{signal:abort.signal,redirect:'error',referrerPolicy:'no-referrer'}).then(function(r){
        if(!r.ok)throw Error((props.lang!=='Zh'?'Asset read failed: ':'资产读取失败：')+r.status);return r.arrayBuffer();
      }).then(function(buffer){
        return new Promise(function(resolve,reject){
          var manager=new T.LoadingManager(), loader=new T.GLTFLoader(manager);
          manager.setURLModifier(function(url){if(!/^(blob:|data:)/.test(url))throw Error('External model resources blocked; embed textures and buffers');return url;});
          loader.register(function(parser){return new Plugin(parser);});loader.parse(buffer,'',resolve,reject);
        });
      });
    }
    function freeModel(object) {
      object?.traverse(function(obj){obj.geometry?.dispose();var materials=Array.isArray(obj.material)?obj.material:[obj.material];materials.filter(Boolean).forEach(function(mat){Object.values(mat).forEach(function(v){if(v?.isTexture)v.dispose();});mat.dispose();});});
    }
    var modelSummary = '';
    fetchModel(props.url,T.VRMLoaderPlugin).then(async function(gltf){
      if(disposed){freeModel(gltf.scene);return;}
      root=gltf.scene;avatar=gltf.userData.vrm||null;scene.add(root);bounds=new T.Box3().setFromObject(root);center=bounds.getCenter(new T.Vector3());radius=Math.max(.01,bounds.getSize(new T.Vector3()).length()/2);pose(props.camera||'front');
      var modelHeightM = Math.max(0.01, bounds.max.y - bounds.min.y);
      setMetrics(function (prev) { return Object.assign({}, prev, { heightM: modelHeightM }); });
      rebuildHeightRuler(props.heightRuler, props.targetHeightM);
      rebuildTriViews(showTriPlanes, triUrls, props.triViewOpacity ?? props.opacity, props.targetHeightM);
      applyCalibration(activeRatio, activeNeck);
      var meshes=0,triangles=0;root.traverse(function(obj){if(obj.isMesh){meshes++;triangles+=(obj.geometry.index?.count || obj.geometry.attributes.position?.count || 0)/3;}});
      var label = meshes+' meshes · '+Math.round(triangles)+' triangles · '+(avatar?'VRM / humanoid':'GLB / embedded mesh');
      modelSummary = label;
      setMessage(label + ' · '+(props.lang!=='Zh'?'visual review required':'仍需视觉复核'));
      if (!props.motionUrl) return;
      if (!avatar) {setMessage(label+' · VRMA needs VRM 1.0');return;}
      var motionData=await fetchModel(props.motionUrl,T.VRMAnimationLoaderPlugin);
      var animation=motionData.userData?.vrmAnimations?.[0];
      freeModel(motionData.scene);
      if(disposed)return;
      if(!animation)throw Error(props.lang!=='Zh'?'No VRMA clip found':'VRMA 未提供可用动作');
      var clip=T.createVRMAnimationClip(animation,avatar);
      if(!clip.tracks.length||!Number.isFinite(clip.duration)||clip.duration<=0) throw Error(props.lang!=='Zh'?'No compatible motion tracks':'VRMA 无可映射轨道');
      avatar.humanoid.resetNormalizedPose();
      mixer=new T.AnimationMixer(avatar.scene);mixer.clipAction(clip).play();
      var playing = !(typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
      sceneRef.current.externalPlaying=playing;setMotionState({ready:true,playing:playing});
      setMessage(label+' · VRMA 1.0 / '+clip.duration.toFixed(2)+' s · '+(props.lang!=='Zh'?'visual review required':'仍需视觉复核'));
    }).catch(function(error){if(!disposed)setMessage(modelSummary?(modelSummary+' · '+error.message):error.message);});
    var ray=new T.Raycaster(),pointer=new T.Vector2(),press=null;
    function down(event){press=[event.clientX,event.clientY];}
    function up(event){if(!root||!press||Math.hypot(event.clientX-press[0],event.clientY-press[1])>5)return;var box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera);var hits=ray.intersectObject(root,true);if(hits[0]&&props.onSelect)props.onSelect(hits[0].object.name);}
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
    return function(){disposed=true;triViewSeq+=1;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);if(mixer){mixer.stopAllAction();mixer.uncacheRoot(avatar.scene);}clearGroup(triViewGroup);clearGroup(rulerGroup);freeModel(scene);wireMat.dispose();renderer.dispose();renderer.domElement.remove();sceneRef.current=null;};
  },[props.url,props.motionUrl]);
  React.useEffect(function(){sceneRef.current?.pose(props.camera);},[props.camera,props.fitSignal]);
  React.useEffect(function(){if(sceneRef.current)sceneRef.current.wireframe=props.wireframe;},[props.wireframe]);
  React.useEffect(function(){if(sceneRef.current)sceneRef.current.playMotion=props.playMotion;},[props.playMotion]);
  React.useEffect(function(){sceneRef.current?.rebuildHeightRuler(props.heightRuler,props.targetHeightM);},[props.heightRuler,props.targetHeightM]);
  React.useEffect(function(){sceneRef.current?.rebuildTriViews(showTriPlanes,triUrls,props.triViewOpacity??props.opacity,props.targetHeightM);},[showTriPlanes,triKey,props.targetHeightM,props.triViewOpacity]);
  React.useEffect(function(){sceneRef.current?.setTriViewOpacity(props.triViewOpacity??props.opacity);},[props.triViewOpacity,props.opacity]);
  React.useEffect(function(){sceneRef.current?.applyCalibration(activeRatio,activeNeck);},[activeRatio,activeNeck]);

  var hudText = (props.heightRuler || metrics.heightM !== null)
    ? (isEn
      ? ('Y=0 Floor · Height ' + (metrics.heightM !== null ? metrics.heightM.toFixed(2) + 'm' : (props.targetHeightM ? Number(props.targetHeightM).toFixed(2) + 'm' : '—')) + ' · H:B ' + activeRatio.toFixed(2) + ' · Neck ' + activeNeck.toFixed(2) + 'x')
      : ('Y=0 地面 · 身高 ' + (metrics.heightM !== null ? metrics.heightM.toFixed(2) + 'm' : (props.targetHeightM ? Number(props.targetHeightM).toFixed(2) + 'm' : '—')) + ' · 头身比 ' + activeRatio.toFixed(2) + ' · 颈缩放 ' + activeNeck.toFixed(2) + 'x'))
    : null;

  return h('div',null,
    h('div',{className:'ck-viewport',style:{position:'relative',height:'clamp(280px,52vh,480px)',minHeight:280,overflow:'hidden'}},
      h('div',{ref:ref,style:{position:'absolute',inset:0}},null),
      !showTriPlanes && props.overlayUrl?h('img',{src:props.overlayUrl,alt:isEn?'Reference overlay':'参考叠图',style:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',opacity:props.opacity??.35,pointerEvents:'none'}}):null,
      props.guides?h('div',{className:'ck-viewport-guide','aria-hidden':'true'}):null,
      hudText?h('div',{className:'ck-viewport-hud',role:'status'},hudText):null),
    h('p',{className:'ck-muted',role:'status'},message),
    props.calibrationControls ? h('div',{className:'ck-row ck-calibration-strip'},
      h('label',{className:'ck-field'},h('span',null,isEn?'Head-body ratio':'目标头身比'),
        h('input',{type:'range',min:'4.5',max:'8.5',step:'0.05',value:String(activeRatio),onChange:function(e){commitCalibration(Number(e.target.value), activeNeck);}})),
      h('label',{className:'ck-field'},h('span',null,isEn?'Neck scale':'颈部缩放'),
        h('input',{type:'range',min:'0.60',max:'1.25',step:'0.01',value:String(activeNeck),onChange:function(e){commitCalibration(activeRatio, Number(e.target.value));}})),
      h('button',{className:'ck-btn',type:'button',disabled:!cal.past.length,onClick:undoCalibration},isEn?'Undo':'撤销'),
      h('button',{className:'ck-btn',type:'button',disabled:!cal.future.length,onClick:redoCalibration},isEn?'Redo':'重做')) : null,
    motionState.ready ? h('div',{className:'ck-row'},
      h('button',{className:'ck-btn',type:'button',onClick:function(){var playing=!motionState.playing;if(sceneRef.current)sceneRef.current.externalPlaying=playing;setMotionState({ready:true,playing:playing});}},
        isEn?(motionState.playing?'Pause VRMA':'Play VRMA'):(motionState.playing?'暂停 VRMA':'播放 VRMA')),
      h('button',{className:'ck-btn',type:'button',onClick:function(){sceneRef.current?.resetMotion();}},isEn?'Restart motion':'动作从头播放')) : null);
}
