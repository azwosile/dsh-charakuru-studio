# Read-only inventory of a user-registered donor Blend. Never save or export it.
import bpy
import bmesh
import json
import math
import os
import sys
import traceback
from mathutils import Vector

c = json.loads(COMMAND)
P = c.get('params') if isinstance(c.get('params'), dict) else c

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


def finite_num(val, digits=5):
    v = float(val)
    return round(v, digits) if math.isfinite(v) else 0.0


def finite_vec(vec, digits=5):
    return [finite_num(x, digits) for x in vec]


def is_facial_bone(name):
    low = str(name or '').lower()
    if low in FACIAL_ROOT_EXACT:
        return False
    if any(tok in low for tok in FACIAL_EXCLUDE_TOKENS):
        return False
    return any(kw in low for kw in FACIAL_BONE_KEYWORDS)


def mesh_armature_name(obj):
    for mod in obj.modifiers:
        if mod.type == 'ARMATURE' and mod.object and mod.object.type == 'ARMATURE':
            return mod.object.name
    cur = obj.parent
    while cur is not None:
        if cur.type == 'ARMATURE':
            return cur.name
        cur = cur.parent
    return None


def world_bbox(obj):
    if not obj.bound_box:
        pos = obj.matrix_world.translation
        return finite_vec(pos), finite_vec(pos)
    mw = obj.matrix_world
    pts = [mw @ Vector(corner) for corner in obj.bound_box]
    bmin = [min(p[i] for p in pts) for i in range(3)]
    bmax = [max(p[i] for p in pts) for i in range(3)]
    return finite_vec(bmin), finite_vec(bmax)


def estimate_neck_rim(meshes):
    if not meshes:
        return None
    prioritized = sorted(
        meshes[:60],
        key=lambda o: (
            0 if any(k in o.name.lower() for k in ('head', 'face', 'kao', '顔')) else 1,
            -len(o.data.vertices),
        ),
    )
    best_loop = None
    for obj in prioritized[:16]:
        if not obj.data.vertices:
            continue
        bm = bmesh.new()
        try:
            bm.from_mesh(obj.data)
            bm.verts.ensure_lookup_table()
            bm.edges.ensure_lookup_table()
            boundary_adj = {}
            for edge in bm.edges:
                if len(edge.link_faces) == 1:
                    v0, v1 = edge.verts[0], edge.verts[1]
                    boundary_adj.setdefault(v0.index, []).append(v1.index)
                    boundary_adj.setdefault(v1.index, []).append(v0.index)
            if not boundary_adj:
                continue
            mw = obj.matrix_world
            visited = set()
            for start in list(boundary_adj.keys()):
                if start in visited:
                    continue
                comp = []
                stack = [start]
                visited.add(start)
                while stack:
                    cur = stack.pop()
                    comp.append(cur)
                    for nb in boundary_adj.get(cur, ()):
                        if nb not in visited:
                            visited.add(nb)
                            stack.append(nb)
                if len(comp) < 4:
                    continue
                pts = [mw @ bm.verts[idx].co for idx in comp]
                cx = sum(p.x for p in pts) / len(pts)
                cy = sum(p.y for p in pts) / len(pts)
                cz = sum(p.z for p in pts) / len(pts)
                radii = [math.hypot(p.x - cx, p.y - cy) for p in pts]
                avg_r = sum(radii) / len(radii)
                min_z = min(p.z for p in pts)
                max_z = max(p.z for p in pts)
                plausible = 0.01 <= avg_r <= 0.25 and (max_z - min_z) <= 0.20
                score = (0 if plausible else 1, cz)
                if best_loop is None or score < best_loop[0]:
                    best_loop = (
                        score,
                        {
                            'mesh': obj.name,
                            'center': finite_vec((cx, cy, cz)),
                            'minZ': finite_num(min_z),
                            'maxZ': finite_num(max_z),
                            'radius': finite_num(avg_r),
                            'boundaryVertexCount': len(pts),
                            'method': 'boundary_loop',
                        },
                    )
        finally:
            bm.free()
    if best_loop is not None:
        return best_loop[1]

    # Fallback for closed donor meshes: lowest vertex band on primary head/mesh
    obj = prioritized[0]
    if not obj.data.vertices:
        return None
    mw = obj.matrix_world
    pts = [mw @ v.co for v in obj.data.vertices]
    min_z = min(p.z for p in pts)
    band = [p for p in pts if p.z <= min_z + 0.025]
    if not band:
        return None
    cx = sum(p.x for p in band) / len(band)
    cy = sum(p.y for p in band) / len(band)
    cz = sum(p.z for p in band) / len(band)
    avg_r = sum(math.hypot(p.x - cx, p.y - cy) for p in band) / len(band)
    return {
        'mesh': obj.name,
        'center': finite_vec((cx, cy, cz)),
        'minZ': finite_num(min_z),
        'maxZ': finite_num(max(p.z for p in band)),
        'radius': finite_num(avg_r),
        'boundaryVertexCount': len(band),
        'method': 'lowest_band',
    }


def enable_vrm(required=False):
    import addon_utils
    root = P.get('vrmAddonPath')
    if root:
        if not os.path.isdir(root):
            if required:
                raise RuntimeError('VRM add-on search path does not exist')
        elif root not in sys.path:
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
    if required and not hasattr(bpy.types.Armature, 'vrm_addon_extension'):
        raise RuntimeError('VRM Add-on unavailable; install a compatible official add-on or configure its local path')
    return hasattr(bpy.types.Armature, 'vrm_addon_extension')


try:
    enable_vrm(required=bool(P.get('vrmAddonPath')))
    bpy.ops.wm.open_mainfile(filepath=c['inputBlend'], load_ui=False, use_scripts=False)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]
    rows = []
    for o in meshes[:250]:
        keys = o.data.shape_keys
        blocks = list(keys.key_blocks) if keys else []
        ref = keys.reference_key if keys else None
        shape_names = [k.name for k in blocks if k != ref][:80]
        bmin, bmax = world_bbox(o)
        rows.append({
            'name': o.name,
            'vertices': len(o.data.vertices),
            'shapes': max(0, len(blocks) - 1),
            'dimensions': finite_vec(o.dimensions),
            'locationWorld': finite_vec(o.matrix_world.translation),
            'bboxMin': bmin,
            'bboxMax': bmax,
            'vertexGroups': [g.name for g in o.vertex_groups][:128],
            'shapeKeyNames': shape_names,
            'armature': mesh_armature_name(o),
            'materials': [s.material.name if s.material else None for s in o.material_slots][:64],
            'uvLayers': len(o.data.uv_layers),
        })

    arm_rows = []
    scene_arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    for arm in scene_arms[:16]:
        bones_list = list(arm.data.bones)
        capped = bones_list[:360]
        mw = arm.matrix_world
        bone_positions = {
            b.name: {
                'head': finite_vec(mw @ b.head_local),
                'tail': finite_vec(mw @ b.tail_local),
                'parent': b.parent.name if b.parent else None,
            }
            for b in capped
        }
        facial = [b.name for b in bones_list if is_facial_bone(b.name)][:200]
        arm_rows.append({
            'name': arm.name,
            'boneCount': len(bones_list),
            'bones': [b.name for b in capped],
            'bonePositions': bone_positions,
            'facialBones': facial,
        })

    missing_images = [
        img.name
        for img in bpy.data.images
        if img.source == 'FILE'
        and not img.packed_file
        and not getattr(img, 'packed_files', None)
        and img.filepath
        and not os.path.isfile(bpy.path.abspath(img.filepath))
    ]
    neck_rim = estimate_neck_rim(meshes)

    payload = {
        'requestId': c['requestId'],
        'donorSha256': c['donorSha256'],
        'meshes': rows,
        'truncated': len(meshes) > 250,
        'armatures': arm_rows,
        'missingImages': missing_images,
        'neckRimEstimate': neck_rim,
    }
    with open(c['reportPath'], 'x', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, allow_nan=False)
    print('HEADLESS ' + json.dumps({'verdict': 'pass', 'requestId': c['requestId']}, ensure_ascii=False))
except Exception as e:
    print('HEADLESS ' + json.dumps({'verdict': 'fail', 'requestId': c['requestId'], 'error': str(e), 'traceback': traceback.format_exc()}, ensure_ascii=False))
    raise
