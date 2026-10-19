import type { ItemForgeCheckpoint } from '@core/itemForge'
/**
 * 아이템 제련 뷰 — 감탄 문장을 망치질하듯 완성하는 전투와 같은 패턴.
 *  · 상단: 제련 문장이 점차 완성되는 체인
 *  · 그 아래: 아이템 일러스트(좌) + 감정 스탯표(우, ▲로 증가 표시)
 *  · 하단: 감탄/정도/평가 선택지를 "텍스트"로 순차 선택(버튼 아님, 인게임 스타일)
 */

import type { ItemDef, StatKey } from '@data/items'
import type { ExclaimWord } from '@data/items'
import { EXCLAIM_SLOTS, ITEM_BLESS_CHANCE_PER_GRADE, ITEM_BLESS_POOL, STAT_LABEL, exclaimModsFor, rollExclaimChoices, rollExclaimMultipliers } from '@data/items'
import type { OwnedItem } from '@core/player'
import { BACKGROUNDS, FORGE_HAMMER_ART, ITEM_ART } from '@/assets'
import { itemArt } from '@/ui/Icons'
import { RARITY_LABEL, type Word } from '@core/types'
import { wordCardInnerHtml } from '@/ui/WordCardFace'
import { spawnCardCommitBurst } from '@/ui/CardCommitBurst'
import { GameAudio } from '@/audio/GameAudio'

interface Opts {
  checkpoint?: ItemForgeCheckpoint
  onCheckpoint?: (checkpoint: ItemForgeCheckpoint) => void
  item: ItemDef
  /** 전투에서 들고 온 보상등급 — 높을수록 행운 감탄(팅! 추가 스탯)이 잘 붙는다. */
  grade?: number
  onDone: (result: OwnedItem) => void
}

const STAT_ORDER: StatKey[] = ['hp', 'atk', 'guard', 'heal', 'luck']

// 선택의 손맛이 끊기지 않도록 카드 이동 → 망치 접촉 → 다음 타격을 짧은 한 박자로 묶는다.
const FORGE_TRANSFER_DURATION_MS = 500
const FORGE_TRANSFER_STAGGER_MS = 45
const FORGE_HAMMER_CONTACT_MS = 220
const FORGE_STRIKE_DURATION_MS = 590
const FORGE_COMPLETE_HOLD_MS = 420

export class ItemExclaimView {
  private picks: Record<string, string | undefined> = {}
  private slotIndex = 0
  private finalizing = false
  private timers: number[] = []
  private transientEffects: HTMLElement[] = []
  private forgeImpactSerial = 0
  private pendingForgeStrikes = 0
  private completionShown = false
  private forgeStrikeRunning = false
  private forgeStrikeQueue: { stats: StatKey[]; beat: number }[] = []
  private rarityMultipliers: [number, number, number]
  /** 이번 재련에서만 열리는 칸별 감탄사. 입장할 때 한 번 굴리고 끝까지 유지한다. */
  private choices: Record<string, ExclaimWord[]>
  // 행운 감탄 — 이 화면에서 추가 스탯이 붙은 단어들. 키는 `슬롯:단어id`.
  private blessed = new Map<string, { stat: StatKey; n: number }>()
  // 팅! 연출은 처음 드러날 때 한 번만.
  private revealed = new Set<string>()

  constructor(private root: HTMLElement, private opts: Opts) {
    this.rarityMultipliers = rollExclaimMultipliers(opts.item.rarity)
    this.choices = rollExclaimChoices()
    // 입장 시 한 번만 굴린다 — 슬롯을 오가도 붙은 자리는 그대로다.
    const chance = Math.min(0.4, (opts.grade ?? 0) * ITEM_BLESS_CHANCE_PER_GRADE)
    for (const slot of EXCLAIM_SLOTS)
      for (const w of this.choices[slot.key] ?? [])
        if (Math.random() < chance) {
          this.blessed.set(`${slot.key}:${w.id}`, ITEM_BLESS_POOL[Math.floor(Math.random() * ITEM_BLESS_POOL.length)])
        }
    if (opts.checkpoint) {
      const c = structuredClone(opts.checkpoint)
      this.picks = c.picks; this.slotIndex = c.slotIndex; this.rarityMultipliers = c.multipliers
      this.choices = c.choices; this.blessed = new Map(c.blessed)
    }
    this.checkpoint()
    this.mount()
    if (this.complete()) this.finalize()
  }
  private checkpoint() {
    this.opts.onCheckpoint?.(structuredClone({ picks: this.picks, slotIndex: this.slotIndex,
      multipliers: this.rarityMultipliers, choices: this.choices, blessed: [...this.blessed] }))
  }
  destroy() {
    this.timers.forEach((t) => clearTimeout(t))
    this.transientEffects.forEach((effect) => effect.remove())
    this.transientEffects = []
  }

  private totals() {
    const t: Record<StatKey, number> = { ...this.opts.item.base }
    EXCLAIM_SLOTS.forEach((slot, slotIndex) => {
      const w = slot.words.find((x) => x.id === this.picks[slot.key])
      if (!w) return
      const mods = exclaimModsFor(this.rarityMultipliers[slotIndex], w.mods)
      for (const k of STAT_ORDER) t[k] += mods[k] ?? 0
      const bless = this.blessed.get(`${slot.key}:${w.id}`)
      if (bless) t[bless.stat] += bless.n
    })
    return t
  }

  private complete() {
    return EXCLAIM_SLOTS.every((s) => this.picks[s.key])
  }

  private mount() {
    const item = this.opts.item
    // 아이템 원화가 있으면 패널을 통째로 채운다 — 액자 안에 작은 그림을 또 끼우지 않는다.
    const art = ITEM_ART[item.art]
    const illust = art
      ? `<img class="iforge-illust-art" src="${art}" alt="" aria-hidden="true">`
      : `<div class="art">${itemArt(item.art)}</div>`
    this.root.innerHTML = `
      <div class="scene item-scene" style="background-image:url(${BACKGROUNDS.bg001})">
        <div class="slot-step iforge-steps" id="esteps"></div>
        <div class="iforge">
          <div class="iforge-chain" id="chain"></div>

          <div class="iforge-top">
            <div class="iforge-illust glass${art ? ' has-art' : ''}">
              ${illust}
              <div class="iforge-enchantment" id="forge-core" aria-hidden="true">
                <i class="forge-orbit orbit-a"></i>
                <i class="forge-orbit orbit-b"></i>
                <span class="forge-core-mark">✦</span>
                <span class="forge-sparks"></span>
              </div>
              <img class="forge-hammer" src="${FORGE_HAMMER_ART}" alt="" aria-hidden="true">
              <span class="forge-impact-word" aria-hidden="true">쾅!</span>
              <div class="iforge-illust-copy">
                <div class="glint">✦ 제련할 아이템 ✦</div>
                <div class="iname">${item.name}</div>
                <div class="grade">등급 · ${RARITY_LABEL[item.rarity]}</div>
              </div>
            </div>
            <div class="iforge-stats glass">
              <div class="dock-title">제련 스탯</div>
              <div class="stat-list" id="stats"></div>
              <div class="iforge-flavor">“${item.flavor}”</div>
            </div>
          </div>

          <div class="iforge-complete" id="forge-complete" aria-live="polite">
            <span>✦</span><b>제련 완료</b><em>세 마디의 힘이 아이템에 새겨졌다</em><span>✦</span>
          </div>

          <div class="iforge-choose">
            <div class="word-row" id="egrid"></div>
            <div class="iforge-choose-title"><b>제련 문장</b><span>세 마디를 골라 아이템에 힘을 새긴다</span></div>
          </div>
        </div>
      </div>`

    // 확정 버튼도 되돌리기도 없다 — 단어 선택처럼 고른 즉시 확정되고, 셋을 다 고르면 발동한다.
    this.refresh()
  }

  /** 선택 카드의 수치를 빛 조각으로 바꿔 실제 아이템 중심까지 운반한다. */
  private playForgeTransfer(source: HTMLElement, gains: Partial<Record<StatKey, number>>, beat: number) {
    const target = this.q('#forge-core').getBoundingClientRect()
    const from = source.getBoundingClientRect()
    const entries = STAT_ORDER.filter((stat) => (gains[stat] ?? 0) > 0)
    if (!entries.length) return
    this.pendingForgeStrikes += 1
    entries.forEach((stat, index) => {
      const value = gains[stat] ?? 0
      const mote = document.createElement('span')
      mote.className = `forge-mote forge-mote-${stat}`
      mote.innerHTML = `<i>+</i><b>${STAT_LABEL[stat]} +${value}</b>`
      mote.style.left = `${from.left + from.width / 2 - 34 + index * 12}px`
      mote.style.top = `${from.top + from.height * 0.34 + index * 14}px`
      document.body.append(mote)
      this.transientEffects.push(mote)

      const dx = target.left + target.width / 2 - (from.left + from.width / 2)
      const dy = target.top + target.height / 2 - (from.top + from.height * 0.34)
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const delay = reducedMotion ? index * 15 : index * FORGE_TRANSFER_STAGGER_MS
      const duration = reducedMotion ? 150 : FORGE_TRANSFER_DURATION_MS
      mote.animate([
        { transform: 'translate3d(0, 0, 0) scale(.72) rotate(-8deg)', opacity: 0 },
        { transform: 'translate3d(0, -24px, 0) scale(1.12) rotate(3deg)', opacity: 1, offset: .18 },
        { transform: `translate3d(${dx * .52}px, ${dy * .22 - 70}px, 0) scale(1.02) rotate(-4deg)`, opacity: 1, offset: .52 },
        { transform: `translate3d(${dx * .9}px, ${dy * .86}px, 0) scale(.92) rotate(7deg)`, opacity: 1, offset: .86 },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(.16) rotate(12deg)`, opacity: .12 },
      ], { duration, delay, easing: 'cubic-bezier(.2,.84,.2,1)', fill: 'forwards' })

      this.timers.push(window.setTimeout(() => {
        mote.remove()
        this.transientEffects = this.transientEffects.filter((effect) => effect !== mote)
        if (index === entries.length - 1) this.igniteForgeCore(entries, beat)
      }, duration + delay - 20))
    })
  }

  /** 빠르게 카드를 골라도 카드별 타격이 겹쳐 사라지지 않도록 한 번씩 순서대로 보낸다. */
  private igniteForgeCore(stats: StatKey[], beat: number) {
    this.forgeStrikeQueue.push({ stats, beat })
    this.runNextForgeStrike()
  }

  /** 한 카드의 빛 조각을 망치 한 번과 폭발 한 번으로 함께 적용한다. */
  private runNextForgeStrike() {
    if (this.forgeStrikeRunning) return
    const strike = this.forgeStrikeQueue.shift()
    if (!strike) return
    this.forgeStrikeRunning = true
    const { stats, beat } = strike
    const core = this.q('#forge-core')
    const panel = this.q('.iforge-illust')
    const scene = this.q('.item-scene')
    const statRows = stats
      .map((stat) => this.root.querySelector<HTMLElement>(`.iforge-stats [data-stat="${stat}"]`))
      .filter((row): row is HTMLElement => Boolean(row))
    const beatKey = String(beat + 1)
    const impactKey = String(++this.forgeImpactSerial)
    core.dataset.stat = stats[0]
    core.dataset.beat = beatKey
    core.dataset.impact = impactKey
    panel.dataset.impact = impactKey
    statRows.forEach((row) => { row.dataset.impact = impactKey })
    panel.classList.remove('forge-hammering', 'forge-impact')
    core.classList.remove('impact')
    statRows.forEach((row) => row.classList.remove('forge-gained'))
    void panel.offsetWidth
    panel.classList.add('forge-hammering')

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const contactDelay = reducedMotion ? 20 : FORGE_HAMMER_CONTACT_MS
    this.timers.push(window.setTimeout(() => {
      if (panel.dataset.impact !== impactKey) return
      GameAudio.playForgeHit(beat)
      const panelRect = panel.getBoundingClientRect()
      const coreRect = core.getBoundingClientRect()
      const scaleX = panelRect.width / panel.offsetWidth || 1
      const scaleY = panelRect.height / panel.offsetHeight || 1
      const color = getComputedStyle(core).getPropertyValue('--forge-impact-color').trim() || '#ffd276'
      spawnCardCommitBurst(
        panel,
        (coreRect.left + coreRect.width / 2 - panelRect.left) / scaleX,
        (coreRect.top + coreRect.height / 2 - panelRect.top) / scaleY,
        color,
      ).classList.add('forge-card-burst')

      core.classList.remove('impact')
      panel.classList.remove('forge-impact')
      scene.classList.remove('forge-screen-hit')
      statRows.forEach((row) => row.classList.remove('forge-gained'))
      void core.offsetWidth
      core.classList.add('impact')
      panel.classList.add('forge-impact')
      scene.classList.add('forge-screen-hit')
      statRows.forEach((row) => row.classList.add('forge-gained'))
      this.timers.push(window.setTimeout(() => scene.classList.remove('forge-screen-hit'), reducedMotion ? 20 : 320))
    }, contactDelay))

    this.timers.push(window.setTimeout(() => {
      if (core.dataset.impact === impactKey) core.classList.remove('impact')
      if (panel.dataset.impact === impactKey) panel.classList.remove('forge-hammering', 'forge-impact')
      statRows.forEach((row) => {
        if (row.dataset.impact === impactKey) row.classList.remove('forge-gained')
      })
      this.pendingForgeStrikes = Math.max(0, this.pendingForgeStrikes - 1)
      this.forgeStrikeRunning = false
      this.runNextForgeStrike()
      if (this.finalizing && this.pendingForgeStrikes === 0) this.finishForging()
    }, reducedMotion ? 90 : FORGE_STRIKE_DURATION_MS))
  }

  /** 대기 중인 마지막 카드별 망치질까지 끝난 뒤에만 완료 봉인과 실제 획득을 진행한다. */
  private finishForging() {
    if (this.completionShown) return
    this.completionShown = true
    const item = this.opts.item
    const scene = this.q('.item-scene')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scene.classList.add('is-forged')
    this.q('#forge-complete').classList.add('show')
    this.timers.push(window.setTimeout(() => {
      const totals = this.totals()
      const line = EXCLAIM_SLOTS.map((s) => s.words.find((x) => x.id === this.picks[s.key])?.text ?? '').join(' ')
      this.opts.onDone({
        id: item.id,
        name: item.name,
        rarity: item.rarity,
        art: item.art,
        line,
        stats: { hp: totals.hp, atk: totals.atk, guard: totals.guard, heal: totals.heal, luck: totals.luck },
        passive: item.passive,
      })
    }, reducedMotion ? 360 : FORGE_COMPLETE_HOLD_MS))
  }

  // 모든 감탄사를 고르면 자동 확정하되, 아직 날아가는 힘과 망치질이 있으면 끝까지 기다린다.
  private finalize() {
    if (this.finalizing || !this.complete()) return
    this.finalizing = true
    const scene = this.q('.item-scene')
    scene.classList.add('is-finalizing')
    this.q('#chain').classList.add('sparkle')
    if (this.pendingForgeStrikes === 0) this.finishForging()
  }

  private q<T extends HTMLElement = HTMLElement>(s: string): T {
    return this.root.querySelector(s) as T
  }

  private refresh() {
    // 상단 감탄 체인
    this.q('#chain').innerHTML = EXCLAIM_SLOTS.map((s) => {
      const w = s.words.find((x) => x.id === this.picks[s.key])
      return w
        ? `<span class="chain-word">${w.text}</span>`
        : `<span class="chain-ghost">${s.label}</span>`
    }).join(' ')

    // 스탯표(▲ 증가)
    const totals = this.totals()
    this.q('#stats').innerHTML = STAT_ORDER.map((k) => {
      const up = totals[k] - this.opts.item.base[k]
      return `<div class="stat" data-stat="${k}"><span class="sl">${STAT_LABEL[k]}</span>
        <span class="sv">${totals[k]}${up ? `<span class="up">▲${up}</span>` : ''}</span></div>`
    }).join('')

    // 슬롯 스텝 — 지금 어느 마디를 고르는 중인지만 알린다. 고른 마디는 되돌리지 않는다.
    this.q('#esteps').innerHTML = EXCLAIM_SLOTS.map((s, i) => {
      const cls = i === this.slotIndex ? 'active' : this.picks[s.key] ? 'done' : ''
      return `<span class="step ${cls}"><b>${i + 1}</b> ${s.label}</span>`
    }).join('<span class="sep">·</span>')

    // 현재 슬롯의 텍스트 선택지 — 행운 감탄이 붙은 칸은 금빛으로 빛나고, 첫 등장에만 팅!.
    const slot = EXCLAIM_SLOTS[this.slotIndex]
    const refilling = Object.values(this.picks).some(Boolean) && !this.complete()
    this.q('#egrid').innerHTML = (this.choices[slot.key] ?? [])
      .map((w, choiceIndex) => {
        const picked = this.picks[slot.key] === w.id
        const key = `${slot.key}:${w.id}`
        const bless = this.blessed.get(key)
        const fresh = bless && !this.revealed.has(key)
        if (fresh) {
          this.revealed.add(key)
        }
        const rarityMultiplier = this.rarityMultipliers[this.slotIndex]
        const effectiveMods = exclaimModsFor(rarityMultiplier, w.mods)
        const effectiveNote = Object.entries(effectiveMods)
          .map(([stat, value]) => `${STAT_LABEL[stat as StatKey]} +${value}`)
          .join(' · ')
        const extraNote = bless ? `${STAT_LABEL[bless.stat]} +${bless.n}` : ''
        const cardNote = `<span class="item-card-main-stat">${effectiveNote}</span>${extraNote
          ? `<span class="item-card-extra-stat">${extraNote}</span>`
          : ''}`
        const accessibleNote = [effectiveNote, extraNote].filter(Boolean).join(', ')
        const rarityBoosted = rarityMultiplier > 1
        const rarityBonusHtml = rarityBoosted
          ? '<span class="rarity-bonus">등급 보너스 +1점</span>'
          : ''
        const primaryStat = Object.keys(w.mods)[0] as StatKey | undefined
        const mood = primaryStat === 'atk'
          ? 'attack'
          : primaryStat === 'guard'
            ? 'guard'
            : primaryStat === 'heal'
              ? 'heal'
              : primaryStat === 'luck' ? 'gamble' : 'buff'
        const cardWord: Word = {
          id: `item-exclaim-${slot.key}-${w.id}`,
          text: w.text,
          slot: slot.key,
          tags: [],
          emotion: 'neutral',
          note: effectiveNote,
          rarity: this.opts.item.rarity,
          kind: primaryStat === 'atk' ? 'attack' : primaryStat === 'guard' ? 'guard' : primaryStat === 'heal' ? 'heal' : undefined,
        }
        const bonuses = rarityBonusHtml
          ? `<span class="item-card-bonuses">${rarityBonusHtml}</span>`
          : ''
        // 아이템 등급을 word-card 호스트에 직접 붙여 공용 희귀/영웅/전설 포일과
        // 전역 FoilShader 관찰자가 전투 카드와 같은 방식으로 이 선택지도 처리한다.
        return `<button class="word-cell iforge-word-card word-card mood-${mood} rarity-${this.opts.item.rarity} ${picked ? 'picked' : ''} ${rarityBoosted ? 'rarity-boosted' : ''} ${bless ? 'blessed' : ''} ${fresh ? 'fresh' : ''} ${refilling ? 'forge-refill' : ''}"
          style="--card-x:0px;--card-z:1;--refill-index:${choiceIndex}" data-id="${w.id}" aria-label="${w.text}, ${accessibleNote} 선택">
          ${wordCardInnerHtml(cardWord, {
            note: cardNote,
            footer: slot.label,
            overlay: bonuses,
            artUrl: ITEM_ART[this.opts.item.art],
            // 제련 감탄사는 전투 단어가 아니므로 잉크를 소비하지 않는다.
            hideMeta: true,
          })}
        </button>`
      })
      .join('')
    this.q('#egrid')
      .querySelectorAll<HTMLElement>('.word-cell')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          if (this.finalizing) return
          this.picks[slot.key] = btn.dataset.id
          const pickedWord = slot.words.find((word) => word.id === btn.dataset.id)
          if (pickedWord) {
            const gains: Partial<Record<StatKey, number>> = { ...exclaimModsFor(this.rarityMultipliers[this.slotIndex], pickedWord.mods) }
            const bless = this.blessed.get(`${slot.key}:${pickedWord.id}`)
            if (bless) gains[bless.stat] = (gains[bless.stat] ?? 0) + bless.n
            this.playForgeTransfer(btn, gains, this.slotIndex)
          }
          // 다음 빈 슬롯으로 진행
          let next = this.slotIndex + 1
          while (next < EXCLAIM_SLOTS.length && this.picks[EXCLAIM_SLOTS[next].key]) next++
          this.slotIndex = Math.min(next, EXCLAIM_SLOTS.length - 1)
          this.checkpoint()
          this.refresh()
          // 전부 고르면 단어 선택처럼 자동 확정
          if (this.complete()) this.finalize()
        }),
      )
  }
}
