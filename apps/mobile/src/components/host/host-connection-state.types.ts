export interface HostConnectionStateProps {
  status: 'connecting' | 'error';
  url: string;
  /** The underlying failure, when the controller reported one. */
  failure?: string;
  onRetry: () => void;
}
