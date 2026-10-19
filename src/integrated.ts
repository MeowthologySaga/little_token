import { CONCEPT_BY_ID } from '@data/steering'
import { installResourceFailureMonitor } from '@/ui/ResourceFailures'
import { installRuntimeErrorBoundary } from '@/ui/RuntimeErrorBoundary'
/** 원본 제품 진입과 빈칸 전투를 연결하는 컨트롤러. classic 저장에는 접근하지 않는다. */
import { TitleView } from '@views/TitleView'
import { CinematicIntro } from '@views/CinematicIntro'
import { EndingView } from '@views/EndingView'
import { RunResultView } from '@views/RunResultView'
import { SteeringView } from '@views/SteeringView'
import { createSteeringRun, loadSteeringRun, saveSteeringRun } from '@core/steering'
import { emptyRunRecord } from '@core/run'
import { GraphicsSettings } from '@/ui/GameSettings'
import { openSettingsModal } from '@/ui/SettingsModal'
import { installMobileViewport } from '@/ui/MobileViewport'
import { FontManager } from '@/ui/FontManager'
import { GameAudio } from '@/audio/GameAudio'
import { installFoilShaders } from '@/ui/FoilShader'
import { CustomCursor } from '@/ui/CustomCursor'
import { ClickScribble } from '@/ui/ClickScribble'
import { ST_INTEGRATED } from '@/localization/steeringIntegrated'
import packageInfo from '../package.json'

const root = document.getElementById('stage')!
let current: { destroy?: () => void } | null = null
let intro: CinematicIntro | null = null
let run = loadSteeringRun(true)
function reset() { intro?.destroy(); intro = null; current?.destroy?.(); current = null; root.innerHTML = ''; root.classList.remove('steering-root') }
function result() {
  const saved = run!
  reset()
  if (saved.phase === 'won' && !saved.product!.endingSeen) {
    current = new EndingView(root, { completedRun: true, onComplete: () => { saved.product!.endingSeen = true; saveSteeringRun(saved); result() } })
    return
  }
  const record = emptyRunRecord()
  record.sentences = saved.totalTurns * 2; record.daysCleared = saved.product!.completedFloors.length
  current = new RunResultView(root, { outcome: saved.phase === 'won' ? 'won' : 'lost', day: saved.floor,
    player: saved.product!.player, record, conceptSummary: saved.deck.map(id => `${CONCEPT_BY_ID[id].name}${saved.levels[id] ? ' +' + saved.levels[id] : ''}`).join(' · '), buildVersion: packageInfo.version,
    onNewRun: () => { run = createSteeringRun(undefined, true); saveSteeringRun(run); battle() }, onTitle: () => title() })
}
function battle() {
  reset()
  current = new SteeringView(root, { run: run!, onSettings: settings, onHome: () => { run = loadSteeringRun(true); title() }, onFinish: saved => { run = saved; result() } })
}
function settings() { openSettingsModal(root, { resetScope: ST_INTEGRATED.resetScope, onResetAll: () => { run = createSteeringRun(undefined, true); saveSteeringRun(run); battle() } }) }
function title(withIntro = false) {
  reset(); run = loadSteeringRun(true)
  const view = new TitleView(root, { hasSave: !!run, holdUi: withIntro,
    onSettings: settings,
    onGuide: () => { const notice = document.createElement('dialog'); notice.textContent = ST_INTEGRATED.guide; const close = document.createElement('button'); close.textContent = '닫기'; close.onclick = () => notice.remove(); notice.append(close); root.append(notice); notice.showModal() },
    onStart: fresh => { run = !fresh && loadSteeringRun(true) || createSteeringRun(undefined, true); saveSteeringRun(run); battle() },
  })
  current = view
  if (withIntro) intro = new CinematicIntro(root, { onFadeStart: () => view.freezeAmbient(),
    onFireflyLayer: canvas => view.addFireflyLayer(canvas), onFireflyLayerDone: canvas => view.removeFireflyLayer(canvas),
    onDone: () => { view.thawAmbient(); view.revealUi() } })
}
installResourceFailureMonitor(); installRuntimeErrorBoundary(root, 'ko')
GraphicsSettings.apply(); installMobileViewport(root); GameAudio.installButtonSounds(); installFoilShaders()
if (!matchMedia('(pointer: coarse)').matches) { CustomCursor.install(); ClickScribble.install() }
void FontManager.load()
document.documentElement.lang = 'ko'
title(true)
