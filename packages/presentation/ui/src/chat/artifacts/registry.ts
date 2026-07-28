import { BUILTIN_ARTIFACT_KINDS } from './builtin';
import type {
  ArtifactKindDefinition,
  ArtifactSyntaxDetector,
  FencedBlock,
  InlineArtifact,
} from './types';

const kinds = new Map<string, ArtifactKindDefinition>(
  BUILTIN_ARTIFACT_KINDS.map((definition) => [definition.id, definition]),
);

/** Baseline detector: fence language → registered kind. Markdown fences already cover every
 * agent's natural output, so it's the only detector until vendor syntaxes (CODE-64) register. */
const BASELINE_DETECTOR_ID = 'fenced-block';

const baselineDetector: ArtifactSyntaxDetector = {
  id: BASELINE_DETECTOR_ID,
  detectFence(block) {
    for (const definition of kinds.values()) {
      if (definition.fenceLanguages.includes(block.language)) {
        return {
          kind: definition.id,
          source: { type: 'inline', language: block.language, text: block.code },
          detectorId: BASELINE_DETECTOR_ID,
        };
      }
    }
    return null;
  },
};

let detectors: ArtifactSyntaxDetector[] = [baselineDetector];

export function getArtifactKind(id: string): ArtifactKindDefinition | undefined {
  return kinds.get(id);
}

/** Kinds are consulted per fence render, so a registration applies from the next render on. */
export function registerArtifactKind(definition: ArtifactKindDefinition): () => void {
  if (kinds.has(definition.id)) {
    throw new Error(`artifact kind "${definition.id}" is already registered`);
  }
  kinds.set(definition.id, definition);
  return () => {
    kinds.delete(definition.id);
  };
}

/** Later registrations take precedence over the baseline (vendor syntaxes are more
 * specific than the generic fence mapping). */
export function registerArtifactDetector(detector: ArtifactSyntaxDetector): () => void {
  detectors = [detector, ...detectors];
  return () => {
    const index = detectors.indexOf(detector);
    if (index !== -1) detectors = detectors.toSpliced(index, 1);
  };
}

export interface ResolvedInlineArtifact {
  artifact: InlineArtifact;
  definition: ArtifactKindDefinition;
}

/** Run detectors over a fence (first match wins). Returns null — degrade to a plain
 * code block — when nothing matches or the matched kind cannot render inline. */
export function resolveFencedArtifact(block: FencedBlock): ResolvedInlineArtifact | null {
  for (const detector of detectors) {
    const artifact = detector.detectFence(block);
    if (!artifact) continue;
    const definition = kinds.get(artifact.kind);
    if (!definition?.capabilities.inlineCapable || !definition.Inline) return null;
    return { artifact, definition };
  }
  return null;
}
