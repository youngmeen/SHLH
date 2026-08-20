# 집알림 DOMAIN

## 1. 목적

집알림에서 사용하는 핵심 개념과 각 개념의 관계를 정의한다.

이 문서는 데이터베이스 스키마나 API 구조를 정의하지 않는다.

구현 방식과 관계없이 프로젝트 전체에서 동일한 용어와 의미를 사용하기 위한 기준 문서다.

---

## 2. 핵심 구조

```text
UserProfile
├─ EligibilityProfile
├─ HousingPreference
└─ LivingBase

Notice
├─ SupplyCategory[]
│    ├─ Eligibility
│    └─ PastCompetition[]
├─ HousingUnit[]
└─ Application[]

HousingUnit
├─ HousingPreferenceResult
├─ CommuteResult
└─ PastCompetition[]

Application
└─ ApplicationResult
```

집알림의 주요 판단 흐름은 다음과 같다.

```text
Notice
↓
SupplyCategory
↓
Eligibility
↓
HousingUnit
↓
HousingPreference
↓
Commute
↓
PastCompetition
↓
Recommendation
↓
Application
↓
ApplicationResult
```

---

## 3. UserProfile

사용자 본인의 전체 설정을 의미한다.

다음 세 영역으로 분리한다.

```text
UserProfile
├─ EligibilityProfile
├─ HousingPreference
└─ LivingBase
```

지원 자격과 주택 선호, 생활 거점은 서로 다른 개념으로 관리한다.

---

## 4. EligibilityProfile

공공임대 공고에 **지원할 수 있는지 판단하기 위한 사용자 정보**다.

주택을 좋아하는지 여부와 관계없이 객관적인 지원 자격 판단에 사용한다.

저장 항목은 REQUIREMENTS R6에 정의한다. 여기서는 성격만 남긴다.

- 모든 항목이 항상 필요한 것은 아니다.
- 공고 판정에 필요한 값이 없으면 지원 불가로 판단하지 않고 `확인 필요`로 처리한다.
- 시간이 지나면 틀리는 값(나이·기간)은 저장하지 않고 생년월일·시작일에서 계산한다.

---

## 5. HousingPreference

사용자가 **실제로 살고 싶은 주택인지 판단하기 위한 선호조건**이다.

지원 자격과 분리한다. 사용할 수 있는 조건은 REQUIREMENTS R19에 정의한다.

초기 판단 결과는 다음과 같이 구분한다.

- 관심 높음
- 검토
- 관심 낮음

향후 점수 기반 추천으로 확장할 수 있다.

---

## 6. LivingBase

출퇴근 및 생활권 판단의 기준이 되는 위치다.

초기에는 현재 직장을 기준으로 사용한다.

예:

```text
LivingBase

이름: 현재 직장
위치: 회사 주소
이동수단: 대중교통
허용시간: 50분
```

회사가 이전하거나 이직하는 경우 LivingBase를 변경할 수 있어야 한다.

특정 회사나 특정 주소를 시스템의 고정값으로 사용하지 않는다.

---

## 7. Notice

LH, SH, 마이홈 등에서 게시한 하나의 모집공고를 의미한다.

예:

```text
2026년 2차 청년 매입임대주택 입주자 모집공고
```

Notice는 실제 주택 자체가 아니다.

하나의 Notice 안에 여러 HousingUnit이 포함될 수 있다.

정리하는 정보 항목은 REQUIREMENTS R4에 정의한다.

---

## 8. NoticeType

공고의 모집 유형이다. 유형에 따라 분석 방식이 달라진다.

**공급기관마다 분류 체계가 다르다.** 2026-08-20 확인한 실제 값이다.

LH(마이홈 API `suplyTyNm`)

```text
행복주택 · 국민임대 · 영구임대 · 통합공공임대 · 매입임대 · 전세임대 · 10년임대
```

SH(서울주거포털 청약유형)

```text
장기전세주택 · 장기안심주택 · 국민공공임대주택 · 매입임대주택 · 재개발임대주택
도시형생활주택 · 수요자맞춤형 · 청년안심주택 · 행복주택 · 희망하우징 · 두레주택
전세임대 · (상가임대 · 용지분양은 주택이 아니므로 대상 아님)
```

LH 단지 마스터(임대주택단지 API)에는 서울 장기전세 단지도 9행 있다. 즉 장기전세를 SH 전용으로 보면 안 된다.

**장기전세는 매입임대의 하위 유형이 아니라 별개 유형이다.** SH의 `미리내집`은 장기전세2 계열이며 담당부서도 `미리내집공급부`다. 다만 공고 제목에는 `신혼신생아매입임대주택Ⅱ`처럼 표기되어 출처별로 유형 표기가 어긋난다.

따라서 다음 규칙을 따른다.

- 출처가 준 유형 표기를 **그대로 보존**한다.
- 시스템이 정규화한 유형은 별도 값으로 두고, 어느 출처에서 왔는지 함께 남긴다(19절 정보 출처).
- 정규화 목록에 없는 유형을 임의로 가까운 유형에 합치지 않는다. 모르면 `기타`로 두고 원문 표기를 남긴다.

특히 전세임대는 HousingUnit이 존재하지 않을 수 있으므로 별도 유형으로 취급한다. 장기전세·장기안심주택도 전세 방식이라 임대조건 구조가 다르므로 확인이 필요하다.

---

## 9. HousingUnit

공고 안에서 사용자가 실제로 선택하거나 지원 대상으로 검토하는 **개별 공급주택 또는 공급형**을 의미한다.

예:

```text
A아파트 / 36㎡

B주택 / 29㎡

C아파트 / 44㎡
```

같은 아파트라도 공급형과 임대조건이 다르면 별도의 HousingUnit으로 볼 수 있다.

예:

```text
A아파트
├─ 26㎡
├─ 36㎡
└─ 44㎡
```

정보 항목은 REQUIREMENTS R16에 정의한다. 공식 자료에 없는 값은 생성하지 않는다.

---

## 10. Eligibility

사용자와 특정 Notice를 비교한 **지원 자격 판정 결과**다.

다음 세 상태를 기본으로 한다.

```text
ELIGIBLE
지원 가능

INELIGIBLE
지원 불가

REVIEW_REQUIRED
확인 필요
```

Eligibility의 판정 단위는 Notice가 아니라 **SupplyCategory(공급유형·순위)**다. 같은 공고 안에서도 청년 1순위와 2순위, 신혼 유형의 자격이 서로 다르기 때문이다. 공고에 공급유형 구분이 없거나 아직 분석하지 못한 경우에만 Notice 단위로 판정한다.

판정 기준일은 해당 공고의 공고일이다(REQUIREMENTS R12).

Eligibility는 단순 결과만 가지지 않고 판정 근거를 함께 가진다.

예:

```text
지원 가능

- 연령 조건 충족
- 무주택 조건 충족
- 소득 조건 충족
- 청약통장 조건 확인 필요
```

정보 부족은 원칙적으로 `REVIEW_REQUIRED`로 처리한다.

---

## 11. HousingPreferenceResult

사용자의 HousingPreference와 특정 HousingUnit을 비교한 결과다. Eligibility와 별개다 — `지원 가능`이면서 `관심 낮음`일 수 있다.

초기 상태

```text
HIGH    관심 높음
REVIEW  검토
LOW     관심 낮음
```

향후 점수 기반 결과를 함께 가질 수 있다.

---

## 12. CommuteResult

특정 HousingUnit에서 LivingBase까지의 출퇴근 가능성을 판단한 결과다.

초기 기준:

- 이동수단: 대중교통
- 기준: Door-to-Door
- 목표 시간: 편도 약 50분

예:

```text
HousingUnit
성남 A주택

LivingBase
현재 회사

예상 출퇴근
42분

결과
허용 범위
```

출퇴근 시간을 확인할 수 없으면 해당 HousingUnit을 제외하지 않는다.

---

## 13. 서울과 경기도의 관계

행정구역은 주택 선호와 생활 가능성을 판단하는 하나의 요소다.

### 서울

서울 지역 공고 및 주택은 기본 후보로 유지한다.

출퇴근 시간이 길다는 이유만으로 자동 제외하지 않는다.

### 경기도

경기도는 LivingBase까지의 실제 출퇴근 가능성을 중요하게 판단한다.

Door-to-Door 기준 약 50분 이내라면 적극적인 관심 후보가 될 수 있다.

따라서 서울 주택이 경기도 주택보다 출퇴근 측면에서 불리한 상황이 정상적으로 발생한다. 판단 기준은 REQUIREMENTS R11에 있다.

---

## 14. PastCompetition

과거 동일하거나 유사한 모집의 경쟁률 정보다.

현재 공고의 당첨 가능성을 확정하는 값이 아니라 지원 판단을 돕는 참고정보다.

비교 대상을 어떤 수준에서 찾았는지(동일 주택·동일 공급형까지 일치했는지, 유형만 같은지)를 **비교 수준**으로 함께 가진다. 비교 우선순위와 정보 항목은 REQUIREMENTS R24에 정의한다.

공식 경쟁률과 시스템이 계산한 참고값은 구분한다. 경쟁률은 SupplyCategory(순위) 단위로 발표되므로 순위를 함께 가진다.

---

## 15. Recommendation

사용자가 최종적으로 어떤 공고와 주택을 우선 확인할지 정리한 결과다.

Recommendation은 하나의 조건으로 결정하지 않는다.

다음 정보를 종합한다.

```text
Eligibility
+
HousingPreferenceResult
+
CommuteResult
+
임대조건
+
PastCompetition
```

기본 흐름:

```text
지원 가능한가
↓
내가 살고 싶은가
↓
출퇴근 가능한가
↓
임대조건은 괜찮은가
↓
과거 경쟁률은 어떠한가
↓
우선 확인 대상 결정
```

### 등급

Recommendation의 등급은 HousingPreferenceResult와 다른 개념이다. 선호는 `내가 살고 싶은가`에 대한 답이고, Recommendation은 `무엇부터 확인할 것인가`에 대한 답이다.

```text
HousingPreferenceResult   HIGH / REVIEW / LOW
                          관심 높음 / 검토 / 관심 낮음

Recommendation            TOP / RECOMMENDED / REVIEW / LOW
                          최우선 확인 / 추천 / 검토 / 관심 낮음
```

지원 불가로 판정된 주택은 Recommendation 등급을 부여하지 않는다.

경쟁률이 낮다는 이유만으로 선호하지 않는 주택을 최우선 추천하지 않는다.

---

## 16. Application

사용자가 실제로 특정 공고 또는 공급주택에 지원한 기록이다.

알림을 받은 것과 실제 지원한 것은 다른 상태다.

예:

```text
Notice
SH 청년매입임대

HousingUnit
송파 A주택 / 36㎡

지원일
2026-09-01
```

기록 항목은 REQUIREMENTS R35에 정의한다.

---

## 17. ApplicationResult

Application에 대한 최종 결과다.

기본 상태:

- 지원 예정
- 지원 완료
- 결과 확인 중
- 당첨
- 예비
- 탈락
- 부적격
- 취소

결과와 함께 기록하는 상세 항목은 REQUIREMENTS R37에 정의한다.

---

## 18. 전세임대 예외

전세임대는 일반적인 Notice와 구조가 다르다.

```text
Notice
└─ 전세임대
```

공고 시점에 실제 HousingUnit이 존재하지 않을 수 있다.

따라서 주택 목록이 아니라 지원한도·본인부담·물색 가능 지역·계약 조건을 중심으로 관리한다(REQUIREMENTS R29).

실제 공급주택이 존재하지 않으면 HousingUnit을 임의 생성하지 않는다.

---

## 19. 정보 출처

집알림에서 사용하는 정보는 출처와 성격을 구분한다.

### Official

공식 공고 또는 공식 데이터에서 직접 확인한 정보

### Calculated

공식 데이터를 이용해 시스템이 계산한 정보

예:

- D-day
- 출퇴근 시간
- 경쟁률 참고 계산

### Inferred

여러 정보를 바탕으로 시스템이 판단한 정보

예:

- 관심 높음
- 우선 확인 추천

### Unknown

확인하지 못한 정보

조회 실패와 공식 정보가 존재하지 않는 상태도 가능하면 구분한다.

---

## 20. 도메인 원칙

- Notice와 HousingUnit을 구분한다.
- 지원 자격과 주택 선호를 구분한다.
- 주택 선호와 출퇴근 가능성을 구분한다.
- 서울·경기와 같은 행정구역만으로 주택의 가치를 판단하지 않는다.
- 현재 직장 위치를 고정하지 않고 LivingBase로 관리한다.
- 알림과 실제 지원 기록을 구분한다.
- 과거 경쟁률과 현재 당첨 가능성을 동일하게 취급하지 않는다.
- 전세임대에 존재하지 않는 HousingUnit을 생성하지 않는다.
- 공식 정보, 계산 정보, 추론 정보를 구분한다.
- 정보가 부족하면 임의로 확정하지 않는다.
- 지원 자격은 공고 단위가 아니라 공급유형·순위 단위로 판단한다.
- 공고 제목에서 읽은 대상 계층은 참고 신호이며 자격 판정 결과가 아니다.
- 시간이 지나면 틀리는 값(나이·기간)은 저장하지 않고 기준일 기준으로 계산한다.

---

## 21. SupplyCategory

하나의 Notice 안에서 **자격 조건과 경쟁률이 함께 움직이는 단위**다. 공급유형과 순위를 함께 가리킨다.

예:

```text
SH 청년 매입임대 모집공고
├─ 청년 1순위 (수급자·차상위 등)
├─ 청년 2순위 (본인·부모 소득 기준)
└─ 청년 3순위 (본인 소득 기준)
```

같은 공고, 같은 주택이라도 순위에 따라 소득·자산 기준이 다르고 경쟁률도 순위별로 발표된다. 따라서 다음 두 가지를 SupplyCategory에 붙인다.

- Eligibility (지원 자격 판정)
- PastCompetition (과거 경쟁률)

### 주요 정보

- 공급유형 이름
- 순위
- 대상 계층 (AudienceType)
- 모집 세대수
- 자격 조건 원문
- 소득·자산 기준

공고에 순위 구분이 없으면 SupplyCategory는 1개다. 공고를 아직 분석하지 못한 경우 SupplyCategory 없이 Notice 단위로 다룬다.

HousingUnit과는 다른 축이다. HousingUnit은 `어떤 주택인가`이고 SupplyCategory는 `어떤 자격으로 신청하는가`다. 하나의 주택에 여러 공급유형이 배정될 수 있다.

---

## 22. AudienceType

공고가 대상으로 하는 계층이다.

예:

- 청년
- 신혼부부
- 신생아
- 다자녀
- 한부모
- 고령자
- 일반

AudienceType은 공고 제목이나 본문에서 읽을 수 있는 **1차 신호**이며 Eligibility와 다르다.

```text
AudienceType     이 공고가 누구를 대상으로 하는가
Eligibility      내가 그 조건을 충족하는가
```

제목에서 읽은 AudienceType만으로 `지원 불가`를 확정하지 않는다(REQUIREMENTS R14). 대상 계층이 명확히 어긋나는 경우에도 판정은 `확인 필요` 이상으로 유지하고, 근거를 함께 표시한다.

현재 코드(`app/lib/audience-match.ts`)의 제목 기반 판정이 이 개념에 해당한다. Phase 3에서 Eligibility로 대체하는 것이 아니라, AudienceType 추출로 정리하고 Eligibility를 그 위에 새로 만든다.
