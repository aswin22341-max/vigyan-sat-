import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TelemetryData, UsbStatus } from '../types/telemetry';
import { TelemetryFrameParser } from '../utils/telemetryParser';

interface UsbSerialProps {
  status: UsbStatus;
  onStatusChange: (status: UsbStatus) => void;
  onTelemetryData: (data: TelemetryData) => void;
  onClearTelemetry: () => void;
  packetCount: number;
}

export const UsbSerial: React.FC<UsbSerialProps> = ({
  onStatusChange,
  onTelemetryData,
  onClearTelemetry,
  status,
}) => {
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [baudRate, setBaudRate] = useState<number>(115200);

  // Mutable refs to prevent re-triggering effects and eliminating connection glitches
  const onTelemetryDataRef = useRef(onTelemetryData);
  const onStatusChangeRef = useRef(onStatusChange);
  const onClearTelemetryRef = useRef(onClearTelemetry);
  const baudRateRef = useRef(baudRate);
  const autoConnectRef = useRef(true);

  const activePortRef = useRef<SerialPort | null>(null);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const isReadingRef = useRef<boolean>(false);
  const isOpeningRef = useRef<boolean>(false);
  const userManuallyDisconnectedRef = useRef<boolean>(false);
  const parserRef = useRef<TelemetryFrameParser>(new TelemetryFrameParser());
  const logsBufferRef = useRef<string[]>([]);

  // Keep refs synchronized
  useEffect(() => {
    onTelemetryDataRef.current = onTelemetryData;
    onStatusChangeRef.current = onStatusChange;
    onClearTelemetryRef.current = onClearTelemetry;
    baudRateRef.current = baudRate;
  });

  // Non-blocking log buffer
  const addLog = useCallback((msg: string) => {
    logsBufferRef.current.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (logsBufferRef.current.length > 50) {
      logsBufferRef.current = logsBufferRef.current.slice(-50);
    }
  }, []);

  // Non-blocking signal assertion with timeout protection
  const safeSetSignals = useCallback(
    async (port: SerialPort, signals: { dataTerminalReady?: boolean; requestToSend?: boolean }) => {
      if (typeof (port as any).setSignals !== 'function') return;
      try {
        await Promise.race([
          (port as any).setSignals(signals),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 150)),
        ]);
      } catch {
        // Driver does not support or timed out; safe to continue
      }
    },
    []
  );

  const cleanupPort = useCallback(async () => {
    isReadingRef.current = false;
    isOpeningRef.current = false;

    if (activeReaderRef.current) {
      try {
        await activeReaderRef.current.cancel();
      } catch {
        // ignore
      }
      try {
        activeReaderRef.current.releaseLock();
      } catch {
        // ignore
      }
      activeReaderRef.current = null;
    }

    if (activePortRef.current) {
      try {
        await activePortRef.current.close();
      } catch {
        // ignore
      }
      activePortRef.current = null;
    }

    onStatusChangeRef.current('DISCONNECTED');
    onClearTelemetryRef.current();
    parserRef.current.reset();
    setIsConnecting(false);
  }, []);

  // HIGH-EFFICIENCY SERIAL READER LOOP (ZERO FREEZES, BUTTER SMOOTH)
  const readSerialData = useCallback(
    async (port: SerialPort) => {
      isReadingRef.current = true;
      let buffer = '';
      const decoder = new TextDecoder();

      while (isReadingRef.current && port.readable) {
        try {
          const reader = port.readable.getReader();
          activeReaderRef.current = reader;

          try {
            while (isReadingRef.current) {
              const { value, done } = await reader.read();
              if (done) break;

              if (value && value.length > 0) {
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // Split on complete line endings (\r\n, \r, or \n)
                const lines = buffer.split(/\r\n|\r|\n/);
                // Keep incomplete trailing fragment in buffer for the next chunk
                buffer = lines.pop() ?? '';

                let latestParsedInChunk: TelemetryData | null = null;

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!line) continue;

                  // Always record line in memory ring-buffer so Live Console is immediately useful
                  addLog(line);

                  const parsed = parserRef.current.parseLine(line);
                  if (parsed) {
                    latestParsedInChunk = parsed;
                  }
                }

                // If buffer accumulates over 1024 characters without newline, parse it directly
                if (buffer.length > 1024) {
                  const parsed = parserRef.current.parseLine(buffer.trim());
                  if (parsed) {
                    latestParsedInChunk = parsed;
                  }
                  buffer = '';
                }

                // Immediately dispatch latest completed telemetry snapshot
                if (latestParsedInChunk) {
                  onTelemetryDataRef.current(latestParsedInChunk);
                }
              }
            }
          } catch (innerErr: any) {
            const msg = innerErr?.message || String(innerErr);
            if (isReadingRef.current) {
              console.warn('Recovered from transient serial packet glitch:', msg);
            }
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
            activeReaderRef.current = null;
          }

          if (isReadingRef.current && port.readable) {
            await new Promise((r) => setTimeout(r, 20));
          }
        } catch (fatalPortErr) {
          console.warn('Fatal serial port error:', fatalPortErr);
          break;
        }
      }

      if (isReadingRef.current) {
        addLog('Hardware serial session ended.');
        await cleanupPort();
      }
    },
    [addLog, cleanupPort]
  );

  // Safe open procedure with hardware bootloader bypass & NO blocking writes
  const openPort = useCallback(
    async (port: SerialPort, isAuto = false) => {
      const targetBaud = baudRateRef.current;
      addLog(
        isAuto
          ? `⚡ Auto-connecting detected USB device at ${targetBaud} baud...`
          : `Opening USB serial port at ${targetBaud} baud...`
      );

      try {
        let opened = false;
        let lastErr: unknown = null;

        // Up to 3 attempts with 200ms spacing to accommodate OS COM driver enumeration
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await port.open({
              baudRate: targetBaud,
              bufferSize: 16384, // 16 KB ring buffer prevents overflow
              dataBits: 8,
              stopBits: 1,
              parity: 'none',
              flowControl: 'none',
            });
            opened = true;
            break;
          } catch (openErr: any) {
            lastErr = openErr;
            if (openErr?.message?.includes('already open')) {
              opened = true;
              break;
            }
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 200));
            }
          }
        }

        if (!opened) {
          throw lastErr;
        }

        activePortRef.current = port;
        isOpeningRef.current = false;
        setIsConnecting(false);
        userManuallyDisconnectedRef.current = false;
        onStatusChangeRef.current('CONNECTED');
        addLog(`USB Connected & Streaming at ${targetBaud} baud.`);

        // CRITICAL FOR ESP32 & ARDUINO:
        // Assert DTR (Terminal Ready) and release RTS (Run sketch, don't hold in reset/bootloader)
        await safeSetSignals(port, { dataTerminalReady: true, requestToSend: false });

        // Immediately start non-blocking reader
        readSerialData(port);
      } catch (err: unknown) {
        isOpeningRef.current = false;
        setIsConnecting(false);
        console.warn('Failed to open serial port:', err);

        if (!isAuto) {
          const errMessage = String((err as any)?.message || '');
          setErrorMessage(errMessage || 'Unable to open USB serial port.');
          addLog(`Error: ${errMessage}`);
        }
        onStatusChangeRef.current('DISCONNECTED');
      }
    },
    [addLog, readSerialData, safeSetSignals]
  );

  // Single centralized scheduler to prevent parallel or overlapping connection attempts
  const scheduleAutoConnect = useCallback(
    async (preferredPort?: SerialPort) => {
      if (
        isOpeningRef.current ||
        activePortRef.current ||
        !autoConnectRef.current ||
        userManuallyDisconnectedRef.current ||
        typeof navigator === 'undefined' ||
        !navigator.serial
      ) {
        return;
      }

      // Synchronously acquire lock to prevent any other timer or event from competing
      isOpeningRef.current = true;
      setIsConnecting(true);

      try {
        let targetPort = preferredPort;
        if (!targetPort) {
          const authorizedPorts = await navigator.serial.getPorts();
          if (authorizedPorts && authorizedPorts.length > 0) {
            targetPort = authorizedPorts[authorizedPorts.length - 1];
          }
        }

        if (targetPort && !activePortRef.current) {
          // Swift 100ms OS COM driver stabilization
          await new Promise((r) => setTimeout(r, 100));
          if (!activePortRef.current) {
            try {
              await openPort(targetPort, true);
              return;
            } catch {
              // Retry once after 250ms in case OS virtual COM port was still initializing
              await new Promise((r) => setTimeout(r, 250));
              if (!activePortRef.current) {
                await openPort(targetPort, true);
                return;
              }
            }
          }
        }
      } catch (err) {
        console.warn('Auto-connect scheduler error:', err);
      }

      isOpeningRef.current = false;
      setIsConnecting(false);
    },
    [openPort]
  );

  // STABLE LIFECYCLE EFFECT:
  // Runs once on mount. Cleanly listens to device connection and auto-connects.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      setIsSupported(false);
      return;
    }

    // 1. Initial check on mount
    scheduleAutoConnect();

    // 2. Hardware Plug-In Event: Fires when USB cable is inserted into laptop
    const handleDeviceConnect = (event: Event) => {
      addLog('USB cable inserted into laptop.');
      userManuallyDisconnectedRef.current = false;
      const serialEvent = event as SerialConnectionEvent;
      scheduleAutoConnect(serialEvent.port);
    };

    // 3. Hardware Unplug Event: Fires when USB cable is removed from laptop
    const handleDeviceDisconnect = (event: Event) => {
      const serialEvent = event as SerialConnectionEvent;
      if (activePortRef.current && serialEvent.port && serialEvent.port === activePortRef.current) {
        addLog('USB cable removed from laptop.');
        userManuallyDisconnectedRef.current = false;
        cleanupPort();
      }
    };

    if (navigator.serial) {
      navigator.serial.addEventListener('connect', handleDeviceConnect);
      navigator.serial.addEventListener('disconnect', handleDeviceDisconnect);
    }

    // 4. Background Plug-and-Play Scanner: Checks if an authorized port became ready
    const pnpScannerTimer = setInterval(() => {
      if (
        autoConnectRef.current &&
        !activePortRef.current &&
        !isOpeningRef.current &&
        !userManuallyDisconnectedRef.current
      ) {
        scheduleAutoConnect();
      }
    }, 1500);

    return () => {
      clearInterval(pnpScannerTimer);
      if (navigator.serial) {
        navigator.serial.removeEventListener('connect', handleDeviceConnect);
        navigator.serial.removeEventListener('disconnect', handleDeviceDisconnect);
      }
      cleanupPort();
    };
  }, [addLog, cleanupPort, scheduleAutoConnect]);

  const handleConnect = async () => {
    setErrorMessage(null);
    userManuallyDisconnectedRef.current = false;

    if (!('serial' in navigator) || !navigator.serial) {
      setIsSupported(false);
      return;
    }

    try {
      setIsConnecting(true);
      isOpeningRef.current = true;
      addLog(`Requesting serial device permission at ${baudRate} baud...`);

      const port = await navigator.serial.requestPort();
      await openPort(port, false);
    } catch (err: unknown) {
      isOpeningRef.current = false;
      setIsConnecting(false);

      if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'AbortError')) {
        addLog('Port selection cancelled.');
        onStatusChangeRef.current('DISCONNECTED');
        return;
      }

      const errMessage = String((err as any)?.message || '');
      if (
        (err instanceof DOMException && err.name === 'SecurityError') ||
        errMessage.includes('permissions policy') ||
        errMessage.includes('disallowed')
      ) {
        setErrorMessage(
          'Web Serial is restricted inside the preview frame. Click "Open in Full Tab" to connect directly.'
        );
        addLog('Blocked by iframe permissions policy. Use "Open in Full Tab".');
        onStatusChangeRef.current('DISCONNECTED');
        return;
      }

      console.warn('USB connection error:', err);
      setErrorMessage(errMessage || 'Unable to open USB serial port.');
      addLog(`Error: ${errMessage}`);
      onStatusChangeRef.current('DISCONNECTED');
    }
  };

  const handleDisconnect = async () => {
    userManuallyDisconnectedRef.current = true;
    addLog('User disconnected USB interface.');
    await cleanupPort();
  };

  return (
    <div className="flex flex-col gap-2 font-sans">
      {/* Unsupported browser warning */}
      {!isSupported && (
        <div className="p-3 bg-red-50 border border-red-300 text-red-950 text-xs rounded-xl shadow-xs">
          <p className="font-bold flex items-center gap-1.5 text-red-900">
            <span>⚠️</span> Web Serial not supported in this browser. Please use Chrome or Edge.
          </p>
        </div>
      )}

      {/* Permissions policy error notice */}
      {errorMessage && (
        <div className="p-3 bg-amber-50 border border-amber-300 text-amber-950 text-xs rounded-xl flex items-center justify-between gap-3 shadow-xs">
          <p className="text-amber-800 font-semibold">{errorMessage}</p>
          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs whitespace-nowrap transition-colors shadow-xs shrink-0 cursor-pointer"
          >
            <span>Open in Full Tab</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}

      {/* USB Top Control Group */}
      <div className="flex items-center gap-3">
        {/* Baud Rate Selector */}
        {status === 'DISCONNECTED' && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-600 font-bold hidden sm:inline">Baud:</span>
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              disabled={isConnecting}
              className="bg-white text-slate-900 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
            >
              <option value={115200}>115200</option>
              <option value={9600}>9600</option>
              <option value={19200}>19200</option>
              <option value={38400}>38400</option>
              <option value={57600}>57600</option>
              <option value={230400}>230400</option>
              <option value={921600}>921600</option>
            </select>
          </div>
        )}

        {/* Connect / Disconnect Action Button */}
        {status === 'DISCONNECTED' ? (
          <button
            onClick={handleConnect}
            disabled={!isSupported || isConnecting}
            className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-150 flex items-center gap-2 shadow-xs ${
              !isSupported
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                : isConnecting
                ? 'bg-blue-200 text-blue-900 cursor-wait border border-blue-300'
                : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 cursor-pointer active:scale-98'
            }`}
          >
            {isConnecting ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                Connecting...
              </>
            ) : (
              'CONNECT USB'
            )}
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 transition-all duration-150 shadow-xs cursor-pointer active:scale-98"
          >
            DISCONNECT USB
          </button>
        )}
      </div>
    </div>
  );
};
