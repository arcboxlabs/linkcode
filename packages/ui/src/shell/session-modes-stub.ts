import type { SessionMode } from '@linkcode/schema';

// TODO(linkcode-schema): Provisional stub — agents advertise their mode list (SessionModeState) at
// session start, but no event carries it to clients yet. The backend will emit a mode-state event
// and fold `availableModes` into the conversation view-model; wire that data into the composer's
// `availableModes` prop and delete this stub. Mode switching itself already works end-to-end via
// the existing `set-mode` AgentInput and `current-mode-update` event.
export const STUB_SESSION_MODES: SessionMode[] = [
  {
    modeId: 'default',
    name: 'Ask for approval',
    description: 'Always ask before editing files and running commands.',
  },
  {
    modeId: 'acceptEdits',
    name: 'Approve for me',
    description: 'Only ask for actions detected as potentially unsafe.',
  },
  {
    modeId: 'bypassPermissions',
    name: 'Full access',
    description: 'Unrestricted access to files and commands in this workspace.',
  },
  {
    modeId: 'plan',
    name: 'Plan',
    description: 'Research and propose a plan before making changes.',
  },
];
