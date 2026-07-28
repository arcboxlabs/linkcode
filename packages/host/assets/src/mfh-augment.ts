/**
 * @types/make-fetch-happen (v10) predates AbortSignal support, but make-fetch-happen forwards
 * `signal` to minipass-fetch — merged here instead of suppressing the error at every call site.
 */
declare module 'make-fetch-happen' {
  interface MakeFetchHappenOptions {
    signal?: AbortSignal;
  }
}

export {};
