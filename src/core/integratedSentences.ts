import { INTEGRATED_ROLES, roleKind, type Role, type Lane } from '@data/steering'
import { cardFor, encounterSubjects, effectFor, formFor, merge, slotsFor, type SteeringRun, type CompiledSentence } from './steering'

/** 저장 경계와 순수 해석의 공통 정규형: JSON으로 표현 가능한 런만 사용한다.
 * optional undefined 키는 부재와 동일하다. 값/전투 이벤트를 선택적으로 비교하지 않는다. */
export function normalizeIntegratedRun(run: SteeringRun): SteeringRun { return JSON.parse(JSON.stringify(run)) as SteeringRun }
export const TURN_INK = 2
export function inkSpent(run: SteeringRun): number {
  return Object.values(run.sentences).reduce((n, s) => n + Object.entries(s.edits ?? {}).filter(([r, id]) => r !== s.blank && id !== s.fixed[r as Role]).length, 0)
}
export const inkRemaining = (run: SteeringRun) => TURN_INK - inkSpent(run)
export function slotId(run: SteeringRun, lane: Lane, role: Role): string | null {
  const s = run.sentences[lane]
  return role === s.blank ? s.selected : s.edits?.[role] ?? s.fixed[role] ?? null
}
export function canPlaceIntegratedCard(run: SteeringRun, lane: Lane, role: Role, id: string): boolean {
  if (!run.product || run.phase !== 'battle' || !slotsFor(run.sentences[lane]).includes(role) || run.product.sealed.includes(id)) return false
  const s = run.sentences[lane]
  let card
  try { card = cardFor(run, id) } catch { return false }
  if (card.borrowed ? !['subj', 'obj'].includes(role) : role === 'obj' || !run.hand.includes(id)) return false
  if (card.borrowed && !encounterSubjects(run).some(c => c.id === id)) return false
  return role === s.blank || id === s.fixed[role] || !!s.edits?.[role] || inkRemaining(run) > 0
}
export function placeIntegratedCard(run: SteeringRun, lane: Lane, role: Role, id: string): SteeringRun {
  if (!canPlaceIntegratedCard(run, lane, role, id)) throw new Error('이 칸의 역할·잉크·봉인 조건에 맞는 카드를 선택하세요.')
  const next = normalizeIntegratedRun(run), s = next.sentences[lane]
  // 실체 참조(나/적/모두)는 재사용한다. 공용 손패 개념은 한 수정 칸에만 배치한다.
  if (!cardFor(next, id).borrowed) for (const other of Object.values(next.sentences)) {
    if (other === s && role === other.blank) continue
    if (other.selected === id) other.selected = null
    for (const r of Object.keys(other.edits ?? {}) as Role[]) if (!(other === s && r === role) && other.edits![r] === id) delete other.edits![r]
  }
  if (role === s.blank) s.selected = id
  else { s.edits ??= {}; if (id === s.fixed[role]) delete s.edits[role]; else s.edits[role] = id }
  return next
}
export function resetIntegratedSlot(run: SteeringRun, lane: Lane, role: Role): SteeringRun {
  const next = normalizeIntegratedRun(run), s = next.sentences[lane]
  if (role === s.blank) s.selected = null
  else if (s.edits) delete s.edits[role]
  return next
}
/** 고정 참조는 죽은 상대를 새 상대에게 바꿔 끼우지 않는다. 그룹도 원래 개체를 유지한다. */
export function referencedIds(run: SteeringRun, id: string): string[] {
  if (id === 'self' || id === 'actor:player') return ['player']
  if (id === 'everyone') return ['player', ...run.enemies.map(e => e.id)]
  if (id === 'vanguard') return run.enemies.slice(0, 2).map(e => e.id)
  if (id.startsWith('actor:')) return [id.slice(6)]
  return []
}
export function compileIntegratedSentence(run: SteeringRun, lane: Lane): CompiledSentence | null {
  const s = run.sentences[lane]
  if (!s.selected) return null
  const ids = Object.fromEntries(slotsFor(s).map(r => [r, slotId(run, lane, r)!])) as Record<Role, string>
  const actors = cardFor(run, ids.subj).borrowed ? referencedIds(run, ids.subj) : [s.originActor!]
  const targets = referencedIds(run, ids.obj)
  const phrases = Object.fromEntries(slotsFor(s).map(r => [r, formFor(run, ids[r], r, lane)])) as Record<Role, string>
  const actorEffects = slotsFor(s).filter(r => !['obj', 'verb'].includes(r)).map(r => effectFor(run, ids[r], r))
  const verb = effectFor(run, ids.verb, 'verb')
  const effect = merge([...actorEffects, verb])
  const preparations = [{ recipients: actors, effect: merge(actorEffects) }, { recipients: targets, effect: verb }]
  return { lane, text: slotsFor(s).map(r => phrases[r]).join(' '), phrases, actors, targets, effect,
    preparations, kind: verb.kind ?? 'attack', power: run.power, guardPower: run.product!.player.stats.guard,
    healPower: run.product!.player.stats.heal, hits: effect.hits ?? 1 }
}
export function validIntegratedSentences(run: SteeringRun): boolean {
  if (inkSpent(run) > TURN_INK || inkSpent(run) < 0) return false
  for (const lane of ['situation', 'action'] as Lane[]) {
    const s = run.sentences[lane], slots = slotsFor(s)
    if (!s.originActor || !['player', ...run.enemies.map(e => e.id)].includes(s.originActor)) return false
    if (slots.includes('adv3') || slots.some(r => !INTEGRATED_ROLES.includes(roleKind(r)))) return false
    if (Object.entries(s.edits ?? {}).some(([r, id]) => !slots.includes(r as Role) || r === s.blank || typeof id !== 'string')) return false
    for (const role of slots) {
      const id = slotId(run, lane, role)
      if (!id) { if (role === s.blank) continue; return false }
      const card = cardFor(run, id)
      if (role === 'obj' && !card.borrowed || card.borrowed && !['subj', 'obj'].includes(role)) return false
    }
  }
  return true
}
