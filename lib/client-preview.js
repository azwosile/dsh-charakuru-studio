// Offline Three.js / optional VRM renderer. StudioThree is bundled into the lazy client factory.
function GeometryPreview(props) {
  var isEn = props.lang !== 'Zh';
  var ref = React.useRef(null), sceneRef = React.useRef(null);
  var status = React.useState(isEn ? 'Loading model…' : '正在加载模型…'), message = status[0], setMessage = status[1];
  var motion = React.useState({ ready:false, playing:false }), motionState = motion[0], setMotionState = motion[1];
  React.useEffect(function () {
    setMotionState({ready:false,playing:false});
    setMessage(props.lang!=='Zh'?'Loading model…':'正在加载模型…');
    var T = StudioThree, host = ref.current, abort = new AbortController(), disposed = false, frame = 0;
    var renderer, controls, scene, camera, orth, persp, wireMat, span=1, avatar = null, root = null, mixer = null, bounds, center, radius;
    try { renderer = new T.WebGLRenderer({antialias:true,alpha:true}); }
    catch(error) {setMessage((props.lang!=='Zh'?'WebGL unavailable: ':'WebGL 不可用：')+error.message);return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x141e2b,1);
    Object.assign(renderer.domElement.style,{width:'100%',height:'100%',display:'block'});
    host.appendChild(renderer.domElement);scene=new T.Scene();persp=new T.PerspectiveCamera(35,1,.01,2000);orth=new T.OrthographicCamera(-1,1,1,-1,.01,2000);camera=persp;
    wireMat=new T.MeshBasicMaterial({color:0x8fd9f8,wireframe:true});
    scene.add(new T.HemisphereLight(0xffffff,0x607080,2.5));var light=new T.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
    controls=new T.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(280,host.clientHeight);renderer.setSize(w,h,false);var aspect=w/h;persp.aspect=aspect;persp.updateProjectionMatrix();var fit=Math.min(1,aspect);orth.left=-span*aspect/fit;orth.right=span*aspect/fit;orth.top=span/fit;orth.bottom=-span/fit;orth.updateProjectionMatrix();}
    var observer=new ResizeObserver(resize);observer.observe(host);resize();
    function pose(name) {
      if(!center)return;
      var directions={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,0],perspective:[1,.5,1]};var v=directions[name]||directions.perspective;
      camera=props.orthographic&&name!=='perspective'?orth:persp;controls.object=camera;camera.zoom=1;camera.up.set(0,name==='top'?0:1,name==='top'?-1:0);span=radius*1.10;resize();
      camera.position.copy(center).add(new T.Vector3(v[0],v[1],v[2]).normalize().multiplyScalar(radius*3.5));camera.near=Math.max(.001,radius/1000);camera.far=Math.max(100,radius*100);camera.updateProjectionMatrix();controls.target.copy(center);controls.update();
    }
    var elapsed=0,last=performance.now();
    function tick(now){if(disposed)return;var dt=Math.min(.05,(now-last)/1000);last=now;elapsed+=dt;controls.update();
      if(avatar){if(mixer){if(sceneRef.current.externalPlaying)mixer.update(dt);}else if(sceneRef.current?.playMotion){var h=avatar.humanoid;[['leftUpperLeg',1],['rightUpperLeg',-1],['leftUpperArm',-1],['rightUpperArm',1]].forEach(function(pair){var bone=h.getNormalizedBoneNode(pair[0]);if(bone)bone.rotation.x=Math.sin(elapsed*4)*.22*pair[1];});}else avatar.humanoid.resetNormalizedPose();avatar.update(dt);}
      scene.overrideMaterial=sceneRef.current?.wireframe?wireMat:null;renderer.render(scene,camera);frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    sceneRef.current={pose:pose,wireframe:props.wireframe,playMotion:props.playMotion,externalPlaying:false,resetMotion:function(){if(mixer){mixer.setTime(0);avatar.update(0);}}};
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
    fetchModel(props.url,T.VRMLoaderPlugin).then(async function(gltf){
      if(disposed){freeModel(gltf.scene);return;}
      root=gltf.scene;avatar=gltf.userData.vrm||null;scene.add(root);bounds=new T.Box3().setFromObject(root);center=bounds.getCenter(new T.Vector3());radius=Math.max(.01,bounds.getSize(new T.Vector3()).length()/2);pose(props.camera||'front');
      var meshes=0,triangles=0;root.traverse(function(obj){if(obj.isMesh){meshes++;triangles+=(obj.geometry.index?.count || obj.geometry.attributes.position?.count || 0)/3;}});
      var label = meshes+' meshes · '+Math.round(triangles)+' triangles · '+(avatar?'VRM / humanoid':'GLB / embedded mesh');
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
    }).catch(function(error){if(!disposed)setMessage(error.message);});
    var ray=new T.Raycaster(),pointer=new T.Vector2(),press=null;
    function down(event){press=[event.clientX,event.clientY];}
    function up(event){if(!root||!press||Math.hypot(event.clientX-press[0],event.clientY-press[1])>5)return;var box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera);var hits=ray.intersectObject(root,true);if(hits[0]&&props.onSelect)props.onSelect(hits[0].object.name);}
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
    return function(){disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);if(mixer){mixer.stopAllAction();mixer.uncacheRoot(avatar.scene);}freeModel(scene);wireMat.dispose();renderer.dispose();renderer.domElement.remove();sceneRef.current=null;};
  },[props.url,props.motionUrl]);
  React.useEffect(function(){sceneRef.current?.pose(props.camera);},[props.camera,props.fitSignal]);
  React.useEffect(function(){if(sceneRef.current)sceneRef.current.wireframe=props.wireframe;},[props.wireframe]);
  React.useEffect(function(){if(sceneRef.current)sceneRef.current.playMotion=props.playMotion;},[props.playMotion]);
  return h('div',null,h('div',{className:'ck-viewport',style:{position:'relative',height:'clamp(280px,52vh,480px)',minHeight:280,overflow:'hidden'}},h('div',{ref:ref,style:{position:'absolute',inset:0}},null),props.overlayUrl?h('img',{src:props.overlayUrl,alt:'Reference overlay',style:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',opacity:props.opacity??.35,pointerEvents:'none'}}):null,props.guides?h('div',{className:'ck-viewport-guide','aria-hidden':'true'}):null),h('p',{className:'ck-muted',role:'status'},message),
    motionState.ready ? h('div',{className:'ck-row'},
      h('button',{className:'ck-btn',type:'button',onClick:function(){var playing=!motionState.playing;if(sceneRef.current)sceneRef.current.externalPlaying=playing;setMotionState({ready:true,playing:playing});}},
        isEn?(motionState.playing?'Pause VRMA':'Play VRMA'):(motionState.playing?'暂停 VRMA':'播放 VRMA')),
      h('button',{className:'ck-btn',type:'button',onClick:function(){sceneRef.current?.resetMotion();}},isEn?'Restart motion':'动作从头播放')) : null);
}
