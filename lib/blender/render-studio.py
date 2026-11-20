# Fixed local renderer. COMMAND is injected by the host; never evaluate a user's brief or code.
import bpy, json, math, os, sys, traceback
from mathutils import Vector

C = json.loads(COMMAND)
P = C['recipe']
S = C['settings']
D = C['output']

EYE_ALPHA_TOKENS = (
    'eye', 'iris', 'cornea', 'pupil', 'sclera', 'lash', 'eyelash', 'tear', 'highlight',
)
OUTLINE_ZERO_TOKENS = (
    'eye', 'cornea', 'lash', 'eyelash', 'mouth', 'lip', 'teeth', 'tooth',
    'tongue', 'pupil', 'iris', 'sclera', 'tear', '目', 'まぶた', '口', '唇', '歯', '舌',
)
FACE_MAT_TOKENS = ('face', 'kao', '顔')
SKIN_MAT_TOKENS = ('skin', 'head', '肌', '顔')


def require(ok, message):
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


def add_area(scene, name, position, look_at, power, color, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.color = color
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (look_at - position).to_track_quat('-Z', 'Y').to_euler()
    return obj


def new_rgba_mix(tree, blend_type='MULTIPLY', factor=1.0):
    mix = tree.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = blend_type
    fac_sock = next((s for s in mix.inputs if s.name == 'Factor' and s.type == 'VALUE'), mix.inputs[0])
    in_a = next((s for s in mix.inputs if s.name == 'A' and s.type == 'RGBA'), mix.inputs[6])
    in_b = next((s for s in mix.inputs if s.name == 'B' and s.type == 'RGBA'), mix.inputs[7])
    out_r = next((s for s in mix.outputs if s.name == 'Result' and s.type == 'RGBA'), mix.outputs[2])
    fac_sock.default_value = factor
    return mix, in_a, in_b, out_r


def active_surface_socket(mat):
    if not mat or not mat.use_nodes or not mat.node_tree:
        return None, None
    tree = mat.node_tree
    outs = [n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output]
    if not outs:
        outs = [n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL']
    if len(outs) != 1:
        return None, None
    out_node = outs[0]
    surf = out_node.inputs.get('Surface')
    if not surf or not surf.is_linked or out_node.inputs['Volume'].is_linked or out_node.inputs['Displacement'].is_linked:
        return None, None
    return tree, surf


def is_mtoon_material(mat):
    if not mat or not mat.use_nodes or not mat.node_tree:
        return False
    ext = getattr(mat, 'vrm_addon_extension', None)
    mtoon1 = getattr(ext, 'mtoon1', None) if ext else None
    if mtoon1 and getattr(mtoon1, 'enabled', False):
        return True
    for node in mat.node_tree.nodes:
        if node.type == 'GROUP' and node.node_tree and 'mtoon' in node.node_tree.name.lower():
            return True
    if 'mtoon' in mat.name.lower() and any(n.type == 'GROUP' for n in mat.node_tree.nodes):
        return True
    return False


def is_preserved_eye_or_alpha(mat, bsdf):
    low = mat.name.lower()
    if any(tok in low for tok in EYE_ALPHA_TOKENS):
        return True
    if getattr(mat, 'blend_method', 'OPAQUE') not in ('OPAQUE', 'CLIP'):
        return True
    if getattr(mat, 'surface_render_method', 'DITHERED') == 'BLENDED':
        return True
    alpha_sock = bsdf.inputs.get('Alpha')
    if alpha_sock and (alpha_sock.is_linked or alpha_sock.default_value < 0.999):
        return True
    for name, thresh in (('Transmission Weight', 0.01), ('Emission Strength', 0.01), ('Coat Weight', 0.2)):
        sock = bsdf.inputs.get(name)
        if sock and (sock.is_linked or sock.default_value > thresh):
            return True
    return False


def connect_base_color(tree, bsdf, target_socket):
    base = bsdf.inputs.get('Base Color')
    if not base:
        return
    if base.is_linked:
        tree.links.new(base.links[0].from_socket, target_socket)
    else:
        target_socket.default_value = tuple(base.default_value)


def resolve_head_light_dots(scene, key_dir, cam_dir):
    l_eff = (0.70 * key_dir + 0.30 * cam_dir).normalized()
    arms = [o for o in scene.objects if o.type == 'ARMATURE' and not o.get('avatar_studio_weight_reference')]
    head_pb = None
    head_arm = None
    head_candidates = ('head', 'Head', 'J_Bip_C_Head', 'mixamorig:Head', '頭')
    for arm in arms:
        ext = getattr(arm.data, 'vrm_addon_extension', None)
        if ext and hasattr(ext, 'vrm1'):
            try:
                human = ext.vrm1.humanoid.human_bones.human_bone_name_to_human_bone()
                for k, hb in human.items():
                    if getattr(k, 'value', str(k)) == 'head' and hb.node.bone_name in arm.pose.bones:
                        head_pb = arm.pose.bones[hb.node.bone_name]
                        head_arm = arm
                        break
            except Exception:
                pass
        if head_pb is None and ext and hasattr(ext, 'vrm0'):
            try:
                for hb in getattr(ext.vrm0.humanoid, 'human_bones', []):
                    if str(getattr(hb, 'human_bone', '') or '').lower() == 'head':
                        bname = getattr(getattr(hb, 'node', None), 'bone_name', '')
                        if bname and bname in arm.pose.bones:
                            head_pb = arm.pose.bones[bname]
                            head_arm = arm
                            break
            except Exception:
                pass
        if head_pb is None:
            for cand in head_candidates:
                if cand in arm.pose.bones:
                    head_pb = arm.pose.bones[cand]
                    head_arm = arm
                    break
        if head_pb is None:
            for pb in arm.pose.bones:
                if pb.name.lower() in {'head', 'j_bip_c_head', 'mixamorig:head', '頭'}:
                    head_pb = pb
                    head_arm = arm
                    break
        if head_pb is not None:
            break

    if head_arm is not None and head_pb is not None:
        rest_rot = (head_arm.matrix_world @ head_pb.bone.matrix_local).to_3x3()
        local_fwd = rest_rot.inverted() @ Vector((0.0, -1.0, 0.0))
        local_right = rest_rot.inverted() @ Vector((1.0, 0.0, 0.0))
        pose_rot = (head_arm.matrix_world @ head_pb.matrix).to_3x3()
        head_fwd = (pose_rot @ local_fwd).normalized()
        head_right = (pose_rot @ local_right).normalized()
    else:
        head_fwd = Vector((0.0, -1.0, 0.0))
        head_right = Vector((1.0, 0.0, 0.0))

    side_dot = max(-1.0, min(1.0, l_eff.dot(head_right)))
    fwd_dot = max(-1.0, min(1.0, l_eff.dot(head_fwd)))
    return side_dot, fwd_dot


def build_toon_metallic(tree, surf, bsdf, key_dir):
    base = bsdf.inputs.get('Base Color')
    dark_mix, d_a, d_b, d_out = new_rgba_mix(tree, 'MULTIPLY', 1.0)
    if base and base.is_linked:
        tree.links.new(base.links[0].from_socket, d_a)
    elif base:
        d_a.default_value = tuple(base.default_value)
    d_b.default_value = (0.48, 0.50, 0.58, 1.0)

    geom = tree.nodes.new('ShaderNodeNewGeometry')
    light_vec = tree.nodes.new('ShaderNodeCombineXYZ')
    light_vec.inputs[0].default_value = key_dir.x
    light_vec.inputs[1].default_value = key_dir.y
    light_vec.inputs[2].default_value = key_dir.z

    half_add = tree.nodes.new('ShaderNodeVectorMath')
    half_add.operation = 'ADD'
    tree.links.new(light_vec.outputs['Vector'], half_add.inputs[0])
    tree.links.new(geom.outputs['Incoming'], half_add.inputs[1])

    half_norm = tree.nodes.new('ShaderNodeVectorMath')
    half_norm.operation = 'NORMALIZE'
    tree.links.new(half_add.outputs['Vector'], half_norm.inputs[0])

    ndoth = tree.nodes.new('ShaderNodeVectorMath')
    ndoth.operation = 'DOT_PRODUCT'
    tree.links.new(geom.outputs['Normal'], ndoth.inputs[0])
    tree.links.new(half_norm.outputs['Vector'], ndoth.inputs[1])

    spec_ramp = tree.nodes.new('ShaderNodeValToRGB')
    spec_ramp.color_ramp.interpolation = 'LINEAR'
    spec_ramp.color_ramp.elements[0].position = 0.89
    spec_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    spec_ramp.color_ramp.elements[1].position = 0.94
    spec_ramp.color_ramp.elements[1].color = (0.85, 0.90, 1.0, 1.0)
    tree.links.new(ndoth.outputs['Value'], spec_ramp.inputs[0])

    lw = tree.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.35
    fresnel_ramp = tree.nodes.new('ShaderNodeValToRGB')
    fresnel_ramp.color_ramp.elements[0].position = 0.65
    fresnel_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    fresnel_ramp.color_ramp.elements[1].position = 0.85
    fresnel_ramp.color_ramp.elements[1].color = (0.28, 0.32, 0.42, 1.0)
    tree.links.new(lw.outputs['Facing'], fresnel_ramp.inputs[0])

    add_spec, s_a, s_b, s_out = new_rgba_mix(tree, 'ADD', 1.0)
    tree.links.new(d_out, s_a)
    tree.links.new(spec_ramp.outputs['Color'], s_b)

    add_rim, r_a, r_b, r_out = new_rgba_mix(tree, 'ADD', 1.0)
    tree.links.new(s_out, r_a)
    tree.links.new(fresnel_ramp.outputs['Color'], r_b)

    em = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(r_out, em.inputs[0])
    tree.links.new(em.outputs[0], surf)


def build_face_sdf_shader(tree, surf, bsdf, sdf_image, side_dot, fwd_dot):
    tex_coord = tree.nodes.new('ShaderNodeTexCoord')
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(tex_coord.outputs['UV'], sep.inputs['Vector'])

    comb = tree.nodes.new('ShaderNodeCombineXYZ')
    if side_dot < 0.0:
        flip = tree.nodes.new('ShaderNodeMath')
        flip.operation = 'SUBTRACT'
        flip.inputs[0].default_value = 1.0
        tree.links.new(sep.outputs['X'], flip.inputs[1])
        tree.links.new(flip.outputs['Value'], comb.inputs['X'])
    else:
        tree.links.new(sep.outputs['X'], comb.inputs['X'])
    tree.links.new(sep.outputs['Y'], comb.inputs['Y'])
    tree.links.new(sep.outputs['Z'], comb.inputs['Z'])

    sdf_tex = tree.nodes.new('ShaderNodeTexImage')
    sdf_tex.image = sdf_image
    sdf_tex.extension = 'CLIP'
    tree.links.new(comb.outputs['Vector'], sdf_tex.inputs['Vector'])

    threshold = max(0.02, min(0.98, 0.5 - 0.5 * fwd_dot))
    rgb_bw = tree.nodes.new('ShaderNodeRGBToBW')
    tree.links.new(sdf_tex.outputs['Color'], rgb_bw.inputs['Color'])
    diff = tree.nodes.new('ShaderNodeMath')
    diff.operation = 'SUBTRACT'
    tree.links.new(rgb_bw.outputs['Val'], diff.inputs[0])
    diff.inputs[1].default_value = threshold

    map_r = tree.nodes.new('ShaderNodeMapRange')
    map_r.clamp = True
    map_r.inputs['From Min'].default_value = -0.025
    map_r.inputs['From Max'].default_value = 0.025
    map_r.inputs['To Min'].default_value = 0.0
    map_r.inputs['To Max'].default_value = 1.0
    tree.links.new(diff.outputs['Value'], map_r.inputs['Value'])

    shade_mix, sh_a, sh_b, sh_out = new_rgba_mix(tree, 'MIX', 1.0)
    fac_sock = next((s for s in shade_mix.inputs if s.name == 'Factor' and s.type == 'VALUE'), shade_mix.inputs[0])
    tree.links.new(map_r.outputs['Result'], fac_sock)
    sh_a.default_value = (0.92, 0.81, 0.83, 1.0)
    sh_b.default_value = (1.0, 0.99, 0.98, 1.0)

    mul_mix, m_a, m_b, m_out = new_rgba_mix(tree, 'MULTIPLY', 1.0)
    connect_base_color(tree, bsdf, m_a)
    tree.links.new(sh_out, m_b)

    em = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(m_out, em.inputs[0])
    tree.links.new(em.outputs[0], surf)


def build_toon_three_tier(tree, surf, bsdf, is_skin=False, specular_rim=True):
    diffuse = tree.nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    linear = tree.nodes.new('ShaderNodeShaderToRGB')
    tree.links.new(diffuse.outputs[0], linear.inputs[0])

    ramp = tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'EASE'
    el0 = ramp.color_ramp.elements[0]
    el1 = ramp.color_ramp.elements[1]
    el2 = ramp.color_ramp.elements.new(0.62)
    el0.position = 0.18
    el1.position = 0.42
    if is_skin:
        el0.color = (0.86, 0.72, 0.75, 1.0)
        el1.color = (0.96, 0.89, 0.88, 1.0)
    else:
        el0.color = (0.52, 0.54, 0.70, 1.0)
        el1.color = (0.84, 0.84, 0.91, 1.0)
    el2.color = (1.0, 0.99, 0.97, 1.0)
    tree.links.new(linear.outputs[0], ramp.inputs[0])

    mul_mix, m_a, m_b, m_out = new_rgba_mix(tree, 'MULTIPLY', 1.0)
    connect_base_color(tree, bsdf, m_a)
    tree.links.new(ramp.outputs['Color'], m_b)

    final_out = m_out
    if specular_rim:
        lw = tree.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.28
        rim_ramp = tree.nodes.new('ShaderNodeValToRGB')
        rim_ramp.color_ramp.elements[0].position = 0.74
        rim_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
        rim_ramp.color_ramp.elements[1].position = 0.86
        rim_ramp.color_ramp.elements[1].color = (0.16, 0.20, 0.28, 1.0)
        tree.links.new(lw.outputs['Facing'], rim_ramp.inputs[0])
        add_mix, a_a, a_b, a_out = new_rgba_mix(tree, 'ADD', 1.0)
        tree.links.new(m_out, a_a)
        tree.links.new(rim_ramp.outputs['Color'], a_b)
        final_out = a_out

    em = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(final_out, em.inputs[0])
    tree.links.new(em.outputs[0], surf)


def _mat_has_mtoon_outline(mat):
    if not is_mtoon_material(mat):
        return False
    ext = getattr(mat, 'vrm_addon_extension', None)
    mtoon1 = getattr(ext, 'mtoon1', None) if ext else None
    mtoon_ext = getattr(getattr(mtoon1, 'extensions', None), 'vrmc_materials_mtoon', None) if mtoon1 else None
    if mtoon_ext is not None:
        mode = str(getattr(mtoon_ext, 'outline_width_mode', 'none') or 'none').lower()
        return mode != 'none'
    return False


def apply_outline_shells(render_objects, thickness, color):
    outline_mat = bpy.data.materials.new('AS_Toon_Outline')
    outline_mat.use_nodes = True
    outline_mat.use_backface_culling = True
    nt = outline_mat.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out_node = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    geom = nt.nodes.new('ShaderNodeNewGeometry')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (float(color[0]), float(color[1]), float(color[2]), 1.0)
    em.inputs['Strength'].default_value = 1.0
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix_sh = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(geom.outputs['Backfacing'], mix_sh.inputs['Fac'])
    nt.links.new(em.outputs['Emission'], mix_sh.inputs[1])
    nt.links.new(trans.outputs['BSDF'], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs['Shader'], out_node.inputs['Surface'])

    outline_meshes = 0
    for obj in render_objects:
        low_name = obj.name.lower()
        if not obj.data.polygons or any(tok in low_name for tok in ('cornea', 'eyeball', 'eye_highlight', 'tear')):
            continue
        obj_mats = [s.material for s in obj.material_slots if s.material]
        if obj_mats and all(_mat_has_mtoon_outline(m) for m in obj_mats):
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        vg = obj.vertex_groups.get('AS_OutlineMask')
        if vg is None:
            vg = obj.vertex_groups.new(name='AS_OutlineMask')
        zero_verts = set()
        zero_group_indices = {
            g.index for g in obj.vertex_groups
            if g.name != 'AS_OutlineMask' and any(tok in g.name.lower() for tok in OUTLINE_ZERO_TOKENS)
        }
        if zero_group_indices:
            for v in obj.data.vertices:
                if any(g.group in zero_group_indices and g.weight > 0.1 for g in v.groups):
                    zero_verts.add(v.index)
        zero_mat_indices = {
            idx for idx, s in enumerate(obj.material_slots)
            if s.material and any(tok in s.material.name.lower() for tok in OUTLINE_ZERO_TOKENS)
        }
        if zero_mat_indices:
            for poly in obj.data.polygons:
                if poly.material_index in zero_mat_indices:
                    zero_verts.update(poly.vertices)
        all_verts = [v.index for v in obj.data.vertices if v.index not in zero_verts]
        if all_verts:
            vg.add(all_verts, 1.0, 'REPLACE')
        if zero_verts:
            vg.add(sorted(zero_verts), 0.0, 'REPLACE')

        last_slot_idx = len(obj.material_slots) - 1
        if last_slot_idx >= 0 and obj.material_slots[last_slot_idx].material == outline_mat:
            mat_idx = last_slot_idx
        else:
            obj.data.materials.append(outline_mat)
            mat_idx = len(obj.material_slots) - 1

        mod = obj.modifiers.new('AS_Outline', 'SOLIDIFY')
        mod.thickness = thickness
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = False
        mod.material_offset = mat_idx
        mod.material_offset_rim = mat_idx
        mod.vertex_group = 'AS_OutlineMask'
        mod.thickness_vertex_group = 0.0
        outline_meshes += 1
    return outline_meshes


def set_color_management(scene, desired_vt, desired_look, exposure):
    vt_items = [item.identifier for item in scene.view_settings.bl_rna.properties['view_transform'].enum_items]
    if desired_vt in vt_items:
        scene.view_settings.view_transform = desired_vt
    elif 'Standard' in vt_items:
        scene.view_settings.view_transform = 'Standard'
    look_items = [item.identifier for item in scene.view_settings.bl_rna.properties['look'].enum_items]
    vt_active = scene.view_settings.view_transform
    if desired_look in look_items:
        scene.view_settings.look = desired_look
    elif f'{vt_active} - {desired_look}' in look_items:
        scene.view_settings.look = f'{vt_active} - {desired_look}'
    elif 'None' in look_items:
        scene.view_settings.look = 'None'
    scene.view_settings.exposure = exposure
    scene.view_settings.gamma = 1.0
    return scene.view_settings.view_transform, scene.view_settings.look


def render():
    enable_vrm(required=bool(P.get('vrmAddonPath') or C.get('vrmAddonPath')))
    bpy.ops.wm.open_mainfile(filepath=C['inputBlend'], load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    view = bpy.context.view_layer

    if P.get('frame') is not None:
        scene.frame_set(int(P['frame']))

    render_objects = [
        o for o in scene.objects
        if o.type == 'MESH' and not o.hide_render and o.visible_get()
        and not o.name.startswith('COL_') and not o.name.endswith('_proxy')
        and not o.name.startswith('Studio_FoundationFit')
    ]
    require(render_objects, 'No visible renderable avatar meshes in this revision')

    allowed = {o.as_pointer() for o in render_objects}
    for o in scene.objects:
        if o.as_pointer() not in allowed:
            o.hide_render = True

    deps = bpy.context.evaluated_depsgraph_get()
    coords = []
    for obj in render_objects:
        ev = obj.evaluated_get(deps)
        coords.extend(ev.matrix_world @ Vector(p) for p in ev.bound_box)
    require(coords and all(math.isfinite(c) for p in coords for c in p), 'Mesh bounds are invalid')
    lo = Vector([min(p[i] for p in coords) for i in range(3)])
    hi = Vector([max(p[i] for p in coords) for i in range(3)])
    height = hi.z - lo.z
    require(0.01 <= height <= 100 and max(hi - lo) <= 100, 'Model scale is unsuitable for this preview')
    subject = (lo + hi) / 2

    angles = {'front': 0.0, 'three_quarter': 0.46, 'profile': math.pi / 2, 'back': math.pi}
    angle = angles[P['camera']] + math.radians(float(P.get('yawDeg') or 0.0))
    if P.get('pitchDeg') is not None:
        pitch = math.radians(float(P['pitchDeg']))
        horiz = math.cos(pitch)
        direction = Vector((math.sin(angle) * horiz, -math.cos(angle) * horiz, math.sin(pitch)))
    else:
        direction = Vector((math.sin(angle), -math.cos(angle), 0.058))
    right = Vector((math.cos(angle), math.sin(angle), 0.0))

    target = subject.copy()
    if P['framing'] == 'portrait':
        target.z = lo.z + 0.855 * height

    cam_data = bpy.data.cameras.new('Studio_Camera')
    cam = bpy.data.objects.new('Studio_Camera', cam_data)
    scene.collection.objects.link(cam)

    width, px_height = C['pixels']
    require(width > 0 and px_height > 0, 'Render pixel dimensions must be positive')
    aspect = width / px_height
    horizontal = max(abs((p - target).dot(right)) for p in coords) * 2.0
    lens_type = str(P.get('lensType') or 'ortho').lower()
    if lens_type == 'persp':
        cam_data.type = 'PERSP'
        cam_data.lens = float(P.get('lens') or 50.0)
        cam_data.sensor_fit = 'HORIZONTAL'
        tan_hfov = max(1e-4, (cam_data.sensor_width * 0.5) / cam_data.lens)
        tan_vfov = tan_hfov / max(1e-4, aspect)
        if P['framing'] == 'portrait':
            frame_h = height * 0.47
            frame_w = frame_h * aspect
        else:
            frame_h = height * 1.23
            frame_w = max(horizontal * 1.23, frame_h * aspect)
        dist = max((frame_w * 0.5) / tan_hfov, (frame_h * 0.5) / tan_vfov, height * 0.75)
        cam.location = target + direction.normalized() * dist
    else:
        lens_type = 'ortho'
        cam_data.type = 'ORTHO'
        cam.location = target + direction * height * 2.6
        if P['framing'] == 'portrait':
            cam_data.ortho_scale = height * 0.47 * max(1.0, aspect)
        else:
            cam_data.ortho_scale = max(horizontal, height * aspect) * (1.23 if aspect >= 1 else 1.23 / aspect)

    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_start = max(0.001, height * 0.005)
    cam_data.clip_end = max(100.0, height * 20.0)

    dof_cfg = P.get('dof')
    if isinstance(dof_cfg, dict) and dof_cfg.get('enabled'):
        cam_data.dof.use_dof = True
        cam_data.dof.aperture_fstop = float(dof_cfg.get('fstop', 2.8))
        focus_dist = dof_cfg.get('focusDistance')
        cam_data.dof.focus_distance = float(focus_dist) if focus_dist is not None else (target - cam.location).length

    scene.camera = cam

    strength = height * height
    aim = subject + Vector((0, 0, height * 0.13))
    frontal = Vector((math.sin(angle), -math.cos(angle), 0.0))
    up = Vector((0.0, 0.0, 1.0))
    key_pos = aim + height * (frontal * 1.45 - right * 0.56 + up * 0.94)
    add_area(scene, 'Studio_Key', key_pos, aim, 300 * strength * P['key'], S['keyColor'], height * 0.84)
    add_area(scene, 'Studio_Fill', aim + height * (frontal * 1.12 + right * 0.91 - up * 0.30), aim, 132 * strength * P['fill'], S['fillColor'], height * 1.04)
    add_area(scene, 'Studio_Rim', aim + height * (-frontal * 0.85 + right * 0.36 + up * 0.89), aim, 276 * strength * P['rim'], S['rimColor'], height * 0.60)

    world = bpy.data.worlds.new('Studio_World')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (*S['backdrop'], 1)
        bg.inputs[1].default_value = 0.65
    scene.world = world

    transparent = bool(P.get('transparent', False))
    if S['floor'] and not transparent:
        bpy.ops.mesh.primitive_plane_add(size=height * 100, location=(subject.x, subject.y, lo.z - height * 0.012))
        floor = bpy.context.object
        floor.name = 'Studio_Floor'
        mat = bpy.data.materials.new('Studio_Backdrop')
        mat.use_nodes = True
        node = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        require(node is not None, 'Missing Principled BSDF node on Studio_Backdrop')
        if 'Base Color' in node.inputs:
            node.inputs['Base Color'].default_value = (*S['backdrop'], 1)
        if 'Roughness' in node.inputs:
            node.inputs['Roughness'].default_value = 0.93
        em_col = node.inputs.get('Emission Color') or node.inputs.get('Emission')
        if em_col is not None:
            em_col.default_value = (*S['backdrop'], 1)
        if 'Emission Strength' in node.inputs:
            node.inputs['Emission Strength'].default_value = 0.24
        floor.data.materials.append(mat)

    mats = {slot.material for o in render_objects for slot in o.material_slots if slot.material}

    def check_images(tree, seen):
        if not tree or tree.as_pointer() in seen:
            return
        seen.add(tree.as_pointer())
        for node in tree.nodes:
            image = getattr(node, 'image', None)
            if image and image.source not in {'GENERATED', 'VIEWER'}:
                require(bool(image.packed_file or image.packed_files), 'Unpacked image on a visible render material: ' + image.name)
            if node.type == 'GROUP':
                check_images(node.node_tree, seen)

    seen = set()
    for mat in mats:
        check_images(mat.node_tree, seen)

    requested_passes = list(P.get('passes') or [])
    base_color_cache = {}
    if 'albedo' in requested_passes:
        for mat in mats:
            tree, surf = active_surface_socket(mat)
            if tree and surf:
                from_node = surf.links[0].from_node
                if from_node.type == 'BSDF_PRINCIPLED':
                    base = from_node.inputs.get('Base Color')
                    if base:
                        base_color_cache[mat.as_pointer()] = (
                            base.links[0].from_socket if base.is_linked else None,
                            tuple(base.default_value),
                        )

    is_toon = bool(P.get('toon'))
    toon_opts = P.get('toonOptions') if isinstance(P.get('toonOptions'), dict) else {}
    toon_count = 0
    preserved_mtoon = 0
    face_sdf_materials = []
    outline_meshes = 0

    face_sdf_path = C.get('faceSdfPath')
    sdf_image = None
    side_dot = 0.0
    fwd_dot = 1.0
    if is_toon and face_sdf_path and toon_opts.get('faceSdf', True) is not False:
        require(os.path.isfile(face_sdf_path), 'Face SDF image path does not exist')
        sdf_image = bpy.data.images.load(face_sdf_path, check_existing=True)
        sdf_image.colorspace_settings.name = 'Non-Color'
        key_dir = (key_pos - aim).normalized()
        cam_dir = (cam.location - target).normalized()
        side_dot, fwd_dot = resolve_head_light_dots(scene, key_dir, cam_dir)

    face_mesh_mats = {
        slot.material.as_pointer()
        for obj in render_objects
        if any(tok in obj.name.lower() for tok in ('head', 'face', 'kao', '顔'))
        for slot in obj.material_slots
        if slot.material
    }

    key_dir = (key_pos - aim).normalized()
    for mat in mats:
        if is_mtoon_material(mat):
            preserved_mtoon += 1
            continue
        if not is_toon:
            continue
        tree, surf = active_surface_socket(mat)
        if not tree or not surf:
            continue
        bsdf = surf.links[0].from_node
        if bsdf.type != 'BSDF_PRINCIPLED':
            continue
        if is_preserved_eye_or_alpha(mat, bsdf):
            continue

        metallic_sock = bsdf.inputs.get('Metallic')
        is_metallic = bool(metallic_sock and not metallic_sock.is_linked and metallic_sock.default_value > 0.35)
        if is_metallic:
            if toon_opts.get('metallicStep', True) is False:
                continue
            build_toon_metallic(tree, surf, bsdf, key_dir)
            toon_count += 1
            continue

        low_mat = mat.name.lower()
        is_face_mat = any(tok in low_mat for tok in FACE_MAT_TOKENS) or (
            mat.as_pointer() in face_mesh_mats and any(tok in low_mat for tok in SKIN_MAT_TOKENS)
        )
        if sdf_image is not None and is_face_mat:
            build_face_sdf_shader(tree, surf, bsdf, sdf_image, side_dot, fwd_dot)
            face_sdf_materials.append(mat.name)
            toon_count += 1
            continue

        is_skin = any(tok in low_mat for tok in SKIN_MAT_TOKENS)
        build_toon_three_tier(
            tree,
            surf,
            bsdf,
            is_skin=is_skin,
            specular_rim=bool(toon_opts.get('specularRim', True)),
        )
        toon_count += 1

    if is_toon and toon_opts.get('outline', True):
        outline_thickness = float(toon_opts.get('outlineThickness', 0.0018))
        outline_color = toon_opts.get('outlineColor', (0.14, 0.08, 0.12))
        outline_meshes = apply_outline_shells(render_objects, outline_thickness, outline_color)

    engine_items = list(bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items.keys())
    requested_engine = str(P.get('engine') or 'eevee').lower()
    if requested_engine == 'cycles':
        require('CYCLES' in engine_items, 'CYCLES engine is unavailable in this Blender build')
        scene.render.engine = 'CYCLES'
        if P.get('samples') is not None:
            scene.cycles.samples = int(P['samples'])
    else:
        if 'BLENDER_EEVEE_NEXT' in engine_items:
            scene.render.engine = 'BLENDER_EEVEE_NEXT'
        elif 'BLENDER_EEVEE' in engine_items:
            scene.render.engine = 'BLENDER_EEVEE'
        else:
            raise RuntimeError('No compatible EEVEE render engine found: ' + ','.join(engine_items))
        if P.get('samples') is not None and hasattr(scene, 'eevee') and hasattr(scene.eevee, 'taa_render_samples'):
            scene.eevee.taa_render_samples = int(P['samples'])

    scene.render.resolution_x = width
    scene.render.resolution_y = px_height
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.film_transparent = transparent
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.use_multiview = False
    for layer in scene.view_layers:
        layer.use = (layer == view)

    desired_vt = P.get('viewTransform') or ('Standard' if is_toon else 'AgX')
    desired_look = P.get('look') or ('Medium High Contrast' if is_toon else 'None')
    used_vt, used_look = set_color_management(scene, desired_vt, desired_look, P['exposure'])

    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.use_file_extension = True
    scene.render.filepath = os.path.join(D, 'render.png')
    require('FINISHED' in bpy.ops.render.render(write_still=True), 'Blender did not finish rendering')

    auxiliary_passes = {}
    if requested_passes:
        # Mute outline shell modifiers during auxiliary geometry/albedo passes
        for obj in render_objects:
            for mod in obj.modifiers:
                if mod.name == 'AS_Outline':
                    mod.show_render = False
        set_color_management(scene, 'Standard', 'None', 0.0)

        for pass_name in requested_passes:
            if pass_name == 'normal':
                norm_mat = bpy.data.materials.new('AS_Pass_Normal')
                norm_mat.use_nodes = True
                nt = norm_mat.node_tree
                for n in list(nt.nodes):
                    if n.type != 'OUTPUT_MATERIAL':
                        nt.nodes.remove(n)
                out_n = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
                geom = nt.nodes.new('ShaderNodeNewGeometry')
                vm_mul = nt.nodes.new('ShaderNodeVectorMath')
                vm_mul.operation = 'SCALE'
                vm_mul.inputs['Scale'].default_value = 0.5
                vm_add = nt.nodes.new('ShaderNodeVectorMath')
                vm_add.operation = 'ADD'
                vm_add.inputs[1].default_value = (0.5, 0.5, 0.5)
                em = nt.nodes.new('ShaderNodeEmission')
                nt.links.new(geom.outputs['Normal'], vm_mul.inputs[0])
                nt.links.new(vm_mul.outputs['Vector'], vm_add.inputs[0])
                nt.links.new(vm_add.outputs['Vector'], em.inputs['Color'])
                nt.links.new(em.outputs[0], out_n.inputs['Surface'])
                view.material_override = norm_mat
            elif pass_name == 'depth':
                depth_mat = bpy.data.materials.new('AS_Pass_Depth')
                depth_mat.use_nodes = True
                nt = depth_mat.node_tree
                for n in list(nt.nodes):
                    if n.type != 'OUTPUT_MATERIAL':
                        nt.nodes.remove(n)
                out_n = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
                cam_n = nt.nodes.new('ShaderNodeCameraData')
                map_r = nt.nodes.new('ShaderNodeMapRange')
                map_r.clamp = True
                map_r.inputs['From Min'].default_value = cam_data.clip_start
                map_r.inputs['From Max'].default_value = max(height * 4.0, (target - cam.location).length * 2.0)
                map_r.inputs['To Min'].default_value = 1.0
                map_r.inputs['To Max'].default_value = 0.0
                em = nt.nodes.new('ShaderNodeEmission')
                nt.links.new(cam_n.outputs['View Z Depth'], map_r.inputs['Value'])
                nt.links.new(map_r.outputs['Result'], em.inputs['Color'])
                nt.links.new(em.outputs[0], out_n.inputs['Surface'])
                view.material_override = depth_mat
            elif pass_name == 'albedo':
                view.material_override = None
                for mat in mats:
                    if mat.as_pointer() in base_color_cache:
                        sock, default_col = base_color_cache[mat.as_pointer()]
                        tree, surf = active_surface_socket(mat)
                        if tree and surf:
                            em = tree.nodes.new('ShaderNodeEmission')
                            if sock is not None:
                                tree.links.new(sock, em.inputs['Color'])
                            else:
                                em.inputs['Color'].default_value = default_col
                            tree.links.new(em.outputs[0], surf)
            else:
                continue

            out_file = f'{pass_name}.png'
            scene.render.filepath = os.path.join(D, out_file)
            if 'FINISHED' in bpy.ops.render.render(write_still=True):
                auxiliary_passes[pass_name] = out_file
            view.material_override = None

    notes = ['Local still, no change to model revision or VRM; material and light edits are in-memory only.']
    if is_toon:
        notes.append('NPR toon pipeline active; MToon, eye/cornea/alpha materials are preserved.')
    if face_sdf_materials:
        notes.append('Head-local Face SDF applied to: ' + ', '.join(face_sdf_materials))

    report = {k: C[k] for k in ('requestId', 'revisionId', 'blendHash', 'recipe')}
    report.update(
        blenderVersion=bpy.app.version_string,
        engine=scene.render.engine,
        meshes=len(render_objects),
        toonMaterials=toon_count,
        materialCount=len(mats),
        frame=scene.frame_current,
        viewTransform=used_vt,
        look=used_look,
        lensType=lens_type,
        outlineMeshes=outline_meshes,
        faceSdfMaterials=face_sdf_materials,
        preservedMtoon=preserved_mtoon,
        auxiliaryPasses=auxiliary_passes,
        notes=notes,
    )
    with open(os.path.join(D, 'report.json'), 'w', encoding='utf8') as out:
        json.dump(report, out, ensure_ascii=False, indent=2)
    print('HEADLESS ' + json.dumps({'verdict': 'pass', 'requestId': C['requestId']}, ensure_ascii=False), flush=True)


try:
    render()
except Exception as error:
    print('HEADLESS ' + json.dumps({'verdict': 'fail', 'requestId': C['requestId'], 'error': str(error), 'traceback': traceback.format_exc()}, ensure_ascii=False), flush=True)
    raise
