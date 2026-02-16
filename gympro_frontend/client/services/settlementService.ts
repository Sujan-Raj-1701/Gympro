import { ApiService } from './apiService';

export interface SettlementData {
  account_code: string;
  retail_code: string;
  settlement_date: string;
  opening_balance: number;
  total_income: number;
  total_expenses: number;
  net_amount: number;
  appointment_count: number;
  billing_count: number;
  settled_appointments: number;
  pending_appointments: number;
  cash_payments: number;
  card_payments: number;
  upi_payments: number;
  expected_cash: number;
  expected_card: number;
  expected_upi: number;
  expected_total: number;
  actual_cash: number;
  actual_card: number;
  actual_upi: number;
  actual_total: number;
  variance_cash: number;
  variance_card: number;
  variance_upi: number;
  variance_total: number;
  closed_by?: string;
  closed_at?: string;

  // Optional fields supported by backend schema
  withdrawal_amount?: number;
  next_day_opening_balance?: number;
  payments?: Array<{
    payment_mode_id: number;
    payment_mode_name?: string;
    expected_amount: number;
    actual_amount: number;
    variance_amount: number;
  }>;
}

export interface SettlementHistoryRow {
  date: string;
  settlement_ref_id?: number;
  opening_balance: number;
  total_income: number;
  total_expenses: number;
  net_amount: number;
  withdrawal_amount?: number;
  next_day_opening_balance?: number;
  appointment_count: number;
  billing_count: number;
  settled_appointments: number;
  pending_appointments: number;
  cash_payments?: number;
  card_payments?: number;
  upi_payments?: number;
  payments?: Array<{
    payment_mode_id: number;
    payment_mode_name?: string;
    expected_amount: number;
    actual_amount: number;
    variance_amount: number;
  }>;
}

export class SettlementService {
  static async getSettlementHistory(params: {
    accountCode: string;
    retailCode: string;
    fromDate: string;
    toDate: string;
  }): Promise<SettlementHistoryRow[]> {
    const qp = new URLSearchParams();
    qp.set('account_code', params.accountCode);
    qp.set('retail_code', params.retailCode);
    qp.set('from_date', params.fromDate);
    qp.set('to_date', params.toDate);

    const resp: any = await ApiService.get(`/settlement/history?${qp.toString()}`);
    if (resp?.success !== true) {
      throw new Error(resp?.detail || resp?.message || 'Failed to load settlement history');
    }
    return Array.isArray(resp?.data) ? (resp.data as SettlementHistoryRow[]) : [];
  }

  /**
   * Upsert settlement data
   */
  static async upsertSettlement(data: Partial<SettlementData> & { payments?: SettlementData['payments'] }): Promise<any> {
    try {
      const response = await ApiService.post('/settlement/upsert', data);
      return response;
    } catch (error) {
      console.error('Error upserting settlement:', error);
      throw error;
    }
  }
}

export default SettlementService;