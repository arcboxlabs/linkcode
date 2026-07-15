import { Badge } from 'coss-ui/components/badge';
import { Card, CardHeader, CardPanel, CardTitle } from 'coss-ui/components/card';

export function ToolPreviewCard({
  badge,
  children,
  icon: Icon,
  title,
}: {
  badge?: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}): React.ReactNode {
  return (
    <Card className="my-1 overflow-hidden">
      <CardHeader className="grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto] items-center gap-2 border-b px-3 py-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <CardTitle className="truncate font-mono font-normal text-xs leading-normal">
          {title}
        </CardTitle>
        {badge ? (
          <Badge size="sm" variant="secondary">
            {badge}
          </Badge>
        ) : null}
      </CardHeader>
      <CardPanel className="p-3">{children}</CardPanel>
    </Card>
  );
}
