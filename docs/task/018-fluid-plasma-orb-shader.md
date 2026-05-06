# Task 018: Fluid Plasma Orb Shader

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 015 (landed), 008A (landed)
- Recommended Tier: `deep`

## Overview

Replace the current W.A.R.D orb with a custom GLSL shader that renders
a fluid, atmospheric "plasma energy ball" — the kind of orb that reads
as **alive** rather than a geometric mesh. The reference is BoltAI's
landing-page orb (browser-rendered, fluid, real-time). The bar is:
visibly less geometric than today's orb, visibly more alive, holding
60 fps on M-series Macs.

Today (post-task-015) the orb is an `IcosahedronGeometry` with an
iridescent `MeshPhysicalMaterial`, two atmosphere torus rings (purple
+ cyan), an additive corona mesh, and a 220-point starfield. The user
shared a screenshot showing it reads as "wireframe sphere with rings
around it" — the geometry leaks through. That look does not match the
fluid plasma feel BoltAI achieves with a shader on the same hardware.

This task swaps the rendering of the orb itself: keep the `WardOrb`
component, its props, and the `ward:speech` event-bus wiring from
015; throw out the rings, wireframe overlay, corona, and starfield;
and drive everything off a custom `THREE.ShaderMaterial` with bloom
post-processing.

## Requirements

### Visual goal

- Reads as **fluid energy** — gentle silhouette deformation, swirling
  internal currents, glowing rim, no visible polygon edges.
- Atmospheric — the orb has a translucent core, brighter rim, and a
  soft halo that bleeds into the dark background.
- Alive — colors shift slowly over time; the orb subtly modulates
  with TTS speech via the existing event bus.
- Stable identity — recognizable across palette changes; the **motion
  language** is the brand, the colors are decoration.
- Comparable in spirit to BoltAI's orb. Pixel-perfect matching is
  **not** the goal.

### Component contract (must not break)

The component signature stays the same so 015's wiring continues to
work:

```ts
type WardOrbProps = {
  pulseKey: number;       // bump to fire a click pulse
  intensity?: number;     // 0..1+, smoothed TTS reactivity
  palette?: string;       // named preset; "ai" stays the default alias for "plasma"
};

export function WardOrb({ pulseKey, intensity, palette }: WardOrbProps): JSX.Element;
```

`apps/ui/src/main.tsx` already drives `intensity` from a
`ward:speech` `CustomEvent` listener (see lines 1513-1532) and bumps
`pulseKey` on click. Both must keep working. No changes to call sites
are required.

### Geometry and material

- `IcosahedronGeometry(1.55, 32)` (subdivisions bumped from 18 → 32
  for smoother vertex displacement).
- Single `THREE.ShaderMaterial` with `transparent: true`,
  `depthWrite: false`, `blending: THREE.AdditiveBlending` (or
  `NormalBlending` if the additive accumulation produces a too-bright
  core; pick during implementation).
- Drop the two torus rings, the wireframe overlay, the corona mesh,
  and the dense 220-point starfield. If a starfield is wanted, render
  it at much lower density (≤ 60 points), far back, additive, so it
  does not compete with the orb.

### Vertex shader

- Apply 3D simplex noise displacement at the vertex's world position
  with a time-driven offset and an `uIntensity`-scaled amplitude.
- Recommended displacement amplitude: **0.04 unit** at rest, up to
  **0.10 unit** at full TTS intensity. Anything larger reads as a
  pulsing balloon, not a plasma orb.
- Recompute normals from the displaced position so lighting (or
  fragment-side normal-derived effects like Fresnel) stays correct.
- Carry `vWorldPos`, `vViewNormal`, and `vViewDir` to the fragment
  stage as varyings.

### Fragment shader

- View-direction Fresnel rim using `dot(normal, viewDir)`. Higher
  power on the rim, lower in the center. Mix the palette's accent
  color in at the rim and the palette's primary in the core.
- 2-3 octaves of fbm noise sampled in world space, advected over
  time using `uFlowDirection` (3D unit vector, slowly randomized
  each ~60 s to avoid an obvious loop). Use the noise to mix the
  palette's primary and secondary colors across the surface.
- Alpha boosted at the rim, lowered toward the center → the orb
  reads as a translucent shell with internal glow rather than a solid
  sphere.
- Emissive output (final RGB) scaled by `uIntensity` so TTS pulses
  brighten the whole shape.
- Optional: a thin "filament" mask using high-frequency ridged noise,
  intermittently revealed via a slow time function. Keep it subtle —
  filaments are spice, not the dish.

### Postprocessing

- `EffectComposer` from `three/examples/jsm/postprocessing/EffectComposer.js`.
- `RenderPass` for the scene.
- `UnrealBloomPass` from
  `three/examples/jsm/postprocessing/UnrealBloomPass.js`.
  Starting params: `threshold = 0.6`, `strength = 0.8`,
  `radius = 0.4`. Tune against the committed reference images during
  iteration; document the final values in Implementation Notes.
- Optional vignette pass to deepen the dark surrounding atmosphere.
  Skip if it's adding cost without obvious gain.
- Render path: replace the existing `renderer.render(scene, camera)`
  call with `composer.render()`. Keep the existing animation loop
  structure intact otherwise.

### Uniforms

| Uniform | Type | Driven by |
|---|---|---|
| `uTime` | `float` | clock advance per frame |
| `uIntensity` | `float` | smoothed `intensityRef.current` (TTS) |
| `uPaletteA` | `vec3` | preset primary |
| `uPaletteB` | `vec3` | preset secondary |
| `uPaletteC` | `vec3` | preset accent (rim) |
| `uHover` | `float` | smoothed pointer-active state |
| `uFlowDirection` | `vec3` | re-randomized every ~60 s |
| `uPulse` | `float` | the existing click-pulse decay (already in code) |

### Color palettes

Ship four named presets. The default stays the alias `"ai"` (=
`plasma`) so 015's existing `palette = "ai"` default keeps working
unchanged.

| Preset | Primary | Secondary | Accent | Mood |
|---|---|---|---|---|
| `plasma` *(default, alias `"ai"`)* | teal | magenta | violet | the WARD identity |
| `aurora` | green | blue | violet | cool, contemplative |
| `ember` | red | orange | yellow | active, urgent |
| `quantum` | white | cyan | blue | clean, technical |

The `palette = "earth"` value from 015 stays accepted as a
backward-compatibility alias for one of the presets (probably
`quantum`). It is no longer the literal earth-style mesh.

### Settings exposure

Add a small "Orb appearance" subsection on the Standard tab of the
Settings modal (between Profile and Theme, or under Theme) with a
single dropdown:

```
ORB APPEARANCE
  Palette: [ Plasma (teal · magenta · violet)  ▼ ]
```

For v1, the chosen palette is **session-scoped** — driven by a
top-level state passed into `WardOrb`'s `palette` prop. Persisting
to `profile.tts_voice`-style preferences is **out of scope** for this
task; landing later as a tiny follow-up.

### Performance gates

- **Target**: 60 fps on M-series Macs (M1+) at default window sizes
  (≤ 1440×900 visible orb area).
- **Floor**: ≥ 30 fps on integrated GPUs / older hardware via
  graceful degradation.
- **FPS sampler**: in `WardOrb.tsx`, sample frame deltas for the
  first 2 seconds. If average FPS < 50, switch to a `low` profile
  for the remainder of the session:
  - drop fbm to **2 octaves** (from 3),
  - drop noise iterations in displacement to **1 octave**,
  - disable the bloom pass entirely (use direct `renderer.render`),
  - reduce icosphere subdivision to **20** (from 32),
  - lower the device pixel ratio cap from `min(2, devicePixelRatio)`
    to `min(1.25, devicePixelRatio)`.
- The `low` profile must not change the perceptual identity of the
  orb (palette, motion, scale). Only sharpness / glow softness drop.

### Concept-art pre-step

Before writing the shader, the implementer generates 8–12 reference
frames using Imagen / SDXL / DALL-E with prompts curated for fluid
plasma energy spheres on dark backgrounds. The best 2–3 references
are committed to `docs/task/018/concept-references/` as PNGs (≤ 1 MB
each, ≤ 1024×1024) for shader iteration ground truth.

Suggested prompts (use any modern image model):

- "An abstract energy plasma sphere, fluid teal magenta violet
  swirling currents, fresnel rim glow, dark space background,
  ethereal and luminous, no text, square, photoreal CGI render,
  soft bloom"
- "A fluid plasma orb with internal currents like a fusion reactor,
  soft purple cyan magenta, dark background, atmospheric haze, no
  medical or healthcare imagery, square, photoreal"
- "An energy ball with swirling internal noise patterns, gentle
  vertex distortion at the silhouette, soft bloom, dark void,
  photoreal CGI"

Negative tokens (use where the model accepts them): `hospital`,
`medical`, `cross`, `plus`, `text`, `watermark`, `hard edges`, `mesh
wireframe`, `low poly`.

## Out of Scope

- Replacing Three.js with a different WebGL framework.
- Real-time microphone-driven FFT audio reactivity. The orb still
  reacts only to outgoing TTS via the existing `ward:speech` bus.
- Animated camera dolly / orbit moves around the orb. Camera stays
  static.
- A second "thinking" orb variant or multi-orb scene composition.
- Saving the user's chosen palette as a profile preference. v1 is
  session-scoped; persistence is a tiny follow-up.
- Touch / mobile interaction polish.
- A full theme system tying the orb palette to app chrome colors.
  The orb's palette is its own identity, separate from light/dark.
- Replicating BoltAI's orb pixel-for-pixel. The bar is "comparable
  in spirit".

## Proposed File Changes

- `apps/ui/src/components/WardOrb.tsx`
  - Rewrite the inner Three.js scene. Drop torus rings, wireframe
    overlay, corona mesh, dense starfield. Keep the host div, props,
    pointer interaction, pulse decay, and lifecycle.
  - Build the shader material via the new factory; wire uniforms to
    the existing refs (`intensityRef`, `pulseRef`, pointer state,
    flow-direction).
  - Add the FPS sampler + low-fidelity fallback path.
  - Swap the render call to `composer.render()`.

- `apps/ui/src/components/orb-shader.ts` (new)
  - Export `vertexShader` / `fragmentShader` strings (or `.glsl`-as-
    string imports).
  - Export `simplexNoise3D` GLSL chunk (Ashima/IQ derivative,
    permissively licensed; cite source).
  - Export `PALETTES: Record<string, { primary, secondary, accent }>`.
  - Export `buildOrbMaterial(opts)` returning a configured
    `THREE.ShaderMaterial` plus the uniforms ref.

- `apps/ui/src/main.tsx`
  - Add the "Orb appearance" subsection to the Settings modal's
    Standard tab. Wire the dropdown to a top-level `orbPalette`
    state passed into `<WardOrb palette={orbPalette} ... />`.
  - No other changes — TTS event-bus, `intensity`, `pulseKey` are
    untouched.

- `apps/ui/src/styles.css`
  - Minor only. The orb stage already has the dark backdrop; the
    shader plus bloom replace the previous CSS drop-shadow on the
    `.ward-orb` container.

- `docs/task/018-fluid-plasma-orb-shader.md` — this doc.
- `docs/task/018/concept-references/*.png` (new) — 2–3 reference
  PNGs (≤ 1 MB each).
- `TASKS.md` — add task 18 entry under Planned.

No backend, schema, or CLI changes.

## Code Context

- Current orb component: `apps/ui/src/components/WardOrb.tsx`. Already
  has `pulseKey`, `intensity?`, `palette?` props (set by 015) and a
  pointer / hover / pulse state machine inside the animation loop.
  Lines 4–10 are the contract; the inner scene below them is the
  thing being rewritten.
- Current rings / corona / starfield: lines 30–~130 of `WardOrb.tsx`.
  All of that goes away.
- TTS event bus: `apps/ui/src/main.tsx` near line 1513 dispatches
  `ward:speech` `CustomEvent`s with `{ kind, intensity }` detail
  whenever speech starts/boundary/end events fire from `speak()`.
  `WardOrb` already listens via the parent component setting
  `intensity` on this prop. No new plumbing needed.
- Three.js postprocessing modules ship with the core package the
  repo already uses (`three`); imports are
  `import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"`
  and similarly for `RenderPass` and `UnrealBloomPass`. No package
  add.
- Settings modal (Standard tab) location: `apps/ui/src/main.tsx`
  Settings modal added in 015; search for the Theme card to find the
  insertion point.

## Implementation Steps

1. **Concept art**: generate 8–12 reference PNGs with the suggested
   prompts. Pick the 2–3 best, crop / downscale to ≤ 1024×1024,
   commit to `docs/task/018/concept-references/`.
2. **Scaffold the shader**: write `orb-shader.ts` with vertex +
   fragment GLSL, simplex noise, palette presets, and
   `buildOrbMaterial()`. Verify it compiles with no runtime errors
   on a stripped-down orb.
3. **Replace the orb internals**: rewrite the Three.js scene in
   `WardOrb.tsx` to use the new material on
   `IcosahedronGeometry(1.55, 32)`. Keep the host div, pointer
   listeners, pulse decay, lifecycle untouched.
4. **Add postprocessing**: introduce `EffectComposer`, `RenderPass`,
   `UnrealBloomPass`. Tune `threshold`, `strength`, `radius` against
   the reference images. Document final values in Implementation
   Notes.
5. **Wire the uniforms**: `uTime`, `uIntensity` (smoothed),
   `uHover`, `uPulse`, `uFlowDirection` (re-randomized every ~60 s),
   palette `vec3`s.
6. **FPS sampler**: implement the 2-second sampling window. Store
   the chosen profile in a ref; switch material defines / postpro
   pipeline / pixel ratio accordingly. The profile choice happens
   once at startup; don't oscillate.
7. **Settings UI**: add the Orb appearance dropdown under Standard.
   Wire to a top-level `orbPalette` state. Pass into `WardOrb`.
8. **Iterate**: hold the chosen palette next to a reference image
   side by side; tune Fresnel exponent, fbm scale, flow speed, and
   bloom params until it visibly matches the spirit of the
   reference. Capture before/after screenshots for review.
9. **Run verification**: `bun run typecheck`, `bun run build`,
   `git diff --check`, dependency-cruise, and a manual UI smoke on
   each palette + with TTS pulsing.
10. **Update docs**: append Implementation Notes (chosen bloom
    params, simplex source, performance numbers on the test
    machine).

## Acceptance Criteria

1. The orb no longer shows visible mesh wireframe, torus rings, or
   discrete starfield points. The silhouette is fluid; surface reads
   as energy currents.
2. The orb rotates and the surface currents flow at all times,
   without visibly looping over a 30-second observation window.
3. Triggering speech via the Speak button (or chat reply) makes the
   orb visibly modulate (rim brighter, scale subtly larger, displace-
   ment amplitude higher) and return to baseline cleanly when speech
   ends.
4. Hovering the orb tilts and slightly intensifies it; clicking
   triggers a one-shot pulse that decays.
5. The Settings → Standard → Orb appearance dropdown switches the
   palette in real time. All four presets ship and look distinct.
6. On an M-series Mac, the orb holds 60 fps under default window
   conditions; the FPS sampler does **not** trigger the low profile.
7. On an integrated-GPU laptop (the implementer can simulate by
   throttling devtools or setting `pixelRatio = 1`), the orb either
   maintains ≥ 30 fps or trips the low-fidelity profile, which keeps
   ≥ 30 fps while keeping palette and motion identifiable.
8. The `WardOrb` component contract is unchanged; no call site in
   `main.tsx` needs to be edited beyond the new palette prop wiring.
9. Two or three concept-reference images live in
   `docs/task/018/concept-references/`. Implementation Notes cite
   which reference drove the final visual decision.
10. `bun run typecheck`, `bun run build`, `git diff --check`, and
    dependency-cruise all pass.

## Verification

- `bun run typecheck`
- `bun run build`
- `git diff --check`
- Manual UI smoke against a running daemon:
  - Open the home view; observe the orb's motion and rim glow
    without speaking.
  - Press the Speak button; observe the orb modulate during speech
    and settle when it ends.
  - Open Settings → Orb appearance; cycle through the four palettes;
    confirm each is distinct and the motion is unchanged.
  - Resize the window; observe the orb stays centered and crisp.
  - Open devtools → Performance; record 10 s; confirm frame budget
    is well under 16 ms (60 fps) on the test machine.
  - Throttle GPU to 4× slow in devtools; reload; confirm the FPS
    sampler kicks the low profile and the orb still looks like the
    orb.

## Implementation Notes

_To be filled in by the implementation stage._
