import { HtmlInline } from './html-inline';
import { MermaidInline } from './mermaid-inline';
import { SvgInline } from './svg-inline';
import type { ArtifactKindDefinition } from './types';

const PANEL_ONLY_CAPABILITIES = {
  inlineCapable: false,
  panelCapable: true,
  sandboxRequired: false,
  interactive: false,
} as const;

/** In-process renderable kinds shipped with the registry. Inline `markdown`/`code`
 * fences are not artifact kinds — they stay on Streamdown's default rendering; the
 * `markdown`/`pdf`/`image`/`text` kinds here are the *file* artifacts the right-panel
 * viewer renders (see `artifactKindForPath`). Sandboxed kinds (html, react) arrive
 * with CODE-62/CODE-64. */
export const BUILTIN_ARTIFACT_KINDS: readonly ArtifactKindDefinition[] = [
  { id: 'markdown', capabilities: PANEL_ONLY_CAPABILITIES, fenceLanguages: [] },
  { id: 'pdf', capabilities: PANEL_ONLY_CAPABILITIES, fenceLanguages: [] },
  { id: 'image', capabilities: PANEL_ONLY_CAPABILITIES, fenceLanguages: [] },
  { id: 'text', capabilities: PANEL_ONLY_CAPABILITIES, fenceLanguages: [] },
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
  {
    id: 'html',
    capabilities: {
      inlineCapable: true,
      panelCapable: true,
      sandboxRequired: true,
      interactive: false,
    },
    fenceLanguages: ['html'],
    Inline: HtmlInline,
  },
];
