# Humanoid character assets

The models and animations are by **Quaternius** (https://quaternius.com). They're released under **CC0 1.0**, a public-domain dedication, so no attribution is legally required. We credit the author anyway.

- **Universal Base Characters**, Standard (free) tier. Includes the Superhero male and female bodies, eyes, eyebrows, hairstyles and beard. https://quaternius.itch.io/universal-base-characters
- **Universal Animation Library**, Standard (free) tier. We use the file without baked-in root motion, `UAL1_Standard.glb`. https://quaternius.itch.io/universal-animation-library

Downloaded on 2026-09-11. `scripts/build-humanoid-assets.mjs` converted the raw downloads into these files with the following changes:
- The skin base colour is swapped to the pack's "Light" texture so the game can tint it to any skin tone.
- Textures are resized and re-encoded as WebP.
- Meshes are quantised (`KHR_mesh_quantization`).
- Only the clips the game uses are kept.
- Scale tracks and non-root translation tracks are stripped from the clips.
