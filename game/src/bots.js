// Bots: nine of them, four Vanguard teammates and five Warden opponents. Each bot
// has a role, a route over the waypoint graph, and a small brain: it walks its
// route, holds its angle, reacts to what it sees and to gunfire it hears, plants
// or defuses the spike, and fights in bursts with a human reaction time and aim
// error. Movement reuses the same axis-separated box collision as the player.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, EDGES, SITES, SPAWNS } from './world.js';

const NAMES = {
  vanguard: ['Ash', 'Bramble', 'Kite', 'Wren'],
  warden: ['Flint', 'Sable', 'Rook', 'Heron', 'Moss'],
};
export function wrapAngle(diff) {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
const TEAM_COLOR = { vanguard: PALETTE.amber, warden: PALETTE.teal };
const RADIUS = 0.34;
const HEIGHT = 1.72;

// BFS over the waypoint graph; returns an array of node indices from `from` to `to`.
function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const [a, b] of EDGES) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next >= 0 && prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let node = to;
  while (node !== from) {
    path.unshift(node);
    node = prev[node];
  }
  return path;
}

function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function createBots(scene, world, random) {
  const bots = [];
  const colliders = world.colliders;
  const probe = new THREE.Box3();
  const tmpV = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function buildMesh(team) {
    const color = new THREE.Color(TEAM_COLOR[team]);
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85, metalness: 0.1 });
    const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
    const visor = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4, emissive: color, emissiveIntensity: 0.35 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
    torso.position.y = 1.12;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), dark);
    head.position.y = 1.62;
    head.castShadow = true;
    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.05), visor);
    visorMesh.position.set(0, 1.64, -0.17);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), dark);
    legL.position.set(-0.14, 0.39, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.14), dark);
    armL.position.set(-0.33, 1.15, -0.1);
    const armR = armL.clone();
    armR.position.x = 0.33;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
    gun.position.set(0.18, 1.18, -0.35);
    group.add(torso, head, visorMesh, legL, legR, armL, armR, gun);
    group.userData.legL = legL;
    group.userData.legR = legR;
    return { group, torso, head };
  }

  function makeBot(team, index, weapon) {
    const { group, torso, head } = buildMesh(team);
    scene.add(group);
    const bot = {
      team,
      name: NAMES[team][index],
      weapon,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      health: 100,
      alive: true,
      state: 'idle', // idle | route | hold | engage | plant | defuse | investigate
      route: [],
      routeIdx: 0,
      holdNode: 0,
      site: null,
      carrier: false,
      visibleEnemy: null,
      lastSeen: null,
      lastSeenAt: -99,
      reactAt: 0,
      burstLeft: 0,
      burstGap: 0,
      thinkAt: 0,
      thinkOffset: random() * 0.12,
      channel: 0, // plant/defuse progress 0..1
      channelKind: null,
      blindedUntil: 0, // flash blindness: no thinking, moving or firing until then
      walkPhase: random() * 6,
      hearAt: -99,
      stuckX: 0, stuckZ: 0, stuckTime: 0, detourUntil: 0, detourDir: 1,
      hearPos: new THREE.Vector3(),
      mesh: group,
      torso,
      head,
      speed: 3.4 + random() * 0.8,
      reaction: 0.35 + random() * 0.25,
      aimError: 0.02 + random() * 0.02,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'body';
    head.userData.bot = bot;
    head.userData.part = 'head';
    bots.push(bot);
    return bot;
  }

  function resetRound(round, spikeCarrierIsPlayer) {
    // Clear old bots' meshes stay; reuse the same nine bot objects.
    const sitePick = random() < 0.55 ? 'A' : 'B';
    const siteNode = sitePick === 'A' ? 17 : 18;
    const holdNodes = sitePick === 'A' ? [19, 20, 14] : [20, 19, 14];
    let vi = 0;
    let wi = 0;
    for (const bot of bots) {
      bot.health = 100;
      bot.alive = true;
      bot.channel = 0;
      bot.channelKind = null;
      bot.visibleEnemy = null;
      bot.lastSeen = null;
      bot.burstLeft = 0;
      bot.carrier = false;
      bot.mesh.visible = true;
      bot.mesh.rotation.set(0, 0, 0);
      bot.mesh.position.y = 0;
      if (bot.team === 'vanguard') {
        const spawn = SPAWNS.vanguard[vi];
        bot.pos.copy(spawn);
        bot.yaw = 0;
        bot.site = sitePick;
        // Route: spawn -> lane -> site. Split the team across A-long, mid, B-long.
        const lane = vi === 0 ? [4, 5, 6, 7, siteNode] : vi === 1 ? [3, 12, 13, 14, sitePick === 'A' ? 15 : 16, siteNode] : vi === 2 ? [8, 9, 10, 11, siteNode] : [3, 12, 13, 14, sitePick === 'A' ? 15 : 16, siteNode];
        bot.route = lane;
        bot.routeIdx = 0;
        bot.state = 'route';
        if (vi === 3 && !spikeCarrierIsPlayer) bot.carrier = true;
        vi += 1;
      } else {
        const spawn = SPAWNS.warden[wi];
        bot.pos.copy(spawn);
        bot.yaw = Math.PI;
        bot.holdNode = holdNodes[wi % holdNodes.length];
        bot.route = [nearestNode(bot.pos.x, bot.pos.z), bot.holdNode];
        bot.routeIdx = 0;
        bot.state = 'route';
        wi += 1;
      }
      bot.mesh.position.copy(bot.pos);
      bot.mesh.rotation.y = bot.yaw;
    }
  }

  function spawnAll() {
    for (let i = 0; i < 4; i += 1) makeBot('vanguard', i, i === 2 ? 'smg' : 'rifle');
    for (let i = 0; i < 5; i += 1) makeBot('warden', i, i === 4 ? 'sniper' : i === 1 ? 'smg' : 'rifle');
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    bot.vel.x = vx;
    bot.vel.z = vz;
    bot.yaw = Math.atan2(-dx, -dz);
    const nextX = bot.pos.x + vx * dt;
    if (!overlaps(nextX, 0, bot.pos.z, HEIGHT, 0.04)) bot.pos.x = nextX;
    const nextZ = bot.pos.z + vz * dt;
    if (!overlaps(bot.pos.x, 0, nextZ, HEIGHT, 0.04)) bot.pos.z = nextZ;
    bot.walkPhase += dt * speed * 2.2;
    return dist < 0.5;
  }

  function setRouteTo(bot, node) {
    const from = nearestNode(bot.pos.x, bot.pos.z);
    bot.route = findPath(from, node);
    bot.routeIdx = 0;
  }

  // One think tick: perception, then a decision. Called at ~8 Hz per bot.
  function think(bot, api, now) {
    if (!bot.alive) return;
    // Perception: nearest visible enemy.
    let best = null;
    let bestD = Infinity;
    for (const foe of api.foesOf(bot)) {
      if (!foe.alive) continue;
      const dx = foe.pos.x - bot.pos.x;
      const dz = foe.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 55 || dist >= bestD) continue;
      const angle = Math.atan2(-dx, -dz);
      const diff = wrapAngle(angle - bot.yaw);
      if (Math.abs(diff) > 1.1 && dist > 4) continue;
      const eye = tmpV.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
      const target = tmpTarget.set(foe.pos.x, foe.pos.y + (foe.isPlayer ? foe.eye : 1.3), foe.pos.z);
      if (!api.losClear(eye, target)) continue;
      best = foe;
      bestD = dist;
    }
    if (best) {
      bot.visibleEnemy = best;
      if (!bot.lastSeen) bot.lastSeen = new THREE.Vector3();
      bot.lastSeen.set(best.pos.x, best.pos.y, best.pos.z);
      bot.lastSeenAt = now;
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.reactAt = now + bot.reaction;
        bot.burstLeft = 0;
        bot.burstGap = 0;
      }
    } else if (bot.state === 'engage' && now - bot.lastSeenAt > 1.2) {
      // Lost them: push to where they were last seen.
      bot.state = 'investigate';
      bot.visibleEnemy = null;
      if (bot.lastSeen) setRouteTo(bot, nearestNode(bot.lastSeen.x, bot.lastSeen.z));
    }

    // Spike logic, decided here so it survives the movement code below.
    const spike = api.spike;
    if (bot.team === 'vanguard' && bot.carrier && spike.state === 'carried') {
      const site = SITES[bot.site];
      const d = Math.hypot(bot.pos.x - site.center.x, bot.pos.z - site.center.z);
      if (d < site.radius && !bot.visibleEnemy) {
        bot.state = 'plant';
      } else if (bot.state === 'plant') {
        bot.state = 'route';
      }
    }
    if (bot.team === 'warden' && spike.state === 'planted') {
      const d = Math.hypot(bot.pos.x - spike.pos.x, bot.pos.z - spike.pos.z);
      if (bot.state !== 'engage' && d > 6) {
        bot.state = 'route';
        setRouteTo(bot, nearestNode(spike.pos.x, spike.pos.z));
      } else if (d <= 2.2 && !bot.visibleEnemy) {
        bot.state = 'defuse';
      }
    }
    // B7: nearest alive Vanguard with no visible enemy fetches a dropped spike.
    if (spike.state === 'dropped' && bot.team === 'vanguard' && !bot.visibleEnemy && !bot.carrier) {
      let nearest = true;
      for (const other of bots) {
        if (other === bot || other.team !== 'vanguard' || !other.alive || other.visibleEnemy) continue;
        if (Math.hypot(other.pos.x - spike.pos.x, other.pos.z - spike.pos.z) < Math.hypot(bot.pos.x - spike.pos.x, bot.pos.z - spike.pos.z)) { nearest = false; break; }
      }
      if (nearest) { bot.state = 'route'; setRouteTo(bot, nearestNode(spike.pos.x, spike.pos.z)); }
    }
    // Heard a shot recently and idle: go look.
    if (bot.state === 'hold' && now - bot.hearAt < 2 && bot.team === 'warden') {
      bot.state = 'investigate';
      setRouteTo(bot, nearestNode(bot.hearPos.x, bot.hearPos.z));
    }
    if (bot.state === 'investigate' && bot.routeIdx >= bot.route.length) {
      bot.state = bot.team === 'warden' ? 'hold' : 'route';
      if (bot.team === 'warden') bot.holdNode = nearestNode(bot.pos.x, bot.pos.z);
    }
  }

  function step(bot, dt, api, now) {
    if (!bot.alive) return;
    if (now < bot.blindedUntil) {
      // Flashed: stand still, hands over the visor. The mesh still animates.
      bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.mesh.rotation.y = bot.yaw;
      return;
    }
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = 0.12 + bot.thinkOffset;
      think(bot, api, now);
    }

    // Movement by state.
    bot.vel.set(0, 0, 0);
    if (bot.state === 'route' || bot.state === 'investigate') {
      if (bot.routeIdx < bot.route.length) {
        const node = WAYPOINTS[bot.route[bot.routeIdx]];
        // B6 stuck detection: <0.2m progress in 1.5s -> sidestep, then re-path.
        if (Math.hypot(bot.pos.x - bot.stuckX, bot.pos.z - bot.stuckZ) > 0.2) { bot.stuckX = bot.pos.x; bot.stuckZ = bot.pos.z; bot.stuckTime = 0; }
        else bot.stuckTime += dt;
        let tx = node.x; let tz = node.z;
        if (bot.stuckTime > 1.5) {
          if (now >= bot.detourUntil) { bot.detourUntil = now + 0.5; bot.detourDir = bot.detourDir * -1; setRouteTo(bot, bot.route[bot.route.length - 1]); bot.stuckTime = 0; }
          const px = -(node.z - bot.pos.z); const pz = (node.x - bot.pos.x); const pl = Math.hypot(px, pz) || 1;
          tx = bot.pos.x + (px / pl) * 2 * bot.detourDir; tz = bot.pos.z + (pz / pl) * 2 * bot.detourDir;
        }
        const arrived = moveToward(bot, tx, tz, dt, bot.speed);
        if (arrived && tx === node.x && tz === node.z) bot.routeIdx += 1;
      } else {
        bot.state = bot.team === 'warden' ? 'hold' : 'route';
        if (bot.team === 'warden') bot.holdNode = nearestNode(bot.pos.x, bot.pos.z);
      }
    } else if (bot.state === 'hold') {
      // Face the lane: defenders look south toward mid/spawn.
      bot.yaw += wrapAngle(Math.PI - bot.yaw) * Math.min(1, dt * 2); // defenders look south toward mid/spawn
    } else if (bot.state === 'engage' && bot.visibleEnemy) {
      const foe = bot.visibleEnemy;
      const dx = foe.pos.x - bot.pos.x;
      const dz = foe.pos.z - bot.pos.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const diff = wrapAngle(targetYaw - bot.yaw);
      bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
      // Strafe a little while fighting, so bots are not statues.
      const strafe = Math.sin(now * 0.7 + bot.walkPhase) * 0.6;
      const sx = Math.cos(bot.yaw) * strafe;
      const sz = -Math.sin(bot.yaw) * strafe;
      const nx = bot.pos.x + sx * dt;
      const nz = bot.pos.z + sz * dt;
      if (!overlaps(nx, 0, bot.pos.z, HEIGHT, 0.04)) bot.pos.x = nx;
      if (!overlaps(bot.pos.x, 0, nz, HEIGHT, 0.04)) bot.pos.z = nz;
    }

    // Plant / defuse channels.
    if (bot.state === 'plant' || bot.state === 'defuse') {
      bot.channel += dt / (bot.state === 'plant' ? 3 : 5);
      if (bot.channel >= 1) {
        api.onChannelDone(bot, bot.state);
        bot.channel = 0;
        bot.state = bot.team === 'warden' ? 'hold' : 'route';
      }
    } else {
      bot.channel = 0;
    }

    // Firing: bursts with a reaction delay, then a pause.
    if (bot.state === 'engage' && bot.visibleEnemy && now >= bot.reactAt) {
      bot.burstGap -= dt;
      if (bot.burstLeft <= 0 && bot.burstGap <= 0) {
        bot.burstLeft = bot.weapon === 'sniper' ? 1 : 3 + Math.floor(random() * 2);
        bot.burstGap = bot.weapon === 'sniper' ? 1.4 : 0.55 + random() * 0.4;
      }
      bot.fireAcc = (bot.fireAcc || 0) - dt;
      if (bot.burstLeft > 0 && bot.fireAcc <= 0) {
        bot.fireAcc = bot.weapon === 'sniper' ? 1.1 : 0.11;
        bot.burstLeft -= 1;
        api.botFire(bot);
      }
    }

    // Animate the mesh.
    const g = bot.mesh;
    g.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    g.rotation.y = bot.yaw;
    const moving = Math.hypot(bot.vel.x, bot.vel.z) > 0.3;
    const swing = moving ? Math.sin(bot.walkPhase) * 0.45 : 0;
    g.userData.legL.rotation.x = swing;
    g.userData.legR.rotation.x = -swing;
    // Aim the torso slightly toward the pitch when engaging.
    g.rotation.x = bot.state === 'engage' ? 0.06 : 0;
  }

  function damage(bot, amount, from, headshot, now) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.mesh.rotation.z = Math.PI / 2;
      bot.mesh.position.y = 0.15;
      bot.channel = 0;
      return true;
    }
    // Being shot interrupts a channel and makes the bot turn on the shooter.
    if (bot.state === 'plant' || bot.state === 'defuse') {
      bot.state = 'engage';
      bot.channel = 0;
    }
    if (from) {
      if (!bot.lastSeen) bot.lastSeen = new THREE.Vector3();
      bot.lastSeen.set(from.pos.x, from.pos.y, from.pos.z);
      bot.lastSeenAt = now;
      bot.visibleEnemy = from;
      bot.state = 'engage';
      bot.reactAt = now;
    }
    return false;
  }

  function hear(pos, now) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
      if (d < 30) {
        bot.hearAt = now;
        bot.hearPos.copy(pos);
      }
    }
  }

  spawnAll();

  return {
    bots,
    resetRound,
    step(bot, dt, api, now) { step(bot, dt, api, now); },
    damage,
    hear,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    hitMeshes() {
      const meshes = [];
      for (const b of bots) if (b.alive) meshes.push(b.torso, b.head);
      return meshes;
    },
  };
}
