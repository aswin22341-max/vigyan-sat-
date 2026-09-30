import React from 'react';

interface VigyansatLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
}

export const VigyansatLogo: React.FC<VigyansatLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
}) => {
  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-20 h-20',
    xl: 'w-28 h-28',
  };

  return (
    <div className={`flex items-center gap-3.5 select-none ${className}`}>
      {/* Official Vigyansat Mission Badge Icon */}
      <img
        src="/vigyansat-logo.svg"
        alt="Vigyansat - Science for Society Logo"
        className={`${sizeClasses[size]} rounded-2xl shadow-md shrink-0 object-contain ring-1 ring-slate-900/10 hover:scale-102 transition-transform duration-200`}
        loading="eager"
      />

      {/* Accompanying Typography Header */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl sm:text-3xl md:text-3xl font-black tracking-tight text-slate-950 uppercase font-sans leading-none">
            VIGYANSAT
          </span>
          <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200">
            Ground Station
          </span>
        </div>
        {showSubtitle && (
          <span className="text-xs font-bold text-slate-500 tracking-wide mt-1">
            Science for Society • Satellite Telemetry
          </span>
        )}
      </div>
    </div>
  );
};
