import { Separator } from 'coss-ui/components/separator';
import { SidebarInset, SidebarTrigger } from 'coss-ui/components/sidebar';
import type * as React from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppSidebarProvider } from '@/components/app-sidebar-provider';
import { BreadcrumbPortalTarget, BreadcrumbProvider } from '@/components/breadcrumbs';

/**
 * The persistent dashboard shell: nav sidebar + header (sidebar trigger +
 * breadcrumb portal target) + content inset. Pages render into the inset and
 * never rebuild this chrome; they portal their current breadcrumb in via
 * `<BreadcrumbCurrent />`.
 */
export function DashboardLayout({ children }: React.PropsWithChildren) {
  return (
    <AppSidebarProvider storageKey="app-sidebar">
      <BreadcrumbProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-0 dark:border">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <BreadcrumbPortalTarget />
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </BreadcrumbProvider>
    </AppSidebarProvider>
  );
}
