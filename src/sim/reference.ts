/**
 * Headless combat simulation. Rendering reads the results returned here; no battle
 * rule is defined in BattleView.
 */
import {
  BOSS_ATTACK_MULTIPLIER,
  bossTurnPressureMultiplier,
  clampStatRank,
  PART_WEAKNESS_MULT,
  playerGuardLimit,
  TARGET_FALLOFF,
  statRankScale,
  WEAKNESS_MULT,
  type BossAttackStage,
} from '@core/combatRules'
import { effectiveBase, isDamageIntent } from '@core/compiler'
import { inkOverdraw } from '@core/ink'
import type { Emotion, EnemyDef, EnemyPartDef, Intent, TargetCount } from '@core/types'

// 규칙 상수의 원본은 core/combatRules.ts다(도움말 화면이 같은 값을 읽는다).
// 기존 소비처가 계속 sim에서 가져다 쓸 수 있도록 여기서 그대로 다시 내보낸다.
export { BOSS_ATTACK_MULTIPLIER, bossTurnPressureMultiplier, playerGuardLimit, type BossAttackStage }

export interface EnemyPartInst {
  def: EnemyPartDef
  hp: number
  maxHp: number
  broken: boolean
}

export interface EnemyInst {
  def: EnemyDef
  hp: number
  maxHp: number
  /** 보스 체력을 구성하는 막 수. 일반 적은 항상 1이다. */
  healthBars: number
  /** 한 막의 체력. 총 체력은 이 값 × healthBars다. */
  hpPerBar: number
  atkMult: number
  /** 전투 중 공격 랭크. 적마다 따로 유지한다. */
  attackRank: number
  dead: boolean
  initiativePhase: 'first' | 'second'
  nextAttackTurn: number
  engaged: boolean
  guard: number
  magicShield: number
  /** attackPattern에서 다음 기술을 고르는 누적 공격 횟수. */
  attacksMade: number
  /** 다음 attackPattern 인덱스와 이번 사이클에서 1회 반복을 이미 썼는지 저장한다. */
  attackPatternIndex: number
  attackStepRepeated: boolean
  /** 이 턴까지 플레이어 공격으로 받는 피해가 groggyDamageMult만큼 증가한다. */
  groggyUntilTurn: number
  groggyDamageMult: number
  /** 보스 좌우에 현재 남아 있는 호위 소환물 수. */
  summonsLeft: number
  summonsRight: number
  /** 좌우 호위의 슬롯 순서별 현재 체력. */
  summonHpLeft: number[]
  summonHpRight: number[]
  /** 여왕벌 그로기 한 주기 안에서 지금까지 퇴치한 호위 수. */
  summonsDefeated: number
  /** 호위 전멸 뒤 회복 턴을 보낸 다음, 새 묶음을 부를 수 있는 첫 턴. */
  summonRespawnTurn: number
  /** 같은 전투 턴에 턴 시작 소환을 두 번 처리하지 않기 위한 표식. */
  lastSummonTurn: number
  /** 거미 다리와 본체처럼 순서대로 피해를 받는 보스 부위. */
  parts: EnemyPartInst[]
  webTurns: number
  lastWebTurn: number
}

export function bossAttackStage(enemy: Pick<EnemyInst, 'def' | 'hp' | 'maxHp'>): BossAttackStage {
  if (!enemy.def.boss || enemy.maxHp <= 0) return 1
  const hpRatio = Math.max(0, enemy.hp) / enemy.maxHp
  if (hpRatio <= 1 / 3) return 3
  if (hpRatio <= 2 / 3) return 2
  return 1
}

/** RNG 최고치까지 막아야 그로기가 열리므로 플레이어에게 항상 같은 목표값을 보여 준다. */
export function enemyGuardBreakRequirement(
  enemy: Pick<EnemyInst, 'def' | 'atkMult' | 'attackRank' | 'hp' | 'maxHp'>,
  turn = 1,
): number {
  const step = enemy.def.attackPattern?.find((candidate) => candidate.shatterGuard)
  if (!step) return 0
  const stageMult = BOSS_ATTACK_MULTIPLIER[bossAttackStage(enemy)]
  const pressureMult = bossTurnPressureMultiplier(enemy, turn)
  return Math.max(1, Math.round(
    (enemy.def.atk + step.bonusAtk + 2) * statRankScale(enemy.attackRank) * enemy.atkMult * stageMult * pressureMult * (step.damageScale ?? 1),
  ))
}

export interface PendingAttack {
  dmg: number
  sentence: string
  target: number
  targetCount: TargetCount
  hitCount: number
  pierceGuard: boolean
  emotions: Emotion[]
  tags: string[]
  comboMatched: boolean
}

export interface BattleState {
  playerHp: number
  playerMax: number
  guard: number
  counter: boolean
  /** 카운터 문장이 방어·회복 행동이어서 받은 피해를 100% 돌려주는가. */
  counterFull: boolean
  playerAttackRank?: number
  playerGuardRank?: number
  /** 한 겹이 다음 적 공격 한 번을 관통 여부와 무관하게 지운다. */
  playerMagicShield?: number
  /** 개발 치트: 적 행동은 진행하되 플레이어 피해와 방어 소모는 막는다. */
  damageImmune?: boolean
  turn: number
  enemies: EnemyInst[]
  pending: PendingAttack | null
}

/** Ink overdraw bypasses guard and directly spends health once per completed sentence. */
export function applyInkOverdraw(state: BattleState, inkCost: number, availableInk?: number): number {
  const damage = inkOverdraw(inkCost, availableInk)
  state.playerHp = Math.max(0, state.playerHp - damage)
  return damage
}

export function makeEnemy(def: EnemyDef, atkMult = 1, hpMult = 1, healthBars = 1): EnemyInst {
  const hpPerBar = Math.max(1, Math.round(def.hp * hpMult))
  // 부위 보스는 부위 하나가 곧 체력 한 줄이다. 호출부의 막 수와 어긋나더라도
  // 부위 배열을 기준으로 잡아 총 체력·HUD·실제 피해 풀이 항상 일치하게 한다.
  const bars = def.parts?.length
    ? def.parts.length
    : def.boss
      ? Math.max(1, Math.floor(healthBars))
      : 1
  const maxHp = hpPerBar * bars
  return {
    def,
    hp: maxHp,
    maxHp,
    healthBars: bars,
    hpPerBar,
    atkMult,
    attackRank: 0,
    dead: false,
    initiativePhase: def.initiative,
    nextAttackTurn: 1,
    engaged: false,
    guard: Math.max(0, def.guard ?? 0),
    magicShield: Math.max(0, def.magicShield ?? 0),
    attacksMade: 0,
    attackPatternIndex: 0,
    attackStepRepeated: false,
    groggyUntilTurn: 0,
    groggyDamageMult: 1,
    summonsLeft: 0,
    summonsRight: 0,
    summonHpLeft: [],
    summonHpRight: [],
    summonsDefeated: 0,
    summonRespawnTurn: 1,
    lastSummonTurn: 0,
    parts: (def.parts ?? []).map((part) => ({
      def: part,
      hp: hpPerBar,
      maxHp: hpPerBar,
      broken: false,
    })),
    webTurns: 0,
    lastWebTurn: 0,
  }
}

export const activeEnemyPart = (enemy: Pick<EnemyInst, 'parts'>): EnemyPartInst | null =>
  enemy.parts.find((part) => !part.broken) ?? null

export const brokenSpiderLegs = (enemy: Pick<EnemyInst, 'parts'>): number =>
  enemy.parts.filter((part) => part.def.kind === 'leg' && part.broken).length

/** 끊어진 다리 수를 기준점으로 삼아, 다리 파괴 시 누적 봉인 수를 0으로 되돌린다. */
export function spiderWebTension(enemy: Pick<EnemyInst, 'def' | 'webTurns' | 'parts'>): number {
  return Math.min(enemy.def.webPattern?.maxSealedCards ?? 0, Math.max(0, enemy.webTurns - brokenSpiderLegs(enemy)))
}

export interface SpiderWebTurn {
  idx: number
  tension: number
  brokenLegs: number
}

/** 3슬롯에서는 주어 → 수식어 → 동사를 정확히 순환해 봉인 편중을 막는다. */
export function spiderSealSlotForTurn(slotKeys: readonly string[], turn: number): string | null {
  if (slotKeys.length === 0) return null
  return slotKeys[Math.max(0, Math.floor(turn) - 1) % slotKeys.length]
}

/** View가 카드 한 장을 고르기 전에 거미줄의 전투 압력을 한 번만 확정한다. */
export function spiderWebAtTurnStart(state: BattleState): SpiderWebTurn | null {
  const idx = state.enemies.findIndex((enemy) => !enemy.dead && !!enemy.def.webPattern)
  if (idx < 0) return null
  const enemy = state.enemies[idx]
  if (enemy.lastWebTurn === state.turn) return null
  enemy.lastWebTurn = state.turn
  if (spiderWebTension(enemy) < enemy.def.webPattern!.maxSealedCards) enemy.webTurns++
  return {
    idx,
    tension: spiderWebTension(enemy),
    brokenLegs: brokenSpiderLegs(enemy),
  }
}

export const summonCount = (enemy: Pick<EnemyInst, 'summonsLeft' | 'summonsRight'>): number =>
  enemy.summonsLeft + enemy.summonsRight

export interface TurnSummon {
  idx: number
  name: string
  side: 'left' | 'right'
  slot: number
  count: number
  max: number
}

/** 턴 시작 소환은 순수 전투 상태에서 확정하고, View는 반환값으로 연출만 한다. */
export function summonAtTurnStart(state: BattleState): TurnSummon[] {
  const summoned: TurnSummon[] = []
  state.enemies.forEach((enemy, idx) => {
    const pattern = enemy.def.summonPattern
    if (!pattern || enemy.dead || enemy.lastSummonTurn === state.turn) return
    if (pattern.refillOnlyWhenEmpty && summonCount(enemy) > 0) return
    if (state.turn < enemy.summonRespawnTurn) return
    enemy.lastSummonTurn = state.turn
    for (let i = 0; i < pattern.perTurn && summonCount(enemy) < pattern.max; i++) {
      const canLeft = enemy.summonsLeft < pattern.maxPerSide
      const canRight = enemy.summonsRight < pattern.maxPerSide
      if (!canLeft && !canRight) break
      const side = canLeft && (!canRight || enemy.summonsLeft <= enemy.summonsRight) ? 'left' : 'right'
      if (side === 'left') enemy.summonsLeft++
      else enemy.summonsRight++
      const slot = side === 'left' ? enemy.summonsLeft : enemy.summonsRight
      if (side === 'left') enemy.summonHpLeft.push(pattern.hp ?? 1)
      else enemy.summonHpRight.push(pattern.hp ?? 1)
      summoned.push({ idx, name: pattern.name, side, slot, count: summonCount(enemy), max: pattern.max })
    }
  })
  return summoned
}

export function nextEnemyAttackStep(enemy: EnemyInst): NonNullable<EnemyDef['attackPattern']>[number] | null {
  const pattern = enemy.def.attackPattern
  if (!pattern?.length) return null
  return pattern[enemy.attackPatternIndex % pattern.length]
}

function advanceEnemyAttackPattern(enemy: EnemyInst, rng: () => number): void {
  const pattern = enemy.def.attackPattern
  if (!pattern?.length) return
  const current = pattern[enemy.attackPatternIndex % pattern.length]
  if (!enemy.attackStepRepeated && (current.repeatOnceChance ?? 0) > 0 && rng() < current.repeatOnceChance!) {
    enemy.attackStepRepeated = true
    return
  }
  enemy.attackPatternIndex = (enemy.attackPatternIndex + 1) % pattern.length
  enemy.attackStepRepeated = false
}

export const aliveIdx = (state: BattleState): number[] =>
  state.enemies.map((enemy, index) => (enemy.dead ? -1 : index)).filter((index) => index >= 0)

export const frontIdx = (state: BattleState): number => state.enemies.findIndex((enemy) => !enemy.dead)

export const allDead = (state: BattleState): boolean => state.enemies.every((enemy) => enemy.dead)

export function engageInitialFront(state: BattleState): void {
  const front = frontIdx(state)
  if (front >= 0) state.enemies[front].engaged = true
}

export function engageFront(state: BattleState): void {
  const front = frontIdx(state)
  if (front < 0) return
  const enemy = state.enemies[front]
  if (enemy.engaged) return
  enemy.engaged = true
  // 뒤에서 기다리던 적은 앞 적이 쓰러진 그 턴에는 공격하지 않는다. 도착 연출과
  // 대응할 한 문장을 보장하고, 다음 턴부터 자기 주기(일반 적은 매 턴)를 시작한다.
  enemy.nextAttackTurn = state.turn + enemy.def.every
  enemy.initiativePhase = enemy.def.initiative
}

export interface HitFx {
  target: number
  dmg: number
  /** 살아 있는 호위 때문에 소환자 본체가 이 타격을 받지 않았는가. */
  summonShieldBlocked?: boolean
  guardAbsorbed: number
  magicShieldBroken: boolean
  /** 이 타격을 막고 남은 매직실드 겹 수. 실드 타격이 아니면 현재 값과 무관하다. */
  magicShieldRemaining: number
  weak: boolean
  /** 한 번의 타격으로 완전히 소진한 보스 체력 막 수. */
  barsBroken: number
  /** 현재 보스 체력 막의 남은 양을 넘어선 충격. 체력바 오버킬 연출에 쓴다. */
  barOverflow?: number
  /** 초과 충격이 막 경계에 멈추지 않고 다음 막까지 실제로 관통했는가. */
  barOverflowPassed?: boolean
  /** 부위 보스에서 이 타격이 시작된 다리 또는 본체. */
  partId?: string
  partName?: string
  /** 공개 약점을 맞혀 카드 봉인 하나를 풀었는가. */
  webCut?: boolean
  /** 다리를 파괴해 카드 봉인을 전부 풀었는가. */
  webBurst?: boolean
  tensionReduced?: number
}

export interface ApplyResult {
  text: string
  combos: string[]
  hits: HitFx[]
  selfDmg: number
  heal: number
  convertedDamage?: number
  lifeStolen?: number
  killed: number[]
  overflow: number
  /** 문장이 보스 곁에서 퇴치한 호위 소환물 수. */
  summonsDispersed: number
  summonDamage: number
  /** 쓰러진 호위가 소환자 본체에 되돌려 준 직접 피해. */
  summonBacklashDamage: number
  /** 지정 감정의 단일 공격으로 호위 퇴치 반동이 강화되었는가. */
  summonFocusedBacklash: boolean
  /** 호위 전멸이 그로기와 공격 스킵을 열었는가. */
  summonGroggyTriggered: boolean
  /** 피해 없이 방어·회복 문장으로 현재 거미 다리의 약점을 맞혀 푼 봉인. */
  supportWebCut: { target: number; tensionReduced: number } | null
}

export interface PreparationResult {
  /** 상한을 적용하기 전 문장이 만든 방어막. */
  guardAttempted: number
  /** 상한 적용 뒤 실제로 늘어난 방어막. */
  guardGain: number
  counter: boolean
  counterFull: boolean
  magicShieldGain: number
  attackRankGain: number
  guardRankGain: number
}

export interface OverkillTransferResult {
  /** 다음 적의 체력에 직접 꽂힌 전이 피해. */
  dealt: number
  killed: boolean
  /** 다음 적까지 쓰러뜨리고도 남아 뒤로 이어질 피해. */
  overflow: number
}

export interface OverkillTransferContext {
  emotions?: readonly Emotion[]
  tags?: readonly string[]
  comboMatched?: boolean
}

export function applyPreparation(state: BattleState, intent: Intent, mult = 1): PreparationResult {
  const castPower = intent.castCount * intent.castScale
  const guardAttempted = intent.tags.includes('enemy') ? 0 : Math.max(0, Math.round(intent.guard * mult * castPower))
  const guardGain = Math.min(guardAttempted, Math.max(0, playerGuardLimit(state.playerMax) - state.guard))
  // 남은 방어막은 피해로 흡수한 만큼만 줄고, 새 방어는 그 위에 누적한다.
  // 방어가 없는 문장을 준비했다는 이유만으로 기존 방어막을 지우지 않는다.
  if (guardGain > 0) state.guard += guardGain
  // 반격은 방어막이 실제로 늘었는지가 아니라 방어 문장을 세웠는지로 걸린다.
  // 상한에 걸려 비축분이 0이어도 그 턴을 방어에 쓴 사실은 같으므로 반격은 살린다.
  // 카운터는 이 문장을 쓴 턴에만 유효하다. 이번 문장에 카운터가 없으면
  // 직전 턴에 피격되지 않고 남은 값도 여기서 사라진다.
  state.counter = intent.counter
  state.counterFull = intent.counter && (intent.kind === 'guard' || intent.kind === 'heal')
  const magicShieldBefore = Math.max(0, state.playerMagicShield ?? 0)
  state.playerMagicShield = intent.magicShield > 0 ? 1 : magicShieldBefore
  const magicShieldGain = state.playerMagicShield - magicShieldBefore
  const attackRankBefore = state.playerAttackRank ?? 0
  const guardRankBefore = state.playerGuardRank ?? 0
  state.playerAttackRank = clampStatRank(attackRankBefore + intent.attackRank)
  state.playerGuardRank = clampStatRank(guardRankBefore + intent.guardRank)
  return {
    guardAttempted,
    guardGain,
    counter: state.counter,
    counterFull: state.counterFull,
    magicShieldGain,
    attackRankGain: state.playerAttackRank - attackRankBefore,
    guardRankGain: state.playerGuardRank - guardRankBefore,
  }
}

interface AttackPlan {
  dmg: number
  target: number
  targetCount: TargetCount
  hitCount: number
  pierceGuard: boolean
  emotions: Emotion[]
  tags: string[]
  /** 현재 약점과 관용구가 함께 맞았을 때만 부위 너머로 남은 피해를 보낸다. */
  comboMatched: boolean
}

/** 일반 보스에서 한 타격이 이 막 수만큼 강하면 막 경계를 넘어간다. */
export const BOSS_MULTI_BAR_HIT_BARS = 2

export function bossMultiBarDamageRequirement(enemy: Pick<EnemyInst, 'def' | 'healthBars' | 'hpPerBar' | 'parts'>): number {
  if (!enemy.def.boss || enemy.healthBars <= 1 || enemy.parts.length > 0) return 0
  return enemy.hpPerBar * BOSS_MULTI_BAR_HIT_BARS
}

function activePartWeak(enemy: EnemyInst, emotions: readonly Emotion[], tags: readonly string[]): boolean {
  const weakness = activeEnemyPart(enemy)?.def.weakness
  if (!weakness) return false
  if (tags.includes('adapt')) return true
  return weakness.kind === 'emotion'
    ? emotions.includes(weakness.value as Emotion)
    : tags.includes(weakness.value)
}

function cutSpiderWebWithSupport(state: BattleState, target: number, intent: Intent): ApplyResult['supportWebCut'] {
  const enemy = state.enemies[target]
  const supportsPlayer = intent.guard > 0 || intent.heal > 0
  if (!enemy || enemy.dead || !enemy.def.webPattern || !supportsPlayer) return null
  if (!activePartWeak(enemy, intent.emotions, intent.tags)) return null

  const tensionBefore = spiderWebTension(enemy)
  enemy.webTurns = Math.max(brokenSpiderLegs(enemy), enemy.webTurns - 1)
  return { target, tensionReduced: Math.max(0, tensionBefore - spiderWebTension(enemy)) }
}

function damageEnemy(
  state: BattleState,
  target: number,
  dmg: number,
  pierceGuard: boolean,
  emotions: Emotion[],
  tags: string[] = [],
  comboMatched = false,
): HitFx | null {
  const enemy = state.enemies[target]
  if (!enemy || enemy.dead) return null
  const tensionBefore = spiderWebTension(enemy)
  const part = activeEnemyPart(enemy)
  const weak = part
    ? activePartWeak(enemy, emotions, tags)
    : !!enemy.def.weakEmotion && emotions.includes(enemy.def.weakEmotion)
  const groggyMult = state.turn <= enemy.groggyUntilTurn ? enemy.groggyDamageMult : 1
  const weakMult = weak ? (part ? PART_WEAKNESS_MULT : WEAKNESS_MULT) : 1
  const raw = Math.max(0, Math.round(dmg * weakMult * groggyMult))
  if (enemy.def.summonPattern && summonCount(enemy) > 0) {
    return {
      target,
      dmg: 0,
      summonShieldBlocked: true,
      guardAbsorbed: 0,
      magicShieldBroken: false,
      magicShieldRemaining: enemy.magicShield,
      weak,
      barsBroken: 0,
      partId: part?.def.id,
      partName: part?.def.name,
      webCut: false,
      webBurst: false,
      tensionReduced: 0,
    }
  }
  if (enemy.magicShield > 0 && !pierceGuard) {
    enemy.magicShield--
    return {
      target,
      dmg: 0,
      summonShieldBlocked: false,
      guardAbsorbed: 0,
      magicShieldBroken: true,
      magicShieldRemaining: enemy.magicShield,
      weak,
      barsBroken: 0,
      partId: part?.def.id,
      partName: part?.def.name,
      webCut: false,
      webBurst: false,
      tensionReduced: 0,
    }
  }
  const guardAbsorbed = pierceGuard ? 0 : Math.min(enemy.guard, raw)
  if (!pierceGuard) enemy.guard -= guardAbsorbed
  const dealt = Math.max(0, raw - guardAbsorbed)
  const currentBarHp = enemy.def.boss && enemy.healthBars > 1
    ? Math.max(1, enemy.hp % enemy.hpPerBar || enemy.hpPerBar)
    : enemy.hp
  const barOverflow = enemy.def.boss && enemy.healthBars > 1
    ? Math.max(0, dealt - currentBarHp)
    : 0
  const hpBefore = enemy.hp
  let barOverflowPassed = false
  let appliedDamage = dealt
  const barsBefore = enemy.parts.length
    ? enemy.parts.filter((candidate) => !candidate.broken).length
    : Math.ceil(Math.max(0, enemy.hp) / enemy.hpPerBar)
  if (part) {
    // 약점만 맞힌 문장은 현재 다리를 확실히 끊는 정답이고, 약점과 이름 있는
    // 관용구까지 함께 맞힌 완벽한 맥락만 뒤 부위로 관통한다. 순차 약점 퍼즐을
    // 보존하면서도 후반 덱의 폭발적인 상한은 관용구 보상으로 남긴다.
    barOverflowPassed = barOverflow > 0 && weak && comboMatched
    let remaining = barOverflowPassed ? dealt : Math.min(dealt, part.hp)
    for (const candidate of enemy.parts.slice(enemy.parts.indexOf(part))) {
      if (remaining <= 0) break
      const applied = Math.min(candidate.hp, remaining)
      candidate.hp -= applied
      remaining -= applied
      if (candidate.hp <= 0) candidate.broken = true
    }
    enemy.hp = enemy.parts.reduce((sum, candidate) => sum + Math.max(0, candidate.hp), 0)
    appliedDamage = Math.max(0, hpBefore - enemy.hp)
  } else {
    const multiBarRequirement = bossMultiBarDamageRequirement(enemy)
    barOverflowPassed = barOverflow > 0 && multiBarRequirement > 0 && dealt >= multiBarRequirement
    // 웬만한 강타는 현재 막을 확실히 깨는 데서 멈춘다. 한 막 체력의 2배에 이른
    // 초강타만 다음 막으로 이어져, 성장한 문장의 폭발력과 보스 패턴의 생존 시간을
    // 함께 보존한다. 일반 적과 단일 막 보스에는 이 경계를 적용하지 않는다.
    if (barOverflow > 0 && multiBarRequirement > 0 && !barOverflowPassed) appliedDamage = currentBarHp
    enemy.hp -= appliedDamage
  }
  const barsAfter = enemy.parts.length
    ? enemy.parts.filter((candidate) => !candidate.broken).length
    : Math.ceil(Math.max(0, enemy.hp) / enemy.hpPerBar)
  if (enemy.hp <= 0) enemy.dead = true
  const barsBroken = barsBefore - barsAfter
  const webBurst = !!enemy.def.webPattern && appliedDamage > 0 && barsBroken > 0
  const webCut = !!enemy.def.webPattern && weak && appliedDamage > 0 && !webBurst
  if (webBurst) {
    // 다리 하나가 떨어지면 쌓인 카드 봉인을 전부 걷어 낸다.
    enemy.webTurns = brokenSpiderLegs(enemy)
  } else if (webCut) {
    // 약점만 맞힌 경우에는 작은 파훼로 한 겹을 끊는다.
    enemy.webTurns = Math.max(brokenSpiderLegs(enemy), enemy.webTurns - 1)
  }
  return {
    target,
    dmg: appliedDamage,
    summonShieldBlocked: false,
    guardAbsorbed,
    magicShieldBroken: false,
    magicShieldRemaining: enemy.magicShield,
    weak,
    barsBroken,
    barOverflow,
    barOverflowPassed,
    partId: part?.def.id,
    partName: part?.def.name,
    webCut,
    webBurst,
    tensionReduced: Math.max(0, tensionBefore - spiderWebTension(enemy)),
  }
}

/**
 * 오버킬 전이는 이미 앞 적을 뚫고 나온 한 줄기이므로 다음 적의 일반 방어막과
 * 매직실드를 모두 건너뛴다. 두 실드는 소모하지 않으며, View가 전투 상태를 직접
 * 고치지 않도록 여기서 체력 막까지 함께 동기화한다.
 */
export function applyOverkillTransfer(
  state: BattleState,
  target: number,
  damage: number,
  context: OverkillTransferContext = {},
): OverkillTransferResult {
  const enemy = state.enemies[target]
  const incoming = Math.max(0, Math.round(damage))
  if (!enemy || enemy.dead || incoming <= 0) return { dealt: 0, killed: false, overflow: 0 }

  const before = Math.max(0, enemy.hp)
  const activePart = activeEnemyPart(enemy)
  const canCrossParts = !!activePart
    && !!context.comboMatched
    && activePartWeak(enemy, context.emotions ?? [], context.tags ?? [])
  const dealt = Math.min(before, incoming, activePart && !canCrossParts ? activePart.hp : before)
  if (enemy.parts.length > 0) {
    let remaining = dealt
    const firstPart = activePart ? enemy.parts.indexOf(activePart) : 0
    const reachableParts = canCrossParts
      ? enemy.parts.slice(firstPart)
      : enemy.parts.slice(firstPart, firstPart + 1)
    for (const part of reachableParts) {
      if (remaining <= 0) break
      const applied = Math.min(part.hp, remaining)
      part.hp -= applied
      remaining -= applied
      if (part.hp <= 0) part.broken = true
    }
    enemy.hp = enemy.parts.reduce((sum, part) => sum + Math.max(0, part.hp), 0)
  } else {
    enemy.hp = Math.max(0, before - dealt)
  }
  enemy.dead = enemy.hp <= 0
  return {
    dealt,
    killed: enemy.dead,
    overflow: enemy.dead ? Math.max(0, incoming - before) : 0,
  }
}

function resolveAttack(state: BattleState, plan: AttackPlan): { hits: HitFx[]; killed: number[]; overflow: number } {
  const hits: HitFx[] = []
  const killed: number[] = []
  const record = (hit: HitFx | null) => {
    if (!hit) return
    hits.push(hit)
    if (state.enemies[hit.target]?.dead && !killed.includes(hit.target)) killed.push(hit.target)
  }

  // 연타도 각 타격은 일반 단일 공격과 같은 오버킬 규칙을 따른다. 도중에 적을
  // 쓰러뜨리면 그 타격의 초과분뿐 아니라 아직 휘두르지 않은 타격도 같은 줄기를
  // 타고 뒷줄로 넘어간다. 매직실드가 막은 타격은 피해가 0이므로 체인에 보태지지
  // 않지만, 남은 연타는 계속 실드를 벗기거나 체력을 노릴 수 있다.
  if (plan.hitCount > 1 && plan.targetCount === 1) {
    for (let i = 0; i < plan.hitCount; i++) {
      if (state.enemies[plan.target]?.dead) break
      const before = state.enemies[plan.target].hp
      const hit = damageEnemy(state, plan.target, plan.dmg, plan.pierceGuard, plan.emotions, plan.tags, plan.comboMatched)
      record(hit)
      if (hit && state.enemies[plan.target].dead) {
        const unusedHits = plan.hitCount - i - 1
        return { hits, killed, overflow: Math.max(0, hit.dmg - before) + hit.dmg * unusedHits }
      }
    }
    return { hits, killed, overflow: 0 }
  }

  const targets = plan.targetCount === 'all'
    ? aliveIdx(state)
    : aliveIdx(state).filter((index) => index >= plan.target).slice(0, plan.targetCount)
  const targetOverflow = new Map<number, number>()
  for (let rank = 0; rank < targets.length; rank++) {
    const target = targets[rank]
    const before = state.enemies[target].hp
    const scale = plan.targetCount === 1 || plan.targetCount === 'all' ? 1 : TARGET_FALLOFF[rank] ?? TARGET_FALLOFF[2]
    const hit = damageEnemy(state, target, Math.round(plan.dmg * scale), plan.pierceGuard, plan.emotions, plan.tags, plan.comboMatched)
    record(hit)
    if (hit && state.enemies[target].dead) {
      targetOverflow.set(target, Math.max(0, hit.dmg - before))
    }
  }

  // 범위 공격의 각 갈래에서 남은 피해도 전열부터 끊기지 않고 쓰러진 구간만 한
  // 줄기로 합쳐 다음 적에게 넘긴다. 앞 적이 매직실드 등으로 살아 있으면 뒤 적의
  // 초과분이 앞으로 역류해 실드를 우회하지 못하고 그 자리에서 소멸한다.
  const nextFront = frontIdx(state)
  const overflow = targets
    .filter((target) => state.enemies[target].dead && (nextFront < 0 || target < nextFront))
    .reduce((sum, target) => sum + (targetOverflow.get(target) ?? 0), 0)
  return { hits, killed, overflow }
}

interface SummonDisperseResult {
  count: number
  damage: number
  remainingDamage: number
  backlashDamage: number
  focusedBacklash: boolean
  groggyTriggered: boolean
  killed: boolean
}

function disperseTargetSummons(
  state: BattleState,
  target: number,
  dmg: number,
  targetCount: TargetCount,
  pierceGuard = false,
  emotions: readonly Emotion[] = [],
): SummonDisperseResult {
  const enemy = state.enemies[target]
  if (!enemy || enemy.dead || !enemy.def.summonPattern) {
    return { count: 0, damage: 0, remainingDamage: dmg, backlashDamage: 0, focusedBacklash: false, groggyTriggered: false, killed: false }
  }
  const pattern = enemy.def.summonPattern
  const available = summonCount(enemy)
  const reachable = targetCount === 'all'
    ? available
    : Math.min(available, Math.max(1, targetCount) * (pierceGuard ? 2 : 1))
  let remainingDamage = Math.max(0, dmg)
  let damage = 0
  let dispersed = 0
  let allReachedDefeated = reachable > 0
  // 범위 피해는 일반 적 레일과 같은 대상 감쇠를 각 일벌에 적용한다.
  for (let reached = 0; reached < reachable; reached++) {
    const useRight = enemy.summonsRight >= enemy.summonsLeft && enemy.summonsRight > 0
    const hpList = useRight ? enemy.summonHpRight : enemy.summonHpLeft
    const hp = hpList[hpList.length - 1] ?? pattern.hp ?? 1
    const scale = targetCount === 1 || targetCount === 'all'
      ? 1
      : TARGET_FALLOFF[reached] ?? TARGET_FALLOFF[2]
    const targetDamage = Math.max(0, Math.round(dmg * scale))
    const applied = Math.min(hp, targetDamage)
    damage += applied
    hpList[hpList.length - 1] = hp - applied
    if (hpList[hpList.length - 1] > 0) {
      allReachedDefeated = false
      continue
    }
    hpList.pop()
    if (useRight) enemy.summonsRight--
    else enemy.summonsLeft--
    dispersed++
  }
  remainingDamage = allReachedDefeated ? Math.max(0, dmg - damage) : 0
  const focusedRule = pattern.focusedBacklash
  const focusedBacklash = dispersed > 0
    && targetCount === 1
    && !pierceGuard
    && !!focusedRule
    && emotions.includes(focusedRule.emotion)
  const backlashRate = (pattern.backlashMaxHpRatePerUnit ?? 0)
    * (focusedBacklash ? focusedRule!.multiplier : 1)
  const backlashDamage = Math.min(
    enemy.hp,
    Math.max(0, Math.round(enemy.maxHp * backlashRate * dispersed)),
  )
  enemy.hp -= backlashDamage
  if (enemy.hp <= 0) enemy.dead = true

  const groggyEvery = Math.max(0, pattern.groggyEvery ?? 0)
  const defeatedTotal = enemy.summonsDefeated + dispersed
  const groggyTriggered = groggyEvery > 0 && defeatedTotal >= groggyEvery && !enemy.dead
  enemy.summonsDefeated = groggyEvery > 0 ? defeatedTotal % groggyEvery : defeatedTotal
  if (groggyTriggered) {
    enemy.groggyUntilTurn = state.turn
    enemy.groggyDamageMult = pattern.groggyDamageMult ?? 1.5
    // 다음 턴은 여왕이 정신을 차리는 데만 쓴다. 그 다음 턴 시작에야 새 일벌
    // 네 마리가 한 묶음으로 돌아오며, 회복 턴 도중에는 공격도 소환도 하지 않는다.
    enemy.summonRespawnTurn = state.turn + 2
    enemy.nextAttackTurn += 1
  }
  return { count: dispersed, damage, remainingDamage, backlashDamage, focusedBacklash, groggyTriggered, killed: enemy.dead }
}

export function applyIntent(state: BattleState, intent: Intent, mult: number, target: number): ApplyResult {
  const dealsDirectDamage = isDamageIntent(intent)
  const guardDamage = Math.round(state.guard * intent.guardAttackMultiplier)
  const baseDamage = Math.round(effectiveBase(intent) * mult * intent.castScale)
  const healAmt = Math.round(intent.heal * mult * intent.castScale * intent.castCount)
  const actualHeal = Math.min(healAmt, Math.max(0, state.playerMax - state.playerHp))
  const convertedDamage = Math.round(Math.max(0, healAmt - actualHeal) * intent.overhealDamageMultiplier)
  // 생명력 폭발은 회복 행동의 결과를 받아 이어지는 공격이다. 먼저 실제 체력을 채운 뒤
  // 최대 체력을 넘어 담기지 못한 양만 피해로 넘긴다.
  state.playerHp += actualHeal
  const dmg = baseDamage + guardDamage + convertedDamage
  // 동사 종류가 방어/회복이어도 수식어가 방어도나 초과 회복을 피해로 바꾸면
  // 실제 공격 계획을 만든다. 화면 미리보기와 덱 평가기는 이미 이 피해를 보여 주므로
  // 여기서 kind만 보고 건너뛰면 "표시만 공격하는" 거짓 선택지가 된다.
  const dealsConvertedDamage = guardDamage > 0 || convertedDamage > 0
  const dealsDamage = dealsDirectDamage || dealsConvertedDamage
  const plan: AttackPlan = {
    dmg,
    target,
    targetCount: intent.targetCount,
    hitCount: intent.hitCount * intent.castCount,
    pierceGuard: intent.pierceGuard,
    emotions: intent.emotions,
    tags: intent.tags,
    comboMatched: intent.combos.length > 0,
  }
  if (intent.timing === 'delayed') {
    state.pending = { ...plan, sentence: intent.sentence }
    return { text: `${intent.sentence} → 다음 턴에 ${dmg} 예약`, combos: intent.combos, hits: [], selfDmg: 0, heal: 0, killed: [], overflow: 0, summonsDispersed: 0, summonDamage: 0, summonBacklashDamage: 0, summonFocusedBacklash: false, summonGroggyTriggered: false, supportWebCut: null }
  }

  // 호위를 먼저 쓰러뜨려야 네 번째 일벌이 연 그로기가 바로 이 문장의 본 공격부터 적용된다.
  const summonDisperse = dealsDamage
    ? disperseTargetSummons(state, target, dmg, intent.targetCount, intent.pierceGuard, intent.emotions)
    : { count: 0, damage: 0, remainingDamage: dmg, backlashDamage: 0, focusedBacklash: false, groggyTriggered: false, killed: false }
  // 일벌과 본체는 한 줄의 킬체인이다. 같은 피해를 본체에 한 번 더 복제하지 않고,
  // 일벌 체력을 차례로 소모하고 남은 초과분만 그로기된 본체까지 이어 보낸다.
  const bodyPlan = { ...plan, dmg: summonDisperse.remainingDamage }
  const attack = dealsDamage && !summonDisperse.killed && bodyPlan.dmg > 0
    ? resolveAttack(state, bodyPlan)
    : { hits: [], killed: [], overflow: 0 }
  const supportWebCut = dealsDamage ? null : cutSpiderWebWithSupport(state, target, intent)
  let selfDmg = intent.recoil
  if (intent.targetMode === 'both') selfDmg += Math.round(dmg * 0.4)
  state.playerHp = Math.max(0, state.playerHp - selfDmg)
  const hpDamage = [...attack.hits].reduce((sum, hit) => sum + hit.dmg, 0) + summonDisperse.damage
  const lifeStolen = Math.min(
    Math.max(0, state.playerMax - state.playerHp),
    Math.max(0, Math.round(hpDamage * intent.lifeStealRate)),
  )
  state.playerHp += lifeStolen
  const label = dealsDamage ? `${dmg} 피해` : healAmt > 0 ? `${healAmt} 회복` : '준비 완료'
  return {
    text: `${intent.sentence} → ${label}` + (selfDmg ? ` · 자신 ${selfDmg}` : ''),
    combos: intent.combos,
    hits: attack.hits,
    selfDmg,
    heal: healAmt,
    convertedDamage,
    lifeStolen,
    killed: summonDisperse.killed && !attack.killed.includes(target) ? [target, ...attack.killed] : attack.killed,
    overflow: attack.overflow,
    summonsDispersed: summonDisperse.count,
    summonDamage: summonDisperse.damage,
    summonBacklashDamage: summonDisperse.backlashDamage,
    summonFocusedBacklash: summonDisperse.focusedBacklash,
    summonGroggyTriggered: summonDisperse.groggyTriggered,
    supportWebCut,
  }
}

export function applyPendingAttack(state: BattleState): ApplyResult | null {
  const pending = state.pending
  if (!pending) return null
  state.pending = null
  const summonDisperse = disperseTargetSummons(state, pending.target, pending.dmg, pending.targetCount, pending.pierceGuard, pending.emotions)
  const bodyPlan = { ...pending, dmg: summonDisperse.remainingDamage }
  const attack = summonDisperse.killed || bodyPlan.dmg <= 0
    ? { hits: [], killed: [], overflow: 0 }
    : resolveAttack(state, bodyPlan)
  return {
    text: `${pending.sentence} → 예약 발동`,
    combos: [],
    hits: attack.hits,
    selfDmg: 0,
    heal: 0,
    killed: summonDisperse.killed && !attack.killed.includes(pending.target) ? [pending.target, ...attack.killed] : attack.killed,
    overflow: attack.overflow,
    summonsDispersed: summonDisperse.count,
    summonDamage: summonDisperse.damage,
    summonBacklashDamage: summonDisperse.backlashDamage,
    summonFocusedBacklash: summonDisperse.focusedBacklash,
    summonGroggyTriggered: summonDisperse.groggyTriggered,
    supportWebCut: null,
  }
}

export interface EnemyStrike {
  text: string
  dealt: number
  idx: number
  /** 보스의 현재 체력 구간에 맞춘 피해 단계. 일반 적은 1이다. */
  attackStage: BossAttackStage
  /** 실제 재생할 공격 클립 단계. 패턴 지정이 없으면 체력 기반 attackStage를 따른다. */
  animationStage: BossAttackStage
  absorbed: number
  /** 강한 기술이 플레이어의 남은 방어를 수치와 무관하게 전부 지웠는가. */
  guardShattered: boolean
  /** 플레이어 매직실드가 이번 공격을 통째로 막았는가. */
  magicShieldBroken: boolean
  /** 실제 체력 피해에 비례해 적이 회복한 양. */
  lifeStolen: number
  /** 공격 직후 다음 플레이어 턴까지 받는 피해 증가 상태에 들어갔는가. */
  groggyEntered: boolean
  groggyDamageMult: number
  /** 예고 강공격을 완전히 막고 그로기를 열기 위해 필요한 방어. */
  guardRequired: number
  telegraphText: string | null
  /** 벌떼 돌격으로 이번 공격에 참가한 뒤 사라진 호위 수. */
  summonsReleased: number
  piercedGuard: boolean
  counterHit: HitFx | null
}

/** 다음 적 공격의 0~2 난수 한 칸을 실제 피해로 바꾼다. 화면 예상값과 실행이 함께 쓴다. */
export function enemyAttackDamageForRoll(
  state: Pick<BattleState, 'turn' | 'playerMax'>,
  enemy: EnemyInst,
  roll: number,
): number {
  const attackStep = nextEnemyAttackStep(enemy)
  if (attackStep?.damageScale === 0) return 0
  const attackStage = bossAttackStage(enemy)
  const escorts = enemy.summonsLeft + enemy.summonsRight
  const summonAttackBonus = escorts * (enemy.def.summonPattern?.attackBonusPerUnit ?? 0)
  const uncappedRaw = Math.round(
    (enemy.def.atk + (attackStep?.bonusAtk ?? 0) + summonAttackBonus + Math.max(0, Math.min(2, Math.floor(roll))))
      * statRankScale(enemy.attackRank)
      * enemy.atkMult
      * BOSS_ATTACK_MULTIPLIER[attackStage]
      * (attackStep?.damageScale ?? 1),
  )
  // 방어 위를 타고 넘는 거미줄 기술만 한 번에 최대 체력의 1/5까지 조인다.
  const webShowCap = Math.max(1, Math.round(state.playerMax * .2))
  const pressureBase = enemy.def.webPattern && attackStep?.pierceGuard ? Math.min(uncappedRaw, webShowCap) : uncappedRaw
  const damage = Math.round(pressureBase * bossTurnPressureMultiplier(enemy, state.turn))
  return Math.max(0, damage)
}

export function enemyAttackDamageRange(
  state: Pick<BattleState, 'turn' | 'playerMax'>,
  enemy: EnemyInst,
): [number, number] {
  return [enemyAttackDamageForRoll(state, enemy, 0), enemyAttackDamageForRoll(state, enemy, 2)]
}

export interface EnemyAttackDefense {
  dealt: number
  absorbed: number
  piercedGuard: boolean
  guardShattered: boolean
  magicShieldBlocked: boolean
  guardRequired: number
}

/** 실제 적 공격과 화면 예상이 같은 방어·관통 판정을 읽는다. 상태는 바꾸지 않는다. */
export function enemyAttackDefense(
  state: Pick<BattleState, 'turn' | 'guard'> & Partial<Pick<BattleState, 'playerMagicShield' | 'damageImmune'>>,
  enemy: EnemyInst,
  raw: number,
): EnemyAttackDefense {
  const summonPattern = enemy.def.summonPattern
  const escorts = summonCount(enemy)
  const summonsReleased = summonPattern?.releaseAt != null && escorts >= summonPattern.releaseAt ? escorts : 0
  const attackStep = nextEnemyAttackStep(enemy)
  const piercedGuard = !!attackStep?.pierceGuard
    || !!enemy.def.pierceGuard
    || summonsReleased > 0
    || (!!summonPattern?.pierceWhileEscorted && escorts > 0)
  const magicShieldBlocked = (state.playerMagicShield ?? 0) > 0
  const immune = !!state.damageImmune || magicShieldBlocked
  const guardRequired = enemyGuardBreakRequirement(enemy, state.turn)
  const guardShattered = !immune && !!attackStep?.shatterGuard && state.guard >= guardRequired
  const absorbed = immune ? 0 : guardShattered ? state.guard : piercedGuard ? 0 : Math.min(state.guard, raw)
  const dealt = immune ? 0 : guardShattered ? 0 : piercedGuard ? raw : Math.max(0, raw - state.guard)
  return { dealt, absorbed, piercedGuard, guardShattered, magicShieldBlocked, guardRequired }
}

export interface EnemyAttackForecast {
  raw: [number, number]
  dealt: [number, number]
  hpAfter: [number, number]
  piercedGuard: boolean
  guardShattered: boolean
  magicShieldBlocked: boolean
  guardRequired: number
  attackTurn: number
}

/** 다음 실제 공격 턴의 피해, 방어 적용값과 피격 후 체력을 한 번에 예상한다. */
export function enemyAttackForecast(
  state: Pick<BattleState, 'turn' | 'playerMax' | 'playerHp' | 'guard'>
    & Partial<Pick<BattleState, 'playerMagicShield' | 'damageImmune'>>,
  enemy: EnemyInst,
): EnemyAttackForecast {
  const attackTurn = Math.max(state.turn, enemy.nextAttackTurn)
  const projectedState = { ...state, turn: attackTurn }
  const raw = enemyAttackDamageRange(projectedState, enemy)
  const low = enemyAttackDefense(projectedState, enemy, raw[0])
  const high = enemyAttackDefense(projectedState, enemy, raw[1])
  return {
    raw,
    dealt: [low.dealt, high.dealt],
    hpAfter: [Math.max(0, state.playerHp - high.dealt), Math.max(0, state.playerHp - low.dealt)],
    piercedGuard: high.piercedGuard,
    guardShattered: high.guardShattered,
    magicShieldBlocked: high.magicShieldBlocked,
    guardRequired: high.guardRequired,
    attackTurn,
  }
}

export function enemyTurn(state: BattleState, rng: () => number, phase: 'first' | 'second', transformRaw: (raw: number) => number = raw => raw, adjudicate: typeof enemyAttackDefense = enemyAttackDefense): EnemyStrike[] {
  const strikes: EnemyStrike[] = []
  const front = frontIdx(state)
  if (front < 0) return strikes
  engageFront(state)
  const enemy = state.enemies[front]
  if (enemy.initiativePhase !== phase || state.turn < enemy.nextAttackTurn) return strikes
  // 일벌 전멸 직후의 한 턴은 여왕벌이 그로기에서 돌아오는 회복 턴이다.
  // 새 호위를 부를 수 있는 다음 턴까지 공격을 포함한 모든 행동을 건너뛴다.
  if (enemy.def.summonPattern && summonCount(enemy) === 0 && state.turn < enemy.summonRespawnTurn) return strikes

  const attackStep = nextEnemyAttackStep(enemy)
  const attackStage = bossAttackStage(enemy)
  const animationStage = attackStep?.animationStage ?? attackStage
  const attackMultiplier = BOSS_ATTACK_MULTIPLIER[attackStage]
  const summonPattern = enemy.def.summonPattern
  const escorts = summonCount(enemy)
  const summonAttackBonus = escorts * (summonPattern?.attackBonusPerUnit ?? 0)
  const summonsReleased = summonPattern?.releaseAt != null && escorts >= summonPattern.releaseAt ? escorts : 0
  const raw = Math.max(0, Math.round(transformRaw(enemyAttackDamageForRoll(state, enemy, Math.floor(rng() * 3)))))
  // 모여든 호위가 한꺼번에 돌격하면 방패 위로 넘어 들어온다. 화면 예상과 같은
  // 순수 판정을 먼저 읽고, 이 실행부에서만 체력과 방어 상태를 실제로 바꾼다.
  const defense = adjudicate(state, enemy, raw)
  const {
    dealt,
    absorbed,
    piercedGuard,
    guardShattered,
    guardRequired,
    magicShieldBlocked: magicShieldBroken,
  } = defense
  if (magicShieldBroken) state.playerMagicShield = Math.max(0, (state.playerMagicShield ?? 0) - 1)
  const immune = !!state.damageImmune || magicShieldBroken
  state.playerHp -= dealt
  const lifeStolen = Math.min(
    Math.max(0, enemy.maxHp - enemy.hp),
    Math.max(0, Math.round(dealt * (attackStep?.lifeStealRate ?? 0))),
  )
  enemy.hp += lifeStolen
  const counterBase = magicShieldBroken ? raw : dealt + absorbed
  const counterHit = counterBase > 0 && state.counter
    ? damageEnemy(state, front, Math.round(counterBase * (state.counterFull ? 1 : .5)), false, [])
    : null
  const groggyEntered = !!attackStep?.groggyDamageMult
    && (!attackStep.groggyRequiresGuardShatter || guardShattered)
    && !enemy.dead
  if (groggyEntered) {
    // 선공에서 막으면 같은 턴 본행동, 후공에서 막으면 다음 턴 본행동까지 정확히
    // 한 번만 열린다. 평타 반복 RNG가 그로기 보상 횟수까지 바꾸지 않게 한다.
    enemy.groggyUntilTurn = state.turn + (phase === 'second' ? 1 : 0)
    enemy.groggyDamageMult = attackStep.groggyDamageMult!
  }
  strikes.push({
    text: `${enemy.def.name}의 ${summonsReleased > 0 ? '벌떼 돌격' : attackStep?.name ?? '습격'} → ${dealt} 피해`
      + (enemy.def.boss && attackStage > 1 ? ` (공격 ${attackStage}단계 ×${attackMultiplier.toFixed(2)})` : '')
      + (summonAttackBonus > 0 ? ` (호위 공격 +${summonAttackBonus})` : '')
      + (immune ? ' (무적)' : '')
      + (guardShattered ? ` (방어 ${absorbed} 전량 파괴)` : '')
      + (attackStep?.shatterGuard && !guardShattered && absorbed > 0 ? ` (방어 ${absorbed}/${guardRequired} · 그로기 실패)` : '')
      + (lifeStolen > 0 ? ` (흡혈 ${lifeStolen})` : '')
      + (groggyEntered ? ` (그로기 · 받는 피해 ×${enemy.groggyDamageMult.toFixed(1)} · 다음 공격 한 턴 스킵)` : '')
      + (piercedGuard ? ' (방어 관통)' : absorbed && !guardShattered ? ` (방어 ${absorbed} 흡수)` : ''),
    dealt,
    idx: front,
    attackStage,
    animationStage,
    absorbed,
    guardShattered,
    magicShieldBroken,
    lifeStolen,
    groggyEntered,
    groggyDamageMult: enemy.groggyDamageMult,
    guardRequired,
    telegraphText: attackStep?.telegraphText ?? null,
    summonsReleased,
    piercedGuard,
    counterHit,
  })
  if (summonsReleased > 0) {
    enemy.summonsLeft = 0
    enemy.summonsRight = 0
    enemy.summonHpLeft = []
    enemy.summonHpRight = []
  }
  enemy.attacksMade++
  advanceEnemyAttackPattern(enemy, rng)
  state.guard -= absorbed
  if (state.guard <= 0) state.guard = 0
  enemy.nextAttackTurn = state.turn + enemy.def.every
  // 강공격을 완전히 막아 낸 대가는 받는 피해 증가만으로는 체감되지 않았다. 휘청인
  // 적은 예정된 다음 공격을 통째로 한 번 거른다 — 일벌 전멸 그로기와 같은 규칙이다.
  if (groggyEntered) enemy.nextAttackTurn += Math.max(1, enemy.def.every)
  if (enemy.def.initiative === 'first') enemy.initiativePhase = phase === 'first' ? 'second' : 'first'
  if (enemy.dead) engageFront(state)
  return strikes
}
