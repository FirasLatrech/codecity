# CodeCity

A repo rendered as a 3D city you drive through. Building = file (height = √lines, footprint ∝ bytes^0.72), district = folder, glowing windows = high-churn files (≥ p90 commits). Drive-only: arcade car with chase cam, bottom card inspects the nearest building (lines/size/commits/age/co-authors), E opens the file in-city. Three cars (coupe/racer/truck, C or the button cycles), each with its own handling and synthesized engine voice. T = git-history timelapse: auto-orbit camera + scrubber, the city grows commit by commit (playback is activity-weighted, 15s full run). P = share card: cinematic 1600×900 PNG (city + stats + contributor faces + watermark) and an 8s WebM orbit clip where the city regrows (MediaRecorder, no deps). `?shot` renders a deterministic fixed-camera still for screenshot diffing; `?nobloom` skips post-processing.

## Pipeline

```
npm install                       # once
npm run dev                       # vite on http://localhost:8137
```

Routing: `/` is a landing page that takes a GitHub URL; submitting hits `GET /analyze?url=` (middleware in `vite.config.js`) which clones into `.cache/<owner>__<repo>` (cached forever — delete to re-pull), runs the analyzer, bakes `public/cities/<repo>.json`, and the page navigates to `/<repo>`. `/<name>` loads `/cities/<name>.json` and drives it; unknown names bounce back to the landing page. Local repos skip the server: `node analyze.mjs <repoPath>` bakes the same file, then open `/<name>`.

AI city plan (optional): if `GROQ_API_KEY` is set when the dev server runs, `/analyze` also asks Groq (llama-3.3-70b) to pick 4–6 landmark files + a city motto from a stats digest; baked as `city.plan`, rendered as floating golden signs + a motto at the gate. No key, any failure, or a big city (> 1500 buildings) → `plan: null`, city renders normally. The key stays server-side.

Big-repo limits (all ponytail ceilings, raise if needed): cities keep only the ~3500 biggest files (smallest pruned before layout), git history parsing caps at the 50k most recent commits, line counting is a single byte-scan (no utf8 decode), clones are `--single-branch --no-tags`, avatar API pages fetch in parallel.

The renderer never touches git or the filesystem — everything it needs is baked into the city JSON by the analyzer, including the treemap layout. Keep that boundary. Server-side pieces live only in `vite.config.js`: `/analyze` (validated owner/repo, execFile — never a shell) and `/raw?repo=&p=` (file contents for the in-city reader, whitelisted against the baked city).

## Files

- `analyze.mjs` — stdlib-only Node module: fs walk, squarified treemap, one-pass `git log` enrichment (commits + age + top-3 authors with avatar URLs per file; author identities merged across emails; timelapse data: per-building `born` + 32-bucket commit histogram `g` + `city.timeline`). Exports `analyze(repoPath, name?, emailAvatars?)` for the server; CLI bakes `public/cities/<name>.json`. No shebang — esbuild bundles it into the vite config and chokes on mid-bundle shebangs. Self-test: `node analyze.mjs --check` — must pass after any analyzer change, then rebake.
- `index.html` — markup shell only (incl. the landing modal); the renderer lives in `src/`.
- `src/main.js` — entry: scene bootstrap, input, car switching, inspection card, file viewer, loop.
- `src/city.js` — city geometry from city.json (plates, buildings, beacons, labels, trees) + `setCityTime(sec)` time-scrub (instance matrices only, no rebuild).
- `src/share.js` — pure share-card composer (2D canvas over the WebGL frame).
- `src/game.js` — coin-run game mode (G / left play button): 40 instanced coins on the plates, 5 hearts, hard crashes cost one (1.2s grace, `rig.hit` flag set in car.js), 0 = wrecked, all coins = win. Flat repos fall back to the root plate for coin placement.
- `src/car.js` — the CARS garage (body build + handling spec + engine profile per car), arcade physics, chase cam.
- `src/faces.js` — author face sprites (drawn fallback, avatar swaps in on load).
- `src/audio.js` — synthesized engine/thump/chime, no audio files. Engine = osc pair → waveshaper growl → lowpass, pitched by a virtual gearbox (RPM climbs per gear, drops ~30% on shifts) + speed² wind-noise bed; all character comes from the per-car profile in `CARS`.
- `vite.config.js` — dev/preview server on 8137 + the `/analyze` and `/raw` endpoints.

## Rules

- Buildings and district plates are ALWAYS `InstancedMesh` — never one Mesh per building, no matter the feature.
- Layout math lives in the analyzer, not the renderer.
- Dependencies stay exactly: three, vite. No new ones for anything a few lines can do.
- New car = one entry in `CARS` (build fn + spec + engine profile). No car logic anywhere else.
- Selective glow is done with two InstancedMeshes (hot/cold materials), not per-instance emissive — per-instance emissive doesn't exist in MeshStandardMaterial.
- Thresholds (glow, hot) are relative to the analyzed repo (percentiles), never absolute constants — repos vary too much.
- Avatars: GitHub noreply emails → GitHub avatar URL, other emails → gravatar `d=404`, renderer falls back to the drawn cartoon face. All baked into city.json by the analyzer.
- Commit after every working feature.
