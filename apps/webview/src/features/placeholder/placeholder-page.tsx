import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'coss-ui/components/empty';
import { ConstructionIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { BreadcrumbCurrent } from '@/components/breadcrumbs';
import { usePageTitle } from '@/hooks/use-page-title';

/**
 * Scaffolding page for routes whose feature isn't built yet. Demonstrates the
 * full page shape — page title, breadcrumb current, static structure rendering
 * immediately — so adding a real feature is a matter of swapping the body.
 */
export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  usePageTitle(title);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BreadcrumbCurrent title={title} />
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ConstructionIcon />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </div>
  );
}
