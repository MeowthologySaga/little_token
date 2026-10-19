import { normalizeIntegratedRun } from '@core/integratedSentences'
import { describeEffect } from '@core/steering'
import { inkRemaining, inkSpent, slotId, resetIntegratedSlot } from '@core/integratedSentences'
import { integratedPlan } from '@core/integratedCombat'
import { compileSentence, encounterSubjects, slotsFor, redraw } from '@core/steering'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSteeringRun, resolveTurn, advanceTurn, takeReward, completeIntegratedReward, validateSteeringSave,
  saveSteeringRun, loadSteeringRun, STEERING_SAVE_KEY, chooseCard, canPlaceCard, type SteeringRun } from '@core/steering'
import { integratedEncounter, beginIntegratedTurn, integratedDamage, pickIntegratedItem, finishIntegratedItem,
  INTEGRATED_SAVE_KEY, bossIntel, bridgeState, damageIntent } from '@core/steeringBridge'
import { ALL_ITEMS } from '@data/items'
import { stageFor } from '@data/stages'
import { summonCount, nextEnemyAttackStep, enemyGuardBreakRequirement, spiderWebTension, applyIntent } from '@/sim/reference'
import { combatBeats } from '@core/steeringBeats'

let checks = 0
function check(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`) }
function fixture(floor = 1): SteeringRun {
  const r = createSteeringRun(37, true)
  r.floor = floor; r.enemies = integratedEncounter(r); beginIntegratedTurn(r)
  r.hand = ['force', 'weaken', 'calm', 'mirror', 'rest', 'echo']
  r.product!.sealed = []
  r.sentences = {
    situation: { lane: 'situation', originActor: r.enemies[0].id, edits: {}, slots: ['subj', 'adv', 'obj', 'verb'], blank: 'adv', fixed: { subj: `actor:${r.enemies[0].id}`, obj: 'actor:player', adv: 'weaken', verb: 'force' }, choices: [...r.hand], selected: 'weaken' },
    action: { lane: 'action', originActor: 'player', edits: {}, slots: ['subj', 'adv', 'obj', 'verb'], blank: 'verb', fixed: { subj: 'actor:player', obj: `actor:${r.enemies[0].id}`, adv: 'force', verb: 'force' }, choices: [...r.hand], selected: 'force' },
  }
  return r
}
function restored(r: SteeringRun): SteeringRun {
  const copy = validateSteeringSave(JSON.parse(JSON.stringify(r)))
  assert.ok(copy, '저장 왕복 검증'); return copy
}
check('기본은 원본 타이틀을 거치는 통합 진입, classic/prototype 분리', () => {
  const entry = readFileSync('src/fork.ts', 'utf8'), boot = readFileSync('src/integrated.ts', 'utf8')
  assert.match(entry, /import\('\.\/integrated'\)/)
  assert.match(entry, /=== 'classic'/); assert.match(entry, /=== 'prototype'/)
  for (const name of ['TitleView', 'CinematicIntro', 'installMobileViewport', 'openSettingsModal', 'EndingView', 'RunResultView']) assert.ok(boot.includes(name))
  assert.doesNotMatch(boot, /from ['"]@core\/save/)
})
check('전투는 현재 활용만 표시, 한 번 열어 네 역할 전체 비교·보상·단어장 설명 보존', () => {
  const view = readFileSync('src/views/SteeringView.ts', 'utf8'), css = readFileSync('src/views/steering.css', 'utf8')
  assert.doesNotMatch(view, /<details class="st-(other-roles|reward-effects)"/)
  const detailStart = view.indexOf('private detailHtml('), detailEnd = view.indexOf('private inspectionRun(', detailStart)
  const currentDetail = view.slice(detailStart, detailEnd)
  assert.match(currentDetail, /if \(run.product\)/)
  assert.match(currentDetail, /class="st-current-use"/)
  assert.match(currentDetail, /data-cmd="role-details" aria-expanded=/)
  const modalStart = view.indexOf('if (this.roleDetailOpen && this.run?.product'), modalEnd = view.indexOf('host.querySelector<HTMLButtonElement>', modalStart)
  const roleModal = view.slice(modalStart, modalEnd)
  assert.match(roleModal, /INTEGRATED_ROLES.map\(role/)
  assert.match(roleModal, /formFor\(run, id, role, this.lane\)/)
  assert.match(roleModal, /describeEffect\(run, id, role, this.lane\)/)
  assert.match(roleModal, /class="st-recipient"/)
  assert.match(view, /cmd === 'role-details'\) \{ this.roleDetailOpen = true; this.renderModal\(\)/)
  assert.match(view, /restoreRole\) this.root.querySelector<HTMLButtonElement>\('\[data-cmd="role-details"\]'\)\?\.focus\(\)/)
  assert.match(view, /st-reward-effects/); assert.match(view, /st-deck-entry/)
  assert.match(css, /\.st-role-modal/)
  assert.match(css, /max-height:none; overflow:visible/)
  assert.doesNotMatch(readFileSync('src/localization/steeringForecast.ts', 'utf8'), /\$\{sentence.hits\}회 준비/)
})
check('원본 편성·막·정예 수치를 새 스테이지 전체에서 사용', () => {
  for (let f = 1; f <= 15; f++) {
    const r = fixture(f), st = stageFor(f)
    assert.equal(r.enemies.length, st.encounter.length)
    assert.deepEqual(r.enemies.map(e => e.visual), st.encounter)
    assert.ok(r.enemies.every(e => e.hp === e.sim!.hp && e.maxHp === e.sim!.maxHp))
    restored(r)
  }
})
check('실제 일반전 승리→개념 강화→아이템 감탄 결과→다음날 성장·보상 중복 차단', () => {
  const r = fixture(); r.power = r.product!.player.stats.atk = 1000
  r.enemies = r.enemies.slice(0, 1)
  const result = resolveTurn(r)
  assert.equal(result.next.phase, 'reward')
  let n = restored(result.next)
  n.rewardChoices = ['force']; n = takeReward(n, 'force')
  assert.equal(n.levels.force, 1); assert.equal(n.product!.rewardStep, 'item')
  assert.throws(() => takeReward(n, 'force'))
  assert.ok(n.product!.itemChoices.length)
  assert.ok(n.product!.itemChoices.every(id => !ALL_ITEMS[id].passive))
  n = restored(pickIntegratedItem(n, n.product!.itemChoices[0]))
  const def = ALL_ITEMS[n.product!.pendingItem!]
  const item = { id: def.id, name: def.name, art: def.art, line: '실제 감탄 결과', stats: { atk: 2, hp: 4, guard: 3, heal: 2, luck: 1 } }
  const before = n.power, hpBefore = n.hp
  n = finishIntegratedItem(n, item)
  assert.equal(n.power, before + 2); assert.equal(n.hp, hpBefore)
  assert.throws(() => finishIntegratedItem(n, item))
  n = completeIntegratedReward(restored(n))
  assert.equal(n.floor, 2); assert.equal(n.phase, 'battle'); assert.equal(n.power, before + 2)
  assert.equal(n.product!.player.items.length, 1)
  assert.throws(() => completeIntegratedReward(n))
  restored(n)
})
check('사마귀: 예고 공격→내려베기→필요 방어 완전 충족→그로기와 예정 공격 생략', () => {
  let r = fixture(5), s = r.enemies[0].sim!
  s.attackPatternIndex = 1
  const pre = JSON.stringify(r), preview = resolveTurn(r)
  assert.equal(JSON.stringify(r), pre)
  assert.deepEqual(resolveTurn(r), preview)
  assert.ok(preview.attacks.some(a => a.source !== 'player' && a.incoming > 0))
  assert.ok(nextEnemyAttackStep(preview.next.enemies[0].sim!)?.shatterGuard)
  r = advanceTurn(preview.next); s = r.enemies[0].sim!
  r.product!.guard = enemyGuardBreakRequirement(s, r.turn)
  r.product!.sealed = []; r.hand = ['weaken', 'rest', 'force', 'calm', 'mirror', 'echo']
  r.sentences.situation = { lane: 'situation', originActor: r.enemies[0].id, edits: {}, slots: ['subj', 'adv', 'obj', 'verb'], blank: 'adv', fixed: { subj: `actor:${r.enemies[0].id}`, obj: 'actor:player', adv: 'weaken', verb: 'force' }, choices: [...r.hand], selected: 'weaken' }
  r.sentences.action = { lane: 'action', originActor: 'player', edits: {}, slots: ['subj', 'adv', 'obj', 'verb'], blank: 'verb', fixed: { subj: 'actor:player', obj: 'actor:player', adv: 'calm', verb: 'rest' }, choices: [...r.hand], selected: 'rest' }
  const hit = resolveTurn(r)
  assert.ok(hit.log.some(l => l.includes('그로기')))
  assert.ok(hit.next.enemies[0].sim!.nextAttackTurn > r.turn + 1)
  assert.equal(hit.attacks.find(a => a.source !== 'player')!.healthDamage, 0)
})
check('여왕벌: 원본 일벌 4마리·본체 무적·2대상 퇴치·반동·그로기·재소환', () => {
  const r = fixture(10), e = r.enemies[0]
  assert.equal(summonCount(e.sim!), 4)
  const before = e.hp
  integratedDamage(r, e, 1, ['mirror'])
  assert.equal(e.hp, before)
  integratedDamage(r, e, 60, ['link'])
  assert.equal(summonCount(e.sim!), 2); assert.ok(e.hp < before)
  integratedDamage(r, e, 60, ['link'])
  assert.equal(summonCount(e.sim!), 0); assert.ok(e.sim!.groggyUntilTurn >= r.turn)
  assert.ok(e.sim!.summonRespawnTurn > r.turn)
  r.turn = e.sim!.summonRespawnTurn; beginIntegratedTurn(r)
  assert.equal(summonCount(e.sim!), 4)
})
check('장로거미: 부위 약점·실드·거미줄 누적·공용 손패 봉인·부위 파괴 해제', () => {
  let r = fixture(15), e = r.enemies[0]
  assert.equal(e.sim!.parts.length, 5)
  assert.equal(spiderWebTension(e.sim!), 1)
  r = advanceTurn(r)
  assert.ok(r.product!.sealed.length > 0 && r.product!.sealed.length <= 3)
  assert.ok(!canPlaceCard(r, 'action', r.product!.sealed[0]))
  assert.throws(() => chooseCard(r, 'action', r.product!.sealed[0]))
  e = r.enemies[0]; e.sim!.magicShield = 0; e.sim!.guard = 0
  const oracle = structuredClone(r), state = bridgeState(oracle, [oracle.enemies[0]])
  applyIntent(state, damageIntent(100000, ['wind']), 1, 0)
  integratedDamage(r, e, 100000, ['wind'])
  assert.equal(e.hp, state.enemies[0].hp)
  assert.equal(e.sim!.parts.filter(p => p.broken).length, 1)
  assert.equal(spiderWebTension(e.sim!), 0)
  restored(r)
})
check('각 보스 미리보기/실행/저장 재개/타격 연출 이벤트가 동일', () => {
  for (const floor of [5, 10, 15]) {
    const r = fixture(floor), preview = resolveTurn(r), resumed = resolveTurn(restored(r))
    assert.deepEqual(resumed, preview)
    assert.ok(bossIntel(r).length)
    const damage = combatBeats(preview).flatMap(b => b.damage)
    assert.deepEqual(damage, preview.damageEvents)
    assert.equal(preview.enemyDamage, r.enemies.reduce((a, e) => a + e.hp, 0) - preview.next.enemies.reduce((a, e) => a + e.hp, 0))
  }
})
check('15층 최종 보상 뒤 승리, 패배 저장도 재개 가능', () => {
  const r = fixture(15); r.phase = 'reward'; r.product!.rewardStep = 'complete'
  const won = completeIntegratedReward(r)
  assert.equal(won.phase, 'won'); assert.equal(won.product!.completedFloors.filter(f => f === 15).length, 1)
  restored(won); assert.throws(() => completeIntegratedReward(won))
  const lost = fixture(); lost.hp = 0; lost.phase = 'lost'; restored(lost)
})
check('통합/프로토타입/classic 저장 키가 서로 덮이지 않음', () => {
  const data = new Map<string, string>([['little-token.run.v1', 'classic sentinel']])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } })
  const prototype = createSteeringRun(11), integrated = fixture()
  saveSteeringRun(prototype); saveSteeringRun(integrated)
  assert.equal(loadSteeringRun()!.product, undefined); assert.ok(loadSteeringRun(true)!.product)
  assert.ok(data.has(STEERING_SAVE_KEY)); assert.ok(data.has(INTEGRATED_SAVE_KEY))
  assert.equal(data.get('little-token.run.v1'), 'classic sentinel')
})


check('통합 템플릿은 3~5칸, 네 범주, 실제 목적어, 원안 배우를 저장', () => {
  const lengths = new Set<number>()
  for (let seed = 1; seed <= 60; seed++) {
    const r = createSteeringRun(seed, true)
    for (const sentence of Object.values(r.sentences)) {
      const slots = slotsFor(sentence); lengths.add(slots.length)
      assert.ok(slots.includes('obj')); assert.ok(!slots.includes('adv3'))
      assert.equal(slots.filter(x => x === 'obj').length, 1)
      assert.ok(sentence.originActor)
    }
    restored(r)
  }
  assert.deepEqual([...lengths].sort(), [3, 4, 5])
})
check('잉크: 빈칸 무료, 고정 칸만 1, 중복 차감 없음, 원안 복원 환불, 0 추가 수정 차단', () => {
  let r = fixture()
  const original = JSON.stringify(Object.values(r.sentences).map(s => ({ fixed: s.fixed, blank: s.blank, slots: s.slots })))
  r = chooseCard(r, 'situation', 'calm')
  assert.equal(inkSpent(r), 0)
  r = chooseCard(r, 'situation', 'actor:player', 'subj'); assert.equal(inkRemaining(r), 1)
  r = chooseCard(r, 'situation', `actor:${r.enemies[1].id}`, 'subj'); assert.equal(inkRemaining(r), 1)
  r = chooseCard(r, 'situation', 'everyone', 'obj'); assert.equal(inkRemaining(r), 0)
  assert.ok(!canPlaceCard(r, 'action', 'mirror', 'adv'))
  assert.throws(() => chooseCard(r, 'action', 'mirror', 'adv'))
  r = chooseCard(r, 'situation', 'actor:player', 'subj'); assert.equal(inkRemaining(r), 0)
  r = chooseCard(r, 'action', 'echo'); assert.equal(inkRemaining(r), 0)
  r = restored(r); assert.equal(inkSpent(r), 2)
  r = resetIntegratedSlot(r, 'situation', 'subj'); assert.equal(inkRemaining(r), 1)
  r = chooseCard(r, 'situation', r.sentences.situation.fixed.obj!, 'obj'); assert.equal(inkRemaining(r), 2)
  assert.equal(JSON.stringify(Object.values(r.sentences).map(s => ({ fixed: s.fixed, blank: s.blank, slots: s.slots }))), original)
  assert.equal(slotId(r, 'situation', 'obj'), 'actor:player')
})
check('새 손패는 원안·빈칸·지불한 수정 보존, 새 턴에 잉크 2 리필', () => {
  let r = fixture(); r = chooseCard(r, 'situation', 'actor:player', 'subj')
  const sentences = JSON.stringify(r.sentences)
  r = redraw(r)
  assert.equal(inkRemaining(r), 1)
  for (const lane of ['situation', 'action'] as const) {
    assert.deepEqual(r.sentences[lane].fixed, JSON.parse(sentences)[lane].fixed)
    assert.equal(r.sentences[lane].blank, JSON.parse(sentences)[lane].blank)
  }
  r = advanceTurn(r); assert.equal(inkRemaining(r), 2)
  assert.ok(Object.values(r.sentences).every(s => !Object.keys(s.edits ?? {}).length))
  restored(r)
})
check('목적어는 뒤 위치의 실제 적을 타격, 죽은 지정 대상은 다른 적으로 바꾸지 않음', () => {
  let r = fixture(2)
  const rear = r.enemies[r.enemies.length - 1]
  r = chooseCard(r, 'action', `actor:${rear.id}`, 'obj')
  const preview = resolveTurn(r)
  assert.ok(preview.attacks.some(a => a.source === 'player' && a.target === rear.id))
  rear.hp = rear.sim!.hp = 0; rear.sim!.dead = true
  // chooseCard는 복제하므로 실제 입력 쪽의 동일 개체에 사망 상태를 기록한다.
  const target = r.enemies.find(e => e.id === rear.id)!; target.hp = target.sim!.hp = 0; target.sim!.dead = true
  const dead = resolveTurn(restored(r))
  assert.equal(dead.attacks.filter(a => a.source === 'player').length, 0)
  assert.ok(dead.log.some(l => l.includes('대체 없음')))
})
check('문장 번호와 무관하게 실제 주어 변경, 적끼리 공격과 나의 자가 타격', () => {
  let r = fixture(2)
  const source = r.enemies[1].id, target = r.enemies[2].id
  r = chooseCard(r, 'action', `actor:${source}`, 'subj')
  r = chooseCard(r, 'action', `actor:${target}`, 'obj')
  assert.deepEqual(compileSentence(r, 'action')!.actors, [source])
  const result = resolveTurn(r)
  assert.ok(result.attacks.some(a => a.source === source && a.target === target))
  assert.equal(result.attacks.filter(a => a.source === source && a.target === 'player').length, 0)
  r = fixture(); r = chooseCard(r, 'situation', 'actor:player', 'subj')
  assert.deepEqual(compileSentence(r, 'situation')!.actors, ['player'])
  assert.ok(resolveTurn(r).attacks.some(a => a.source === 'player' && a.target === 'player'))
  assert.ok(encounterSubjects(r).some(c => c.id === 'actor:player' && c.name === '프롬' && c.forms.subj === '프롬은' && c.forms.obj === '프롬을'))
})
check('모든 적 기본 턴, 중복 주어는 명시된 두 행동만, 실제 타격 이벤트와 저장 예측 동일', () => {
  let r = fixture(2)
  r.hp = r.maxHp = r.product!.player.stats.hp = 1000
  for (const e of r.enemies) { e.hp = e.maxHp = e.sim!.hp = e.sim!.maxHp = e.sim!.hpPerBar = 1000; e.sim!.guard = 0; e.sim!.magicShield = 0 }
  const result = resolveTurn(r)
  for (const e of r.enemies) assert.equal(result.attacks.filter(a => a.source === e.id).length, 1)
  const source = r.enemies[0].id
  r = chooseCard(r, 'action', `actor:${source}`, 'subj')
  assert.equal(integratedPlan(r).filter(j => j.source === source).length, 2)
  assert.ok(integratedPlan(r).filter(j => j.source === source).every(j => !j.fallback))
  const doubled = resolveTurn(r)
  assert.equal(doubled.attacks.filter(a => a.source === source).length, 2)
  assert.deepEqual(resolveTurn(restored(r)), doubled)
  assert.deepEqual(combatBeats(doubled).flatMap(b => b.damage), doubled.damageEvents)
})
check('방어/회복/화상 행동은 목적어에게, 반사/가시/연타는 실제 대상 배우에 기록', () => {
  let r = fixture(2); r.hp = 20
  r = chooseCard(r, 'action', 'rest')
  r = chooseCard(r, 'action', 'actor:player', 'obj')
  const heal = resolveTurn(r)
  assert.ok(heal.supportEvents!.some(e => e.target === 'player' && e.kind === 'heal'))
  r = fixture(2); r.hand = ['fire', 'wind', 'thorn', 'mirror', 'force', 'echo']
  r.sentences.situation.selected = 'force'; r.sentences.action.selected = 'fire'
  const ignited = resolveTurn(r)
  assert.ok(ignited.next.enemies[0].burnTurns > 0)
  assert.ok(ignited.damageEvents.some(e => e.target === r.enemies[0].id && e.cause === 'burn'))
  r = fixture(2); r.sentences.action.selected = 'echo'
  // 연타 횟수 검사는 대상이 도중에 죽지 않는 상태에서 확인한다.
  for (const e of r.enemies) e.hp = e.maxHp = e.sim!.hp = e.sim!.maxHp = e.sim!.hpPerBar = 1000
  const multi = resolveTurn(r)
  assert.equal(multi.attacks.filter(a => a.source === 'player').length, 3)
  r = fixture(2); r.sentences.action.selected = 'mirror'; r.sentences.action.fixed.obj = 'actor:player'
  const mirror = resolveTurn(r)
  assert.ok(mirror.damageEvents.some(e => e.cause === 'reflect'))
})
check('원본 제련 체크포인트가 선택마다 저장되고 재개 시 난수/선택을 복원', () => {
  const source = readFileSync('src/views/ItemExclaimView.ts', 'utf8')
  assert.match(source, /opts.checkpoint/); assert.match(source, /this.picks = c.picks/)
  assert.match(source, /this.checkpoint\(\)[\s\S]*this.refresh\(\)/)
  assert.match(readFileSync('src/views/SteeringView.ts', 'utf8'), /onCheckpoint: checkpoint/)
})
check('참조 이미지 UI 계약: 넓은 전장·좌 순서/아이템·우 요약과 작은 화면 드로어·하단 6장/잉크/실행', () => {
  const view = readFileSync('src/views/SteeringView.ts', 'utf8'), css = readFileSync('src/views/steering.css', 'utf8')
  for (const name of ['st-left-rail', 'st-owned-items', 'st-card-panel', 'st-ink-drops', 'st-turn-actions']) assert.ok(view.includes(name))
  assert.match(css, /st-in-battle \.st-arena \{ position:absolute; inset:0/)
  assert.match(css, /@media\(max-width:1099px\),\(max-height:649px\)/)
  assert.match(view, /data-cmd="effect-panel" aria-expanded=/)
  assert.match(css, /\.st-card-panel.st-panel-open/)
  assert.match(css, /st-ribbon-situation/); assert.match(css, /st-ribbon-action/)
  assert.doesNotMatch(view, /<details class="st-(other-roles|reward-effects)"/)
})
check('저장 정규형: optional undefined는 키 부재와 같고 전체 결과를 그대로 비교', () => {
  const r = fixture(2)
  r.enemies[0].sim!.def = { ...r.enemies[0].sim!.def, magicShield: undefined }
  assert.ok(Object.prototype.hasOwnProperty.call(r.enemies[0].sim!.def, 'magicShield'))
  const original = JSON.stringify(r)
  const live = resolveTurn(r), saved = resolveTurn(restored(r))
  assert.deepEqual(saved, live)
  assert.deepEqual(normalizeIntegratedRun(r), JSON.parse(original))
  assert.ok(!Object.prototype.hasOwnProperty.call(live.next.enemies[0].sim!.def, 'magicShield'))
  assert.ok(Object.prototype.hasOwnProperty.call(r.enemies[0].sim!.def, 'magicShield'))
})
check('왼쪽 확정 계획은 hover 미선택 후보와 분리, 실제 타격에 순서/대상 연결', () => {
  let r = fixture(2)
  r = chooseCard(r, 'action', `actor:${r.enemies[1].id}`, 'subj')
  const committed = integratedPlan(r, true)
  const hover = chooseCard(r, 'action', `actor:${r.enemies[1].id}`, 'obj')
  assert.notDeepEqual(integratedPlan(hover, true), committed)
  assert.deepEqual(integratedPlan(r, true), committed)
  const result = resolveTurn(r), actualPlan = integratedPlan(r)
  for (const hit of result.attacks) {
    assert.equal(actualPlan[hit.planIndex! - 1].source, hit.source)
    assert.ok(actualPlan[hit.planIndex! - 1].targets.includes(hit.target))
  }
  const source = readFileSync('src/views/SteeringView.ts', 'utf8')
  const start = source.indexOf('private integratedControlsHtml('), end = source.indexOf('private sentenceHtml(', start)
  assert.match(source.slice(start, end), /integratedPlan\(run, true\)/)
  assert.doesNotMatch(source.slice(start, end), /inspectionRun/)
  const copy = readFileSync('src/localization/steeringIntegrated.ts', 'utf8')
  assert.match(source, /ST_INTEGRATED.ui.trial/)
  assert.match(copy, /미리보기 · 미선택/)
  assert.doesNotMatch(source, /나는\/나를=프롬|프롬\(나\)/)
})
check('지원 동사 설명과 실제 수신자 일치, 주어/수식은 행동자 효과', () => {
  const r = fixture(2)
  for (const id of ['calm', 'rest', 'fire', 'thorn', 'mirror', 'wind']) {
    assert.match(describeEffect(r, id, 'verb'), /목적어 대상/)
    assert.doesNotMatch(describeEffect(r, id, 'verb'), /행동 주체에게/)
  }
  assert.match(describeEffect(r, 'thorn', 'subj'), /행동자/)
  assert.match(describeEffect(r, 'rest', 'adv'), /행동자/)
  for (const [id, kind] of [['rest', 'heal'], ['thorn', 'guard'], ['mirror', 'reflect'], ['wind', 'dodge']] as const) {
    let draft = fixture(2); draft.hp = 20
    if (!draft.hand.includes(id)) draft.hand[draft.hand.length - 1] = id
    for (const sentence of Object.values(draft.sentences)) sentence.choices = [...draft.hand]
    draft = chooseCard(draft, 'action', id)
    draft = chooseCard(draft, 'action', 'actor:player', 'obj')
    assert.ok(resolveTurn(draft).supportEvents!.some(event => event.source === 'player' && event.target === 'player' && event.kind === kind))
  }
})
check('통합 손패 이름과 활용 문구는 겹치지 않고 상세 설명에 접근 가능', () => {
  const css = readFileSync('src/views/steering.css', 'utf8')
  const name = css.match(/st-card \.concept-front \.concept-name \{[^}]*bottom:(\d+)px;[^}]*height:(\d+)px/)
  const note = css.match(/st-card \.concept-front \.concept-note \{[^}]*bottom:(\d+)px;[^}]*height:(\d+)px/)
  assert.ok(name && note, '통합 카드 이름과 활용 문구 영역 필요')
  assert.ok(Number(note[1]) + Number(note[2]) <= Number(name[1]), '문구 영역은 이름 아래에 있어야 함')
  assert.ok(Number(name[1]) + Number(name[2]) <= 250, '카드 안에 이름 표시')
  assert.match(readFileSync('src/ui/WordCardFace.ts', 'utf8'), /concept-note.*title=/)
  assert.match(css, /st-role-details p \{ display:block/)
})
console.log(`통합 회귀 ${checks}개 통과`)
