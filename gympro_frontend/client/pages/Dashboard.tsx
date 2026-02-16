import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid, Label, BarChart, Bar, ReferenceLine } from "recharts";
import { AlertTriangle, Calendar, CheckCircle, Clock, XCircle, IndianRupee, MapPin, Users, UserCheck, TrendingUp, Calculator, FileText, UserCog, CreditCard, RotateCcw, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { DataService } from "@/services/userService";
import { BookingsService } from "@/services/bookingsService";
import { AppointmentTransactionService } from "@/services/appointmentTransactionService";
import { ApiService } from "@/services/apiService";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { formatYMDIST } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// Helper date utils
const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isSameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d; };
const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23,59,59,999); return d; };

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const accountCode = (user as any)?.account_code || "";
  const retailCode = (user as any)?.retail_code || "";

  const getBillStatus = (bill: any): string => {
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
    return String(raw || '').trim().toUpperCase();
  };
  const isBilledInvoice = (bill: any): boolean => getBillStatus(bill) === 'Y';
  
  // Debug: Log user account details
  useEffect(() => {
    
  }, [user]);

  const [bookings, setBookings] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [paymodes, setPaymodes] = useState<any[]>([]);
  const [halls, setHalls] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [hallBookings, setHallBookings] = useState<any[]>([]);
  // New states for all transactions
  const [appointmentTransactions, setAppointmentTransactions] = useState<any[]>([]);
  const [billingTransactions, setBillingTransactions] = useState<any[]>([]);
  const [billingPayments, setBillingPayments] = useState<any[]>([]);
  const [billingLineRows, setBillingLineRows] = useState<any[]>([]);
  const [customerRangeMetrics, setCustomerRangeMetrics] = useState<{ customer_visits: number; new_customers: number; existing_customers: number; total_visits: number }>(
    { customer_visits: 0, new_customers: 0, existing_customers: 0, total_visits: 0 }
  );
  const [employeeNameById, setEmployeeNameById] = useState<Record<string, string>>({});
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [incomeExpenseKPI, setIncomeExpenseKPI] = useState({ income: 0, expense: 0, net: 0, incomeCount: 0, expenseCount: 0 });
  const [incomeExpenseLoading, setIncomeExpenseLoading] = useState(false);
  const [staffSplitOpen, setStaffSplitOpen] = useState(false);
  const [staffSplitQuery, setStaffSplitQuery] = useState('');
  // Pagination for Recent Transactions
  const [txnPage, setTxnPage] = useState<number>(1);
  const txnPageSize = 5;
  // Filters: date range + quick presets
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [activeQuick, setActiveQuick] = useState<"today" | "thisWeek" | "thisMonth" | "last3Months" | null>("today");
  const atStartOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const atEndOfDay = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  const startOfWeek = (d: Date) => {
    const x = new Date(d);
    const day = x.getDay(); // 0 Sun - 6 Sat
    x.setDate(x.getDate() - day); // Sunday as start
    x.setHours(0,0,0,0);
    return x;
  };
  const endOfWeek = (d: Date) => { const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23,59,59,999); return e; };
  const startOfMonth = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0,0,0,0); return x; };
  const endOfMonth = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(23,59,59,999); return x; };

  // Initialize default range to today
  useEffect(() => {
    const now = new Date();
    setStartDate(atStartOfDay(now));
    setEndDate(atEndOfDay(now));
    setActiveQuick("today");
  }, []);

  // Load payments specifically for the Last 7 Days Sales Trend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!accountCode || !retailCode) return;
        // Compute last 7 days window based on today (independent of range filters)
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const fromStr = fmt(start);
        const toStr = fmt(today);

        const res = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate: fromStr, todate: toStr });
        const rows: any[] = (res && Array.isArray((res as any).data)) ? (res as any).data : (Array.isArray(res) ? (res as any) : []);
        // Flatten all payment rows
        const flatPays: any[] = [];
        for (const entry of rows) {
          const pays = Array.isArray(entry?.payments) ? entry.payments : [];
          for (const p of pays) flatPays.push(p);
        }
        if (!cancelled) setPayments(flatPays);
      } catch (e) {
        // Non-fatal: keep payments empty; chart will fallback to billing when available
        if (!cancelled) setPayments([]);
      }
    })();
    return () => { cancelled = true; };
  }, [accountCode, retailCode]);

  // Load core masters and appointments for the selected range
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!accountCode || !retailCode) return;
        // Single /read call for all needed master tables
        const resp = await DataService.readData(
          ['master_appointment', 'master_customer', 'master_hall', 'master_slot', 'master_paymentmodes', 'master_employee'],
          accountCode,
          retailCode
        ).catch(() => ({ data: {} }));

        if (cancelled) return;

        const raw = (resp as any)?.data;
        const root: any = raw && typeof raw === 'object' ? raw : {};

        // Appointments (may be keyed or a flat array depending on backend)
        let appts: any[] = [];
        if (Array.isArray(raw)) {
          if (raw.length && raw.every((r: any) => typeof r === 'object' && ('appointment_date' in r || 'appointment_id' in r))) {
            appts = raw as any[];
          }
        } else {
          appts = root.master_appointment || root.appointments || root.masterAppointments || [];
        }

        // Client-side range filter (inclusive)
        const fromTs = startDate ? atStartOfDay(startDate).getTime() : undefined;
        const toTs = endDate ? atEndOfDay(endDate).getTime() : undefined;
        const apptsInRange = (Array.isArray(appts) ? appts : []).filter((r: any) => {
          const d = r?.appointment_date;
          if (!d) return false;
          const t = new Date(d).getTime();
          if (fromTs != null && t < fromTs) return false;
          if (toTs != null && t > toTs) return false;
          return true;
        });

        // Normalize masters
        const custs: any[] = root.master_customer || root.customers || root.customer || [];
        const hallsRows: any[] = root.master_hall || root.halls || [];
        const slotsRows: any[] = root.master_slot || root.slots || root.shift_slots || [];

        // Payment modes
        const pmRows: any[] = root.master_paymentmodes || root.payment_modes || root.paymentmode || root.paymentmodes || [];
        const normalizedPaymodes = (pmRows || []).map((r: any) => ({
          id: String(r.id ?? r.payment_mode_id ?? r.payment_id ?? r.code ?? r.paymode_id ?? ''),
          payment_mode_name: String(r.payment_mode_name ?? r.name ?? r.mode ?? r.description ?? '').trim(),
          status: r.status ?? r.is_active ?? 1,
        })).filter((r: any) => r.payment_mode_name);
        const activePaymodes = normalizedPaymodes.filter((r: any) => String(r.status).toLowerCase() !== '0');

        // Employees: build id -> name map for Staff Performance
        const emps: any[] = root.master_employee || root.employees || root.employee || [];
        const empMap: Record<string, string> = {};
        for (const e of (Array.isArray(emps) ? emps : [])) {
          const id =
            e.employee_id ?? e.EMPLOYEE_ID ??
            e.emp_id ?? e.EMP_ID ??
            e.staff_id ?? e.STAFF_ID ??
            e.id ?? e.ID ??
            e.code ?? e.CODE ??
            e.employee_code ?? e.EMPLOYEE_CODE;
          const name =
            e.employee_name ?? e.EMPLOYEE_NAME ??
            e.emp_name ?? e.EMP_NAME ??
            e.name ?? e.NAME ??
            e.full_name ?? e.FULL_NAME ??
            e.username ?? e.USERNAME;
          if (id != null && String(id).trim() && name) {
            empMap[String(id).trim()] = String(name).trim();
          }
        }

        setBookings(apptsInRange);
        setCustomers(Array.isArray(custs) ? custs : []);
        setHalls(Array.isArray(hallsRows) ? hallsRows : []);
        setSlots(Array.isArray(slotsRows) ? slotsRows : []);
        setPaymodes(activePaymodes.length ? activePaymodes : normalizedPaymodes);
        setEmployeeNameById(empMap);
      } catch (e) {
        if (cancelled) return;
        // Fail safe to empty arrays to avoid runtime errors
        setBookings([]);
        setCustomers([]);
        setHalls([]);
        setSlots([]);
        setPaymodes([]);
        setEmployeeNameById({});
      }
    })();
    return () => { cancelled = true; };
  }, [accountCode, retailCode, startDate, endDate]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {

      
      if (!accountCode || !retailCode) {

        return;
      }
      if (!startDate || !endDate) {

        return;
      }
      

      
      try {
        setTransactionsLoading(true);
        setIncomeExpenseLoading(true);

        // Match Billing/Performance screens: IST-safe date formatting for API filters
        const fromDateStr = formatYMDIST(startDate);
        const toDateStr = formatYMDIST(endDate);

        // Build params with from/to dates so backend filters server-side
        const btParams = new URLSearchParams({
          account_code: accountCode,
          retail_code: retailCode,
          // Avoid truncation: dashboard KPIs must reflect full range like Billing page
          limit: '5000',
          // Fetch only invoice summary rows (faster): backend skips per-invoice detail expansion
          sendalldata: 'N'
        });
        if (fromDateStr) btParams.append('from_date', fromDateStr);
        if (toDateStr) btParams.append('to_date', toDateStr);

        // Billing line endpoints used by Billing page for accurate staff attribution
        const baseLineParams = new URLSearchParams({
          account_code: accountCode,
          retail_code: retailCode,
        });
        if (fromDateStr) baseLineParams.append('from_date', fromDateStr);
        if (toDateStr) baseLineParams.append('to_date', toDateStr);

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

        const payParams = new URLSearchParams({ account_code: accountCode, retail_code: retailCode });
        if (fromDateStr) payParams.append('from_date', fromDateStr);
        if (toDateStr) payParams.append('to_date', toDateStr);

        const custParams = new URLSearchParams({ account_code: accountCode, retail_code: retailCode });
        if (fromDateStr) custParams.append('from_date', fromDateStr);
        if (toDateStr) custParams.append('to_date', toDateStr);

        // Run all range-dependent calls in parallel
        const fromStrYMD = format(startDate, 'yyyy-MM-dd');
        const toStrYMD = format(endDate, 'yyyy-MM-dd');

        const [apptTxnRes, billingRes, billingPayRes, incomeExpenseRes, svcLinesRes, pkgLinesRes, invLinesRes, custMetricsRes] = await Promise.allSettled([
          AppointmentTransactionService.list(accountCode, retailCode, fromDateStr, toDateStr),
          ApiService.get(`/billing-transitions?${btParams.toString()}`),
          ApiService.get(`/billing-payments?${payParams.toString()}`),
          DataService.getIncomeExpenses(fromStrYMD, toStrYMD, accountCode, retailCode),
          fetchPagedLines('/billing-trans-services'),
          fetchPagedLines('/billing-trans-packages'),
          fetchPagedLines('/billing-trans-inventory'),
          ApiService.get(`/customer-metrics?${custParams.toString()}`),
        ]);

        if (!mounted) return;

        // Appointment transactions
        const appointmentTxns: any[] = apptTxnRes.status === 'fulfilled' ? ((apptTxnRes.value as any)?.data || []) : [];
        setAppointmentTransactions(appointmentTxns);

        // Billing transactions
        let billingTxns: any[] = [];
        if (billingRes.status === 'fulfilled') {
          const v: any = billingRes.value;
          const allBilling = Array.isArray(v?.data?.data)
            ? v.data.data
            : (Array.isArray(v?.data) ? v.data : (Array.isArray(v) ? v : []));
          billingTxns = allBilling || [];
        }
        setBillingTransactions(billingTxns);

        // Billing payments
        const billingPaymentsData: any[] = billingPayRes.status === 'fulfilled' ? (((billingPayRes.value as any)?.data) || []) : [];
        setBillingPayments(billingPaymentsData);

        // Customer metrics (visits/new/existing)
        try {
          if (custMetricsRes.status === 'fulfilled') {
            const v: any = custMetricsRes.value;
            setCustomerRangeMetrics({
              customer_visits: Number(v?.customer_visits ?? 0) || 0,
              new_customers: Number(v?.new_customers ?? 0) || 0,
              existing_customers: Number(v?.existing_customers ?? 0) || 0,
              total_visits: Number(v?.total_visits ?? 0) || 0,
            });
          } else {
            setCustomerRangeMetrics({ customer_visits: 0, new_customers: 0, existing_customers: 0, total_visits: 0 });
          }
        } catch {
          setCustomerRangeMetrics({ customer_visits: 0, new_customers: 0, existing_customers: 0, total_visits: 0 });
        }

        // Billing line rows (services/packages/inventory)
        const svcRows: any[] = svcLinesRes.status === 'fulfilled' ? (svcLinesRes.value as any) : [];
        const pkgRows: any[] = pkgLinesRes.status === 'fulfilled' ? (pkgLinesRes.value as any) : [];
        const invRows: any[] = invLinesRes.status === 'fulfilled' ? (invLinesRes.value as any) : [];
        // fetchPagedLines returns arrays directly
        setBillingLineRows([...(svcRows || []), ...(pkgRows || []), ...(invRows || [])]);

        // Income / expense KPI
        try {
          const rows: any[] = incomeExpenseRes.status === 'fulfilled'
            ? (((incomeExpenseRes.value as any)?.data) || ((incomeExpenseRes.value as any)?.rows) || ((incomeExpenseRes.value as any)?.items) || [])
            : [];

          let income = 0;
          let expense = 0;
          let incomeCount = 0;
          let expenseCount = 0;

          (rows || []).forEach((r: any) => {
            const type = String(r?.type ?? '').toLowerCase();
            const amount = Number(r?.amount ?? r?.total_amount ?? r?.total ?? 0) || 0;
            if (!amount) return;
            if (type === 'income' || type === 'inflow') {
              income += amount;
              incomeCount += 1;
            } else if (type === 'expense' || type === 'outflow') {
              expense += amount;
              expenseCount += 1;
            }
          });
          setIncomeExpenseKPI({ income, expense, net: income - expense, incomeCount, expenseCount });
        } catch {
          setIncomeExpenseKPI({ income: 0, expense: 0, net: 0, incomeCount: 0, expenseCount: 0 });
        }
      } finally {
        if (mounted) setTransactionsLoading(false);
        if (mounted) setIncomeExpenseLoading(false);
      }
    };
    
  load();
    return () => { mounted = false; };
  }, [accountCode, retailCode, startDate, endDate]);

  // Normalize and combine all transactions (no network)
  useEffect(() => {
    const normalizedTransactions = normalizeAllTransactions(
      bookings,
      appointmentTransactions,
      billingTransactions,
      startDate,
      endDate
    );
    setAllTransactions(normalizedTransactions);
  }, [bookings, appointmentTransactions, billingTransactions, startDate, endDate]);

  const applyPreset = (k: "today" | "thisWeek" | "thisMonth" | "last3Months") => {
    const now = new Date();
    if (k === "today") {
      setStartDate(startOfToday());
      setEndDate(endOfToday());
    } else if (k === "thisWeek") {
      setStartDate(startOfWeek(now));
      setEndDate(endOfWeek(now));
    } else if (k === "thisMonth") {
      setStartDate(startOfMonth(now));
      setEndDate(endOfMonth(now));
    } else if (k === "last3Months") {
      const from = new Date(now);
      from.setMonth(now.getMonth() - 2);
      setStartDate(atStartOfDay(from));
      setEndDate(endOfToday());
    }
    setActiveQuick(k);
  };

  const handleStartDateSelect = (date?: Date) => {
    if (!date) {
      setStartDate(null);
      setActiveQuick(null);
      return;
    }
    const d = atStartOfDay(date);
    setStartDate(d);
    setActiveQuick(null);
    if (endDate && d > endDate) setEndDate(atEndOfDay(d));
  };

  const handleEndDateSelect = (date?: Date) => {
    if (!date) {
      setEndDate(null);
      setActiveQuick(null);
      return;
    }
    const d = atEndOfDay(date);
    setEndDate(d);
    setActiveQuick(null);
    if (startDate && d < startDate) setStartDate(atStartOfDay(d));
  };

  // Canonical booking key resolver + variants across heterogeneous schemas
  const getBookingKeyCandidates = (row: any): string[] => {
    const raw = [
      row?.booking_pk,
      row?.booking_id,
      row?.bookingID,
      row?.bookingId,
      row?.bookingid,
      row?.booking,
      row?.reservation_id,
      row?.reservationID,
      row?.reservation_no,
      row?.booking_code,
      row?.booking_display_id,
      row?.booking_no,
      row?.booking_number,
      row?.order_id,
      row?.orderID,
      row?.order_no,
      row?.invoice_no,
      row?.id,
      row?._id,
      // sometimes values hide under generic fields
      row?.code,
      row?.no,
      row?.number,
    ];
    return raw
      .map((x) => (x !== undefined && x !== null ? String(x).trim() : ""))
      .filter((s, idx, arr) => s.length > 0 && arr.indexOf(s) === idx);
  };
  const getBookingKey = (row: any): string => {
    const list = getBookingKeyCandidates(row);
    return list.length ? list[0] : "";
  };

  const hallNameMap = useMemo(() => {
    const m = new Map<string, string>();
    (halls || []).forEach((h: any) => {
      const name = String(h.hall_name || h.name || h.description || "").trim();
      const ids = [h.hall_id, h.id, h._id, h.code, h.hallcode];
      ids.forEach((v) => {
        if (v != null) m.set(String(v), name || String(v));
      });
      if (name) m.set(name, name);
    });
    return m;
  }, [halls]);

  const slotNameMap = useMemo(() => {
    const m = new Map<string, string>();
    (slots || []).forEach((s: any) => {
      const name = String(s.slot_name || s.name || s.description || "").trim();
      const ids = [s.slot_id, s.id, s._id, s.code, s.slotcode];
      ids.forEach((v) => { if (v != null) m.set(String(v), name || String(v)); });
      if (name) m.set(name, name);
    });
    // common names
    m.set('dual', 'Dual');
    return m;
  }, [slots]);

  const normalizedBookings = useMemo(() => {
    return (bookings || []).map((r, idx) => {
  const dateStr = r.appointment_date || r.eventdate || r.booking_date || r.date || r.created_at || r.start_time;
      const d = dateStr ? new Date(dateStr) : new Date();
      const cancelDateStr =
        r.cancel_date ||
        r.cancelled_date ||
        r.cancelled_at ||
        r.canceled_at ||
        r.cancel_datetime ||
        r.cancelDate;
      const cancelDate = cancelDateStr ? new Date(cancelDateStr) : null;
      const safeCancelDate = cancelDate && !Number.isNaN(cancelDate.getTime()) ? cancelDate : null;
      const totalAmount = Number(r.total_amount ?? r.amount ?? r.total ?? 0) || 0;
  const advancePaid = Number(r.advance_paid ?? r.paid ?? 0) || 0;
  const balanceDue = Number(r.balance_due ?? r.balance ?? Math.max((totalAmount - advancePaid), 0)) || 0;
      const cgst = Number(r.cgst_amount ?? 0) || 0;
      const sgst = Number(r.sgst_amount ?? 0) || 0;
      const taxAmount = Number(r.tax_amount != null ? r.tax_amount : (cgst + sgst)) || 0;
      const taxableAmount = (() => {
        const hallRate = Number(r.hall_rate ?? 0) || 0;
        const svcTotal = Number(r.services_total ?? 0) || 0;
        const discount = Number(r.discount ?? 0) || 0;
        const calc = hallRate + svcTotal - discount;
        if (calc > 0) return calc;
        // fallback: if total includes tax, taxable = total - tax
        return Math.max((totalAmount || 0) - (taxAmount || 0), 0);
      })();
      const statusRaw = String(r.status ?? r.STATUS ?? "").toLowerCase();
      const status = statusRaw === "canceled" ? "cancelled" : (statusRaw || "");
      const customer = r.customer_name || r.customer || r.customer_full_name || r.name || "";
      // Prefer a human-friendly hall name when possible
      const hallNameCandidate = r.hall_name || r.hallname || r.hall_description || r.hall_desc || r.hall_title || "";
      const hallIdCandidate = r.hall || r.hallid || r.hall_id || r.hall_code || r.hallcode || "";
      const toStr = (v: any) => (v != null ? String(v).trim() : "");
      let hall = toStr(hallNameCandidate) || toStr(hallIdCandidate);
      // Try mapping using halls collection
      if (hall && hallNameMap.size) {
        const mapped = hallNameMap.get(hall);
        if (mapped) hall = mapped;
      }
      // Avoid showing bare numeric IDs as labels
      const isNumericLike = (s: string) => /^\d+(?:\.\d+)?$/.test(s);
      if (!hall || isNumericLike(hall)) {
        const fallback = toStr(hallNameCandidate);
        hall = fallback && !isNumericLike(fallback) ? fallback : "Unknown";
      }
      const guests = Number(r.guest_count || r.guests || 0) || 0;
  // staff resolution
  const staffNameCandidate = r.staff_name || r.staff || r.employee_name || "";
  const staffIdCandidate = r.staff_id || r.staffid || r.employee_id || "";
  let staff = (r => (r != null ? String(r).trim() : ""))(staffNameCandidate) || (r => (r != null ? String(r).trim() : ""))(staffIdCandidate);
      if (!staff) staff = 'Unassigned';
  else if (/^\d+(?:\.\d+)?$/.test(staff)) staff = `Staff ${staff}`;
      // slot resolution
      const slotNameCandidate = r.slot_name || r.slotname || r.slot_desc || r.slot_description || "";
      const slotIdCandidate = r.slot || r.slot_id || "";
      let slot = String(slotNameCandidate || slotIdCandidate || '').trim();
  if (slot && slotNameMap.size) {
        const mapped = slotNameMap.get(slot) || slotNameMap.get(String(slotIdCandidate || ''));
        if (mapped) slot = mapped;
      }
  if (!slot || isNumericLike(slot)) slot = slotNameMap.get(String(slotIdCandidate || '')) || (slot ? `Slot ${slot}` : 'Unknown');
      const keyVariants = getBookingKeyCandidates(r);
      const id = (keyVariants[0] || `bk-${idx}`);
      const paymentMode = String(r.payment_mode || r.paymentMode || '').trim();
      return { id, keyVariants, date: d, cancelDate: safeCancelDate, totalAmount, taxAmount, cgstAmount: cgst, sgstAmount: sgst, taxableAmount, status, customer, hall, slot, guests, advancePaid, balanceDue, staff, paymentMode } as {
        id: string;
        keyVariants: string[];
        date: Date;
        cancelDate: Date | null;
        totalAmount: number;
        taxAmount: number;
        cgstAmount: number;
        sgstAmount: number;
        taxableAmount: number;
        status: string;
        customer: string;
        hall: string;
        slot: string;
        guests: number;
        advancePaid: number;
        balanceDue: number;
        staff: string;
        paymentMode: string;
      };
    });
  }, [bookings, hallNameMap, slotNameMap]);

  // Create a map from booking identifiers to the booking object for quick join with hallBookings
  const bookingByKey = useMemo(() => {
    const m = new Map<string, any>();
    (bookings || []).forEach((b: any) => {
      getBookingKeyCandidates(b).forEach((k) => { if (k) m.set(k, b); });
    });
    return m;
  }, [bookings]);

  // Occurrence-level normalization using hallbooking rows (each with its own eventdate/status)
  const normalizedOccurrences = useMemo(() => {
    // If no hallBookings, fall back to normalizedBookings
    if (!hallBookings || hallBookings.length === 0) return normalizedBookings;

    const out: Array<{
      id: string;
      keyVariants: string[];
      date: Date;
      cancelDate: Date | null;
      totalAmount: number;
      taxAmount: number;
      cgstAmount: number;
      sgstAmount: number;
      taxableAmount: number;
      status: string;
      customer: string;
      hall: string;
      slot: string;
      guests: number;
    }> = [];

    const toStr = (v: any) => (v != null ? String(v).trim() : "");

    (hallBookings || []).forEach((hb: any, idx: number) => {
      const eventDateStr = hb.eventdate || hb.event_date || hb.date || hb.booking_date || hb.created_at;
      const d = eventDateStr ? new Date(eventDateStr) : new Date();
      const cancelDateStr =
        hb.cancel_date ||
        hb.cancelled_date ||
        hb.cancelled_at ||
        hb.canceled_at ||
        hb.cancel_datetime ||
        hb.cancelDate;
      const cancelDateRaw = cancelDateStr ? new Date(cancelDateStr) : null;
      const safeCancelDate = cancelDateRaw && !Number.isNaN(cancelDateRaw.getTime()) ? cancelDateRaw : null;
      const statusRaw = String(hb.status ?? hb.STATUS ?? "").toLowerCase();
      const status = statusRaw === "canceled" ? "cancelled" : (statusRaw || "");

      // Join with booking master to get amounts and customer
      const bookingKeyCandidates = getBookingKeyCandidates(hb);
      let master: any = null;
      for (const k of bookingKeyCandidates) {
        const found = bookingByKey.get(k);
        if (found) { master = found; break; }
      }
      // If not found via hb, try using hb.booking_id-like fields mapped from master
      if (!master && bookings && bookings.length) {
        const hbCode = toStr(hb.code || hb.booking_code || hb.booking_no || hb.booking_number || hb.booking_id || hb.id || hb._id);
        if (hbCode) {
          for (const b of bookings) {
            const ks = getBookingKeyCandidates(b);
            if (ks.includes(hbCode)) { master = b; break; }
          }
        }
      }

      const totalAmount = Number(master?.total_amount ?? master?.amount ?? master?.total ?? 0) || 0;
      const cgst = Number(master?.cgst_amount ?? 0) || 0;
      const sgst = Number(master?.sgst_amount ?? 0) || 0;
      const taxAmount = Number(master?.tax_amount != null ? master?.tax_amount : (cgst + sgst)) || 0;
      const taxableAmount = (() => {
        const hallRate = Number(master?.hall_rate ?? 0) || 0;
        const svcTotal = Number(master?.services_total ?? 0) || 0;
        const discount = Number(master?.discount ?? 0) || 0;
        const calc = hallRate + svcTotal - discount;
        if (calc > 0) return calc;
        return Math.max((totalAmount || 0) - (taxAmount || 0), 0);
      })();

      const customer = master?.customer_name || master?.customer || master?.customer_full_name || master?.name || "";

      // Hall/slot resolution from hb first, then fallback to master
      const hallNameCandidate = hb.hall_name || hb.hallname || hb.hall_description || master?.hall_name || master?.hall_description || "";
      const hallIdCandidate = hb.hall || hb.hallid || hb.hall_id || hb.hall_code || hb.hallcode || master?.hall || master?.hall_id || "";
      let hall = toStr(hallNameCandidate) || toStr(hallIdCandidate);
      if (hall && hallNameMap.size) {
        const mapped = hallNameMap.get(hall);
        if (mapped) hall = mapped;
      }
      const isNumericLike = (s: string) => /^\d+(?:\.\d+)?$/.test(s);
      if (!hall || isNumericLike(hall)) {
        const fallback = toStr(hallNameCandidate);
        hall = fallback && !isNumericLike(fallback) ? fallback : "Unknown";
      }

      const slotNameCandidate = hb.slot_name || hb.slotname || hb.slot_desc || hb.slot_description || master?.slot_name || "";
      const slotIdCandidate = hb.slot || hb.slot_id || master?.slot || master?.slot_id || "";
      let slot = String(slotNameCandidate || slotIdCandidate || '').trim();
      if (slot && slotNameMap.size) {
        const mapped = slotNameMap.get(slot) || slotNameMap.get(String(slotIdCandidate || ''));
        if (mapped) slot = mapped;
      }
      if (!slot || isNumericLike(slot)) slot = slotNameMap.get(String(slotIdCandidate || '')) || (slot ? `Slot ${slot}` : 'Unknown');

  const guests = Number(master?.guest_count || master?.guests || 0) || 0;
  // staff from hallbooking or master
  const staffNameCandidate = hb.staff_name || hb.staff || master?.staff_name || master?.staff || '';
  const staffIdCandidate = hb.staff_id || hb.staffid || master?.staff_id || master?.staffid || '';
  const toStr2 = (v: any) => (v != null ? String(v).trim() : '');
  let staff = toStr2(staffNameCandidate) || toStr2(staffIdCandidate);
  const isNumericLike2 = (s: string) => /^\d+(?:\.\d+)?$/.test(s);
  if (!staff) staff = 'Unassigned';
  else if (isNumericLike2(staff)) staff = `Staff ${staff}`;

      const advancePaid = Number(master?.advance_paid ?? master?.paid ?? 0) || 0;
      const balanceDue = Number(master?.balance_due ?? master?.balance ?? Math.max((totalAmount - advancePaid), 0)) || 0;
      const keyVariants = master ? getBookingKeyCandidates(master) : bookingKeyCandidates;
      const id = (keyVariants[0] || `occ-${idx}`);
      const paymentMode = String(master?.payment_mode || hb.payment_mode || '').trim();
      // Prefer hb cancel date; fall back to master cancel date if present
      const masterCancelDateStr =
        master?.cancel_date ||
        master?.cancelled_date ||
        master?.cancelled_at ||
        master?.canceled_at ||
        master?.cancel_datetime ||
        master?.cancelDate;
      const masterCancelDateRaw = masterCancelDateStr ? new Date(masterCancelDateStr) : null;
      const safeMasterCancelDate = masterCancelDateRaw && !Number.isNaN(masterCancelDateRaw.getTime()) ? masterCancelDateRaw : null;

      out.push({ id, keyVariants, date: d, cancelDate: safeCancelDate ?? safeMasterCancelDate, totalAmount, taxAmount, cgstAmount: cgst, sgstAmount: sgst, taxableAmount, status, customer, hall, slot, guests, advancePaid, balanceDue, staff, paymentMode } as any);
    });

    return out;
  }, [hallBookings, bookings, hallNameMap, slotNameMap, bookingByKey, normalizedBookings]);

  const today = startOfToday();
  const thisMonth = new Date();

  const bookingSummary = useMemo(() => {
    let todayCount = 0, weekCount = 0, monthCount = 0;
    const weekStart = startOfWeek(new Date());
    const weekEnd = endOfWeek(new Date());
    const lastWeekStart = atStartOfDay(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7));
    const lastWeekEnd = atEndOfDay(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1));
    let lastWeekCount = 0;
    
    normalizedBookings.forEach((b) => {
      if (isSameDay(b.date, today)) todayCount++;
      if (b.date >= weekStart && b.date <= weekEnd) weekCount++;
      if (b.date >= lastWeekStart && b.date <= lastWeekEnd) lastWeekCount++;
      if (isSameMonth(b.date, thisMonth)) monthCount++;
    });
    
    const weekTrend = lastWeekCount > 0 ? ((weekCount - lastWeekCount) / lastWeekCount * 100).toFixed(1) : '0';
    return { today: todayCount, week: weekCount, month: monthCount, weekTrend: Number(weekTrend) };
  }, [normalizedBookings]);

  // Appointments count for the selected date filters (fallback to current month when no filters)
  const appointmentsInRange = useMemo(() => {
    const fromMid = startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) : null;
    const toMid = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) : null;
    const inRange = (d: Date) => {
      if (fromMid && d < fromMid) return false;
      if (toMid && d > toMid) return false;
      return true;
    };
    const list = (normalizedBookings || []).filter(b => inRange(b.date));
    // When no filters are set, fall back to this month (preserves previous behavior)
    if (!fromMid && !toMid) {
      const now = new Date();
      return (normalizedBookings || []).filter(b => isSameMonth(b.date, now)).length;
    }
    return list.length;
  }, [normalizedBookings, startDate, endDate]);

  // Payments summed by any known booking identifier
  const paidByBooking = useMemo(() => {
    const m = new Map<string, number>();
    (payments || []).forEach((p: any) => {
      const variants = getBookingKeyCandidates({
        booking_pk: p?.booking_pk,
        booking_id: p?.booking_id,
        bookingID: p?.bookingID,
        bookingId: p?.bookingId,
        bookingid: p?.bookingid,
        booking: p?.booking,
        reservation_id: p?.reservation_id,
        reservationID: p?.reservationID,
        reservation_no: p?.reservation_no,
        booking_code: p?.booking_code,
        booking_display_id: p?.booking_display_id,
        booking_no: p?.booking_no,
        booking_number: p?.booking_number,
        order_id: p?.order_id,
        orderID: p?.orderID,
        order_no: p?.order_no,
        invoice_no: p?.invoice_no,
        id: p?.id,
        _id: p?._id,
        code: p?.code,
        no: p?.no,
        number: p?.number,
      });
      const amt = Number(p.amount || p.paid_amount || 0) || 0;
      if (!variants.length || !amt) return;
      variants.forEach((k) => m.set(k, (m.get(k) || 0) + amt));
    });
    return m;
  }, [payments]);

  const revenue = useMemo(() => {
    const monthBookings = normalizedBookings.filter((b) => isSameMonth(b.date, thisMonth));
    let totalSales = 0, collected = 0;
    monthBookings.forEach((b) => {
      totalSales += b.totalAmount || 0;
      collected += paidByBooking.get(String(b.id)) || 0;
    });
    const pending = Math.max(totalSales - collected, 0);
    return { totalSales, collected, pending };
  }, [normalizedBookings, paidByBooking]);

  const totalRevenue = revenue.collected + revenue.pending;

  // Removed Slot Utilization widget and related calculations

  // Staff distribution for selected date range (SALES by staff)
  const staffDistribution = useMemo(() => {
    const inRange = (d: Date) => {
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    };

    // Build a set of billed invoice keys from billing-transitions (authoritative bill status)
    const normInvKeys = (raw: any): string[] => {
      const s0 = String(raw ?? '').trim();
      if (!s0) return [];
      const out = new Set<string>();
      const s = s0.replace(/\s+/g, '');
      out.add(s0);
      out.add(s);
      const upper = s.toUpperCase();
      out.add(upper);

      // Common forms: INV-1181, INV1181, 1181
      const digitsOnly = upper.replace(/\D+/g, '');
      if (digitsOnly) {
        out.add(digitsOnly);
        out.add(`INV-${digitsOnly}`);
        out.add(`INV${digitsOnly}`);
      }

      // If it starts with INV, add tail after INV / INV- / INV:
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
    (billingTransactions || []).forEach((bill: any) => {
      const billDate =
        bill?.last_created_at ??
        bill?.txn_created_at ??
        bill?.created_at ??
        bill?.invoice_date ??
        bill?.date ??
        bill?.LAST_CREATED_AT ??
        bill?.TXN_CREATED_AT ??
        bill?.CREATED_AT ??
        bill?.INVOICE_DATE ??
        bill?.DATE;
      if (!billDate) return;
      const d = new Date(billDate);
      if (Number.isNaN(d.getTime()) || !inRange(d)) return;
      if (!isBilledInvoice(bill)) return;
      const candidates = [
        bill?.invoice_id,
        bill?.txn_invoice_id,
        bill?.bill_id,
        bill?.id,
        bill?.invoice_no,
        bill?.invoice_number,
        bill?.txn_invoice_no,
        bill?.INVOICE_ID,
        bill?.TXN_INVOICE_ID,
        bill?.BILL_ID,
        bill?.ID,
        bill?.INVOICE_NO,
        bill?.INVOICE_NUMBER,
        bill?.TXN_INVOICE_NO,
      ];
      candidates
        .filter((v: any) => v != null && String(v).trim() !== '')
        .forEach((v: any) => normInvKeys(v).forEach((k) => billedInvoiceKeys.add(k)));
    });

    const m = new Map<string, number>();

    const getLineAmount = (row: any): number => {
      const taxable = Number(
        row?.taxable_amount ??
        row?.taxableAmount ??
        row?.TAXABLE_AMOUNT ??
        row?.TAXABLEAMOUNT
      );
      const tax = Number(
        row?.tax_amount ??
        row?.taxAmount ??
        row?.TAX_AMOUNT ??
        row?.TAXAMOUNT ??
        0
      );
      const discount = Number(
        row?.discount_amount ??
        row?.discountAmount ??
        row?.DISCOUNT_AMOUNT ??
        row?.DISCOUNTAMOUNT ??
        0
      );
      const membershipDiscount = Number(
        row?.membership_discount ??
        row?.membershipDiscount ??
        row?.MEMBERSHIP_DISCOUNT ??
        row?.MEMBERSHIPDISCOUNT ??
        0
      );
      if (!Number.isNaN(taxable) && taxable !== 0) {
        return Math.max(
          0,
          taxable + (Number.isNaN(tax) ? 0 : tax) - (Number.isNaN(discount) ? 0 : discount) - (Number.isNaN(membershipDiscount) ? 0 : membershipDiscount)
        );
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
      const ds =
        row?.created_at ??
        row?.updated_at ??
        row?.date ??
        row?.entry_date ??
        row?.billing_date ??
        row?.CREATED_AT ??
        row?.UPDATED_AT ??
        row?.DATE ??
        row?.ENTRY_DATE ??
        row?.BILLING_DATE;
      if (!ds) return null;
      const d = new Date(ds);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    // Source: billing line rows (services/packages/inventory), billed-only
    const lineRowsInRange = (billingLineRows || []).filter((r: any) => {
      const d = parseRowDate(r);
      if (!d) return false;
      if (!inRange(d)) return false;

      // billing-trans-* line tables may not carry bill status; prefer billed invoice header mapping.
      if (billedInvoiceKeys.size > 0) {
        const rawId = r?.invoice_id ?? r?.billing_id ?? r?.bill_id ?? r?.invoice_no ?? r?.invoice_number ?? r?.id ?? r?.INVOICE_ID ?? r?.BILL_ID ?? r?.INVOICE_NO ?? r?.INVOICE_NUMBER ?? r?.ID;
        const keys = normInvKeys(rawId);
        return keys.some((k) => billedInvoiceKeys.has(k));
      }

      // Fallback: if line row has bill status columns, use them; otherwise include row.
      const st = getBillStatus(r);
      if (st) return st === 'Y';
      return true;
    });

    lineRowsInRange.forEach((r: any) => {
      const staffName = String(
        r?.employee_name ??
        r?.staff_name ??
        r?.stylist_name ??
        r?.txn_employee_name ??
        r?.employeeDetails ??
        r?.EMPLOYEE_NAME ??
        r?.EMP_NAME ??
        r?.STAFF_NAME ??
        r?.STYLIST_NAME ??
        r?.TECHNICIAN_NAME ??
        r?.technician_name ??
        ''
      ).trim();
      const staffId = String(
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
      const inferredId = staffId || tryIdFromName();
      const mappedName = inferredId ? (employeeNameById?.[inferredId] || '') : '';
      const staff = mappedName || staffName || (inferredId ? `Staff ${inferredId}` : 'Unassigned');

      const amount = getLineAmount(r);
      if (!(amount > 0)) return;
      m.set(staff, (m.get(staff) || 0) + amount);
    });

    // Note: billedInvoiceKeys already comes from /billing-transitions when available.

    const palette = ["#6366F1", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7", "#84CC16"];
    // Round-off values to nearest rupee for display consistency
    return Array.from(m.entries()).map(([name, value], idx) => ({
      name: String(name || '').trim().toLowerCase() === 'unassigned' ? '-' : name,
      value: Math.round(Number(value) || 0),
      color: palette[idx % palette.length],
    }));
  }, [billingLineRows, billingTransactions, employeeNameById, startDate, endDate]);

  // Center label renderer util for Pie charts
  const renderCenterLabel = (primary: string, secondary: string) => (props: any) => {
    const vb = props?.viewBox || {};
    const hasCx = typeof vb?.cx === "number" && !isNaN(vb.cx);
    const hasCy = typeof vb?.cy === "number" && !isNaN(vb.cy);
    if (!hasCx || !hasCy) return null; // avoid stray render at (0,0)
    const cx = vb.cx as number;
    const cy = vb.cy as number;
    return (
      // @ts-ignore - Recharts allows text elements inside custom label
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" pointerEvents="none">
        <tspan fill="#0f172a" fontSize="18" fontWeight="700">{primary}</tspan>
        <tspan x={cx} dy="18" fill="#475569" fontSize="12">{secondary}</tspan>
      </text>
    );
  };

  // Pay mode distribution (range-based). Use a single authoritative source per range to avoid double counting.
  const paymodeDistribution = useMemo(() => {
    const m = new Map<string, number>();
           
    const normalize = (name: string): string => {
      const s = String(name || '').trim().toLowerCase();
      if (!s) return 'Unknown';
      if (/(cash|cod)/i.test(s)) return 'Cash';
      if (/(card|debit|credit|pos)/i.test(s)) return 'Card';
      if (/(upi|gpay|phonepe|paytm|bharat|qr)/i.test(s)) return 'UPI';
      if (/(cheque|check)/i.test(s)) return 'Cheque';
      if (/(wallet)/i.test(s)) return 'Wallet';
      if (/(bank|neft|rtgs|imps|transfer)/i.test(s)) return 'Bank Transfer';
      return s.charAt(0).toUpperCase() + s.slice(1);
    };

    const inRange = (d: Date) => {
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    };

    // Helper: process a mode+amount pair
    const add = (mode: any, amt: number) => {
      const a = Number(amt || 0);
      if (!(a > 0)) return;
      const norm = normalize(String(mode || ''));
      m.set(norm, (m.get(norm) || 0) + a);
    };

    // Normalize invoice identifiers so payments can map to billed invoices robustly.
    const normInvKeys = (raw: any): string[] => {
      const s0 = String(raw ?? '').trim();
      if (!s0) return [];
      const out = new Set<string>();
      const s = s0.replace(/\s+/g, '');
      out.add(s0);
      out.add(s);
      const upper = s.toUpperCase();
      out.add(upper);

      // Common forms: INV-1181, INV1181, 1181
      const digitsOnly = upper.replace(/\D+/g, '');
      if (digitsOnly) {
        out.add(digitsOnly);
        out.add(`INV-${digitsOnly}`);
        out.add(`INV${digitsOnly}`);
      }

      // If it starts with INV, add tail after INV / INV- / INV:
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

    // Build a set of billed invoices in range (so paymodes reflect billed invoices only)
    const billedBillingTxnsInRange = (billingTransactions || []).filter((bill: any) => {
      const billDate = bill.last_created_at || bill.txn_created_at || bill.created_at || bill.invoice_date || bill.date;
      if (!billDate) return false;
      if (!inRange(new Date(billDate))) return false;
      return isBilledInvoice(bill);
    });

    // Build billed invoice lookup so we can use invoice totals as the source of truth.
    const billByKey = new Map<string, any>();
    billedBillingTxnsInRange.forEach((bill: any) => {
      const candidates = [
        bill.invoice_id,
        bill.txn_invoice_id,
        bill.bill_id,
        bill.id,
        bill.invoice_no,
        bill.invoice_number,
        bill.txn_invoice_no,
      ].filter((v: any) => v != null && String(v).trim() !== '');

      candidates.forEach((v: any) => {
        normInvKeys(v).forEach((k) => {
          if (!billByKey.has(k)) billByKey.set(k, bill);
        });
      });
    });

    // Index billed invoices so each is processed once.
    const billedBills = Array.from(new Set(billedBillingTxnsInRange));

    // Group payment rows by the billed invoice they belong to (if we can map them).
    const paymentsByBill = new Map<any, any[]>();
    (billingPayments || []).forEach((p: any) => {
      const ds = p.payment_date || p.created_at || p.updated_at;
      if (!ds) return;
      if (!inRange(new Date(ds))) return;

      const payStatus = getBillStatus(p);
      if (payStatus && payStatus !== 'Y') return;

      const keysRaw = [p.invoice_id, p.txn_invoice_id, p.bill_id, p.billing_id, p.id, p.invoice_no, p.invoice_number]
        .filter((v: any) => v != null && String(v).trim() !== '');

      let bill: any = null;
      for (const kr of keysRaw) {
        const ks = normInvKeys(kr);
        for (const k of ks) {
          const found = billByKey.get(k);
          if (found) {
            bill = found;
            break;
          }
        }
        if (bill) break;
      }
      if (!bill) return;

      const arr = paymentsByBill.get(bill) || [];
      arr.push(p);
      paymentsByBill.set(bill, arr);
    });

    // For each billed invoice, allocate its invoice total into payment modes.
    billedBills.forEach((bill: any) => {
      const invoiceTotal = Number(
        bill.txn_grand_total ??
          bill.txn_total_amount ??
          bill.txn_total ??
          bill.grand_total ??
          bill.total_amount ??
          bill.total ??
          bill.amount ??
          0
      );
      if (!(invoiceTotal > 0)) return;
      const invoiceTotalR = Math.round(invoiceTotal);
      if (!(invoiceTotalR > 0)) return;

      const pays = paymentsByBill.get(bill) || [];

      // If we have payment rows for this invoice, use them to determine split,
      // but scale to invoiceTotal so totals always match Sales/Tax summary.
      if (pays.length > 0) {
        const byMode = new Map<string, number>();
        let paySum = 0;
        pays.forEach((p: any) => {
          const amount = Number(p.amount || 0);
          if (!(amount > 0)) return;

          let mode = '';
          if (p.payment_method) mode = p.payment_method;
          else if (p.payment_mode_name) mode = p.payment_mode_name;
          else if (p.payment_mode_id != null) {
            const id = String(p.payment_mode_id);
            const found = (paymodes || []).find((pm: any) => {
              const candidates = [pm.id, pm.payment_mode_id, pm.payment_id, pm.code, pm.paymode_id].map((v: any) => (v != null ? String(v) : ''));
              return candidates.includes(id);
            });
            mode = found?.payment_mode_name || id;
          } else if (p.paymode || p.mode || p.paymentmode) {
            mode = p.paymode || p.mode || p.paymentmode;
          }

          const normMode = normalize(String(mode || ''));
          byMode.set(normMode, (byMode.get(normMode) || 0) + amount);
          paySum += amount;
        });

        if (paySum > 0 && byMode.size > 0) {
          // Allocate integer rupees per invoice to avoid decimal display.
          const parts = Array.from(byMode.entries()).map(([mode, amt]) => {
            const raw = invoiceTotalR * (amt / paySum);
            const flo = Math.floor(raw);
            return { mode, flo, frac: raw - flo };
          });
          let used = parts.reduce((s, p) => s + p.flo, 0);
          let rem = invoiceTotalR - used;
          if (rem > 0) {
            parts.sort((a, b) => b.frac - a.frac);
            for (let i = 0; i < parts.length && rem > 0; i++, rem--) {
              parts[i].flo += 1;
            }
          }
          parts.forEach((p) => {
            if (p.flo > 0) add(p.mode, p.flo);
          });
          return;
        }
      }

      // Fallback: use billed invoice header payment method fields.
      let mode = '';
      if (bill.txn_payment_method) mode = bill.txn_payment_method;
      else if (bill.txn_payment_mode_name) mode = bill.txn_payment_mode_name;
      else if (bill.txn_payment_mode_id != null) {
        const id = String(bill.txn_payment_mode_id);
        const found = (paymodes || []).find((pm: any) => {
          const candidates = [pm.id, pm.payment_mode_id, pm.payment_id, pm.code, pm.paymode_id].map((v: any) => (v != null ? String(v) : ''));
          return candidates.includes(id);
        });
        mode = found?.payment_mode_name || id;
      } else if (bill.payment_mode || bill.payment_method) {
        mode = bill.payment_mode || bill.payment_method;
      }
      add(mode, invoiceTotalR);
    });

    // Ensure non-empty for chart rendering
    if (m.size === 0) {
      m.set('Cash', 0);
    }

    const palette = ["#34D399", "#60A5FA", "#F472B6", "#F59E0B", "#A78BFA", "#F87171", "#10B981", "#22D3EE", "#FBBF24", "#4ADE80"];
    return Array.from(m.entries()).map(([name, value], idx) => ({ name, value, color: palette[idx % palette.length] }));
  }, [paymodes, billingTransactions, billingPayments, startDate, endDate]);

  // Totals for chart center labels and percentage tooltips
  const staffDistTotal = useMemo(() => staffDistribution.reduce((a, c) => a + (Number(c.value) || 0), 0), [staffDistribution]);
  const paymodeDistTotal = useMemo(() => paymodeDistribution.reduce((a, c) => a + (Number(c.value) || 0), 0), [paymodeDistribution]);

  // Range-based filter for selected dates (used by multiple charts below)
  const rangeBookings = useMemo(() => {
    // Use occurrence-level data when available for accurate date filtering by eventdate
    const source = (hallBookings && hallBookings.length) ? normalizedOccurrences : normalizedBookings;
    if (!startDate || !endDate) return source;
    return source.filter((b) => b.date >= startDate && b.date <= endDate);
  }, [normalizedBookings, normalizedOccurrences, startDate, endDate, hallBookings]);

  // Bookings by Status per day (stacked columns)
  const statusByDay = useMemo(() => {
    if (!startDate || !endDate) return [] as any[];
    const oneDay = 24*60*60*1000;
    const days: any[] = [];
    const start = new Date(startDate); start.setHours(0,0,0,0);
    const end = new Date(endDate); end.setHours(23,59,59,999);
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + oneDay)) {
      const key = d.toLocaleDateString('en-CA');
      const label = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
      days.push({ key, label, advance: 0, paid: 0, settled: 0, cancelled: 0 });
    }
    const idxByKey = new Map(days.map((x, i) => [x.key, i] as const));
    rangeBookings.forEach((b: any) => {
      const k = b.date.toLocaleDateString('en-CA');
      const idx = idxByKey.get(k);
      if (idx === undefined) return;
      const st = String(b.status || '').toLowerCase().trim();
      if (st === 'advance' || st === 'advanced') days[idx].advance += 1;
      else if (st === 'paid') days[idx].paid += 1;
      else if (st === 'settled' || st === 'settlement') days[idx].settled += 1;
      else if (st === 'cancelled' || st === 'canceled' || st === 'cancel' || st.includes('cancel')) days[idx].cancelled += 1;
    });
    return days;
  }, [rangeBookings, startDate, endDate]);

  // Removed Slot Utilization and Event Type Mix datasets


  // Revenue: Last 7 days (BILLED invoices only)
  const last7DaysRevenue = useMemo(() => {
    const todayEnd = endOfToday();
    const start = new Date(todayEnd);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const days: { key: string; label: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayEnd);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const key = d.toLocaleDateString("en-CA"); // YYYY-MM-DD (local)
      const label = d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
      days.push({ key, label, amount: 0 });
    }

    (billingTransactions || []).forEach((bill: any) => {
      if (!isBilledInvoice(bill)) return;
      const billDateStr = bill.last_created_at || bill.txn_created_at || bill.created_at || bill.invoice_date || bill.date;
      if (!billDateStr) return;
      const d = new Date(billDateStr);
      if (isNaN(d.getTime())) return;
      if (d < start || d > todayEnd) return;
      const amt = Number(
        bill.txn_grand_total ??
          bill.txn_total_amount ??
          bill.txn_total ??
          bill.grand_total ??
          bill.total_amount ??
          bill.total ??
          bill.amount ??
          bill.invoice_amount ??
          0
      ) || 0;
      if (!(amt > 0)) return;
      const key = d.toLocaleDateString('en-CA');
      const idx = days.findIndex((x) => x.key === key);
      if (idx !== -1) days[idx].amount += amt;
    });

    return days.map(({ label, amount }) => ({ label, amount }));
  }, [billingTransactions]);

  // KPIs (month-to-date)
  const monthRange = useMemo(() => { const start = new Date(); start.setDate(1); start.setHours(0,0,0,0); const end = new Date(); end.setHours(23,59,59,999); return { start, end }; }, []);
  const monthBookings = useMemo(() => { const { start, end } = monthRange; return normalizedBookings.filter((b) => b.date >= start && b.date <= end); }, [normalizedBookings, monthRange]);
  
  // Customer metrics
  const customerMetrics = useMemo(() => {
    const totalCustomers = customers.length;
    return { total: totalCustomers };
  }, [customers]);

  // Customers added within the selected date range (fallback to this month when no filters)
  const customersAddedInRange = useMemo(() => {
    const getCreatedDate = (c: any): Date | null => {
      const keys = ['created_at','createdAt','created_date','createdon','created_on','created','reg_date','registered_at'];
      for (const k of keys) {
        const v = (c as any)?.[k];
        if (v) {
          const d = new Date(v);
          if (!isNaN(d.getTime())) return d;
        }
      }
      return null;
    };
    const fromMid = startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) : null;
    const toMid = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) : null;
    const inRange = (d: Date) => {
      if (fromMid && d < fromMid) return false;
      if (toMid && d > toMid) return false;
      return true;
    };
    if (!fromMid && !toMid) {
      const now = new Date();
      return customers.filter(c => {
        const d = getCreatedDate(c);
        return d && isSameMonth(d, now);
      }).length;
    }
    return customers.filter(c => {
      const d = getCreatedDate(c);
      if (isNaN(d.getTime())) return false;
      return inRange(d);
    }).length;
  }, [customers, startDate, endDate]);

  const getPaidForBooking = (b: { id: string; keyVariants?: string[] }): number => {
    const keys = [b.id, ...(b.keyVariants || [])];
    for (const k of keys) {
      const v = Number(paidByBooking.get(String(k)) || 0);
      if (v > 0) return v;
    }
    return 0;
  };

  const derivePaymentStatus = (b: { id: string; totalAmount: number; keyVariants?: string[] }) => {
    const paid = getPaidForBooking(b);
    const total = Number(b.totalAmount) || 0;
    const eps = 0.005; // handle rounding
    if (paid <= eps) return "pending" as const;
    if (paid + eps < total) return "advance" as const;
    return "settled" as const;
  };
  const kpis = useMemo(() => {
    // Mirror HallBooking: sums exclude cancelled; counts show totals across the same range
    const totalBookings = monthBookings.length;
    const isCancelledStatus = (s: string) => {
      const v = String(s || '').toLowerCase().trim();
      return v === 'cancelled' || v === 'canceled' || v === 'cancel' || v === 'cancelled.' || v === 'canceled.' || v.includes('cancel');
    };
    const cancelled = monthBookings.filter((b: any) => isCancelledStatus(b.status || "")).length;
    const usable = monthBookings.filter((b: any) => !isCancelledStatus(b.status || ""));
    let pendingCnt = 0, settledCnt = 0, advanceSum = 0, pendingAmt = 0, totalRev = 0;
    usable.forEach((b: any) => {
      const total = Number(b.totalAmount) || 0;
      const paid = getPaidForBooking(b);
      const st = derivePaymentStatus(b);
      if (st === "pending") pendingCnt++;
      if (st === "settled") settledCnt++;
      totalRev += total;
      advanceSum += Math.max(paid, 0);
      pendingAmt += Math.max(total - paid, 0);
    });
    return { totalBookings, pendingCnt, cancelled, settledCnt, advanceSum, pendingAmt, totalRev };
  }, [monthBookings, paidByBooking]);

  const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString()}`;

  // Range-based KPIs for first 5 cards, aligned with HallBooking:
  // - Include bookings by payments[].payment_date hitting range endpoints (From or To) only (pending inclusive upgrade)
  // - Cancelled card uses bookings.cancel_date inclusive
  // - Total excludes cancelled (both qty and amount)

  const rangeKPI = useMemo(() => {
    const isCancelledLike = (s: string) => {
      const v = String(s || '').toLowerCase().trim();
      return v === 'cancelled' || v === 'canceled' || v === 'cancel' || v.includes('cancel');
    };

    // Use occurrence-level data when available for accurate date filtering by eventdate
    const apptSource = (hallBookings && hallBookings.length) ? (normalizedOccurrences as any[]) : (normalizedBookings as any[]);
    const within = (dt: Date | null | undefined) => {
      if (!startDate || !endDate) return true;
      if (!dt || Number.isNaN(dt.getTime())) return false;
      return dt >= startDate && dt <= endDate;
    };

    // Active bookings are filtered by appointment date; cancelled bookings are filtered by cancel date (fall back to appointment date if cancel date is unavailable)
    const cancelledRows = apptSource.filter((b: any) => {
      if (!isCancelledLike(String(b.status || ''))) return false;
      const cd: Date | null = (b.cancelDate ?? b.cancel_date ?? b.cancelled_at ?? null) as any;
      return within(cd && !Number.isNaN(new Date(cd).getTime()) ? new Date(cd) : b.date);
    });
    const activeRows = apptSource.filter((b: any) => {
      if (isCancelledLike(String(b.status || ''))) return false;
      return within(b.date);
    });

    const eps = 0.5;
    let paidCnt = 0, paidAmt = 0;
    let pendingCnt = 0, pendingAmt = 0;

    activeRows.forEach((b: any) => {
      const total = Number(b.totalAmount) || 0;
      const adv = Number(b.advancePaid ?? b.paid ?? 0) || 0;
      const computedBal = Math.max(total - adv, 0);
      const bal = Number(b.balanceDue ?? b.balance ?? computedBal) || 0;
      const st = String(b.status || '').toLowerCase().trim();
      const isPaid = st === 'paid' || st === 'settled' || st === 'settlement' || bal <= eps;

      if (isPaid) {
        paidCnt += 1;
        paidAmt += total;
      } else {
        pendingCnt += 1;
        pendingAmt += Math.max(bal, computedBal, 0);
      }
    });

    const cancelledCnt = cancelledRows.length;
    const cancelledAmt = cancelledRows.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
    const totalCnt = activeRows.length;
    const totalAmt = activeRows.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);

    // Billing totals (already server-side filtered, but keep a safe date filter + field fallbacks)
    const billingInRange = (billingTransactions || []).filter((bill: any) => {
      if (!startDate || !endDate) return true;
      const billDate = bill.last_created_at || bill.txn_created_at || bill.created_at || bill.invoice_date || bill.date;
      if (!billDate) return true;
      const d = new Date(billDate);
      if (Number.isNaN(d.getTime())) return true;
      return d >= startDate && d <= endDate;
    });

    const getBillAmount = (bill: any): number => {
      return Number(
        bill.txn_grand_total ??
        bill.txn_total_amount ??
        bill.txn_total ??
        bill.grand_total ??
        bill.total ??
        bill.total_amount ??
        bill.amount ??
        bill.invoice_amount ??
        0
      ) || 0;
    };

    let billingBilledCnt = 0, billingBilledAmt = 0;
    let billingCancelledCnt = 0, billingCancelledAmt = 0;
    let billingHoldCnt = 0, billingHoldAmt = 0;

    billingInRange.forEach((bill: any) => {
      const st = getBillStatus(bill);
      const amt = getBillAmount(bill);
      if (st === 'Y') {
        billingBilledCnt += 1;
        billingBilledAmt += amt;
      } else if (st === 'C') {
        billingCancelledCnt += 1;
        billingCancelledAmt += amt;
      } else if (st === 'N') {
        billingHoldCnt += 1;
        billingHoldAmt += amt;
      } else {
        // Unknown status: do not count towards billed/cancelled/hold
      }
    });

    // Keep legacy fields (not currently displayed in the cards)
    const settledCnt = 0, settledAmt = 0;
    const advancedCnt = 0, advancedAmt = 0;

    return {
      totalCnt,
      totalAmt,
      cancelledCnt,
      cancelledAmt,
      settledCnt,
      settledAmt,
      advancedCnt,
      advancedAmt,
      paidCnt,
      paidAmt,
      pendingCnt,
      pendingAmt,
      billingBilledAmt,
      billingBilledCnt,
      billingCancelledAmt,
      billingCancelledCnt,
      billingHoldAmt,
      billingHoldCnt
    };
  }, [normalizedBookings, normalizedOccurrences, hallBookings, startDate, endDate, billingTransactions, employeeNameById]);

  // Compute previous-period KPIs (same length window immediately before current)
  const prevRangeKPI = useMemo(() => {
    if (!startDate || !endDate) return { totalAmt: 0, paidAmt: 0 };
    const oneDay = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / oneDay) + 1);
    const prevEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    prevEnd.setTime(prevEnd.getTime() - oneDay); // previous day start
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * oneDay);

    const isCancelledLike = (s: string) => {
      const v = String(s || '').toLowerCase().trim();
      return v === 'cancelled' || v === 'canceled' || v === 'cancel' || v.includes('cancel');
    };

    // Align with rangeKPI: use occurrence-level data when available; filter by previous window
    const apptSource = (hallBookings && hallBookings.length) ? (normalizedOccurrences as any[]) : (normalizedBookings as any[]);
    const prevStartDt = new Date(prevStart.getFullYear(), prevStart.getMonth(), prevStart.getDate());
    const prevEndDt = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate(), 23, 59, 59, 999);
    const apptInPrev = apptSource.filter((b: any) => (b.date >= prevStartDt && b.date <= prevEndDt));

    const activeRows = apptInPrev.filter((b: any) => !isCancelledLike(String(b.status || '')));

    const eps = 0.5;
    let apptTotalAmt = 0;
    let apptPaidAmt = 0;
    activeRows.forEach((b: any) => {
      const total = Number(b.totalAmount) || 0;
      apptTotalAmt += total;

      const adv = Number(b.advancePaid ?? b.paid ?? 0) || 0;
      const computedBal = Math.max(total - adv, 0);
      const bal = Number(b.balanceDue ?? b.balance ?? computedBal) || 0;
      const st = String(b.status || '').toLowerCase().trim();
      const isPaid = st === 'paid' || st === 'settled' || st === 'settlement' || bal <= eps;
      if (isPaid) apptPaidAmt += total;
    });

    const billingInPrev = (billingTransactions || []).filter((bill: any) => {
      const billDate = bill.last_created_at || bill.txn_created_at || bill.created_at || bill.invoice_date || bill.date;
      if (!billDate) return false;
      const d = new Date(billDate);
      if (Number.isNaN(d.getTime())) return false;
      return d >= prevStartDt && d <= prevEndDt;
    });
    const getBillStatus = (bill: any): string => {
      const raw =
        bill.billtype ??
        bill.bill_type ??
        bill.billstatus ??
        bill.bill_status ??
        bill.BILL_STATUS ??
        bill.txn_billtype ??
        bill.txn_bill_type ??
        bill.txn_billstatus ??
        bill.txn_bill_status;
      return String(raw || '').trim().toUpperCase();
    };
    const billingTotalAmt = billingInPrev.reduce((sum: number, bill: any) => {
      // Only treat billed invoices as revenue
      if (getBillStatus(bill) !== 'Y') return sum;
      const gt = Number(
        bill.txn_grand_total ??
        bill.txn_total_amount ??
        bill.txn_total ??
        bill.grand_total ??
        bill.total ??
        bill.total_amount ??
        bill.amount ??
        bill.invoice_amount ??
        0
      ) || 0;
      return sum + gt;
    }, 0);

    // Keep the same assumption as rangeKPI: billed invoices count as "paid" revenue
    const totalAmt = apptTotalAmt + billingTotalAmt;
    const paidAmt = apptPaidAmt + billingTotalAmt;

    return { totalAmt, paidAmt };
  }, [startDate, endDate, normalizedBookings, normalizedOccurrences, hallBookings, billingTransactions]);

  const deltaPct = (curr: number, prev: number) => {
    if (!prev) return curr ? 100 : 0;
    return ((curr - prev) / Math.max(prev, 1e-6)) * 100;
  };

  // Normalize all transaction types into a unified format
  const normalizeAllTransactions = (appointments: any[], appointmentTxns: any[], billingTxns: any[], filterStartDate?: Date, filterEndDate?: Date) => {
    const transactions: any[] = [];

    // Helper to check if date is in range
    const isInRange = (dateStr: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (filterStartDate && d < filterStartDate) return false;
      if (filterEndDate && d > filterEndDate) return false;
      return true;
    };

    // 1. Add appointments as transactions
    appointments.forEach((apt: any) => {
      if (!isInRange(apt.appointment_date)) return;
      
      transactions.push({
        id: `apt-${apt.id || apt.appointment_id}`,
        type: 'appointment',
        date: new Date(apt.appointment_date),
        customer_name: apt.customer_name,
        customer_phone: apt.customer_phone,
        staff_name: apt.staff_name,
        amount: Number(apt.total_amount || 0),
        paid_amount: Number(apt.advance_paid || 0),
        balance: Number(apt.balance_due || Math.max((apt.total_amount || 0) - (apt.advance_paid || 0), 0)),
        payment_mode: apt.payment_mode,
        status: apt.status || 'pending',
        services: apt.services,
        appointment_id: apt.appointment_id,
        tax_amount: Number(apt.tax_amount || 0),
        discount: Number(apt.discount || 0),
        source: 'appointment'
      });
    });

    // 2. Add appointment transactions  
    appointmentTxns.forEach((txn: any) => {
      if (!isInRange(txn.latest_created)) return;
      
      transactions.push({
        id: `apt-txn-${txn.appointment_id}`,
        type: 'appointment_transaction',
        date: new Date(txn.latest_created),
        customer_name: txn.customer_name,
        customer_phone: txn.customer_mobile?.toString(),
        staff_name: txn.employee_name,
        amount: Number(txn.grand_total || 0),
        paid_amount: Number(txn.grand_total || 0), // Assumption: transactions are usually paid
        balance: 0,
        payment_mode: 'Multiple', // Transaction lines might have different modes
        status: 'settled',
        appointment_id: txn.appointment_id,
        line_count: txn.line_count,
        subtotal: Number(txn.total_subtotal || 0),
        tax_amount: Number(txn.total_tax || 0),
        source: 'appointment_transaction'
      });
    });

    // 3. Add billing transactions
    billingTxns.forEach((bill: any) => {
      const billDate = bill.last_created_at || bill.txn_created_at || bill.created_at || bill.invoice_date || bill.date;
      
      if (!billDate) return;
      if (!isInRange(billDate)) return;
      
      transactions.push({
        id: `bill-${bill.invoice_id || bill.id}`,
        type: 'billing',
        date: new Date(billDate),
        customer_name: bill.customer_name || bill.txn_customer_name || 'Walk-in',
        customer_phone: bill.customer_phone || bill.txn_customer_mobile,
        staff_name: bill.txn_employee_name || bill.employee_name || 'Staff',
        amount: Number(bill.grand_total || bill.total_amount || 0),
        paid_amount: Number(bill.grand_total || bill.paid_amount || bill.advance_paid || 0), // Assuming billing transactions are paid
        balance: 0, // Billing transactions are typically settled
        payment_mode: bill.payment_mode || 'Cash',
        status: 'settled',
        invoice_id: bill.invoice_id || bill.id,
        tax_amount: Number(bill.tax_amount || bill.txn_tax_amount || 0),
        discount: Number(bill.discount_sum || bill.txn_discount_amount || bill.discount_amount || 0),
        membership_discount: Number(bill.txn_membership_discount || 0),
        line_count: Number(bill.line_count || 0),
        subtotal: Number(bill.raw_subtotal || bill.txn_subtotal || 0),
        taxable_amount: Number(bill.txn_taxable_amount || 0),
        cgst: Number(bill.txn_total_cgst || 0),
        sgst: Number(bill.txn_total_sgst || 0),
        employee_level: bill.txn_employee_level,
        source: 'billing'
      });
    });

    // Sort by date (newest first)
    return transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  // TAX/GST summary for selected range (includes both appointments and billing)
  const taxSummary = useMemo(() => {
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const toNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    let cgst = 0;
    let sgst = 0;
    let tax = 0;
    let taxable = 0;

    // Add billing transaction tax data for the selected range
    const billingInRange = billingTransactions.filter((bill: any) => {
      const billDate = bill.last_created_at || bill.txn_created_at || bill.created_at || bill.invoice_date || bill.date;
      if (!billDate) return false;
      const d = new Date(billDate);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      if (!isBilledInvoice(bill)) return false;
      return true;
    });

    billingInRange.forEach((bill: any) => {
      const billCgstRaw = toNum(bill.txn_total_cgst ?? bill.total_cgst ?? bill.cgst_amount ?? 0);
      const billSgstRaw = toNum(bill.txn_total_sgst ?? bill.total_sgst ?? bill.sgst_amount ?? 0);
      const billIgstRaw = toNum(bill.txn_total_igst ?? bill.total_igst ?? bill.igst_amount ?? 0);
      const billTaxRaw = toNum(bill.txn_tax_amount ?? bill.tax_amount ?? bill.total_tax ?? 0);

      const componentsSum = billCgstRaw + billSgstRaw + billIgstRaw;
      const billTax = componentsSum > 0 ? componentsSum : billTaxRaw;

      // If only total tax is present (and IGST is not), infer CGST/SGST split for display.
      // This avoids showing CGST=0, SGST=0, Total Tax>0.
      const billCgst = (billCgstRaw + billSgstRaw) === 0 && billTax > 0 && billIgstRaw === 0 ? billTax / 2 : billCgstRaw;
      const billSgst = (billCgstRaw + billSgstRaw) === 0 && billTax > 0 && billIgstRaw === 0 ? billTax / 2 : billSgstRaw;

      const grandTotal = toNum(bill.grand_total ?? bill.total_amount ?? bill.amount ?? 0);
      const billTaxable = grandTotal > 0
        ? Math.max(grandTotal - billTax, 0)
        : toNum(bill.txn_taxable_amount ?? bill.taxable_amount ?? 0);

      cgst += billCgst;
      sgst += billSgst;
      tax += billTax;
      taxable += billTaxable;
    });

    // Keep totals stable and readable (avoid float drift)
    cgst = round2(cgst);
    sgst = round2(sgst);
    tax = round2(tax || (cgst || sgst ? cgst + sgst : 0));
    taxable = round2(taxable);

    const effRate = taxable ? (tax / Math.max(taxable, 1e-6)) * 100 : 0;
    

    
    return { cgst, sgst, tax, taxable, effRate };
  }, [billingTransactions, startDate, endDate]);

  // Smooth page/load transitions
  const reduceMotion = useReducedMotion();
  const pageEase = [0.22, 1, 0.36, 1] as any;
  const pageTransition = { duration: reduceMotion ? 0 : 0.45, ease: pageEase };
  const containerVariants = {
    hidden: { opacity: 0, y: 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        staggerChildren: reduceMotion ? 0 : 0.06,
        delayChildren: reduceMotion ? 0 : 0.05,
      },
    },
  } as const;
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.35, ease: pageEase } },
  } as const;

  // Simple skeleton block
  const Skeleton = ({ className = "" }: { className?: string }) => (
    <div className={`animate-pulse rounded-md bg-slate-200/60 ${className}`} />
  );

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-4 p-3 sm:p-4 lg:p-5 max-w-full overflow-x-hidden bg-slate-50">
  {/* Background gradient overlay removed for a clean, plain dashboard background */}
      {/* Header with Filters - wrapped in a unified Card */}
      <Card className="border border-slate-200 shadow-sm mb-2 sticky top-0 z-30 bg-white">
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <h1 className="heading-font text-lg sm:text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">DASHBOARD</h1>

            {/* Filters bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex flex-wrap sm:flex-nowrap items-center border border-input bg-background shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden">
                {/* Date range */}
                <div className="flex flex-nowrap items-center gap-2 px-2 h-10 sm:h-9 whitespace-nowrap">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "min-w-[132px] justify-start text-left rounded-none h-10 sm:h-9 px-2 font-medium border-0 hover:bg-transparent",
                          !startDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="text-xs sm:text-sm">From{startDate ? `: ${format(startDate, "dd-MM-yyyy")}` : ""}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={startDate ?? undefined}
                        onSelect={handleStartDateSelect}
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
                          !endDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="text-xs sm:text-sm">To{endDate ? `: ${format(endDate, "dd-MM-yyyy")}` : ""}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={endDate ?? undefined}
                        onSelect={handleEndDateSelect}
                        disabled={startDate ? { before: startDate } : undefined}
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
          </div>
        </CardHeader>
      </Card>
      {/* Summary cards */}
  <div className="space-y-4">
        {/* Billing Section */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Billing
          </h3>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
              <Skeleton className="h-24 sm:h-28" />
              <Skeleton className="h-24 sm:h-28" />
              <Skeleton className="h-24 sm:h-28" />
              <Skeleton className="h-24 sm:h-28" />
            </div>
          ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            {/* Billing Paid */}
            <motion.div variants={itemVariants}>
            <Card className="group relative h-full overflow-hidden rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Billing Paid" className="h-8 w-8 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircle className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">
                    Billed
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Qty</div>
                    <div className="text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">{rangeKPI.billingBilledCnt}</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Amount</div>
                    <div className="text-base sm:text-lg font-bold text-emerald-700 tabular-nums">{fmtINR(rangeKPI.billingBilledAmt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>

            {/* Billing Cancelled */}
            <motion.div variants={itemVariants}>
            <Card className="group relative h-full overflow-hidden rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Billing Cancelled" className="h-8 w-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                    <XCircle className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">
                    Cancelled
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Qty</div>
                    <div className="text-lg sm:text-xl font-bold text-rose-700 tabular-nums">{rangeKPI.billingCancelledCnt}</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Amount</div>
                    <div className="text-base sm:text-lg font-bold text-rose-700 tabular-nums">{fmtINR(rangeKPI.billingCancelledAmt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>

            {/* Billing Hold */}
            <motion.div variants={itemVariants}>
            <Card className="group relative h-full overflow-hidden rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Hold Bills" className="h-8 w-8 flex items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                    <Clock className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">
                    Hold
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Qty</div>
                    <div className="text-lg sm:text-xl font-bold text-amber-700 tabular-nums">{rangeKPI.billingHoldCnt}</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Amount</div>
                    <div className="text-base sm:text-lg font-bold text-amber-700 tabular-nums">{fmtINR(rangeKPI.billingHoldAmt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>

            {/* Customer Details (range) - shown under Hold */}
            <motion.div
              variants={itemVariants}
            >
              <Card className="group relative h-full overflow-hidden rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-sky-500" />
                <CardHeader className="pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span title="Customer Details" className="h-8 w-8 flex items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-200">
                      <Users className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">
                      Customer Details
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 divide-x divide-slate-200">
                    <div className="py-2 text-center">
                      <div className="text-[11px] text-slate-500">New</div>
                      <div className="text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">{customerRangeMetrics.new_customers}</div>
                    </div>
                    <div className="py-2 text-center">
                      <div className="text-[11px] text-slate-500">Existing</div>
                      <div className="text-lg sm:text-xl font-bold text-amber-700 tabular-nums">{customerRangeMetrics.existing_customers}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
        </div>
      </div>

      {/* Finance Tracker */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Finance Tracker
        </h3>

        {/* Income / Expense / Net cards */}
        {incomeExpenseLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch mb-2">
            <Skeleton className="h-24 sm:h-28" />
            <Skeleton className="h-24 sm:h-28" />
            <Skeleton className="h-24 sm:h-28" />
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch mb-2"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            <motion.div variants={itemVariants}>
            <Card className="group relative h-full overflow-hidden rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Income" className="h-8 w-8 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    <IndianRupee className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">Income</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Qty</div>
                    <div className="text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">{incomeExpenseKPI.incomeCount}</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Amount</div>
                    <div className="text-base sm:text-lg font-bold text-emerald-700 tabular-nums">{fmtINR(incomeExpenseKPI.income)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="group relative h-full overflow-hidden rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Expense" className="h-8 w-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                    <CreditCard className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">Expense</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Qty</div>
                    <div className="text-lg sm:text-xl font-bold text-rose-700 tabular-nums">{incomeExpenseKPI.expenseCount}</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-[11px] text-slate-500">Amount</div>
                    <div className="text-base sm:text-lg font-bold text-rose-700 tabular-nums">{fmtINR(incomeExpenseKPI.expense)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="group relative h-full overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-500" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Net" className="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                    <Calculator className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">Net</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="py-2 text-center">
                  <div className="text-[11px] text-slate-500">Income - Expense</div>
                  <div className={"text-base sm:text-lg font-bold tabular-nums " + (incomeExpenseKPI.net >= 0 ? "text-emerald-700" : "text-rose-700")}>
                    {fmtINR(incomeExpenseKPI.net)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          </motion.div>
        )}
      </div>

      {/* Customers + Quick Insights in one row */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-2">
          <Skeleton className="h-24 sm:h-28" />
          <Skeleton className="h-24 sm:h-28 hidden md:block" />
          <Skeleton className="h-24 sm:h-28 hidden md:block" />
          <Skeleton className="h-24 sm:h-28 hidden md:block" />
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch mb-2"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {/* Customers */}
          <motion.div variants={itemVariants}>
            <Card className="group relative overflow-hidden bg-white border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md h-full">
              <div className="pointer-events-none absolute -top-7 -right-7 h-16 w-16 rounded-full bg-teal-200/30" />
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span title="Total Customers" className="h-8 w-8 flex items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                    <Users className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-700 leading-none">
                    Customers
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500">Total</div>
                      <div className="text-base sm:text-lg font-semibold text-slate-800 tabular-nums">{customerMetrics.total}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">New (Range)</div>
                      <div className="text-base sm:text-lg font-semibold text-slate-800">+{customersAddedInRange}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Average Bill Value */}
          <motion.div variants={itemVariants}>
            <Card className="border shadow-sm h-full">
              <CardHeader className="pb-1">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="p-1 sm:p-1.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 flex-shrink-0">
                    <Calculator className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-700 truncate">Average Bill Value</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm sm:text-base lg:text-lg font-semibold text-slate-800">
                  {(() => { const cnt = Number(rangeKPI?.billingBilledCnt || 0); const amt = Number(rangeKPI?.billingBilledAmt || 0); const v = cnt>0 ? (amt / cnt) : 0; return `₹${v.toLocaleString(undefined,{maximumFractionDigits:0})}`; })()}
                </div>
                <div className="text-[10px] sm:text-[11px] text-slate-500">This range</div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Top Pay Mode */}
          <motion.div variants={itemVariants}>
            <Card className="border shadow-sm h-full">
              <CardHeader className="pb-1">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="p-1 sm:p-1.5 rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 flex-shrink-0">
                    <CreditCard className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-700 truncate">Top Pay Mode</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {(() => {
                  const list = (paymodeDistribution || []).slice().sort((a:any,b:any)=>Number(b?.value||0)-Number(a?.value||0));
                  const top = list[0];
                  const total = Number(paymodeDistTotal||0) || list.reduce((s:any,x:any)=>s+Number(x?.value||0),0);
                  const pct = top ? Math.round((Number(top.value||0)/Math.max(total,1))*100) : 0;
                  return (
                    <div>
                      <div className="text-sm sm:text-base lg:text-lg font-semibold text-slate-800 truncate">{top?.name || '—'}</div>
                      <div className="text-[10px] sm:text-[11px] text-slate-500">{top?`₹${Number(top.value||0).toLocaleString()} • ${pct}%`:'No data'}</div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </motion.div>

          {/* Active Staff */}
          <motion.div variants={itemVariants}>
            <Card className="border shadow-sm h-full">
              <CardHeader className="pb-1">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="p-1 sm:p-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0">
                    <UserCog className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </span>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-700 truncate">Active Staff</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm sm:text-base lg:text-lg font-semibold text-slate-800">{Array.isArray(staffDistribution)? staffDistribution.length : 0}</div>
                <div className="text-[10px] sm:text-[11px] text-slate-500">Contributing this range</div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* Analytics Charts */}
      {/* Insights - 4 analytics cards */}
  <motion.div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-stretch" variants={containerVariants} initial="hidden" animate="show">
        
  <motion.div variants={itemVariants}>
  <Card className="group relative overflow-hidden bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200/50 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 h-full flex flex-col">
          <div className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full bg-orange-200/30" />
          <CardHeader className="pb-3 relative z-10">
            <div className="flex items-center gap-3">
              <span title="Payment Analytics" className="p-2 rounded-lg bg-orange-100 text-orange-700 border border-orange-200">
                <CreditCard className="h-5 w-5" />
              </span>
              <CardTitle className="text-lg font-semibold flex items-center gap-2 text-slate-700">
                Payment Analytics
                <span className="text-xs font-normal text-slate-500"></span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 relative z-10 pt-0">
            {loading ? (
              <Skeleton className="h-48 sm:h-56 lg:h-[220px]" />
            ) : (
              <div className="h-full flex flex-col">
                {/* Total Revenue Summary */}
                <div className="mb-3 sm:mb-4 p-2 sm:p-3 rounded-lg bg-orange-100/50 border border-orange-200 text-center">
                  <div className="text-xs text-slate-500 mb-1">Total Revenue Collected</div>
                  <div className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-800">₹{Number(paymodeDistTotal).toLocaleString()}</div>
                  <div className="text-xs text-slate-500">All payment methods</div>
                </div>
                {/* Details */}
                {Array.isArray(paymodeDistribution) && paymodeDistribution.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-xs text-slate-500 mb-1">Top payment modes</div>
                    <ul className="text-xs divide-y divide-orange-200/70 rounded-md border border-orange-200/60 bg-white/40 overflow-hidden">
                      {paymodeDistribution
                        .slice()
                        .sort((a:any,b:any)=>Number(b?.value||0)-Number(a?.value||0))
                        .slice(0,3)
                        .map((m:any,idx:number)=>{
                          const total = Number(paymodeDistTotal||0);
                          const pct = total>0 ? Math.round((Number(m?.value||0)/total)*100) : 0;
                          return (
                            <li key={`top-pay-${idx}`} className="flex items-center justify-between px-2 py-1.5">
                              <span className="text-slate-700">{m?.name || '—'}</span>
                              <span className="text-slate-600">₹{Number(m?.value||0).toLocaleString()} <span className="text-[10px] text-slate-500">({pct}%)</span></span>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-slate-500">
                    <div className="text-center text-xs">Pie chart is shown in the separate card below.</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        </motion.div>
        {/* Standalone Staff Performance Pie Chart Card */}
        <motion.div variants={itemVariants}>
          <Card className="group relative overflow-hidden border border-emerald-200/50 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 h-full flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <span title="Staff Performance (Pie)" className="p-1.5 sm:p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0">
                  <UserCog className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                <CardTitle className="text-sm font-semibold text-slate-700">Staff Performance</CardTitle>
                <div className="ml-auto flex items-center gap-2">
                  <div className="hidden sm:block text-right">
                    <div className="text-[10px] text-slate-500 leading-none">Total</div>
                    <div className="text-xs font-semibold text-slate-700 tabular-nums">₹{Math.round(Number(staffDistTotal || 0)).toLocaleString()}</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setStaffSplitOpen(true)}
                    disabled={loading || !(staffDistribution?.length > 0)}
                    title="View staff-wise split"
                    aria-label="View staff-wise split"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <Skeleton className="h-48 sm:h-52 lg:h-56" />
              ) : staffDistribution.length > 0 ? (
                <div className="h-48 sm:h-52 lg:h-56 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={staffDistribution}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={renderCenterLabel(`₹${Number(staffDistTotal).toLocaleString()}`, "Total Sales")}
                          outerRadius={70}
                          innerRadius={40}
                          fill="#8884d8"
                          dataKey="value"
                          strokeWidth={2}
                          stroke="#fff"
                        >
                          {staffDistribution.map((entry, index) => (
                            <Cell key={`staff-cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [
                            `₹${Math.round(Number(value)||0).toLocaleString()} (${staffDistTotal > 0 ? ((Math.round(Number(value)||0) / staffDistTotal) * 100).toFixed(1) : '0'}%)`,
                            name,
                          ]}
                          contentStyle={{
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Scrollable legend/details (prevents clipping when many staff exist) */}
                  <div className="mt-2 max-h-20 overflow-y-auto pr-1">
                    <ul className="text-[11px] space-y-1">
                      {staffDistribution
                        .slice()
                        .sort((a: any, b: any) => Number(b?.value || 0) - Number(a?.value || 0))
                        .map((entry: any, index: number) => {
                          const value = Math.round(Number(entry?.value || 0));
                          const pct = staffDistTotal > 0 ? ((value / staffDistTotal) * 100).toFixed(1) : '0.0';
                          return (
                            <li
                              key={`staff-legend-${index}`}
                              className="flex items-center justify-between gap-2 rounded-md border border-emerald-200/60 bg-white/40 px-2 py-1"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry?.color || '#94a3b8' }} />
                                <span className="truncate text-slate-700">{entry?.name || '—'}</span>
                              </div>
                              <span className="flex-shrink-0 text-slate-600">
                                ₹{value.toLocaleString()} <span className="text-[10px] text-slate-500">({pct}%)</span>
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="h-56 flex items-center justify-center text-slate-500">
                  <div className="text-center">
                    <UserCog className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No staff performance data</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expandable staff-wise split */}
          <Dialog open={staffSplitOpen} onOpenChange={setStaffSplitOpen}>
            <DialogContent className="w-[95vw] max-w-[720px] max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-3">
                  <span>Staff Performance Split</span>
                  <span className="text-sm font-semibold text-slate-700 tabular-nums">Total: ₹{Math.round(Number(staffDistTotal || 0)).toLocaleString()}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="mt-3">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                  <input
                    value={staffSplitQuery}
                    onChange={(e) => setStaffSplitQuery(e.target.value)}
                    placeholder="Search staff..."
                    className="h-9 w-full sm:w-[280px] rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                  <div className="text-xs text-slate-500">
                    Showing {staffDistribution?.length || 0} staff
                  </div>
                </div>

                <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
                  <div className="grid grid-cols-12 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    <div className="col-span-6">Staff</div>
                    <div className="col-span-3 text-right">Amount</div>
                    <div className="col-span-3 text-right">Share</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {staffDistribution
                      .slice()
                      .sort((a: any, b: any) => Number(b?.value || 0) - Number(a?.value || 0))
                      .filter((x: any) => {
                        const q = String(staffSplitQuery || '').trim().toLowerCase();
                        if (!q) return true;
                        return String(x?.name || '').toLowerCase().includes(q);
                      })
                      .map((entry: any, idx: number) => {
                        const value = Math.round(Number(entry?.value || 0));
                        const pct = staffDistTotal > 0 ? ((value / staffDistTotal) * 100).toFixed(1) : '0.0';
                        return (
                          <div key={`staff-split-${idx}`} className="grid grid-cols-12 items-center px-3 py-2 text-sm">
                            <div className="col-span-6 flex items-center gap-2 min-w-0">
                              <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry?.color || '#94a3b8' }} />
                              <span className="truncate text-slate-700">{entry?.name || '—'}</span>
                            </div>
                            <div className="col-span-3 text-right tabular-nums text-slate-700">₹{value.toLocaleString()}</div>
                            <div className="col-span-3 text-right tabular-nums text-slate-600">{pct}%</div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>

        {/* Standalone Payment Mode Split Pie Chart Card */}
        <motion.div variants={itemVariants}>
          <Card className="group relative overflow-hidden border border-sky-200/50 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 h-full flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <span title="Payment Mode Split" className="p-1.5 sm:p-2 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex-shrink-0">
                  <CreditCard className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                <CardTitle className="text-sm font-semibold text-slate-700">Payment Mode Split</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <Skeleton className="h-48 sm:h-52 lg:h-56" />
              ) : paymodeDistribution.length > 0 ? (
                <div className="h-48 sm:h-52 lg:h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymodeDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={renderCenterLabel(`₹${Number(paymodeDistTotal).toLocaleString()}`, "Total Revenue")}
                        outerRadius={70}
                        innerRadius={40}
                        fill="#8884d8"
                        dataKey="value"
                        strokeWidth={2}
                        stroke="#fff"
                      >
                        {paymodeDistribution.map((entry, index) => (
                          <Cell key={`pay-cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [
                          `₹${Number(value).toLocaleString()} (${paymodeDistTotal > 0 ? ((Number(value) / paymodeDistTotal) * 100).toFixed(1) : '0'}%)`,
                          name,
                        ]}
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          border: '1px solid #e2e8f0',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={32}
                        formatter={(value, entry) => (
                          <span style={{ color: entry.color, fontSize: '10px' }}>
                            {value} (₹{Number(entry.payload?.value || 0).toLocaleString()})
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-56 flex items-center justify-center text-slate-500">
                  <div className="text-center">
                    <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No payment analytics data</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
        {/* Tax/GST Summary */}
        <motion.div variants={itemVariants}>
        <Card className="group relative overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200/50 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 h-full flex flex-col">
          <div className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full bg-slate-200/30" />
          <CardHeader className="pb-2 sm:pb-3 relative z-10">
            <div className="flex items-center gap-2 sm:gap-3">
              <span title="Tax Summary" className="p-1.5 sm:p-2 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex-shrink-0">
                <Calculator className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <CardTitle className="text-sm sm:text-base lg:text-lg font-semibold flex items-center gap-1 sm:gap-2 text-slate-700">
                Tax Summary
                <span className="text-xs rounded-full px-1.5 sm:px-2 py-0.5 border border-slate-300 bg-slate-200/50 text-slate-700">
                  GST
                </span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-48 sm:min-h-52 lg:min-h-[220px] relative z-10 pt-0">
            {/* Taxable Base Amount - Prominent Display */}
            <div className="mb-3 sm:mb-4 p-2 sm:p-3 rounded-lg bg-slate-100/50 border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Taxable Amount (Base)</div>
                  <div className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-800">
                    ₹{Number(taxSummary.taxable || 0).toLocaleString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-1">Effective Rate</div>
                  <div className="text-base sm:text-lg font-semibold text-slate-800">
                    {taxSummary.effRate ? taxSummary.effRate.toFixed(1) : '0'}%
                  </div>
                </div>
              </div>
            </div>

            {/* Tax Breakdown */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="text-center p-1.5 sm:p-2 rounded-lg bg-slate-50">
                <div className="text-xs text-slate-500 mb-1">CGST</div>
                <div className="text-xs sm:text-sm font-semibold text-slate-800">
                  ₹{Number(taxSummary.cgst || 0).toLocaleString()}
                </div>
              </div>
              <div className="text-center p-1.5 sm:p-2 rounded-lg bg-slate-50">
                <div className="text-xs text-slate-500 mb-1">SGST</div>
                <div className="text-xs sm:text-sm font-semibold text-slate-800">
                  ₹{Number(taxSummary.sgst || 0).toLocaleString()}
                </div>
              </div>
              <div className="text-center p-1.5 sm:p-2 rounded-lg bg-slate-100/50 border border-slate-200">
                <div className="text-xs text-slate-500 mb-1">Total Tax</div>
                <div className="text-xs sm:text-sm font-bold text-slate-800">
                  ₹{Number(taxSummary.tax || 0).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Visual Tax Split */}
            <div className="mt-auto">
              <div className="text-xs text-slate-500 mb-2 flex items-center justify-between">
                <span>Tax Distribution</span>
                <span>CGST vs SGST</span>
              </div>
              {(() => { 
                const cg = Number(taxSummary.cgst || 0); 
                const sg = Number(taxSummary.sgst || 0); 
                const tot = Math.max(cg + sg, 1); 
                const cgP = (cg / tot) * 100; 
                const sgP = (sg / tot) * 100; 
                return (
                  <div className="space-y-2">
                    <div className="h-3 rounded-full overflow-hidden bg-slate-200 border border-slate-300">
                      <div className="h-full flex">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300" 
                          style={{ width: `${cgP}%` }}
                        />
                        <div 
                          className="bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-300" 
                          style={{ width: `${sgP}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        CGST ({cgP.toFixed(0)}%)
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        SGST ({sgP.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                ); 
              })()}
            </div>
          </CardContent>
        </Card>
        </motion.div>
        </motion.div>

      {/* Last 7 Days Sales Trend */}
      <motion.div className="mt-2" variants={containerVariants} initial="hidden" animate="show">
        <motion.div variants={itemVariants}>
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 flex-shrink-0">
                  <TrendingUp className="h-4 w-4" />
                </span>
                <CardTitle className="text-sm font-semibold text-slate-700">Last 7 Days Sales Trend</CardTitle>
                </div>
                {(() => {
                  const total = (last7DaysRevenue || []).reduce((s:any,x:any)=>s + Number(x?.amount||0), 0);
                  const avg = Math.round(total / Math.max((last7DaysRevenue||[]).length, 1));
                  return (
                    <div className="text-xs text-slate-600 flex flex-col sm:flex-row gap-1 sm:gap-3">
                      <span>Total: <span className="font-semibold">₹{total.toLocaleString()}</span></span>
                      <span>Avg/day: <span className="font-semibold">₹{avg.toLocaleString()}</span></span>
                    </div>
                  );
                })()}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <Skeleton className="h-48 sm:h-52 lg:h-56" />
              ) : (
                (() => {
                  const hasData = (last7DaysRevenue || []).some((x:any) => Number(x?.amount||0) > 0);
                  if (!hasData) {
                    return (
                      <div className="h-48 sm:h-52 lg:h-56 flex items-center justify-center text-slate-500">
                        <div className="text-center">
                          <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No sales recorded in the last 7 days</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="h-48 sm:h-52 lg:h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={last7DaysRevenue} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                          <defs>
                            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v)=>`₹${Number(v).toLocaleString()}`} />
                          <Tooltip formatter={(v:any)=>`₹${Number(v||0).toLocaleString()}`} />
                          {(() => {
                            const total = (last7DaysRevenue || []).reduce((s:any,x:any)=>s + Number(x?.amount||0), 0);
                            const avg = Math.round(total / Math.max((last7DaysRevenue||[]).length, 1));
                            return <ReferenceLine y={avg} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Avg ₹${avg.toLocaleString()}`, position: 'insideTopRight', fill: '#475569', fontSize: 11 }} />;
                          })()}
                          <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#trendFill)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* No additional insights row; consolidated above */}
    </motion.div>
  );

}