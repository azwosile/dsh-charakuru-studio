// Offline Three.js / optional VRM renderer. StudioThree is bundled into the lazy client factory.
function GeometryPreview(props) {
  var ref = React.useRef(null), sceneRef = React.useRef(null);
  var status = React.useState('正在加载模型…'), message = status[0], setMessage = status[1];
  React.useEffect(function () {
    var T = StudioThree, host = ref.current, abort = new AbortController(), disposed = false, frame = 0;
    var renderer, controls, scene, camera, avatar = null, root = null, bounds, center, radius;
    try { renderer = new T.WebGLRenderer({antialias:true,alpha:true}); }
    catch(error) {setMessage('WebGL 不可用：'+error.message);return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x141e2b,1);
    host.appendChild(renderer.domElement);scene=new T.Scene();camera=new T.PerspectiveCamera(35,1,.01,2000);
    scene.add(new T.HemisphereLight(0xffffff,0x607080,2.5));var light=new T.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
    controls=new T.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    function resize(){var w=Math.max(1,host.clientWidth),h=Math.max(280,host.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
    var observer=new ResizeObserver(resize);observer.observe(host);resize();
    function pose(name) {
      if(!center)return;
      var directions={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],perspective:[1,.5,1]};var v=directions[name]||directions.perspective;
      camera.position.copy(center).add(new T.Vector3(v[0],v[1],v[2]).normalize().multiplyScalar(radius*3.5));camera.near=Math.max(.001,radius/1000);camera.far=Math.max(100,radius*100);camera.updateProjectionMatrix();controls.target.copy(center);controls.update();
    }
    var elapsed=0,last=performance.now();
    function tick(now){if(disposed)return;var dt=Math.min(.05,(now-last)/1000);last=now;elapsed+=dt;controls.update();
      if(avatar){if(sceneRef.current?.playMotion){var h=avatar.humanoid;[['leftUpperLeg',1],['rightUpperLeg',-1],['leftUpperArm',-1],['rightUpperArm',1]].forEach(function(pair){var bone=h.getNormalizedBoneNode(pair[0]);if(bone)bone.rotation.x=Math.sin(elapsed*4)*.22*pair[1];});}else avatar.humanoid.resetNormalizedPose();avatar.update(dt);}
      renderer.render(scene,camera);frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    sceneRef.current={pose:pose,playMotion:props.playMotion};
    fetch(props.url,{signal:abort.signal}).then(function(r){if(!r.ok)throw Error('资产读取失败：'+r.status);return r.arrayBuffer();}).then(function(buffer){return new Promise(function(resolve,reject){var loader=new T.GLTFLoader();loader.manager.setURLModifier(function(url){if(!/^(blob:|data:)/.test(url))throw Error('External model resources blocked; embed textures and buffers in the GLB');return url;});loader.register(function(parser){return new T.VRMLoaderPlugin(parser);});loader.parse(buffer,'',resolve,reject);});}).then(function(gltf){
      if(disposed){gltf.scene.traverse(function(o){o.geometry?.dispose();});return;}
      root=gltf.scene;avatar=gltf.userData.vrm||null;scene.add(root);bounds=new T.Box3().setFromObject(root);center=bounds.getCenter(new T.Vector3());radius=Math.max(.01,bounds.getSize(new T.Vector3()).length()/2);pose(props.camera||'front');
      var meshes=0,triangles=0;root.traverse(function(obj){if(obj.isMesh){meshes++;triangles+=(obj.geometry.index?obj.geometry.index.count:obj.geometry.attributes.position.count)/3;}});
      setMessage(meshes+' 个网格 · '+Math.round(triangles)+' 三角形 · '+(avatar?'VRM 运行时 / 弹簧已加载':'GLB 材质 / 纹理 / 蒙皮预览')+' · 拖动旋转、滚轮缩放、点击选择对象；动作演示不等于质量验收');
    }).catch(function(error){if(!disposed)setMessage(error.message);});
    var ray=new T.Raycaster(),pointer=new T.Vector2(),press=null;
    function down(event){press=[event.clientX,event.clientY];}
    function up(event){if(!root||!press||Math.hypot(event.clientX-press[0],event.clientY-press[1])>5)return;var box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera);var hits=ray.intersectObject(root,true);if(hits[0]&&props.onSelect)props.onSelect(hits[0].object.name);}
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
    return function(){disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);scene.traverse(function(obj){obj.geometry?.dispose();var materials=Array.isArray(obj.material)?obj.material:[obj.material];materials.filter(Boolean).forEach(function(mat){Object.values(mat).forEach(function(v){if(v?.isTexture)v.dispose();});mat.dispose();});});renderer.dispose();renderer.domElement.remove();sceneRef.current=null;};
  },[props.url]);
  React.useEffect(function(){sceneRef.current?.pose(props.camera);},[props.camera]);
  React.useEffect(function(){if(sceneRef.current)sceneRef.current.playMotion=props.playMotion;},[props.playMotion]);
  return h('div',null,h('div',{style:{position:'relative',height:480,minHeight:280}},h('div',{ref:ref,style:{position:'absolute',inset:0}},null),props.overlayUrl?h('img',{src:props.overlayUrl,alt:'Reference overlay',style:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',opacity:props.opacity??.35,pointerEvents:'none'}}):null),h('p',{className:'ck-muted'},message));
}
