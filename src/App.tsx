import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { TelemetryData, UsbStatus } from './types/telemetry';
import { initialTelemetryState } from './utils/telemetryParser';
import { CubeSatelliteViewer } from './components/CubeSatelliteViewer';
import { UsbSerial } from './components/UsbSerial';
import { Telemetry } from './components/Telemetry';
import { IrregularAlertBanner } from './components/IrregularAlertBanner';
import { detectIrregularLevels } from './utils/anomalyDetector';
import { VigyansatLogo } from './components/VigyansatLogo';

export default function App() {
  const [usbStatus, setUsbStatus] = useState<UsbStatus>('DISCONNECTED');
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [lastDataTimestamp, setLastDataTimestamp] = useState<number | null>(null);
  const [packetCount, setPacketCount] = useState<number>(0);

  // In-memory high-speed telemetry buffer (decouples high-rate serial from React rendering)
  const latestTelemetryRef = useRef<TelemetryData | null>(null);
  const totalPacketsRef = useRef<number>(0);
  const lastPacketTimeRef = useRef<number | null>(null);
  const hasPendingUpdateRef = useRef<boolean>(false);
  const isFirstPacketRef = useRef<boolean>(true);

  // High-speed receiver (called from serial reader loop, costs < 0.001ms)
  const handleTelemetryData = useCallback((data: TelemetryData) => {
    latestTelemetryRef.current = data;
    totalPacketsRef.current += 1;
    lastPacketTimeRef.current = Date.now();
    hasPendingUpdateRef.current = true;

    // Instant zero-delay render on first incoming packet
    if (isFirstPacketRef.current) {
      isFirstPacketRef.current = false;
      setTelemetry({ ...data });
      setLastDataTimestamp(Date.now());
      setPacketCount(1);
    }
  }, []);

  // Clear handler
  const handleClearTelemetry = useCallback(() => {
    latestTelemetryRef.current = null;
    totalPacketsRef.current = 0;
    lastPacketTimeRef.current = null;
    hasPendingUpdateRef.current = false;
    isFirstPacketRef.current = true;
    setTelemetry(null);
    setLastDataTimestamp(null);
    setPacketCount(0);
  }, []);

  const handleStatusChange = useCallback(
    (newStatus: UsbStatus) => {
      setUsbStatus(newStatus);
      if (newStatus === 'CONNECTED') {
        // Activate baseline telemetry state so instruments and 3D simulation start immediately
        setTelemetry({ ...initialTelemetryState, timestamp: Date.now() });
      } else if (newStatus === 'DISCONNECTED') {
        handleClearTelemetry();
      }
    },
    [handleClearTelemetry]
  );

  // High-performance 60 FPS UI dispatcher synchronized directly with screen refresh rate
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      if (hasPendingUpdateRef.current && latestTelemetryRef.current) {
        hasPendingUpdateRef.current = false;
        setTelemetry({ ...latestTelemetryRef.current });
        setLastDataTimestamp(lastPacketTimeRef.current);
        setPacketCount(totalPacketsRef.current);
      }
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Compute irregular level alert
  const alert = useMemo(() => {
    return detectIrregularLevels(telemetry);
  }, [telemetry]);

  const hasTelemetry = usbStatus === 'CONNECTED' && telemetry !== null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col p-3 sm:p-5 md:p-6 lg:p-8 font-sans antialiased selection:bg-blue-500/20">
      <div className="w-full max-w-[1920px] mx-auto flex flex-col gap-5 sm:gap-6">
        {/* Top Mission Command Header with Logo */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-300">
          <VigyansatLogo size="md" showSubtitle={true} />

          {/* Top of Dashboard: USB Connect / Disconnect Action */}
          <div className="flex items-center">
            <UsbSerial
              status={usbStatus}
              onStatusChange={handleStatusChange}
              onTelemetryData={handleTelemetryData}
              onClearTelemetry={handleClearTelemetry}
              packetCount={packetCount}
            />
          </div>
        </header>

        {/* Irregular Anomaly Alert Banner */}
        {hasTelemetry && (
          <section>
            <IrregularAlertBanner alert={alert} hasTelemetry={hasTelemetry} />
          </section>
        )}

        {/* Main Command Dashboard Layout: Expansive 3D View + High-Density Telemetry Deck */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Expanded 3D Satellite Attitude Station */}
          <section className="lg:col-span-7 xl:col-span-8 2xl:col-span-8 w-full flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm sm:text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span>VIGYANSAT</span>
                {hasTelemetry && (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </h2>
              <span className="text-xs sm:text-sm font-bold text-slate-500">
                {hasTelemetry ? 'Synchronized to Hardware Orientation' : 'Stationary (Waiting for USB Stream)'}
              </span>
            </div>
            <CubeSatelliteViewer
              telemetry={telemetry}
              alert={alert}
              isConnected={usbStatus === 'CONNECTED'}
            />
          </section>

          {/* Right Column: High-Density Telemetry Deck */}
          <section className="lg:col-span-5 xl:col-span-4 2xl:col-span-4 w-full flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm sm:text-base font-black text-slate-800 uppercase tracking-wider">
                Real-Time Telemetry Data
              </h2>
              {lastDataTimestamp && (
                <span className="text-xs font-black font-mono text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                  LIVE STREAM ACTIVE
                </span>
              )}
            </div>
            <Telemetry
              telemetry={telemetry}
              usbStatus={usbStatus}
              lastDataTimestamp={lastDataTimestamp}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
