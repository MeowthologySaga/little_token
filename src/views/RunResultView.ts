/**
 * 런 결과 — 일기장에서 찢겨 나온 종이 한 장. 승리와 패배가 같은 종이를 쓰고
 * 도장·토큰·색만 갈린다. 무엇에게 갉아먹혔는지, 무엇을 모았는지, 어디까지 갔는지를
 * 한 장에 촘촘히 적어 "이 판이 어떤 판이었는지"가 한눈에 읽히게 한다.
 *
 * 전리품 화면(RewardView)의 조판을 따른다 — 유리 카드 + 상단 토큰 + 가운데 정렬.
 * 결과 화면만 다른 문법으로 생기면 런의 끝이 딴 게임처럼 보인다.
 */

import { BACKGROUNDS, SPRITES, TOKEN_FACES } from '@/assets'
import { itemArt } from '@/ui/Icons'
import { GameAudio } from '@/audio/GameAudio'
import { ownedItemRarity, STAT_META, type PlayerState } from '@core/player'
import type { DefeatCause, RunRecord } from '@core/run'
import { STARTING_COMBAT_STATS } from '@core/player'
import { stageFor } from '@data/stages'
import { t } from '@/localization'
import { DISPLAY_FLOORS } from '@/config/edition'
import { EARLY_WORDS, makeEarlyTables } from '@data/earlyWords'
import { availableCombos } from '@core/deckInsights'
import { discoveredComboIds } from '@core/comboDiscovery'

export type RunOutcome = 'lost' | 'won'

interface Opts {
  conceptSummary?: string
  outcome: RunOutcome
  /** 몇 일째에 끝났는지. */
  day: number
  player: PlayerState
  record: RunRecord
  /** 패배일 때 무엇에게 쓰러졌는지. 승리면 없다. */
  cause?: DefeatCause | null
  /** 5층 전용 데모를 완주했을 때 정식판과 다른 마무리 정보를 보여 준다. */
  demoComplete?: boolean
  buildVersion?: string
  feedbackUrl?: string
  onNewRun: () => void
  onTitle: () => void
  /**
   * 승리는 런의 끝이 아니다 — 이야기를 지켜 낸 뒤에도 엔들리스로 계속 쓴다.
   * 이 값이 있으면 첫 버튼이 "새 일기"가 아니라 "계속 쓰기"가 된다.
   */
  onContinue?: () => void
}

const STAMP: Record<RunOutcome, { kicker: string; title: string; token: string; tokenAlt: string }> = {
  lost: {
    kicker: 'DIARY LOST',
    title: '일기장이 너무 상했다…',
    // 파랗게 질려 고개를 떨군 토큰 — 종이 아래에서 웅크린다.
    token: TOKEN_FACES.gloom,
    tokenAlt: '고개를 떨군 토큰',
  },
  won: {
    kicker: 'DIARY KEPT',
    title: '이야기를 지켜 냈다!',
    // 고깔모자에 나팔을 든 토큰 — 종이 위로 솟아오른다.
    token: TOKEN_FACES.party,
    tokenAlt: '나팔을 부는 토큰',
  },
}

const DEMO_STAMP = {
  kicker: 'DEMO COMPLETE',
  title: '첫 장을 지켜 냈다!',
  token: TOKEN_FACES.party,
  tokenAlt: '나팔을 부는 토큰',
}

/**
 * 종이 위아래로 삐져나오는 토큰이 잘리지 않게 남기는 여백. 축소 배율을 잴 때
 * 무대 높이에서 미리 뺀다.
 */
const FIT_PADDING = 28

function text(key: string, korean: string, values: Record<string, string | number> = {}): string {
  return t(key, korean).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
}

function stageProgressLabel(day: number): string {
  const stage = stageFor(day)
  const cycle = stage.endlessCycle > 0
    ? text('hudEndlessCycle', '엔드리스 {cycle}주기', { cycle: stage.endlessCycle })
    : text('hudStoryCycle', '첫 이야기')
  return `${cycle} · ${text('hudStageLabel', '스테이지')} ${stage.floor}/${DISPLAY_FLOORS}`
}

export class RunResultView {
  private acted = false
  private opts: Opts
  /** 내용이 늘어나면(아이템·처치 목록·폰트 교체) 다시 재어 배율을 고친다. */
  private fitObserver: ResizeObserver | null = null

  constructor(private root: HTMLElement, opts: Opts) {
    this.opts = opts
    this.mount()
  }

  destroy() {
    this.fitObserver?.disconnect()
    this.fitObserver = null
  }

  /**
   * 결과 종이는 스크롤하지 않는다 — 한 판의 기록은 한 화면에서 다 읽혀야 한다.
   * 아이템과 처치 목록은 런마다 길이가 달라지므로, 넘칠 때만 종이 전체를 통째로
   * 줄인다(글자만 줄이면 조판이 무너진다). 넘치지 않으면 배율은 1이다.
   */
  private fit = () => {
    const scene = this.root.querySelector<HTMLElement>('.result-scene')
    const paper = this.root.querySelector<HTMLElement>('.result-stage')
    if (!scene || !paper) return
    // offsetWidth/Height는 transform을 타지 않는 배치 크기라 배율을 되돌리지 않고 잴 수 있다.
    const height = paper.offsetHeight
    const width = paper.offsetWidth
    if (!height || !width) return
    const scale = Math.min(
      1,
      (scene.clientHeight - FIT_PADDING) / height,
      (scene.clientWidth - FIT_PADDING) / width,
    )
    paper.style.setProperty('--result-fit', scale.toFixed(4))
  }

  private mount() {
    const { outcome, day, player, record } = this.opts
    if (outcome === 'lost') {
      GameAudio.play('gameOver')
      GameAudio.playDefeatBgm()
    }
    const stamp = this.opts.demoComplete ? DEMO_STAMP : STAMP[outcome]

    this.root.innerHTML = `
      <main class="scene result-scene" data-outcome="${outcome}" data-demo="${this.opts.demoComplete ? 'true' : 'false'}" style="background-image:url(${BACKGROUNDS.bg001})">
        <div class="result-stage">
          <div class="result-paper" role="status" aria-live="polite">
            <div class="result-token" aria-hidden="true">
              <img src="${stamp.token}" alt="${stamp.tokenAlt}" />
            </div>
            <div class="result-head">
              <div class="k">${stamp.kicker}</div>
              <h1 class="t hand">${this.opts.demoComplete ? text('demoResultTitle', stamp.title) : stamp.title}</h1>
              <div class="result-day">${stageProgressLabel(day)}${this.opts.demoComplete
                ? text('demoResultCleared', ' 완주')
                : outcome === 'lost' ? '에서 멈췄다' : '까지 써 냈다'}</div>
            </div>

            ${this.opts.conceptSummary ? `<p class="result-concepts">${this.opts.conceptSummary}</p>` : ''}
            ${this.causeHtml()}
            ${this.opts.demoComplete ? this.demoDiscoveriesHtml(player) : ''}

            <div class="result-cols">
              <section class="rs-block rs-stats">
                <h2>마지막 몸</h2>
                <ul class="rs-statlist">${this.statsHtml(player)}</ul>
              </section>
              <section class="rs-block rs-kills">
                <h2>갉아 낸 벌레 <b>${this.totalKills()}</b></h2>
                ${this.killsHtml()}
              </section>
              <section class="rs-block rs-items">
                <h2>주워 담은 것 <b>${player.items.length}</b></h2>
                ${this.itemsHtml(player)}
              </section>
            </div>

            <div class="result-records">${this.recordsHtml(record)}</div>
            ${this.opts.demoComplete ? this.demoReleaseHtml() : ''}

            <div class="result-actions">
              ${this.opts.onContinue
                ? '<button class="result-new" type="button" data-act="continue">계속 쓰기</button>'
                : `<button class="result-new" type="button" data-act="new">${this.opts.demoComplete ? text('demoResultReplay', '데모 다시 시작') : '새 일기 시작'}</button>`}
              <button class="result-title" type="button" data-act="title">타이틀로</button>
            </div>
          </div>
        </div>
      </main>`

    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((button) =>
      button.addEventListener('click', () => this.act(button.dataset.act ?? '')),
    )
    this.root.querySelector<HTMLButtonElement>('[data-act="new"]')?.focus()

    const paper = this.root.querySelector<HTMLElement>('.result-stage')
    if (paper) {
      this.fit()
      // 장식 폰트 교체와 아이템 원화 로드가 끝나면 높이가 달라진다 — 그때마다 다시 잰다.
      this.fitObserver = new ResizeObserver(this.fit)
      this.fitObserver.observe(paper)
    }
  }

  /** 나를 갉아먹은 것 — 종이에서 가장 크게 적히는 한 줄. */
  private causeHtml(): string {
    const { outcome, cause } = this.opts
    if (this.opts.demoComplete) {
      return `
        <div class="result-cause is-won is-demo">
          <div class="rc-label">${text('demoResultFirstBoss', '첫 번째 보스')}</div>
          <div class="rc-name">${text('demoResultMantis', '사마귀를 물리쳤다')}</div>
          <div class="rc-note">${text('demoResultNote', '다섯 장의 문장을 지키며 첫 번째 이야기를 완성했다.')}</div>
        </div>`
    }
    if (outcome === 'won') {
      return `
        <div class="result-cause is-won">
          <div class="rc-label">마지막 장</div>
          <div class="rc-name">고쳐 쓴 결말</div>
          <div class="rc-note">낙서에 먹히던 문장을 끝까지 제 글씨로 되찾았다.</div>
        </div>`
    }
    if (!cause) {
      return `
        <div class="result-cause">
          <div class="rc-label">사인</div>
          <div class="rc-name">알 수 없는 무엇</div>
          <div class="rc-note">일기장이 스스로 닳아 버렸다.</div>
        </div>`
    }
    if (cause.kind === 'self') {
      return `
        <div class="result-cause is-self">
          <div class="rc-label">나를 갉아먹은 것</div>
          <div class="rc-name">내가 쓴 문장</div>
          <div class="rc-note">「${cause.sentence}」 — 제 손으로 쓴 문장이 제 일기장을 깎았다.</div>
        </div>`
    }
    const portrait = SPRITES[cause.sprite]
    return `
      <div class="result-cause">
        ${portrait ? `<img class="rc-face" src="${portrait}" alt="${cause.name}" />` : ''}
        <div class="rc-text">
          <div class="rc-label">나를 갉아먹은 것</div>
          <div class="rc-name">${cause.name}</div>
          <div class="rc-note">${cause.note}</div>
        </div>
      </div>`
  }

  private demoDiscoveriesHtml(player: PlayerState): string {
    const startingIds = new Set(Object.values(EARLY_WORDS).flat().map((word) => word.id))
    const deckWords = Object.values(player.deck).flat()
    const newWords = deckWords.filter((word) => !startingIds.has(word.id))
    const reinforced = deckWords.filter((word) => (word.level ?? 1) > 1)
    const discovered = discoveredComboIds()
    const combos = availableCombos(player.deck, makeEarlyTables(player.deck, player).combos).filter((combo) => discovered.has(combo.id))
    const names = (values: string[]) => {
      if (!values.length) return text('demoResultNone', '없음')
      const shown = values.slice(0, 6)
      return `${shown.join(' · ')}${values.length > shown.length ? ` +${values.length - shown.length}` : ''}`
    }
    return `
      <section class="demo-discoveries" aria-label="${text('demoResultDiscoveries', '데모 발견 기록')}">
        <div><span>${text('demoResultNewWords', '새 단어')} <b>${newWords.length}</b></span><p>${names(newWords.map((word) => word.text))}</p></div>
        <div><span>${text('demoResultReinforced', '반복강화')} <b>${reinforced.length}</b></span><p>${names(reinforced.map((word) => `${word.text} Lv.${word.level}`))}</p></div>
        <div><span>${text('demoResultCombos', '완성 관용구')} <b>${combos.length}</b></span><p>${names(combos.map((combo) => combo.name))}</p></div>
        <div><span>${text('demoResultItems', '아이템')} <b>${player.items.length}</b></span><p>${names(player.items.map((item) => item.name))}</p></div>
      </section>`
  }

  private demoReleaseHtml(): string {
    const feedback = this.opts.feedbackUrl
      ? `<a class="demo-feedback" href="${this.opts.feedbackUrl}" target="_blank" rel="noreferrer">${text('demoResultFeedback', '플레이 후기 남기기')}</a>`
      : ''
    return `
      <section class="demo-release">
        <div>
          <h2>${text('demoResultFullTitle', '이야기는 정식판에서 계속된다')}</h2>
          <p>${text('demoResultFullBody', '정식판은 15스테이지, 세 보스, 후반 보상과 클리어 후 엔드리스를 담는다.')}</p>
          <small>${text('demoResultSaveScope', '데모 저장은 데모 안에서만 이어지며 정식판으로 이전되지 않는다.')} · v${this.opts.buildVersion ?? '0.0.0'}</small>
        </div>
        ${feedback}
      </section>`
  }

  private statsHtml(player: PlayerState): string {
    return STAT_META.map((meta) => {
      const now = player.stats[meta.key] ?? 0
      const start = STARTING_COMBAT_STATS[meta.key] ?? 0
      const gain = now - start
      return `
        <li>
          <span class="rs-stat-name">${meta.label}</span>
          <span class="rs-stat-val">${now}</span>
          ${gain > 0 ? `<span class="rs-stat-gain">+${gain}</span>` : ''}
        </li>`
    }).join('')
  }

  private totalKills(): number {
    return Object.values(this.opts.record.kills).reduce((n, v) => n + v, 0)
  }

  private killsHtml(): string {
    const entries = Object.entries(this.opts.record.kills).sort((a, b) => b[1] - a[1])
    if (entries.length === 0) return '<p class="rs-empty">한 마리도 못 잡았다.</p>'
    return `<ul class="rs-killlist">${entries
      .map(([name, n]) => `<li><span>${name}</span><b>×${n}</b></li>`)
      .join('')}</ul>`
  }

  private itemsHtml(player: PlayerState): string {
    if (player.items.length === 0) return '<p class="rs-empty">아무것도 줍지 못했다.</p>'
    return `<div class="rs-itemgrid">${player.items
      .map((item) => `
        <div class="rs-item rarity-${ownedItemRarity(item)}" title="${item.name} — ${item.line}">
          <div class="rs-item-art">${itemArt(item.art)}</div>
          <div class="rs-item-name">${item.name}</div>
        </div>`)
      .join('')}</div>`
  }

  /** 하단 띠 — 자랑거리 수치들. 없는 값은 칸을 만들지 않는다. */
  private recordsHtml(record: RunRecord): string {
    const cells: string[] = []
    cells.push(`<div class="rr-cell"><span>넘긴 날</span><b>${record.daysCleared}일</b></div>`)
    cells.push(`<div class="rr-cell"><span>쓴 문장</span><b>${record.sentences}개</b></div>`)
    if (record.bestMult > 0) {
      cells.push(`<div class="rr-cell hot"><span>최고 배율</span><b>×${record.bestMult.toFixed(2)}</b></div>`)
    }
    if (record.bestCombo > 1) {
      cells.push(`<div class="rr-cell hot"><span>최고 관통</span><b>×${record.bestCombo}</b></div>`)
    }
    const best = record.bestHit
    return `
      <div class="rr-row">${cells.join('')}</div>
      ${best
        ? `<div class="rr-best">
             <span class="rr-best-label">가장 센 한 방</span>
             <b class="rr-best-dmg">${best.dmg}</b>
             <span class="rr-best-sentence">「${best.sentence}」</span>
           </div>`
        : ''}`
  }

  private act(action: string) {
    if (this.acted) return
    this.acted = true
    if (action === 'continue') this.opts.onContinue?.()
    else if (action === 'new') this.opts.onNewRun()
    else this.opts.onTitle()
  }
}
