import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// dropdown menu removed for direct Edit action
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// alert dialog removed along with dropdown actions
import { format } from "date-fns";
import {
  UserCog,
  Search,
  Filter,
  Download,
  Users,
  Shield,
  UserPlus,
  Pencil,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useAuth, User } from "@/contexts/AuthContext";
import { UserService, ModuleService } from "@/services/userService";

interface UserForm {
  username: string;
  email: string;
  password: string;
  role?: string;
  isActive: boolean;
}

// Remove static data; we'll load from backend /read

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roles, setRoles] = useState<Array<{ id?: number | string; name: string }>>([]);
  const [rawUserRows, setRawUserRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  type SortKey = "username" | "role" | "isActive" | "createdAt";
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole =
      roleFilter === "all" ||
      (user.role && user.role.toLowerCase() === roleFilter.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? user.isActive : !user.isActive);
    return matchesSearch && matchesRole && matchesStatus;
  });

  const sortedUsers = useMemo(() => {
    const arr = [...filteredUsers];
    arr.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "username":
          return dir * a.username.localeCompare(b.username);
        case "role":
          return dir * (String(a.role || "").localeCompare(String(b.role || "")));
        case "isActive":
          return dir * (Number(a.isActive) - Number(b.isActive));
        case "createdAt":
        default:
          return dir * (a.createdAt.getTime() - b.createdAt.getTime());
      }
    });
    return arr;
  }, [filteredUsers, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedUsers = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedUsers.slice(start, start + pageSize);
  }, [sortedUsers, pageSize, safePage]);

  // Stats section removed

  // Load users from backend
  useEffect(() => {
    const loadUsers = async () => {
      if (!currentUser?.account_code || !currentUser?.retail_code) return;
      setIsLoading(true);
      try {
        const res = await UserService.getUsers(currentUser.account_code, currentUser.retail_code);
  const rows: any[] = (res as any)?.data?.users || (res as any)?.data || [];
  setRawUserRows(rows || []);
        const toBool = (v: any): boolean | undefined => {
          if (v === undefined || v === null) return undefined;
          const s = String(v).toLowerCase();
          return s === "1" || s === "true" || s === "active";
        };
        const mapped: User[] = Array.isArray(rows)
          ? rows.map((r: any): User => {
              const statusFromStatus = toBool(r.status);
              const statusFromIsActive = toBool(r.is_active);
              const statusFromActive = toBool(r.active);
              const isActive =
                statusFromStatus ?? statusFromIsActive ?? statusFromActive ?? true;
              return {
                id: String(r.user_id || r.id || r.username),
                username: r.username ?? "",
                email: r.email ?? r.email_id ?? "",
                role: r.role || r.role_name || undefined,
                isActive,
                createdAt: r.create_at ? new Date(r.create_at) : new Date(),
              };
            })
          : [];
        setUsers(mapped);
        setPage(1);
      } catch (e) {
        console.error("Failed to load users:", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadUsers();
  }, [currentUser?.account_code, currentUser?.retail_code]);

  // Load roles from roles table via public endpoint helper
  useEffect(() => {
    let mounted = true;
    const loadRoles = async () => {
      try {
        if (!currentUser?.account_code || !currentUser?.retail_code) return;
        const res: any = await ModuleService.getModulesAndRoles(currentUser.account_code, currentUser.retail_code);
        if (!mounted) return;
        const list: Array<{ id?: number | string; name: string }> = (res?.data?.roles || [])
          .map((r: any) => ({ id: r?.id ?? r?.role_id ?? r?.code, name: r?.name }))
          .filter((x: any) => x.name);
        setRoles(list);
      } catch {
        // keep roles empty; filter will still show All Roles
      }
    };
    loadRoles();
    return () => {
      mounted = false;
    };
  }, []);

  const handleDelete = (id: string) => {
    if (id === currentUser?.id) {
      alert("You cannot delete your own account.");
      return;
    }
    setUsers((prev) => prev.filter((user) => user.id !== id));
  };

  const toggleUserStatus = (id: string) => {
    if (id === currentUser?.id) {
      alert("You cannot deactivate your own account.");
      return;
    }
    setUsers((prev) =>
      prev.map((user) =>
        user.id === id ? { ...user, isActive: !user.isActive } : user,
      ),
    );
  };

  const exportUsers = () => {
    const csvContent = [
      "Username,Email,Role,Status,Created Date",
      ...filteredUsers.map((user) =>
        [
          user.username,
          user.email,
          user.role,
          user.isActive ? "Active" : "Inactive",
          format(user.createdAt, "yyyy-MM-dd"),
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("hidden", "");
    a.setAttribute("href", url);
    a.setAttribute("download", `users-${format(new Date(), "yyyy-MM-dd")}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-red-100 text-red-800";
      case "manager": return "bg-blue-100 text-blue-800";
      case "staff": return "bg-green-100 text-green-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin": return <Shield className="h-4 w-4" />;
      case "manager": return <UserCog className="h-4 w-4" />;
      default: return <Users className="h-4 w-4" />;
    }
  };
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  };
  const SortIcon = ({ keyName }: { keyName: SortKey }) => {
    if (sortKey !== keyName) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? (
      <ChevronUp className="ml-1 h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="ml-1 h-3.5 w-3.5" />
    );
  };

  // Calculate user statistics for dashboard cards
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.isActive).length;
  const inactiveUsers = totalUsers - activeUsers;
  
  // More flexible role matching to handle variations like "Admin", "Administrator", etc.
  const adminUsers = users.filter(u => {
    const role = (u.role || '').toLowerCase().trim();
    return role === 'admin' || role === 'administrator' || role.includes('admin');
  }).length;
  
  const managerUsers = users.filter(u => {
    const role = (u.role || '').toLowerCase().trim();
    return role === 'manager' || role === 'mgr' || role.includes('manager');
  }).length;

  // Debug: Log user roles to help identify the issue
  const statCards = [
    {
      label: "Total Users",
      value: totalUsers,
      description: "Accounts created",
      icon: Users,
      iconStyles: "bg-blue-50 text-blue-600",
      trend: "+2 this week",
      trendColor: "text-blue-600",
    },
    {
      label: "Active",
      value: activeUsers,
      description: "Currently enabled",
      icon: CheckCircle,
      iconStyles: "bg-emerald-50 text-emerald-600",
      trend: "Stable",
      trendColor: "text-emerald-600",
    },
    {
      label: "Inactive",
      value: inactiveUsers,
      description: "Awaiting reactivation",
      icon: XCircle,
      iconStyles: "bg-rose-50 text-rose-600",
      trend: "Review needed",
      trendColor: "text-rose-600",
    },
    {
      label: "Admins",
      value: adminUsers,
      description: "System supervisors",
      icon: Shield,
      iconStyles: "bg-purple-50 text-purple-600",
      trend: "Secure",
      trendColor: "text-purple-600",
    },
    {
      label: "Managers",
      value: managerUsers,
      description: "Operations owners",
      icon: UserCog,
      iconStyles: "bg-amber-50 text-amber-600",
      trend: "On track",
      trendColor: "text-amber-600",
    },
  ];

  return (
    <div className="space-y-4 p-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2 rounded-lg shadow-md">
            <UserCog className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">User Management</h1>
            <p className="text-xs text-slate-500 hidden sm:block">Monitor account activity, manage access levels, and keep your team roster current.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={exportUsers}
            variant="outline"
            size="sm"
            className="h-8 border-slate-300 bg-white hover:bg-slate-50 flex-1 sm:flex-none"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            <span className="sm:inline">Export</span>
          </Button>
          <Button 
            onClick={() => navigate("/add-user")}
            size="sm"
            className="h-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md flex-1 sm:flex-none"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            <span className="sm:inline">New User</span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`relative overflow-hidden rounded-lg border ${card.label === 'Total Users' ? 'border-blue-200 bg-blue-50' : card.label === 'Active' ? 'border-emerald-200 bg-emerald-50' : card.label === 'Inactive' ? 'border-rose-200 bg-rose-50' : card.label === 'Admins' ? 'border-purple-200 bg-purple-50' : 'border-amber-200 bg-amber-50'} px-2 sm:px-3 py-2 shadow-sm hover:shadow-md transition-all hover:scale-[1.02]`}
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className={`${card.iconStyles} p-1 sm:p-1.5 rounded-md shadow-sm`}>
                  <Icon className="h-3 w-3 sm:h-4 sm:w-4" />
                </div>
                <div className={`text-[8px] sm:text-[9px] font-bold tracking-wider uppercase ${card.trendColor}`}>
                  {card.label}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[9px] sm:text-[10px] text-gray-600">User</span>
                  <span className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums">{card.value}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[9px] sm:text-[10px] text-gray-600 truncate">{card.description}</span>
                  <span className={`text-[9px] sm:text-[10px] font-medium ${card.trendColor} hidden sm:inline`}>{card.trend}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters Section */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="space-y-3 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base font-semibold text-slate-900">Directory</CardTitle>
            <p className="text-xs text-slate-600">Search, filter, and manage user access levels in one place.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px] md:grid-cols-[minmax(0,1fr)_180px_180px]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-8 pl-8 text-xs bg-white border-slate-300 focus-visible:ring-0 focus-visible:border-blue-500"
                placeholder="Search users by name or email"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(v) => {
                setRoleFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 text-xs border-slate-300 bg-white focus:ring-0 focus:border-blue-500">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">All Roles</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={String(r.id ?? r.name)} value={r.name}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 text-xs border-slate-300 bg-white focus:ring-0 focus:border-blue-500">
                <SelectValue placeholder="All status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading users…</div>
          ) : paginatedUsers.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No users match the current filters.</div>
          ) : (
            <>
              {/* Mobile Cards View */}
              <div className="block sm:hidden space-y-3">
                {paginatedUsers.map((user) => {
                  const raw = rawUserRows.find((r) => String(r.user_id || r.id || r.username) === user.id) || {};
                  let roleName = user.role;
                  if (!roleName && raw.role_id) {
                    const found = roles.find((rr) => String(rr.id) === String(raw.role_id));
                    roleName = found?.name;
                  }
                  const display = roleName
                    ? roleName.charAt(0).toUpperCase() + roleName.slice(1)
                    : "No Role";

                  return (
                    <Card key={user.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <Avatar className="h-10 w-10 border border-slate-200">
                              <AvatarFallback className="bg-slate-100 text-slate-700 text-sm">
                                {user.username.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-base text-slate-900 truncate">{user.username}</p>
                              <p className="text-xs text-slate-500 truncate">{user.email}</p>
                            </div>
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-slate-600 hover:text-slate-900"
                                  onClick={() => navigate(`/edit-user/${user.id}`)}
                                  aria-label="Edit user"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-slate-600">Role</p>
                            <Badge className={`${getRoleColor(roleName || "unknown")} px-2 py-1 text-xs font-medium w-fit`}>
                              <div className="flex items-center gap-1">
                                {getRoleIcon(roleName || "unknown")}
                                {display}
                              </div>
                            </Badge>
                          </div>
                          
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-slate-600">Status</p>
                            {user.isActive ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                                <span className="h-2 w-2 rounded-full bg-rose-500" />
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="pt-2 border-t border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium text-slate-600">Created</p>
                              <p className="text-xs text-slate-700">{format(user.createdAt, "MMM dd, yyyy")}</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Desktop Table View */}
              <div className="hidden sm:block overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-100 border-b-2">
                      <TableHead className="text-xs font-semibold text-slate-700 h-10">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-slate-700"
                          onClick={() => toggleSort("username")}
                        >
                          User
                          <SortIcon keyName="username" />
                        </button>
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-slate-700 h-10">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-slate-700"
                          onClick={() => toggleSort("role")}
                        >
                          Role
                          <SortIcon keyName="role" />
                        </button>
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-slate-700 h-10">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-slate-700"
                          onClick={() => toggleSort("createdAt")}
                        >
                          Created
                          <SortIcon keyName="createdAt" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold text-slate-700 h-10">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedUsers.map((user) => (
                      <TableRow
                        key={user.id}
                        className="border-b h-12 hover:bg-slate-50"
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8 border border-slate-200">
                              <AvatarFallback className="bg-slate-100 text-slate-700 text-xs">
                                {user.username.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm text-slate-900 leading-tight">{user.username}</p>
                              <p className="text-[10px] text-slate-500">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const raw =
                                rawUserRows.find((r) => String(r.user_id || r.id || r.username) === user.id) || {};
                              let roleName = user.role;
                              if (!roleName && raw.role_id) {
                                const found = roles.find((rr) => String(rr.id) === String(raw.role_id));
                                roleName = found?.name;
                              }
                              const display = roleName
                                ? roleName.charAt(0).toUpperCase() + roleName.slice(1)
                                : "No Role";
                              return (
                                <Badge className={`${getRoleColor(roleName || "unknown")} px-2 py-0.5 text-[10px] font-medium`}> 
                                  <div className="flex items-center gap-1">
                                    {getRoleIcon(roleName || "unknown")}
                                    {display}
                                  </div>
                                </Badge>
                              );
                            })()}
                            {user.isActive ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600">
                                <span className="h-2 w-2 rounded-full bg-rose-500" />Inactive
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 py-2">
                          {format(user.createdAt, "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell className="text-right py-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-slate-600 hover:text-slate-900"
                                  onClick={() => navigate(`/edit-user/${user.id}`)}
                                  aria-label="Edit user"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 border-t">
                <div className="text-xs text-slate-600 text-center sm:text-left">
                  Showing <span className="font-semibold">{(safePage-1)*pageSize + 1}</span>–<span className="font-semibold">{Math.min(safePage*pageSize, filteredUsers.length)}</span> of <span className="font-semibold">{filteredUsers.length}</span>
                </div>
                <div className="flex items-center justify-center sm:justify-end gap-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs text-slate-600">Rows:</Label>
                    <Select value={String(pageSize)} onValueChange={(v)=>{ setPageSize(Number(v)||8); setPage(1); }}>
                      <SelectTrigger className="w-16 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[5,8,10,20,50].map(n=> (<SelectItem key={n} value={String(n)}>{n}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={safePage<=1} onClick={()=> setPage(1)} title="First page">
                      <ChevronLeft className="h-3 w-3" />
                      <ChevronLeft className="h-3 w-3 -ml-1.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={safePage<=1} onClick={()=> setPage(p=> Math.max(1, p-1))} title="Previous page">
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <div className="px-3 py-1 text-xs font-medium border rounded-md bg-slate-50 min-w-[80px] text-center">
                      {safePage} / {totalPages}
                    </div>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={safePage>=totalPages} onClick={()=> setPage(p=> Math.min(totalPages, p+1))} title="Next page">
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={safePage>=totalPages} onClick={()=> setPage(totalPages)} title="Last page">
                      <ChevronRight className="h-3 w-3" />
                      <ChevronRight className="h-3 w-3 -ml-1.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
