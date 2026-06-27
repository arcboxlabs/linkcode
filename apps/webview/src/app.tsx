import type { ReactNode } from 'react';
import { RootProviders } from '@/providers/root-providers';

export function App(): ReactNode {
  return (
    <RootProviders>
      <main className="min-h-screen bg-background" aria-label="LinkCode startup" />
    </RootProviders>
  );
}
