// Common API configuration and utilities
// Prefer Vite env var; fallback to production backend
const RAW_API_BASE = (import.meta as any)?.env?.VITE_API_BASE_URL || 'http://localhost:8007/';
// Normalize base (remove trailing slash)
const NORMALIZED_BASE = typeof RAW_API_BASE === 'string' ? RAW_API_BASE.replace(/\/$/, '') : RAW_API_BASE;

export const API_BASE_URL = NORMALIZED_BASE as string;

// Stable stringify for request de-duplication (sorts object keys)
function stableStringify(value: any): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t !== 'object') return String(v);
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

// Types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface User {
  user_id?: string;
  username: string;
  account_code?: string;
  retail_code?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
  createdAt?: Date;
}

export interface Module {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  route?: string;
  display_order: number;
  is_active: number;
  parent_id?: number | null;
  created_at: string;
  updated_at: string;
}

// Common API utilities
export class ApiService {
  // In-flight request de-dupe (mainly to prevent duplicate /read calls in dev StrictMode)
  private static _inflightPost = new Map<string, Promise<any>>();
  private static _inflightGet = new Map<string, Promise<any>>();
  static async checkHallAvailability(params: { hall_id: string; eventdate: string; slot_id?: string; }): Promise<{ available: boolean; conflicts: any[]; source: string; }>{
    const q = new URLSearchParams();
    q.set('hall_id', params.hall_id);
    q.set('eventdate', params.eventdate);
    if (params.slot_id) q.set('slot_id', params.slot_id);
    const res = await this.get<{ available: boolean; conflicts: any[]; source: string; }>(`/hall-availability?${q.toString()}`);
    return res;
  }

  /**
   * Fetch strictly scoped billing payments (backend enforces account_code + retail_code + optional date range).
   */
  static async getBillingPayments(params: { accountCode: string; retailCode: string; fromDate?: string; toDate?: string; }): Promise<{ success: boolean; count: number; data: any[]; query_info?: any; }> {
    const qp = new URLSearchParams();
    qp.set('account_code', params.accountCode);
    qp.set('retail_code', params.retailCode);
    if (params.fromDate) qp.set('from_date', params.fromDate);
    if (params.toDate) qp.set('to_date', params.toDate);
    return this.get(`/billing-payments?${qp.toString()}`);
  }
  /**
   * Get authorization headers with token
   */
  static getAuthHeaders(options?: { json?: boolean }): Record<string, string> {
    const token = sessionStorage.getItem('access_token');
    const json = options?.json !== false;
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * Low-level fetch that attaches auth header and retries once after refresh
   */
  static async fetchWithAuth(input: RequestInfo, init: RequestInit = {}, retry = true): Promise<Response> {
    const isFormDataBody = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const authHeaders = this.getAuthHeaders({ json: !isFormDataBody });
    const headers = { ...authHeaders, ...(init.headers || {}) } as Record<string, string>;
    let response = await fetch(input, { ...init, headers });
    
    // If not 401, return the response immediately
    if (response.status !== 401) return response;

    // If retry not allowed, return the 401 response
    if (!retry) return response;

    try {
      // lazy import to avoid circular dependency at module init
      const { AuthService } = await import('./authService');

      // If another refresh is in progress, wait for it instead of firing another
      if ((AuthService as any)._refreshPromise) {
        try {
          await (AuthService as any)._refreshPromise;
          // After waiting for refresh, try request again with new token
          const newAuthHeaders = this.getAuthHeaders({ json: !isFormDataBody });
          const newHeaders = { ...newAuthHeaders, ...(init.headers || {}) } as Record<string, string>;
          response = await fetch(input, { ...init, headers: newHeaders });
          return response;
        } catch (e) {
          // If the in-flight refresh failed, return original 401
          console.error('In-flight refresh failed:', e);
          return response;
        }
      } else {
        // Perform a refresh and wait for it
        try {
          await AuthService.refreshToken();
          // After refresh success, retry the original request with new token
          const newAuthHeaders = this.getAuthHeaders({ json: !isFormDataBody });
          const newHeaders = { ...newAuthHeaders, ...(init.headers || {}) } as Record<string, string>;
          response = await fetch(input, { ...init, headers: newHeaders });
          return response;
        } catch (e) {
          // Refresh failed, return original 401
          console.error('Token refresh failed:', e);
          return response;
        }
      }
    } catch (err) {
      // If anything unexpected happened, return original response
      console.error('Unexpected error in fetchWithAuth:', err);
      return response;
    }
  }

  /**
   * Handle API response and errors
   */
  static async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      // Handle 401 errors specially
      if (response.status === 401) {
        const errorText = await response.text();
        
        // If this is a refresh token failure, redirect to login
        if (errorText.includes('refresh token') || errorText.includes('Invalid or expired')) {
          // Clear all tokens and redirect to login
          try {
            const { AuthService } = await import('./authService');
            AuthService.logout();
          } catch (e) {
            console.warn('Could not import AuthService for logout:', e);
          }
          
          // Redirect to login if not already there
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        
        throw new Error(`Authentication failed: ${errorText}`);
      }
      
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    return response.json();
  }

  /**
   * Generic GET request
   */
  static async get<T>(endpoint: string): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const existing = this._inflightGet.get(url);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      const response = await this.fetchWithAuth(url, { method: 'GET' });
      return this.handleResponse<T>(response);
    })();

    this._inflightGet.set(url, p);
    try {
      return await p;
    } finally {
      this._inflightGet.delete(url);
    }
  }

  /**
   * Generic POST request
   */
  static async post<T>(endpoint: string, data?: any): Promise<T> {
    // De-dupe identical /read requests made back-to-back (same payload)
    if (endpoint === '/read' && data) {
      const key = `${API_BASE_URL}${endpoint}|${stableStringify(data)}`;
      const existing = this._inflightPost.get(key);
      if (existing) return existing as Promise<T>;

      const p = (async () => {
        const response = await this.fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          ...(data && { body: JSON.stringify(data) }),
        });
        return this.handleResponse<T>(response);
      })();

      this._inflightPost.set(key, p);
      try {
        return await p;
      } finally {
        this._inflightPost.delete(key);
      }
    }

    const response = await this.fetchWithAuth(`${API_BASE_URL}${endpoint}`, { method: 'POST', ...(data && { body: JSON.stringify(data) }) });
    return this.handleResponse<T>(response);
  }

  /**
   * Generic PUT request
   */
  static async put<T>(endpoint: string, data?: any): Promise<T> {
  const response = await this.fetchWithAuth(`${API_BASE_URL}${endpoint}`, { method: 'PUT', ...(data && { body: JSON.stringify(data) }) });
  return this.handleResponse<T>(response);
  }

  /**
   * Generic DELETE request
   */
  static async delete<T>(endpoint: string): Promise<T> {
  const response = await this.fetchWithAuth(`${API_BASE_URL}${endpoint}`, { method: 'DELETE' });
  return this.handleResponse<T>(response);
  }

  /**
   * Search master customers by query string.
   * Tries primary API_BASE_URL first, then falls back to '/api' proxy and finally VITE_BACKEND_ORIGIN/port-swap.
   * Returns raw rows array (backend shape: { data: [...] }).
   */
  static async searchMasterCustomer(query: string, limit: number = 10, accountCode?: string, retailCode?: string, includeMembership: boolean = false): Promise<any[]> {
    const q = (query || '').trim();
    if (!q) return [];
    const headers: Record<string,string> = { ...this.getAuthHeaders() };
    const qp = new URLSearchParams();
    qp.set('q', q);
    qp.set('limit', String(limit));
    if (accountCode) qp.set('account_code', accountCode);
    if (retailCode) qp.set('retail_code', retailCode);
    if (includeMembership) qp.set('include_membership', 'true');
    const qs = `?${qp.toString()}`;
    // Build candidate endpoint URLs in order
    const candidates: string[] = [];
    // 1. Primary base (FastAPI direct)
    candidates.push(`${API_BASE_URL}/search-master-customer${qs}`);
    // 2. Frontend dev/proxy base '/api'
    try {
      const origin = window.location.origin.replace(/\/$/, '');
      candidates.push(`${origin}/api/search-master-customer${qs}`);
    } catch { /* ignore */ }
    // 3. Explicit backend origin env var or port heuristic 8080->8000
    try {
      const backendOrigin = ((import.meta as any)?.env?.VITE_BACKEND_ORIGIN || ((): string => {
        try { return window.location.origin.replace(':8080', ':8000'); } catch { return ''; }
      })()).replace(/\/$/, '');
      if (backendOrigin) candidates.push(`${backendOrigin}/search-master-customer${qs}`);
    } catch { /* ignore */ }

    const tried = new Set<string>();
    for (const url of candidates) {
      if (!url || tried.has(url)) continue;
      tried.add(url);
      try {
        const resp = await fetch(url, { headers });
        const ct = resp.headers.get('content-type') || '';
        if (!resp.ok) continue; // try next
        if (!/application\/json/i.test(ct)) continue; // likely HTML fallback; try next
        const json: any = await resp.json().catch(() => ({}));
        if (Array.isArray(json?.data)) return json.data;
        if (Array.isArray(json)) return json; // in case backend returns raw array
      } catch {
        // proceed to next candidate silently
      }
    }
    return [];
  }
}
