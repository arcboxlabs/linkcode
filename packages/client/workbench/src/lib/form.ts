import type { FieldErrors } from 'react-hook-form';
import { z } from 'zod';
import { createErrorMap } from 'zod-validation-error';

// Activates human-readable zod validation messages globally as a module side effect — any import
// of this module turns it on.
z.config({ customError: createErrorMap() });

// Only flattens top-level field errors. Nested fields (e.g. "address.street")
// need recursive flattening into dot-notation keys for base-ui <Field name="address.street">.
export function rhfErrorsToFormErrors(errors: FieldErrors): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key in errors) {
    if (key === 'root' || key === 'form') continue;
    const value = errors[key];
    if (value?.message && typeof value.message === 'string') {
      result[key] = value.message;
    }
  }
  return result;
}
