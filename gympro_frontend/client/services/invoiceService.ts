import { ApiService } from './apiService';

export interface InvoiceLineInput {
  service_id?: string;
  service_name: string;
  qty: number;
  base_price?: number;
  unit_price: number;
  discount_amount?: number; // overall invoice discount captured on first line only
  tax_rate_percent?: number;
  tax_id?: string;
  employee_id?: string;
  employee_name?: string;
  employee_level?: string;
  employee_percent?: number;
  markup_percent_ap?: number;
  markup_amount_per?: number;
}

export interface CreateInvoicePayload {
  account_code: string;
  retail_code: string;
  tax_rate_percent?: number;
  discount_amount?: number;
  tax_id?: string;
  employee_id?: string;
  invoice_id?: string; // optional client-supplied
  lines: InvoiceLineInput[];
  // New arrays for packages and inventory items
  customer_lines?: Array<{
    account_code: string;
    retail_code: string;
    invoice_id: string;
    row_index?: number;
    customer_id?: number | string;
    customer_name?: string;
    customer_number?: string;
    customer_gender?: string;
    membership_id?: string;
    birthday_date?: string;
    anniversary_date?: string;
    membership_cardno?: string;
    address?: string;
    visit_count?: string | number;
    credit_pending?: string | number;
    created_by?: string;
    updated_by?: string;
  }>;
  package_lines?: Array<{
    account_code: string;
    retail_code: string;
    invoice_id: string;
    package_id: string;
    package_name: string;
    qty: number;
    unit_price: number;
    tax_id?: string;
    tax_rate_percent?: number;
    total_cgst?: number;
    total_sgst?: number;
    total_igst?: number;
    total_vat?: number;
    tax_amount?: number;
    discount_amount?: number;
    grand_total?: number;
    created_by?: string;
    updated_by?: string;
  }>;
  inventory_lines?: Array<{
    account_code: string;
    retail_code: string;
    invoice_id: string;
    product_id: string;
    product_name: string;
    barcode?: string | null;
    brand?: string | null;
    qty: number;
    unit_price: number;
    tax_id?: string;
    tax_rate_percent?: number;
    total_cgst?: number;
    total_sgst?: number;
    total_igst?: number;
    total_vat?: number;
    tax_amount?: number;
    discount_amount?: number;
    grand_total?: number;
    created_by?: string;
    updated_by?: string;
  }>;
}

export class InvoiceService {
  static async create(payload: CreateInvoicePayload) {
    return ApiService.post('/billing-transition', payload);
  }
  static async get(invoice_id: string, account_code: string, retail_code: string) {
    const q = new URLSearchParams({ account_code, retail_code }).toString();
    return ApiService.get(`/billing-transition/${invoice_id}?${q}`);
  }
  static async list(
    account_code: string,
    retail_code: string,
    options?: { limit?: number; invoice_id?: string; fromDate?: string; toDate?: string }
  ) {
    const q = new URLSearchParams({ account_code, retail_code });
    if (options?.limit !== undefined) q.set('limit', String(options.limit));
    if (options?.invoice_id) q.set('invoice_id', options.invoice_id);
    if (options?.fromDate) q.set('from_date', options.fromDate);
    if (options?.toDate) q.set('to_date', options.toDate);
    return ApiService.get(`/billing-transitions?${q.toString()}`);
  }
  static async getBillingPayments(
    account_code: string,
    retail_code: string,
    options?: { fromDate?: string; toDate?: string }
  ) {
    const q = new URLSearchParams({ account_code, retail_code });
    if (options?.fromDate) q.set('from_date', options.fromDate);
    if (options?.toDate) q.set('to_date', options.toDate);
    return ApiService.get(`/billing-payments?${q.toString()}`);
  }
  static async update(invoice_id: string, payload: CreateInvoicePayload) {
    return ApiService.put(`/billing-transition/${invoice_id}/update`, payload);
  }
  static async cancel(invoice_id: string, account_code: string, retail_code: string) {
    const q = new URLSearchParams({ account_code, retail_code }).toString();
    return ApiService.put(`/billing-transition/${encodeURIComponent(invoice_id)}/cancel?${q}`);
  }

  static async uncancel(invoice_id: string, account_code: string, retail_code: string) {
    const q = new URLSearchParams({ account_code, retail_code }).toString();
    return ApiService.put(`/billing-transition/${encodeURIComponent(invoice_id)}/uncancel?${q}`);
  }
}
