export {};

declare global {
  interface Window {
    parkitDesktop?: {
      platform: string;
      onServicesFailed: (callback: (names: string[]) => void) => void;
      getFailedServices: () => Promise<string[]>;
      onServiceCrashed: (callback: (name: string) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
      onOAuthCallback: (callback: (url: string) => void) => () => void;
    };
  }
}
