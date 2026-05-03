import { useEffect, useRef } from "react";
import * as THREE from "three";

type WardOrbProps = {
  pulseKey: number;
};

export function WardOrb({ pulseKey }: WardOrbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const pulseRef = useRef(0);

  useEffect(() => {
    pulseRef.current = 1;
  }, [pulseKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

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

    const geometry = new THREE.IcosahedronGeometry(1.55, 18);
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#dfeaff"),
      roughness: 0.34,
      metalness: 0.08,
      transmission: 0.18,
      thickness: 0.8,
      clearcoat: 0.85,
      clearcoatRoughness: 0.22,
      iridescence: 0.38,
      emissive: new THREE.Color("#2e7bff"),
      emissiveIntensity: 0.08
    });
    const orb = new THREE.Mesh(geometry, material);
    group.add(orb);

    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.62, 5),
      new THREE.MeshBasicMaterial({
        color: "#4b8dff",
        transparent: true,
        opacity: 0.12,
        wireframe: true
      })
    );
    group.add(wire);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 64, 64),
      new THREE.MeshBasicMaterial({
        color: "#7db5ff",
        transparent: true,
        opacity: 0.18
      })
    );
    group.add(core);

    scene.add(new THREE.AmbientLight("#f6fbff", 2.2));
    const key = new THREE.PointLight("#ffffff", 28, 18);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const blue = new THREE.PointLight("#2e7bff", 16, 14);
    blue.position.set(3, -2, 4);
    scene.add(blue);

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
      const targetScale = 1 + hover + pulse;

      group.rotation.y += 0.005 + Math.abs(pointer.x) * 0.0015;
      group.rotation.x += 0.0025;
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, pointer.x * 0.12, 0.04);
      orb.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.06);
      wire.rotation.y -= 0.007;
      wire.rotation.x = Math.sin(time * 0.7) * 0.12;
      core.scale.setScalar(1 + Math.sin(time * 2.2) * 0.035 + pulse * 0.7);
      material.emissiveIntensity = 0.08 + hover * 0.22 + pulse * 1.4;
      blue.intensity = 16 + hover * 10 + pulse * 60;

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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="ward-orb" ref={hostRef} aria-label="WARD animated orb" />;
}
