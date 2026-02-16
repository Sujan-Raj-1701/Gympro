import { API_BASE_URL, ApiService, User } from './apiService';

// Authentication Service
export class AuthService {
  // Promise for an in-flight refresh request to avoid parallel refreshes
  private static _refreshPromise: Promise<any> | null = null;
  /**
   * Login user and get access token
   */
  static async login(username: string, password: string): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        username,
        password,
      }),
    });

    if (!response.ok) {
      throw new Error("Invalid username or password");
    }

    const data = await response.json();
    
    // Store tokens in sessionStorage
    sessionStorage.setItem("access_token", data.access_token);
    sessionStorage.setItem("token_type", data.token_type);
    if (data.refresh_token) {
      sessionStorage.setItem("refresh_token", data.refresh_token);
      // Also store refresh token in localStorage as fallback
      try { 
        localStorage.setItem('refresh_token', data.refresh_token); 
      } catch (e) { 
        console.warn('Could not store refresh token in localStorage:', e);
      }
    }
    
    return data;
  }

  /**
   * Get current user details
   */
  static async getCurrentUser(): Promise<User> {
    const resp: any = await ApiService.get<any>('/users/me/');
    try {
      // Persist hierarchical modules for navigation and permissions
      if (resp && resp.modules) {
        sessionStorage.setItem('user_modules', JSON.stringify(resp.modules));
      } else {
        sessionStorage.removeItem('user_modules');
      }
      // Persist retail_master details for the session if provided by backend
      if (resp && typeof resp === 'object' && 'retail_master' in resp) {
        if (resp.retail_master) {
          sessionStorage.setItem('retail_master', JSON.stringify(resp.retail_master));
        } else {
          sessionStorage.removeItem('retail_master');
        }
      }
    } catch (e) {
      console.warn('Could not persist user modules to sessionStorage:', e);
    }
    return resp as User;
  }

  /**
   * Refresh access token
   */
  static async refreshToken(refreshToken?: string): Promise<{
    access_token: string;
    token_type?: string;
    refresh_token?: string;
  }> {
    // If a refresh is already in progress, return the same promise so callers can wait
    if (this._refreshPromise) return this._refreshPromise;

    const tokenToUse = refreshToken || sessionStorage.getItem('refresh_token');
  // fallback to localStorage if sessionStorage was cleared (e.g., tab closed)
  const fallback = !tokenToUse ? localStorage.getItem('refresh_token') : null;
  const token = tokenToUse || fallback;
  if (!token) throw new Error('No refresh token available');

    this._refreshPromise = (async () => {
      const response = await fetch(`${API_BASE_URL}/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: token }),
      });

      if (!response.ok) {
        // clear tokens on failure
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('token_type');
        sessionStorage.removeItem('refresh_token');
        // ensure we reset the promise before throwing so next attempts can try again
        this._refreshPromise = null;
        throw new Error("Invalid refresh token");
      }

      const data = await response.json();
      // Update stored tokens
      if (data.access_token) sessionStorage.setItem("access_token", data.access_token);
      if (data.token_type) sessionStorage.setItem("token_type", data.token_type);
      if (data.refresh_token) {
        sessionStorage.setItem("refresh_token", data.refresh_token);
        // Persist a copy in localStorage as a fallback so refresh can run after tab reloads
        try { localStorage.setItem('refresh_token', data.refresh_token); } catch (e) { /* ignore */ }
      } else {
        // if backend didn't return a new refresh token, ensure any previous persisted one remains
        try { const existing = localStorage.getItem('refresh_token'); if (existing) sessionStorage.setItem('refresh_token', existing); } catch(e) { /* ignore */ }
      }

      // clear the stored promise and return data
      this._refreshPromise = null;
      return data;
    })();

    return this._refreshPromise;
  }

  /**
   * Logout user and clear tokens
   */
  static async logout(): Promise<void> {
    // Best-effort notify backend for audit trail, including refresh token for auth if access token expired
    try {
      const token = sessionStorage.getItem('refresh_token') || (() => { try { return localStorage.getItem('refresh_token'); } catch { return null; } })();
      await ApiService.post<{ success: boolean }>(`/logout`, token ? { refresh_token: token } : undefined);
    } catch (e) {
      // Ignore errors; still clear local auth state
      console.warn('Logout audit call failed:', e);
    }
    localStorage.removeItem("auth_user");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("token_type");
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('retail_master');
    sessionStorage.removeItem('user_modules');
    // Also remove refresh token from localStorage
    try {
      localStorage.removeItem('refresh_token');
    } catch (e) {
      console.warn('Could not remove refresh token from localStorage:', e);
    }
  }
}
