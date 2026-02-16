import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, UserPlus, ChevronDown, ChevronRight, Eye, EyeOff, Search, ChevronsDown, ChevronsUp, CheckSquare, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "../contexts/AuthContext";
import { UserService, ModuleService } from "@/services/userService";
import { ApiService } from "@/services/apiService";

interface Module { id: number; name: string; display_order: number; parent_id: number | null; }
type Permission = { view: boolean; edit: boolean };
type FormDataShape = { username: string; password: string; email: string; phoneNumber: string; retailCode: string; role: string; isActive: boolean; permissions: Record<string, Permission> };

export default function AddUser() {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const { toast } = useToast();
  const { user } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [modules, setModules] = useState<Module[]>([]);
  const [roles, setRoles] = useState<Array<{ id?: number | string; name: string }>>([]);
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());
  const [showPassword, setShowPassword] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState<FormDataShape>({ username: "", password: "", email: "", phoneNumber: "", retailCode: "", role: "", isActive: true, permissions: {} });
  // store raw loaded user so we can map role -> role_id after roles are loaded
  const [loadedUserRaw, setLoadedUserRaw] = useState<any | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormDataShape, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormDataShape, boolean>>>({});
  const [usernameValidation, setUsernameValidation] = useState<{ checking: boolean; available?: boolean; message?: string }>({ checking: false });
  const [usernameCheckTimeout, setUsernameCheckTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const loadModulesAndRoles = async () => {
      try {
        if (!user?.account_code || !user?.retail_code) return;
        const response: any = await ModuleService.getModulesAndRoles(user.account_code, user.retail_code);
        if (response?.success && response?.data) {
          const data: Module[] = response.data.modules || [];
          const roleList: Array<{ id?: number | string; name: string }> = (response.data.roles || []).map((r: any) => ({ id: r?.id ?? r?.role_id ?? r?.code, name: r?.name || r?.role || r?.role_name || r?.title })).filter((x: any) => x.name);
          if (roleList.length) setRoles(roleList);
          setModules(data);
          const initial: Record<string, Permission> = {};
          data.forEach((m) => (initial[String(m.id)] = { view: false, edit: false }));
          // Merge initial permissions with any existing (e.g. loaded user permissions) instead of overwriting
          setFormData((p) => ({ ...p, permissions: { ...initial, ...(p.permissions || {}) } }));
        } else {
          toast({ title: "Warning", description: "No modules/roles found.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Error", description: "Failed to load modules/roles.", variant: "destructive" });
      }
    };
    loadModulesAndRoles();
  }, [toast]);

  // If editing, fetch user details and prefill
  useEffect(() => {
    const loadUser = async () => {
      if (!userId || !user?.account_code || !user?.retail_code) return;
      try {
        // Use the dedicated endpoint that returns both user and screens
        const resp: any = await ApiService.get(`/users/${encodeURIComponent(String(userId))}/details`);
          if (resp && resp.success && resp.user) {
          const found = resp.user as any;
            setLoadedUserRaw(found);
          setFormData((p) => ({
            ...p,
            username: found.username || "",
            password: "", // do not prefill for security
            // backend commonly uses email_id column name
            email: found.email_id || found.email || "",
            phoneNumber: found.phone_number || "",
            retailCode: found.retail_code || user?.retail_code || "",
            role: found.role_id || found.role || "",
            // Prefer explicit numeric/string status first, then is_active/active; default true
            isActive: (() => {
              const toBool = (v: any) => {
                if (v === undefined || v === null) return undefined as unknown as boolean;
                const s = String(v).toLowerCase();
                return s === '1' || s === 'true' || s === 'active';
              };
              const a = toBool(found.status);
              const b = toBool(found.is_active);
              const c = toBool(found.active);
              return (a ?? b ?? c ?? true) as boolean;
            })(),
            permissions: (() => {
              try {
                const parsed = typeof found.permissions === 'string' ? JSON.parse(found.permissions) : (found.permissions || {});
                return { ...p.permissions, ...parsed } as Record<string, Permission>;
              } catch {
                return p.permissions;
              }
            })(),
          }));

          // Merge explicit users_screen_access rows returned by the endpoint
          try {
            const rows: any[] = resp.screens || [];
            const byScreen: Record<string, Permission> = {};
            for (const r of rows) {
              if (r && r.screen_id != null) {
                byScreen[String(r.screen_id)] = { view: !!r.can_view, edit: !!r.can_edit };
              }
            }
            if (Object.keys(byScreen).length) {
              setFormData((p) => ({ ...p, permissions: { ...p.permissions, ...byScreen } }));
            }
          } catch (e) {
            console.debug('Failed to merge users_screen_access from details endpoint:', e);
          }
        }
      } catch (e) {
        console.error('Failed to load user for edit', e);
      }
    };
    loadUser();
  }, [userId, user?.account_code, user?.retail_code]);

  // Check username availability with debouncing
  const checkUsernameAvailability = async (username: string) => {
    if (!username || username.length < 3 || !user?.account_code || !user?.retail_code) {
      setUsernameValidation({ checking: false });
      return;
    }

    // Skip check if editing existing user with same username
    if (userId && loadedUserRaw?.username === username) {
      setUsernameValidation({ checking: false, available: true });
      return;
    }

    setUsernameValidation({ checking: true });
    
    try {
      const response = await UserService.checkUsernameAvailability(username, user.account_code, user.retail_code);
      
      if (response?.success && response?.data) {
        setUsernameValidation({ 
          checking: false, 
          available: response.data.available,
          message: response.data.message
        });
      } else {
        setUsernameValidation({ 
          checking: false, 
          available: false, 
          message: response?.message || 'Error checking username availability'
        });
      }
    } catch (error) {
      console.error('Username check error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      setUsernameValidation({ 
        checking: false, 
        available: false, 
        message: 'Error checking username availability'
      });
    }
  };

  // When roles list becomes available, map any loaded user's role (by id or name) to formData.role
  useEffect(() => {
    if (!loadedUserRaw || !roles || !roles.length) return;
    // If role already set in formData, do not override
    if (formData.role && String(formData.role).trim() !== "") return;
    let roleVal: any = loadedUserRaw.role_id ?? loadedUserRaw.role ?? loadedUserRaw.role_name ?? null;
    // If roleVal is a string that is not numeric, try to find by name
    if ((roleVal === null || roleVal === undefined || String(roleVal).trim() === "") && loadedUserRaw.role) {
      const nameToFind = String(loadedUserRaw.role).toLowerCase();
      const match = roles.find((r) => String(r.name || '').toLowerCase() === nameToFind);
      if (match) roleVal = match.id;
    }
    if (roleVal !== null && typeof roleVal !== 'undefined') {
      setFormData((p) => ({ ...p, role: String(roleVal) }));
    }
  }, [roles, loadedUserRaw]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (usernameCheckTimeout) {
        clearTimeout(usernameCheckTimeout);
      }
    };
  }, [usernameCheckTimeout]);
//test
  const handleInputChange = (field: keyof FormDataShape, value: string) => {
    // sanitize phone
    if (field === 'phoneNumber') value = value.replace(/\D/g, '').slice(0, 10);
    setFormData((p) => ({ ...p, [field]: value }));
    if (touched[field]) {
      const fieldErr = validateField(field, value, { ...formData, [field]: value });
      setErrors((e) => ({ ...e, [field]: fieldErr }));
    }

    // Handle username validation with debouncing
    if (field === 'username') {
      // Clear previous timeout
      if (usernameCheckTimeout) {
        clearTimeout(usernameCheckTimeout);
      }
      
      // Reset validation state
      setUsernameValidation({ checking: false });
      
      // Set new timeout for username check
      if (value && value.length >= 3) {
        const timeout = setTimeout(() => {
          checkUsernameAvailability(value);
        }, 500); // 500ms delay
        
        setUsernameCheckTimeout(timeout);
      } else if (!value || value.length < 3) {
        // Clear validation state if username is too short or empty
        setUsernameValidation({ checking: false });
      }
    }
  };
  const markTouched = (field: keyof FormDataShape) => setTouched((t) => ({ ...t, [field]: true }));
  const handlePermissionChange = (id: string, key: keyof Permission, v: boolean) => setFormData((p) => ({ ...p, permissions: { ...p.permissions, [id]: { ...p.permissions[id], [key]: v } } }));
  const handleSelectAll = () => { const next = { ...formData.permissions }; modules.forEach((m) => (next[String(m.id)] = { view: true, edit: true })); setFormData((p) => ({ ...p, permissions: next })); };
  const handleDeselectAll = () => { const next = { ...formData.permissions }; modules.forEach((m) => (next[String(m.id)] = { view: false, edit: false })); setFormData((p) => ({ ...p, permissions: next })); };
  const toggleParent = (pid: number) => setExpandedParents((prev) => { const c = new Set(prev); c.has(pid) ? c.delete(pid) : c.add(pid); return c; });

  const hierarchical = useMemo(() => {
    const parents = modules.filter((m) => m.parent_id === null).sort((a, b) => a.display_order - b.display_order);
    return parents.map((parent) => ({ parent, children: modules.filter((c) => c.parent_id === parent.id).sort((a, b) => a.display_order - b.display_order) }));
  }, [modules]);
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return hierarchical;
    const q = searchTerm.toLowerCase();
    return hierarchical.map(({ parent, children }) => {
      const matchParent = parent.name.toLowerCase().includes(q);
      const ch = children.filter((c) => c.name.toLowerCase().includes(q));
      if (matchParent) return { parent, children };
      if (ch.length) return { parent, children: ch };
      return null as any;
    }).filter(Boolean) as { parent: Module; children: Module[] }[];
  }, [hierarchical, searchTerm]);
  // summary removed along with side panel
  const genPwd = () => { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+"; let pwd = ""; for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)]; setFormData((p) => ({ ...p, password: pwd })); setShowPassword(true); };
  // password strength meter removed per request

  const validateField = (field: keyof FormDataShape, value: string, data: FormDataShape): string | undefined => {
    switch (field) {
      case 'username': {
        if (!value.trim()) return 'Username is required';
        if (value.length < 3) return 'At least 3 characters';
        if (!/^[a-zA-Z0-9._-]+$/.test(value)) return 'Only letters, numbers, dot, underscore, hyphen';
        
        // Check username availability validation
        if (usernameValidation.available === false && !usernameValidation.checking) {
          return usernameValidation.message || 'Username is not available';
        }
        
        return undefined;
      }
      case 'password': {
        if (!value) return 'Password is required';
        if (value.length < 3) return 'Minimum 3 characters';
        // removed strict character composition requirements
        if (data.username && value === data.username) return 'Password should differ from username';
        return undefined;
      }
      case 'email': {
        if (!value) return undefined; // optional
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
        return ok ? undefined : 'Enter a valid email';
      }
      case 'phoneNumber': {
        if (!value) return undefined; // optional
        return value.length === 10 ? undefined : 'Enter 10-digit number';
      }
      case 'retailCode': {
        return value ? undefined : 'Retail code is required';
      }
      case 'role': {
        return value ? undefined : 'Role is required';
      }
      default:
        return undefined;
    }
  };

  const validateAll = (data: FormDataShape) => {
    const nextErrors: Partial<Record<keyof FormDataShape, string>> = {};
    (['username','password','email','phoneNumber','retailCode','role'] as (keyof FormDataShape)[]) .forEach((f) => {
      const msg = validateField(f, (data as any)[f], data);
      if (msg) nextErrors[f] = msg;
    });
    return nextErrors;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setIsLoading(true);
    try {
      // custom validation
      const v = validateAll(formData);
      setTouched({ username: true, password: true, email: true, phoneNumber: true, retailCode: true, role: true, permissions: true as any });
      // In edit mode, password is optional; drop its error if empty
      if (userId && !formData.password) delete v.password;
      
      // Check username availability before submission
      if (!userId && usernameValidation.available === false) {
        v.username = usernameValidation.message || 'Username is not available';
      }
      
      // If username is still being checked, wait for validation
      if (usernameValidation.checking) {
        setIsLoading(false);
        toast({ title: 'Please wait', description: 'Checking username availability...', variant: 'default' });
        return;
      }
      setErrors(v);
      // Require at least one screen permission when creating a new user
      const hasAnyScreen = Object.values(formData.permissions || {}).some((p) => !!(p.view || p.edit));
      if (!userId && !hasAnyScreen) {
        const permErr = 'Select at least one screen permission';
        setErrors((prev) => ({ ...prev, permissions: permErr }));
        setIsLoading(false);
        toast({ title: 'Validation error', description: permErr, variant: 'destructive' });
        const el = document.getElementById('permissions-section');
        if (el && 'scrollIntoView' in el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      if (Object.keys(v).length) {
        setIsLoading(false);
        const firstKey = Object.keys(v)[0] as keyof FormDataShape;
        const el = document.getElementById(String(firstKey));
        if (el && 'scrollIntoView' in el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast({ title: 'Validation error', description: v[firstKey] || 'Please fix the highlighted fields', variant: 'destructive' });
        return;
      }
    if (userId) {
        // Update
        const payload: any = {
          user_id: userId,
          username: formData.username,
          ...(formData.password ? { password: formData.password } : {}),
          email: formData.email,
          phone_number: formData.phoneNumber,
          account_code: user?.account_code || "",
          retail_code: formData.retailCode || user?.retail_code || "",
          role: formData.role,
          permissions: JSON.stringify(formData.permissions),
          // Send both for compatibility; backend will pick the appropriate column
          is_active: !!formData.isActive,
          status: !!formData.isActive,
          updated_at: new Date().toISOString(),
        };
        const res = await UserService.updateUser(payload);
        if (res?.success) { toast({ title: "Success", description: "User updated successfully" }); navigate("/user-management"); } else throw new Error(res?.message || "Failed to update user");
      } else {
        // Create
  const payload = { username: formData.username, hashed_password: formData.password, email: formData.email, phone_number: formData.phoneNumber, account_code: user?.account_code || "", retail_code: formData.retailCode || user?.retail_code || "", role: formData.role, permissions: JSON.stringify(formData.permissions), is_active: !!formData.isActive, status: !!formData.isActive, created_at: new Date().toISOString() };
        const res = await UserService.createUser(payload);
        if (res?.success) { toast({ title: "Success", description: "User created successfully" }); navigate("/user-management"); } else throw new Error(res?.message || "Failed to create user");
      }
    } catch (err: any) { toast({ title: "Error", description: err?.message || "Failed to create user", variant: "destructive" }); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="w-full px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="heading-font text-xl sm:text-2xl font-semibold tracking-tight">{userId ? 'Update User' : 'Create User'}</h1>
          <p className="text-muted-foreground text-sm mt-1">{userId ? 'Update user details and permissions.' : 'Add a user and assign screen permissions.'}</p>
        </div>
        <Button variant="ghost" size="sm" className="flex items-center gap-2 hover:bg-slate-100 self-start sm:self-auto" onClick={() => navigate("/user-management")}>
          <ArrowLeft className="h-4 w-4" /><span>Back</span>
        </Button>
      </div>

  <form onSubmit={onSubmit} className="space-y-4 sm:space-y-6" autoComplete="off">
        <div className="space-y-4 sm:space-y-6">
          <Card className="relative overflow-hidden border-0">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 opacity-80 pointer-events-none"></div>
            <CardHeader id="permissions-section" className="pb-3 relative z-10">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg ring-1 ring-indigo-200/60">
                  <UserPlus className="h-4 w-4" />
                </div>
                User Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 relative z-10">
              <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="username" className="text-sm">Username</Label>
                <div className="relative">
                  <Input 
                    id="username" 
                    name="new-username" 
                    autoComplete="off" 
                    spellCheck={false} 
                    className={`h-9 pr-8 ${
                      errors.username 
                        ? 'border-red-500 focus-visible:ring-red-500' 
                        : usernameValidation.available === true 
                        ? 'border-green-500 focus-visible:ring-green-500' 
                        : usernameValidation.available === false 
                        ? 'border-red-500 focus-visible:ring-red-500'
                        : ''
                    }`} 
                    placeholder="jane.doe" 
                    value={formData.username} 
                    onBlur={() => { 
                      markTouched('username'); 
                      setErrors((e) => ({ ...e, username: validateField('username', formData.username, formData) })); 
                    }} 
                    onChange={(e) => handleInputChange("username", e.target.value)} 
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    {usernameValidation.checking && (
                      <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    )}
                    {!usernameValidation.checking && usernameValidation.available === true && (
                      <div className="h-4 w-4 text-green-500">✓</div>
                    )}
                    {!usernameValidation.checking && usernameValidation.available === false && (
                      <div className="h-4 w-4 text-red-500">✗</div>
                    )}
                  </div>
                </div>
                {errors.username && <p className="text-xs text-red-600 mt-1">{errors.username}</p>}
                {!errors.username && usernameValidation.available === true && (
                  <p className="text-xs text-green-600 mt-1">Username is available</p>
                )}
                {!errors.username && usernameValidation.available === false && usernameValidation.message && (
                  <p className="text-xs text-red-600 mt-1">{usernameValidation.message}</p>
                )}
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="password" className="text-sm">Password{userId ? ' (leave blank to keep unchanged)' : ''}</Label>
                <div className="relative">
                  <Input id="password" name="new-password" autoComplete="new-password" className={`h-9 pr-16 sm:pr-20 ${errors.password ? 'border-red-500 focus-visible:ring-red-500' : ''}`} type={showPassword ? "text" : "password"} placeholder="Minimum 3 characters" value={formData.password} onBlur={() => { markTouched('password'); setErrors((e) => ({ ...e, password: validateField('password', formData.password, formData) })); }} onChange={(e) => handleInputChange("password", e.target.value)} />
                  <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowPassword((v) => !v)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={genPwd}>Gen</Button>
                  </div>
                </div>
                {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <Input id="email" name="new-email" autoComplete="off" className={`h-9 ${errors.email ? 'border-red-500 focus-visible:ring-red-500' : ''}`} placeholder="name@example.com" value={formData.email} onBlur={() => { markTouched('email'); setErrors((e) => ({ ...e, email: validateField('email', formData.email, formData) })); }} onChange={(e) => handleInputChange("email", e.target.value)} />
                {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="phoneNumber" className="text-sm">Phone Number</Label>
                <Input id="phoneNumber" name="new-phone" autoComplete="off" inputMode="numeric" className={`h-9 ${errors.phoneNumber ? 'border-red-500 focus-visible:ring-red-500' : ''}`} placeholder="10-digit mobile" value={formData.phoneNumber} onBlur={() => { markTouched('phoneNumber'); setErrors((e) => ({ ...e, phoneNumber: validateField('phoneNumber', formData.phoneNumber, formData) })); }} onChange={(e) => handleInputChange("phoneNumber", e.target.value)} />
                {errors.phoneNumber && <p className="text-xs text-red-600 mt-1">{errors.phoneNumber}</p>}
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="retailCode" className="text-sm">Retail Code</Label>
                <Select value={formData.retailCode} onValueChange={(v) => handleInputChange("retailCode", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select Retail Codes" /></SelectTrigger>
                  <SelectContent><SelectItem value={user?.retail_code || ""}>{user?.retail_code}</SelectItem></SelectContent>
                </Select>
                {errors.retailCode && <p className="text-xs text-red-600 mt-1">{errors.retailCode}</p>}
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="role" className="text-sm">Role</Label>
                <Select value={String(formData.role)} onValueChange={(v) => handleInputChange("role", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select Role" /></SelectTrigger>
                  <SelectContent>{roles.map((r) => (<SelectItem key={String(r.id) + r.name} value={String(r.id ?? r.name)}>{r.name}</SelectItem>))}</SelectContent>
                </Select>
                {errors.role && <p className="text-xs text-red-600 mt-1">{errors.role}</p>}
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="isActive" className="text-sm">Status</Label>
                <div className="flex items-center h-9 px-3 rounded-md border border-input bg-background shadow-sm">
                  <Switch id="isActive" checked={!!formData.isActive} onCheckedChange={(c) => setFormData((p) => ({ ...p, isActive: !!c }))} />
                  <span className="ml-2 text-sm text-slate-700">{formData.isActive ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 opacity-80 pointer-events-none"></div>
            <CardHeader className="pb-2 relative z-10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg ring-1 ring-emerald-200/60">
                    <Search className="h-4 w-4" />
                  </div>
                  Screen Permissions
                </CardTitle>
                <div className="flex gap-2 flex-wrap items-center">
                  <div className="relative flex-1 sm:flex-none">
                    <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search screens..." className="pl-8 h-8 w-full sm:w-48" />
                    <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  <div className="flex gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setExpandedParents(new Set(hierarchical.map(h => h.parent.id)))} aria-label="Open All">
                            <ChevronsDown className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open All</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setExpandedParents(new Set())} aria-label="Close All">
                            <ChevronsUp className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Close All</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={handleSelectAll} aria-label="Select All">
                            <CheckSquare className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Select All</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={handleDeselectAll} aria-label="Deselect All">
                            <Square className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Deselect All</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10 py-3">
              {errors.permissions && <p className="text-xs text-red-600 mb-2">{errors.permissions}</p>}
              <div className="space-y-3">
                {filtered.map(({ parent, children }) => (
                  <div key={parent.id} className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 bg-gradient-to-r from-slate-50 to-slate-100/50 border border-slate-200/60 rounded-lg shadow-sm hover:shadow-md transition-shadow gap-2 sm:gap-0">
                      <div className="flex items-center gap-2 flex-1">
                          {children.length > 0 && (
                            <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-slate-200" onClick={() => toggleParent(parent.id)}>
                              {expandedParents.has(parent.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          )}
                          <div className={`flex items-center gap-2 flex-1 ${children.length > 0 ? "cursor-pointer" : ""}`} onClick={children.length > 0 ? () => toggleParent(parent.id) : undefined}>
                            <Label className="font-semibold text-slate-800 text-sm">{parent.name}</Label>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        {(() => {
                          const pid = String(parent.id);
                          const permParent = formData.permissions[pid] || { view: false, edit: false };
                          const allSelected = !!(permParent.view && permParent.edit && children.every((m) => {
                            const p = formData.permissions[String(m.id)] || { view: false, edit: false };
                            return p.view && p.edit;
                          }));
                          const setAll = (val: boolean) => {
                            handlePermissionChange(pid, "view", val);
                            handlePermissionChange(pid, "edit", val);
                            children.forEach((m) => {
                              const id = String(m.id);
                              handlePermissionChange(id, "view", val);
                              handlePermissionChange(id, "edit", val);
                            });
                          };
                          return (
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`p-${parent.id}-all`} className="text-xs">All</Label>
                              <Switch id={`p-${parent.id}-all`} checked={allSelected} onCheckedChange={(c) => setAll(!!c)} />
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`p-${parent.id}-view`} className="text-xs">View</Label>
                          <Switch id={`p-${parent.id}-view`} checked={!!formData.permissions[String(parent.id)]?.view} onCheckedChange={(c) => handlePermissionChange(String(parent.id), "view", !!c)} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`p-${parent.id}-edit`} className="text-xs">Edit</Label>
                          <Switch id={`p-${parent.id}-edit`} checked={!!formData.permissions[String(parent.id)]?.edit} onCheckedChange={(c) => handlePermissionChange(String(parent.id), "edit", !!c)} />
                        </div>
                      </div>
                    </div>

                    {expandedParents.has(parent.id) && children.length > 0 && (
                      <div className="ml-2 sm:ml-4 space-y-1">
                        {children.map((m) => {
                          const id = String(m.id);
                          const perm = formData.permissions[id] || { view: false, edit: false };
                          return (
                            <div key={id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-2 border border-slate-200/60 rounded-md bg-white gap-2 sm:gap-0">
                              <div className="flex-1"><Label className="font-medium text-slate-700 text-sm">{m.name}</Label></div>
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`${id}-view`} className="text-xs">View</Label>
                                  <Switch id={`${id}-view`} checked={perm.view} onCheckedChange={(c) => handlePermissionChange(id, "view", !!c)} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`${id}-edit`} className="text-xs">Edit</Label>
                                  <Switch id={`${id}-edit`} checked={perm.edit} onCheckedChange={(c) => handlePermissionChange(id, "edit", !!c)} />
                                </div>
                                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => { const next = !(perm.view && perm.edit); handlePermissionChange(id, "view", next); handlePermissionChange(id, "edit", next); }}>{perm.view && perm.edit ? "Unset" : "Set"}</Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="mt-4 pt-4 border-t border-slate-200/60 flex flex-col sm:flex-row sm:justify-end gap-3">
            <Button type="button" variant="outline" size="sm" className="h-10 px-4 hover:bg-slate-50 order-2 sm:order-1" onClick={() => navigate("/user-management")}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isLoading} className="h-10 px-6 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 shadow-md order-1 sm:order-2">{isLoading ? (userId ? 'Updating...' : 'Creating...') : (userId ? 'Update User' : 'Create User')}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}

