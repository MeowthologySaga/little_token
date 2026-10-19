/** 실제 공용 손패/잉크/목적어/아이템 성장을 사용하는 1~3층 전투 시뮬레이션. */
import assert from 'node:assert/strict'
import { createSteeringRun, chooseCard, canPlaceCard, resolveTurn, advanceTurn, encounterSubjects, slotsFor,
  takeReward, completeIntegratedReward, type SteeringRun } from '@core/steering'
import { inkRemaining, slotId } from '@core/integratedSentences'
import { pickIntegratedItem, finishIntegratedItem } from '@core/steeringBridge'
import { ALL_ITEMS, EXCLAIM_SLOTS, rollExclaimChoices, rollExclaimMultipliers, exclaimModsFor, type StatKey } from '@data/items'
import type { Lane } from '@data/steering'

const lanes: Lane[] = ['situation', 'action']
const ready = (r: SteeringRun) => lanes.every(l => !!r.sentences[l].selected)
function score(r: SteeringRun): number {
  const result = resolveTurn(r)
  return result.next.phase === 'lost' ? -1e6 : result.next.phase === 'reward' ? 1e6 + result.next.hp
    : result.enemyDamage * 3 - result.playerDamage * 4 + result.healed * .5
      + result.next.enemies.filter(e => e.hp <= 0).length * 14
      + result.next.enemies.reduce((n, e) => n + (e.burnTurns ? e.burn : 0), 0)
}
function decision(r: SteeringRun): SteeringRun {
  const ids = [...new Set([...r.hand, ...encounterSubjects(r).map(c => c.id)])]
  let candidates = [r]
  for (const lane of lanes) candidates = candidates.flatMap(draft => ids.filter(id => canPlaceCard(draft, lane, id)).map(id => chooseCard(draft, lane, id)))
  assert.ok(candidates.length, '필수 빈칸 선택지가 사라짐')
  const ranked = candidates.filter(ready).map(run => ({ run, score: score(run) })).sort((a, b) => b.score - a.score).slice(0, 4)
  assert.ok(ranked.length, '두 무료 빈칸을 동시에 채울 수 없음')
  let best = ranked[0]
  for (const start of ranked) {
    let current = start
    for (let step = 0; step < 2 && inkRemaining(current.run); step++) {
      let edited = current
      for (const lane of lanes) for (const role of slotsFor(current.run.sentences[lane])) {
        if (role === current.run.sentences[lane].blank) continue
        for (const id of ids) {
          if (id === slotId(current.run, lane, role) || !canPlaceCard(current.run, lane, id, role)) continue
          const run = chooseCard(current.run, lane, id, role)
          if (!ready(run)) continue
          const value = score(run)
          if (value > edited.score) edited = { run, score: value }
        }
      }
      if (edited === current) break
      current = edited
    }
    if (current.score > best.score) best = current
  }
  return best.run
}
function reward(r: SteeringRun): SteeringRun {
  let run = takeReward(r, r.rewardChoices.find(id => ['force', 'echo', 'link'].includes(id)) ?? r.rewardChoices[0])
  if (run.product!.rewardStep === 'item') {
    run = pickIntegratedItem(run, run.product!.itemChoices[0])
    const item = ALL_ITEMS[run.product!.pendingItem!], choices = rollExclaimChoices(() => .25), multipliers = rollExclaimMultipliers(item.rarity, () => .25)
    const stats = { ...item.base }
    EXCLAIM_SLOTS.forEach((slot, index) => {
      const word = [...choices[slot.key]].sort((a, b) => (b.mods.atk ?? 0) * 2 + (b.mods.hp ?? 0) / 2 - (a.mods.atk ?? 0) * 2 - (a.mods.hp ?? 0) / 2)[0]
      const mods = exclaimModsFor(multipliers[index], word.mods)
      for (const key of Object.keys(stats) as StatKey[]) stats[key] += mods[key] ?? 0
    })
    run = finishIntegratedItem(run, { id: item.id, name: item.name, art: item.art, rarity: item.rarity, line: '시뮬레이션: 실제 열린 감탄사 중 선택', stats })
  }
  return completeIntegratedReward(run)
}
let cleared = 0
for (const seed of [11, 23, 37, 53, 79, 101]) {
  let run = createSteeringRun(seed, true), turns = 0
  while (run.floor <= 3 && run.phase !== 'lost' && turns < 60) {
    if (run.phase === 'reward') { run = reward(run); continue }
    run = resolveTurn(decision(run)).next; turns++
    if (run.phase === 'battle') run = advanceTurn(run)
  }
  if (run.floor > 3) cleared++
  console.log(`seed=${seed} floor=${run.floor} phase=${run.phase} hp=${run.hp}/${run.maxHp} turns=${turns} items=${run.product!.player.items.length}`)
}
assert.ok(cleared >= 4, `초반 3층 생존 ${cleared}/6: 동시 행동 편성/수치 검토 필요`)
console.log(`초반 실제 통합 루프 3층 클리어 ${cleared}/6`)
