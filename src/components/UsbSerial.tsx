import React, { useState, useEffect, useRef } from 'react';
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
  status,
  onStatusChange,
  onTelemetryData,
  onClearTelemetry,
  packetCount,
}) => {
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInIframe, setIsInIframe] = useState<boolean>(false);
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [rawLogs, setRawLogs] = useState<string[]>([]);

  const activePortRef = useRef<SerialPort | null>(null);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const isReadingRef = useRef<boolean>(false);
  const parserRef = useRef<TelemetryFrameParser>(new TelemetryFrameParser());

  useEffect(() => {
    if (typeof window !== 'undefined' && window.self !== window.top) {
      setIsInIframe(true);
    }

    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      setIsSupported(false);
    }

    // Only disconnect if the EXACT port in use is physically unplugged
    const handleSerialDisconnect = (event: Event) => {
      const serialEvent = event as SerialConnectionEvent;
      if (activePortRef.current && serialEvent.port && serialEvent.port === activePortRef.current) {
        addLog('Hardware USB port unplugged.');
        cleanupPort();
      }
    };

    if (navigator.serial) {
      navigator.serial.addEventListener('disconnect', handleSerialDisconnect);
    }

    return () => {
      if (navigator.serial) {
        navigator.serial.removeEventListener('disconnect', handleSerialDisconnect);
      }
      cleanupPort();
    };
  }, []);

  const addLog = (msg: string) => {
    setRawLogs((prev) => {
      const next = [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`];
      return next.slice(-50);
    });
  };

  const cleanupPort = async () => {
    isReadingRef.current = false;

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

    onStatusChange('DISCONNECTED');
    onClearTelemetry();
    parserRef.current.reset();
    setIsConnecting(false);
  };

  const handleConnect = async () => {
    setErrorMessage(null);

    if (!('serial' in navigator) || !navigator.serial) {
      setIsSupported(false);
      return;
    }

    try {
      setIsConnecting(true);
      addLog(`Requesting serial device at ${baudRate} baud...`);

      const port = await navigator.serial.requestPort();

      addLog(`Configuring port with 16KB anti-overflow buffer...`);
      // Use large buffer size and explicit serial framing to prevent BufferOverrunError
      await port.open({
        baudRate,
        bufferSize: 16384, // 16 KB ring buffer protects against rapid printf bursts
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });

      activePortRef.current = port;
      onStatusChange('CONNECTED');
      setIsConnecting(false);
      addLog(`Connected successfully. Hardware stream active.`);

      readSerialData(port);
    } catch (err: unknown) {
      setIsConnecting(false);

      if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'AbortError')) {
        addLog('Port selection cancelled.');
        onStatusChange('DISCONNECTED');
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
        onStatusChange('DISCONNECTED');
        return;
      }

      console.warn('USB connection error:', err);
      setErrorMessage(errMessage || 'Unable to open USB serial port.');
      addLog(`Error: ${errMessage}`);
      onStatusChange('DISCONNECTED');
    }
  };

  // RESILIENT RECOVERABLE SERIAL READER LOOP
  // Never disconnects on transient framing glitches or buffer hiccups!
  const readSerialData = async (port: SerialPort) => {
    isReadingRef.current = true;
    let buffer = '';
    const decoder = new TextDecoder();

    // Outer loop maintains connection across transient reader resets
    while (isReadingRef.current && port.readable) {
      try {
        const reader = port.readable.getReader();
        activeReaderRef.current = reader;

        try {
          while (isReadingRef.current) {
            const { value, done } = await reader.read();
            if (done) {
              // Reader cancelled or port closed cleanly
              break;
            }

            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;

              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() ?? '';

              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                addLog(line);

                const parsed = parserRef.current.parseLine(line);
                if (parsed) {
                  onTelemetryData(parsed);
                }
              }
            }
          }
        } catch (innerErr: any) {
          // Non-fatal stream error (e.g. transient baud slip or framing glitch)
          // Log and recover automatically without terminating USB connection!
          const msg = innerErr?.message || String(innerErr);
          if (isReadingRef.current) {
            console.warn('Recovered from transient serial packet glitch:', msg);
            addLog(`Stream auto-recovered from transient frame glitch.`);
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
          activeReaderRef.current = null;
        }

        // Brief delay before acquiring next reader if port remains active
        if (isReadingRef.current && port.readable) {
          await new Promise((r) => setTimeout(r, 60));
        }
      } catch (fatalPortErr) {
        console.warn('Fatal serial port error:', fatalPortErr);
        break;
      }
    }

    // Only disconnect if user triggered disconnect or device was unplugged
    if (isReadingRef.current) {
      addLog('Hardware serial session ended.');
      await cleanupPort();
    }
  };

  const handleDisconnect = async () => {
    addLog('Disconnecting USB...');
    await cleanupPort();
  };

  return (
    <div className="flex flex-col gap-3 font-sans">
      {/* Unsupported browser warning */}
      {!isSupported && (
        <div className="p-4 bg-red-50 border border-red-300 text-red-950 text-sm rounded-2xl shadow-sm">
          <p className="font-bold flex items-center gap-2 text-red-900">
            <span>⚠️</span> Web Serial is not supported in this browser.
          </p>
          <p className="mt-1 text-red-800 text-xs">
            Please use a Chromium-based desktop browser such as Google Chrome or Microsoft Edge.
          </p>
        </div>
      )}

      {/* Permissions policy error notice */}
      {errorMessage && (
        <div className="p-4 bg-amber-50 border border-amber-300 text-amber-950 text-sm rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex-1 space-y-1">
            <p className="font-bold text-amber-900 flex items-center gap-2">
              <span>⚠️</span> Direct Serial Access Required
            </p>
            <p className="text-amber-800 text-xs leading-relaxed">{errorMessage}</p>
          </div>
          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs whitespace-nowrap transition-colors shadow-sm shrink-0 cursor-pointer"
          >
            <span>Open in Full Tab</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}

      {/* Iframe guidance badge */}
      {isInIframe && !errorMessage && (
        <div className="px-4 py-2 bg-slate-200/80 border border-slate-300 text-slate-800 text-xs font-medium rounded-xl flex flex-wrap items-center justify-between gap-2 shadow-2xs">
          <span>Running in embedded view. For uninterrupted hardware USB connection:</span>
          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:text-blue-900 font-bold underline underline-offset-2 flex items-center gap-1 shrink-0"
          >
            <span>Open in Full Tab</span>
            <span>↗</span>
          </a>
        </div>
      )}

      {/* Main USB Control Card */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-5 bg-white border border-slate-300/80 shadow-md rounded-2xl">
        {/* USB Connection Status */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
              USB Interface:
            </span>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-slate-50 border-slate-200">
              <span
                className={`w-3 h-3 rounded-full ${
                  status === 'CONNECTED'
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)] animate-pulse'
                    : 'bg-slate-400'
                }`}
              />
              <span
                className={`font-black text-xs uppercase tracking-wider ${
                  status === 'CONNECTED' ? 'text-emerald-800' : 'text-slate-700'
                }`}
              >
                {status}
              </span>
            </div>
          </div>

          {/* Packet Stream Badge */}
          {status === 'CONNECTED' && (
            <div className="flex items-center gap-2 text-xs font-bold bg-blue-50 text-blue-900 px-3 py-1.5 rounded-lg border border-blue-200 shadow-2xs">
              <span className="text-blue-600 font-medium">Frames Streamed:</span>
              <span className="font-black text-blue-800 font-mono text-sm">{packetCount}</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Baud Rate Selector */}
          {status === 'DISCONNECTED' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-600 font-bold hidden sm:inline">Baud Rate:</span>
              <select
                value={baudRate}
                onChange={(e) => setBaudRate(Number(e.target.value))}
                disabled={isConnecting}
                className="bg-white text-slate-900 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
              >
                <option value={115200}>115200 (Default)</option>
                <option value={9600}>9600</option>
                <option value={19200}>19200</option>
                <option value={38400}>38400</option>
                <option value={57600}>57600</option>
                <option value={230400}>230400</option>
                <option value={921600}>921600</option>
              </select>
            </div>
          )}

          {/* Live Serial Console Toggle */}
          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-2xs ${
              showConsole
                ? 'bg-blue-100 text-blue-900 border-blue-400'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {showConsole ? 'Close Console' : 'Live Console'}
          </button>

          {/* Connect / Disconnect Action Button */}
          {status === 'DISCONNECTED' ? (
            <button
              onClick={handleConnect}
              disabled={!isSupported || isConnecting}
              className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-150 flex items-center gap-2 shadow-sm ${
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
              className="px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 transition-all duration-150 shadow-sm cursor-pointer active:scale-98"
            >
              DISCONNECT USB
            </button>
          )}
        </div>
      </div>

      {/* Raw Serial Terminal Monitor */}
      {showConsole && (
        <div className="p-4 bg-slate-900 text-slate-100 rounded-2xl font-mono text-xs shadow-lg border border-slate-800">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-slate-400">
            <span className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Serial Terminal ({baudRate} Baud)
            </span>
            <button
              onClick={() => setRawLogs([])}
              className="text-xs text-slate-400 hover:text-white uppercase font-bold underline cursor-pointer"
            >
              Clear Logs
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1 select-text text-xs leading-relaxed font-mono">
            {rawLogs.length === 0 ? (
              <span className="text-slate-500 italic">No incoming serial lines yet. Connect USB to view raw hardware stream.</span>
            ) : (
              rawLogs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap break-all px-2 py-0.5 rounded hover:bg-slate-800/70">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
