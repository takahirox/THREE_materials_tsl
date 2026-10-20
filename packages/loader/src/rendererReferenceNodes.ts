import { RendererReferenceNode } from 'three/webgpu';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

export function resolveRendererReferenceNode(raw: JsonValue | undefined, links?: Record<string, unknown>) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== 2 || !Object.keys(raw).every((key) => ['property', 'uniformType'].includes(key)) ||
      raw.property !== 'toneMappingExposure' || raw.uniformType !== 'float' ||
      (links && Object.keys(links).length !== 0)) return null;
  // Keep this data-only contract paired with the exporter. The native class
  // chooses the consumer's active renderer and creates its own live uniform.
  return new RendererReferenceNode('toneMappingExposure', 'float');
}
