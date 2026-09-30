// Type definitions for Web Serial API
export {};

declare global {
  interface Navigator {
    serial?: Serial;
  }

  interface Serial extends EventTarget {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
    addEventListener(
      type: 'connect' | 'disconnect',
      listener: (this: Serial, ev: SerialConnectionEvent) => any,
      options?: boolean | AddEventListenerOptions
    ): void;
    removeEventListener(
      type: 'connect' | 'disconnect',
      listener: (this: Serial, ev: SerialConnectionEvent) => any,
      options?: boolean | EventListenerOptions
    ): void;
  }

  interface SerialConnectionEvent extends Event {
    readonly port: SerialPort;
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }

  interface SerialPort extends EventTarget {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    forget?(): Promise<void>;
  }
}
