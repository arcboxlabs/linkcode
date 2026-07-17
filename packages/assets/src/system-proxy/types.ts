/** What a platform leg found in the OS proxy configuration. */
export type SystemProxyDetection =
  | { kind: 'proxy'; proxyUrl: string; noProxy: string[] }
  | { kind: 'pac'; pacUrl: string };
