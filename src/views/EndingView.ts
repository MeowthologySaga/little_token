import { BACKGROUNDS, SPRITES, TOKEN_FACES } from '@/assets'

interface Opts {
  completedRun?: boolean
  onComplete: () => void
}

const CUTS = [
  {
    kicker: '마지막 장 · 고쳐 쓴 결말',
    title: '거미줄이 끊어졌다.',
    body: '장로거미가 고쳐 쓰던 문장은 멈췄다. 프롬은 찢어진 페이지를 한 장씩 펴서, 자신의 글씨로 결말을 다시 잇는다.',
    actor: SPRITES.boss_elder_spider,
    actorAlt: '쓰러진 장로거미',
    tone: 'spider',
  },
  {
    kicker: '그리고, 맑아진 여백',
    title: '이야기는 지켜 냈어.',
    body: '토큰이 되찾은 문장 위를 환하게 맴돈다. 끝이라고 적은 자리 너머에도, 아직 쓰지 않은 페이지가 바람에 팔랑인다.',
    actor: TOKEN_FACES.smile,
    actorAlt: '웃는 토큰',
    tone: 'token',
  },
  {
    kicker: 'ENDLESS · 새로운 한 권',
    title: '하지만 이야기는 계속된다.',
    body: '15층의 이야기를 마쳤습니다. 이제 같은 여정을 더 강해진 벌레들과 반복하며, 매 15층마다 한층 높아진 난이도에 도전합니다.',
    actor: SPRITES.player_001,
    actorAlt: '새 일기장을 든 프롬',
    tone: 'from',
  },
] as const

/** 첫 장로거미 처치 뒤 한 번만 재생되는 엔딩 컷씬. 후속 원화가 와도 컷 데이터만 교체할 수 있다. */
export class EndingView {
  private index = 0
  private acted = false
  private keydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') this.next()
  }

  constructor(private root: HTMLElement, private opts: Opts) {
    this.mount()
    window.addEventListener('keydown', this.keydown)
  }

  destroy() {
    window.removeEventListener('keydown', this.keydown)
  }

  private mount() {
    this.root.innerHTML = `
      <main class="scene ending-scene" style="background-image:url(${BACKGROUNDS.battleDark})">
        <div class="ending-vignette" aria-hidden="true"></div>
        <section class="ending-cut" aria-live="polite"></section>
        <div class="ending-progress" aria-label="엔딩 진행"></div>
      </main>`
    this.root.querySelector('.ending-scene')?.addEventListener('click', () => this.next())
    this.render()
  }

  private render() {
    const cut = this.opts.completedRun && this.index === CUTS.length - 1 ? { ...CUTS[this.index], kicker: '한 권의 끝', title: '이야기를 지켜 냈어.', body: '15층의 이야기를 마쳤습니다. 수집한 개념과 아이템을 기록하고 새 일기를 시작할 수 있습니다.' } : CUTS[this.index]
    const panel = this.root.querySelector<HTMLElement>('.ending-cut')!
    panel.className = `ending-cut tone-${cut.tone}`
    panel.innerHTML = `
      <div class="ending-art"><img src="${cut.actor}" alt="${cut.actorAlt}"></div>
      <article class="ending-page">
        <div class="ending-kicker">${cut.kicker}</div>
        <h1 class="hand">${cut.title}</h1>
        <p>${cut.body}</p>
        <button type="button" class="ending-next">${this.index === CUTS.length - 1 ? this.opts.completedRun ? '런 결과 보기' : '엔드리스 모드 시작' : '다음 장'}</button>
      </article>`
    this.root.querySelector('.ending-progress')!.innerHTML = CUTS.map(
      (_, index) => `<i${index === this.index ? ' class="on"' : ''}></i>`,
    ).join('')
    panel.classList.remove('is-entering')
    requestAnimationFrame(() => panel.classList.add('is-entering'))
    panel.querySelector<HTMLButtonElement>('.ending-next')?.focus()
  }

  private next() {
    if (this.acted) return
    if (this.index < CUTS.length - 1) {
      this.index++
      this.render()
      return
    }
    this.acted = true
    this.opts.onComplete()
  }
}
