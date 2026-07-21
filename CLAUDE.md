# CodeCity

A repo rendered as a 3D city. Building = file (height = √lines, footprint ∝ bytes^0.72), district = folder, glowing windows = high-churn files (≥ p90 commits).

## Pipeline

```
node analyze.mjs <repoPath>   # walks repo + git log → city.json (layout baked in)
python3 -m http.server 8137   # then open http://localhost:8137
```

The renderer never touches git or the filesystem — everything it needs is baked into `city.json` by the analyzer, including the treemap layout. Keep that boundary.

## Files

- `analyze.mjs` — stdlib-only Node script: fs walk, squarified treemap, one-pass `git log` enrichment (commits + age per file). Self-test: `node analyze.mjs --check` — must pass after any analyzer change, then regenerate city.json.
- `index.html` — the entire renderer. Three.js + GSAP from CDN via importmap. No npm, no bundler, no build step — keep it that way.

## Rules

- Buildings and district plates are ALWAYS `InstancedMesh` — never one Mesh per building, no matter the feature.
- Layout math lives in the analyzer, not the renderer.
- No new dependencies for anything a few lines can do; anything added must come from the importmap CDN.
- Selective glow is done with two InstancedMeshes (hot/cold materials), not per-instance emissive — per-instance emissive doesn't exist in MeshStandardMaterial.
- Thresholds (glow, hot) are relative to the analyzed repo (percentiles), never absolute constants — repos vary too much.
- Commit after every working feature.
