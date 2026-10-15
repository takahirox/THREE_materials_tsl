import type { Node } from 'three/webgpu';

const containsNode = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (!value || typeof value !== 'object') return false;
  if ((value as Node).isNode === true) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  return (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype) &&
    Object.values(value).some((child) => containsNode(child, seen));
};

export function validateNodeLinks(node: Node, inputs: string[]) {
  // Three.js discovery skips private properties and self references. Inspect
  // own fields too, including nested containers, so attached graphs cannot vanish.
  for (const { property } of node.getSerializeChildren()) {
    if (!inputs.includes(property)) throw new Error(`Unsupported ${node.type} link "${property}"; supply explicit adapters`);
  }
  for (const [property, value] of Object.entries(node)) {
    // TSLCore caches derived swizzles/array accesses here during shader builds;
    // these are runtime memoization, not inputs or before() attachments.
    if (property === '_cache') continue;
    if (!inputs.includes(property) && containsNode(value)) {
      throw new Error(`Unsupported ${node.type} link "${property}"; supply explicit adapters`);
    }
  }
}
