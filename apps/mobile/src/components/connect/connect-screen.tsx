import { ConnectSections } from '@mobile/components/connect/connect-sections';
import { FormList } from '@mobile/components/form/list.android';

export function ConnectScreen(): React.ReactNode {
  return (
    <FormList>
      <ConnectSections />
    </FormList>
  );
}
