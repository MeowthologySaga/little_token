/** 여러 배우가 함께 참여하는 통합판의 유일한 턴 해석기. 미리보기와 확정이 공유한다. */
import { CONCEPTS, type Effect, type Lane } from '@data/steering'
import { compileSentence, preparedEffects, targetsFor, slotsFor, type SteeringRun, type Resolution,
  type CompiledSentence, type DamageEvent, type AttackTrace, type SupportEvent, type EscortImpact } from './steering'
import { slotId, normalizeIntegratedRun } from './integratedSentences'
import { damageIntent, syncFighter } from './steeringBridge'
import { applyIntent, enemyTurn, enemyAttackDefense, summonCount, spiderWebTension,
  type EnemyInst, type EnemyAttackDefense } from '@/sim/reference'

export interface PlannedAction { source: string; targets: string[]; sentence: CompiledSentence; fallback: boolean; order: number; eligible: boolean }
export function integratedPlan(run: SteeringRun, provisional = false): PlannedAction[] {
  const sentences = (['situation', 'action'] as Lane[]).flatMap(lane => {
    const sentence = run.sentences[lane]
    const draft = provisional && !sentence.selected ? { ...run, sentences: { ...run.sentences, [lane]: { ...sentence, selected: sentence.fixed[sentence.blank]! } } } : run
    const compiled = compileSentence(draft, lane)
    return compiled ? [compiled] : []
  })
  const assigned = new Set(sentences.flatMap(s => s.actors))
  const fallback = run.enemies.filter(e => e.hp > 0 && !assigned.has(e.id)).map(e => ({
    lane: 'situation' as Lane, text: `${e.name} → 프롬 · 기본 행동`, phrases: {} as CompiledSentence['phrases'],
    actors: [e.id], targets: ['player'], kind: 'attack' as const, effect: {} as Effect, power: e.atk, hits: 1,
  }))
  return [...sentences, ...fallback].flatMap((sentence, index) => sentence.actors.map(source => {
    const sim = run.enemies.find(e => e.id === source)?.sim
    return { source, targets: sentence.targets ?? [], sentence, fallback: index >= sentences.length,
      eligible: (source === 'player' ? run.hp > 0 : !!run.enemies.find(e => e.id === source && e.hp > 0)) && (!sim || run.turn >= sim.nextAttackTurn && !(sim.def.summonPattern && summonCount(sim) === 0 && run.turn < sim.summonRespawnTurn)),
      order: sentence.effect.priority ?? (sentence.effect.delay ? 3 : source === 'player' ? 1 : sim?.initiativePhase === 'first' ? 0 : 2) }
  })).sort((a, b) => a.order - b.order)
}
interface Temp { guard: number; reflect: number; dodge: number; thorns: number; burn: number; chain: number }
const round = (n: number) => Math.max(0, Math.round(n))
export function resolveIntegratedTurn(run: SteeringRun): Resolution {
  if (!run.product || run.phase !== 'battle') throw new Error('통합 전투 중이 아닙니다.')
  const situation = compileSentence(run, 'situation'), action = compileSentence(run, 'action')
  if (!situation || !action) throw new Error('두 문장의 무료 빈칸을 채워 주세요.')
  const next = normalizeIntegratedRun(run), p = next.product!, log: string[] = [], damageEvents: DamageEvent[] = [], attacks: AttackTrace[] = []
  const supportEvents: SupportEvent[] = [], escortImpacts: EscortImpact[] = []
  const plan = integratedPlan(run), temps = new Map<string, Temp>(), freshWeak = new Map<string, number>()
  let reflected = 0, collision = 0, healed = 0
  const enemy = (id: string) => next.enemies.find(e => e.id === id)!
  const alive = (id: string) => id === 'player' ? next.hp > 0 : !!next.enemies.find(e => e.id === id && e.hp > 0)
  const name = (id: string) => id === 'player' ? '프롬' : enemy(id).name
  const temp = (id: string): Temp => {
    if (!temps.has(id)) temps.set(id, { guard: id === 'player' ? p.guard : 0, reflect: 0, dodge: 0, thorns: 0, burn: 0, chain: 0 })
    return temps.get(id)!
  }
  const burn = (id: string, value: number) => {
    if (!alive(id)) return
    if (id === 'player') { next.playerBurn = Math.max(next.playerBurn, round(value)); next.playerBurnTurns = 3 }
    else { enemy(id).burn = Math.max(enemy(id).burn, round(value)); enemy(id).burnTurns = 3 }
  }
  const damage = (id: string, value: number, cause: DamageEvent['cause'], ids: string[] = [], pierce = false) => {
    if (!alive(id)) return { amount: 0, blocked: 0 }
    let amount = 0, blocked = 0
    if (id === 'player') { amount = Math.min(next.hp, round(value)); next.hp -= amount }
    else {
      const e = enemy(id), s = e.sim!, before = e.hp, summonsBefore = summonCount(s)
      const escortBefore = { left: [...s.summonHpLeft], right: [...s.summonHpRight] }
      const intent = damageIntent(round(value), ids)
      intent.pierceGuard = pierce
      if (ids.includes('link') || ids.includes('echo')) intent.targetCount = 2
      const state = { playerHp: next.hp, playerMax: next.maxHp, guard: 0, counter: false, counterFull: false, turn: next.turn, pending: null, enemies: [s] }
      const result = applyIntent(state, intent, 1, 0)
      syncFighter(e); amount = before - e.hp
      for (const side of ['left', 'right'] as const) escortBefore[side].forEach((hp, slot) => {
        const after = (side === 'left' ? s.summonHpLeft : s.summonHpRight)[slot] ?? 0
        if (hp !== after) escortImpacts.push({ target: `escort:${e.id}:${side}:${slot}`, boss: e.id, side, slot, hp: after, maxHp: s.def.summonPattern?.hp ?? hp, amount: hp - after })
      })
      blocked = result.hits.reduce((n, h) => n + h.guardAbsorbed, 0)
      if (summonsBefore !== summonCount(s)) log.push(`${e.name}의 일벌 ${summonsBefore - summonCount(s)}마리 퇴치 · 남은 일벌 ${summonCount(s)}`)
      if (result.summonGroggyTriggered) log.push(`${e.name} 그로기 · 다음 공격 한 턴 생략`)
      for (const h of result.hits) {
        if (h.magicShieldBroken) log.push(`${e.name} 마법실드 한 겹 소모`)
        if (h.summonShieldBlocked) log.push(`${e.name} 본체: 일벌 호위로 피해 차단`)
        if (h.webBurst) log.push(`${e.name} 부위 파괴 · 거미줄 전부 해제`)
        else if (h.webCut) log.push(`${e.name} 감정 약점 타격 · 거미줄 완화`)
      }
    }
    if (amount) damageEvents.push({ target: id, amount, cause })
    return { amount, blocked }
  }
  const heal = (id: string, value: number) => {
    if (!alive(id)) return
    const amount = Math.min(id === 'player' ? next.maxHp - next.hp : enemy(id).maxHp - enemy(id).hp, round(value))
    if (id === 'player') { next.hp += amount; healed += amount }
    else { enemy(id).sim!.hp += amount; syncFighter(enemy(id)) }
    if (amount) log.push(`${name(id)} 회복 +${amount}`)
  }
  // 주어/수식의 성질은 행동자에게, 방어·회복 등 행동 동사는 명시된 목적어에게 준다.
  for (const job of plan.filter(j => !j.fallback && j.eligible && alive(j.source))) {
    const s = job.sentence, scale = s.effect.scale ?? 1
    for (const prep of s.preparations ?? []) for (const target of prep.recipients) {
      if (!alive(target)) continue
      // 주어별 준비는 각 주어에게 한 번. 그룹 목적어 지원은 행동자 수만큼 실행한다.
      if (prep.recipients === s.actors && target !== job.source) continue
      const e = { ...prep.effect, scale, hits: s.hits }
      const source = job.source === 'player' ? null : enemy(job.source)
      const compiled = { ...s, effect: e, power: source?.atk ?? next.power,
        guardPower: source?.atk ?? p.player.stats.guard, healPower: source?.atk ?? p.player.stats.heal }
      const prepared = preparedEffects(compiled), t = temp(target)
      const guardBefore = t.guard
      t.guard += prepared.guard
      if (target === 'player') t.guard = Math.min(next.maxHp * .5, t.guard)
      t.reflect = Math.min(2, t.reflect + prepared.reflect); t.dodge = Math.min(1, t.dodge + prepared.dodge)
      t.thorns += prepared.thorns; t.burn = Math.max(t.burn, prepared.burn); t.chain = Math.max(t.chain, prepared.chain)
      if (prepared.heal) {
        const hpBefore = target === 'player' ? next.hp : enemy(target).hp
        heal(target, prepared.heal)
        const actual = (target === 'player' ? next.hp : enemy(target).hp) - hpBefore
        if (actual) supportEvents.push({ source: job.source, target, kind: 'heal', amount: actual })
      }
      for (const [kind, amount] of [['guard', t.guard - guardBefore], ['reflect', prepared.reflect], ['dodge', prepared.dodge]] as const) if (amount) supportEvents.push({ source: job.source, target, kind, amount })
      if (e.kind === 'ignite') { burn(target, prepared.selfBurn); log.push(`${name(job.source)} → ${name(target)} 화상 ${prepared.selfBurn} · 3턴`) }
      if ((prepared.guard || prepared.heal) && target === 'player') {
        const spider = next.enemies.find(e => e.hp > 0 && e.sim?.def.webPattern)
        if (spider) {
          const ids = slotsFor(next.sentences[s.lane]).map(r => slotId(next, s.lane, r)!)
          const support = damageIntent(0, ids); support.kind = prepared.guard ? 'guard' : 'heal'; support.guard = prepared.guard; support.heal = prepared.heal
          const state = { playerHp: next.maxHp, playerMax: next.maxHp, guard: 0, counter: false, counterFull: false, turn: next.turn, pending: null, enemies: [spider.sim!] }
          applyIntent(state, support, 1, 0)
        }
      }
    }
  }
  let activePlanIndex = 0
  const strike = (source: string, target: string, raw: number, effect: Effect, ids: string[], attacker?: EnemyInst): EnemyAttackDefense => {
    const zero = { dealt: 0, absorbed: 0, piercedGuard: false, guardShattered: false, magicShieldBlocked: false, guardRequired: 0 }
    if (!alive(source) || !alive(target)) return zero
    const eventStart = damageEvents.length, escortStart = escortImpacts.length, t = temp(target)
    const original = round(raw * (1 + (target === 'player' ? next.playerWeak : enemy(target).weak)))
    const dodged = round(original * t.dodge)
    let incoming = original - dodged
    if (!incoming && (effect.collision ?? 0) > 0 && source !== 'player') {
      const index = next.enemies.findIndex(e => e.id === source)
      const other = [next.enemies[index + 1], next.enemies[index - 1]].find(e => e?.hp > 0 && e.id !== target)
      if (other) { const d = damage(other.id, raw * effect.collision!, 'collision').amount; collision += d; log.push(`${name(source)} → ${other.name} 충돌 ${d}`) }
    }
    const back = round(incoming * t.reflect)
    let returnedDamage = 0
    if (back) { const d = damage(source, back, 'reflect').amount; returnedDamage = d; reflected += d; log.push(`${name(target)} → ${name(source)} 반사 ${d}`) }
    incoming = Math.max(0, incoming - Math.min(incoming, back))
    let defense = { ...zero, dealt: incoming }, blocked = 0
    const defender = target === 'player' ? null : enemy(target).sim!
    if (attacker) {
      defense = enemyAttackDefense({ turn: next.turn, guard: t.guard + (defender?.guard ?? 0), playerMagicShield: defender?.magicShield ?? 0 }, attacker, incoming)
      if (defense.guardShattered) { blocked = defense.absorbed; t.guard = 0; if (defender) defender.guard = 0; incoming = 0 }
      else if (!defense.piercedGuard && !(defender && defender.magicShield > 0)) { blocked = Math.min(t.guard, incoming); t.guard -= blocked; incoming -= blocked }
    } else { blocked = Math.min(t.guard, incoming); t.guard -= blocked; incoming -= blocked }
    const hit = damage(target, incoming, 'attack', ids, defense.piercedGuard)
    blocked += hit.blocked
    if (hit.amount) log.push(`${name(source)} → ${name(target)} 타격 ${hit.amount}`)
    if (t.thorns && dodged < original && alive(source)) {
      const d = damage(source, t.thorns, 'thorns').amount
      if (t.chain && target === 'player') for (const other of next.enemies.filter(e => e.id !== source && e.hp > 0)) damage(other.id, d * t.chain, 'chain')
    }
    if (t.burn && dodged < original && alive(source)) burn(source, t.burn)
    const contactBurn = effect.kind === 'ignite' ? 0 : round((effect.burn ?? 0) * (effect.scale ?? 1) * (effect.hits ?? 1))
    if (contactBurn && dodged < original && alive(target)) burn(target, contactBurn)
    const chain = effect.chain ?? 0
    if (chain && hit.amount && target !== 'player') for (const other of next.enemies.filter(e => e.id !== target && e.id !== source && e.hp > 0)) damage(other.id, hit.amount * chain, 'chain')
    if (t.chain && returnedDamage && target === 'player') for (const other of next.enemies.filter(e => e.id !== source && e.hp > 0)) damage(other.id, returnedDamage * t.chain, 'chain')
    attacks.push({ planIndex: activePlanIndex, escorts: escortImpacts.slice(escortStart), source, target, incoming: original, dodged, reflected: Math.min(original - dodged, back), blocked,
      healthDamage: hit.amount, eventStart, eventEnd: damageEvents.length })
    return { ...defense, dealt: hit.amount, absorbed: blocked, magicShieldBlocked: false }
  }
  for (const [planIndex, job] of plan.entries()) {
    activePlanIndex = planIndex + 1
    if (!alive(job.source) || !job.eligible) { log.push(`${name(job.source)}: 예정 행동 생략`); continue }
    const s = job.sentence, source = job.source, e = s.effect
    const ids = job.fallback ? [] : slotsFor(next.sentences[s.lane]).map(r => slotId(next, s.lane, r)!)
    const targets = targetsFor(next, s, source)
    if (!targets.length) log.push(`${name(source)}: 지정된 대상이 쓰러져 행동 대상 없음 · 대체 없음`)
    if (source === 'player') {
      if (s.kind === 'attack') for (let i = 0; i < s.hits && alive(source); i++) for (const target of targets) {
        strike(source, target, next.power * (e.scale ?? 1), e, ids)
      }
    } else {
      const fighter = enemy(source), sim = fighter.sim!
      sim.nextAttackTurn = next.turn // 같은 배우의 두 문장은 명시된 두 행동이다. 기본 행동은 추가하지 않는다.
      const state = { playerHp: next.hp, playerMax: next.maxHp, guard: 0, counter: false, counterFull: false, turn: next.turn, pending: null, enemies: [sim] }
      const attackStart = attacks.length
      const strikes = enemyTurn(state, () => .5, sim.initiativePhase, raw => raw * (e.scale ?? 1), (_state, _enemy, raw) => {
        let total: EnemyAttackDefense = { dealt: 0, absorbed: 0, piercedGuard: false, guardShattered: false, magicShieldBlocked: false, guardRequired: 0 }
        if (s.kind === 'attack' || sim.def.boss) for (let i = 0; i < s.hits && alive(source); i++) for (const target of targets) {
          const start = attacks.length, d = strike(source, target, raw, e, ids, sim)
          total = { ...d, dealt: total.dealt + d.dealt, absorbed: total.absorbed + d.absorbed, guardShattered: total.guardShattered || d.guardShattered }
          for (const a of attacks.slice(start)) a.animationStage = sim.def.attackPattern?.[sim.attackPatternIndex]?.animationStage ?? 1
        }
        return total
      })
      for (const attack of attacks.slice(attackStart)) attack.animationStage = strikes[0]?.animationStage ?? attack.animationStage
      if (sim.dead) sim.hp = 0
      const lifeStolen = strikes.reduce((n, s) => n + s.lifeStolen, 0)
      if (!sim.dead && lifeStolen && attacks.length > attackStart) attacks[attacks.length - 1].healing = [{ target: source, amount: lifeStolen }]
      syncFighter(fighter)
      log.push(...strikes.map(s => s.text.replace(/ → .*? 피해/, ' · 고유 행동 완료')))
    }
    if (e.weak && alive(source)) { freshWeak.set(source, e.weak); if (source === 'player') next.playerWeak = e.weak; else enemy(source).weak = e.weak }
  }
  const escortAftermathStart = escortImpacts.length
  if (next.playerBurnTurns > 0 && next.hp > 0) { const d = damage('player', next.playerBurn, 'burn').amount; log.push(`프롬 화상 ${d}`); next.playerBurnTurns-- }
  for (const e of next.enemies) {
    if (e.burnTurns > 0 && e.hp > 0) { const d = damage(e.id, e.burn, 'burn').amount; log.push(`${e.name} 화상 ${d}`); e.burnTurns-- }
    e.weak = freshWeak.get(e.id) ?? 0
  }
  next.playerWeak = freshWeak.get('player') ?? 0
  p.guard = temp('player').guard
  const tension = Math.max(0, ...next.enemies.map(e => spiderWebTension(e.sim!)))
  p.sealed = p.sealed.slice(0, tension)
  next.totalTurns++; next.log = [situation.text, action.text, ...log]
  if (next.hp <= 0) next.phase = 'lost'
  else if (next.enemies.every(e => e.hp <= 0)) {
    next.phase = 'reward'; p.rewardStep = 'concept'
    // 보상 진열 난수는 런 seed에만 저장하고 미리보기는 입력 상태를 바꾸지 않는다.
    const pool = [...CONCEPTS]
    for (let i = pool.length - 1; i > 0; i--) {
      next.seed = (Math.imul(next.seed, 1664525) + 1013904223) >>> 0
      const j = Math.floor(next.seed / 4294967296 * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]
    }
    next.rewardChoices = pool.slice(0, 3).map(c => c.id)
  }
  return { next, log, attacks, damageEvents, supportEvents, escortAftermath: escortImpacts.slice(escortAftermathStart), reflected, collision, healed, playerDamage: run.hp - next.hp,
    enemyDamage: run.enemies.reduce((n, e) => n + e.hp, 0) - next.enemies.reduce((n, e) => n + e.hp, 0), situation: situation.text, action: action.text }
}
