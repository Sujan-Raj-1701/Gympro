import { ApiService } from './apiService';

export interface CalendarEntry {
  date: string;            // YYYY-MM-DD
  booking_id: string;      // display id or numeric as string
  slot_id: string;         // master_slot id as string
  customer_id?: string;
  hall_id?: string;
  status?: string;         // PENDING/CONFIRMED/CANCELLED/etc
  customer_name?: string;
  customer_phone?: string;
}

export class CalendarService {
  static async getMonth(params: {
    account_code: string;
    retail_code: string;
    year: number;
    month: number; // 1-12
    hall_id?: string;
  }): Promise<{ success: boolean; count?: number; data: CalendarEntry[] }>
  {
    const q = new URLSearchParams({
      account_code: params.account_code,
      retail_code: params.retail_code,
      year: String(params.year),
      month: String(params.month),
      ...(params.hall_id ? { hall_id: params.hall_id } : {}),
    }).toString();
    return ApiService.get(`/calendar-month?${q}`);
  }
}
