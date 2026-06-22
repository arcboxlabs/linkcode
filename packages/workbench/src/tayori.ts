import type { Options, RequestResult } from '@linkcode/sdk';
import { tayori } from 'tayori';
import type { ZodError } from 'zod';
import { prettifyError } from 'zod';

export const { useData, useMutation, TayoriProvider } = tayori<Options, RequestResult<unknown>>();

export function extractErrorMessageFromZodError(error: ZodError): string[] {
  return prettifyError(error).split('\n');
}
