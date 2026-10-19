import { icon as UIIcons, itemArt } from '@/ui/Icons'
import { itemStatsText } from '@core/player'
import { inkRemaining, slotId, resetIntegratedSlot } from '@core/integratedSentences'
import { integratedPlan } from '@core/integratedCombat'
import { TokenActor } from './TokenActor'
import { nextEnemyAttackStep } from '@/sim/reference'
import { BossCinematic } from './BossCinematic'
import { VIDEO } from '@/assets'
import './steering.css'
import { bossIntel, pickIntegratedItem, finishIntegratedItem } from '@core/steeringBridge'
import { stageFor } from '@data/stages'
import { pickFieldBackground } from '@data/backgrounds'
import { ALL_ITEMS } from '@data/items'
import { ItemExclaimView } from './ItemExclaimView'
import { completeIntegratedReward } from '@core/steering'
import { ST_INTEGRATED, integratedEffectSummary } from '@/localization/steeringIntegrated'

import { BACKGROUNDS, TOKEN_FACES, INK_UI } from '@/assets'
import { CHARACTER_VISUALS, type CharacterVisualDef } from '@data/characters'
import { ROLES, INTEGRATED_ROLES, ROLE_LABELS, roleKind, type Role, type Lane } from '@data/steering'
import { ST } from '@/localization/steering'
import { FORECAST as FT, actionLines, cardImpactHint, forecastSentence, outcomeFacts } from '@/localization/steeringForecast'
import { advanceTurn, cardFor, chooseCard, compileSentence, createSteeringRun, describeEffect,
  formFor, loadSteeringRun, redraw, resolveTurn, saveSteeringRun, sentencePhrases, takeReward,
  preparedEffects, canPlaceCard, slotsFor, encounterSubjects,
  type Resolution, type SteeringRun } from '@core/steering'
import { wordCardFrontHtml } from '@/ui/WordCardFace'
import type { Word } from '@core/types'
import { destroyCharacterModels, mountCharacterModel, playCharacterAnimation } from './BattleCharacterModel'
import { GameAudio } from '@/audio/GameAudio'
import { Howler } from 'howler'
import { combatBeats, type CombatBeat } from '@core/steeringBeats'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const label = (lane: Lane, integrated = false) => integrated ? lane === 'situation' ? '문장 1' : '문장 2' : lane === 'situation' ? ST.situation : ST.action

export class SteeringView {
  private run: SteeringRun | null = null
  private forge: ItemExclaimView | null = null
  private token: TokenActor | null = null
  private spokenWarnings = new Set<string>()
  private bossMovie: BossCinematic | null = null
  private lane: Lane = 'situation'
  private role: Role | null = null
  private inspected: string | null = null
  private picked: string | null = null
  private dragging: string | null = null
  private result: Resolution | null = null
  private muted = true
  private menu = true
  private helpOpen = false
  private deckOpen = false
  private roleDetailOpen = false
  private referencePickerOpen = false
  private effectPanelOpen = false
  private newConfirm = false
  private storageOk = true
  private busy = false
  private finishing = false
  private timer = 0
  private rollTimer = 0
  private rollKey = ''
  private rolling = false
  private arenaKey = ''
  private onClick = (event: Event) => this.click(event)
  private onHover = (event: Event) => this.hover(event)
  private onKey = (event: KeyboardEvent) => this.key(event)
  private pointerDrag: { id: string; pointerId: number; x: number; y: number } | null = null
  private suppressClicksUntil = 0
  private onPointerDown = (event: PointerEvent) => {
    const source = (event.target as HTMLElement).closest<HTMLElement>('[data-card],[data-slot-card]')
    const id = source?.dataset.card ?? source?.dataset.slotCard
    if (!id || event.button !== 0 || this.busy || this.rolling || this.result || this.run?.phase !== 'battle' || source?.dataset.reward) return
    this.pointerDrag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }
  private onPointerMove = (event: PointerEvent) => {
    const drag = this.pointerDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!this.dragging && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return
    event.preventDefault()
    if (!this.dragging) {
      this.dragging = drag.id; this.picked = null
      this.root.setPointerCapture(event.pointerId)
      this.updateInspection(drag.id)
      this.root.classList.add('st-dragging')
      const ghost = document.createElement('div')
      ghost.className = 'st-drag-ghost'; ghost.textContent = `${cardFor(this.run!, drag.id).glyph} ${cardFor(this.run!, drag.id).name}`
      this.root.append(ghost)
      this.root.querySelectorAll<HTMLElement>('[data-drop-lane]').forEach(slot => slot.classList.toggle('st-drop-valid', canPlaceCard(this.run!, slot.dataset.dropLane as Lane, drag.id, slot.dataset.dropRole as Role | undefined)))
    }
    const rect = this.root.getBoundingClientRect(), scale = rect.width / 1920
    const ghost = this.root.querySelector<HTMLElement>('.st-drag-ghost')!
    ghost.style.left = `${(event.clientX - rect.left) / scale}px`; ghost.style.top = `${(event.clientY - rect.top) / scale}px`
    const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drop-lane]')
    this.root.querySelectorAll('.st-drop-over').forEach(el => el.classList.remove('st-drop-over'))
    if (slot && canPlaceCard(this.run!, slot.dataset.dropLane as Lane, drag.id, slot.dataset.dropRole as Role | undefined)) slot.classList.add('st-drop-over')
  }
  private onPointerUp = (event: PointerEvent) => {
    if (!this.pointerDrag || event.pointerId !== this.pointerDrag.pointerId) return
    const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drop-lane]')
    if (this.dragging) this.suppressClicksUntil = performance.now() + 200
    if (slot && this.dragging && canPlaceCard(this.run!, slot.dataset.dropLane as Lane, this.dragging, slot.dataset.dropRole as Role | undefined)) {
      event.preventDefault(); this.placeCard(slot.dataset.dropLane as Lane, this.dragging, slot.dataset.dropRole as Role | undefined)
    }
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId)
    this.pointerDrag = null
    this.endDrag()
  }
  private onPointerCancel = () => { this.pointerDrag = null; this.endDrag() }

  constructor(private root: HTMLElement, private options: { run?: SteeringRun; onHome?: () => void; onSettings?: () => void; onFinish?: (run: SteeringRun) => void } = {}) {
    this.run = options.run ?? loadSteeringRun(); this.menu = !options.run; this.muted = !options.run
    root.classList.add('steering-root')
    root.addEventListener('click', this.onClick)
    root.addEventListener('pointerover', this.onHover)
    root.addEventListener('focusin', this.onHover)
    root.addEventListener('pointerdown', this.onPointerDown)
    root.addEventListener('pointermove', this.onPointerMove)
    root.addEventListener('pointerup', this.onPointerUp)
    root.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('keydown', this.onKey)
    this.render()
  }
  destroy() {
    this.token?.destroy(); this.token = null
    this.bossMovie?.destroy()
    this.forge?.destroy()
    this.root.classList.remove('steering-root', 'st-integrated-root', 'st-in-battle')
    clearTimeout(this.timer)
    clearTimeout(this.rollTimer)
    destroyCharacterModels(this.root)
    this.root.removeEventListener('click', this.onClick)
    this.root.removeEventListener('pointerover', this.onHover)
    this.root.removeEventListener('focusin', this.onHover)
    this.root.removeEventListener('pointerdown', this.onPointerDown)
    this.root.removeEventListener('pointermove', this.onPointerMove)
    this.root.removeEventListener('pointerup', this.onPointerUp)
    this.root.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('keydown', this.onKey)
  }
  private persist() { if (this.run) this.storageOk = saveSteeringRun(this.run) }
  private sound(effect: 'shield' | 'swordHit' | 'win') {
    if (this.muted) return
    GameAudio.play(effect)
  }
  private render() {
    if (this.menu) { this.renderMenu(); return }
    if (!this.run) return
    if (this.run.product?.rewardStep === 'forge' && this.run.phase === 'reward') { this.openForge(); return }
    if (!this.result && this.run.product?.rewardStep === 'complete' && this.run.phase === 'reward') { this.run = completeIntegratedReward(this.run); this.persist() }
    if (!this.result && this.run.product && ['won', 'lost'].includes(this.run.phase) && this.options.onFinish) { if (!this.finishing) { this.finishing = true; queueMicrotask(() => this.options.onFinish?.(this.run!)) } return }
    if (!this.root.querySelector('.st-game')) {
      this.root.innerHTML = `<main class="st-game"><header class="st-hud"></header><section class="st-arena battle" data-weather="sunny" aria-label="전장"></section><section class="st-workspace"></section><footer class="st-footer"></footer><div class="st-modal-host"></div><div class="stage-area st-token-stage"></div></main>`
      this.arenaKey = ''
    }
    const run = this.run
    if (run.product && run.phase === 'battle' && run.floor === 5 && !run.product.cinematicFloors.includes(run.floor)) {
      run.product.cinematicFloors.push(run.floor); this.persist()
      const src = VIDEO.bossCinematic1
      this.bossMovie = new BossCinematic({ src, onCurtainReady: () => this.render(), onDone: () => { this.bossMovie = null } })
    }
    const puzzleKey = `${run.floor}:${run.turn}`
    const startRoll = run.phase === 'battle' && !this.result && puzzleKey !== this.rollKey
    this.root.classList.toggle('st-integrated-root', !!run.product)
    this.root.classList.toggle('st-in-battle', !!run.product && run.phase === 'battle' && !this.result)
    if (startRoll) { this.rollKey = puzzleKey; this.rolling = true }
    this.root.classList.toggle('st-rolling', this.rolling)
    this.root.querySelector('.st-hud')!.innerHTML = `<div class="st-brand">Little Token <small>${ST.edition}</small></div>
      <div class="st-day">${run.product ? `잉크 ${inkRemaining(run)} / 2 · ` : ''}${run.floor}일차 <span>/ 15</span><small>${run.floor % 5 === 0 ? '보스 조우' : '이야기를 갉아먹는 벌레들'} · ${run.turn}번째 문장</small></div>
      <nav><button data-cmd="deck">개념 ${run.deck.length}장</button><button data-cmd="help">${ST.help}</button><button data-cmd="mute">${this.muted ? ST.unmute : ST.mute}</button><button data-cmd="menu">${ST.home}</button></nav>`
    if (run.product) {
      const s = run.product.player.stats
      const ui = ST_INTEGRATED.ui
      const tools = [['settings', 'settings', ui.settings], ['deck', 'book', ui.deck], ['help', 'note', ui.help], ['mute', this.muted ? 'audio-off' : 'audio', this.muted ? ui.unmute : ui.mute], ['menu', 'home', ui.home]]
      this.root.querySelector('.st-hud')!.innerHTML = `<div class="st-live-stats"><strong>${ui.player}</strong><b title="${ui.hp}">${UIIcons('heart')} ${run.hp}/${run.maxHp}</b><span title="${ui.attack}">${UIIcons('sword')} ${s.atk}</span><span title="${ui.guard} · ${ui.stock} ${run.product.guard}">${UIIcons('shield')} ${s.guard}<small>+${run.product.guard}</small></span><span title="${ui.heal}">${UIIcons('cross')} ${s.heal}</span><span title="${ui.luck}">${UIIcons('clover')} ${s.luck}</span></div><div class="st-day">${run.floor}/15 장 · ${run.turn}턴</div><nav>${tools.map(([cmd, key, text]) => `<button data-cmd="${cmd}" aria-label="${text}" title="${text}" ${cmd === 'mute' ? `aria-pressed="${this.muted}"` : ''}>${UIIcons(key)}</button>`).join('')}</nav><div class="st-phase-banner" role="status">✦ ${this.busy ? ui.executing : this.rolling ? ui.rolling : this.result ? ui.turnResult : ui.composing} ✦</div>`
    }
    this.renderArena()
    if (run.product) {
      if (!this.token) this.token = new TokenActor(this.root.querySelector('.st-token-stage')!)
      this.token.attachTo(this.root.querySelector('[data-actor="player"]'))
      this.token.observeBattle({ hpRatio: run.hp / run.maxHp, enemyCount: run.enemies.filter(e => e.hp > 0).length, turnProgress: 0 })
      if (!this.rolling && !this.bossMovie) this.token.wake()
      const boss = run.enemies.find(e => e.hp > 0 && e.sim?.def.boss)?.sim
      const step = boss && nextEnemyAttackStep(boss)
      const key = `${run.floor}:${step?.name ?? boss?.def.id}`
      if (boss && !this.spokenWarnings.has(key)) {
        const text = step?.shatterGuard ? ST_INTEGRATED.mantisWarning : boss.def.summonPattern ? ST_INTEGRATED.queenWarning : boss.def.webPattern ? ST_INTEGRATED.spiderWarning : ''
        if (text) { this.spokenWarnings.add(key); this.token.say({ text, tone: 'warn' }) }
      }
    }
    const content = this.root.querySelector('.st-workspace')!
    if (this.result) content.innerHTML = this.resultHtml()
    else if (run.phase === 'reward') content.innerHTML = this.rewardHtml()
    else if (run.phase === 'won' || run.phase === 'lost') content.innerHTML = this.endingHtml()
    else content.innerHTML = this.battleHtml()
    const stats = this.root.querySelector('.st-preview-stats')!
    const preview = !this.result && run.phase === 'battle' ? this.projected() : null
    stats.innerHTML = preview && !run.product ? `<small>살펴보는 조합의 결과</small><b>프롬 ${preview.next.hp} / ${run.maxHp}</b><span>적에게 ${preview.enemyDamage} 피해</span>` : ''
    this.root.querySelector('.st-footer')!.innerHTML = run.product ? `<span></span><span>${this.storageOk ? ST_INTEGRATED.ui.saved : '저장 공간을 사용할 수 없어 이번 진행은 저장되지 않아요'}</span>` : `<span>한국어 개선판 · 빈칸 위치는 매 문장 무작위 · 조우 주어는 전투 후 반환</span><span>${this.storageOk ? '자동 저장됨' : '저장 공간을 사용할 수 없어 이번 진행은 저장되지 않아요'}</span>`
    this.renderModal()
    if (startRoll) this.rollTimer = window.setTimeout(() => {
      this.rolling = false; this.root.classList.remove('st-rolling'); this.render()
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 140 : 1150)
  }
  private renderMenu() {
    destroyCharacterModels(this.root); this.arenaKey = ''
    this.root.innerHTML = `<main class="st-menu" style="--st-bg:url('${BACKGROUNDS.bg001}')">
      <div class="st-menu-title"><small>Little Token · 한국어 개선판</small><h1>빈칸의 이야기</h1><p>${ST.intro}<br>${ST.introSub}</p>
      <div class="st-example"><span>사마귀는</span><strong>[ 빈칸 ]</strong><span>내리쳤다</span></div>
      <div class="st-menu-buttons">${this.run ? `<button class="st-primary" data-cmd="resume">${ST.resume} · ${this.run.floor}일차</button>` : ''}
      <button class="${this.run ? '' : 'st-primary'}" data-cmd="new">${ST.start}</button><button data-cmd="help">${ST.help}</button>
      <a href="?mode=classic">${ST.classic}</a></div>
      ${this.newConfirm ? `<div class="st-confirm"><p>${ST.restart}</p><button data-cmd="confirm-new">새로 시작</button><button data-cmd="cancel-new">취소</button></div>` : ''}
      <p class="st-menu-foot">상황을 유도하고, 내 행동으로 활용하세요.<br>불꽃 · 거울 · 바람 — 한 장의 개념, 위치마다 다른 가능성.</p></div><div class="st-modal-host"></div></main>`
    this.renderModal()
  }
  private visual(id: string): CharacterVisualDef { return CHARACTER_VISUALS[id as keyof typeof CHARACTER_VISUALS] ?? CHARACTER_VISUALS.termite }
  private actor(id: string, visualId: string, name: string, hp: number, maxHp: number, i: number): string {
    const visual = this.visual(visualId)
    const count = this.run!.enemies.length
    const boss = !!this.run?.product && stageFor(this.run.floor).isBoss && id !== 'player'
    const columns = Math.ceil(count / 2)
    const x = count === 1 ? 1190 : count === 2 ? [1100, 1310][i] : count === 3 ? [1030, 1210, 1380][i] : 1000 + (i % columns) * Math.min(185, 400 / Math.max(1, columns - 1))
    const ground = count <= 3 ? 630 + (i % 2) * 10 : i < columns ? 560 : 640
    return `<div class="st-actor ${id === 'player' ? 'st-hero' : 'st-enemy'} ${boss ? 'st-boss' : ''}" data-actor="${id}" style="--ground-x:${x}px;--ground-bottom:${1080 - ground}px;--depth:${i < columns ? 1 : 2};--actor-index:${i};--formation-x:${[10, 35, 60, 85, 20, 45, 70, 94][i] ?? 50}%;--formation-y:${i < 4 ? 0 : 85}px">
      <button class="st-name" data-inspect-actor="${id}" aria-label="${esc(name)} 상세"><b>${esc(name)}</b><span>${hp} / ${maxHp}</span><i style="--hp:${hp / maxHp * 100}%"></i></button>
      <div class="model-shell" ${this.run?.enemies.find(e => e.id === id)?.sim?.def.elite ? `data-enemy-rarity="${this.run.enemies.find(e => e.id === id)!.sim!.def.elite!.rarity}"` : ''}><img class="battle-sprite" src="${visual.portrait2d}" alt="${esc(name)}" /></div>
      <div class="st-status"></div><div class="st-shadow"></div></div>`
  }
  private renderArena() {
    const run = this.run!, arena = this.root.querySelector<HTMLElement>('.st-arena')!
    const key = `${run.floor}:${run.enemies.map(e => e.id).join(',')}`
    if (key !== this.arenaKey) {
      destroyCharacterModels(arena); this.arenaKey = key
      const st = stageFor(run.floor)
      const bg = run.product ? pickFieldBackground(run.floor, st.isBoss, st.encounter[0]).next : BACKGROUNDS[run.floor % 5 === 0 ? 'bg006' : `bg00${1 + (run.floor - 1) % 5}`]
      arena.style.backgroundImage = `url('${bg}')`
      if (run.product) { arena.dataset.weather = st.field.weather; this.root.setAttribute('data-theme', st.field.theme); GameAudio.playBattleBgm(run.floor, st.isBoss ? st.encounter[0] : undefined) }
      arena.innerHTML = `<div class="st-arena-title"><small>CHAPTER ${String(run.floor).padStart(2, '0')}</small><b>${run.floor % 5 === 0 ? esc(run.enemies[0].name) + '의 장' : '숲의 빈칸'}</b></div>
        ${this.actor('player', 'player', '프롬', run.hp, run.maxHp, 0)}
        ${run.product ? '' : `<img class="st-fairy" src="${TOKEN_FACES.neutral}" alt="요정 토큰" />`}
        <div class="st-foes ${run.product ? 'st-formation' : ''} st-count-${run.enemies.length}">${run.enemies.map((enemy, i) => this.actor(enemy.id, enemy.visual, enemy.name, enemy.hp, enemy.maxHp, i)).join('')}</div>
        <div class="st-preview-stats" aria-live="polite"></div><div class="st-vfx" aria-hidden="true"></div>`
      mountCharacterModel(arena.querySelector('[data-actor="player"]')!, this.visual('player'))
      for (const enemy of run.enemies) mountCharacterModel(arena.querySelector(`[data-actor="${enemy.id}"]`)!, this.visual(enemy.visual))
    }
    if (run.product) this.renderEscorts(arena)
    this.updateActor('player', run.hp, run.maxHp, run.playerBurnTurns ? `♨ 화상 ${run.playerBurn} · ${run.playerBurnTurns}턴` : '')
    let intel = arena.querySelector<HTMLElement>('.st-boss-intel')
    if (!intel) { intel = document.createElement('div'); intel.className = 'st-boss-intel'; arena.append(intel) }
    intel.textContent = bossIntel(run).join(' / ')
    for (const enemy of run.enemies) this.updateActor(enemy.id, enemy.hp, enemy.maxHp,
      [enemy.sim?.guard ? `방어 ${enemy.sim.guard}` : '', enemy.sim?.magicShield ? `실드 ${enemy.sim.magicShield}` : '', enemy.burnTurns ? `♨ 화상 ${enemy.burn} · ${enemy.burnTurns}턴` : '', enemy.weak ? '◇ 빈틈' : ''].filter(Boolean).join(' · '))
  }
  private renderEscorts(arena: HTMLElement) {
    let host = arena.querySelector<HTMLElement>('.st-escorts')
    if (!host) { host = document.createElement('div'); host.className = 'st-escorts'; arena.append(host) }
    const key = this.run!.enemies.map(e => `${e.id}:${e.sim?.summonHpLeft.join(',')}:${e.sim?.summonHpRight.join(',')}`).join('|')
    if (host.dataset.key === key) return
    destroyCharacterModels(host); host.dataset.key = key
    host.innerHTML = this.run!.enemies.map(e => (['left', 'right'] as const).map(side => (side === 'left' ? e.sim?.summonHpLeft : e.sim?.summonHpRight)?.map((hp, slot) => `<div class="st-escort" data-actor="escort:${e.id}:${side}:${slot}" style="--escort-i:${(side === 'left' ? 0 : 2) + slot}"><b>일벌 <span>${hp}/${e.sim!.def.summonPattern!.hp}</span></b><div class="model-shell"><img class="battle-sprite" src="${this.visual('workerBee').portrait2d}" alt="일벌" /></div></div>`).join('') ?? '').join('')).join('')
    host.querySelectorAll<HTMLElement>('.st-escort').forEach(actor => mountCharacterModel(actor, this.visual('workerBee')))
  }
  private updateActor(id: string, hp: number, max: number, status: string) {
    const actor = this.root.querySelector<HTMLElement>(`[data-actor="${id}"]`)!
    actor.classList.toggle('st-dead', hp <= 0)
    actor.querySelector('.st-name span')!.textContent = `${hp} / ${max}`
    actor.querySelector<HTMLElement>('.st-name i')!.style.setProperty('--hp', `${hp / max * 100}%`)
    actor.querySelector('.st-status')!.textContent = status
  }
  private cardHtml(id: string, index: number, reward = false): string {
    const run = this.run!, card = cardFor(run, id)
    const placed = (['situation', 'action'] as Lane[]).find(lane => run.sentences[lane].selected === id || Object.values(run.sentences[lane].edits ?? {}).includes(id))
    const selected = !reward && !!placed, level = run.levels[id] ?? 0
    const role = this.focusRole()
    const word: Word = { id: card.id, text: card.name, slot: '*', tags: [], art: card.art, emotion: 'neutral', note: '' }
    let note = reward ? run.deck.includes(id) ? `모든 위치 효과 강화 +${level + 1}` : run.product ? '새 개념 · 주어/수식/행동에 활용' : '새 개념 · 세 종류의 위치에 활용'
      : card.borrowed ? run.product ? '주어·목적어 참조' : '주어 전용' : formFor(run, id, role, this.lane)
    if (run.product && !reward) note = card.borrowed
      ? role === 'subj' ? ST_INTEGRATED.ui.actorUse : role === 'obj' ? ST_INTEGRATED.ui.targetUse : ST_INTEGRATED.ui.referenceUse
      : role === 'obj' ? ST_INTEGRATED.ui.targetUnavailable : integratedEffectSummary(describeEffect(run, id, role, this.lane))
    let artUrl: string | undefined
    if (card.borrowed && card.id.startsWith('actor:')) artUrl = this.visual(id === 'actor:player' ? 'player' : run.enemies.find(e => `actor:${e.id}` === id)!.visual).portrait2d
    const draft = !reward && canPlaceCard(run, this.lane, id, this.focusRole()) ? chooseCard(run, this.lane, id, this.focusRole()) : null
    const compiledDraft = draft && compileSentence(draft, this.lane)
    const purpose = draft && compiledDraft ? cardImpactHint(draft, id, role, compiledDraft) : card.borrowed ? '누가 행동할지 변경' : ''
    const html = wordCardFrontHtml(word, { note, artUrl, hideMeta: true,
      overlay: !reward && !run.product ? `<span class="st-card-purpose" title="${esc(purpose)}">${esc(purpose)}</span>` : '',
      concept: { glyph: card.glyph, badge: run.product && !reward ? level ? `+${level}` : '' : card.borrowed ? ST.borrowed : level ? `개념 +${level}` : '개념 카드' } })
    return `<button class="st-card ${card.borrowed ? 'st-reference-card' : ''} ${selected ? 'selected' : ''} ${this.picked === id ? 'picked' : ''}" data-card="${id}" draggable="false" ${reward ? 'data-reward="true"' : ''}
      style="--concept-color:${card.color}" aria-disabled="${!!run.product?.sealed.includes(id)}" aria-pressed="${selected}" aria-label="${esc(card.name)}${reward ? ' 보상' : ` · ${card.borrowed && role !== 'subj' && !(run.product && role === 'obj') ? run.product ? '주어·목적어 참조' : '주어 전용' : formFor(run, id, role, this.lane)}`}">
      <kbd>${index + 1}${run.product?.sealed.includes(id) ? " · 거미줄 봉인" : ""}</kbd>${html}${selected ? `<span class="st-selected-mark">${run.product ? label(placed!, true) : (placed === 'situation' ? '적 행동' : '내 대응') + '에 배치됨'}</span>` : this.picked === id ? '<span class="st-selected-mark">빈칸을 눌러 배치</span>' : ''}</button>`
  }
  private focusRole(): Role { return this.role && slotsFor(this.run!.sentences[this.lane]).includes(this.role) ? this.role : this.run!.sentences[this.lane].blank }
  private integratedSentenceHtml(lane: Lane): string {
    const run = this.run!, s = run.sentences[lane], phrases = sentencePhrases(run, lane), ui = ST_INTEGRATED.ui
    return `<section class="st-sentence st-ribbon-${lane} ${this.lane === lane ? 'active' : ''}" aria-label="${label(lane, true)}"><button class="st-lane-label" data-lane="${lane}" aria-pressed="${this.lane === lane}"><b>${label(lane, true)}</b>${s.selected ? `<span aria-label="${ui.placed}">✓</span>` : ''}</button>
      <div class="st-phrases" style="grid-template-columns:1.35fr repeat(${slotsFor(s).length - 1},minmax(0,1fr))">${slotsFor(s).map(role => {
        const free = role === s.blank, edited = !!s.edits?.[role], id = slotId(run, lane, role)
        const focused = this.lane === lane && this.focusRole() === role
        const hint = free ? ui.freeHint : edited ? ui.editedHint : inkRemaining(run) ? ui.editHint : ui.noInkHint
        const reference = focused && ['subj', 'obj'].includes(role)
        return `<div class="st-slot-wrap" style="--phrase-weight:${Math.min(1.8, Math.max(.8, (id ? phrases[role] : ui.blank).length / 6))}"><button class="st-phrase ${free || edited ? 'editable' : 'locked'} ${free && !id ? 'st-empty-slot' : ''} ${focused ? 'st-focus-slot' : ''}" data-lane="${lane}" data-role="${role}" data-drop-lane="${lane}" data-drop-role="${role}" ${id ? `data-slot-card="${id}"` : ''} aria-label="${esc(`${label(lane, true)} ${ROLE_LABELS[role]}, ${hint}, ${id ? phrases[role] : ui.blank}. ${this.actorClarity(lane)}`)}">
          <small>${ROLE_LABELS[role]}</small><b>${esc(id ? phrases[role] : ui.blank)}</b>${free ? `<em class="st-slot-state">${ui.free}</em>` : edited ? '<em class="st-slot-state">◆</em>' : ''}</button>${edited ? `<button class="st-undo" data-reset-lane="${lane}" data-reset-role="${role}" aria-label="${ui.restore}">↶</button>` : ''}
          ${reference ? `<div class="st-reference-control"><button data-cmd="references" aria-expanded="${this.referencePickerOpen}" aria-controls="st-reference-picker">${role === 'subj' ? ui.chooseActor : ui.chooseTarget}</button>${this.referencePickerOpen ? `<nav id="st-reference-picker" class="st-reference-picker" aria-label="${ui.referenceUse}">${encounterSubjects(run).map(c => `<button data-card="${c.id}" ${canPlaceCard(run, lane, c.id, role) ? '' : 'disabled'}>${esc(c.name)}</button>`).join('')}</nav>` : ''}</div>` : ''}</div>`
      }).join('')}</div></section>`
  }
  private actorClarity(lane: Lane): string {
    const { compiled } = forecastSentence(this.run!, lane)
    const name = (id: string) => id === 'player' ? '프롬' : this.run!.enemies.find(e => e.id === id)?.name ?? id
    return esc(`실제 행동자: ${compiled.actors.map(name).join('·')} → 대상: ${(compiled.targets ?? []).map(name).join('·')}`)
  }
  private integratedControlsHtml(planOnly = false): string {
    const run = this.run!, plan = integratedPlan(run, true)
    const names = (ids: string[]) => ids.map(id => id === 'player' ? '프롬' : run.enemies.find(e => e.id === id)?.name ?? id).join('·')
    if (planOnly) {
      const actors = [...new Set(plan.map(j => j.source))]
      return `<div class="st-turn-plan" aria-live="polite"><h3>${ST_INTEGRATED.ui.plan} <button data-cmd="help" aria-label="${ST_INTEGRATED.ui.planHint}" title="${ST_INTEGRATED.ui.planHint}">ⓘ</button></h3>${actors.map(source => {
        const jobs = plan.map((j, i) => ({ ...j, index: i + 1 })).filter(j => j.source === source)
        const targets = [...new Set(jobs.flatMap(j => j.targets))]
        const portrait = this.visual(source === 'player' ? 'player' : run.enemies.find(e => e.id === source)!.visual).portrait2d
        return `<div data-plan-source="${source}" title="${esc(jobs.map(j => `${j.index}. ${j.sentence.text}`).join(' / '))}" aria-label="${esc(`${names([source])} → ${names(targets)} · ${jobs.length}회`)}"><img src="${portrait}" alt="" /><div><b>${esc(names([source]))}</b><span><i>${jobs.map(j => j.index).join('·')}</i>${jobs.every(j => !j.eligible) ? '생략' : jobs.length > 1 ? `${jobs.length}회` : ''}</span></div></div>`
      }).join('')}</div>`
    }
    return `<div class="st-ink-row" aria-label="${ST_INTEGRATED.ui.inkHint}" title="${ST_INTEGRATED.ui.inkHint}"><small>${ST_INTEGRATED.ui.ink}</small><b>${inkRemaining(run)} <span>/ 2</span></b><div class="st-ink-drops">${Array.from({ length: 2 }, (_, i) => `<i class="${i < inkRemaining(run) ? 'full' : ''}"><img src="${INK_UI.bottle}" alt="" /></i>`).join('')}</div><span>${ST_INTEGRATED.ui.changed}</span></div>`
  }

  private sentenceHtml(lane: Lane): string {
    const run = this.run!, s = run.sentences[lane], phrases = sentencePhrases(run, lane)
    if (run.product) return this.integratedSentenceHtml(lane)
    return `<section class="st-sentence ${lane} ${this.lane === lane ? 'active' : ''}" aria-label="${label(lane, !!this.run?.product)}">
      <button class="st-lane-label" data-lane="${lane}" aria-pressed="${this.lane === lane}"><small>${lane === 'situation' ? '01 · STEER' : '02 · ACT'}</small><b>${label(lane, !!this.run?.product)}</b><span>${s.selected ? '✓ 빈칸 선택 완료' : '한 칸을 채워 주세요'}</span></button>
      <div class="st-phrases slots-${slotsFor(s).length}" style="grid-template-columns:repeat(${slotsFor(s).length},minmax(0,1fr))">${slotsFor(s).map((role, index) => role === s.blank
        ? `<button class="st-phrase editable ${s.selected ? 'filled' : ''}" data-lane="${lane}" data-drop-lane="${lane}" ${s.selected ? `data-slot-card="${s.selected}"` : ''}><small>${ROLE_LABELS[role]} · ${s.selected ? '배치됨 · 드래그로 이동' : '여기에 카드 놓기'}</small><b>${esc(phrases[role])}</b></button>`
        : `<div class="st-phrase locked ${this.rolling ? 'st-reeling' : ''}" style="--reel-delay:${index * 40}ms"><small>▣ ${ST.fixed} · ${ROLE_LABELS[role]}</small>${this.rolling ? `<span class="st-reel-window"><span class="st-reel-track">${[...run.hand.filter(id => !cardFor(run, id).borrowed).slice(0, 3).map(id => formFor(run, id, role, lane)), phrases[role]].map(text => `<b>${esc(text)}</b>`).join('')}</span></span>` : `<b>${esc(phrases[role])}</b>`}</div>`).join('')}</div>
      <div class="st-sentence-summary">${this.subjectSummary(lane)}</div></section>`
  }
  private subjectSummary(lane: Lane): string {
    const run = this.inspectionRun(), { compiled, provisional } = forecastSentence(run, lane)
    const lines = actionLines(run, compiled)
    const other = !run.product && lane === 'situation' ? run.enemies.filter(e => e.hp > 0 && !compiled.actors.includes(e.id) && (!run.product || e.id === run.enemies.find(front => front.hp > 0)?.id)).length : 0
    return `<small>${provisional ? FT.before : this.isTrial() && lane === this.lane ? '살펴보는 카드 적용 시' : '선택한 문장의 행동'}</small>
      <strong>${esc(lines[0])}</strong>${lines.length > 1 ? `<span>${esc(lines[1])}</span>` : ''}${other ? `<span>다른 적 ${other}명도 기본 공격합니다</span>` : ''}`
  }
  private battleHtml(): string {
    const run = this.run!, s = run.sentences[this.lane]
    if (!this.inspected || !(run.hand.includes(this.inspected) || run.product && encounterSubjects(run).some(c => c.id === this.inspected))) this.inspected = s.selected ?? run.hand.find(id => canPlaceCard(run, this.lane, id, this.focusRole())) ?? run.hand[0]
    const ready = !!run.sentences.situation.selected && !!run.sentences.action.selected
    if (run.product) return this.integratedBattleHtml(ready)
    return `<div class="st-editors">${this.sentenceHtml('situation')}${this.sentenceHtml('action')}</div>
      <div class="st-forecast" aria-live="polite">${this.forecastHtml()}</div>
      <div class="st-choice-heading"><div><small>공용 손패 ${run.hand.length}장 · ${run.product ? '숫자 선택 후 ↑문장 1 / ↓문장 2 · 고정 칸도 잉크로 수정' : '두 문장에 함께 사용 · 숫자 1~6 선택 후 ↑적 행동 / ↓내 대응'}</small><h2>${this.rolling ? '구절을 정하는 중… 빈칸만 직접 채우세요' : this.picked ? `${cardFor(run, this.picked).name} 선택 중 — 놓을 빈칸을 누르세요` : run.product ? '주어와 목적어로 행동자·대상을 지정하세요' : '카드를 적 행동 또는 내 대응의 빈칸으로 끌어 놓으세요'}</h2></div>
      <button data-cmd="redraw" ${run.redraws <= 0 ? 'disabled' : ''} title="${ST.redrawHint}">${ST.redraw} <b>${run.redraws} / 2</b></button></div>
      ${run.product ? this.integratedControlsHtml() : ''}<div class="st-choice-area"><div class="st-hand">${run.hand.map((id, i) => this.cardHtml(id, i)).join('')}</div>
      </div><aside class="st-detail">${this.detailHtml(this.inspected)}</aside>
      <div class="st-action-bar"><div class="st-projection" aria-live="polite">${this.projectionHtml()}</div>
      <button class="st-primary" data-cmd="execute" ${!ready || this.busy || this.rolling ? 'disabled' : ''}>${ready ? ST.execute : '두 빈칸을 채워 주세요'} <small>Enter</small></button></div>`
  }
  private integratedBattleHtml(ready: boolean): string {
    const run = this.run!, ui = ST_INTEGRATED.ui
    const items = run.product!.player.items
    return `<div class="st-integrated-layout"><aside class="st-left-rail">${this.integratedControlsHtml(true)}<section class="st-owned-items"><h3>${ui.items} ${items.length}</h3><div>${items.map((item, index) => `<button data-inspect-item="${index}" title="${esc(item.name + ' · ' + itemStatsText(item))}">${itemArt(item.art)}<span class="sr-only">${esc(item.name)}</span></button>`).join('') || '<span class="st-empty-item" aria-hidden="true"></span>'}</div><p class="st-item-info" aria-live="polite"></p></section></aside>
      <div class="st-editors">${this.sentenceHtml('situation')}${this.sentenceHtml('action')}</div>${this.integratedControlsHtml()}
      <div class="st-choice-area"><div class="st-hand">${run.hand.map((id, i) => this.cardHtml(id, i)).join('')}</div></div>
      <button class="st-effect-toggle" data-cmd="effect-panel" aria-expanded="${this.effectPanelOpen}" aria-controls="st-card-panel">${ui.cardEffect}</button>
      <aside id="st-card-panel" class="st-card-panel ${this.effectPanelOpen ? 'st-panel-open' : ''}"><h2 class="st-panel-title">${UIIcons('book')} ${ui.cardEffect}</h2><button class="st-effect-close" data-cmd="effect-panel">${ui.close} ×</button><aside class="st-detail">${this.detailHtml(this.inspected!)}</aside><div class="st-forecast" aria-live="polite">${this.forecastHtml()}</div><div class="st-projection">${this.projectionHtml()}</div></aside>
      <div class="st-compact-result" aria-live="polite">${this.forecastHtml()}</div>
      <div class="st-turn-actions">${!ready ? `<small>${ui.noPreview(Object.values(run.sentences).filter(s => !s.selected).length)}</small>` : ''}<button data-cmd="redraw" ${run.redraws ? '' : 'disabled'}>${ui.redraw} ${run.redraws}/2</button><button class="st-primary" data-cmd="execute" ${!ready || this.busy || this.rolling ? 'disabled' : ''}>${ui.execute}<small>Enter</small></button></div></div>`
  }

  private detailHtml(id: string): string {
    const run = this.run!, card = cardFor(run, id), current = this.focusRole()
    const preview = canPlaceCard(run, this.lane, id, this.focusRole()) ? compileSentence(chooseCard(run, this.lane, id, this.focusRole()), this.lane)! : null
    if (run.product) {
      const ui = ST_INTEGRATED.ui
      const validRole = card.borrowed ? ['subj', 'obj'].includes(current) : current !== 'obj'
      const recipients = preview ? current === 'verb' ? preview.targets ?? [] : preview.actors : []
      const names = recipients.map(actor => actor === 'player' ? '프롬' : run.enemies.find(e => e.id === actor)?.name ?? actor).join('·')
      const effect = validRole ? describeEffect(run, id, current, this.lane) : card.borrowed ? ui.referenceHint : ui.conceptTargetHint
      return `<header><span style="color:${card.color}">${card.glyph}</span><h3>${esc(card.name)}</h3></header><div class="st-current-use"><small>${label(this.lane, true)} · ${ROLE_LABELS[current]}${names ? ` · ${esc(names)}` : ''}</small><p title="${esc(effect)}">${esc(validRole ? integratedEffectSummary(effect) : effect)}</p></div><button class="st-other-uses" data-cmd="role-details" aria-expanded="${this.roleDetailOpen}" aria-controls="st-role-detail-dialog">${ui.otherUses} ↗</button>`
    }
    return `<header><span style="color:${card.color}">${card.glyph}</span><h3>${esc(card.name)}</h3><span>${ST_INTEGRATED.roleComparison}</span></header>
      <div class="st-role-details">${(run.product ? INTEGRATED_ROLES : ROLES).filter(role => !!run.product || !card.borrowed || role === 'subj').map(role => `<div class="${role === roleKind(current) ? 'current' : ''}"><small>${ROLE_LABELS[role]}${role === roleKind(current) ? ' · 선택 중' : ''}</small><b>${esc(formFor(run, id, role, this.lane))}</b><p>${esc(describeEffect(run, id, role, this.lane))}</p></div>`).join('')}</div>
      <div class="st-context-effect"><b>${preview ? esc(preview.text) : run.product ? '무료 빈칸을 채우면 수정 문장의 실제 결과가 계산됩니다.' : ST.borrowedHint}</b><span>${preview ? actionLines(run, preview).slice(0, run.product ? 2 : 99).map(esc).join(' / ') + (run.product && actionLines(run, preview).length > 2 ? ' · 추가 효과는 행동 순서/피해 계산에 포함' : '') : ''}</span></div>`
  }

  private inspectionRun(): SteeringRun {
    const run = this.run!
    return this.inspected && canPlaceCard(run, this.lane, this.inspected, this.focusRole())
      ? chooseCard(run, this.lane, this.inspected, this.focusRole()) : run
  }
  private isTrial(): boolean { return !!this.inspected && canPlaceCard(this.run!, this.lane, this.inspected, this.focusRole()) && this.inspected !== slotId(this.run!, this.lane, this.focusRole()) }
  private projected(): Resolution | null {
    const run = this.run!
    if (run.phase !== 'battle') return null
    const preview = this.inspectionRun()
    if (!preview.sentences.situation.selected || !preview.sentences.action.selected) return null
    return resolveTurn(preview)
  }
  private projectionHtml(): string {
    const projected = this.projected()
    if (!projected) return this.run!.product ? '' : `<b>${FT.waiting}</b>`
    const facts = outcomeFacts(this.run!, projected)
    return `${this.run!.product ? '' : `<small>${this.isTrial() ? FT.trial : '선택한 조합'}</small><b>${esc(facts.playerHp)}</b>`}
      <details class="st-math"><summary>${this.run!.product ? ST_INTEGRATED.ui.damageDetails : FT.equation}</summary><div>${projected.attacks.map(a => `<p>${esc(this.run!.enemies.find(e => e.id === a.source)?.name ?? '프롬')} → ${esc(this.run!.enemies.find(e => e.id === a.target)?.name ?? '프롬')}: 입력 타격 ${a.incoming} · 회피 ${a.dodged} · 반사 상쇄 ${a.reflected} · 방어 ${a.blocked} → 실제 체력 피해 ${a.healthDamage}</p>`).join('')}
      <p>내 화상 피해 ${facts.playerBurn} · 내 회복 ${projected.healed}</p><p>먼저 쓰러진 적의 공격은 제외합니다. 남은 체력보다 큰 피해는 남은 체력까지만 표시합니다.</p></div></details>
      ${projected.next.phase === 'lost' ? '<strong class="danger">예상 패배</strong>' : projected.next.phase === 'reward' || projected.next.phase === 'won' ? '<strong class="good">예상 승리</strong>' : ''}`
  }
  private forecastHtml(): string {
    const projected = this.projected()
    if (!projected) return this.run!.product ? `<div class="st-forecast-pending"><b>${ST_INTEGRATED.ui.noPreview(Object.values(this.inspectionRun().sentences).filter(s => !s.selected).length)}</b></div>` : `<div class="st-forecast-pending"><b>${FT.waiting}</b><span>위 두 문장의 빈칸을 하나씩 선택하세요. 적의 행동과 내 대응을 함께 계산합니다.</span></div>`
    const facts = outcomeFacts(this.run!, projected)
    if (this.run!.product) return `<div class="st-forecast-final"><small>${this.isTrial() ? ST_INTEGRATED.ui.trial : ST_INTEGRATED.ui.result}</small><b>프롬 ${this.run!.hp} → ${projected.next.hp}</b><strong>${projected.enemyDamage < 0 ? `적 체력 +${-projected.enemyDamage}` : `적 체력 −${projected.enemyDamage}`}</strong></div>`
    const reducing = [`회피 ${facts.avoided}`, `반사 상쇄 ${facts.returned}`, `방어 ${facts.blocked}`].join(' + ')
    return `<div class="st-forecast-enemy"><small>${FT.enemyAttack}</small><b>공격 합계 ${facts.incoming}</b><span>실제 실행되는 ${projected.attacks.filter(a => a.target === 'player').length}회 공격 · 방어 전</span></div>
      <div class="st-forecast-response"><small>${FT.defense}</small><b>${facts.avoided + facts.returned + facts.blocked} 막음 → ${facts.directHealthLoss} 피해</b><span>${reducing}</span></div>
      <div class="st-forecast-final"><small>${this.isTrial() ? `${cardFor(this.run!, this.inspected!).name}을 넣으면 · 미선택` : FT.outcome}</small><b>${esc(facts.playerHp)}</b><span>적에게 ${projected.enemyDamage} 피해${facts.causeTotals.length ? ` = ${facts.causeTotals.join(' + ')}` : ''}${facts.playerBurn ? ` · 내 화상 ${facts.playerBurn}` : ''}${projected.healed ? ` · 내 회복 ${projected.healed}` : ''}</span></div>`
  }
  private updateInspection(id: string) {
    if (!this.run || this.result || this.busy || this.rolling || this.run.phase !== 'battle' || !(this.run.hand.includes(id) || this.run.product && encounterSubjects(this.run).some(c => c.id === id))) return
    this.inspected = id
    const detail = this.root.querySelector('.st-detail'), projection = this.root.querySelector('.st-projection')
    if (detail) detail.innerHTML = this.detailHtml(id)
    if (projection) projection.innerHTML = this.projectionHtml()
    const editors = this.root.querySelector('.st-editors'), forecast = this.root.querySelector('.st-forecast')
    if (editors && !this.run.product) editors.innerHTML = this.sentenceHtml('situation') + this.sentenceHtml('action')
    if (forecast) forecast.innerHTML = this.forecastHtml()
    const compact = this.root.querySelector('.st-compact-result'); if (compact) compact.innerHTML = this.forecastHtml()
    const projected = this.projected(), stats = this.root.querySelector('.st-preview-stats')
    if (stats) stats.innerHTML = projected && !this.run.product ? `<small>살펴보는 조합의 결과</small><b>프롬 ${projected.next.hp} / ${this.run.maxHp}</b><span>적에게 ${projected.enemyDamage} 피해</span>` : ''
    this.root.querySelectorAll('[data-card]').forEach(el => el.classList.toggle('inspected', (el as HTMLElement).dataset.card === id))
  }
  private rewardHtml(): string {
    if (this.run!.product?.rewardStep === 'item') return `<section class="st-reward"><h1>${ST_INTEGRATED.itemChoice}</h1><p>${ST_INTEGRATED.excludedPassives}</p><div class="st-item-choices">${this.run!.product.itemChoices.map(id => `<button data-item-choice="${id}"><h2>${esc(ALL_ITEMS[id].name)}</h2><p>${esc(ALL_ITEMS[id].rarity)}</p><span>${ST_INTEGRATED.forgeHint}</span></button>`).join('')}</div></section>`
    return `<section class="st-reward"><small>CHAPTER COMPLETE · ${this.run!.floor}일차</small><h1>${ST.reward}</h1><p>${ST.rewardHint}</p>
      <div class="st-reward-cards">${this.run!.rewardChoices.map((id, i) => `<div class="st-reward-item">${this.cardHtml(id, i, true)}<div class="st-reward-effects">${(this.run!.product ? INTEGRATED_ROLES : ROLES).map(role => `<p><b>${ROLE_LABELS[role]} · ${cardFor(this.run!, id).forms[role]}</b><span>${describeEffect(this.run!, id, role, this.lane)}</span></p>`).join('')}</div></div>`).join('')}</div>
      <p>${this.run!.product ? ST_INTEGRATED.rewardFlow : "한 장 선택 → 최대 체력 +2 · 체력 +8 회복 · 공격 +1 · 다음 날로"}</p></section>`
  }
  private openForge() {
    if (this.forge) return
    const id = this.run!.product!.pendingItem!
    this.token?.destroy(); this.token = null
    destroyCharacterModels(this.root)
    this.root.classList.remove('steering-root')
    this.forge = new ItemExclaimView(this.root, { item: ALL_ITEMS[id], checkpoint: this.run!.product!.forge, onCheckpoint: checkpoint => { this.run!.product!.forge = checkpoint; this.persist() }, onDone: item => {
      this.run = finishIntegratedItem(this.run!, item); this.persist()
      this.forge?.destroy(); this.forge = null; this.arenaKey = ''; this.root.classList.add('steering-root'); this.render()
    } })
  }
  private resultHtml(): string {
    const result = this.result!, cleared = result.next.phase !== 'battle'
    return `<section class="st-result"><div><small>이번 문장의 결과</small><h2>${cleared ? result.next.phase === 'lost' ? '다음 문장으로 이어지지 못했어요' : '이 장의 벌레들을 물리쳤어요' : '맥락이 전투를 바꿨어요'}</h2>
      <p class="st-result-sentence">${esc(result.situation)}</p><p class="st-result-sentence teal">${esc(result.action)}</p>
      <div class="st-result-numbers"><span>적 피해 <b>${result.enemyDamage}</b></span><span>내 체력 <b>${result.next.hp}</b></span>${result.reflected ? `<span>반사 <b>${result.reflected}</b></span>` : ''}${result.collision ? `<span>충돌 <b>${result.collision}</b></span>` : ''}</div>
      <button class="st-primary" data-cmd="continue">${cleared ? result.next.phase === 'reward' ? '보상 고르기' : '이야기 결과' : ST.next}</button></div>
      <ol class="st-combat-log" aria-label="실제 전투 기록">${result.log.length ? result.log.map(line => `<li>${esc(line)}</li>`).join('') : '<li>이번 문장은 준비 효과만 남겼어요.</li>'}</ol></section>`
  }
  private endingHtml(): string {
    const run = this.run!
    return `<section class="st-ending"><small>${run.phase === 'won' ? 'THE STORY CONTINUES' : 'A PAGE TO REWRITE'}</small><h1>${run.phase === 'won' ? ST.won : ST.lost}</h1>
      <p>${run.floor}일차 · ${run.totalTurns}개 문장 · ${run.deck.length}개 개념</p><button class="st-primary" data-cmd="new">${ST.retry}</button><button data-cmd="menu">${ST.home}</button>
      ${this.newConfirm ? `<div class="st-confirm"><p>${ST.restart}</p><button data-cmd="confirm-new">새로 시작</button><button data-cmd="cancel-new">취소</button></div>` : ''}</section>`
  }
  private renderModal() {
    const host = this.root.querySelector('.st-modal-host')!
    if (!this.helpOpen && !this.deckOpen && !this.roleDetailOpen) { host.innerHTML = ''; return }
    if (this.roleDetailOpen && this.run?.product && this.inspected) {
      const run = this.run, id = this.inspected, card = cardFor(run, id), ui = ST_INTEGRATED.ui
      host.innerHTML = `<div class="st-modal-backdrop"><section id="st-role-detail-dialog" class="st-modal st-role-modal" role="dialog" aria-modal="true" aria-labelledby="st-role-detail-title" tabindex="-1"><header><h2 id="st-role-detail-title">${esc(card.name)} · ${ui.otherUses}</h2><button data-cmd="close-roles">${ui.close} ×</button></header><p>${card.borrowed ? ui.referenceHint : ui.conceptTargetHint}</p><div class="st-role-details">${INTEGRATED_ROLES.map(role => {
        const valid = card.borrowed ? ['subj', 'obj'].includes(role) : role !== 'obj'
        const { compiled } = forecastSentence(run, this.lane)
        const actors = role === 'subj' && !card.borrowed ? [run.sentences[this.lane].originActor!] : compiled.actors
        const recipients = role === 'verb' ? compiled.targets ?? [] : actors
        const names = recipients.map(actor => actor === 'player' ? '프롬' : run.enemies.find(e => e.id === actor)?.name ?? actor).join('·')
        return `<article class="${role === roleKind(this.focusRole()) ? 'current' : ''}"><small>${ROLE_LABELS[role]}</small><b>${esc(valid ? formFor(run, id, role, this.lane) : role === 'obj' ? ui.targetUnavailable : ui.unavailable)}</b>${valid ? `<p>${esc(describeEffect(run, id, role, this.lane))}</p>${!card.borrowed ? `<p class="st-recipient">→ ${esc(names)}</p>` : ''}` : ''}</article>`
      }).join('')}</div><p>${ui.referenceRules}</p></section></div>`
      host.querySelector<HTMLButtonElement>('[data-cmd="close-roles"]')?.focus()
      return
    }
    host.innerHTML = `<div class="st-modal-backdrop"><section class="st-modal" role="dialog" aria-modal="true" aria-label="${this.helpOpen ? ST.help : '개념 단어장'}" tabindex="-1">
      <header><h2>${this.helpOpen ? ST.help : '개념 단어장'}</h2><button data-cmd="close">${ST.close} ×</button></header>
      ${this.helpOpen ? `<ol>${(this.run?.product ? [ST_INTEGRATED.ui.referenceRules, ST_INTEGRATED.ui.inkHint, ST_INTEGRATED.ui.planHint, ST_INTEGRATED.guide] : ST.helpText).map(text => `<li>${text}</li>`).join('')}</ol>`
        : this.run!.deck.map(id => `<article class="st-deck-entry">${this.cardHtml(id, 0, true)}<div><h3>${esc(cardFor(this.run!, id).name)} ${(this.run!.levels[id] ?? 0) ? `+${this.run!.levels[id]}` : ''}</h3>${(this.run!.product ? INTEGRATED_ROLES : ROLES).map(role => `<p><b>${ROLE_LABELS[role]} · ${cardFor(this.run!, id).forms[role]}</b> — ${describeEffect(this.run!, id, role, this.lane)}</p>`).join('')}</div></article>`).join('')}
      </section></div>`
    host.querySelector<HTMLButtonElement>('[data-cmd="close"]')?.focus()
  }
  private hover(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-card]')
    if (button && !this.picked && !this.dragging && !button.dataset.reward && button.dataset.card !== this.inspected && !this.helpOpen && !this.deckOpen && !this.roleDetailOpen) this.updateInspection(button.dataset.card!)
  }
  private click(event: Event) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button')
    if (!target || performance.now() < this.suppressClicksUntil || (target as HTMLButtonElement).disabled || this.busy || this.rolling) return
    if ((this.helpOpen || this.deckOpen || this.roleDetailOpen) && !target.closest('.st-modal')) return
    const cmd = target.dataset.cmd
    if (cmd === 'role-details') { this.roleDetailOpen = true; this.renderModal(); return }
    if (cmd === 'close-roles') { this.roleDetailOpen = false; this.renderModal(); this.root.querySelector<HTMLButtonElement>('[data-cmd="role-details"]')?.focus(); return }
    if (cmd === 'references') { this.referencePickerOpen = !this.referencePickerOpen; this.render(); this.root.querySelector<HTMLButtonElement>(this.referencePickerOpen ? '.st-reference-picker button:not(:disabled)' : '[data-cmd="references"]')?.focus(); return }
    if (cmd === 'effect-panel') { this.effectPanelOpen = !this.effectPanelOpen; this.render(); this.root.querySelector<HTMLButtonElement>(this.effectPanelOpen ? '.st-effect-close' : '.st-effect-toggle')?.focus(); return }
    if (cmd === 'settings') { this.options.onSettings?.(); return }
    if (cmd === 'close') { this.helpOpen = false; this.deckOpen = false; this.renderModal(); return }
    if (cmd === 'help') { this.helpOpen = true; this.renderModal(); return }
    if (cmd === 'deck') { this.deckOpen = true; this.renderModal(); return }
    if (cmd === 'mute') { this.muted = !this.muted; Howler.mute(this.muted); this.render(); return }
    if (cmd === 'menu' && this.options.onHome) { this.options.onHome(); return }
    if (cmd === 'menu') { this.menu = true; this.result = null; this.render(); return }
    if (cmd === 'resume') { this.menu = false; this.result = null; this.render(); return }
    if (cmd === 'cancel-new') { this.newConfirm = false; this.render(); return }
    if (cmd === 'new' || cmd === 'confirm-new') {
      if (this.run && cmd !== 'confirm-new') { this.newConfirm = true; this.render(); return }
      this.run = createSteeringRun(); this.menu = false; this.newConfirm = false; this.result = null; this.inspected = null; this.lane = 'situation'
      this.picked = null; this.rollKey = ''; this.rolling = false
      this.persist(); this.render(); return
    }
    if (!this.run) return
    if (cmd === 'continue') { this.result = null; this.inspected = null; this.lane = 'situation'; this.role = null; this.render(); return }
    if (target.dataset.resetRole && this.run.product) { this.run = resetIntegratedSlot(this.run, target.dataset.resetLane as Lane, target.dataset.resetRole as Role); this.persist(); this.render(); return }
    if (target.dataset.lane && !this.result && this.run.phase === 'battle') {
      const role = target.dataset.role as Role | undefined
      if (this.picked && canPlaceCard(this.run, target.dataset.lane as Lane, this.picked, role)) { this.placeCard(target.dataset.lane as Lane, this.picked, role); return }
      this.lane = target.dataset.lane as Lane; this.role = role ?? null; this.inspected = null; this.referencePickerOpen = false; this.render(); return
    }
    if (target.dataset.inspectItem !== undefined && this.run.product) {
      const item = this.run.product.player.items[Number(target.dataset.inspectItem)]
      const info = this.root.querySelector('.st-item-info'); if (item && info) info.textContent = `${item.name} · ${itemStatsText(item)} · ${item.line}`
      return
    }
    if (target.dataset.itemChoice && this.run.product) { this.run = pickIntegratedItem(this.run, target.dataset.itemChoice); this.persist(); this.render(); return }
    if (target.dataset.card) {
      const id = target.dataset.card
      if (target.dataset.reward) {
        this.run = takeReward(this.run, id); this.lane = 'situation'; this.inspected = null; this.sound('win')
      } else {
        if (this.run.product && target.closest('.st-reference-picker')) { this.referencePickerOpen = false; this.placeCard(this.lane, id, this.focusRole()); return }
        this.picked = id; this.inspected = id
      }
      this.persist(); this.render(); return
    }
    if (cmd === 'redraw') { this.run = redraw(this.run); this.inspected = null; this.picked = null; this.persist(); this.render(); return }
    if (cmd === 'execute') this.execute()
    const actorId = target.dataset.inspectActor
    if (actorId) {
      const enemy = this.run.enemies.find(e => e.id === actorId)
      const status = actorId === 'player' ? `프롬 · 공격 ${this.run.power} · 화상 ${this.run.playerBurnTurns}턴`
        : `${enemy!.name} · 기본 공격 ${enemy!.atk} · 화상 ${enemy!.burnTurns}턴 · 빈틈 +${Math.round(enemy!.weak * 100)}%`
      this.root.querySelector('.st-preview-stats')!.textContent = status
    }
  }
  private placeCard(lane: Lane, id: string, role: Role = this.run!.sentences[lane].blank) {
    if (!this.run || !canPlaceCard(this.run, lane, id, role)) return
    this.run = chooseCard(this.run, lane, id, role); this.picked = null; this.inspected = null
    this.referencePickerOpen = false
    this.lane = role === this.run.sentences[lane].blank && lane === 'situation' && !this.run.sentences.action.selected ? 'action' : lane
    this.role = this.lane === lane ? role : null
    this.persist(); this.render()
  }
  private endDrag() {
    this.dragging = null; this.root.classList.remove('st-dragging')
    this.root.querySelector('.st-drag-ghost')?.remove()
    this.root.querySelectorAll('.st-drop-valid,.st-drop-over').forEach(el => el.classList.remove('st-drop-valid', 'st-drop-over'))
  }
  private execute() {
    const run = this.run!
    if (!run.sentences.situation.selected || !run.sentences.action.selected) return
    const result = resolveTurn(run)
    this.busy = true
    const arena = this.root.querySelector<HTMLElement>('.st-arena')!
    // 연출 전에 저장해 새로고침해도 같은 공격을 두 번 받지 않는다.
    this.run = result.next.phase === 'battle' ? advanceTurn(result.next) : result.next
    this.role = null
    this.persist()
    this.root.querySelector<HTMLButtonElement>('[data-cmd="execute"]')!.disabled = true
    const health = new Map([['player', run.hp], ...run.enemies.map(e => [e.id, e.hp] as [string, number])])
    if (run.product) {
      for (const e of result.supportEvents ?? []) {
        const actor = arena.querySelector<HTMLElement>(`[data-actor="${e.target}"]`)
        if (e.kind === 'heal') {
          health.set(e.target, Math.min(e.target === 'player' ? run.maxHp : run.enemies.find(f => f.id === e.target)!.maxHp, health.get(e.target)! + e.amount))
          playCharacterAnimation(actor, 'heal', 300)
        } else { actor?.classList.add('st-defending'); playCharacterAnimation(actor, 'shield', 300) }
      }
    } else {
    for (const lane of ['situation', 'action'] as Lane[]) {
      const sentence = compileSentence(run, lane)!, prep = preparedEffects(sentence)
      for (const actorId of sentence.actors) {
        const actor = arena.querySelector<HTMLElement>(`[data-actor="${actorId}"]`)
        if (prep.heal) health.set(actorId, Math.min(actorId === 'player' ? run.maxHp : run.enemies.find(e => e.id === actorId)!.maxHp, health.get(actorId)! + prep.heal))
        if (prep.guard || prep.reflect || prep.dodge || prep.thorns) {
          actor?.classList.add('st-defending')
          playCharacterAnimation(actor, 'shield', 300)
        } else if (prep.heal) playCharacterAnimation(actor, 'heal', 300)
      }
    }
    }
    for (const [actorId, hp] of health) this.updateActor(actorId, hp, actorId === 'player' ? run.maxHp : run.enemies.find(e => e.id === actorId)!.maxHp, '')
    const stats = arena.querySelector<HTMLElement>('.st-preview-stats')!
    stats.innerHTML = '<small>전투 진행 중</small><b>방어·반격 준비</b>'
    this.timer = window.setTimeout(() => this.playBeat(combatBeats(result), 0, result, run, health), 300)
  }
  private playBeat(beats: CombatBeat[], index: number, result: Resolution, before: SteeringRun, health: Map<string, number>) {
    const arena = this.root.querySelector<HTMLElement>('.st-arena')!
    const stats = arena.querySelector<HTMLElement>('.st-preview-stats')!, vfx = arena.querySelector<HTMLElement>('.st-vfx')!
    arena.querySelectorAll('.st-attacking,.st-hit-react').forEach(el => el.classList.remove('st-attacking', 'st-hit-react'))
    vfx.innerHTML = ''
    if (index >= beats.length) {
      this.busy = false; this.result = result
      arena.querySelectorAll('.st-defending').forEach(el => el.classList.remove('st-defending'))
      this.render(); return
    }
    const beat = beats[index], reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (beat.kind === 'strike') {
      const source = arena.querySelector<HTMLElement>(`[data-actor="${beat.attack.source}"]`)!
      source.classList.add('st-attacking')
      source.dataset.strikeIndex = String(beat.ordinal)
      playCharacterAnimation(source, beat.attack.animationStage === 3 ? 'attack3' : beat.attack.animationStage === 2 ? 'attack2' : 'attack', 330)
      const actorName = beat.attack.source === 'player' ? '프롬' : before.enemies.find(e => e.id === beat.attack.source)!.name
      const targetName = beat.attack.target === 'player' ? '프롬' : before.enemies.find(e => e.id === beat.attack.target)!.name
      this.root.querySelectorAll<HTMLElement>('[data-plan-source]').forEach(entry => entry.classList.toggle('st-current-action', entry.dataset.planSource === beat.attack.source))
      const entry = this.root.querySelector<HTMLElement>(`[data-plan-source="${beat.attack.source}"] span`)
      if (entry) entry.textContent = `실행 ${beat.attack.planIndex ?? beat.ordinal}순서 → ${targetName} · ${beat.ordinal}/${beat.total}타`
      stats.innerHTML = `<small>실제 ${beat.attack.planIndex ?? beat.ordinal}순서 · ${esc(actorName)} → ${esc(targetName)}</small><b>${beat.ordinal} / ${beat.total} 타</b>`
    } else stats.innerHTML = '<small>턴 마무리</small><b>화상 피해</b>'
    this.timer = window.setTimeout(() => {
      if (beat.kind === 'strike') {
        if (!this.muted) {
          if (beat.attack.source === 'player') GameAudio.playSwordHit(beat.ordinal - 1)
          else GameAudio.playEnemyAttack()
        }
        const target = arena.querySelector<HTMLElement>(`[data-actor="${beat.attack.target}"]`)!
        target.classList.add('st-hit-react')
        this.strikeTrail(beat.attack.source, beat.attack.target, false)
        if (beat.attack.blocked) this.damagePopup(beat.attack.target, `방어 ${beat.attack.blocked}`, 'guard', 0)
        if (beat.attack.dodged) this.damagePopup(beat.attack.target, `회피 ${beat.attack.dodged}`, 'guard', 1)
        if (beat.attack.reflected) this.strikeTrail(beat.attack.target, beat.attack.source, true)
      }
      for (const [i, event] of beat.damage.entries()) {
        health.set(event.target, Math.max(0, health.get(event.target)! - event.amount))
        const max = event.target === 'player' ? before.maxHp : before.enemies.find(e => e.id === event.target)!.maxHp
        this.updateActor(event.target, health.get(event.target)!, max, '')
        this.damagePopup(event.target, event.cause === 'attack' ? `−${event.amount}` : `${FT.causes[event.cause]} ${event.amount}`, event.cause, i + 2)
        if (health.get(event.target) === 0) playCharacterAnimation(arena.querySelector(`[data-actor="${event.target}"]`), 'defeat', 350)
      }
      {
        for (const e of (beat.kind === 'strike' ? beat.attack.escorts : beat.escorts) ?? []) {
          const actor = arena.querySelector<HTMLElement>(`[data-actor="${e.target}"]`)
          if (actor) { actor.querySelector('span')!.textContent = `${e.hp}/${e.maxHp}`; actor.classList.add('st-hit-react'); this.damagePopup(e.target, `−${e.amount}`, 'attack', 0); if (!e.hp) { actor.classList.add('st-dead'); playCharacterAnimation(actor, 'defeat', 350) } }
        }
        for (const e of (beat.kind === 'strike' ? beat.attack.healing : undefined) ?? []) {
          const max = e.target === 'player' ? before.maxHp : before.enemies.find(f => f.id === e.target)!.maxHp
          health.set(e.target, Math.min(max, health.get(e.target)! + e.amount)); this.updateActor(e.target, health.get(e.target)!, max, ''); this.damagePopup(e.target, `회복 +${e.amount}`, 'guard', 0)
        }
      }
      this.timer = window.setTimeout(() => this.playBeat(beats, index + 1, result, before, health), reduced ? 170 : 270)
    }, reduced ? 70 : 150)
  }
  private actorPoint(id: string) {
    const arena = this.root.querySelector<HTMLElement>('.st-arena')!, actor = arena.querySelector<HTMLElement>(`[data-actor="${id}"]`)!
    const a = arena.getBoundingClientRect(), b = actor.getBoundingClientRect(), scale = a.width / arena.offsetWidth
    return { x: (b.left - a.left + b.width * .5) / scale, y: (b.top - a.top + b.height * .5) / scale }
  }
  private damagePopup(id: string, text: string, kind: string, index: number) {
    const point = this.actorPoint(id), pop = document.createElement('span')
    pop.className = `st-damage-popup st-pop-${kind}`; pop.textContent = text
    pop.style.left = `${point.x + (index % 2 ? 30 : -30)}px`; pop.style.top = `${point.y - 20 - (index % 3) * 28}px`
    this.root.querySelector('.st-vfx')!.append(pop)
  }
  private strikeTrail(from: string, to: string, returned: boolean) {
    const a = this.actorPoint(from), b = this.actorPoint(to), trail = document.createElement('span')
    trail.className = `st-strike-trail ${returned ? 'returned' : ''}`
    trail.style.left = `${a.x}px`; trail.style.top = `${a.y}px`
    trail.style.width = `${Math.hypot(b.x - a.x, b.y - a.y)}px`
    trail.style.setProperty('--trail-angle', `${Math.atan2(b.y - a.y, b.x - a.x)}rad`)
    this.root.querySelector('.st-vfx')!.append(trail)
  }
  private key(event: KeyboardEvent) {
    if (this.helpOpen || this.deckOpen || this.roleDetailOpen) {
      if (event.key === 'Escape') { const restoreRole = this.roleDetailOpen; this.helpOpen = false; this.deckOpen = false; this.roleDetailOpen = false; this.renderModal(); if (restoreRole) this.root.querySelector<HTMLButtonElement>('[data-cmd="role-details"]')?.focus() }
      if (event.key === 'Tab') {
        const modal = this.root.querySelector('.st-modal')!, focusable = [...modal.querySelectorAll<HTMLButtonElement>('button')]
        if (focusable.length && (event.shiftKey && document.activeElement === focusable[0] || !event.shiftKey && document.activeElement === focusable[focusable.length - 1])) { event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0].focus() }
      }
      return
    }
    if (event.key === 'Escape' && (this.referencePickerOpen || this.effectPanelOpen)) { this.referencePickerOpen = false; this.effectPanelOpen = false; this.render(); return }
    if (this.menu || this.busy || this.rolling) return
    if (/^[1-6]$/.test(event.key)) {
      this.root.querySelectorAll<HTMLButtonElement>(this.run?.product ? '.st-hand [data-card]' : '[data-card]')[Number(event.key) - 1]?.click()
    } else if (this.picked && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); this.placeCard(event.key === 'ArrowUp' ? 'situation' : 'action', this.picked)
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('button,summary,a,input,select'))) {
      this.root.querySelector<HTMLButtonElement>('[data-cmd="execute"], [data-cmd="continue"]')?.click()
    }
  }
}
