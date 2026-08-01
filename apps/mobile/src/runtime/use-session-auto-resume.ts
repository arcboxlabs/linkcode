import { useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionStatus } from '@linkcode/schema';
import { useFocusEffect } from 'expo-router';
import { noop } from 'foxact/noop';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Desktop parity for opening a stopped session: resume once when the screen first observes the
 * session, and retry a failed cold resume when the screen next focuses. Call `stop` after the
 * caller has suppressed auto-resume (e.g. via route params) so an explicit stop stays stopped.
 */
export function useSessionAutoResume(
  sessionId: SessionId | null,
  status: SessionStatus | undefined,
  autoResumeSuppressed: boolean,
): {
  stop: () => void;
} {
  const client = useLinkCodeClient();
  const observedSessionRef = useRef<SessionId | null>(null);
  const resumeInFlightRef = useRef<SessionId | null>(null);
  const resumePromiseRef = useRef<Promise<unknown> | null>(null);
  const resumeFailedRef = useRef<SessionId | null>(null);

  const resume = useCallback(
    (id: SessionId) => {
      if (autoResumeSuppressed || resumeInFlightRef.current === id) return;
      resumeInFlightRef.current = id;
      resumeFailedRef.current = null;
      const promise = client
        .resumeSession(id)
        .catch(() => {
          resumeFailedRef.current = id;
        })
        .finally(() => {
          if (resumeInFlightRef.current === id) resumeInFlightRef.current = null;
          if (resumePromiseRef.current === promise) resumePromiseRef.current = null;
        });
      resumePromiseRef.current = promise;
    },
    [autoResumeSuppressed, client],
  );

  const stop = useCallback(() => {
    if (!sessionId) return;
    resumeFailedRef.current = null;
    void client.stopSession(sessionId).catch(noop);
    // A stop that races an in-flight resume must re-issue after the resume settles.
    const pendingResume = resumePromiseRef.current;
    if (pendingResume) {
      void pendingResume.finally(() => {
        void client.stopSession(sessionId).catch(noop);
      });
    }
  }, [client, sessionId]);

  useEffect(() => {
    if (autoResumeSuppressed) resumeFailedRef.current = null;
  }, [autoResumeSuppressed]);

  // The daemon re-broadcasts open asks to attachers — a reopened app regains pending approvals.
  // A failed cold resume retries when the screen next focuses.
  useFocusEffect(
    useCallback(() => {
      if (
        sessionId &&
        !autoResumeSuppressed &&
        status === 'stopped' &&
        resumeFailedRef.current === sessionId
      ) {
        resume(sessionId);
      }
    }, [autoResumeSuppressed, resume, sessionId, status]),
  );

  // Opening a stopped session resumes it silently, once. Mark every opened session as observed,
  // including running ones, so an explicit later Stop does not immediately wake it again.
  useEffect(() => {
    if (!sessionId || status === undefined || observedSessionRef.current === sessionId) return;
    observedSessionRef.current = sessionId;
    resumeFailedRef.current = null;
    if (!autoResumeSuppressed && status === 'stopped') resume(sessionId);
  }, [autoResumeSuppressed, resume, sessionId, status]);

  return { stop };
}
