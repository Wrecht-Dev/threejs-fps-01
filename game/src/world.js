// The map: Ashworks Yard, an original 48 x 40 m industrial yard built from boxes.
// Two bomb sites (A: the Furnace, B: the Silos), three lanes between the spawns
// (A-long west, Mid, B-long east), and cover sized so crouching hides you and
// standing exposes you. Every box is a collider for movement and a surface a
// bullet stops on. Waypoints below are the graph the bots walk.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: nodes are { x, z } walkable points, edges link neighbours.
// Bots pathfind over it with BFS and walk node to node.
export const WAYPOINTS = [
  // Vanguard spawn (south) and its exits
  { x: 0, z: 16 }, // 0 spawn V
  { x: -8, z: 14 }, // 1
  { x: 8, z: 14 }, // 2
  { x: 0, z: 10 }, // 3 mid mouth
  // A-long (west)
  { x: -16, z: 12 }, // 4
  { x: -20, z: 4 }, // 5
  { x: -20, z: -6 }, // 6
  { x: -17, z: -11 }, // 7 A approach
  // B-long (east)
  { x: 16, z: 12 }, // 8
  { x: 20, z: 4 }, // 9
  { x: 20, z: -6 }, // 10
  { x: 17, z: -11 }, // 11 B approach
  // Mid
  { x: 0, z: 2 }, // 12
  { x: 2, z: -6 }, // 13 (shifted off the Crusher pillar line, B6)
  { x: 0, z: -11 }, // 14 mid connector
  { x: -9, z: -12 }, // 15 mid to A
  { x: 9, z: -12 }, // 16 mid to B
  // Sites and holds
  { x: -18, z: -15 }, // 17 site A
  { x: 18, z: -15 }, // 18 site B
  { x: -12, z: -9 }, // 19 A hold
  { x: 12, z: -9 }, // 20 B hold
  { x: 0, z: -16 }, // 21 spawn W
  { x: -6, z: -15 }, // 22 W spawn west
  { x: 6, z: -15 }, // 23 W spawn east
  { x: -20, z: -15 }, // 24 A corner
  { x: 20, z: -15 }, // 25 B corner
];
export const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 8], [3, 12],
  [4, 5], [5, 6], [6, 7], [7, 17], [7, 15], [7, 24],
  [8, 9], [9, 10], [10, 11], [11, 18], [11, 16], [11, 25],
  [12, 13], [13, 14], [14, 15], [14, 16], [15, 19], [16, 20],
  [15, 17], [16, 18], [17, 19], [18, 20], [17, 22], [18, 23],
  [19, 22], [20, 23], [21, 22], [21, 23], [14, 21], [19, 24], [20, 25],
  [12, 5], [12, 9], [1, 3], [2, 3],
];

export const SITES = {
  A: { name: 'Furnace', center: new THREE.Vector3(-18, 0, -15), radius: 4.2 },
  B: { name: 'Silos', center: new THREE.Vector3(18, 0, -15), radius: 4.2 },
};
export const SPAWNS = {
  vanguard: [
    new THREE.Vector3(-3, 0, 16.5), new THREE.Vector3(-1, 0, 17.5),
    new THREE.Vector3(1, 0, 17.5), new THREE.Vector3(3, 0, 16.5),
    new THREE.Vector3(0, 0, 15),
  ],
  warden: [
    new THREE.Vector3(-3, 0, -16.5), new THREE.Vector3(-1, 0, -17.5),
    new THREE.Vector3(1, 0, -17.5), new THREE.Vector3(3, 0, -16.5),
    new THREE.Vector3(0, 0, -15),
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'amber' || name === 'teal' ? 0.5 : 0.92,
      metalness: name === 'surface' || name === 'hairline' || name === 'dark' ? 0.35 : 0.03,
    });
  }
  // A few tinted variants so the yard does not read as one flat grey.
  const rustDark = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.95, metalness: 0.1 });
  const steelBlue = new THREE.MeshStandardMaterial({ color: 0x6e7f91, roughness: 0.85, metalness: 0.4 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x595d63, roughness: 0.98, metalness: 0.0 });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xc7a23a, roughness: 0.8, metalness: 0.1 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and perimeter: 48 x 40 m, 5 m walls, open dusk sky.
  box(48.4, 0.4, 40.4, 0, -0.2, 0, concrete);
  box(0.4, 5, 40.4, -24.2, 2.5, 0, materials.surface);
  box(0.4, 5, 40.4, 24.2, 2.5, 0, materials.surface);
  box(48.4, 5, 0.4, 0, 2.5, -20.2, materials.surface);
  box(48.4, 5, 0.4, 0, 2.5, 20.2, materials.surface);

  // Site A — the Furnace (north-west): big rusted furnace block, pipes, low wall.
  box(5, 3.4, 3, -19.5, 1.7, -17.5, materials.rust);
  box(1.2, 5.2, 1.2, -21.5, 2.6, -18.5, rustDark); // chimney
  box(3.2, 1.1, 1.2, -15, 0.55, -17.5, materials.hairline);
  box(1.2, 1.1, 3.2, -14.5, 0.55, -13.5, materials.hairline);
  box(2.2, 0.9, 2.2, -21, 0.45, -12, materials.dark);
  // Site A marker: amber hazard stripe on the floor edge.
  box(6, 0.06, 0.5, -18, 0.03, -11.2, hazard, false);

  // Site B — the Silos (north-east): two tall silo blocks and a pipe run.
  box(3, 4.6, 3, 19.5, 2.3, -17.5, steelBlue);
  box(3, 4.0, 3, 15.5, 2.0, -18, steelBlue);
  box(1.2, 1.1, 3.2, 14.5, 0.55, -13.5, materials.hairline);
  box(3.2, 1.1, 1.2, 15, 0.55, -17.5, materials.hairline);
  box(2.2, 0.9, 2.2, 21, 0.45, -12, materials.dark);
  box(6, 0.06, 0.5, 18, 0.03, -11.2, hazard, false);

  // Mid — the Crusher: a big central block splitting mid into two lanes, with a
  // low wall behind it so mid fights happen at two ranges.
  box(4.5, 2.6, 4.5, 0, 1.3, 0, materials.dark);
  box(1.0, 3.4, 1.0, 0, 1.7, -3.2, materials.hairline);
  box(5.5, 1.1, 1.0, 0, 0.55, 6.5, materials.hairline);
  box(1.2, 1.1, 3.6, -6.5, 0.55, 2, materials.hairline);
  box(1.2, 1.1, 3.6, 6.5, 0.55, 2, materials.hairline);

  // A-long (west lane): container wall with a gap, crates, a barrel stack.
  box(6, 2.6, 2.4, -22, 1.3, 8, materials.dark);
  box(2.4, 2.6, 2.4, -22, 1.3, -1, steelBlue);
  box(1.6, 1.1, 1.6, -18.5, 0.55, 4, materials.hairline);
  box(1.6, 0.7, 1.6, -16.5, 0.35, 8.5, materials.hairline);
  box(1.2, 2.2, 1.2, -21.5, 1.1, -8.5, materials.rust);

  // B-long (east lane): mirrored, different dressing.
  box(6, 2.6, 2.4, 22, 1.3, 8, materials.dark);
  box(2.4, 2.6, 2.4, 22, 1.3, -1, steelBlue);
  box(1.6, 1.1, 1.6, 18.5, 0.55, 4, materials.hairline);
  box(1.6, 0.7, 1.6, 16.5, 0.35, 8.5, materials.hairline);
  box(1.2, 2.2, 1.2, 21.5, 1.1, -8.5, materials.rust);

  // Connector walls between mid and the longs, leaving door-sized gaps.
  box(0.8, 2.4, 7, -11, 1.2, -6, materials.surface);
  box(0.8, 2.4, 7, 11, 1.2, -6, materials.surface);
  box(0.8, 2.4, 6, -11, 1.2, 6, materials.surface);
  box(0.8, 2.4, 6, 11, 1.2, 6, materials.surface);

  // South yard (Vanguard spawn): crates and a low wall to stage behind.
  box(2.4, 1.1, 1.2, -5, 0.55, 12.5, materials.hairline);
  box(2.4, 1.1, 1.2, 5, 0.55, 12.5, materials.hairline);
  box(1.6, 0.7, 1.6, 3, 0.35, 14.5, materials.hairline); // moved off the spawn->node-3 line (B6)

  // North yard (Warden spawn): matching cover.
  box(2.4, 1.1, 1.2, -5, 0.55, -12.5, materials.hairline);
  box(2.4, 1.1, 1.2, 5, 0.55, -12.5, materials.hairline);

  // Site marker posts: a small amber post at A, teal at B, so sites read at a glance.
  const postA = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.25), materials.amber);
  postA.position.set(-13.5, 1.1, -15);
  postA.castShadow = true;
  group.add(postA);
  const postB = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.25), materials.teal);
  postB.position.set(13.5, 1.1, -15);
  postB.castShadow = true;
  group.add(postB);

  // Light: low amber sun from the west, cool dusk fill, warm sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(0xa89478), new THREE.Color(0x5a5044), 2.0);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb45e), 3.4);
  sun.position.set(-14, 20, 14);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(new THREE.Color(0xffe0b8), 0.35));
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6f87a8), 1.3);
  fill.position.set(14, 10, -12);
  scene.add(fill);
  // Site A furnace glow and site B silo lamp, so the two sites feel different.
  const glowA = new THREE.PointLight(new THREE.Color(0xff7a2a), 24, 14);
  glowA.position.set(-19.5, 2.2, -15.5);
  scene.add(glowA);
  const lampB = new THREE.PointLight(new THREE.Color(0x37b6c9), 14, 12);
  lampB.position.set(18, 3.4, -15.5);
  scene.add(lampB);

  return { colliders, shootables, group };
}
