# Chili3D POC Boundary

This folder is the only integration point for the experimental Chili3D editor.

- Do not import Chili3D from `frontend/index.html`.
- Do not connect this POC to search, indexing, duplicate detection, tenant schema logic, or backend vector pipelines.
- Keep runtime files, if ever approved, under this folder so the integration can be removed cleanly.
- Chili3D is AGPL-3.0 at the time this POC was added, so do not vendor or deploy its runtime without a license decision.
- `ENABLE_CHILI3D_EDITOR` is intentionally false by default. When false, the main UI entry point is hidden and this page only renders a disabled notice.
