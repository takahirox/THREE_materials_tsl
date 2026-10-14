# THREE_materials_tsl

glTF Vendor Extension — Draft v2.0

Demo: https://takahirox.github.io/THREE_materials_tsl/

## Contributing

Use English for new collaboration content. Follow the [development flow](docs/development-flow.md)
and [review and merge guidelines](docs/review-guidelines.md). AI agents should start with
[AGENTS.md](AGENTS.md). Use the [Issue template](.github/ISSUE_TEMPLATE/issue.md)
and [Pull Request template](.github/pull_request_template.md).

## Plugins

Reference implementations for Three.js are available as separate packages:

- Loader plugin: https://www.npmjs.com/package/@takahirox/gltf-three-materials-tsl-loader
- Exporter plugin: https://www.npmjs.com/package/@takahirox/gltf-three-materials-tsl-exporter

Install:

```sh
npm install @takahirox/gltf-three-materials-tsl-loader @takahirox/gltf-three-materials-tsl-exporter
```

## Status

* **Draft**
* Vendor extension for **Three.js**
* Not ratified by Khronos
* Subject to change

## Overview

`THREE_materials_tsl` is a vendor-specific glTF extension that allows
`Three.js TSL / NodeMaterial` graphs to be serialized into glTF
without embedding or executing JavaScript code.

The extension stores a NodeMaterial type identifier and a node graph as
declarative JSON. A compatible Three.js consumer resolves the material type
and each node operation through consumer-provided mappings and reconstructs
the graph by wiring references described in the extension. The reconstructed
NodeMaterial retains the ordinary material properties represented by glTF
and supported non-`THREE_materials_tsl` material extensions.

This extension is a serialization container, not a general-purpose
shading language specification.

## Motivation

[`Three.js TSL`](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) is
typically authored and executed as JavaScript code.
While flexible, embedding or evaluating JavaScript source inside glTF
is undesirable for security, portability, and tooling reasons.

`THREE_materials_tsl` provides a minimal, data-only representation of a
TSL node graph that can be safely stored in glTF and reconstructed by a
compatible Three.js runtime.

## Design Goals

* Serialize `TSL / NodeMaterial` graphs without eval
* Use pure JSON data only
* Enable round-tripping in Three.js (TSL → glTF → TSL)
* Keep the specification minimal and implementation-driven

## Design Rationale

The design is **Three.js-first, with minimal implementation**: reuse the existing
Three.js node model and serialization facilities wherever practical. Keep the
extension and its supporting implementations focused on transporting node data
and resolving references, rather than reimplementing Three.js node semantics.

The extension defines a declarative, data-only container for the NodeMaterial
type, node identifiers, literal arguments, links, and material entrypoints.
A compatible Three.js consumer resolves `materialType` to a supported NodeMaterial
class, resolves `op` identifiers, and interprets node-specific arguments and
semantics using registries, resolvers, or equivalent mappings. No specific
built-in Three.js registry API or consumer resolver API is required by this
specification, and no fixed catalog of NodeMaterial classes is specified.

The glTF material and its supported non-`THREE_materials_tsl` extensions provide
ordinary material properties; this extension adds the TSL graph to the resolved
NodeMaterial. Node-versus-property behavior follows Three.js NodeMaterial
semantics. The extension introduces no new priority or shading-composition rule
and does not prescribe a construction or property-transfer sequence.

Leaving operation semantics implementation-defined allows the extension to follow
evolving Three.js / TSL APIs and support consumer-provided custom nodes without
revising the glTF extension for every node or shader semantic. The specification
therefore does not standardize an operation catalog or constructor signatures.
Reusing Three.js behavior reduces duplication, keeps the specification and
loader/exporter implementation surface small, and eases maintenance as Three.js evolves.

The [reference serializer](packages/exporter/src/defaultNodeSerializer.ts)
illustrates this reuse with node serialization via `serialize()` and child discovery
via `getSerializeChildren()` where suitable. These are implementation examples,
not APIs required by this specification.

Interpretation depends on the consumer and its Three.js environment. Full
portability across Three.js versions, configurations, or other engines is not
guaranteed. Version differences, unsupported nodes, and node-specific serialization
details may still require explicit adapters. Minimal implementation is a design
goal, not a guarantee of zero conversion code or cross-version interoperability.

## Non-Goals

This extension does not attempt to provide:

* Cross-engine or cross-runtime compatibility
* Standardized shader semantics
* MaterialX or KHR_* compatibility
* Embedded GLSL / WGSL / HLSL source code
* Full semantic validation of node graphs

## Extension Placement

The extension MUST be defined under a glTF material:

```javascript
materials[i].extensions.THREE_materials_tsl
```

Standard glTF material properties and supported non-`THREE_materials_tsl`
material extensions MUST be preserved. When applying this extension, their
corresponding material values MUST be available as ordinary properties of the
resolved NodeMaterial, in addition to the serialized TSL entrypoints and graph.
These properties are not merely a fallback appearance.

A consumer without TSL support uses the ordinary glTF material, including its
other supported material extensions, as the fallback. A consumer that cannot
apply this extension MUST use the same fallback as described in
[Consumer Requirements](#consumer-requirements).

## Top-Level Object

### Required Properties

* version (string): Extension encoding version
* materialType (string): Original Three.js NodeMaterial type identifier
* entrypoints (object): Slot name → nodeId mapping
* nodes (object): Node dictionary

### Optional Properties

* three (object): Three.js metadata (non-normative)
* compat (object): Compatibility hints (non-normative)

### Structure

```json
{
  "version": "2.0",
  "materialType": "MeshStandardNodeMaterial",
  "three": { "revision": "r160" },
  "entrypoints": { "colorNode": "outColor" },
  "nodes": {
    "outColor": {
      "op": "ConstNode",
      "args": { "value": [1, 0, 0], "valueType": "color" }
    }
  },
  "compat": {}
}
```

### version

version specifies the extension encoding version, including the material type
and node graph representation. This draft uses `"2.0"`. Implementations MUST
ignore the entire extension for a material if its version is not supported and
use the ordinary glTF material, including other supported material extensions,
as fallback.

Draft v2.0 introduces the required `materialType` field as a breaking change
from Draft v1.0. Existing `"1.0"` data is not valid v2.0 data, and changing only
its version to `"2.0"` does not satisfy the new requirement. A consumer MAY
separately support the earlier v1.0 encoding under its original rules; this
draft does not redefine v1.0 or implicitly supply a missing material type.
A consumer that does not support v1.0 MUST ignore its entire extension for the
material and use the ordinary glTF fallback, including other supported material
extensions. Consumers that only support v1.0 likewise cannot apply v2.0 data.

### materialType

materialType MUST be a non-empty string identifying the original Three.js
NodeMaterial type. Built-in types can use names such as
`"MeshStandardNodeMaterial"` or `"MeshPhysicalNodeMaterial"`, consistent with
`material.type`.

A compatible consumer MUST resolve this identifier to a supported, usable
NodeMaterial class. Custom NodeMaterial types MAY be supported through
consumer-provided mappings. This specification requires neither a fixed class
catalog nor a particular resolver API.

If materialType is missing, invalid, unknown, or cannot be resolved to a usable
NodeMaterial class, the consumer MUST ignore the entire extension for that
material and use the ordinary glTF fallback, including other supported material
extensions. It MUST NOT infer a replacement type and partially apply the graph.

### three (optional)

The optional three object provides informational metadata about the Three.js
version used to author the material.

This information is intended for debugging and tooling purposes only.
Implementations MUST NOT require this information to match the runtime Three.js
version in order to interpret the extension.

#### three.revision (optional)

A string representing the Three.js revision (for example, "r160").
This hint does not guarantee compatibility or change the consumer's responsibility
to resolve operations in its own Three.js environment.

## Entry Points

### Definition

entrypoints is a dictionary mapping implementation-defined slot names
to node identifiers.

Example:

```json
"entrypoints": {
  "colorNode": "outColor",
  "positionNode": "outPosition"
}
```

* Keys are strings
* Values MUST reference a nodeId defined in nodes
* At least one entrypoint MUST be present

### Semantics

The meaning of entrypoint keys is implementation-defined.

A Three.js consumer MAY apply entrypoints by assigning:

```javascript
material[slotName] = resolvedNode
```

Entry point keys are expected to correspond to NodeMaterial properties,
but this specification does not standardize or restrict them.

The serialized entrypoints and node graph MUST coexist with the NodeMaterial's
ordinary properties supplied by the glTF material and its other supported
material extensions. Their interaction, including node-versus-property
precedence, follows Three.js NodeMaterial semantics; this extension defines no
additional priority or shading-composition rule.

A TSL node such as `materialColor` can retain its dynamic reference to
`material.color`. Consumers MUST preserve that Three.js behavior when
reconstructing the graph, rather than substitute a fixed value for the dynamic
reference.

---

## Node Dictionary

### Node Identifiers

Each node is identified by a nodeId, which MUST be unique within the
nodes object.

### Node Definition

A node definition object contains:

* op (required): Consumer-resolved node operation identifier
* args (optional): JSON literal arguments
* links (optional): Input references

## Operations (op)

* op MUST be a string identifying a node known to the consumer through its
  registry, resolver, or equivalent mapping.
* No fallback resolution mechanism is defined.
* If an op cannot be resolved, the entire extension for that material MUST be
  ignored, using the ordinary glTF material and its other supported extensions
  as fallback.

All operation semantics are delegated to the compatible Three.js consumer.

### op name conventions (non-normative)

Implementations MAY use two forms:

* **Node class names** (e.g. `ConstNode`, `MathNode`, `OperatorNode`) which are instantiated with `args` and `links`.
* **Shared TSL instances** (e.g. `time`, `positionLocal`, `normalView`) which are resolved to existing TSL node objects.

Using shared instance names preserves runtime semantics for built-in nodes.

## Arguments (args)

* args MUST contain only JSON literal values
* Executable code or expressions are not representable

args carries JSON-compatible node-specific data. Its interpretation remains
implementation-defined and is delegated to the consumer and Three.js; this extension
does not standardize a per-node argument schema or duplicate the node's
serialization semantics.

## Links (links)

links describes how node inputs are wired.

Links reflect the node's existing property and child relationships, including
array/object structures. The extension defines how references to nodes, textures,
and accessors are encoded; the consumer resolves them according to the node model.
The extension does not redefine each node's input semantics.

### Link Value Forms

links values MAY be nested structures to support array/object node inputs.

Allowed link value forms:

* Node reference: `{ "$ref": "nodeId" }`
* Texture reference: `{ "$refTex": n }`
* Accessor reference: `{ "$refAccessor": n }`
* Array of link values: `[ linkValue, ... ]`
* Object of link values: `{ "key": linkValue, ... }`

Texture references point to `glTF.textures[n]`.
Accessor references point to `glTF.accessors[n]`.

The consumer is expected to resolve these references to runtime objects
such as `THREE.Texture` or `BufferAttribute`.

Example fragment with array/object links (top-level version and materialType
omitted):

```json
{
  "nodes": {
    "n0": {
      "op": "OutputStructNode",
      "links": {
        "members": [
          { "$ref": "n1" },
          { "$ref": "n2" }
        ],
        "params": {
          "tint": { "$ref": "n3" }
        }
      }
    },
    "n1": { "op": "ConstNode", "args": { "value": 0.25, "valueType": "float" } },
    "n2": { "op": "ConstNode", "args": { "value": 0.75, "valueType": "float" } },
    "n3": { "op": "ConstNode", "args": { "value": [1, 0, 0], "valueType": "color" } }
  },
  "entrypoints": {
    "colorNode": "n0"
  }
}
```

## Compatibility Hints (compat)

compat MAY be provided for diagnostics and tooling.

All fields are hints only and MAY be ignored by consumers.

## Consumer Requirements

A consumer applying this extension MUST resolve materialType to a usable
NodeMaterial class whose ordinary properties retain the corresponding values
from the glTF material and supported non-`THREE_materials_tsl` material
extensions, with the serialized TSL entrypoints and graph applied in addition.
These requirements describe the result, not an implementation sequence.

A consumer MUST ignore the entire `THREE_materials_tsl` extension for the
affected material and fall back to the ordinary glTF material, including other
supported material extensions, if:

* The extension version is unsupported
* A required field is missing or invalid (including an empty entrypoints object)
* materialType is unknown or cannot be resolved to a usable NodeMaterial class
* An entrypoint references a non-existent nodeId
* A reference points to a missing nodeId
* A graph cycle is detected
* An op cannot be resolved
* A texture or accessor index is out of range
* Any other graph reconstruction error prevents applying the extension

Fallback MUST leave no partially applied TSL nodes or entrypoints from this
extension on the material. Ignoring `THREE_materials_tsl` MUST NOT discard the
ordinary glTF material or its other supported material extensions.

## Security Considerations

* No executable code is embedded
* No dynamic evaluation is required
* All content is declarative data
