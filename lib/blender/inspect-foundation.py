# Read-only inventory of a user-registered donor Blend. Never save or export it.
import bpy
import json
import os
import sys
import traceback

c = json.loads(COMMAND)
P = c.get('params') if isinstance(c.get('params'), dict) else c

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
        blocks = o.data.shape_keys.key_blocks if o.data.shape_keys else []
        rows.append({'name': o.name, 'vertices': len(o.data.vertices), 'shapes': max(0, len(blocks)-1),
                     'dimensions': list(o.dimensions), 'locationWorld': list(o.matrix_world.translation)})
    with open(c['reportPath'], 'x', encoding='utf-8') as f:
        json.dump({'requestId': c['requestId'], 'donorSha256': c['donorSha256'], 'meshes': rows, 'truncated': len(meshes)>250}, f, ensure_ascii=False, allow_nan=False)
    print('HEADLESS '+json.dumps({'verdict':'pass','requestId':c['requestId']}))
except Exception as e:
    print('HEADLESS '+json.dumps({'verdict':'fail','requestId':c['requestId'],'error':str(e),'traceback':traceback.format_exc()}))
    raise
