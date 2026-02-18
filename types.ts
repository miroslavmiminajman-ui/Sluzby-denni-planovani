
export interface ExcelRow {
  [key: string]: any;
}

export interface CalculationResult {
  branchName: string;
  revenueRR: number;
  planAsrServicesRevenue: number;
  serviceAsistRevenue: number;
  daysRemaining: number;
  weekdaysRemaining: number;
  weekendsRemaining: number;
  isTodayWeekend: boolean;
  finalValue: number;
  rawRow: any;
}
