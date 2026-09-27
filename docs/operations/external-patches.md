# Golden Hour — External Patch Notes

> **Installation-specific and unverified:** This records a manual patch reportedly applied to one local ComfyUI installation on July 26, 2026. It is not part of this repository or required by the app. Before applying it, inspect the installed NVIDIA RTX Nodes version and check whether the fix is already present; reinstalling/updating the node may have removed or incorporated it.

Patch notes for dependencies outside this repository.

---

## 1. RTX Video Super Resolution — CUDA Context Init Fix

**Date:** 2026-07-26  
**File:** `<ComfyUI>/custom_nodes/Nvidia_RTX_Nodes_ComfyUI-main/__init__.py`  
**Repo:** [Comfy-Org/Nvidia_RTX_Nodes_ComfyUI](https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI)  
**Symptom:** `NvVFX_Load failed: The effect has not been properly initialized (code -12)`  
**When it happens:** Standalone upscale workflows (`LoadImage → RTXVideoSuperResolution → SaveImage`) fail because no prior node initializes CUDA. Full generation workflows work because `VAEDecode` initializes CUDA implicitly before RTX runs.

### Root Cause

`nvvfx.VideoSuperRes.load()` calls NVIDIA's `NvVFX_Load()`, which requires an active CUDA device context. When the node runs after `LoadImage` (which outputs a CPU tensor), PyTorch's CUDA subsystem hasn't been initialized yet → error `-12`.

The node's own `.cuda()` call would initialize CUDA, but it runs *after* `sr.load()` — too late.

### Patch

Add `torch.cuda.init()` before the `nvvfx.VideoSuperRes` context manager:

```diff
 selected_quality = quality_mapping.get(quality, nvvfx.effects.QualityLevel.HIGH)

+        # Ensure CUDA context is initialized before NvVFX_Load.
+        # When this node runs after LoadImage (CPU tensor), no CUDA context
+        # exists yet. NvVFX_Load requires an active CUDA device context,
+        # causing error -12 ("not properly initialized") without this.
+        if not torch.cuda.is_initialized():
+            torch.cuda.init()
+
         with nvvfx.VideoSuperRes(selected_quality) as sr:
             sr.output_width = output_width
             sr.output_height = output_height
             sr.load()
```

### How to re-apply

1. Open `<ComfyUI>/custom_nodes/Nvidia_RTX_Nodes_ComfyUI-main/__init__.py`
2. Find the `execute` method in class `RTXVideoSuperResolution`
3. Add the 3 lines (`if not torch.cuda.is_initialized(): torch.cuda.init()`) immediately before the `with nvvfx.VideoSuperRes(...)` block
4. Restart ComfyUI

### Notes

- Safe to call repeatedly — `torch.cuda.is_initialized()` short-circuits if already warm.
- Does not conflict with in-graph generation workflows (CUDA is already initialized by the time RTX runs).
- If the `Nvidia_RTX_Nodes_ComfyUI` custom node repo is updated/reinstalled, this patch will need to be re-applied.
- Duplicate node directory `comfyui_nvidia_rtx_nodes` has been removed to avoid conflict.
