import { describe, expect, it, vi } from 'vitest';
import type { ArtifactHostActions } from '../host-actions';
import { artifactNavigationAction } from '../host-actions';

describe('artifactNavigationAction', () => {
  it('routes a video file to openVideoPreview when wired', () => {
    const openVideoPreview = vi.fn();
    const openFile = vi.fn();
    const actions: ArtifactHostActions = {
      referenceToComposer: vi.fn(),
      openFile,
      openVideoPreview,
    };
    artifactNavigationAction(actions, { kind: 'file', path: 'demo/clip.mp4' })?.();
    expect(openVideoPreview).toHaveBeenCalledWith('demo/clip.mp4');
    expect(openFile).not.toHaveBeenCalled();
  });

  it('falls back to openFile for a video when no video preview is wired', () => {
    const openFile = vi.fn();
    const actions: ArtifactHostActions = { referenceToComposer: vi.fn(), openFile };
    artifactNavigationAction(actions, { kind: 'file', path: 'demo/clip.mp4' })?.();
    expect(openFile).toHaveBeenCalledWith('demo/clip.mp4');
  });

  it('routes non-video files to openFile even when video preview is wired', () => {
    const openVideoPreview = vi.fn();
    const openFile = vi.fn();
    const actions: ArtifactHostActions = {
      referenceToComposer: vi.fn(),
      openFile,
      openVideoPreview,
    };
    artifactNavigationAction(actions, { kind: 'file', path: 'docs/PLAN.md' })?.();
    expect(openFile).toHaveBeenCalledWith('docs/PLAN.md');
    expect(openVideoPreview).not.toHaveBeenCalled();
  });

  it('returns undefined when the host wires no matching action', () => {
    const actions: ArtifactHostActions = { referenceToComposer: vi.fn() };
    expect(
      artifactNavigationAction(actions, { kind: 'file', path: 'demo/clip.mp4' }),
    ).toBeUndefined();
    expect(artifactNavigationAction(null, { kind: 'file', path: 'a.md' })).toBeUndefined();
  });
});
