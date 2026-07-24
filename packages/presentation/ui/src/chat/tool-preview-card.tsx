import { Badge } from 'coss-ui/components/badge';
import { Frame } from 'coss-ui/components/frame';
import { ChatCardActions, ChatCardHeader, ChatCardPanel, ChatCardTitle } from './chat-card';

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
    <Frame className="my-1">
      <ChatCardHeader>
        <Icon className="size-3.5 shrink-0" />
        <ChatCardTitle>{title}</ChatCardTitle>
        {badge ? (
          <ChatCardActions>
            <Badge size="sm" variant="secondary">
              {badge}
            </Badge>
          </ChatCardActions>
        ) : null}
      </ChatCardHeader>
      <ChatCardPanel>{children}</ChatCardPanel>
    </Frame>
  );
}
