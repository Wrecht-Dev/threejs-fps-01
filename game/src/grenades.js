// Grenades: thrown projectiles with a short ballistic arc and a bounce, then
// their effect. Frag hurts in a radius, smoke blocks sight for 16 seconds, flash
// blinds anyone looking at it. Smoke zones live here so bots can ask whether a
// line of sight passes through one.
import * as THREE from 'three';

const GRAVITY = 14;
const BOUNCE = 0.45;

export function createGrenades(scene, colliders, hooks) {
  const live = [];
  const smokes = [];
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0x8b9096, roughness: 1, metalness: 0,
    transparent: true, opacity: 0.55, depthWrite: false,
  });
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e343c, roughness: 0.6, metalness: 0.4 });
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const probe = new THREE.Box3();
  const tmpNext = new THREE.Vector3();

  function overlapsBox(p, r) {
    probe.min.set(p.x - r, p.y - r, p.z - r);
    probe.max.set(p.x + r, p.y + r, p.z + r);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function throwGrenade(kind, origin, dir, speed = 13) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    live.push({
      kind, mesh,
      pos: mesh.position,
      vel: new THREE.Vector3(dir.x * speed, dir.y * speed + 3.2, dir.z * speed),
      fuse: kind === 'flash' ? 1.4 : 2.4,
      bounced: false,
    });
    hooks.onThrow(kind);
  }

  function detonate(g) {
    const p = g.pos;
    if (g.kind === 'frag') {
      hooks.onFrag(p.clone());
    } else if (g.kind === 'smoke') {
      const zone = { pos: p.clone(), radius: 4.2, ttl: 16 };
      smokes.push(zone);
      const cloud = new THREE.Group();
      for (let i = 0; i < 7; i += 1) {
        const puff = new THREE.Mesh(smokeGeo, smokeMat);
        const a = (i / 7) * Math.PI * 2;
        puff.position.set(Math.cos(a) * 1.6, 0.6 + (i % 3) * 0.7, Math.sin(a) * 1.6);
        const s = 1.4 + (i % 3) * 0.5;
        puff.scale.set(s, s * 0.8, s);
        cloud.add(puff);
      }
      cloud.position.copy(p);
      cloud.userData.zone = zone;
      smokeGroup.add(cloud);
      zone.cloud = cloud;
    } else if (g.kind === 'flash') {
      hooks.onFlash(p.clone());
    }
    scene.remove(g.mesh);
  }

  function step(dt) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const next = tmpNext.copy(g.pos).addScaledVector(g.vel, dt);
      const hit = overlapsBox(next, 0.09);
      if (hit) {
        // Simple bounce: reflect the velocity component that hit, damped.
        if (Math.abs(g.vel.x) > Math.abs(g.vel.z) && Math.abs(g.vel.x) > 1) g.vel.x *= -BOUNCE;
        else if (Math.abs(g.vel.z) > 1) g.vel.z *= -BOUNCE;
        else g.vel.y = Math.abs(g.vel.y) * BOUNCE;
        g.vel.multiplyScalar(0.7);
        g.bounced = true;
        if (g.fuse > 0.6) g.fuse = Math.min(g.fuse, 0.6);
      } else {
        g.pos.copy(next);
      }
      if (g.pos.y < 0.09) {
        g.pos.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * BOUNCE;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
        g.bounced = true;
        if (g.fuse > 0.8) g.fuse = Math.min(g.fuse, 0.8);
      }
      if (g.fuse <= 0) {
        detonate(g);
        live.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const z = smokes[i];
      z.ttl -= dt;
      if (z.cloud) z.cloud.rotation.y += dt * 0.1;
      if (z.ttl <= 0) {
        if (z.cloud) smokeGroup.remove(z.cloud);
        smokes.splice(i, 1);
      }
    }
  }

  // True when the segment a->b passes through any live smoke cloud.
  function sightBlocked(a, b) {
    for (const z of smokes) {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz || 1;
      let t = ((z.pos.x - a.x) * abx + (z.pos.y - a.y) * aby + (z.pos.z - a.z) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + abx * t - z.pos.x;
      const cy = a.y + aby * t - z.pos.y;
      const cz = a.z + abz * t - z.pos.z;
      if (cx * cx + cy * cy + cz * cz < z.radius * z.radius) return true;
    }
    return false;
  }

  return { throwGrenade, step, smokes, sightBlocked };
}
