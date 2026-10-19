import { compileIntegratedSentence, placeIntegratedCard, canPlaceIntegratedCard, normalizeIntegratedRun, slotId, referencedIds } from './integratedSentences'
import { resolveIntegratedTurn } from './integratedCombat'
import { newProduct, integratedEncounter, beginIntegratedTurn, prepareIntegratedItems, INTEGRATED_SAVE_KEY, validateProduct, type IntegratedState } from './steeringBridge'
import { spiderWebTension, type EnemyInst } from '@/sim/reference'
import { josa } from './josa'
import { ST_INTEGRATED } from '@/localization/steeringIntegrated'
import { CONCEPTS, CONCEPT_BY_ID, STARTER_CONCEPTS, BASE_ROLES, SLOT_ROLES, ROLE_LABELS, STEERING_RULES as R,
  encounterFor, type Concept, type Effect, type Lane, type Role, type BaseRole, type ActionKind } from '@data/steering'

export interface Fighter {
  sim?: EnemyInst; id: string; name: string; visual: string; hp: number; maxHp: number; atk: number
  burn: number; burnTurns: number; weak: number
}
export interface Sentence {
  originActor?: string; edits?: Partial<Record<Role, string>>; lane: Lane; blank: Role; slots?: Role[]; fixed: Record<BaseRole, string> & Partial<Record<Role, string>>; choices: string[]; selected: string | null
}
export const slotsFor = (s: Sentence): Role[] => s.slots ?? BASE_ROLES
export interface SteeringRun {
  product?: IntegratedState; schema: 1; seed: number; floor: number; turn: number; hp: number; maxHp: number; power: number
  playerBurn: number; playerBurnTurns: number; playerWeak: number
  deck: string[]; hand: string[]; levels: Record<string, number>; enemies: Fighter[]; sentences: Record<Lane, Sentence>
  redraws: number; phase: 'battle' | 'reward' | 'won' | 'lost'; rewardChoices: string[]
  log: string[]; totalTurns: number
}
export interface CompiledSentence {
  preparations?: { recipients: string[]; effect: Effect }[]; targets?: string[]; text: string; phrases: Record<Role, string>; actors: string[]; kind: ActionKind
  effect: Effect; power: number; guardPower?: number; healPower?: number; hits: number; lane: Lane
}
export interface SupportEvent { source: string; target: string; kind: 'heal' | 'guard' | 'reflect' | 'dodge' | 'burn'; amount: number }
export interface EscortImpact { target: string; boss: string; side: 'left' | 'right'; slot: number; hp: number; maxHp: number; amount: number }
export interface Resolution {
  supportEvents?: SupportEvent[]; escortAftermath?: EscortImpact[]
  next: SteeringRun; log: string[]; playerDamage: number; enemyDamage: number
  reflected: number; collision: number; healed: number; situation: string; action: string
  attacks: AttackTrace[]; damageEvents: DamageEvent[]
}
export interface AttackTrace {
  planIndex?: number;
  escorts?: EscortImpact[]; healing?: { target: string; amount: number }[]
  animationStage?: 1 | 2 | 3; source: string; target: string; incoming: number; dodged: number
  reflected: number; blocked: number; healthDamage: number
  eventStart: number; eventEnd: number
}
export interface DamageEvent {
  target: string; amount: number; cause: 'attack' | 'reflect' | 'thorns' | 'burn' | 'collision' | 'chain'
}
/** 표시와 실행에서 함께 쓰는, 합성/반올림이 끝난 준비 효과. */
export function preparedEffects(sentence: CompiledSentence) {
  const e = sentence.effect, potency = (e.scale ?? 1) * sentence.hits
  return {
    guard: round((sentence.guardPower ?? sentence.power) * (e.guard ?? 0) * potency), reflect: Math.min(2, (e.reflect ?? 0) * potency),
    dodge: Math.min(1, (e.dodge ?? 0) * potency), thorns: round((e.thorns ?? 0) * potency),
    burn: e.kind === 'ignite' ? 0 : round((e.burn ?? 0) * potency), chain: e.chain ?? 0,
    heal: round((sentence.healPower ?? sentence.power) * (e.heal ?? 0) * potency),
    selfBurn: e.kind === 'ignite' ? round((e.burn ?? 0) * potency) : 0,
  }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const round = (n: number) => Math.max(0, Math.round(n))
function random(run: SteeringRun): number {
  run.seed = (Math.imul(run.seed, 1664525) + 1013904223) >>> 0
  return run.seed / 4294967296
}
function shuffled<T>(run: SteeringRun, values: T[]): T[] {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random(run) * (i + 1)); [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
export function encounterSubjects(run: SteeringRun): Concept[] {
  const emptyForms = { obj: '', adv: '', adv2: '', adv3: '', verb: '' }
  const emptyEffects = { obj: {}, subj: {}, adv: {}, adv2: {}, adv3: {}, verb: {} }
  const subjects: Concept[] = run.enemies.filter(e => e.hp > 0).map(enemy => ({
    id: `actor:${enemy.id}`, name: enemy.name, glyph: '♟', art: '', color: '#b36c53',
    forms: { ...emptyForms, subj: josa(enemy.name, '은', '는'), obj: josa(enemy.name, '을', '를') }, effects: { ...emptyEffects },
    actor: 'encounter', borrowed: true,
  }))
  if (subjects.length > 1) subjects.push({ id: 'vanguard', name: run.product ? '첫 두 벌레' : '선봉대', glyph: '♟♟', art: '', color: '#ab7551',
    forms: { ...emptyForms, subj: run.product ? '첫 두 벌레는' : '선봉대는', obj: '첫 두 벌레를' }, effects: { ...emptyEffects }, actor: 'vanguard', borrowed: true })
  subjects.push({ id: 'everyone', name: '모두', glyph: '☷', art: '', color: '#8b739b',
    forms: { ...emptyForms, subj: '모두는', obj: '모두를' }, effects: { ...emptyEffects }, actor: 'all', borrowed: true })
  if (run.product) subjects.push({ id: 'actor:player', name: '프롬', glyph: '✎', art: '', color: '#398f99', forms: { ...emptyForms, subj: '프롬은', obj: '프롬을' }, effects: { ...emptyEffects }, actor: 'player', borrowed: true })
  return subjects
}
export function cardFor(run: SteeringRun, id: string): Concept {
  // 보상/결과 저장에서도 쓰러진 적의 조우 카드 설명을 읽을 수 있어야 한다.
  const catalog = { ...run, enemies: run.enemies.map(e => ({ ...e, hp: Math.max(1, e.hp) })) }
  const card = CONCEPT_BY_ID[id] ?? encounterSubjects(catalog).find(c => c.id === id)
  if (!card) throw new Error(`알 수 없는 개념 카드: ${id}`)
  return card
}
export function effectFor(run: SteeringRun, id: string, role: Role): Effect {
  const effect = { ...cardFor(run, id).effects[role] }
  const growth = 1 + (run.levels[id] ?? 0) * R.reinforcement
  for (const key of ['guard', 'heal', 'burn', 'thorns'] as const) if (effect[key]) effect[key]! *= growth
  // 약화의 반복 강화는 감쇠를 키운다. 메아리 등 다른 카드의 성장 규칙은 유지한다.
  if (effect.scale) effect.scale *= id === 'weaken' ? 1 / growth : growth
  if (effect.reflect) effect.reflect = Math.min(2, effect.reflect * growth)
  if (effect.dodge) effect.dodge = Math.min(1, effect.dodge * growth)
  if (effect.chain) effect.chain = Math.min(1, effect.chain * growth)
  if (effect.collision) effect.collision *= growth
  return effect
}
export function formFor(run: SteeringRun, id: string, role: Role, lane: Lane): string {
  if (id === 'self') return run.product ? (role === 'obj' ? '프롬을' : '프롬은') : '나는'
  const card = cardFor(run, id)
  if (run.product && role === 'subj' && !card.borrowed) {
    const actor = run.sentences[lane]?.originActor
    const name = actor === 'player' ? '프롬' : run.enemies.find(e => e.id === actor)?.name ?? '원안 배우'
    return `${ST_INTEGRATED.subjectTraits[id] ?? card.name} ${josa(name, '은', '는')}`
  }
  if (run.product && role === 'verb') {
    const verbs: Record<string, string> = { mirror: '반사막으로 감쌌다', wind: '피하게 했다', thorn: '가시막으로 지켰다', calm: '지켰다', rest: '회복시켰다', fire: '불태웠다' }
    if (verbs[id]) return verbs[id]
  }
  const form = card.forms[role]
  if (role === 'subj' && lane === 'situation' && form.includes('내가')) {
    const actor = run.enemies.find(enemy => enemy.hp > 0) ?? run.enemies[0]
    return form.replace('내가', josa(actor.name, '이', '가'))
  }
  return form
}
export function describeEffect(run: SteeringRun, id: string, role: Role, lane: Lane = 'action'): string {
  const card = cardFor(run, id)
  if (role === 'obj' && !card.borrowed) return '대상은 프롬·적·모두 카드로 지정 · 개념 카드는 배치 불가'
  if (card.borrowed && run.product && !['subj', 'obj'].includes(role)) return '실체 참조는 주어·목적어로만 사용합니다.'
  if (card.borrowed && run.product) return card.actor === 'player' ? role === 'obj' ? '실제 대상: 프롬' : '실제 행동자: 프롬' : card.actor === 'all' ? '범위: 프롬과 살아 있는 모든 적 · 아군 포함' : card.actor === 'vanguard' ? `범위: ${run.enemies.slice(0, 2).map(e => e.name).join('·')} · 죽은 개체를 다른 적으로 대체하지 않음` : `${role === 'obj' ? '실제 대상' : '실제 행동자'}: ${card.name}`
  if (card.borrowed) return card.actor === 'all' ? '나와 살아 있는 모든 적이 행동 · 아군 포함'
    : card.actor === 'vanguard' ? '앞줄의 살아 있는 적 최대 2명이 행동' : `${card.name}의 행동을 유도`
  const e = effectFor(run, id, role), bits: string[] = []
  const recipient = run.product ? role === 'verb' ? '목적어 대상' : '행동자' : '행동 주체'
  const amountFor = (coefficient: number, stat: 'guard' | 'heal'): string => {
    if (!run.product) return String(round(run.power * coefficient))
    const s = run.sentences[lane], subject = role === 'subj' ? id : slotId(run, lane, 'subj') ?? s.fixed.subj
    const actors = cardFor(run, subject).borrowed ? referencedIds(run, subject) : [s.originActor!]
    const values = [...new Set(actors.map(actor => round((actor === 'player' ? run.product!.player.stats[stat] : run.enemies.find(e => e.id === actor)!.atk) * coefficient)))].sort((a, b) => a - b)
    return values.length > 1 ? `${values[0]}~${values[values.length - 1]} (배우별)` : String(values[0] ?? 0)
  }
  if (e.target) bits.push('지정된 대상 공격 · 해당 대상이 없으면 선두 상대')
  if (e.priority !== undefined) bits.push(e.priority < 0 ? '기본 적 공격보다 먼저 행동' : e.priority > 1 ? '일반 행동이 끝난 뒤 행동' : '일반 순서로 행동')
  if (e.scale) bits.push(`행동 위력 ×${e.scale.toFixed(2)}`)
  if (e.hits && e.hits > 1) bits.push(`${e.hits}회 행동 · 준비 효과 합산`)
  if (e.reflect) bits.push(`${run.product ? recipient + ": " : ""}타격 ${Math.round(e.reflect * 100)}% 반사·최대 100% 상쇄`)
  if (e.dodge) bits.push(`${run.product ? recipient + ": " : ""}타격 ${Math.round(e.dodge * 100)}% 회피`)
  if (e.guard) bits.push(`${recipient}에게 방어 ${amountFor(e.guard, 'guard')}`)
  if (e.heal) bits.push(`${recipient} 회복 ${amountFor(e.heal, 'heal')}`)
  if (e.thorns) bits.push(`${run.product ? recipient + ": " : ""}피격마다 가시 ${round(e.thorns)}`)
  if (e.burn) bits.push(e.kind === 'ignite' ? `${recipient}에게 화상 ${round(e.burn)} · 3턴`
    : `공격/접촉 상대에게 화상 ${round(e.burn)} · 3턴`)
  if (e.weak) bits.push(`행동 후 주체의 받는 타격 +${Math.round(e.weak * 100)}% · 다음 턴까지`)
  if (e.collision) bits.push(`돌진을 완전 회피당하면 다른 적과 충돌 ×${e.collision}`)
  if (e.chain) bits.push(`타격의 ${Math.round(e.chain * 100)}%를 ${run.product ? '지정 대상과 같은 편의 다른 개체에게 연결 · 행동자 제외' : '다른 상대 모두에게 연결'}`)
  if (e.delay) bits.push('가장 늦게 행동')
  if (card.note) bits.push(card.note)
  return bits.join(' · ') || ROLE_LABELS[role]
}
const defaultSubject = (run: SteeringRun) => `actor:${run.enemies.find(e => e.hp > 0)!.id}`
function makeSentence(run: SteeringRun, lane: Lane): Sentence {
  const length = 3 + Math.floor(random(run) * 3)
  if (run.product) {
    const slots: Role[] = ['subj', ...(['adv', 'adv2'] as Role[]).slice(0, length - 3), 'obj', 'verb']
    const actor = lane === 'situation' ? run.enemies.filter(e => e.hp > 0)[Math.floor(random(run) * run.enemies.filter(e => e.hp > 0).length)].id : 'player'
    const target = actor === 'player' ? run.enemies.filter(e => e.hp > 0)[Math.floor(random(run) * run.enemies.filter(e => e.hp > 0).length)].id : 'player'
    const modifiers = shuffled(run, run.deck)
    return { lane, originActor: actor, edits: {}, blank: slots[Math.floor(random(run) * slots.length)], slots, selected: null, choices: [],
      fixed: { subj: `actor:${actor}`, obj: `actor:${target}`, adv: modifiers[0], adv2: modifiers[1], verb: shuffled(run, ['force', 'rush', 'mirror', 'rest'])[0] } }
  }
  const slots: Role[] = ['subj', ...(['adv', 'adv2', 'adv3'] as Role[]).slice(0, length - 2), 'verb']
  const blank = slots[Math.floor(random(run) * slots.length)]
  // 늘어나는 칸도 모두 같은 수식 규칙. 같은 개념의 고정 수식은 중복하지 않는다.
  const modifiers = shuffled(run, run.deck)
  const fixed = { subj: lane === 'situation' ? defaultSubject(run) : 'self',
    adv: modifiers[0], adv2: modifiers[1], adv3: modifiers[2],
    verb: shuffled(run, lane === 'situation' ? ['force', 'rush', 'echo'] : ['force', 'mirror', 'wind', 'thorn', 'rest'])[0] }
  const sentence: Sentence = { lane, blank, slots, fixed, choices: [], selected: null }
  return sentence
}
function dealHand(run: SteeringRun, previous: string[] = []): void {
  const held = [...new Set(Object.values(run.sentences).flatMap(s => [...(s.selected ? [s.selected] : []), ...Object.values(s.edits ?? {})]))]
  const borrowed = run.product ? encounterSubjects(run).map(c => c.id) : Object.values(run.sentences).some(s => s.blank === 'subj') ? encounterSubjects(run).map(c => c.id) : []
  const pool = [...run.deck, ...borrowed]
  const available = pool.filter(id => !held.includes(id))
  const ordered = [...shuffled(run, available.filter(id => !previous.includes(id))), ...shuffled(run, available.filter(id => previous.includes(id)))]
  run.hand = [...held, ...new Set(ordered)].slice(0, R.hand)
  if (run.product) {
    const refs = ['actor:player', `actor:${run.enemies.find(e => e.hp > 0)!.id}`]
    const concepts = [...held.filter(id => !borrowed.includes(id)), ...ordered.filter(id => !borrowed.includes(id))]
    run.hand = [...new Set([...refs, ...concepts])].slice(0, R.hand)
  }
  if (borrowed.length && !run.hand.some(id => borrowed.includes(id))) {
    const guaranteed = shuffled(run, borrowed)[0]
    run.hand[run.hand.length - 1] = guaranteed
  }
  if (run.product) {
    const tension = Math.max(0, ...run.enemies.filter(e => e.sim).map(e => spiderWebTension(e.sim!)))
    const requiredConcepts = Object.values(run.sentences).filter(s => ['adv', 'adv2', 'verb'].includes(s.blank)).length
    const availableConcepts = run.hand.filter(id => !cardFor(run, id).borrowed && !held.includes(id))
    run.product.sealed = shuffled(run, availableConcepts).slice(0, Math.min(3, tension, Math.max(0, availableConcepts.length - requiredConcepts)))
  }
  for (const sentence of Object.values(run.sentences)) sentence.choices = [...run.hand]
}
function enterFloor(run: SteeringRun): void {
  run.turn = 1; run.redraws = R.redraws; run.phase = 'battle'; run.rewardChoices = []
  run.enemies = run.product ? integratedEncounter(run) : encounterFor(run.floor).map((enemy, i) => ({ ...enemy, id: `${enemy.id}-${i}`, maxHp: enemy.hp, burn: 0, burnTurns: 0, weak: 0 }))
  beginIntegratedTurn(run)
  run.playerBurn = 0; run.playerBurnTurns = 0; run.playerWeak = 0
  run.sentences = { situation: makeSentence(run, 'situation'), action: makeSentence(run, 'action') }
  dealHand(run)
}
export function createSteeringRun(seed = Date.now() >>> 0, integrated = false): SteeringRun {
  const run: SteeringRun = { schema: 1, seed, floor: 1, turn: 1, hp: R.maxHp, maxHp: R.maxHp, power: R.power,
    playerBurn: 0, playerBurnTurns: 0, playerWeak: 0, deck: [...STARTER_CONCEPTS], hand: [], levels: {}, enemies: [],
    sentences: {} as Record<Lane, Sentence>, redraws: R.redraws, phase: 'battle', rewardChoices: [], log: [], totalTurns: 0 }
  if (integrated) { run.product = newProduct(); run.hp = run.maxHp = run.product.player.stats.hp; run.power = run.product.player.stats.atk }
  enterFloor(run); return run.product ? normalizeIntegratedRun(run) : run
}
export function chooseCard(run: SteeringRun, lane: Lane, id: string, role: Role = run.sentences[lane].blank): SteeringRun {
  if (run.product) return placeIntegratedCard(run, lane, role, id)
  if (!canPlaceCard(run, lane, id)) throw new Error('조우 카드는 주어 빈칸에, 개념 카드는 어느 빈칸에나 놓을 수 있어요.')
  const next = clone(run), other = lane === 'situation' ? 'action' : 'situation'
  if (next.sentences[other].selected === id) next.sentences[other].selected = null
  next.sentences[lane].selected = id; return next
}
export function canPlaceCard(run: SteeringRun, lane: Lane, id: string, role: Role = run.sentences[lane].blank): boolean {
  if (run.product) return canPlaceIntegratedCard(run, lane, role, id)
  if (run.phase !== 'battle' || !run.hand.includes(id)) return false
  return !cardFor(run, id).borrowed || run.sentences[lane].blank === 'subj'
}
export function redraw(run: SteeringRun, _lane?: Lane): SteeringRun {
  if (run.phase !== 'battle' || run.redraws <= 0) return run
  const next = clone(run); next.redraws--; dealHand(next, next.hand); return next
}
export function merge(effects: Effect[]): Effect {
  const out: Effect = { scale: 1, hits: 1 }
  for (const e of effects) {
    if (e.kind) out.kind = e.kind
    if (e.target) out.target = e.target
    if (e.priority !== undefined) out.priority = e.priority
    out.scale! *= e.scale ?? 1
    out.hits = Math.max(out.hits!, e.hits ?? 1)
    for (const key of ['reflect', 'guard', 'heal', 'thorns', 'burn', 'weak', 'collision', 'dodge'] as const) out[key] = (out[key] ?? 0) + (e[key] ?? 0)
    out.chain = Math.min(1, (out.chain ?? 0) + (e.chain ?? 0)); out.delay ||= e.delay
  }
  out.dodge = Math.min(1, out.dodge ?? 0); out.reflect = Math.min(2, out.reflect ?? 0)
  return out
}
export function compileSentence(run: SteeringRun, lane: Lane): CompiledSentence | null {
  const sentence = run.sentences[lane]
  if (run.product) return compileIntegratedSentence(run, lane)
  if (!sentence.selected) return null
  const ids = { ...sentence.fixed, [sentence.blank]: sentence.selected }
  const subject = ids.subj
  const actors = subject === 'everyone' ? ['player', ...run.enemies.filter(e => e.hp > 0).map(e => e.id)]
    : subject === 'vanguard' ? run.enemies.filter(e => e.hp > 0).slice(0, 2).map(e => e.id)
      : subject.startsWith('actor:') ? [subject.slice(6)]
        : [lane === 'situation' ? run.enemies.find(e => e.hp > 0)!.id : 'player']
  const slots = slotsFor(sentence)
  const phrases = Object.fromEntries(slots.map(role => [role, formFor(run, ids[role]!, role, lane)])) as Record<Role, string>
  const effects = slots.map(role => ids[role] === 'self' ? {} : effectFor(run, ids[role]!, role))
  const effect = merge(effects)

  return { lane, text: slots.map(role => phrases[role]).join(' '), phrases, actors,
    kind: effect.kind ?? 'attack', effect, power: run.power, hits: effect.hits ?? 1 }
}
export function sentencePhrases(run: SteeringRun, lane: Lane): Record<Role, string> {
  const sentence = run.sentences[lane]
  return Object.fromEntries(slotsFor(sentence).map(role => {
    if (role === sentence.blank && !sentence.selected) return [role, '[ 빈칸 ]']
    const id = role === sentence.blank ? sentence.selected! : sentence.edits?.[role] ?? sentence.fixed[role]!
    return [role, formFor(run, id, role, lane)]
  })) as Record<Role, string>
}
export function targetsFor(run: SteeringRun, sentence: CompiledSentence, source: string, lastAttacker?: string): string[] {
  if (run.product && sentence.targets) return sentence.targets.filter(id => id === 'player' ? run.hp > 0 : run.enemies.some(e => e.id === id && e.hp > 0))
  const mode = sentence.effect.target
  const opponents = source === 'player' ? run.enemies.filter(e => e.hp > 0).map(e => e.id) : run.hp > 0 ? ['player'] : []
  const alive = (id: string) => id === 'player' ? run.hp > 0 : run.enemies.some(e => e.id === id && e.hp > 0)
  if (mode === 'self') return alive(source) ? [source] : []
  if (mode === 'all') return [...(run.hp > 0 ? ['player'] : []), ...run.enemies.filter(e => e.hp > 0).map(e => e.id)]
  if (mode === 'vanguard') return run.enemies.filter(e => e.hp > 0).slice(0, 2).map(e => e.id)
  if (mode && run.enemies.some(e => e.id === mode)) return alive(mode) ? [mode] : []
  if (mode === 'opponents') return opponents
  if (mode === 'last' && lastAttacker && alive(lastAttacker)) return [lastAttacker]
  if (mode === 'back') return opponents.slice(-1)
  if (mode === 'burning') {
    const burning = opponents.find(id => id === 'player' ? run.playerBurnTurns > 0 : run.enemies.find(e => e.id === id)!.burnTurns > 0)
    return burning ? [burning] : opponents.slice(0, 1)
  }
  const stat = (id: string, kind: 'atk' | 'hp') => id === 'player' ? kind === 'atk' ? run.power : run.hp : run.enemies.find(e => e.id === id)![kind]
  if (['strongest', 'weakest', 'healthiest'].includes(mode ?? '')) {
    return [...opponents].sort((a, b) => mode === 'weakest' ? stat(a, 'atk') - stat(b, 'atk') : stat(b, mode === 'healthiest' ? 'hp' : 'atk') - stat(a, mode === 'healthiest' ? 'hp' : 'atk')).slice(0, 1)
  }
  return opponents.slice(0, 1)
}

/** 순수한 전투 해석. 미리보기와 실행이 이 함수를 공유하며 RNG를 사용하지 않는다. */
export function resolveTurn(run: SteeringRun): Resolution {
  if (run.product) return resolveIntegratedTurn(run)
  if (run.phase !== 'battle') throw new Error('전투 중이 아닙니다.')
  const situation = compileSentence(run, 'situation'), action = compileSentence(run, 'action')
  if (!situation || !action) throw new Error('두 문장의 빈칸을 채워 주세요.')
  const next = clone(run), log: string[] = []
  const attacks: AttackTrace[] = [], damageEvents: DamageEvent[] = []
  const lastAttackers = new Map<string, string>()
  let reflected = 0, collision = 0, healed = 0
  const playerBefore = next.hp, enemiesBefore = next.enemies.reduce((s, e) => s + e.hp, 0)
  interface Temp { guard: number; reflect: number; dodge: number; thorns: number; burn: number; chain: number }
  const temps = new Map<string, Temp>()
  const active = (id: string) => id === 'player' ? next.hp > 0 : !!next.enemies.find(e => e.id === id && e.hp > 0)
  const enemy = (id: string) => next.enemies.find(e => e.id === id)!
  const name = (id: string) => id === 'player' ? '프롬' : enemy(id).name
  const temp = (id: string): Temp => {
    if (!temps.has(id)) temps.set(id, { guard: 0, reflect: 0, dodge: 0, thorns: 0, burn: 0, chain: 0 })
    return temps.get(id)!
  }
  const rawDamage = (id: string, value: number, cause: DamageEvent['cause'] = 'attack'): number => {
    const before = id === 'player' ? next.hp : enemy(id).hp
    const damage = Math.min(before, round(value))
    if (id === 'player') next.hp -= damage; else enemy(id).hp -= damage
    if (damage) damageEvents.push({ target: id, amount: damage, cause })
    return damage
  }
  const heal = (id: string, value: number) => {
    const amount = id === 'player' ? Math.min(next.maxHp - next.hp, round(value)) : Math.min(enemy(id).maxHp - enemy(id).hp, round(value))
    if (id === 'player') { next.hp += amount; healed += amount } else { enemy(id).hp += amount; if (enemy(id).sim) enemy(id).sim!.hp = enemy(id).hp }
    if (amount) log.push(`${name(id)} 회복 +${amount}`)
  }
  const burn = (id: string, value: number) => {
    if (id === 'player') { next.playerBurn = Math.max(next.playerBurn, round(value)); next.playerBurnTurns = R.burnTurns }
    else { enemy(id).burn = Math.max(enemy(id).burn, round(value)); enemy(id).burnTurns = R.burnTurns }
  }
  // 두 문장의 방어/반격은 공격보다 먼저 준비한다. 죽은 배우는 이후 행동하지 않는다.
  for (const sentence of [situation, action]) for (const id of sentence.actors) {
    if (!active(id)) continue
    const p = preparedEffects(sentence), t = temp(id)
    t.guard += p.guard; t.reflect = Math.min(2, t.reflect + p.reflect)
    t.dodge = Math.min(1, t.dodge + p.dodge); t.thorns += p.thorns
    t.burn = Math.max(t.burn, p.burn); t.chain = Math.max(t.chain, p.chain)
    if (p.heal) heal(id, p.heal)
  }
  const hit = (source: string, target: string, value: number, e: Effect, attackBurn: number) => {
    if (!active(source) || !active(target)) return
    lastAttackers.set(target, source)
    const eventStart = damageEvents.length
    const t = temp(target), weak = target === 'player' ? next.playerWeak : enemy(target).weak
    let incoming = round(value * (1 + weak))
    const original = incoming
    const dodged = round(incoming * t.dodge); incoming -= dodged
    if (dodged) log.push(`${name(target)} 회피 ${dodged}`)
    if (!incoming && (e.collision ?? 0) > 0 && source !== 'player') {
      const other = next.enemies.find(other => other.id !== source && other.hp > 0)
      if (other) { const damage = rawDamage(other.id, value * e.collision!, 'collision'); collision += damage; log.push(`${name(source)}의 돌진이 ${other.name}에 충돌! ${damage} 피해`) }
    }
    const back = round(incoming * t.reflect)
    if (back) {
      const damage = rawDamage(source, back, 'reflect'); reflected += damage; log.push(`${name(target)} → ${name(source)} 반사 ${damage}`)
      if (t.chain && target === 'player') for (const other of next.enemies.filter(other => other.id !== source && other.hp > 0)) {
        const chained = rawDamage(other.id, damage * t.chain, 'chain'); log.push(`${other.name} 반사 연결 ${chained}`)
      }
    }
    incoming = Math.max(0, incoming - Math.min(incoming, back))
    const blocked = Math.min(t.guard, incoming); t.guard -= blocked; incoming -= blocked
    if (blocked) log.push(`${name(target)} 방어 ${blocked}`)
    const damage = rawDamage(target, incoming)
    if (damage) log.push(`${name(source)} → ${name(target)} 타격 ${damage}`)
    if (dodged < round(value * (1 + weak)) && t.thorns && active(source)) {
      const prick = rawDamage(source, t.thorns, 'thorns'); log.push(`${name(target)} 가시 반격 ${prick}`)
      if (t.chain && target === 'player') for (const other of next.enemies.filter(other => other.id !== source && other.hp > 0)) {
        const chained = rawDamage(other.id, prick * t.chain, 'chain'); log.push(`${other.name} 가시 연결 ${chained}`)
      }
    }
    if (t.burn && active(source) && dodged < round(value * (1 + weak))) { burn(source, t.burn); log.push(`${name(source)} 접촉 화상 ${t.burn} · 3턴`) }
    if (attackBurn && active(target) && dodged < round(value * (1 + weak))) { burn(target, attackBurn); log.push(`${name(target)} 화상 ${attackBurn} · 3턴`) }
    if (e.chain && damage && source === 'player') {
      for (const other of next.enemies.filter(other => other.id !== target && other.hp > 0)) {
        const chain = rawDamage(other.id, damage * e.chain, 'chain'); log.push(`${other.name} 연결 피해 ${chain}`)
      }
    }
    attacks.push({ source, target, incoming: original, dodged, reflected: Math.min(original - dodged, back), blocked,
      healthDamage: damage, eventStart, eventEnd: damageEvents.length })
  }
  // 상황에 선택되지 않은 적도 기본 공격한다. 특정 주어가 다른 적을 공짜로 정지시키지 않는다.
  const scheduled = new Set(situation.actors)
  const fallback: CompiledSentence[] = next.enemies.filter(e => e.hp > 0 && !scheduled.has(e.id)).map(e => ({
    lane: 'situation', text: `${e.name} 기본 공격`, phrases: situation.phrases, actors: [e.id], kind: 'attack', effect: {}, power: e.atk, hits: 1,
  }))
  const jobs = [situation, ...fallback, action].flatMap(sentence => sentence.actors.map(id => ({ sentence, id })))
  jobs.sort((a, b) => {
    const speed = (job: typeof a) => job.sentence.effect.priority ?? (job.sentence.effect.delay ? 2 : job.sentence.lane === 'action' ? 1 : 0)
    return speed(a) - speed(b)
  })
  const newWeak = new Map<string, number>()
  for (const { sentence, id } of jobs) {
    if (!active(id)) continue
    const e = sentence.effect
    const prepared = preparedEffects(sentence)
    if (sentence.kind === 'ignite') { burn(id, prepared.selfBurn); log.push(`${name(id)} 스스로 불타올랐다!`) }
    if (sentence.kind === 'attack') {
      const power = id === 'player' ? next.power : enemy(id).atk
      for (let i = 0; i < sentence.hits && active(id); i++) {
        for (const target of targetsFor(next, sentence, id, lastAttackers.get(id))) {
          // 접촉/표시와 같은 문장 단위 화상. 연타마다 더하지 않고 기존 최댓값 규칙으로 갱신한다.
          if (active(id)) hit(id, target, Math.max(1, power * (e.scale ?? 1)), e, prepared.burn)
        }
      }
    }
    if (e.weak) {
      newWeak.set(id, e.weak)
      if (id === 'player') next.playerWeak = e.weak; else enemy(id).weak = e.weak
    }
  }
  if (next.playerBurnTurns > 0 && next.hp > 0) { const damage = rawDamage('player', next.playerBurn, 'burn'); log.push(`프롬 화상 피해 ${damage}`); next.playerBurnTurns-- }
  for (const enemy of next.enemies) {
    if (enemy.burnTurns > 0 && enemy.hp > 0) { const damage = rawDamage(enemy.id, enemy.burn, 'burn'); log.push(`${enemy.name} 화상 피해 ${damage}`); enemy.burnTurns-- }
    enemy.weak = newWeak.get(enemy.id) ?? 0
  }
  next.playerWeak = newWeak.get('player') ?? 0
  next.totalTurns++; next.log = [situation.text, action.text, ...log]
  if (next.hp <= 0) next.phase = 'lost'
  else if (next.enemies.every(e => e.hp <= 0)) {
    next.phase = next.floor === R.floors ? 'won' : 'reward'
    if (next.phase === 'reward') next.rewardChoices = shuffled(next, CONCEPTS.map(c => c.id)).slice(0, 3)
  }
  return { next, log, attacks, damageEvents, reflected, collision, healed, playerDamage: playerBefore - next.hp,
    enemyDamage: enemiesBefore - next.enemies.reduce((s, e) => s + e.hp, 0), situation: situation.text, action: action.text }
}
export function advanceTurn(run: SteeringRun): SteeringRun {
  if (run.phase !== 'battle') return run
  const next = clone(run); next.turn++
  beginIntegratedTurn(next)
  next.sentences = { situation: makeSentence(next, 'situation'), action: makeSentence(next, 'action') }
  dealHand(next)
  return next
}
export function takeReward(run: SteeringRun, id: string): SteeringRun {
  if (run.phase !== 'reward' || !run.rewardChoices.includes(id)) throw new Error('현재 보상에서 골라 주세요.')
  const next = clone(run)
  if (next.product && next.product.rewardStep !== 'concept') throw new Error('개념 보상을 이미 받았습니다.')
  if (next.deck.includes(id)) next.levels[id] = (next.levels[id] ?? 0) + 1
  else next.deck.push(id)
  if (next.product) { prepareIntegratedItems(next); return next }
  next.power += 1; next.maxHp += 2; next.hp = Math.min(next.maxHp, next.hp + R.healingBetweenFloors)
  next.floor++; enterFloor(next); return next.product ? normalizeIntegratedRun(next) : next
}

export const STEERING_SAVE_KEY = 'little-token-steering-v1'
export function saveSteeringRun(run: SteeringRun): boolean {
  try { localStorage.setItem(run.product ? INTEGRATED_SAVE_KEY : STEERING_SAVE_KEY, JSON.stringify(run)); return true } catch { return false }
}
export function loadSteeringRun(integrated = false): SteeringRun | null {
  try {
    const raw = localStorage.getItem(integrated ? INTEGRATED_SAVE_KEY : STEERING_SAVE_KEY)
    const parsed = raw ? validateSteeringSave(JSON.parse(raw)) : null
    return parsed && !!parsed.product === integrated ? parsed : null
  } catch { return null }
}
export function validateSteeringSave(value: unknown): SteeringRun | null {
  if (!value || typeof value !== 'object') return null
  const run = value as SteeringRun
  // 이전 포크 저장의 두 손패를 공용 손패로 이관. 고정 문장/배치한 카드는 보존한다.
  if (!Array.isArray(run.hand) && Array.isArray(run.sentences?.situation?.choices) && Array.isArray(run.sentences?.action?.choices)) {
    const selected = Object.values(run.sentences).flatMap(s => [...(s.selected ? [s.selected] : []), ...Object.values(s.edits ?? {})])
    run.hand = [...new Set([...selected, ...run.sentences.situation.choices, ...run.sentences.action.choices])].slice(0, R.hand)
    if (run.sentences.situation.selected === run.sentences.action.selected) run.sentences.action.selected = null
    for (const s of Object.values(run.sentences)) s.choices = [...run.hand]
  }
  if (run.schema !== 1 || !Number.isInteger(run.floor) || run.floor < 1 || run.floor > R.floors
    || !Number.isInteger(run.seed) || !Number.isFinite(run.hp) || !Number.isFinite(run.maxHp)
    || run.maxHp <= 0 || run.hp < 0 || run.hp > run.maxHp || !Number.isFinite(run.power) || run.power <= 0
    || !Number.isInteger(run.turn) || run.turn < 1 || !Number.isInteger(run.totalTurns)
    || !['battle', 'reward', 'lost', 'won'].includes(run.phase) || !Array.isArray(run.deck) || !run.deck.length
    || !run.deck.every(id => !!CONCEPT_BY_ID[id]) || !run.levels || Object.values(run.levels).some(n => !Number.isInteger(n) || n < 0)
    || !Array.isArray(run.hand) || !run.hand.length || run.hand.length > R.hand || new Set(run.hand).size !== run.hand.length
    || !Array.isArray(run.enemies) || !run.enemies.length || run.enemies.length > (run.product ? 8 : 3)
    || run.enemies.some(e => !e || typeof e.name !== 'string' || !Number.isFinite(e.hp) || !Number.isFinite(e.maxHp) || e.hp < 0 || e.hp > e.maxHp || !Number.isFinite(e.atk))
    || !run.sentences || !Number.isInteger(run.redraws) || run.redraws < 0 || run.redraws > R.redraws
    || !Array.isArray(run.rewardChoices) || !run.rewardChoices.every(id => !!CONCEPT_BY_ID[id])
    || !Array.isArray(run.log) || !run.log.every(line => typeof line === 'string')) return null
  try {
    for (const lane of ['situation', 'action'] as Lane[]) {
      const s = run.sentences[lane]
      if (s?.slots?.some(role => ['target', 'timing', 'repeat', 'link'].includes(role))) {
        const old = s as unknown as { slots: string[]; blank: string; fixed: Record<string, string>; selected: string | null }
        if (old.slots.length > 7 || !old.slots.every(role => ['subj', 'adv', 'verb', 'target', 'timing', 'repeat', 'link'].includes(role))
          || !old.slots.includes(old.blank) || !old.fixed) return null
        const extras = old.slots.filter(role => !['subj', 'adv', 'verb'].includes(role))
        const retained = [...new Set([...(extras.includes(old.blank) ? [old.blank] : []), ...extras])].slice(0, 2)
        const mapping: Record<string, Role> = { subj: 'subj', adv: 'adv', verb: 'verb' }
        retained.forEach((role, i) => { mapping[role] = i === 0 ? 'adv2' : 'adv3' })
        s.slots = ['subj', 'adv', ...retained.map(role => mapping[role]), 'verb']
        s.blank = mapping[old.blank]
        const fixed = { subj: old.fixed.subj, adv: old.fixed.adv, verb: old.fixed.verb } as Sentence['fixed']
        retained.forEach(role => { fixed[mapping[role]] = CONCEPT_BY_ID[old.fixed[role]] ? old.fixed[role] : 'calm' })
        s.fixed = fixed
        // Old targeted actor placements become subjects; encounter cards keep their meaning.
        if (s.selected && cardFor(run, s.selected).borrowed) s.blank = 'subj'
      }
      if (!s || s.lane !== lane || !(run.product ? [...SLOT_ROLES, 'obj'] : SLOT_ROLES).includes(s.blank) || !Array.isArray(s.choices) || !s.choices.length || s.choices.length > R.hand
        || (s.selected !== null && !run.product && !s.choices.includes(s.selected))) return null
      for (const id of run.hand) cardFor(run, id)
      if (s.selected && (!(run.product ? [...run.hand, ...encounterSubjects({ ...run, enemies: run.enemies.map(e => ({ ...e, hp: Math.max(1, e.hp) })) }).map(c => c.id)] : run.hand).includes(s.selected) || (cardFor(run, s.selected).borrowed && s.blank !== 'subj' && !(run.product && s.blank === 'obj')))) return null
      const slots = slotsFor(s)
      if (slots.length < 3 || slots.length > 5 || !slots.every(role => (run.product ? [...SLOT_ROLES, 'obj'] : SLOT_ROLES).includes(role)) || new Set(slots).size !== slots.length || !slots.includes(s.blank) || !(run.product ? ['subj', 'obj', 'verb'] as Role[] : BASE_ROLES).every(role => slots.includes(role))) return null
      for (const role of slots) if (s.fixed[role] !== 'self') {
        // 전투가 끝나 죽은 적의 고정 주어도 저장에는 남는다.
        const id = s.fixed[role]!
        if (!CONCEPT_BY_ID[id] && !((role === 'subj' || run.product && role === 'obj') && (id === 'everyone' || id === 'vanguard' || run.product && id === 'actor:player' || run.enemies.some(e => `actor:${e.id}` === id)))) return null
      }
    }
  } catch { return null }
  try { if (run.product && !validateProduct(run)) return null } catch { return null }
  return run
}

/** 보상 완료는 층마다 정확히 한 번. 최종 보상도 엔딩 전에 적용한다. */
export function completeIntegratedReward(run: SteeringRun): SteeringRun {
  const next = clone(run), p = next.product
  if (!p || next.phase !== 'reward' || p.rewardStep !== 'complete' || p.completedFloors.includes(next.floor)) throw new Error('완료할 보상이 없습니다.')
  p.completedFloors.push(next.floor)
  if (next.floor === R.floors) { next.phase = 'won'; return next }
  next.floor++; enterFloor(next); return next.product ? normalizeIntegratedRun(next) : next
}
