# Golden Hour Roadmap

This roadmap lists the remaining features worth considering. Existing Gemini cost estimates and Magic Enhance are foundations for two of these ideas; they are not new features from scratch.

## Features to consider

### ComfyUI image-to-image (img2img)
Use a reference image as the starting point for local ComfyUI variations, with a configurable denoise strength. This would extend the existing reference-image workflow to native local generation.

### Prompt refactoring
Add a non-generative cleanup action that improves clarity by removing contradictions, repetition, filler, and ambiguity without changing the user's intent. Keep this distinct from Magic Enhance, which expands a prompt with additional descriptive detail.

### Gemini spending limit
Extend the existing live cost estimate and session counter with an optional user-configured spending cap. Define how the cap behaves for batches and partial failures before implementation; estimates should be clearly distinguished from actual billing.
