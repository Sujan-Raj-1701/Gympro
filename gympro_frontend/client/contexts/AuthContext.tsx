import React, { createContext, useContext, useState, useEffect } from "react";
import { AuthService } from "@/services/authService";
import { UserService } from "@/services/userService";

// Kill-switch: disable extra /read on 'users' during auth hydration.
// Set to true to re-enable enrichment from users table.
const ENABLE_USER_HYDRATION = false;

export interface User {
  id: string;
  user_id?: string;
  username: string;
  account_code?: string;
  retail_code?: string;
  salon_id?: number;
  email?: string;
  role?: string;
  isActive: boolean;
  createdAt: Date;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// No mock default credentials; real authentication via backend

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Merge helper to enrich current user with record from users table
  const hydrateUserFromUsersTable = async (baseUser: User | null, fallbackUsername?: string) => {
  // Short-circuit to stop calling /read on 'users' globally (e.g., Appointments  page load)
  if (!ENABLE_USER_HYDRATION) return baseUser;
    try {
      if (!baseUser) return null;
      const accountCode = baseUser.account_code || "";
      const retailCode = baseUser.retail_code || "";
      const username = baseUser.username || fallbackUsername || "";
      if (!accountCode || !retailCode || !username) return baseUser;
      const resp = await UserService.getUsers(accountCode, retailCode);
      const rows: any[] = (resp as any)?.data?.users || (resp as any)?.data || [];
      const match = Array.isArray(rows) ? rows.find((r: any) => (r.username || r.user_name) === username) : null;
      if (!match) return baseUser;
      // Merge additional fields from DB row (non-destructive)
      const enriched: any = {
        ...baseUser,
        // direct copies if present
        email: match.email ?? baseUser.email,
        role: match.role ?? baseUser.role,
        account_code: match.account_code ?? baseUser.account_code,
        retail_code: match.retail_code ?? baseUser.retail_code,
        // common optional org fields used in UI
        company_name: match.company_name ?? (match.org_name ?? (baseUser as any)?.company_name),
        org_name: match.org_name ?? (match.company_name ?? (baseUser as any)?.org_name),
        phone_number: match.phone_number ?? (baseUser as any)?.phone_number,
        permissions: match.permissions ?? (baseUser as any)?.permissions,
      };
      return enriched as User;
    } catch (e) {
      console.warn("Could not hydrate user from users table:", e);
      return baseUser;
    }
  };

  // Check for existing session on app load
  useEffect(() => {
    const checkExistingSession = async () => {
      const storedUser = localStorage.getItem("auth_user");
      const storedToken = sessionStorage.getItem("access_token");

      if (storedUser && storedToken) {
        try {
          const parsedUser = JSON.parse(storedUser);
          // Try to hydrate with real DB row (non-blocking)
          const enriched = await hydrateUserFromUsersTable(parsedUser);
          setUser(enriched || parsedUser);
          setIsAuthenticated(true);
          setIsLoading(false);
          return;
        } catch (error) {
          localStorage.removeItem("auth_user");
          sessionStorage.removeItem("access_token");
          sessionStorage.removeItem("token_type");
        }
      }

      // If we have a stored user but no access token, try a silent refresh using persisted refresh token
      if (storedUser && !storedToken) {
        try {
          await AuthService.refreshToken();
          // if refresh succeeded, fetch user info
          const userData = await AuthService.getCurrentUser();
          const parsedUser = {
            id: userData.user_id || userData.username,
            user_id: userData.user_id,
            username: userData.username,
            account_code: userData.account_code,
            retail_code: userData.retail_code,
            email: userData.email,
            role: userData.role,
            isActive: userData.isActive !== undefined ? userData.isActive : true,
            createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
          } as any;
          const enriched = await hydrateUserFromUsersTable(parsedUser);
          setUser(enriched || parsedUser);
          setIsAuthenticated(true);
          localStorage.setItem('auth_user', JSON.stringify(parsedUser));
          setIsLoading(false);
          return;
        } catch (e) {
          // Silent refresh failed; clear local stored tokens to force login
          sessionStorage.removeItem('access_token');
          sessionStorage.removeItem('token_type');
          sessionStorage.removeItem('refresh_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('auth_user');
        }
      }

      setIsLoading(false);
    };

    checkExistingSession();
  }, []);

  const login = async (
    username: string,
    password: string,
  ): Promise<boolean> => {
    try {
      // Call the AuthService for authentication
      const loginResponse = await AuthService.login(username, password);

      // Tokens are already stored in sessionStorage by AuthService
      const { access_token, token_type } = loginResponse;
  // store refresh token if present
  if ((loginResponse as any).refresh_token) sessionStorage.setItem('refresh_token', (loginResponse as any).refresh_token);
      
      // Get base user info from the backend
      const userData = await AuthService.getCurrentUser();
      const baseUser: User = {
        id: userData.user_id || userData.username,
        user_id: userData.user_id,
        username: userData.username,
        account_code: userData.account_code,
        retail_code: userData.retail_code,
        email: userData.email,
        role: userData.role,
        isActive: userData.isActive !== undefined ? userData.isActive : true,
        createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
      };
      // Enrich from users table via /read
      const enriched = await hydrateUserFromUsersTable(baseUser, username);

      setUser((enriched as any) || baseUser);
      setIsAuthenticated(true);
      localStorage.setItem("auth_user", JSON.stringify((enriched as any) || baseUser));
      return true;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = async () => {
    try {
      // Best-effort notify backend to record logout in activity log
      await AuthService.logout();
    } catch (e) {
      // Even if the API call fails, proceed with local logout
      console.warn('AuthContext.logout: backend logout failed, proceeding locally', e);
    }
    setUser(null);
    setIsAuthenticated(false);
    // Local clean-up (AuthService.logout already cleared most tokens, keep this idempotent)
    try { localStorage.removeItem("auth_user"); } catch {}
    try { sessionStorage.removeItem("access_token"); } catch {}
    try { sessionStorage.removeItem("token_type"); } catch {}
    try { sessionStorage.removeItem('refresh_token'); } catch {}
    try { sessionStorage.removeItem("user_modules"); } catch {}
  };

  const hasRole = (role: string): boolean => {
    if (!user || !isAuthenticated || !user.role) return false;
    return user.role === role;
  };

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
