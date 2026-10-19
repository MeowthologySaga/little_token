/** 포크판이 기본 진입점. 원본 저장/플레이는 mode=classic에 분리해 보존한다. */
import './style.css'
if (new URLSearchParams(location.search).get('mode') === 'classic') {
  void import('./main')
} else if (new URLSearchParams(location.search).get('mode') === 'prototype') {
  void import('./views/SteeringView').then(async ({ SteeringView }) => {
    const { FontManager } = await import('./ui/FontManager')
    const { GraphicsSettings } = await import('./ui/GameSettings')
    GraphicsSettings.apply()
    document.documentElement.lang = 'ko'
    const stage = document.getElementById('stage')!
    const resize = () => stage.style.setProperty('--scale', String(Math.min(innerWidth / 1920, innerHeight / 1080)))
    resize(); window.addEventListener('resize', resize)
    void FontManager.load()
    new SteeringView(stage)
  }).catch(error => {
    console.error(error)
    const stage = document.getElementById('stage')!
    stage.textContent = '개선판을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'
  })
}

else { void import('./integrated') }
