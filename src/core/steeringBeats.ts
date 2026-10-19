import type { AttackTrace, DamageEvent, Resolution, EscortImpact } from './steering'

export type CombatBeat = { kind: 'strike'; attack: AttackTrace; ordinal: number; total: number; damage: DamageEvent[] }
  | { kind: 'aftermath'; damage: DamageEvent[]; escorts?: EscortImpact[] }

/** 실제로 실행된 타격만 재생한다. 죽어서 취소된 타격을 연출에서 만들어내지 않는다. */
export function combatBeats(result: Resolution): CombatBeat[] {
  const beats: CombatBeat[] = []
  for (let i = 0; i < result.attacks.length; i++) {
    const attack = result.attacks[i]
    let start = i, end = i
    while (start > 0 && result.attacks[start - 1].source === attack.source) start--
    while (end + 1 < result.attacks.length && result.attacks[end + 1].source === attack.source) end++
    beats.push({ kind: 'strike', attack, ordinal: i - start + 1, total: end - start + 1,
      damage: result.damageEvents.slice(attack.eventStart, attack.eventEnd) })
  }
  const consumed = result.attacks[result.attacks.length - 1]?.eventEnd ?? 0
  const remaining = result.damageEvents.slice(consumed)
  if (remaining.length || result.escortAftermath?.length) beats.push({ kind: 'aftermath', damage: remaining, escorts: result.escortAftermath })
  return beats
}
