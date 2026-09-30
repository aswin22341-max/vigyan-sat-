import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TelemetryData, IrregularAlert } from '../types/telemetry';

interface CubeSatelliteViewerProps {
  telemetry: TelemetryData | null;
  alert: IrregularAlert;
  isConnected: boolean;
}

export const CubeSatelliteViewer: React.FC<CubeSatelliteViewerProps> = ({
  telemetry,
  alert,
  isConnected,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const targetQuaternionRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const hasTelemetryRef = useRef<boolean>(false);
  const isConnectedRef = useRef<boolean>(false);
  const alertRef = useRef<IrregularAlert>(alert);
  const beaconLightRef = useRef<THREE.PointLight | null>(null);
  const beaconMeshRef = useRef<THREE.Mesh | null>(null);
  const resetCameraFnRef = useRef<(() => void) | null>(null);

  // Manual rotation test offsets
  const manualPitchRef = useRef<number>(0);
  const manualRollRef = useRef<number>(0);
  const manualYawRef = useRef<number>(0);
  const [manualOffset, setManualOffset] = useState<{ pitch: number; roll: number; yaw: number }>({
    pitch: 0,
    roll: 0,
    yaw: 0,
  });

  // Auto 3D orbit tumble demo mode
  const [isAutoTumbling, setIsAutoTumbling] = useState<boolean>(false);
  const isAutoTumblingRef = useRef<boolean>(false);

  // High-stability filtered attitude memory
  const smoothedPitch = useRef<number>(0);
  const smoothedRoll = useRef<number>(0);
  const smoothedHeading = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);

  useEffect(() => {
    isAutoTumblingRef.current = isAutoTumbling;
  }, [isAutoTumbling]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
    if (!isConnected) {
      hasTelemetryRef.current = false;
      isInitializedRef.current = false;
      if (!isAutoTumblingRef.current && manualPitchRef.current === 0 && manualRollRef.current === 0 && manualYawRef.current === 0) {
        targetQuaternionRef.current.identity();
      }
    }
  }, [isConnected]);

  useEffect(() => {
    alertRef.current = alert;
  }, [alert]);

  // ULTRA-STABLE ADAPTIVE ATTITUDE DETERMINATION
  // Locks rock-solid when resting on desk, tracks fluidly when rotated in all directions
  useEffect(() => {
    if (isConnected && telemetry) {
      hasTelemetryRef.current = true;
      const { pitch, roll, heading, ax, ay, az, mx, my, gTotal } = telemetry;

      let inPitch = 0;
      if (typeof pitch === 'number' && !isNaN(pitch)) {
        inPitch = pitch;
      } else if (typeof ax === 'number' && typeof ay === 'number' && typeof az === 'number') {
        inPitch = THREE.MathUtils.radToDeg(Math.atan2(-ax, Math.sqrt(ay * ay + az * az)));
      }

      let inRoll = 0;
      if (typeof roll === 'number' && !isNaN(roll)) {
        inRoll = roll;
      } else if (typeof ay === 'number' && typeof az === 'number' && (ay !== 0 || az !== 0)) {
        inRoll = THREE.MathUtils.radToDeg(Math.atan2(ay, az));
      }

      let inHeading = 0;
      if (typeof heading === 'number' && !isNaN(heading)) {
        inHeading = heading;
      } else if (typeof mx === 'number' && typeof my === 'number' && (mx !== 0 || my !== 0)) {
        let hdg = THREE.MathUtils.radToDeg(Math.atan2(-my, mx));
        if (hdg < 0) hdg += 360;
        inHeading = hdg;
      }

      if (!isInitializedRef.current) {
        // Fast seed on first packet
        smoothedPitch.current = inPitch;
        smoothedRoll.current = inRoll;
        smoothedHeading.current = inHeading;
        isInitializedRef.current = true;
      } else {
        // ADAPTIVE STABILIZATION:
        // Check if device is stationary (gyro rate < 2.5 deg/s and small angular delta)
        const gyroRate = typeof gTotal === 'number' ? gTotal : 0;
        const dP = Math.abs(inPitch - smoothedPitch.current);
        const dR = Math.abs(inRoll - smoothedRoll.current);
        let dH = inHeading - smoothedHeading.current;
        while (dH > 180) dH -= 360;
        while (dH < -180) dH += 360;
        const absDH = Math.abs(dH);

        const isQuiet = gyroRate < 2.5 && dP < 0.45 && dR < 0.45 && absDH < 0.6;

        if (isQuiet) {
          // Stationary state: apply heavy damping to freeze sensor electronic micro-noise completely
          smoothedPitch.current += (inPitch - smoothedPitch.current) * 0.08;
          smoothedRoll.current += (inRoll - smoothedRoll.current) * 0.08;
          smoothedHeading.current += dH * 0.08;
        } else {
          // Dynamic motion state: fast, responsive tracking in all directions
          const dynamicWeight = THREE.MathUtils.clamp(0.4 + gyroRate * 0.02, 0.4, 0.85);
          smoothedPitch.current += (inPitch - smoothedPitch.current) * dynamicWeight;
          smoothedRoll.current += (inRoll - smoothedRoll.current) * dynamicWeight;
          smoothedHeading.current += dH * dynamicWeight;
        }

        while (smoothedHeading.current < 0) smoothedHeading.current += 360;
        while (smoothedHeading.current >= 360) smoothedHeading.current -= 360;
      }

      // Add any manual offset
      const finalPitch = smoothedPitch.current + manualPitchRef.current;
      const finalRoll = smoothedRoll.current + manualRollRef.current;
      const finalYaw = smoothedHeading.current + manualYawRef.current;

      // FULL 3D QUATERNION ROTATION (NO GIMBAL LOCK, ROTATES IN ALL DIRECTIONS)
      const pitchRad = -THREE.MathUtils.degToRad(finalPitch);
      const yawRad = THREE.MathUtils.degToRad(finalYaw);
      const rollRad = -THREE.MathUtils.degToRad(finalRoll);

      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRad);
      const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRad);

      targetQuaternionRef.current.copy(qYaw).multiply(qPitch).multiply(qRoll);
    } else if (!hasTelemetryRef.current && (manualPitchRef.current !== 0 || manualRollRef.current !== 0 || manualYawRef.current !== 0)) {
      // Manual test rotation mode
      const pitchRad = -THREE.MathUtils.degToRad(manualPitchRef.current);
      const yawRad = THREE.MathUtils.degToRad(manualYawRef.current);
      const rollRad = -THREE.MathUtils.degToRad(manualRollRef.current);

      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRad);
      const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRad);

      targetQuaternionRef.current.copy(qYaw).multiply(qPitch).multiply(qRoll);
    }
  }, [telemetry, isConnected, manualOffset]);

  const handleManualRotate = (axis: 'pitch' | 'roll' | 'yaw', delta: number) => {
    if (axis === 'pitch') {
      manualPitchRef.current = (manualPitchRef.current + delta) % 360;
    } else if (axis === 'roll') {
      manualRollRef.current = (manualRollRef.current + delta) % 360;
    } else if (axis === 'yaw') {
      manualYawRef.current = (manualYawRef.current + delta) % 360;
    }
    setManualOffset({
      pitch: manualPitchRef.current,
      roll: manualRollRef.current,
      yaw: manualYawRef.current,
    });
  };

  const handleResetOrientation = () => {
    manualPitchRef.current = 0;
    manualRollRef.current = 0;
    manualYawRef.current = 0;
    setManualOffset({ pitch: 0, roll: 0, yaw: 0 });
    setIsAutoTumbling(false);
    if (!isConnectedRef.current || !hasTelemetryRef.current) {
      targetQuaternionRef.current.identity();
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    // Dynamic framing
    const computeIdealRadius = (aspect: number) => {
      const baseRadius = 4.8;
      return aspect < 1.3 ? baseRadius * (1.3 / Math.max(0.65, aspect)) : baseRadius;
    };

    let aspect = container.clientWidth / container.clientHeight;
    let cameraRadius = computeIdealRadius(aspect);
    let cameraAngleY = 0.52;
    let cameraAngleX = 0.28;

    const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 100);

    const updateCameraPos = () => {
      camera.position.x = cameraRadius * Math.sin(cameraAngleY) * Math.cos(cameraAngleX);
      camera.position.y = cameraRadius * Math.sin(cameraAngleX);
      camera.position.z = cameraRadius * Math.cos(cameraAngleY) * Math.cos(cameraAngleX);
      camera.lookAt(0, 0, 0);
    };
    updateCameraPos();

    resetCameraFnRef.current = () => {
      const curAspect = container.clientWidth / container.clientHeight;
      cameraRadius = computeIdealRadius(curAspect);
      cameraAngleY = 0.52;
      cameraAngleX = 0.28;
      updateCameraPos();
    };

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.2);
    fillLight.position.set(-6, 3, -4);
    scene.add(fillLight);

    const bottomBounce = new THREE.DirectionalLight(0xf1f5f9, 0.9);
    bottomBounce.position.set(0, -6, 2);
    scene.add(bottomBounce);

    // Spatial Grid Platform
    const gridHelper = new THREE.GridHelper(7.0, 14, 0xcbd5e1, 0xe2e8f0);
    gridHelper.position.y = -1.5;
    scene.add(gridHelper);

    // Main Satellite Pivot Group
    const satellitePivot = new THREE.Group();
    scene.add(satellitePivot);

    const satelliteModel = new THREE.Group();
    satellitePivot.add(satelliteModel);

    // Materials
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.3,
    });

    const goldKaptonMaterial = new THREE.MeshStandardMaterial({
      color: 0xdfa008,
      metalness: 0.85,
      roughness: 0.25,
      emissive: 0x614202,
      emissiveIntensity: 0.15,
    });

    const solarCellMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      metalness: 0.65,
      roughness: 0.2,
      emissive: 0x0f172a,
      emissiveIntensity: 0.1,
    });

    const busbarMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.9,
      roughness: 0.1,
    });

    // 1U CUBESAT CHASSIS
    const bodyWidth = 1.0;
    const bodyHeight = 1.2;
    const bodyDepth = 1.0;

    // Core
    const coreGeo = new THREE.BoxGeometry(bodyWidth * 0.96, bodyHeight * 0.96, bodyDepth * 0.96);
    const coreMesh = new THREE.Mesh(coreGeo, goldKaptonMaterial);
    satelliteModel.add(coreMesh);

    // 4 Corner Structural Rails
    const railLength = bodyHeight * 1.02;
    const railGeo = new THREE.BoxGeometry(0.08, railLength, 0.08);
    const halfW = bodyWidth / 2;
    const halfD = bodyDepth / 2;

    const cornerOffsets = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ];

    cornerOffsets.forEach(([cx, cz]) => {
      const rail = new THREE.Mesh(railGeo, frameMaterial);
      rail.position.set(cx, 0, cz);
      satelliteModel.add(rail);
    });

    // End Caps
    const endCapGeo = new THREE.BoxGeometry(bodyWidth, 0.04, bodyDepth);
    const topCap = new THREE.Mesh(endCapGeo, frameMaterial);
    topCap.position.y = bodyHeight / 2 + 0.02;
    satelliteModel.add(topCap);

    const bottomCap = new THREE.Mesh(endCapGeo, frameMaterial);
    bottomCap.position.y = -bodyHeight / 2 - 0.02;
    satelliteModel.add(bottomCap);

    // Solar Cell Panels
    const panelThickness = 0.02;
    const createSideSolarPanel = (w: number, h: number) => {
      const panelGroup = new THREE.Group();
      const backing = new THREE.Mesh(new THREE.BoxGeometry(w, h, panelThickness), frameMaterial);
      panelGroup.add(backing);

      const cellW = (w - 0.12) / 2;
      const cellH = (h - 0.14) / 2;
      const cellGeo = new THREE.BoxGeometry(cellW, cellH, 0.005);

      const positions = [
        [-cellW / 2 - 0.02, cellH / 2 + 0.02],
        [cellW / 2 + 0.02, cellH / 2 + 0.02],
        [-cellW / 2 - 0.02, -cellH / 2 - 0.02],
        [cellW / 2 + 0.02, -cellH / 2 - 0.02],
      ];

      positions.forEach(([px, py]) => {
        const cell = new THREE.Mesh(cellGeo, solarCellMaterial);
        cell.position.set(px, py, panelThickness / 2 + 0.003);
        panelGroup.add(cell);

        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.015, cellH, 0.006), busbarMaterial);
        bar.position.set(px, py, panelThickness / 2 + 0.004);
        panelGroup.add(bar);
      });

      return panelGroup;
    };

    // Front Panel (+Z)
    const frontPanel = createSideSolarPanel(bodyWidth * 0.9, bodyHeight * 0.85);
    frontPanel.position.set(0, 0, halfD + panelThickness / 2);
    satelliteModel.add(frontPanel);

    // Front Camera Lens (+Z)
    const cameraBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20),
      frameMaterial
    );
    cameraBezel.rotation.x = Math.PI / 2;
    cameraBezel.position.set(0, 0.22, halfD + 0.025);
    satelliteModel.add(cameraBezel);

    const cameraLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.045, 20),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.9, roughness: 0.1 })
    );
    cameraLens.rotation.x = Math.PI / 2;
    cameraLens.position.set(0, 0.22, halfD + 0.03);
    satelliteModel.add(cameraLens);

    // Back Panel (-Z)
    const backPanel = createSideSolarPanel(bodyWidth * 0.9, bodyHeight * 0.85);
    backPanel.position.set(0, 0, -halfD - panelThickness / 2);
    backPanel.rotation.y = Math.PI;
    satelliteModel.add(backPanel);

    // Symmetrical Deployable Solar Wings
    const createDeployableWing = (isLeft: boolean) => {
      const wingGroup = new THREE.Group();
      const wingWidth = 1.1;
      const wingHeight = bodyHeight * 0.85;

      const wingMesh = new THREE.Mesh(
        new THREE.BoxGeometry(wingWidth, wingHeight, 0.02),
        frameMaterial
      );
      wingMesh.position.x = isLeft ? -wingWidth / 2 : wingWidth / 2;
      wingGroup.add(wingMesh);

      const cols = 2;
      const rows = 2;
      const cW = (wingWidth - 0.15) / cols;
      const cH = (wingHeight - 0.15) / rows;
      const cGeo = new THREE.BoxGeometry(cW, cH, 0.005);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = (isLeft ? -wingWidth : 0) + (c + 0.5) * (cW + 0.04) + 0.035;
          const cy = (r - 0.5) * (cH + 0.04);
          const cell = new THREE.Mesh(cGeo, solarCellMaterial);
          cell.position.set(cx, cy, 0.013);
          wingGroup.add(cell);

          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.015, cH, 0.006), busbarMaterial);
          bar.position.set(cx, cy, 0.015);
          wingGroup.add(bar);
        }
      }

      return wingGroup;
    };

    const leftWing = createDeployableWing(true);
    leftWing.position.set(-halfW - 0.02, 0, 0);
    satelliteModel.add(leftWing);

    const rightWing = createDeployableWing(false);
    rightWing.position.set(halfW + 0.02, 0, 0);
    satelliteModel.add(rightWing);

    // Payload Antenna (+Y Top)
    const patchAntenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.2, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 })
    );
    patchAntenna.position.set(-0.12, bodyHeight / 2 + 0.06, -0.12);
    satelliteModel.add(patchAntenna);

    // Optical Beacon (+Y Top)
    const beaconGeo = new THREE.SphereGeometry(0.05, 16, 16);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.5,
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.position.set(0.18, bodyHeight / 2 + 0.07, 0.18);
    satelliteModel.add(beaconMesh);
    beaconMeshRef.current = beaconMesh;

    const beaconLight = new THREE.PointLight(0x10b981, 2, 4);
    beaconLight.position.set(0.18, bodyHeight / 2 + 0.1, 0.18);
    satelliteModel.add(beaconLight);
    beaconLightRef.current = beaconLight;

    // Whip antennas
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95 });
    const ant1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 8), antennaMat);
    ant1.position.set(halfW, bodyHeight / 2 + 0.4, halfD);
    ant1.rotation.z = -0.18;
    satelliteModel.add(ant1);

    const ant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 8), antennaMat);
    ant2.position.set(-halfW, bodyHeight / 2 + 0.4, -halfD);
    ant2.rotation.z = 0.18;
    satelliteModel.add(ant2);

    // Attitude Thruster (-Y Bottom)
    const thruster = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.14, 16),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.4 })
    );
    thruster.rotation.x = Math.PI;
    thruster.position.set(0, -bodyHeight / 2 - 0.09, 0);
    satelliteModel.add(thruster);

    // Exact geometric centering
    const bbox = new THREE.Box3().setFromObject(satelliteModel);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    satelliteModel.position.sub(center);

    // Coordinate Axes Helper (X: Red, Y: Green, Z: Blue)
    const axesHelper = new THREE.AxesHelper(1.2);
    axesHelper.position.set(0, 0, 0);
    satellitePivot.add(axesHelper);

    // FULL 360° ALL-DIRECTION DRAG ORBIT CONTROLS
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;

      cameraAngleY -= deltaX * 0.008;
      cameraAngleX = THREE.MathUtils.clamp(
        cameraAngleX + deltaY * 0.008,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05
      );

      updateCameraPos();
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraRadius = THREE.MathUtils.clamp(cameraRadius + e.deltaY * 0.005, 2.8, 9.0);
      updateCameraPos();
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    // Animation Loop with Multi-Directional Rotation
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const deltaTime = Math.min(clock.getDelta(), 0.05);
      const elapsedTime = clock.getElapsedTime();

      // Optical Beacon Anomaly strobe
      const alertState = alertRef.current;
      const sev = alertState.severity;
      if (beaconMeshRef.current && beaconLightRef.current) {
        if (sev === 'critical') {
          const flash = Math.sin(elapsedTime * 16) > 0 ? 1 : 0;
          const color = new THREE.Color(0xef4444);
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).color = color;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).emissive = color;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = flash ? 3.5 : 0.2;
          beaconLightRef.current.color = color;
          beaconLightRef.current.intensity = flash ? 4.0 : 0.2;
        } else if (sev === 'warning') {
          const pulse = (Math.sin(elapsedTime * 6) + 1) / 2;
          const color = new THREE.Color(0xf59e0b);
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).color = color;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).emissive = color;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + pulse * 2.0;
          beaconLightRef.current.color = color;
          beaconLightRef.current.intensity = 0.8 + pulse * 2.5;
        } else {
          const color = new THREE.Color(0x10b981);
          const pulse = (Math.sin(elapsedTime * 2.5) + 1) / 2;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).color = color;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).emissive = color;
          (beaconMeshRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + pulse * 1.0;
          beaconLightRef.current.color = color;
          beaconLightRef.current.intensity = 1.0 + pulse * 1.2;
        }
      }

      // AUTO 3D ORBIT TUMBLE MODE
      if (isAutoTumblingRef.current) {
        const tumblePitch = Math.sin(elapsedTime * 0.8) * 0.7;
        const tumbleYaw = elapsedTime * 0.5;
        const tumbleRoll = Math.cos(elapsedTime * 0.6) * 0.5;

        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tumbleYaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tumblePitch);
        const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tumbleRoll);

        const autoQuat = new THREE.Quaternion().copy(qYaw).multiply(qPitch).multiply(qRoll);
        satellitePivot.quaternion.slerp(autoQuat, 1.0 - Math.exp(-8.0 * deltaTime));
      } else {
        // SMOOTH CRITICALLY DAMPED QUATERNION SLERP IN ALL DIRECTIONS
        const smoothRate = 1.0 - Math.exp(-7.5 * deltaTime);
        satellitePivot.quaternion.slerp(targetQuaternionRef.current, smoothRate);
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const newAspect = container.clientWidth / container.clientHeight;
      camera.aspect = newAspect;
      camera.updateProjectionMatrix();
      cameraRadius = computeIdealRadius(newAspect);
      updateCameraPos();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  const isIrregular = alert.isIrregular;

  // Displayed attitude (hardware or manual offset)
  const displayPitch = (telemetry?.pitch ?? smoothedPitch.current) + manualOffset.pitch;
  const displayRoll = (telemetry?.roll ?? smoothedRoll.current) + manualOffset.roll;
  const displayHeading = ((telemetry?.heading ?? smoothedHeading.current) + manualOffset.yaw + 360) % 360;

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden border bg-white shadow-lg flex flex-col select-none transition-all duration-200 ${
        isIrregular && alert.severity === 'critical'
          ? 'border-rose-400 ring-4 ring-rose-100'
          : isIrregular
          ? 'border-amber-400 ring-4 ring-amber-100'
          : 'border-slate-300'
      }`}
    >
      {/* Viewer Header Bar with Full Rotation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <span className="px-3.5 py-1.5 bg-slate-950 text-white text-xs font-black rounded-lg tracking-wide uppercase shadow-xs">
            VIGYANSAT
          </span>
          <span
            className={`px-3 py-1.5 text-xs font-black rounded-lg border uppercase tracking-wider ${
              isAutoTumbling
                ? 'bg-blue-100 text-blue-900 border-blue-300 animate-pulse'
                : alert.severity === 'critical'
                ? 'bg-rose-50 text-rose-800 border-rose-300 animate-pulse'
                : alert.severity === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : isConnected && telemetry
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-slate-100 text-slate-700 border-slate-300'
            }`}
          >
            {isAutoTumbling
              ? '● 360° All-Direction Auto Orbit'
              : isConnected && telemetry
              ? '● Live Hardware Tracking (Stabilized)'
              : '○ Stationary (Awaiting USB)'}
          </span>
        </div>

        {/* Action Controls: 360° Auto-Rotate & View Reset */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <button
            onClick={() => setIsAutoTumbling((prev) => !prev)}
            className={`px-3.5 py-1.5 rounded-lg border transition-all cursor-pointer font-black ${
              isAutoTumbling
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {isAutoTumbling ? 'Stop 360° Demo' : '360° Demo Rotate'}
          </button>
          <button
            onClick={() => {
              handleResetOrientation();
              resetCameraFnRef.current?.();
            }}
            className="text-xs font-black text-slate-800 bg-slate-100 hover:bg-slate-200 px-3.5 py-1.5 rounded-lg border border-slate-300 shadow-2xs transition-colors cursor-pointer uppercase tracking-wider"
          >
            Reset All
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Area: Expansive, Taller, and High-Dominance */}
      <div className="relative w-full h-[520px] sm:h-[600px] md:h-[680px] lg:h-[750px] xl:h-[820px]">
        <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

        {/* Floating Directional Manual Rotation Gimbal Controls (Top Right of Canvas) */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-white/90 backdrop-blur-sm p-3 rounded-2xl border border-slate-300 shadow-md">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider text-center">
            Rotate In Any Axis
          </span>
          <div className="grid grid-cols-2 gap-1.5 text-xs font-black">
            <button
              onClick={() => handleManualRotate('pitch', 15)}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-red-50 hover:text-red-700 border border-slate-300 hover:border-red-300 text-slate-800 cursor-pointer shadow-2xs"
              title="Pitch Nose Up"
            >
              Pitch +15°
            </button>
            <button
              onClick={() => handleManualRotate('pitch', -15)}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-red-50 hover:text-red-700 border border-slate-300 hover:border-red-300 text-slate-800 cursor-pointer shadow-2xs"
              title="Pitch Nose Down"
            >
              Pitch -15°
            </button>
            <button
              onClick={() => handleManualRotate('roll', 15)}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border border-slate-300 hover:border-blue-300 text-slate-800 cursor-pointer shadow-2xs"
              title="Roll Wing Right"
            >
              Roll +15°
            </button>
            <button
              onClick={() => handleManualRotate('roll', -15)}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border border-slate-300 hover:border-blue-300 text-slate-800 cursor-pointer shadow-2xs"
              title="Roll Wing Left"
            >
              Roll -15°
            </button>
            <button
              onClick={() => handleManualRotate('yaw', 15)}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-300 hover:border-emerald-300 text-slate-800 cursor-pointer shadow-2xs"
              title="Yaw Clockwise"
            >
              Yaw +15°
            </button>
            <button
              onClick={() => handleManualRotate('yaw', -15)}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-300 hover:border-emerald-300 text-slate-800 cursor-pointer shadow-2xs"
              title="Yaw Counter-Clockwise"
            >
              Yaw -15°
            </button>
          </div>
        </div>

        {/* Orbit Hint */}
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          <span className="text-xs font-bold text-slate-600 bg-white/90 px-3 py-1.5 rounded-lg border border-slate-300 shadow-2xs">
            Drag to orbit full 360° in all directions • Scroll to zoom
          </span>
        </div>
      </div>

      {/* Dedicated Bottom Attitude HUD Bar */}
      <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50/95 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="w-3 h-3 rounded-full bg-blue-600 animate-pulse" />
          <span className="text-xs font-black text-slate-900 uppercase tracking-wider">
            Satellite Attitude:
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-bold font-mono">
          <div className="bg-white px-4 py-2 rounded-xl border border-slate-300 shadow-xs">
            <span className="text-slate-500 font-bold mr-2 font-sans text-xs">PITCH (X)</span>
            <span className="text-slate-950 font-black text-base sm:text-lg">
              {displayPitch > 0 ? `+${displayPitch.toFixed(1)}` : displayPitch.toFixed(1)}°
            </span>
          </div>
          <div className="bg-white px-4 py-2 rounded-xl border border-slate-300 shadow-xs">
            <span className="text-slate-500 font-bold mr-2 font-sans text-xs">ROLL (Z)</span>
            <span className="text-slate-950 font-black text-base sm:text-lg">
              {displayRoll > 0 ? `+${displayRoll.toFixed(1)}` : displayRoll.toFixed(1)}°
            </span>
          </div>
          <div className="bg-white px-4 py-2 rounded-xl border border-slate-300 shadow-xs">
            <span className="text-slate-500 font-bold mr-2 font-sans text-xs">HEADING (Y)</span>
            <span className="text-blue-700 font-black text-base sm:text-lg">
              {displayHeading.toFixed(1)}° [{telemetry?.cardinal ?? '--'}]
            </span>
          </div>
        </div>

        {/* Coordinate Axis Legend */}
        <div className="hidden md:flex items-center gap-2.5 text-xs font-black">
          <span className="px-3 py-1.5 rounded-lg bg-red-100 text-red-800 border border-red-200">X (Pitch)</span>
          <span className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">Y (Yaw)</span>
          <span className="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-800 border border-blue-200">Z (Roll)</span>
        </div>
      </div>
    </div>
  );
};
