# Read-only inventory of a user-registered donor Blend. Never save or export it.
import bpy
import json
import traceback

c = json.loads(COMMAND)

try:
    bpy.ops.wm.open_mainfile(filepath=c['inputBlend'], load_ui=False, use_scripts=False)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]
    rows = []
    for o in meshes[:70]:
        blocks = o.data.shape_keys.key_blocks if o.data.shape_keys else []
        rows.append({'name': o.name, 'vertices': len(o.data.vertices), 'shapes': max(0, len(blocks)-1),
                     'dimensions': list(o.dimensions), 'locationWorld': list(o.matrix_world.translation)})
    with open(c['reportPath'], 'x', encoding='utf-8') as f:
        json.dump({'requestId': c['requestId'], 'donorSha256': c['donorSha256'], 'meshes': rows, 'truncated': len(meshes)>70}, f, ensure_ascii=False, allow_nan=False)
    print('HEADLESS '+json.dumps({'verdict':'pass','requestId':c['requestId']}))
except Exception as e:
    print('HEADLESS '+json.dumps({'verdict':'fail','requestId':c['requestId'],'error':str(e),'traceback':traceback.format_exc()}))
    raise
