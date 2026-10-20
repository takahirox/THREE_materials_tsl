# Current-renderer exposure references

[Issue #35](https://github.com/takahirox/THREE_materials_tsl/issues/35) adds a paired,
data-only default adapter for ordinary `RendererReferenceNode` instances. Draft
v2.0, required `materialType`, ordinary material coexistence and the existing
plugin/override architecture are unchanged. No v1.0 support is restored.

## Source audit

Rechecked on **2026-10-20**: [npm's stable Three.js package](https://registry.npmjs.org/three/latest)
is **0.186.1**, matching the locks (`@types/three@0.186.0`). The following nine
installed source files were compared byte-for-byte with the upstream **r186**
tag; all were identical. This is an audited baseline, not a promise for every
version in the unchanged peer range.

| Native source | Constructor, mutable state and lifecycle |
| --- | --- |
| [RendererReferenceNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/RendererReferenceNode.js) | `(property, inputType, renderer = null)` calls ReferenceBaseNode with the renderer as `object`, stores `renderer`, and sets the exact shared `renderGroup`. `updateReference(state)` selects explicit renderer when non-null, otherwise `state.renderer`; it writes the runtime `reference` cache. |
| [ReferenceBaseNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/ReferenceBaseNode.js) | Stores `property`, `uniformType`, `object`, `count = null`, dotted `properties` cache, `reference = object`, `node = null`, `group = null`, and `updateType = 'object'`. `setNodeType()` creates a native `uniform(null, uniformType)` and assigns its group. `generateNodeType(builder)` selects the reference and updates its value when the uniform is absent. `setup()` and `update()` call native `updateValue()`, which reads the selected property into the lazy uniform. No constructor-field serialization override exists. |
| [ToneMappingNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/ToneMappingNode.js) | The exported `toneMappingExposure` is exactly `rendererReference('toneMappingExposure', 'float')`. ToneMappingNode defaults to that shared object; a separately constructed node has a different graph identity even with identical selectors. |
| [NodeFrame](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeFrame.js) | `updateNode()` calls native `getUpdateType()` and `updateReference(frame)` before update. Object-frequency nodes update on every call, including within the same frame/render ID; render-frequency groups update once per render ID. Initial cached IDs are zero, so the scheduling harness starts at render ID 1. |
| [UniformGroupNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformGroupNode.js) | `renderGroup` is the shared `('render', true, 0, 'render')` singleton. Its update increments the live version through `needsUpdate`. Group scheduling is separate from the reference's object update frequency. |
| [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js) | Setup calls `updateReference(builder)` before native `setup()`. Base fields include `nodeType = null`, `name = ''`, `global = false`, `parents = false`, update-before/after `none`, and `_beforeNodes = null`. `getSerializeChildren()` discovers the group and built uniform, and can also inspect a plain-object cached renderer. Inherited `serialize()` writes child UUIDs, not the selector. Private fields/self references are skipped by native discovery. |
| [UniformNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformNode.js) | The lazy float uniform has null initial value until a native reference update, null precision, empty name, false global/parents and no updates. `generate()` obtains a native uniform binding; its value stays live. Its own value serialization must not become a fixed exposure literal. |
| [GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js) | Native uniform generation places the float in the render group's uniform buffer and names its shader expression. No plugin shader implementation is needed. |
| [WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js) | Native uniform generation likewise uses the render binding group, WGSL uniform declaration and native packing. No plugin exposure calculation or shader code is needed. |

The r186 type declarations still describe older ReferenceNode inheritance and
omit `group` and the exact lazy uniform type. The exporter locally refines those
types against the audited runtime; Three.js and its declarations are unchanged.

## Exact supported contract

Author either `new RendererReferenceNode('toneMappingExposure', 'float')` from
`three/webgpu` or `rendererReference('toneMappingExposure', 'float')` from
`three/tsl`. The ordinary operation is exactly:

```json
{"op":"RendererReferenceNode","args":{"property":"toneMappingExposure","uniformType":"float"}}
```

No links or additional arguments are accepted. The exporter requires the exact
native bundled class/prototype, `renderer === null`, `object === null`, null
count, one exact cached property segment, the exact native `renderGroup`, native
object update frequency, no before/after updates, and native default base fields.
Nondefault base names, node types, global/parents flags and before attachments
are deferred. Unknown own scalar fields, symbols, accessors, functions and
meaningful public/private child attachments are rejected, including subclasses
that claim the native type string. The group configuration is validated even
though it is not emitted as a graph node.

Both unbuilt and natively built/updated instances are supported. A type-only
lazy uniform with null value is also safe. Existing internal uniforms must have
the exact native prototype, float type, null precision, native default
base/input/update state and the same exact render group. Their cached value may
be null or a finite number; it is validated but never saved. Customized uniforms,
callbacks, links and groups fail export. IDs, UUIDs, versions, stack traces,
native cache keys and TSL memoization caches are runtime state, recreated rather
than transported.

The cached `reference` may be null or an object selected by a previous native
update/build. It is opaque: the exporter never reads its exposure, calls its
callbacks or serializes its resources. For child discovery/serialization the
adapter uses a descriptor copy with `reference: null`; native traversal and
serialization then see only the validated group/lazy uniform. Child UUIDs are
preseeded to prevent recursive serialization of internal runtime values. The
exporter's existing preflight hook also stops at renderer references, so it
cannot traverse that cache before validation. The source node is not rebound or
modified. No renderer object or producer exposure enters file arguments.

Import constructs a fresh native node with those two constructor arguments.
Its initial reference/uniform are null. Shader setup/type inference and normal
NodeFrame updates select the **consumer's active renderer**, read its exposure,
and continue tracking later changes or a different active renderer. Existing
native object-update/render-group upload scheduling is retained; this adapter
does not schedule renders or promise uploads midway through a render call.

The exact shared TSL `toneMappingExposure` retains its existing singleton op and
identity. Ordinary instances never resolve to that singleton. Repeated links
within a material graph share one reconstructed node; distinct definitions keep
distinct nodes/uniforms. GLTFLoader primitive clones share their material graph
on the first import. If re-export gives clones separate glTF material entries,
the next import has one graph per entry; cross-material identity is not promised.

## Rejection, deferrals and external renderer bindings

The default resolver accepts only the exact property/type arguments above, with
no nonempty links. Unknown fields, selectors/types, missing args, dangling
references, cycles, malformed entrypoints and invalid unreachable definitions
fail the whole graph through existing loader validation. All ordinary material
properties, other supported material extensions, native primitive clones and
material dependency caches remain intact. Nothing is published incrementally.

Explicit/non-null renderers and foreign `object` bindings are deferred: glTF has
no renderer resource or identity, and choosing the consumer's renderer for an
explicit producer target would change its meaning. Other renderer properties,
value types, nested paths, arrays/counts and custom groups require separate
property/type, uniform-layout and lifecycle audits. Custom callback methods,
renderer ownership, render scheduling and external binding IDs remain application
responsibilities. A file never contains arbitrary JS, GLSL, WGSL or a renderer
instance. Data fields must not become executable constructor/property lookup.

For a specific external renderer, use paired overrides with a **distinct op**,
for example `BoundRendererExposure`. The producer's serializer must validate the
exact node/property/type/group contract, look up its explicit renderer in an
application-owned reverse registry, and emit only an allowlisted stable
`rendererId` plus the validated selector/type; reject unknown targets. The
consumer resolver `(op, args, links)` must reject extra arguments/links, validate
the same selector/type and ID domain, resolve that ID from a prepopulated
consumer-owned renderer registry, and construct a native
`new RendererReferenceNode('toneMappingExposure', 'float', resolvedRenderer)`.
Missing or incompatible IDs must fail, never silently bind the active renderer.
Registry provisioning, renderer selection, sharing/cloning, updates, disposal and
ownership must be defined by both applications, using a companion loader plugin
if necessary. This future contract is not part of the default operation or file
resource schema; no registry framework is added here.

## Validation

The [renderer-reference integration suite](../packages/demo/test/rendererReferences.test.js)
covers built/unbuilt graphs, two JSON glTF and GLB export/import rounds, distinct
ordinary instances, repeated graph links, exact singleton identity, five material
entrypoints, selected-entrypoint export, ordinary material coexistence, physical
extensions and primitive clones. Real NodeFrame methods check active-renderer
selection, same-frame exposure changes and switching renderers before/after
import. Real GLSL/WGSL builders compare vertex/fragment setup/analyze/generate
flow and declarations. Native bindings check two distinct uniforms with reuse of
repeated inputs, render-group metadata/scheduling and live packed float values.
Negative tests cover source state/callbacks/groups/subclasses/internal uniforms,
malformed args/links/graphs, invalid unreachable nodes and complete ordinary
material/clone/cache retention with no successful application callback.

Executed on 2026-10-20:

| Command | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; zero vulnerabilities reported |
| `npm --prefix packages/exporter ci` | Passed; zero vulnerabilities reported |
| `npm --prefix packages/demo ci` | Passed; npm reported 10 development-tool vulnerabilities (3 moderate, 5 high, 2 critical) |
| `npm --prefix packages/demo test` | Passed: 1,866 tests in 12 files, including 92 renderer-reference tests; no skips |
| `npm --prefix packages/loader run build` | Passed |
| `npm --prefix packages/exporter run build` | Passed |
| `npm --prefix packages/demo run typecheck` | Passed |
| `npm --prefix packages/demo run build` | Passed; Vite bundle-size advisory |
| `git diff --check` | Passed |

The first focused test run exposed exporter preflight traversal of the cached
renderer; that hook was corrected. Initial test assumptions about zero render IDs
and native clone/cache identity were corrected against native behavior. The
full suite above passed after those fixes. Existing reference tests print native
metalness/roughness packing and mismatched-UV warnings. `npm audit --json` confirmed
the demo's reported findings in its existing development-tool dependency tree;
no dependency versions/locks were changed in this issue.

Browser WebGL/WebGPU visual smoke tests were not performed. Node-side shader
generation, native reference updates and CPU uniform packing do **not** prove
hardware shader compilation, GPU upload success or pixel behavior. No packages
were published or versions bumped. Required post-merge verification: none.
