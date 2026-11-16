// Game state: phases, rounds, money and the spike. One place owns the numbers,
// so the HUD and the sim never disagree. Vanguard attacks (plants the spike),
// Warden defends. First to 5 round wins takes the match, at most 9 rounds.
import * as THREE from 'three';
import { SITES } from './world.js';

export const BUY_TIME = 10;
export const ROUND_TIME = 100;
export const FUSE_TIME = 40;
export const WIN_ROUNDS = 5;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const PLANT_REWARD = 300;

export function createGameState(random) {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseTime: 0,
    round: 1,
    score: { vanguard: 0, warden: 0 },
    money: START_MONEY,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    spike: { state: 'carried', site: null, pos: new THREE.Vector3(), fuse: 0, carrier: 'player' },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
  };

  function startMatch() {
    state.round = 1;
    state.score.vanguard = 0;
    state.score.warden = 0;
    state.money = START_MONEY;
    state.lossStreak = 0;
    state.kills = 0;
    state.deaths = 0;
    state.matchWinner = null;
    startRound();
  }

  function startRound() {
    state.phase = 'buy';
    state.phaseTime = BUY_TIME;
    state.roundWinner = null;
    state.roundReason = '';
    state.spike.state = 'carried';
    state.spike.site = null;
    state.spike.fuse = 0;
    state.spike.carrier = 'player';
  }

  function startLive() {
    state.phase = 'live';
    state.phaseTime = ROUND_TIME;
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.phase = 'roundEnd';
    state.phaseTime = 4;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.score[winner] += 1;
    if (winner === 'vanguard') {
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.money += LOSS_REWARD + Math.min(2, state.lossStreak) * LOSS_STREAK_BONUS;
      state.lossStreak += 1;
    }
    // Tie-break (explicit): first to 5 wins; at round 9+ a tied score plays a
    // deciding round instead of awarding the match on a coin-flip branch.
    if (state.score[winner] >= WIN_ROUNDS || (state.round >= 9 && state.score.vanguard !== state.score.warden)) {
      state.matchWinner = state.score.vanguard > state.score.warden ? 'vanguard' : 'warden';
    }
  }

  function plantSpike(siteKey, pos) {
    state.spike.state = 'planted';
    state.spike.site = siteKey;
    state.spike.pos.copy(pos);
    state.spike.fuse = FUSE_TIME;
    state.spike.carrier = null;
  }

  function dropSpike(pos) {
    state.spike.state = 'dropped';
    state.spike.pos.copy(pos);
    state.spike.carrier = null;
  }

  function pickupSpike(carrier) {
    state.spike.state = 'carried';
    state.spike.carrier = carrier;
  }

  // Called every fixed step; returns an event string when the phase changes.
  function step(dt) {
    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        startLive();
        return 'live';
      }
    } else if (state.phase === 'live') {
      state.phaseTime -= dt;
      if (state.spike.state === 'planted') {
        state.spike.fuse -= dt;
        if (state.spike.fuse <= 0) {
          endRound('vanguard', `The spike detonated at Site ${state.spike.site}`);
          return 'roundEnd';
        }
      } else if (state.phaseTime <= 0) {
        endRound('warden', 'Time expired — the spike was never planted');
        return 'roundEnd';
      }
    } else if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        if (state.matchWinner) {
          state.phase = 'matchEnd';
          return 'matchEnd';
        }
        state.round += 1;
        startRound();
        return 'buy';
      }
    }
    return null;
  }

  return {
    state,
    startMatch,
    endRound,
    plantSpike,
    dropSpike,
    pickupSpike,
    step,
    siteCenter(key) {
      return SITES[key].center;
    },
    inSite(pos, key) {
      const c = SITES[key].center;
      return Math.hypot(pos.x - c.x, pos.z - c.z) < SITES[key].radius;
    },
  };
}
