export {};

declare global {
  /** Electron's PrinterInfo, trimmed to what the UI needs. */
  interface DesktopPrinter {
    name: string;
    displayName: string;
    isDefault: boolean;
  }

  type DesktopPrintResult =
    | { ok: true }
    | {
        ok: false;
        reason:
          | 'no-window'
          | 'no-printer'
          | 'printer-not-found'
          | 'print-failed'
          | 'timeout';
        detail?: string;
      };

  interface Window {
    parkitDesktop?: {
      platform: string;
      onServicesFailed: (callback: (names: string[]) => void) => void;
      getFailedServices: () => Promise<string[]>;
      onServiceCrashed: (callback: (name: string) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
      onOAuthCallback: (callback: (url: string) => void) => () => void;
      listPrinters: () => Promise<DesktopPrinter[]>;
      printTicket: (payload: {
        html: string;
        deviceName: string | null;
        /** Papel alimentado después de la última línea, para la guillotina. */
        tailFeedMm: number;
        pageWidthMm: number | null;
      }) => Promise<DesktopPrintResult>;
    };
  }
}
