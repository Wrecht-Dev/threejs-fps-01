// The DOM HUD: crosshair, hit marker, ammo, health, money, timer, score, team
// pips, kill feed, buy menu and banners. It never touches the simulation; main.js
// pushes numbers in and reads callbacks out. Every setter caches its last value
// so the DOM is only touched when something changes.
import { WEAPONS, GRENADES } from './weapons.js';

const COPY = {
  start: {
    title: 'Emberline',
    copy: 'Ashworks Yard. Plant the spike at Furnace or Silos — or stop the Wardens from defusing it. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Emberline',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammo = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const money = $('money-num');
  const timer = $('timer');
  const roundScore = $('round-score');
  const teamV = $('team-v');
  const teamW = $('team-w');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const spikeStatus = $('spike-status');
  const channel = $('channel');
  const channelFill = $('channel-fill');
  const channelLabel = $('channel-label');
  const damageVignette = $('damage');
  const flashOverlay = $('flash');
  const grenadesEl = $('grenades');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let playCallback = null;

  play.addEventListener('click', () => {
    if (playCallback) playCallback();
  });

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuyMenu(onBuy) {
    buyItems.innerHTML = '';
    const entries = [
      ...Object.values(WEAPONS).filter((w) => w.price > 0),
      ...Object.values(GRENADES),
    ];
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.dataset.id = entry.id;
      const key = document.createElement('kbd');
      key.textContent = String(buyItems.children.length + 1);
      const name = document.createElement('span');
      name.className = 'buy-name';
      name.textContent = entry.name;
      const price = document.createElement('span');
      price.className = 'buy-price';
      price.textContent = `$${entry.price}`;
      row.append(key, name, price);
      row.addEventListener('click', () => onBuy(entry.id));
      buyItems.appendChild(row);
    }
  }

  return {
    onPlay(cb) { playCallback = cb; },
    buildBuyMenu,
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (last.hp === v) return;
      last.hp = v;
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
      healthNum.textContent = String(v);
    },
    setMoney(value) { setText(money, 'money', `$${value}`); for (const row of buyItems.querySelectorAll('.poor')) row.classList.remove('poor'); },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timer, 'timer', text);
      timer.classList.toggle('urgent', seconds <= 10);
    },
    setScore(v, w, round) {
      setText(roundScore, 'score', `V ${v} — ${w} W · Round ${round}`);
    },
    setTeams(vAlive, wAlive) {
      setText(teamV, 'teamV', '●'.repeat(vAlive) + '○'.repeat(5 - vAlive));
      setText(teamW, 'teamW', '●'.repeat(wAlive) + '○'.repeat(5 - wAlive));
    },
    setSpike(text) { setText(spikeStatus, 'spike', text); },
    setGrenades(counts) {
      const text = `Frag ${counts.frag} · Smoke ${counts.smoke} · Flash ${counts.flash}`;
      setText(grenadesEl, 'grenades', text);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = `feed-row ${killerTeam}`;
      row.innerHTML = '';
      const k = document.createElement('b');
      k.textContent = killer;
      const v = document.createElement('span');
      v.textContent = ` ${headshot ? '◉ ' : '✕ '} `;
      const vic = document.createElement('b');
      vic.textContent = victim;
      row.append(k, v, vic);
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    showBanner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.add('hidden'), ms);
    },
    hideBanner() { banner.classList.add('hidden'); },
    showOverlay(mode, sub = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = sub || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
    },
    hideOverlay() { overlay.hidden = true; },
    showBuy(open) { buyMenu.classList.toggle('hidden', !open); },
    markBought(id, affordable) {
      const row = buyItems.querySelector(`[data-id="${id}"]`);
      if (!row) return;
      row.classList.toggle('bought', affordable !== false);
      row.classList.toggle('poor', affordable === false);
    },
    showChannel(label, progress) {
      channel.classList.remove('hidden');
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hideChannel() { channel.classList.add('hidden'); },
    damageFlash() {
      damageVignette.classList.remove('hit');
      void damageVignette.offsetWidth;
      damageVignette.classList.add('hit');
    },
    flashBlind(strength) {
      flashOverlay.style.opacity = String(strength);
      setTimeout(() => { flashOverlay.style.opacity = '0'; }, 60);
    },
  };
}
