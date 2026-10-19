import assert from 'node:assert/strict'
import { CONCEPTS, STARTER_CONCEPTS, ROLES, SLOT_ROLES, type Lane, type Role } from '@data/steering'
import { advanceTurn, cardFor, chooseCard, compileSentence, createSteeringRun, describeEffect, effectFor,
  redraw, resolveTurn, takeReward, validateSteeringSave, canPlaceCard, slotsFor, formFor, preparedEffects, type SteeringRun } from '@core/steering'
import { combatBeats } from '@core/steeringBeats'
import { outcomeFacts } from '@/localization/steeringForecast'

let checks = 0
function check(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`) }
function scenario(enemyVerb = 'force', playerVerb = 'mirror', enemyAdv = 'force', playerAdv = 'force'): SteeringRun {
  const run = createSteeringRun(17)
  run.enemies[0].hp = run.enemies[0].maxHp = 250
  run.sentences.situation = { lane: 'situation', blank: 'adv', fixed: { subj: `actor:${run.enemies[0].id}`, adv: enemyAdv, verb: enemyVerb }, choices: [enemyAdv, 'calm'], selected: enemyAdv }
  run.sentences.action = { lane: 'action', blank: 'verb', fixed: { subj: 'self', adv: playerAdv, verb: playerVerb }, choices: [playerVerb, 'rest'], selected: playerVerb }
  run.hand = [...new Set([enemyAdv, playerVerb, 'force', 'calm', 'mirror', 'rest'])].slice(0, 6)
  for (const s of Object.values(run.sentences)) s.choices = [...run.hand]
  return run
}
check('3~5칸 독립 생성과 무작위 빈칸 · 공용 손패 6장', () => {
  const blanks = new Set<Role>()
  const lengths = new Set<number>()
  for (let seed = 1; seed <= 100; seed++) {
    let run = createSteeringRun(seed)
    for (let turn = 0; turn < 8; turn++) {
      for (const lane of ['situation', 'action'] as Lane[]) {
        const s = run.sentences[lane]; blanks.add(s.blank)
        lengths.add(slotsFor(s).length)
        assert.ok(slotsFor(s).length >= 3 && slotsFor(s).length <= 5)
        assert.equal(s.selected, null); assert.equal(run.hand.length, 6)
        assert.equal(new Set(run.hand).size, 6)
        assert.deepEqual(s.choices, run.hand)
        assert.ok(slotsFor(s).includes(s.blank))
      }
      run = advanceTurn(run)
    }
  }
  assert.equal(blanks.size, 5); assert.equal(lengths.size, 3)
})
check('선택/재탐색은 고정 구절과 빈칸 위치를 바꾸지 않음; 입력 불변', () => {
  const run = createSteeringRun(8), before = JSON.stringify(run), s = run.sentences.situation
  const id = run.hand.find(id => canPlaceCard(run, 'situation', id))!
  const selected = chooseCard(run, 'situation', id)
  const next = redraw(selected, 'situation')
  assert.deepEqual(next.sentences.situation.fixed, s.fixed)
  assert.equal(next.sentences.situation.blank, s.blank)
  assert.equal(next.redraws, 1); assert.equal(next.sentences.situation.selected, id)
  assert.ok(next.hand.includes(id)); assert.deepEqual(next.sentences.action.choices, next.hand)
  assert.equal(JSON.stringify(run), before)
  assert.equal(redraw(redraw(next, 'situation'), 'situation').redraws, 0)
  assert.throws(() => chooseCard(run, 'situation', 'not-in-hand'))
})
check('같은 카드는 한 곳에만 배치 · 이동/교체 시 고정 구절 보존', () => {
  const run = createSteeringRun(7), fixed = JSON.stringify(run.sentences.action.fixed)
  const id = run.hand.find(id => canPlaceCard(run, 'action', id) && canPlaceCard(run, 'situation', id))!
  const moved = chooseCard(chooseCard(run, 'situation', id), 'action', id)
  assert.equal(moved.sentences.situation.selected, null); assert.equal(moved.sentences.action.selected, id)
  assert.equal(JSON.stringify(moved.sentences.action.fixed), fixed); assert.deepEqual(moved.hand, run.hand)
})
check('약화는 시작 덱/실제 공용 손패에 등장하고 양쪽 모든 범주에 배치 가능', () => {
  assert.ok(STARTER_CONCEPTS.includes('weaken'))
  const placements = new Set<string>()
  for (let seed = 1; seed <= 200; seed++) {
    const run = createSteeringRun(Math.imul(seed, 2654435761) >>> 0)
    assert.ok(run.deck.includes('weaken'))
    if (!run.hand.includes('weaken')) continue
    assert.equal(run.hand.length, 6)
    for (const lane of ['situation', 'action'] as Lane[]) {
      assert.ok(canPlaceCard(run, lane, 'weaken'))
      const chosen = chooseCard(run, lane, 'weaken')
      assert.deepEqual(chosen.sentences[lane].choices, chosen.hand)
      assert.equal(chosen.sentences[lane].selected, 'weaken')
      assert.ok(compileSentence(chosen, lane))
      placements.add(`${lane}:${chosen.sentences[lane].blank}`)
    }
  }
  assert.equal(placements.size, 10)
  const run = scenario()
  assert.equal(formFor(run, 'weaken', 'subj', 'action'), '기운 빠진 내가')
  assert.equal(formFor(run, 'weaken', 'subj', 'situation'), '기운 빠진 흰개미가')
  for (const role of SLOT_ROLES) {
    assert.equal(effectFor(run, 'weaken', role).scale, 0.5)
    assert.match(describeEffect(run, 'weaken', role), /내 문장에 넣으면 나도 약해짐/)
  }
  assert.equal(formFor(run, 'weaken', 'verb', 'action'), '힘없이 때렸다')
  run.levels.weaken = 1
  assert.ok(effectFor(run, 'weaken', 'adv').scale! < 0.5)
})
check('반사 없이 적 약화 + 내 힘 강화로 실제 받는 피해 감소/주는 피해 증가', () => {
  const baseline = resolveTurn(scenario('force', 'force', 'link', 'link'))
  const run = scenario('force', 'force', 'weaken', 'force')
  const result = resolveTurn(run)
  assert.equal(baseline.playerDamage, 8); assert.equal(result.playerDamage, 4)
  assert.equal(baseline.enemyDamage, 19); assert.equal(result.enemyDamage, 33)
  assert.equal(result.reflected, 0)
  assert.equal(result.next.hp, run.hp - 4)
  assert.equal(result.next.enemies[0].hp, run.enemies[0].hp - 33)
  const selfWeakened = resolveTurn(scenario('force', 'weaken', 'link', 'link'))
  assert.equal(selfWeakened.enemyDamage, 6)
  assert.ok(selfWeakened.enemyDamage < baseline.enemyDamage)
})
check('공격하지 않는 상대에 불꽃 수식 + 힘/메아리 행동: 표시와 실제 화상 일치', () => {
  for (const verb of ['force', 'echo']) {
    const run = scenario('rest', verb, 'link', 'fire')
    const shown = preparedEffects(compileSentence(run, 'action')!).burn
    assert.equal(shown, 5)
    const result = resolveTurn(run)
    assert.equal(result.attacks.filter(a => a.source !== 'player').length, 0)
    assert.equal(result.next.enemies[0].burn, shown)
    assert.equal(result.next.enemies[0].burnTurns, 2)
    assert.deepEqual(result.damageEvents.filter(e => e.cause === 'burn'),
      [{ target: run.enemies[0].id, amount: shown, cause: 'burn' }])
    assert.equal(result.log.some(line => line.includes('접촉 화상')), false)
  }
})
check('화상 공통 계산은 접촉/자기 발화/완전 회피/방어/강한 기존 화상을 보존', () => {
  const contact = scenario('force', 'thorn', 'force', 'fire')
  const shownContact = preparedEffects(compileSentence(contact, 'action')!).burn
  assert.equal(resolveTurn(contact).next.enemies[0].burn, shownContact)
  const ignite = scenario('rest', 'fire', 'link', 'echo')
  const shownSelf = preparedEffects(compileSentence(ignite, 'action')!).selfBurn
  assert.equal(resolveTurn(ignite).next.playerBurn, shownSelf)
  const dodged = resolveTurn(scenario('wind', 'force', 'wind', 'fire'))
  assert.equal(dodged.next.enemies[0].burnTurns, 0)
  const guarded = resolveTurn(scenario('calm', 'force', 'force', 'fire'))
  assert.equal(guarded.attacks[0].healthDamage, 0)
  assert.equal(guarded.next.enemies[0].burn, 5)
  const existing = scenario('rest', 'force', 'link', 'fire')
  existing.enemies[0].burn = 9; existing.enemies[0].burnTurns = 1
  const refreshed = resolveTurn(existing)
  assert.equal(refreshed.next.enemies[0].burn, 9)
  assert.equal(refreshed.next.enemies[0].burnTurns, 2)
})
check('반사 준비 상태에서는 적 공격 강화가 반사 피해를 증가시킴', () => {
  const strong = resolveTurn(scenario()), calm = resolveTurn(scenario('force', 'mirror', 'calm'))
  assert.ok(strong.reflected > calm.reflected); assert.equal(strong.next.hp, 60)
  assert.ok(strong.reflected > 0)
})
check('연타를 유도하면 가시가 타격마다 발동', () => {
  const run = scenario('echo', 'thorn', 'echo', 'calm')
  const result = resolveTurn(run)
  assert.equal(result.log.filter(line => line.includes('가시 반격')).length, 3)
})
check('힘과 메아리는 방어/반사에도 작용하고 불꽃 방어는 접촉 화상', () => {
  const boosted = resolveTurn(scenario('force', 'mirror', 'force', 'force'))
  const neutral = resolveTurn(scenario('force', 'mirror', 'force', 'rest'))
  assert.ok(boosted.reflected > neutral.reflected)
  const fire = resolveTurn(scenario('force', 'thorn', 'force', 'fire'))
  assert.ok(fire.next.enemies[0].burnTurns > 0)
  const guard = scenario('force', 'calm', 'force', 'echo')
  assert.equal(resolveTurn(guard).next.hp, 60)
})
check('돌진을 완전히 회피하면 다른 적에게 충돌; 혼자일 땐 충돌 없음', () => {
  const run = scenario('rush', 'wind')
  assert.equal(resolveTurn(run).collision, 0)
  run.enemies.push({ ...run.enemies[0], id: 'other', name: '다른 적' })
  const result = resolveTurn(run)
  assert.ok(result.collision > 0)
  assert.ok(result.log.some(line => line.includes('충돌')))
})
check('불꽃의 문법/효과: 수식어는 타격 대상, 동사는 행동 주체에 화상', () => {
  const run = scenario('force', 'force', 'calm', 'fire')
  const hit = resolveTurn(run)
  assert.ok(hit.next.enemies[0].burnTurns > 0)
  assert.equal(compileSentence(run, 'action')!.text, '나는 불꽃을 두르고 내리쳤다')
  const ignite = scenario('force', 'fire', 'calm', 'calm')
  const result = resolveTurn(ignite)
  assert.ok(result.next.playerBurnTurns > 0)
  assert.equal(result.next.enemies[0].burnTurns, 0)
})
check('화상은 정확히 3턴 작동하고 종료; 전투 완료 시 저장 유효', () => {
  let run = scenario('mirror', 'fire', 'calm', 'calm')
  let result = resolveTurn(run)
  assert.equal(result.next.playerBurnTurns, 2)
  run = result.next
  run.sentences.action.fixed.verb = 'mirror'; run.sentences.action.choices = ['mirror']; run.sentences.action.selected = 'mirror'
  result = resolveTurn(run); assert.equal(result.next.playerBurnTurns, 1)
  result = resolveTurn(result.next); assert.equal(result.next.playerBurnTurns, 0)
})
check('조우 주어는 주체를 바꾸고 모두는 플레이어까지 포함', () => {
  const run = scenario()
  run.enemies.push({ ...run.enemies[0], id: 'other', name: '둘째 적' })
  run.sentences.situation.blank = 'subj'
  run.sentences.situation.choices = ['everyone', 'vanguard']
  run.sentences.situation.selected = 'everyone'
  assert.deepEqual(compileSentence(run, 'situation')!.actors, ['player', run.enemies[0].id, 'other'])
  assert.equal(cardFor(run, 'everyone').forms.subj, '모두는')
  run.sentences.situation.selected = 'vanguard'
  assert.equal(compileSentence(run, 'situation')!.actors.length, 2)
  assert.ok(!compileSentence(run, 'situation')!.actors.includes('player'))
  assert.ok(!run.deck.includes('everyone'))
})
check('선택되지 않은 다른 적도 기본 행동; 쓰러지면 행동 안 함', () => {
  const run = scenario('mirror', 'mirror', 'calm', 'calm')
  run.enemies.push({ ...run.enemies[0], id: 'other', name: '둘째 적', atk: 10 })
  assert.ok(resolveTurn(run).reflected > 0)
  run.enemies[1].hp = 0
  assert.equal(resolveTurn(run).reflected, 0)
})
check('무거운 적 공격은 내 공격 뒤로 이동; 처치되면 공격하지 않음', () => {
  const run = scenario('force', 'force', 'weight', 'force')
  run.enemies[0].hp = 1
  assert.equal(resolveTurn(run).next.hp, 60)
})
check('미리보기와 실행 일치 및 원본 상태 불변', () => {
  for (let seed = 1; seed <= 50; seed++) {
    let run = createSteeringRun(seed)
    const a = run.hand.find(id => canPlaceCard(run, 'situation', id))!
    const b = run.hand.find(id => id !== a && canPlaceCard(run, 'action', id))!
    run = chooseCard(run, 'situation', a)
    run = chooseCard(run, 'action', b)
    const before = JSON.stringify(run)
    assert.deepEqual(resolveTurn(run), resolveTurn(run))
    assert.equal(JSON.stringify(run), before)
    assert.ok(validateSteeringSave(JSON.parse(before)))
  }
})
check('모든 개념은 세 종류의 위치에 표현과 효과 보유; 강화는 낮은 타격 계수도 증가', () => {
  const run = createSteeringRun(9)
  for (const card of CONCEPTS) for (const role of ROLES) {
    assert.ok(card.forms[role]); assert.ok(describeEffect(run, card.id, role))
  }
  const before = effectFor(run, 'echo', 'adv').scale!
  run.levels.echo = 1
  assert.ok(effectFor(run, 'echo', 'adv').scale! > before)
})
check('손상 저장은 거부하고 완료 전투의 쓰러진 조우 주어는 복구', () => {
  assert.equal(validateSteeringSave({ schema: 1 }), null)
  const run = scenario()
  run.enemies[0].hp = 1
  run.sentences.situation.blank = 'subj'
  run.sentences.situation.choices = [`actor:${run.enemies[0].id}`]
  run.sentences.situation.selected = run.sentences.situation.choices[0]
  run.hand[0] = run.sentences.situation.selected
  const result = resolveTurn(run)
  assert.equal(result.next.phase, 'reward')
  assert.ok(validateSteeringSave(JSON.parse(JSON.stringify(result.next))))
  const next = takeReward(result.next, result.next.rewardChoices[0])
  assert.equal(next.floor, 2); assert.equal(next.redraws, 2)
  assert.ok(!next.deck.some(id => id.startsWith('actor:')))
})
check('타격별 연출은 실제 타격과 피해 이벤트를 누락/중복 없이 재생', () => {
  const result = resolveTurn(scenario('echo', 'thorn', 'echo', 'calm'))
  const beats = combatBeats(JSON.parse(JSON.stringify(result)))
  assert.equal(beats.filter(b => b.kind === 'strike').length, result.attacks.length)
  assert.deepEqual(beats.flatMap(b => b.damage), result.damageEvents)
  const series = beats.filter(b => b.kind === 'strike')
  assert.deepEqual(series.map(b => b.kind === 'strike' ? b.ordinal : 0), [1, 2, 3])
  const facts = outcomeFacts(scenario('echo', 'thorn', 'echo', 'calm'), result)
  assert.equal(facts.incoming, facts.avoided + facts.returned + facts.blocked + facts.directHealthLoss)
})
check('수식 칸은 모두 같은 의미 · 가시는 횟수가 되지 않고 메아리만 연타', () => {
  const run = scenario('force', 'force', 'calm', 'thorn')
  run.sentences.action.slots = [...SLOT_ROLES]
  Object.assign(run.sentences.action.fixed, { adv2: 'wind', adv3: 'rest' })
  assert.equal(compileSentence(run, 'action')!.hits, 1)
  assert.equal(Object.keys(compileSentence(run, 'action')!.phrases).length, 5)
  for (const card of CONCEPTS) for (const role of ['adv2', 'adv3'] as Role[]) {
    assert.deepEqual(effectFor(run, card.id, role), effectFor(run, card.id, 'adv'))
    assert.equal(card.forms[role], card.forms.adv)
  }
  assert.equal(effectFor(run, 'thorn', 'adv3').hits, undefined)
  run.sentences.action.fixed.adv2 = 'echo'
  assert.equal(compileSentence(run, 'action')!.hits, 3)
  assert.equal(resolveTurn(run).attacks.filter(a => a.source === 'player').length, 3)
})
check('이전 7범주 저장은 최대 5칸의 수식으로 이관 · 선택/진행 보존', () => {
  const legacy = JSON.parse(JSON.stringify(scenario()))
  const s = legacy.sentences.action
  s.slots = ['subj', 'target', 'timing', 'adv', 'link', 'repeat', 'verb']
  Object.assign(s.fixed, { target: 'thorn', timing: 'wind', link: 'fire', repeat: 'thorn' })
  s.blank = 'repeat'; s.selected = 'thorn'
  legacy.hand[legacy.hand.length - 1] = 'thorn'
  s.choices = [...legacy.hand]
  const migrated = validateSteeringSave(legacy)!
  assert.ok(migrated)
  assert.equal(migrated.floor, 1); assert.equal(migrated.seed, legacy.seed)
  assert.equal(migrated.sentences.action.blank, 'adv2')
  assert.equal(migrated.sentences.action.selected, 'thorn')
  assert.equal(slotsFor(migrated.sentences.action).length, 5)
  assert.equal(compileSentence(migrated, 'action')!.hits, 1)
  assert.ok(validateSteeringSave(JSON.parse(JSON.stringify(migrated))))
})

check('이전 독립 손패 저장을 배치/고정 구절/씨드 보존 후 공용 손패로 이관', () => {
  const run = scenario()
  const legacy = JSON.parse(JSON.stringify(run))
  delete legacy.hand
  legacy.sentences.situation.choices = ['force', 'calm', 'fire', 'mirror']
  legacy.sentences.action.choices = ['mirror', 'rest', 'wind', 'thorn']
  const next = validateSteeringSave(legacy)!
  assert.ok(next); assert.equal(next.seed, run.seed)
  assert.equal(next.sentences.situation.selected, 'force'); assert.equal(next.sentences.action.selected, 'mirror')
  assert.deepEqual(next.sentences.situation.fixed, run.sentences.situation.fixed)
  assert.equal(next.hand.length, 6); assert.deepEqual(next.sentences.action.choices, next.hand)
})

// 공용 손패에서 서로 다른 두 카드를 배치하는 정책. 승률은 수용 기준이 아닌 밸런스 관측이다.
let wins = 0, losses = 0, maxFloor = 0
const distributions = new Map<number, number>()
for (let seed = 1; seed <= 30; seed++) {
  let run = createSteeringRun(seed)
  for (let step = 0; step < 500 && run.phase !== 'won' && run.phase !== 'lost'; step++) {
    if (run.phase === 'reward') {
      const reward = run.rewardChoices.find(id => !run.deck.includes(id)) ?? run.rewardChoices[0]
      run = takeReward(run, reward); continue
    }
    let best: ReturnType<typeof resolveTurn> | null = null, bestScore = -Infinity
    for (const a of run.hand) for (const b of run.hand) {
      if (a === b || !canPlaceCard(run, 'situation', a) || !canPlaceCard(run, 'action', b)) continue
      const selected = chooseCard(chooseCard(run, 'situation', a), 'action', b)
      const result = resolveTurn(selected)
      const score = (result.next.phase === 'lost' ? -10000 : 0) + result.enemyDamage * 1.2 - result.playerDamage * 2 + result.reflected * .2
        + (result.next.phase === 'reward' || result.next.phase === 'won' ? 100 : 0)
      if (score > bestScore) { best = result; bestScore = score }
    }
    assert.ok(best)
    assert.ok(best.next.hp >= 0 && best.next.hp <= best.next.maxHp)
    assert.ok(validateSteeringSave(best.next))
    run = best.next.phase === 'battle' ? advanceTurn(best.next) : best.next
  }
  assert.ok(run.phase === 'won' || run.phase === 'lost', `seed ${seed} did not terminate`)
  maxFloor = Math.max(maxFloor, run.floor)
  distributions.set(run.floor, (distributions.get(run.floor) ?? 0) + 1)
  if (run.phase === 'won') wins++; else losses++
}
console.log(JSON.stringify({ checks, runs: 30, wins, losses, maxFloor, endFloors: Object.fromEntries(distributions) }))
assert.ok(maxFloor >= 5, '보스 조우까지 진행 가능해야 함')
