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
 * Universal Telemetry Frame Parser
 * Automatically parses:
 * - VIGYANSAT official protocol frames
 * - Key-value strings (Pitch: 12.3, Roll: -4.5, Yaw: 180.2)
 * - MPU6050 DMP "ypr\t120.5\t15.2\t-8.4" and "rpy" formats
 * - Accelerometer / Gyroscope / Magnetometer triplets (with or without X/Y/Z labels)
 * - CSV, TSV, space-separated sensor arrays (2 to 14 elements)
 * - Auto-unit normalization (raw ADC counts, m/s², rad/s, and °/s)
 * - JSON streams
 */
export class TelemetryFrameParser {
  private current: TelemetryData = { ...initialTelemetryState };
  private hasExplicitAttitude: boolean = false;

  public reset() {
    this.current = { ...initialTelemetryState };
    this.hasExplicitAttitude = false;
  }

  private parseNum(str: string | undefined): number | null {
    if (!str) return null;
    const cleaned = str.replace(/[^\d.+-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '+') return null;
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  }

  // Normalizes raw counts (16384 = 1g) or m/s² (9.81 = 1g) to Gs
  private normalizeAccel(val: number): number {
    if (Math.abs(val) > 200) {
      return val / 16384.0; // 16-bit raw MPU6050 counts
    }
    if (Math.abs(val) > 4.5 && Math.abs(val) < 25.0) {
      return val / 9.80665; // m/s² to g
    }
    return val;
  }

  // Normalizes raw gyro counts (131 = 1 dps) or rad/s to °/s
  private normalizeGyro(val: number): number {
    if (Math.abs(val) > 250) {
      return val / 131.0; // 16-bit raw MPU6050 counts (FS_SEL=0: 131 LSB/(°/s))
    }
    if (Math.abs(val) > 0 && Math.abs(val) < 0.1) {
      return val * (180 / Math.PI); // rad/s to °/s
    }
    return val;
  }

  private updateCardinalFromHeading(heading: number) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const normalized = ((heading % 360) + 360) % 360;
    const index = Math.round(normalized / 22.5) % 16;
    this.current.cardinal = directions[index];
  }

  public parseLine(rawLine: string): TelemetryData | null {
    const line = rawLine.trim();
    if (!line) return null;

    let updated = false;

    // 1. HEALTH: %3.0f%%
    if (/HEALTH/i.test(line)) {
      const match = line.match(/\bHEALTH\b(?:\s*[:=]?\s*|\s+)([+-]?\s*[\d.]+)/i);
      const val = this.parseNum(match?.[1]);
      if (val !== null) {
        this.current.health = Math.min(100, Math.max(0, val));
        updated = true;
      }
    }

    // 2. STATE: %s
    if (/STATE/i.test(line)) {
      const match = line.match(/\bSTATE\b(?:\s*[:=]?\s*|\s+)([A-Za-z0-9 _-]+)/i);
      if (match?.[1]) {
        this.current.state = match[1].trim().toUpperCase();
        updated = true;
      }
    }

    // 3. EVENT: %s
    if (/EVENT/i.test(line)) {
      const match = line.match(/\bEVENT\b(?:\s*[:=]?\s*|\s+)([A-Za-z0-9 _-]+)/i);
      if (match?.[1]) {
        this.current.event = match[1].trim();
        updated = true;
      }
    }

    // 4. CONFIDENCE: %3.0f%%
    if (/CONFIDENCE/i.test(line)) {
      const match = line.match(/\bCONFIDENCE\b(?:\s*[:=]?\s*|\s+)([+-]?\s*[\d.]+)/i);
      const val = this.parseNum(match?.[1]);
      if (val !== null) {
        this.current.confidence = Math.min(100, Math.max(0, val));
        updated = true;
      }
    }

    // 5. MPU6050 DMP SPECIAL: "ypr\t120.5\t15.2\t-8.4" (Yaw, Pitch, Roll)
    const yprMatch = line.match(/\bypr\b\s*[:=]?\s*([+-]?[\d.]+)[,\s\t]+([+-]?[\d.]+)[,\s\t]+([+-]?[\d.]+)/i);
    if (yprMatch) {
      const y = this.parseNum(yprMatch[1]);
      const p = this.parseNum(yprMatch[2]);
      const r = this.parseNum(yprMatch[3]);
      if (y !== null) this.current.heading = y;
      if (p !== null) this.current.pitch = p;
      if (r !== null) this.current.roll = r;
      this.hasExplicitAttitude = true;
      updated = true;
    }

    // 6. RPY SPECIAL: "rpy\t-8.4\t15.2\t120.5" (Roll, Pitch, Yaw)
    const rpyMatch = line.match(/\brpy\b\s*[:=]?\s*([+-]?[\d.]+)[,\s\t]+([+-]?[\d.]+)[,\s\t]+([+-]?[\d.]+)/i);
    if (rpyMatch) {
      const r = this.parseNum(rpyMatch[1]);
      const p = this.parseNum(rpyMatch[2]);
      const y = this.parseNum(rpyMatch[3]);
      if (r !== null) this.current.roll = r;
      if (p !== null) this.current.pitch = p;
      if (y !== null) this.current.heading = y;
      this.hasExplicitAttitude = true;
      updated = true;
    }

    // 7. PRY SPECIAL: "pry\t15.2\t-8.4\t120.5" (Pitch, Roll, Yaw)
    const pryMatch = line.match(/\bpry\b\s*[:=]?\s*([+-]?[\d.]+)[,\s\t]+([+-]?[\d.]+)[,\s\t]+([+-]?[\d.]+)/i);
    if (pryMatch) {
      const p = this.parseNum(pryMatch[1]);
      const r = this.parseNum(pryMatch[2]);
      const y = this.parseNum(pryMatch[3]);
      if (p !== null) this.current.pitch = p;
      if (r !== null) this.current.roll = r;
      if (y !== null) this.current.heading = y;
      this.hasExplicitAttitude = true;
      updated = true;
    }

    // 8. KEY-VALUE ATTITUDE: Pitch, Roll, Yaw / Heading (e.g. "Pitch: 12.3 Roll: -4.5 Yaw: 180.2")
    if (!yprMatch && !rpyMatch && !pryMatch && /PITCH|ROLL|HDG|HEADING|YAW|ATTITUDE/i.test(line)) {
      const mP = line.match(/\b(?:Pitch|P)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mR = line.match(/\b(?:Roll|R)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mH = line.match(/\b(?:Hdg|Heading|Yaw|Y)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mC = line.match(/\[\s*([A-Za-z0-9._-]+)\s*\]/);

      const pitch = this.parseNum(mP?.[1]);
      const roll = this.parseNum(mR?.[1]);
      const hdg = this.parseNum(mH?.[1]);

      if (pitch !== null) this.current.pitch = pitch;
      if (roll !== null) this.current.roll = roll;
      if (hdg !== null) this.current.heading = hdg;
      if (mC?.[1]) this.current.cardinal = mC[1].trim();

      if (pitch !== null || roll !== null || hdg !== null) {
        this.hasExplicitAttitude = true;
        updated = true;
      }
    }

    // 9. ACCELEROMETER: ACCEL or AX/AY/AZ or "Accel: 0.1, 0.2, 0.9"
    if (/ACCEL|ACC\b|A\s*[:=]/i.test(line)) {
      const mX = line.match(/\b(?:AX|ACCEL_X|X)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mY = line.match(/\b(?:AY|ACCEL_Y|Y)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mZ = line.match(/\b(?:AZ|ACCEL_Z|Z)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mA = line.match(/\|A\|\s*[:=]?\s*([+-]?\s*[\d.]+)/i);

      let ax = this.parseNum(mX?.[1]);
      let ay = this.parseNum(mY?.[1]);
      let az = this.parseNum(mZ?.[1]);
      const aTot = this.parseNum(mA?.[1]);

      // If no explicit X/Y/Z labels, check for list of numbers right after ACCEL label
      if (ax === null && ay === null && az === null) {
        const afterPrefix = line.replace(/^[A-Za-z0-9_.\s]*?(?:ACCEL|ACC|A)\s*[:=]?\s*/i, '');
        const nums = afterPrefix.split(/[,;\s\t]+/).map(p => this.parseNum(p)).filter((n): n is number => n !== null);
        if (nums.length >= 3) {
          ax = nums[0];
          ay = nums[1];
          az = nums[2];
        }
      }

      if (ax !== null || ay !== null || az !== null || aTot !== null) {
        if (ax !== null) this.current.ax = this.normalizeAccel(ax);
        if (ay !== null) this.current.ay = this.normalizeAccel(ay);
        if (az !== null) this.current.az = this.normalizeAccel(az);

        if (aTot !== null) {
          this.current.aTotal = aTot;
        } else {
          this.current.aTotal = Math.sqrt(this.current.ax ** 2 + this.current.ay ** 2 + this.current.az ** 2);
        }

        // Only compute pitch & roll from accelerometer if sketch does NOT output fused attitude
        if (!this.hasExplicitAttitude) {
          const curAx = this.current.ax;
          const curAy = this.current.ay;
          const curAz = this.current.az;
          if (curAx !== 0 || curAy !== 0 || curAz !== 0) {
            const radToDeg = 180 / Math.PI;
            this.current.pitch = Math.atan2(-curAx, Math.sqrt(curAy * curAy + curAz * curAz)) * radToDeg;
            this.current.roll = Math.atan2(curAy, curAz) * radToDeg;
          }
        }
        updated = true;
      }
    }

    // 10. GYROSCOPE: GYRO or GX/GY/GZ or "Gyro: 0.1, 0.2, 0.3"
    if (/GYRO|GYR\b|G\s*[:=]/i.test(line)) {
      const mX = line.match(/\b(?:GX|GYRO_X|X)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mY = line.match(/\b(?:GY|GYRO_Y|Y)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mZ = line.match(/\b(?:GZ|GYRO_Z|Z)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mW = line.match(/\|W\|\s*[:=]?\s*([+-]?\s*[\d.]+)/i);

      let gx = this.parseNum(mX?.[1]);
      let gy = this.parseNum(mY?.[1]);
      let gz = this.parseNum(mZ?.[1]);
      const gTot = this.parseNum(mW?.[1]);

      if (gx === null && gy === null && gz === null) {
        const afterPrefix = line.replace(/^[A-Za-z0-9_.\s]*?(?:GYRO|GYR|G)\s*[:=]?\s*/i, '');
        const nums = afterPrefix.split(/[,;\s\t]+/).map(p => this.parseNum(p)).filter((n): n is number => n !== null);
        if (nums.length >= 3) {
          gx = nums[0];
          gy = nums[1];
          gz = nums[2];
        }
      }

      if (gx !== null || gy !== null || gz !== null || gTot !== null) {
        if (gx !== null) this.current.gx = this.normalizeGyro(gx);
        if (gy !== null) this.current.gy = this.normalizeGyro(gy);
        if (gz !== null) this.current.gz = this.normalizeGyro(gz);

        if (gTot !== null) {
          this.current.gTotal = gTot;
        } else {
          this.current.gTotal = Math.sqrt(this.current.gx ** 2 + this.current.gy ** 2 + this.current.gz ** 2);
        }
        updated = true;
      }
    }

    // 11. MAGNETOMETER: MAG or MX/MY/MZ or "Mag: 15.2, -8.4, 42.1"
    if (/MAG|MMC|M\s*[:=]/i.test(line)) {
      const mX = line.match(/\b(?:MX|MAG_X|X)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mY = line.match(/\b(?:MY|MAG_Y|Y)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mZ = line.match(/\b(?:MZ|MAG_Z|Z)\b\s*[:=]?\s*([+-]?\s*[\d.]+)/i);
      const mB = line.match(/\|B\|\s*[:=]?\s*([+-]?\s*[\d.]+)/i);

      let mx = this.parseNum(mX?.[1]);
      let my = this.parseNum(mY?.[1]);
      let mz = this.parseNum(mZ?.[1]);
      const bTot = this.parseNum(mB?.[1]);

      if (mx === null && my === null && mz === null) {
        const afterPrefix = line.replace(/^[A-Za-z0-9_.\s]*?(?:MAG|MMC|M)\s*[:=]?\s*/i, '');
        const nums = afterPrefix.split(/[,;\s\t]+/).map(p => this.parseNum(p)).filter((n): n is number => n !== null);
        if (nums.length >= 3) {
          mx = nums[0];
          my = nums[1];
          mz = nums[2];
        }
      }

      if (mx !== null || my !== null || mz !== null || bTot !== null) {
        if (mx !== null) this.current.mx = mx;
        if (my !== null) this.current.my = my;
        if (mz !== null) this.current.mz = mz;

        if (bTot !== null) {
          this.current.bTotal = bTot;
        } else {
          this.current.bTotal = Math.sqrt(this.current.mx ** 2 + this.current.my ** 2 + this.current.mz ** 2);
        }

        // Auto-compute Heading from Magnetometer if no explicit attitude provided
        if (!this.hasExplicitAttitude && (this.current.mx !== 0 || this.current.my !== 0)) {
          let hdg = Math.atan2(-this.current.my, this.current.mx) * (180 / Math.PI);
          if (hdg < 0) hdg += 360;
          this.current.heading = hdg;
        }
        updated = true;
      }
    }

    // 12. TEMPERATURE: TEMP: %f or T: %f
    if (/TEMP/i.test(line)) {
      const match = line.match(/\b(?:TEMP|TEMPERATURE|T)\b(?:\s*[:=]?\s*|\s+)([+-]?\s*[\d.]+)/i);
      const val = this.parseNum(match?.[1]);
      if (val !== null) {
        this.current.temp = val;
        updated = true;
      }
    }

    // 13. MULTI-VALUE / DELIMITED NUMBER LIST (CSV, TSV, SEMICOLON, OR SPACE SEPARATED)
    if (!updated) {
      // Strip common prefixes like "DATA:", "IMU:", "ATT:", "RAW:", "ORIENTATION:"
      const cleanedLine = line.replace(/^[A-Za-z0-9_.-]+[:=]\s*/, '').trim();
      const parts = cleanedLine.split(/[,;\t]+|\s+/).map((p) => this.parseNum(p.trim()));
      const validNumbers = parts.filter((n): n is number => n !== null);

      // Optional Arduino timestamp detection: if first number is an integer timestamp (> 1000), strip it
      const isFirstNumTimestamp = validNumbers.length >= 4 && validNumbers[0] > 1000 && Number.isInteger(validNumbers[0]);
      const numbers = isFirstNumTimestamp ? validNumbers.slice(1) : validNumbers;

      if (numbers.length >= 9) {
        // [ax, ay, az, gx, gy, gz, mx, my, mz]
        this.current.ax = this.normalizeAccel(numbers[0]);
        this.current.ay = this.normalizeAccel(numbers[1]);
        this.current.az = this.normalizeAccel(numbers[2]);
        this.current.gx = this.normalizeGyro(numbers[3]);
        this.current.gy = this.normalizeGyro(numbers[4]);
        this.current.gz = this.normalizeGyro(numbers[5]);
        this.current.mx = numbers[6];
        this.current.my = numbers[7];
        this.current.mz = numbers[8];

        this.current.aTotal = Math.sqrt(this.current.ax ** 2 + this.current.ay ** 2 + this.current.az ** 2);
        this.current.gTotal = Math.sqrt(this.current.gx ** 2 + this.current.gy ** 2 + this.current.gz ** 2);
        this.current.bTotal = Math.sqrt(this.current.mx ** 2 + this.current.my ** 2 + this.current.mz ** 2);

        if (numbers.length >= 12) {
          this.current.pitch = numbers[9];
          this.current.roll = numbers[10];
          this.current.heading = numbers[11];
          this.hasExplicitAttitude = true;
        } else if (!this.hasExplicitAttitude) {
          const radToDeg = 180 / Math.PI;
          this.current.pitch = Math.atan2(-this.current.ax, Math.sqrt(this.current.ay ** 2 + this.current.az ** 2)) * radToDeg;
          this.current.roll = Math.atan2(this.current.ay, this.current.az) * radToDeg;

          // Compute tilt-compensated heading from MMC5983MA Magnetometer
          if (this.current.mx !== 0 || this.current.my !== 0) {
            const pRad = (this.current.pitch * Math.PI) / 180;
            const rRad = (this.current.roll * Math.PI) / 180;
            const cosP = Math.cos(pRad);
            const sinP = Math.sin(pRad);
            const cosR = Math.cos(rRad);
            const sinR = Math.sin(rRad);
            const Xh = this.current.mx * cosP + this.current.my * sinR * sinP + this.current.mz * cosR * sinP;
            const Yh = this.current.my * cosR - this.current.mz * sinR;
            let hdg = Math.atan2(-Yh, Xh) * radToDeg;
            if (hdg < 0) hdg += 360;
            this.current.heading = hdg;
          }
        }
        updated = true;
      } else if (numbers.length >= 6) {
        // [ax, ay, az, gx, gy, gz]
        this.current.ax = this.normalizeAccel(numbers[0]);
        this.current.ay = this.normalizeAccel(numbers[1]);
        this.current.az = this.normalizeAccel(numbers[2]);
        this.current.gx = this.normalizeGyro(numbers[3]);
        this.current.gy = this.normalizeGyro(numbers[4]);
        this.current.gz = this.normalizeGyro(numbers[5]);

        this.current.aTotal = Math.sqrt(this.current.ax ** 2 + this.current.ay ** 2 + this.current.az ** 2);
        this.current.gTotal = Math.sqrt(this.current.gx ** 2 + this.current.gy ** 2 + this.current.gz ** 2);

        if (numbers.length >= 7) {
          this.current.temp = numbers[6];
        }
        if (!this.hasExplicitAttitude) {
          const radToDeg = 180 / Math.PI;
          this.current.pitch = Math.atan2(-this.current.ax, Math.sqrt(this.current.ay ** 2 + this.current.az ** 2)) * radToDeg;
          this.current.roll = Math.atan2(this.current.ay, this.current.az) * radToDeg;
        }
        updated = true;
      } else if (numbers.length >= 3) {
        // Determine whether [pitch, roll, yaw] or [ax, ay, az]
        // If numbers look like angles (e.g. > 2.0 or negative), it's attitude
        if (Math.abs(numbers[0]) > 2.5 || Math.abs(numbers[1]) > 2.5 || Math.abs(numbers[2]) > 2.5) {
          this.current.pitch = numbers[0];
          this.current.roll = numbers[1];
          this.current.heading = numbers[2];
          this.hasExplicitAttitude = true;
        } else {
          this.current.ax = this.normalizeAccel(numbers[0]);
          this.current.ay = this.normalizeAccel(numbers[1]);
          this.current.az = this.normalizeAccel(numbers[2]);
          this.current.aTotal = Math.sqrt(this.current.ax ** 2 + this.current.ay ** 2 + this.current.az ** 2);

          if (!this.hasExplicitAttitude) {
            const radToDeg = 180 / Math.PI;
            this.current.pitch = Math.atan2(-this.current.ax, Math.sqrt(this.current.ay ** 2 + this.current.az ** 2)) * radToDeg;
            this.current.roll = Math.atan2(this.current.ay, this.current.az) * radToDeg;
          }
        }
        if (numbers.length >= 4) {
          this.current.temp = numbers[3];
        }
        updated = true;
      } else if (numbers.length === 2) {
        // [pitch, roll]
        this.current.pitch = numbers[0];
        this.current.roll = numbers[1];
        this.hasExplicitAttitude = true;
        updated = true;
      }
    }

    // 14. JSON Fallback
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

            const ax = num(obj.ax ?? obj.AX ?? obj.accel_x ?? obj.acc_x);
            const ay = num(obj.ay ?? obj.AY ?? obj.accel_y ?? obj.acc_y);
            const az = num(obj.az ?? obj.AZ ?? obj.accel_z ?? obj.acc_z);
            if (ax !== null) this.current.ax = this.normalizeAccel(ax);
            if (ay !== null) this.current.ay = this.normalizeAccel(ay);
            if (az !== null) this.current.az = this.normalizeAccel(az);

            const gx = num(obj.gx ?? obj.GX ?? obj.gyro_x);
            const gy = num(obj.gy ?? obj.GY ?? obj.gyro_y);
            const gz = num(obj.gz ?? obj.GZ ?? obj.gyro_z);
            if (gx !== null) this.current.gx = this.normalizeGyro(gx);
            if (gy !== null) this.current.gy = this.normalizeGyro(gy);
            if (gz !== null) this.current.gz = this.normalizeGyro(gz);

            const mx = num(obj.mx ?? obj.MX ?? obj.mag_x);
            const my = num(obj.my ?? obj.MY ?? obj.mag_y);
            const mz = num(obj.mz ?? obj.MZ ?? obj.mag_z);
            if (mx !== null) this.current.mx = mx;
            if (my !== null) this.current.my = my;
            if (mz !== null) this.current.mz = mz;

            const pitch = num(obj.pitch ?? obj.PITCH ?? obj.p);
            const roll = num(obj.roll ?? obj.ROLL ?? obj.r);
            const hdg = num(obj.heading ?? obj.HDG ?? obj.yaw ?? obj.YAW ?? obj.y);
            if (pitch !== null) this.current.pitch = pitch;
            if (roll !== null) this.current.roll = roll;
            if (hdg !== null) this.current.heading = hdg;

            // If pitch & roll not explicitly provided, estimate from accelerometer
            if (pitch === null && (this.current.ax !== 0 || this.current.ay !== 0 || this.current.az !== 0)) {
              const radToDeg = 180 / Math.PI;
              this.current.pitch = Math.atan2(-this.current.ax, Math.sqrt(this.current.ay ** 2 + this.current.az ** 2)) * radToDeg;
              this.current.roll = Math.atan2(this.current.ay, this.current.az) * radToDeg;
            }

            // If heading not explicitly provided, estimate from tilt-compensated magnetometer
            if (hdg === null && (this.current.mx !== 0 || this.current.my !== 0)) {
              const pRad = (this.current.pitch * Math.PI) / 180;
              const rRad = (this.current.roll * Math.PI) / 180;
              const cosP = Math.cos(pRad);
              const sinP = Math.sin(pRad);
              const cosR = Math.cos(rRad);
              const sinR = Math.sin(rRad);
              const Xh = this.current.mx * cosP + this.current.my * sinR * sinP + this.current.mz * cosR * sinP;
              const Yh = this.current.my * cosR - this.current.mz * sinR;
              let computedHdg = Math.atan2(-Yh, Xh) * (180 / Math.PI);
              if (computedHdg < 0) computedHdg += 360;
              this.current.heading = computedHdg;
            }

            const health = num(obj.health ?? obj.HEALTH);
            if (health !== null) this.current.health = health;

            const temp = num(obj.temp ?? obj.TEMP ?? obj.temperature);
            if (temp !== null) this.current.temp = temp;

            this.current.aTotal = Math.sqrt(this.current.ax ** 2 + this.current.ay ** 2 + this.current.az ** 2);
            this.current.gTotal = Math.sqrt(this.current.gx ** 2 + this.current.gy ** 2 + this.current.gz ** 2);
            this.current.bTotal = Math.sqrt(this.current.mx ** 2 + this.current.my ** 2 + this.current.mz ** 2);

            updated = true;
          }
        }
      } catch {
        // Ignore JSON error
      }
    }

    if (updated) {
      if (typeof this.current.heading === 'number' && !isNaN(this.current.heading)) {
        this.updateCardinalFromHeading(this.current.heading);
      }
      this.current.timestamp = Date.now();
      return { ...this.current };
    }

    return null;
  }
}
