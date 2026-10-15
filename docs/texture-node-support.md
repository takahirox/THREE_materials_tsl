# Default 2D texture nodes (Issue #17)

The paired default adapters support `texture(myTexture)` with the existing
Draft v2.0 `$refTex` resource link. They use GLTFExporter's texture writer and
GLTFLoader's texture dependency parser; sampling and shader generation remain
Three.js's responsibility. This is an r186 (`three@0.186.1`) implementation
convention for node `args`/`links`, not an extension schema change or Draft v1
compatibility layer.

## Supported subset

| Node/resource | Preserved behavior |
| --- | --- |
| Ordinary `TextureNode` | Default UVs (`texture.channel` 0–3), explicit UV graph, `sampler` (sample or texel fetch), `updateMatrix`, optional `levelNode`, `biasNode` and integer `offsetNode`. Child graphs must themselves fit the default allowlist or have paired adapters. |
| Image-backed `Texture` | Ordinary RGBA/unsigned-byte, UV mapping, nonempty raster image. PNG/JPEG/WebP use the writer's normal image encoding. Name and glTF wrap/filter settings use the resource writer/parser. Anisotropy and explicit `generateMipmaps` are restored separately because glTF samplers omit them. No authored mip chains. |
| UV transform | Offset, repeat, rotation, center, full matrix and `matrixAutoUpdate`, plus the node's separate `updateMatrix` toggle. Explicit UVs disable `updateMatrix` by default, just as in Three.js; explicit opt-in is retained. Matrix replacement and parameter changes continue through Three.js's own `TextureNode.update()`. |
| Color space | `NoColorSpace`, `SRGBColorSpace`, `LinearSRGBColorSpace`; intent is per TSL texture, independent of the ordinary material slot's color-space assignment. Three.js performs decoding/conversion. |
| Fluent sampling references | `.sample()`, `.level()`, `.bias()`, `.offset()`, `.load()`, `texture(existingTextureNode)` and similar ordinary internal `referenceNode` links retain base-node identity and value replacement behavior. Only links to another ordinary supported `TextureNode` are accepted; external object/property references require adapters. Cycles fail. |
| `TextureSizeNode` | Shared `textureNode` input and optional mip-level graph; Three.js generates the shader size query. |
| `MaxMipLevelNode` | Private `_textureNode` input retained explicitly; Three.js recomputes the value from image dimensions per frame. Its cached numeric value is not a persistent input. |

Node names, precision (`low`/`medium`/`high` where applicable), global and parents
flags are retained. Default uniform groups and Three.js-owned update behavior
are supported, including nodes already used in shader setup. Internal matrix/flip
uniform caches are rebuilt, rather than saved as user graph inputs. Application
callbacks and non-default uniform groups require adapters.

`flipY` is **normalized**, not restored as an upload flag: GLTFExporter bakes it
into the image and GLTFLoader loads with `flipY=false`. Restoring the original
flag would flip the image twice. Subsequent exports retain the normalized pixels.
Image re-encoding, sizing and supported formats follow GLTFExporter options;
lossy codecs are not byte-preserving. Upload-only alignment is immaterial for
the supported RGBA8 raster resources. Pixels, not original encoded file bytes,
are the resource contract.

## Ordinary material fallback and transforms

Ordinary core and `KHR_materials_*` texture properties still use Three.js's
normal material processing. TSL state is applied to a private texture clone,
cached by glTF texture index and identical sampling metadata across all material
graphs in a parser. TSL nodes share those textures and their image sources.
Ordinary material slots keep their own parser resources/clones; identity between
an ordinary map and a TSL texture is deliberately not retained. This prevents
double transforms, color-space pollution, and mutations of fallback resources
if any graph node fails. Every material graph is validated before publication,
including unreachable definitions and query targets.

The r186 audit found an ordinary-map representation limit:

- GLTFExporter writes offset/repeat/rotation into texture-info and
  `KHR_texture_transform`; it does not write center or arbitrary matrices.
- Three.js's automatic UV matrix uses `T*S*R`. The r186 GLTFLoader KHR handler
  uses `T*R*S`, stores its matrix, and disables `matrixAutoUpdate` for rotation.
  Rotation combined with nonuniform scale can therefore change on native export.

When exporting a material with a TextureNode graph, the plugin compares ordinary
map transforms with the matrix the KHR loader will reconstruct. Incompatible
ordinary maps fail explicitly. Use zero center and uniform scale when rotating,
or a fixed matrix that already matches the KHR offset/scale/rotation fields.
Nonuniform scale without rotation works. A separate ordinary fallback map can
provide a glTF-compatible approximation while the TSL texture retains arbitrary
center/matrix transforms. The plugin does not change the native exporter for
materials without a texture graph or bake a TSL graph into fallback maps.

## Encoding and r186 audit

[TextureNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/TextureNode.js)
serializes sampler/updateMatrix/updateType, the texture UUID and discovered node
children, but not the complete glTF texture-info state. The default adapter
uses Three.js serialization with preseeded child/resource caches and explicit
fields for omitted state. Renderer-dependent `updateType` is recomputed during
shader setup. Its additional compare/depth/gradient/gather/comparison-sampler
fields are audited and rejected. Ordinary `offsetNode` and sampler=false fetch
paths have no extra resource requirements and are included.

Base TextureNode links contain `value: { $refTex: n }` and optional UV/level/bias/
offset inputs. `args.texture` contains channel, colorSpace, offset, repeat,
center, rotation, matrix, matrixAutoUpdate, generateMipmaps and anisotropy.
Derived nodes instead link `referenceNode: { $ref: id }` and carry no duplicate
texture state/resource. Queries link `textureNode` or `_textureNode`; their
targets are checked after hydration. Unknown fields and malformed reference
kinds fail. The default resolver's private completion step runs after resource
hydration and before material publication; custom adapters keep their normal
hydration behavior.

The other audit references are
[TextureSizeNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/TextureSizeNode.js),
[MaxMipLevelNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/utils/MaxMipLevelNode.js),
[GLTFExporter](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/exporters/GLTFExporter.js)
(`processTextureAsync`, `processImage`, `processSampler`, `applyTextureTransform`), and
[GLTFLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js)
(`loadTextureImage`, `assignTexture`, `GLTFTextureTransformExtension`).

## Deliberate exclusions and adapters

Depth comparison, comparison samplers, gather, gradients, array layers, cube/3D/
storage textures, render-target/framebuffer/renderer resources, video, compressed,
data/integer/float textures and custom texture implementations are outside the
default resource model. Non-UV mapping, manual mipmaps, upload premultiplication,
partial texture updates and application texture metadata/callbacks also fail
explicitly. `userData.mimeType` is the one supported metadata key, consumed by
the native writer/parser. Ordinary material fallback cannot represent every TSL
texture state, even when the TSL copy can preserve it.

Use paired serializer/resolver overrides to agree on a constrained additional
resource or operation. External mutable references require a consumer-owned
binding/lifetime contract; cube/volume/storage and renderer resources need a
separate resource design. Do not encode shader source, callbacks or live objects
in glTF. `NormalMapNode` remains outside the default allowlist; ordinary glTF
normal maps continue through Three.js, and a custom TSL normal-map operation
needs its own paired adapter.

## Validation

The [texture integration tests](../packages/demo/test/textures.test.js) use the
real exporter and parser with CPU canvas/PNG encoding and decoding supplied by
the demo-only `@napi-rs/canvas` development dependency. They cover JSON data URIs
and binary GLB image bufferViews, two repeated round trips, four distinct image
pixels and flip normalization, shared graphs/resources across materials, all UV
channels, explicit/default UV behavior, mutable/fixed matrices, color spaces,
all glTF minification filters, mip-generation intent, sampler/wrap settings,
sampling options and both queries. They compare Three.js GLSL builder output
before and after import, and check core/KHR fallback with and without the plugin,
including malformed texture graphs and unsupported export modes.

Browser/WebGPU visual smoke tests are optional and were not run. CPU image
round trips and Node shader generation do not establish GPU compilation or
rendered pixel correctness. Required post-merge verification: none. No npm
publication is part of this issue.

Final required checks in the assigned worktree on 2026-10-15:

| Command from repository root | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; no audit findings. |
| `npm --prefix packages/exporter ci` | Passed; no audit findings. |
| `npm --prefix packages/demo ci` | Passed, including a clean reinstall with the new canvas dependency. npm reported the same 10 existing audit findings (3 moderate, 5 high, 2 critical). |
| `npm --prefix packages/demo test` | Passed: 180 tests across 3 files, including 41 texture tests and all existing tests. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite reported its large-chunk warning. |
| `git diff --check` | Passed. |

No mandatory checks were skipped. The only new dependency is the demo's canvas
test codec; runtime package dependencies, peer ranges and versions are unchanged.
