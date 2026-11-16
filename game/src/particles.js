// Particles and tracers: a small pool of reusable objects, so the hot loop never
// allocates. Tracers are stretched lines from muzzle to hit; impacts are short
// spark bursts; explosions are a flash sphere plus a point light.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 12;

export function createParticles(scene) {
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({
    color: 0xffc861, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, ttl: 0 });
  }

  const sparks = [];
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3 * 6), 3));
  const sparkMat = new THREE.PointsMaterial({
    color: 0xffd27a, size: 0.09, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  sparkPoints.visible = false;
  scene.add(sparkPoints);
  const sparkVel = new Float32Array(MAX_SPARKS * 3 * 6);
  let sparkCount = 0;
  let sparkTtl = 0;

  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffa63d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const explosionLight = new THREE.PointLight(0xff8a2a, 0, 18);
  scene.add(explosionLight);
  let explosionTtl = 0;
  let explosionMesh = null;

  const tmp = new THREE.Vector3();

  function tracer(from, to) {
    let slot = tracers.find((t) => t.ttl <= 0) || tracers[0];
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.visible = true;
    slot.ttl = 0.07;
  }

  function impact(point, normal) {
    const pos = sparkGeo.attributes.position;
    sparkCount = 6;
    for (let i = 0; i < sparkCount; i += 1) {
      pos.setXYZ(i, point.x, point.y, point.z);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2;
      sparkVel[i * 3] = Math.cos(a) * 2 + normal.x * 2;
      sparkVel[i * 3 + 1] = up + normal.y * 2;
      sparkVel[i * 3 + 2] = Math.sin(a) * 2 + normal.z * 2;
    }
    pos.needsUpdate = true;
    sparkPoints.visible = true;
    sparkTtl = 0.22;
    tmp.copy(point);
  }

  function explosion(point) {
    if (explosionMesh) scene.remove(explosionMesh);
    explosionMesh = new THREE.Mesh(flashGeo, flashMat); // O1: reuse material, opacity reset in step()
    explosionMesh.position.copy(point);
    explosionMesh.position.y += 0.4;
    explosionMesh.scale.setScalar(0.5);
    scene.add(explosionMesh);
    explosionLight.position.copy(point);
    explosionLight.position.y += 1;
    explosionLight.intensity = 60;
    explosionTtl = 0.35;
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.ttl > 0) {
        t.ttl -= dt;
        if (t.ttl <= 0) t.line.visible = false;
      }
    }
    if (sparkTtl > 0) {
      sparkTtl -= dt;
      const pos = sparkGeo.attributes.position;
      for (let i = 0; i < sparkCount; i += 1) {
        pos.setXYZ(i,
          pos.getX(i) + sparkVel[i * 3] * dt,
          pos.getY(i) + sparkVel[i * 3 + 1] * dt,
          pos.getZ(i) + sparkVel[i * 3 + 2] * dt);
        sparkVel[i * 3 + 1] -= 9 * dt;
      }
      pos.needsUpdate = true;
      if (sparkTtl <= 0) sparkPoints.visible = false;
    }
    if (explosionTtl > 0) {
      explosionTtl -= dt;
      if (explosionMesh) {
        const s = 0.5 + (0.35 - explosionTtl) * 14;
        explosionMesh.scale.setScalar(s);
        explosionMesh.material.opacity = Math.max(0, explosionTtl / 0.35) * 0.9;
      }
      explosionLight.intensity = Math.max(0, explosionTtl / 0.35) * 60;
      if (explosionTtl <= 0 && explosionMesh) {
        scene.remove(explosionMesh);
        explosionMesh = null;
        explosionLight.intensity = 0;
      }
    }
  }

  return { tracer, impact, explosion, step };
}
