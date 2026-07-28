import { describe, expect, it } from 'vitest';
import { registerArtifactDetector, registerArtifactKind, resolveFencedArtifact } from '../registry';
import type { FencedBlock } from '../types';

function fence(language: string, code = 'graph TD;\nA-->B'): FencedBlock {
  return { language, code, isIncomplete: false };
}

describe('resolveFencedArtifact', () => {
  it('maps builtin fence languages through the baseline detector', () => {
    const resolved = resolveFencedArtifact(fence('mermaid'));
    expect(resolved).not.toBeNull();
    expect(resolved!.artifact).toMatchObject({
      kind: 'mermaid',
      detectorId: 'fenced-block',
      source: { type: 'inline', language: 'mermaid', text: 'graph TD;\nA-->B' },
    });
    expect(resolved!.definition.capabilities.inlineCapable).toBe(true);

    expect(resolveFencedArtifact(fence('svg'))!.artifact.kind).toBe('svg');
  });

  it('degrades unknown languages to a plain code block', () => {
    expect(resolveFencedArtifact(fence('python'))).toBeNull();
  });

  it('lets a registered detector take precedence over the baseline', () => {
    const unregisterKind = registerArtifactKind({
      id: 'vendor-diagram',
      capabilities: {
        inlineCapable: true,
        panelCapable: false,
        sandboxRequired: false,
        interactive: false,
      },
      fenceLanguages: [],
      Inline: () => null,
    });
    const unregisterDetector = registerArtifactDetector({
      id: 'vendor',
      detectFence: (block) =>
        block.language === 'mermaid'
          ? {
              kind: 'vendor-diagram',
              source: { type: 'inline', language: block.language, text: block.code },
              detectorId: 'vendor',
            }
          : null,
    });

    try {
      expect(resolveFencedArtifact(fence('mermaid'))!.artifact.kind).toBe('vendor-diagram');
    } finally {
      unregisterDetector();
      unregisterKind();
    }

    expect(resolveFencedArtifact(fence('mermaid'))!.artifact.kind).toBe('mermaid');
  });

  it('degrades when the detected kind cannot render inline', () => {
    const unregisterDetector = registerArtifactDetector({
      id: 'points-at-unknown-kind',
      detectFence: (block) => ({
        kind: 'not-registered',
        source: { type: 'inline', language: block.language, text: block.code },
        detectorId: 'points-at-unknown-kind',
      }),
    });

    try {
      expect(resolveFencedArtifact(fence('mermaid'))).toBeNull();
    } finally {
      unregisterDetector();
    }
  });
});

describe('registerArtifactKind', () => {
  it('rejects duplicate kind ids', () => {
    expect(() =>
      registerArtifactKind({
        id: 'mermaid',
        capabilities: {
          inlineCapable: true,
          panelCapable: false,
          sandboxRequired: false,
          interactive: false,
        },
        fenceLanguages: ['mermaid'],
      }),
    ).toThrow('already registered');
  });
});

describe('registerArtifactDetector', () => {
  it('unregisters only its own duplicate registration', () => {
    const unregisterKind = registerArtifactKind({
      id: 'duplicate-detector-kind',
      capabilities: {
        inlineCapable: true,
        panelCapable: false,
        sandboxRequired: false,
        interactive: false,
      },
      fenceLanguages: [],
      Inline: () => null,
    });
    const detector = {
      id: 'duplicate-detector',
      detectFence: (block: FencedBlock) => ({
        kind: 'duplicate-detector-kind',
        source: { type: 'inline' as const, language: block.language, text: block.code },
        detectorId: 'duplicate-detector',
      }),
    };
    const unregisterFirst = registerArtifactDetector(detector);
    const unregisterSecond = registerArtifactDetector(detector);

    try {
      unregisterSecond();
      expect(resolveFencedArtifact(fence('mermaid'))!.artifact.kind).toBe(
        'duplicate-detector-kind',
      );
    } finally {
      unregisterFirst();
      unregisterSecond();
      unregisterKind();
    }

    expect(resolveFencedArtifact(fence('mermaid'))!.artifact.kind).toBe('mermaid');
  });
});
