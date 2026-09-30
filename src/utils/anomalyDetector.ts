import { TelemetryData, IrregularAlert } from '../types/telemetry';

export function detectIrregularLevels(telemetry: TelemetryData | null): IrregularAlert {
  if (!telemetry) {
    return {
      isIrregular: false,
      type: 'NOMINAL',
      severity: 'normal',
      title: 'STANDBY',
      detail: 'Awaiting telemetry stream from ESP32-C3.',
      metric: '--',
    };
  }

  const { state, event, health, confidence, aTotal, gTotal, bTotal } = telemetry;
  const stateUpper = (state || '').toUpperCase();

  // 1. ESP32-C3 Firmware State: CRITICAL
  if (stateUpper === 'CRITICAL' || health < 40) {
    return {
      isIrregular: true,
      type: 'CRITICAL',
      severity: 'critical',
      title: `CRITICAL ANOMALY: ${event || 'FAILURE'}`,
      detail: `Spacecraft health degraded to ${health.toFixed(0)}%. Autonomous TinyML detected severe ${event || 'divergence'}.`,
      metric: `HEALTH ${health.toFixed(0)}% • CONF ${confidence.toFixed(0)}%`,
    };
  }

  // 2. ESP32-C3 Firmware State: ANOMALY
  if (stateUpper === 'ANOMALY' || health < 70) {
    return {
      isIrregular: true,
      type: 'ANOMALY',
      severity: 'critical',
      title: `ANOMALY: ${event || 'DETECTED'}`,
      detail: `On-board health index dropped to ${health.toFixed(0)}%. Event: ${event}.`,
      metric: `HEALTH ${health.toFixed(0)}% • CONF ${confidence.toFixed(0)}%`,
    };
  }

  // 3. ESP32-C3 Firmware State: EARLY WARNING
  if (stateUpper === 'EARLY WARNING' || health < 90) {
    return {
      isIrregular: true,
      type: 'EARLY_WARNING',
      severity: 'warning',
      title: `EARLY WARNING: ${event || 'INSTABILITY'}`,
      detail: `Pre-anomaly condition detected (${confidence.toFixed(0)}% AI confidence). Event signature: ${event}.`,
      metric: `HEALTH ${health.toFixed(0)}% • CONF ${confidence.toFixed(0)}%`,
    };
  }

  // 4. Physical Threshold Validation (Backup checks)
  if (gTotal > 120) {
    return {
      isIrregular: true,
      type: 'TUMBLING',
      severity: 'critical',
      title: 'CRITICAL TUMBLING DETECTED',
      detail: `Rapid angular rotation rate: ${gTotal.toFixed(1)} °/s (|W|).`,
      metric: `${gTotal.toFixed(1)} °/s`,
    };
  }

  if (aTotal > 2.5) {
    return {
      isIrregular: true,
      type: 'HIGH_G',
      severity: 'critical',
      title: 'EXCESSIVE G-FORCE / VIBRATION',
      detail: `Total acceleration magnitude |A| reached ${aTotal.toFixed(2)} g.`,
      metric: `${aTotal.toFixed(2)} g`,
    };
  }

  if (gTotal > 60) {
    return {
      isIrregular: true,
      type: 'TUMBLING',
      severity: 'warning',
      title: 'ELEVATED ROTATION RATE',
      detail: `Satellite rotational rate elevated at ${gTotal.toFixed(1)} °/s.`,
      metric: `${gTotal.toFixed(1)} °/s`,
    };
  }

  if (bTotal > 3.0) {
    return {
      isIrregular: true,
      type: 'ANOMALY',
      severity: 'warning',
      title: 'MAGNETIC FIELD ANOMALY',
      detail: `Unusual magnetic field density |B|: ${bTotal.toFixed(2)} Gauss.`,
      metric: `${bTotal.toFixed(2)} G`,
    };
  }

  // 5. Nominal Healthy Working State
  return {
    isIrregular: false,
    type: 'NOMINAL',
    severity: 'normal',
    title: `HEALTHY • ${event || 'NOMINAL PATTERN'}`,
    detail: `All systems nominal. Health index: ${health.toFixed(0)}%. Sensors operating within calibrated baselines.`,
    metric: `HEALTH ${health.toFixed(0)}%`,
  };
}
