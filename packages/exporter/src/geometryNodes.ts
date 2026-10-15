import { BackSide } from 'three';
import { NodeBuilder } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { JsonValue, NodeExport } from './types.js';
import { validateNodeLinks } from './nodeLinks.js';

// Paired with loader/geometryNodes.ts. Scope data selects native Three.js
// behavior; it never supplies shader calculations or a camera/renderer binding.
const scopes: Record<string, string[]> = {
  IndexNode: ['vertex', 'instance', 'draw'],
  ScreenNode: ['coordinate', 'viewport', 'size', 'uv'],
  ViewportDepthNode: ['depth', 'linearDepth'],
  FrontFacingNode: []
};
export const isGeometryNodeOp = (op: string) => Object.prototype.hasOwnProperty.call(scopes, op);
const check = (valid: unknown, message = 'Invalid or unsupported geometry/screen node arguments or links; supply paired adapters') => {
  if (!valid) throw new Error(message);
};

function validateArgs(op: string, args: Record<string, unknown>) {
  const fields = ['nodeType', 'name', 'global', 'parents', ...(op === 'FrontFacingNode' ? [] : ['scope'])];
  check(Object.keys(args).every((key) => fields.includes(key)));
  check(op === 'FrontFacingNode' || scopes[op].includes(args.scope as string),
    `Unsupported ${op} scope "${String(args.scope)}"; see the geometry-node audit or supply paired adapters`);
  check(args.nodeType === (op === 'IndexNode' ? 'uint' : op === 'FrontFacingNode' ? 'bool' : op === 'ViewportDepthNode' ? 'float' : null));
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
}

const defaults = new WeakSet<object>();
export function validateGeometryMaterial(node: object, material: { side: number }) {
  // glTF only stores doubleSided. BackSide becomes FrontSide on native import,
  // which changes FrontFacingNode's explicit false branch. Never hide that loss.
  if (defaults.has(node) && (node as Node).type === 'FrontFacingNode') {
    check(material.side !== BackSide, 'Unsupported FrontFacingNode on BackSide: native glTF loses the material side; supply paired material adapters');
  }
}

export function serializeGeometryNode(value: object): NodeExport | null {
  const node = value as Node & Record<string, unknown>;
  if (!isGeometryNodeOp(node.type)) return null;
  check(Object.prototype.hasOwnProperty.call(node.constructor, 'type'));
  const args: Record<string, JsonValue> = {};
  for (const key of ['nodeType', 'name', 'global', 'parents', ...(node.type === 'FrontFacingNode' ? [] : ['scope'])]) {
    args[key] = node[key] as JsonValue;
  }
  validateArgs(node.type, args);
  // ScreenNode.setup() changes updateType to RENDER for these two scopes.
  // Allow native pre/post-build states, but never app-defined update behavior.
  const renderUpdate = node.type === 'ScreenNode' && ['size', 'viewport'].includes(node.scope as string);
  check(node.updateType === 'none' || (renderUpdate && node.updateType === 'render'));
  check(node.updateBeforeType === 'none' && node.updateAfterType === 'none');
  for (const key of ['camera', 'renderer', 'renderTarget', ...(node.type === 'FrontFacingNode' ? ['scope'] : [])]) {
    check(!Object.prototype.hasOwnProperty.call(node, key));
  }
  const inputs = node.type === 'ViewportDepthNode' && node.scope === 'linearDepth' ? ['valueNode'] : [];
  validateNodeLinks(node, inputs);
  const links: Record<string, unknown> = {};
  if (node.type === 'ViewportDepthNode') {
    // DEPTH ignores its valueNode natively. Reject it instead of losing a link.
    check(node.valueNode === null || (inputs.length > 0 && (node.valueNode as Node)?.isNode === true));
    if (node.valueNode !== null) links.valueNode = { node: node.valueNode };
  }
  // All four classes inherit Node.serialize(): only children are saved upstream.
  // Preseed the native cache to leave traversal/identity/cycles to the writer.
  const nodes = Object.fromEntries([...node.getSerializeChildren()].map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  node.serialize({ meta: { nodes, textures: {}, images: {} } } as never);
  validateDepthInput(node);
  defaults.add(node);
  return { op: node.type, args, links };
}

// This conversion expects scalar ordinary depth, not a renderer resource or a
// vector silently truncated by shader formatting. Context-dependent inference
// needs an explicit consumer adapter, as with the other typed default adapters.
function validateDepthInput(value: object) {
  const node = value as Node & { valueNode?: Node | null };
  if (node.type !== 'ViewportDepthNode' || node.valueNode === null) return;
  check(node.valueNode?.isNode === true);
  const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder;
  check(node.valueNode!.getNodeType(new TypeBuilder()) === 'float');
}
