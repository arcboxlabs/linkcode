import type { Options, RequestResult } from '@linkcode/sdk';
import { tayori } from 'tayori';
import type { ZodError } from 'zod';
import { prettifyError } from 'zod';

const instance = tayori<Options, RequestResult>();

export const { useMutation, TayoriProvider } = instance;

/**
 * tayori@0.3.6's SWR middleware only calls its internal hooks (`use(context)` + `useCallback`)
 * when the SWR key is a tayori-marked key, and a literally-falsy `sdkArg` produces a `null` key.
 * A call site whose args flip between falsy and object (`cond ? { … } : null`) therefore changes
 * the hook count across renders and crashes React ("reading 'length'" in areHookInputsEqual).
 * Always handing tayori a *function* arg keeps the key a marked function object — the middleware's
 * hooks then run on every render — while SWR still disables the request when it returns falsy.
 * Drop this shim once tayori hoists its middleware hooks out of the key check.
 */
export const useData: typeof instance.useData = (sdkMethod, sdkArg, config) =>
  instance.useData(sdkMethod, typeof sdkArg === 'function' ? sdkArg : () => sdkArg, config);

export function extractErrorMessageFromZodError(error: ZodError): string[] {
  return prettifyError(error).split('\n');
}
