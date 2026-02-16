import { ApiService, ApiResponse, Module, User } from './apiService';

// User Management Service
export class UserService {
  /**
   * Create a new user
   */
  static async createUser(userData: {
    username: string;
    hashed_password: string;
    email?: string;
    phone_number?: string;
    account_code?: string;
    retail_code: string;
    role?: string;
    permissions?: string;
    is_active?: boolean;
  status?: boolean;
    created_at?: string;
  }): Promise<ApiResponse<any>> {
    // Convert legacy permissions (JSON string or object) into screens array expected by /users
    let screens: Array<{ screen_id: number; can_view?: number; can_edit?: number }> | undefined = undefined;
    try {
      const permsRaw: any = (userData as any).permissions;
      const perms = typeof permsRaw === 'string' && permsRaw ? JSON.parse(permsRaw) : (permsRaw || {});
      const s: Array<{ screen_id: number; can_view?: number; can_edit?: number }> = [];
      for (const k of Object.keys(perms || {})) {
        const entry = perms[k];
        const id = Number(k);
        if (Number.isNaN(id)) continue;
        s.push({ screen_id: id, can_view: entry?.view ? 1 : 0, can_edit: entry?.edit ? 1 : 0 });
      }
      if (s.length) screens = s;
    } catch (e) {
      // ignore parse errors and fall back to sending no screens
    }

    const payload: any = {
      username: userData.username,
      password: userData.hashed_password, // backend expects plain 'password' and will hash it server-side
      account_code: userData.account_code,
      retail_code: userData.retail_code,
    };
    if (userData.email) payload.email = userData.email;
    if ((userData as any).full_name) payload.full_name = (userData as any).full_name;
    if (screens) payload.screens = screens;
    // keep some optional fields if provided (backend may ignore unknown fields)
    // Map frontend 'role' to 'role_id' when possible (number or object with id). Otherwise keep 'role'.
    if ((userData as any).role !== undefined && (userData as any).role !== null) {
      const rv = (userData as any).role;
      if (typeof rv === 'object') {
        // object may be { id: 3, name: 'Admin' }
        const id = rv.id ?? rv.role_id ?? rv.value;
        if (typeof id !== 'undefined' && id !== null) payload.role_id = Number(id);
        else payload.role = rv;
      } else if (typeof rv === 'string') {
        const n = Number(rv);
        if (!Number.isNaN(n)) payload.role_id = n;
        else payload.role = rv;
      } else if (typeof rv === 'number') {
        payload.role_id = rv;
      } else {
        payload.role = rv;
      }
    }
    if ((userData as any).phone_number) payload.phone_number = (userData as any).phone_number;
  if (typeof (userData as any).is_active !== 'undefined') payload.is_active = (userData as any).is_active;
  if (typeof (userData as any).status !== 'undefined') payload.status = (userData as any).status;
    if ((userData as any).created_at) payload.created_at = (userData as any).created_at;

    return ApiService.post<ApiResponse<any>>('/users', payload);
  }

  /**
   * Update an existing user
   */
  static async updateUser(userData: any): Promise<ApiResponse<any>> {
    // Send the same shape as createUser to the /users endpoint. Backend will detect update vs create.
    const payload: any = { ...userData };
    // If permissions present as JSON string, convert to screens array
    if (payload.permissions) {
      try {
        const perms = typeof payload.permissions === 'string' ? JSON.parse(payload.permissions) : payload.permissions;
        const s: Array<{ screen_id: number; can_view?: number; can_edit?: number }> = [];
        for (const k of Object.keys(perms || {})) {
          const entry = perms[k];
          const id = Number(k);
          if (Number.isNaN(id)) continue;
          s.push({ screen_id: id, can_view: entry?.view ? 1 : 0, can_edit: entry?.edit ? 1 : 0 });
        }
        payload.screens = s;
      } catch (e) {
        // ignore
      }
    }
    // Map frontend 'role' to 'role_id' when possible (number or object with id). Otherwise keep 'role'.
    if (payload.role !== undefined && payload.role !== null) {
      const rv = payload.role;
      if (typeof rv === 'object') {
        const id = rv.id ?? rv.role_id ?? rv.value;
        if (typeof id !== 'undefined' && id !== null) payload.role_id = Number(id);
        else payload.role = rv;
      } else if (typeof rv === 'string') {
        const n = Number(rv);
        if (!Number.isNaN(n)) payload.role_id = n;
        else payload.role = rv;
      } else if (typeof rv === 'number') {
        payload.role_id = rv;
      } else {
        payload.role = rv;
      }
    }

    // Ensure status/is_active propagate if provided and normalize 0/1, '0'/'1', 'true'/'false'
    const toBool = (v: any): boolean | undefined => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).toLowerCase();
      if (s === '1' || s === 'true' || s === 'active') return true;
      if (s === '0' || s === 'false' || s === 'inactive') return false;
      return !!v;
    };
    if (typeof payload.status !== 'undefined') payload.status = toBool(payload.status);
    if (typeof payload.is_active !== 'undefined') payload.is_active = toBool(payload.is_active);
    if (!payload.updated_at) payload.updated_at = new Date().toISOString();
    return ApiService.put<ApiResponse<any>>('/users', payload);
  }

  /**
   * Get all users for a specific account/retail code
   */
  static async getUsers(accountCode: string, retailCode: string): Promise<ApiResponse<User[]>> {
    return ApiService.post<ApiResponse<User[]>>('/read', {
      tables: ['users'],
      account_code: accountCode,
      retail_code: retailCode,
    });
  }

  /**
   * Check if username is available
   */
  static async checkUsernameAvailability(username: string, accountCode: string, retailCode: string): Promise<ApiResponse<{ available: boolean; message?: string }>> {
    return ApiService.post<ApiResponse<{ available: boolean; message?: string }>>('/check-username', {
      username,
      account_code: accountCode,
      retail_code: retailCode,
    });
  }

  /**
   * Delete a user
   */
  static async deleteUser(userId: string): Promise<ApiResponse<any>> {
    // Implementation depends on your backend endpoint for deletion
    return ApiService.delete<ApiResponse<any>>(`/users/${userId}`);
  }
}

// Backward-compatible default export alias (some pages import default)
export default UserService;

// Module/Screen Permissions Service
export class ModuleService {
  /**
   * Get all modules/screens (authenticated endpoint)
   */
  static async getModules(accountCode: string, retailCode: string): Promise<ApiResponse<Module[]>> {
    return DataService.readData(['modules'], accountCode, retailCode) as Promise<ApiResponse<Module[]>>;
  }

  /**
   * Get modules and roles together using authenticated endpoint
   * Returns an object with arrays: { modules: Module[], roles: Array<{ id?: string|number; name: string }> }
   */
  static async getModulesAndRoles(accountCode: string, retailCode: string): Promise<ApiResponse<{ modules: Module[]; roles: Array<{ id?: string|number; name: string }> }>> {
    const res = await DataService.readData(['modules', 'roles'], accountCode, retailCode);
    // Normalize possible shapes: either keyed by table name or flat arrays
    let modules: Module[] = [];
    let roles: Array<{ id?: string|number; name: string }> = [];

    const d = (res as any)?.data;
    if (d) {
      if (Array.isArray(d)) {
        // If backend returns a combined array, try to distinguish by presence of module fields
        modules = d.filter((x: any) => typeof x?.display_order !== 'undefined').map((x: any) => x as Module);
        roles = d.filter((x: any) => typeof x?.display_order === 'undefined').map((r: any) => ({ id: r.id || r.role_id || r.code, name: r.name || r.role || r.role_name || r.title }));
      } else {
        // Prefer keyed object by table names
        if (d.modules) modules = d.modules as Module[];
        if (d.roles) roles = (d.roles as any[]).map((r: any) => ({ id: r.id || r.role_id || r.code, name: r.name || r.role || r.role_name || r.title }));
      }
    }

    return { success: (res as any).success, message: (res as any).message, data: { modules, roles } } as ApiResponse<{ modules: Module[]; roles: Array<{ id?: string|number; name: string }> }>;
  }

}

const coerceNumberOrZero = (v: any): number => {
  if (v === '' || v === null || typeof v === 'undefined') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

const normalizeDataByTable = (table: string, data: any): any => {
  if (!data || typeof data !== 'object') return data;
  if (table === 'master_employee' && Object.prototype.hasOwnProperty.call(data, 'price_markup_percent')) {
    return {
      ...data,
      price_markup_percent: coerceNumberOrZero((data as any).price_markup_percent),
    };
  }
  return data;
};

// General Data Service
export class DataService {
  /**
   * Read data from tables with credentials
   */
  static async readData(tables: string[], accountCode: string, retailCode: string): Promise<ApiResponse<any[]>> {
    return ApiService.post<ApiResponse<any[]>>('/read', {
      tables,
      account_code: accountCode,
      retail_code: retailCode,
    });
  }

  /**
   * Read booking-scoped data from tables using account/retail and booking_id
   */
  static async readByBooking(
    tables: string[],
    accountCode: string,
    retailCode: string,
    bookingId: string | number,
  ): Promise<ApiResponse<any[]>> {
    return ApiService.post<ApiResponse<any[]>>('/read-by-booking', {
      tables,
      account_code: accountCode,
      retail_code: retailCode,
      booking_id: bookingId,
    });
  }

  // readPublicData method removed - use readData with proper authentication instead

  /**
   * Get bookings and related payments within a date range
   */
  static async bookingsRange(
    accountCode: string,
    retailCode: string,
    startDateYMD: string,
    endDateYMD: string,
  ): Promise<ApiResponse<any>> {
    // Deprecated: backend /bookings-range endpoint removed.
    // Return a consistent empty payload instead of calling the network.
    return Promise.resolve({ success: true, data: [], count: 0 } as any);
  }

  /**
   * Create data in any table
   */
  static async createData(table: string, data: any, autoGenerate?: any, accountCode?: string, retailCode?: string): Promise<ApiResponse<any>> {
    const normalizedData = normalizeDataByTable(table, data);
    return ApiService.post<ApiResponse<any>>('/create', {
      table,
      data: normalizedData,
      ...(autoGenerate && { auto_generate: autoGenerate }),
      ...(accountCode && { account_code: accountCode }),
      ...(retailCode && { retail_code: retailCode }),
    });
  }

  /**
   * Update data in any table
   */
  static async updateData(table: string, data: any): Promise<ApiResponse<any>> {
    const normalizedData = normalizeDataByTable(table, data);
    return ApiService.put<ApiResponse<any>>('/update', {
      table,
      data: normalizedData,
    });
  }

  /**
   * Create income/expense rows (trans_income_expense) from a composite payload
   * Payload shape:
   * {
   *   account_code: string,
   *   retail_code: string,
   *   entry_date: string (yyyy-mm-dd),
   *   type: 'inflow'|'outflow',
   *   payment_method: string,
   *   items: Array<{ description: string; qty: number; price: number; amount: number; remarks?: string }>,
   *   created_by?: string
   * }
   */
  static async createIncomeExpense(payload: any): Promise<ApiResponse<any>> {
    return ApiService.post<ApiResponse<any>>('/trans-income-expense', payload);
  }

  /**
   * Get income/expense rows in a date range.
   */
  static async getIncomeExpenses(fromdate: string, todate: string, accountCode?: string, retailCode?: string): Promise<ApiResponse<any>> {
    const params = new URLSearchParams();
    if (fromdate) params.set('fromdate', fromdate);
    if (todate) params.set('todate', todate);
    if (accountCode) params.set('account_code', accountCode);
    if (retailCode) params.set('retail_code', retailCode);
    return ApiService.get<ApiResponse<any>>(`/trans-income-expenses?${params.toString()}`);
  }
}
