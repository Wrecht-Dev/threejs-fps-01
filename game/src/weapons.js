// Weapons: the buy menu's catalogue and the player's view model. One hitscan
// weapon at a time; the table owns every number, so balance lives in one place.
// Spread punishes moving and firing: still and crouched is a laser, sprinting and
// spraying is a prayer. Damage falls off with range; headshots pay double.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0,
    damage: 26, headMult: 2.5, mag: 12, reserve: 48, fireGap: 0.16,
    reloadTime: 1.4, spreadStill: 0.003, spreadMove: 0.02, auto: false,
    kick: 0.006, range: 45, pellets: 1, sound: 'shot',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Kestrel', price: 2700,
    damage: 34, headMult: 2.5, mag: 30, reserve: 90, fireGap: 0.096,
    reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true,
    kick: 0.009, range: 70, pellets: 1, sound: 'shot',
  },
  smg: {
    id: 'smg', name: 'SMG-9 Hornet', price: 1500,
    damage: 24, headMult: 2.2, mag: 32, reserve: 96, fireGap: 0.07,
    reloadTime: 1.6, spreadStill: 0.004, spreadMove: 0.03, auto: true,
    kick: 0.006, range: 40, pellets: 1, sound: 'shot',
  },
  shotgun: {
    id: 'shotgun', name: 'SG-12 Mastiff', price: 1700,
    damage: 12, headMult: 2.0, mag: 7, reserve: 28, fireGap: 0.85,
    reloadTime: 2.4, spreadStill: 0.02, spreadMove: 0.045, auto: false,
    kick: 0.03, range: 22, pellets: 8, sound: 'shotgun',
  },
  sniper: {
    id: 'sniper', name: 'DMR-8 Longbow', price: 4000,
    damage: 95, headMult: 2.5, mag: 10, reserve: 30, fireGap: 1.1,
    reloadTime: 2.6, spreadStill: 0.0008, spreadMove: 0.05, auto: false,
    kick: 0.035, range: 90, pellets: 1, sound: 'sniper',
  },
};
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300 },
  flash: { id: 'flash', name: 'Flash Grenade', price: 200 },
};

const VIEW = {
  pistol: { receiver: [0.07, 0.09, 0.2], barrel: [0.04, 0.04, 0.12], stock: null, grip: true },
  rifle: { receiver: [0.09, 0.1, 0.42], barrel: [0.045, 0.045, 0.4], stock: [0.075, 0.08, 0.22], grip: true },
  smg: { receiver: [0.08, 0.09, 0.3], barrel: [0.04, 0.04, 0.22], stock: [0.06, 0.07, 0.16], grip: true },
  shotgun: { receiver: [0.1, 0.11, 0.4], barrel: [0.06, 0.06, 0.42], stock: [0.08, 0.09, 0.24], grip: true },
  sniper: { receiver: [0.08, 0.09, 0.5], barrel: [0.035, 0.035, 0.55], stock: [0.07, 0.08, 0.2], grip: true, scope: true },
};

export function createWeapon(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.7, metalness: 0.3 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.45, metalness: 0.55 }); // O10: steel receiver, amber only as accent
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let def = WEAPONS.rifle;
  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0 };
  // Ammo is remembered per weapon, so switching back to the sidearm finds the
  // magazine you left it with instead of a fresh one.
  const stores = {};
  for (const id of Object.keys(WEAPONS)) stores[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

  function buildModel() {
    while (model.children.length) {
      const child = model.children.pop();
      child.geometry.dispose();
    }
    const spec = VIEW[def.id];
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(...spec.receiver), bodyMat);
    model.add(receiver);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(...spec.barrel), gripMat);
    barrel.position.set(0, 0.025, -(spec.receiver[2] / 2 + spec.barrel[2] / 2 - 0.05));
    model.add(barrel);
    if (spec.stock) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(...spec.stock), gripMat);
      stock.position.set(0, -0.02, spec.receiver[2] / 2 + 0.08);
      model.add(stock);
    }
    if (spec.scope) {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), accentMat);
      scope.position.set(0, 0.08, -0.05);
      model.add(scope);
    }
    if (spec.grip) {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), gripMat);
      grip.position.set(0, -0.1, 0.08);
      grip.rotation.x = 0.3;
      model.add(grip);
    }
  }
  buildModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    def() { return def; },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + (def.id === 'shotgun' ? 0.02 : 0.008));
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    // Spread grows with speed, with airtime, and with sustained fire (bloom).
    spread(speed, airborne, crouching) {
      const move = Math.min(1, speed / 5.2);
      let s = def.spreadStill + move * def.spreadMove + state.bloom;
      if (airborne) s += 0.03;
      if (crouching) s *= 0.7;
      return s;
    },
    equip(id) {
      stores[def.id].mag = state.mag;
      stores[def.id].reserve = state.reserve;
      def = WEAPONS[id];
      state.mag = stores[id].mag;
      state.reserve = stores[id].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      buildModel();
    },
    // O7: magazines refill each round, reserve carries over (ammo economy).
    refillMagazines() {
      for (const id of Object.keys(stores)) stores[id].mag = WEAPONS[id].mag;
      state.mag = def.mag;
    },
  };
}
