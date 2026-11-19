# Fixed local renderer. COMMAND is injected by the host; never evaluate a user's brief or code.
import bpy, json, math, os, sys, traceback
from mathutils import Vector

C=json.loads(COMMAND)
P=C['recipe']
S=C['settings']
D=C['output']

def require(ok,message):
    if not ok:
        raise RuntimeError(message)

def enable_vrm(required=False):
    import addon_utils
    root = P.get('vrmAddonPath') or C.get('vrmAddonPath')
    if root:
        require(os.path.isdir(root), 'VRM add-on search path does not exist')
        if root not in sys.path:
            sys.path.insert(0, root)
    if hasattr(bpy.types.Armature, 'vrm_addon_extension'):
        return True
    candidates = []
    mod_hint = P.get('vrmAddonModule') or C.get('vrmAddonModule')
    if mod_hint:
        candidates.append(mod_hint)
    for name in ('bl_ext.user_default.vrm', 'bl_ext.blender_org.vrm', 'io_scene_vrm', 'VRM_Addon_for_Blender-release'):
        if name not in candidates:
            candidates.append(name)
    try:
        for mod in addon_utils.modules():
            name = getattr(mod, '__name__', '')
            if 'vrm' in name.lower() and name not in candidates:
                candidates.append(name)
    except Exception:
        pass
    for mod_name in candidates:
        try:
            addon_utils.enable(mod_name, default_set=True, persistent=True)
            if hasattr(bpy.types.Armature, 'vrm_addon_extension'):
                return True
        except Exception:
            continue
    if required:
        require(hasattr(bpy.types.Armature, 'vrm_addon_extension'), 'VRM Add-on unavailable; install a compatible official add-on or configure its local path')
    return hasattr(bpy.types.Armature, 'vrm_addon_extension')


def add_area(scene,name,position,look_at,power,color,size):
    data=bpy.data.lights.new(name,'AREA')
    data.color=color
    data.energy=power
    data.shape='DISK'
    data.size=size
    obj=bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location=position
    obj.rotation_euler=(look_at-position).to_track_quat('-Z','Y').to_euler()


def make_toon(mat):
    # Preserve nontrivial (including eye/alpha/specialty) graphs. Never modify the input .blend.
    if not mat or not mat.use_nodes or not mat.node_tree:
        return False
    tree=mat.node_tree
    outs=[n for n in tree.nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output]
    if len(outs)!=1 or not outs[0].inputs['Surface'].is_linked or outs[0].inputs['Volume'].is_linked or outs[0].inputs['Displacement'].is_linked:
        return False
    output=outs[0].inputs['Surface']
    bsdf=output.links[0].from_node
    if bsdf.type!='BSDF_PRINCIPLED' or bsdf.inputs['Alpha'].is_linked or bsdf.inputs['Alpha'].default_value<.999:
        return False
    for name in ['Transmission Weight','Emission Strength','Coat Weight','Metallic','Subsurface Weight']:
        sock=bsdf.inputs.get(name)
        if sock and (sock.is_linked or sock.default_value>.01):
            return False
    diffuse=tree.nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.inputs['Color'].default_value=(1,1,1,1)
    linear=tree.nodes.new('ShaderNodeShaderToRGB')
    tree.links.new(diffuse.outputs[0],linear.inputs[0])
    ramp=tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation='EASE'
    ramp.color_ramp.elements[0].position=.24
    ramp.color_ramp.elements[0].color=(.40,.44,.60,1)
    ramp.color_ramp.elements[1].position=.51
    ramp.color_ramp.elements[1].color=(1.0,.98,.95,1)
    tree.links.new(linear.outputs[0], ramp.inputs[0])
    mix=tree.nodes.new('ShaderNodeMixRGB')
    mix.blend_type='MULTIPLY'
    mix.inputs[0].default_value=1.0
    base=bsdf.inputs['Base Color']
    if base.is_linked:
        tree.links.new(base.links[0].from_socket,mix.inputs[1])
    else:
        mix.inputs[1].default_value=base.default_value
    tree.links.new(ramp.outputs['Color'],mix.inputs[2])
    em=tree.nodes.new('ShaderNodeEmission')
    tree.links.new(mix.outputs[0],em.inputs[0])
    tree.links.new(em.outputs[0],output)
    return True


def render():
    enable_vrm(required=bool(P.get('vrmAddonPath') or C.get('vrmAddonPath')))
    bpy.ops.wm.open_mainfile(filepath=C['inputBlend'],load_ui=False,use_scripts=False)
    scene=bpy.context.scene
    view=bpy.context.view_layer
    render_objects=[o for o in scene.objects if o.type=='MESH' and not o.hide_render and o.visible_get() and not o.name.startswith('COL_') and not o.name.endswith('_proxy')]
    require(render_objects,'No visible renderable avatar meshes in this revision')
    # Preview selected meshes only; preserve dependency objects for deformation and drivers.
    allowed={o.as_pointer() for o in render_objects}
    for o in scene.objects:
        if o.as_pointer() not in allowed:
            o.hide_render=True
    deps=bpy.context.evaluated_depsgraph_get()
    coords=[]
    for obj in render_objects:
        ev=obj.evaluated_get(deps)
        coords.extend(ev.matrix_world @ Vector(p) for p in ev.bound_box)
    require(coords and all(math.isfinite(c) for p in coords for c in p),'Mesh bounds are invalid')
    lo=Vector([min(p[i] for p in coords) for i in range(3)])
    hi=Vector([max(p[i] for p in coords) for i in range(3)])
    height=hi.z-lo.z
    require(.01<=height<=100 and max(hi-lo)<=100,'Model scale is unsuitable for this preview')
    subject=(lo+hi)/2
    # Blender Z up, front -Y as with the glTF front preview. Presets do not guess facial direction.
    angles={'front':0,'three_quarter':.46,'profile':math.pi/2,'back':math.pi}
    angle=angles[P['camera']]
    direction=Vector((math.sin(angle),-math.cos(angle),.058))
    right=Vector((math.cos(angle),math.sin(angle),0))
    target=subject.copy()
    if P['framing']=='portrait':
        target.z=lo.z+.855*height
    cam_data=bpy.data.cameras.new('Studio_Camera')
    cam=bpy.data.objects.new('Studio_Camera',cam_data)
    scene.collection.objects.link(cam)
    cam.location=target+direction*height*2.6
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    cam_data.type='ORTHO'
    width,px_height=C['pixels']
    aspect=width/px_height
    horizontal=max(abs((p-target).dot(right)) for p in coords)*2
    if P['framing']=='portrait':
        cam_data.ortho_scale=height*.47*max(1,aspect)
    else:
        cam_data.ortho_scale=max(horizontal,height*aspect)*(1.23 if aspect>=1 else 1.23/aspect)
    cam_data.clip_start=max(.001,height*.005)
    cam_data.clip_end=max(100,height*20)
    scene.camera=cam
    strength=height*height
    aim=subject+Vector((0,0,height*.13))
    frontal=Vector((math.sin(angle),-math.cos(angle),0))
    up=Vector((0,0,1))
    add_area(scene,'Studio_Key',aim+height*(frontal*1.45-right*.56+up*.94),aim,300*strength*P['key'],S['keyColor'],height*.84)
    add_area(scene,'Studio_Fill',aim+height*(frontal*1.12+right*.91-up*.30),aim,132*strength*P['fill'],S['fillColor'],height*1.04)
    add_area(scene,'Studio_Rim',aim+height*(-frontal*.85+right*.36+up*.89),aim,276*strength*P['rim'],S['rimColor'],height*.60)
    world=bpy.data.worlds.new('Studio_World')
    world.use_nodes=True
    world.node_tree.nodes.get('Background').inputs[0].default_value=(*S['backdrop'],1)
    world.node_tree.nodes.get('Background').inputs[1].default_value=.65
    scene.world=world
    if S['floor']:
        bpy.ops.mesh.primitive_plane_add(size=height*100,location=(subject.x,subject.y,lo.z-height*.012))
        floor=bpy.context.object
        floor.name='Studio_Floor'
        mat=bpy.data.materials.new('Studio_Backdrop')
        mat.use_nodes=True
        node=mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value=(*S['backdrop'],1)
        node.inputs['Roughness'].default_value=.93
        node.inputs['Emission Color'].default_value=(*S['backdrop'],1)
        node.inputs['Emission Strength'].default_value=.24
        floor.data.materials.append(mat)
    mats={slot.material for o in render_objects for slot in o.material_slots if slot.material}
    # Stop instead of emitting a supposedly finished portrait with missing or remote source textures.
    def check_images(tree,seen):
        if not tree or tree.as_pointer() in seen:
            return
        seen.add(tree.as_pointer())
        for node in tree.nodes:
            image=getattr(node,'image',None)
            if image and image.source not in {'GENERATED','VIEWER'}:
                require(bool(image.packed_file or image.packed_files),'Unpacked image on a visible render material: '+image.name)
            if node.type=='GROUP':
                check_images(node.node_tree,seen)
    seen=set()
    for mat in mats:
        check_images(mat.node_tree,seen)
    toon_count=sum(1 for mat in mats if P['toon'] and make_toon(mat))
    scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=width
    scene.render.resolution_y=px_height
    scene.render.resolution_percentage=100
    scene.render.pixel_aspect_x=scene.render.pixel_aspect_y=1
    scene.render.use_border=False
    scene.render.use_crop_to_border=False
    scene.render.film_transparent=False
    scene.render.use_compositing=False
    scene.render.use_sequencer=False
    scene.render.use_multiview=False
    for layer in scene.view_layers:
        layer.use=(layer==view)
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='None'
    scene.view_settings.exposure=P['exposure']
    scene.view_settings.gamma=1.0
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGB'
    scene.render.image_settings.color_depth='8'
    scene.render.use_file_extension=True
    scene.render.filepath=os.path.join(D,'render.png')
    require('FINISHED' in bpy.ops.render.render(write_still=True),'Blender did not finish rendering')
    notes=['Local still, no change to model revision or VRM; material and light edits are in-memory only.']
    if P['toon']:
        notes.append('Compatible opaque Principled materials only; custom/alpha/hair shaders may be preserved. No facial SDF or per-part outline shell is synthesized.')
    report={k:C[k] for k in ('requestId','revisionId','blendHash','recipe')}
    report.update(blenderVersion=bpy.app.version_string,engine=scene.render.engine,meshes=len(render_objects),toonMaterials=toon_count,materialCount=len(mats),frame=scene.frame_current,notes=notes)
    with open(os.path.join(D,'report.json'),'w',encoding='utf8') as out:
        json.dump(report,out,ensure_ascii=False,indent=2)
    print('HEADLESS '+json.dumps({'verdict':'pass','requestId':C['requestId']},ensure_ascii=False),flush=True)

try:
    render()
except Exception as error:
    print('HEADLESS '+json.dumps({'verdict':'fail','requestId':C['requestId'],'error':str(error),'traceback':traceback.format_exc()},ensure_ascii=False),flush=True)
    raise
