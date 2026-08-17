import { Form, Host } from '@expo/ui/swift-ui';
import { ConnectSections } from '@mobile/components/connect/connect-sections';

export function ConnectScreen(): React.ReactNode {
  return (
    // Form needs the viewport as its proposed size, otherwise it collapses to its content.
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>
        <ConnectSections />
      </Form>
    </Host>
  );
}
