import { wait } from 'foxts/wait';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a download's object URL is kept alive before it is released (see {@link downloadBlob}). */
const OBJECT_URL_TTL_MS = 60000;

/**
 * Saving a captured file goes through an anchor download rather than a system-plane call: it works
 * identically in the desktop renderer and in webview, and needs no IPC surface. The browser drops it
 * in the user's download location.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // The browser reads the URL asynchronously after the click, so revoking synchronously would race
  // an unwritten file; a generous delay releases the blob without that risk.
  void wait(OBJECT_URL_TTL_MS).then(() => URL.revokeObjectURL(url));
}

/** Wrap a base64 wire payload (images cross the wire base64-encoded, not as `data:` URLs) as a Blob. */
export function base64Blob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return new Blob([bytes], { type });
}

/** `<device> 2026-07-25 01-23-45` — a filesystem-safe stem for a capture of `deviceName`. */
export function captureFileStem(deviceName: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '-');
  return `${deviceName.replaceAll('/', '-')} ${stamp}`;
}

/** Recording containers in preference order; the first the browser can actually mux wins. */
const RECORDING_TYPES = [
  { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
] as const;

/** Resolved once — codec support is a property of the browser build, not of any render. */
let recordingType: { mimeType: string; extension: string } | null | undefined;

function pickRecordingType(): { mimeType: string; extension: string } | null {
  recordingType ??=
    typeof MediaRecorder === 'undefined'
      ? null
      : (RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type.mimeType)) ?? null);
  return recordingType;
}

export interface SimulatorRecorder {
  /** Whether a recording is currently running. */
  recording: boolean;
  /** False when the browser has no usable recording container (the button should stay hidden). */
  supported: boolean;
  /** Start recording `canvas`; the finished file downloads as `<stem>.<ext>`. */
  start: (canvas: HTMLCanvasElement, stem: string) => void;
  /** Stop and save. Safe to call when idle. */
  stop: () => void;
}

/**
 * Records the live device screen by capturing the canvas the framebuffer already paints into, so the
 * recording is codec-agnostic — it works the same whether the stream arrives as H.264 or JPEG, and
 * needs no muxer of our own. Recording stops (and saves) when the component unmounts.
 */
export function useSimulatorRecorder(): SimulatorRecorder {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const start = useCallback((canvas: HTMLCanvasElement, stem: string) => {
    if (recorderRef.current !== null) return;
    const type = pickRecordingType();
    if (type === null) return;
    // No fps argument: the stream then samples on each canvas paint, matching the device's own
    // frame delivery instead of resampling it.
    const recorder = new MediaRecorder(canvas.captureStream(), { mimeType: type.mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (chunks.length > 0) {
        downloadBlob(new Blob(chunks, { type: type.mimeType }), `${stem}.${type.extension}`);
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }, []);

  // A panel that unmounts mid-recording still saves what it captured.
  useEffect(() => stop, [stop]);

  return { recording, supported: pickRecordingType() !== null, start, stop };
}
