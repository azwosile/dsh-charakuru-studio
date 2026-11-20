# Original Blender editor / production operations. COMMAND is injected as a JSON string.
# Never executes text supplied by a model. Opens input with script autoexecution disabled.
import bpy, bmesh, contextlib, json, math, os, re, sys, traceback, uuid
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

C = json.loads(COMMAND)
P = C['params']
O = C['outputs']
notes = []
fit_report = None
penetration_report = None
pose_check_report = None
smart_mesh_report = None
mtoon_report = None
expression_lab_report = None
physics_oscillation_report = None

FACIAL_BONE_KEYWORDS = (
    'eye', 'eyelid', 'eyebrow', 'brow', 'lash', 'eyelash', 'pupil', 'iris', 'sclera',
    'mouth', 'lip', 'jaw', 'chin', 'tongue', 'teeth', 'tooth', 'nose', 'nostril',
    'cheek', 'ear', 'forehead', 'temple', 'blink', 'wink', 'smile', 'frown', 'tear',
    'face', 'facial', 'expression', 'viseme', 'lid',
    '目', 'まぶた', '眉', '口', '唇', '舌', '歯', '頬', '顎', '鼻', '耳', '顔',
)
FACIAL_ROOT_EXACT = {
    'head', 'neck', 'j_bip_c_head', 'j_bip_c_neck',
    'mixamorig:head', 'mixamorig:neck', '頭', '首',
}
FACIAL_EXCLUDE_TOKENS = (
    'hair', 'ahoge', 'ribbon', 'hat', 'earring', 'headset', 'crown',
    'skirt', 'ponytail', 'twintail', 'bangs', 'cape', 'coat', 'dress',
    'bust', 'breast', 'glasses', 'mask',
)

HUMANOID_ALIASES = {
    'hips': ('hips', 'pelvis', 'root_hips', 'jbipchips', 'mixamorighips', '下半身', '腰', 'センター'),
    'spine': ('spine', 'spine01', 'spine1', 'waist', 'jbipcspine', 'mixamorigspine', '上半身'),
    'chest': ('chest', 'spine02', 'spine2', 'spine001', 'spine002', 'jbipcchest', 'mixamorigspine1', '上半身2'),
    'upperChest': ('upperchest', 'spine03', 'spine3', 'spine003', 'jbipcupperchest', 'mixamorigspine2'),
    'neck': ('neck', 'jbipcneck', 'mixamorigneck', '首'),
    'head': ('head', 'jbipchead', 'mixamorighead', '頭'),
    'leftShoulder': ('leftshoulder', 'shoulderl', 'lshoulder', 'lclavicle', 'claviclel', 'jbiplshoulder', 'mixamorigleftshoulder', '左肩'),
    'leftUpperArm': ('leftupperarm', 'upperarml', 'lupperarm', 'leftarm', 'arml', 'jbiplupperarm', 'mixamorigleftarm', '左腕'),
    'leftLowerArm': ('leftlowerarm', 'lowerarml', 'llowerarm', 'forearml', 'lforearm', 'leftforearm', 'jbipllowerarm', 'mixamorigleftforearm', '左ひじ'),
    'leftHand': ('lefthand', 'handl', 'lhand', 'jbiplhand', 'mixamoriglefthand', '左手首'),
    'rightShoulder': ('rightshoulder', 'shoulderr', 'rshoulder', 'rclavicle', 'clavicler', 'jbiprshoulder', 'mixamorigrightshoulder', '右肩'),
    'rightUpperArm': ('rightupperarm', 'upperarmr', 'rupperarm', 'rightarm', 'armr', 'jbiprupperarm', 'mixamorigrightarm', '右腕'),
    'rightLowerArm': ('rightlowerarm', 'lowerarmr', 'rlowerarm', 'forearmr', 'rforearm', 'rightforearm', 'jbiprlowerarm', 'mixamorigrightforearm', '右ひじ'),
    'rightHand': ('righthand', 'handr', 'rhand', 'jbiprhand', 'mixamorigrighthand', '右手首'),
    'leftUpperLeg': ('leftupperleg', 'upperlegl', 'lupperleg', 'thighl', 'lthigh', 'leftupleg', 'jbiplupperleg', 'mixamorigleftupleg', '左足', '左足d'),
    'leftLowerLeg': ('leftlowerleg', 'lowerlegl', 'llowerleg', 'shinl', 'lshin', 'calfl', 'lcalf', 'leftleg', 'jbipllowerleg', 'mixamorigleftleg', '左ひざ', '左ひざd'),
    'leftFoot': ('leftfoot', 'footl', 'lfoot', 'jbiplfoot', 'mixamorigleftfoot', '左足首', '左足首d'),
    'leftToes': ('lefttoes', 'lefttoebase', 'toel', 'ltoebase', 'toesl', 'jbipltoebase', 'mixamoriglefttoebase', '左つま先'),
    'rightUpperLeg': ('rightupperleg', 'upperlegr', 'rupperleg', 'thighr', 'rthigh', 'rightupleg', 'jbiprupperleg', 'mixamorigrightupleg', '右足', '右足d'),
    'rightLowerLeg': ('rightlowerleg', 'lowerlegr', 'rlowerleg', 'shinr', 'rshin', 'calfr', 'rcalf', 'rightleg', 'jbiprlowerleg', 'mixamorigrightleg', '右ひざ', '右ひざd'),
    'rightFoot': ('rightfoot', 'footr', 'rfoot', 'jbiprfoot', 'mixamorigrightfoot', '右足首', '右足首d'),
    'rightToes': ('righttoes', 'righttoebase', 'toer', 'rtoebase', 'toesr', 'jbiprtoebase', 'mixamorigrighttoebase', '右つま先'),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def _set_enum_safely(target, prop, preferred, fallbacks=()):
    if target is None or not hasattr(target, prop):
        return False
    candidates = [str(preferred)] + [str(f) for f in fallbacks if f is not None]
    bl_rna = getattr(target, 'bl_rna', None)
    props = getattr(bl_rna, 'properties', None) if bl_rna is not None else None
    prop_rna = props.get(prop) if props is not None and hasattr(props, 'get') else None
    enum_items = getattr(prop_rna, 'enum_items', None) if prop_rna is not None else None
    if enum_items:
        by_exact = {item.identifier: item.identifier for item in enum_items}
        by_lower = {item.identifier.lower(): item.identifier for item in enum_items}
        by_norm = {item.identifier.lower().replace('_', ''): item.identifier for item in enum_items}
        for cand in candidates:
            if cand in by_exact:
                setattr(target, prop, by_exact[cand])
                return True
            low = cand.lower()
            if low in by_lower:
                setattr(target, prop, by_lower[low])
                return True
            norm = low.replace('_', '')
            if norm in by_norm:
                setattr(target, prop, by_norm[norm])
                return True
        return False
    for cand in candidates:
        try:
            setattr(target, prop, cand)
            return True
        except (TypeError, ValueError):
            continue
    return False


@contextlib.contextmanager
def _armature_edit_mode(arm):
    prev_obj = bpy.context.object
    if prev_obj is not None and prev_obj.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    prev_active = bpy.context.view_layer.objects.active
    prev_hide = arm.hide_get()
    prev_vp = arm.hide_viewport
    try:
        arm.hide_set(False)
        arm.hide_viewport = False
        bpy.ops.object.select_all(action='DESELECT')
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='EDIT')
        yield arm.data.edit_bones
    finally:
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        arm.hide_set(prev_hide)
        arm.hide_viewport = prev_vp
        bpy.context.view_layer.objects.active = prev_active


def _view3d_override():
    wm = getattr(bpy.context, 'window_manager', None)
    windows = list(getattr(wm, 'windows', ())) if wm is not None else []
    cur_win = getattr(bpy.context, 'window', None)
    if cur_win is not None and cur_win not in windows:
        windows.insert(0, cur_win)
    for win in windows:
        screen = getattr(win, 'screen', None)
        if screen is None:
            continue
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                region = next((r for r in area.regions if r.type == 'WINDOW'), None)
                if region is not None:
                    return {'window': win, 'screen': screen, 'area': area, 'region': region}
    screen = getattr(bpy.context, 'screen', None)
    if screen is not None:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                region = next((r for r in area.regions if r.type == 'WINDOW'), None)
                if region is not None:
                    return {'screen': screen, 'area': area, 'region': region}
    return None


def _clear_shape_keys(mesh_obj):
    keys = getattr(getattr(mesh_obj, 'data', None), 'shape_keys', None)
    if not keys:
        return 0
    blocks = list(keys.key_blocks)
    for kb in reversed(blocks):
        mesh_obj.shape_key_remove(kb)
    return len(blocks)


def is_facial_bone_name(name):
    low = str(name or '').lower()
    if low in FACIAL_ROOT_EXACT:
        return False
    if any(tok in low for tok in FACIAL_EXCLUDE_TOKENS):
        return False
    return any(kw in low for kw in FACIAL_BONE_KEYWORDS)


def _norm_bone_token(name):
    s = str(name or '').strip().lower()
    s = re.sub(r'^mixamorig\d*[:_]', 'mixamorig', s)
    s = re.sub(r'^def[-_]', '', s)
    return re.sub(r'[^a-z0-9\u3040-\u9fff]+', '', s)


def resolve_humanoid_bones(arm, explicit_map=None):
    resolved = {}
    sources = []
    bones = arm.data.bones
    bone_by_lower = {b.name.lower(): b.name for b in bones}
    bone_by_norm = {}
    for b in bones:
        norm = _norm_bone_token(b.name)
        if norm and norm not in bone_by_norm:
            bone_by_norm[norm] = b.name

    canonical_by_lower = {k.lower(): k for k in HUMANOID_ALIASES}

    # Priority 1: explicit_map (P.get('boneMap'))
    if isinstance(explicit_map, dict) and explicit_map:
        matched_explicit = False
        for raw_key, raw_bone in explicit_map.items():
            if not isinstance(raw_key, str) or not isinstance(raw_bone, str):
                continue
            ckey = canonical_by_lower.get(raw_key.strip().lower(), raw_key.strip())
            if raw_bone in bones:
                resolved[ckey] = raw_bone
                matched_explicit = True
            elif raw_bone.lower() in bone_by_lower:
                resolved[ckey] = bone_by_lower[raw_bone.lower()]
                matched_explicit = True
        if matched_explicit:
            sources.append('explicit')

    # Priority 2: VRM 1.0 vrm1.humanoid and VRM 0.x vrm0.humanoid
    ext = getattr(arm.data, 'vrm_addon_extension', None)
    if ext is not None:
        vrm1_matched = False
        vrm1 = getattr(ext, 'vrm1', None)
        if vrm1 and hasattr(vrm1, 'humanoid'):
            try:
                human = vrm1.humanoid.human_bones.human_bone_name_to_human_bone()
                for key, hb in human.items():
                    cname = getattr(key, 'value', str(key))
                    bname = getattr(getattr(hb, 'node', None), 'bone_name', '')
                    if bname and bname in bones and cname not in resolved:
                        resolved[cname] = bname
                        vrm1_matched = True
            except Exception:
                pass
        if vrm1_matched:
            sources.append('vrm1')

        vrm0_matched = False
        vrm0 = getattr(ext, 'vrm0', None)
        if vrm0 and hasattr(vrm0, 'humanoid'):
            try:
                for hb in getattr(vrm0.humanoid, 'human_bones', []):
                    cname = str(getattr(hb, 'human_bone', '') or '')
                    ckey = canonical_by_lower.get(cname.lower(), cname)
                    bname = getattr(getattr(hb, 'node', None), 'bone_name', '')
                    if bname and bname in bones and ckey and ckey not in resolved:
                        resolved[ckey] = bname
                        vrm0_matched = True
            except Exception:
                pass
        if vrm0_matched:
            sources.append('vrm0')

    # Priority 3: Case-insensitive normalized alias table
    alias_matched = False
    for cname, aliases in HUMANOID_ALIASES.items():
        if cname in resolved:
            continue
        for alias in aliases:
            found = bone_by_norm.get(_norm_bone_token(alias))
            if found:
                resolved[cname] = found
                alias_matched = True
                break
    if alias_matched:
        sources.append('alias')

    return resolved, ('+'.join(sources) if sources else 'none')


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
            addon_utils.enable(mod_name, default_set=True, persistent=True)
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
    return [
        o for o in bpy.context.scene.objects
        if o.type == 'MESH' and not o.hide_render
        and not o.name.startswith('COL_') and not o.name.endswith('_proxy')
        and not o.name.startswith('Studio_FoundationFit')
    ]


def select_export():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.get('avatar_studio_weight_reference')]
    selected = [
        o for o in (visible_meshes() + arms)
        if o.type != 'EMPTY' and not o.name.startswith('Studio_FoundationFit')
    ]
    for o in selected:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    if selected:
        bpy.context.view_layer.objects.active = next((o for o in selected if o.type == 'ARMATURE'), selected[0])


def ancestors(obj):
    while obj.parent is not None:
        obj = obj.parent
        yield obj


def bound_to(obj, arm):
    return any(m.type == 'ARMATURE' and m.object == arm for m in obj.modifiers) or arm in ancestors(obj)


def _world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.bound_box for c in o.bound_box]
    if not pts:
        return Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.0))
    return (
        Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
        Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))),
    )


def _ensure_single_user_mesh(obj):
    if obj.type == 'MESH' and obj.data and obj.data.users > 1:
        obj.data = obj.data.copy()


def _transform_mesh_world(obj, world_fn, old_world=None, new_world=None):
    _ensure_single_user_mesh(obj)
    old_mw = old_world if old_world is not None else obj.matrix_world.copy()
    tgt_mw = new_world if new_world is not None else obj.matrix_world.copy()
    inv_tgt = tgt_mw.inverted()
    keys = obj.data.shape_keys
    if keys and keys.key_blocks:
        for kb in keys.key_blocks:
            for i, item in enumerate(kb.data):
                item.co = inv_tgt @ world_fn(i, old_mw @ item.co)
        ref = keys.reference_key
        for i, v in enumerate(obj.data.vertices):
            v.co = ref.data[i].co
    else:
        for i, v in enumerate(obj.data.vertices):
            v.co = inv_tgt @ world_fn(i, old_mw @ v.co)
    obj.data.update()


def _build_eval_bvh(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    try:
        mesh.calc_loop_triangles()
        mw = ev.matrix_world
        verts = [mw @ v.co for v in mesh.vertices]
        tris = [tuple(t.vertices) for t in mesh.loop_triangles]
        tree = BVHTree.FromPolygons(verts, tris, all_triangles=True) if tris else None
        return tree, verts, tris
    finally:
        ev.to_mesh_clear()


def _mute_ignored_modifiers(objs, ignore_tokens):
    restored = []
    tokens = [str(t).lower() for t in (ignore_tokens or ())]
    if not tokens:
        return restored
    for obj in objs:
        for mod in obj.modifiers:
            if any(tok in mod.name.lower() or tok in mod.type.lower() for tok in tokens):
                if mod.show_viewport:
                    restored.append((mod, True))
                    mod.show_viewport = False
    return restored


def _restore_modifiers(restored):
    for mod, prev in restored:
        mod.show_viewport = prev


def cleanup_foundation_fit_empties():
    empties = [o for o in list(bpy.data.objects) if o.type == 'EMPTY' and o.name.startswith('Studio_FoundationFit')]
    if not empties:
        return 0
    removed = 0
    for empty in empties:
        parent_obj = empty.parent
        parent_inv = parent_obj.matrix_world.inverted() if parent_obj else Matrix.Identity(4)
        for child in list(empty.children):
            world = child.matrix_world.copy()
            child.parent = parent_obj
            child.parent_type = 'OBJECT'
            child.matrix_parent_inverse = parent_inv if parent_obj else Matrix.Identity(4)
            bpy.context.view_layer.update()
            child.matrix_world = world
        bpy.data.objects.remove(empty, do_unlink=True)
        removed += 1
    bpy.context.view_layer.update()
    return removed


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
            bname = mapping[name]
            require(isinstance(bname, str) and bname and bname in arm.data.bones, 'Missing bone: ' + str(bname))
            bone.node.bone_name = bname
    required = ['hips', 'spine', 'head', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
    missing = [name for name in required if not any(getattr(k, 'value', str(k)) == name and b.node.bone_name for k, b in human.items())]
    require(not missing, 'Required humanoid assignments missing: ' + ','.join(missing))
    meta = ext.vrm1.meta
    require(P.get('title') and P.get('authors'), 'Explicit avatar title and authors required; no inferred redistribution permission')
    meta.vrm_name = P['title']
    meta.version = '1.0'
    meta.authors.clear()
    for name in P['authors']:
        meta.authors.add().value = str(name)
    _set_enum_safely(meta, 'commercial_usage', P.get('commercialUsage', 'personalNonProfit'), ('personalNonProfit',))
    _set_enum_safely(meta, 'avatar_permission', 'onlyAuthor')
    meta.allow_redistribution = False
    _set_enum_safely(meta, 'modification', 'prohibited')
    notes.append('VRM metadata restricts use and redistribution by default; authors retain responsibility for input rights.')


def head_scale():
    arm = rig()
    head = arm.data.bones.get(P.get('headBone', 'head'))
    pivot = arm.data.bones.get(P.get('pivotBone', 'neck'))
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
                v.co = inverse @ (origin + (world - origin) * (1.0 + (factor - 1.0) * weight))
                changed += 1
    require(changed > 0, 'No vertices weighted to selected head/hair bones')
    with _armature_edit_mode(arm) as ebones:
        pivot_local = arm.matrix_world.inverted() @ origin
        for bone in ebones:
            if bone.name in influenced:
                bone.head = pivot_local + (bone.head - pivot_local) * factor
                bone.tail = pivot_local + (bone.tail - pivot_local) * factor
    notes.append('Weighted head and descendant hair bones scaled together; neck transition and appearance require visual review.')


def normalize_weights():
    arm = rig()
    targets = P.get('objects') or [o.name for o in visible_meshes()]
    for name in targets:
        obj = bpy.data.objects.get(name)
        require(obj is not None and obj.type == 'MESH', 'Unknown mesh: ' + name)
        deform = {g.index: g for g in obj.vertex_groups if g.name in arm.data.bones and arm.data.bones[g.name].use_deform}
        for vertex in obj.data.vertices:
            weights = [(deform[g.group], g.weight) for g in vertex.groups if g.group in deform and g.weight > 0]
            total = sum(w for _, w in weights)
            require(total > 0.000001, f'Unweighted vertex: {name}:{vertex.index}; normalization cannot invent anatomical weights')
            for group, weight in weights:
                group.add([vertex.index], weight / total, 'REPLACE')


def _build_surface_weight_sampler(source, arm):
    deps = bpy.context.evaluated_depsgraph_get()
    eval_src = source.evaluated_get(deps)
    src_mesh = eval_src.to_mesh()
    try:
        src_mesh.calc_loop_triangles()
        triangles = [tuple(t.vertices) for t in src_mesh.loop_triangles]
        vertices = [eval_src.matrix_world @ v.co for v in src_mesh.vertices]
        require(triangles, 'Weight transfer source mesh has no faces: ' + source.name)
        tree = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
        bone_groups = {
            g.index: g.name
            for g in source.vertex_groups
            if g.name in arm.data.bones and arm.data.bones[g.name].use_deform
        }
        require(bone_groups, 'Source mesh has no deform weights: ' + source.name)
        src_weights = []
        for vi in range(len(vertices)):
            eval_groups = src_mesh.vertices[vi].groups if vi < len(src_mesh.vertices) else ()
            v_groups = eval_groups if eval_groups else (source.data.vertices[vi].groups if vi < len(source.data.vertices) else ())
            src_weights.append([
                (bone_groups[m.group], m.weight)
                for m in v_groups
                if m.group in bone_groups and m.weight > 0.0
            ])
    finally:
        eval_src.to_mesh_clear()

    def sample(target, max_dist, require_nonzero=True):
        out = []
        for vertex in target.data.vertices:
            point = target.matrix_world @ vertex.co
            hit, _normal, index, distance = tree.find_nearest(point)
            require(
                hit is not None and distance <= max_dist,
                f'Weight transfer too far: {target.name}:{vertex.index} distance={distance}; increase explicit bound only after review',
            )
            ia, ib, ic = triangles[index]
            a, b, c = vertices[ia], vertices[ib], vertices[ic]
            ab, ac, ap = b - a, c - a, hit - a
            d00, d01, d11 = ab.dot(ab), ab.dot(ac), ac.dot(ac)
            d20, d21 = ap.dot(ab), ap.dot(ac)
            den = d00 * d11 - d01 * d01
            if abs(den) < 1e-15:
                coeff = (1.0, 0.0, 0.0)
            else:
                v = (d11 * d20 - d01 * d21) / den
                w = (d00 * d21 - d01 * d20) / den
                coeff = (max(0.0, 1.0 - v - w), max(0.0, v), max(0.0, w))
            wmap = {}
            for vi, cw in zip((ia, ib, ic), coeff):
                for bname, bw in src_weights[vi]:
                    wmap[bname] = wmap.get(bname, 0.0) + bw * cw
            if require_nonzero:
                require(sum(wmap.values()) > 1e-6, 'Source triangle has no deform weights')
            out.append(wmap)
        return out

    return sample


def transfer_weights():
    # Explicit same-project source only; no bundled donor or guessed anatomical labels.
    arm = rig()
    source = bpy.data.objects.get(P.get('sourceMesh', ''))
    require(source is not None and source.type == 'MESH', 'Choose an explicit weighted source mesh')
    require(P.get('objects') and source.name not in P['objects'], 'Choose distinct target meshes')
    sampler = _build_surface_weight_sampler(source, arm)
    maximum = float(P.get('maxTransferDistance', 0.25))
    for name in P['objects']:
        target = bpy.data.objects.get(name)
        require(target is not None and target.type == 'MESH', 'Unknown weight target ' + name)
        vert_weights = sampler(target, maximum, require_nonzero=True)
        all_bones = set().union(*(w.keys() for w in vert_weights))
        groups = {bname: (target.vertex_groups.get(bname) or target.vertex_groups.new(name=bname)) for bname in all_bones}
        for vg in target.vertex_groups:
            if vg.name in arm.data.bones and arm.data.bones[vg.name].use_deform:
                vg.remove(list(range(len(target.data.vertices))))
        for vidx, wmap in enumerate(vert_weights):
            top_weights = sorted([(bn, w) for bn, w in wmap.items() if w > 1e-7], key=lambda item: item[1], reverse=True)[:4]
            total = sum(w for _, w in top_weights)
            require(total > 1e-6, 'Source triangle has no deform weights')
            for bname, weight in top_weights:
                groups[bname].add([vidx], weight / total, 'REPLACE')
        if target.parent is None:
            target.parent = arm
        modifiers = [m for m in target.modifiers if m.type == 'ARMATURE']
        require(len(modifiers) <= 1, 'Multiple armature modifiers require manual review')
        modifier = modifiers[0] if modifiers else target.modifiers.new('AvatarStudioArmature', 'ARMATURE')
        modifier.object = arm
    notes.append('Explicit surface-interpolated weights from ' + source.name + '; no anatomical or collision quality claim. Source mesh unchanged.')


def make_skirt(arm, spec):
    obj = bpy.data.objects.get(spec.get('mesh', ''))
    require(obj is not None and obj.type == 'MESH', 'Choose the skirt mesh')
    top, bottom = float(spec['waistZ']), float(spec['hemZ'])
    require(top > bottom and top - bottom < 2, 'Skirt bounds must be in armature-local meters')
    segments, rings = int(spec.get('segments', 8)), int(spec.get('rings', 3))
    require(4 <= segments <= 24 and 2 <= rings <= 6, 'Skirt chain count outside limits')
    resolved_bones, _ = resolve_humanoid_bones(arm, P.get('boneMap'))
    root_name = spec.get('rootBone', 'hips')
    if root_name not in arm.data.bones and root_name.lower() in {k.lower() for k in resolved_bones}:
        root_name = next(v for k, v in resolved_bones.items() if k.lower() == root_name.lower())
    root = arm.data.bones.get(root_name)
    require(root is not None, 'Skirt parent bone missing')

    prefix = str(spec.get('prefix') or 'AS_skirt_')
    skirt_mode = str(spec.get('mode') or ('replace' if P.get('mode') == 'replace' else 'strict')).lower()
    if skirt_mode == 'replace':
        with _armature_edit_mode(arm) as ebones:
            for eb in list(ebones):
                if eb.name.startswith(prefix):
                    ebones.remove(eb)
        for vg in list(obj.vertex_groups):
            if vg.name.startswith(prefix):
                obj.vertex_groups.remove(vg)
    else:
        require(not any(b.name.startswith(prefix) for b in arm.data.bones), 'Skirt chains already exist; use mode=replace or a distinct prefix')

    include_vg_name = spec.get('includeVertexGroup')
    include_idx = None
    if include_vg_name:
        vg_inc = obj.vertex_groups.get(include_vg_name)
        require(vg_inc is not None, 'Missing includeVertexGroup: ' + include_vg_name)
        include_idx = vg_inc.index
    exclude_names = set(spec.get('excludeVertexGroups') or ())
    exclude_indices = {g.index for g in obj.vertex_groups if g.name in exclude_names}
    min_radius = float(spec['minRadius']) if spec.get('minRadius') is not None else None
    max_radius = float(spec['maxRadius']) if spec.get('maxRadius') is not None else None

    inverse = arm.matrix_world.inverted()
    center = root.head_local.copy()
    positions = []
    for v in obj.data.vertices:
        p = inverse @ obj.matrix_world @ v.co
        if not (bottom <= p.z <= top):
            continue
        if include_idx is not None and not any(g.group == include_idx and g.weight > 0.01 for g in v.groups):
            continue
        if exclude_indices and any(g.group in exclude_indices and g.weight > 0.01 for g in v.groups):
            continue
        r = math.hypot(p.x - center.x, p.y - center.y)
        if min_radius is not None and r < min_radius:
            continue
        if max_radius is not None and r > max_radius:
            continue
        positions.append((v.index, p))
    require(len(positions) > 30, 'Skirt region contains too few vertices')
    radius = max(math.hypot(v.x - center.x, v.y - center.y) for _, v in positions)
    require(radius > 0.02, 'Skirt radius is degenerate')

    with _armature_edit_mode(arm) as ebones:
        chains = []
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            previous = ebones[root.name]
            names = []
            for ring in range(rings):
                bone = ebones.new(f'{prefix}{segment:02d}_{ring}')
                r0 = radius * (0.55 + 0.45 * ring / rings)
                r1 = radius * (0.55 + 0.45 * (ring + 1) / rings)
                bone.head = (center.x + math.cos(angle) * r0, center.y + math.sin(angle) * r0, top - (top - bottom) * ring / rings)
                bone.tail = (center.x + math.cos(angle) * r1, center.y + math.sin(angle) * r1, top - (top - bottom) * (ring + 1) / rings)
                bone.parent = previous
                previous = bone
                names.append(bone.name)
            chains.append(names)

    deform_names = {b.name for b in arm.data.bones if b.use_deform}
    groups = {name: (obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)) for chain in chains for name in chain}
    for index, v in positions:
        angle = (math.atan2(v.y - center.y, v.x - center.x) + 2 * math.pi) % (2 * math.pi)
        section = angle / (2 * math.pi) * segments
        left = int(math.floor(section)) % segments
        right = (left + 1) % segments
        alpha = section - math.floor(section)
        t = max(0.0, min(1.0, (top - v.z) / (top - bottom)))
        ring_f = t * (rings - 1)
        r0 = min(rings - 1, int(math.floor(ring_f)))
        r1 = min(rings - 1, r0 + 1)
        r_beta = ring_f - r0
        strength = min(1.0, max(0.0, (top - v.z) / (top - bottom) * 3.0))

        original = [
            (obj.vertex_groups[g.group], g.weight)
            for g in obj.data.vertices[index].groups
            if obj.vertex_groups[g.group].name in deform_names and not obj.vertex_groups[g.group].name.startswith(prefix)
        ]
        total_orig = sum(w for _, w in original)
        require(total_orig > 0, f'Unweighted skirt vertex {index}')

        skirt_w = {}
        for bname, bw in (
            (chains[left][r0], (1.0 - alpha) * (1.0 - r_beta)),
            (chains[right][r0], alpha * (1.0 - r_beta)),
        ):
            if bw > 1e-7:
                skirt_w[bname] = skirt_w.get(bname, 0.0) + bw
        if r1 != r0:
            for bname, bw in (
                (chains[left][r1], (1.0 - alpha) * r_beta),
                (chains[right][r1], alpha * r_beta),
            ):
                if bw > 1e-7:
                    skirt_w[bname] = skirt_w.get(bname, 0.0) + bw

        if strength >= 0.999:
            for group, _ in original:
                group.remove([index])
            top_skirt = sorted(skirt_w.items(), key=lambda item: item[1], reverse=True)[:4]
            top_names = {bname for bname, _ in top_skirt}
            for bname, grp in groups.items():
                if bname not in top_names and any(g.group == grp.index for g in obj.data.vertices[index].groups):
                    grp.remove([index])
            s_tot = sum(w for _, w in top_skirt)
            for bname, w in top_skirt:
                groups[bname].add([index], w / s_tot, 'REPLACE')
        else:
            combined = {}
            for group, w in original:
                combined[group.name] = (w / total_orig) * (1.0 - strength)
            for bname, sw in skirt_w.items():
                combined[bname] = combined.get(bname, 0.0) + sw * strength
            ranked = sorted([(k, w) for k, w in combined.items() if w > 1e-7], key=lambda item: item[1], reverse=True)
            kept = dict(ranked[:4])
            k_tot = sum(kept.values())
            for group, _ in original:
                if group.name not in kept:
                    group.remove([index])
            for bname, grp in groups.items():
                if bname not in kept and any(g.group == grp.index for g in obj.data.vertices[index].groups):
                    grp.remove([index])
            for bname, w in kept.items():
                target_vg = groups[bname] if bname in groups else obj.vertex_groups[bname]
                target_vg.add([index], w / k_tot, 'REPLACE')

    for mod in list(obj.modifiers):
        if mod.type in {'CLOTH', 'SURFACE_DEFORM'}:
            obj.modifiers.remove(mod)
    notes.append('Skirt region converted to continuous bilinear skeletal weights; original deform groups removed cleanly under full skirt blend.')
    return chains


def spring_setup():
    enable_vrm(required=True)
    arm = rig()
    sb = arm.data.vrm_addon_extension.spring_bone1
    mode = str(P.get('mode', 'append')).lower()
    require(mode in {'append', 'replace', 'strict'}, 'Spring setup mode must be append, replace, or strict')
    if mode == 'strict':
        require(not sb.springs and not sb.colliders, 'Spring configuration already exists; use mode=append or replace')

    spring_prefix = str(P.get('springNamePrefix') or 'Avatar Studio')
    collider_group_name = str(P.get('colliderGroupName') or 'Avatar Studio body colliders')

    if mode == 'replace':
        skirt_prefix = str((P.get('skirt') or {}).get('prefix') or 'AS_skirt_')
        removed_cg_uuids = {cg.uuid for cg in sb.collider_groups if cg.vrm_name == collider_group_name}
        removed_c_uuids = set()
        for idx in range(len(sb.collider_groups) - 1, -1, -1):
            cg = sb.collider_groups[idx]
            if cg.vrm_name == collider_group_name:
                for ref in cg.colliders:
                    removed_c_uuids.add(ref.collider_uuid)
                sb.collider_groups.remove(idx)
        for idx in range(len(sb.colliders) - 1, -1, -1):
            if sb.colliders[idx].uuid in removed_c_uuids:
                sb.colliders.remove(idx)
        for idx in range(len(sb.springs) - 1, -1, -1):
            sp = sb.springs[idx]
            uses_skirt_prefix = bool(P.get('skirt')) and any(
                j.node.bone_name.startswith(skirt_prefix) for j in sp.joints
            )
            if sp.vrm_name.startswith(spring_prefix) or uses_skirt_prefix:
                sb.springs.remove(idx)
            elif removed_cg_uuids:
                for j in range(len(sp.collider_groups) - 1, -1, -1):
                    if sp.collider_groups[j].collider_group_uuid in removed_cg_uuids:
                        sp.collider_groups.remove(j)

    chains = list(P.get('chains', []))
    skirt_chains = []
    if P.get('skirt'):
        skirt_chains = make_skirt(arm, P['skirt'])
        chains = chains + skirt_chains
    require(chains, 'Explicit spring chains required')

    collider_group = None
    if mode == 'append':
        collider_group = next((cg for cg in sb.collider_groups if cg.vrm_name == collider_group_name), None)
    if collider_group is None:
        collider_group = sb.collider_groups.add()
        collider_group.uuid = uuid.uuid4().hex
        collider_group.vrm_name = collider_group_name

    for spec in P.get('colliderBones', []):
        bone = arm.data.bones.get(spec['bone'])
        require(bone is not None, 'Collider bone missing: ' + spec['bone'])
        collider = sb.colliders.add()
        collider.uuid = uuid.uuid4().hex
        collider.node.bone_name = bone.name
        _set_enum_safely(collider, 'shape_type', 'Capsule', ('CAPSULE',))
        if hasattr(collider, 'reset_bpy_object'):
            collider.reset_bpy_object(bpy.context, arm)
        collider.shape.capsule.offset = (0, 0, 0)
        cap_len = ((arm.matrix_world @ bone.tail_local) - (arm.matrix_world @ bone.head_local)).length
        collider.shape.capsule.tail = (0, cap_len, 0)
        collider.shape.capsule.radius = float(spec.get('radius', 0.04))
        ref = collider_group.colliders.add()
        ref.collider_uuid = collider.uuid

    front_mult = float(
        P.get('frontStiffnessMultiplier')
        if P.get('frontStiffnessMultiplier') is not None
        else (P.get('skirt') or {}).get('frontStiffnessMultiplier', 1.0)
    )
    drag_val = float(P.get('windDrag') if P.get('windDrag') is not None else P.get('dragForce', 0.5))
    base_stiffness = float(P.get('stiffness', 1.0))
    resolved_bones, _ = resolve_humanoid_bones(arm, P.get('boneMap'))
    hips_name = resolved_bones.get('hips')
    root_origin = (arm.matrix_world @ arm.data.bones[hips_name].head_local) if (isinstance(hips_name, str) and hips_name and hips_name in arm.data.bones) else arm.matrix_world.translation
    skirt_set = {tuple(c) for c in skirt_chains}

    for index, chain in enumerate(chains):
        require(isinstance(chain, list) and len(chain) > 1, 'Each spring chain needs at least two existing bones')
        first_bone = arm.data.bones.get(chain[0]) if isinstance(chain[0], str) and chain[0] else None
        require(first_bone is not None, 'Spring bone missing: ' + str(chain[0]))
        is_front_chain = False
        if front_mult != 1.0 and (tuple(chain) in skirt_set or chain[0].startswith((P.get('skirt') or {}).get('prefix', 'AS_skirt_'))):
            bone_world = arm.matrix_world @ first_bone.head_local
            if (bone_world.y - root_origin.y) < -0.015:
                is_front_chain = True
        chain_stiffness = base_stiffness * (front_mult if is_front_chain else 1.0)

        spring = sb.springs.add()
        spring.vrm_name = f'{spring_prefix} {index}'
        for bone_name in chain:
            require(isinstance(bone_name, str) and bone_name and bone_name in arm.data.bones, 'Spring bone missing: ' + str(bone_name))
            joint = spring.joints.add()
            joint.node.bone_name = bone_name
            joint.hit_radius = float(P.get('hitRadius', 0.015))
            joint.stiffness = chain_stiffness
            joint.drag_force = drag_val
            joint.gravity_power = float(P.get('gravityPower', 0.1))
            joint.gravity_dir = (0, 0, -1)
        if len(collider_group.colliders):
            spring.collider_groups.add().collider_group_uuid = collider_group.uuid


def material_check():
    mode = P.get('materialMode', 'preserve')
    require(mode in {'preserve', 'pbr', 'mtoon'}, 'Material mode must be preserve, pbr, or mtoon')
    if mode == 'mtoon':
        apply_mtoon()
    elif mode == 'pbr':
        replaced = {}
        for obj in visible_meshes():
            for slot in obj.material_slots:
                old = slot.material
                require(old is not None and old.use_nodes, 'Material source graph missing on ' + obj.name)
                if old.name not in replaced:
                    textures = [n.image for n in old.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
                    colors = [image for image in textures if image.colorspace_settings.name != 'Non-Color' and 'normal' not in image.name.lower()]
                    require(colors, 'Choose a base-color texture before converting ' + old.name)
                    image = max(colors, key=lambda image: image.size[0] * image.size[1])
                    mat = bpy.data.materials.new(old.name + '_AS_PBR')
                    mat.use_nodes = True
                    nodes = mat.node_tree.nodes
                    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
                    require(bsdf is not None, 'Missing Principled BSDF node in material: ' + mat.name)
                    tex = nodes.new('ShaderNodeTexImage')
                    tex.image = image
                    if 'Base Color' in bsdf.inputs:
                        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
                    if 'Roughness' in bsdf.inputs:
                        bsdf.inputs['Roughness'].default_value = 0.8
                    replaced[old.name] = mat
                slot.material = replaced[old.name]
        notes.append('PBR material branch created with existing base-color textures; original shader graphs remain in prior revisions.')
    checked = 0
    for obj in visible_meshes():
        require(obj.material_slots, 'Missing material on ' + obj.name)
        for slot in obj.material_slots:
            mat = slot.material
            require(mat is not None, 'Empty material slot on ' + obj.name)
            require(mat.use_nodes, 'Material has no node graph: ' + mat.name)
            require(any(n.type in {'BSDF_PRINCIPLED', 'EMISSION', 'GROUP'} for n in mat.node_tree.nodes), 'No exportable shader in ' + mat.name)
            checked += 1
    require(checked > 0, 'No render materials found')
    notes.append('Material operation validates existing materials and packed texture availability; it does not claim automatic texture reconstruction.')


def _apply_shape_entry(obj, key_name, val, strict=True):
    keys = obj.data.shape_keys
    if not keys or not keys.use_relative:
        if strict:
            require(False, 'Selected mesh does not have relative shape keys: ' + obj.name)
        return False
    driven = {fc.data_path for fc in keys.animation_data.drivers} if keys.animation_data else set()
    key = keys.key_blocks.get(key_name)
    if key is None or key == keys.reference_key or key.path_from_id('value') in driven:
        if strict:
            require(False, 'Not a writable shape key on ' + obj.name + ': ' + key_name)
        return False
    fval = float(val)
    if fval < key.slider_min - 1e-6 or fval > key.slider_max + 1e-6:
        if strict:
            require(False, f'Shape key value out of slider bounds [{key.slider_min}, {key.slider_max}]: {key_name}')
        return False
    key.value = max(key.slider_min, min(key.slider_max, fval))
    return True


def _cos_bump_asym(z, center, low_hw, high_hw):
    if z <= center:
        hw = max(1e-4, low_hw)
        t = (center - z) / hw
    else:
        hw = max(1e-4, high_hw)
        t = (z - center) / hw
    if t >= 1.0:
        return 0.0
    return 0.5 * (1.0 + math.cos(math.pi * t))


def _apply_region_scaling(arm, body, meshes, rs, floor):
    resolved_bones, _ = resolve_humanoid_bones(arm, P.get('boneMap'))
    b_min, b_max = _world_bbox([body])
    total_h = max(0.05, b_max.z - b_min.z)
    center_xy = Vector(((b_min.x + b_max.x) * 0.5, (b_min.y + b_max.y) * 0.5, 0.0))

    def bone_z(explicit_key, *fallback_keys):
        bname = rs.get(explicit_key) if explicit_key else None
        if not bname:
            for fk in fallback_keys:
                if fk in resolved_bones:
                    bname = resolved_bones[fk]
                    break
        if bname and bname in arm.data.bones:
            return (arm.matrix_world @ arm.data.bones[bname].head_local).z, bname
        return None, None

    hips_z, hips_bname = bone_z('hipsBone', 'hips')
    if hips_z is None:
        hips_z = floor + 0.50 * total_h
    neck_z, neck_bname = bone_z('neckBone', 'neck')
    head_z, head_bname = bone_z('headBone', 'head')
    if neck_z is None:
        neck_z = (head_z - 0.03 * total_h) if head_z is not None else (floor + 0.84 * total_h)
    chest_z, _ = bone_z('chestBone', 'chest', 'upperChest', 'spine')
    if chest_z is None:
        chest_z = hips_z + 0.60 * (neck_z - hips_z)
    spine_z, _ = bone_z(None, 'spine')
    waist_z = spine_z if (spine_z is not None and hips_z + 0.02 * total_h < spine_z < chest_z - 0.02 * total_h) else (hips_z + 0.35 * (chest_z - hips_z))

    # Enforce strict monotonic landmark ordering
    hips_z = max(floor + 0.10 * total_h, min(hips_z, floor + 0.72 * total_h))
    neck_z = max(hips_z + 0.12 * total_h, min(neck_z, floor + 0.94 * total_h))
    chest_z = max(hips_z + 0.05 * total_h, min(chest_z, neck_z - 0.03 * total_h))
    waist_z = max(hips_z + 0.02 * total_h, min(waist_z, chest_z - 0.02 * total_h))
    shoulder_z = chest_z + 0.55 * (neck_z - chest_z)

    preserve_head = bool(rs.get('preserveHead', True))
    leg_s = float(rs.get('legScale', 1.0))
    torso_s = float(rs.get('torsoScale', 1.0))
    shoulder_s = float(rs.get('shoulderWidthScale', 1.0))
    waist_s = float(rs.get('waistScale', 1.0))
    hip_s = float(rs.get('hipScale', 1.0))
    arm_s = float(rs.get('armScale', 1.0))

    # C1-continuous piecewise Z scaling by integrating smooth C0 scale derivative s_z(z)
    b_hip = min(0.04 * total_h, 0.25 * (hips_z - floor), 0.25 * (waist_z - hips_z))
    b_neck = min(0.03 * total_h, 0.25 * (neck_z - chest_z))
    head_sz = 1.0 if preserve_head else torso_s

    def _seg_integral(z0, z1, s0, s1, z):
        # Integral of s0 + (s1 - s0) * 0.5 * (1 - cos(pi * (u - z0)/(z1 - z0))) from z0 to min(z, z1)
        if z <= z0:
            return 0.0
        span = max(1e-6, z1 - z0)
        zu = min(z, z1)
        t = (zu - z0) / span
        return span * (s0 * t + (s1 - s0) * 0.5 * (t - math.sin(math.pi * t) / math.pi))

    def map_z(z):
        if z <= floor:
            return floor + (z - floor) * leg_s
        out = floor
        z_a = hips_z - b_hip
        z_b = hips_z + b_hip
        z_c = neck_z - 2.0 * b_neck
        z_d = neck_z

        if z <= z_a:
            return out + (z - floor) * leg_s
        out += (z_a - floor) * leg_s

        if z <= z_b:
            return out + _seg_integral(z_a, z_b, leg_s, torso_s, z)
        out += _seg_integral(z_a, z_b, leg_s, torso_s, z_b)

        if z <= z_c:
            return out + (z - z_b) * torso_s
        out += (z_c - z_b) * torso_s

        if z <= z_d:
            return out + _seg_integral(z_c, z_d, torso_s, head_sz, z)
        out += _seg_integral(z_c, z_d, torso_s, head_sz, z_d)

        return out + (z - z_d) * head_sz

    head_dz = map_z(neck_z) - neck_z
    head_bone_set = set()
    if head_bname and head_bname in arm.data.bones:
        hb = arm.data.bones[head_bname]
        head_bone_set = {hb.name} | {b.name for b in hb.children_recursive}

    arm_side_bones = {'L': set(), 'R': set()}
    shoulder_origins = {}
    for side, keys in (('L', ('leftUpperArm', 'leftLowerArm', 'leftHand')), ('R', ('rightUpperArm', 'rightLowerArm', 'rightHand'))):
        root_arm = resolved_bones.get(keys[0])
        if root_arm and root_arm in arm.data.bones:
            ab = arm.data.bones[root_arm]
            arm_side_bones[side] = {ab.name} | {b.name for b in ab.children_recursive}
            shoulder_origins[side] = arm.matrix_world @ ab.head_local
        for k in keys[1:]:
            bn = resolved_bones.get(k)
            if bn and bn in arm.data.bones:
                arm_side_bones[side].add(bn)
                arm_side_bones[side].update(b.name for b in arm.data.bones[bn].children_recursive)

    def torso_deform_pt(pt):
        z = pt.z
        w_hip = _cos_bump_asym(z, hips_z, 0.35 * (hips_z - floor), max(0.03, waist_z - hips_z))
        w_waist = _cos_bump_asym(z, waist_z, max(0.03, waist_z - hips_z), max(0.03, chest_z - waist_z))
        w_sh = _cos_bump_asym(z, shoulder_z, max(0.04, shoulder_z - waist_z), max(0.02, neck_z - shoulder_z))
        neck_fade = 1.0
        if preserve_head:
            if z >= neck_z:
                neck_fade = 0.0
            elif z > neck_z - 2.0 * b_neck:
                t = (neck_z - z) / max(1e-5, 2.0 * b_neck)
                neck_fade = 0.5 * (1.0 - math.cos(math.pi * t))

        sx = 1.0 + neck_fade * ((1.0 + (hip_s - 1.0) * w_hip) * (1.0 + (waist_s - 1.0) * w_waist) * (1.0 + (shoulder_s - 1.0) * w_sh) - 1.0)
        sy = 1.0 + neck_fade * ((1.0 + (hip_s - 1.0) * w_hip) * (1.0 + (waist_s - 1.0) * w_waist) - 1.0)

        dx = (pt.x - center_xy.x) * sx + center_xy.x
        dy = (pt.y - center_xy.y) * sy + center_xy.y
        dz = map_z(z)
        return Vector((dx, dy, dz))

    def deform_world_pt(pt, head_w=0.0, arm_lw=0.0, arm_rw=0.0):
        deformed = torso_deform_pt(pt)

        if arm_s != 1.0:
            for aw, orig in ((arm_lw, shoulder_origins.get('L')), (arm_rw, shoulder_origins.get('R'))):
                if aw > 0.0 and orig is not None:
                    piv_deformed = torso_deform_pt(orig)
                    deformed = piv_deformed + (deformed - piv_deformed) * (1.0 + (arm_s - 1.0) * min(1.0, aw))

        if preserve_head:
            rigid_pt = Vector((pt.x, pt.y, pt.z + head_dz))
            if pt.z >= neck_z or head_w > 0.5:
                return rigid_pt
            if head_w > 0.0:
                blend = min(1.0, head_w * 2.0)
                return deformed.lerp(rigid_pt, blend)
        return deformed

    for obj in meshes:
        head_idx = {g.index for g in obj.vertex_groups if g.name in head_bone_set}
        arm_l_idx = {g.index for g in obj.vertex_groups if g.name in arm_side_bones['L']}
        arm_r_idx = {g.index for g in obj.vertex_groups if g.name in arm_side_bones['R']}
        v_head_w = [min(1.0, sum(g.weight for g in v.groups if g.group in head_idx)) for v in obj.data.vertices]
        v_arml_w = [min(1.0, sum(g.weight for g in v.groups if g.group in arm_l_idx)) for v in obj.data.vertices]
        v_armr_w = [min(1.0, sum(g.weight for g in v.groups if g.group in arm_r_idx)) for v in obj.data.vertices]
        _transform_mesh_world(
            obj,
            lambda i, wco: deform_world_pt(wco, v_head_w[i], v_arml_w[i], v_armr_w[i]),
        )

    with _armature_edit_mode(arm) as ebones:
        arm_mw = arm.matrix_world.copy()
        arm_inv = arm_mw.inverted()
        for eb in ebones:
            is_head = preserve_head and (eb.name in head_bone_set)
            is_arm_l = 1.0 if eb.name in arm_side_bones['L'] else 0.0
            is_arm_r = 1.0 if eb.name in arm_side_bones['R'] else 0.0
            hw = 1.0 if is_head else 0.0
            eb.head = arm_inv @ deform_world_pt(arm_mw @ eb.head, hw, is_arm_l, is_arm_r)
            eb.tail = arm_inv @ deform_world_pt(arm_mw @ eb.tail, hw, is_arm_l, is_arm_r)
    bpy.context.view_layer.update()


def fit_foundation():
    # Stretch the existing rig and its associated meshes together; never change indices/UVs/groups.
    cleanup_foundation_fit_empties()
    arm = rig()
    body = bpy.context.scene.objects.get(P['bodyObject'])
    require(body is not None and body.type == 'MESH' and bound_to(body, arm), 'Choose an existing body mesh bound to the selected rig')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and bound_to(o, arm)]
    keep = P.get('keepMeshes')
    if keep:
        require(all(any(x.name == n for x in meshes) for n in keep), 'Keep-list must name meshes on the selected rig')
        for obj in meshes:
            if obj.name not in keep:
                obj.hide_render = True
                obj.hide_set(True)
                obj['studio_foundation_reference'] = True
            elif obj.get('studio_foundation_reference'):
                obj.hide_render = False
                obj.hide_set(False)
                del obj['studio_foundation_reference']

    scales = P.get('shapeValues', [])
    if scales:
        sync_names = P.get('syncMeshes')
        sync_targets = []
        if sync_names is not None:
            for sname in sync_names:
                sobj = bpy.data.objects.get(sname)
                require(sobj is not None and sobj in meshes, 'Sync mesh must be bound to the selected rig: ' + str(sname))
                if sobj != body:
                    sync_targets.append(sobj)
        else:
            sync_targets = [m for m in meshes if m != body]

        for entry in scales:
            if entry.get('mesh'):
                target_mesh = bpy.data.objects.get(entry['mesh'])
                require(target_mesh is not None and target_mesh in meshes, 'Shape key mesh must be bound to the selected rig: ' + str(entry['mesh']))
                _apply_shape_entry(target_mesh, entry['key'], entry['value'], strict=True)
            else:
                _apply_shape_entry(body, entry['key'], entry['value'], strict=True)
                for other in sync_targets:
                    _apply_shape_entry(other, entry['key'], entry['value'], strict=False)

    bpy.context.view_layer.update()
    points = [body.matrix_world @ Vector(v) for v in body.bound_box]
    floor = min(v.z for v in points)
    factors = tuple(P.get('scale', (1.0, 1.0, 1.0)))
    rs = P.get('regionScaling')

    if rs:
        _apply_region_scaling(arm, body, meshes, rs, floor)
        result = min((body.matrix_world @ Vector(v)).z for v in body.bound_box)
        require(abs(result - floor) < 0.0005, 'Foot-anchor check failed after regionScaling')
        cleanup_foundation_fit_empties()
    elif factors != (1.0, 1.0, 1.0):
        pivot = Vector((
            (min(v.x for v in points) + max(v.x for v in points)) * 0.5,
            (min(v.y for v in points) + max(v.y for v in points)) * 0.5,
            floor,
        ))
        if P.get('applyScale', True):
            m_scale = Matrix.Translation(pivot) @ Matrix.Diagonal((*factors, 1.0)) @ Matrix.Translation(-pivot)
            old_worlds = {o.as_pointer(): o.matrix_world.copy() for o in [arm] + meshes}
            # Reset object scales cleanly while preserving world locations/rotations
            arm_loc, arm_rot, _ = old_worlds[arm.as_pointer()].decompose()
            if arm.parent is not None:
                arm.matrix_parent_inverse = Matrix.Identity(4)
            arm.matrix_world = Matrix.Translation(arm_loc) @ arm_rot.to_matrix().to_4x4()
            arm.scale = (1.0, 1.0, 1.0)
            bpy.context.view_layer.update()
            for obj in meshes:
                loc, rot, _ = old_worlds[obj.as_pointer()].decompose()
                if obj.parent is not None:
                    obj.matrix_parent_inverse = Matrix.Identity(4)
                bpy.context.view_layer.update()
                obj.matrix_world = Matrix.Translation(loc) @ rot.to_matrix().to_4x4()
                obj.scale = (1.0, 1.0, 1.0)
            bpy.context.view_layer.update()

            arm_old = old_worlds[arm.as_pointer()]
            arm_new_inv = arm.matrix_world.inverted()
            with _armature_edit_mode(arm) as ebones:
                for eb in ebones:
                    eb.head = arm_new_inv @ (m_scale @ (arm_old @ eb.head))
                    eb.tail = arm_new_inv @ (m_scale @ (arm_old @ eb.tail))
            bpy.context.view_layer.update()

            for obj in meshes:
                old_mw = old_worlds[obj.as_pointer()]
                new_mw = obj.matrix_world.copy()
                new_inv = new_mw.inverted()
                _ensure_single_user_mesh(obj)
                keys = obj.data.shape_keys
                if keys and keys.key_blocks:
                    for kb in keys.key_blocks:
                        for item in kb.data:
                            item.co = new_inv @ (m_scale @ (old_mw @ item.co))
                    ref = keys.reference_key
                    for i, v in enumerate(obj.data.vertices):
                        v.co = ref.data[i].co
                else:
                    for v in obj.data.vertices:
                        v.co = new_inv @ (m_scale @ (old_mw @ v.co))
                obj.data.update()
            bpy.context.view_layer.update()
            result = min((body.matrix_world @ Vector(v)).z for v in body.bound_box)
            require(abs(result - floor) < 0.0005, 'Foot-anchor check failed; baked scale shifted floor anchor')
            cleanup_foundation_fit_empties()
        else:
            nodes = set([arm] + meshes)
            roots = [o for o in nodes if not any(p in nodes for p in ancestors(o))]
            group = bpy.data.objects.new('Studio_FoundationFit', None)
            bpy.context.scene.collection.objects.link(group)
            group.location = pivot
            bpy.context.view_layer.update()
            for obj in roots:
                world = obj.matrix_world.copy()
                obj.parent = group
                obj.parent_type = 'OBJECT'
                obj.matrix_parent_inverse = Matrix.Identity(4)
                obj.matrix_world = world
            group.scale = factors
            bpy.context.view_layer.update()
            result = min((body.matrix_world @ Vector(v)).z for v in body.bound_box)
            require(abs(result - floor) < 0.0005, 'Foot-anchor check failed; no new revision activated')
    else:
        cleanup_foundation_fit_empties()
    notes.append('Existing body/rig adjusted together; vertex order, UV and weights are retained. Recheck joints, fit and neck visually.')


def _find_lowest_boundary_loop(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        adj = {}
        for e in bm.edges:
            if len(e.link_faces) == 1:
                v0, v1 = e.verts[0].index, e.verts[1].index
                adj.setdefault(v0, []).append(v1)
                adj.setdefault(v1, []).append(v0)
        if not adj:
            return []
        mw = obj.matrix_world
        visited = set()
        loops = []
        for start in adj:
            if start in visited:
                continue
            comp = []
            stack = [start]
            visited.add(start)
            while stack:
                cur = stack.pop()
                comp.append(cur)
                for nb in adj.get(cur, ()):
                    if nb not in visited:
                        visited.add(nb)
                        stack.append(nb)
            if len(comp) >= 4:
                avg_z = sum((mw @ bm.verts[i].co).z for i in comp) / len(comp)
                loops.append((avg_z, comp))
        if not loops:
            return []
        loops.sort(key=lambda item: item[0])
        return loops[0][1]
    finally:
        bm.free()


def _target_neck_vertices(target_mesh, arm, neck_bone):
    bm = bmesh.new()
    try:
        bm.from_mesh(target_mesh.data)
        bm.verts.ensure_lookup_table()
        mw = target_mesh.matrix_world
        boundary_verts = {v.index for e in bm.edges if len(e.link_faces) == 1 for v in e.verts}
        neck_z = None
        if neck_bone and neck_bone in arm.data.bones:
            neck_z = (arm.matrix_world @ arm.data.bones[neck_bone].head_local).z
        if boundary_verts:
            pts = [(idx, mw @ bm.verts[idx].co) for idx in boundary_verts]
            if neck_z is not None:
                near = [(idx, co) for idx, co in pts if abs(co.z - neck_z) <= 0.18]
                if near:
                    return near
            pts.sort(key=lambda item: item[1].z, reverse=True)
            top_z = pts[0][1].z
            return [(idx, co) for idx, co in pts if co.z >= top_z - 0.15]
        pts = [(v.index, mw @ v.co) for v in bm.verts]
        if neck_z is not None:
            near = [(idx, co) for idx, co in pts if abs(co.z - neck_z) <= 0.12]
            if near:
                return near
        if not pts:
            return []
        max_z = max(co.z for _, co in pts)
        min_z = min(co.z for _, co in pts)
        thresh = max_z - 0.2 * max(0.05, max_z - min_z)
        return [(idx, co) for idx, co in pts if co.z >= thresh]
    finally:
        bm.free()


def append_foundation_head():
    material = C['material']
    arm = rig()
    bind = P['headBone']
    require(bind in arm.data.bones, 'Named head bone is not present in the current rig')
    replace = []
    for name in P.get('replaceHeadObjects', []):
        obj = bpy.context.scene.objects.get(name)
        require(obj and obj.type == 'MESH' and bound_to(obj, arm), 'Old head mesh not found on the active rig: ' + name)
        replace.append(obj)

    before_objs = {obj.as_pointer() for obj in bpy.data.objects}
    with bpy.data.libraries.load(material['path'], link=False) as (source, target):
        require(all(name in source.objects for name in P['objects']), 'A named head object is not in this library')
        target.objects = P['objects']
    meshes = list(target.objects)
    require(all(o and o.type == 'MESH' and o.as_pointer() not in before_objs for o in meshes), 'The selected head entries must be new Blender mesh objects')

    group = bpy.data.collections.new('Studio_Head_Source')
    bpy.context.scene.collection.children.link(group)
    for obj in meshes:
        group.objects.link(obj)
    bpy.context.view_layer.update()

    shift = Vector(P.get('translation', (0, 0, 0)))
    scale = P.get('scale', (1, 1, 1))
    rot_deg = P.get('rotation', (0, 0, 0))
    rot_mat = Euler([math.radians(float(a)) for a in rot_deg], 'XYZ').to_matrix().to_4x4()
    donor_coords = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
    if donor_coords:
        d_min = Vector((min(p.x for p in donor_coords), min(p.y for p in donor_coords), min(p.z for p in donor_coords)))
        d_max = Vector((max(p.x for p in donor_coords), max(p.y for p in donor_coords), max(p.z for p in donor_coords)))
        pivot = (d_min + d_max) * 0.5
    else:
        pivot = arm.matrix_world @ arm.data.bones[bind].head_local
    fit = Matrix.Translation(pivot + shift) @ rot_mat @ Matrix.Diagonal((*scale, 1)) @ Matrix.Translation(-pivot)

    preserve_facial = bool(P.get('preserveFacialBones', False))
    donor_arms = []
    if preserve_facial:
        seen_arms = set()
        for obj in meshes:
            for mod in obj.modifiers:
                if mod.type == 'ARMATURE' and mod.object and mod.object.as_pointer() not in seen_arms:
                    seen_arms.add(mod.object.as_pointer())
                    donor_arms.append(mod.object)
            if obj.parent and obj.parent.type == 'ARMATURE' and obj.parent.as_pointer() not in seen_arms:
                seen_arms.add(obj.parent.as_pointer())
                donor_arms.append(obj.parent)

    copied_facial_map = {}
    donor_bone_names = set()
    if preserve_facial and donor_arms:
        donor_arm = donor_arms[0]
        donor_bone_names = {b.name for b in donor_arm.data.bones}
        facial_bones = [b for b in donor_arm.data.bones if is_facial_bone_name(b.name)]
        if facial_bones:
            with _armature_edit_mode(arm) as ebones:
                arm_inv = arm.matrix_world.inverted()
                donor_mw = donor_arm.matrix_world
                existing_names = {b.name for b in ebones}
                for db in facial_bones:
                    new_name = db.name if db.name not in existing_names else f'AS_face_{db.name}'
                    while new_name in existing_names:
                        new_name += '_'
                    existing_names.add(new_name)
                    copied_facial_map[db.name] = new_name
                    eb = ebones.new(new_name)
                    eb.head = arm_inv @ (fit @ (donor_mw @ db.head_local))
                    eb.tail = arm_inv @ (fit @ (donor_mw @ db.tail_local))
                    if (eb.tail - eb.head).length < 1e-5:
                        eb.tail = eb.head + Vector((0.0, 0.0, 0.01))
                    eb.use_deform = db.use_deform
                    eb.use_connect = False
                for db in facial_bones:
                    eb = ebones[copied_facial_map[db.name]]
                    if db.parent and db.parent.name in copied_facial_map:
                        eb.parent = ebones[copied_facial_map[db.parent.name]]
                    else:
                        eb.parent = ebones[bind]

    used_facial_armature = bool(copied_facial_map)
    for obj in meshes:
        world = fit @ obj.matrix_world.copy()
        for constraint in list(obj.constraints):
            obj.constraints.remove(constraint)
        if used_facial_armature:
            for mod in list(obj.modifiers):
                if mod.type == 'ARMATURE':
                    obj.modifiers.remove(mod)
            bind_vg = obj.vertex_groups.get(bind) or obj.vertex_groups.new(name=bind)
            non_facial_indices = []
            for vg in list(obj.vertex_groups):
                if vg.name in copied_facial_map:
                    new_name = copied_facial_map[vg.name]
                    if new_name != vg.name:
                        vg.name = new_name
                elif vg.name in donor_bone_names and vg.name != bind:
                    non_facial_indices.append(vg.index)
            if non_facial_indices:
                non_set = set(non_facial_indices)
                for v in obj.data.vertices:
                    fold = sum(g.weight for g in v.groups if g.group in non_set)
                    if fold > 1e-6:
                        bind_vg.add([v.index], fold, 'ADD')
                for vg in list(obj.vertex_groups):
                    if vg.index in non_set:
                        obj.vertex_groups.remove(vg)
            obj.parent = arm
            obj.parent_type = 'OBJECT'
            obj.matrix_parent_inverse = Matrix.Identity(4)
            bpy.context.view_layer.update()
            obj.matrix_world = world
            mod = obj.modifiers.new('AvatarStudioArmature', 'ARMATURE')
            mod.object = arm
        else:
            for mod in list(obj.modifiers):
                if mod.type == 'ARMATURE':
                    obj.modifiers.remove(mod)
            obj.parent = arm
            obj.parent_type = 'BONE'
            obj.parent_bone = bind
            obj.matrix_parent_inverse = Matrix.Identity(4)
            bpy.context.view_layer.update()
            obj.matrix_world = world
        obj.hide_render = False
        obj.hide_set(False)
        obj['avatar_studio_material_id'] = material['id']

    for d_arm in donor_arms:
        if d_arm.as_pointer() not in before_objs and d_arm != arm:
            bpy.data.objects.remove(d_arm, do_unlink=True)

    if P.get('snapNeckRim'):
        neck_bone = P.get('neckBone', 'neck')
        tol = float(P.get('snapTolerance', 0.015))
        target_mesh = bpy.data.objects.get(P['neckTargetMesh']) if P.get('neckTargetMesh') else None
        if target_mesh is None:
            candidates = [
                o for o in visible_meshes()
                if o not in meshes and o not in replace and bound_to(o, arm)
            ]
            if candidates:
                target_mesh = max(candidates, key=lambda o: len(o.data.vertices))
        require(target_mesh is not None and target_mesh.type == 'MESH', 'Target body mesh required for snapNeckRim')
        neck_pts = _target_neck_vertices(target_mesh, arm, neck_bone)
        require(neck_pts, 'No target neck vertices found for snapNeckRim')
        kd = KDTree(len(neck_pts))
        for i, (_, co) in enumerate(neck_pts):
            kd.insert(co, i)
        kd.balance()
        copy_bones = [b for b in (neck_bone, bind) if b and b in arm.data.bones]
        snapped_total = 0
        for obj in meshes:
            loop_indices = _find_lowest_boundary_loop(obj)
            if not loop_indices:
                continue
            _ensure_single_user_mesh(obj)
            mw = obj.matrix_world
            inv = mw.inverted()
            dst_groups = {b: (obj.vertex_groups.get(b) or obj.vertex_groups.new(name=b)) for b in copy_bones}
            src_groups = {b: target_mesh.vertex_groups.get(b) for b in copy_bones}
            keys = obj.data.shape_keys
            for vidx in loop_indices:
                v_world = mw @ obj.data.vertices[vidx].co
                co_tgt, kd_idx, dist = kd.find(v_world)
                if co_tgt is None or dist > tol:
                    continue
                tgt_vidx = neck_pts[kd_idx][0]
                local_new = inv @ co_tgt
                delta_local = local_new - obj.data.vertices[vidx].co
                obj.data.vertices[vidx].co = local_new
                if keys and keys.key_blocks:
                    for kb in keys.key_blocks:
                        kb.data[vidx].co += delta_local
                # Copy neck/head weights from matched target neck vertex
                copied_w = {}
                for b in copy_bones:
                    svg = src_groups.get(b)
                    if svg is not None:
                        for gm in target_mesh.data.vertices[tgt_vidx].groups:
                            if gm.group == svg.index and gm.weight > 1e-6:
                                copied_w[b] = gm.weight
                tot_cw = sum(copied_w.values())
                if tot_cw > 1e-6:
                    for vg in obj.vertex_groups:
                        if vg.name in arm.data.bones and arm.data.bones[vg.name].use_deform:
                            vg.remove([vidx])
                    for b, w in copied_w.items():
                        dst_groups[b].add([vidx], w / tot_cw, 'REPLACE')
                snapped_total += 1
            obj.data.update()
        notes.append(f'snapNeckRim snapped {snapped_total} lowest boundary vertices within {tol}m.')

    for obj in replace:
        obj.hide_render = True
        obj.hide_set(True)
    if used_facial_armature:
        notes.append(f'Appended head meshes preserving {len(copied_facial_map)} facial bones under {bind}.')
    else:
        notes.append('Appended the named head meshes with UVs and shape keys; rigid head-bone follow only. Face/eye rig, seam and apparent shading need separate checks.')


def _import_mesh_file(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    before = {obj.as_pointer() for obj in bpy.context.scene.objects}
    if ext == '.fbx':
        result = bpy.ops.import_scene.fbx(filepath=filepath)
    else:
        result = bpy.ops.import_scene.gltf(filepath=filepath)
    imported = [obj for obj in bpy.context.scene.objects if obj.as_pointer() not in before]
    require('FINISHED' in result and any(obj.type == 'MESH' for obj in imported), 'Imported file contains no mesh')
    return imported, (ext == '.fbx')


def normalize_imported_meshes(imported, opts=None):
    opts = opts or {}
    bpy.context.view_layer.update()

    # Unparent meshes from glTF/FBX wrapper Empties preserving world transforms
    for obj in imported:
        if obj.parent is not None and (obj.parent.type == 'EMPTY' or obj.type == 'MESH' and obj.parent.type != 'ARMATURE'):
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.parent_type = 'OBJECT'
            obj.matrix_parent_inverse = Matrix.Identity(4)
            bpy.context.view_layer.update()
            obj.matrix_world = world

    # Remove empty wrapper objects
    remaining = []
    for obj in imported:
        if obj.type == 'EMPTY':
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            remaining.append(obj)

    meshes = [o for o in remaining if o.type == 'MESH']
    bpy.context.view_layer.update()

    # Bake scale & rotation into mesh vertices and reset object transforms cleanly
    for obj in meshes:
        if obj.parent and obj.parent.type == 'ARMATURE':
            continue
        mw = obj.matrix_world.copy()
        rot_scale = mw.to_3x3().to_4x4()
        loc = mw.translation.copy()
        obj.rotation_mode = 'XYZ'
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        obj.location = loc
        bpy.context.view_layer.update()
        _ensure_single_user_mesh(obj)
        keys = obj.data.shape_keys
        if keys and keys.key_blocks:
            for kb in keys.key_blocks:
                for item in kb.data:
                    item.co = rot_scale @ item.co
            ref = keys.reference_key
            for i, v in enumerate(obj.data.vertices):
                v.co = ref.data[i].co
        else:
            for v in obj.data.vertices:
                v.co = rot_scale @ v.co
        obj.data.update()
    bpy.context.view_layer.update()

    if not meshes:
        return remaining

    bmin, bmax = _world_bbox(meshes)
    max_dim = max(bmax.x - bmin.x, bmax.y - bmin.y, bmax.z - bmin.z)
    auto_scale = bool(opts.get('autoScaleUnits', opts.get('isFbx', False)))
    if auto_scale and max_dim > 10.0:
        scale_mat = Matrix.Scale(0.01, 4)
        for obj in meshes:
            old_mw = obj.matrix_world.copy()
            obj.location = obj.location * 0.01
            bpy.context.view_layer.update()
            _transform_mesh_world(obj, lambda _i, p: scale_mat @ p, old_world=old_mw)
        bpy.context.view_layer.update()

    rz = float(opts.get('rotateZDeg') or 0.0)
    if abs(rz) > 1e-6:
        bmin, bmax = _world_bbox(meshes)
        c_xy = Vector(((bmin.x + bmax.x) * 0.5, (bmin.y + bmax.y) * 0.5, 0.0))
        rot_z = Matrix.Translation(c_xy) @ Matrix.Rotation(math.radians(rz), 4, 'Z') @ Matrix.Translation(-c_xy)
        for obj in meshes:
            _transform_mesh_world(obj, lambda _i, p: rot_z @ p)
        bpy.context.view_layer.update()

    target_h = opts.get('targetHeight')
    if target_h is not None:
        bmin, bmax = _world_bbox(meshes)
        cur_h = max(1e-5, bmax.z - bmin.z)
        s = float(target_h) / cur_h
        piv = Vector(((bmin.x + bmax.x) * 0.5, (bmin.y + bmax.y) * 0.5, bmin.z))
        s_mat = Matrix.Translation(piv) @ Matrix.Scale(s, 4) @ Matrix.Translation(-piv)
        for obj in meshes:
            _transform_mesh_world(obj, lambda _i, p: s_mat @ p)
        bpy.context.view_layer.update()

    if opts.get('groundToFloor'):
        bmin, _ = _world_bbox(meshes)
        dz = -bmin.z
        if abs(dz) > 1e-6:
            shift_mat = Matrix.Translation((0.0, 0.0, dz))
            for obj in meshes:
                _transform_mesh_world(obj, lambda _i, p: shift_mat @ p)
            bpy.context.view_layer.update()

    if bpy.data.images:
        try:
            bpy.ops.file.pack_all()
        except RuntimeError:
            pass
    return remaining


def append_material_mesh():
    material = C['material']
    imported, is_fbx = _import_mesh_file(material['path'])
    should_norm = P.get('normalize')
    if should_norm is None:
        should_norm = is_fbx or any(k in P for k in ('rotateZDeg', 'targetHeight', 'groundToFloor', 'autoScaleUnits'))
    if should_norm:
        imported = normalize_imported_meshes(imported, {**P, 'isFbx': is_fbx})
    donor = material['role'] == 'weight_mesh'
    for obj in imported:
        obj['avatar_studio_material_id'] = material['id']
        if donor:
            obj['avatar_studio_weight_reference'] = True
            obj.hide_render = True
    notes.append('External model appended as ' + ('non-exporting weight reference objects' if donor else 'new objects') + ': ' + ', '.join(o.name for o in imported))
    if donor:
        notes.append('No weights were transferred. Choose corresponding bones and explicitly run transfer_weights.')


def normalize_material_mesh():
    material = C.get('material')
    if material:
        imported, is_fbx = _import_mesh_file(material['path'])
        targets = normalize_imported_meshes(imported, {**P, 'isFbx': is_fbx, 'autoScaleUnits': P.get('autoScaleUnits', True)})
        for obj in targets:
            obj['avatar_studio_material_id'] = material['id']
    else:
        names = P.get('objects') or []
        require(names, 'Provide a registered material or explicit mesh objects to normalize')
        targets = [bpy.data.objects.get(n) for n in names]
        require(all(o is not None for o in targets), 'Unknown target object for normalize_material_mesh')
        targets = normalize_imported_meshes(targets, {**P, 'isFbx': False})

    norm_meshes = [o for o in targets if o.type == 'MESH']
    require(norm_meshes, 'No meshes available after normalization')
    if 'normalizedGlb' in O and O['normalizedGlb']:
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.object.select_all(action='DESELECT')
        for o in norm_meshes:
            o.hide_set(False)
            o.hide_viewport = False
            o.select_set(True)
        bpy.context.view_layer.objects.active = norm_meshes[0]
        bpy.ops.export_scene.gltf(
            filepath=O['normalizedGlb'],
            export_format='GLB',
            use_selection=True,
            export_animations=False,
            export_yup=True,
        )
    notes.append('Normalized mesh transforms and units cleanly: ' + ', '.join(o.name for o in norm_meshes))


def _point_inside_bvh(bvh, point):
    ray_dir = Vector((1.0, 0.0, 0.0))
    origin = point.copy()
    hits = 0
    for _ in range(24):
        loc, _normal, _idx, _dist = bvh.ray_cast(origin, ray_dir)
        if loc is None:
            break
        hits += 1
        origin = loc + ray_dir * 1e-4
    return (hits % 2) == 1


def _penetration_for_pair(body_bvh, g_obj, depsgraph, margin):
    g_bvh, g_verts, _ = _build_eval_bvh(g_obj, depsgraph)
    overlap_pairs = len(body_bvh.overlap(g_bvh)) if (body_bvh and g_bvh) else 0
    pen_verts = []
    max_depth = 0.0
    if body_bvh and g_verts:
        for idx, pt in enumerate(g_verts):
            hit, normal, _face_idx, dist = body_bvh.find_nearest(pt)
            if hit is None:
                continue
            inside = _point_inside_bvh(body_bvh, pt)
            signed = (pt - hit).dot(normal)
            if inside or (dist < max(0.04, margin * 8.0) and signed < margin):
                needed = (dist + margin) if inside else (margin - signed)
                if needed > 0.0:
                    push_dir = normal.normalized() if normal.length > 1e-6 else (pt - hit).normalized()
                    if inside and (pt - hit).dot(push_dir) > 0.0:
                        push_dir = (hit - pt).normalized()
                    pen_verts.append((idx, push_dir, needed))
                    if needed > max_depth:
                        max_depth = needed
    return overlap_pairs, pen_verts, max_depth


def _push_penetrating_rest_vertices(body_bvh, g_obj, margin, max_push):
    _ensure_single_user_mesh(g_obj)
    deps = bpy.context.evaluated_depsgraph_get()
    _, pen_verts, _ = _penetration_for_pair(body_bvh, g_obj, deps, margin)
    if not pen_verts:
        return 0
    if len(pen_verts) > len(g_obj.data.vertices):
        return 0
    inv_mw = g_obj.matrix_world.inverted()
    mw = g_obj.matrix_world
    # Build adjacency for gentle 1-ring smoothing of push vectors
    bm = bmesh.new()
    try:
        bm.from_mesh(g_obj.data)
        bm.verts.ensure_lookup_table()
        adj = {v.index: [e.other_vert(v).index for e in v.link_edges] for v in bm.verts}
    finally:
        bm.free()

    raw_push = {}
    for vidx, pdir, needed in pen_verts:
        raw_push[vidx] = pdir * min(max_push, needed)

    smoothed = dict(raw_push)
    for vidx in list(raw_push.keys()):
        nbs = adj.get(vidx, ())
        if nbs:
            acc = raw_push[vidx].copy()
            count = 1.0
            for nb in nbs:
                if nb in raw_push:
                    acc += raw_push[nb] * 0.5
                    count += 0.5
            vec = acc / count
            if vec.length > max_push:
                vec = vec.normalized() * max_push
            smoothed[vidx] = vec

    keys = g_obj.data.shape_keys
    for vidx, pvec in smoothed.items():
        if vidx >= len(g_obj.data.vertices):
            continue
        old_w = mw @ g_obj.data.vertices[vidx].co
        new_l = inv_mw @ (old_w + pvec)
        delta_l = new_l - g_obj.data.vertices[vidx].co
        g_obj.data.vertices[vidx].co = new_l
        if keys and keys.key_blocks:
            for kb in keys.key_blocks:
                kb.data[vidx].co += delta_l
    g_obj.data.update()
    bpy.context.view_layer.update()
    return len(smoothed)


def _apply_named_pose(arm, resolved_bones, pose_name, high_kick_deg=100.0):
    def rotate_bone_world(bone_key, world_axis, deg):
        bname = resolved_bones.get(bone_key)
        if not bname or bname not in arm.pose.bones:
            return
        pb = arm.pose.bones[bname]
        rest_rot = (arm.matrix_world @ pb.bone.matrix_local).to_3x3()
        r_world = Matrix.Rotation(math.radians(deg), 3, world_axis)
        r_local = rest_rot.inverted() @ r_world @ rest_rot
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = r_local.to_quaternion() @ pb.rotation_quaternion

    if pose_name == 'rest':
        return
    elif pose_name == 'head_turn':
        rotate_bone_world('head', Vector((0, 0, 1)), 35.0)
    elif pose_name == 'arm_raise':
        rotate_bone_world('leftUpperArm', Vector((0, 1, 0)), -110.0)
        rotate_bone_world('rightUpperArm', Vector((0, 1, 0)), 110.0)
    elif pose_name == 'elbow_bend':
        rotate_bone_world('leftLowerArm', Vector((0, 0, 1)), -70.0)
        rotate_bone_world('rightLowerArm', Vector((0, 0, 1)), 70.0)
    elif pose_name == 'high_kick':
        rotate_bone_world('leftUpperLeg', Vector((1, 0, 0)), -float(high_kick_deg))
    elif pose_name == 'squat':
        rotate_bone_world('leftUpperLeg', Vector((1, 0, 0)), -75.0)
        rotate_bone_world('rightUpperLeg', Vector((1, 0, 0)), -75.0)
        rotate_bone_world('leftLowerLeg', Vector((1, 0, 0)), 95.0)
        rotate_bone_world('rightLowerLeg', Vector((1, 0, 0)), 95.0)


def _snapshot_pose(arm):
    return {
        pb.name: (pb.rotation_mode, pb.rotation_quaternion.copy(), pb.rotation_euler.copy(), pb.location.copy(), pb.scale.copy())
        for pb in arm.pose.bones
    }


def _restore_pose(arm, snapshot):
    for pb in arm.pose.bones:
        mode, quat, euler, loc, sc = snapshot[pb.name]
        pb.rotation_mode = mode
        pb.rotation_quaternion = quat
        pb.rotation_euler = euler
        pb.location = loc
        pb.scale = sc


def _delight_mesh_albedo(targets, cfg):
    try:
        import numpy as np
    except Exception:
        return []
    lift = float(cfg.get('lift', cfg.get('strength', 0.45))) if isinstance(cfg, dict) else 0.45
    clamp_min = float(cfg.get('clampMin', 0.0)) if isinstance(cfg, dict) else 0.0
    clamp_max = float(cfg.get('clampMax', 1.0)) if isinstance(cfg, dict) else 1.0
    gamma = float(cfg.get('gamma', 1.0)) if isinstance(cfg, dict) else 1.0
    edited = []
    seen_imgs = set()
    for obj in targets:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes or not mat.node_tree:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'TEX_IMAGE' or not node.image:
                    continue
                img = node.image
                if img.as_pointer() in seen_imgs:
                    continue
                if img.colorspace_settings.name == 'Non-Color' or any(k in img.name.lower() for k in ('normal', 'rough', 'metal', 'sdf', 'ao')):
                    continue
                w, h = img.size[0], img.size[1]
                if w <= 0 or h <= 0 or len(img.pixels) != w * h * 4:
                    continue
                seen_imgs.add(img.as_pointer())
                arr = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(arr)
                rgba = arr.reshape(-1, 4)
                rgb = rgba[:, :3]
                alpha = rgba[:, 3]
                mask = alpha > 0.1
                if not np.any(mask):
                    continue
                lum = 0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]
                l_target = float(np.percentile(lum[mask], 82))
                if l_target <= 0.05:
                    continue
                l_safe = np.maximum(lum, 0.08)
                gain = np.clip((l_target / l_safe) ** lift, 1.0, 2.2)
                rgb_out = np.clip(rgb * gain[:, None], clamp_min, clamp_max)
                if abs(gamma - 1.0) > 1e-4:
                    rgb_out = np.power(np.clip(rgb_out, 0.0, 1.0), 1.0 / gamma)
                rgba[:, :3] = np.where(mask[:, None], rgb_out, rgb)
                img.pixels.foreach_set(rgba.ravel())
                img.update()
                try:
                    img.pack()
                except Exception:
                    pass
                edited.append(img.name)
    return edited


def _weight_smooth_and_transfer(obj, source, arm, max_dist, iterations, rigid_islands, factor=0.5):
    sampler = _build_surface_weight_sampler(source, arm)
    nv = len(obj.data.vertices)
    vert_weights = sampler(obj, max_dist, require_nonzero=False)

    # Build mesh adjacency once
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        adj = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    finally:
        bm.free()

    blend = max(0.0, min(1.0, float(factor)))
    for _ in range(max(0, int(iterations))):
        nxt = []
        for i in range(nv):
            nbs = adj[i]
            if not nbs or blend <= 0.0:
                nxt.append(dict(vert_weights[i]))
                continue
            acc = {k: v * (1.0 - blend) for k, v in vert_weights[i].items()}
            nb_share = blend / len(nbs)
            for nb in nbs:
                for k, v in vert_weights[nb].items():
                    acc[k] = acc.get(k, 0.0) + v * nb_share
            nxt.append(acc)
        vert_weights = nxt

    if rigid_islands and nv > 0:
        parent = list(range(nv))

        def find_root(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i, nbs in enumerate(adj):
            ri = find_root(i)
            for nb in nbs:
                rj = find_root(nb)
                if ri != rj:
                    parent[rj] = ri
                    ri = find_root(i)
        islands = {}
        for i in range(nv):
            islands.setdefault(find_root(i), []).append(i)
        thresh = max(12, int(nv * 0.05))
        for comp in islands.values():
            if len(comp) <= thresh or len(islands) == 1 and P.get('partCategory') == 'accessory':
                avg = {}
                for idx in comp:
                    for bn, w in vert_weights[idx].items():
                        avg[bn] = avg.get(bn, 0.0) + w
                tot = sum(avg.values())
                if tot > 1e-6:
                    avg = {bn: w / tot for bn, w in avg.items()}
                    for idx in comp:
                        vert_weights[idx] = dict(avg)

    # Prune to top-4 deform weights and remove dropped groups
    for vg in list(obj.vertex_groups):
        if vg.name in arm.data.bones and arm.data.bones[vg.name].use_deform:
            vg.remove(list(range(nv)))
    groups = {bname: (obj.vertex_groups.get(bname) or obj.vertex_groups.new(name=bname)) for bname in set().union(*(w.keys() for w in vert_weights))}
    for i, wmap in enumerate(vert_weights):
        top = sorted([(bn, w) for bn, w in wmap.items() if w > 1e-6], key=lambda item: item[1], reverse=True)[:4]
        tot = sum(w for _, w in top)
        if tot > 1e-6:
            for bn, w in top:
                groups[bn].add([i], w / tot, 'REPLACE')
    if obj.parent is None:
        obj.parent = arm
    mods = [m for m in obj.modifiers if m.type == 'ARMATURE']
    mod = mods[0] if mods else obj.modifiers.new('AvatarStudioArmature', 'ARMATURE')
    mod.object = arm


def fit_garment():
    global fit_report
    body = bpy.data.objects.get(P.get('bodyObject', ''))
    require(body is not None and body.type == 'MESH', 'Valid bodyObject mesh is required')
    targets = [bpy.data.objects.get(n) for n in (P.get('objects') or [])]
    require(targets and all(o is not None and o.type == 'MESH' and o != body for o in targets), 'Valid garment target meshes required')
    for obj in targets:
        _ensure_single_user_mesh(obj)

    part_cat = str(P.get('partCategory') or 'clothing')
    strategy = str(P.get('fitStrategy') or 'none')
    fit_offset = float(P.get('fitOffset', 0.004))
    apply_mods = bool(P.get('applyModifiers', True))

    b_min, b_max = _world_bbox([body])
    b_size = b_max - b_min
    b_center = (b_min + b_max) * 0.5
    body_h = max(0.05, b_size.z)

    report = {
        'bodyObject': body.name,
        'partCategory': part_cat,
        'fitStrategy': strategy,
        'fitOffset': fit_offset,
        'objects': {},
        'warnings': [],
    }

    arm = next((m.object for m in body.modifiers if m.type == 'ARMATURE' and m.object), None)
    if arm is None:
        arm = next((a for a in ancestors(body) if a.type == 'ARMATURE'), None)
    resolved_bones, _ = resolve_humanoid_bones(arm, P.get('boneMap')) if arm else ({}, 'none')

    # 1. Optional landmarkFit
    lf = P.get('landmarkFit')
    lf_enabled = lf if isinstance(lf, bool) else (bool(lf.get('enabled', True)) if isinstance(lf, dict) else False)
    if lf_enabled:
        g_min, g_max = _world_bbox(targets)
        g_size = g_max - g_min
        g_center = (g_min + g_max) * 0.5
        scale_factor = 1.0
        target_center = g_center.copy()
        min_s = float(lf.get('minScale', 0.5)) if isinstance(lf, dict) else 0.5
        max_s = float(lf.get('maxScale', 2.0)) if isinstance(lf, dict) else 2.0
        pad = float(lf.get('padding', lf.get('margin', 0.0))) if isinstance(lf, dict) else 0.0
        do_scale = (lf.get('uniform', lf.get('uniformScale', lf.get('scaleUniform', lf.get('preserveAspect', True))))) if isinstance(lf, dict) else True
        if part_cat == 'hair':
            head_b = resolved_bones.get('head')
            head_z = (arm.matrix_world @ arm.data.bones[head_b].head_local).z if (arm and isinstance(head_b, str) and head_b and head_b in arm.data.bones) else (b_min.z + 0.86 * body_h)
            if do_scale and g_size.x > 1e-4:
                scale_factor = max(min_s, min(max_s, (b_size.x * 0.45 + pad) / g_size.x))
            target_center = Vector((b_center.x, b_center.y, b_max.z - (g_size.z * scale_factor * 0.5)))
        elif part_cat == 'clothing':
            if do_scale and g_size.x > 1e-4:
                scale_factor = max(min_s, min(max_s, (b_size.x * 0.85 + pad) / g_size.x))
            target_center = Vector((b_center.x, b_center.y, b_min.z + 0.58 * body_h))
        else:
            target_center = Vector((b_center.x, b_center.y, g_center.z))

        if isinstance(lf, dict):
            if lf.get('alignX', True) is False:
                target_center.x = g_center.x
            if lf.get('alignY', True) is False:
                target_center.y = g_center.y
            if lf.get('alignZ', True) is False:
                target_center.z = g_center.z

        m_fit = Matrix.Translation(target_center) @ Matrix.Scale(scale_factor, 4) @ Matrix.Translation(-g_center)
        for obj in targets:
            _transform_mesh_world(obj, lambda _i, p: m_fit @ p)
        bpy.context.view_layer.update()
        report['landmarkFit'] = {'applied': True, 'scale': round(scale_factor, 5), 'delta': [round(x, 5) for x in (target_center - g_center)]}

    deps = bpy.context.evaluated_depsgraph_get()
    body_bvh, _, _ = _build_eval_bvh(body, deps)

    # 2. Optional hollowShell (prune deeply trapped inner faces inside body)
    hs = P.get('hollowShell')
    hs_enabled = hs if isinstance(hs, bool) else (bool(hs.get('enabled', True)) if isinstance(hs, dict) else False)
    if hs_enabled and body_bvh is not None:
        max_depth = float(hs.get('minThickness', 0.004)) if isinstance(hs, dict) else 0.004
        delete_inner = bool(hs.get('deleteInnerFaces', True)) if isinstance(hs, dict) else True
        for obj in targets:
            _ensure_single_user_mesh(obj)
            bm = bmesh.new()
            removed = 0
            try:
                bm.from_mesh(obj.data)
                mw = obj.matrix_world
                inner_faces = []
                if delete_inner:
                    for f in bm.faces:
                        fc = mw @ f.calc_center_median()
                        if _point_inside_bvh(body_bvh, fc):
                            hit, _n, _idx, dist = body_bvh.find_nearest(fc)
                            if hit is not None and dist > max_depth:
                                inner_faces.append(f)
                if inner_faces and len(inner_faces) < len(bm.faces):
                    bmesh.ops.delete(bm, geom=inner_faces, context='FACES')
                    loose_v = [v for v in bm.verts if not v.link_faces]
                    if loose_v:
                        bmesh.ops.delete(bm, geom=loose_v, context='VERTS')
                    bm.to_mesh(obj.data)
                    obj.data.update()
                    removed = len(inner_faces)
            finally:
                bm.free()
            report['objects'].setdefault(obj.name, {})['hollowShellRemovedFaces'] = removed

    # 3. Optional delightAlbedo
    da = P.get('delightAlbedo')
    da_enabled = da if isinstance(da, bool) else (bool(da.get('enabled', True)) if isinstance(da, dict) else False)
    if da_enabled:
        report['delightedImages'] = _delight_mesh_albedo(targets, da)

    # Helper to apply modifier cleanly
    def apply_obj_modifier(obj, mod_name):
        _ensure_single_user_mesh(obj)
        has_shape_keys = bool(getattr(obj.data, 'shape_keys', None) and obj.data.shape_keys.key_blocks)
        require(not has_shape_keys, f'Modifier {mod_name} cannot be applied to {obj.name} while shape keys exist; remove shape keys or set applyModifiers=False')
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        prev_hide = obj.hide_get()
        prev_vp = obj.hide_viewport
        obj.hide_set(False)
        obj.hide_viewport = False
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.modifier_apply(modifier=mod_name)
        finally:
            obj.hide_set(prev_hide)
            obj.hide_viewport = prev_vp

    # 4. Fitting strategy
    for obj in targets:
        obj_rep = report['objects'].setdefault(obj.name, {})
        obj_rep['vertices'] = len(obj.data.vertices)
        if strategy == 'shrinkwrap':
            mod = obj.modifiers.new('AS_Fit_Shrinkwrap', 'SHRINKWRAP')
            mod.target = body
            mod.wrap_method = 'NEAREST_SURFACEPOINT'
            mod.wrap_mode = 'OUTSIDE_SURFACE'
            mod.offset = fit_offset
            if apply_mods:
                apply_obj_modifier(obj, mod.name)
        elif strategy == 'surface_deform':
            cage = body.copy()
            cage.data = body.data.copy()
            cage.name = f'AS_TmpSurfaceCage_{obj.name}'
            bpy.context.scene.collection.objects.link(cage)
            _clear_shape_keys(cage)
            try:
                disp = cage.modifiers.new('AS_CageOffset', 'DISPLACE')
                disp.strength = fit_offset
                apply_obj_modifier(cage, disp.name)
                cage.hide_set(False)
                cage.hide_viewport = False
                mod = obj.modifiers.new('AS_Fit_SurfaceDeform', 'SURFACE_DEFORM')
                mod.target = cage
                prev_hide = obj.hide_get()
                prev_vp = obj.hide_viewport
                obj.hide_set(False)
                obj.hide_viewport = False
                prev_active = bpy.context.view_layer.objects.active
                bpy.ops.object.select_all(action='DESELECT')
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                try:
                    bpy.ops.object.surfacedeform_bind(modifier=mod.name)
                finally:
                    obj.hide_set(prev_hide)
                    obj.hide_viewport = prev_vp
                if getattr(mod, 'is_bound', False):
                    sw = cage.modifiers.new('AS_CageShrink', 'SHRINKWRAP')
                    sw.target = body
                    sw.wrap_mode = 'OUTSIDE_SURFACE'
                    sw.offset = fit_offset
                    apply_obj_modifier(cage, sw.name)
                else:
                    report['warnings'].append(f'surface_deform bind failed on {obj.name}; falling back to shrinkwrap')
                    obj.modifiers.remove(mod)
                    mod = obj.modifiers.new('AS_Fit_Shrinkwrap', 'SHRINKWRAP')
                    mod.target = body
                    mod.wrap_mode = 'OUTSIDE_SURFACE'
                    mod.offset = fit_offset
                if apply_mods and mod.name in obj.modifiers:
                    apply_obj_modifier(obj, mod.name)
                if prev_active:
                    bpy.context.view_layer.objects.active = prev_active
            finally:
                bpy.data.objects.remove(cage, do_unlink=True)
        elif strategy == 'mesh_deform_cage':
            o_min, o_max = _world_bbox([obj])
            c_loc = (o_min + o_max) * 0.5
            c_dim = (o_max - o_min) + Vector((0.08, 0.08, 0.08))
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=c_loc)
            cage = bpy.context.active_object
            require(cage is not None and cage.type == 'MESH', 'Failed to create mesh_deform cage')
            cage.name = f'AS_TmpMeshCage_{obj.name}'
            cage.scale = c_dim
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            sub = cage.modifiers.new('Subdiv', 'SUBSURF')
            sub.levels = 2
            sub.render_levels = 2
            sub.subdivision_type = 'SIMPLE'
            apply_obj_modifier(cage, sub.name)
            try:
                mod = obj.modifiers.new('AS_Fit_MeshDeform', 'MESH_DEFORM')
                mod.object = cage
                mod.precision = 4
                prev_hide = obj.hide_get()
                prev_vp = obj.hide_viewport
                obj.hide_set(False)
                obj.hide_viewport = False
                bpy.ops.object.select_all(action='DESELECT')
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                try:
                    bpy.ops.object.meshdeform_bind(modifier=mod.name)
                finally:
                    obj.hide_set(prev_hide)
                    obj.hide_viewport = prev_vp
                if body_bvh is not None:
                    _push_penetrating_rest_vertices(body_bvh, cage, fit_offset, max_push=0.05)
                if apply_mods:
                    apply_obj_modifier(obj, mod.name)
            finally:
                bpy.data.objects.remove(cage, do_unlink=True)

        # 5. Optional correctiveSmooth
        cs = P.get('correctiveSmooth')
        cs_enabled = cs if isinstance(cs, bool) else (bool(cs.get('enabled', True)) if isinstance(cs, dict) else False)
        if cs_enabled:
            cmod = obj.modifiers.new('AS_CorrectiveSmooth', 'CORRECTIVE_SMOOTH')
            cmod.factor = float(cs.get('factor', 0.5)) if isinstance(cs, dict) else 0.5
            cmod.iterations = int(cs.get('iterations', 3)) if isinstance(cs, dict) else 3
            cmod.smooth_type = cs.get('smoothType', 'SIMPLE') if isinstance(cs, dict) else 'SIMPLE'
            if isinstance(cs, dict):
                if cs.get('restSource'):
                    cmod.rest_source = cs['restSource']
                if 'usePinBoundary' in cs:
                    cmod.use_pin_boundary = bool(cs['usePinBoundary'])
            if apply_mods:
                apply_obj_modifier(obj, cmod.name)

        # 6. Optional weightSmooth
        ws = P.get('weightSmooth')
        ws_enabled = ws if isinstance(ws, bool) else (bool(ws.get('enabled', True)) if isinstance(ws, dict) else False)
        if ws_enabled:
            require(arm is not None, 'Armature required for weightSmooth')
            ws_dict = ws if isinstance(ws, dict) else {}
            src_obj = bpy.data.objects.get(ws_dict.get('sourceMesh') or body.name)
            require(src_obj is not None and src_obj.type == 'MESH', 'Valid sourceMesh required for weightSmooth')
            _weight_smooth_and_transfer(
                obj,
                src_obj,
                arm,
                max_dist=float(ws_dict.get('maxTransferDistance', 0.25)),
                iterations=int(ws_dict.get('iterations', 4)),
                rigid_islands=bool(ws_dict.get('rigidIslands', part_cat == 'accessory')),
                factor=float(ws_dict.get('factor', 0.5)),
            )
            obj_rep['weightSmooth'] = {'sourceMesh': src_obj.name, 'iterations': int(ws_dict.get('iterations', 4))}

    # 7. Optional resolvePenetration
    rp = P.get('resolvePenetration')
    rp_enabled = rp if isinstance(rp, bool) else (bool(rp.get('enabled', True)) if isinstance(rp, dict) else False)
    if rp_enabled:
        rp_margin = float(rp.get('margin', 0.004)) if isinstance(rp, dict) else 0.004
        rp_max_push = float(rp.get('maxPush', 0.025)) if isinstance(rp, dict) else 0.025
        rp_iters = max(1, int(rp.get('iterations', 1))) if isinstance(rp, dict) else 1
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        body_bvh, _, _ = _build_eval_bvh(body, deps)
        for obj in targets:
            overlaps_before, _, _ = _penetration_for_pair(body_bvh, obj, deps, rp_margin)
            fixed_total = 0
            for _ in range(rp_iters):
                fixed_step = _push_penetrating_rest_vertices(body_bvh, obj, rp_margin, rp_max_push)
                fixed_total += fixed_step
                if fixed_step == 0:
                    break
            deps_after = bpy.context.evaluated_depsgraph_get()
            overlaps_after, pen_after, max_d_after = _penetration_for_pair(body_bvh, obj, deps_after, rp_margin)
            report['objects'][obj.name]['penetration'] = {
                'overlapsBefore': overlaps_before,
                'fixedVertices': fixed_total,
                'overlapsAfter': overlaps_after,
                'remainingPenetrating': len(pen_after),
                'maxDepthAfter': round(max_d_after, 6),
            }

    fit_report = report
    notes.append(f'fit_garment ({part_cat}, strategy={strategy}) completed for ' + ', '.join(o.name for o in targets))


def audit_penetration():
    global penetration_report
    body = bpy.data.objects.get(P.get('bodyObject', ''))
    require(body is not None and body.type == 'MESH', 'Valid bodyObject mesh is required')
    targets = [bpy.data.objects.get(n) for n in (P.get('objects') or [])]
    require(targets and all(o is not None and o.type == 'MESH' for o in targets), 'Valid garment mesh objects are required')

    poses = list(P.get('poses') or ['rest'])
    margin = float(P.get('margin', 0.002))
    fix_pen = bool(P.get('fixPenetration', False))
    max_push = float(P.get('maxPush', 0.025))
    ignore_mods = P.get('ignoreModifiers') if P.get('ignoreModifiers') is not None else ['Outline', 'SOLIDIFY']

    arm = next((m.object for m in body.modifiers if m.type == 'ARMATURE' and m.object), None)
    if arm is None:
        arm = next((a for a in ancestors(body) if a.type == 'ARMATURE'), None)
    need_rig_poses = any(p != 'rest' for p in poses)
    if need_rig_poses:
        if arm is None:
            arm = rig()
        resolved_bones, _ = resolve_humanoid_bones(arm, P.get('boneMap'))
    else:
        resolved_bones = {}

    muted = _mute_ignored_modifiers([body] + targets, ignore_mods)
    snapshot = _snapshot_pose(arm) if (arm is not None and need_rig_poses) else None

    fixed_counts = {}
    pose_results = {}
    max_overlap = 0
    try:
        if fix_pen:
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            body_bvh, _, _ = _build_eval_bvh(body, deps)
            for obj in targets:
                fixed_counts[obj.name] = _push_penetrating_rest_vertices(body_bvh, obj, margin, max_push)

        for pose_name in poses:
            if arm is not None and snapshot is not None:
                _restore_pose(arm, snapshot)
                _apply_named_pose(arm, resolved_bones, pose_name, high_kick_deg=float(P.get('highKickDeg', 100.0)))
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            body_bvh, _, _ = _build_eval_bvh(body, deps)
            per_obj = {}
            for obj in targets:
                overlaps, pen_verts, max_d = _penetration_for_pair(body_bvh, obj, deps, margin)
                max_overlap = max(max_overlap, overlaps)
                per_obj[obj.name] = {
                    'overlapPairs': overlaps,
                    'penetratingVertices': len(pen_verts),
                    'maxDepth': round(max_d, 6),
                }
            pose_results[pose_name] = per_obj
    finally:
        if arm is not None and snapshot is not None:
            _restore_pose(arm, snapshot)
            bpy.context.view_layer.update()
        _restore_modifiers(muted)

    penetration_report = {
        'bodyObject': body.name,
        'margin': margin,
        'poses': pose_results,
        'maxOverlapPairs': max_overlap,
        'fixPenetration': fix_pen,
        'fixedVertices': fixed_counts if fix_pen else None,
        'passed': max_overlap == 0,
    }
    notes.append(f'Penetration audit across poses={poses}: maxOverlapPairs={max_overlap}')


def rigid_attach():
    arm = rig()
    raw_bone = str(P.get('bone') or '')
    require(raw_bone, 'Target bone name is required')
    bone_name = raw_bone if raw_bone in arm.data.bones else None
    if bone_name is None:
        resolved, _ = resolve_humanoid_bones(arm, P.get('boneMap'))
        lower_map = {k.lower(): v for k, v in resolved.items()}
        bone_name = lower_map.get(raw_bone.lower())
    if bone_name is None:
        bone_name = next((b.name for b in arm.data.bones if b.name.lower() == raw_bone.lower()), None)
    require(bone_name is not None and bone_name in arm.data.bones, 'Target bone missing on armature: ' + raw_bone)

    attach_mode = str(P.get('attachMode') or 'bone_parent')
    require(attach_mode in {'bone_parent', 'vertex_weight'}, 'attachMode must be bone_parent or vertex_weight')

    scale = P.get('scale', (1.0, 1.0, 1.0))
    rot_deg = P.get('rotation', (0.0, 0.0, 0.0))
    trans = Vector(P.get('translation', (0.0, 0.0, 0.0)))
    has_xform = (
        tuple(float(x) for x in scale) != (1.0, 1.0, 1.0)
        or any(abs(float(a)) > 1e-9 for a in rot_deg)
        or trans.length > 1e-9
    )
    rot_mat = Euler([math.radians(float(a)) for a in rot_deg], 'XYZ').to_matrix().to_4x4()

    for name in P.get('objects', []):
        obj = bpy.data.objects.get(name)
        require(obj is not None and obj.type == 'MESH', 'Target must be a mesh object: ' + name)
        world = obj.matrix_world.copy()
        if has_xform:
            bmin, bmax = _world_bbox([obj])
            piv = (bmin + bmax) * 0.5
            xform = Matrix.Translation(piv + trans) @ rot_mat @ Matrix.Diagonal((*scale, 1.0)) @ Matrix.Translation(-piv)
            world = xform @ world

        if attach_mode == 'bone_parent':
            for mod in list(obj.modifiers):
                if mod.type == 'ARMATURE':
                    obj.modifiers.remove(mod)
            obj.parent = arm
            obj.parent_type = 'BONE'
            obj.parent_bone = bone_name
            obj.matrix_parent_inverse = Matrix.Identity(4)
            bpy.context.view_layer.update()
            obj.matrix_world = world
        else:
            for vg in list(obj.vertex_groups):
                if vg.name in arm.data.bones and arm.data.bones[vg.name].use_deform:
                    vg.remove(list(range(len(obj.data.vertices))))
            vg = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
            if len(obj.data.vertices):
                vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
            obj.parent = arm
            obj.parent_type = 'OBJECT'
            obj.matrix_parent_inverse = Matrix.Identity(4)
            bpy.context.view_layer.update()
            obj.matrix_world = world
            mods = [m for m in obj.modifiers if m.type == 'ARMATURE']
            mod = mods[0] if mods else obj.modifiers.new('AvatarStudioArmature', 'ARMATURE')
            mod.object = arm
        obj.hide_render = False
        obj.hide_set(False)
    notes.append(f'Rigidly attached {len(P.get("objects", []))} mesh(es) to {bone_name} ({attach_mode}).')


def apply_material_texture():
    material = C['material']
    slot_index = P['textureSlot']
    image = bpy.data.images.load(material['path'], check_existing=False)
    image.pack()
    for name in P['objects']:
        obj = bpy.data.objects.get(name)
        require(obj is not None and obj.type == 'MESH' and obj.data.uv_layers.active, 'Choose a mesh with active UVs: ' + name)
        require(len(obj.material_slots) > slot_index or (not obj.material_slots and slot_index == 0), 'Material slot does not exist on ' + name)
        if not obj.material_slots:
            obj.data = obj.data.copy()
            obj.data.materials.append(bpy.data.materials.new(name + '_BaseColor'))
        slot = obj.material_slots[slot_index]
        old = slot.material
        mat = old.copy() if old else bpy.data.materials.new(name + '_BaseColor')
        mat.use_nodes = True
        require(mat.node_tree is not None, 'Missing shader node graph on ' + name)
        bsdfs = [node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED']
        require(len(bsdfs) == 1, 'Expected one Principled BSDF for Base Color on ' + name)
        bsdf = bsdfs[0]
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.label = 'Avatar Studio external base color'
        tex.image = image
        tex.location = (bsdf.location.x - 300, bsdf.location.y)
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        slot.link = 'OBJECT'
        slot.material = mat
    notes.append('Packed external PNG was connected as Base Color on explicit targets only; UVs, other channels and earlier revisions were preserved.')


SMART_TEXTURE_GROUPS = ('hair', 'head', 'upper_body', 'lower_body', 'accessories')
EXPRESSION_LAB_PRESETS = (
    'happy', 'angry', 'sad', 'relaxed', 'surprised',
    'blink', 'blinkLeft', 'blinkRight',
    'aa', 'ih', 'ou', 'ee', 'oh', 'neutral',
)
EXPRESSION_PRESET_MORPHS = {
    'blinkLeft': [('eye_blink_L', 1.0)],
    'blinkRight': [('eye_blink_R', 1.0)],
    'blink': [('eye_blink_L', 1.0), ('eye_blink_R', 1.0)],
    'happy': [('eye_happy_L', 1.0), ('eye_happy_R', 1.0), ('mouth_smile', 0.85)],
    'angry': [('brow_down_angry', 1.0), ('mouth_frown', 0.8)],
    'sad': [('brow_sad', 1.0), ('mouth_frown', 0.7)],
    'relaxed': [('eye_half_L', 0.8), ('eye_half_R', 0.8), ('brow_relaxed', 1.0)],
    'surprised': [('eye_wide_L', 1.0), ('eye_wide_R', 1.0), ('brow_surprised', 1.0), ('mouth_oh', 0.6)],
    'aa': [('mouth_aa', 1.0)],
    'ih': [('mouth_ih', 1.0)],
    'ou': [('mouth_ou', 1.0)],
    'ee': [('mouth_ee', 1.0)],
    'oh': [('mouth_oh', 1.0)],
    'neutral': [],
}


def _classify_semantic_group(obj_name, mat_name, part_tag, mid_z, min_z, total_h):
    combined = f'{obj_name} {mat_name}'.lower()
    part = str(part_tag or '').upper()
    if any(tok in combined for tok in ('hairpin', 'ribbon', 'bow', 'acc', 'hat', 'crown', 'glass', 'earring', 'necklace', 'choker', 'belt', 'bag', 'tie', 'wing', 'ornament')):
        return 'accessories'
    if any(tok in combined for tok in ('hair', 'bang', 'twintail', 'ponytail', 'ahoge')):
        return 'hair'
    has_head_tok = ('head' in combined and 'headless' not in combined) or any(
        tok in combined for tok in ('face', 'eye', 'lash', 'brow', 'mouth', 'lip', 'teeth', 'tongue', 'nose', 'ear')
    )
    if part == 'HEAD' or has_head_tok:
        return 'head'
    if any(tok in combined for tok in ('skirt', 'pant', 'short', 'trouser', 'legging', 'stocking', 'sock', 'shoe', 'boot', 'heel', 'sandal', 'leg', 'thigh', 'calf', 'shin', 'foot', 'feet', 'lower', 'bottom')):
        return 'lower_body'
    if any(tok in combined for tok in ('upper', 'torso', 'shirt', 'blouse', 'jacket', 'coat', 'dress', 'top', 'sleeve', 'arm', 'hand', 'chest', 'waist', 'neck')):
        return 'upper_body'
    nz = (mid_z - min_z) / max(1e-4, total_h)
    if nz >= 0.80:
        return 'head'
    if nz < 0.56:
        return 'lower_body'
    return 'upper_body'


def _extract_mesh_islands(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        visited = set()
        islands = []
        mw = obj.matrix_world
        for start_v in bm.verts:
            if start_v.index in visited:
                continue
            stack = [start_v]
            visited.add(start_v.index)
            v_indices = []
            f_indices = set()
            while stack:
                v = stack.pop()
                v_indices.append(v.index)
                for f in v.link_faces:
                    f_indices.add(f.index)
                for e in v.link_edges:
                    ov = e.other_vert(v)
                    if ov.index not in visited:
                        visited.add(ov.index)
                        stack.append(ov)
            if not f_indices and not v_indices:
                continue
            zs = [(mw @ bm.verts[idx].co).z for idx in v_indices]
            mat_counts = {}
            for fidx in f_indices:
                mi = bm.faces[fidx].material_index
                mat_name = ''
                if 0 <= mi < len(obj.material_slots) and obj.material_slots[mi].material:
                    mat_name = obj.material_slots[mi].material.name
                mat_counts[mat_name] = mat_counts.get(mat_name, 0) + 1
            dom_mat = max(mat_counts, key=mat_counts.get) if mat_counts else ''
            islands.append({
                'verts': v_indices,
                'faces': sorted(f_indices),
                'min_z': min(zs),
                'max_z': max(zs),
                'mid_z': 0.5 * (min(zs) + max(zs)),
                'mat_name': dom_mat,
            })
        return islands
    finally:
        bm.free()


def _smart_uv_project_object(obj, angle_deg, margin):
    _ensure_single_user_mesh(obj)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    prev_active = bpy.context.view_layer.objects.active
    prev_hide = obj.hide_get()
    prev_vp = obj.hide_viewport
    try:
        obj.hide_set(False)
        obj.hide_viewport = False
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        ov = _view3d_override()
        if ov is not None and hasattr(bpy.context, 'temp_override'):
            with bpy.context.temp_override(**ov):
                try:
                    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin)
                except TypeError:
                    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg))
        else:
            try:
                bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin)
            except TypeError:
                bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg))
    except Exception:
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        bm = bmesh.new()
        try:
            bm.from_mesh(obj.data)
            uv_layer = bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap')
            bmin, bmax = _world_bbox([obj])
            span = Vector((max(1e-4, bmax.x - bmin.x), max(1e-4, bmax.y - bmin.y), max(1e-4, bmax.z - bmin.z)))
            mw = obj.matrix_world
            for f in bm.faces:
                n = f.normal
                for loop in f.loops:
                    w = mw @ loop.vert.co
                    if abs(n.y) >= abs(n.x) and abs(n.y) >= abs(n.z):
                        u, v = (w.x - bmin.x) / span.x, (w.z - bmin.z) / span.z
                    elif abs(n.x) >= abs(n.z):
                        u, v = (w.y - bmin.y) / span.y, (w.z - bmin.z) / span.z
                    else:
                        u, v = (w.x - bmin.x) / span.x, (w.y - bmin.y) / span.y
                    loop[uv_layer].uv = (max(0.0, min(1.0, u)), max(0.0, min(1.0, v)))
            bm.to_mesh(obj.data)
        finally:
            bm.free()
    finally:
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        obj.hide_set(prev_hide)
        obj.hide_viewport = prev_vp
        bpy.context.view_layer.objects.active = prev_active


def _find_base_color_image(mat):
    if not mat or not mat.use_nodes or not mat.node_tree:
        return None
    for node in mat.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            inp = node.inputs.get('Base Color')
            if inp and inp.is_linked:
                src = inp.links[0].from_node
                if src.type == 'TEX_IMAGE' and src.image:
                    return src.image
    textures = [n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    colors = [im for im in textures if im.colorspace_settings.name != 'Non-Color' and 'normal' not in im.name.lower()]
    return max(colors, key=lambda im: im.size[0] * im.size[1]) if colors else None


def _load_view_image_arrays(view_paths):
    try:
        import numpy as np
    except Exception:
        return {}
    arrays = {}
    if not isinstance(view_paths, dict):
        return arrays
    for view_key in ('front', 'right', 'left', 'back'):
        fpath = view_paths.get(view_key)
        if not fpath or not os.path.isfile(str(fpath)):
            continue
        img = bpy.data.images.load(str(fpath), check_existing=False)
        try:
            w, h = img.size[0], img.size[1]
            if w > 0 and h > 0 and len(img.pixels) == w * h * 4:
                buf = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(buf)
                arrays[view_key] = buf.reshape(h, w, 4)
        finally:
            bpy.data.images.remove(img)
    return arrays


def _sample_rgba_bilinear(arr, u, v):
    h, w, _ = arr.shape
    x = max(0.0, min(w - 1.0, float(u) * (w - 1)))
    y = max(0.0, min(h - 1.0, float(v) * (h - 1)))
    return arr[int(round(y)), int(round(x))]


def _bake_group_packed_image(group_name, entries, tex_size, view_arrays, all_min, all_max, delight):
    img_name = f'AS_SmartTex_{group_name}'
    old_img = bpy.data.images.get(img_name)
    if old_img is not None:
        bpy.data.images.remove(old_img)
    img = bpy.data.images.new(img_name, width=tex_size, height=tex_size, alpha=True)
    img.colorspace_settings.name = 'sRGB'
    fallback_rgb = {
        'hair': (0.28, 0.24, 0.34, 1.0),
        'head': (0.96, 0.85, 0.78, 1.0),
        'upper_body': (0.78, 0.80, 0.86, 1.0),
        'lower_body': (0.24, 0.28, 0.38, 1.0),
        'accessories': (0.85, 0.68, 0.34, 1.0),
        'physics': (0.36, 0.42, 0.56, 1.0),
    }.get(group_name, (0.8, 0.8, 0.8, 1.0))

    try:
        import numpy as np
        work_res = min(tex_size, 512)
        buf = np.zeros((work_res, work_res, 4), dtype=np.float32)
        buf[:, :] = fallback_rgb
        filled = np.zeros((work_res, work_res), dtype=bool)
        span_x = max(1e-4, all_max.x - all_min.x)
        span_y = max(1e-4, all_max.y - all_min.y)
        span_z = max(1e-4, all_max.z - all_min.z)

        # Cache existing source base-color images for delight/albedo fallback
        src_img_cache = {}
        if delight:
            _delight_mesh_albedo([e['obj'] for e in entries], {'lift': 0.45})
        for e in entries:
            obj = e['obj']
            for slot in obj.material_slots:
                sim = _find_base_color_image(slot.material)
                if sim and sim.as_pointer() not in src_img_cache:
                    sw, sh = sim.size[0], sim.size[1]
                    if sw > 0 and sh > 0 and len(sim.pixels) == sw * sh * 4:
                        sbuf = np.empty(sw * sh * 4, dtype=np.float32)
                        sim.pixels.foreach_get(sbuf)
                        src_img_cache[sim.as_pointer()] = sbuf.reshape(sh, sw, 4)

        for e in entries:
            obj = e['obj']
            face_set = set(e['faces'])
            bm = bmesh.new()
            try:
                bm.from_mesh(obj.data)
                bm.faces.ensure_lookup_table()
                uv_layer = bm.loops.layers.uv.active
                if uv_layer is None:
                    continue
                mw = obj.matrix_world
                n_mat = mw.to_3x3().inverted_safe().transposed()
                for f in bm.faces:
                    if f.index not in face_set or len(f.loops) < 3:
                        continue
                    wn = (n_mat @ f.normal).normalized()
                    wc = mw @ f.calc_center_median()
                    sample = None
                    if view_arrays:
                        if abs(wn.y) >= abs(wn.x):
                            vkey = 'front' if wn.y <= 0 else 'back'
                            if vkey not in view_arrays:
                                vkey = 'front' if 'front' in view_arrays else next(iter(view_arrays))
                            u_p = (wc.x - all_min.x) / span_x
                            if vkey == 'back':
                                u_p = 1.0 - u_p
                        else:
                            vkey = 'right' if wn.x >= 0 else 'left'
                            if vkey not in view_arrays:
                                vkey = 'front' if 'front' in view_arrays else next(iter(view_arrays))
                            u_p = (wc.y - all_min.y) / span_y if vkey in ('right', 'left') else (wc.x - all_min.x) / span_x
                        v_p = (wc.z - all_min.z) / span_z
                        sample = _sample_rgba_bilinear(view_arrays[vkey], u_p, v_p)
                    else:
                        mi = f.material_index
                        mat = obj.material_slots[mi].material if 0 <= mi < len(obj.material_slots) else None
                        sim = _find_base_color_image(mat)
                        if sim and sim.as_pointer() in src_img_cache:
                            uv_avg = sum((lp[uv_layer].uv for lp in f.loops), Vector((0.0, 0.0))) / len(f.loops)
                            sample = _sample_rgba_bilinear(src_img_cache[sim.as_pointer()], uv_avg.x % 1.0, uv_avg.y % 1.0)
                    if sample is None:
                        continue
                    us = [lp[uv_layer].uv.x for lp in f.loops]
                    vs = [lp[uv_layer].uv.y for lp in f.loops]
                    x0 = max(0, min(work_res - 1, int(math.floor(min(us) * (work_res - 1))) - 1))
                    x1 = max(0, min(work_res - 1, int(math.ceil(max(us) * (work_res - 1))) + 1))
                    y0 = max(0, min(work_res - 1, int(math.floor(min(vs) * (work_res - 1))) - 1))
                    y1 = max(0, min(work_res - 1, int(math.ceil(max(vs) * (work_res - 1))) + 1))
                    buf[y0:y1 + 1, x0:x1 + 1] = sample
                    filled[y0:y1 + 1, x0:x1 + 1] = True
            finally:
                bm.free()

        if work_res != tex_size:
            scale = tex_size // work_res
            out_buf = np.repeat(np.repeat(buf, scale, axis=0), scale, axis=1)
        else:
            out_buf = buf
        img.pixels.foreach_set(out_buf.astype(np.float32).ravel())
    except Exception:
        img.generated_color = fallback_rgb
    img.update()
    try:
        img.pack()
    except Exception:
        pass
    return img


def smart_mesh_retexture():
    global smart_mesh_report
    targets = [bpy.data.objects.get(n) for n in P['objects']] if P.get('objects') else visible_meshes()
    require(targets and all(o is not None and o.type == 'MESH' for o in targets), 'Valid target meshes required for smart_mesh_retexture')

    requested_groups = list(P.get('groups') or SMART_TEXTURE_GROUPS)
    require(requested_groups and all(g in SMART_TEXTURE_GROUPS for g in requested_groups), 'Invalid texture group name')
    tex_size = int(P.get('textureSize', 4096))
    require(tex_size in {1024, 2048, 4096}, 'textureSize must be 1024, 2048, or 4096')
    smart_uv_angle = float(P.get('smartUvAngleDeg', 66.0))
    require(15.0 <= smart_uv_angle <= 89.0, 'smartUvAngleDeg must be between 15 and 89')
    uv_margin = float(P.get('uvMargin', 0.02))
    require(0.001 <= uv_margin <= 0.1, 'uvMargin must be between 0.001 and 0.1')
    delight = bool(P.get('delight', True))
    separate_physics = bool(P.get('separatePhysicsGroup', False))
    view_arrays = _load_view_image_arrays(C.get('viewImagePaths') or P.get('viewImagePaths'))

    all_min, all_max = _world_bbox(targets)
    total_h = max(1e-4, all_max.z - all_min.z)

    spring_bone_names = set()
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.get('avatar_studio_weight_reference')]
    for arm in arms:
        ext = getattr(arm.data, 'vrm_addon_extension', None)
        sb = getattr(ext, 'spring_bone1', None) if ext else None
        if sb:
            for sp in sb.springs:
                for j in sp.joints:
                    if j.node.bone_name:
                        spring_bone_names.add(j.node.bone_name)

    grouped_entries = {g: [] for g in SMART_TEXTURE_GROUPS}
    island_counts = {g: 0 for g in SMART_TEXTURE_GROUPS}
    physics_entries = []
    physics_islands = 0

    for obj in targets:
        _smart_uv_project_object(obj, smart_uv_angle, uv_margin)
        islands = _extract_mesh_islands(obj)
        if not islands:
            continue
        obj_has_spring_vg = any(
            vg.name in spring_bone_names or any(t in vg.name.lower() for t in ('skirt', 'ribbon', 'cape', 'as_skirt'))
            for vg in obj.vertex_groups
        )
        obj_group_counts = {}
        for isl in islands:
            grp = _classify_semantic_group(
                obj.name, isl['mat_name'], obj.get('charakuru_part', ''),
                isl['mid_z'], all_min.z, total_h,
            )
            if grp not in requested_groups:
                continue
            is_phys = separate_physics and (
                obj_has_spring_vg
                or any(t in (obj.name + ' ' + isl['mat_name']).lower() for t in ('skirt', 'ribbon', 'cape', 'hair', 'physics'))
            )
            entry = {'obj': obj, 'faces': isl['faces'], 'verts': isl['verts']}
            if is_phys:
                physics_entries.append(entry)
                physics_islands += 1
            else:
                grouped_entries[grp].append(entry)
                island_counts[grp] += 1
            obj_group_counts[grp] = obj_group_counts.get(grp, 0) + len(isl['faces'])
        if obj_group_counts:
            obj['charakuru_tex_group'] = max(obj_group_counts, key=obj_group_counts.get)

    packed_images = []
    groups_summary = {}
    group_mats = {}

    def _assign_group_material(grp_name, grp_entries, img):
        mat_name = f'AS_SmartMat_{grp_name}'
        mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        out_n = nodes.new('ShaderNodeOutputMaterial')
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = 0.85
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        links.new(bsdf.outputs['BSDF'], out_n.inputs['Surface'])
        group_mats[grp_name] = mat
        for e in grp_entries:
            obj = e['obj']
            slot_idx = next((i for i, s in enumerate(obj.material_slots) if s.material == mat), None)
            if slot_idx is None:
                obj.data.materials.append(mat)
                slot_idx = len(obj.material_slots) - 1
            for fidx in e['faces']:
                if fidx < len(obj.data.polygons):
                    obj.data.polygons[fidx].material_index = slot_idx

    for grp in requested_groups:
        grp_entries = grouped_entries[grp]
        img = _bake_group_packed_image(grp, grp_entries, tex_size, view_arrays, all_min, all_max, delight)
        packed_images.append(img.name)
        groups_summary[grp] = sorted({e['obj'].name for e in grp_entries})
        if grp_entries:
            _assign_group_material(grp, grp_entries, img)

    physics_report = None
    if separate_physics:
        phys_meshes = sorted({e['obj'].name for e in physics_entries})
        phys_img = _bake_group_packed_image('physics', physics_entries, tex_size, view_arrays, all_min, all_max, delight)
        packed_images.append(phys_img.name)
        if physics_entries:
            _assign_group_material('physics', physics_entries, phys_img)
        physics_report = {
            'enabled': True,
            'meshes': phys_meshes,
            'islands': physics_islands,
            'image': phys_img.name,
        }

    smart_mesh_report = {
        'groups': groups_summary,
        'islandCounts': island_counts,
        'textureSize': tex_size,
        'packedImages': packed_images,
        'physicsGroup': physics_report,
    }
    notes.append(
        f'Smart mesh retexture completed ({tex_size}px, groups={list(groups_summary.keys())}, '
        f'totalIslands={sum(island_counts.values())}, packedImages={len(packed_images)}).'
    )


def apply_mtoon():
    global mtoon_report
    addon_loaded = enable_vrm(required=False)
    targets = [bpy.data.objects.get(n) for n in P['objects']] if P.get('objects') else visible_meshes()
    require(targets and all(o is not None and o.type == 'MESH' for o in targets), 'Valid target meshes required for apply_mtoon')

    shade_color = [float(x) for x in (P.get('shadeColor') or [0.85, 0.80, 0.85])]
    shading_shift = float(P.get('shadingShift', 0.0))
    shading_toony = float(P.get('shadingToony', 0.9))
    matcap_factor = [float(x) for x in (P.get('matcapFactor') or [1.0, 1.0, 1.0])]
    rim_color = [float(x) for x in (P.get('rimColor') or [1.0, 1.0, 1.0])]
    rim_fresnel = float(P.get('rimFresnelPower', 5.0))
    rim_lift = float(P.get('rimLift', 0.0))
    outline_mode = str(P.get('outlineWidthMode', 'worldCoordinates'))
    require(outline_mode in {'none', 'worldCoordinates', 'screenCoordinates'}, 'Invalid outlineWidthMode')
    outline_width = float(P.get('outlineWidthFactor', 0.002))
    outline_color = [float(x) for x in (P.get('outlineColor') or [0.05, 0.05, 0.08])]

    matcap_path = C.get('matcapPath') or P.get('matcapPath')
    matcap_img = None
    if matcap_path:
        require(os.path.isfile(str(matcap_path)), 'Matcap image path missing: ' + str(matcap_path))
        matcap_img = bpy.data.images.load(str(matcap_path), check_existing=False)
        matcap_img.pack()

    configured = []
    seen_mats = set()
    used_addon_mtoon = False

    for obj in targets:
        if not obj.material_slots:
            obj.data = obj.data.copy()
            obj.data.materials.append(bpy.data.materials.new(obj.name + '_MToon'))
        for slot in obj.material_slots:
            if slot.material is None:
                slot.material = bpy.data.materials.new(obj.name + '_MToon')
            mat = slot.material
            if mat.as_pointer() in seen_mats:
                continue
            seen_mats.add(mat.as_pointer())
            mat.use_nodes = True
            base_img = _find_base_color_image(mat)
            base_rgba = (1.0, 1.0, 1.0, 1.0)
            if mat.node_tree:
                bsdf_old = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if bsdf_old and bsdf_old.inputs.get('Base Color'):
                    dv = bsdf_old.inputs['Base Color'].default_value
                    base_rgba = (float(dv[0]), float(dv[1]), float(dv[2]), float(dv[3]))

            ext = getattr(mat, 'vrm_addon_extension', None)
            mtoon1 = getattr(ext, 'mtoon1', None) if (addon_loaded and ext is not None) else None
            if mtoon1 is not None:
                used_addon_mtoon = True
                mtoon1.enabled = True
                if hasattr(mtoon1, 'pbr_metallic_roughness'):
                    pbr = mtoon1.pbr_metallic_roughness
                    if hasattr(pbr, 'base_color_factor'):
                        pbr.base_color_factor = base_rgba
                    if base_img is not None and hasattr(pbr, 'base_color_texture') and hasattr(pbr.base_color_texture, 'index'):
                        pbr.base_color_texture.index.source = base_img
                mtoon_ext = getattr(getattr(mtoon1, 'extensions', None), 'vrmc_materials_mtoon', None)
                if mtoon_ext is not None:
                    if hasattr(mtoon_ext, 'shade_color_factor'):
                        mtoon_ext.shade_color_factor = tuple(shade_color[:3])
                    if hasattr(mtoon_ext, 'shading_shift_factor'):
                        mtoon_ext.shading_shift_factor = shading_shift
                    if hasattr(mtoon_ext, 'shading_toony_factor'):
                        mtoon_ext.shading_toony_factor = shading_toony
                    if matcap_img is not None and hasattr(mtoon_ext, 'matcap_texture') and hasattr(mtoon_ext.matcap_texture, 'index'):
                        mtoon_ext.matcap_texture.index.source = matcap_img
                    if hasattr(mtoon_ext, 'matcap_factor'):
                        mtoon_ext.matcap_factor = tuple(matcap_factor[:3])
                    if hasattr(mtoon_ext, 'parametric_rim_color_factor'):
                        mtoon_ext.parametric_rim_color_factor = tuple(rim_color[:3])
                    if hasattr(mtoon_ext, 'parametric_rim_fresnel_power_factor'):
                        mtoon_ext.parametric_rim_fresnel_power_factor = rim_fresnel
                    if hasattr(mtoon_ext, 'parametric_rim_lift_factor'):
                        mtoon_ext.parametric_rim_lift_factor = rim_lift
                    if hasattr(mtoon_ext, 'outline_width_mode'):
                        _set_enum_safely(mtoon_ext, 'outline_width_mode', outline_mode)
                    if hasattr(mtoon_ext, 'outline_width_factor'):
                        mtoon_ext.outline_width_factor = outline_width
                    if hasattr(mtoon_ext, 'outline_color_factor'):
                        mtoon_ext.outline_color_factor = tuple(outline_color[:3])
            else:
                # Clean ShaderNode fallback preserving base texture & alpha
                nodes = mat.node_tree.nodes
                links = mat.node_tree.links
                nodes.clear()
                out_n = nodes.new('ShaderNodeOutputMaterial')
                bsdf = nodes.new('ShaderNodeBsdfPrincipled')
                bsdf.inputs['Base Color'].default_value = base_rgba
                bsdf.inputs['Roughness'].default_value = max(0.35, min(1.0, 1.0 - 0.35 * shading_toony))
                if 'Specular IOR Level' in bsdf.inputs:
                    bsdf.inputs['Specular IOR Level'].default_value = 0.0
                elif 'Specular' in bsdf.inputs:
                    bsdf.inputs['Specular'].default_value = 0.0
                if base_img is not None:
                    tex = nodes.new('ShaderNodeTexImage')
                    tex.label = 'MToon BaseColor'
                    tex.image = base_img
                    tex.location = (-360, 120)
                    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
                    links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
                if matcap_img is not None:
                    mc_tex = nodes.new('ShaderNodeTexImage')
                    mc_tex.label = 'MToon Matcap'
                    mc_tex.image = matcap_img
                    mc_tex.location = (-360, -160)
                lw = nodes.new('ShaderNodeLayerWeight')
                lw.inputs['Blend'].default_value = 0.5
                lw.location = (-560, -340)
                pw = nodes.new('ShaderNodeMath')
                pw.operation = 'POWER'
                pw.inputs[1].default_value = max(0.1, rim_fresnel)
                pw.location = (-340, -340)
                links.new(lw.outputs['Facing'], pw.inputs[0])
                em_color_inp = bsdf.inputs.get('Emission Color') or bsdf.inputs.get('Emission')
                if em_color_inp is not None:
                    em_color_inp.default_value = (rim_color[0], rim_color[1], rim_color[2], 1.0)
                if 'Emission Strength' in bsdf.inputs:
                    bsdf.inputs['Emission Strength'].default_value = max(0.0, min(1.0, rim_lift))
                links.new(bsdf.outputs['BSDF'], out_n.inputs['Surface'])

            mat['vrmc_materials_mtoon'] = json.dumps({
                'shadeColor': shade_color[:3],
                'shadingShift': shading_shift,
                'shadingToony': shading_toony,
                'matcapFactor': matcap_factor[:3],
                'rimColor': rim_color[:3],
                'rimFresnelPower': rim_fresnel,
                'rimLift': rim_lift,
                'outlineWidthMode': outline_mode,
                'outlineWidthFactor': outline_width,
                'outlineColor': outline_color[:3],
                'baseColorTexture': base_img.name if base_img else None,
                'matcapTexture': matcap_img.name if matcap_img else None,
            })
            configured.append(mat.name)

    mtoon_report = {
        'materialsConfigured': configured,
        'addonMtoonEnabled': used_addon_mtoon,
        'outlineWidthMode': outline_mode,
    }
    notes.append(f'Applied MToon configuration to {len(configured)} material(s) (addonMtoon={used_addon_mtoon}, outline={outline_mode}).')


def _resolve_head_mesh_for_expressions(meshes):
    if P.get('headMesh'):
        obj = bpy.data.objects.get(P['headMesh'])
        require(obj is not None and obj.type == 'MESH', 'Explicit headMesh not found: ' + str(P['headMesh']))
        return obj
    candidates = [
        o for o in meshes
        if str(o.get('charakuru_part', '')).upper() == 'HEAD'
    ]
    if not candidates:
        candidates = [
            o for o in meshes
            if 'head' in o.name.lower() and 'headless' not in o.name.lower() and 'hair' not in o.name.lower()
        ]
    if not candidates:
        candidates = [o for o in meshes if 'face' in o.name.lower() and 'hair' not in o.name.lower()]
    if not candidates:
        non_hair = [o for o in meshes if 'hair' not in o.name.lower() and 'headless' not in o.name.lower()]
        pool = non_hair or meshes
        if pool:
            candidates = [max(pool, key=lambda o: _world_bbox([o])[1].z)]
    require(candidates, 'No target headMesh found for expression_lab')
    return candidates[0]


def _morph_delta_for_vertex(morph_name, nx, nz, front_mask, fw, fh):
    delta = Vector((0.0, 0.0, 0.0))
    if morph_name.startswith('eye_'):
        is_left = morph_name.endswith('_L')
        eye_cx = 0.30 if is_left else -0.30
        eye_cz = 0.50
        falloff = math.exp(-(((nx - eye_cx) / 0.18) ** 2 + ((nz - eye_cz) / 0.09) ** 2)) * front_mask
        if 'blink' in morph_name:
            delta.z = -0.014 * fh * falloff
            delta.y = 0.003 * fh * falloff
        elif 'happy' in morph_name:
            delta.z = 0.011 * fh * falloff
        elif 'wide' in morph_name:
            delta.z = 0.009 * fh * falloff * (1.0 if nz >= eye_cz else -1.0)
        elif 'half' in morph_name:
            delta.z = -0.007 * fh * falloff
    elif morph_name.startswith('brow_'):
        brow_cz = 0.62
        falloff = math.exp(-(((abs(nx) - 0.28) / 0.22) ** 2 + ((nz - brow_cz) / 0.07) ** 2)) * front_mask
        if morph_name == 'brow_surprised':
            delta.z = 0.012 * fh * falloff
        elif morph_name == 'brow_down_angry':
            delta.z = -0.011 * fh * falloff * max(0.2, 1.3 - abs(nx))
        elif morph_name == 'brow_sad':
            delta.z = 0.009 * fh * falloff * (0.45 - abs(nx))
        elif morph_name == 'brow_relaxed':
            delta.z = -0.005 * fh * falloff
    elif morph_name.startswith('mouth_'):
        mouth_cz = 0.24
        falloff = math.exp(-((nx / 0.20) ** 2 + ((nz - mouth_cz) / 0.08) ** 2)) * front_mask
        if morph_name == 'mouth_aa':
            delta.z = -0.015 * fh * falloff * (1.0 if nz < mouth_cz else -0.3)
            delta.y = 0.006 * fh * falloff
        elif morph_name == 'mouth_ih':
            delta.x = 0.011 * fw * (1.0 if nx >= 0 else -1.0) * falloff
        elif morph_name == 'mouth_ou':
            delta.x = -0.009 * fw * (1.0 if nx >= 0 else -1.0) * falloff
            delta.y = -0.005 * fh * falloff
        elif morph_name == 'mouth_ee':
            delta.x = 0.013 * fw * (1.0 if nx >= 0 else -1.0) * falloff
            delta.z = -0.005 * fh * falloff
        elif morph_name == 'mouth_oh':
            delta.z = -0.012 * fh * falloff
            delta.y = 0.005 * fh * falloff
        elif morph_name == 'mouth_smile':
            delta.z = 0.010 * fh * falloff * abs(nx)
        elif morph_name == 'mouth_frown':
            delta.z = -0.009 * fh * falloff * abs(nx)
    return delta


def expression_lab():
    global expression_lab_report
    head_obj = _resolve_head_mesh_for_expressions(visible_meshes())
    _ensure_single_user_mesh(head_obj)
    mesh = head_obj.data
    require(len(mesh.vertices) > 0, 'Target headMesh has no vertices: ' + head_obj.name)

    presets = list(P.get('presets') or list(EXPRESSION_LAB_PRESETS))
    require(presets and len(set(presets)) == len(presets) and all(p in EXPRESSION_LAB_PRESETS for p in presets), 'Invalid expression_lab presets')
    intensity = float(P.get('intensity', 1.0))
    require(0.1 <= intensity <= 2.0, 'intensity must be between 0.1 and 2.0')
    exclude_hair_bbox = bool(P.get('excludeHairByBbox', True))
    hair_vgroups = {str(g) for g in (P.get('hairVertexGroups') or [])}
    bind_vrm1 = bool(P.get('bindVrm1', True))
    overwrite = bool(P.get('overwriteExisting', False))

    hair_vg_indices = set()
    for vg in head_obj.vertex_groups:
        low = vg.name.lower()
        if vg.name in hair_vgroups or (exclude_hair_bbox and any(t in low for t in ('hair', 'bang', 'twintail', 'ponytail', 'ahoge'))):
            hair_vg_indices.add(vg.index)

    excluded = set()
    for v in mesh.vertices:
        if any(g.group in hair_vg_indices and g.weight > 0.2 for g in v.groups):
            excluded.add(v.index)

    if exclude_hair_bbox:
        hair_mat_verts = set()
        non_hair_mat_verts = set()
        for poly in mesh.polygons:
            mat_name = ''
            if 0 <= poly.material_index < len(head_obj.material_slots) and head_obj.material_slots[poly.material_index].material:
                mat_name = head_obj.material_slots[poly.material_index].material.name.lower()
            target_set = hair_mat_verts if any(t in mat_name for t in ('hair', 'bang', 'twintail', 'ponytail', 'ahoge')) else non_hair_mat_verts
            for vi in poly.vertices:
                target_set.add(vi)
        excluded.update(hair_mat_verts - non_hair_mat_verts)

    face_verts = [v for v in mesh.vertices if v.index not in excluded]
    if not face_verts:
        face_verts = list(mesh.vertices)
        excluded.clear()

    if exclude_hair_bbox and len(face_verts) > 8:
        xs = [v.co.x for v in face_verts]
        ys = [v.co.y for v in face_verts]
        zs = [v.co.z for v in face_verts]
        raw_w = max(1e-4, max(xs) - min(xs))
        raw_h = max(1e-4, max(zs) - min(zs))
        raw_min_y, raw_max_y = min(ys), max(ys)
        front_band = [v for v in face_verts if v.co.y <= raw_min_y + 0.42 * max(1e-4, raw_max_y - raw_min_y)]
        if raw_h > 1.75 * raw_w and len(front_band) >= 8:
            f_zs = sorted(v.co.z for v in front_band)
            chin_z = f_zs[max(0, int(0.03 * len(f_zs)))]
            back_cut_y = raw_min_y + 0.65 * raw_w * 1.4
            for v in list(face_verts):
                if v.co.z < chin_z - 0.02 * raw_w or v.co.y > back_cut_y:
                    excluded.add(v.index)
            face_verts = [v for v in mesh.vertices if v.index not in excluded] or face_verts

    f_xs = [v.co.x for v in face_verts]
    f_ys = [v.co.y for v in face_verts]
    f_zs = [v.co.z for v in face_verts]
    f_min_x, f_max_x = min(f_xs), max(f_xs)
    f_min_y, f_max_y = min(f_ys), max(f_ys)
    f_min_z, f_max_z = min(f_zs), max(f_zs)
    fw = max(1e-4, f_max_x - f_min_x)
    fd = max(1e-4, f_max_y - f_min_y)
    fh = max(1e-4, f_max_z - f_min_z)
    f_cx = 0.5 * (f_min_x + f_max_x)

    if mesh.shape_keys is None:
        head_obj.shape_key_add(name='Basis', from_mix=False)
    basis = mesh.shape_keys.reference_key

    morphs_needed = []
    for preset in presets:
        for sk_name, _ in EXPRESSION_PRESET_MORPHS[preset]:
            if sk_name not in morphs_needed:
                morphs_needed.append(sk_name)

    created_keys = []
    for sk_name in morphs_needed:
        existing_kb = mesh.shape_keys.key_blocks.get(sk_name)
        if existing_kb is not None and not overwrite:
            continue
        kb = existing_kb if existing_kb is not None else head_obj.shape_key_add(name=sk_name, from_mix=False)
        kb.relative_key = basis
        kb.value = 0.0
        for idx, b_item in enumerate(basis.data):
            base_co = b_item.co
            if idx in excluded:
                kb.data[idx].co = base_co.copy()
                continue
            front_mask = max(0.0, 1.0 - max(0.0, base_co.y - f_min_y) / (0.48 * fd))
            if front_mask <= 0.0:
                kb.data[idx].co = base_co.copy()
                continue
            nx = (base_co.x - f_cx) / (0.5 * fw)
            nz = (base_co.z - f_min_z) / fh
            delta = _morph_delta_for_vertex(sk_name, nx, nz, front_mask, fw, fh) * intensity
            kb.data[idx].co = base_co + delta
        created_keys.append(sk_name)

    bound_presets = []
    if bind_vrm1:
        enable_vrm(required=False)
        arm = next((m.object for m in head_obj.modifiers if m.type == 'ARMATURE' and m.object), None)
        if arm is None:
            arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.get('avatar_studio_weight_reference')]
            arm = arms[0] if len(arms) == 1 else None
        ext = getattr(arm.data, 'vrm_addon_extension', None) if arm is not None else None
        vrm1_expr = getattr(getattr(ext, 'vrm1', None), 'expressions', None)
        preset_obj = getattr(vrm1_expr, 'preset', None) if vrm1_expr is not None else None
        if preset_obj is not None:
            slot_attr_map = {'blinkLeft': 'blink_left', 'blinkRight': 'blink_right'}
            for preset in presets:
                attr = slot_attr_map.get(preset, preset)
                expr_slot = getattr(preset_obj, attr, None)
                if expr_slot is None:
                    continue
                while len(expr_slot.morph_target_binds) > 0:
                    expr_slot.morph_target_binds.remove(0)
                for sk_name, w in EXPRESSION_PRESET_MORPHS[preset]:
                    if sk_name in mesh.shape_keys.key_blocks:
                        b = expr_slot.morph_target_binds.add()
                        b.node.mesh_object_name = head_obj.name
                        b.index = sk_name
                        b.weight = w
                if preset == 'happy' and hasattr(expr_slot, 'override_blink'):
                    _set_enum_safely(expr_slot, 'override_blink', 'block', ('BLOCK',))
                bound_presets.append(preset)

    expression_lab_report = {
        'headMesh': head_obj.name,
        'createdKeys': created_keys,
        'boundPresets': bound_presets,
        'excludedHairVertices': len(excluded),
    }
    notes.append(
        f'Expression Lab on {head_obj.name}: created={len(created_keys)} keys, '
        f'bound={len(bound_presets)} VRM1 presets, excludedHairVertices={len(excluded)}.'
    )


def physics_oscillation_audit():
    global physics_oscillation_report
    arm = rig()
    resolved, bone_source = resolve_humanoid_bones(arm, P.get('boneMap'))
    osc_keys = (
        'hips', 'spine', 'chest', 'head',
        'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
        'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
    )
    matched = {k: resolved[k] for k in osc_keys if k in resolved and isinstance(resolved[k], str) and resolved[k] and resolved[k] in arm.pose.bones}
    require(len(matched) > 0, 'No recognizable humanoid bones matched on armature; physics_oscillation_audit failed closed')

    frames = int(P.get('frames', 24))
    require(8 <= frames <= 120, 'frames must be an integer between 8 and 120')
    amplitude_deg = float(P.get('amplitudeDeg', 30.0))
    require(5.0 <= amplitude_deg <= 90.0, 'amplitudeDeg must be between 5 and 90')
    compare_off = bool(P.get('compareSpringOff', True))
    ignore_mods = P.get('ignoreModifiers') if P.get('ignoreModifiers') is not None else ['Outline', 'SOLIDIFY']

    all_meshes = visible_meshes()
    body_obj = bpy.data.objects.get(P['bodyObject']) if P.get('bodyObject') else None
    if body_obj is None:
        bound_meshes = [o for o in all_meshes if bound_to(o, arm)]
        body_obj = next((o for o in bound_meshes if 'body' in o.name.lower()), None)
        if body_obj is None and bound_meshes:
            body_obj = max(bound_meshes, key=lambda o: len(o.data.vertices))
    if P.get('objects'):
        garment_objs = [bpy.data.objects.get(n) for n in P['objects']]
        require(all(o is not None and o.type == 'MESH' for o in garment_objs), 'Invalid target mesh in physics_oscillation_audit')
    else:
        garment_objs = [o for o in all_meshes if o != body_obj and bound_to(o, arm)]

    ext = getattr(arm.data, 'vrm_addon_extension', None)
    sb = getattr(ext, 'spring_bone1', None) if ext is not None else None
    spring_chains = []
    if sb is not None:
        for sp in sb.springs:
            bones_in_chain = [j.node.bone_name for j in sp.joints if j.node.bone_name and j.node.bone_name in arm.pose.bones]
            if bones_in_chain:
                spring_chains.append(bones_in_chain)

    def _rotate_bone_world(bone_key, world_axis, deg):
        bname = matched.get(bone_key)
        if not bname or abs(deg) <= 1e-9:
            return
        pb = arm.pose.bones[bname]
        rest_rot = (arm.matrix_world @ pb.bone.matrix_local).to_3x3()
        r_world = Matrix.Rotation(math.radians(deg), 3, world_axis)
        r_local = rest_rot.inverted() @ r_world @ rest_rot
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = r_local.to_quaternion() @ pb.rotation_quaternion

    def _run_oscillation_pass(spring_on):
        if sb is not None and hasattr(sb, 'enable_animation'):
            sb.enable_animation = bool(spring_on)
        tip_positions = {tuple(chain): [] for chain in spring_chains}
        frame_overlaps = []
        for idx in range(frames):
            scene.frame_set(start_frame + idx)
            _restore_pose(arm, snapshot)
            theta = 2.0 * math.pi * (idx / float(frames))
            s_val = math.sin(theta)
            c_val = math.cos(theta)
            _rotate_bone_world('hips', Vector((0, 0, 1)), 0.25 * amplitude_deg * s_val)
            _rotate_bone_world('spine', Vector((0, 0, 1)), 0.15 * amplitude_deg * c_val)
            _rotate_bone_world('leftUpperLeg', Vector((1, 0, 0)), amplitude_deg * s_val)
            _rotate_bone_world('rightUpperLeg', Vector((1, 0, 0)), -amplitude_deg * s_val)
            _rotate_bone_world('leftUpperArm', Vector((1, 0, 0)), -0.6 * amplitude_deg * s_val)
            _rotate_bone_world('rightUpperArm', Vector((1, 0, 0)), 0.6 * amplitude_deg * s_val)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            arm_eval = arm.evaluated_get(deps)
            for chain in spring_chains:
                tip_pb = arm_eval.pose.bones.get(chain[-1])
                if tip_pb is not None:
                    tip_positions[tuple(chain)].append((arm_eval.matrix_world @ tip_pb.tail).copy())
            total_ov = 0
            if body_obj is not None and garment_objs:
                body_bvh, _, _ = _build_eval_bvh(body_obj, deps)
                if body_bvh is not None:
                    for g in garment_objs:
                        g_bvh, _, _ = _build_eval_bvh(g, deps)
                        if g_bvh is not None:
                            total_ov += len(body_bvh.overlap(g_bvh))
            frame_overlaps.append(total_ov)

        max_amp = 0.0
        for pts in tip_positions.values():
            if len(pts) >= 2:
                mean_p = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
                chain_amp = max((p - mean_p).length for p in pts)
                max_amp = max(max_amp, chain_amp)
        return max_amp, (max(frame_overlaps) if frame_overlaps else 0), frame_overlaps

    scene = bpy.context.scene
    start_frame = scene.frame_current
    prev_enable_anim = getattr(sb, 'enable_animation', None) if sb is not None else None
    saved_joints = (
        [(j, j.stiffness, j.gravity_power, j.drag_force) for sp in sb.springs for j in sp.joints]
        if sb is not None else []
    )
    muted = _mute_ignored_modifiers(all_meshes, ignore_mods)
    snapshot = _snapshot_pose(arm)

    try:
        amp_on, ov_on, per_frame_on = _run_oscillation_pass(True)
        if compare_off:
            amp_off, ov_off, per_frame_off = _run_oscillation_pass(False)
            max_ov_delta = max(
                (abs(a - b) for a, b in zip(per_frame_on, per_frame_off)),
                default=0,
            )
        else:
            amp_off, ov_off, max_ov_delta = None, None, 0
    finally:
        _restore_pose(arm, snapshot)
        scene.frame_set(start_frame)
        if sb is not None:
            if prev_enable_anim is not None and hasattr(sb, 'enable_animation'):
                sb.enable_animation = prev_enable_anim
            for j, st, gp, df in saved_joints:
                j.stiffness = st
                j.gravity_power = gp
                j.drag_force = df
        bpy.context.view_layer.update()
        _restore_modifiers(muted)

    physics_oscillation_report = {
        'frames': frames,
        'springChainsAudited': len(spring_chains),
        'amplitudeOn': round(amp_on, 6),
        'amplitudeOff': round(amp_off, 6) if amp_off is not None else None,
        'overlapOn': ov_on,
        'overlapOff': ov_off,
        'maxOverlapDelta': max_ov_delta,
        'boneSource': bone_source,
        'matchedBones': matched,
    }
    notes.append(
        f'Physics oscillation audit ({frames} frames, {len(spring_chains)} spring chains): '
        f'ampOn={physics_oscillation_report["amplitudeOn"]}, ampOff={physics_oscillation_report["amplitudeOff"]}, '
        f'overlapOn={ov_on}, overlapOff={ov_off}, maxOverlapDelta={max_ov_delta}.'
    )


def audit():
    objects = []
    for obj in bpy.context.scene.objects:
        if obj.type not in {'MESH', 'ARMATURE'}:
            continue
        row = {
            'name': obj.name,
            'type': obj.type,
            'helper': obj not in visible_meshes() if obj.type == 'MESH' else False,
            'dimensions': list(obj.dimensions),
            'location': list(obj.location),
            'scale': list(obj.scale),
        }
        if obj.type == 'MESH':
            rigid_bone_parent = (
                obj.parent_type == 'BONE'
                and obj.parent is not None
                and obj.parent.type == 'ARMATURE'
                and bool(obj.parent_bone)
                and obj.parent_bone in obj.parent.data.bones
                and not any(m.type == 'ARMATURE' for m in obj.modifiers)
            )
            deform = {
                g.index for g in obj.vertex_groups
                if any(a.type == 'ARMATURE' and g.name in a.data.bones and a.data.bones[g.name].use_deform for a in bpy.context.scene.objects)
            }
            unweighted = 0
            not_normalized = 0
            if not rigid_bone_parent:
                for v in obj.data.vertices:
                    total = sum(g.weight for g in v.groups if g.group in deform)
                    unweighted += int(total < 0.00001)
                    not_normalized += int(abs(total - 1) > 0.01)
            keys = obj.data.shape_keys
            row['shapeKeyCount'] = len(keys.key_blocks) - 1 if keys else 0
            row['shapeKeys'] = (
                [
                    {
                        'name': k.name,
                        'value': round(k.value, 4),
                        'sliderMin': round(k.slider_min, 4),
                        'sliderMax': round(k.slider_max, 4),
                    }
                    for k in keys.key_blocks if k != keys.reference_key
                ][:80]
                if keys else []
            )
            row['quadFaces'] = sum(1 for poly in obj.data.polygons if len(poly.vertices) == 4)
            row['uvLayers'] = len(obj.data.uv_layers)
            row.update(
                vertices=len(obj.data.vertices),
                faces=len(obj.data.polygons),
                unweighted=unweighted,
                nonNormalized=not_normalized,
                materials=[s.material.name if s.material else None for s in obj.material_slots],
                modifiers=[m.type for m in obj.modifiers],
            )
        else:
            row['bones'] = [b.name for b in obj.data.bones]
            row['bonePositions'] = {b.name: {'head': list(b.head_local), 'tail': list(b.tail_local)} for b in obj.data.bones}
            if hasattr(obj.data, 'vrm_addon_extension'):
                ext = obj.data.vrm_addon_extension
                row.update(
                    springs=len(ext.spring_bone1.springs),
                    colliders=len(ext.spring_bone1.colliders),
                    springJoints=sum(len(s.joints) for s in ext.spring_bone1.springs),
                )
        objects.append(row)
    missing = [i.name for i in bpy.data.images if i.source == 'FILE' and not i.packed_file and not getattr(i, 'packed_files', None) and i.filepath and not os.path.isfile(bpy.path.abspath(i.filepath))]
    meshes = [o for o in objects if o['type'] == 'MESH' and not o['helper']]
    out = {
        'requestId': C['requestId'],
        'blenderVersion': bpy.app.version_string,
        'operation': C['operation'],
        'objects': objects,
        'missingImages': missing,
        'gates': {'textures': not missing, 'weights': bool(meshes) and all(o['unweighted'] == 0 and o['nonNormalized'] == 0 for o in meshes)},
        'notes': notes,
        'visualReview': 'required',
        'expressions': P.get('expressions', 'preserve'),
        'sourceFilesModified': False,
        'materialInput': {'id': C['material']['id'], 'sha256': C['material']['sha256'], 'role': C['material']['role']} if C.get('material') else None,
    }
    if fit_report is not None:
        out['fitReport'] = fit_report
    if penetration_report is not None:
        out['penetrationReport'] = penetration_report
    if pose_check_report is not None:
        out['poseCheck'] = pose_check_report
    if smart_mesh_report is not None:
        out['smartMeshReport'] = smart_mesh_report
    if mtoon_report is not None:
        out['mtoonReport'] = mtoon_report
    if expression_lab_report is not None:
        out['expressionLabReport'] = expression_lab_report
    if physics_oscillation_report is not None:
        out['physicsOscillationReport'] = physics_oscillation_report
    return out


def _render_pose_screenshot(scene, meshes, out_path):
    bmin, bmax = _world_bbox(meshes)
    height = max(0.2, bmax.z - bmin.z)
    center = (bmin + bmax) * 0.5
    cam_data = bpy.data.cameras.new('AS_PoseCheck_Cam')
    cam_obj = bpy.data.objects.new('AS_PoseCheck_Cam', cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = center + Vector((height * 0.65, -height * 2.3, height * 0.12))
    cam_obj.rotation_euler = (center - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = height * 1.25

    light_data = bpy.data.lights.new('AS_PoseCheck_Light', 'SUN')
    light_data.energy = 2.5
    light_obj = bpy.data.objects.new('AS_PoseCheck_Light', light_data)
    scene.collection.objects.link(light_obj)
    light_obj.rotation_euler = (Euler((math.radians(45), 0, math.radians(-25)), 'XYZ'))

    prev_cam = scene.camera
    prev_path = scene.render.filepath
    prev_engine = scene.render.engine
    prev_rx, prev_ry = scene.render.resolution_x, scene.render.resolution_y
    prev_fmt = scene.render.image_settings.file_format
    prev_cm = scene.render.image_settings.color_mode
    try:
        engines = list(bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items.keys())
        if 'BLENDER_EEVEE_NEXT' in engines:
            scene.render.engine = 'BLENDER_EEVEE_NEXT'
        elif 'BLENDER_EEVEE' in engines:
            scene.render.engine = 'BLENDER_EEVEE'
        scene.camera = cam_obj
        scene.render.resolution_x = 512
        scene.render.resolution_y = 640
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGB'
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
    finally:
        scene.camera = prev_cam
        scene.render.filepath = prev_path
        scene.render.engine = prev_engine
        scene.render.resolution_x, scene.render.resolution_y = prev_rx, prev_ry
        scene.render.image_settings.file_format = prev_fmt
        scene.render.image_settings.color_mode = prev_cm
        bpy.data.objects.remove(cam_obj, do_unlink=True)
        bpy.data.objects.remove(light_obj, do_unlink=True)


def pose_check():
    global pose_check_report
    arm = rig()
    resolved, bone_source = resolve_humanoid_bones(arm, P.get('boneMap'))
    pose_bone_keys = (
        'head', 'neck', 'hips', 'spine', 'chest',
        'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
        'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
    )
    matched = {k: resolved[k] for k in pose_bone_keys if k in resolved and isinstance(resolved[k], str) and resolved[k] and resolved[k] in arm.pose.bones}
    require(len(matched) > 0, 'No recognizable humanoid pose bones matched on armature; supply explicit boneMap')

    all_meshes = visible_meshes()
    body_obj = bpy.data.objects.get(P['bodyObject']) if P.get('bodyObject') else None
    if body_obj is None:
        bound_meshes = [o for o in all_meshes if bound_to(o, arm)]
        body_obj = next((o for o in bound_meshes if 'body' in o.name.lower()), None)
        if body_obj is None and bound_meshes:
            body_obj = max(bound_meshes, key=lambda o: len(o.data.vertices))
    garment_objs = [o for o in all_meshes if o != body_obj and bound_to(o, arm)]

    poses = list(P.get('poses') or ['rest', 'head_turn', 'arm_raise', 'elbow_bend', 'high_kick'])
    high_kick_deg = float(P.get('highKickDeg', 100.0))
    capture = bool(P.get('captureScreenshots', False))
    report_dir = os.path.dirname(O['report']) if O.get('report') else os.getcwd()

    muted = _mute_ignored_modifiers(all_meshes, ('Outline', 'SOLIDIFY'))
    snapshot = _snapshot_pose(arm)
    pose_summaries = []
    max_overlap = 0
    try:
        for pose_name in poses:
            _restore_pose(arm, snapshot)
            _apply_named_pose(arm, resolved, pose_name, high_kick_deg=high_kick_deg)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            for obj in all_meshes:
                evaluated = obj.evaluated_get(deps)
                mesh = evaluated.to_mesh()
                try:
                    require(all(math.isfinite(c) for vert in mesh.vertices for c in vert.co), 'Nonfinite deformed vertex in ' + obj.name)
                finally:
                    evaluated.to_mesh_clear()

            overlaps_by_mesh = {}
            total_overlaps = 0
            if body_obj is not None and garment_objs:
                body_bvh, _, _ = _build_eval_bvh(body_obj, deps)
                if body_bvh is not None:
                    for g in garment_objs:
                        g_bvh, _, _ = _build_eval_bvh(g, deps)
                        cnt = len(body_bvh.overlap(g_bvh)) if g_bvh is not None else 0
                        overlaps_by_mesh[g.name] = cnt
                        total_overlaps += cnt
            max_overlap = max(max_overlap, total_overlaps)

            shot_file = None
            if capture and all_meshes:
                shot_name = f'pose_{pose_name}.png'
                shot_path = os.path.join(report_dir, shot_name)
                _render_pose_screenshot(bpy.context.scene, all_meshes, shot_path)
                shot_file = shot_name

            pose_summaries.append({
                'pose': pose_name,
                'finiteVerticesOk': True,
                'totalOverlapPairs': total_overlaps,
                'overlapsByMesh': overlaps_by_mesh,
                **({'screenshot': shot_file} if shot_file else {}),
            })
    finally:
        _restore_pose(arm, snapshot)
        bpy.context.view_layer.update()
        _restore_modifiers(muted)

    pose_check_report = {
        'boneSource': bone_source,
        'matchedBones': matched,
        'bodyObject': body_obj.name if body_obj else None,
        'poses': pose_summaries,
        'maxOverlapPairs': max_overlap,
        'passed': True,
    }
    notes.append(f'Multi-pose check ({bone_source}, {len(matched)} bones) ran poses={[p["pose"] for p in pose_summaries]}; maxOverlapPairs={max_overlap}.')


try:
    vrm_required = bool(P.get('vrmAddonPath') or C['operation'] in {'configure_vrm', 'spring_setup', 'export_vrm'})
    enable_vrm(required=vrm_required)
    if C.get('inputBlend'):
        bpy.ops.wm.open_mainfile(filepath=C['inputBlend'], load_ui=False, use_scripts=False)
    else:
        require(C['operation'] == 'normalize_material_mesh', 'inputBlend is required for ' + str(C['operation']))
        bpy.ops.wm.read_factory_settings(use_empty=True)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    operation = C['operation']
    if operation == 'head_scale':
        head_scale()
    elif operation == 'transform':
        rot_deg = P.get('rotation', [0, 0, 0])
        has_rot = any(abs(float(a)) > 1e-9 for a in rot_deg)
        rot_euler = Euler([math.radians(float(a)) for a in rot_deg], 'XYZ')
        for name in P['objects']:
            obj = bpy.data.objects.get(name)
            require(obj is not None and obj.type == 'MESH', 'Explicit mesh selection required: ' + name)
            obj.scale = Vector([a * b for a, b in zip(obj.scale, P.get('scale', [1, 1, 1]))])
            if has_rot:
                if obj.rotation_mode != 'XYZ':
                    obj.rotation_euler = obj.rotation_euler.to_matrix().to_euler('XYZ')
                    obj.rotation_mode = 'XYZ'
                obj.rotation_euler.rotate(rot_euler)
            obj.location += Vector(P.get('translation', [0, 0, 0]))
    elif operation == 'fit_foundation':
        fit_foundation()
    elif operation == 'append_foundation_head':
        append_foundation_head()
    elif operation == 'append_material_mesh':
        append_material_mesh()
    elif operation == 'normalize_material_mesh':
        normalize_material_mesh()
    elif operation == 'fit_garment':
        fit_garment()
    elif operation == 'audit_penetration':
        audit_penetration()
    elif operation == 'rigid_attach':
        rigid_attach()
    elif operation == 'apply_material_texture':
        apply_material_texture()
    elif operation == 'transfer_weights':
        transfer_weights()
    elif operation == 'normalize_weights':
        normalize_weights()
    elif operation == 'materials':
        material_check()
    elif operation == 'configure_vrm':
        configure_vrm()
    elif operation == 'spring_setup':
        spring_setup()
    elif operation == 'pose_check':
        pose_check()
    elif operation == 'smart_mesh_retexture':
        smart_mesh_retexture()
    elif operation == 'apply_mtoon':
        apply_mtoon()
    elif operation == 'expression_lab':
        expression_lab()
    elif operation == 'physics_oscillation_audit':
        physics_oscillation_audit()
    elif operation not in {'import_blend', 'import_checkpoint', 'import_material_scene', 'audit', 'export_vrm'}:
        raise RuntimeError('Unknown operation')
    report = audit()
    require(not report['missingImages'], 'Missing source images: ' + ','.join(report['missingImages']))
    try:
        bpy.ops.file.pack_all()
    except RuntimeError as pack_err:
        notes.append('Warning: pack_all skipped external data: ' + str(pack_err))
        report['notes'] = notes
    # Save a new immutable project revision only; source file is never saved in place.
    bpy.ops.wm.save_as_mainfile(filepath=O['blend'], check_existing=False, compress=False)
    select_export()
    bpy.ops.export_scene.gltf(filepath=O['preview'], export_format='GLB', use_selection=True, export_animations=False, export_yup=True)
    if operation == 'export_vrm':
        require(report['gates']['weights'], 'Export blocked by unweighted or non-normalized mesh vertices')
        result = bpy.ops.export_scene.vrm(filepath=O['vrm'], export_only_selections=True, export_invisibles=False, armature_object_name=rig().name)
        require('FINISHED' in result and os.path.isfile(O['vrm']), 'VRM exporter rejected the scene; inspect its validation errors')
    with open(O['report'], 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print('HEADLESS ' + json.dumps({'verdict': 'pass', 'requestId': C['requestId'], 'outputs': O, 'visualReview': 'required'}, ensure_ascii=False))
except Exception as error:
    print('HEADLESS ' + json.dumps({'verdict': 'fail', 'requestId': C['requestId'], 'error': str(error), 'traceback': traceback.format_exc()}, ensure_ascii=False))
    raise
