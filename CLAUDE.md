# CodeCity

A repo rendered as a 3D city you drive through. Building = file (height = √lines, footprint ∝ bytes^0.72), district = folder, glowing windows = high-churn files (≥ p90 commits). Drive-only: arcade car with chase cam, bottom card inspects the nearest building (lines/size/commits/age/co-authors), E opens the file in-city. Three cars (coupe/racer/truck, C or the button cycles), each with its own handling and synthesized engine voice. `?shot` renders a deterministic fixed-camera still for screenshot diffing; `?nobloom` skips post-processing.

## Pipeline

```
npm install                       # once
node analyze.mjs <repoPath>       # walks repo + git log → public/city.json (layout baked in)
npm run dev                       # vite on http://localhost:8137
```

The renderer never touches git or the filesystem — everything it needs is baked into `public/city.json` by the analyzer, including the treemap layout. Keep that boundary. The one server-side piece is the `/raw?p=<path>` endpoint (a middleware plugin in `vite.config.js`) that serves file contents for the in-city reader, whitelisted against city.json paths.

## Files

- `analyze.mjs` — stdlib-only Node script: fs walk, squarified treemap, one-pass `git log` enrichment (commits + age + top-3 authors with avatar URLs per file; author identities merged across emails). Self-test: `node analyze.mjs --check` — must pass after any analyzer change, then regenerate city.json.
- `index.html` — markup shell only; the renderer lives in `src/`.
- `src/main.js` — entry: scene bootstrap, input, car switching, inspection card, file viewer, loop.
- `src/city.js` — static city geometry from city.json (plates, buildings, beacons, labels, trees).
- `src/car.js` — the CARS garage (body build + handling spec + engine profile per car), arcade physics, chase cam.
- `src/faces.js` — author face sprites (drawn fallback, avatar swaps in on load).
- `src/audio.js` — synthesized engine/thump/chime, no audio files; engine voice is a per-car profile.
- `vite.config.js` — dev/preview server on 8137 + the `/raw` endpoint.

## Rules

- Buildings and district plates are ALWAYS `InstancedMesh` — never one Mesh per building, no matter the feature.
- Layout math lives in the analyzer, not the renderer.
- Dependencies stay exactly: three, vite. No new ones for anything a few lines can do.
- New car = one entry in `CARS` (build fn + spec + engine profile). No car logic anywhere else.
- Selective glow is done with two InstancedMeshes (hot/cold materials), not per-instance emissive — per-instance emissive doesn't exist in MeshStandardMaterial.
- Thresholds (glow, hot) are relative to the analyzed repo (percentiles), never absolute constants — repos vary too much.
- Avatars: GitHub noreply emails → GitHub avatar URL, other emails → gravatar `d=404`, renderer falls back to the drawn cartoon face. All baked into city.json by the analyzer.
- Commit after every working feature.
