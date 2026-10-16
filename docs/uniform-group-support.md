# UniformNode group links (Issue #27)

## Source audit and stable baseline

Audited installed **three@0.186.1** (r186) source and the bundled `three/tsl`
stack. On **2026-10-16**, `npm view three version` returned 0.186.1 and the
[latest GitHub release](https://github.com/mrdoob/three.js/releases/tag/r186)
was r186 (published September 24). The
[npm stable metadata](https://registry.npmjs.org/three/latest) agreed. No dependency,
package version or Draft v2.0 change is needed. This audit does not establish
compatibility with every version in the existing peer range.

| Native source | Audited behavior and consequence |
| --- | --- |
| [UniformNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformNode.js) | Constructor sets `name: ''` and `groupNode: objectGroup`; `setGroup()` assigns that reference, and `getGroup()` returns it. Shader generation obtains a native uniform from its shared-node hash and current group. No serialize/deserialize override exists. |
| [InputNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/InputNode.js) | Native serialization/deserialization owns value, valueType, nullable nodeType and precision. Values remain export-time snapshots; selecting a group does not reconnect an external application value or callback. |
| [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js) and [NodeUtils](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeUtils.js) | `getSerializeChildren()` discovers public node-valued properties, including groupNode. `serialize()` stores child UUIDs and `deserialize()` resolves them through metadata. Traversal skips private fields and self links; the existing writer still checks those and owns graph IDs, reuse and cycles. `needsUpdate = true` increments version. IDs, UUIDs, versions and build caches are runtime state. |
| [UniformGroupNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformGroupNode.js) | Constructor is `(name, shared = false, order = 1, updateType = null)`. `uniformGroup()` constructs a nonshared group; `sharedUniformGroup()` defaults order to 0. Native serialize/deserialize saves name, shared and **runtime version**, but omits **order and updateType**. A generic native JSON round trip therefore cannot restore all constructor behavior. Native `update()` increments version through needsUpdate. |
| [NodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeBuilder.js) | Bindings are collected by group name; sortBindingGroups orders by the first binding's group.order. Shared binding reuse also checks exact group identity and uniform node IDs in the current render context. Same names alone do not establish the same ownership. Build discovery includes groups in the native update list. |
| [GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js) and [WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js) | Both collect numeric uniforms into uniform buffers keyed by group.name. A previously encountered group with that name can own later uniforms. GLSL emits named uniform blocks; WGSL emits uniform structs/variables and binding indices. Names and order are renderer-visible configuration, not arbitrary labels. |
| [NodeBuilderState](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/nodes/NodeBuilderState.js) | createBindings reuses shared bind groups and clones nonshared groups for each render object. The clone still references the native group node. |
| [NodeFrame](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeFrame.js) | updateNode caches FRAME updates by frameId and RENDER updates by renderId; OBJECT updates run for each object invocation. A group's update bumps its version; it does not change the UniformNode value or install a value callback. |
| [NodeManager](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/nodes/NodeManager.js) and [Bindings](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Bindings.js) | updateGroup always allows OBJECT updates. Other groups compare version per group-node/binding pair. Bindings uses this gate before native value packing/upload, including the shared-buffer path. Version counters, packed buffers, device resources and renderer caches must remain live and must not be frozen into graph arguments. |

## Exact default support

Only ordinary native UniformNode instances are expanded by this issue. The
existing literal value/type/precision domain is unchanged. Bundled and ordinary
source-module UniformNode instances are accepted; imports use the bundled native
constructor, on the same stack as `three/tsl`.

| Exact `three/tsl` object | Native name | shared | order | updateType | File representation |
| --- | --- | --- | --- | --- | --- |
| `objectGroup` | object | false | 1 | object | Default UniformNode omits its group link. Explicit import links are accepted and normalized to omission on re-export. |
| `renderGroup` | render | true | 0 | render | UniformNode.links.groupNode references one `{ "op": "renderGroup" }` definition. |
| `frameGroup` | frame | true | 0 | frame | UniformNode.links.groupNode references one `{ "op": "frameGroup" }` definition. |

These are shared **TSL exports**; objectGroup's native `shared` flag is **false**.
Import returns the actual TSL objects, never new groups with similar settings.
The exporter uses native child discovery and value serialization, pre-seeding
child UUID metadata so the existing graph writer controls traversal and identity.
Two uniforms referencing one group emit one definition within a material graph;
repeated uniform inputs and entrypoints retain their own graph sharing. Across
materials the exact three group objects still have singleton identity. Ordinary
non-singleton graph nodes retain the existing per-material reconstruction boundary.

Unchanged default output remains valid. The previously accepted source-module
objectGroup default is also omitted; import uses bundled TSL objectGroup. Distinct
source-module renderGroup/frameGroup objects are not the exact TSL exports and
require adapters. This avoids treating any lookalike as a native singleton.

Group operations take **no args and no nonempty links**. UniformNode args remain
exactly value/valueType/nodeType/precision. Its only optional link is a single
`groupNode: { "$ref": "id" }`; absence or an empty link dictionary retains the
native default. The hydrated target must be one of the exact three objects.
Groups are not copied, deserialized into, or mutated during import.

Export checks unchanged native group configuration even when omitting the default
link. Ordinary uniforms must have native default name/global/parents and lifecycle
state; unexpected own fields, links, callbacks and subclasses (including forged
static type IDs) fail. Group runtime versions may advance naturally and are never
serialized. Node IDs/UUIDs, caches and diagnostic stack traces are omitted.
Native group scheduling stays Three.js-owned. Imported values remain mutable;
`setGroup(frameGroup)` controls buffer update frequency, not a new per-frame
value callback. Shared `time` and other preexisting TSL exports retain native behavior.

**UniformArrayNode is unchanged:** its bounded adapter still accepts only its
native default object group and its native per-render array update behavior.
This issue does not enable render/frame/custom groups on arrays or arbitrary buffers.

## Independently constructed groups: audited and deferred

No independent UniformGroupNode variant is added to the default allowlist.
Export rejects them, including ordinary native constructors, `uniformGroup()`,
`sharedUniformGroup()`, and independent copies of the built-in configuration.
Import rejects the `UniformGroupNode` op. This is a deliberate boundary, not an
attempt to approximate an unsupported group with objectGroup.

| Deferred variant | Concrete ambiguity and consumer-owned path |
| --- | --- |
| Arbitrary nonshared name, order and object updates | Both builders use a name-keyed map, not an identity-keyed map. Names must coexist with native object/render/frame, internal groups and other application adapters; merely validating a shader identifier does not prevent collisions. Order changes binding indices. An application must reserve names, validate collisions and own ordering before installing these groups. |
| Independent copies named object/render/frame, even with matching flags | A copy is not the native identity. A builder can combine its uniforms under an earlier group with the same name; shared-group checks, version ownership and binding reuse then depend on what was encountered first. Default adapters must not replace the copy with a singleton or promise an independent renderer group from its identity alone. |
| shared=true, with frame/render/object updateType | Reuse spans uniform identities and render contexts, while file graphs reconstruct ordinary nodes per material. Restoring cross-material/global ownership needs an external group registry and an explicit lifetime/identity contract, not a constructor per node definition. |
| null/none or other manually driven updateType | Initial upload can occur, but later uploads depend on application-owned needsUpdate/version changes. Snapshotting a version does not restore the scheduler or the owner that advances it. Bind a known application group with explicit invalidation ownership. |
| Custom orders, lifecycle methods, callbacks, before/after updates, subclasses | Native JSON omits order/updateType, and executable behavior cannot be transported. A data-only variant needs a paired constructor/configuration allowlist, renderer/name validation and an installed behavior binding. No source, closures or scheduler may be embedded in the file. |

Use the existing serializer/resolver override APIs with an application-specific
operation such as `AppUniform` and a validated **group binding ID** in its args.
A consumer-maintained registry maps that ID to the existing native group, with
reserved shader names, order, shared flags and lifecycle ownership validated out
of band. Its resolver creates a native UniformNode and calls native `setGroup()`
with that bound object. Multiple uniforms/materials use the same registry entry
when identity sharing is intended. The paired exporter must check the complete
uniform value/state and registered group identity; the resolver must reject
unknown IDs/fields/link shapes. This is consumer-supplied code, never executable
file data. Separate group operations can also use a validated registry binding;
they must not acquire file-supplied links or silently allocate global identities.
No parallel uniform scheduler or renderer configuration is installed by this plugin.

## Failure behavior and validation

Malformed links, non-group targets, unknown group args/ops/fields, dangling
references, cycles and invalid unreachable definitions reject the **entire**
material extension before publication. The existing loader retains ordinary
material properties, physical KHR extensions, shared materials, primitive clones
and dependency caches. Unknown fields on graph node definitions are rejected
rather than ignored. Custom adapters still use the existing explicit override API.

The [group suite](../packages/demo/test/uniformGroups.test.js) covers all three
groups with bundled/source UniformNodes through two real GLTFExporter → GLTFLoader
round trips, in JSON glTF and GLB. It checks default omission, explicit default
imports, repeated references, material entrypoints, singleton identity across
materials, ordinary material coexistence and shared time. Negative cases cover
independent/forged/subclass groups and uniforms, custom callbacks, altered native
singletons, unexpected state, malformed/missing/extra links and lifecycle fields,
invalid graph references and unreachable definitions. Fallback compares every
ordinary material field with a plugin-disabled load (excluding IDs and extension
bookkeeping), including physical extension values and all graph entrypoints.

Native GLSL and WGSL setup/analyze/generate flow and declarations are compared in
vertex and fragment stages. Native binding checks verify order 0 before order 1,
shared buffer reuse, per-object binding cloning and live values in packed upload
buffers. Native NodeFrame and NodeManager checks verify repeated objects within
one render, two renders within one frame, and a subsequent frame, observing both
version changes and the native binding update gate. Runtime updates can precede
re-export without emitting versions or replacing the groups.

These Node-side checks do **not** compile GPU programs, execute device uploads,
validate hardware limits or establish rendered pixels. Optional browser WebGL and
WebGPU smoke tests were not run. Required post-merge verification: none.

### Check results (2026-10-16)

| Command from repository root | Actual outcome |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/exporter ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/demo ci` | Passed; 10 existing advisories (3 moderate, 5 high, 2 critical). Dependencies and locks were not changed. |
| `npm --prefix packages/demo test` | Passed: 8 files, **1,157 tests**, including **128 uniform-group tests**, no skips. Existing texture-packing tests emit native exporter warnings. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite warned about the minified chunk exceeding 500 kB. |
| `git diff --check` / `git diff --cached --check` | Passed. |
| Browser WebGL/WebGPU smoke tests | Not run (optional); CPU flow/binding/lifecycle checks do not establish device execution or rendered pixels. |

No push, PR, merge, comment, package publication, version bump or post-merge action
was performed.
