// The look plan, in one place. Emberline's palette is a dusk industrial yard:
// rust amber against cold steel blue, with one hot accent for the spike and the HUD.
// The same names are the CSS custom properties in index.html, so the page and the
// 3D scene never disagree about a colour.
export const PALETTE = {
  canvas: '#2e2620', // dusk sky / fog
  floor: '#4a5058', // concrete yard
  surface: '#626e7c', // steel walls
  hairline: '#78838f', // crates, mid steel
  dark: '#40474f', // containers, deep shadow
  rust: '#8a5a33', // rusted metal, site A furnace
  amber: '#f0a830', // Vanguard team, accent, spike light
  teal: '#37b6c9', // Warden team
  ink: '#ece7db', // text, lights
  muted: '#9aa3ab', // secondary text
  red: '#e5484d', // damage, danger
  green: '#57c785', // health, defuse
};

export function shade(name) {
  return PALETTE[name];
}
