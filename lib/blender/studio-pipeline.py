# Original Blender editor / production operations. COMMAND is injected as a JSON string.
# Never executes text supplied by a model. Opens input with script autoexecution disabled.
import bpy, json, math, os, sys, traceback, uuid
from mathutils import Vector, Matrix, Euler

C = json.loads(COMMAND)
P = C['params']
O = C['outputs']
notes = []

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def enable_vrm(required=False):
    import addon_utils
    root = P.get('vrmAddonPath')
    if root:
        require(os.path.isdir(root), 'VRM add-on search path does not exist')
        if root not in sys.path:
            sys.path.insert(0, root)
    if hasattr(bpy.types.Armature, 'vrm_addon_extension'):
        return True
    candidates = []
    if P.get('vrmAddonModule'):
        candidates.append(P['vrmAddonModule'])
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
            addon_utils.enable(mod_name, default_set=True, persistent=True)  # In-memory preferences only; never save_userpref()
            if hasattr(bpy.types.Armature, 'vrm_addon_extension'):
                return True
        except Exception:
            continue
    if required:
        require(hasattr(bpy.types.Armature, 'vrm_addon_extension'), 'VRM Add-on unavailable; install a compatible official add-on or configure its local path')
    return hasattr(bpy.types.Armature, 'vrm_addon_extension')

def rig():
    found = bpy.data.objects.get(P.get('armature', ''))
    if found is None:
        candidates = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.get('avatar_studio_weight_reference')]
        require(len(candidates) == 1, 'Choose one explicit armature')
        found = candidates[0]
    require(found.type == 'ARMATURE', 'Selected armature is not a rig')
    return found

def visible_meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and not o.name.startswith('COL_') and not o.name.endswith('_proxy')]

def select_export():
    bpy.ops.object.select_all(action='DESELECT')
    selected = visible_meshes() + [o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.get('avatar_studio_weight_reference')]
    for o in selected:
        o.hide_set(False)
        o.select_set(True)
    if selected:
        bpy.context.view_layer.objects.active = next((o for o in selected if o.type == 'ARMATURE'), selected[0])

def configure_vrm():
    enable_vrm(required=True)
    arm = rig()
    ext = arm.data.vrm_addon_extension
    ext.spec_version = '1.0'
    mapping = P.get('humanBones')
    require(isinstance(mapping, dict) and mapping, 'VRM setup requires explicit humanoid-to-bone mapping')
    human = ext.vrm1.humanoid.human_bones.human_bone_name_to_human_bone()
    for key, bone in human.items():
        name = getattr(key, 'value', str(key))
        if name in mapping:
            require(mapping[name] in arm.data.bones, 'Missing bone: ' + mapping[name])
            bone.node.bone_name = mapping[name]
    required = ['hips','spine','head','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand']
    missing = [name for name in required if not any(getattr(k, 'value', str(k)) == name and b.node.bone_name for k, b in human.items())]
    require(not missing, 'Required humanoid assignments missing: ' + ','.join(missing))
    meta = ext.vrm1.meta
    require(P.get('title') and P.get('authors'), 'Explicit avatar title and authors required; no inferred redistribution permission')
    meta.vrm_name = P['title']
    meta.version = '1.0'
    meta.authors.clear()
    for name in P['authors']:
        meta.authors.add().value = str(name)
    meta.commercial_usage = P.get('commercialUsage','personalNonProfit')
    meta.avatar_permission = 'onlyAuthor'
    meta.allow_redistribution = False
    meta.modification = 'prohibited'
    notes.append('VRM metadata restricts use and redistribution by default; authors retain responsibility for input rights.')

def head_scale():
    arm = rig()
    head = arm.data.bones.get(P.get('headBone','head'))
    pivot = arm.data.bones.get(P.get('pivotBone','neck'))
    require(head is not None and pivot is not None, 'Explicit head and neck pivot bones are required')
    factor = float(P['factor'])
    require(0.75 <= factor <= 1.25, 'Head scale outside safe editing range')
    influenced = {head.name} | {b.name for b in head.children_recursive}
    origin = arm.matrix_world @ pivot.tail_local
    changed = 0
    for obj in visible_meshes():
        selected = {g.index for g in obj.vertex_groups if g.name in influenced}
        if not selected:
            continue
        weights = [min(1.0, sum(g.weight for g in v.groups if g.group in selected)) for v in obj.data.vertices]
        inverse = obj.matrix_world.inverted()
        groups = [k.data for k in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [obj.data.vertices]
        for vertices in groups:
            for i, v in enumerate(vertices):
                weight = weights[i]
                if weight <= 0:
                    continue
                world = obj.matrix_world @ v.co
                v.co = inverse @ (origin + (world-origin) * (1.0 + (factor-1.0)*weight))
                changed += 1
    require(changed > 0, 'No vertices weighted to selected head/hair bones')
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    pivot_local = arm.matrix_world.inverted() @ origin
    for bone in arm.data.edit_bones:
        if bone.name in influenced:
            bone.head = pivot_local + (bone.head-pivot_local)*factor
            bone.tail = pivot_local + (bone.tail-pivot_local)*factor
    bpy.ops.object.mode_set(mode='OBJECT')
    notes.append('Weighted head and descendant hair bones scaled together; neck transition and appearance require visual review.')

def normalize_weights():
    arm = rig()
    targets = P.get('objects') or [o.name for o in visible_meshes()]
    for name in targets:
        obj = bpy.data.objects.get(name)
        require(obj is not None and obj.type == 'MESH', 'Unknown mesh: ' + name)
        deform = {g.index:g for g in obj.vertex_groups if g.name in arm.data.bones and arm.data.bones[g.name].use_deform}
        for vertex in obj.data.vertices:
            weights = [(deform[g.group],g.weight) for g in vertex.groups if g.group in deform and g.weight > 0]
            total = sum(w for _,w in weights)
            require(total > 0.000001, f'Unweighted vertex: {name}:{vertex.index}; normalization cannot invent anatomical weights')
            for group, weight in weights:
                group.add([vertex.index],weight/total,'REPLACE')

def transfer_weights():
    # Explicit same-project source only; no bundled donor or guessed anatomical labels.
    from mathutils.bvhtree import BVHTree
    arm=rig()
    source=bpy.data.objects.get(P.get('sourceMesh',''))
    require(source is not None and source.type=='MESH', 'Choose an explicit weighted source mesh')
    require(P.get('objects') and source.name not in P['objects'], 'Choose distinct target meshes')
    deps=bpy.context.evaluated_depsgraph_get()
    eval_src=source.evaluated_get(deps)
    src_mesh=eval_src.to_mesh()
    try:
        src_mesh.calc_loop_triangles()
        triangles=[tuple(t.vertices) for t in src_mesh.loop_triangles]
        vertices=[eval_src.matrix_world @ v.co for v in src_mesh.vertices]
        tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
        bone_groups={g.index:g.name for g in source.vertex_groups if g.name in arm.data.bones and arm.data.bones[g.name].use_deform}
        maximum=float(P.get('maxTransferDistance',0.25))
        src_verts=src_mesh.vertices if len(src_mesh.vertices)==len(source.data.vertices) else source.data.vertices
        for name in P['objects']:
            target=bpy.data.objects.get(name)
            require(target is not None and target.type=='MESH','Unknown weight target '+name)
            groups={name:(target.vertex_groups.get(name) or target.vertex_groups.new(name=name)) for name in bone_groups.values()}
            for vertex in target.data.vertices:
                point=target.matrix_world @ vertex.co
                hit,normal,index,distance=tree.find_nearest(point)
                require(hit is not None and distance<=maximum,f'Weight transfer too far: {target.name}:{vertex.index} distance={distance}; increase explicit bound only after review')
                ia,ib,ic=triangles[index];a,b,c=vertices[ia],vertices[ib],vertices[ic]
                ab,ac,ap=b-a,c-a,hit-a;d00=ab.dot(ab);d01=ab.dot(ac);d11=ac.dot(ac);d20=ap.dot(ab);d21=ap.dot(ac);den=d00*d11-d01*d01
                if abs(den)<1e-15:coeff=[1,0,0]
                else:
                    v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den;coeff=[max(0,1-v-w),max(0,v),max(0,w)]
                weights={}
                for vi,weight in zip((ia,ib,ic),coeff):
                    v_groups=src_verts[vi].groups if src_verts[vi].groups else source.data.vertices[vi].groups
                    for membership in v_groups:
                        if membership.group in bone_groups:
                            bname=bone_groups[membership.group];weights[bname]=weights.get(bname,0)+membership.weight*weight
                top_weights=sorted([(bname,w) for bname,w in weights.items() if w>1e-7],key=lambda item:item[1],reverse=True)[:4]
                total=sum(w for _,w in top_weights);require(total>1e-6,'Source triangle has no deform weights')
                for group in target.vertex_groups:
                    if group.name in arm.data.bones and arm.data.bones[group.name].use_deform:group.remove([vertex.index])
                for bname,weight in top_weights:
                    groups[bname].add([vertex.index],weight/total,'REPLACE')
            if target.parent is None:
                target.parent=arm
            modifiers=[m for m in target.modifiers if m.type=='ARMATURE']
            require(len(modifiers)<=1,'Multiple armature modifiers require manual review')
            modifier=modifiers[0] if modifiers else target.modifiers.new('AvatarStudioArmature','ARMATURE')
            modifier.object=arm
    finally:
        eval_src.to_mesh_clear()
    notes.append('Explicit surface-interpolated weights from '+source.name+'; no anatomical or collision quality claim. Source mesh unchanged.')

def make_skirt(arm, spec):
    obj = bpy.data.objects.get(spec.get('mesh',''))
    require(obj is not None and obj.type == 'MESH', 'Choose the skirt mesh')
    top, bottom = float(spec['waistZ']), float(spec['hemZ'])
    require(top > bottom and top-bottom < 2, 'Skirt bounds must be in armature-local meters')
    segments, rings = int(spec.get('segments',8)), int(spec.get('rings',3))
    require(4 <= segments <= 24 and 2 <= rings <= 6, 'Skirt chain count outside limits')
    root = arm.data.bones.get(spec.get('rootBone','hips'))
    require(root is not None, 'Skirt parent bone missing')
    inverse = arm.matrix_world.inverted()
    positions = [(v.index, inverse @ obj.matrix_world @ v.co) for v in obj.data.vertices]
    positions = [(i,v) for i,v in positions if bottom <= v.z <= top]
    require(len(positions) > 30, 'Skirt region contains too few vertices')
    center = root.head_local.copy()
    radius = max(math.hypot(v.x-center.x,v.y-center.y) for _,v in positions)
    require(radius > 0.02, 'Skirt radius is degenerate')
    prefix = 'AS_skirt_'
    require(not any(b.name.startswith(prefix) for b in arm.data.bones), 'Skirt chains already exist; rollback before reconfiguration')
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    chains=[]
    for segment in range(segments):
        angle=2*math.pi*segment/segments
        previous=arm.data.edit_bones[root.name]
        names=[]
        for ring in range(rings):
            bone=arm.data.edit_bones.new(f'{prefix}{segment:02d}_{ring}')
            r0=radius*(0.55+0.45*ring/rings)
            r1=radius*(0.55+0.45*(ring+1)/rings)
            bone.head=(center.x+math.cos(angle)*r0,center.y+math.sin(angle)*r0,top-(top-bottom)*ring/rings)
            bone.tail=(center.x+math.cos(angle)*r1,center.y+math.sin(angle)*r1,top-(top-bottom)*(ring+1)/rings)
            bone.parent=previous
            previous=bone
            names.append(bone.name)
        chains.append(names)
    bpy.ops.object.mode_set(mode='OBJECT')
    deform_names={b.name for b in arm.data.bones if b.use_deform}
    groups={name:obj.vertex_groups.new(name=name) for chain in chains for name in chain}
    for index,v in positions:
        angle=(math.atan2(v.y-center.y,v.x-center.x)+2*math.pi)%(2*math.pi)
        section=angle/(2*math.pi)*segments
        left=int(section)%segments
        alpha=section-int(section)
        ring=min(rings-1,int((top-v.z)/(top-bottom)*rings))
        strength=min(1,max(0,(top-v.z)/(top-bottom)*3))
        original=[(obj.vertex_groups[g.group],g.weight) for g in obj.data.vertices[index].groups if obj.vertex_groups[g.group].name in deform_names and not obj.vertex_groups[g.group].name.startswith(prefix)]
        total=sum(w for _,w in original)
        require(total > 0, f'Unweighted skirt vertex {index}')
        for group,w in original:
            group.add([index],w/total*(1-strength),'REPLACE')
        groups[chains[left][ring]].add([index],strength*(1-alpha),'REPLACE')
        groups[chains[(left+1)%segments][ring]].add([index],strength*alpha,'REPLACE')
    for mod in list(obj.modifiers):
        if mod.type in {'CLOTH','SURFACE_DEFORM'}:
            obj.modifiers.remove(mod)
    notes.append('Skirt region converted to explicit skeletal weights in this revision; Blender cloth/surface deformation removed only from selected mesh. Motion penetration requires visual review.')
    return chains

def spring_setup():
    enable_vrm(required=True)
    arm=rig()
    sb=arm.data.vrm_addon_extension.spring_bone1
    require(not sb.springs and not sb.colliders, 'Spring configuration already exists; use a prior revision or edit explicitly in Blender')
    chains=P.get('chains',[])
    if P.get('skirt'):
        chains=chains+make_skirt(arm,P['skirt'])
    require(chains, 'Explicit spring chains required')
    collider_group=sb.collider_groups.add()
    collider_group.uuid=uuid.uuid4().hex
    collider_group.vrm_name='Avatar Studio body colliders'
    for spec in P.get('colliderBones',[]):
        bone=arm.data.bones.get(spec['bone'])
        require(bone is not None,'Collider bone missing: '+spec['bone'])
        collider=sb.colliders.add()
        collider.uuid=uuid.uuid4().hex
        collider.node.bone_name=bone.name
        collider.shape_type='Capsule'
        collider.reset_bpy_object(bpy.context,arm)
        collider.shape.capsule.offset=(0,0,0)
        collider.shape.capsule.tail=(0,bone.length,0)
        collider.shape.capsule.radius=float(spec.get('radius',0.04))
        ref=collider_group.colliders.add()
        ref.collider_uuid=collider.uuid
    for index,chain in enumerate(chains):
        require(isinstance(chain,list) and len(chain)>1,'Each spring chain needs at least two existing bones')
        spring=sb.springs.add()
        spring.vrm_name='Avatar Studio '+str(index)
        for bone_name in chain:
            require(bone_name in arm.data.bones,'Spring bone missing: '+bone_name)
            joint=spring.joints.add()
            joint.node.bone_name=bone_name
            joint.hit_radius=float(P.get('hitRadius',0.015))
            joint.stiffness=float(P.get('stiffness',1.0))
            joint.drag_force=float(P.get('dragForce',0.5))
            joint.gravity_power=float(P.get('gravityPower',0.1))
            joint.gravity_dir=(0,0,-1)
        if len(collider_group.colliders):
            spring.collider_groups.add().collider_group_uuid=collider_group.uuid

def material_check():
    mode = P.get('materialMode','preserve')
    require(mode in {'preserve','pbr'}, 'Material mode must be preserve or pbr')
    if mode == 'pbr':
        replaced = {}
        for obj in visible_meshes():
            for slot in obj.material_slots:
                old = slot.material
                require(old is not None and old.use_nodes, 'Material source graph missing on '+obj.name)
                if old.name not in replaced:
                    textures = [n.image for n in old.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
                    colors = [image for image in textures if image.colorspace_settings.name != 'Non-Color' and 'normal' not in image.name.lower()]
                    require(colors, 'Choose a base-color texture before converting '+old.name)
                    image = max(colors,key=lambda image:image.size[0]*image.size[1])
                    mat = bpy.data.materials.new(old.name+'_AS_PBR')
                    mat.use_nodes = True
                    nodes = mat.node_tree.nodes
                    bsdf = nodes.get('Principled BSDF')
                    tex = nodes.new('ShaderNodeTexImage')
                    tex.image = image
                    mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
                    bsdf.inputs['Roughness'].default_value = 0.8
                    replaced[old.name] = mat
                slot.material = replaced[old.name]
        notes.append('PBR material branch created with existing base-color textures; original shader graphs remain in prior revisions.')
    checked=0
    for obj in visible_meshes():
        require(obj.material_slots,'Missing material on '+obj.name)
        for slot in obj.material_slots:
            mat=slot.material
            require(mat is not None,'Empty material slot on '+obj.name)
            require(mat.use_nodes,'Material has no node graph: '+mat.name)
            require(any(n.type in {'BSDF_PRINCIPLED','EMISSION','GROUP'} for n in mat.node_tree.nodes),'No exportable shader in '+mat.name)
            checked+=1
    require(checked>0,'No render materials found')
    notes.append('Material operation validates existing materials and packed texture availability; it does not claim automatic texture reconstruction.')

def ancestors(obj):
    while obj.parent is not None:
        obj=obj.parent
        yield obj


def bound_to(obj, arm):
    return any(m.type == 'ARMATURE' and m.object == arm for m in obj.modifiers) or arm in ancestors(obj)


def fit_foundation():
    # Stretch the existing rig and its associated meshes together; never change indices/UVs/groups.
    arm = rig()
    body = bpy.context.scene.objects.get(P['bodyObject'])
    require(body is not None and body.type == 'MESH' and bound_to(body, arm), 'Choose an existing body mesh bound to the selected rig')
    meshes = [o for o in bpy.context.scene.objects if o.type=='MESH' and bound_to(o,arm)]
    keep = P.get('keepMeshes')
    if keep:
        require(all(any(x.name==n for x in meshes) for n in keep), 'Keep-list must name meshes on the selected rig')
        for obj in meshes:
            if obj.name not in keep:
                obj.hide_render = True
                obj.hide_set(True)
                obj['studio_foundation_reference'] = True
            elif obj.get('studio_foundation_reference'):
                obj.hide_render=False
                obj.hide_set(False)
                del obj['studio_foundation_reference']
    factors = tuple(P.get('scale', (1.,1.,1.)))
    scales = P.get('shapeValues', [])
    if scales:
        keys = body.data.shape_keys
        require(keys is not None and keys.use_relative, 'Selected body does not have relative shape keys')
        driven = {fc.data_path for fc in keys.animation_data.drivers} if keys.animation_data else set()
        for value in scales:
            key = keys.key_blocks.get(value['key'])
            require(key and key != keys.reference_key and key.path_from_id('value') not in driven and key.slider_min <= value['value'] <= key.slider_max, 'Not a writable body shape: '+value['key'])
            key.value = value['value']
    bpy.context.view_layer.update()
    points = [body.matrix_world @ Vector(v) for v in body.bound_box]
    floor = min(v.z for v in points)
    if factors != (1.,1.,1.):
        pivot=Vector(((min(v.x for v in points)+max(v.x for v in points))*.5,
                      (min(v.y for v in points)+max(v.y for v in points))*.5,floor))
        nodes = set([arm]+meshes)
        roots = [o for o in nodes if not any(p in nodes for p in ancestors(o))]
        group = bpy.data.objects.new('Studio_FoundationFit', None)
        bpy.context.scene.collection.objects.link(group)
        group.location=pivot
        bpy.context.view_layer.update()
        for obj in roots:
            world=obj.matrix_world.copy()
            obj.parent=group
            obj.parent_type='OBJECT'
            obj.matrix_parent_inverse=Matrix.Identity(4)
            obj.matrix_world=world
        group.scale=factors
        bpy.context.view_layer.update()
        result=min((body.matrix_world @ Vector(v)).z for v in body.bound_box)
        require(abs(result-floor)<.0001, 'Foot-anchor check failed; no new revision activated')
    notes.append('Existing body/Rig adjusted together (X,Y,Z); vertex order, UV and weights are retained. Recheck joints, fit and neck visually.')


def append_foundation_head():
    material=C['material']
    arm=rig()
    bind=P['headBone']
    require(bind in arm.data.bones, 'Named head bone is not present in the current rig')
    replace=[]
    for name in P.get('replaceHeadObjects',[]):
        obj=bpy.context.scene.objects.get(name)
        require(obj and obj.type=='MESH' and bound_to(obj,arm), 'Old head mesh not found on the active rig: '+name)
        replace.append(obj)
    before={obj.as_pointer() for obj in bpy.data.objects}
    with bpy.data.libraries.load(material['path'],link=False) as (source,target):
        require(all(name in source.objects for name in P['objects']), 'A named head object is not in this library')
        target.objects=P['objects']
    meshes=target.objects
    require(all(o and o.type=='MESH' and o.as_pointer() not in before for o in meshes), 'The selected head entries must be new Blender mesh objects')
    group = bpy.data.collections.new('Studio_Head_Source')
    bpy.context.scene.collection.children.link(group)
    for obj in meshes:
        group.objects.link(obj)
    bpy.context.view_layer.update()
    # Existing topology, UVs and expression keys remain; a different skeleton is not treated as compatible.
    # This is rigid head-follow fit, not facial bone or eye weight retargeting.
    shift=Vector(P.get('translation',(0,0,0)))
    scale=P.get('scale',(1,1,1))
    rot_deg=P.get('rotation',(0,0,0))
    rot_mat=Euler([math.radians(float(a)) for a in rot_deg],'XYZ').to_matrix().to_4x4()
    donor_coords=[obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
    if donor_coords:
        d_min=Vector((min(p.x for p in donor_coords),min(p.y for p in donor_coords),min(p.z for p in donor_coords)))
        d_max=Vector((max(p.x for p in donor_coords),max(p.y for p in donor_coords),max(p.z for p in donor_coords)))
        pivot=(d_min+d_max)*0.5
    else:
        pivot=arm.matrix_world @ arm.data.bones[bind].head_local
    fit=Matrix.Translation(pivot+shift) @ rot_mat @ Matrix.Diagonal((*scale,1)) @ Matrix.Translation(-pivot)
    for obj in meshes:
        world=fit @ obj.matrix_world.copy()
        for mod in list(obj.modifiers):
            if mod.type=='ARMATURE':obj.modifiers.remove(mod)
        # Rig-independent head meshes preserve morph data; object constraints from the old rig are dropped.
        for constraint in list(obj.constraints):obj.constraints.remove(constraint)
        obj.parent=arm
        obj.parent_type='BONE'
        obj.parent_bone=bind
        obj.matrix_parent_inverse=Matrix.Identity(4)
        bpy.context.view_layer.update()
        obj.matrix_world=world
        obj.hide_render=False
        obj.hide_set(False)
        obj['avatar_studio_material_id']=material['id']
    for obj in replace:
        obj.hide_render=True
        obj.hide_set(True)
    notes.append('Appended the named head meshes with UVs and shape keys; rigid head-bone follow only. Face/eye rig, seam and apparent shading need separate checks.')


def append_material_mesh():
    material = C['material']
    before = {obj.as_pointer() for obj in bpy.context.scene.objects}
    result = bpy.ops.import_scene.gltf(filepath=material['path'])
    imported = [obj for obj in bpy.context.scene.objects if obj.as_pointer() not in before]
    require('FINISHED' in result and any(obj.type == 'MESH' for obj in imported), 'Imported GLB contains no mesh')
    donor = material['role'] == 'weight_mesh'
    for obj in imported:
        obj['avatar_studio_material_id'] = material['id']
        if donor:
            obj['avatar_studio_weight_reference'] = True
            obj.hide_render = True
    notes.append('External GLB appended as '+('non-exporting weight reference objects' if donor else 'new objects')+': '+', '.join(o.name for o in imported))
    if donor:
        notes.append('No weights were transferred. Choose corresponding bones and explicitly run transfer_weights.')

def apply_material_texture():
    material = C['material']
    slot_index = P['textureSlot']
    image = bpy.data.images.load(material['path'], check_existing=False)
    image.pack()
    for name in P['objects']:
        obj = bpy.context.scene.objects.get(name)
        require(obj is not None and obj.type == 'MESH' and obj.data.uv_layers.active, 'Choose a mesh with active UVs: '+name)
        require(len(obj.material_slots) > slot_index or (not obj.material_slots and slot_index == 0), 'Material slot does not exist on '+name)
        if not obj.material_slots:
            obj.data = obj.data.copy()
            obj.data.materials.append(bpy.data.materials.new(name+'_BaseColor'))
        slot = obj.material_slots[slot_index]
        old = slot.material
        mat = old.copy() if old else bpy.data.materials.new(name+'_BaseColor')
        mat.use_nodes = True
        require(mat.node_tree is not None, 'Missing shader node graph on '+name)
        bsdfs = [node for node in mat.node_tree.nodes if node.type=='BSDF_PRINCIPLED']
        require(len(bsdfs)==1, 'Expected one Principled BSDF for Base Color on '+name)
        bsdf = bsdfs[0]
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.label = 'Avatar Studio external base color'
        tex.image = image
        tex.location = (bsdf.location.x-300, bsdf.location.y)
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        slot.link = 'OBJECT'
        slot.material = mat
    notes.append('Packed external PNG was connected as Base Color on explicit targets only; UVs, other channels and earlier revisions were preserved.')

def audit():
    objects=[]
    for obj in bpy.context.scene.objects:
        if obj.type not in {'MESH','ARMATURE'}:
            continue
        row={'name':obj.name,'type':obj.type,'helper':obj not in visible_meshes() if obj.type=='MESH' else False,'dimensions':list(obj.dimensions),'location':list(obj.location),'scale':list(obj.scale)}
        if obj.type=='MESH':
            rigid_bone_parent = (
                obj.parent_type == 'BONE'
                and obj.parent is not None
                and obj.parent.type == 'ARMATURE'
                and obj.parent_bone in obj.parent.data.bones
                and not any(m.type == 'ARMATURE' for m in obj.modifiers)
            )
            deform={g.index for g in obj.vertex_groups if any(a.type=='ARMATURE' and g.name in a.data.bones and a.data.bones[g.name].use_deform for a in bpy.context.scene.objects)}
            unweighted=0
            not_normalized=0
            if not rigid_bone_parent:
                for v in obj.data.vertices:
                    total=sum(g.weight for g in v.groups if g.group in deform)
                    unweighted+=int(total<0.00001)
                    not_normalized+=int(abs(total-1)>0.01)
            keys=obj.data.shape_keys
            row['shapeKeyCount']=len(keys.key_blocks)-1 if keys else 0
            row['shapeKeys']=([{'name':k.name,'value':round(k.value,4)} for k in keys.key_blocks if k!=keys.reference_key][:80] if keys else [])
            row['quadFaces']=sum(1 for poly in obj.data.polygons if len(poly.vertices)==4)
            row['uvLayers']=len(obj.data.uv_layers)
            row.update(vertices=len(obj.data.vertices),faces=len(obj.data.polygons),unweighted=unweighted,nonNormalized=not_normalized,materials=[s.material.name if s.material else None for s in obj.material_slots],modifiers=[m.type for m in obj.modifiers])
        else:
            row['bones']=[b.name for b in obj.data.bones]
            row['bonePositions']={b.name:{'head':list(b.head_local),'tail':list(b.tail_local)} for b in obj.data.bones}
            if hasattr(obj.data,'vrm_addon_extension'):
                ext=obj.data.vrm_addon_extension
                row.update(springs=len(ext.spring_bone1.springs),colliders=len(ext.spring_bone1.colliders),springJoints=sum(len(s.joints) for s in ext.spring_bone1.springs))
        objects.append(row)
    missing=[i.name for i in bpy.data.images if i.source=='FILE' and not i.packed_file and i.filepath and not os.path.isfile(bpy.path.abspath(i.filepath))]
    meshes=[o for o in objects if o['type']=='MESH' and not o['helper']]
    return {'requestId':C['requestId'],'blenderVersion':bpy.app.version_string,'operation':C['operation'],'objects':objects,'missingImages':missing,'gates':{'textures':not missing,'weights':bool(meshes) and all(o['unweighted']==0 and o['nonNormalized']==0 for o in meshes)},'notes':notes,'visualReview':'required','expressions':P.get('expressions','preserve'),'sourceFilesModified':False,'materialInput':{'id':C['material']['id'],'sha256':C['material']['sha256'],'role':C['material']['role']} if C.get('material') else None}

def pose_check():
    arm=rig()
    snapshot={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
    frames=[]
    try:
        for angle in [0,0.25,-0.25]:
            for name in ['thigh.L','thigh.R','upper_arm.L','upper_arm.R']:
                bone=arm.pose.bones.get(name)
                if bone:
                    bone.rotation_mode='XYZ'
                    bone.rotation_euler.x=angle*(-1 if name.endswith('.R') else 1)
            bpy.context.view_layer.update()
            deps=bpy.context.evaluated_depsgraph_get()
            for obj in visible_meshes():
                evaluated=obj.evaluated_get(deps)
                mesh=evaluated.to_mesh()
                try:
                    require(all(math.isfinite(v) for vert in mesh.vertices for v in vert.co),'Nonfinite deformed vertex in '+obj.name)
                finally:
                    evaluated.to_mesh_clear()
            frames.append(angle)
    finally:
        for bone in arm.pose.bones:
            bone.matrix_basis=snapshot[bone.name]
        bpy.context.view_layer.update()
    notes.append('Deformation finite-value probe angles='+str(frames)+'. This is not a visual collision or gait acceptance test.')

try:
    vrm_required = bool(P.get('vrmAddonPath') or C['operation'] in {'configure_vrm','spring_setup','export_vrm'})
    enable_vrm(required=vrm_required)
    bpy.ops.wm.open_mainfile(filepath=C['inputBlend'],load_ui=False,use_scripts=False)
    if bpy.context.object and bpy.context.object.mode!='OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    operation=C['operation']
    if operation=='head_scale':
        head_scale()
    elif operation=='transform':
        rot_deg=P.get('rotation',[0,0,0])
        has_rot=any(abs(float(a))>1e-9 for a in rot_deg)
        rot_euler=Euler([math.radians(float(a)) for a in rot_deg],'XYZ')
        for name in P['objects']:
            obj=bpy.data.objects.get(name)
            require(obj is not None and obj.type=='MESH','Explicit mesh selection required: '+name)
            obj.scale=Vector([a*b for a,b in zip(obj.scale,P.get('scale',[1,1,1]))])
            if has_rot:
                if obj.rotation_mode!='XYZ':
                    obj.rotation_euler=obj.rotation_euler.to_matrix().to_euler('XYZ')
                    obj.rotation_mode='XYZ'
                obj.rotation_euler.rotate(rot_euler)
            obj.location+=Vector(P.get('translation',[0,0,0]))
    elif operation=='fit_foundation':
        fit_foundation()
    elif operation=='append_foundation_head':
        append_foundation_head()
    elif operation=='append_material_mesh':
        append_material_mesh()
    elif operation=='apply_material_texture':
        apply_material_texture()
    elif operation=='transfer_weights':
        transfer_weights()
    elif operation=='normalize_weights':
        normalize_weights()
    elif operation=='materials':
        material_check()
    elif operation=='configure_vrm':
        configure_vrm()
    elif operation=='spring_setup':
        spring_setup()
    elif operation=='pose_check':
        pose_check()
    elif operation not in {'import_blend','import_checkpoint','import_material_scene','audit','export_vrm'}:
        raise RuntimeError('Unknown operation')
    report=audit()
    require(not report['missingImages'],'Missing source images: '+','.join(report['missingImages']))
    bpy.ops.file.pack_all()
    # Save a new immutable project revision only; source file is never saved in place.
    bpy.ops.wm.save_as_mainfile(filepath=O['blend'],check_existing=False,compress=False)
    select_export()
    bpy.ops.export_scene.gltf(filepath=O['preview'],export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
    if operation=='export_vrm':
        require(report['gates']['weights'],'Export blocked by unweighted or non-normalized mesh vertices')
        result=bpy.ops.export_scene.vrm(filepath=O['vrm'],export_only_selections=True,export_invisibles=False,armature_object_name=rig().name)
        require('FINISHED' in result and os.path.isfile(O['vrm']),'VRM exporter rejected the scene; inspect its validation errors')
    with open(O['report'],'w',encoding='utf-8') as f:
        json.dump(report,f,ensure_ascii=False,indent=2)
    print('HEADLESS '+json.dumps({'verdict':'pass','requestId':C['requestId'],'outputs':O,'visualReview':'required'},ensure_ascii=False))
except Exception as error:
    print('HEADLESS '+json.dumps({'verdict':'fail','requestId':C['requestId'],'error':str(error),'traceback':traceback.format_exc()},ensure_ascii=False))
    raise
