import { describe, expect, it } from 'vitest';
import type { DiagramElement } from '../element-label';
import { extractMermaidLabel, extractSvgLabel } from '../element-label';

interface FakeInput {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: FakeInput[];
}

class FakeElement implements DiagramElement {
  readonly tagName: string;
  parentElement: FakeElement | null = null;
  nextElementSibling: FakeElement | null = null;
  private readonly attrs: Record<string, string>;
  private readonly text: string | null;
  private readonly childElements: FakeElement[];

  constructor({ tag, attrs = {}, text, children = [] }: FakeInput) {
    this.tagName = tag;
    this.attrs = attrs;
    this.text = text ?? null;
    this.childElements = children.map((child) => new FakeElement(child));
    for (const [i, child] of this.childElements.entries()) {
      child.parentElement = this;
      child.nextElementSibling = this.childElements[i + 1] ?? null;
    }
  }

  get firstElementChild(): FakeElement | null {
    return this.childElements[0] ?? null;
  }

  get textContent(): string | null {
    const childText = this.childElements.map((child) => child.textContent ?? '').join('');
    return `${this.text ?? ''}${childText}`;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  descendant(...path: number[]): FakeElement {
    return path.reduce<FakeElement>((el, index) => el.childElements[index], this);
  }
}

describe('extractMermaidLabel', () => {
  const root = new FakeElement({
    tag: 'div',
    children: [
      {
        tag: 'svg',
        children: [
          {
            tag: 'g',
            attrs: { class: 'node default' },
            children: [{ tag: 'span', text: '  Renderer\n  process ' }],
          },
          { tag: 'path', attrs: { class: 'edge' } },
        ],
      },
    ],
  });

  it('returns the normalized label of the nearest node group', () => {
    const clickedSpan = root.descendant(0, 0, 0);
    expect(extractMermaidLabel(clickedSpan, root)).toBe('Renderer process');
  });

  it('returns null when the click lands outside any node', () => {
    expect(extractMermaidLabel(root.descendant(0, 1), root)).toBeNull();
    expect(extractMermaidLabel(root.descendant(0), root)).toBeNull();
  });

  it('never treats the root itself as a node', () => {
    const nodeRoot = new FakeElement({ tag: 'g', attrs: { class: 'node' }, text: 'X' });
    expect(extractMermaidLabel(nodeRoot, nodeRoot)).toBeNull();
  });

  it('caps overlong labels', () => {
    const long = new FakeElement({
      tag: 'div',
      children: [{ tag: 'g', attrs: { class: 'node' }, text: 'y'.repeat(200) }],
    });
    const label = extractMermaidLabel(long.descendant(0), long);
    expect(label).toHaveLength(121);
    expect(label!.endsWith('…')).toBe(true);
  });
});

describe('extractSvgLabel', () => {
  it('prefers the nearest aria-label, then <title>, then clicked text', () => {
    const root = new FakeElement({
      tag: 'div',
      children: [
        {
          tag: 'g',
          attrs: { 'aria-label': 'Outer group' },
          children: [
            {
              tag: 'g',
              children: [{ tag: 'title', text: 'Inner title' }, { tag: 'rect' }],
            },
            { tag: 'text', text: 'Plain text' },
          ],
        },
      ],
    });

    expect(extractSvgLabel(root.descendant(0, 0, 1), root)).toBe('Inner title');
    expect(extractSvgLabel(root.descendant(0, 1), root)).toBe('Plain text');
    expect(extractSvgLabel(root.descendant(0), root)).toBe('Outer group');
  });

  it('returns null when nothing labels the click target', () => {
    const root = new FakeElement({ tag: 'div', children: [{ tag: 'rect' }] });
    expect(extractSvgLabel(root.descendant(0), root)).toBeNull();
  });
});
