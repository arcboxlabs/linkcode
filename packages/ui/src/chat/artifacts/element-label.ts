/** Label extraction for click-to-composer, written against a structural subset of
 * `Element` so the walking logic stays unit-testable without a DOM. */
export interface DiagramElement {
  readonly tagName: string;
  readonly parentElement: DiagramElement | null;
  readonly firstElementChild: DiagramElement | null;
  readonly nextElementSibling: DiagramElement | null;
  readonly textContent: string | null;
  getAttribute: (name: string) => string | null;
}

const MAX_LABEL_LENGTH = 120;

/** Mermaid groups its clickable shapes under `<g>` elements carrying these classes
 * (flowchart nodes, sequence actors, subgraph clusters, gantt tasks, edge labels). */
const MERMAID_NODE_CLASSES = new Set(['node', 'actor', 'cluster', 'task', 'edgeLabel']);

function normalizeLabel(raw: string | null): string | null {
  const label = raw?.replaceAll(/\s+/g, ' ').trim();
  if (!label) return null;
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH)}…` : label;
}

function hasMermaidNodeClass(el: DiagramElement): boolean {
  const classAttr = el.getAttribute('class');
  if (!classAttr) return false;
  return classAttr.split(/\s+/).some((cls) => MERMAID_NODE_CLASSES.has(cls));
}

/** Walk from the clicked element up to (excluding) the diagram root and return the
 * label of the nearest mermaid node group, or null when the click hit no node. */
export function extractMermaidLabel(target: DiagramElement, root: DiagramElement): string | null {
  for (let el: DiagramElement | null = target; el && el !== root; el = el.parentElement) {
    if (el.tagName.toLowerCase() === 'g' && hasMermaidNodeClass(el)) {
      return normalizeLabel(el.textContent);
    }
  }
  return null;
}

function directTitleText(el: DiagramElement): string | null {
  for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
    if (child.tagName.toLowerCase() === 'title') return child.textContent;
  }
  return null;
}

const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'textpath']);

/** Walk from the clicked element up to (excluding) the svg root; the nearest labeled
 * element wins. Per element: `aria-label`, then `<title>`, then a text element's own
 * content. */
export function extractSvgLabel(target: DiagramElement, root: DiagramElement): string | null {
  for (let el: DiagramElement | null = target; el && el !== root; el = el.parentElement) {
    const label =
      normalizeLabel(el.getAttribute('aria-label')) ??
      normalizeLabel(directTitleText(el)) ??
      (SVG_TEXT_TAGS.has(el.tagName.toLowerCase()) ? normalizeLabel(el.textContent) : null);
    if (label) return label;
  }
  return null;
}
