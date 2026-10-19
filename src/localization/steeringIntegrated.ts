/** 한국어 통합 모드 전용 문구. classic의 여섯 언어 계약과 분리한다. */
export const ST_INTEGRATED = {
  roleComparison: '네 역할을 함께 비교 · 목적어는 실체 참조로 지정',
  ui: {
    player: '프롬', hp: '체력', attack: '공격', guard: '방어', stock: '비축', heal: '회복', luck: '운',
    settings: '설정', deck: '단어장', help: '도움말', mute: '음소거', unmute: '음소거 해제', home: '처음으로',
    composing: '문장 완성', rolling: '구절을 정하는 중', executing: '문장 실행', turnResult: '이번 턴의 결과',
    sentences: { situation: '첫 번째 문장', action: '두 번째 문장' },
    blank: '단어 선택', free: '무료', placed: '배치됨', restore: '원안 복원, 잉크 1 환불',
    freeHint: '무료 빈칸 · 카드를 놓으세요', editHint: '고정 칸 수정 · 잉크 1', editedHint: '수정한 칸 · 원안 복원 시 환불', noInkHint: '수정할 잉크가 없습니다',
    otherUses: '다른 활용', currentUse: '현재 활용', trial: '미리보기 · 미선택', confirmed: '선택한 조합',
    referenceHint: '주어·목적어에 사용', conceptTargetHint: '목적어는 프롬·적·모두 카드로 지정하세요',
    noPreview: (count: number) => `빈칸 ${count}곳을 채우세요`,
    referenceRules: '주어가 행동하고 목적어가 대상을 정합니다.',
    planHint: '미선택 빈칸은 원안 기준. 먼저 쓰러진 배우는 행동하지 않습니다.',
    ink: '잉크', inkHint: '빈칸 무료 · 고정 칸당 1 · 같은 칸 재수정 무료 · 원안 복원 시 환불',
    chooseTarget: '대상 선택', chooseActor: '배우 선택', noItems: '아직 없어요',
    handHint: '카드 선택 → 칸 클릭 · 드래그 가능',
    redraw: '새 손패', execute: '실행', fillBlanks: '빈칸을 채우세요', damageDetails: '피해 계산',
    roleDetails: '네 역할 전체 비교', result: '예상 결과',
    cardEffect: '카드 효과', close: '닫기', plan: '행동 순서', items: '아이템', restoreHint: '원안 복원', saved: '저장됨',
    referenceUse: '주어 · 목적어', actorUse: '행동자 지정', targetUse: '대상 지정', unavailable: '사용 불가', targetUnavailable: '대상 지정 불가',
    changed: '고정 칸 수정 1',
  },
  subjectTraits: {
    fire: '불꽃을 두른', mirror: '거울을 두른', wind: '바람 같은', thorn: '가시 돋친',
    force: '힘센', weaken: '기운 빠진', calm: '신중한', echo: '메아리치는',
    rest: '숨을 고른', reckless: '무모한', link: '연결된', weight: '묵직한', rush: '돌진하는',
  } as Record<string, string>,
  mantisWarning: '큰낫이 내려와! 위에 적힌 필요 방어를 채우면 그로기와 다음 공격 생략이 열려!',
  queenWarning: '일벌이 남아 있으면 본체는 무적이고 독침은 방어를 관통해! 메아리·연결로 먼저 호위를 없애자!',
  spiderWarning: '다리마다 감정 약점이 달라! 손패의 거미줄 봉인은 약점 공격이나 방어·회복으로 풀 수 있어!',
  itemChoice: '이 장에서 가져갈 아이템',
  excludedPassives: '이 모드는 스탯 아이템을 사용합니다. 원본 슬롯·문장 규칙 패시브 아이템은 보상에서 제외됩니다.',
  forgeHint: '선택 후 감탄 문장을 완성해 영구 스탯을 얻습니다.',
  rewardFlow: '개념 한 장 → 아이템 선택 → 감탄 문장 → 스탯 적용 → 다음 날. 체력은 자동 회복되지 않습니다.',
  resetScope: { label: '통합 런 새로 시작', note: '현재 통합 런을 새로 시작합니다. 원본과 프로토타입 저장은 보존합니다.', confirmNote: '한 번 더 누르면 통합 런을 새로 시작합니다.' },
  guide: '빈칸 통합판은 한국어로 플레이합니다. 공용 손패 6장으로 두 문장의 빈칸을 채우세요. 보스의 고유 행동은 계속 진행되며, 개념으로 그 위력과 방어·반격을 바꿉니다.',
}

/** 전체 설명은 상세에 남기고 앞면에서는 현재 값의 핵심 효과를 읽는다. */
export function integratedEffectSummary(description: string): string {
  const parts = description.split(' · ').filter(text => !/^\d+턴$|^준비 효과 합산$|^다음 턴까지$|^이 문장 행동 주체|^내 문장에 넣으면/.test(text))
  const compact = (text: string) => text
    .replace(/행동 위력 /g, '위력 ').replace(/행동자: /g, '').replace(/목적어 대상: /g, '')
    .replace(/행동자에게 /g, '').replace(/목적어 대상에게 /g, '').replace(/행동자 회복 /g, '회복 ')
    .replace(/목적어 대상 회복 /g, '회복 ').replace(/공격\/접촉 상대에게 /g, '접촉 ')
    .replace(/·최대 100% 상쇄/g, '').replace(/회 행동/g, '회')
    .replace(/행동 후 주체의 받는 타격 /g, '피격 ').replace(/피격마다 가시/g, '가시')
    .replace(/타격의 (\d+)%를 .*/, '연결 $1%').replace(/\.00\b/g, '').replace(/(\.\d)0\b/g, '$1')
  const primary = compact(parts[0])
  const weak = parts.find(text => text.startsWith('행동 후 주체의 받는 타격'))
  if (weak) return `${primary.replace('위력 ', '')} · ${compact(weak)}`
  const hits = parts.find(text => /^\d+회 행동/.test(text))
  const shown = hits ? `${compact(hits)} · ${primary.replace('위력 ', '')}` : primary
  const remaining = parts.length - (hits ? 2 : 1)
  return remaining > 0 ? `${shown} 외 ${remaining}` : shown
}
