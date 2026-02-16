import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
// Label component not used after tab removal
// Removed Select components – Employee and Dept filters hidden
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// Tabs removed as per request – single Overview view only
import {
  ArrowLeft,
  User,
  Phone,
  Calendar,
  Clock,
  IndianRupee,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { DataService } from "@/services/userService";
import { AppointmentTransactionService } from "@/services/appointmentTransactionService";
// Use workspace-level shared API helper; '@' alias maps to client/, so use relative path
import { ApiService } from "@/services/apiService";
import { formatYMDIST } from "@/lib/timezone";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface StaffMember {
  id: string | number;
  name: string;
  employee_code?: string;
  department?: string;
  designation?: string;
  join_date?: string;
  photo?: string;
}

interface PerformanceMetrics {
  employee_id: string | number;
  employee_name: string;
  period: string;
  
  // Service metrics
  appointments_completed: number;
  appointments_cancelled: number;
  total_appointments: number;
  completion_rate: number;
  
  // Revenue metrics
  revenue_generated: number;
  average_ticket_size: number;
  target_revenue: number;
  revenue_achievement: number;
  
  // Customer satisfaction
  average_rating: number;
  total_reviews: number;
  five_star_reviews: number;
  customer_retention_rate: number;
  
  // Efficiency metrics
  average_service_time: number;
  on_time_percentage: number;
  break_time_minutes: number;
  productive_hours: number;
  
  // Sales metrics
  upsells_count: number;
  cross_sells_count: number;
  products_sold: number;
  product_revenue: number;
  
  // Quality metrics
  complaints_received: number;
  compliments_received: number;
  repeat_customers: number;
  referrals_generated: number;
}

// Removed DailyPerformance and Target interfaces – tabs and analytics removed

export default function PerformanceTracking() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [performanceData, setPerformanceData] = useState<PerformanceMetrics[]>([]);
  // Removed analytics and targets states – only Overview is shown
  
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("current-month");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  
  // Date range filters - Default to today to show current day's data
  const [fromDate, setFromDate] = useState<Date | undefined>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [toDate, setToDate] = useState<Date | undefined>(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return today;
  });
  const [activeQuick, setActiveQuick] = useState<"today" | "thisWeek" | "thisMonth" | "last3Months" | null>("today");
  
  const [isLoading, setIsLoading] = useState(false);
  const [walkInCountByEmployee, setWalkInCountByEmployee] = useState<Record<string, number>>({});
  const [appointments, setAppointments] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [billingTransactions, setBillingTransactions] = useState<any[]>([]);

  // Aggregates derived from invoice headers (must match Billing page totals)
  const [billCountByEmployee, setBillCountByEmployee] = useState<Record<string, number>>({});
  const [revenueByEmployee, setRevenueByEmployee] = useState<Record<string, number>>({});
  const [uniqueBillCount, setUniqueBillCount] = useState<number>(0);
  const [employeeNameById, setEmployeeNameById] = useState<Record<string, string>>({});

  // Keep an id -> name map from loaded staff masters (used for display + attribution)
  useEffect(() => {
    if (!staffMembers || staffMembers.length === 0) return;
    const m: Record<string, string> = {};
    for (const s of staffMembers) {
      const id = String(s?.id ?? '').trim();
      const name = String(s?.name ?? '').trim();
      if (id && name) m[id] = name;
    }
    setEmployeeNameById((prev) => ({ ...m, ...prev }));
  }, [staffMembers]);
  
  // Employee details modal states
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [selectedEmployeeDetails, setSelectedEmployeeDetails] = useState<any>(null);
  const [employeeWorkDetails, setEmployeeWorkDetails] = useState<any[]>([]);
  
  // Load staff master (real-time)
  useEffect(() => {
    const loadStaff = async () => {
      try {
        if (!user) return;
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        if (!acc || !ret) return;
        
        console.log('Loading staff members for account:', acc, 'retail:', ret);
        const res: any = await DataService.readData(["master_employee"], acc, ret);
        
        // DataService.readData can return various structures:
        // - { data: { master_employee: [...] } }
        // - { data: { success: true, data: [...] } } (raw /read response)
        // - { data: [...] } (array directly)
        // - or sometimes already the payload
        const payload: any = res?.data ?? res ?? {};
        let emps: any[] = [];
        
        if (Array.isArray(payload)) {
          // res.data is already the employees array
          emps = payload;
        } else if (payload.success && Array.isArray(payload.data)) {
          // Wrapped in { success: true, data: [...] }
          emps = payload.data;
        } else {
          // Nested by table name
          emps = payload.master_employee || payload.employees || payload.employee || [];
        }
        
        console.log('Raw employee data received:', emps);
        console.log('First employee sample:', emps[0]);
        
        const mapped: StaffMember[] = emps.map((e:any) => {
          const id = e.employee_id ?? e.EMPLOYEE_ID ?? e.emp_id ?? e.EMP_ID ?? e.staff_id ?? e.STAFF_ID ?? e.id ?? e.ID ?? e.code ?? e.CODE ?? e.employee_code ?? e.EMPLOYEE_CODE;
          const name =
            e.employee_name ?? e.EMPLOYEE_NAME ??
            e.emp_name ?? e.EMP_NAME ??
            e.name ?? e.NAME ??
            e.full_name ?? e.FULL_NAME ??
            e.username ?? e.USERNAME ??
            (id != null ? `Employee ${id}` : 'Employee');
          return {
            id,
            name,
            employee_code: e.employee_code ?? e.EMPLOYEE_CODE ?? e.code ?? e.CODE ?? e.employee_id ?? e.EMPLOYEE_ID ?? undefined,
            department: e.department ?? e.DEPARTMENT ?? e.division ?? e.DIVISION ?? e.role ?? e.ROLE ?? e.designation ?? e.DESIGNATION ?? undefined,
            designation: e.designation ?? e.DESIGNATION ?? e.role ?? e.ROLE ?? e.position ?? e.POSITION ?? undefined,
            join_date: e.join_date ?? e.JOIN_DATE ?? e.doj ?? e.DOJ ?? e.date_of_joining ?? e.DATE_OF_JOINING ?? undefined,
            photo: e.photo_url ?? e.PHOTO_URL ?? e.avatar ?? e.AVATAR ?? e.image ?? e.IMAGE ?? undefined,
          };
        }).filter(s => s.id != null);
        
        console.log('Mapped staff members:', mapped);
        setStaffMembers(mapped);
        
        if (mapped.length > 0) {
          toast({
            title: "Staff Loaded",
            description: `Found ${mapped.length} staff members`,
          });
        }
      } catch (e) {
        console.error('Failed to load staff:', e);
        // If masters fail, keep staffMembers empty and derive from appointments later
      }
    };
    loadStaff();
  }, [user]);

  // Handle employee selection change
  // Employee/Dept selectors removed from UI

  // Set to current month
  const setThisMonth = () => {
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    setFromDate(start);
    setToDate(end);
  };

  // Set to today only
  const setToday = () => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    setFromDate(start);
    setToDate(end);
  };

  const atStartOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const atEndOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const startOfWeek = (d: Date) => {
    const x = new Date(d);
    const day = x.getDay();
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfWeek = (d: Date) => {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  };

  const applyPreset = (k: "today" | "thisWeek" | "thisMonth" | "last3Months") => {
    const now = new Date();
    if (k === 'today') {
      setFromDate(atStartOfDay(now));
      setToDate(atEndOfDay(now));
    } else if (k === 'thisWeek') {
      setFromDate(startOfWeek(now));
      setToDate(endOfWeek(now));
    } else if (k === 'thisMonth') {
      setThisMonth();
    } else if (k === 'last3Months') {
      const from = new Date(now);
      from.setMonth(now.getMonth() - 2);
      setFromDate(atStartOfDay(from));
      setToDate(atEndOfDay(now));
    }
    setActiveQuick(k);
  };

  const handleFromDateSelect = (date?: Date) => {
    if (!date) {
      setFromDate(undefined);
      setActiveQuick(null);
      return;
    }
    const d = atStartOfDay(date);
    setFromDate(d);
    setActiveQuick(null);
    if (toDate && d > toDate) setToDate(atEndOfDay(d));
  };

  const handleToDateSelect = (date?: Date) => {
    if (!date) {
      setToDate(undefined);
      setActiveQuick(null);
      return;
    }
    const d = atEndOfDay(date);
    setToDate(d);
    setActiveQuick(null);
    if (fromDate && d < fromDate) setFromDate(atStartOfDay(d));
  };

  // Compute date range based on selectedPeriod or custom date filters
  const getPeriodRange = (): { from: Date; to: Date } => {
    // Use custom date filters if both are provided
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    
    // If only fromDate is provided, use it with current date as end
    if (fromDate && !toDate) {
      const from = new Date(fromDate);
      const to = new Date();
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    
    // If only toDate is provided, use current month start with toDate as end
    if (!fromDate && toDate) {
      const to = new Date(toDate);
      const from = startOfMonth(to);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    
    // Fallback to current month if no custom dates
    const now = new Date();
    const from = startOfMonth(now);
    const to = endOfMonth(now);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  };

  // Handle employee click to show work details
  const handleEmployeeClick = async (employeeId: string | number, employeeName: string) => {
    try {
      if (!user) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      const { from, to } = getPeriodRange();
      const fromStr = format(from, 'yyyy-MM-dd');
      const toStr = format(to, 'yyyy-MM-dd');

      // Find employee details
      const employee = staffMembers.find(s => s.id === employeeId) || {
        id: employeeId,
        name: employeeName,
        employee_code: String(employeeId),
        department: 'N/A',
        designation: 'N/A'
      };

      setSelectedEmployeeDetails(employee);

      // Fetch employee's work details from multiple sources
      // Use billing-transitions which now includes services/packages/inventory arrays per invoice
      const params = new URLSearchParams({
        account_code: String(acc),
        retail_code: String(ret),
        from_date: fromStr,
        to_date: toStr,
        // Keep payload light (same as Dashboard)
        sendalldata: 'N',
      });
      const [billingTransitionsResp, apptRows] = await Promise.all([
        ApiService.get(`/billing-transitions?${params.toString()}`) as Promise<any>,
        AppointmentTransactionService.fetchAppointments(acc, ret, fromStr, toStr) as Promise<any[]>,
      ]);

      console.log('Raw API responses:', {
        billingTransitionsResp,
      });

      // Get billing transitions for customer data (has txn_customer_name, txn_customer_mobile)
      const billingTransitionsData: any[] = Array.isArray(billingTransitionsResp?.data?.data)
        ? billingTransitionsResp.data.data
        : Array.isArray(billingTransitionsResp?.data)
        ? billingTransitionsResp.data
        : Array.isArray(billingTransitionsResp)
        ? billingTransitionsResp
        : [];

      console.log('Billing transitions sample:', billingTransitionsData.slice(0, 3));

      // Filter appointments for this employee
      const isRealAppointmentRow = (apt: any): boolean => {
        // Avoid showing non-appointment rows that sometimes leak into appointment feeds.
        // Require appointment-specific fields rather than generic created_at-only rows.
        const hasApptDate = !!(apt.appointment_date || apt.appointment_datetime || apt.booking_date || apt.date_of_appointment);
        const hasApptTime = !!(apt.appointment_time || apt.slot_time || apt.time);
        const hasApptId = !!(apt.appointment_id || apt.booking_id || apt.bookingId || apt.appt_id);
        return hasApptDate || hasApptTime || hasApptId;
      };

      const employeeAppointments = (apptRows || [])
        .filter((apt: any) => {
          const sameEmp = String(apt.employee_id || apt.txn_employee_id || '') === String(employeeId) ||
            String(apt.employee_name || '').trim() === String(employeeName || '').trim();
          if (!sameEmp) return false;
          if (!isRealAppointmentRow(apt)) return false;

          // Use appointment_date/datetime for range filtering (not created_at)
          const dStr = apt.appointment_date || apt.appointment_datetime || apt.booking_date || apt.date_of_appointment;
          const d = dStr ? new Date(dStr) : undefined;
          return !!d && d >= from && d <= to;
        });

      // Combine and format work details from child arrays
      const workDetails: any[] = [];
      const toArr = (v: any) => (Array.isArray(v) ? v : []);
      const normBillStatus = (v: any) => String(v || '').toUpperCase();

      const getLineAmount = (row: any): number => {
        const taxable = Number(row?.taxable_amount ?? row?.taxableAmount);
        const tax = Number(row?.tax_amount ?? row?.taxAmount ?? 0);
        const discount = Number(row?.discount_amount ?? row?.discountAmount ?? 0);
        const membershipDiscount = Number(row?.membership_discount ?? row?.membershipDiscount ?? 0);
        if (!isNaN(taxable) && taxable !== 0) {
          return Math.max(0, taxable + (isNaN(tax) ? 0 : tax) - (isNaN(discount) ? 0 : discount) - (isNaN(membershipDiscount) ? 0 : membershipDiscount));
        }
        const n = Number(row?.grand_total ?? row?.grandTotal ?? row?.total_amount ?? row?.amount ?? 0);
        if (!isNaN(n) && n !== 0) return n;
        const qty = Number(row?.qty ?? row?.quantity ?? 1) || 1;
        const unit = Number(row?.unit_price ?? row?.unitPrice ?? row?.price ?? 0) || 0;
        return Math.max(0, unit * qty);
      };

      billingTransitionsData.forEach((inv: any) => {
        const billStatus = normBillStatus(inv?.billstatus ?? inv?.bill_status ?? inv?.BILLSTATUS);
        if (billStatus === 'C' || billStatus === 'N') return;
        if (billStatus && billStatus !== 'Y') return;

        const invDate = inv?.txn_created_at || inv?.created_at || inv?.last_created_at || inv?.date;
        const d = invDate ? new Date(invDate) : null;
        if (!d || d < from || d > to) return;

        const customerId = inv?.customer_id ?? inv?.txn_customer_id ?? inv?.billing_customer_id ?? inv?.cust_id;
        let customerName = inv?.customerr_name || inv?.txn_customer_name || inv?.customer_name || inv?.cust_name || inv?.customer || '';
        let customerPhone = String(inv?.customer_mobile || '') || String(inv?.txn_customer_mobile || '') || inv?.customer_phone || inv?.customer_number || '';
        customerName = customerName || (customerId ? `Customer ${customerId}` : 'Walk-in Customer');
        customerPhone = customerPhone || 'N/A';

        const invId = inv?.invoice_id || inv?.txn_invoice_id || inv?.invoiceId || inv?.id;
        const base = {
          invoice_id: invId,
          date: invDate,
          customer_name: customerName,
          customer_phone: customerPhone,
        };

        const pushIfMatch = (row: any, label: string) => {
          const eid = String(row?.employee_id ?? row?.staff_id ?? '').trim();
          if (!eid || eid !== String(employeeId)) return;
          workDetails.push({
            type: 'billing',
            id: row?.id ?? `${label}-${String(invId)}-${String(eid)}-${Math.random()}`,
            ...base,
            service_name: label,
            amount: getLineAmount(row),
            status: 'completed',
          });
        };

        toArr(inv?.services).forEach((s: any) => {
          const label = s?.service_name || s?.name || 'Service';
          pushIfMatch(s, label);
        });
        toArr(inv?.packages).forEach((p: any) => {
          const label = p?.package_name || p?.name || 'Package';
          pushIfMatch(p, label);
        });
        toArr(inv?.inventory).forEach((it: any) => {
          const label = it?.product_name || it?.item_name || 'Product';
          pushIfMatch(it, label);
        });
      });

      workDetails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setEmployeeWorkDetails(workDetails);
      setShowEmployeeModal(true);

      toast({
        title: "Employee Details Loaded",
        description: `Found ${workDetails.length} work records for ${employeeName}`,
      });
    } catch (error) {
      console.error('Failed to load employee details:', error);
      toast({
        title: "Error",
        description: "Failed to load employee work details",
        variant: "destructive"
      });
    }
  };

  // Fetch appointments/invoices for selected period; compute Walk-Ins
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!user) return;
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        if (!acc || !ret) return;
        
        const { from, to } = getPeriodRange();
        // Match Billing page date formatting to avoid timezone edge cases
        const fromStr = formatYMDIST(from);
        const toStr = formatYMDIST(to);
        
        console.log('Fetching data for date range:', { fromStr, toStr, from, to });
        
        setIsLoading(true);

        // Use the same endpoints Dashboard uses for staff performance:
        // - /billing-transitions for authoritative billed invoice status
        // - /billing-trans-services|packages|inventory for staff attribution + amounts
        const btParams = new URLSearchParams({
          account_code: String(acc),
          retail_code: String(ret),
          limit: '5000',
          // Fetch only invoice summary rows (faster): backend skips per-invoice detail expansion
          sendalldata: 'N',
          from_date: fromStr,
          to_date: toStr,
        });

        const baseLineParams = new URLSearchParams({
          account_code: String(acc),
          retail_code: String(ret),
          from_date: fromStr,
          to_date: toStr,
        });

        const fetchPagedLines = async (path: string): Promise<any[]> => {
          const pageLimit = 20000;
          const maxPages = 5;
          let offset = 0;
          const out: any[] = [];
          for (let i = 0; i < maxPages; i++) {
            const p = new URLSearchParams(baseLineParams.toString());
            p.set('limit', String(pageLimit));
            p.set('offset', String(offset));
            const resp: any = await ApiService.get(`${path}?${p.toString()}`);
            const rows: any[] = Array.isArray(resp?.data?.data)
              ? resp.data.data
              : (Array.isArray(resp?.data) ? resp.data : []);
            out.push(...rows);
            if (rows.length < pageLimit) break;
            offset += pageLimit;
          }
          return out;
        };

        const [billingTransitionsResp, apptRows, svcLines, pkgLines, invLines] = await Promise.all([
          ApiService.get(`/billing-transitions?${btParams.toString()}`) as Promise<any>,
          AppointmentTransactionService.fetchAppointments(acc, ret, fromStr, toStr) as Promise<any[]>,
          fetchPagedLines('/billing-trans-services'),
          fetchPagedLines('/billing-trans-packages'),
          fetchPagedLines('/billing-trans-inventory'),
        ]);

        const invoiceList: any[] = Array.isArray(billingTransitionsResp?.data?.data)
          ? billingTransitionsResp.data.data
          : Array.isArray(billingTransitionsResp?.data)
          ? billingTransitionsResp.data
          : Array.isArray(billingTransitionsResp)
          ? billingTransitionsResp
          : [];

        const lineRows: any[] = [...(svcLines || []), ...(pkgLines || []), ...(invLines || [])];

        console.log('Fetched data:', { 
          billingTransactions: lineRows.length,
          appointments: apptRows?.length || 0, 
          invoices: invoiceList.length,
          dateRange: { from: fromStr, to: toStr }
        });

        // Debug: Log first few billing line rows
        if (lineRows.length > 0) {
          console.log('Sample billing line rows:', lineRows.slice(0, 5).map((bt: any) => ({
            invoice_id: bt.invoice_id ?? bt.bill_id ?? bt.billing_id,
            item_total: bt.item_total ?? bt.grand_total,
            employee_id: bt.employee_id ?? bt.staff_id,
            employee_name: bt.employee_name ?? bt.staff_name,
            created_at: bt.created_at,
          })));
        }

        // Debug: Log first few invoices
        if (invoiceList.length > 0) {
          console.log('Sample billing transitions invoices:', invoiceList.slice(0, 3).map(iv => ({
            id: iv.id || iv.invoice_id,
            grand_total: iv.grand_total,
            employee_id: iv.employee_id,
            employee_name: iv.employee_name,
          })));
        }

        setAppointments(apptRows || []);
        setInvoices(invoiceList || []);
        setBillingTransactions(lineRows || []);

        // Fallback: infer employee names from invoice child arrays (services/packages/inventory)
        // This fixes cases where master_employee is missing an id.
        const inferredNames: Record<string, string> = {};
        const remember = (idRaw: any, nameRaw: any) => {
          const id = String(idRaw ?? '').trim();
          const name = String(nameRaw ?? '').trim();
          if (!id || id === '0' || id === 'null' || id === 'undefined') return;
          if (!name) return;
          if (!inferredNames[id] || inferredNames[id].startsWith('Employee ')) inferredNames[id] = name;
        };
        (invoiceList || []).forEach((iv: any) => {
          remember(iv?.txn_employee_id ?? iv?.employee_id ?? iv?.staff_id ?? iv?.emp_id, iv?.txn_employee_name ?? iv?.employee_name ?? iv?.staff_name);
          const svcArr: any[] = Array.isArray(iv?.services) ? iv.services : [];
          const pkgArr: any[] = Array.isArray(iv?.packages) ? iv.packages : [];
          const invArr: any[] = Array.isArray(iv?.inventory) ? iv.inventory : [];
          svcArr.forEach((r: any) => remember(r?.employee_id ?? r?.staff_id ?? r?.emp_id ?? r?.EMPLOYEE_ID, r?.employee_name ?? r?.staff_name ?? r?.EMPLOYEE_NAME));
          pkgArr.forEach((r: any) => remember(r?.employee_id ?? r?.staff_id ?? r?.emp_id ?? r?.EMPLOYEE_ID, r?.employee_name ?? r?.staff_name ?? r?.EMPLOYEE_NAME));
          invArr.forEach((r: any) => remember(r?.employee_id ?? r?.staff_id ?? r?.emp_id ?? r?.EMPLOYEE_ID, r?.employee_name ?? r?.staff_name ?? r?.EMPLOYEE_NAME));
        });
        // Merge inferred names with master names (master wins unless missing)
        setEmployeeNameById((prev) => ({ ...inferredNames, ...prev }));

        // Build billed invoice key set from /billing-transitions (authoritative)
        const normInvKeys = (raw: any): string[] => {
          const s0 = String(raw ?? '').trim();
          if (!s0) return [];
          const out = new Set<string>();
          const s = s0.replace(/\s+/g, '');
          out.add(s0);
          out.add(s);
          const upper = s.toUpperCase();
          out.add(upper);
          const digitsOnly = upper.replace(/\D+/g, '');
          if (digitsOnly) {
            out.add(digitsOnly);
            out.add(`INV-${digitsOnly}`);
            out.add(`INV${digitsOnly}`);
          }
          if (upper.startsWith('INV')) {
            const tail = upper.replace(/^INV(?:-|:|_)*/i, '').trim();
            if (tail) {
              out.add(tail);
              const tailDigits = tail.replace(/\D+/g, '');
              if (tailDigits) {
                out.add(tailDigits);
                out.add(`INV-${tailDigits}`);
                out.add(`INV${tailDigits}`);
              }
            }
          }
          return Array.from(out).filter((k) => !!String(k || '').trim());
        };

        const billedInvoiceKeys = new Set<string>();
        const isBilled = (bill: any): boolean => {
          const raw =
            bill?.billtype ??
            bill?.billType ??
            bill?.bill_type ??
            bill?.BILLTYPE ??
            bill?.BILL_TYPE ??
            bill?.billstatus ??
            bill?.billStatus ??
            bill?.bill_status ??
            bill?.BILLSTATUS ??
            bill?.BILL_STATUS ??
            bill?.txn_billtype ??
            bill?.txn_bill_type ??
            bill?.txn_billstatus ??
            bill?.txn_bill_status;
          return String(raw || '').trim().toUpperCase() === 'Y';
        };

        const inRangeInvoice = (bill: any): boolean => {
          const billDate =
            bill?.last_created_at ??
            bill?.txn_created_at ??
            bill?.created_at ??
            bill?.invoice_date ??
            bill?.date;
          if (!billDate) return false;
          const d = new Date(billDate);
          if (Number.isNaN(d.getTime())) return false;
          return d >= from && d <= to;
        };

        (invoiceList || []).forEach((bill: any) => {
          if (!inRangeInvoice(bill)) return;
          if (!isBilled(bill)) return;
          const candidates = [
            bill?.invoice_id,
            bill?.txn_invoice_id,
            bill?.bill_id,
            bill?.id,
            bill?.invoice_no,
            bill?.invoice_number,
            bill?.txn_invoice_no,
          ];
          candidates
            .filter((v: any) => v != null && String(v).trim() !== '')
            .forEach((v: any) => normInvKeys(v).forEach((k) => billedInvoiceKeys.add(k)));
        });

        const getLineAmount = (row: any): number => {
          const taxable = Number(row?.taxable_amount ?? row?.taxableAmount ?? row?.TAXABLE_AMOUNT);
          const tax = Number(row?.tax_amount ?? row?.taxAmount ?? row?.TAX_AMOUNT ?? 0);
          const discount = Number(row?.discount_amount ?? row?.discountAmount ?? row?.DISCOUNT_AMOUNT ?? 0);
          const membershipDiscount = Number(row?.membership_discount ?? row?.membershipDiscount ?? row?.MEMBERSHIP_DISCOUNT ?? 0);
          if (!Number.isNaN(taxable) && taxable !== 0) {
            return Math.max(0, taxable + (Number.isNaN(tax) ? 0 : tax) - (Number.isNaN(discount) ? 0 : discount) - (Number.isNaN(membershipDiscount) ? 0 : membershipDiscount));
          }
          const n = Number(
            row?.grand_total ??
            row?.grandTotal ??
            row?.GRAND_TOTAL ??
            row?.item_total ??
            row?.ITEM_TOTAL ??
            row?.total_amount ??
            row?.TOTAL_AMOUNT ??
            row?.amount ??
            row?.AMOUNT ??
            row?.total ??
            row?.TOTAL ??
            0
          );
          if (!Number.isNaN(n) && n !== 0) return Math.max(0, n);
          const qty = Number(row?.qty ?? row?.quantity ?? row?.QTY ?? row?.QUANTITY ?? 1) || 1;
          const unit = Number(row?.unit_price ?? row?.unitPrice ?? row?.UNIT_PRICE ?? row?.price ?? row?.PRICE ?? row?.rate ?? row?.RATE ?? 0) || 0;
          return Math.max(0, unit * qty);
        };

        const parseRowDate = (row: any): Date | null => {
          const ds = row?.created_at ?? row?.updated_at ?? row?.date ?? row?.entry_date ?? row?.billing_date;
          if (!ds) return null;
          const d = new Date(ds);
          return Number.isNaN(d.getTime()) ? null : d;
        };

        const _revenueByEmployee: Record<string, number> = {};
        const invoiceSetByEmployee = new Map<string, Set<string>>();
        const UNASSIGNED_ID = '__unassigned__';

        const lineRowsInRange = (lineRows || []).filter((r: any) => {
          const d = parseRowDate(r);
          if (!d) return false;
          if (d < from || d > to) return false;

          if (billedInvoiceKeys.size > 0) {
            const rawId = r?.invoice_id ?? r?.billing_id ?? r?.bill_id ?? r?.invoice_no ?? r?.invoice_number ?? r?.id;
            const keys = normInvKeys(rawId);
            return keys.some((k) => billedInvoiceKeys.has(k));
          }

          const st = String(r?.billtype ?? r?.billstatus ?? r?.BILLSTATUS ?? '').trim().toUpperCase();
          if (st) return st === 'Y';
          return true;
        });

        lineRowsInRange.forEach((r: any) => {
          const staffName = String(
            r?.employee_name ??
            r?.staff_name ??
            r?.stylist_name ??
            r?.txn_employee_name ??
            r?.EMPLOYEE_NAME ??
            r?.EMP_NAME ??
            r?.STAFF_NAME ??
            r?.STYLIST_NAME ??
            r?.TECHNICIAN_NAME ??
            r?.technician_name ??
            ''
          ).trim();
          const staffIdRaw = String(
            r?.employee_id ??
            r?.staff_id ??
            r?.stylist_id ??
            r?.technician_id ??
            r?.employeeId ??
            r?.EMPLOYEE_ID ??
            r?.EMP_ID ??
            r?.STAFF_ID ??
            r?.STYLIST_ID ??
            r?.TECHNICIAN_ID ??
            ''
          ).trim();

          const tryIdFromName = () => {
            const m = String(staffName || '').trim().match(/^staff\s*(\d+)$/i);
            return m?.[1] ? String(m[1]).trim() : '';
          };

          const staffId = (staffIdRaw || tryIdFromName() || UNASSIGNED_ID).trim();

          const amount = getLineAmount(r);
          if (!(amount > 0)) return;
          _revenueByEmployee[staffId] = (_revenueByEmployee[staffId] || 0) + amount;

          const rawInvId = r?.invoice_id ?? r?.billing_id ?? r?.bill_id ?? r?.invoice_no ?? r?.invoice_number ?? r?.id;
          const keys = normInvKeys(rawInvId);
          const primaryKey = keys.find((k) => /^\d+$/.test(k)) || keys[0] || '';
          if (primaryKey) {
            if (!invoiceSetByEmployee.has(staffId)) invoiceSetByEmployee.set(staffId, new Set());
            invoiceSetByEmployee.get(staffId)!.add(primaryKey);
          }
        });

        const _billCountByEmployee: Record<string, number> = {};
        const allInv = new Set<string>();
        for (const [empId, s] of invoiceSetByEmployee.entries()) {
          _billCountByEmployee[empId] = s.size;
          s.forEach((k) => allInv.add(k));
        }

        setRevenueByEmployee(_revenueByEmployee);
        setBillCountByEmployee(_billCountByEmployee);
        setUniqueBillCount(allInv.size);
        setWalkInCountByEmployee(_billCountByEmployee);
      } catch (e) {
        console.error('Error fetching performance data:', e);
        // fail silently; default 0s
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedPeriod, fromDate, toDate]);
  // Build performance metrics from real data whenever inputs change
  useEffect(() => {
    const build = () => {
      const { from, to } = getPeriodRange();

      const getDateCI = (row: any, keys: string[]): Date | null => {
        for (const k of keys) {
          const v = row?.[k] ?? row?.[k.toLowerCase()] ?? row?.[k.toUpperCase()];
          if (!v) continue;
          const d = new Date(v);
          if (!isNaN(d.getTime())) return d;
        }
        // Fallback: appointment_date (yyyy-MM-dd)
        const ad = row?.appointment_date ?? row?.appointmentDate;
        if (ad) {
          const d = new Date(String(ad));
          if (!isNaN(d.getTime())) return d;
        }
        return null;
      };

      const normalizeAppointmentEmployeeId = (a: any): string | null => {
        const id = [
          a.employee_id,
          a.employeeId,
          a.emp_id,
          a.staff_id,
          a.staffId,
          a.txn_employee_id,
        ].find((v) => v != null && String(v).trim() !== "");
        if (id) return String(id);

        const name = [a.staff_name, a.employee_name, a.txn_employee_name, a.emp_name]
          .map((v: any) => String(v || "").trim())
          .find((v) => v);
        if (!name) return null;

        if (staffMembers.length > 0) {
          const staff = staffMembers.find(
            (s) => (s.name || "").toLowerCase() === name.toLowerCase()
          );
          if (staff) return String(staff.id);
        }
        return null;
      };
      
      // Group billing transactions by employee id (primary source), with fallback to invoices
      const normalizeEmployeeId = (iv:any): string | null => {
        // First try direct ID matching
        const id = [iv.employee_id, iv.EMPLOYEE_ID, iv.employeeId, iv.emp_id, iv.staff_id, iv.txn_employee_id].find((v)=> v!=null && String(v).trim()!=='' );
        if (id) return String(id);
        
        // Fallback: try to match by employee name to existing employee IDs
        const name = [iv.txn_employee_name, iv.employee_name, iv.staffName, iv.staff_name, iv.employee, iv.emp_name]
          .map((v:any)=> String(v||'').trim()).find(v=> v);
        if (!name) return null;
        
        // Try to match to staffMembers by name (if available)
        if (staffMembers.length > 0) {
          const staff = staffMembers.find(s => (s.name||'').toLowerCase() === name.toLowerCase());
          return staff ? String(staff.id) : null;
        }
        
        // Fallback: try to match to existing employee IDs from appointments by name
        const apptEmp = appointments.find(a => (a.staff_name||'').toLowerCase() === name.toLowerCase());
        if (apptEmp && apptEmp.employee_id) {
          return String(apptEmp.employee_id);
        }
        
        // Enhanced name-based ID mapping (including Raja and other common names)
        const nameToIdMap: Record<string, string> = {
        };
        const normalizedName = name.toLowerCase();
        const mappedId = nameToIdMap[normalizedName];
        
        // If no mapping found, create a default employee ID based on the name
        if (!mappedId && name) {
          // For unknown staff, create a consistent ID based on name
          const hash = name.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
          }, 0);
          return String(Math.abs(hash % 1000) + 100); // Generate ID between 100-1099
        }
        
        return mappedId || null;
      };

      const normalizeBillingEmployeeId = (bt: any): string | null => {
        const id = [
          bt.employee_id,
          bt.EMPLOYEE_ID,
          bt.employeeId,
          bt.emp_id,
          bt.staff_id,
          bt.staffId,
          bt.txn_employee_id,
        ].find((v) => v != null && String(v).trim() !== "");
        if (id) return String(id);

        const name = [bt.employee_name, bt.txn_employee_name, bt.staff_name, bt.emp_name]
          .map((v: any) => String(v || "").trim())
          .find((v) => v);
        if (!name) return null;

        if (staffMembers.length > 0) {
          const staff = staffMembers.find(
            (s) => (s.name || "").toLowerCase() === name.toLowerCase()
          );
          return staff ? String(staff.id) : null;
        }
        return null;
      };

      const getBillingLineAmount = (bt: any): number => {
        const qty = Number(bt.qty ?? bt.quantity ?? bt.QTY ?? 1) || 1;

        // Best signal from /billing-transitions style rows
        // (matches your sample payload and respects quantity/tax/discount)
        const taxable = Number(bt.taxable_amount ?? bt.taxableAmount);
        const tax = Number(bt.tax_amount ?? bt.taxAmount ?? 0);
        const discount = Number(bt.discount_amount ?? bt.discountAmount ?? 0);
        const membershipDiscount = Number(bt.membership_discount ?? bt.membershipDiscount ?? 0);
        if (!isNaN(taxable) && taxable !== 0) {
          const line = taxable + (isNaN(tax) ? 0 : tax) - (isNaN(discount) ? 0 : discount) - (isNaN(membershipDiscount) ? 0 : membershipDiscount);
          return Math.max(0, line);
        }

        // Prefer line/sub totals if present (service-level amounts)
        const candidates = [
          // billing_trans_summary commonly provides grand_total as line total (tax inclusive)
          bt.grand_total,
          bt.subtotal,
          bt.line_total,
          bt.line_amount,
          bt.item_total,
          bt.item_amount,
          bt.service_total,
          bt.service_amount,
          bt.net_amount,
          bt.netAmount,
          bt.sub_total,
          bt.subTotal,
          bt.total_amount,
          bt.totalAmount,
          bt.amount,
          bt.value,
        ];
        for (const c of candidates) {
          const n = Number(c);
          if (!isNaN(n) && n !== 0) return n;
        }

        // Compute from unit price + tax/discount when explicit line totals are missing
        const unitPrice = Number(bt.rate ?? bt.price ?? bt.unit_price ?? bt.unitPrice ?? 0) || 0;
        if (unitPrice) {
          const base = unitPrice * qty;
          const tax = Number(bt.tax_amount ?? bt.taxAmount ?? 0) || 0;
          const discount = Number(bt.discount_amount ?? bt.discountAmount ?? 0) || 0;
          const membershipDiscount = Number(bt.membership_discount ?? bt.membershipDiscount ?? 0) || 0;
          return Math.max(0, base + tax - discount - membershipDiscount);
        }
        // Last resort (can be invoice total and may over-attribute if multiple staff share an invoice)
        return Number(bt.txn_grand_total ?? bt.grand_total ?? bt.grandTotal ?? 0) || 0;
      };

      // collect unique employee IDs from staff, appointments, and invoice-derived revenue/bill counts
      const idSet = new Set<string>();
      const empById = new Map<string, StaffMember>();
      staffMembers.forEach((s) => { if (s.id != null) { idSet.add(String(s.id)); empById.set(String(s.id), s); } });
      appointments.forEach((a:any) => { if (a.employee_id != null && String(a.employee_id).trim() !== '') idSet.add(String(a.employee_id)); });

      Object.keys(billCountByEmployee || {}).forEach((k) => idSet.add(String(k)));
      Object.keys(revenueByEmployee || {}).forEach((k) => idSet.add(String(k)));

      const ids = Array.from(idSet);
      
      // Debug logging for employee IDs and data
      console.log('=== Performance Build Debug ===');
      console.log('Staff members:', staffMembers.map(s => ({ id: s.id, name: s.name })));
      console.log('Unique employee IDs found:', ids);
      console.log('Total appointments:', appointments.length);
      console.log('Total billing transactions:', billingTransactions.length);
      console.log('Total invoices:', invoices.length);
      console.log('Date range:', { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') });
      
      // Check today's invoices specifically
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const todaysInvoicesRaw = invoices.filter(iv => {
        const dateStr = iv.last_created_at || iv.last_updated_at || iv.created_at || iv.date;
        return dateStr && dateStr.startsWith(todayStr);
      });
      console.log(`Today's raw invoices (${todayStr}):`, todaysInvoicesRaw.length);
      if (todaysInvoicesRaw.length > 0) {
        console.log('Today\'s invoice details:', todaysInvoicesRaw.map(iv => ({
          id: iv.id,
          amount: iv.grand_total,
          staff: iv.txn_employee_name || iv.employee_name,
          employee_id: normalizeEmployeeId(iv),
          date: iv.last_created_at || iv.created_at
        })));
      }

      // Helper to resolve employee name by id or by name in invoice
      const resolveNameById = (id: string): string => {
        if (id === '__unassigned__') return 'Unassigned';
        const found = empById.get(id);
        if (found) return found.name;

        const inferred = employeeNameById?.[id];
        if (inferred) return inferred;
        
        // Try to find by appointment data
        const a = appointments.find((x:any)=> String(x.employee_id)===id);
        if (a?.staff_name) return a.staff_name;
        
        // Try to find by invoice data (reverse lookup)
        const inv = invoices.find((iv:any) => normalizeEmployeeId(iv) === id);
        if (inv) {
          const name = [inv.txn_employee_name, inv.employee_name, inv.staffName, inv.staff_name, inv.employee, inv.emp_name]
            .map((v:any)=> String(v||'').trim()).find(v=> v);
          if (name) return name;

          // Final attempt: search child arrays for a matching employee id and pick the name
          const lookIn = (arr: any[]) => {
            const hit = (arr || []).find((r: any) => {
              const rid = String(r?.employee_id ?? r?.staff_id ?? r?.emp_id ?? r?.EMPLOYEE_ID ?? '').trim();
              return rid && rid === id;
            });
            if (!hit) return '';
            return String(hit?.employee_name ?? hit?.staff_name ?? hit?.EMPLOYEE_NAME ?? '').trim();
          };
          const svcName = lookIn(Array.isArray(inv?.services) ? inv.services : []);
          if (svcName) return svcName;
          const pkgName = lookIn(Array.isArray(inv?.packages) ? inv.packages : []);
          if (pkgName) return pkgName;
          const invName = lookIn(Array.isArray(inv?.inventory) ? inv.inventory : []);
          if (invName) return invName;
        }
        
        return `Employee ${id}`;
      };

      const perEmp: PerformanceMetrics[] = ids.map((id) => {
        // Appointments filtered to period and this emp
        const appts = appointments.filter((a:any) => {
          const apptEmpId = normalizeAppointmentEmployeeId(a);
          if (!apptEmpId || apptEmpId !== id) return false;
          const d = getDateCI(a, [
            "latest_created",
            "last_created_at",
            "created_at",
            "createdAt",
            "txn_created_at",
          ]);
          return !!d && d >= from && d <= to;
        });
        const total_apts = appts.length;
        const cancelled = appts.filter((a:any)=> String(a.status||'').toLowerCase()==='cancelled').length;
        const completed = appts.filter((a:any)=> {
          const st = String(a.status||'').toLowerCase();
          if (st==='completed' || st === 'done') return true;
          // consider settled as completed
          const ps = String(a.payment_status||'').toLowerCase();
          return ps==='settled' || Number(a.balance_due||0) <= 0;
        }).length;
        const completion_rate = total_apts>0 ? (completed/total_apts)*100 : 0;

        // Use invoice-header derived revenue/bill counts (matches Billing totals)
        const finalRevenue = Number(revenueByEmployee?.[id] || 0) || 0;
        const billCount = Number(billCountByEmployee?.[id] || 0) || 0;
        const avg_ticket = billCount > 0 ? finalRevenue / billCount : 0;

        const name = resolveNameById(id);

        return {
          employee_id: id,
          employee_name: name,
          period: `${format(from,'yyyy-MM')}`,
          appointments_completed: completed,
          appointments_cancelled: cancelled,
          total_appointments: total_apts,
          completion_rate,
          revenue_generated: finalRevenue,
          average_ticket_size: Math.round(avg_ticket),
          target_revenue: finalRevenue, // placeholder until explicit targets exist
          revenue_achievement: finalRevenue>0 ? 100 : 0,
          average_rating: 0,
          total_reviews: 0,
          five_star_reviews: 0,
          customer_retention_rate: 0,
          average_service_time: (()=>{
            // compute from slots if available
            const durations = appts.map((a:any)=>{
              const f = a.slot_from ? new Date(`${a.appointment_date}T${a.slot_from}`) : null;
              const t = a.slot_to ? new Date(`${a.appointment_date}T${a.slot_to}`) : null;
              if (!f || !t || isNaN(f.getTime()) || isNaN(t.getTime())) return 0;
              return Math.max(0, Math.round((t.getTime()-f.getTime())/60000));
            }).filter((m:number)=> m>0);
            if (durations.length===0) return 0;
            return Math.round(durations.reduce((s:number,x:number)=>s+x,0)/durations.length);
          })(),
          on_time_percentage: 0,
          break_time_minutes: 0,
          productive_hours: 0,
          upsells_count: 0,
          cross_sells_count: 0,
          products_sold: 0,
          product_revenue: 0,
          complaints_received: 0,
          compliments_received: 0,
          repeat_customers: 0,
          referrals_generated: 0,
        } as PerformanceMetrics;
      });

      setPerformanceData(perEmp);

        };
        build();
      }, [staffMembers, appointments, invoices, billingTransactions, billCountByEmployee, revenueByEmployee, employeeNameById, selectedPeriod, fromDate, toDate]);

  const getFilteredPerformanceData = () => {
    let filtered = performanceData;
    
    if (selectedEmployee !== "all") {
      filtered = filtered.filter(p => p.employee_id.toString() === selectedEmployee);
    }
    
    if (selectedDepartment !== "all") {
      const deptStaffIds = staffMembers
        .filter(s => s.department === selectedDepartment)
        .map(s => s.id.toString());
      filtered = filtered.filter(p => deptStaffIds.includes(p.employee_id.toString()));
    }
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      filtered = filtered.filter(p => (p.employee_name || "").toLowerCase().includes(q));
    }
    
    return filtered;
  };

  const groupedPerformanceData = useMemo(() => {
    const rows = getFilteredPerformanceData();

    type Agg = {
      employeeKey: string;
      employeeName: string;
      employeeId: string | number;
      employeeIds: Set<string>;
      appointmentsCompleted: number;
      appointmentsCancelled: number;
      totalAppointments: number;
      revenue: number;
      ticketCount: number;
    };

    const byEmployee = new Map<string, Agg>();

    for (const r of rows) {
      const name = String(r.employee_name || r.employee_id || "").trim() || "Employee";
      const key = name.toLowerCase();

      const existing = byEmployee.get(key);
      const completed = Number(r.appointments_completed || 0) || 0;
      const cancelled = Number(r.appointments_cancelled || 0) || 0;
      const totalAppts = Number(r.total_appointments || 0) || 0;
      const revenue = Number(r.revenue_generated || 0) || 0;

      // Best-effort ticket count so avg ticket is weighted correctly.
      const avgTicket = Number(r.average_ticket_size || 0) || 0;
      const tickets = avgTicket > 0 ? Math.max(1, Math.round(revenue / avgTicket)) : 0;

      if (!existing) {
        // Prefer a stable staff ID if we can match by name
        const staff = staffMembers.find(
          (s) => String(s.name || "").trim().toLowerCase() === key
        );
        const displayId = staff?.id ?? r.employee_id;
        byEmployee.set(key, {
          employeeKey: key,
          employeeName: name,
          employeeId: displayId,
          employeeIds: new Set([String(r.employee_id)]),
          appointmentsCompleted: completed,
          appointmentsCancelled: cancelled,
          totalAppointments: totalAppts,
          revenue,
          ticketCount: tickets,
        });
        continue;
      }

      existing.employeeIds.add(String(r.employee_id));
      existing.appointmentsCompleted += completed;
      existing.appointmentsCancelled += cancelled;
      existing.totalAppointments += totalAppts;
      existing.revenue += revenue;
      existing.ticketCount += tickets;

      // If the current row maps to a real staff member id, prefer that id for navigation
      const staff = staffMembers.find(
        (s) => String(s.name || "").trim().toLowerCase() === key
      );
      if (staff?.id != null) existing.employeeId = staff.id;
    }

    return Array.from(byEmployee.values())
      .map((a) => {
        const completionRate = a.totalAppointments > 0
          ? (a.appointmentsCompleted / a.totalAppointments) * 100
          : 0;
        const avgTicket = a.ticketCount > 0 ? Math.round(a.revenue / a.ticketCount) : 0;
        return {
          employee_id: a.employeeId,
          employee_name: a.employeeName,
          period: "",
          appointments_completed: a.appointmentsCompleted,
          appointments_cancelled: a.appointmentsCancelled,
          total_appointments: a.totalAppointments,
          completion_rate: completionRate,
          revenue_generated: a.revenue,
          average_ticket_size: avgTicket,
          target_revenue: a.revenue,
          revenue_achievement: a.revenue > 0 ? 100 : 0,
          average_rating: 0,
          total_reviews: 0,
          five_star_reviews: 0,
          customer_retention_rate: 0,
          average_service_time: 0,
          on_time_percentage: 0,
          break_time_minutes: 0,
          productive_hours: 0,
          upsells_count: 0,
          cross_sells_count: 0,
          products_sold: 0,
          product_revenue: 0,
          complaints_received: 0,
          compliments_received: 0,
          repeat_customers: 0,
          referrals_generated: 0,
          _employeeIds: Array.from(a.employeeIds),
        } as any;
      })
      .sort((x, y) => {
        const revDiff = (Number(y.revenue_generated || 0) || 0) - (Number(x.revenue_generated || 0) || 0);
        if (revDiff !== 0) return revDiff;
        return String(x.employee_name).localeCompare(String(y.employee_name));
      });
  }, [performanceData, staffMembers, selectedEmployee, selectedDepartment, search]);

  // Removed performance scoring/analytics helpers – only Overview is shown

  const aggregatedData = groupedPerformanceData;
  const totalRevenue = aggregatedData.reduce((sum, p) => sum + (p.revenue_generated || 0), 0);
  const totalRevenueRounded = Math.round(totalRevenue);
  const totalRoundOff = Number((totalRevenueRounded - totalRevenue).toFixed(2));
  // Show total appointments (completed + pending + cancelled) across employees
  const totalAppointments = aggregatedData.reduce((sum, p) => sum + (p.total_appointments || 0), 0);
  const avgCompletionRate = aggregatedData.length > 0
    ? aggregatedData.reduce((sum, p) => sum + p.completion_rate, 0) / aggregatedData.length
    : 0;

  const totalsRow = useMemo(() => {
    // Total Walk-ins should equal the sum of the Walk-ins column shown per row
    // (Note: multi-staff invoices can legitimately increase this vs unique bills.)
    const totalWalkIns = aggregatedData.reduce((sum, p: any) => {
      const ids: string[] = Array.isArray(p?._employeeIds) ? p._employeeIds : [String(p?.employee_id)];
      const rowWalkIns = ids.reduce((rowSum, id) => rowSum + (walkInCountByEmployee[String(id)] || 0), 0);
      return sum + rowWalkIns;
    }, 0);
    const totalAppts = aggregatedData.reduce((sum, p) => sum + (p.total_appointments || 0), 0);
    const totalRev = aggregatedData.reduce((sum, p) => sum + (p.revenue_generated || 0), 0);
    const totalRevRounded = Math.round(totalRev);
    const totalRevRoundOff = Number((totalRevRounded - totalRev).toFixed(2));
    return { totalWalkIns, totalAppts, totalRev, totalRevRounded, totalRevRoundOff };
  }, [aggregatedData, walkInCountByEmployee]);

  // Unique department list for filter
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    staffMembers.forEach(s => {
      if (s.department && String(s.department).trim() !== "") set.add(String(s.department));
    });
    return Array.from(set);
  }, [staffMembers]);

  return (
    <div className="min-h-screen space-y-4">
      {/* Unified Card with Filters, KPIs and Team Table */}
      <Card className="border border-gray-200/70 shadow-sm bg-white">
        <CardHeader className="pb-3 px-3 sm:px-5 pt-3 sm:pt-4">
          {/* Title row */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="heading-font text-lg sm:text-xl font-bold text-slate-900">Performance Tracking</h1>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate("/staff")}
              className="h-9 px-2 text-xs sm:text-sm"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </div>

          {/* Toolbar */}
          <div className="mt-2 flex flex-col lg:flex-row lg:items-center gap-3 w-full">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="flex flex-wrap sm:flex-nowrap items-center border border-input bg-background shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden rounded-lg">
                {/* Date range */}
                <div className="flex flex-nowrap items-center gap-2 px-2 h-10 sm:h-9 whitespace-nowrap">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "min-w-[132px] justify-start text-left rounded-none h-10 sm:h-9 px-2 font-medium border-0 hover:bg-transparent",
                          !fromDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="text-xs sm:text-sm">From{fromDate ? `: ${format(fromDate, "dd-MM-yyyy")}` : ""}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={fromDate ?? undefined}
                        onSelect={handleFromDateSelect}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  <span className="text-muted-foreground/60">→</span>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "min-w-[120px] justify-start text-left rounded-none h-10 sm:h-9 px-2 font-medium border-0 hover:bg-transparent",
                          !toDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="text-xs sm:text-sm">To{toDate ? `: ${format(toDate, "dd-MM-yyyy")}` : ""}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={toDate ?? undefined}
                        onSelect={handleToDateSelect}
                        disabled={fromDate ? { before: fromDate } : undefined}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Presets */}
                <div className="flex items-center px-2 h-10 sm:h-9 min-w-[170px]">
                  <Select
                    value={(['today', 'thisWeek', 'thisMonth', 'last3Months'] as string[]).includes(activeQuick || '') ? (activeQuick as any) : undefined}
                    onValueChange={(v) => {
                      const k = v as "today" | "thisWeek" | "thisMonth" | "last3Months";
                      applyPreset(k);
                    }}
                  >
                    <SelectTrigger className="h-10 sm:h-9 w-full border-0 rounded-none bg-transparent shadow-none focus:ring-0">
                      <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                      <SelectValue placeholder="Range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="thisWeek">This Week</SelectItem>
                      <SelectItem value="thisMonth">This Month</SelectItem>
                      <SelectItem value="last3Months">3 Months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex-1 flex flex-col sm:flex-row gap-2">
              <div className="relative w-full">
                <Input
                  value={search}
                  onChange={e=> setSearch(e.target.value)}
                  placeholder="Employee name"
                  className="pl-3 h-9 border-slate-200 rounded-lg bg-white text-sm"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4 px-3 sm:px-5">
          {/* KPI Cards */}
          <div className="mb-3 sm:mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
            <div className="relative overflow-hidden rounded-lg bg-white px-3 py-3 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-600">Total Revenue</p>
                <div className="h-6 w-6 rounded-md bg-emerald-100 text-emerald-600 grid place-items-center text-xs">₹</div>
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">₹{totalRevenueRounded.toLocaleString('en-IN')}</div>
              {Math.abs(totalRoundOff) > 0.01 && (
                <div className="mt-0.5 text-[11px] text-gray-500">
                  Roundoff: {totalRoundOff > 0 ? '+' : ''}₹{Math.abs(totalRoundOff).toFixed(2)}
                </div>
              )}
            </div>
            <div className="relative overflow-hidden rounded-lg bg-white px-3 py-3 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-600">Total Appointments</p>
                <div className="h-6 w-6 rounded-md bg-blue-100 text-blue-600 grid place-items-center text-xs">#</div>
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{totalAppointments}</div>
            </div>
            <div className="relative overflow-hidden rounded-lg bg-white px-3 py-3 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-600">Avg Completion Rate</p>
                <div className="h-6 w-6 rounded-md bg-purple-100 text-purple-600 grid place-items-center text-xs">%</div>
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{avgCompletionRate.toFixed(1)}%</div>
            </div>
            </div>
          </div>          {/* Team Performance Table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead className="font-semibold text-gray-700 text-xs py-2">Employee</TableHead>
                  <TableHead className="text-center font-semibold text-gray-700 text-xs py-2">Walk-ins</TableHead>
                  <TableHead className="text-center font-semibold text-gray-700 text-xs py-2">Appointments</TableHead>
                  <TableHead className="text-center font-semibold text-gray-700 text-xs py-2">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregatedData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-xs py-6">No data</TableCell>
                  </TableRow>
                )}
                {aggregatedData.map((performance: any) => {
                  const staff = staffMembers.find(s => s.id === performance.employee_id);
                  const ids: string[] = Array.isArray(performance._employeeIds) ? performance._employeeIds : [String(performance.employee_id)];
                  const walkIns = ids.reduce((sum, id) => sum + (walkInCountByEmployee[String(id)] || 0), 0);
                  const revExact = Number(performance.revenue_generated || 0) || 0;
                  const revRounded = Math.round(revExact);
                  const roundOff = Number((revRounded - revExact).toFixed(2));
                  return (
                    <TableRow key={performance.employee_id}>
                      <TableCell className="py-2">
                        <div 
                          className="cursor-pointer hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                          onClick={() => handleEmployeeClick(performance.employee_id, performance.employee_name)}
                        >
                          <div className="font-medium text-sm text-blue-600 hover:text-blue-800">{performance.employee_name}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center py-2">
                        <div className="font-medium text-sm">{walkIns}</div>
                        <div className="text-[10px] text-gray-500">Walk-ins</div>
                      </TableCell>
                      <TableCell className="text-center py-2">
                        <div>
                          <div className="font-medium text-sm">{performance.total_appointments}</div>
                          <div className="text-[10px] text-gray-500">{performance.completion_rate.toFixed(1)}% completed</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center py-2">
                        <div>
                          <div className="font-medium text-sm">₹{revRounded.toLocaleString('en-IN')}</div>
                          {Math.abs(roundOff) > 0.01 ? (
                            <div className="text-[10px] text-gray-500">
                              Roundoff: {roundOff > 0 ? '+' : ''}₹{Math.abs(roundOff).toFixed(2)}
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-500">₹{performance.average_ticket_size} avg</div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {aggregatedData.length > 0 && (
                  <TableRow className="bg-slate-50 font-semibold">
                    <TableCell className="py-2">
                      <div className="px-2 py-1">Total</div>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <div className="px-2 py-1">{totalsRow.totalWalkIns}</div>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <div className="px-2 py-1">{totalsRow.totalAppts}</div>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <div className="px-2 py-1">
                        <div className="text-sm">₹{Number(totalsRow.totalRevRounded ?? Math.round(totalsRow.totalRev || 0)).toLocaleString('en-IN')}</div>
                        {Math.abs(Number(totalsRow.totalRevRoundOff || 0)) > 0.01 && (
                          <div className="text-[10px] text-gray-500">
                            Roundoff: {Number(totalsRow.totalRevRoundOff || 0) > 0 ? '+' : ''}₹{Math.abs(Number(totalsRow.totalRevRoundOff || 0)).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Employee Work Details Modal */}
      <Dialog open={showEmployeeModal} onOpenChange={setShowEmployeeModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {selectedEmployeeDetails?.name} - Work Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedEmployeeDetails && (
            <div className="space-y-4">
              {/* Work Details Table */}
              <div className="border rounded-lg">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <h3 className="font-semibold text-gray-700">Customer Work Details</h3>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {employeeWorkDetails.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      No work records found for the selected period
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Customer</TableHead>
                          <TableHead className="text-xs">Service</TableHead>
                          <TableHead className="text-xs">Amount</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employeeWorkDetails.map((work, index) => (
                          <TableRow key={`${work.type}-${work.id}-${index}`}>
                            <TableCell>
                              {(() => {
                                let typeLabel = 'Other';
                                if (work.type === 'billing') typeLabel = 'Service';
                                else if (work.type === 'invoice') typeLabel = 'Invoice';
                                else if (work.type === 'appointment') typeLabel = 'Appointment';

                                const typeClassName =
                                  work.type === 'billing'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-blue-100 text-blue-700';

                                return (
                                  <div className={`px-2 py-1 rounded text-xs font-medium ${typeClassName}`}> 
                                    {typeLabel}
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium text-sm">{work.customer_name || 'N/A'}</div>
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {work.customer_phone || 'N/A'}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{work.service_name || 'N/A'}</div>
                              {work.invoice_id && (
                                <div className="text-xs text-gray-500">Invoice: {work.invoice_id}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium flex items-center gap-1">
                                <IndianRupee className="h-3 w-3" />
                                {(work.amount || 0).toLocaleString()}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {work.date ? format(new Date(work.date), 'MMM dd, yyyy') : 'N/A'}
                              </div>
                              {work.type === 'appointment' && work.appointment_time && (
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {work.appointment_time}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className={`px-2 py-1 rounded text-xs font-medium ${
                                work.status === 'completed' 
                                  ? 'bg-green-100 text-green-700' 
                                  : work.status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}>
                                {work.status || 'N/A'}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}