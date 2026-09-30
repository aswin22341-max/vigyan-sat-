import React from 'react';
import { IrregularAlert } from '../types/telemetry';

interface IrregularAlertBannerProps {
  alert: IrregularAlert;
  hasTelemetry: boolean;
}

export const IrregularAlertBanner: React.FC<IrregularAlertBannerProps> = ({
  alert,
  hasTelemetry,
}) => {
  if (!hasTelemetry) {
    return null;
  }

  const isCritical = alert.severity === 'critical';
  const isWarning = alert.severity === 'warning';
  const isIrregular = alert.isIrregular;

  return (
    <div
      className={`p-4 rounded-xl border transition-all duration-200 shadow-sm ${
        isCritical
          ? 'bg-rose-50 border-rose-300 text-rose-950 ring-2 ring-rose-200'
          : isWarning
          ? 'bg-amber-50 border-amber-300 text-amber-950 ring-2 ring-amber-200'
          : 'bg-emerald-50 border-emerald-200 text-emerald-950'
      }`}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-3.5 h-3.5 rounded-full shrink-0 ${
              isCritical
                ? 'bg-rose-600 shadow-[0_0_8px_rgba(225,29,72,0.8)] animate-pulse'
                : isWarning
                ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                : 'bg-emerald-600'
            }`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`font-bold text-xs px-2.5 py-0.5 rounded-md uppercase tracking-wider ${
                isCritical
                  ? 'bg-rose-600 text-white'
                  : isWarning
                  ? 'bg-amber-600 text-white'
                  : 'bg-emerald-700 text-white'
              }`}
            >
              {isIrregular ? '⚠️ Irregular Level Alert' : '✓ Nominal Working Level'}
            </span>
            <span className="font-bold text-sm text-slate-900 tracking-tight">
              {alert.title}
            </span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className="text-xs font-bold font-mono px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-800 shadow-2xs">
            {alert.metric}
          </span>
        </div>
      </div>

      <p
        className={`mt-2 text-xs font-medium pl-6.5 leading-relaxed ${
          isCritical
            ? 'text-rose-900'
            : isWarning
            ? 'text-amber-900'
            : 'text-emerald-900'
        }`}
      >
        {alert.detail}
      </p>
    </div>
  );
};
