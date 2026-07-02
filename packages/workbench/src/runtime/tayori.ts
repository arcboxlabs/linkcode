import type { Options, RequestResult } from '@linkcode/sdk';
import { tayori } from 'tayori';
import type { ZodError } from 'zod';
import { prettifyError } from 'zod';

// Requires tayori >= 0.3.8: earlier versions called their SWR-middleware hooks conditionally
// on the key, so args flipping between falsy and object crashed React (hook-order change).
export const { useData, useMutation, TayoriProvider } = tayori<Options, RequestResult>();

export function extractErrorMessageFromZodError(error: ZodError): string[] {
  return prettifyError(error).split('\n');
}
