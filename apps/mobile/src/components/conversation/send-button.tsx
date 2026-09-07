import { NativeIconButton } from '@mobile/components/form/icon-button';

/** The round send action shared by the conversation composer and the new-thread draft: one
 * circular button that morphs between send and stop, because a turn in flight is the only thing
 * the user wants to do to it. Filled with the platform tint, like the native senders. */
export function SendButton({
  isRunning,
  enabled,
  sendLabel,
  stopLabel,
  onSend,
  onStop,
}: {
  isRunning: boolean;
  enabled: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend: () => void;
  onStop: () => void;
}): React.ReactNode {
  return (
    <NativeIconButton
      filled
      icon={isRunning ? 'stop' : 'send'}
      label={isRunning ? stopLabel : sendLabel}
      disabled={!enabled}
      onPress={isRunning ? onStop : onSend}
    />
  );
}
