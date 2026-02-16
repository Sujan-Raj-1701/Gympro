import React, { createContext, useContext, useState, useEffect } from "react";
import { AuthService } from "@/services/authService";

export interface User {
  id: string;
  user_id?: string;
  username: string;
  account_code?: string;
  retail_code?: string;
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
  logout: () => void;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock user database (no default roles)
const userDatabase = {
  admin: { password: "1234" },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on app load
  useEffect(() => {
    const checkExistingSession = () => {
      const storedUser = localStorage.getItem("auth_user");
      const storedToken = sessionStorage.getItem("access_token");
      
      if (storedUser && storedToken) {
        try {
          // Use stored user data directly, no need to call API
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setIsAuthenticated(true);
        } catch (error) {
          // If stored data is corrupted, clear storage
          localStorage.removeItem("auth_user");
          sessionStorage.removeItem("access_token");
          sessionStorage.removeItem("token_type");
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
      
      // Get user info from the backend (only needed during initial login)
      const userData = await AuthService.getCurrentUser();

      // Use actual API response data only
      const user: User = {
        id: userData.user_id || userData.username, // Use user_id from API as primary id
        user_id: userData.user_id, // Store user_id separately
        username: userData.username,
        account_code: userData.account_code, // Store account_code from API
        retail_code: userData.retail_code, // Store retail_code from API
        email: userData.email, // Only use email if it comes from API, don't generate
        role: userData.role, // Use role from API
        isActive: userData.isActive !== undefined ? userData.isActive : true,
        createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
      };

      setUser(user);
      setIsAuthenticated(true);
      localStorage.setItem("auth_user", JSON.stringify(user));
      return true;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem("auth_user");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("token_type");
    sessionStorage.removeItem("user_modules");
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
