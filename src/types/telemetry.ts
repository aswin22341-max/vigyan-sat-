export interface TelemetryData {
  // ISM330DHCX Accelerometer
  ax: number;
  ay: number;
  az: number;
  aTotal: number;

  // ISM330DHCX Gyroscope
  gx: number;
  gy: number;
  gz: number;
  gTotal: number;

  // MMC5983MA Magnetometer
  mx: number;
  my: number;
  mz: number;
  bTotal: number;

  // Attitude
  pitch: number; // in degrees
  roll: number;  // in degrees
  heading: number; // in degrees 0-360
  cardinal: string;

  // Femto-Satellite Autonomous Health & Diagnostics
  health: number; // 0 - 100%
  state: 'HEALTHY' | 'EARLY WARNING' | 'ANOMALY' | 'CRITICAL' | string;
  event: string;
  confidence: number; // 0 - 100%

  // Optional temperature
  temp: number;
  timestamp: number;
}

export type UsbStatus = 'DISCONNECTED' | 'CONNECTED';

export type AlertSeverity = 'normal' | 'warning' | 'critical';

export interface IrregularAlert {
  isIrregular: boolean;
  type: 'NOMINAL' | 'EARLY_WARNING' | 'ANOMALY' | 'CRITICAL' | 'TUMBLING' | 'HIGH_G' | 'THERMAL';
  severity: AlertSeverity;
  title: string;
  detail: string;
  metric: string;
}
