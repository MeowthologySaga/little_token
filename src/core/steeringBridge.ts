import { CONCEPT_BY_ID } from '@data/steering'
import { validIntegratedSentences, normalizeIntegratedRun } from './integratedSentences'
import type { ItemForgeCheckpoint } from './itemForge'
/** 원본 규칙 브릿지. 뷰는 이 모듈의 규칙을 복제하지 않는다. */
import type { Fighter, SteeringRun } from './steering'
import { startingPlayer, applyItemReward } from './run'
import type { PlayerState, OwnedItem } from './player'
import type { Intent, Emotion } from './types'
import { stageFor } from '@data/stages'
import { enemyDefForEncounter } from '@data/enemies'
import { ALL_ITEMS } from '@data/items'
import { genRewards, rewardOfferRng } from '@data/rewards'
import { startGrade } from './grade'
import { makeEnemy, applyIntent, summonAtTurnStart, spiderWebAtTurnStart, nextEnemyAttackStep,
  activeEnemyPart, summonCount, spiderWebTension, enemyGuardBreakRequirement, type BattleState } from '@/sim/reference'

export interface IntegratedState {
  forge?: ItemForgeCheckpoint; sealed: string[]; schema: 2; player: PlayerState; guard: number
  rewardStep: 'concept' | 'item' | 'forge' | 'complete'
  itemChoices: string[]; pendingItem: string | null; completedFloors: number[]; endingSeen: boolean; cinematicFloors: number[]
}
export const INTEGRATED_SAVE_KEY = 'little-token.integrated.v2'
export function newProduct(): IntegratedState {
  const player = startingPlayer(); player.deck = {}
  return { schema: 2, sealed: [], player, guard: 0, rewardStep: 'concept', itemChoices: [], pendingItem: null, completedFloors: [], endingSeen: false, cinematicFloors: [] }
}
export function bridgeState(run: SteeringRun, enemies = run.enemies): BattleState {
  return { playerHp: run.hp, playerMax: run.maxHp, guard: run.product?.guard ?? 0, counter: false,
    counterFull: false, turn: run.turn, pending: null, enemies: enemies.map(e => e.sim!) }
}
export function syncFighter(e: Fighter) {
  if (!e.sim) return
  e.hp = Math.max(0, e.sim.hp); e.maxHp = e.sim.maxHp
  e.atk = Math.max(1, Math.round(e.sim.def.atk * e.sim.atkMult))
}
export function integratedEncounter(run: SteeringRun): Fighter[] {
  const st = stageFor(run.floor)
  return st.encounter.map((id, i) => {
    const def = enemyDefForEncounter(id, run.floor, i, st.encounter.length)
    const sim = makeEnemy(def, st.atkMult * (st.isBoss ? 1 : 1 / st.encounter.length), st.hpMult, st.bossHealthBars)
    sim.engaged = true
    return { id: `${id}-${i}`, name: st.isBoss ? def.name : `${def.name} ${i + 1}번`, visual: id, hp: sim.hp, maxHp: sim.maxHp,
      atk: Math.max(1, Math.round(def.atk * sim.atkMult)), burn: 0, burnTurns: 0, weak: 0, sim }
  })
}
export function beginIntegratedTurn(run: SteeringRun) {
  if (!run.product) return
  const state = bridgeState(run)
  summonAtTurnStart(state); spiderWebAtTurnStart(state)
  run.enemies.forEach(syncFighter)
}
export function conceptEmotion(id: string): Emotion {
  return id === 'force' || id === 'rush' || id === 'fire' ? 'anger'
    : id === 'rest' || id === 'calm' ? 'pleasure' : id === 'weaken' || id === 'mirror' ? 'sorrow' : 'joy'
}
export function damageIntent(damage: number, ids: string[] = []): Intent {
  return { sentence: '', targetMode: 'enemy', aoe: 'single', targetCount: 1, kind: 'attack', preempt: false,
    base: damage, multiplier: 1, variance: null, timing: 'immediate', guard: 0, heal: 0, recoil: 0, evade: 0,
    pierceGuard: false, hitCount: 1, castCount: 1, castScale: 1, counter: false, magicShield: 0,
    guardAttackMultiplier: 0, overhealDamageMultiplier: 0, lifeStealRate: 0, attackRank: 0, guardRank: 0,
    emotions: [...new Set(ids.filter(id => !!CONCEPT_BY_ID[id]).map(conceptEmotion))], emotionResonance: 1, tags: [], combos: [], coherence: 1,
    penalties: [], critP: 0, failP: 0, statKey: null, growHp: 0, doubtCount: 0, breakdown: { flats: [], mults: [] } }
}
export function integratedDamage(run: SteeringRun, target: Fighter, value: number, ids: string[] = []): number {
  const state = bridgeState(run, [target]), before = target.hp
  const intent = damageIntent(value, ids)
  // 연결/연타는 원본 여왕벌의 2대상 공략에 대응한다. 감정은 개념에서 공개적으로 결정한다.
  if (ids.includes('link') || ids.includes('echo')) intent.targetCount = 2
  applyIntent(state, intent, 1, 0)
  syncFighter(target)
  return before - target.hp
}
export function bossIntel(run: SteeringRun): string[] {
  return run.enemies.filter(e => e.sim?.def.boss).map(e => {
    const s = e.sim!, step = nextEnemyAttackStep(s), part = activeEnemyPart(s)
    return [s.def.name, `다음: ${step?.name ?? '습격'}`, step?.telegraphText,
      step?.shatterGuard ? `완전 방어 ${enemyGuardBreakRequirement(s, run.turn)} → 그로기·다음 공격 생략` : '',
      s.def.summonPattern ? `일벌 ${summonCount(s)} · 남아 있으면 본체 무적 · 메아리/연결로 2마리 공략` : '',
      part ? `${part.def.name} ${part.hp}/${part.maxHp} · 약점 ${part.def.weakness?.label ?? '없음'}` : '',
      s.def.webPattern ? `거미줄 ${spiderWebTension(s)} · 손패 ${run.product?.sealed.length ?? 0}장 봉인 · 약점 타격으로 해제` : '',
      run.turn <= s.groggyUntilTurn ? '그로기: 받는 피해 증가' : '',
      run.turn < s.nextAttackTurn ? '이번 턴 공격 생략' : '',
    ].filter(Boolean).join(' · ')
  })
}
export function prepareIntegratedItems(run: SteeringRun) {
  const p = run.product!
  const rng = rewardOfferRng(run.seed, 'item', 0)
  // 원본 희귀도 생성기를 쓰되 미지원 규칙 아이템은 풀에서 사전에 제외한다.
  const excluded = Object.values(ALL_ITEMS).filter(i => i.passive).map(i => ({ id: i.id, name: i.name, art: i.art, line: '', stats: {} }))
  const player = { ...p.player, items: [...p.player.items, ...excluded] }
  p.itemChoices = genRewards(player, startGrade(player.stats.luck), run.floor, 'item', rng)
    .flatMap(o => o.item && !o.item.passive ? [o.item.id] : [])
  p.rewardStep = p.itemChoices.length ? 'item' : 'complete'
}
export function pickIntegratedItem(run: SteeringRun, id: string): SteeringRun {
  const next = normalizeIntegratedRun(run), p = next.product!
  if (next.phase !== 'reward' || p.rewardStep !== 'item' || !p.itemChoices.includes(id)) throw new Error('현재 아이템 보상에서 골라 주세요.')
  p.pendingItem = id; p.rewardStep = 'forge'; return next
}
export function finishIntegratedItem(run: SteeringRun, item: OwnedItem): SteeringRun {
  const next = normalizeIntegratedRun(run), p = next.product!
  if (next.phase !== 'reward' || p.rewardStep !== 'forge' || p.pendingItem !== item.id || item.passive || p.player.items.some(i => i.id === item.id)) throw new Error('이미 처리했거나 지원하지 않는 아이템입니다.')
  applyItemReward(p.player, item)
  next.maxHp = p.player.stats.hp; next.power = p.player.stats.atk
  p.rewardStep = 'complete'; p.pendingItem = null; delete p.forge; return next
}
export function validateProduct(run: SteeringRun): boolean {
  const p = run.product
  return validIntegratedSentences(run) && !!p && p.schema === 2 && Array.isArray(p.sealed) && p.sealed.every(id => run.hand.includes(id)) && p.sealed.length <= 3 && Array.isArray(p.cinematicFloors) && !!p.player?.stats && Object.values(p.player.stats).every(n => Number.isFinite(n) && n >= 0)
    && p.player.stats.hp === run.maxHp && p.player.stats.atk === run.power && Array.isArray(p.player.items)
    && p.player.items.every(i => !!ALL_ITEMS[i.id] && !i.passive) && Array.isArray(p.completedFloors)
    && new Set(p.completedFloors).size === p.completedFloors.length && p.completedFloors.every(f => Number.isInteger(f) && f <= run.floor)
    && ['concept', 'item', 'forge', 'complete'].includes(p.rewardStep) && Array.isArray(p.itemChoices)
    && p.itemChoices.every(id => !!ALL_ITEMS[id] && !ALL_ITEMS[id].passive)
    && (p.rewardStep !== 'forge' || !!p.pendingItem && p.itemChoices.includes(p.pendingItem))
    && Number.isFinite(p.guard) && p.guard >= 0 && run.enemies.every(e => !!e.sim && e.hp === Math.max(0, e.sim.hp) && e.maxHp === e.sim.maxHp)
}

export function integratedSupport(run: SteeringRun, ids: string[], guard: number, heal: number) {
  const target = run.enemies.find(e => e.hp > 0 && e.sim?.def.webPattern)
  if (!target) return
  const state = bridgeState(run, [target]), intent = damageIntent(0, ids)
  intent.kind = guard ? 'guard' : 'heal'; intent.guard = guard; intent.heal = heal
  // 원본 지원 약점 판정만 호출한다. 회복은 기존 준비 단계에서 이미 처리했다.
  state.playerHp = state.playerMax
  applyIntent(state, intent, 1, 0)
}
