import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Edit, ArrowUpDown, ChevronUp, ChevronDown, MoreVertical, FileText, CalendarDays, Eye, Receipt, Banknote, Search as SearchIcon, PartyPopper, Info, HandCoins, ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { ApiService } from "@/services/apiService";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Employee {
  id: string | number;
  name: string;
  employee_code?: string;
  department?: string;
  designation?: string;
  base_salary?: number;
  status?: number | boolean;
}

type IncentiveType = "fixed";
// Basis removed per requirement

interface IncentiveRow {
  id: string;
  service_id: string; // service to map incentive against
  type: IncentiveType;
  value: number;
}

interface MappingForm {
  employee_id: string;
  base_salary: number;
  pay_cycle: "monthly" | "weekly";
  target?: number;
  incentive?: number;
  // New: explicit per-day leave deduction amount (user-provided)
  leave_deduction_amount?: number;
}

interface MappingRecord {
  id: string;
  form: MappingForm;
  rows: IncentiveRow[];
  employee_name: string;
  employee_code?: string;
  computed_incentive?: number;
  billing_total?: number;
  line_count?: number;
  attendance_present?: number;
  attendance_half_day?: number;
  attendance_absent?: number;
  attendance_days?: number;
}

// Employee cash advances (recorded for reference; not deducted from suggested salary)
interface AdvanceEntry {
  id: string;
  employee_id: string | number;
  month: string; // YYYY-MM
  on_date: string; // YYYY-MM-DD
  amount: number;
  note?: string;
}

interface ServiceItem {
  id: string | number;
  name: string;
  service_code?: string;
  category?: string;
  price?: number;
}

const isEmployeeActive = (status: Employee["status"]) => {
  if (status === undefined || status === null) return true;
  if (typeof status === "boolean") return status;
  if (typeof status === "number") return status !== 0;
  if (typeof status === "string") {
    const normalized = status;
    if (!normalized) return true;
    if (["inactive"].includes(normalized)) {
      return false;
    }
    if (["active"].includes(normalized)) {
      return true;
    }
    return true;
  }
  return Boolean(status);
};

export default function PayrollIncentives() {
  const navigate = useNavigate();
  const { mappingId } = useParams<{ mappingId?: string }>();
  const { user } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [listMonth, setListMonth] = useState<string>(format(new Date(), "yyyy-MM"));
  // New: From and To date filters (UI-only for now)
  const monthStartEnd = (ym: string) => {
    try {
      const [y, m] = ym.split("-").map(Number);
      const start = new Date(y, (m || 1) - 1, 1);
      const end = new Date(y, m || 1, 0);
      return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
    } catch {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
    }
  };
  const _def = monthStartEnd(listMonth);
  const [fromDate, setFromDate] = useState<string>(_def.start);
  const [toDate, setToDate] = useState<string>(_def.end);
  // Triggered only when user clicks Submit; used to re-fetch data with selected range
  const [filtersTick, setFiltersTick] = useState<number>(1);

  // Apply button handler: validates range and updates the month key to trigger data reload.
  const applyFilters = () => {
    try {
      if (!fromDate || !toDate) {
        toast({ title: 'Select dates', description: 'Please select both From and To dates.', variant: 'destructive' });
        return;
      }
      if (fromDate > toDate) {
        toast({ title: 'Invalid range', description: 'From date cannot be after To date.', variant: 'destructive' });
        return;
      }
      const newYM = format(new Date(fromDate), 'yyyy-MM');
      if (newYM !== listMonth) setListMonth(newYM);
      // Re-fetch data explicitly using the selected range
      setFiltersTick((x) => x + 1);
      setPage(1);
    } catch (e: any) {
      toast({ title: 'Apply failed', description: e?.message || String(e), variant: 'destructive' });
    }
  };
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [mappings, setMappings] = useState<MappingRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Track pro-rate toggle per row id
  const [proRateById, setProRateById] = useState<Record<string, boolean>>({});
  // Store leave days per month: { 'YYYY-MM': Set<'YYYY-MM-DD'> }
  const [storeLeaves, setStoreLeaves] = useState<Record<string, Set<string>>>({});
  // Loading state for the table area (skeleton rows)
  const [tableLoading, setTableLoading] = useState<boolean>(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [leaveMonth, setLeaveMonth] = useState<string>(format(new Date(), "yyyy-MM"));
  const [leaveLoading, setLeaveLoading] = useState(false);

  // Advances state (by employee for selected month)
  const [advancesByEmp, setAdvancesByEmp] = useState<Record<string, AdvanceEntry[]>>({});
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [advanceForEmp, setAdvanceForEmp] = useState<{ id: string; name: string } | null>(null);
  const [newAdvance, setNewAdvance] = useState<{ date: string; amount: string; note: string; type: 'given' | 'received' }>({
    date: format(new Date(), "yyyy-MM-dd"),
    amount: "",
    note: "",
    type: 'given',
  });

  // Provide Salary dialog
  const [provideDialogOpen, setProvideDialogOpen] = useState(false);
  const [provideCtx, setProvideCtx] = useState<{ rec: MappingRecord; actual: number; suggested: number; custom: string } | null>(null);
  // Provided salaries map for current range
  const [providedByEmp, setProvidedByEmp] = useState<Record<string, { amount: number; id?: number }>>({});
  // Commission info dialog
  const [commissionInfo, setCommissionInfo] = useState<{ open: boolean; employee?: string; billing?: number; items?: number; commission?: number } | null>(null);
  // Helper: round to 2 decimals and return string for number input
  const round2Str = (v: number | string | null | undefined): string => {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return (Math.round(n * 100) / 100).toFixed(2);
  };
  const openProvide = (rec: MappingRecord) => {
    const actual = actualSalaryOf(rec);
    const suggested = suggestedTotalOf(rec);
    setProvideCtx({ rec, actual, suggested, custom: round2Str(suggested) });
    setProvideDialogOpen(true);
  };
  const submitProvide = async () => {
    try {
      if (!user?.account_code || !user?.retail_code || !provideCtx?.rec) return;
      const customRounded = provideCtx.custom === '' ? undefined : Number(round2Str(provideCtx.custom));
      const payload: any = {
        account_code: user.account_code,
        retail_code: user.retail_code,
        employee_id: Number(provideCtx.rec.form.employee_id),
        // use date range for salary provision
        fromdate: fromDate,
        todate: toDate,
        // keep month for backward-compatibility with older servers
        month: listMonth,
        actual_salary: provideCtx.actual,
        suggested_salary: provideCtx.suggested,
        custom_salary: customRounded,
      };
      const resp: any = await ApiService.post('/employee-salary/provide', payload);
      if (resp?.success) {
        toast({ title: 'Salary provided', description: 'Salary provision recorded successfully.' });
        // Update provided map so the UI reflects immediately
        setProvidedByEmp(prev => {
          const empKey = String(provideCtx.rec.form.employee_id);
          const copy = { ...prev };
          copy[empKey] = { amount: Number(resp.final_salary ?? provideCtx.suggested) };
          return copy;
        });
        setProvideDialogOpen(false);
      }
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  // Table UX: search, sort, pagination
  type SortKey = "employee" | "base" | "target" | "inc" | "advance" | "actual" | "suggested" | "attendance";
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "employee", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const activeEmployees = useMemo(
    () => employees.filter((emp) => isEmployeeActive(emp.status)),
    [employees]
  );

  const makeRowForService = (serviceId: string): IncentiveRow => ({
    id: crypto.randomUUID(),
    service_id: String(serviceId),
    type: "fixed",
    value: 0,
  });

  const mergeRowsWithAllServices = (existingRows: IncentiveRow[]): IncentiveRow[] => {
    const byServiceId = new Map(existingRows.map((r) => [String(r.service_id), r] as const));
    const next: IncentiveRow[] = services.map((s) => {
      const found = byServiceId.get(String(s.id));
      return found ? { ...found, type: "fixed" } : makeRowForService(String(s.id));
    });
    // Preserve any saved rows whose service no longer exists in services list
    for (const r of existingRows) {
      if (!services.some((s) => String(s.id) === String(r.service_id))) {
        next.push({ ...r, type: "fixed" });
      }
    }
    return next;
  };

  const activeMappings = useMemo(() => {
    if (!employees.length) return mappings;
    const idSet = new Set(activeEmployees.map((emp) => String(emp.id)));
    return mappings.filter((m) => idSet.has(String(m.form.employee_id)));
  }, [mappings, activeEmployees, employees.length]);

  const toggleSort = (key: SortKey) => {
    setSortBy((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: "asc" | "desc" }) => (
    <span className="inline-flex items-center ml-1 text-gray-400">
      {active ? (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : (
        <ArrowUpDown className="h-3 w-3" />
      )}
    </span>
  );

  // helpers for sorting values
  const baseSalaryOf = (m: MappingRecord) => {
    const fallback = employees.find(e => e.id.toString() === m.form.employee_id)?.base_salary ?? 0;
    return Number(m.form.base_salary ?? fallback ?? 0);
  };
  // Count working days in the selected date range (inclusive), minus store leaves within the range
  const selectedRangeWorkingDays = (): number => {
    try {
      if (!fromDate || !toDate) return daysInSelectedMonth();
      const from = new Date(fromDate + 'T00:00:00');
      const to = new Date(toDate + 'T00:00:00');
      if (isNaN(from.getTime()) || isNaN(to.getTime())) return daysInSelectedMonth();
      const diffDays = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      const leaveSet = storeLeaves[listMonth];
      if (!leaveSet || leaveSet.size === 0) return Math.max(0, diffDays);
      let inRangeLeaves = 0;
      for (const d of leaveSet) {
        if (d >= fromDate && d <= toDate) inRangeLeaves += 1;
      }
      return Math.max(0, diffDays - inRangeLeaves);
    } catch {
      return daysInSelectedMonth();
    }
  };
  const incentiveTotalOf = (m: MappingRecord) => {
    const compInc = Number(m.computed_incentive ?? 0);
    const tgt = Number(m.form.target ?? 0);
    const tgtBonus = Number(m.form.incentive ?? 0);
    const billing = Number(m.billing_total ?? 0);
    const metTarget = tgt > 0 ? billing >= tgt : false;
    return compInc + (metTarget ? tgtBonus : 0);
  };
  const advanceTotalOf = (m: MappingRecord) => {
    const list = advancesByEmp[String(m.form.employee_id)] || [];
    return list.reduce((s, a) => s + Number(a.amount || 0), 0);
  };
  // Helper: compute paid-days depending on toggle state.
  const paidDaysFor = (m: MappingRecord) => {
    const p = Number(m.attendance_present ?? 0);
    const h = Number(m.attendance_half_day ?? 0);
    const selectedDays = Number(m.attendance_days ?? (p + 0.5 * h));
    // When toggle is OFF, consider all selected days in the chosen range
    const isProRate = proRateById[m.id] !== false; // default true
    if (isProRate) return (p + 0.5 * h);
    // Use exact range length (inclusive), minus store leaves in that range
    return selectedRangeWorkingDays();
  };

  const actualSalaryOf = (m: MappingRecord) => {
    const base = baseSalaryOf(m);
    const inc = incentiveTotalOf(m);
    // Salary calculated on paid days; when toggle is OFF, treat all selected-range days as paid
    const paidDays = paidDaysFor(m);
    const monthDaysAll = daysInSelectedMonth();
    const leavesCount = (storeLeaves[listMonth]?.size ?? 0);
    const monthDays = Math.max(1, monthDaysAll - leavesCount);
    const basePortion = Math.max(0, base * (paidDays / Math.max(1, monthDays)));
    return Math.max(0, Math.round(basePortion) + inc);
  };
  const advancesBreakdown = (m: MappingRecord) => {
    const list = advancesByEmp[String(m.form.employee_id)] || [];
    let given = 0; // amounts given to employee (positive)
    let received = 0; // amounts returned by employee (negative entries recorded as positive here)
    for (const a of list) {
      const amt = Number(a.amount || 0);
      if (amt >= 0) given += amt; else received += Math.abs(amt);
    }
    return { given, received, net: given - received };
  };
  const suggestedTotalOf = (m: MappingRecord) => {
    const actual = actualSalaryOf(m);
    const adv = advancesBreakdown(m);
    // Deduct advances given, add advances received
    return Math.max(0, actual - adv.given + adv.received);
  };
  const attendanceDaysOf = (m: MappingRecord) => {
    const p = Number(m.attendance_present ?? 0);
    const h = Number(m.attendance_half_day ?? 0);
    return Number(m.attendance_days ?? (p + 0.5 * h));
  };

  // derive visible rows
  const filtered = activeMappings.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (m.employee_name || "").toLowerCase().includes(q) ||
      (m.employee_code || "").toLowerCase().includes(q)
    );
  });
  const sorted = [...filtered].sort((a, b) => {
    const dirMul = sortBy.dir === "asc" ? 1 : -1;
    const val = (key: SortKey, m: MappingRecord): any => {
      switch (key) {
        case "employee": return (m.employee_name || "").toLowerCase();
        case "base": return baseSalaryOf(m);
  // payCycle column removed from UI; sorting on it is no longer needed
        case "target": return Number(m.form.target ?? 0);
        case "inc": return incentiveTotalOf(m);
        case "advance": return advanceTotalOf(m);
        case "actual": return actualSalaryOf(m);
        case "suggested": return suggestedTotalOf(m);
        case "attendance": return attendanceDaysOf(m);
      }
    };
    const av = val(sortBy.key, a);
    const bv = val(sortBy.key, b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dirMul;
    return av.localeCompare(bv) * dirMul;
  });
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const visibleRows = sorted.slice(start, end);

  // reset page on key changes
  useEffect(() => { setPage(1); }, [search, pageSize, listMonth, activeMappings.length]);

  // Load advances for the selected range (keep month in query for compatibility)
  useEffect(() => {
    const loadAdvances = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      try {
        const q = new URLSearchParams({
          account_code: user.account_code,
          retail_code: user.retail_code,
          month: listMonth,
          fromdate: fromDate,
          todate: toDate,
        });
          const resp: any = await ApiService.get(`/employee-advance/list?${q.toString()}`);
        if (resp?.success && Array.isArray(resp.data)) {
          const byEmp: Record<string, AdvanceEntry[]> = {};
          for (const r of resp.data) {
            const entry: AdvanceEntry = {
              id: String(r.id ?? crypto.randomUUID()),
              employee_id: String(r.employee_id ?? r.emp_id ?? r.employeeId ?? ""),
              month: String(r.month ?? listMonth),
              on_date: String(r.on_date ?? r.date ?? format(new Date(), "yyyy-MM-dd")),
              amount: Number(r.amount ?? 0),
              note: r.note ?? r.remarks ?? "",
            };
            const k = String(entry.employee_id);
            if (!byEmp[k]) byEmp[k] = [];
            byEmp[k].push(entry);
          }
          setAdvancesByEmp(byEmp);
        } else {
          setAdvancesByEmp({});
        }
      } catch (e) {
        // non-blocking
      }
    };
    loadAdvances();
  }, [user, fromDate, toDate, filtersTick]);

  const openAdvance = (rec: MappingRecord) => {
    setAdvanceForEmp({ id: String(rec.form.employee_id), name: rec.employee_name });
    setNewAdvance({ date: format(new Date(), "yyyy-MM-dd"), amount: "", note: "", type: 'given' });
    setAdvanceDialogOpen(true);
  };

  // Load provided salaries for the selected range
  useEffect(() => {
    const loadProvided = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      try {
        const q = new URLSearchParams({
          account_code: user.account_code,
          retail_code: user.retail_code,
          fromdate: fromDate,
          todate: toDate,
        });
        const resp: any = await ApiService.get(`/employee-salary/provided?${q.toString()}`);
        if (resp?.success && Array.isArray(resp.data)) {
          const byEmp: Record<string, { amount: number; id?: number }> = {};
          for (const r of resp.data) {
            const emp = String(r.employee_id ?? '');
            if (!emp) continue;
            byEmp[emp] = { amount: Number(r.final_salary ?? 0), id: r.id };
          }
          setProvidedByEmp(byEmp);
        } else {
          setProvidedByEmp({});
        }
      } catch {
        setProvidedByEmp({});
      }
    };
    loadProvided();
  }, [user, fromDate, toDate, filtersTick]);

  const addAdvance = async () => {
    if (!advanceForEmp || !newAdvance.amount) return;
    try {
      const payload = {
        account_code: user?.account_code,
        retail_code: user?.retail_code,
        employee_id: Number(advanceForEmp.id),
        month: listMonth,
        date: newAdvance.date,
        amount: (newAdvance.type === 'received' ? -1 : 1) * Number(newAdvance.amount),
        note: newAdvance.note || undefined,
      };
      const resp: any = await ApiService.post('/employee-advance/add', payload);
      if (resp?.success) {
        // Refresh list
        const q = new URLSearchParams({ account_code: user!.account_code!, retail_code: user!.retail_code!, month: listMonth, fromdate: fromDate, todate: toDate });
        const listResp: any = await ApiService.get(`/employee-advance/list?${q.toString()}`);
        if (listResp?.success && Array.isArray(listResp.data)) {
          const byEmp: Record<string, AdvanceEntry[]> = {};
          for (const r of listResp.data) {
            const entry: AdvanceEntry = {
              id: String(r.id ?? crypto.randomUUID()),
              employee_id: String(r.employee_id ?? ''),
              month: String(r.month ?? listMonth),
              on_date: String(r.on_date ?? format(new Date(), 'yyyy-MM-dd')),
              amount: Number(r.amount ?? 0),
              note: r.note ?? '',
            };
            const k = String(entry.employee_id); if (!byEmp[k]) byEmp[k] = []; byEmp[k].push(entry);
          }
          setAdvancesByEmp(byEmp);
        }
        toast({ title: newAdvance.type === 'received' ? 'Advance received' : 'Advance added', description: 'Entry recorded successfully.' });
        setNewAdvance({ date: format(new Date(), 'yyyy-MM-dd'), amount: '', note: '', type: 'given' });
      }
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  const deleteAdvance = async (entry: AdvanceEntry) => {
    try {
      const q = new URLSearchParams({
        account_code: user!.account_code!,
        retail_code: user!.retail_code!,
        id: String(entry.id),
      });
      const resp: any = await ApiService.delete(`/employee-advance/delete?${q.toString()}`);
      if (resp?.success) {
        setAdvancesByEmp(prev => {
          const copy = { ...prev };
          const k = String(entry.employee_id);
          copy[k] = (copy[k] || []).filter(e => e.id !== entry.id);
          return copy;
        });
        toast({ title: 'Removed', description: 'Advance deleted.' });
      }
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  const daysInSelectedMonth = () => {
    try {
      const [y, m] = listMonth.split("-").map((v) => parseInt(v, 10));
      if (!y || !m) return 30;
      // JS: month index for Date is 0-based, and day 0 gives last day of prev month
      return new Date(y, m, 0).getDate();
    } catch {
      return 30;
    }
  };

  // Attendance details dialog state
  const [showAttendanceView, setShowAttendanceView] = useState(false);
  const [attendanceViewCtx, setAttendanceViewCtx] = useState<{
    record?: MappingRecord;
    proRate?: boolean;
  }>({});

  // -------- Reports exports --------
  const exportAllReportsExcel = () => {
    try {
      const wb = XLSX.utils.book_new();

      // 1) Payroll Summary (no pro-rate + KPIs)
      const payrollHeader = [
        "Employee","Employee Code","Base Salary","Month","Pay Cycle","Target","Manual Incentive","Billing Total","Billing Items","Computed Incentive","Target Hit","Total Incentive","Present","Half","Absent","Paid Days","Store Leaves","Advances Given","Advances Received","Actual Salary","Suggested Salary",
      ];
      const payrollRows: any[][] = [payrollHeader];
  for (const m of activeMappings) {
        const fallback = employees.find(e => e.id.toString() === m.form.employee_id)?.base_salary ?? 0;
        const base = Number(m.form.base_salary ?? fallback ?? 0);
        const compInc = Number(m.computed_incentive ?? 0);
        const tgt = Number(m.form.target ?? 0);
        const bonus = Number(m.form.incentive ?? 0);
        const billing = Number(m.billing_total ?? 0);
        const items = Number(m.line_count ?? 0);
        const hit = tgt > 0 && billing >= tgt;
        const totalInc = compInc + (hit ? bonus : 0);
  const p = Number(m.attendance_present ?? 0);
  const h = Number(m.attendance_half_day ?? 0);
  const a = Number(m.attendance_absent ?? 0);
  const paid = paidDaysFor(m);
        const monthDaysAll = daysInSelectedMonth();
        const leaveCount = storeLeaves[listMonth]?.size ?? 0;
        const monthDays = Math.max(1, monthDaysAll - leaveCount);
        // Salary based on percentage of paid days worked
        const basePortion = Math.max(0, base * (paid / Math.max(1, monthDays)));
        const actual = Math.max(0, Math.round(basePortion) + totalInc);
        const advList = advancesByEmp[String(m.form.employee_id)] || [];
        const advGiven = advList.filter(a=>Number(a.amount||0)>=0).reduce((s,a)=> s + Number(a.amount||0),0);
        const advReceived = advList.filter(a=>Number(a.amount||0)<0).reduce((s,a)=> s + Math.abs(Number(a.amount||0)),0);
        const suggestedFinal = Math.max(0, actual - advGiven + advReceived);
        payrollRows.push([
          m.employee_name,
          m.employee_code || "",
          base,
          listMonth,
          m.form.pay_cycle,
          tgt,
          bonus,
          billing,
          items,
          compInc,
          hit ? "Yes" : "No",
          totalInc,
          p,
          h,
          a,
          paid,
          leaveCount,
          advGiven,
          advReceived,
          actual,
          suggestedFinal,
        ]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payrollRows), "Payroll Summary");

      // 2) Suggested Salary (pro-rated)
      const sugHeader = [
        "Employee","Employee Code","Base Salary","Pro-Rate?","Paid Days","Work Days","Leave Deduction/Day","Base Portion","Computed Incentive","Manual Incentive (if hit)","Target Hit","Advances Given","Advances Received","Actual (before advances)","Suggested (after advances)",
      ];
      const sugRows: any[][] = [sugHeader];
  for (const m of activeMappings) {
        const fallback = employees.find(e => e.id.toString() === m.form.employee_id)?.base_salary ?? 0;
        const base = Number(m.form.base_salary ?? fallback ?? 0);
        const compInc = Number(m.computed_incentive ?? 0);
        const tgt = Number(m.form.target ?? 0);
        const bonus = Number(m.form.incentive ?? 0);
        const billing = Number(m.billing_total ?? 0);
        const hit = tgt > 0 ? billing >= tgt : false;
        const inc = compInc + (hit ? bonus : 0);
  const p = Number(m.attendance_present ?? 0);
  const hh = Number(m.attendance_half_day ?? 0);
  const selectedDays = Number(m.attendance_days ?? (p + 0.5 * hh));
  const isProRate = (proRateById[m.id] !== false);
  const paidDays = isProRate ? (p + 0.5 * hh) : selectedDays;
        const monthDaysAll = daysInSelectedMonth();
        const leavesCount = (storeLeaves[listMonth]?.size ?? 0);
        const monthDays = Math.max(1, monthDaysAll - leavesCount);
        const leavePerDay = Number((m.form as any)?.leave_deduction_amount ?? 0);
        // Salary based on percentage of paid days worked
        const basePortion = Math.max(0, base * (paidDays / Math.max(1, monthDays)));
        const actual = Math.max(0, Math.round(basePortion) + inc);
        const advList = advancesByEmp[String(m.form.employee_id)] || [];
        const advGiven = advList.filter(a=>Number(a.amount||0)>=0).reduce((s,a)=> s + Number(a.amount||0),0);
        const advReceived = advList.filter(a=>Number(a.amount||0)<0).reduce((s,a)=> s + Math.abs(Number(a.amount||0)),0);
        const suggested = Math.max(0, actual - advGiven + advReceived);
        sugRows.push([
          m.employee_name,
          m.employee_code || "",
          base,
          isProRate ? "Yes" : "No",
          paidDays,
          monthDays,
          leavePerDay || 0,
          Math.round(basePortion),
          compInc,
          hit ? bonus : 0,
          hit ? "Yes" : "No",
          advGiven,
          advReceived,
          actual,
          suggested,
        ]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sugRows), "Suggested Salary");

      // 3) Attendance Summary
      const attHeader = ["Employee","Employee Code","Present","Half","Absent","Paid Days","Store Leaves","Month"]; 
      const attRows: any[][] = [attHeader];
      const leaveCountGlobal = storeLeaves[listMonth]?.size ?? 0;
  for (const m of activeMappings) {
  const p = Number(m.attendance_present ?? 0);
  const h = Number(m.attendance_half_day ?? 0);
  const a = Number(m.attendance_absent ?? 0);
  const paid = paidDaysFor(m);
        attRows.push([m.employee_name, m.employee_code || "", p, h, a, paid, leaveCountGlobal, listMonth]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(attRows), "Attendance");

      // 4) Incentive Mapping
      const incHeader = ["Employee","Employee Code","Month","Service Id","Type","Value"]; 
      const incRows: any[][] = [incHeader];
  for (const m of activeMappings) {
        const list = m.rows && m.rows.length ? m.rows : [];
        if (list.length === 0) {
          incRows.push([m.employee_name, m.employee_code || "", listMonth, "", "", ""]);
          continue;
        }
        for (const r of list) {
          incRows.push([m.employee_name, m.employee_code || "", listMonth, r.service_id, r.type, r.value]);
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incRows), "Incentive Mapping");

      // 5) Advances Detail
      const advHeader = ["Employee","Employee Code","Date","Amount","Note"]; 
      const advRows: any[][] = [advHeader];
  for (const m of activeMappings) {
        const empId = String(m.form.employee_id);
        const list = advancesByEmp[empId] || [];
        if (list.length === 0) {
          advRows.push([m.employee_name, m.employee_code || "", "", 0, ""]);
          continue;
        }
        for (const a of list) {
          advRows.push([m.employee_name, m.employee_code || "", a.on_date, Number(a.amount||0), a.note || ""]);
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(advRows), "Advances");

      XLSX.writeFile(wb, `payroll-reports-${listMonth}.xlsx`);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || String(e), variant: "destructive" });
    }
  };
  const exportPayrollSummaryCSV = () => {
    try {
      const header = [
        "Employee",
        "Employee Code",
        "Base Salary",
        "Month",
        "Pay Cycle",
        "Target",
        "Manual Incentive",
        "Billing Total",
        "Billing Items",
        "Computed Incentive",
        "Target Hit",
        "Total Incentive",
        "Present",
        "Half",
        "Absent",
        "Paid Days",
        "Store Leaves",
        "Advances Given",
        "Advances Received",
        "Actual Salary",
        "Suggested Salary",
      ];
      const rows: (string | number)[][] = [header];
  for (const m of activeMappings) {
        const fallback = employees.find(e => e.id.toString() === m.form.employee_id)?.base_salary ?? 0;
        const base = Number(m.form.base_salary ?? fallback ?? 0);
        const compInc = Number(m.computed_incentive ?? 0);
        const tgt = Number(m.form.target ?? 0);
        const bonus = Number(m.form.incentive ?? 0);
        const billing = Number(m.billing_total ?? 0);
        const items = Number(m.line_count ?? 0);
        const hit = tgt > 0 && billing >= tgt;
        const totalInc = compInc + (hit ? bonus : 0);
  const p = Number(m.attendance_present ?? 0);
  const h = Number(m.attendance_half_day ?? 0);
  const a = Number(m.attendance_absent ?? 0);
  const paid = paidDaysFor(m);
        const monthDaysAll = daysInSelectedMonth();
        const leaveCount = storeLeaves[listMonth]?.size ?? 0;
        const monthDays = Math.max(1, monthDaysAll - leaveCount);
        const basePortion = Math.max(0, base * (paid / Math.max(1, monthDays)));
        const actual = Math.max(0, Math.round(basePortion) + totalInc);
        const advList = advancesByEmp[String(m.form.employee_id)] || [];
        const advGiven = advList.filter(a=>Number(a.amount||0)>=0).reduce((s,a)=> s + Number(a.amount||0),0);
        const advReceived = advList.filter(a=>Number(a.amount||0)<0).reduce((s,a)=> s + Math.abs(Number(a.amount||0)),0);
        const suggested = Math.max(0, actual - advGiven + advReceived);
        rows.push([
          m.employee_name,
          m.employee_code || "",
          base,
          listMonth,
          m.form.pay_cycle,
          tgt,
          bonus,
          billing,
          items,
          compInc,
          hit ? "Yes" : "No",
          totalInc,
          p,
          h,
          a,
          paid,
          leaveCount,
          advGiven,
          advReceived,
          actual,
          suggested,
        ]);
      }
      const csv = toCSV(rows);
      download(`payroll-summary-${listMonth}.csv`, csv);
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    }
  };

  const exportAttendanceSummaryCSV = () => {
    try {
  const header = ["Employee", "Employee Code", "Present", "Half", "Absent", "Paid Days", "Store Leaves", "Month"];
      const rows: (string | number)[][] = [header];
      const leaveCount = storeLeaves[listMonth]?.size ?? 0;
  for (const m of activeMappings) {
        const p = Number(m.attendance_present ?? 0);
        const h = Number(m.attendance_half_day ?? 0);
        const a = Number(m.attendance_absent ?? 0);
        const paid = p + 0.5 * h;
        rows.push([m.employee_name, m.employee_code || "", p, h, a, paid, leaveCount, listMonth]);
      }
      const csv = toCSV(rows);
      download(`attendance-summary-${listMonth}.csv`, csv);
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    }
  };

  const exportIncentiveMappingCSV = () => {
    try {
      const header = ["Employee", "Employee Code", "Month", "Service Id", "Type", "Value"];
      const rows: (string | number)[][] = [header];
  for (const m of activeMappings) {
        const list = m.rows && m.rows.length ? m.rows : [];
        if (list.length === 0) {
          rows.push([m.employee_name, m.employee_code || "", listMonth, "", "", ""]);
          continue;
        }
        for (const r of list) {
          rows.push([
            m.employee_name,
            m.employee_code || "",
            listMonth,
            r.service_id,
            r.type,
            r.value,
          ]);
        }
      }
      const csv = toCSV(rows);
      download(`incentive-mapping-${listMonth}.csv`, csv);
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    }
  };

  // Generate a printable payslip for a specific employee mapping record
  const generatePayslip = (rec: MappingRecord) => {
    try {
  const month = listMonth;
      const present = Number((rec as any).attendance_present_day ?? (rec as any).attendance_present ?? 0);
      const half = Number((rec as any).attendance_half_day ?? 0);
      const absent = Number((rec as any).attendance_absent ?? 0);
      const paidDays = present + 0.5 * half;

      const leaveCount = (storeLeaves[month]?.size ?? 0);
      const [y, m] = month.split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const denom = Math.max(1, daysInMonth - leaveCount);

      const baseSalary = Number(baseSalaryOf(rec) || 0);
      const leavePerDay = Number((rec.form as any)?.leave_deduction_amount || 0);
      const proRate = (proRateById[rec.id] !== false);
      let basePortion = baseSalary;
      let perDay = 0;
      if (proRate) {
        if (leavePerDay > 0) {
          const unpaidDays = Math.max(0, denom - paidDays);
          basePortion = Math.max(0, baseSalary - leavePerDay * unpaidDays);
          perDay = leavePerDay;
        } else {
          basePortion = baseSalary * (paidDays / Math.max(1, denom));
        }
      }

      const billingTotal = Number((rec as any).billing_total || 0);
      const computedIncentive = Number((rec as any).computed_incentive || 0);
      const target = Number(rec.form?.target || 0);
      const incentiveBonus = Number(rec.form?.incentive || 0);
      const targetHit = target > 0 ? billingTotal >= target : false;
      const totalIncentive = computedIncentive + (targetHit ? incentiveBonus : 0);
  // Employee advances for the month (informational only; NOT deducted from pay)
  const advances = (advancesByEmp[String(rec.form.employee_id)] || []).reduce((s, a) => s + Number((a as any).amount || 0), 0);
  const grossPay = Math.round(basePortion) + totalIncentive;
  // Per policy: Do not deduct advances from net pay
  const finalSalary = Math.max(0, grossPay);

      const storeLeaveList = Array.from(storeLeaves[month] || []).sort();
      const issuedOn = new Date().toLocaleDateString();

      // Derive company name from user or stored session info
      const deriveCompanyName = (): string => {
        try {
          // Highest priority: retail_master stored in localStorage by backend bootstrap
          const retailMasterRaw = localStorage.getItem('retail_master');
          if (retailMasterRaw) {
            try {
              const rm = JSON.parse(retailMasterRaw);
              const fromRM = rm?.RetailName || rm?.retail_name || rm?.retailName;
              if (fromRM) return String(fromRM);
            } catch {}
          }
          // Also check sessionStorage (as in your screenshot)
          const retailMasterSession = sessionStorage.getItem('retail_master');
          if (retailMasterSession) {
            try {
              const rms = JSON.parse(retailMasterSession);
              const fromRMS = rms?.RetailName || rms?.retail_name || rms?.retailName;
              if (fromRMS) return String(fromRMS);
            } catch {}
          }
          // Prefer enriched user fields if present
          const u: any = user as any;
          const fromUser = (u?.company_name || u?.org_name || u?.RetailName || u?.retail_name || u?.retailName);
          if (fromUser) return String(fromUser);
          // Fallback to persisted auth user object
          const raw = localStorage.getItem('auth_user');
          if (raw) {
            const ju = JSON.parse(raw);
            const fromStored = (ju?.company_name || ju?.org_name || ju?.RetailName || ju?.retail_name || ju?.retailName);
            if (fromStored) return String(fromStored);
          }
        } catch {}
        // If not found, do not show retail code—return empty so header omits codes
        return '';
      };
      const companyName = deriveCompanyName();

      const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Payslip - ${rec.employee_name || ''} - ${month}</title>
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;font-size:12px}
          .container{max-width:750px;margin:10px auto;background:#fff;border:1px solid #000}
          .header{background:#000;color:#fff;padding:12px;display:flex;justify-content:space-between;align-items:center}
          .company-info h1{font-size:18px;font-weight:700;margin-bottom:2px}
          .company-info p{font-size:11px}
          .payslip-meta{ text-align:right }
          .payslip-meta .period{font-size:11px}
          .section{padding:10px}
          .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
          .info h3{font-size:10px;text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px;font-weight:600;color:#000}
          .info .value{font-size:13px;font-weight:600;color:#000}
          table{width:100%;border-collapse:collapse;margin-top:8px}
          th{background:#f5f5f5;color:#000;font-weight:600;font-size:10px;text-transform:uppercase;border:1px solid #000}
          th,td{padding:6px 8px;text-align:left;border:1px solid #000}
          td.amount{text-align:right;font-weight:600}
          .total-row{background:#e8e8e8;font-weight:700}
          .net-pay{background:#d8d8d8;color:#000;font-size:13px;font-weight:700}
          .footer{padding:8px 10px;border-top:1px solid #000;background:#f8f8f8;text-align:center}
          .footer-text{font-size:10px;color:#000;margin-bottom:4px}
          .print-btn{background:#000;color:#fff;border:1px solid #000;padding:6px 12px;font-size:11px;cursor:pointer}
          .print-btn:hover{background:#333}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="company-info">
              <h1>${companyName || 'Payslip'}</h1>
              ${companyName ? `<p>Employee Payroll</p>` : ''}
            </div>
            <div class="payslip-meta">
              <div class="period">Pay Period: ${month}</div>
              <div class="period">Generated: ${issuedOn}</div>
            </div>
          </div>

          <div class="section">
            <div class="grid-2">
              <div class="info">
                <h3>Employee Information</h3>
                <div class="value">${rec.employee_name || 'N/A'}</div>
                <div style="font-size:11px;color:#000;margin-top:1px;">ID: ${rec.form?.employee_id || 'N/A'}</div>
              </div>
              <div class="info">
                <h3>Employment Details</h3>
                <div class="value" style="text-transform:capitalize;">${rec.form?.pay_cycle || 'Monthly'} Employee</div>
                <div style="font-size:11px;color:#000;margin-top:1px;">Working Days: ${denom} (Leaves: ${leaveCount})</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title" style="font-size:13px;font-weight:600;color:#000;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #000;">Earnings</div>
            <table>
              <thead>
                <tr><th>Description</th><th>Amount</th></tr>
              </thead>
              <tbody>
                ${proRate ? `<tr>
                  <td>Base Pay (${perDay > 0 ? `₹${perDay.toLocaleString()}/day deduction × ${Math.max(0, denom - paidDays)} unpaid days` : `${paidDays}/${denom} working days`})</td>
                  <td class="amount">${Math.round(basePortion).toLocaleString()}</td>
                </tr>` : `<tr><td>Base Pay</td><td class="amount">${Math.round(basePortion).toLocaleString()}</td></tr>`}
                <tr>
                  <td>Commission from Billing <div style="font-size:9px;color:#000;margin-top:1px;">Billing total: ₹${billingTotal.toLocaleString()}</div></td>
                  <td class="amount">${computedIncentive.toLocaleString()}</td>
                </tr>
                ${target > 0 ? `<tr>
                  <td>Target Incentive <div style="font-size:9px;color:#000;margin-top:1px;">Target ₹${target.toLocaleString()} - ${targetHit ? 'Achieved' : 'Not Achieved'}</div></td>
                  <td class="amount">${targetHit ? incentiveBonus.toLocaleString() : '0'}</td>
                </tr>` : ''}
                <tr class="total-row"><td><strong>Gross Pay</strong></td><td class="amount"><strong>₹${grossPay.toLocaleString()}</strong></td></tr>
                <tr><td>Advances (informational; not deducted)</td><td class="amount">${advances.toLocaleString()}</td></tr>
                <tr class="net-pay"><td><strong>NET PAY</strong></td><td class="amount"><strong>₹${finalSalary.toLocaleString()}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div class="section" style="background:#f8f8f8;">
            <div class="grid-2">
              <div>
                <h4 style="color:#000;font-size:10px;text-transform:uppercase;margin-bottom:4px;font-weight:600;">Attendance Summary</h4>
                <div style="font-size:11px;color:#000;">Total Paid Days: <strong>${paidDays}</strong></div>
              </div>
              <div>
                <h4 style="color:#000;font-size:10px;text-transform:uppercase;margin-bottom:4px;font-weight:600;">Performance Summary</h4>
                <div style="font-size:11px;color:#000;">Billing Total: <strong>₹${billingTotal.toLocaleString()}</strong><br/>Commission: <strong>Variable</strong><br/>${storeLeaveList.length ? `Store Holidays: <strong>${storeLeaveList.length} days</strong>` : 'No Store Holidays'}</div>
              </div>
            </div>
            ${storeLeaveList.length ? `<div style="margin-top:16px;padding:12px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:6px;">
              <div style="font-size:12px;color:#856404;font-weight:600;margin-bottom:4px;">Store Holiday Dates:</div>
              <div style="font-size:12px;color:#856404;">${storeLeaveList.join(', ')}</div>
            </div>` : ''}
          </div>

          <div class="footer">
            <div class="footer-text">This is a computer-generated payslip and does not require a signature.</div>
            <div class="no-print" style="margin-top:6px;">
              <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
            </div>
          </div>
        </div>
      </body>
      </html>`;

      // Open in new tab via Blob URL
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);

    } catch (e) {
      console.error('Payslip generation failed', e);
    }
  };

  // Load store leaves for the selected range (keep month for compatibility and local caching)
  useEffect(() => {
    const loadLeaves = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      try {
        const q = new URLSearchParams({
          account_code: user.account_code,
          retail_code: user.retail_code,
          month: listMonth,
          fromdate: fromDate,
          todate: toDate,
        });
        const resp: any = await ApiService.get(`/store-leaves/list?${q.toString()}`);
        if (resp?.success) {
          const set = new Set<string>((resp.data || []) as string[]);
          setStoreLeaves((prev) => ({ ...prev, [listMonth]: set }));
        }
      } catch (e) {
        // non-blocking
      }
    };
    loadLeaves();
  }, [user, fromDate, toDate, filtersTick]);
    const [form, setForm] = useState<MappingForm>({
      employee_id: "",
      base_salary: 0,
      pay_cycle: "monthly",
    });
    const [rows, setRows] = useState<IncentiveRow[]>([]);

    // Load employees, services, and existing incentive mappings from backend
    useEffect(() => {
      const loadEmployees = async () => {
        if (!user?.account_code || !user?.retail_code) return;
        setIsLoading(true);
        try {
          // Single batched read for both employees and services
          const resp: any = await ApiService.post("/read", {
            account_code: user.account_code,
            retail_code: user.retail_code,
            tables: ["master_employee", "master_service"],
          });
          if (resp?.success) {
            const raw = resp.data;
            // Employees
            const empList = Array.isArray(raw)
              ? raw
              : (raw?.master_employee || raw?.employee || []);
            const mappedEmp: Employee[] = (empList as any[]).map((e: any) => ({
              id: e.employee_id || e.id,
              name: e.employee_name || e.name || "Unknown",
              employee_code: e.employee_code,
              department: e.department,
              designation: e.designation,
              base_salary: Number((e.base_salary ?? e.BaseSalary ?? 0) || 0),
              status: e.status ?? e.STATUS ?? e.employee_status ?? e.is_active ?? e.active ?? e.isActive,
            }));
            setEmployees(mappedEmp);

            // Services
            const svcList = Array.isArray(raw)
              ? []
              : (raw?.master_service || raw?.service || []);
            const mappedSvc: ServiceItem[] = (svcList as any[]).map((s: any) => ({
              id: s.service_id || s.id,
              name: s.service_name || s.name || "Unknown",
              service_code: s.service_code,
              category: s.category_name || s.category,
              price: (() => {
                const v =
                  s.service_price ??
                  s.price ??
                  s.rate ??
                  s.amount ??
                  s.service_rate ??
                  s.service_amount ??
                  s.selling_price ??
                  s.sale_price ??
                  s.mrp;
                const n = Number(v);
                return Number.isFinite(n) ? n : undefined;
              })(),
            }));
            setServices(mappedSvc);
          }

          // Load existing incentive mappings
          try {
            setTableLoading(true);
            const q = new URLSearchParams({
              account_code: user.account_code,
              retail_code: user.retail_code,
              effective_from: listMonth,
            });
            // Pass through date range if selected; backend may accept these optionally
            if (fromDate) q.set('fromdate', fromDate);
            if (toDate) q.set('todate', toDate);
            const listResp: any = await ApiService.get(`/employee-incentives/list?${q.toString()}`);
            if (listResp?.success && Array.isArray(listResp.data)) {
              const mapped: MappingRecord[] = listResp.data.map((g: any) => ({
                id: `${g.employee_id}`,
                employee_name: g.employee_name || "",
                employee_code: g.employee_code,
                form: {
                  employee_id: String(g.employee_id),
                  base_salary: Number(g.base_salary ?? 0),
                  pay_cycle: ((g.pay_cycle || '').toString().toLowerCase() === 'weekly' ? 'weekly' : 'monthly') as MappingForm['pay_cycle'],
                  target: g.target != null ? Number(g.target) : undefined,
                  incentive: g.incentive != null ? Number(g.incentive) : undefined,
                  leave_deduction_amount: g.leave_deduction_amount != null ? Number(g.leave_deduction_amount) : undefined,
                },
                rows: (g.incentives || []).map((r: any) => ({
                  id: String(r.id ?? crypto.randomUUID()),
                  service_id: String(r.service_id),
                  type: "fixed" as IncentiveType,
                  value: Number(r.value || 0),
                })),
                computed_incentive: Number(g.incentive_total ?? 0),
                billing_total: Number(g.billing_total ?? 0),
                line_count: Number(g.line_count ?? 0),
                attendance_present: Number(g.attendance_present ?? 0),
                attendance_half_day: Number(g.attendance_half_day ?? 0),
                attendance_absent: Number(g.attendance_absent ?? 0),
                attendance_days: Number(g.attendance_days ?? 0),
              }));
              setMappings(mapped);
            }
          } catch (e) {
            console.warn("Failed loading mappings", e);
          } finally {
            setTableLoading(false);
          }
        } catch (err) {
          console.error("Failed to load employees", err);
          toast({ title: "Error", description: "Failed to load employees", variant: "destructive" });
        } finally {
          setIsLoading(false);
        }
     };
     loadEmployees();
   }, [user, listMonth, fromDate, toDate, filtersTick]);

  const makeDefaultRow = (): IncentiveRow => ({ id: crypto.randomUUID(), service_id: "", type: "fixed", value: 0 });

    const addRow = () => {
      setRows(prev => [
        ...prev,
        makeDefaultRow(),
      ]);
    };

    const updateRow = (id: string, patch: Partial<IncentiveRow>) => {
      setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    };

    const removeRow = (id: string) => {
      setRows(prev => prev.filter(r => r.id !== id));
    };

    const saveMapping = async () => {
      if (!form.employee_id) {
        toast({ title: "Select employee", description: "Please choose an employee to map.", variant: "destructive" });
        return;
      }
      if (Number(form.incentive || 0) > Number(form.target || 0)) {
        toast({ title: "Invalid incentive", description: "Incentive cannot be greater than Target.", variant: "destructive" });
        return;
      }
      try {
        const payload = {
          account_code: user?.account_code,
          retail_code: user?.retail_code,
          employee_id: Number(form.employee_id),
          base_salary: Number(form.base_salary || 0),
          // Backend model requires effective_from (string). Use current listMonth for compatibility.
          effective_from: listMonth,
          pay_cycle: form.pay_cycle,
          target: form.target ?? 0,
          incentive: form.incentive ?? 0,
          leave_deduction_amount: Number(form.leave_deduction_amount ?? 0),
          incentives: rows.map(r => ({
            service_id: Number(r.service_id),
            incentive_type: "fixed" as IncentiveType,
            value: Number(r.value || 0),
          })),
        };
        const resp: any = await ApiService.post("/employee-incentives/save-mapping", payload);
        if (resp?.success) {
          // Optimistically refresh list
          const q = new URLSearchParams({ account_code: user!.account_code!, retail_code: user!.retail_code!, effective_from: listMonth });
          if (fromDate) q.set('fromdate', fromDate);
          if (toDate) q.set('todate', toDate);
          setTableLoading(true);
          const listResp: any = await ApiService.get(`/employee-incentives/list?${q.toString()}`);
          if (listResp?.success && Array.isArray(listResp.data)) {
            const mapped: MappingRecord[] = listResp.data.map((g: any) => ({
              id: `${g.employee_id}`,
              employee_name: g.employee_name || "",
              employee_code: g.employee_code,
              form: {
                employee_id: String(g.employee_id),
                base_salary: Number(g.base_salary ?? 0),
                pay_cycle: ((g.pay_cycle || '').toString().toLowerCase() === 'weekly' ? 'weekly' : 'monthly') as MappingForm['pay_cycle'],
                  target: g.target != null ? Number(g.target) : undefined,
                  incentive: g.incentive != null ? Number(g.incentive) : undefined,
                  leave_deduction_amount: g.leave_deduction_amount != null ? Number(g.leave_deduction_amount) : undefined,
              },
              rows: (g.incentives || []).map((r: any) => ({
                id: String(r.id ?? crypto.randomUUID()),
                service_id: String(r.service_id),
                type: "fixed" as IncentiveType,
                value: Number(r.value || 0),
              })),
              computed_incentive: Number(g.incentive_total ?? 0),
              billing_total: Number(g.billing_total ?? 0),
              line_count: Number(g.line_count ?? 0),
              attendance_present: Number(g.attendance_present ?? 0),
              attendance_half_day: Number(g.attendance_half_day ?? 0),
              attendance_absent: Number(g.attendance_absent ?? 0),
              attendance_days: Number(g.attendance_days ?? 0),
            }));
            setMappings(mapped);
          }
          setTableLoading(false);
          toast({ title: editingId ? "Updated" : "Saved", description: "Payroll mapping saved." });
          setEditingId(null);
          if (typeof mappingId === "string" && mappingId.length > 0) {
            navigate("/staff-management/payroll-incentives");
          }
        }
      } catch (e: any) {
        toast({ title: "Save failed", description: e?.message || String(e), variant: "destructive" });
      }
    };

    const openAdd = () => {
      navigate("/staff-management/payroll-incentives/mapping/new");
    };

    const openEdit = (rec: MappingRecord) => {
      navigate(`/staff-management/payroll-incentives/mapping/${encodeURIComponent(String(rec.id))}`);
    };

    const isMappingPage = typeof mappingId === "string" && mappingId.length > 0;
    const [mappingInitFor, setMappingInitFor] = useState<string | null>(null);
    const [rowsMergedFor, setRowsMergedFor] = useState<string | null>(null);

    const resetForNewMapping = () => {
      setEditingId(null);
      setForm({
        employee_id: "",
        base_salary: 0,
        pay_cycle: "monthly",
        target: 0,
        incentive: 0,
        leave_deduction_amount: 0,
      });
      // Pre-map ALL services with default commission value 0
      setRows(services.length ? services.map((s) => makeRowForService(String(s.id))) : []);
    };

    const loadForEditMapping = (rec: MappingRecord) => {
      setEditingId(rec.id);
      setForm({ ...rec.form });
      const existing = rec.rows.map((r) => ({ ...r }));
      // Keep saved values but ensure every service has a row
      setRows(services.length ? mergeRowsWithAllServices(existing) : existing);
    };

    useEffect(() => {
      if (!isMappingPage) setMappingInitFor(null);
    }, [isMappingPage]);

    useEffect(() => {
      if (!isMappingPage || !mappingId) return;
      if (mappingInitFor === mappingId) return;

      if (mappingId === "new") {
        resetForNewMapping();
        setMappingInitFor(mappingId);
        return;
      }

      const rec = mappings.find((m) => String(m.id) === String(mappingId));
      if (rec) {
        loadForEditMapping(rec);
        setMappingInitFor(mappingId);
      }
    }, [isMappingPage, mappingId, mappingInitFor, mappings]);

    // If services arrive after initial load (or user navigates directly), ensure rows are pre-mapped once.
    useEffect(() => {
      if (!isMappingPage || !mappingId) return;
      if (!services.length) return;
      if (rowsMergedFor === mappingId) return;

      if (mappingId === "new") {
        // Only auto-fill if empty (avoid stomping user edits)
        setRows((prev) => (prev.length ? prev : services.map((s) => makeRowForService(String(s.id)))));
        setRowsMergedFor(mappingId);
        return;
      }

      // For edit: merge existing rows with any missing services, preserving current values
      setRows((prev) => mergeRowsWithAllServices(prev));
      setRowsMergedFor(mappingId);
    }, [isMappingPage, mappingId, rowsMergedFor, services]);

    const deleteRec = async (id: string) => {
      try {
        const rec = mappings.find(m => m.id === id);
        if (!rec) return;
        const q = new URLSearchParams({
          account_code: user!.account_code!,
          retail_code: user!.retail_code!,
          employee_id: String(rec.form.employee_id),
          pay_cycle: rec.form.pay_cycle,
        });
        const delResp: any = await ApiService.delete(`/employee-incentives/delete?${q.toString()}`);
        if (delResp?.success) {
          setMappings(prev => prev.filter(m => m.id !== id));
          toast({ title: "Deleted", description: "Mapping removed." });
        }
      } catch (e: any) {
        toast({ title: "Delete failed", description: e?.message || String(e), variant: "destructive" });
      }
    };

    if (isMappingPage) {
      const mappingReady = services.length > 0 && (mappingId === "new" || mappingInitFor === mappingId);
      return (
        <div className="min-h-screen space-y-2 md:space-y-3">

          <div className="w-full text-xs">
            <div className="bg-gradient-to-r from-slate-900 via-indigo-800 to-indigo-600 text-white p-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-[11px] text-white/70">Payroll configuration</div>
                  <div className="text-left text-sm text-white font-semibold">
                    {editingId ? "Edit Payroll Mapping" : "Create Payroll Mapping"}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button variant="secondary" onClick={addRow} className="h-7 px-2 text-xs" disabled={!mappingReady}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Commission
                  </Button>
                  <Button
                    onClick={saveMapping}
                    className="bg-white text-slate-900 hover:bg-white/90 h-7 px-2 text-xs"
                    disabled={!mappingReady}
                  >
                    Save Mapping
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/staff-management/payroll-incentives")}
                    className="h-7 px-2 flex items-center gap-2 text-xs bg-white text-slate-900 hover:bg-white/90"
                    title="Back to Payroll & Incentives"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </Button>
                </div>
              </div>
            </div>

            {!mappingReady ? (
              <div className="p-2 text-xs text-gray-600">Loading mapping…</div>
            ) : (
              <div className="p-2 sm:p-2 lg:p-3 space-y-2">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                  <Card className="lg:col-span-7 shadow-sm border-slate-200">
                    <CardHeader className="px-4 py-3 pb-2">
                      <CardTitle className="text-sm">Payroll Details</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Employee</Label>
                          <Select
                            value={form.employee_id}
                            onValueChange={(v) => setForm((p) => ({ ...p, employee_id: v }))}
                            disabled={Boolean(editingId)}
                          >
                            <SelectTrigger className="h-8 text-xs" disabled={Boolean(editingId)}>
                              <SelectValue placeholder={isLoading ? "Loading..." : "Select employee"} />
                            </SelectTrigger>
                            <SelectContent>
                              {activeEmployees.map((e) => (
                                <SelectItem key={e.id} value={String(e.id)}>
                                  {e.name} {e.employee_code ? `(${e.employee_code})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Base Salary</Label>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            value={form.base_salary ?? ""}
                            onChange={(e) => setForm((p) => ({ ...p, base_salary: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="0"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Pay Cycle</Label>
                          <Select value={form.pay_cycle} onValueChange={(v: MappingForm['pay_cycle']) => setForm((p) => ({ ...p, pay_cycle: v }))}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="weekly">Weekly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Leave Deduction / Day</Label>
                          {(() => {
                            const effMonth = listMonth;
                            let workingDays = 30;
                            try {
                              const [yy, mm] = effMonth.split('-').map((v) => parseInt(v, 10));
                              if (yy && mm) {
                                const monthDays = new Date(yy, mm, 0).getDate();
                                const leaveCount = storeLeaves[effMonth]?.size ?? 0;
                                workingDays = Math.max(1, monthDays - leaveCount);
                              }
                            } catch {}
                            const fallback = employees.find(e => e.id.toString() === form.employee_id)?.base_salary ?? 0;
                            const base = Number(form.base_salary ?? fallback ?? 0);
                            const perDay = Math.round(base / Math.max(1, workingDays));
                            return (
                              <div className="space-y-1">
                                <Input
                                  className="h-8 text-xs"
                                  type="number"
                                  min={0}
                                  value={form.leave_deduction_amount ?? ''}
                                  onChange={(e) => setForm((p) => ({ ...p, leave_deduction_amount: e.target.value === '' ? undefined : Number(e.target.value) }))}
                                  onBlur={(e) => setForm((p) => ({ ...p, leave_deduction_amount: e.target.value === '' ? 0 : Number(e.target.value) }))}
                                  placeholder={perDay ? String(perDay) : '0'}
                                />
                                <div className="text-[11px] text-muted-foreground">
                                  Default: ₹{perDay.toLocaleString()}
                                  {workingDays ? ` (working days: ${workingDays})` : ''}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-5 shadow-sm border-slate-200">
                    <CardHeader className="px-4 py-3 pb-2">
                      <CardTitle className="text-sm">Target & Incentive</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 space-y-2">
                      <div className="space-y-2">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Target</Label>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            value={form.target ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? undefined : Number(e.target.value);
                              setForm((p) => ({ ...p, target: val }));
                            }}
                            onBlur={(e) => {
                              const n = e.target.value === '' ? 0 : Number(e.target.value);
                              setForm((p) => ({ ...p, target: n, incentive: Math.min(Number(p.incentive || 0), n) }));
                            }}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Manual Incentive (if target hit)</Label>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            value={form.incentive ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? undefined : Number(e.target.value);
                              setForm((p) => ({ ...p, incentive: val }));
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value === '' ? 0 : Number(e.target.value);
                              const cap = Number(form.target || 0);
                              const val = cap > 0 ? Math.min(raw, cap) : raw;
                              setForm((p) => ({ ...p, incentive: val }));
                            }}
                            placeholder="0"
                          />
                          {Number(form.incentive || 0) > Number(form.target || 0) && (
                            <div className="text-[11px] text-red-600">Incentive cannot exceed Target</div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="shadow-sm border-slate-200">
                  <CardHeader className="px-4 py-3 pb-2">
                    <CardTitle className="text-sm">Commission Mapping</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <PreviewIncentiveTable
                      rows={rows}
                      services={services}
                      updateRow={updateRow}
                      removeRow={removeRow}
                      isLoading={isLoading}
                    />
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen md:-mt-2 space-y-4 md:space-y-6">

  {/* Header */}
  <div className="space-y-3 mb-4 md:hidden">
    {/* Date filters + actions (mobile only; desktop lives in table header) */}
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-2 sm:gap-3 md:hidden">
      {/* From Date */}
      <div className="w-full sm:w-48 md:w-56 lg:w-64">
        <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
        <Input
          className="h-9 text-sm w-full"
          type="date"
          value={fromDate}
          onChange={(e) => {
            const v = e.target.value;
            setFromDate(v);
            if (toDate && v > toDate) setToDate(v);
          }}
        />
      </div>

      {/* To Date */}
      <div className="w-full sm:w-48 md:w-56 lg:w-64">
        <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
        <Input
          className="h-9 text-sm w-full"
          type="date"
          value={toDate}
          onChange={(e) => {
            const v = e.target.value;
            setToDate(v);
            if (fromDate && v < fromDate) setFromDate(v);
          }}
        />
      </div>

      {/* Submit button */}
      <div className="w-full sm:w-auto">
        <Label className="sr-only">Submit</Label>
        <Button className="h-9 px-4 w-full sm:w-auto" onClick={applyFilters}>
          Submit
        </Button>
      </div>

      {/* Desktop actions: placed immediately after Submit (same row) */}
      <div className="hidden sm:flex items-end gap-2 lg:gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="bg-yellow-500 text-black hover:bg-yellow-600 flex items-center gap-2 h-9 px-3 text-sm">
              <FileText className="h-4 w-4" />
              <span className="hidden lg:inline">Reports</span>
              <span className="lg:hidden">Reports</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Export Reports</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => exportAllReportsExcel()}>
              All (Excel • multi-sheet)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportPayrollSummaryCSV()}>
              Payroll summary (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportAttendanceSummaryCSV()}>
              Attendance summary (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportIncentiveMappingCSV()}>
              Incentive mapping (CSV)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>


      </div>
    </div>

    {/* Search and actions row */}
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center sm:justify-between">
      {/* Search (mobile only; desktop search is inside table header) */}
      <div className="relative flex-1 max-w-sm md:hidden">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          className="h-9 text-sm pl-9" 
          placeholder="Search employee name or code..." 
          value={search} 
          onChange={(e) => setSearch(e.target.value)} 
        />
      </div>

      {/* Actions - responsive layout (mobile only here; desktop actions are in the row above) */}
      <div className="flex gap-2 sm:gap-3">
        {/* Mobile dropdown for all actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="sm:hidden h-9 px-3 flex items-center gap-2">
              <MoreVertical className="h-4 w-4" />
              <span>Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Quick Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Back button removed as requested */}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Export Reports</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => exportAllReportsExcel()}>
              <FileText className="h-4 w-4 mr-2" />
              All Reports (Excel)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportPayrollSummaryCSV()}>
              <FileText className="h-4 w-4 mr-2" />
              Payroll Summary (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportAttendanceSummaryCSV()}>
              <FileText className="h-4 w-4 mr-2" />
              Attendance Summary (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportIncentiveMappingCSV()}>
              <FileText className="h-4 w-4 mr-2" />
              Incentive Mapping (CSV)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Desktop actions removed here to avoid duplication */}
      </div>
    </div>
  </div>

        {/* Existing Mappings Table (desktop) + Mobile Cards */}
        <Card>
          <CardContent className="p-0">
            {/* Mobile cards */}
            <div className="md:hidden p-4 space-y-4">
              {tableLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <div key={`mob-sk-${idx}`} className="rounded-lg border p-4 bg-white shadow-sm">
                    <div className="h-5 bg-gray-200/70 rounded animate-pulse w-2/3 mb-3" />
                    <div className="h-4 bg-gray-200/70 rounded animate-pulse w-1/2 mb-2" />
                    <div className="h-4 bg-gray-200/70 rounded animate-pulse w-5/6 mb-2" />
                    <div className="h-4 bg-gray-200/70 rounded animate-pulse w-3/4" />
                  </div>
                ))
              ) : activeMappings.length === 0 ? (
                <div className="text-center text-gray-500 py-12 text-base">No payroll mappings yet.</div>
              ) : (
                visibleRows.map((m) => (
                  <div key={`mob-${m.id}`} className="rounded-lg border p-4 bg-white shadow-sm">
                    {/* Header section */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-gray-900 text-base leading-tight">{m.employee_name}</div>
                        {m.employee_code && (
                          <div className="text-sm text-gray-500 mt-1">{m.employee_code}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(m)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Base salary and period info */}
                    {(() => {
                      const fallback = employees.find(e => e.id.toString() === m.form.employee_id)?.base_salary ?? 0;
                      const baseVal = Number(m.form.base_salary ?? fallback ?? 0);
                      return (
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-gray-600">Base Salary</div>
                            <div className={`text-lg font-semibold ${baseVal === 0 ? "text-red-600" : "text-gray-900"}`}>
                              ₹{baseVal.toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <div className="text-gray-600">Pay Cycle</div>
                            <div className="capitalize font-medium">{m.form.pay_cycle}</div>
                          </div>
                          <div className="flex items-center justify-between text-sm mt-1">
                            <div className="text-gray-600">Period</div>
                            <div className="font-medium">{listMonth}</div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Target and incentive */}
                    {(() => {
                      const tgt = Number(m.form.target ?? 0);
                      const incMan = Number(m.form.incentive ?? 0);
                      const billing = Number(m.billing_total ?? 0);
                      const metTarget = tgt > 0 ? billing >= tgt : false;
                      return (
                        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-gray-600">Target</div>
                            <div className={`text-lg font-semibold flex items-center gap-2 ${
                              tgt > 0 ? (metTarget ? 'text-green-600' : 'text-red-600') : 'text-gray-700'
                            }`}>
                              {metTarget && <PartyPopper className="h-4 w-4" />}
                              ₹{tgt.toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <div className="text-gray-600">Manual Incentive</div>
                            <div className="font-medium">₹{incMan.toLocaleString()}</div>
                          </div>
                          {metTarget && (
                            <div className="mt-2 text-xs text-green-700 bg-green-100 px-2 py-1 rounded">
                              🎉 Target achieved! Bonus applicable.
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Commission section */}
                    {(() => {
                      const compInc = Number(m.computed_incentive ?? 0);
                      const billing = Number(m.billing_total ?? 0);
                      return (
                        <div className="mb-4 p-3 bg-green-50 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-gray-600">Commission Amount</div>
                            <div className="text-lg font-semibold text-green-700">₹{compInc.toLocaleString()}</div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-600">From Billing</div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">₹{billing.toLocaleString()}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 p-0 text-muted-foreground"
                                onClick={() => setCommissionInfo({ 
                                  open: true, 
                                  employee: m.employee_name, 
                                  billing, 
                                  items: Number(m.line_count ?? 0), 
                                  commission: compInc 
                                })}
                              >
                                <Info className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Salary calculations */}
                    {(() => {
                      const actual = actualSalaryOf(m);
                      const adv = advancesBreakdown(m);
                      const suggested = Math.max(0, actual - adv.given + adv.received);
                      return (
                        <div className="mb-4 p-3 bg-purple-50 rounded-lg">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-sm text-gray-600 mb-1">Actual Salary</div>
                              <div className="text-lg font-semibold text-gray-900">₹{actual.toLocaleString()}</div>
                              <div className="text-xs text-gray-500">Before advances</div>
                            </div>
                            <div>
                              <div className="text-sm text-gray-600 mb-1">Suggested Salary</div>
                              <div className="text-lg font-semibold text-green-600">₹{suggested.toLocaleString()}</div>
                              <div className="text-xs text-gray-500">
                                -₹{adv.given.toLocaleString()} +₹{adv.received.toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Attendance section */}
                    {(() => {
                      const p = Number(m.attendance_present ?? 0);
                      const h = Number(m.attendance_half_day ?? 0);
                      const a = Number(m.attendance_absent ?? 0);
                      const days = paidDaysFor(m);
                      return (
                        <div className="mb-4 p-3 bg-yellow-50 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-gray-600">Attendance</div>
                            <div className="text-lg font-semibold text-gray-900">{days} days</div>
                          </div>
                          <div className="text-sm text-gray-600 mb-3">
                            Present: {p} • Half Day: {h} • Absent: {a}
                          </div>
                          <div className="flex items-center justify-between">
                            <Label className="text-sm text-gray-700">Pro-rate salary</Label>
                            <Switch
                              checked={proRateById[m.id] !== false}
                              onCheckedChange={(val) => setProRateById((prev) => ({ ...prev, [m.id]: !!val }))}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Action buttons */}
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 flex items-center justify-center gap-2 text-sm"
                        onClick={() => {
                          setAttendanceViewCtx({ record: m, proRate: (proRateById[m.id] !== false) });
                          setShowAttendanceView(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                        <span>View Details</span>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-10 flex items-center justify-center gap-2 text-sm"
                        onClick={() => generatePayslip(m)}
                      >
                        <Receipt className="h-4 w-4" />
                        <span>Payslip</span>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <div className="w-full">{/* Use full width for the table to avoid unnecessary horizontal scroll */}
                  <Table className="w-full table-auto text-xs [&_th]:py-2 [&_th]:px-2 [&_td]:py-2 [&_td]:px-2">
                    <TableHeader className="sticky top-0 bg-white z-10">
                      {/* Desktop title + filters + search combined in one row */}
                      <TableRow className="hidden md:table-row">
                        <TableHead colSpan={11} className="py-3">
                          <div className="flex items-center justify-between gap-4">
                            {/* Left: Title */}
                            <div className="text-base font-semibold text-gray-900 shrink-0">Payroll & Incentives</div>

                            {/* Middle: Filters */}
                            <div className="flex flex-wrap items-center gap-2 flex-1">
                              <div className="w-[150px]">
                                <Label className="text-[10px] text-muted-foreground mb-0.5 block">From</Label>
                                <Input
                                  className="h-8 text-xs w-full"
                                  type="date"
                                  value={fromDate}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setFromDate(v);
                                    if (toDate && v > toDate) setToDate(v);
                                  }}
                                />
                              </div>

                              <div className="w-[150px]">
                                <Label className="text-[10px] text-muted-foreground mb-0.5 block">To</Label>
                                <Input
                                  className="h-8 text-xs w-full"
                                  type="date"
                                  value={toDate}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setToDate(v);
                                    if (fromDate && v < fromDate) setFromDate(v);
                                  }}
                                />
                              </div>

                              <Button className="h-8 px-3 text-xs mt-4" onClick={applyFilters}>
                                Submit
                              </Button>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" className="bg-yellow-500 text-black hover:bg-yellow-600 flex items-center gap-2 h-8 px-3 text-xs mt-4">
                                    <FileText className="h-3.5 w-3.5" />
                                    <span>Reports</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  <DropdownMenuLabel>Export Reports</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => exportAllReportsExcel()}>
                                    All (Excel • multi-sheet)
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => exportPayrollSummaryCSV()}>
                                    Payroll summary (CSV)
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => exportAttendanceSummaryCSV()}>
                                    Attendance summary (CSV)
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => exportIncentiveMappingCSV()}>
                                    Incentive mapping (CSV)
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            {/* Right: Search + Back */}
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="relative w-[280px]">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                  className="h-8 text-xs pl-9"
                                  placeholder="Search employee name or code..."
                                  value={search}
                                  onChange={(e) => setSearch(e.target.value)}
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(-1)}
                                className="h-8 px-3 flex items-center gap-2"
                                title="Go back"
                              >
                                <ArrowLeft className="h-4 w-4" />
                                <span>Back</span>
                              </Button>
                            </div>
                          </div>
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead className="w-[130px] py-3 text-xs">
                          <button className="flex items-center w-full justify-start font-medium" onClick={() => toggleSort("employee")}>
                            Employee <SortIcon active={sortBy.key==="employee"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[90px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("base")}>
                            Base Salary <SortIcon active={sortBy.key==="base"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[90px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("target")}>
                            Target <SortIcon active={sortBy.key==="target"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[110px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("inc")}>
                            Commission Amount <SortIcon active={sortBy.key==="inc"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[80px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("advance")}>
                            Advance <SortIcon active={sortBy.key==="advance"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[100px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("actual")}>
                            Actual Salary <SortIcon active={sortBy.key==="actual"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[110px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("suggested")}>
                            Suggested Salary <SortIcon active={sortBy.key==="suggested"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[80px] text-center py-3 text-xs">Payslip</TableHead>
                        <TableHead className="w-[100px] text-center py-3 text-xs">Provide Salary</TableHead>
                        <TableHead className="w-[100px] text-center py-3 text-xs">
                          <button className="flex items-center w-full justify-center font-medium" onClick={() => toggleSort("attendance")}>
                            Attendance <SortIcon active={sortBy.key==="attendance"} dir={sortBy.dir} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[80px] text-center py-3 text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableLoading ? (
                        // Skeleton rows while loading
                        Array.from({ length: 5 }).map((_, idx) => (
                          <TableRow key={`sk-${idx}`}>
                            <TableCell className="py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-3/4" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-2/3 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-2/3 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-3/4 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-1/2 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-2/3 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-2/3 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-1/2 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-1/2 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-1/2 mx-auto" /></TableCell>
                            <TableCell className="text-center py-3"><div className="h-4 bg-gray-200/70 rounded animate-pulse w-3/4 mx-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : activeMappings.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center text-gray-500 py-12 text-base">No payroll mappings yet.</TableCell>
                        </TableRow>
                      ) : (
                        visibleRows.map((m) => (
                          <TableRow key={m.id} className="hover:bg-gray-50">
                            <TableCell className="py-3">
                              <div className="font-medium text-gray-900">{m.employee_name}</div>
                              {m.employee_code && <div className="text-xs text-gray-500 mt-1">{m.employee_code}</div>}
                            </TableCell>
                            {/* Base Salary with current Month below */}
                            <TableCell className="text-center whitespace-nowrap py-3">
                              {(() => {
                                const fallback = employees.find(e => e.id.toString() === m.form.employee_id)?.base_salary ?? 0;
                                const val = Number(m.form.base_salary ?? fallback ?? 0);
                                return (
                                  <div className="text-center leading-tight">
                                    <div className={`font-medium ${val === 0 ? "text-red-600" : "text-gray-900"}`}>₹{val.toLocaleString()}</div>
                                    <div className="text-xs text-gray-500 capitalize mt-1">{m.form.pay_cycle}</div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Manual Target with Incentive shown below */}
                            <TableCell className="text-center whitespace-nowrap py-3">
                              {(() => {
                                const tgt = Number(m.form.target ?? 0);
                                const incMan = Number(m.form.incentive ?? 0);
                                const billing = Number(m.billing_total ?? 0);
                                const metTarget = tgt > 0 ? billing >= tgt : false;
                                return (
                                  <div className="text-center leading-tight">
                                    <div className={`font-medium ${tgt > 0 ? (metTarget ? 'text-green-600 inline-flex items-center justify-center gap-1' : 'text-red-600') : 'text-gray-700'}`}>
                                      {metTarget && <PartyPopper className="h-3 w-3" />}₹{tgt.toLocaleString()}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">Incentive: ₹{incMan.toLocaleString()}</div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Commission Amount: computed from billing ONLY (exclude target bonus) with info icon */}
                            <TableCell className="text-center py-3">
                              {(() => {
                                const compInc = Number(m.computed_incentive ?? 0);
                                const billing = Number(m.billing_total ?? 0);
                                return (
                                  <div className="text-center leading-tight">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <span className="font-medium text-green-600">₹{compInc.toLocaleString()}</span>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 p-0 text-muted-foreground"
                                        onClick={() => setCommissionInfo({ open: true, employee: m.employee_name, billing, items: Number(m.line_count ?? 0), commission: compInc })}
                                        title={`Billing ₹${billing.toLocaleString()}${typeof m.line_count === 'number' ? ` (items: ${m.line_count})` : ''}`}
                                      >
                                        <Info className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Advance column (amount only; button moved to Payslip column) */}
                            <TableCell className="text-center py-3">
                              {(() => {
                                const adv = (advancesByEmp[String(m.form.employee_id)] || []).reduce((s,a)=> s + Number(a.amount||0),0);
                                return (
                                  <div className="text-center leading-tight">
                                    <div className="font-medium">₹{adv.toLocaleString()}</div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Actual Salary */}
                            <TableCell className="text-center whitespace-nowrap py-3">
                              {(() => {
                                const totalActual = actualSalaryOf(m);
                                return (
                                  <div className="text-center leading-tight">
                                    <div className="font-semibold text-gray-900">₹{totalActual.toLocaleString()}</div>
                                    <div className="text-xs text-gray-500 mt-1">Before advances</div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Suggested Salary (after advances) */}
                            <TableCell className="text-center whitespace-nowrap py-3">
                              {(() => {
                                const actual = actualSalaryOf(m);
                                const adv = advancesBreakdown(m);
                                const total = Math.max(0, actual - adv.given + adv.received);
                                return (
                                  <div className="text-center leading-tight">
                                        <div className="text-green-600 font-semibold">₹{total.toLocaleString()}</div>
                                        <div className="text-xs text-gray-500 mt-1">-₹{adv.given.toLocaleString()} +₹{adv.received.toLocaleString()}</div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Payslip column: show Advance (top) + Payslip (bottom) */}
                            <TableCell className="text-center whitespace-nowrap py-3">
                              <div className="flex flex-col items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-xs flex items-center justify-center gap-1.5"
                                  onClick={() => openAdvance(m)}
                                >
                                  <Banknote className="h-3.5 w-3.5" />
                                  <span>Advance</span>
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 px-2 text-xs flex items-center justify-center gap-1.5"
                                  onClick={() => generatePayslip(m)}
                                >
                                  <Receipt className="h-3.5 w-3.5" />
                                  <span>Payslip</span>
                                </Button>
                              </div>
                            </TableCell>
                            {/* Provide Salary */}
                            <TableCell className="text-center whitespace-nowrap py-3">
                              {(() => {
                                const empKey = String(m.form.employee_id);
                                const prov = providedByEmp[empKey];
                                if (prov) {
                                  return (
                                    <div className="leading-tight">
                                      <div className="text-xs text-muted-foreground">Salary Provided</div>
                                      <div className="font-semibold">₹{Number(prov.amount).toLocaleString()}</div>
                                    </div>
                                  );
                                }
                                return (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="h-8 px-2 text-xs flex items-center justify-center gap-1.5"
                                    onClick={() => openProvide(m)}
                                  >
                                    <HandCoins className="h-3.5 w-3.5" />
                                    <span>Provide</span>
                                  </Button>
                                );
                              })()}
                            </TableCell>
                            {/* Attendance */}
                            <TableCell className="text-center py-3">
                              {(() => {
                                const p = Number(m.attendance_present ?? 0);
                                const h = Number(m.attendance_half_day ?? 0);
                                const a = Number(m.attendance_absent ?? 0);
                                const days = paidDaysFor(m);
                                return (
                                  <div className="leading-tight">
                                    <div className="font-medium">{days} days</div>
                                    <div className="text-xs text-gray-500 mt-1">P: {p} | H: {h} | A: {a}</div>
                                    <div className="flex justify-center items-center gap-2 mt-2">
                                      <Switch className="transform scale-90"
                                        checked={proRateById[m.id] !== false}
                                        onCheckedChange={(val) =>
                                          setProRateById((prev) => ({ ...prev, [m.id]: !!val }))
                                        }
                                      />
                                    </div>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-center py-3">
                              <div className="flex flex-col items-center gap-2">
                                <div className="flex items-center gap-2 justify-center">
                                  <Button variant="ghost" size="sm" className="h-8" onClick={() => openEdit(m)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-xs w-full flex items-center justify-center gap-1.5"
                                  onClick={() => {
                                    setAttendanceViewCtx({ record: m, proRate: (proRateById[m.id] !== false) });
                                    setShowAttendanceView(true);
                                  }}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>View</span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {/* Pagination footer */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border-t text-sm bg-gray-50">
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Rows per page</Label>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
                    <SelectTrigger className="h-9 w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-600 ml-2">
                    {totalRows === 0 ? "0" : `${start + 1}-${Math.min(end, totalRows)}`} of {totalRows}
                  </span>
                </div>
                <div className="flex items-center gap-3 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                    Previous
                  </Button>
                  <span className="text-sm text-gray-700">Page {safePage} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Commission Info Dialog */}
        <Dialog open={!!commissionInfo?.open} onOpenChange={(v)=> setCommissionInfo(prev => (prev ? { ...prev, open: v } : prev))}>
          <DialogContent className="w-[95vw] max-w-[480px] text-sm">
            <DialogHeader>
              <DialogTitle className="text-base">
                Commission Details
                {commissionInfo?.employee && (
                  <div className="text-sm font-normal text-muted-foreground mt-1">{commissionInfo.employee}</div>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="text-sm text-gray-700">Commission from billing</div>
                  <div className="text-lg font-semibold text-green-700">₹{Number(commissionInfo?.commission || 0).toLocaleString()}</div>
                </div>
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="text-sm text-gray-700">Billing total</div>
                  <div className="text-lg font-semibold text-blue-700">₹{Number(commissionInfo?.billing || 0).toLocaleString()}</div>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <div className="text-sm text-gray-700">Billing items</div>
                  <div className="text-lg font-semibold text-purple-700">{Number(commissionInfo?.items || 0)}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground p-3 bg-yellow-50 rounded-lg">
                💡 Target bonus (if any) is shown in Target column and not included here.
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Advance Manager Dialog */}
        <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
          <DialogContent className="w-[95vw] max-w-[800px] text-sm max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base">Employee Advance</DialogTitle>
            </DialogHeader>
            {advanceForEmp && (
              <div className="space-y-4">
                <div className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg">
                  <div className="font-medium">{advanceForEmp.name}</div>
                  <div className="text-xs text-muted-foreground">Period: {listMonth}</div>
                </div>
                
                {/* Add new advance form */}
                <div className="space-y-4 p-4 border rounded-lg bg-white">
                  <div className="text-sm font-medium text-gray-900">Add New Advance</div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" className="h-9 text-sm" value={newAdvance.date} onChange={e=> setNewAdvance(v=>({ ...v, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Type</Label>
                      <Select value={newAdvance.type} onValueChange={(v)=> setNewAdvance(prev=> ({ ...prev, type: v as 'given'|'received' }))}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="given">Given</SelectItem>
                          <SelectItem value="received">Received</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount</Label>
                      <Input type="number" className="h-9 text-sm" value={newAdvance.amount} onChange={e=> setNewAdvance(v=>({ ...v, amount: e.target.value }))} />
                    </div>
                    <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                      <Label className="text-xs">&nbsp;</Label>
                      <Button size="sm" className="w-full h-9" onClick={addAdvance}>Add</Button>
                    </div>
                  </div>
                  
                  <div className="sm:col-span-2 lg:col-span-4 space-y-1">
                    <Label className="text-xs">Note (optional)</Label>
                    <Input className="h-9 text-sm" value={newAdvance.note} onChange={e=> setNewAdvance(v=>({ ...v, note: e.target.value }))} />
                  </div>
                </div>

                {/* Advances list */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table className="w-full text-sm">
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="text-xs py-3 font-medium">Date</TableHead>
                          <TableHead className="text-xs py-3 text-center font-medium">Type</TableHead>
                          <TableHead className="text-xs py-3 text-center font-medium">Amount</TableHead>
                          <TableHead className="text-xs py-3 font-medium">Note</TableHead>
                          <TableHead className="text-xs py-3 text-center font-medium">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(advancesByEmp[advanceForEmp.id] || []).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-gray-500 py-8">No advances yet</TableCell>
                          </TableRow>
                        ) : (
                          (advancesByEmp[advanceForEmp.id] || []).map((a)=> (
                            <TableRow key={a.id}>
                              <TableCell className="py-3 text-sm">{a.on_date}</TableCell>
                              <TableCell className="py-3 text-sm text-center">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  a.amount < 0 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {a.amount < 0 ? 'Received' : 'Given'}
                                </span>
                              </TableCell>
                              <TableCell className="py-3 text-sm text-center">
                                <span className={`font-medium ${a.amount < 0 ? 'text-green-600' : 'text-blue-600'}`}>
                                  ₹{Math.abs(Number(a.amount)).toLocaleString()}
                                </span>
                              </TableCell>
                              <TableCell className="py-3 text-sm">{a.note || "-"}</TableCell>
                              <TableCell className="py-3 text-sm text-center">
                                <Button size="sm" variant="ghost" className="text-red-600 h-8 hover:bg-red-50" onClick={()=> deleteAdvance(a)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Provide Salary Dialog */}
        <Dialog open={provideDialogOpen} onOpenChange={setProvideDialogOpen}>
          <DialogContent className="w-[95vw] max-w-[520px] text-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Provide Salary</DialogTitle>
            </DialogHeader>
            {provideCtx && (
              <div className="space-y-4">
                <div className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg">
                  <div className="font-medium">{provideCtx.rec.employee_name}</div>
                  <div className="text-xs text-muted-foreground">Period: {fromDate} — {toDate}</div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button 
                    type="button" 
                    className="rounded-lg border-2 p-4 text-center hover:bg-accent cursor-pointer transition-colors border-gray-200 hover:border-blue-300" 
                    onClick={() => setProvideCtx(prev => prev ? ({ ...prev, custom: round2Str(prev.actual) }) : prev)}
                  >
                    <div className="text-xs text-muted-foreground mb-1">Actual Salary</div>
                    <div className="text-xl font-bold text-gray-900">₹{Number(provideCtx.actual).toLocaleString()}</div>
                    <div className="text-xs text-blue-600 mt-2 font-medium">Click to use</div>
                  </button>
                  
                  <button 
                    type="button" 
                    className="rounded-lg border-2 p-4 text-center hover:bg-accent cursor-pointer transition-colors border-green-200 hover:border-green-300" 
                    onClick={() => setProvideCtx(prev => prev ? ({ ...prev, custom: round2Str(prev.suggested) }) : prev)}
                  >
                    <div className="text-xs text-muted-foreground mb-1">Suggested Salary</div>
                    <div className="text-xl font-bold text-green-700">₹{Number(provideCtx.suggested).toLocaleString()}</div>
                    <div className="text-xs text-green-600 mt-2 font-medium">Click to use</div>
                  </button>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Custom Salary (optional)</Label>
                  <Input
                    type="number"
                    className="h-10 text-sm"
                    value={provideCtx.custom}
                    onChange={(e)=> setProvideCtx(prev => prev ? ({...prev, custom: e.target.value}) : prev)}
                    onBlur={(e)=> setProvideCtx(prev => prev ? ({...prev, custom: e.target.value === '' ? '' : round2Str(e.target.value)}) : prev)}
                    placeholder={round2Str(provideCtx.suggested)}
                  />
                </div>
                
                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" onClick={()=> setProvideDialogOpen(false)} className="h-10 px-4">
                    Cancel
                  </Button>
                  <Button onClick={submitProvide} className="h-10 px-4">
                    Submit Salary
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Store Leave Dialog */}
        <StoreLeaveDialog
          open={showLeaveDialog}
          onOpenChange={setShowLeaveDialog}
          month={leaveMonth}
          setMonth={setLeaveMonth}
          currentSet={storeLeaves[leaveMonth]}
          isLoading={leaveLoading}
          onSave={async (dates: string[]) => {
            if (!user?.account_code || !user?.retail_code) return;
            setLeaveLoading(true);
            try {
              const payload = {
                account_code: user.account_code,
                retail_code: user.retail_code,
                month: leaveMonth,
                dates,
              };
              const resp: any = await ApiService.post('/store-leaves/save-month', payload);
              if (resp?.success) {
                setStoreLeaves((prev) => ({ ...prev, [leaveMonth]: new Set(dates) }));
                toast({ title: 'Saved', description: 'Store leave days updated.' });
                setShowLeaveDialog(false);
              }
            } catch (e: any) {
              toast({ title: 'Save failed', description: e?.message || String(e), variant: 'destructive' });
            } finally {
              setLeaveLoading(false);
            }
          }}
        />

        {/* Attendance View Dialog */}
        <AttendanceDetailsDialog
          open={showAttendanceView}
          onOpenChange={setShowAttendanceView}
          accountCode={user?.account_code || ""}
          retailCode={user?.retail_code || ""}
          month={listMonth}
          employeeName={attendanceViewCtx.record?.employee_name || ""}
          employeeId={Number(attendanceViewCtx.record?.form.employee_id || 0)}
          advanceGiven={(advancesByEmp[String(attendanceViewCtx.record?.form.employee_id || 0)] || []).filter(a=> Number((a as any).amount||0) >= 0).reduce((s,a)=> s + Number((a as any).amount || 0), 0)}
          advanceReceived={(advancesByEmp[String(attendanceViewCtx.record?.form.employee_id || 0)] || []).filter(a=> Number((a as any).amount||0) < 0).reduce((s,a)=> s + Math.abs(Number((a as any).amount || 0)), 0)}
          baseSalary={(() => {
            const rec = attendanceViewCtx.record; if (!rec) return 0; const fallback = employees.find(e => e.id.toString() === rec.form.employee_id)?.base_salary ?? 0; return Number(rec.form.base_salary ?? fallback ?? 0);
          })()}
          computedIncentive={Number(attendanceViewCtx.record?.computed_incentive || 0)}
          billingTotal={Number(attendanceViewCtx.record?.billing_total || 0)}
          target={Number(attendanceViewCtx.record?.form.target || 0)}
          incentiveBonus={Number(attendanceViewCtx.record?.form.incentive || 0)}
          proRate={!!attendanceViewCtx.proRate}
          leaveDeductionPerDay={Number(attendanceViewCtx.record?.form?.leave_deduction_amount || 0)}
        />
      </div>
    );
}

// Dialog to map store leave days for the month
function StoreLeaveDialog({ open, onOpenChange, month, setMonth, currentSet, onSave, isLoading }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  month: string;
  setMonth: (v: string) => void;
  currentSet: Set<string> | undefined;
  onSave: (dates: string[]) => Promise<void>;
  isLoading: boolean;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    // initialize from currentSet
    const s = new Set<number>();
    if (currentSet) {
      for (const d of currentSet) {
        const parts = d.split("-");
        const day = parseInt(parts[2], 10);
        if (!isNaN(day)) s.add(day);
      }
    }
    setSel(s);
  }, [currentSet, month, open]);

  const daysInMonth = (() => {
    try { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); } catch { return 30; }
  })();
  const startWeekday = (() => {
    try { const [y, m] = month.split("-").map(Number); return new Date(y, m - 1, 1).getDay(); } catch { return 0; }
  })();
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const toggle = (d: number) => {
    setSel(prev => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  };

  const makeDates = (): string[] => {
    const [y, m] = month.split("-");
    return Array.from(sel).sort((a, b) => a - b).map(d => `${y}-${m}-${String(d).padStart(2, '0')}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[90vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Store Leave Days</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Month selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Label className="text-sm font-medium">Month</Label>
            <Input 
              className="h-10 text-sm w-full sm:w-[200px]" 
              type="month" 
              value={month} 
              onChange={(e) => setMonth(e.target.value)} 
            />
          </div>

          {/* Calendar section */}
          <div className="space-y-3">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 text-sm text-muted-foreground">
              {weekdayLabels.map((w) => (
                <div key={w} className="text-center py-2 font-medium">{w}</div>
              ))}
            </div>
            
            {/* Calendar grid with offset for first day */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startWeekday }).map((_, idx) => (
                <div key={`sp-${idx}`} className="h-10" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  onClick={() => toggle(d)}
                  className={`h-10 text-sm rounded-lg border text-center transition-colors ${
                    sel.has(d) 
                      ? 'bg-red-600 text-white border-red-600 hover:bg-red-700' 
                      : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}
                  title={`Mark ${d} as leave`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Selected dates summary */}
          {sel.size > 0 && (
            <div className="p-3 bg-red-50 rounded-lg">
              <div className="text-sm font-medium text-red-800 mb-1">
                Selected Leave Days ({sel.size})
              </div>
              <div className="text-sm text-red-700">
                {Array.from(sel).sort((a, b) => a - b).join(', ')}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-10">
              Close
            </Button>
            <Button 
              disabled={isLoading} 
              onClick={() => onSave(makeDates())} 
              className="h-10"
            >
              {isLoading ? 'Saving...' : 'Save Leave Days'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// CSV helpers and export actions
function toCSV(rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map(r => r.map(escape).join(",")).join("\n");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// component-scoped functions above call these helpers

// Attendance details dialog: shows per-day status, store leaves, and salary calculation
function AttendanceDetailsDialog({ open, onOpenChange, accountCode, retailCode, month, employeeId, employeeName, baseSalary, computedIncentive, billingTotal, target, incentiveBonus, proRate, leaveDeductionPerDay, advanceGiven, advanceReceived }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountCode: string;
  retailCode: string;
  month: string;
  employeeId: number;
  employeeName: string;
  baseSalary: number;
  computedIncentive: number;
  billingTotal: number;
  target: number;
  incentiveBonus: number;
  proRate: boolean;
  leaveDeductionPerDay?: number;
  advanceGiven?: number;
  advanceReceived?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [presentDates, setPresentDates] = useState<string[]>([]);
  const [halfDates, setHalfDates] = useState<string[]>([]);
  const [absentDates, setAbsentDates] = useState<string[]>([]);
  const [storeLeaves, setStoreLeaves] = useState<string[]>([]);
  const [showDates, setShowDates] = useState<{present: boolean; half: boolean; absent: boolean; store: boolean}>({ present: false, half: false, absent: false, store: false });

  useEffect(() => {
    const run = async () => {
      if (!open || !accountCode || !retailCode || !employeeId) return;
      setLoading(true);
      try {
        const q = new URLSearchParams({ account_code: accountCode, retail_code: retailCode, employee_id: String(employeeId), month });
        const resp: any = await ApiService.get(`/attendance/by-month?${q.toString()}`);
        if (resp?.success) {
          const data: any[] = resp.data || [];
          const p: string[] = []; const h: string[] = []; const a: string[] = [];
          for (const r of data) {
            if (r.status === 'present') p.push(r.date); else if (r.status === 'half') h.push(r.date); else a.push(r.date);
          }
          setPresentDates(p); setHalfDates(h); setAbsentDates(a);
          setStoreLeaves(resp.store_leaves || []);
        }
      } finally { setLoading(false); }
    };
    run();
  }, [open, accountCode, retailCode, employeeId, month]);

  // salary calculation
  const daysInMonth = (() => { try { const [y, m] = (month || '').split('-').map(Number); return new Date(y, m, 0).getDate(); } catch { return 30; } })();
  const leaveCount = storeLeaves.length;
  const paidDays = presentDates.length + 0.5 * halfDates.length;
  const denom = Math.max(1, daysInMonth - leaveCount);
  // Salary based on paid days; if custom leave deduction per day exists, use it
  const leavePerDay = Number(leaveDeductionPerDay || 0);
  let basePortion = baseSalary;
  if (proRate) {
    if (leavePerDay > 0) {
      const unpaidDays = Math.max(0, denom - paidDays);
      basePortion = Math.max(0, baseSalary - leavePerDay * unpaidDays);
    } else {
      basePortion = Math.max(0, baseSalary * (paidDays / Math.max(1, denom)));
    }
  }
  const targetHit = target > 0 ? billingTotal >= target : false;
  const totalIncentive = computedIncentive + (targetHit ? incentiveBonus : 0);
  // Advances are informational only (do not deduct)
  const advGiven = Math.max(0, Number(advanceGiven || 0));
  const advReceived = Math.max(0, Number(advanceReceived || 0));
  const advAmount = Math.max(0, advGiven - advReceived);
  const finalSalary = Math.max(0, Math.round(basePortion) + totalIncentive);
  // Suggested salary adjusts for advances: deduct given, add received
  const suggestedSalary = Math.max(0, finalSalary - advGiven + advReceived);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Attendance Details — {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="text-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <div className="font-medium">Present ({presentDates.length})</div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=> setShowDates(s=> ({...s, present: !s.present}))}>
                  {showDates.present ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                </Button>
              </div>
              {showDates.present && (
                <div className="text-xs text-muted-foreground break-words">{presentDates.join(', ') || '-'}</div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <div className="font-medium">Half Day ({halfDates.length})</div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=> setShowDates(s=> ({...s, half: !s.half}))}>
                  {showDates.half ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                </Button>
              </div>
              {showDates.half && (
                <div className="text-xs text-muted-foreground break-words">{halfDates.join(', ') || '-'}</div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <div className="font-medium">Absent ({absentDates.length})</div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=> setShowDates(s=> ({...s, absent: !s.absent}))}>
                  {showDates.absent ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                </Button>
              </div>
              {showDates.absent && (
                <div className="text-xs text-muted-foreground break-words">{absentDates.join(', ') || '-'}</div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <div className="font-medium">Store Leaves ({leaveCount})</div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=> setShowDates(s=> ({...s, store: !s.store}))}>
                  {showDates.store ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                </Button>
              </div>
              {showDates.store && (
                <div className="text-xs text-muted-foreground break-words">{storeLeaves.join(', ') || '-'}</div>
              )}
            </div>
          </div>
          <div className="border-t pt-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium mb-1">Salary Calculation</div>
              </div>
              <div className="flex items-stretch gap-2">
                <div className="rounded-md border px-3 py-2 text-right bg-white shrink-0 min-w-[180px]">
                  <div className="text-[11px] text-muted-foreground">Actual salary</div>
                  <div className="text-2xl font-semibold leading-6">₹{finalSalary.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">Base ₹{Math.round(basePortion).toLocaleString()} + Incentive ₹{totalIncentive.toLocaleString()}</div>
                </div>
                <div className="rounded-md border px-3 py-2 text-right bg-white shrink-0 min-w-[180px]">
                  <div className="text-[11px] text-muted-foreground">Suggested salary</div>
                  <div className="text-2xl font-semibold leading-6 text-green-700">₹{suggestedSalary.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">After advances -₹{advGiven.toLocaleString()} +₹{advReceived.toLocaleString()}</div>
                </div>
              </div>
            </div>
              <div className="mt-2 space-y-3">
                {/* Earnings segment */}
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Earnings</div>
                  <div className="space-y-1">
                    <div>Base salary: ₹{baseSalary.toLocaleString()}</div>
                    {proRate && (
                      <div>
                        Calculation: ₹{Math.round(basePortion).toLocaleString()} {Number(leaveDeductionPerDay||0) > 0 ?
                          `(custom ₹${Number(leaveDeductionPerDay||0).toLocaleString()} × unpaid ${Math.max(0, denom - paidDays)})` :
                          `(paidDays/workingDays = ${paidDays}/${denom})`
                        }
                      </div>
                    )}
                    <div>commission from billing: ₹{computedIncentive.toLocaleString()}</div>
                    {target > 0 && (
                      <div>Target {targetHit ? 'hit' : 'not hit'}: {targetHit ? `+ ₹${incentiveBonus.toLocaleString()}` : `₹${incentiveBonus.toLocaleString()} not added`} (target ₹{target.toLocaleString()}, billing ₹{billingTotal.toLocaleString()})</div>
                    )}
                  </div>
                </div>
                {/* Advances segment */}
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Advances</div>
                  <div className="space-y-1">
                    <div>Advances given: ₹{advGiven.toLocaleString()}</div>
                    <div>Advances received: ₹{advReceived.toLocaleString()}</div>
                    <div>Advances (net): ₹{advAmount.toLocaleString()} (not deducted)</div>
                  </div>
                </div>
              </div>
              {/* Summary lines moved into cards above; no duplicate footer lines */}
            </div>
          </div>
      
      </DialogContent>
    </Dialog>
  );
}

// Small sub-component to preview computed Incentive from billings based on a bill amount
function PreviewIncentiveTable({ rows, services, updateRow, removeRow, isLoading }: {
  rows: IncentiveRow[];
  services: ServiceItem[];
  updateRow: (id: string, patch: Partial<IncentiveRow>) => void;
  removeRow: (id: string) => void;
  isLoading: boolean;
}) {
  const [serviceFilter, setServiceFilter] = useState("");

  const serviceById = useMemo(() => {
    const m = new Map<string, ServiceItem>();
    for (const s of services) {
      m.set(String(s.id), s);
    }
    return m;
  }, [services]);

  const filteredRows = useMemo(() => {
    const q = serviceFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const svc = serviceById.get(String(r.service_id));
      if (!svc) return false;
      const hay = `${svc.name ?? ""} ${svc.service_code ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, serviceById, serviceFilter]);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between gap-2 pb-2">
        <Input
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          placeholder="Search service..."
          className="h-8 w-[220px] text-xs"
          aria-label="Search commission mapping by service"
        />
      </div>
      <div className="min-w-[720px]"> {/* Minimum width for table content */}
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="h-9 bg-slate-50">
              <TableHead className="w-[200px] text-xs sm:text-sm px-3 py-2 font-medium">Service</TableHead>
              <TableHead className="w-[140px] text-xs sm:text-sm px-3 py-2 text-center font-medium">Service Price</TableHead>
              <TableHead className="w-[140px] text-xs sm:text-sm px-3 py-2 text-center font-medium">Type</TableHead>
              <TableHead className="w-[140px] text-xs sm:text-sm px-3 py-2 text-center font-medium">Value</TableHead>
              <TableHead className="w-[80px] text-xs sm:text-sm px-3 py-2 text-center font-medium">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-base">
                      {rows.length === 0 ? "No commission mappings yet" : "No matching services"}
                    </div>
                    <div className="text-sm">
                      {rows.length === 0
                        ? 'Use "Add Commission" to begin.'
                        : 'Try a different search term.'}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((r, idx) => (
                <TableRow key={r.id} className={`h-12 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                  <TableCell className="px-3 py-2">
                    <Select value={r.service_id} onValueChange={(v) => updateRow(r.id, { service_id: v })}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={isLoading ? 'Loading...' : 'Select service'} />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id.toString()}>
                            {s.name} {s.service_code ? `(${s.service_code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center">
                    {(() => {
                      const svc = serviceById.get(String(r.service_id));
                      if (!svc) return <span className="text-muted-foreground">—</span>;
                      if (svc.price === undefined || svc.price === null || !Number.isFinite(svc.price)) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return <span className="font-medium">₹{Number(svc.price).toLocaleString()}</span>;
                    })()}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center">
                    <div className="inline-flex items-center justify-center h-8 px-2 text-xs font-medium text-slate-700">
                      Fixed
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center">
                    <div className="relative">
                      <Input
                        className="h-8 text-xs text-center"
                        type="number"
                        min={0}
                        step={0.01}
                        value={r.value}
                        onChange={(e) => {
                          if (e.target.value === '') {
                            updateRow(r.id, { value: '' as any });
                            return;
                          }
                          let val = Number(e.target.value);
                          if (isNaN(val)) val = 0;
                          updateRow(r.id, { value: val });
                        }}
                        onBlur={(e) => {
                          let val = e.target.value === '' ? 0 : Number(e.target.value);
                          if (isNaN(val)) val = 0;
                          val = Math.max(0, val);
                          updateRow(r.id, { value: val });
                        }}
                        placeholder="0.00"
                        aria-label="Fixed value"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => removeRow(r.id)} 
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}