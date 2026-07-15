// The LCS line diff is platform-neutral and shared with the native (React Native) chat
// components; it lives in @linkcode/common/chat and is re-exported here for the web half.
export {
  type DiffRow,
  type DiffStats,
  diffLines,
  diffStats,
  toolCallDiffStats,
} from '@linkcode/common/chat';
