/** 포크판 전용 규칙. 표시 문구와 실행이 같은 Effect를 읽는다. */
export type BaseRole = 'subj' | 'adv' | 'verb'
// adv2/adv3는 수식 구절의 위치 ID이며 별도의 품사나 효과가 아니다.
export type Role = BaseRole | 'obj' | 'adv2' | 'adv3'
export const roleKind = (role: Role): BaseRole | 'obj' | 'obj' => role === 'adv2' || role === 'adv3' ? 'adv' : role
export type Lane = 'situation' | 'action'
export type ActionKind = 'attack' | 'reflect' | 'guard' | 'dodge' | 'heal' | 'ignite' | 'wait'
export interface Effect {
  kind?: ActionKind
  scale?: number
  hits?: number
  reflect?: number
  dodge?: number
  thorns?: number
  burn?: number
  guard?: number
  heal?: number
  weak?: number
  collision?: number
  chain?: number
  delay?: boolean
  target?: string
  priority?: number
}
export interface Concept {
  id: string
  name: string
  glyph: string
  art: string
  color: string
  forms: Record<Role, string>
  effects: Record<Role, Effect>
  note?: string
  actor?: 'all' | 'vanguard' | 'player' | 'encounter'
  borrowed?: boolean
}
const concept = (id: string, name: string, glyph: string, art: string, color: string,
  forms: [string, string, string], effects: [Effect, Effect, Effect], note?: string): Concept => ({
  id, name, glyph, art, color, note,
  forms: { subj: forms[0], adv: forms[1], verb: forms[2], obj: '대상 카드로 지정', adv2: forms[1], adv3: forms[1] },
  effects: { subj: effects[0], adv: effects[1], verb: effects[2], obj: {}, adv2: effects[1], adv3: effects[1] },
})
export const CONCEPTS: Concept[] = [
  concept('fire', '불꽃', '♨', '3011', '#bb5636', ['불꽃이', '불꽃을 두르고', '불타올랐다'],
    [{ burn: 3 }, { burn: 3 }, { kind: 'ignite', burn: 5 }]),
  concept('mirror', '거울', '◇', '2006', '#398f99', ['거울이', '거울처럼', '되돌렸다'],
    [{ reflect: 0.5 }, { reflect: 0.5 }, { kind: 'reflect', reflect: 1 }]),
  concept('wind', '바람', '≋', '2003', '#6d9b87', ['바람이', '바람처럼', '비켜섰다'],
    [{ dodge: 0.5 }, { dodge: 0.5 }, { kind: 'dodge', dodge: 1, collision: 0.8 }]),
  concept('thorn', '가시', '✦', '3004', '#947358', ['가시가', '가시를 세우고', '가시로 버텼다'],
    [{ thorns: 3 }, { thorns: 3 }, { kind: 'guard', guard: 0.7, thorns: 5 }]),
  concept('force', '힘', '↗', '2001', '#b35048', ['힘센 내가', '온 힘을 다해', '내리쳤다'],
    [{ scale: 1.4 }, { scale: 1.7 }, { kind: 'attack', scale: 1.6 }]),
  concept('weaken', '약화', '↘', '2005', '#778a9a', ['기운 빠진 내가', '힘없이', '힘없이 때렸다'],
    [{ scale: 0.5 }, { scale: 0.5 }, { kind: 'attack', scale: 0.5 }],
    '이 문장 행동 주체의 위력을 줄임 · 내 문장에 넣으면 나도 약해짐'),
  concept('calm', '신중함', '◌', '2005', '#778a9a', ['신중한 내가', '조심스럽게', '막아냈다'],
    [{ guard: 0.7 }, { scale: 0.6, guard: 0.5 }, { kind: 'guard', guard: 1.8 }]),
  concept('echo', '메아리', '»', '3002', '#a0789a', ['메아리가', '거듭해서', '연달아 때렸다'],
    [{ hits: 2, scale: 0.7 }, { hits: 3, scale: 0.5 }, { kind: 'attack', hits: 3, scale: 0.6 }]),
  concept('rest', '쉼', '✚', '3013', '#608859', ['쉬어 가는 내가', '숨을 고르며', '회복했다'],
    [{ heal: 0.6 }, { heal: 0.5, scale: 0.8 }, { kind: 'heal', heal: 1.4 }]),
  concept('reckless', '무모함', '⚡', '2007', '#c27f3e', ['무모한 내가', '무모하게', '몸을 던졌다'],
    [{ scale: 1.5, weak: 0.4 }, { scale: 1.3, weak: 0.5 }, { kind: 'attack', scale: 1.8, weak: 0.5 }]),
  concept('link', '연결', '∞', '3023', '#6d8fa5', ['연결이', '서로 이어져', '연쇄 타격했다'],
    [{ chain: 0.5 }, { chain: 0.5 }, { kind: 'attack', chain: 0.5, scale: 1.1 }]),
  concept('weight', '무게', '◆', '3010', '#9a8363', ['묵직한 내가', '무게를 실어', '짓눌렀다'],
    [{ scale: 1.5, delay: true }, { scale: 1.8, delay: true }, { kind: 'attack', scale: 2, delay: true }]),
  concept('rush', '돌진', '➜', '3003', '#b06d54', ['돌진하는 내가', '멈추지 않고', '돌진했다'],
    [{ scale: 1.2, collision: 0.8 }, { scale: 1.3, collision: 0.8 }, { kind: 'attack', scale: 1.4, collision: 0.8 }]),
]
export const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map(card => [card.id, card])) as Record<string, Concept>
export const STARTER_CONCEPTS = ['fire', 'mirror', 'wind', 'thorn', 'force', 'weaken', 'calm', 'echo', 'rest']
export const BASE_ROLES: BaseRole[] = ['subj', 'adv', 'verb']
export const ROLES: BaseRole[] = BASE_ROLES
export const SLOT_ROLES: Role[] = ['subj', 'adv', 'adv2', 'adv3', 'verb']
export const ROLE_LABELS: Record<Role, string> = { obj: '목적어', subj: '주어', adv: '수식', adv2: '수식', adv3: '수식', verb: '행동' }
export const STEERING_RULES = {
  floors: 15, maxHp: 60, power: 12, hand: 6, redraws: 2,
  burnTurns: 3, healingBetweenFloors: 8, reinforcement: 0.2,
} as const

export interface EncounterDef {
  id: string; name: string; visual: string; hp: number; atk: number
}
const ENCOUNTERS: EncounterDef[] = [
  { id: 'termite', name: '흰개미', visual: 'termite', hp: 21, atk: 5 },
  { id: 'flea', name: '벼룩', visual: 'flea', hp: 23, atk: 5 },
  { id: 'roach', name: '바퀴벌레', visual: 'roach', hp: 26, atk: 6 },
  { id: 'moth', name: '먼지벌레', visual: 'moth', hp: 28, atk: 6 },
]
export function encounterFor(floor: number): EncounterDef[] {
  const boost = 1 + (floor - 1) * 0.13
  if (floor % 5 === 0) {
    const boss = floor === 5 ? { id: 'mantis', name: '사마귀', visual: 'mantis' }
      : floor === 10 ? { id: 'queenBee', name: '여왕벌', visual: 'queenBee' }
        : { id: 'elderSpider', name: '장로거미', visual: 'elderSpider' }
    return [{ ...boss, hp: Math.round((floor === 5 ? 65 : 85) * boost), atk: Math.round(8 * boost) },
      { ...ENCOUNTERS[(floor / 5 - 1) % ENCOUNTERS.length], hp: Math.round(18 * boost), atk: Math.round(4 * boost) }]
  }
  const count = floor < 3 ? 1 : floor < 8 ? 2 : 3
  return Array.from({ length: count }, (_, i) => {
    const base = ENCOUNTERS[(floor - 1 + i) % ENCOUNTERS.length]
    return { ...base, hp: Math.round(base.hp * boost), atk: Math.round(base.atk * boost) }
  })
}

/** 통합판만 목적어를 사용한다. prototype의 ROLES/BASE_ROLES는 보존한다. */
export const INTEGRATED_ROLES: Role[] = ['subj', 'adv', 'obj', 'verb']
