/**
 * @types/make-fetch-happen (v10) predates AbortSignal support; minipass-fetch has accepted
 * `signal` for years and make-fetch-happen forwards it. Merged here instead of suppressing
 * the type error at every call site.
 */
declare module 'make-fetch-happen' {
  interface MakeFetchHappenOptions {
    signal?: AbortSignal;
  }
}

export {};
