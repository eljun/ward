import { useEffect, useRef } from "react";
import * as THREE from "three";

type WardOrbProps = {
  pulseKey: number;
  intensity?: number;
  palette?: "ai" | "earth";
};

export function WardOrb({ pulseKey, intensity = 0, palette = "ai" }: WardOrbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const pulseRef = useRef(0);
  const intensityRef = useRef(0);

  useEffect(() => {
    pulseRef.current = 1;
  }, [pulseKey]);

  useEffect(() => {
    intensityRef.current = Math.max(0, Math.min(1, intensity));
  }, [intensity]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const isAi = palette !== "earth";
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 7);

    const group = new THREE.Group();
    scene.add(group);

    // Plasma core
    const geometry = new THREE.IcosahedronGeometry(1.55, 18);
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(isAi ? "#1c2733" : "#dfeaff"),
      roughness: isAi ? 0.55 : 0.34,
      metalness: isAi ? 0.18 : 0.08,
      transmission: isAi ? 0.04 : 0.18,
      thickness: 0.8,
      clearcoat: isAi ? 0.6 : 0.85,
      clearcoatRoughness: isAi ? 0.4 : 0.22,
      iridescence: isAi ? 1 : 0.38,
      iridescenceIOR: isAi ? 1.6 : 1.3,
      emissive: new THREE.Color(isAi ? "#5fe6c2" : "#2e7bff"),
      emissiveIntensity: isAi ? 0.32 : 0.08
    });
    const orb = new THREE.Mesh(geometry, material);
    group.add(orb);

    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.62, 5),
      new THREE.MeshBasicMaterial({
        color: isAi ? "#d24bff" : "#4b8dff",
        transparent: true,
        opacity: isAi ? 0.18 : 0.12,
        wireframe: true
      })
    );
    group.add(wire);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 64, 64),
      new THREE.MeshBasicMaterial({
        color: isAi ? "#6e5dff" : "#7db5ff",
        transparent: true,
        opacity: isAi ? 0.32 : 0.18,
        blending: isAi ? THREE.AdditiveBlending : THREE.NormalBlending
      })
    );
    group.add(core);

    // Atmosphere ring (translucent, slowly counter-rotating)
    let atmosphere: THREE.Mesh | null = null;
    if (isAi) {
      const ringGeom = new THREE.TorusGeometry(2.05, 0.06, 24, 200);
      const ringMat = new THREE.MeshBasicMaterial({
        color: "#5fe6c2",
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      atmosphere = new THREE.Mesh(ringGeom, ringMat);
      atmosphere.rotation.x = Math.PI * 0.42;
      group.add(atmosphere);

      const ring2Mat = new THREE.MeshBasicMaterial({
        color: "#d24bff",
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const atmosphere2 = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.025, 16, 200), ring2Mat);
      atmosphere2.rotation.x = Math.PI * 0.32;
      atmosphere2.rotation.z = Math.PI * 0.18;
      group.add(atmosphere2);

      // soft corona shell
      const coronaGeom = new THREE.SphereGeometry(1.95, 48, 48);
      const coronaMat = new THREE.MeshBasicMaterial({
        color: "#5fe6c2",
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide
      });
      group.add(new THREE.Mesh(coronaGeom, coronaMat));
    }

    // Particle field
    let particles: THREE.Points | null = null;
    if (isAi) {
      const particleCount = 220;
      const positions = new Float32Array(particleCount * 3);
      const radii = new Float32Array(particleCount);
      for (let i = 0; i < particleCount; i++) {
        const r = 2.4 + Math.random() * 1.6;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
        radii[i] = r;
      }
      const particleGeom = new THREE.BufferGeometry();
      particleGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const particleMat = new THREE.PointsMaterial({
        color: "#9fbfff",
        size: 0.045,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      particles = new THREE.Points(particleGeom, particleMat);
      group.add(particles);
    }

    scene.add(new THREE.AmbientLight(isAi ? "#445566" : "#f6fbff", isAi ? 1.2 : 2.2));
    const key = new THREE.PointLight(isAi ? "#d24bff" : "#ffffff", isAi ? 22 : 28, 18);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const accent = new THREE.PointLight(isAi ? "#5fe6c2" : "#2e7bff", isAi ? 18 : 16, 14);
    accent.position.set(3, -2, 4);
    scene.add(accent);

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointerRef.current = {
        x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
        active: true
      };
    };
    const onPointerLeave = () => {
      pointerRef.current.active = false;
    };
    const onResize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    };

    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("resize", onResize);

    let frameId = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      const time = clock.getElapsedTime();
      const pointer = pointerRef.current;
      pulseRef.current = Math.max(0, pulseRef.current - 0.018);
      const pulse = Math.sin(pulseRef.current * Math.PI) * 0.16;
      const hover = pointer.active ? 0.1 : 0;
      const tts = intensityRef.current;
      const targetScale = 1 + hover + pulse + tts * 0.08;

      group.rotation.y += 0.005 + Math.abs(pointer.x) * 0.0015;
      group.rotation.x += 0.0025;
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, pointer.x * 0.12, 0.04);
      orb.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.06);
      wire.rotation.y -= 0.007;
      wire.rotation.x = Math.sin(time * 0.7) * 0.12;
      core.scale.setScalar(1 + Math.sin(time * 2.2) * 0.035 + pulse * 0.7 + tts * 0.18);
      const baseEmissive = isAi ? 0.32 : 0.08;
      material.emissiveIntensity = baseEmissive + hover * 0.3 + pulse * 1.4 + tts * 0.9;
      accent.intensity = (isAi ? 18 : 16) + hover * 10 + pulse * 60 + tts * 22;
      if (atmosphere) {
        atmosphere.rotation.z -= 0.0045;
        atmosphere.rotation.y += 0.0012;
        const mat = atmosphere.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.32 + tts * 0.25 + pulse * 0.2;
      }
      if (particles) {
        particles.rotation.y += 0.0015;
        particles.rotation.x = Math.sin(time * 0.2) * 0.04;
        const mat = particles.material as THREE.PointsMaterial;
        mat.opacity = 0.7 + tts * 0.2;
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      if (particles) {
        particles.geometry.dispose();
        (particles.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [palette]);

  return <div className="ward-orb" ref={hostRef} aria-label="WARD animated orb" />;
}
