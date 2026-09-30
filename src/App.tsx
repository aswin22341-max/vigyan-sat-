import { useState, useMemo } from 'react';
import { TelemetryData, UsbStatus } from './types/telemetry';
import { CubeSatelliteViewer } from './components/CubeSatelliteViewer';
import { UsbSerial } from './components/UsbSerial';
import { Telemetry } from './components/Telemetry';
import { IrregularAlertBanner } from './components/IrregularAlertBanner';
import { detectIrregularLevels } from './utils/anomalyDetector';

export default function App() {
  const [usbStatus, setUsbStatus] = useState<UsbStatus>('DISCONNECTED');
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [lastDataTimestamp, setLastDataTimestamp] = useState<number | null>(null);
  const [packetCount, setPacketCount] = useState<number>(0);

  const handleTelemetryData = (data: TelemetryData) => {
    setTelemetry(data);
    setLastDataTimestamp(Date.now());
    setPacketCount((prev) => prev + 1);
  };

  const handleClearTelemetry = () => {
    setTelemetry(null);
    setLastDataTimestamp(null);
    setPacketCount(0);
  };

  const handleStatusChange = (newStatus: UsbStatus) => {
    setUsbStatus(newStatus);
    if (newStatus === 'DISCONNECTED') {
      handleClearTelemetry();
    }
  };

  // Compute irregular level alert
  const alert = useMemo(() => {
    return detectIrregularLevels(telemetry);
  }, [telemetry]);

  const hasTelemetry = usbStatus === 'CONNECTED' && telemetry !== null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col p-3 sm:p-5 md:p-6 lg:p-8 font-sans antialiased selection:bg-blue-500/20">
      <div className="w-full max-w-[1920px] mx-auto flex flex-col gap-5 sm:gap-6">
        {/* Top Mission Command Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-300">
          <div className="flex items-center gap-3.5">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-slate-950 uppercase">
              VIGYANSAT
            </h1>
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider px-3.5 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
              Flight Ground Station
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs sm:text-sm font-bold text-slate-700">
            <span className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl border border-slate-300 shadow-2xs">
              <span className={`w-3 h-3 rounded-full ${hasTelemetry ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              {hasTelemetry ? 'Telemetry Stream Active (4 Hz)' : usbStatus === 'CONNECTED' ? 'USB Port Connected' : 'System Standby'}
            </span>
          </div>
        </header>

        {/* USB Connection Interface Card */}
        <section>
          <UsbSerial
            status={usbStatus}
            onStatusChange={handleStatusChange}
            onTelemetryData={handleTelemetryData}
            onClearTelemetry={handleClearTelemetry}
            packetCount={packetCount}
          />
        </section>

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
