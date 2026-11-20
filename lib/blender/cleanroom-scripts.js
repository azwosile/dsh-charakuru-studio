function finite(value, name, min = 0, max = 100) { if (!Number.isFinite(value) || value <= min || value > max) throw new Error(`Invalid ${name}`); return value; }
/**
 * dsh-charakuru-studio — 100% Clean-Room MIT Blender 5.2+ Python Script Generators.
 *
 * Designed for direct execution through `sixtysevenlf/dsh-blender-plugin`:
 *   - `blender_rt_do` (`/act` persistent kernel `K` when GUI is open)
 *   - `blender_rt_headless` (`/headless` with `hardExit: true`, emitting single-line `HEADLESS {...}` JSON)
 *
 * Strictly adheres to Blender 5.2+ API contracts:
 *   1. Enables VRM Add-on BEFORE `bpy.ops.wm.open_mainfile()` to prevent `EXCEPTION_ACCESS_VIOLATION`.
 *   2. Never touches removed `Mesh.use_auto_smooth` (removed in Blender 4.1+/5.x).
 *   3. Uses `bpy.data` / `bmesh` directly so scripts work identically in GUI and headless `-b` workers.
 *   4. Uses zero donor `.blend` or JSON files from `nanocle/Charakuru`.
 */

const VRM_PREAMBLE_PY = `# Auto-generated Clean-Room script by dsh-charakuru-studio (MIT License)
import contextlib
import json
import math
import os
import sys
import addon_utils
import bpy
import bmesh
from mathutils import Vector, Matrix

def enable_vrm_addon_safely():
    """Enable VRM Add-on BEFORE opening any .blend with VRM extension properties (prevents Blender 5.2 AV crash)."""
    candidates = [
        "bl_ext.user_default.vrm",
        "bl_ext.blender_org.vrm",
        "io_scene_vrm",
    ]
    for mod in addon_utils.modules():
        name = getattr(mod, "__name__", "")
        if "vrm" in name.lower() and name not in candidates:
            candidates.append(name)
    enabled_mod = None
    for mod_name in candidates:
        try:
            module = addon_utils.enable(mod_name, default_set=False, persistent=True)
            if module is not None and addon_utils.check(mod_name)[1]:
                enabled_mod = mod_name
                break
        except Exception:
            continue
    if enabled_mod is None:
        raise RuntimeError("Enable VRM Add-on before opening a VRM blend; addon was not found or failed to enable")
    return enabled_mod

def require_file(filepath):
    if not filepath or not os.path.isfile(filepath):
        raise FileNotFoundError("Required stage input: " + str(filepath))

def ensure_parent_dir(filepath):
    if not filepath:
        return
    parent = os.path.dirname(os.path.abspath(filepath))
    if parent:
        os.makedirs(parent, exist_ok=True)

@contextlib.contextmanager
def armature_edit_mode(arm_obj):
    prev_obj = bpy.context.object
    if prev_obj is not None and prev_obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    prev_active = bpy.context.view_layer.objects.active
    prev_hide = arm_obj.hide_get()
    prev_vp = arm_obj.hide_viewport
    try:
        arm_obj.hide_set(False)
        arm_obj.hide_viewport = False
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.mode_set(mode="EDIT")
        yield arm_obj.data.edit_bones
    finally:
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        arm_obj.hide_set(prev_hide)
        arm_obj.hide_viewport = prev_vp
        bpy.context.view_layer.objects.active = prev_active

def set_enum_safely(target, prop, preferred, fallbacks=()):
    if target is None or not hasattr(target, prop):
        return False
    if isinstance(preferred, bool):
        setattr(target, prop, preferred)
        return True
    candidates = [str(preferred)] + [str(f) for f in fallbacks if f is not None]
    bl_rna = getattr(target, "bl_rna", None)
    props = getattr(bl_rna, "properties", None) if bl_rna is not None else None
    prop_rna = props.get(prop) if props is not None and hasattr(props, "get") else None
    enum_items = getattr(prop_rna, "enum_items", None) if prop_rna is not None else None
    if enum_items:
        by_exact = {item.identifier: item.identifier for item in enum_items}
        by_lower = {item.identifier.lower(): item.identifier for item in enum_items}
        by_norm = {item.identifier.lower().replace("_", ""): item.identifier for item in enum_items}
        for cand in candidates:
            if cand in by_exact:
                setattr(target, prop, by_exact[cand])
                return True
            low = cand.lower()
            if low in by_lower:
                setattr(target, prop, by_lower[low])
                return True
            norm = low.replace("_", "")
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

def open_required_blend(filepath):
    require_file(filepath)
    bpy.ops.wm.open_mainfile(filepath=filepath, load_ui=False, use_scripts=False)
    if not any(o.type == "MESH" for o in bpy.context.scene.objects):
        raise RuntimeError("Input blend contains no scene meshes")

def emit_headless(payload):
    print("HEADLESS " + json.dumps(payload, ensure_ascii=False))

def is_head_mesh_candidate(obj, include_face=True):
    part = str(obj.get("charakuru_part", "")).upper()
    if part == "HEAD":
        return True
    if part == "BODY":
        return False
    low = obj.name.lower()
    if "headless" in low:
        return False
    if include_face and "face" in low:
        return True
    return "head" in low
`;

export function generateStage1SafeImportScript({
  headGlbPath = '',
  bodyGlbPath = '',
  existingBlendPath = '',
  outputBlendPath,
}) {
  return `${VRM_PREAMBLE_PY}
HEAD_GLB = ${JSON.stringify(headGlbPath || '')}
BODY_GLB = ${JSON.stringify(bodyGlbPath || '')}
EXISTING_BLEND = ${JSON.stringify(existingBlendPath || '')}
OUTPUT_BLEND = ${JSON.stringify(outputBlendPath)}

def import_tagged_glb(filepath, tag_prefix):
    require_file(filepath)
    before_names = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=filepath)
    created = []
    for name in list(bpy.data.objects.keys()):
        if name not in before_names:
            obj = bpy.data.objects[name]
            obj["charakuru_part"] = tag_prefix
            if obj.type == "MESH":
                obj.name = f"CHR_{tag_prefix}_{obj.name}"
                # Generic mesh cleanup is performed through companion fix/audit operations.
            created.append(obj.name)
    return created

def main():
    vrm_mod = enable_vrm_addon_safely()
    if EXISTING_BLEND:
        require_file(EXISTING_BLEND)
        bpy.ops.wm.open_mainfile(filepath=EXISTING_BLEND, load_ui=False, use_scripts=False)
    else:
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)

    if not EXISTING_BLEND and (not HEAD_GLB or not BODY_GLB):
        raise RuntimeError("Both head and body GLBs are required for a new assembly")
    imported_head = import_tagged_glb(HEAD_GLB, "HEAD") if HEAD_GLB else []
    imported_body = import_tagged_glb(BODY_GLB, "BODY") if BODY_GLB else []
    if not any(o.type == "MESH" for o in bpy.context.scene.objects):
        raise RuntimeError("Import produced no meshes")

    ensure_parent_dir(OUTPUT_BLEND)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    result = {
        "verdict": "pass",
        "stage": "01_vrm_safe_boot_and_import",
        "blenderVersion": bpy.app.version_string,
        "vrmAddonModule": vrm_mod,
        "importedHeadObjects": imported_head,
        "importedBodyObjects": imported_body,
        "savedBlend": OUTPUT_BLEND,
    }
    emit_headless(result)
    return result

try:
    LAST_RESULT = main()
except Exception as exc:
    emit_headless({"verdict": "fail", "error": str(exc)})
    raise
`;
}

export function generateStage2AssemblyRatioScript({
  inputBlendPath,
  outputBlendPath,
  neckScaleFactor = 0.86,
  targetHeightMeters = 1.58,
}) {
  return `${VRM_PREAMBLE_PY}
INPUT_BLEND = ${JSON.stringify(inputBlendPath)}
OUTPUT_BLEND = ${JSON.stringify(outputBlendPath)}
NECK_SCALE = float(${finite(neckScaleFactor, "neckScaleFactor")})
TARGET_HEIGHT = float(${finite(targetHeightMeters, "targetHeightMeters")})

TEXTURE_GROUPS = ("Hair", "Head", "UpperBody", "LowerBody", "Accessories")

def world_bbox(meshes):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    count = 0
    for obj in meshes:
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, w.x)
            mins.y = min(mins.y, w.y)
            mins.z = min(mins.z, w.z)
            maxs.x = max(maxs.x, w.x)
            maxs.y = max(maxs.y, w.y)
            maxs.z = max(maxs.z, w.z)
            count += 1
    return (mins, maxs) if count else (Vector((0, 0, 0)), Vector((0, 0, 1.6)))

def classify_texture_group(obj):
    low = obj.name.lower()
    part = str(obj.get("charakuru_part", "")).upper()
    if "hair" in low or "bang" in low or "tail" in low:
        return "Hair"
    if is_head_mesh_candidate(obj, include_face=True):
        return "Head"
    if "skirt" in low or "pant" in low or "shoe" in low or "leg" in low or "sock" in low:
        return "LowerBody"
    if "ribbon" in low or "bow" in low or "acc" in low or "pin" in low:
        return "Accessories"
    mins, maxs = world_bbox([obj])
    mid_z = 0.5 * (mins.z + maxs.z)
    if part == "BODY":
        return "UpperBody" if mid_z >= 0.88 else "LowerBody"
    return "UpperBody"

def main():
    vrm_mod = enable_vrm_addon_safely()
    open_required_blend(INPUT_BLEND)

    if any(o.type == "ARMATURE" for o in bpy.data.objects):
        raise RuntimeError("Ratio assembly accepts unrigged parts; transform a rig and its colliders together using a reviewed rig workflow")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    head_meshes = [o for o in meshes if is_head_mesh_candidate(o, include_face=False)]
    body_meshes = [o for o in meshes if o not in head_meshes]

    if not head_meshes or not body_meshes:
        raise RuntimeError("Ratio assembly requires tagged head and body meshes")

    # Normalize body grounded at Z=0
    if body_meshes:
        b_min, b_max = world_bbox(body_meshes)
        body_h = max(1e-4, b_max.z - b_min.z)
        desired_body_h = TARGET_HEIGHT * 0.84
        s_body = desired_body_h / body_h
        for o in body_meshes:
            o.scale *= s_body
            o.location.z = (o.location.z - b_min.z) * s_body

    bpy.context.view_layer.update()
    b_min, b_max = world_bbox(body_meshes) if body_meshes else (Vector((0, 0, 0)), Vector((0, 0, 1.32)))
    neck_pivot = Vector((0.0, 0.0, b_max.z - 0.03))

    # Align & scale head+hair around neck pivot (prevents collar gap & keeps head-body ratio ~6.3 heads)
    if head_meshes:
        h_min, h_max = world_bbox(head_meshes)
        h_center_xy = Vector((0.5 * (h_min.x + h_max.x), 0.5 * (h_min.y + h_max.y), h_min.z))
        offset = neck_pivot - h_center_xy
        pivot_mat = Matrix.Translation(neck_pivot) @ Matrix.Scale(NECK_SCALE, 4) @ Matrix.Translation(-neck_pivot)
        for o in head_meshes:
            o.matrix_world = Matrix.Translation(offset) @ o.matrix_world
            o.matrix_world = pivot_mat @ o.matrix_world

    bpy.context.view_layer.update()
    grouped = {g: [] for g in TEXTURE_GROUPS}
    for o in meshes:
        grp = classify_texture_group(o)
        o["charakuru_tex_group"] = grp
        grouped[grp].append(o.name)

    all_min, all_max = world_bbox(meshes)
    total_h = max(1e-4, all_max.z - all_min.z)
    head_h = max(1e-4, (world_bbox(head_meshes)[1].z - world_bbox(head_meshes)[0].z)) if head_meshes else (total_h / 6.3)

    ensure_parent_dir(OUTPUT_BLEND)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    result = {
        "verdict": "degraded",
        "honestLimits": ["Heuristic draft; companion audit and visual/animation review remain required"],
        "stage": "02_part_group_and_neck_ratio",
        "vrmAddonModule": vrm_mod,
        "neckPivot": [round(neck_pivot.x, 4), round(neck_pivot.y, 4), round(neck_pivot.z, 4)],
        "neckScaleApplied": NECK_SCALE,
        "measuredTotalHeightM": round(total_h, 4),
        "estimatedHeadBodyRatio": round(total_h / head_h, 2),
        "textureGroups": grouped,
        "savedBlend": OUTPUT_BLEND,
    }
    emit_headless(result)
    return result

try:
    LAST_RESULT = main()
except Exception as exc:
    emit_headless({"verdict": "fail", "error": str(exc)})
    raise
`;
}

export function generateStage3CleanRoomRigWeightsScript({
  inputBlendPath,
  outputBlendPath,
  vestBleedCutoffZRatio = 0.53,
}) {
  return `${VRM_PREAMBLE_PY}
INPUT_BLEND = ${JSON.stringify(inputBlendPath)}
OUTPUT_BLEND = ${JSON.stringify(outputBlendPath)}
VEST_CUTOFF_RATIO = float(${finite(vestBleedCutoffZRatio, "vestBleedCutoffZRatio")})

# Clean-Room procedural VRM 1.0 Humanoid skeleton ratios (height = 1.0 normalized, scaled to character bbox)
HUMANOID_SPEC = [
    ("hips", None, (0.0, 0.0, 0.52), (0.0, 0.0, 0.58)),
    ("spine", "hips", (0.0, 0.0, 0.58), (0.0, 0.0, 0.68)),
    ("chest", "spine", (0.0, 0.0, 0.68), (0.0, 0.0, 0.78)),
    ("upperChest", "chest", (0.0, 0.0, 0.78), (0.0, 0.0, 0.84)),
    ("neck", "upperChest", (0.0, 0.0, 0.84), (0.0, 0.0, 0.88)),
    ("head", "neck", (0.0, 0.0, 0.88), (0.0, 0.0, 1.00)),
    ("leftEye", "head", (0.028, -0.055, 0.935), (0.028, -0.075, 0.935)),
    ("rightEye", "head", (-0.028, -0.055, 0.935), (-0.028, -0.075, 0.935)),
    ("leftShoulder", "upperChest", (0.03, 0.0, 0.82), (0.10, 0.0, 0.82)),
    ("leftUpperArm", "leftShoulder", (0.10, 0.0, 0.82), (0.26, 0.0, 0.82)),
    ("leftLowerArm", "leftUpperArm", (0.26, 0.0, 0.82), (0.41, 0.0, 0.82)),
    ("leftHand", "leftLowerArm", (0.41, 0.0, 0.82), (0.47, 0.0, 0.82)),
    ("leftThumbMetacarpal", "leftHand", (0.425, -0.015, 0.818), (0.445, -0.028, 0.812)),
    ("leftThumbProximal", "leftThumbMetacarpal", (0.445, -0.028, 0.812), (0.463, -0.036, 0.808)),
    ("leftThumbDistal", "leftThumbProximal", (0.463, -0.036, 0.808), (0.478, -0.042, 0.805)),
    ("leftIndexProximal", "leftHand", (0.470, -0.014, 0.820), (0.490, -0.014, 0.820)),
    ("leftIndexIntermediate", "leftIndexProximal", (0.490, -0.014, 0.820), (0.506, -0.014, 0.820)),
    ("leftIndexDistal", "leftIndexIntermediate", (0.506, -0.014, 0.820), (0.519, -0.014, 0.820)),
    ("leftMiddleProximal", "leftHand", (0.472, -0.004, 0.820), (0.494, -0.004, 0.820)),
    ("leftMiddleIntermediate", "leftMiddleProximal", (0.494, -0.004, 0.820), (0.511, -0.004, 0.820)),
    ("leftMiddleDistal", "leftMiddleIntermediate", (0.511, -0.004, 0.820), (0.525, -0.004, 0.820)),
    ("leftRingProximal", "leftHand", (0.470, 0.006, 0.820), (0.490, 0.006, 0.820)),
    ("leftRingIntermediate", "leftRingProximal", (0.490, 0.006, 0.820), (0.506, 0.006, 0.820)),
    ("leftRingDistal", "leftRingIntermediate", (0.506, 0.006, 0.820), (0.519, 0.006, 0.820)),
    ("leftLittleProximal", "leftHand", (0.466, 0.016, 0.820), (0.483, 0.016, 0.820)),
    ("leftLittleIntermediate", "leftLittleProximal", (0.483, 0.016, 0.820), (0.496, 0.016, 0.820)),
    ("leftLittleDistal", "leftLittleIntermediate", (0.496, 0.016, 0.820), (0.507, 0.016, 0.820)),
    ("rightShoulder", "upperChest", (-0.03, 0.0, 0.82), (-0.10, 0.0, 0.82)),
    ("rightUpperArm", "rightShoulder", (-0.10, 0.0, 0.82), (-0.26, 0.0, 0.82)),
    ("rightLowerArm", "rightUpperArm", (-0.26, 0.0, 0.82), (-0.41, 0.0, 0.82)),
    ("rightHand", "rightLowerArm", (-0.41, 0.0, 0.82), (-0.47, 0.0, 0.82)),
    ("rightThumbMetacarpal", "rightHand", (-0.425, -0.015, 0.818), (-0.445, -0.028, 0.812)),
    ("rightThumbProximal", "rightThumbMetacarpal", (-0.445, -0.028, 0.812), (-0.463, -0.036, 0.808)),
    ("rightThumbDistal", "rightThumbProximal", (-0.463, -0.036, 0.808), (-0.478, -0.042, 0.805)),
    ("rightIndexProximal", "rightHand", (-0.470, -0.014, 0.820), (-0.490, -0.014, 0.820)),
    ("rightIndexIntermediate", "rightIndexProximal", (-0.490, -0.014, 0.820), (-0.506, -0.014, 0.820)),
    ("rightIndexDistal", "rightIndexIntermediate", (-0.506, -0.014, 0.820), (-0.519, -0.014, 0.820)),
    ("rightMiddleProximal", "rightHand", (-0.472, -0.004, 0.820), (-0.494, -0.004, 0.820)),
    ("rightMiddleIntermediate", "rightMiddleProximal", (-0.494, -0.004, 0.820), (-0.511, -0.004, 0.820)),
    ("rightMiddleDistal", "rightMiddleIntermediate", (-0.511, -0.004, 0.820), (-0.525, -0.004, 0.820)),
    ("rightRingProximal", "rightHand", (-0.470, 0.006, 0.820), (-0.490, 0.006, 0.820)),
    ("rightRingIntermediate", "rightRingProximal", (-0.490, 0.006, 0.820), (-0.506, 0.006, 0.820)),
    ("rightRingDistal", "rightRingIntermediate", (-0.506, 0.006, 0.820), (-0.519, 0.006, 0.820)),
    ("rightLittleProximal", "rightHand", (-0.466, 0.016, 0.820), (-0.483, 0.016, 0.820)),
    ("rightLittleIntermediate", "rightLittleProximal", (-0.483, 0.016, 0.820), (-0.496, 0.016, 0.820)),
    ("rightLittleDistal", "rightLittleIntermediate", (-0.496, 0.016, 0.820), (-0.507, 0.016, 0.820)),
    ("leftUpperLeg", "hips", (0.09, 0.0, 0.52), (0.09, 0.0, 0.28)),
    ("leftLowerLeg", "leftUpperLeg", (0.09, 0.0, 0.28), (0.09, 0.0, 0.05)),
    ("leftFoot", "leftLowerLeg", (0.09, 0.0, 0.05), (0.09, -0.08, 0.01)),
    ("leftToes", "leftFoot", (0.09, -0.08, 0.01), (0.09, -0.13, 0.01)),
    ("rightUpperLeg", "hips", (-0.09, 0.0, 0.52), (-0.09, 0.0, 0.28)),
    ("rightLowerLeg", "rightUpperLeg", (-0.09, 0.0, 0.28), (-0.09, 0.0, 0.05)),
    ("rightFoot", "rightLowerLeg", (-0.09, 0.0, 0.05), (-0.09, -0.08, 0.01)),
    ("rightToes", "rightFoot", (-0.09, -0.08, 0.01), (-0.09, -0.13, 0.01)),
]

LEFT_LEG_BONES = {"leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"}
RIGHT_LEG_BONES = {"rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"}
NON_DEFORM_EYE_BONES = {"leftEye", "rightEye"}

MIXAMO_PINKY_ALIASES = {
    "mixamorig:LeftHandPinky1": "leftLittleProximal",
    "mixamorig:LeftHandPinky2": "leftLittleIntermediate",
    "mixamorig:LeftHandPinky3": "leftLittleDistal",
    "LeftHandPinky1": "leftLittleProximal",
    "LeftHandPinky2": "leftLittleIntermediate",
    "LeftHandPinky3": "leftLittleDistal",
    "RightHandPinky1": "rightLittleProximal",
    "RightHandPinky2": "rightLittleIntermediate",
    "RightHandPinky3": "rightLittleDistal",
    "mixamorig:RightHandPinky1": "rightLittleProximal",
    "mixamorig:RightHandPinky2": "rightLittleIntermediate",
    "mixamorig:RightHandPinky3": "rightLittleDistal",
}

def point_segment_dist(p, a, b):
    ab = b - a
    denom = ab.length_squared
    if denom < 1e-10:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / denom))
    proj = a + t * ab
    return (p - proj).length

def fix_mixamo_pinky_drift(arm_obj):
    fixed = []
    with armature_edit_mode(arm_obj) as ebones:
        for old_name, new_name in MIXAMO_PINKY_ALIASES.items():
            if old_name in ebones and new_name not in ebones:
                eb = ebones[old_name]
                eb.name = new_name
                fixed.append(f"{old_name}->{new_name}")
        # Clamp any pinky chain floating >4cm above parent hand bone Z
        for hand_candidates, pinky_chain in (
            (("leftHand", "mixamorig:LeftHand", "LeftHand"), ("leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal")),
            (("rightHand", "mixamorig:RightHand", "RightHand"), ("rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal")),
        ):
            hand_b = next((ebones[n] for n in hand_candidates if n in ebones), None)
            pinky_b = ebones.get(pinky_chain[0])
            if hand_b is not None and pinky_b is not None:
                dz = pinky_b.head.z - hand_b.tail.z
                if abs(dz) > 0.04:
                    delta = Vector((0.0, 0.0, -dz))
                    for seg_name in pinky_chain:
                        if seg_name in ebones:
                            ebones[seg_name].head += delta
                            ebones[seg_name].tail += delta
                    fixed.append(f"{pinky_chain[0]}:clamped_dz={round(dz, 4)}")
    return fixed

def ensure_missing_detail_bones(arm_obj, total_height):
    """Add missing VRM eye/toe/finger leaf bones to an existing armature when their parent exists."""
    added = []
    with armature_edit_mode(arm_obj) as ebones:
        detail_names = {
            "leftEye", "rightEye", "leftToes", "rightToes",
            "leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal",
            "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
            "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
            "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
            "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
            "rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal",
            "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
            "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
            "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
            "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal",
        }
        for bname, parent_name, h_rel, t_rel in HUMANOID_SPEC:
            if bname not in detail_names or bname in ebones:
                continue
            if parent_name and parent_name in ebones:
                eb = ebones.new(bname)
                eb.head = Vector((h_rel[0] * total_height, h_rel[1] * total_height, h_rel[2] * total_height))
                eb.tail = Vector((t_rel[0] * total_height, t_rel[1] * total_height, t_rel[2] * total_height))
                eb.parent = ebones[parent_name]
                added.append(bname)
    return added

def _populate_humanoid_bones(arm_obj, total_height):
    with armature_edit_mode(arm_obj) as ebones:
        for bname, parent_name, h_rel, t_rel in HUMANOID_SPEC:
            eb = ebones.new(bname)
            eb.head = Vector((h_rel[0] * total_height, h_rel[1] * total_height, h_rel[2] * total_height))
            eb.tail = Vector((t_rel[0] * total_height, t_rel[1] * total_height, t_rel[2] * total_height))
            if parent_name and parent_name in ebones:
                eb.parent = ebones[parent_name]

def ensure_cleanroom_armature(total_height):
    existing = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if existing:
        arm = existing[0]
        if len(arm.data.bones) == 0:
            _populate_humanoid_bones(arm, total_height)
            return arm, ["populated_empty_armature"], True
        pinky_fixes = fix_mixamo_pinky_drift(arm)
        added_bones = ensure_missing_detail_bones(arm, total_height)
        return arm, pinky_fixes + [f"added:{b}" for b in added_bones], False

    arm_data = bpy.data.armatures.new("CHR_VRM_Humanoid")
    arm_obj = bpy.data.objects.new("CHR_VRM_Armature", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    _populate_humanoid_bones(arm_obj, total_height)
    return arm_obj, [], True

def _is_leg_group_side(group_name):
    low = group_name.lower()
    if group_name in LEFT_LEG_BONES:
        return "left"
    if group_name in RIGHT_LEG_BONES:
        return "right"
    is_leg = any(tok in low for tok in ("upleg", "upperleg", "lowerleg", "thigh", "calf", "shin", "foot", "toe"))
    if not is_leg:
        return None
    if "left" in low or low.endswith("_l") or ".l" in low:
        return "left"
    if "right" in low or low.endswith("_r") or ".r" in low:
        return "right"
    return None

def enforce_leg_x_sign_separation(mesh_obj):
    """Strip any opposite-side leg/foot/toe weights across X=0 and re-normalize vertex weights."""
    vgroups = mesh_obj.vertex_groups
    if not vgroups:
        return 0
    left_idxs = {vg.index for vg in vgroups if _is_leg_group_side(vg.name) == "left"}
    right_idxs = {vg.index for vg in vgroups if _is_leg_group_side(vg.name) == "right"}
    if not left_idxs and not right_idxs:
        return 0
    fixed_verts = 0
    for v in mesh_obj.data.vertices:
        wp = mesh_obj.matrix_world @ v.co
        forbidden = right_idxs if wp.x >= 0.0 else left_idxs
        bad_groups = [g for g in v.groups if g.group in forbidden and g.weight > 0.0]
        if not bad_groups:
            continue
        fixed_verts += 1
        for g in bad_groups:
            vgroups[g.group].remove([v.index])
        kept = [(g.group, g.weight) for g in v.groups if g.group not in forbidden and g.weight > 0.0]
        total_w = sum(w for _, w in kept)
        if total_w > 1e-6:
            for gidx, w in kept:
                vgroups[gidx].add([v.index], w / total_w, "REPLACE")
        elif "hips" in vgroups:
            vgroups["hips"].add([v.index], 1.0, "REPLACE")
    return fixed_verts

def bind_gaussian_envelope_weights(mesh_obj, arm_obj, total_height):
    """Clean-Room smooth Gaussian segment weight solver + vest thigh-bleed sanitizer + L/R leg X-sign separation."""
    bones = [(b.name, arm_obj.matrix_world @ b.head_local, arm_obj.matrix_world @ b.tail_local) for b in arm_obj.data.bones]
    if not bones:
        return 0
    vgroups = mesh_obj.vertex_groups
    for bname, _, _ in bones:
        if bname not in vgroups:
            vgroups.new(name=bname)

    is_upper_garment = mesh_obj.get("charakuru_tex_group") == "UpperBody"
    is_head_mesh = mesh_obj.get("charakuru_tex_group") in ("Head", "Hair")
    waist_cutoff_z = total_height * VEST_CUTOFF_RATIO
    sigma = max(0.035, total_height * 0.055)
    purged_bleed_verts = 0

    for v in mesh_obj.data.vertices:
        wp = mesh_obj.matrix_world @ v.co
        if is_head_mesh:
            head_bone = "head" if "head" in vgroups else bones[0][0]
            vgroups[head_bone].add([v.index], 1.0, "REPLACE")
            continue

        raw_w = []
        for bname, bh, bt in bones:
            if bname in NON_DEFORM_EYE_BONES:
                continue
            # Enforce strict left/right leg X-sign separation so L/R thighs/calves never cross-talk
            if wp.x >= 0.0 and bname in RIGHT_LEG_BONES:
                continue
            if wp.x < 0.0 and bname in LEFT_LEG_BONES:
                continue
            # Prevent upper-body blazers/vests above waist cutoff from picking up 50-90% thigh weights
            if is_upper_garment and wp.z > waist_cutoff_z and ("Leg" in bname or "Foot" in bname or "Toes" in bname):
                purged_bleed_verts += 1
                continue
            d = point_segment_dist(wp, bh, bt)
            w = math.exp(-(d * d) / (2.0 * sigma * sigma))
            if w > 1e-4:
                raw_w.append((bname, w))

        if not raw_w:
            side_candidates = [
                b for b in bones
                if b[0] not in NON_DEFORM_EYE_BONES
                and not (wp.x >= 0.0 and b[0] in RIGHT_LEG_BONES)
                and not (wp.x < 0.0 and b[0] in LEFT_LEG_BONES)
            ] or bones
            nearest = min(side_candidates, key=lambda b: point_segment_dist(wp, b[1], b[2]))
            raw_w = [(nearest[0], 1.0)]
        raw_w.sort(key=lambda x: x[1], reverse=True)
        top4 = raw_w[:4]
        s = sum(w for _, w in top4) or 1.0
        for bname, w in top4:
            vgroups[bname].add([v.index], w / s, "REPLACE")

    has_arm_mod = any(m.type == "ARMATURE" for m in mesh_obj.modifiers)
    if not has_arm_mod:
        mod = mesh_obj.modifiers.new(name="VRM_Armature", type="ARMATURE")
        mod.object = arm_obj
    mesh_obj.parent = arm_obj
    return purged_bleed_verts

def main():
    vrm_mod = enable_vrm_addon_safely()
    open_required_blend(INPUT_BLEND)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    max_z = max((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box) if meshes else 1.58
    min_z = min((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box) if meshes else 0.0
    if min_z < -0.001 or abs(min_z) > 0.01:
        raise RuntimeError("Rig draft expects grounded mesh near Z=0; complete assembly first")
    total_h = max(0.5, max_z - min_z)

    arm_obj, pinky_fixes, created_procedural = ensure_cleanroom_armature(total_h)
    ext = arm_obj.data.vrm_addon_extension
    ext.spec_version = "1.0"
    import re
    for bone_name, _, _, _ in HUMANOID_SPEC:
        if bone_name not in arm_obj.data.bones:
            continue
        attr = re.sub(r"(?<!^)(?=[A-Z])", "_", bone_name).lower()
        slot = getattr(ext.vrm1.humanoid.human_bones, attr, None)
        if slot is not None:
            slot.node.bone_name = bone_name
    total_purged = 0
    leg_crosstalk_fixed = 0
    for m in meshes:
        if created_procedural or not m.vertex_groups:
            total_purged += bind_gaussian_envelope_weights(m, arm_obj, total_h)
        leg_crosstalk_fixed += enforce_leg_x_sign_separation(m)

    ensure_parent_dir(OUTPUT_BLEND)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    result = {
        "verdict": "degraded",
        "honestLimits": ["Heuristic draft; companion audit and visual/animation review remain required"],
        "stage": "03_cleanroom_humanoid_rig_weights",
        "vrmAddonModule": vrm_mod,
        "armatureName": arm_obj.name,
        "proceduralSkeletonGenerated": created_procedural,
        "mixamoPinkyFixes": pinky_fixes,
        "vestThighBleedPurgedCount": total_purged,
        "legCrosstalkFixedCount": leg_crosstalk_fixed,
        "weightedMeshCount": len(meshes),
        "savedBlend": OUTPUT_BLEND,
    }
    emit_headless(result)
    return result

try:
    LAST_RESULT = main()
except Exception as exc:
    emit_headless({"verdict": "fail", "error": str(exc)})
    raise
`;
}

export function generateStage4SkirtSpringPhysicsScript({
  inputBlendPath,
  outputBlendPath,
  skirtChains = 16,
  frontAnchorDeg = 30.0,
  thighColliderRadius = 0.082,
  minSkirtClearanceM = 0.018,
}) {
  if (!Number.isInteger(skirtChains)) throw new Error("skirtChains must be an integer");
  return `${VRM_PREAMBLE_PY}
INPUT_BLEND = ${JSON.stringify(inputBlendPath)}
OUTPUT_BLEND = ${JSON.stringify(outputBlendPath)}
SKIRT_CHAINS = int(${finite(skirtChains, "skirtChains")})
FRONT_ANCHOR_DEG = float(${finite(frontAnchorDeg, "frontAnchorDeg")})
THIGH_RADIUS = float(${finite(thighColliderRadius, "thighColliderRadius")})
MIN_CLEARANCE = float(${finite(minSkirtClearanceM, "minSkirtClearanceM")})

def build_radial_skirt_spring_bones(arm_obj, skirt_meshes):
    """Create 16 radial skirt SpringBone chains around Hips with +-30 deg front waist stiffening."""
    if not skirt_meshes:
        return []
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for m in skirt_meshes:
        for c in m.bound_box:
            w = m.matrix_world @ Vector(c)
            mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
            maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))

    radius_xy = max(0.11, 0.5 * max(maxs.x - mins.x, maxs.y - mins.y))
    top_z = maxs.z - 0.02
    bot_z = mins.z + 0.01

    with armature_edit_mode(arm_obj) as ebones:
        hips = ebones.get("hips")
        created_chains = []

        for i in range(SKIRT_CHAINS):
            angle = (2.0 * math.pi * i) / SKIRT_CHAINS
            # Blender front is -Y: vector (sin(angle), -cos(angle)) has angle 0 at -Y front (0, -1)
            deg = abs(math.degrees(math.atan2(math.sin(angle), math.cos(angle))))
            is_front_anchor = deg <= FRONT_ANCHOR_DEG
            stiffness = 1.85 if is_front_anchor else 0.75
            drag = 0.55 if is_front_anchor else 0.35

            x0 = math.sin(angle) * (radius_xy * 0.72)
            y0 = -math.cos(angle) * (radius_xy * 0.72)
            x1 = math.sin(angle) * (radius_xy + MIN_CLEARANCE)
            y1 = -math.cos(angle) * (radius_xy + MIN_CLEARANCE)
            mid_z = 0.5 * (top_z + bot_z)

            b1_name = f"skirt_spring_{i:02d}_01"
            b2_name = f"skirt_spring_{i:02d}_02"
            for existing_n in (b1_name, b2_name):
                if existing_n in ebones:
                    ebones.remove(ebones[existing_n])

            b1 = ebones.new(b1_name)
            b1.head = Vector((x0, y0, top_z))
            b1.tail = Vector((0.5 * (x0 + x1), 0.5 * (y0 + y1), mid_z))
            if hips:
                b1.parent = hips

            b2 = ebones.new(b2_name)
            b2.head = b1.tail.copy()
            b2.tail = Vector((x1, y1, bot_z))
            b2.parent = b1

            created_chains.append({
                "chainIndex": i,
                "rootBone": b1_name,
                "tipBone": b2_name,
                "frontAnchored": is_front_anchor,
                "stiffness": stiffness,
                "dragForce": drag,
            })

    return created_chains

def discover_hair_spring_chains(arm_obj):
    """Discover existing hair bone chains (root -> children) on the armature for VRM 1.0 spring wiring."""
    hair_tokens = ("hair", "bang", "ponytail", "twintail", "ahoge", "sidetail", "backhair")
    def is_hair_bone(bone):
        low = bone.name.lower()
        return not low.startswith("skirt_spring_") and any(tok in low for tok in hair_tokens)

    hair_bones = [b for b in arm_obj.data.bones if is_hair_bone(b)]
    hair_set = {b.name for b in hair_bones}
    roots = [b for b in hair_bones if b.parent is None or b.parent.name not in hair_set]
    hair_chains = []
    for root in roots:
        chain = [root.name]
        cur = root
        while cur.children:
            next_child = next((c for c in cur.children if c.name in hair_set), None)
            if next_child is None:
                break
            chain.append(next_child.name)
            cur = next_child
        if len(chain) >= 2:
            hair_chains.append(chain)
    return hair_chains

def configure_vrm1_spring_extension(arm_obj, chains, hair_chains=None):
    import uuid
    ext = getattr(arm_obj.data, "vrm_addon_extension", None)
    sb = getattr(ext, "spring_bone1", None) if ext is not None else None
    if ext is None or sb is None:
        return {"boundToVrmExtension": False, "chainsConfigured": 0, "reason": "VRM 1.0 spring_bone1 extension unavailable"}

    ext.spec_version = "1.0"
    collider_group_name = "CHR_Body_Colliders"
    collider_group = next((cg for cg in sb.collider_groups if cg.vrm_name == collider_group_name), None)
    if collider_group is None:
        collider_group = sb.collider_groups.add()
        collider_group.uuid = uuid.uuid4().hex
        collider_group.vrm_name = collider_group_name

    def add_body_collider(bone_name, shape_type, radius):
        bone = arm_obj.data.bones.get(bone_name)
        if bone is None:
            return False
        for ref in collider_group.colliders:
            existing = next((c for c in sb.colliders if c.uuid == ref.collider_uuid), None)
            if existing is not None and existing.node.bone_name == bone.name:
                return False
        collider = sb.colliders.add()
        collider.uuid = uuid.uuid4().hex
        collider.node.bone_name = bone.name
        set_enum_safely(collider, "shape_type", shape_type, (shape_type.upper(),))
        if hasattr(collider, "reset_bpy_object"):
            collider.reset_bpy_object(bpy.context, arm_obj)
        if shape_type == "Capsule":
            cap_len = max(0.01, ((arm_obj.matrix_world @ bone.tail_local) - (arm_obj.matrix_world @ bone.head_local)).length)
            collider.shape.capsule.offset = (0.0, 0.0, 0.0)
            collider.shape.capsule.tail = (0.0, cap_len, 0.0)
            collider.shape.capsule.radius = float(radius)
        else:
            collider.shape.sphere.offset = (0.0, 0.0, 0.0)
            collider.shape.sphere.radius = float(radius)
        ref = collider_group.colliders.add()
        ref.collider_uuid = collider.uuid
        return True

    body_collider_specs = [
        ("hips", "Sphere", THIGH_RADIUS * 1.35),
        ("spine", "Capsule", THIGH_RADIUS * 1.15),
        ("chest", "Capsule", THIGH_RADIUS * 1.25),
        ("upperChest", "Capsule", THIGH_RADIUS * 1.20),
        ("head", "Sphere", THIGH_RADIUS * 1.25),
        ("leftShoulder", "Capsule", THIGH_RADIUS * 0.65),
        ("rightShoulder", "Capsule", THIGH_RADIUS * 0.65),
        ("leftUpperLeg", "Capsule", THIGH_RADIUS + MIN_CLEARANCE),
        ("rightUpperLeg", "Capsule", THIGH_RADIUS + MIN_CLEARANCE),
        ("leftLowerLeg", "Capsule", THIGH_RADIUS * 0.72),
        ("rightLowerLeg", "Capsule", THIGH_RADIUS * 0.72),
    ]
    for bone_name, shape_type, radius in body_collider_specs:
        add_body_collider(bone_name, shape_type, radius)

    skirt_configured = 0
    for ch in chains:
        bone_names = [ch["rootBone"], ch["tipBone"]]
        if not all(bn in arm_obj.data.bones for bn in bone_names):
            continue
        spring = sb.springs.add()
        spring.vrm_name = f"CHR_Skirt_{ch['chainIndex']:02d}"
        if "hips" in arm_obj.data.bones and hasattr(spring, "center"):
            spring.center.bone_name = "hips"
        for bn in bone_names:
            joint = spring.joints.add()
            joint.node.bone_name = bn
            joint.hit_radius = float(MIN_CLEARANCE)
            joint.stiffness = float(ch["stiffness"])
            joint.drag_force = float(ch["dragForce"])
            joint.gravity_power = 0.15
            joint.gravity_dir = (0.0, 0.0, -1.0)
        if len(collider_group.colliders) > 0:
            spring.collider_groups.add().collider_group_uuid = collider_group.uuid
        skirt_configured += 1

    hair_list = list(hair_chains) if hair_chains is not None else discover_hair_spring_chains(arm_obj)
    hair_configured = 0
    for idx, bone_names in enumerate(hair_list):
        if len(bone_names) < 2 or not all(bn in arm_obj.data.bones for bn in bone_names):
            continue
        spring = sb.springs.add()
        spring.vrm_name = f"CHR_Hair_{idx:02d}"
        if "head" in arm_obj.data.bones and hasattr(spring, "center"):
            spring.center.bone_name = "head"
        for bn in bone_names:
            joint = spring.joints.add()
            joint.node.bone_name = bn
            joint.hit_radius = 0.015
            joint.stiffness = 0.9
            joint.drag_force = 0.45
            joint.gravity_power = 0.2
            joint.gravity_dir = (0.0, 0.0, -1.0)
        if len(collider_group.colliders) > 0:
            spring.collider_groups.add().collider_group_uuid = collider_group.uuid
        hair_configured += 1

    return {
        "boundToVrmExtension": (skirt_configured + hair_configured) > 0,
        "chainsConfigured": skirt_configured + hair_configured,
        "skirtChainsConfigured": skirt_configured,
        "hairChainsConfigured": hair_configured,
        "colliderGroupName": collider_group.vrm_name,
        "colliderGroupUuid": collider_group.uuid,
        "colliderCount": len(collider_group.colliders),
    }

def main():
    vrm_mod = enable_vrm_addon_safely()
    open_required_blend(INPUT_BLEND)

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No Armature found in scene. Run Stage 3 rig script first.")
    arm_obj = arms[0]

    skirt_meshes = [
        o for o in bpy.data.objects
        if o.type == "MESH" and (o.get("charakuru_garment") == "skirt" or "skirt" in o.name.lower())
    ]
    if len(arms) != 1 or not skirt_meshes:
        raise RuntimeError("Select exactly one armature and explicitly tagged/named skirt meshes")
    if any(not all(abs(v - x) < 1e-6 for v, x in zip(row, expected)) for row, expected in zip(arm_obj.matrix_world, Matrix.Identity(4))):
        raise RuntimeError("Skirt bone draft expects identity armature transform")
    if any(b.name.startswith("skirt_spring_") for b in arm_obj.data.bones):
        raise RuntimeError("Skirt draft already exists; review it instead of overwriting bound bones")
    chains = build_radial_skirt_spring_bones(arm_obj, skirt_meshes)
    vrm_bind = configure_vrm1_spring_extension(arm_obj, chains)

    ensure_parent_dir(OUTPUT_BLEND)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    result = {
        "verdict": "degraded",
        "honestLimits": ["Heuristic draft; companion audit and visual/animation review remain required"],
        "stage": "04_skirt_hair_spring_colliders",
        "vrmAddonModule": vrm_mod,
        "skirtChainCount": len(chains),
        "frontWaistAnchoredCount": sum(1 for c in chains if c["frontAnchored"]),
        "thighColliderRadiusM": round(THIGH_RADIUS + MIN_CLEARANCE, 4),
        "vrmSpringExtension": vrm_bind,
        "savedBlend": OUTPUT_BLEND,
    }
    emit_headless(result)
    return result

try:
    LAST_RESULT = main()
except Exception as exc:
    emit_headless({"verdict": "fail", "error": str(exc)})
    raise
`;
}

export function generateStage5ClosedMeshExpressionsVrmScript({
  inputBlendPath,
  outputBlendPath,
  outputVrmPath,
  vrmMeta = {},
}) {
  return `${VRM_PREAMBLE_PY}
INPUT_BLEND = ${JSON.stringify(inputBlendPath)}
OUTPUT_BLEND = ${JSON.stringify(outputBlendPath)}
OUTPUT_VRM = ${JSON.stringify(outputVrmPath)}
VRM_META = json.loads(${JSON.stringify(JSON.stringify(vrmMeta || {}))})

# 23 Clean-Room Parametric Facial Morphs for Closed Tripo Facial Meshes (8 eye + 5 brow + 10 mouth)
EYE_MORPHS = [
    "eye_blink_L", "eye_blink_R", "eye_happy_L", "eye_happy_R",
    "eye_wide_L", "eye_wide_R", "eye_half_L", "eye_half_R",
]
BROW_MORPHS = [
    "brow_up", "brow_down_angry", "brow_sad", "brow_surprised", "brow_relaxed",
]
MOUTH_MORPHS = [
    "mouth_aa", "mouth_ih", "mouth_ou", "mouth_ee", "mouth_oh",
    "mouth_smile", "mouth_frown", "mouth_smirk", "mouth_triangle", "mouth_cat",
]

def _isolate_face_vertices(head_obj, verts):
    """Isolate face/skull vertices from long hair vertices using vertex groups, materials, and crown-Z core."""
    hair_tokens = ("hair", "bang", "ponytail", "twintail", "ahoge", "ribbon", "acc")
    hair_vert_indices = set()

    hair_vg_indices = {
        vg.index for vg in head_obj.vertex_groups
        if any(tok in vg.name.lower() for tok in hair_tokens)
    }
    if hair_vg_indices:
        for v in verts:
            if any(g.group in hair_vg_indices and g.weight > 0.1 for g in v.groups):
                hair_vert_indices.add(v.index)

    hair_mat_indices = {
        idx for idx, slot in enumerate(head_obj.material_slots)
        if slot.material and any(tok in slot.material.name.lower() for tok in hair_tokens)
    }
    if hair_mat_indices and len(head_obj.data.polygons) > 0:
        non_hair_mat_verts = set()
        hair_only_mat_verts = set()
        for poly in head_obj.data.polygons:
            target_set = hair_only_mat_verts if poly.material_index in hair_mat_indices else non_hair_mat_verts
            for vi in poly.vertices:
                target_set.add(vi)
        hair_vert_indices.update(hair_only_mat_verts - non_hair_mat_verts)

    face_candidates = [v for v in verts if v.index not in hair_vert_indices]
    if len(face_candidates) < 16:
        face_candidates = list(verts)
        hair_vert_indices = set()

    w_zs = [(head_obj.matrix_world @ v.co).z for v in face_candidates]
    w_crown_z = max(w_zs)
    w_min_z = min(w_zs)
    if (w_crown_z - w_min_z) > 0.34:
        core = [v for v, wz in zip(face_candidates, w_zs) if wz >= w_crown_z - 0.28]
        if len(core) < 16:
            core = [v for v, wz in zip(face_candidates, w_zs) if wz >= w_crown_z - 0.42 * (w_crown_z - w_min_z)]
        if len(core) >= 16:
            face_candidates = core

    ys = [v.co.y for v in face_candidates]
    zs = [v.co.z for v in face_candidates]
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    front_core = [v for v in face_candidates if v.co.y <= min_y + 0.55 * max(1e-4, max_y - min_y)]
    x_source = front_core if len(front_core) >= 12 else face_candidates
    xs = [v.co.x for v in x_source]
    min_x, max_x = min(xs), max(xs)
    return min_x, max_x, min_y, max_y, min_z, max_z, hair_vert_indices

def build_closed_mesh_23_shapekeys(head_obj):
    if head_obj.type != "MESH":
        return []
    mesh = head_obj.data
    if mesh.shape_keys is None:
        head_obj.shape_key_add(name="Basis", from_mix=False)

    verts = mesh.vertices
    if not verts:
        return []

    min_x, max_x, min_y, max_y, min_z, max_z, hair_vert_indices = _isolate_face_vertices(head_obj, verts)
    w = max(1e-4, max_x - min_x)
    h = max(1e-4, max_z - min_z)
    front_y = min_y  # Blender -Y forward convention
    face_cutoff_z = min_z - 0.015

    all_names = EYE_MORPHS + BROW_MORPHS + MOUTH_MORPHS
    basis_key = mesh.shape_keys.key_blocks[0]
    existing = set(mesh.shape_keys.key_blocks.keys())
    created = []

    for morph_name in all_names:
        if morph_name in existing:
            kb = mesh.shape_keys.key_blocks[morph_name]
        else:
            kb = head_obj.shape_key_add(name=morph_name, from_mix=False)
        kb.relative_key = basis_key
        created.append(morph_name)

        for idx, v in enumerate(verts):
            basis_co = basis_key.data[idx].co
            kb.data[idx].co = basis_co.copy()
            if v.index in hair_vert_indices or basis_co.z < face_cutoff_z:
                continue
            nx = (basis_co.x - 0.5 * (min_x + max_x)) / (0.5 * w)
            nz = (basis_co.z - min_z) / h
            front_mask = max(0.0, 1.0 - abs(basis_co.y - front_y) / max(1e-4, 0.42 * (max_y - min_y)))
            if front_mask <= 0.0:
                continue

            delta = Vector((0.0, 0.0, 0.0))
            if morph_name.startswith("eye_"):
                is_left = morph_name.endswith("_L")
                eye_cx = 0.30 if is_left else -0.30
                eye_cz = 0.48
                falloff = math.exp(-(((nx - eye_cx) / 0.18) ** 2 + ((nz - eye_cz) / 0.09) ** 2)) * front_mask
                if "blink" in morph_name:
                    delta.z = -0.012 * h * falloff
                    delta.y = 0.003 * h * falloff
                elif "happy" in morph_name:
                    delta.z = 0.010 * h * falloff
                elif "wide" in morph_name:
                    delta.z = 0.008 * h * falloff * (1.0 if nz >= eye_cz else -1.0)
                elif "half" in morph_name:
                    delta.z = -0.006 * h * falloff
            elif morph_name.startswith("brow_"):
                brow_cz = 0.59
                falloff = math.exp(-(((abs(nx) - 0.28) / 0.22) ** 2 + ((nz - brow_cz) / 0.07) ** 2)) * front_mask
                if morph_name in ("brow_up", "brow_surprised"):
                    delta.z = 0.011 * h * falloff
                elif morph_name == "brow_down_angry":
                    delta.z = -0.010 * h * falloff * (1.3 - abs(nx))
                elif morph_name == "brow_sad":
                    delta.z = 0.008 * h * falloff * (0.4 - abs(nx))
                elif morph_name == "brow_relaxed":
                    delta.z = -0.004 * h * falloff
            elif morph_name.startswith("mouth_"):
                mouth_cz = 0.24
                falloff = math.exp(-((nx / 0.20) ** 2 + ((nz - mouth_cz) / 0.08) ** 2)) * front_mask
                # Closed-mesh relief deformation: subtle inward recess + lip contour shift without tearing non-existent hole
                if morph_name == "mouth_aa":
                    delta.z = -0.014 * h * falloff * (1.0 if nz < mouth_cz else -0.3)
                    delta.y = 0.006 * h * falloff
                elif morph_name == "mouth_ih":
                    delta.x = 0.010 * w * (1.0 if nx >= 0 else -1.0) * falloff
                elif morph_name == "mouth_ou":
                    delta.x = -0.008 * w * (1.0 if nx >= 0 else -1.0) * falloff
                    delta.y = -0.005 * h * falloff
                elif morph_name == "mouth_ee":
                    delta.x = 0.012 * w * (1.0 if nx >= 0 else -1.0) * falloff
                    delta.z = -0.005 * h * falloff
                elif morph_name == "mouth_oh":
                    delta.z = -0.011 * h * falloff
                    delta.y = 0.005 * h * falloff
                elif morph_name == "mouth_smile":
                    delta.z = 0.009 * h * falloff * abs(nx)
                elif morph_name == "mouth_frown":
                    delta.z = -0.008 * h * falloff * abs(nx)
                else:
                    delta.z = 0.005 * h * falloff

            kb.data[idx].co = basis_co + delta

    return created

def bind_vrm1_expressions_and_meta(arm_obj, head_obj):
    ext = getattr(arm_obj.data, "vrm_addon_extension", None)
    if ext is None:
        return {"bound": False, "reason": "vrm_addon_extension unavailable"}
    try:
        ext.spec_version = "1.0"
        meta = ext.vrm1.meta
        meta.vrm_name = str(VRM_META.get("title") or "CharakuruStudioAvatar")
        meta.version = str(VRM_META.get("version") or "1.0.0")
        for field in ("commercial_usage", "avatar_permission", "allow_excessively_violent_usage", "allow_excessively_sexual_usage", "allow_political_or_religious_usage", "allow_antisocial_or_hate_usage", "credit_notation", "allow_redistribution", "modification"):
            camel = field.split("_")[0] + "".join(p.title() for p in field.split("_")[1:])
            if camel in VRM_META:
                set_enum_safely(meta, field, VRM_META[camel])
        authors = VRM_META.get("authors") or ["Charakuru Studio Creator"]
        while len(meta.authors) > 0:
            meta.authors.remove(0)
        for a in authors:
            item = meta.authors.add()
            item.value = str(a)

        preset = ext.vrm1.expressions.preset
        bind_map = [
            (preset.blink_left, [("eye_blink_L", 1.0)], "none"),
            (preset.blink_right, [("eye_blink_R", 1.0)], "none"),
            (preset.blink, [("eye_blink_L", 1.0), ("eye_blink_R", 1.0)], "none"),
            (preset.aa, [("mouth_aa", 1.0)], "none"),
            (preset.ih, [("mouth_ih", 1.0)], "none"),
            (preset.ou, [("mouth_ou", 1.0)], "none"),
            (preset.ee, [("mouth_ee", 1.0)], "none"),
            (preset.oh, [("mouth_oh", 1.0)], "none"),
            (preset.happy, [("eye_happy_L", 1.0), ("eye_happy_R", 1.0), ("mouth_smile", 1.0)], "block"),
            (preset.angry, [("brow_down_angry", 1.0), ("eye_half_L", 0.35), ("eye_half_R", 0.35), ("mouth_frown", 0.65)], "none"),
            (preset.sad, [("brow_sad", 1.0), ("eye_half_L", 0.40), ("eye_half_R", 0.40), ("mouth_frown", 0.60)], "none"),
            (preset.relaxed, [("brow_relaxed", 1.0), ("eye_half_L", 0.65), ("eye_half_R", 0.65), ("mouth_smirk", 0.35)], "none"),
            (preset.surprised, [("brow_surprised", 1.0), ("brow_up", 0.80), ("eye_wide_L", 1.0), ("eye_wide_R", 1.0), ("mouth_oh", 0.50)], "block"),
        ]
        bound_count = 0
        bound_shape_keys = set()
        for expr_slot, binds, blink_override in bind_map:
            while len(expr_slot.morph_target_binds) > 0:
                expr_slot.morph_target_binds.remove(0)
            for sk_name, weight in binds:
                b = expr_slot.morph_target_binds.add()
                b.node.mesh_object_name = head_obj.name
                b.index = sk_name
                b.weight = float(weight)
                bound_shape_keys.add(sk_name)
            set_enum_safely(expr_slot, "override_blink", blink_override, (blink_override.upper(),))
            bound_count += 1

        # Bind remaining expressive mouth/brow/eye custom expressions so all 23 shape keys are bound
        custom_specs = [
            ("triangle", [("mouth_triangle", 1.0)]),
            ("cat", [("mouth_cat", 1.0)]),
            ("smirk", [("mouth_smirk", 1.0)]),
            ("brow_up", [("brow_up", 1.0)]),
            ("eye_wide", [("eye_wide_L", 1.0), ("eye_wide_R", 1.0)]),
            ("eye_half", [("eye_half_L", 1.0), ("eye_half_R", 1.0)]),
        ]
        custom_coll = ext.vrm1.expressions.custom
        while len(custom_coll) > 0:
            custom_coll.remove(0)
        custom_count = 0
        for custom_name, binds in custom_specs:
            c_slot = custom_coll.add()
            if hasattr(c_slot, "custom_name"):
                c_slot.custom_name = custom_name
            elif hasattr(c_slot, "name"):
                c_slot.name = custom_name
            for sk_name, weight in binds:
                b = c_slot.morph_target_binds.add()
                b.node.mesh_object_name = head_obj.name
                b.index = sk_name
                b.weight = float(weight)
                bound_shape_keys.add(sk_name)
            custom_count += 1

        return {
            "bound": True,
            "boundPresetCount": bound_count,
            "boundCustomCount": custom_count,
            "boundShapeKeyCount": len(bound_shape_keys),
            "boundShapeKeys": sorted(bound_shape_keys),
        }
    except Exception as exc:
        return {"bound": False, "reason": str(exc)}

def main():
    vrm_mod = enable_vrm_addon_safely()
    open_required_blend(INPUT_BLEND)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    head_candidates = [
        o for o in meshes
        if o.get("charakuru_tex_group") == "Head"
        or (o.get("charakuru_tex_group") != "Hair" and is_head_mesh_candidate(o, include_face=True))
    ]
    if len(head_candidates) != 1:
        raise RuntimeError("Expression draft requires exactly one explicitly tagged head mesh")
    head_obj = head_candidates[0]
    if head_obj is None:
        raise RuntimeError("No head mesh found to author 23 expressions")

    created_morphs = build_closed_mesh_23_shapekeys(head_obj)
    basis = head_obj.data.shape_keys.key_blocks[0]
    deltas = {name: max(((p.co - basis.data[i].co).length for i, p in enumerate(head_obj.data.shape_keys.key_blocks[name].data)), default=0.0) for name in created_morphs}
    zero_morphs = [name for name, delta in deltas.items() if delta < 1e-7]
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    vrm_bind = bind_vrm1_expressions_and_meta(arms[0], head_obj) if arms else {"bound": False, "reason": "No armature"}

    ensure_parent_dir(OUTPUT_BLEND)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)

    vrm_exported = False
    vrm_export_error = None
    import uuid
    temp_vrm = OUTPUT_VRM + "." + uuid.uuid4().hex + ".vrm"
    if OUTPUT_VRM and hasattr(bpy.ops.export_scene, "vrm"):
        try:
            ensure_parent_dir(OUTPUT_VRM)
            if len(arms) != 1 or not vrm_bind.get("bound") or zero_morphs:
                raise RuntimeError("Export requires one mapped armature, expression binding and nonzero morphs")
            status = bpy.ops.export_scene.vrm(filepath=temp_vrm, armature_object_name=arms[0].name)
            if "FINISHED" not in status or not os.path.isfile(temp_vrm) or os.path.getsize(temp_vrm) < 20:
                raise RuntimeError("VRM exporter did not finish with a new artifact")
            os.replace(temp_vrm, OUTPUT_VRM)
            vrm_exported = True
        except Exception as exc:
            vrm_export_error = str(exc)
        finally:
            if os.path.exists(temp_vrm):
                os.remove(temp_vrm)

    result = {
        "verdict": "degraded" if vrm_exported else "fail",
        "morphMaxDisplacements": deltas,
        "zeroMorphs": zero_morphs,
        "honestLimits": ["Heuristic deformation; topology, expression appearance and animation require separate companion gates and human review"],
        "stage": "05_closed_mesh_23_expressions_vrm1",
        "vrmAddonModule": vrm_mod,
        "headObject": head_obj.name,
        "createdMorphCount": len(created_morphs),
        "morphBreakdown": {
            "eye": len(EYE_MORPHS),
            "brow": len(BROW_MORPHS),
            "mouth": len(MOUTH_MORPHS),
        },
        "vrmExpressionBinding": vrm_bind,
        "savedBlend": OUTPUT_BLEND,
        "vrmExported": vrm_exported,
        "outputVrmPath": OUTPUT_VRM if vrm_exported else None,
        "vrmExportError": vrm_export_error,
    }
    emit_headless(result)
    return result

try:
    LAST_RESULT = main()
except Exception as exc:
    emit_headless({"verdict": "fail", "error": str(exc)})
    raise
`;
}

