import { TelemetryData } from '../types/telemetry';

export const initialTelemetryState: TelemetryData = {
  ax: 0,
  ay: 0,
  az: 1.0,
  aTotal: 1.0,
  gx: 0,
  gy: 0,
  gz: 0,
  gTotal: 0,
  mx: 0,
  my: 0,
  mz: 0,
  bTotal: 0,
  pitch: 0,
  roll: 0,
  heading: 0,
  cardinal: '--',
  health: 100,
  state: 'HEALTHY',
  event: 'NOMINAL PATTERN',
  confidence: 0,
  temp: 25.0,
  timestamp: Date.now(),
};

/**
 * Robust Telemetry Frame Parser for VIGYANSAT ESP32-C3
 * Parses human-readable multi-line serial frames and JSON fallbacks
 */
export class TelemetryFrameParser {
  private current: TelemetryData = { ...initialTelemetryState };

  public reset() {
    this.current = { ...initialTelemetryState };
  }

  /**
   * Helper to parse a floating point number even with embedded spaces e.g. "+ 0.1" or " -0.05"
   */
  private parseNum(str: string | undefined): number | null {
    if (!str) return null;
    // Remove inner spaces between sign and digits e.g. "+ 0.1" -> "+0.1"
    const cleaned = str.replace(/\s+/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  }

  public parseLine(rawLine: string): TelemetryData | null {
    const line = rawLine.trim();
    if (!line) return null;

    let updated = false;
    let isFrameComplete = false;

    // 1. HEALTH: %3.0f%%
    if (/HEALTH:/i.test(line)) {
      const match = line.match(/HEALTH:\s*([+-]?\s*[\d.]+)/i);
      const val = this.parseNum(match?.[1]);
      if (val !== null) {
        this.current.health = Math.min(100, Math.max(0, val));
        updated = true;
      }
    }

    // 2. STATE: %s
    if (/STATE:/i.test(line)) {
      const match = line.match(/STATE:\s*([A-Za-z0-9 _-]+)/i);
      if (match?.[1]) {
        this.current.state = match[1].trim().toUpperCase();
        updated = true;
      }
    }

    // 3. EVENT: %s
    if (/EVENT:/i.test(line)) {
      const match = line.match(/EVENT:\s*([A-Za-z0-9 _-]+)/i);
      if (match?.[1]) {
        this.current.event = match[1].trim();
        updated = true;
      }
    }

    // 4. AI CONFIDENCE: %3.0f%%
    if (/CONFIDENCE:/i.test(line)) {
      const match = line.match(/CONFIDENCE:\s*([+-]?\s*[\d.]+)/i);
      const val = this.parseNum(match?.[1]);
      if (val !== null) {
        this.current.confidence = Math.min(100, Math.max(0, val));
        updated = true;
      }
    }

    // 5. ACCEL [g]: X:%+5.2f Y:%+5.2f Z:%+5.2f | |A|: %4.2f g
    if (/ACCEL/i.test(line)) {
      const mX = line.match(/X:\s*([+-]?\s*[\d.]+)/i);
      const mY = line.match(/Y:\s*([+-]?\s*[\d.]+)/i);
      const mZ = line.match(/Z:\s*([+-]?\s*[\d.]+)/i);
      const mA = line.match(/\|A\|:\s*([+-]?\s*[\d.]+)/i);

      const ax = this.parseNum(mX?.[1]);
      const ay = this.parseNum(mY?.[1]);
      const az = this.parseNum(mZ?.[1]);
      const aTot = this.parseNum(mA?.[1]);

      if (ax !== null) this.current.ax = ax;
      if (ay !== null) this.current.ay = ay;
      if (az !== null) this.current.az = az;

      if (aTot !== null) {
        this.current.aTotal = aTot;
      } else if (ax !== null && ay !== null && az !== null) {
        this.current.aTotal = Math.sqrt(ax * ax + ay * ay + az * az);
      }
      updated = true;
    }

    // 6. GYRO [°/s]: X:%+5.1f Y:%+5.1f Z:%+5.1f | |W|: %5.1f °/s
    if (/GYRO/i.test(line)) {
      const mX = line.match(/X:\s*([+-]?\s*[\d.]+)/i);
      const mY = line.match(/Y:\s*([+-]?\s*[\d.]+)/i);
      const mZ = line.match(/Z:\s*([+-]?\s*[\d.]+)/i);
      const mW = line.match(/\|W\|:\s*([+-]?\s*[\d.]+)/i);

      const gx = this.parseNum(mX?.[1]);
      const gy = this.parseNum(mY?.[1]);
      const gz = this.parseNum(mZ?.[1]);
      const gTot = this.parseNum(mW?.[1]);

      if (gx !== null) this.current.gx = gx;
      if (gy !== null) this.current.gy = gy;
      if (gz !== null) this.current.gz = gz;

      if (gTot !== null) {
        this.current.gTotal = gTot;
      } else if (gx !== null && gy !== null && gz !== null) {
        this.current.gTotal = Math.sqrt(gx * gx + gy * gy + gz * gz);
      }
      updated = true;
    }

    // 7. MAG [Gauss]: X:%+5.2f Y:%+5.2f Z:%+5.2f | |B|: %4.2f G
    if (/MAG/i.test(line)) {
      const mX = line.match(/X:\s*([+-]?\s*[\d.]+)/i);
      const mY = line.match(/Y:\s*([+-]?\s*[\d.]+)/i);
      const mZ = line.match(/Z:\s*([+-]?\s*[\d.]+)/i);
      const mB = line.match(/\|B\|:\s*([+-]?\s*[\d.]+)/i);

      const mx = this.parseNum(mX?.[1]);
      const my = this.parseNum(mY?.[1]);
      const mz = this.parseNum(mZ?.[1]);
      const bTot = this.parseNum(mB?.[1]);

      if (mx !== null) this.current.mx = mx;
      if (my !== null) this.current.my = my;
      if (mz !== null) this.current.mz = mz;

      if (bTot !== null) {
        this.current.bTotal = bTot;
      } else if (mx !== null && my !== null && mz !== null) {
        this.current.bTotal = Math.sqrt(mx * mx + my * my + mz * mz);
      }
      updated = true;
    }

    // 8. ATTITUDE: Pitch: %+5.1f° | Roll: %+5.1f° | Hdg: %5.1f° [%s]
    if (/ATTITUDE/i.test(line)) {
      const mP = line.match(/Pitch:\s*([+-]?\s*[\d.]+)/i);
      const mR = line.match(/Roll:\s*([+-]?\s*[\d.]+)/i);
      const mH = line.match(/(?:Hdg|Heading):\s*([+-]?\s*[\d.]+)/i);
      const mC = line.match(/\[\s*([A-Za-z0-9._-]+)\s*\]/);

      const pitch = this.parseNum(mP?.[1]);
      const roll = this.parseNum(mR?.[1]);
      const hdg = this.parseNum(mH?.[1]);

      if (pitch !== null) this.current.pitch = pitch;
      if (roll !== null) this.current.roll = roll;
      if (hdg !== null) this.current.heading = hdg;
      if (mC?.[1]) this.current.cardinal = mC[1].trim();

      updated = true;
      // ATTITUDE is the last line of the VIGYANSAT frame -> commit full frame atomically!
      isFrameComplete = true;
    }

    // 9. Frame boundary delimiter
    if (line.startsWith('---') || line.includes('VIGYANSAT-01 TELEMETRY FRAME')) {
      // Boundary marker
      if (updated) {
        isFrameComplete = true;
      }
    }

    // 10. JSON Fallback
    if (!updated && (line.startsWith('{') || line.includes('{"'))) {
      try {
        const jsonMatch = line.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const obj = JSON.parse(jsonMatch[0]);
          if (typeof obj === 'object' && obj !== null) {
            const num = (v: unknown): number | null => {
              if (typeof v === 'number') return isNaN(v) ? null : v;
              if (typeof v === 'string') return this.parseNum(v);
              return null;
            };

            const ax = num(obj.ax ?? obj.AX);
            const ay = num(obj.ay ?? obj.AY);
            const az = num(obj.az ?? obj.AZ);
            if (ax !== null) this.current.ax = ax;
            if (ay !== null) this.current.ay = ay;
            if (az !== null) this.current.az = az;

            const gx = num(obj.gx ?? obj.GX);
            const gy = num(obj.gy ?? obj.GY);
            const gz = num(obj.gz ?? obj.GZ);
            if (gx !== null) this.current.gx = gx;
            if (gy !== null) this.current.gy = gy;
            if (gz !== null) this.current.gz = gz;

            const mx = num(obj.mx ?? obj.MX);
            const my = num(obj.my ?? obj.MY);
            const mz = num(obj.mz ?? obj.MZ);
            if (mx !== null) this.current.mx = mx;
            if (my !== null) this.current.my = my;
            if (mz !== null) this.current.mz = mz;

            const pitch = num(obj.pitch ?? obj.PITCH);
            const roll = num(obj.roll ?? obj.ROLL);
            const hdg = num(obj.heading ?? obj.HDG ?? obj.yaw);
            if (pitch !== null) this.current.pitch = pitch;
            if (roll !== null) this.current.roll = roll;
            if (hdg !== null) this.current.heading = hdg;

            const health = num(obj.health ?? obj.HEALTH);
            if (health !== null) this.current.health = health;

            this.current.aTotal = Math.sqrt(this.current.ax ** 2 + this.current.ay ** 2 + this.current.az ** 2);
            this.current.gTotal = Math.sqrt(this.current.gx ** 2 + this.current.gy ** 2 + this.current.gz ** 2);
            this.current.bTotal = Math.sqrt(this.current.mx ** 2 + this.current.my ** 2 + this.current.mz ** 2);

            updated = true;
            isFrameComplete = true;
          }
        }
      } catch {
        // Ignore JSON error
      }
    }

    // Atomic commit: return completed frame when ATTITUDE or JSON arrives, or fallback if updated
    if (isFrameComplete || (updated && (this.current.ax !== 0 || this.current.pitch !== 0))) {
      this.current.timestamp = Date.now();
      return { ...this.current };
    }

    return null;
  }
}
