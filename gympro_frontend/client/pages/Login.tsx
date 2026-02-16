import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Eye,
  EyeOff,
  Lock,
  User,
  Package,
  Users,
  FileText,
  Settings,
  BarChart3,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";


export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Decide the first sidebar parent route (fallback to first child if parent has no route)
  const getFirstSidebarRoute = (): string => {
    try {
      const raw = sessionStorage.getItem("user_modules");
      if (!raw) return "/";
      const mods = JSON.parse(raw);
      const parents: any[] = Array.isArray(mods) ? mods : [];
      const firstVisible = parents.find(
        (p) => (p?.can_view ?? 0) === 1 || (Array.isArray(p?.children) && p.children.some((c: any) => (c?.can_view ?? 0) === 1)),
      );
      if (!firstVisible) return "/";
      const parentRoute = String(firstVisible?.route || "").trim();
      if (parentRoute && parentRoute !== "#") return parentRoute.startsWith("/") ? parentRoute : `/${parentRoute}`;
      const firstChild = (firstVisible.children || []).find((c: any) => (c?.can_view ?? 0) === 1);
      const childRoute = String(firstChild?.route || "").trim();
      if (childRoute) return childRoute.startsWith("/") ? childRoute : `/${childRoute}`;
      return "/";
    } catch {
      return "/";
    }
  };

  // Demo credentials hint (intentionally empty)
  useEffect(() => {}, []);

  if (isAuthenticated) {
    const target = getFirstSidebarRoute();
    return <Navigate to={target} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const success = await login(username, password);
      if (!success) {
        setError("Invalid username or password. Please try again.");
      } else {
        // Redirect to the first visible parent from sidebar modules
        const target = getFirstSidebarRoute();
        navigate(target, { replace: true });
      }
    } catch (error: any) {
      setError(error.message || "An error occurred during login. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      {/* Brand / Illustration Panel */}
      <div className="relative hidden lg:flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* subtle grid */}
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:24px_24px]"></div>
        {/* glow */}
        <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-blue-400/10 blur-3xl"></div>
        <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl"></div>

        <div className="relative z-10 max-w-lg px-12 py-16 text-white">
          <div className="mb-8">
            <p className="text-white/80 text-xs tracking-widest uppercase">GYM Pro</p>
            <h1 className="text-2xl font-semibold leading-tight">AI-powered gym management, from member onboarding to seamless billing.</h1>
          </div>

          <ul className="space-y-3 text-white/90 text-[15px] leading-6">
            <li className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-sky-300"></div>
              <span className="font-medium tracking-[-0.01em]">Membership tracking with renewal alerts</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-300"></div>
              <span className="font-medium tracking-[-0.01em]">Role-based access for trainers and admins</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-indigo-300"></div>
              <span className="font-medium tracking-[-0.01em]">Faster billing with packages and payments</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-orange-300"></div>
              <span className="font-medium tracking-[-0.01em]">Actionable reports for attendance and revenue</span>
            </li>
          </ul>

          {/* Modules showcase (static, non-navigable) */}
          <div className="mt-10">
            <p className="text-xs uppercase tracking-widest text-white/70 mb-3">Explore features</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="group rounded-xl bg-white/10 border border-white/20 p-4 transition hover:bg-white/15">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">Memberships</p>
                    <p className="text-xs text-white/80 truncate">Plans & renewals</p>
                  </div>
                </div>
              </div>
              <div className="group rounded-xl bg-white/10 border border-white/20 p-4 transition hover:bg-white/15">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">Trainers & Access</p>
                    <p className="text-xs text-white/80 truncate">Roles, permissions & staff</p>
                  </div>
                </div>
              </div>
              <div className="group rounded-xl bg-white/10 border border-white/20 p-4 transition hover:bg-white/15">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">Billing</p>
                    <p className="text-xs text-white/80 truncate">Packages & payments</p>
                  </div>
                </div>
              </div>
              <div className="group rounded-xl bg-white/10 border border-white/20 p-4 transition hover:bg-white/15">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">Reports</p>
                    <p className="text-xs text-white/80 truncate">Attendance & revenue</p>
                  </div>
                </div>
              </div>
              <div className="group rounded-xl bg-white/10 border border-white/20 p-4 transition hover:bg-white/15">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">Attendance</p>
                    <p className="text-xs text-white/80 truncate">Check-ins & logs</p>
                  </div>
                </div>
              </div>
              <div className="group rounded-xl bg-white/10 border border-white/20 p-4 transition hover:bg-white/15">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                    <Settings className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">Settings</p>
                    <p className="text-xs text-white/80 truncate">Gym & business setup</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Form Panel */}
  <div className="flex items-center justify-center p-6 lg:p-12 bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
        <Card className="w-full max-w-md shadow-xl border border-slate-200">
          <CardHeader className="pb-4 text-center">
            <div className="mx-auto mb-2 h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg">
              <User className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
            <p className="text-sm text-slate-500">Sign in to continue to your workspace</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-5">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10 h-11"
                    placeholder="Enter your username"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-11"
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-base font-medium shadow-md bg-slate-900 hover:bg-slate-800 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
