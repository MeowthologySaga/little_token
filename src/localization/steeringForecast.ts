import { bridgeState } from '@core/steeringBridge'
import { enemyAttackDamageForRoll, nextEnemyAttackStep } from '@/sim/reference'
import { compileSentence, preparedEffects, targetsFor, effectFor, type CompiledSentence, type Resolution, type SteeringRun } from '@core/steering'
import type { Lane, Role } from '@data/steering'

export const FORECAST = {
  enemy: '적 행동', own: '내 대응', target: '공격 대상', before: '빈칸 적용 전', trial: '카드 미리보기 · 아직 선택하지 않음',
  enemyAttack: '나에게 들어오는 공격', defense: '내가 줄이는 피해', outcome: '이번 턴 최종 결과',
  waiting: '다른 빈칸까지 고르면 실제 피해가 계산됩니다', otherRoles: '다른 위치에서는?',
  inContext: '이 문장에서 실제로 하는 일', equation: '피해 계산 펼치기',
  selection: '두 선택 확정 후 실행', hoverHint: '살펴보는 카드의 결과입니다. 카드를 눌러야 선택됩니다.',
  causes: { attack: '직접 공격', reflect: '반사', thorns: '가시 반격', burn: '화상', collision: '충돌', chain: '연결 피해' },
} as const
export const fighterName = (run: SteeringRun, id: string) => id === 'player' ? '나' : run.enemies.find(e => e.id === id)?.name ?? id

/** 빈칸이 미선택이면 고정 원안만 보여 준다. 임의 후보를 확정한 것처럼 표시하지 않는다. */
export function forecastSentence(run: SteeringRun, lane: Lane): { compiled: CompiledSentence; provisional: boolean } {
  const s = run.sentences[lane], provisional = !s.selected
  const draft = provisional ? { ...run, sentences: { ...run.sentences, [lane]: { ...s, selected: s.fixed[s.blank]! } } } : run
  return { compiled: compileSentence(draft, lane)!, provisional }
}
export function actionLines(run: SteeringRun, sentence: CompiledSentence): string[] {
  if (run.product) {
    const lines: string[] = []
    const names = (ids: string[]) => ids.length > 3 ? `${ids.length}명 (주어/목적어 범위)` : ids.map(id => fighterName(run, id)).join('·')
    for (const source of sentence.actors) {
      const actor = run.enemies.find(e => e.id === source)
      if (source === 'player' ? run.hp <= 0 : !actor || actor.hp <= 0) { lines.push(`${fighterName(run, source)}: 쓰러져 행동 생략`); continue }
      const targets = targetsFor(run, sentence, source)
      if (actor?.sim && (run.turn < actor.sim.nextAttackTurn || actor.sim.def.summonPattern && actor.sim.summonsLeft + actor.sim.summonsRight === 0 && run.turn < actor.sim.summonRespawnTurn)) { lines.push(`${actor.name}: 고유 기믹으로 예정 행동 생략`); continue }
      if (sentence.kind === 'attack' || actor?.sim?.def.boss) {
        const raw = Math.round((actor?.sim ? enemyAttackDamageForRoll(bridgeState(run, [actor]), actor.sim, 1) : run.power) * (sentence.effect.scale ?? 1))
        lines.push(`${fighterName(run, source)} → ${targets.length ? names(targets) : '지정 대상 사망 · 대체 없음'}: 기본 타격 ${raw} × ${sentence.hits}회${actor?.sim?.def.boss ? ' · ' + (nextEnemyAttackStep(actor.sim)?.name ?? '습격') : ''} · 방어/약점 전`)
      }
      for (const prep of sentence.preparations ?? []) {
        const recipients = prep.recipients === sentence.actors ? [source] : prep.recipients
        const p = preparedEffects({ ...sentence, effect: { ...prep.effect, scale: sentence.effect.scale, hits: sentence.hits }, power: actor?.atk ?? run.power,
          guardPower: actor?.atk ?? run.product.player.stats.guard, healPower: actor?.atk ?? run.product.player.stats.heal })
        const bits = [p.guard ? `방어 ${p.guard}` : '', p.reflect ? `타격 ${Math.round(p.reflect * 100)}% 반사` : '', p.dodge ? `${Math.round(p.dodge * 100)}% 회피` : '', p.thorns ? `피격마다 가시 ${p.thorns}` : '', p.heal ? `최대 ${p.heal} 회복` : '', p.burn ? `접촉 화상 ${p.burn}` : '', p.selfBurn ? `화상 ${p.selfBurn} · 3턴` : ''].filter(Boolean)
        if (bits.length) lines.push(`${fighterName(run, source)} → ${names(recipients)}: ${bits.join(' · ')}`)
      }
    }
    return lines.length ? lines : ['지정된 배우/대상이 쓰러져 행동하지 않습니다.']
  }
  const p = preparedEffects(sentence), e = sentence.effect, lines: string[] = []
  const names = sentence.actors.map(id => fighterName(run, id)).join('·')
  if (sentence.kind === 'attack' || sentence.actors.some(id => run.enemies.find(e => e.id === id)?.sim?.def.boss)) {
    for (const id of sentence.actors) {
      const actor = id === 'player' ? null : run.enemies.find(enemy => enemy.id === id)!
      const target = targetsFor(run, sentence, id).map(target => fighterName(run, target)).join('·') || '살아 있는 대상 없음'
      if (actor?.sim && run.turn < actor.sim.nextAttackTurn) { lines.push(`${fighterName(run, id)}: 이번 턴 공격 생략`); continue }
      if (sentence.kind !== 'attack' && !actor?.sim?.def.boss) continue
      const power = Math.max(1, Math.round((actor?.sim ? enemyAttackDamageForRoll(bridgeState(run, [actor]), actor.sim, 1) : actor?.atk ?? run.power) * (e.scale ?? 1)))
      lines.push(`${fighterName(run, id)} → ${target}: ${power} 피해 × ${sentence.hits}회${actor?.sim?.def.boss ? ' · ' + (nextEnemyAttackStep(actor.sim)?.name ?? '습격') : ''}${e.priority === -1 ? ' · 먼저' : e.priority === 2 || e.delay ? ' · 맨 마지막' : ''}`)
    }
  }
  const preparations: string[] = []
  if (p.guard) preparations.push(`피해 ${p.guard}까지 막기`)
  if (p.reflect) preparations.push(`받는 공격 ${Math.round(p.reflect * 100)}% 돌려주기`)
  if (p.dodge) preparations.push(`받는 공격 ${Math.round(p.dodge * 100)}% 피하기`)
  if (p.thorns) preparations.push(`맞을 때마다 ${p.thorns} 반격`)
  if (p.heal) preparations.push(`체력 ${p.heal} 회복`)
  if (p.burn) preparations.push(`공격·접촉한 상대: 3턴간 화상 ${p.burn}씩`)
  if (p.selfBurn) preparations.push(`주의: ${names}에게 3턴간 화상 ${p.selfBurn}씩`)
  if (e.weak) preparations.push(`행동 후 ${names}의 받는 피해 +${Math.round(e.weak * 100)}%`)
  if (e.chain) preparations.push(`공격·반격의 ${Math.round(e.chain * 100)}%를 다른 적에도`)
  if (preparations.length) lines.push(`${names}: ${preparations.join(' · ')}`)
  if (e.collision) lines.push('돌진을 완전히 피하면 다른 적과 충돌 · 상대가 없으면 발생 안 함')
  if (!lines.length) lines.push(`${names}: 이번 턴 대기`)
  return lines
}
export function cardImpactHint(run: SteeringRun, id: string, role: Role, sentence: CompiledSentence): string {
  const e = effectFor(run, id, role), p = preparedEffects(sentence)
  const recipients = run.product && role === 'verb' && sentence.kind !== 'attack' ? sentence.targets ?? [] : sentence.actors
  const who = recipients.map(actor => fighterName(run, actor)).join('·')
  if (run.product && role === 'obj') return `실제 대상: ${sentence.targets?.map(id => fighterName(run, id)).join('·') || '없음'}`
  if (e.scale && e.scale !== 1) return `행동 위력 ×${e.scale.toFixed(2)}${sentence.kind === 'attack' ? ' · ' + (actionLines(run, sentence)[0] ?? '행동 대상 없음').replace(/^[^:]+: /, '') : ''}`
  if (e.priority !== undefined) return e.priority < 0 ? '기본 적보다 먼저 행동' : e.priority > 1 ? '맨 마지막에 행동' : '일반 순서에 행동'
  if (run.product) {
    const lines = actionLines(run, sentence)
    const keyword = e.reflect ? '반사' : e.dodge ? '회피' : e.thorns ? '가시' : e.burn ? '화상' : e.guard ? '방어' : e.heal ? '회복' : ''
    return keyword ? lines.find(line => line.includes(keyword)) ?? lines[0] : lines[0]
  }
  if (e.kind === 'ignite') return `주의: ${who}에게 화상 ${p.selfBurn}씩`
  if (e.reflect) return `${who}: 공격 ${Math.round(p.reflect * 100)}% 반사`
  if (e.dodge) return `${who}: 공격 ${Math.round(p.dodge * 100)}% 회피`
  if (e.thorns) return `${who}: 맞을 때마다 ${p.thorns} 반격`
  if (e.burn) return `공격·접촉한 상대 화상 ${p.burn}씩`
  if (e.guard) return `${who}: 피해 ${p.guard}까지 방어`
  if (e.heal) return `${who}: 체력 ${p.heal} 회복`
  if (e.chain) return `다른 적에게도 ${Math.round(e.chain * 100)}% 피해`
  if (sentence.kind !== 'attack') return p.guard ? `방어 ${p.guard}` : p.reflect ? `반사 ${Math.round(p.reflect * 100)}%` : p.heal ? `회복 ${p.heal}` : '공격 위력 변화 없음 · 다른 위치 효과 참조'
  return (actionLines(run, sentence)[0] ?? '행동 대상 없음').replace(/^[^:]+: /, '')
}
export function outcomeFacts(run: SteeringRun, result: Resolution) {
  const incoming = result.attacks.filter(a => a.target === 'player')
  const sum = (key: 'incoming' | 'dodged' | 'reflected' | 'blocked' | 'healthDamage') => incoming.reduce((s, a) => s + a[key], 0)
  const causeTotals = Object.entries(FORECAST.causes).flatMap(([cause, label]) => {
    const value = result.damageEvents.filter(event => event.target !== 'player' && event.cause === cause).reduce((s, event) => s + event.amount, 0)
    return value ? [`${label} ${value}`] : []
  })
  const playerBurn = result.damageEvents.filter(event => event.target === 'player' && event.cause === 'burn').reduce((s, e) => s + e.amount, 0)
  return { incoming: sum('incoming'), avoided: sum('dodged'), returned: sum('reflected'), blocked: sum('blocked'),
    directHealthLoss: sum('healthDamage'), playerBurn, causeTotals,
    playerHp: `내 체력 ${run.hp} → ${result.next.hp}`,
    enemyHp: run.enemies.map(enemy => `${enemy.name} ${enemy.hp} → ${result.next.enemies.find(e => e.id === enemy.id)!.hp}`),
  }
}
