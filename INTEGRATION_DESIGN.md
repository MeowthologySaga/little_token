# v0.17.0 통합 상태와 실행 계약 — 2026-10-18 최종

## 단일 출처

- 컨트롤러: `src/integrated.ts`. 원본 TitleView/CinematicIntro/설정/모바일 스케일러/오디오/ItemExclaimView/EndingView/RunResultView를 연결한다.
- 문장/손패/개념/현재 자원/진행 단계: SteeringRun. 영속 제품 확장: SteeringRun.product (schema 2).
- 실제 스탯/보유 아이템: product.player의 원본 PlayerState. 원본 슬롯 deck은 비워 두며 전투/카드 획득에 쓰지 않는다.
- 적 상태: Fighter.sim의 원본 EnemyInst. Fighter의 HP/최대 HP/공격은 이 상태를 동기화한 표시 투영이다.
  일벌 체력은 EnemyInst의 summonHp 배열에만 저장하고 연출은 그 변화 스냅샷을 읽는다.
- 문장 원안/원안 배우/무료 빈칸/수정: Sentence.fixed/originActor/blank/edits. 잉크는 edits 중 실제 원안과 다른 고정 칸 수로 계산한다.
- 실제 전투: `resolveTurn → resolveIntegratedTurn`. 미리보기와 확정이 동일한 순수 함수를 호출한다.
  integratedPlan은 모든 명시 행동과 미참여 적의 기본 행동을 만든다. 선두 레일은 이 경로에 없다.
- 원본 sim: applyIntent로 실드/호위/감정 약점/부위/그로기 피해, enemyTurn으로 기술 진행/흡혈/행동 순서/공격 생략,
  summonAtTurnStart/spiderWebAtTurnStart로 고유 턴 시작을 처리한다. enemyTurn의 optional adjudicate 훅은 통합판의
  실제 임의 대상 타격 결과를 받는다. classic은 기존 기본 판정을 그대로 사용한다.
- UI: AttackTrace/DamageEvent/SupportEvent/EscortImpact에서 실제 배우별 타격/반사/화상/가시/연타/회복/일벌 피격을 재생한다.

## 대상/준비/행동

실체 주어/목적어는 player 또는 정확한 조우 ID를 참조한다. 나는/나를은 레인에 무관하게 프롬이다.
개념 주어는 원안 배우의 성질만 바꾼다. 주어/수식 준비는 행동자, 지원 동사 준비는 목적어에게 준다.
같은 배우의 두 문장은 두 명시 행동이다. 문장에 들어간 적에게 기본 행동을 추가하지 않는다.
지정된 대상이 죽으면 대체하지 않는다. 보스 고유 행동은 지원 동사를 택해도 유지하며 공개된 목적어를 향한다.

일반 편성은 stageFor를 재사용하되 동시 행동 압력을 위해 atkMult를 encounter.length로 나눈다.
보스 수치는 나누지 않는다. 이 수치는 core 브릿지에만 있으며 View가 재정의하지 않는다.
거미줄은 공용 손패 봉인이며 최대 3, 필수 두 빈칸을 동시에 채울 선택지가 남도록 조정한다.
원본 슬롯 관용구는 이 모드에서 활성화하지 않으므로 부위 관통을 여는 약점+관용구 경로도 제공하지 않는다.
약점 타격/지원으로 봉인을 풀고 현재 부위를 깨는 원본 진행은 동작한다.

## 저장/보상 정규화

키는 `little-token.integrated.v2`. classic/prototype/v1 실험 키는 보존하며 자동 업그레이드하지 않는다.
정규형은 normalizeIntegratedRun의 JSON 데이터 형태다. optional undefined 프로퍼티는 부재와 동일하다.
실시간 해석의 입력 복제/카드 수정/아이템 처리도 이 경계를 사용한다. 회귀는 정규화한 전체 Resolution을 deepEqual한다.
체력/공격/이벤트만 고르고 나머지 차이를 무시하는 비교는 하지 않는다.

승리 → concept → item → forge → complete → 다음 층/최종 승리 단계가 저장된다.
제련의 열린 감탄사/등급 보너스 위치/행운 보정/선택/다음 칸은 체크포인트로 저장해 재개한다.
아이템 결과는 applyItemReward로 한 번만 적용한다. 완료 층과 보상 단계로 중복 지급을 거부한다.
최종 15층 아이템까지 적용한 뒤 엔딩/결과를 보여 준다. 현재/최대 체력은 자동 회복하지 않는다.

## 표시 계약과 제한

왼쪽 계획은 실제 선택만 읽고 hover draft를 읽지 않는다. 실행 중에는 실제 trace의 순서/배우/대상을 표시한다.
오른쪽만 hover의 미선택 결과를 표시한다. 네 역할 상세에는 전체 문구, 앞면은 이름/두 줄 활용/두 줄 효과의 고정 영역이다.
승인된 이미지 배치를 구현했으며 생성/구매/업로드 에셋은 없다.

원본 패시브 아이템 전부(슬롯 확장, 원본 compiler 문장 규칙 변경 포함)는 후보 생성 전에 보유 처리한 필터로 제외한다.
스탯 아이템만 원본 희귀도 생성기/감탄 UI로 획득한다. 이 제외는 화면에도 표시한다.
원본 영감 상점/슬롯 보상/6개 언어/엔드리스/슬롯 관용구/런 메타 진행을 통합 완료라고 표시하지 않는다.
검사 결과와 관리자 실측/남은 시각 검수는 FORK_QA.md 및 integration-steering-result.md에 분리해 기록한다.

---

## 초기 설계 보존 기록 (아래 v1/위력 약화 안은 현재 계약이 아님)

# v0.17 통합 설계

기본 진입은 원본 TitleView/CinematicIntro/설정/모바일 스케일러에서 시작하고 빈칸 전투로 연결한다. `?mode=classic`과 `?mode=prototype`은 비교 경로로 보존한다.

`SteeringRun.product`가 통합 런의 유일한 영속 상태다. 공용 개념 덱/강화/손패/문장은 기존 SteeringRun, 스탯/아이템은 원본 PlayerState, 적 상태는 원본 EnemyInst를 사용한다. Fighter의 HP/공격 표시는 EnemyInst에서 동기화한 투영이다. 미리보기와 실행은 동일한 resolveTurn을 호출하며 원본 sim/reference의 applyIntent, enemyTurn, 소환/거미줄 시작 처리를 재사용한다. 원본 슬롯 덱은 전투나 카드 보상에 사용하지 않는다.

전투 승리 → 개념 선택 → 원본 아이템 3택 → ItemExclaimView → applyItemReward → 다음 날 순서다. 보상 단계와 진열, 완료한 층을 저장해 동일 단계를 두 번 처리하지 않는다. 기존 슬롯 패시브 전체는 이 모드의 아이템 풀에서 명시적으로 제외한다. 영웅/전설 규칙 아이템은 그 효과를 구현하기 전에는 지급하지 않는다.

새 저장 키는 `little-token.integrated.v1`이며 classic/프로토타입 저장에는 쓰지 않는다. 프로토타입 자동 변환은 적/성장 규칙이 달라 진행 의미를 보존할 수 없으므로 하지 않는다. 이전 저장은 비교 경로에서 그대로 이어한다.

빈칸 문장은 보스의 다음 공격 위력을 조정하고 준비 효과를 부여한다. 보스 고유 행동은 행동 동사를 교체해도 사라지지 않는다. 소환 보호/그로기/부위 경계/방어 파괴는 원본 규칙을 따른다. 개념의 감정 대응과 거미줄의 공개된 위력 약화를 별도로 표시한다. 15층 보상 후 원본 엔딩을 재생하고 런을 종료한다(엔드리스는 classic 전용).
