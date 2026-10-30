export type ColorKey = 'yellow' | 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray';

export interface Base {
  id: string;
  updatedAt: number;
  deleted?: 0 | 1;
  dirty?: 0 | 1;
}

/** 큰 카테고리 (공부, 알바, 운동 …) */
export interface Category extends Base {
  name: string;
  color: ColorKey;
  order: number;
}

/** 할 일 묶음 (수학, 영어, 카페 …) */
export interface Bundle extends Base {
  categoryId: string;
  name: string;
  color: ColorKey;
  order: number;
  /** 수입 계산 (알바) */
  income: boolean;
  /** 시급 (원) */
  wage: number;
  /** 월급날: 매달 N일 */
  payday: number;
  /** 정산기간 시작일: 매달 N일 ~ 다음 달 N-1일 */
  settleStart: number;
}

export interface Todo extends Base {
  bundleId: string;
  title: string;
  done: boolean;
  order: number;
}

export interface Top3Item {
  text: string;
  done: boolean;
}

/** id = 날짜 (yyyy-mm-dd) */
export interface Top3 extends Base {
  items: Top3Item[];
}

export type BlockKind = 'plan' | 'done';

export interface Block extends Base {
  /** 하루(06:00 시작) 기준 날짜 */
  date: string;
  /** 06:00부터 10분 단위 칸 번호 (0 … 143) */
  start: number;
  /** 끝 칸 (포함하지 않음, 1 … 144) */
  end: number;
  kind: BlockKind;
  bundleId: string;
  todoId?: string;
  title: string;
  memo: string;
}

export interface Expense extends Base {
  date: string;
  name: string;
  amount: number;
  categoryId: string;
  methodId: string;
}

export interface ExpenseCategory extends Base {
  name: string;
  color: string;
  order: number;
}

export interface PaymentMethod extends Base {
  name: string;
  order: number;
}

export type ScreenKey = 'todo' | 'timetable' | 'ledger' | 'stats' | 'settings';

export interface Sections {
  top3: boolean;
  summary: boolean;
  stats: boolean;
  ledger: boolean;
  dailyReview: boolean;
  dday: boolean;
  goal: boolean;
}

/** id = 'me' */
export interface Settings extends Base {
  displayName: string;
  startScreen: ScreenKey;
  sections: Sections;
  aggregate: { categoryIds: string[]; bundleIds: string[] };
  /** 월 예산 (원), 0이면 표시 안 함 */
  budget: number;
}
