// Minimal Vite env surface used by this package. Workbench is consumed as source by the Vite
// renderers, which statically replace these; the full `vite/client` types live in the apps.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
