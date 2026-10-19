# v0.17.0 통합 구현 결과

2026-10-18. 기존 미커밋/미추적 작업과 classic/prototype 저장을 보존했다. 커밋·푸시·배포·외부 업로드는 하지 않았다.

## 실제 기본 진입과 게임

`src/fork.ts → src/integrated.ts`가 기본 경로다. 원본 TitleView/오프닝/설정/화면 스케일/오디오로 시작하고
실제 빈칸 전투→개념 보상→아이템 선택→원본 감탄 제련→스탯 성장→다음 스테이지→세 보스→최종 보상→엔딩/런 결과를 연결한다.
패배와 전투/보상/제련/엔딩 재개, 단계별 중복 보상 방지를 구현했다.

- 공용 손패 6장. 문장마다 3~5칸, 무료 빈칸 한 곳. 범주는 주어/수식/목적어/행동만 사용한다.
- 매 턴 잉크 2로 고정 칸을 수정한다. 같은 칸 재교체 중복 비용 없음, 원안 복원 환불, 0 잉크 제한, 저장 재개/새 턴 리필을 구현했다.
- 실제 주어/목적어, 적끼리 공격, 자기 타격, 모든 미참여 적 기본 행동, 같은 주어의 명시된 두 행동을 동일 해석기로 예측/실행한다.
- 선두 레일은 통합 경로에 없다. 여러 적의 대형/HP/상태/타격/반사/가시/충돌/화상/연타와 일벌 피격을 개별 배우로 재생한다.
- 원본 stageFor/필드/배경/정예/아이템 데이터와 sim을 재사용한다. 일반 적 공격 배율은 동시 참여 수로 나눠 압력을 조정했다.
- 사마귀 예고·방어 파괴·그로기/행동 생략, 여왕벌 일벌·본체 보호·반동·재소환, 장로거미 부위·약점·실드·거미줄을 연결했다.

## 이미지와 관리자 피드백 반영

승인 이미지의 상단 실제 스탯/진행, 왼쪽 순서/아이템, 중앙 전장과 두 검은 문장 리본, 오른쪽 양피지 네 역할 비교,
하단 6장 손패/실제 잉크/실행 버튼 배치를 구현했다. 기존 배경/삽화/캐릭터만 사용했다.

1. 저장 전후 optional undefined를 normalizeIntegratedRun의 JSON 정규형으로 통일했다. 전체 결과 deepEqual을 유지했다.
2. 카드 앞면 그림/이름/짧은 활용/핵심 효과 영역을 고정하고 긴 활용은 두 줄 제한/상세 원문으로 분리했다.
3. 왼쪽은 확정 run 계획만 읽는다. hover는 오른쪽 미선택 결과에만 쓰며 실행 중 trace의 실제 순서/배우/대상을 표시한다.
4. 주어/수식은 행동자, 지원 동사는 목적어 대상이라는 recipient를 설명과 실제 적용에서 맞췄다.
5. 나는/나를은 항상 프롬이라는 의미를 유지하고 실제 배우/대상 이름을 문장 옆에 명시했다.

## 중요한 변경 경로

- `src/integrated.ts`, `src/fork.ts`: 제품 진입/화면/런 루프 연결, 비교 경로 분리.
- `src/core/integratedSentences.ts`: 목적어/실체 참조/잉크/수정/정규화.
- `src/core/integratedCombat.ts`, `src/core/steeringBridge.ts`: 다중 배우 실제 턴/원본 보스·적·스탯·아이템 브릿지.
- `src/core/steering.ts`, `src/core/steeringBeats.ts`: 기존 프로토타입 보존과 통합 분기/실제 타격 이벤트.
- `src/views/SteeringView.ts`, `src/views/steering.css`, `src/ui/WordCardFace.ts`: 이미지 배치/상시 상세/카드 영역/확정 계획과 실행 표시.
- `src/views/ItemExclaimView.ts`, `src/core/itemForge.ts`: 원본 감탄 난수/선택 체크포인트.
- `src/sim/reference.ts`: 기존 기본 동작을 유지한 임의 대상 판정 훅.
- `src/tools/integrated-steering-check.ts`, `src/tools/integrated-opening-sim.ts`: 회귀/초반 실제 루프 수치 검사.
- `AGENTS.md`, `FORK_GAMEPLAY.md`, `FORK_QA.md`, `INTEGRATION_DESIGN.md`, VERSION/package/lock: 현재 계약과 버전 정합.

## 검사 결과

- 최종 `npm run type-check`: 통과.
- `npm run integrated:check`: 관리자 피드백 수정 후 **전체 23개 통과**. 저장 전체 결과 비교, 잉크/대상/주어/다중 적,
  각 보스/보상/성장/엔딩/재개와 hover 분리/효과 수신자/카드 영역 계약을 포함한다.
- `core:check`, `locale:check`, `boss:sim`, `sweep`: 통과.
- `git diff --check`, VERSION/package/lock 0.17.0 정합: 통과.
- `steering:check`, `effects:check`, `items:check`, `integrated:sim`: 이 CLI에서는 esbuild spawn EPERM으로 실행 불가.
  관리자 중간 단계에서는 표준 build와 steering:check 23개가 이미 통과했다.
- 23개 통과 뒤 추가한 실제 enemyTurn 클립 단계 동기화/유료 수정 카드 선택 표시의 최종 integrated:check 재실행도 EPERM이다.
  최종 타입 검사는 이 변경을 포함한다. 검사를 우회하거나 기능 비교를 삭제하지 않았다.

## 보존과 제한

- 현재 키 `little-token.integrated.v2`. classic `little-token.run.v1`/prototype `little-token-steering-v1`과 v1 실험 저장을 덮거나 삭제하지 않았다.
  `?mode=classic`, `?mode=prototype`에서 기존 방식/기존 저장을 비교한다. 서로 다른 규칙이라 자동 변환하지 않는다.
- 원본 슬롯/문장 규칙 패시브 아이템은 이 모드에서 모두 명시적으로 제외한다. 실제 스탯 아이템/감탄/성장은 연결했다.
- 원본 슬롯 덱/영감 상점/슬롯 관용구/엔드리스/여섯 언어/메타 기록 전체를 통합 완료라고 표시하지 않는다.
  현재는 한국어 15층 통합 런이다. 슬롯 관용구가 없어 장로거미의 약점+관용구 부위 관통은 제공하지 않으며 약점/부위 파괴 진행을 사용한다.
- 초반 동시 전투 수치 시뮬레이션 코드는 실제 루프를 사용하지만 EPERM으로 수치 결과를 얻지 못했다.
- 브라우저/서버/새 이미지 생성·에셋 구매는 실행하지 않았다. 최종 시각·실제 감탄 완료 경로의 브라우저 검수와 최종 표준 빌드는 관리자 범위다.

## 관리자 확인 경로

표준 `npm run type-check`, `npm run steering:check`, `npm run integrated:check`, `npm run integrated:sim`,
`npm run effects:check`, `npm run items:check`, `npm run build`를 승인된 환경에서 실행한다.
기본 `/`에서 1280×720/1920×1080 카드 영역/오른쪽 원문, 확정 후 다른 목적어 hover 시 왼쪽 불변과 오른쪽 미선택,
나는/나를 자기 타격/미참여 적 기본 행동/실제 현재 타격 순서를 확인한다.
이어 실제 승리→개념→아이템→감탄 중 재로드→스탯 반영→다음 날, 5/10/15 고유 기믹→최종 보상→엔딩을 확인한다.
이미 관리자에게서 확인받은 진입·잉크 수정/환불·무료 드래그·HP52→44 예측 일치·다음 턴 리필 실측은 중복 확인하지 않았다.
