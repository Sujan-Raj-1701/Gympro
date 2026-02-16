import { ApiService, ApiResponse } from './apiService';

export interface AppointmentRow {
  id?: number|string;
  appointment_id?: string;
  account_code?: string;
  retail_code?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  customer_gender?: string;
  customer_address?: string;
  appointment_date?: string; // yyyy-mm-dd
  slot_from?: string; // HH:MM:SS
  slot_to?: string;   // HH:MM:SS
  staff_id?: string;
  staff_name?: string;
  special_requirements?: string; // raw blob converted backend side
  status?: string; // pending | confirmed | cancelled | settled etc.
  services?: any;  // JSON
  addons?: any;    // JSON
  services_total?: number;
  discount?: number;
  tax_rate?: number;
  tax_amount?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  total_amount?: number;
  payment_mode?: string;
  advance_paid?: number;
  balance_due?: number;
  created_at?: string;
  updated_at?: string;
}

export class AppointmentService {
  /**
   * Fetch appointments from master_appointment table. Optionally filter by date range.
   * If both from and to provided they are inclusive (server side must handle filtering or return all which we filter client side).
   */
  static async fetch(accountCode: string, retailCode: string, opts?: { from?: string; to?: string }): Promise<AppointmentRow[]> {
    const res = await ApiService.post<ApiResponse<any>>('/read', {
      tables: ['master_appointment'],
      account_code: accountCode,
      retail_code: retailCode,
    });
    let rows: AppointmentRow[] = [];
    const data = (res as any)?.data;
    if (Array.isArray(data)) {
      // Could be flat array containing rows OR array of table blocks; detect objects with appointment_date
      if (data.length && data.every(r => typeof r === 'object' && ('appointment_date' in r || 'appointment_id' in r))) {
        rows = data as any;
      }
    } else if (data && data.master_appointment) {
      rows = data.master_appointment as any;
    }
    if (!rows) rows = [];

    // Client-side range filter if provided
    if (opts?.from || opts?.to) {
      const fromTs = opts.from ? new Date(opts.from).getTime() : undefined;
      const toTs = opts.to ? new Date(opts.to).getTime() : undefined;
      rows = rows.filter(r => {
        if (!r.appointment_date) return false;
        const t = new Date(r.appointment_date).getTime();
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
        return true;
      });
    }
    return rows;
  }

  /**
   * Update an appointment row. Accepts partial fields; requires identifying key (id or appointment_id) plus account/retail codes.
   * Backend generic update expects: { table: 'master_appointment', data: { ...fields }, where: { id or appointment_id, account_code, retail_code } }
   */
  static async update(accountCode: string, retailCode: string, ident: { id?: number|string; appointment_id?: string }, patch: Partial<AppointmentRow>): Promise<any> {
    // Backend /update expects: { table, data: { pk, account_code, retail_code, ...fields } } with PUT method.
    const data: any = { ...patch, account_code: accountCode, retail_code: retailCode };
    if (ident.id != null) data.id = ident.id; // primary key
    else if (ident.appointment_id) data.appointment_id = ident.appointment_id; // attempt if pk is appointment_id (fallback)
    else throw new Error('Missing identifier for update');
    return ApiService.put<ApiResponse<any>>('/update', { table: 'master_appointment', data });
  }
}

export default AppointmentService;
