import { GameAudio } from '@/audio/GameAudio'
import {
  GraphicsSettings,
  type AntiAliasingQuality,
  type EffectsQuality,
  type FrameRateLimit,
  type GraphicsQuality,
  type PostProcessingQuality,
  type ResolutionScale,
} from '@/ui/GameSettings'
import { icon } from '@/ui/Icons'
import { currentLocale, LOCALE_NAMES, setLocale, SUPPORTED_LOCALES, t, type LocaleCode } from '@/localization'

type SettingsTab = 'graphics' | 'sound' | 'other'

/** 전투와 타이틀이 같은 저장값·마크업을 쓰는 공용 설정 모달. */
export function openSettingsModal(root: HTMLElement, opts: { onResetAll: () => void; resetScope?: { label: string; note: string; confirmNote: string } }) {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let host = root.querySelector<HTMLElement>('#overlay')
  if (!host) {
    host = document.createElement('div')
    host.id = 'overlay'
    root.append(host)
  }
  const volume = Math.round(GameAudio.getVolume() * 100)
  const graphics = GraphicsSettings.matchingPreset()
  const antiAliasing = GraphicsSettings.getAntiAliasing()
  const resolution = GraphicsSettings.getResolution()
  const fps = GraphicsSettings.getFps()
  const effects = GraphicsSettings.getEffects()
  const postprocessing = GraphicsSettings.getPostProcessing()

  host.innerHTML = `
    <div class="ov-backdrop"></div>
    <section class="ov-panel glass settings-panel" role="dialog" aria-modal="true" aria-label="${t('settings', '설정')}">
      <div class="ov-head"><div class="ov-title">${icon('settings')} ${t('settings', '설정')}</div><button class="ov-close" id="ov-x" type="button" aria-label="${t('close', '닫기')}">${icon('close')}</button></div>
      <div class="settings-tabs" role="tablist" aria-label="${t('settingsCategories', '설정 분류')}">
        <button id="settings-tab-graphics" type="button" role="tab" data-settings-tab="graphics" aria-controls="settings-panel-graphics" aria-selected="true" tabindex="0">${t('graphics', '그래픽')}</button>
        <button id="settings-tab-sound" type="button" role="tab" data-settings-tab="sound" aria-controls="settings-panel-sound" aria-selected="false" tabindex="-1">${t('sound', '사운드')}</button>
        <button id="settings-tab-other" type="button" role="tab" data-settings-tab="other" aria-controls="settings-panel-other" aria-selected="false" tabindex="-1">${t('other', '기타')}</button>
      </div>
      <div id="settings-panel-graphics" class="settings-tab-panel graphics-settings-panel" data-settings-panel="graphics" role="tabpanel" aria-labelledby="settings-tab-graphics">
        <div class="settings-group settings-wide">
          <div class="settings-label"><b>${t('qualityPreset', '품질 프리셋')}</b><span>${t('qualityPresetHint', '세부 항목을 한 번에 설정')}</span></div>
          <div class="graphics-options" role="group" aria-label="그래픽 품질">
            <button type="button" data-quality="low" class="${graphics === 'low' ? 'on' : ''}"><b>${t('low', '낮음')}</b></button>
            <button type="button" data-quality="medium" class="${graphics === 'medium' ? 'on' : ''}"><b>${t('medium', '보통')}</b></button>
            <button type="button" data-quality="high" class="${graphics === 'high' ? 'on' : ''}"><b>${t('high', '높음')}</b></button>
            <button type="button" data-quality="ultra" class="${graphics === 'ultra' ? 'on' : ''}"><b>${t('ultra', '울트라')}</b></button>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-label"><b>${t('resolution', '해상도')}</b><span>${t('resolutionHint', '캐릭터 렌더 배율')}</span></div>
          <div class="graphics-options compact-options" role="group" aria-label="해상도 배율">
            ${['75', '100', '125', '150'].map((value) => `<button type="button" data-resolution="${value}" class="${resolution === value ? 'on' : ''}"><b>${value}%</b></button>`).join('')}
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-label"><b>${t('maxFps', '최대 FPS')}</b><span>${t('fpsHint', '렌더 갱신 빈도')}</span></div>
          <div class="graphics-options compact-options" role="group" aria-label="최대 FPS">
            ${['30', '45', '60', 'unlimited'].map((value) => `<button type="button" data-fps="${value}" class="${fps === value ? 'on' : ''}"><b>${value === 'unlimited' ? t('unlimited', '무제한') : value}</b></button>`).join('')}
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-label"><b>${t('effects', '이펙트')}</b><span>${t('effectsHint', '파편·불꽃 밀도')}</span></div>
          <div class="graphics-options triple-options" role="group" aria-label="이펙트 품질">
            <button type="button" data-effects="low" class="${effects === 'low' ? 'on' : ''}"><b>${t('low', '낮음')}</b></button>
            <button type="button" data-effects="medium" class="${effects === 'medium' ? 'on' : ''}"><b>${t('medium', '보통')}</b></button>
            <button type="button" data-effects="high" class="${effects === 'high' ? 'on' : ''}"><b>${t('high', '높음')}</b></button>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-label"><b>${t('postprocessing', '후처리')}</b><span>${t('postprocessingHint', '블러·색감·비네팅')}</span></div>
          <div class="graphics-options triple-options" role="group" aria-label="후처리 품질">
            <button type="button" data-postprocessing="off" class="${postprocessing === 'off' ? 'on' : ''}"><b>${t('off', '끔')}</b></button>
            <button type="button" data-postprocessing="medium" class="${postprocessing === 'medium' ? 'on' : ''}"><b>${t('medium', '보통')}</b></button>
            <button type="button" data-postprocessing="high" class="${postprocessing === 'high' ? 'on' : ''}"><b>${t('high', '높음')}</b></button>
          </div>
        </div>
        <div class="settings-group settings-wide">
          <div class="settings-label"><b>${t('antialiasing', '안티앨리어싱')}</b><span>${t('antialiasingHint', '캐릭터 가장자리')}</span></div>
          <div class="graphics-options triple-options" role="group" aria-label="안티앨리어싱 품질">
            <button type="button" data-aa="off" class="${antiAliasing === 'off' ? 'on' : ''}"><b>${t('off', '끔')}</b></button>
            <button type="button" data-aa="medium" class="${antiAliasing === 'medium' ? 'on' : ''}"><b>${t('medium', '보통')}</b><span>×1.35</span></button>
            <button type="button" data-aa="high" class="${antiAliasing === 'high' ? 'on' : ''}"><b>${t('high', '높음')}</b><span>×1.7</span></button>
          </div>
        </div>
      </div>
      <div id="settings-panel-sound" class="settings-tab-panel" data-settings-panel="sound" role="tabpanel" aria-labelledby="settings-tab-sound" hidden>
        <div class="settings-group">
          <div class="settings-label"><b>${t('masterVolume', '마스터 볼륨')}</b><span id="volume-value">${volume}%</span></div>
          <input id="volume-range" type="range" min="0" max="100" step="5" value="${volume}" aria-label="마스터 볼륨">
          <p>${t('volumeHint', '배경음악과 효과음의 전체 크기를 조절합니다.')}</p>
        </div>
      </div>
      <div id="settings-panel-other" class="settings-tab-panel" data-settings-panel="other" role="tabpanel" aria-labelledby="settings-tab-other" hidden>
        <div class="settings-group language-settings-group">
          <div class="settings-label"><b>${t('language', '언어')}</b><span>${LOCALE_NAMES[currentLocale]}</span></div>
          <select id="language-select" class="settings-select" aria-label="${t('language', '언어')}">
            ${SUPPORTED_LOCALES.map((locale) => `<option value="${locale}"${locale === currentLocale ? ' selected' : ''}>${LOCALE_NAMES[locale]}</option>`).join('')}
          </select>
          <p>${t('languageHint', '언어를 변경하면 페이지를 새로 불러옵니다.')}</p>
        </div>
        <div class="settings-group records-reset-group">
          <div class="settings-label"><b>${t('playRecords', '플레이 기록')}</b><span>${t('startOver', '처음부터 다시 쓰기')}</span></div>
          <button id="records-reset" class="settings-reset-btn" type="button">${(opts.resetScope?.label ?? t('resetAll', '모든 기록 삭제하고 새 게임'))}</button>
          <p id="records-reset-note" aria-live="polite">${(opts.resetScope?.note ?? t('resetNote', '진행 중인 일기와 튜토리얼 기록을 모두 삭제하고, 튜토리얼부터 바로 시작합니다.'))}</p>
        </div>
      </div>
    </section>`
  host.classList.add('open')

  const close = () => {
    window.removeEventListener('keydown', onModalKeydown)
    host!.classList.remove('open')
    host!.innerHTML = ''
    if (returnFocus?.isConnected) returnFocus.focus()
  }
  host.querySelector('#ov-x')!.addEventListener('click', close)
  host.querySelector('.ov-backdrop')!.addEventListener('click', close)

  const activateTab = (tab: SettingsTab) => {
    host!.querySelectorAll<HTMLElement>('[data-settings-panel]').forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== tab })
    host!.querySelectorAll<HTMLElement>('[data-settings-tab]').forEach((button) => {
      const active = button.dataset.settingsTab === tab
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    })
  }
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')]
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => activateTab(button.dataset.settingsTab as SettingsTab))
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      const next = tabs[nextIndex]
      activateTab(next.dataset.settingsTab as SettingsTab)
      next.focus()
    })
  })

  function onModalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...host!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.closest('[hidden]'))
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  window.addEventListener('keydown', onModalKeydown)
  host.querySelector<HTMLButtonElement>('#ov-x')?.focus()

  host.querySelector<HTMLSelectElement>('#language-select')!.addEventListener('change', (event) => {
    const locale = (event.currentTarget as HTMLSelectElement).value as LocaleCode
    if (locale === currentLocale) return
    setLocale(locale)
    window.location.reload()
  })

  const syncGraphicsSelection = () => {
    const values: Record<string, string> = {
      quality: GraphicsSettings.matchingPreset() ?? '',
      aa: GraphicsSettings.getAntiAliasing(),
      resolution: GraphicsSettings.getResolution(),
      fps: GraphicsSettings.getFps(),
      effects: GraphicsSettings.getEffects(),
      postprocessing: GraphicsSettings.getPostProcessing(),
    }
    Object.entries(values).forEach(([key, value]) => host!.querySelectorAll<HTMLElement>(`[data-${key}]`).forEach((item) => item.classList.toggle('on', item.dataset[key] === value)))
  }
  host.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => button.addEventListener('click', () => { GraphicsSettings.set(button.dataset.quality as GraphicsQuality); syncGraphicsSelection() }))
  host.querySelectorAll<HTMLButtonElement>('[data-aa]').forEach((button) => button.addEventListener('click', () => { GraphicsSettings.setAntiAliasing(button.dataset.aa as AntiAliasingQuality); syncGraphicsSelection() }))
  host.querySelectorAll<HTMLButtonElement>('[data-resolution]').forEach((button) => button.addEventListener('click', () => { GraphicsSettings.setResolution(button.dataset.resolution as ResolutionScale); syncGraphicsSelection() }))
  host.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((button) => button.addEventListener('click', () => { GraphicsSettings.setFps(button.dataset.fps as FrameRateLimit); syncGraphicsSelection() }))
  host.querySelectorAll<HTMLButtonElement>('[data-effects]').forEach((button) => button.addEventListener('click', () => { GraphicsSettings.setEffects(button.dataset.effects as EffectsQuality); syncGraphicsSelection() }))
  host.querySelectorAll<HTMLButtonElement>('[data-postprocessing]').forEach((button) => button.addEventListener('click', () => { GraphicsSettings.setPostProcessing(button.dataset.postprocessing as PostProcessingQuality); syncGraphicsSelection() }))

  const range = host.querySelector<HTMLInputElement>('#volume-range')!
  const value = host.querySelector<HTMLElement>('#volume-value')!
  range.addEventListener('input', () => {
    const next = Number(range.value)
    value.textContent = `${next}%`
    GameAudio.setVolume(next / 100)
  })

  const recordsReset = host.querySelector<HTMLButtonElement>('#records-reset')!
  let resetConfirmTimer = 0
  recordsReset.addEventListener('click', () => {
    if (!recordsReset.classList.contains('is-danger')) {
      recordsReset.classList.add('is-danger')
      recordsReset.textContent = t('resetConfirm', '정말 모두 삭제할까요?')
      host!.querySelector<HTMLElement>('#records-reset-note')!.textContent = (opts.resetScope?.confirmNote ?? t('resetConfirmNote', '한 번 더 누르면 삭제 후 새 게임을 시작합니다.'))
      resetConfirmTimer = window.setTimeout(() => {
        recordsReset.classList.remove('is-danger')
        recordsReset.textContent = (opts.resetScope?.label ?? t('resetAll', '모든 기록 삭제하고 새 게임'))
        host?.querySelector<HTMLElement>('#records-reset-note')?.replaceChildren((opts.resetScope?.note ?? t('resetNote', '진행 중인 일기와 튜토리얼 기록을 모두 삭제하고, 튜토리얼부터 바로 시작합니다.')))
      }, 3400)
      return
    }
    clearTimeout(resetConfirmTimer)
    opts.onResetAll()
  })
}
