import { ApiService } from './apiService';

export interface CustomerRow {
  id?: string | number;
  customer_id?: string | number;
  customer_name?: string;
  name?: string;
  mobile?: string;
  phone?: string;
  phone1?: string;
  customer_mobile?: string;
  alternate_phone?: string;
  phone2?: string;
  alternate_mobile?: string;
  gst_number?: string;
  gst?: string;
  gstin?: string;
  status?: string | number | boolean;
  customer_status?: string;
  [key: string]: any;
}

export class CustomerService {
  /**
   * Fetch customers via authenticated `/read` endpoint and return a normalized array of rows.
   * Accepts variations in backend payload shape (keyed object or flat array).
   */
  static async getCustomers(accountCode: string, retailCode: string): Promise<CustomerRow[]> {
    const resp: any = await ApiService.post('/read', {
      tables: ['master_customer'],
      account_code: accountCode,
      retail_code: retailCode,
    });

    const data = resp?.data;
    if (Array.isArray(data)) return data as CustomerRow[];
    if (data && typeof data === 'object') {
      // Common aliases
      const candidates = [
        'master_customer',
        'customers',
        'customer',
        'customer_master',
      ];
      for (const key of candidates) {
        const rows = (data as any)[key];
        if (Array.isArray(rows)) return rows as CustomerRow[];
      }
    }
    return [];
  }
}

export default CustomerService;
