# Geometry, screen and viewport depth nodes

Issue [#23](https://github.com/takahirox/THREE_materials_tsl/issues/23) adds paired,
data-only defaults for ordinary `IndexNode`, `FrontFacingNode`, `ScreenNode` and
`ViewportDepthNode` instances. The Draft v2.0 specification is unchanged.

## Audit baseline

On **2026-10-15**, GitHub's [latest stable release](https://api.github.com/repos/mrdoob/three.js/releases/latest)
was [r186](https://github.com/mrdoob/three.js/releases/tag/r186) and
[npm latest](https://registry.npmjs.org/three/latest) was **0.186.1**. Implementation
and tests use the installed `three@0.186.1` and `@types/three@0.186.0`, with no
version or peer-range change. This does not establish support for every version
in the existing peer range.

Sources audited: [IndexNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/IndexNode.js),
[FrontFacingNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/FrontFacingNode.js),
[ScreenNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/ScreenNode.js),
[ViewportDepthNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/ViewportDepthNode.js),
[Node serialization](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js),
[NodeFrame](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeFrame.js),
[camera uniforms](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/Camera.js),
[GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js),
[WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js),
[NodeMaterial](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js)
and native glTF material transport.

All four classes inherit `Node.serialize()` / `deserialize()`: they serialize
child links, but omit scope and base `nodeType`, `name`, `global`, `parents` state.
The adapters call native serialization with a preseeded child cache and record
these small missing fields explicitly. Resolution invokes the imported
`three/webgpu` constructors on the same TSL stack as `three/tsl`; validated child
slots are hydrated by the existing graph loader. There is no upstream scalar
`deserialize()` implementation to reuse for these classes. Native Three.js owns
all shader calculations, uniforms, backend selection and updates. Index,
front-facing and viewport-depth nodes have no own runtime updates; screen
coordinate/UV also retain `none`, with size updates supplied by the native
screenSize node used during setup. Scope is public mutable constructor state: a
changed supported scope is saved, but application-driven scope changes after
shader compilation still require normal Three.js invalidation/rebuilds.

## Exact supported variants

| Class / constructor | Supported scope or state | Runtime and shader-stage contract |
| --- | --- | --- |
| `IndexNode(scope)`; fixed `uint` | `VERTEX = 'vertex'`, `INSTANCE = 'instance'`, `DRAW = 'draw'`. No default scope. No children. | Native vertex/instance/draw indices; fragment use goes through native varyings. Vertex and instance work on GLSL and WGSL. Draw requires a WebGL renderer: native GLSL selects `gl_DrawID` with `WEBGL_multi_draw`, or the renderer-owned `nodeUniformDrawId` fallback. r186 WGSL `getDrawIndex()` returns null, so this scope has **no WebGPU support**. No draw ID is frozen into a literal or emulated by the plugins. |
| `FrontFacingNode()`; fixed `bool` | No scope or inputs; ordinary instances stay distinct from the shared `frontFacing` object. | Fragment generation uses native front-facing builtins on FrontSide/DoubleSide; outside fragment it returns true. Native BackSide returns false, but BackSide material transport is deferred below. |
| `ScreenNode(scope)`; base `nodeType: null`, inferred `vec2`/`vec4` | `COORDINATE = 'coordinate'`, `UV = 'uv'`, `SIZE = 'size'`, `VIEWPORT = 'viewport'`. No default scope. No children. | Coordinate/UV require fragment builtins. Coordinate follows native WebGPU coordinate conventions, including native GLSL Y flipping. Size (`vec2`) and viewport (`vec4`) may also be used in vertex expressions. They use native render-group uniforms and RENDER updates after setup. |
| `ViewportDepthNode(scope, valueNode = null)`; fixed `float` | `DEPTH = 'depth'` with null/omitted value only; `LINEAR_DEPTH = 'linearDepth'` with null/omitted value or one scalar-float `valueNode` link. No default scope. | Fragment depth expressions follow the active builder camera. Depth uses positionView and cameraNear/cameraFar, selecting perspective versus orthographic projection. Linear depth without input uses positionView and live near/far; with input it converts ordinary perspective depth using the active perspective camera, or returns the input for an orthographic camera. |

The graph retains base naming/cache flags and shared references within each
material graph, including one linked depth value used by several nodes and
entrypoints. Graphs of different glTF materials are resolved independently, as
before. Assigning a node to `positionNode`, `colorNode`, `emissiveNode` or
`depthNode` preserves that entrypoint; consumers must still choose meaningful
value types and stages for the surrounding material graph.

### Renderer and camera ownership

Screen sizes are **live physical pixels**, never serialized display dimensions.
Native `ScreenNode.setup()` creates render-group uniforms backed by Three.js
module-owned vectors. Native updates query the current render target: size uses
its width/height, viewport copies its viewport without DPR scaling. With no
render target, size uses `getDrawingBufferSize()` and viewport uses
`getViewport()` multiplied by the current pixel ratio. The exported object can
be unbuilt (`updateType: none`) or already built (`render` for size/viewport).
The imported node starts unbuilt and native setup restores its render updates.
The plugins preserve Three.js's own module-cache/lifetime behavior, including
shared backing vectors; they add no independent screen cache.

Depth expressions do not sample a framebuffer, bind a stored camera, or allocate
a depth texture. Their camera is the camera of the current Three.js render;
near/far are Three.js render-update uniforms. Projection-kind selection happens
during native shader setup: switching between perspective and orthographic
cameras requires the normal Three.js rebuild/program selection. Linked input
must be scalar ordinary perspective depth for that same camera, or orthographic
depth when that camera is orthographic. The file cannot identify the camera that
produced an arbitrary depth value; foreign-camera conversions require a paired
binding adapter. These scopes do not promise logarithmic/reversed hardware-depth
texture decoding, and do not configure renderer depth modes. Use the native
NodeMaterial `depthNode` path for custom fragment-depth output, subject to the
renderer/pipeline's normal depth contract.

## Deferred variants and adapter paths

| Exact variant | Reason for deferral / failure | Future paired adapter or binding approach |
| --- | --- | --- |
| Ordinary IndexNode `invocationLocal`, `invocationSubgroup`, `subgroup` | Workgroup/subgroup identifiers require compute dispatch; ordinary glTF mesh material graphs provide no dispatch or workgroup/subgroup ownership. GLSL WebGL lacks these builtins. | Bind a consumer-owned compute pipeline, dispatch/workgroup layout and subgroup capability contract, with explicit stage validation. |
| IndexNode `draw` on WebGPU | Native r186 WGSL supplies no draw index. The serialized scope is supported only where native WebGL implements it. | A consumer renderer adapter may bind a real per-draw uniform/resource; never replace it with a constant or instance index. |
| Ordinary FrontFacingNode on a `BackSide` material | Native glTF only carries `doubleSided`; BackSide imports as FrontSide. The native false branch would change. Export rejects this material even when the node is nested in another expression. | Paired material/geometry adapters must transport and restore the side/culling contract before shader setup. FrontSide and DoubleSide are supported. |
| ViewportDepthNode `depthBase`, both with and without `valueNode` | With a value, native setup constructs an assignment needing ordered statement/write context. Without a value it exposes a fragment output that may be uninitialized; it is not a portable depth read. Generic statement/scope support is already deferred. | Define a consumer-owned ordered fragment-depth write adapter and output initialization/stage rules. Use `depth`/`linearDepth` expressions in material `depthNode` when appropriate. |
| ViewportDepthNode `depth` with any non-null `valueNode` | Native setup ignores this input. Accepting it would falsely imply a depth conversion or write. Export rejects it. | Choose `linearDepth` for its defined conversion, or a separate explicit consumer operation with documented semantics. |
| Framebuffer depth textures, foreign cameras, logarithmic/reversed depth decoding | Sampling requires render-pass ownership, resource lifetime, the producing camera and depth encoding. Ordinary `ViewportDepthTextureNode` remains unsupported. | Bind a consumer-owned depth source, camera ID and encoding, validate targets, and reconstruct native Three.js operations with the required pass scheduling. |
| App callbacks, explicit `camera`/`renderer`/`renderTarget` fields, invalid/missing scopes, changed fixed node types, custom update schedules, extra child links | Not native portable constructor data; silently dropping them could change behavior. | Supply paired data-only adapters with agreed context IDs/lifetimes and validation. The file may select predefined consumer behavior, never supply executable code. |

All **exact shared TSL objects** keep the existing name/identity path, ahead of
ordinary class adapters. In particular `frontFacing`, screen singletons, index
singletons (including compute indices), `depth` and `viewportLinearDepth` remain
unchanged. Shared names accept no file-provided args or links. Their identity
support is not universal stage/backend/render-pass support:
`viewportLinearDepth` internally uses a renderer-managed viewport depth texture,
while an independently constructed linearDepth node with such an ordinary
texture input still requires a resource adapter. Shared behavior/protections are
not weakened or treated as evidence for arbitrary-instance support.

## Failure behavior and validation

Export checks native child discovery and own/nested child fields, rejecting
extra graphs (including private attachments), broken/array/non-node depth links,
unsupported subclasses and callbacks. The scalar depth input type uses native
Three.js type inference without renderer resources; inputs requiring unavailable
inference context need a paired adapter. Import validates exact fields, scopes,
link shape and reference kind before hydration, then validates the linked input
type privately before publication. Dangling references, cycles, unsupported or
malformed unreachable definitions and invalid resources use the existing atomic
fallback: the entire ordinary glTF material and its properties remain intact,
with no partial entrypoints published. No arbitrary JavaScript, GLSL or WGSL is
stored in glTF; no v1.0 path is restored.

The [geometry suite](../packages/demo/test/geometry.test.js) covers all supported
ordinary variants through GLTFExporter → GLTFLoader → GLTFExporter → GLTFLoader,
including GLB, material entrypoints, base state, distinct/shared node identity,
linked uniforms and exact shared singleton identity. Native GLSL/WGSL flow is
compared before/after import (WGSL draw is explicitly excluded), including
vertex/fragment behavior, front/back-side branches, draw ID extension/fallback
selection and perspective/orthographic depth. Native NodeFrame tests exercise
screen resize, DPR, render-target switching and camera near/far changes.
Malformed graphs are compared with the complete ordinary material produced by a
plugin-disabled loader, excluding generated IDs and extension bookkeeping.

Validation commands and final results are recorded below. Browser/WebGPU visual
smoke tests are optional and were not run; Node-side shader generation does not
compile GPU programs or prove GPU pixel behavior. No post-merge verification or
npm publication is required by this issue.

### Check results (2026-10-15)

| Command from repository root | Actual result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/exporter ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/demo ci` | Passed; npm reported 10 dependency advisories (3 moderate, 5 high, 2 critical). No dependency changes were made in this issue. |
| `npm --prefix packages/demo test` | Passed: 6 files, **730 tests**, including **115 geometry tests**, no skips. Existing texture-packing negative tests emit native exporter warnings. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite warned about the minified chunk exceeding 500 kB. |
| `git diff --check` / `git diff --cached --check` | Passed. |
| Browser/WebGPU visual smoke tests | Not run (optional); CPU shader-flow/runtime checks do not prove rendered pixels. |

The root Draft v2.0 specification, package versions and dependency locks are
unchanged. No push, PR, merge, comment, package publication or post-merge action
was performed.
