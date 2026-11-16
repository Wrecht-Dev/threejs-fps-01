// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Owns the hitscan resolver (player and bots shoot through the
// same function), the spike, the buy phase and the round flow; the modules own
// their own numbers. ?shot=combat|start|buy|plant with &seed=N stages a
// deterministic frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADES, createWeapon } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createParticles } from './particles.js';
import { createBots, wrapAngle } from './bots.js';
import { createGameState, PLANT_REWARD, KILL_REWARD } from './state.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const particles = createParticles(scene);
const hud = createHud();
const game = createGameState(random);
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const weapon = createWeapon(camera);
const bots = createBots(scene, world, random);
const grenades = createGrenades(scene, world.colliders, {
  onThrow(kind) { audio.throwWhoosh(); },
  onFrag(pos) {
    audio.explosion(player.state.position.distanceTo(pos));
    particles.explosion(pos);
    damageRadius(pos, 6.5, 110, 'player');
    bots.hear(pos, elapsed);
  },
  onFlash(pos) {
    audio.flash();
    applyFlash(pos);
  },
});
const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const shootables = world.shootables;

// Player loadout: one primary, the sidearm, and a grenade pouch.
const loadout = {
  primary: 'rifle',
  grenades: { frag: 0, smoke: 0, flash: 0 },
  equipped: 'primary', // primary | pistol | frag | smoke | flash
};
const spikeMesh = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.3, 0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.4, metalness: 0.4, emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 0.6 }),
  );
  body.position.y = 0.15;
  const light = new THREE.PointLight(new THREE.Color(PALETTE.amber), 6, 6);
  light.position.y = 0.5;
  spikeMesh.add(body, light);
  spikeMesh.visible = false;
  scene.add(spikeMesh);
}

const body = player.state;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let plantChannel = 0;
let defuseChannel = 0;
let stepSoundAt = 0;
let blindUntil = 0;
let ads = false;

const tmpDir = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpBox = new THREE.Box3();

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const targetFov = ads && weapon.def().id === 'sniper' ? 46 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

// --- line of sight ---------------------------------------------------------
function losClear(a, b) {
  if (grenades.sightBlocked(a, b)) return false;
  tmpDir.copy(b).sub(a);
  const dist = tmpDir.length();
  if (dist < 0.01) return true;
  tmpDir.normalize();
  raycaster.set(a, tmpDir);
  raycaster.far = dist;
  return raycaster.intersectObjects(shootables, false).length === 0;
}

// --- hitscan ---------------------------------------------------------------
const UP_NORMAL = new THREE.Vector3(0, 1, 0);
let cachedShootables = null;
let cachedAlive = -1;
function allShootables() {
  const alive = bots.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
  if (!cachedShootables || alive !== cachedAlive) { cachedShootables = shootables.concat(bots.hitMeshes()); cachedAlive = alive; }
  return cachedShootables;
}
const tmpPlayerHit = new THREE.Vector3();
function fireHitscan(origin, dir, shooter, def) {
  raycaster.set(origin, dir);
  raycaster.far = def.range * 1.5;
  const hits = raycaster.intersectObjects(allShootables(), false);
  // The player is a box, not a mesh: test the ray against it by hand.
  let playerHit = null;
  if (shooter !== 'player' && body.alive) {
    tmpBox.min.set(body.position.x - 0.34, body.position.y, body.position.z - 0.34);
    tmpBox.max.set(body.position.x + 0.34, body.position.y + body.height, body.position.z + 0.34);
    const t = raycaster.ray.intersectBox(tmpBox, tmpPlayerHit);
    if (t) playerHit = { distance: origin.distanceTo(t), point: t, head: t.y > body.position.y + body.height - 0.35 };
  }
  const first = hits[0];
  const end = tmpTarget.set(origin.x + dir.x * def.range, origin.y + dir.y * def.range, origin.z + dir.z * def.range);
  if (playerHit && (!first || playerHit.distance < first.distance)) {
    particles.tracer(origin, playerHit.point);
    const falloff = Math.max(0.4, 1 - Math.max(0, playerHit.distance - def.range) / def.range);
    const dmg = def.damage * falloff * (playerHit.head ? def.headMult : 1);
    damagePlayer(dmg, shooter, playerHit.head);
    return { hit: 'player', distance: playerHit.distance };
  }
  if (first) {
    particles.tracer(origin, first.point);
    const hitBot = first.object.userData.bot;
    if (hitBot) {
      const falloff = Math.max(0.4, 1 - Math.max(0, first.distance - def.range) / def.range);
      const head = first.object.userData.part === 'head';
      const dmg = def.damage * falloff * (head ? def.headMult : 1);
      damageBot(hitBot, dmg, shooter, head);
    } else {
      particles.impact(first.point, first.face ? first.face.normal : UP_NORMAL);
    }
    return { hit: hitBot ? 'bot' : 'world', distance: first.distance };
  }
  particles.tracer(origin, end);
  return { hit: null, distance: def.range };
}

function damageBot(bot, amount, shooter, headshot) {
  const shooterRef = shooter === 'player' ? { pos: body.position, isPlayer: true } : shooter;
  const killed = bots.damage(bot, amount, shooterRef, headshot, elapsed);
  if (shooter === 'player') {
    hud.hitMarker(killed, killed ? 400 : 120);
    audio.hit();
    if (killed) {
      audio.kill();
      game.state.money += KILL_REWARD;
      game.state.kills += 1;
      hud.killfeed('You', bot.name, headshot, 'vanguard');
    }
  }
  if (killed) {
    if (bot.carrier && game.state.spike.state === 'carried') {
      game.dropSpike(bot.pos);
      spikeMesh.visible = true;
      spikeMesh.position.copy(bot.pos);
    }
    if (shooter !== 'player') hud.killfeed(botNameOf(shooter), bot.name, headshot, shooter.team);
    checkRoundEnd();
  }
}

function botNameOf(shooter) {
  return shooter === 'player' ? 'You' : shooter.name;
}

function damagePlayer(amount, shooter, headshot) {
  if (!body.alive) return;
  body.health -= amount;
  hud.damageFlash();
  audio.hurt();
  if (body.health <= 0) {
    body.health = 0;
    body.alive = false;
    game.state.deaths += 1;
    if (game.state.spike.carrier === 'player') {
      game.dropSpike(body.position);
      spikeMesh.visible = true;
      spikeMesh.position.copy(body.position);
    }
    hud.killfeed(botNameOf(shooter), 'You', headshot, shooter === 'player' ? 'vanguard' : shooter.team);
    document.exitPointerLock?.();
    checkRoundEnd();
  }
}

function damageRadius(pos, radius, maxDamage, source) {
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.pos.distanceTo(pos);
    if (d < radius) {
      const dmg = maxDamage * (1 - d / radius);
      const killed = bots.damage(bot, dmg, source === 'player' ? { pos: body.position, isPlayer: true } : null, false, elapsed);
      if (killed && source === 'player') {
        game.state.money += KILL_REWARD;
        game.state.kills += 1;
        hud.killfeed('You', bot.name, false, 'vanguard');
      }
      if (killed) checkRoundEnd();
    }
  }
  if (body.alive) {
    const d = body.position.distanceTo(pos);
    if (d < radius) damagePlayer(maxDamage * (1 - d / radius) * 0.7, source === 'player' ? 'player' : { name: 'Frag', team: 'warden' }, false);
  }
}

function applyFlash(pos) {
  // Player: blinded when looking toward the flash and close enough.
  if (body.alive) {
    tmpDir.copy(pos).sub(camera.position).normalize();
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const facing = forward.dot(tmpDir);
    const dist = camera.position.distanceTo(pos);
    const strength = Math.max(0, (1 - dist / 40)) * Math.max(0, facing);
    if (strength > 0.15) {
      blindUntil = elapsed + 1.2 * strength + 0.4;
      hud.flashBlind(Math.min(1, strength));
    }
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
    if (!losClear(eye, pos)) continue;
    const dist = eye.distanceTo(pos);
    if (dist > 35) continue;
    const dx = pos.x - bot.pos.x;
    const dz = pos.z - bot.pos.z;
    const facing = Math.atan2(-dx, -dz);
    const diff = wrapAngle(facing - bot.yaw);
    if (Math.abs(diff) < 1.4) bot.blindedUntil = elapsed + 2;
  }
}

// --- bot API ---------------------------------------------------------------
const foePool = bots.bots.map((b) => ({ pos: b.pos, alive: true, eye: 1.3, isPlayer: false, ref: b }));
const playerFoe = { pos: body.position, alive: true, eye: 1.6, isPlayer: true, ref: 'player' };
const botApi = {
  foesOf(bot) {
    const want = bot.team === 'vanguard' ? 'warden' : 'vanguard';
    const out = [];
    for (let i = 0; i < bots.bots.length; i += 1) {
      if (bots.bots[i].team !== want) continue;
      const f = foePool[i]; f.alive = bots.bots[i].alive; out.push(f);
    }
    if (want === 'vanguard') { playerFoe.alive = body.alive; playerFoe.eye = body.eye; out.push(playerFoe); }
    return out;
  },
  losClear,
  spike: game.state.spike,
  botFire(bot) {
    const foe = bot.visibleEnemy;
    if (!foe) return;
    const def = WEAPONS[bot.weapon];
    tmpOrigin.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
    const aimY = foe.isPlayer ? foe.pos.y + foe.eye * 0.8 : foe.pos.y + 1.25;
    tmpTarget.set(foe.pos.x, aimY, foe.pos.z);
    tmpDir.copy(tmpTarget).sub(tmpOrigin).normalize();
    const dist = tmpOrigin.distanceTo(tmpTarget);
    const err = bot.aimError * (0.5 + dist / 30) + (foe.isPlayer && player.groundSpeed() > 3 ? 0.02 : 0);
    tmpDir.x += (random() * 2 - 1) * err;
    tmpDir.y += (random() * 2 - 1) * err;
    tmpDir.z += (random() * 2 - 1) * err;
    tmpDir.normalize();
    fireHitscan(tmpOrigin, tmpDir, bot, def);
    const d = body.position.distanceTo(tmpOrigin);
    if (def.sound === 'shotgun') audio.shotgun(d);
    else if (def.sound === 'sniper') audio.sniper(d);
    else audio.shot(d);
    bots.hear(tmpOrigin, elapsed);
  },
  onChannelDone(bot, kind) {
    if (kind === 'plant') {
      bot.carrier = false;
      game.plantSpike(bot.site, bot.pos);
      spikeMesh.visible = true;
      spikeMesh.position.copy(bot.pos);
      game.state.money += PLANT_REWARD;
      hud.showBanner(`Spike planted at Site ${bot.site}`, 'Defend it — or defuse it before the fuse runs out');
      audio.plantBeep();
      bots.hear(bot.pos, elapsed);
    } else {
      game.endRound('warden', `${bot.name} defused the spike`);
      hud.showBanner('Spike defused', `${bot.name} saved the yard`);
      audio.roundLose();
    }
  },
};

// --- player shooting --------------------------------------------------------
function playerShoot() {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dry();
    weapon.reload();
    return;
  }
  camera.getWorldDirection(tmpDir);
  const spread = weapon.spread(player.groundSpeed(), !body.onGround, body.crouching) * (ads ? 0.5 : 1);
  for (let p = 0; p < def.pellets; p += 1) {
    tmpDir.x += (random() * 2 - 1) * spread;
    tmpDir.y += (random() * 2 - 1) * spread;
    tmpDir.z += (random() * 2 - 1) * spread;
    tmpDir.normalize();
    tmpOrigin.copy(camera.position);
    fireHitscan(tmpOrigin, tmpDir, 'player', def);
    camera.getWorldDirection(tmpDir);
  }
  weapon.pullTrigger();
  player.recoil(def.kick * 1.4, (random() * 2 - 1) * def.kick * 0.4);
  if (def.sound === 'shotgun') audio.shotgun(0);
  else if (def.sound === 'sniper') audio.sniper(0);
  else audio.shot(0);
  bots.hear(body.position, elapsed);
}

// --- buying ------------------------------------------------------------------
const BUY_ORDER = ['rifle', 'smg', 'shotgun', 'sniper', 'frag', 'smoke', 'flash'];
function buy(id) {
  if (game.state.phase !== 'buy') return;
  const item = WEAPONS[id] || GRENADES[id];
  if (!item) return;
  if (game.state.money < item.price) {
    audio.denied();
    hud.markBought(id, false);
    return;
  }
  game.state.money -= item.price;
  audio.buy();
  if (WEAPONS[id]) {
    loadout.primary = id;
    weapon.equip(id);
    loadout.equipped = 'primary';
  } else {
    loadout.grenades[id] += 1;
  }
  hud.markBought(id, true);
  syncHud();
}

function switchWeapon(slot) {
  if (slot === 'primary') {
    weapon.equip(loadout.primary);
    loadout.equipped = 'primary';
  } else if (slot === 'pistol') {
    weapon.equip('pistol');
    loadout.equipped = 'pistol';
  }
}

// --- rounds ------------------------------------------------------------------
function checkRoundEnd() {
  if (game.state.phase !== 'live') return;
  const vAlive = (body.alive ? 1 : 0) + bots.aliveCount('vanguard');
  const wAlive = bots.aliveCount('warden');
  const planted = game.state.spike.state === 'planted';
  if (wAlive === 0) {
    game.endRound('vanguard', 'All Wardens eliminated');
    hud.showBanner('Round to Vanguard', 'All Wardens eliminated');
    audio.roundWin();
  } else if (vAlive === 0 && !planted) {
    game.endRound('warden', 'Vanguard eliminated');
    hud.showBanner('Round to Warden', 'Vanguard eliminated');
    audio.roundLose();
  }
}

function startRoundSetup() {
  // Reset positions, loadout ammo and the spike; bots pick a site and routes.
  const vSpawn = new THREE.Vector3(0, 0, 16.5);
  player.reset(vSpawn, 0);
  weapon.equip(loadout.primary);
  weapon.refillMagazines(); // O7: reserve carries across rounds
  loadout.grenades = { frag: 0, smoke: 0, flash: 0 };
  loadout.equipped = 'primary';
  spikeMesh.visible = false;
  blindUntil = 0;
  plantChannel = 0;
  defuseChannel = 0;
  bots.resetRound(game.state.round, true);
  hud.hideChannel();
  hud.setHealth(100);
  syncHud();
}

function onPhaseEvent(event) {
  if (event === 'live') {
    hud.showBuy(false);
    hud.showBanner(`Round ${game.state.round}`, game.state.spike.carrier === 'player' ? 'You carry the spike — plant it at Furnace or Silos' : 'Plant the spike or eliminate the Wardens');
  } else if (event === 'buy') {
    startRoundSetup();
    hud.showBuy(true);
    hud.showBanner('Buy phase', 'Spend your money — B closes the menu');
  } else if (event === 'roundEnd') {
    hud.showBuy(false);
    if (game.state.matchWinner) {
      // matchEnd follows after the roundEnd timer in state.step
    }
  } else if (event === 'matchEnd') {
    const won = game.state.matchWinner === 'vanguard';
    hud.showOverlay('matchEnd', won
      ? `Vanguard takes the match ${game.state.score.vanguard}–${game.state.score.warden}. ${game.state.kills} eliminations, ${game.state.deaths} deaths.`
      : `Warden takes the match ${game.state.score.warden}–${game.state.score.vanguard}. ${game.state.kills} eliminations, ${game.state.deaths} deaths.`);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// --- HUD sync -----------------------------------------------------------------
function syncHud() {
  const g = game.state;
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setHealth(body.health);
  hud.setMoney(g.money);
  hud.setTimer(g.phaseTime); // O5: freeze at remaining time in roundEnd/matchEnd, not 0:00
  hud.setScore(g.score.vanguard, g.score.warden, g.round);
  hud.setTeams((body.alive ? 1 : 0) + bots.aliveCount('vanguard'), bots.aliveCount('warden'));
  hud.setGrenades(loadout.grenades);
  const spike = g.spike.state === 'planted'
    ? `Spike planted — Site ${g.spike.site} · ${Math.ceil(g.spike.fuse)}s`
    : g.spike.state === 'dropped'
      ? 'Spike dropped — pick it up'
      : g.spike.carrier === 'player' ? 'You carry the spike' : 'Teammate carries the spike';
  hud.setSpike(spike);
  const spread = weapon.spread(player.groundSpeed(), !body.onGround, body.crouching);
  hud.setCrosshairGap(6 + spread * 900);
}

// --- overlays / input ---------------------------------------------------------
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.state.phase === 'menu') {
    game.startMatch();
    startRoundSetup();
    hud.showBuy(true);
  } else if (game.state.phase === 'matchEnd') {
    game.startMatch();
    startRoundSetup();
    hud.showBuy(true);
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (game.state.phase === 'live' && body.alive) {
    hud.showOverlay('paused');
  }
}

hud.buildBuyMenu((id) => buy(id));

// --- fixed step ---------------------------------------------------------------
function step(dt) {
  elapsed += dt;
  const g = game.state;
  const event = game.step(dt);
  if (event) onPhaseEvent(event);

  const buyOpen = !buyMenuHidden();
  if (input.takePressed('KeyB') && g.phase === 'buy') { // O4: buy menu is buy-phase only
    hud.showBuy(buyOpen ? false : true);
  }
  if (g.phase === 'buy' && !buyMenuHidden()) {
    for (let i = 0; i < BUY_ORDER.length; i += 1) {
      if (input.takePressed(`Digit${i + 1}`)) buy(BUY_ORDER[i]);
    }
  }
  if (input.takePressed('Digit1')) switchWeapon('primary');
  if (input.takePressed('Digit2')) switchWeapon('pistol');
  if (input.takePressed('Digit3') && loadout.grenades.frag > 0) loadout.equipped = 'frag';
  if (input.takePressed('Digit4') && loadout.grenades.smoke > 0) loadout.equipped = 'smoke';
  if (input.takePressed('Digit5') && loadout.grenades.flash > 0) loadout.equipped = 'flash';
  if (input.takePressed('KeyR')) {
    if (weapon.reload()) audio.reload();
  }

  const frozenPhase = g.phase === 'buy' || g.phase === 'menu' || g.phase === 'roundEnd' || g.phase === 'matchEnd';
  if (!frozenPhase && body.alive) {
    player.step(dt, input.state.keys);
    const speed = player.groundSpeed();
    if (speed > 1 && body.onGround && elapsed - stepSoundAt > 0.38) {
      stepSoundAt = elapsed;
      audio.footstep();
    }
  }
  weapon.step(dt);
  grenades.step(dt);
  particles.step(dt);
  ads = input.state.altFire && weapon.def().id === 'sniper';

  if (!frozenPhase) {
    for (const bot of bots.bots) bots.step(bot, dt, botApi, elapsed);
    // Spike pickup: a Vanguard bot or the player walking over a dropped spike.
    if (g.spike.state === 'dropped') {
      if (body.alive && body.position.distanceTo(g.spike.pos) < 1.2) {
        game.pickupSpike('player');
        spikeMesh.visible = false;
        hud.showBanner('Spike recovered', 'Plant it at Furnace or Silos');
      } else {
        for (const bot of bots.bots) {
          if (bot.team === 'vanguard' && bot.alive && bot.pos.distanceTo(g.spike.pos) < 1.2) {
            game.pickupSpike(bot.name);
            bot.carrier = true;
            spikeMesh.visible = false;
            break;
          }
        }
      }
    }
    // Plant / defuse channels for the player.
    if (body.alive && input.state.keys.has('KeyE')) {
      if (g.spike.carrier === 'player' && g.spike.state === 'carried') {
        const site = game.inSite(body.position, 'A') ? 'A' : game.inSite(body.position, 'B') ? 'B' : null;
        if (site) {
          plantChannel += dt / 3;
          hud.showChannel(`Planting spike — Site ${site}`, plantChannel);
          if (plantChannel >= 1) {
            plantChannel = 0;
            hud.hideChannel();
            game.plantSpike(site, body.position);
            spikeMesh.visible = true;
            spikeMesh.position.copy(body.position);
            game.state.money += PLANT_REWARD;
            hud.showBanner(`Spike planted at Site ${site}`, 'Defend it until it detonates');
            audio.plantBeep();
          }
        } else plantChannel = 0;
      } else if (g.spike.state === 'planted' && body.position.distanceTo(g.spike.pos) < 2.2) {
        defuseChannel += dt / 5;
        hud.showChannel('Defusing spike', defuseChannel);
        if (defuseChannel >= 1) {
          defuseChannel = 0;
          hud.hideChannel();
          game.endRound('vanguard', 'You defused the spike');
          hud.showBanner('Spike defused', 'The yard is safe — round to Vanguard');
          audio.roundWin();
        }
      } else {
        plantChannel = 0;
        defuseChannel = 0;
        hud.hideChannel();
      }
    } else {
      plantChannel = 0;
      defuseChannel = 0;
      hud.hideChannel();
    }
  }

  // O9: warn when a bot is planting/defusing.
  for (const bot of bots.bots) {
    if (bot.alive && bot.channel > 0.05 && bot.channel < 0.2 && !bot._channelWarned) {
      bot._channelWarned = true;
      if (bot.state === 'defuse') hud.showBanner('A Warden is defusing the spike!', 'Stop them before the channel completes');
      else if (bot.state === 'plant') hud.showBanner('A Vanguard is planting the spike', 'Cover them');
    }
    if (bot.channel === 0) bot._channelWarned = false;
  }
  // Spike blink while planted.
  if (g.spike.state === 'planted') {
    spikeMesh.visible = true;
    spikeMesh.position.copy(g.spike.pos);
    const blink = Math.sin(elapsed * 6) > 0 ? 1 : 0.25;
    spikeMesh.children[1].intensity = 6 * blink;
  }
  syncHud();
}

function buyMenuHidden() {
  return document.getElementById('buy-menu').classList.contains('hidden');
}

// --- frame loop ---------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (elapsed < blindUntil) {
      // Blinded: the mouse barely turns the view.
      player.look(look.x * 0.15, look.y * 0.15);
    } else {
      player.look(look.x, look.y);
    }
    const firing = input.state.firing && game.state.phase === 'live' && body.alive && elapsed >= blindUntil;
    if (firing && loadout.equipped === 'primary' || firing && loadout.equipped === 'pistol') {
      if (weapon.ready()) playerShoot();
      else if (weapon.state.mag === 0 && weapon.state.cooldown === 0) audio.dry();
    } else if (firing && (loadout.equipped === 'frag' || loadout.equipped === 'smoke' || loadout.equipped === 'flash')) {
      if (loadout.grenades[loadout.equipped] > 0) {
        loadout.grenades[loadout.equipped] -= 1;
        camera.getWorldDirection(tmpDir);
        tmpOrigin.copy(camera.position);
        grenades.throwGrenade(loadout.equipped, tmpOrigin, tmpDir);
        loadout.equipped = 'primary';
        weapon.equip(loadout.primary);
        input.state.firing = false;
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  game.startMatch();
  startRoundSetup();
  game.state.phase = 'live';
  game.state.phaseTime = 99;
  body.pitch = 0;
  if (name === 'start') {
    body.position.set(0, 0, 16.5);
    body.yaw = 0;
    game.state.phase = 'buy'; // O8: timer reads the buy-phase value, not a running live timer
    game.state.phaseTime = 10;
    hud.showOverlay('start');
    hud.showBuy(false);
  } else if (name === 'buy') {
    body.position.set(0, 0, 16.5);
    body.yaw = 0;
    game.state.round = 2; // O8: $4700 is only reachable from round 2
    game.state.score.vanguard = 1;
    game.state.money = 4700;
    game.state.phase = 'buy';
    game.state.phaseTime = 8;
    hud.showBuy(true);
    // Two teammates staged in view.
    const mates = bots.bots.filter((b) => b.team === 'vanguard');
    mates[0].pos.set(-2.5, 0, 12);
    mates[0].yaw = 0;
    mates[1].pos.set(2.5, 0, 12.5);
    mates[1].yaw = 0;
    for (const m of mates) { m.mesh.position.copy(m.pos); m.mesh.rotation.y = m.yaw; }
  } else if (name === 'combat') {
    body.position.set(1.5, 0, 7);
    const foe = bots.bots.find((b) => b.team === 'warden');
    foe.pos.set(4.5, 0, -3); // B3: open lane east of the Crusher, clear LOS
    foe.yaw = Math.PI;
    const foe2 = bots.bots.filter((b) => b.team === 'warden')[1];
    foe2.pos.set(-5, 0, -6);
    foe2.yaw = Math.PI * 0.7;
    const mate = bots.bots.find((b) => b.team === 'vanguard');
    mate.pos.set(-3.5, 0, 3);
    mate.yaw = 0;
    settle(10);
    aimAt(new THREE.Vector3(4.5, 1.3, -3));
    playerShoot();
    settle(6);
    aimAt(new THREE.Vector3(4.5, 1.3, -3));
  } else if (name === 'plant') {
    body.position.set(-12, 0, -8);
    game.plantSpike('A', new THREE.Vector3(-18, 0, -15));
    game.state.spike.fuse = 32;
    const foe = bots.bots.find((b) => b.team === 'warden');
    foe.pos.set(-16.5, 0, -13.5);
    foe.yaw = Math.PI * 0.25;
    foe.state = 'defuse';
    foe.channel = 0.55;
    const mate = bots.bots.find((b) => b.team === 'vanguard');
    mate.pos.set(-8, 0, -6);
    mate.yaw = Math.PI * 0.8;
    settle(10);
    aimAt(new THREE.Vector3(-17, 1.2, -14));
    hud.showChannel('Defusing spike', 0.55);
  }
  hud.setScore(game.state.score.vanguard, game.state.score.warden, game.state.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
