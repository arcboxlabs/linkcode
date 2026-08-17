export interface NewTerminalSheetProps {
  isPresented: boolean;
  onIsPresentedChange: (isPresented: boolean) => void;
  creating: boolean;
  error: string | null;
  onCreate: (cwd: string) => Promise<boolean>;
}
