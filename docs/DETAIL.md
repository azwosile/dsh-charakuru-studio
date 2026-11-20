# Avatar Studio 0.10.0

A native DSH avatar workbench with two modeling routes (illustration rebuild and Route 2 base-mesh tailoring), organized into three primary workspaces (Workbench, Render Lab, Asset Library) plus a global Settings Drawer with adaptive light/dark theming and full English/Chinese localization. Experimental build `0.10.0` builds on `0.9.0`'s 25 structured Blender operations, 3D world-space tri-view planes, `Y=0` height ruler, built-in MIT/CC0 walk-cycle VRMA (`GET /studio/motions/builtin`), and agent-free VRM 1.0 metadata patching (`POST /studio/vrm/export-meta`), adding Blender 4.2 LTS / 5.x and Cycles outline/ShapeKey/VRM add-on compatibility hardening, Cordis 4 and loopback HTTP security guards, 3D viewport loading race fixes, Tripo OpenAPI terminal-state idempotency and timeout protection, and Qwen sampler parameter isolation.

**Experimental (internal verification build).** Structural checks, local Eevee/Cycles renders, and human visual approvals are recorded separately. Cloud billing is disabled by default, and no third-party proprietary models are distributed.

[Workbench Guide](WORKBENCH.md) · [Installation](INSTALL-WINDOWS.md) · [Operations](OPERATIONS.md) · [0.10.0 Verification Report](VERIFICATION-0.10.0.md)
