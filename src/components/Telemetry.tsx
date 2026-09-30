import React from 'react';
import { TelemetryData, UsbStatus } from '../types/telemetry';

interface TelemetryProps {
  telemetry: TelemetryData | null;
  usbStatus: UsbStatus;
  lastDataTimestamp: number | null;
}

export const Telemetry: React.FC<TelemetryProps> = ({
  telemetry,
  usbStatus,
  lastDataTimestamp,
}) => {
  const isConnected = usbStatus === 'CONNECTED';
  const hasTelemetry = isConnected && telemetry !== null;

  const ismStatus = hasTelemetry ? 'ONLINE (RECEIVING)' : isConnected ? 'STANDBY' : 'OFFLINE';
  const mmcStatus = hasTelemetry ? 'ONLINE (RECEIVING)' : isConnected ? 'STANDBY' : 'OFFLINE';

  const formatVal = (val: number | undefined, precision = 2): string => {
    if (!hasTelemetry || typeof val !== 'number' || isNaN(val)) {
      return '---';
    }
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(precision)}`;
  };

  const formatTot = (val: number | undefined, precision = 2): string => {
    if (!hasTelemetry || typeof val !== 'number' || isNaN(val)) {
      return '---';
    }
    return val.toFixed(precision);
  };

  return (
    <div className="flex flex-col gap-4 font-sans text-slate-900">
      {/* 1. SPACECRAFT HEALTH & AUTONOMOUS DIAGNOSTICS */}
      <div className="bg-white p-5 rounded-2xl border border-slate-300/80 shadow-md">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
              Spacecraft Health & AI Diagnostics
            </h3>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${
              !hasTelemetry
                ? 'bg-slate-100 text-slate-600 border-slate-300'
                : telemetry.state === 'CRITICAL'
                ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse'
                : telemetry.state === 'ANOMALY'
                ? 'bg-rose-50 text-rose-700 border-rose-300'
                : telemetry.state === 'EARLY WARNING'
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-emerald-100 text-emerald-800 border-emerald-300'
            }`}
          >
            {hasTelemetry ? telemetry.state : isConnected ? 'STANDBY' : 'NO DATA'}
          </span>
        </div>

        {hasTelemetry ? (
          <div className="mt-3.5 space-y-3">
            {/* Health Index Bar */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 uppercase">
                Health Index:
              </span>
              <span className="text-2xl font-black font-mono text-blue-700">
                {telemetry.health.toFixed(0)}%
              </span>
            </div>

            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden shadow-inner">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  telemetry.health >= 90
                    ? 'bg-emerald-500'
                    : telemetry.health >= 70
                    ? 'bg-amber-500'
                    : 'bg-rose-600'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, telemetry.health))}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase block mb-0.5">
                  Primary Event
                </span>
                <span className="text-xs font-black text-slate-900 truncate block">
                  {telemetry.event || 'NOMINAL PATTERN'}
                </span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase block mb-0.5">
                  AI Confidence
                </span>
                <span className="text-xs font-black text-slate-900 font-mono block">
                  {telemetry.confidence.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-xs font-bold text-slate-500 italic">
            Connect USB to stream on-board TinyML health diagnostics.
          </div>
        )}
      </div>

      {/* 2. ATTITUDE DETERMINATION (Roll, Pitch, Heading) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-300/80 shadow-md">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
            Attitude Determination
          </h3>
          <span className="px-2.5 py-0.5 rounded bg-blue-100 text-blue-800 font-black font-mono text-xs border border-blue-200">
            {hasTelemetry && telemetry?.cardinal ? telemetry.cardinal : '--'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-3.5">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center shadow-2xs">
            <span className="text-xs font-black text-slate-500 block mb-1">PITCH</span>
            <span className={`text-lg md:text-xl font-black font-mono tracking-tight ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
              {hasTelemetry && typeof telemetry?.pitch === 'number'
                ? `${telemetry.pitch > 0 ? '+' : ''}${telemetry.pitch.toFixed(1)}°`
                : '---'}
            </span>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center shadow-2xs">
            <span className="text-xs font-black text-slate-500 block mb-1">ROLL</span>
            <span className={`text-lg md:text-xl font-black font-mono tracking-tight ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
              {hasTelemetry && typeof telemetry?.roll === 'number'
                ? `${telemetry.roll > 0 ? '+' : ''}${telemetry.roll.toFixed(1)}°`
                : '---'}
            </span>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center shadow-2xs">
            <span className="text-xs font-black text-slate-500 block mb-1">HEADING</span>
            <span className={`text-lg md:text-xl font-black font-mono tracking-tight ${hasTelemetry ? 'text-blue-700' : 'text-slate-400'}`}>
              {hasTelemetry && typeof telemetry?.heading === 'number'
                ? `${telemetry.heading.toFixed(1)}°`
                : '---'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. ISM330DHCX 6-DOF IMU (Accelerometer & Gyroscope) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-300/80 shadow-md space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
              ISM330DHCX 6-DOF IMU
            </h3>
            <span className="text-[11px] font-bold text-slate-500">Dual 3D Accelerometer & Gyroscope</span>
          </div>
          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
            {hasTelemetry ? '208 Hz' : 'I2C 0x6B'}
          </span>
        </div>

        {/* Accelerometer */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
              Accelerometer
            </span>
            <span className="text-xs font-black font-mono text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
              |A|: {formatTot(telemetry?.aTotal, 2)} g
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-xs font-black text-red-600 block mb-0.5">X (g)</span>
              <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
                {formatVal(telemetry?.ax, 2)}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-xs font-black text-emerald-600 block mb-0.5">Y (g)</span>
              <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
                {formatVal(telemetry?.ay, 2)}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-xs font-black text-blue-600 block mb-0.5">Z (g)</span>
              <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
                {formatVal(telemetry?.az, 2)}
              </span>
            </div>
          </div>
        </div>

        {/* Gyroscope */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
              Gyroscope (Angular Rate)
            </span>
            <span className="text-xs font-black font-mono text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
              |W|: {formatTot(telemetry?.gTotal, 1)} °/s
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-xs font-black text-red-600 block mb-0.5">X (°/s)</span>
              <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
                {formatVal(telemetry?.gx, 1)}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-xs font-black text-emerald-600 block mb-0.5">Y (°/s)</span>
              <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
                {formatVal(telemetry?.gy, 1)}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-xs font-black text-blue-600 block mb-0.5">Z (°/s)</span>
              <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
                {formatVal(telemetry?.gz, 1)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. MMC5983MA MAGNETOMETER */}
      <div className="bg-white p-5 rounded-2xl border border-slate-300/80 shadow-md space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
              MMC5983MA Magnetometer
            </h3>
            <span className="text-[11px] font-bold text-slate-500">18-Bit AMR Magnetic Flux Sensor</span>
          </div>
          <span className="text-xs font-black font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
            |B|: {formatTot(telemetry?.bTotal, 2)} G
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-black text-red-600 block mb-0.5">X (Gauss)</span>
            <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
              {formatVal(telemetry?.mx, 2)}
            </span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-black text-emerald-600 block mb-0.5">Y (Gauss)</span>
            <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
              {formatVal(telemetry?.my, 2)}
            </span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs font-black text-blue-600 block mb-0.5">Z (Gauss)</span>
            <span className={`text-base md:text-lg font-black font-mono ${hasTelemetry ? 'text-slate-950' : 'text-slate-400'}`}>
              {formatVal(telemetry?.mz, 2)}
            </span>
          </div>
        </div>
      </div>

      {/* 5. HARDWARE BUS & PACKET DIAGNOSTICS */}
      <div className="bg-white p-4 rounded-2xl border border-slate-300/80 shadow-md flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-600 font-bold">ISM330DHCX IMU:</span>
          <span className={`font-black ${hasTelemetry ? 'text-emerald-700' : 'text-slate-500'}`}>
            {ismStatus}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-600 font-bold">MMC5983MA MAG:</span>
          <span className={`font-black ${hasTelemetry ? 'text-emerald-700' : 'text-slate-500'}`}>
            {mmcStatus}
          </span>
        </div>
        {lastDataTimestamp && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px] text-slate-500">
            <span>Last Telemetry Frame:</span>
            <span className="font-mono font-bold text-slate-700">Just now</span>
          </div>
        )}
      </div>
    </div>
  );
};
