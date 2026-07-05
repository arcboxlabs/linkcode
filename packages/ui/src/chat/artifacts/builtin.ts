import { MermaidInline } from './mermaid-inline';
import { SvgInline } from './svg-inline';
import type { ArtifactKindDefinition } from './types';

/** In-process renderable kinds shipped with the registry. `markdown`/`code` are not
 * artifact kinds — they stay on Streamdown's default rendering. Sandboxed kinds
 * (html, react) arrive with CODE-62/CODE-64. */
export const BUILTIN_ARTIFACT_KINDS: readonly ArtifactKindDefinition[] = [
  {
    id: 'mermaid',
    capabilities: {
      inlineCapable: true,
      panelCapable: false,
      sandboxRequired: false,
      interactive: true,
    },
    fenceLanguages: ['mermaid'],
    Inline: MermaidInline,
  },
  {
    id: 'svg',
    capabilities: {
      inlineCapable: true,
      panelCapable: false,
      sandboxRequired: false,
      interactive: true,
    },
    fenceLanguages: ['svg'],
    Inline: SvgInline,
  },
];
