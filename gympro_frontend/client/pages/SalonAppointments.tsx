import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addMonths } from 'date-fns';
import { todayYMDIST, parseYMDToIST, IST_LABEL, nowIST } from '@/lib/timezone';
import { useAuth } from '@/contexts/AuthContext';
import { AppointmentService, AppointmentRow } from '@/services/appointmentService';
import AppointmentTransactionService from '@/services/appointmentTransactionService';
import { ApiService } from '@/services/apiService';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Download, CalendarDays, ChevronLeft, ChevronRight, Search, Filter, Wallet, CheckCircle2, IndianRupee, XCircle, Clock, Printer, Share2, Pencil, Eye } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { exportData } from '@/lib/exportUtils';
import { toast } from '@/hooks/use-toast';

// Time formatting helpers (12h with AM/PM)
const BLOCK_MINUTES = 30; // slot size for availability grid
const pad2 = (n:number)=> String(n).padStart(2,'0');
const to12h = (hhmm: string): string => {
  if (!hhmm) return '';
  const h = Number(hhmm.slice(0,2));
  const m = Number(hhmm.slice(3,5));
  const ampm = h >= 12 ? 'PM' : 'AM';
  let dispH = h % 12; if (dispH === 0) dispH = 12;
  return `${dispH}:${pad2(m)} ${ampm}`;
};
const range12 = (fromHHMMSS?: string, toHHMMSS?: string): string => {
  const f = (fromHHMMSS||'').slice(0,5); const t = (toHHMMSS||'').slice(0,5);
  if (!f && !t) return '';
  if (f && !t) return to12h(f);
  if (!f && t) return to12h(t);
  const fH = Number(f.slice(0,2)); const tH = Number(t.slice(0,2));
  const fA = fH >= 12 ? 'PM' : 'AM'; const tA = tH >= 12 ? 'PM' : 'AM';
  const fTxt = to12h(f).replace(/\s(AM|PM)$/,'');
  const tTxt = to12h(t).replace(/\s(AM|PM)$/,'');
  return fA === tA ? `${fTxt}-${tTxt} ${fA}` : `${to12h(f)} - ${to12h(t)}`;
};
const blockRange12 = (startHHMM: string): string => {
  if (!startHHMM) return '';
  const h = Number(startHHMM.slice(0,2)); const m = Number(startHHMM.slice(3,5));
  let hh = h; let mm = m + BLOCK_MINUTES; if (mm >= 60) { mm -= 60; hh += 1; }
  const end = `${pad2(hh)}:${pad2(mm)}`;
  const fA = h >= 12 ? 'PM' : 'AM'; const tA = hh >= 12 ? 'PM' : 'AM';
  const fTxt = to12h(startHHMM).replace(/\s(AM|PM)$/,'');
  const tTxt = to12h(end).replace(/\s(AM|PM)$/,'');
  return fA === tA ? `${fTxt}-${tTxt} ${fA}` : `${to12h(startHHMM)} - ${to12h(end)}`;
};

// Clamp payment status to editable values
const sanitizePayStatus = (v: any): 'pending'|'advance'|'settled' => (v==='advance' || v==='settled') ? v : 'pending';

// Normalize booking status coming from backend to consistent labels
// Maps variants like "canceled", "cancel", "CANCELLED" -> "cancelled"
// Also handles common aliases for completed/confirmed/pending
const normalizeBookingStatus = (val: any): 'pending'|'confirmed'|'completed'|'cancelled'|string => {
  const v = String(val ?? '').trim().toLowerCase();
  if (!v) return 'pending';
  if (v.startsWith('cancel')) return 'cancelled';
  if (v === 'canceled') return 'cancelled';
  if (v === 'cancelled') return 'cancelled';
  if (v === 'completed' || v === 'complete' || v === 'done' || v === 'closed') return 'completed';
  if (v === 'confirmed' || v === 'confirm') return 'confirmed';
  if (v === 'booked') return 'pending';
  if (v === 'pending') return 'pending';
  return v as any;
};

/**
 * Salon Appointments Page
 * Data Source: master_appointment table
 * Schema columns mapped: appointment_date, slot_from, slot_to, staff_name, customer_name, status, total_amount, advance_paid, balance_due
 * UI: KPI cards, calendar (availability heat), searchable list, export
 */

interface DerivedAppointment extends AppointmentRow {
  payment_status?: 'pending' | 'advance' | 'settled';
  amount?: number;
}

const PAGE_SIZE_OPTIONS = [10,25,50];

export default function SalonAppointments() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [raw, setRaw] = useState<DerivedAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string|number|undefined>();
  const [editRowId, setEditRowId] = useState<string|number|undefined>();
  const [editPaymentStatus, setEditPaymentStatus] = useState<'pending'|'advance'|'settled'>('pending');
  const [editAdvance, setEditAdvance] = useState<string>('');
  const [paymentModes, setPaymentModes] = useState<Array<{ value:string; label:string }>>([]);
  const [paymentModeNameMap, setPaymentModeNameMap] = useState<Record<string,string>>({});
  const [payModesLoading, setPayModesLoading] = useState<boolean>(false);
  const [editPaymentMode, setEditPaymentMode] = useState<string>('');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [pendingSaveRow, setPendingSaveRow] = useState<DerivedAppointment | null>(null);
  const [staffMaster, setStaffMaster] = useState<string[]>([]);
  const [staffMasterData, setStaffMasterData] = useState<any[]>([]);

  // Appointment transaction state
  // Store complete appointment object keyed by appointmentId
  const [appointmentTransactions, setAppointmentTransactions] = useState<Record<string, any>>({});
  const [loadingTransactions, setLoadingTransactions] = useState<Set<string>>(new Set());
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string>('');
  // Cancel confirmation state
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelRemark, setCancelRemark] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);

  // Filters
  const todayStr = todayYMDIST();
  const initialToday = parseYMDToIST(todayStr);
  const defaultFromYMD = format(startOfMonth(initialToday), 'yyyy-MM-dd');
  const defaultToYMD = format(endOfMonth(initialToday), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState<string>(defaultFromYMD);
  const [toDate, setToDate] = useState<string>(defaultToYMD);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all'|'pending'|'advance'|'settled'|'cancelled'>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [staffFilterQuery, setStaffFilterQuery] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // UI toggles (legacy; calendar now shown inline inside the list card)
  const [showCalendar, setShowCalendar] = useState(true);

  const formatYMDToDMY = (ymd: string): string => {
    if (!ymd) return '';
    try {
      return format(parseYMDToIST(ymd), 'dd/MM/yyyy');
    } catch {
      return ymd;
    }
  };

  const parseDMYToYMD = (raw: string): string | null => {
    const s = String(raw || '').trim();
    if (!s) return null;

    // Accept DD/MM/YYYY or DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    // Validate date components (reject 31/02/2026 etc.)
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;

    return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  type DatePreset = 'today' | 'thisWeek' | 'thisMonth' | 'threeMonths';
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth');
  const applyDatePreset = (preset: DatePreset) => {
    const today = parseYMDToIST(todayYMDIST());

    if (preset === 'today') {
      const ymd = todayYMDIST();
      setFromDate(ymd);
      setToDate(ymd);
      return;
    }

    if (preset === 'thisWeek') {
      const start = startOfWeek(today, { weekStartsOn: 1 });
      const end = endOfWeek(today, { weekStartsOn: 1 });
      setFromDate(format(start, 'yyyy-MM-dd'));
      setToDate(format(end, 'yyyy-MM-dd'));
      return;
    }

    if (preset === 'thisMonth') {
      const start = startOfMonth(today);
      const end = endOfMonth(today);
      setFromDate(format(start, 'yyyy-MM-dd'));
      setToDate(format(end, 'yyyy-MM-dd'));
      return;
    }

    // threeMonths
    const start = new Date(today);
    start.setMonth(today.getMonth() - 2);
    setFromDate(format(start, 'yyyy-MM-dd'));
    setToDate(todayYMDIST());
  };

  const [fromInput, setFromInput] = useState<string>(() => formatYMDToDMY(todayStr));
  const [toInput, setToInput] = useState<string>(() => formatYMDToDMY(todayStr));

  useEffect(() => {
    setFromInput(formatYMDToDMY(fromDate));
  }, [fromDate]);

  useEffect(() => {
    setToInput(formatYMDToDMY(toDate));
  }, [toDate]);

  // Report date range helper (for headers/metadata)
  const reportDateRange = useMemo(() => {
    const from = fromDate ? new Date(fromDate) : new Date();
    const to = toDate ? new Date(toDate) : (fromDate ? new Date(fromDate) : new Date());
    return { from, to };
  }, [fromDate, toDate]);

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState<Date>(parseYMDToIST(todayStr));
  const [calFrom, setCalFrom] = useState<string>('');
  const [calTo, setCalTo] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [openModal, setOpenModal] = useState(false);
  const [modalDate, setModalDate] = useState<string>('');
  const [modalStaff, setModalStaff] = useState<string>('');
  const [modalFrom, setModalFrom] = useState<string>(''); // HH:MM:SS
  const [modalTo, setModalTo] = useState<string>('');     // HH:MM:SS
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('all');
  const [staffSearchQuery, setStaffSearchQuery] = useState<string>('');
  // Details popup state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsRow, setDetailsRow] = useState<DerivedAppointment | null>(null);
  // KPI tap-to-filter and mobile expand state
  type KpiKey = 'advanced'|'paid'|'settlement'|'pending'|'total';
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState<Record<string, boolean>>({});

  const handleKpiTap = (key: KpiKey) => {
    if (activeKpi === key) {
      setActiveKpi(null);
      setStatusFilter('all');
      return;
    }
    setActiveKpi(key);
    const map: Record<KpiKey, 'all'|'pending'|'advance'|'settled'> = {
      advanced: 'advance',
      paid: 'settled',
      settlement: 'advance',
      pending: 'pending',
      total: 'all',
    };
    setStatusFilter(map[key]);
  };

  useEffect(()=>{
    // Keep KPI highlight in sync with status dropdown
    const current = (()=>{
      if (statusFilter === 'advance') return 'advanced' as KpiKey;
      if (statusFilter === 'settled') return 'paid' as KpiKey;
      if (statusFilter === 'pending') return 'pending' as KpiKey;
      if (statusFilter === 'all') return 'total' as KpiKey;
      return null;
    })();
    setActiveKpi(current);
  }, [statusFilter]);

  useEffect(()=>{
    const fetchData = async () => {
      if (!user) return;
      setLoading(true); setError(null);
      try {
        const acc = (user as any)?.account_code || ''; const ret = (user as any)?.retail_code || '';
        if (!acc || !ret) return;
        
        // Use appointment transaction service instead of AppointmentService
        const rows = await AppointmentTransactionService.fetchAppointments(acc, ret, fromDate, toDate);
        const mapped: DerivedAppointment[] = (rows||[]).map(r=>{
          const amount = Number(r.total_amount)||0;
          const adv = Number(r.advance_paid)||0;
          const bal = r.balance_due != null ? Number(r.balance_due) : Math.max(amount-adv,0);
          let payment_status: DerivedAppointment['payment_status'] = 'pending';
          if (adv>0 && adv < amount) payment_status = 'advance';
          if (amount>0 && bal <=0) payment_status = 'settled';
          return { ...r, amount, advance_paid: adv, balance_due: bal, payment_status };
        });
        setRaw(mapped);
        // payment modes are loaded in a dedicated effect below
        // If we arrived after creating a record remove the query param for cleanliness
        const params = new URLSearchParams(location.search);
        if (params.get('created')==='1') {
          params.delete('created');
          navigate({ pathname: '/appointments', search: params.toString()? `?${params.toString()}`: '' }, { replace: true });
        }
      } catch(e:any){ setError(e.message||String(e)); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [user, location.search, navigate, fromDate, toDate]);

  // Load payment modes from masters once
  useEffect(()=>{
    const loadPayModes = async () => {
      if (!user) return;
      setPayModesLoading(true);
      try {
        const acc = (user as any)?.account_code || ''; const ret = (user as any)?.retail_code || '';
        if (!acc || !ret) return;
        let names: string[] = [];
        try {
          const res = await ApiService.post('/read', { tables: ['master_paymentmodes'], account_code: acc, retail_code: ret });
          const data:any = (res as any)?.data || {};
          const rows:any[] = data.master_paymentmodes || data.master_payment_mode || data.payment_modes || data.payment_mode_master || data.master_paymode || data.paymodes || data.paymentmodes || [];
          names = rows.map((r:any, idx:number)=> String(r.payment_mode_name ?? r.paymode_name ?? r.name ?? r.mode ?? r.payment_mode ?? `Mode ${idx+1}`));
        } catch {
          // fallback to POM
          try {
            const res2 = await ApiService.post('/read', { tables: ['POM'], account_code: acc, retail_code: ret });
            const data2:any = (res2 as any)?.data || {};
            const rows2:any[] = data2.POM || data2.pom || [];
            names = rows2.map((r:any, idx:number)=> String(r.payment_mode_name ?? r.paymode_name ?? r.name ?? r.mode ?? `Mode ${idx+1}`));
          } catch {}
        }
        // Safe fallback list if nothing returned
        if (!names || names.length === 0) {
          names = ['Cash','Card','Upi','Cheque'];
        }
        const dedup = Array.from(new Set(names)).filter(Boolean).sort((a,b)=> a.localeCompare(b));
        const opts = dedup.map(n=> ({ value: n, label: n }));
        setPaymentModes(opts);
        const map: Record<string,string> = {}; opts.forEach(o=> map[o.value]=o.label);
        setPaymentModeNameMap(map);
      } finally {
        setPayModesLoading(false);
      }
    };
    loadPayModes();
  }, [user]);

  // Load staff master list once and merge with names from appointments
  useEffect(()=>{
    const loadStaff = async () => {
      if (!user) return;
      try {
        const acc = (user as any)?.account_code || ''; const ret = (user as any)?.retail_code || '';
        if (!acc || !ret) return;
        const tables = ['master_employee'];
        const res = await ApiService.post('/read', { tables, account_code: acc, retail_code: ret });
        const data:any = (res as any)?.data ?? {};
        const allRows:any[] = [];
        if (Array.isArray(data)) {
          allRows.push(...data);
        } else {
          for (const key of tables) {
            const rows:any[] = data?.[key];
            if (Array.isArray(rows)) allRows.push(...rows);
          }
        }
        
        // Store full staff data including gender
        const staffData = allRows.filter((r:any)=> r && (r.status == null || r.status === 1));
        setStaffMasterData(staffData);
        
        let names = staffData
          .map((r:any) => String(r.employee_name ?? r.staff_name ?? r.name ?? r.full_name ?? r.user_name ?? r.username ?? ''))
          .filter(Boolean);
        // case-insensitive dedupe
        const seen = new Set<string>();
        names = names.filter(n=>{ const k = n.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        names.sort((a,b)=> a.localeCompare(b));
        // console.log('Staff API response:', { data, allRows, names });
        setStaffMaster(names);
      } catch {}
    };
    loadStaff();
  }, [user]);

  // If editing and modes just loaded while selection empty, set sensible default
  useEffect(()=>{
    if (editRowId != null && !editPaymentMode && paymentModes.length > 0) {
      const cash = paymentModes.find(m=> m.label.toLowerCase()==='cash');
      setEditPaymentMode(cash?.value || paymentModes[0].value);
    }
  }, [editRowId, editPaymentMode, paymentModes]);

  const staffOptions = useMemo(()=>{
    const names = (staffMasterData || [])
      .map(staff => String(staff.employee_name ?? staff.staff_name ?? staff.name ?? staff.full_name ?? staff.user_name ?? staff.username ?? ''))
      .filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [staffMasterData]);

  // Filtered list
  const filtered = useMemo(()=>{
    return raw.filter(r=>{
      const dStr = r.appointment_date || '';
      let inRange = true;
      try {
        if (fromDate) inRange = inRange && dStr >= fromDate;
        if (toDate) inRange = inRange && dStr <= toDate;
      } catch { inRange = false; }
      if (!inRange) {
        return false;
      }
      const q = search.toLowerCase();
      if (q) {
        const blob = [r.customer_name, r.customer_phone, r.staff_name, r.appointment_id].map(x=>String(x||'').toLowerCase()).join(' ');
        if (!blob.includes(q)) return false;
      }
      if (statusFilter !== 'all') {
        const s = normalizeBookingStatus((r as any).status);
        if (statusFilter === 'cancelled') {
          if (s !== 'cancelled') return false;
        } else {
          if (r.payment_status !== statusFilter) return false;
        }
      }
      if (staffFilter !== 'all' && r.staff_name !== staffFilter) return false;
      return true;
    });
  }, [raw, fromDate, toDate, search, statusFilter, staffFilter, staffMasterData]);

  // KPI metrics (Advanced, Paid, Settlement, Pending, Total)
  const kpis = useMemo(()=>{
    const totalQty = filtered.length;
    const totalAmount = filtered.reduce((s,r)=> s + (r.amount||0),0);
    const isCancelled = (r:DerivedAppointment)=> normalizeBookingStatus((r as any).status) === 'cancelled';
    const advanced = filtered.filter(r=> r.payment_status==='advance' && !isCancelled(r));
    const paid = filtered.filter(r=> r.payment_status==='settled' && !isCancelled(r));
    const pending = filtered.filter(r=> r.payment_status==='pending' && !isCancelled(r));
    const settlementAll = filtered.filter(r=> (Number(r.advance_paid)||0) > 0);
    // helpers
    const sumAmount = (arr:DerivedAppointment[])=> arr.reduce((s,r)=> s + (r.amount||0),0);
    const sumAdvance = (arr:DerivedAppointment[])=> arr.reduce((s,r)=> s + (Number(r.advance_paid)||0),0);
    return {
      advanced: { qty: advanced.length, amount: sumAdvance(advanced) },
      paid: { qty: paid.length, amount: sumAmount(paid) },
      settlement: { qty: settlementAll.length, amount: sumAdvance(settlementAll) },
      pending: { qty: pending.length, amount: sumAmount(pending) },
      total: { qty: totalQty, amount: totalAmount },
    };
  }, [filtered]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageData = useMemo(()=>{
    const start = (page-1)*pageSize; return filtered.slice(start, start+pageSize);
  }, [filtered, page, pageSize]);
  useEffect(()=>{ setPage(1); }, [filtered.length, pageSize]);

  // Calendar generation (month grid)
  const calendarDays = useMemo(()=>{
    const mStart = startOfMonth(calendarMonth); const mEnd = endOfMonth(calendarMonth);
    const start = startOfWeek(mStart); const end = endOfWeek(mEnd);
    const days = eachDayOfInterval({ start, end });
    return days.map(d=>({ date: d, key: format(d,'yyyy-MM-dd') }));
  }, [calendarMonth, filtered]);

  const fmtINR = (n:number)=> `\u20B9${n.toLocaleString('en-IN')}`;

  const serviceNames = (srv: any): string => {
    try {
      let v = srv;
      for (let i=0;i<2;i++) {
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch { break; }
        }
      }
      if (Array.isArray(v)) {
        const names = v.map((x:any)=> x?.name || x?.service_name || x?.title).filter(Boolean);
        if (names.length) return names.join(', ');
      }
    } catch {}
    return '';
  };

  const beginEdit = (r: DerivedAppointment) => {
    setEditRowId(r.id || r.appointment_id);
    setEditPaymentStatus(sanitizePayStatus(r.payment_status));
    setEditAdvance(r.advance_paid != null ? String(r.advance_paid) : '');
    const existing = String((r as any).payment_mode || '');
    setEditPaymentMode(existing || (paymentModes[0]?.value || ''));
  };

  const printAppointment = (r: DerivedAppointment) => {
    const servicesText = serviceNames((r as any).services);
    const paid = Number(r.advance_paid) || 0; // Use advance_paid directly as the paid amount
    const tm = range12(r.slot_from as any, r.slot_to as any);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Appointment ${r.appointment_id||''}</title>
    <style>
      @media print { @page { size: 80mm auto; margin: 6mm } }
      body{font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif; color:#111; background:#fff;}
      .wrap{max-width:360px;margin:0 auto;padding:8px}
      .hdr{display:flex;align-items:center;gap:8px;border-bottom:1px dashed #ccc;padding-bottom:8px;margin-bottom:8px}
      .logo{height:28px;width:28px;object-fit:contain}
      .brand{font-weight:700;font-size:14px;line-height:1}
      .sub{font-size:10px;color:#555}
      .title{font-size:12px;font-weight:600;margin:6px 0}
      table{border-collapse:collapse;width:100%}
      td{padding:4px 0;font-size:11px;vertical-align:top}
      .label{color:#555;width:120px}
      .val{font-weight:600}
      .total{border-top:1px dashed #ccc;margin-top:6px;padding-top:6px;font-size:12px}
      .foot{margin-top:10px;font-size:10px;color:#666;text-align:center}
      .qr{margin-top:6px;text-align:center}
    </style></head><body>
      <div class="wrap">
        <div class="hdr">
          <img src="/Salon_POS.png" alt="Logo" class="logo"/>
          <div>
            <div class="brand">Your Salon</div>
            <div class="sub">Contact: +91 9418529635</div>
          </div>
        </div>
        <div class="title">Appointment Receipt</div>
        <table>
          <tr><td class="label">Date</td><td class="val">${r.appointment_date ? formatYMDToDMY(r.appointment_date) : ''}</td></tr>
          <tr><td class="label">Time</td><td class="val">${tm}</td></tr>
          <tr><td class="label">Staff</td><td class="val">${r.staff_name||'-'}</td></tr>
          <tr><td class="label">Customer</td><td class="val">${r.customer_name||'-'} ${r.customer_phone? '('+r.customer_phone+')':''}</td></tr>
          <tr><td class="label">Appt ID</td><td class="val">${r.appointment_id||'-'}</td></tr>
          <tr><td class="label">Services</td><td class="val">${servicesText||'-'}</td></tr>
          <tr><td class="label">Total</td><td class="val">${fmtINR(r.amount||0)}</td></tr>
          <tr><td class="label">Paid</td><td class="val">${fmtINR(paid)}</td></tr>
          <tr><td class="label">Balance</td><td class="val">${fmtINR(r.balance_due!=null? Number(r.balance_due): Math.max((r.amount||0)-paid,0))}</td></tr>
          <tr><td class="label">Pay Mode</td><td class="val">${String((r as any).payment_mode || '-')}</td></tr>
          <tr><td class="label">Status</td><td class="val">${r.payment_status||'-'}</td></tr>
        </table>
        <div class="total">Thank you for choosing us!</div>
        <br/>Generated on ${format(new Date(),'dd-MM-yyyy HH:mm')}</div>
      </div>
      <script>window.onload = function(){ window.print(); setTimeout(()=> window.close(), 300); }</script>
    </body></html>`;
    const win = window.open('', '_blank', 'width=420,height=720');
    if (win) { win.document.open(); win.document.write(html); win.document.close(); }
  };

  const shareAppointment = async (r: DerivedAppointment) => {
    const servicesText = serviceNames((r as any).services);
    const tm = range12(r.slot_from as any, r.slot_to as any);
    const amount = r.amount || 0;
    const bal = r.balance_due != null ? Number(r.balance_due) : Math.max(amount - (Number(r.advance_paid)||0), 0);
    const paid = Number(r.advance_paid) || 0; // Use advance_paid directly as the paid amount
    const headline = `💈 Your Salon – Appointment`;
    const lines = [
      `📅 Date: ${r.appointment_date ? formatYMDToDMY(r.appointment_date) : ''}`,
      `⏰ Time: ${tm}`,
      `👤 Staff: ${r.staff_name||'-'}`,
      `🧾 Appt ID: ${r.appointment_id||''}`,
      servicesText ? `💇 Services: ${servicesText}` : null,
      `💰 Amount: ${fmtINR(amount)}`,
      `✅ Paid: ${fmtINR(paid)}`,
      `🧮 Balance: ${fmtINR(bal)}`,
      `💳 Mode: ${String((r as any).payment_mode || '-')}`,
      `📌 Status: ${r.payment_status||'-'}`,
      '',
    ].filter(Boolean) as string[];
    const text = [headline, ...lines].join('\n');

    // Prefer Web Share API
    try {
      if (navigator.share) {
        await navigator.share({ title: `Appointment ${r.appointment_id||''}`, text });
        toast({ title: 'Shared', description: 'Appointment details shared.' });
        return;
      }
    } catch {}

    // WhatsApp direct: if customer phone exists, pre-address message to them
    const cleanMsisdn = (p?: string) => (p||'').replace(/[^0-9]/g,'');
    const customerPhone = cleanMsisdn(String(r.customer_phone||''));
    if (customerPhone) {
      const waUrl = `https://wa.me/${customerPhone}?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank');
      return;
    }

    // Fallback: clipboard, else generic wa.me
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: 'Details copied to clipboard.' });
    } catch {
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    }
  };
  const cancelEdit = () => { setEditRowId(undefined); setSavingId(undefined); };
  const doPersistUpdate = async (r: DerivedAppointment) => {
    if (!user) return;
    const acc = (user as any)?.account_code; const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;
    const amount = r.amount || 0;
    let advancePaid = Number(editAdvance||0);
    if (editPaymentStatus === 'settled') advancePaid = amount; // force fully paid
    else if (advancePaid > amount) advancePaid = amount;
    let balance = Math.max(amount - advancePaid, 0);
    // Require payment mode when collecting any amount
    if ((advancePaid > 0 || editPaymentStatus === 'settled') && !editPaymentMode) { setError('Select a payment mode'); return; }
    // Do NOT modify backend 'status' column here (may have limited size / enum). Payment settlement tracked via financials only.
    setSavingId(r.id || r.appointment_id);
    try {
      // Use appointment transaction service instead of AppointmentService
      await AppointmentTransactionService.update(r.appointment_id!, {
        update_fields: {
          advance_paid: advancePaid,
          balance_due: balance,
          ...(editPaymentMode ? { payment_mode: editPaymentMode } : {}),
        }
      }, acc, ret);
      // optimistic local update
      setRaw(prev=> prev.map(x=>{
        if ((x.id||x.appointment_id) === (r.id||r.appointment_id)) {
          return { ...x, advance_paid: advancePaid, balance_due: balance, payment_status: editPaymentStatus, payment_mode: editPaymentMode } as any;
        }
        return x;
      }));
      cancelEdit();
    } catch(e:any) {
      setError(e.message||String(e));
    } finally { setSavingId(undefined); }
  };

  const handleSave = async (r: DerivedAppointment) => {
    const amount = r.amount || 0;
    let advancePaid = Number(editAdvance||0);
    if (editPaymentStatus === 'settled') advancePaid = amount;
    const needsMode = (advancePaid > 0 || editPaymentStatus === 'settled');
    if (needsMode && !editPaymentMode) {
      setPendingSaveRow(r);
      setPaymentDialogOpen(true);
      return;
    }
    await doPersistUpdate(r);
  };

  // Appointment Transaction Functions
  const fetchAppointmentTransactions = async (appointmentId: string) => {
    if (!user || !appointmentId) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    setLoadingTransactions(prev => new Set(prev).add(appointmentId));
    try {
      const response = await AppointmentTransactionService.get(appointmentId, acc, ret);
      if (response.success && response.data) {
        // Handle 3-table response format: complete appointment data object
        setAppointmentTransactions(prev => ({
          ...prev,
          [appointmentId]: response.data // Store complete appointment object
        }));
      }
    } catch (error: any) {
      console.error('Failed to fetch appointment transactions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load appointment transaction details',
        variant: 'destructive'
      });
    } finally {
      setLoadingTransactions(prev => {
        const newSet = new Set(prev);
        newSet.delete(appointmentId);
        return newSet;
      });
    }
  };

  const createAppointmentTransaction = async (appointmentData: DerivedAppointment) => {
    if (!user || !appointmentData.appointment_id) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    try {
      const transactionData = {
        appointment_id: appointmentData.appointment_id,
        account_code: acc,
        retail_code: ret,
        customer_id: '', // Not available in AppointmentRow
        customer_name: appointmentData.customer_name || '',
        customer_phone: appointmentData.customer_phone || '',
        staff_id: appointmentData.staff_id || '',
        staff_name: appointmentData.staff_name || '',
        services_total: appointmentData.total_amount || 0,
        discount: appointmentData.discount || 0,
        tax_rate: appointmentData.tax_rate || 0,
        tax_amount: appointmentData.tax_amount || 0,
        cgst_amount: appointmentData.cgst_amount || 0,
        sgst_amount: appointmentData.sgst_amount || 0,
        membership_discount: 0 // Add if available in appointment data
      };

      const response = await AppointmentTransactionService.createFromAppointment(transactionData);
      if (response.success) {
        toast({
          title: 'Success',
          description: 'Appointment transactions created successfully'
        });
        // Refresh transaction data
        await fetchAppointmentTransactions(appointmentData.appointment_id);
      }
    } catch (error: any) {
      console.error('Failed to create appointment transactions:', error);
      toast({
        title: 'Error',
        description: 'Failed to create appointment transactions',
        variant: 'destructive'
      });
    }
  };

  const viewTransactionDetails = (appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
    if (!appointmentTransactions[appointmentId]) {
      fetchAppointmentTransactions(appointmentId);
    }
    setTransactionDialogOpen(true);
  };

  // ---------- Reports (Excel) ----------
  const exportAppointmentListExcel = () => {
    const rows = filtered.map(r=>{
      const amount = Number(r.amount) || 0;
      const paid = Number(r.advance_paid) || 0;
      const pending = r.balance_due != null ? Number(r.balance_due) : Math.max(amount - paid, 0);
      return ({
        date: r.appointment_date ? new Date(r.appointment_date) : new Date(),
        time: `${String(r.slot_from||'').slice(0,5)}${r.slot_to ? `-${String(r.slot_to).slice(0,5)}` : ''}`,
        staff: r.staff_name || '-',
        customer: r.customer_name || '-',
        phone: r.customer_phone || '-',
        appointment_id: r.appointment_id || '',
        payment_mode: String((r as any).payment_mode || ''),
        payment_status: r.payment_status || 'pending',
        advance_amount: paid,
        pending_amount: pending,
        total_amount: amount,
        booking_status: normalizeBookingStatus((r as any).status) || '-',
      });
    });
    exportData('excel', {
      filename: `appointments-list-${format(reportDateRange.from,'yyyyMMdd')}-${format(reportDateRange.to,'yyyyMMdd')}`,
      title: 'Appointment List',
      columns: [
        { header: 'Date', dataKey: 'date', width: 14 },
        { header: 'Time', dataKey: 'time', width: 14 },
        { header: 'Staff', dataKey: 'staff', width: 18 },
        { header: 'Customer', dataKey: 'customer', width: 22 },
        { header: 'Phone', dataKey: 'phone', width: 16 },
        { header: 'Appt ID', dataKey: 'appointment_id', width: 16 },
        { header: 'Pay Mode', dataKey: 'payment_mode', width: 14 },
        { header: 'Payment Status', dataKey: 'payment_status', width: 16 },
        { header: 'Advance', dataKey: 'advance_amount', width: 12 },
        { header: 'Pending', dataKey: 'pending_amount', width: 12 },
        { header: 'Amount', dataKey: 'total_amount', width: 12 },
        { header: 'Booking Status', dataKey: 'booking_status', width: 14 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportDailySummaryExcel = () => {
    const map = new Map<string, { date: Date; qty: number; advance_amount: number; pending_amount: number; total_amount: number }>();
    filtered.forEach(r => {
      const key = r.appointment_date || '';
      const dateObj = key ? new Date(key) : new Date();
      if (!map.has(key)) map.set(key, { date: dateObj, qty: 0, advance_amount: 0, pending_amount: 0, total_amount: 0 });
      const rec = map.get(key)!;
      const amount = Number(r.amount) || 0;
      const paid = Number(r.advance_paid) || 0;
      const pending = r.balance_due != null ? Number(r.balance_due) : Math.max(amount - paid, 0);
      rec.qty += 1; rec.advance_amount += paid; rec.pending_amount += pending; rec.total_amount += amount;
    });
    const rows = Array.from(map.values()).sort((a,b)=> a.date.getTime() - b.date.getTime());
    exportData('excel', {
      filename: `appointments-daily-summary-${format(reportDateRange.from,'yyyyMMdd')}-${format(reportDateRange.to,'yyyyMMdd')}`,
      title: 'Daily Summary',
      columns: [
        { header: 'Date', dataKey: 'date', width: 14 },
        { header: 'Appointments', dataKey: 'qty', width: 14 },
        { header: 'Advance', dataKey: 'advance_amount', width: 14 },
        { header: 'Pending', dataKey: 'pending_amount', width: 14 },
        { header: 'Total Amount', dataKey: 'total_amount', width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportStaffSummaryExcel = () => {
    const map = new Map<string, { staff: string; qty: number; total_amount: number }>();
    filtered.forEach(r => {
      const name = r.staff_name || '-';
      if (!map.has(name)) map.set(name, { staff: name, qty: 0, total_amount: 0 });
      const rec = map.get(name)!;
      rec.qty += 1; rec.total_amount += Number(r.amount) || 0;
    });
    const rows = Array.from(map.values()).sort((a,b)=> b.total_amount - a.total_amount);
    exportData('excel', {
      filename: `appointments-staff-summary-${format(reportDateRange.from,'yyyyMMdd')}-${format(reportDateRange.to,'yyyyMMdd')}`,
      title: 'Staff-wise Summary',
      columns: [
        { header: 'Staff', dataKey: 'staff', width: 22 },
        { header: 'Appointments', dataKey: 'qty', width: 14 },
        { header: 'Total Amount', dataKey: 'total_amount', width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportPaymentStatusSummaryExcel = () => {
    const buckets: Record<string, { status: string; qty: number; total_amount: number }> = {
      pending: { status: 'Pending', qty: 0, total_amount: 0 },
      advance: { status: 'Advanced', qty: 0, total_amount: 0 },
      settled: { status: 'Settled', qty: 0, total_amount: 0 },
      cancelled: { status: 'Cancelled', qty: 0, total_amount: 0 },
    };
    filtered.forEach(r => {
      const sBook = normalizeBookingStatus((r as any).status);
      const key = sBook === 'cancelled' ? 'cancelled' : (r.payment_status || 'pending');
      const b = buckets[key]; if (!b) return; b.qty += 1; b.total_amount += Number(r.amount)||0;
    });
    const rows = Object.values(buckets);
    exportData('excel', {
      filename: `appointments-payment-summary-${format(reportDateRange.from,'yyyyMMdd')}-${format(reportDateRange.to,'yyyyMMdd')}`,
      title: 'Payment Status Summary',
      columns: [
        { header: 'Status', dataKey: 'status', width: 18 },
        { header: 'Appointments', dataKey: 'qty', width: 14 },
        { header: 'Total Amount', dataKey: 'total_amount', width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportCustomerContactsExcel = () => {
    const map = new Map<string, { customer: string; phone: string; bookings: number; total_amount: number }>();
    filtered.forEach(r => {
      const name = r.customer_name || '-';
      const phone = r.customer_phone || '-';
      const key = `${name}|${phone}`;
      if (!map.has(key)) map.set(key, { customer: name, phone, bookings: 0, total_amount: 0 });
      const rec = map.get(key)!;
      rec.bookings += 1; rec.total_amount += Number(r.amount)||0;
    });
    const rows = Array.from(map.values()).sort((a,b)=> b.total_amount - a.total_amount);
    exportData('excel', {
      filename: `appointments-contacts-${format(reportDateRange.from,'yyyyMMdd')}-${format(reportDateRange.to,'yyyyMMdd')}`,
      title: 'Customer Contact List',
      columns: [
        { header: 'Customer', dataKey: 'customer', width: 26 },
        { header: 'Phone', dataKey: 'phone', width: 18 },
        { header: 'Bookings', dataKey: 'bookings', width: 12 },
        { header: 'Total Amount', dataKey: 'total_amount', width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  return (
    <div className="space-y-2 sm:space-y-3 px-2 sm:px-3 lg:px-2 pt-0 pb-2 max-w-full overflow-x-hidden">
      {/* KPI Cards moved inside Appointment List card below */}

      {/* Calendar Layout */}
      <div className="w-full">
        {/* Constrain calendar width for a tighter look on large screens */}
  <div className="w-full max-w-[1100px] px-1 sm:px-2 mx-auto">
        {/* Calendar */}
  {false && (
        <Card className="border border-gray-200/70 shadow-sm bg-white">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 sm:py-4 px-3 sm:px-5 border-b border-gray-100 gap-3 sm:gap-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <CardTitle className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base font-semibold text-gray-900">
              <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 flex-shrink-0"/>
              <span className="truncate">Appointment Booking Calendar</span>
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const today = parseYMDToIST(todayYMDIST());
                setCalendarMonth(today);
              }}
              className="h-7 sm:h-8 px-2 sm:px-3 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-xs flex-shrink-0"
              title="Go to current month"
            >
              Today
            </Button>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 justify-center sm:justify-end">
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100"
              onClick={()=> setCalendarMonth(addMonths(calendarMonth,-1))}
            >
              <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            <div className="text-xs sm:text-sm font-medium w-28 sm:w-36 text-center text-gray-700">
              {format(calendarMonth,'MMMM yyyy')}
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100"
              onClick={()=> setCalendarMonth(addMonths(calendarMonth,1))}
            >
              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            {/* Hide button removed intentionally */}
          </div>
        </CardHeader>
        <CardContent className="pt-3 sm:pt-4 pb-4 sm:pb-5 px-3 sm:px-5">

          {/* Calendar grid wrapper with full border */}
          <div className="space-y-2">
            <div className="rounded-lg border border-slate-200/80 p-1 sm:p-2 bg-white">
              {/* Days of week header */}
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=> (
                  <div key={d} className="p-0.5 sm:p-1 text-center text-xs font-medium text-gray-500">
                    {d}
                  </div>
                ))}
              </div>
              
              {/* Calendar days */}
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mt-1 sm:mt-2">
              {calendarDays.map(d=>{
                const inMonth = d.date.getMonth() === calendarMonth.getMonth();
                const todayYMD = todayStr;
                const isPast = d.key < todayYMD;
                // Calendar filter range check
                let inRange = true;
                if (calFrom) inRange = inRange && d.key >= calFrom;
                if (calTo) inRange = inRange && d.key <= calTo;
                // Determine if the day has any available (future & unbooked) slots
                const isToday = d.key === todayStr;
                const now = nowIST();
                const nowHH = Number(format(now,'HH'));
                const nowMM = Number(format(now,'mm'));
                const currentBlockStart = `${pad2(nowHH)}:${nowMM < 30 ? '00' : '30'}`;
                const staffNames = (staffFilter === 'all' ? (staffMaster && staffMaster.length ? staffMaster : []) : [staffFilter]).filter(Boolean);
                const hasAnyAvailability = (()=>{
                  if (!inMonth || isPast) return false;
                  const pad = (n:number)=> String(n).padStart(2,'0');
                  const addBlock = (hh:number, mm:number) => {
                    mm += BLOCK_MINUTES; if (mm >= 60) { mm -= 60; hh += 1; }
                    return `${pad(hh)}:${pad(mm)}`; // HH:MM
                  };
                  // If no staff filter and no staff master yet, we can't be sure. Assume not available until staff loads.
                  if (staffNames.length === 0) return false;
                  // Check per staff if any free 30-min block exists
                  for (const st of staffNames) {
                    const appts = raw.filter(r=> r.appointment_date === d.key && r.staff_name === st && (normalizeBookingStatus((r as any).status) !== 'cancelled'));
                    for (let h=0; h<=23; h++) {
                      for (const m of [0,30]) {
                        const v = `${pad(h)}:${pad(m)}`; // start HH:MM
                        if (isToday && v < currentBlockStart) continue; // hide strictly past blocks
                        const endHM = addBlock(h, m); // end HH:MM
                        const booked = appts.some(a=>{
                          const from = (a.slot_from||'').slice(0,5);
                          const to = (a.slot_to||'').slice(0,5);
                          return !(to <= v || from >= endHM);
                        });
                        if (!booked) return true;
                      }
                    }
                  }
                  return false;
                })();
                const clickable = inMonth && !isPast && inRange && hasAnyAvailability;
                const selected = selectedDate === d.key;
                // Compute day bookings (respect staff filter, exclude cancelled)
                const dayAppts = raw.filter(r=> r.appointment_date === d.key && (staffFilter==='all' || r.staff_name === staffFilter) && (normalizeBookingStatus((r as any).status) !== 'cancelled'));
                const bookedCount = dayAppts.length;
                const hasBookings = bookedCount > 0;
                
                return (
                  <div
                    key={d.key}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : -1}
                    onKeyDown={(e)=>{ if (!clickable) return; if (e.key==='Enter' || e.key===' ') { e.preventDefault(); setSelectedDate(d.key); setModalDate(d.key); setModalStaff(''); setModalFrom(''); setModalTo(''); setSelectedStaffFilter('all'); setStaffSearchQuery(''); setOpenModal(true);} }}
                    onClick={()=>{
                      if (clickable) {
                        setSelectedDate(d.key);
                        setModalDate(d.key);
                        setModalStaff('');
                        setModalFrom('');
                        setModalTo('');
                        setSelectedStaffFilter('all');
                        setStaffSearchQuery('');
                        setOpenModal(true);
                      }
                    }}
                    className={`
                      relative p-0.5 sm:p-1 h-12 sm:h-14 lg:h-16 border rounded-md transition-all
                      ${!inMonth 
                        ? "bg-slate-50 border-slate-100 text-transparent cursor-default hover:shadow-none opacity-50" 
                        : isPast
                          ? "bg-gray-50 text-gray-400 cursor-not-allowed opacity-50"
                          : clickable
                            ? "bg-green-50 border-green-200 hover:bg-green-100 cursor-pointer hover:shadow-sm"
                            : hasBookings
                              ? "bg-red-50 border-red-200 text-red-700 cursor-not-allowed"
                              : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                      }
                      ${selected ? "ring-1 sm:ring-2 ring-purple-500 border-purple-500" : ""}
                    `}
                    title={inMonth ? (hasBookings 
                      ? dayAppts.map(r=>{
                          const tm = range12(r.slot_from as any, r.slot_to as any);
                          const sv = serviceNames((r as any).services);
                          return `${r.staff_name||'-'} | ${tm}${sv? ' | '+sv: ''}`;
                        }).join('\n')
                      : (clickable ? 'Available - click to create' : 'No slots available')) : ''}
                  >
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between">
                        <span className={`
                          text-xs font-medium
                          ${!inMonth ? "invisible" : "text-gray-900"}
                        `}>
                          {format(d.date,'d')}
                        </span>
                        {inMonth && !isPast && (
                          <div className={`
                            w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full
                            ${clickable ? "bg-green-500" : (hasBookings ? "bg-red-500" : "bg-gray-400")}
                          `} />
                        )}
                      </div>
                      
                      {inMonth && (
                        <div className="flex-1 flex flex-col justify-end">
                          <div className="text-[9px] sm:text-[10px] font-semibold">
                            {hasBookings
                              ? <span className={isPast ? "text-gray-600" : "text-red-700"}>Booked {bookedCount}</span>
                              : !isPast && clickable
                                ? <span className="text-emerald-700 hidden sm:inline">Available</span>
                                : !isPast
                                  ? <span className="text-gray-600 hidden sm:inline">No slots</span>
                                  : null}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-center sm:justify-between pt-2 sm:pt-3 border-t border-gray-100">
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="flex items-center space-x-1.5 sm:space-x-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-green-500 rounded-full"></div>
                  <span className="text-xs text-gray-600">Available</span>
                </div>
                <div className="flex items-center space-x-1.5 sm:space-x-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-500 rounded-full"></div>
                  <span className="text-xs text-gray-600">Booked</span>
                </div>
                <div className="flex items-center space-x-1.5 sm:space-x-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-gray-400 rounded-full"></div>
                  <span className="text-xs text-gray-600">Disabled</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </CardContent>
      </Card>
      )}
      {/* Inline calendar now rendered inside Appointment List card; hidden old toggle removed */}
      </div>
      </div>

      {/* Payment Mode Modal */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Payment Mode</DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-slate-500 -mt-2 mb-2">Required to record an advance or settle payment.</div>
          <div className="space-y-2">
            <Select value={editPaymentMode} onValueChange={v=> setEditPaymentMode(v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Choose a mode"/></SelectTrigger>
              <SelectContent>
                {paymentModes.map(pm=> <SelectItem key={pm.value} value={pm.value}>{pm.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=> { setPaymentDialogOpen(false); setPendingSaveRow(null); }}>Cancel</Button>
            <Button disabled={!editPaymentMode} onClick={async ()=> { if (pendingSaveRow) { await doPersistUpdate(pendingSaveRow); } setPaymentDialogOpen(false); setPendingSaveRow(null); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Appointment</DialogTitle>
            <DialogDescription>
              Please provide a short reason for cancellation. This note will be saved with the booking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700">Remark</label>
            <Textarea
              value={cancelRemark}
              onChange={(e:any)=> setCancelRemark(e.target.value)}
              rows={3}
              placeholder="Enter cancellation remark (min 3 characters)"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=> setCancelConfirmOpen(false)} disabled={cancelSaving}>Back</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700"
              disabled={cancelSaving || (cancelRemark.trim().length < 3) || !selectedAppointmentId}
              onClick={async ()=>{
                if (!user || !selectedAppointmentId) return;
                const acc = (user as any)?.account_code; const ret = (user as any)?.retail_code;
                if (!acc || !ret) return;
                try {
                  setCancelSaving(true);
                  const row = raw.find(x=> String(x.appointment_id)===String(selectedAppointmentId));
                  const prevNote = String((row as any)?.special_requirements || '').trim();
                  const newNote = prevNote ? `${prevNote}\n[Cancelled]: ${cancelRemark.trim()}` : `[Cancelled]: ${cancelRemark.trim()}`;
                  await AppointmentTransactionService.update(selectedAppointmentId, { 
                    update_fields: { 
                      status: 'cancelled', 
                      special_requirements: newNote,
                      advance_paid: 0,
                      balance_due: row?.amount || 0,
                      payment_status: 'cancelled'
                    } 
                  }, acc, ret);
                  
                  // Update the local state to immediately reflect the cancellation
                  setRaw(prev=> prev.map(x=> String(x.appointment_id)===String(selectedAppointmentId)
                    ? ({ 
                        ...x, 
                        status: 'cancelled', 
                        special_requirements: newNote,
                        advance_paid: 0,
                        balance_due: x.amount || 0,
                        payment_status: 'cancelled'
                      } as any)
                    : x));
                  
                  // Close dialog and show success message
                  setCancelConfirmOpen(false);
                  setCancelRemark('');
                  setTransactionDialogOpen(false);
                  
                  toast({ title: 'Booking Cancelled', description: 'Appointment cancelled successfully' });
                  
                  // Refresh appointment transactions data
                  await fetchAppointmentTransactions(selectedAppointmentId);
                } catch(err:any) {
                  toast({ title: 'Error', description: 'Failed to cancel appointment', variant: 'destructive' });
                } finally { setCancelSaving(false); }
              }}
            >
              {cancelSaving ? 'Cancelling…' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Booking Availability Modal */}
      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Availability on {modalDate || ''}</DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-slate-500 mb-3 flex-shrink-0">
            Gray = Past Time (Disabled), Red = Booked, Green = Available, Blue = Selected. Times in IST format. Each slot is exactly 30 minutes. Click any available green slot to select.
          </div>
          
          {/* Main Layout - Left Panel & Right Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 flex-1 overflow-hidden min-h-0">
            
            {/* Left Panel - Filters & Staff Selection */}
            <div className="lg:col-span-2 space-y-4 flex flex-col overflow-hidden">

              {/* Staff Selection */}
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="text-sm font-semibold text-blue-800 mb-3 flex-shrink-0">Select Staff</div>
                
                {/* Staff Search Input */}
                <div className="mb-3 flex-shrink-0">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" />
                    <Input
                      value={staffSearchQuery}
                      onChange={(e) => setStaffSearchQuery(e.target.value)}
                      className="pl-9 h-8 text-xs border-blue-300 bg-white focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                <ScrollArea className="flex-1 overflow-auto pr-2 min-h-0">
                  <div className="space-y-2">
                    {staffOptions
                      .filter(staff => 
                        staffSearchQuery === '' || 
                        staff.toLowerCase().includes(staffSearchQuery.toLowerCase())
                      )
                      .map(staff => {
                        const staffData = staffMasterData.find(s => 
                          (s.employee_name === staff || s.staff_name === staff || s.name === staff)
                        );
                        const skillLevel = staffData?.skill_level;
                        // Count appointments for the selected date for this staff (excluding cancelled)
                        const apptCount = raw.filter(r => 
                          r.appointment_date === modalDate && 
                          r.staff_name === staff &&
                          (normalizeBookingStatus((r as any).status) !== 'cancelled')
                        ).length;
                        
                        return (
                          <Button
                            key={staff}
                            variant={selectedStaffFilter === staff ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              setSelectedStaffFilter(staff);
                              setStaffSearchQuery('');
                            }}
                            className={`w-full h-9 px-3 text-xs font-medium justify-between ${
                              selectedStaffFilter === staff
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'border-blue-300 text-blue-700 hover:bg-blue-100'
                            }`}
                          >
                            <span>{skillLevel ? `${staff} - ${skillLevel}` : staff}</span>
                            <span
                              className={
                                selectedStaffFilter === staff
                                  ? 'ml-2 inline-flex items-center justify-center rounded-full bg-blue-500/20 text-white border border-white/30 px-2 py-0.5 text-[10px]'
                                  : 'ml-2 inline-flex items-center justify-center rounded-full bg-red-100 text-blue-700 px-2 py-0.5 text-[10px]'
                              }
                              title="Appointments on selected date"
                            >
                              {apptCount}
                            </span>
                          </Button>
                        );
                      })}
                    
                    {/* Show message when no staff match search */}
                    {staffOptions.filter(staff => 
                      staffSearchQuery === '' || 
                      staff.toLowerCase().includes(staffSearchQuery.toLowerCase())
                    ).length === 0 && staffSearchQuery && (
                      <div className="text-xs text-blue-600 text-center py-2">
                        No staff found matching "{staffSearchQuery}"
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Right Panel - Time Slots */}
            <div className="lg:col-span-3 flex flex-col overflow-hidden min-h-0">
              <div className="p-4 bg-green-50 rounded-lg border border-green-200 flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="text-sm font-semibold text-green-800 mb-3 flex-shrink-0">Available Time Slots</div>
                <ScrollArea className="flex-1 overflow-auto pr-2 min-h-0">
                  <div className="space-y-4">
                    {(() => {
                      const filteredStaffList = selectedStaffFilter !== 'all'
                        ? [selectedStaffFilter]
                        : staffSearchQuery === '' 
                          ? staffOptions 
                          : staffOptions.filter(staff => 
                              staff.toLowerCase().includes(staffSearchQuery.toLowerCase())
                            );
                      return filteredStaffList.map(stName => {
                        const appts = raw.filter(r => 
                          r.appointment_date === modalDate && 
                          r.staff_name === stName &&
                          normalizeBookingStatus((r as any).status) !== 'cancelled'
                        );
                        
                        // Build 30-min blocks from 04:00-21:00 with past time checking
                        const blocks: Array<{ label: string; value: string; booked: boolean; past: boolean; displayLabel: string }> = [];
                        const pad = (n: number) => String(n).padStart(2, '0');
                        
                        // Get current IST time for past checking
                        const isToday = modalDate === todayStr;
                        const now = nowIST();
                        const currentHour = Number(format(now, 'HH'));
                        const currentMinute = Number(format(now, 'mm'));
                        const currentTimeInMinutes = currentHour * 60 + currentMinute;
                        
                        // Convert 24-hour to 12-hour format
                        const formatTo12Hour = (hour: number, minute: number) => {
                          const period = hour >= 12 ? 'PM' : 'AM';
                          const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                          return `${displayHour}:${pad(minute)} ${period}`;
                        };
                        
                        for (let h = 0; h <= 23; h++) {
                          for (let m of [0, 30]) {
                            const startLabel = `${pad(h)}:${pad(m)}`;
                            const startValue = `${startLabel}:00`;
                            const slotTimeInMinutes = h * 60 + m;
                            
                            // Check if this time slot is in the past
                            const past = isToday && slotTimeInMinutes < currentTimeInMinutes;
                            
                            // Check if booked
                            const booked = appts.some(a => {
                              const from = (a.slot_from || '').slice(0, 5);
                              const to = (a.slot_to || '').slice(0, 5);
                              // Calculate end time for this 30-min block
                              let endH = h;
                              let endM = m + 30;
                              if (endM >= 60) { endM -= 60; endH += 1; }
                              const endLabel = `${pad(endH)}:${pad(endM)}`;
                              
                              // Check overlap
                              return !(to <= startLabel || from >= endLabel);
                            });
                            
                            // Create display label in 12-hour format
                            let endH = h;
                            let endM = m + 30;
                            if (endM >= 60) { endM -= 60; endH += 1; }
                            const displayLabel = `${formatTo12Hour(h, m)}-${formatTo12Hour(endH, endM)}`;
                            
                            blocks.push({ label: startLabel, value: startValue, booked, past, displayLabel });
                          }
                        }
                        
                        return (
                          <div key={stName} className="space-y-2">
                            <div className="text-xs font-semibold text-gray-700 border-b border-gray-200 pb-1">
                              {stName} {stName === modalStaff ? '(Selected)' : ''}
                            </div>
                            <div className="grid grid-cols-6 gap-1">
                              {blocks.map(({ label, value, booked, past, displayLabel }, idx) => {
                                // Only highlight the exact selected slot
                                const isSelected = modalStaff === stName && 
                                  modalFrom && modalFrom.slice(0, 5) === label;
                                
                                // Calculate end time for setting modal state
                                let endH = Number(label.slice(0, 2));
                                let endM = Number(label.slice(3, 5)) + 30;
                                if (endM >= 60) { endM -= 60; endH += 1; }
                                
                                const isDisabled = booked || past;
                                
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      if (isDisabled) return;
                                      
                                      // Always select exactly this 30-minute slot
                                      setModalStaff(stName);
                                      setModalFrom(value);
                                      setModalTo(`${pad(endH)}:${pad(endM)}:00`);
                                    }}
                                    disabled={isDisabled}
                                    className={`h-8 text-[9px] font-medium rounded border transition-colors ${
                                      past
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed border-gray-400'
                                        : booked
                                        ? 'bg-red-500 text-white cursor-not-allowed border-red-600'
                                        : isSelected
                                        ? 'bg-blue-600 text-white border-blue-700'
                                        : 'bg-green-500 hover:bg-green-600 text-white border-green-600'
                                    }`}
                                  >
                                    {displayLabel}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>

          <DialogFooter className="flex justify-end gap-2 pt-4 flex-shrink-0 border-t border-gray-200 mt-4">
            <Button variant="outline" onClick={() => setOpenModal(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setModalFrom('');
                setModalTo('');
                setModalStaff('');
              }}
              disabled={!modalFrom && !modalTo}
            >
              Clear Selection
            </Button>
            <Button
              disabled={!modalStaff || !modalFrom || !modalTo}
              onClick={() => {
                setOpenModal(false);
                toast({
                  title: 'Booking started',
                  description: `${format(new Date(modalDate), 'dd-MM-yyyy')} • ${modalStaff} • ${range12(modalFrom, modalTo)}`
                });
                navigate(`/appointments/create?date=${modalDate}&staff=${encodeURIComponent(modalStaff)}&from=${encodeURIComponent(modalFrom)}&to=${encodeURIComponent(modalTo)}`);
              }}
            >
              Continue to Create Appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters & Actions */}
      <Card className="border border-gray-200/70 shadow-sm bg-white">
        <CardHeader className="pb-2 px-3 sm:px-5 pt-2 sm:pt-3">
          {/* Inline Calendar above filters */}
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const today = parseYMDToIST(todayYMDIST());
                    setCalendarMonth(today);
                  }}
                  className="h-7 sm:h-8 px-2 sm:px-3 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-xs"
                  title="Go to current month"
                >
                  Today
                </Button>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100"
                  onClick={()=> setCalendarMonth(addMonths(calendarMonth,-1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
                <div className="text-xs sm:text-sm font-medium w-28 sm:w-36 text-center text-gray-700">
                  {format(calendarMonth,'MMMM yyyy')}
                </div>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100"
                  onClick={()=> setCalendarMonth(addMonths(calendarMonth,1))}
                >
                  <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-slate-200/80 p-1 sm:p-2 bg-white">
              {/* Days of week header */}
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=> (
                  <div key={d} className="p-0.5 sm:p-1 text-center text-xs font-medium text-gray-500">
                    {d}
                  </div>
                ))}
              </div>
              {/* Calendar days */}
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mt-1 sm:mt-2">
                {calendarDays.map(d=>{
                  const inMonth = d.date.getMonth() === calendarMonth.getMonth();
                  const todayYMD = todayStr;
                  const isPast = d.key < todayYMD;
                  let inRange = true;
                  if (calFrom) inRange = inRange && d.key >= calFrom;
                  if (calTo) inRange = inRange && d.key <= calTo;
                  const isToday = d.key === todayStr;
                  const now = nowIST();
                  const nowHH = Number(format(now,'HH'));
                  const nowMM = Number(format(now,'mm'));
                  const currentBlockStart = `${pad2(nowHH)}:${nowMM < 30 ? '00' : '30'}`;
                  const staffNames = (staffFilter === 'all' ? (staffMaster && staffMaster.length ? staffMaster : []) : [staffFilter]).filter(Boolean);
                  const hasAnyAvailability = (()=>{
                    if (!inMonth || isPast) return false;
                    const pad = (n:number)=> String(n).padStart(2,'0');
                    const addBlock = (hh:number, mm:number) => {
                      mm += BLOCK_MINUTES; if (mm >= 60) { mm -= 60; hh += 1; }
                      return `${pad(hh)}:${pad(mm)}`;
                    };
                    if (staffNames.length === 0) return false;
                    for (const st of staffNames) {
                      const appts = raw.filter(r=> r.appointment_date === d.key && r.staff_name === st && (normalizeBookingStatus((r as any).status) !== 'cancelled'));
                      for (let h=0; h<=23; h++) {
                        for (const m of [0,30]) {
                          const v = `${pad(h)}:${pad(m)}`;
                          if (isToday && v < currentBlockStart) continue;
                          const endHM = addBlock(h, m);
                          const booked = appts.some(a=>{
                            const from = (a.slot_from||'').slice(0,5);
                            const to = (a.slot_to||'').slice(0,5);
                            return !(to <= v || from >= endHM);
                          });
                          if (!booked) return true;
                        }
                      }
                    }
                    return false;
                  })();
                  const clickable = inMonth && !isPast && inRange && hasAnyAvailability;
                  const selected = selectedDate === d.key;
                  const dayAppts = raw.filter(r=> r.appointment_date === d.key && (staffFilter==='all' || r.staff_name === staffFilter) && (normalizeBookingStatus((r as any).status) !== 'cancelled'));
                  const bookedCount = dayAppts.length;
                  const hasBookings = bookedCount > 0;

                  return (
                    <div
                      key={d.key}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : -1}
                      onKeyDown={(e)=>{ if (!clickable) return; if (e.key==='Enter' || e.key===' ') { e.preventDefault(); setSelectedDate(d.key); setModalDate(d.key); setModalStaff(''); setModalFrom(''); setModalTo(''); setSelectedStaffFilter('all'); setStaffSearchQuery(''); setOpenModal(true);} }}
                      onClick={()=>{
                        if (clickable) {
                          setSelectedDate(d.key);
                          setModalDate(d.key);
                          setModalStaff('');
                          setModalFrom('');
                          setModalTo('');
                          setSelectedStaffFilter('all');
                          setStaffSearchQuery('');
                          setOpenModal(true);
                        }
                      }}
                      className={`
                        relative p-0.5 sm:p-1 h-12 sm:h-14 lg:h-16 border rounded-md transition-all
                        ${!inMonth 
                          ? "bg-slate-50 border-slate-100 text-transparent cursor-default hover:shadow-none opacity-50" 
                          : isPast
                            ? "bg-gray-50 text-gray-400 cursor-not-allowed opacity-50"
                            : clickable
                              ? "bg-green-50 border-green-200 hover:bg-green-100 cursor-pointer hover:shadow-sm"
                              : hasBookings
                                ? "bg-red-50 border-red-200 text-red-700 cursor-not-allowed"
                                : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                        }
                        ${selected ? "ring-1 sm:ring-2 ring-purple-500 border-purple-500" : ""}
                      `}
                      title={inMonth ? (hasBookings 
                        ? dayAppts.map(r=>{
                            const tm = range12(r.slot_from as any, r.slot_to as any);
                            const sv = serviceNames((r as any).services);
                            return `${r.staff_name||'-'} | ${tm}${sv? ' | '+sv: ''}`;
                          }).join('\n')
                        : (clickable ? 'Available - click to create' : 'No slots available')) : ''}
                    >
                      <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between">
                          <span className={`
                            text-xs font-medium
                            ${!inMonth ? "invisible" : "text-gray-900"}
                          `}>
                            {format(d.date,'d')}
                          </span>
                          {inMonth && !isPast && (
                            <div className={`
                              w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full
                              ${clickable ? "bg-green-500" : (hasBookings ? "bg-red-500" : "bg-gray-400")}
                            `} />
                          )}
                        </div>
                        {inMonth && (
                          <div className="flex-1 flex flex-col justify-end">
                            <div className="text-[9px] sm:text-[10px] font-semibold">
                              {hasBookings
                                ? <span className={isPast ? "text-gray-600" : "text-red-700"}>Booked {bookedCount}</span>
                                : !isPast && clickable
                                  ? <span className="text-emerald-700 hidden sm:inline">Available</span>
                                  : !isPast
                                    ? <span className="text-gray-600 hidden sm:inline">No slots</span>
                                    : null}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="flex items-center justify-center sm:justify-between pt-2 sm:pt-3 border-top border-gray-100">
                <div className="flex items-center space-x-3 sm:space-x-4">
                  <div className="flex items-center space-x-1.5 sm:space-x-2">
                    <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-green-500 rounded-full"></div>
                    <span className="text-xs text-gray-600">Available</span>
                  </div>
                  <div className="flex items-center space-x-1.5 sm:space-x-2">
                    <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-500 rounded-full"></div>
                    <span className="text-xs text-gray-600">Booked</span>
                  </div>
                  <div className="flex items-center space-x-1.5 sm:space-x-2">
                    <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-gray-400 rounded-full"></div>
                    <span className="text-xs text-gray-600">Disabled</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4 px-3 sm:px-5">
          {/* KPI Cards below filters: grid for perfect alignment on desktop */}
          <div className="mb-3 sm:mb-4 grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
            {[
              { key: 'advanced', label: 'ADVANCED', qty: kpis.advanced.qty, amount: kpis.advanced.amount, icon: <Wallet className="h-4 w-4" />, tone: 'from-purple-500/10 to-purple-500/5', iconTint: 'bg-purple-100 text-purple-600 ring-purple-200/60' },
              { key: 'paid', label: 'PAID', qty: kpis.paid.qty, amount: kpis.paid.amount, icon: <CheckCircle2 className="h-4 w-4" />, tone: 'from-emerald-500/10 to-emerald-500/5', iconTint: 'bg-emerald-100 text-emerald-600 ring-emerald-200/60' },
              { key: 'settlement', label: 'SETTLEMENT', qty: kpis.settlement.qty, amount: kpis.settlement.amount, icon: <IndianRupee className="h-4 w-4" />, tone: 'from-teal-500/10 to-teal-500/5', iconTint: 'bg-teal-100 text-teal-600 ring-teal-200/60' },
              { key: 'pending', label: 'PENDING', qty: kpis.pending.qty, amount: kpis.pending.amount, icon: <Clock className="h-4 w-4" />, tone: 'from-yellow-500/10 to-yellow-500/5', iconTint: 'bg-yellow-100 text-yellow-600 ring-yellow-200/60' },
              { key: 'total', label: 'TOTAL', qty: kpis.total.qty, amount: kpis.total.amount, icon: <CalendarDays className="h-4 w-4" />, tone: 'from-amber-500/10 to-amber-500/5', iconTint: 'bg-amber-100 text-amber-600 ring-amber-200/60' }
            ].map(card => (
              <div
                key={card.label}
                className={`relative overflow-hidden rounded-lg bg-white px-2 sm:px-3 py-2 sm:py-3 shadow-sm transition-all min-h-[112px]`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${card.tone} opacity-80 pointer-events-none`}></div>
                <div className="relative flex items-center justify-between gap-2 sm:gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1 sm:mb-2">
                      <p className="text-[9px] sm:text-[10px] font-semibold tracking-wide text-gray-600 uppercase leading-none truncate">{card.label}</p>
                      <div className={`h-5 w-5 sm:h-6 sm:w-6 rounded-md ${card.iconTint} flex items-center justify-center flex-shrink-0`}>{card.icon}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-1 sm:gap-2">
                      <div>
                        <div className="text-[8px] sm:text-[9px] text-gray-500 mb-0.5 sm:mb-1">Qty</div>
                        <div className="text-sm sm:text-base lg:text-lg leading-none font-semibold text-gray-900 tabular-nums">{card.qty}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[8px] sm:text-[9px] text-gray-500 mb-0.5 sm:mb-1">Amount</div>
                        <div className="text-xs sm:text-sm lg:text-base leading-none font-semibold text-gray-900 tabular-nums">₹{Number((card.qty === 0 ? 0 : card.amount)||0).toLocaleString('en-IN')}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full mb-3 sm:mb-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 sm:px-4 py-2 shadow-sm">
              <Input 
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                value={fromInput}
                onChange={e=> setFromInput(e.target.value)}
                onBlur={() => {
                  const ymd = parseDMYToYMD(fromInput);
                  if (!ymd) {
                    setFromInput(formatYMDToDMY(fromDate));
                    return;
                  }
                  setFromDate(ymd);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                }}
                className="h-8 min-w-[110px] rounded-lg border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-sm" 
              />
              <span className="text-slate-400 text-xs px-1 self-center hidden sm:inline">→</span>
              <Input 
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                value={toInput}
                onChange={e=> setToInput(e.target.value)}
                onBlur={() => {
                  const ymd = parseDMYToYMD(toInput);
                  if (!ymd) {
                    setToInput(formatYMDToDMY(toDate));
                    return;
                  }
                  setToDate(ymd);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                }}
                className="h-8 min-w-[110px] rounded-lg border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-sm" 
              />
              <Select
                value={datePreset}
                onValueChange={(v)=>{
                  const preset = v as DatePreset;
                  setDatePreset(preset);
                  applyDatePreset(preset);
                }}
              >
                <SelectTrigger
                  className="h-8 w-full sm:w-36 rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-xs px-3 whitespace-nowrap"
                  title="Quick date range"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="today"
                    onClick={() => {
                      setDatePreset('today');
                      applyDatePreset('today');
                    }}
                  >
                    Today
                  </SelectItem>
                  <SelectItem
                    value="thisWeek"
                    onClick={() => {
                      setDatePreset('thisWeek');
                      applyDatePreset('thisWeek');
                    }}
                  >
                    This Week
                  </SelectItem>
                  <SelectItem
                    value="thisMonth"
                    onClick={() => {
                      setDatePreset('thisMonth');
                      applyDatePreset('thisMonth');
                    }}
                  >
                    This Month
                  </SelectItem>
                  <SelectItem
                    value="threeMonths"
                    onClick={() => {
                      setDatePreset('threeMonths');
                      applyDatePreset('threeMonths');
                    }}
                  >
                    3 Months
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                <Input 
                  value={search} 
                  onChange={e=> setSearch(e.target.value)} 
                  className="pl-9 h-9 border-slate-200 rounded-lg bg-white text-sm" 
                />
              </div>
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
                  <SelectTrigger className="h-9 w-full sm:w-32 lg:w-40 rounded-lg border-slate-200 bg-white text-sm font-medium px-3">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="advance">Advanced</SelectItem>
                    <SelectItem value="settled">Paid</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={staffFilter}
                  onValueChange={v=> setStaffFilter(v)}
                  onOpenChange={(open) => {
                    if (!open) setStaffFilterQuery('');
                  }}
                >
                  <SelectTrigger className="h-9 w-full sm:w-32 lg:w-40 rounded-lg border-slate-200 bg-white text-sm font-medium px-3">
                    <SelectValue placeholder="Staff"/>
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        value={staffFilterQuery}
                        onChange={(e) => setStaffFilterQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Search staff"
                        className="h-8"
                      />
                    </div>
                    <SelectItem value="all">All Staff</SelectItem>
                    {staffOptions
                      .filter((s) => {
                        const q = staffFilterQuery.trim().toLowerCase();
                        if (!q) return true;
                        return String(s).toLowerCase().includes(q);
                      })
                      .map(s=> <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-9 rounded-lg border-slate-200 bg-yellow-500/90 text-black hover:bg-yellow-500 px-3 sm:px-4 whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 sm:mr-2"/>
                    <span className="hidden sm:inline">Reports</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Export Excel</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={exportAppointmentListExcel}>Appointment List (filtered)</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportDailySummaryExcel}>Daily Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportStaffSummaryExcel}>Staff-wise Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPaymentStatusSummaryExcel}>Payment Status Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCustomerContactsExcel}>Customer Contact List</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {/* Mobile/Tablet compact list (show up to lg; desktop shows table) */}
          <div className="lg:hidden space-y-2">
            {loading && (
              <div className="text-center text-xs py-6">Loading...</div>
            )}
            {!loading && pageData.length === 0 && (
              <div className="text-center text-xs py-6">No appointments</div>
            )}
            {!loading && pageData.map((r)=>{
              const id = String(r.id || r.appointment_id || '');
              const tm = range12(r.slot_from as any, r.slot_to as any);
              const amount = r.amount || 0;
              const bal = r.balance_due != null ? Number(r.balance_due) : Math.max(amount - (Number(r.advance_paid)||0), 0);
              const paid = Number(r.advance_paid) || 0;
              const expanded = !!mobileExpanded[id];
              return (
                <div key={id} className="rounded-lg border border-gray-200 bg-white shadow-sm p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-gray-900">{r.appointment_date ? formatYMDToDMY(r.appointment_date) : ''}</div>
                      <div className="text-[11px] text-gray-600">{tm}</div>
                      <div className="text-sm font-semibold text-gray-900 truncate">{r.customer_name || 'Walk-in'} <span className="text-gray-500 font-normal">• {r.staff_name || '-'}</span></div>
                      <div className="text-[11px] text-gray-600">{r.customer_phone || '-'}</div>
                      <div className="text-[11px] text-gray-600 mt-0.5">ID: {r.appointment_id || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Amount</div>
                      <div className="text-sm font-semibold">{fmtINR(amount)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-end">
                    <div className="text-right text-[11px]">
                      <span className="text-emerald-700 font-semibold mr-3">Paid: {fmtINR(paid)}</span>
                      <span className={`${bal>0? 'text-amber-700' : 'text-emerald-700'} font-semibold`}>Bal: {fmtINR(bal)}</span>
                    </div>
                  </div>
                  {/* More section */}
                  <div className="mt-2">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={()=> setMobileExpanded(prev=> ({...prev, [id]: !expanded}))}>
                      {expanded ? 'Less' : 'More'}
                    </Button>
                  </div>
                  {expanded && (
                    <div className="mt-2 border-t pt-2 text-[12px] text-gray-700">
                      <div className="flex items-center">
                        <div>Phone: <span className="font-medium">{r.customer_phone || '-'}</span></div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {r.payment_status === 'settled' ? (
                          <Button size="sm" variant="outline" className="h-7 px-3 border-slate-300 text-slate-700 hover:bg-slate-50" onClick={(e)=>{ e.stopPropagation(); setDetailsRow(r); setDetailsOpen(true); }}>
                            <Eye className="h-4 w-4 mr-1"/> View
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" className="h-7 px-3 border-blue-300 text-blue-700 hover:bg-blue-50"
                              onClick={(e)=>{ e.stopPropagation(); const qs = new URLSearchParams(); qs.set('edit','1'); if (r.id != null) qs.set('id', String(r.id)); if (r.appointment_id) qs.set('appointment_id', String(r.appointment_id)); navigate(`/appointments/create?${qs.toString()}`); }}>
                              <Pencil className="h-4 w-4 mr-1"/> Edit
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-3 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              onClick={(e)=>{ e.stopPropagation(); const qs = new URLSearchParams(); qs.set('from_appt','1'); if (r.appointment_id) qs.set('appointment_id', String(r.appointment_id)); if (r.customer_name) qs.set('customer_name', String(r.customer_name)); if (r.customer_phone) qs.set('customer_phone', String(r.customer_phone)); if (r.staff_name) qs.set('staff_name', String(r.staff_name)); navigate(`/billing/add?${qs.toString()}`); }}>
                              <Printer className="h-4 w-4 mr-1"/> Produce Bill
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="outline" className="h-7 px-3" onClick={(e)=>{ e.stopPropagation(); printAppointment(r); }}>
                          <Printer className="h-4 w-4 mr-1"/> Print
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-3" onClick={(e)=>{ e.stopPropagation(); shareAppointment(r); }}>
                          <Share2 className="h-4 w-4 mr-1"/> Share
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden lg:block overflow-x-auto rounded-lg border border-gray-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead className="min-w-28 sm:w-36 font-semibold text-gray-700 whitespace-nowrap text-sm sm:text-base">Date</TableHead>
                  {/* Time moved under Date */}
                  <TableHead className="min-w-24 sm:w-32 font-semibold text-gray-700 text-sm sm:text-base">Staff</TableHead>
                  <TableHead className="min-w-40 sm:w-56 font-semibold text-gray-700 text-sm sm:text-base">Customer</TableHead>
                  {/* Phone moved under Customer */}
                  <TableHead className="min-w-20 sm:w-28 font-semibold text-gray-700 whitespace-nowrap text-sm sm:text-base">Appt ID</TableHead>
                  <TableHead className="min-w-20 sm:w-24 font-semibold text-gray-700 text-sm sm:text-base">Status</TableHead>
                  <TableHead className="min-w-20 sm:w-24 font-semibold text-gray-700 text-right text-sm sm:text-base">Amount</TableHead>
                  <TableHead className="min-w-16 sm:w-24 font-semibold text-gray-700 text-right text-sm sm:text-base">Paid</TableHead>
                  <TableHead className="min-w-18 sm:w-24 font-semibold text-gray-700 text-right text-sm sm:text-base">Balance</TableHead>
                  <TableHead className="min-w-24 sm:w-28 font-semibold text-gray-700 text-sm sm:text-base">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={9} className="text-center text-xs py-6">Loading...</TableCell></TableRow>}
                {!loading && pageData.length===0 && <TableRow><TableCell colSpan={9} className="text-center text-xs py-6">No appointments</TableCell></TableRow>}
                {!loading && pageData.map(r=>{
                  const tm = range12(r.slot_from as any, r.slot_to as any);
                  const isEditing = (editRowId != null) && (editRowId === (r.id||r.appointment_id));
                  const amount = r.amount || 0;
                  const bal = r.balance_due != null ? Number(r.balance_due) : Math.max(amount - (Number(r.advance_paid)||0), 0);
                  const paid = Number(r.advance_paid) || 0; // Use advance_paid directly as the paid amount
                  // Remove left color indicator line
                  const rowAccent = '';
                  return (
                    <TableRow
                      key={r.id || r.appointment_id}
                      className={`text-xs sm:text-sm cursor-pointer hover:bg-slate-50/60 odd:bg-white even:bg-slate-50/40 ${rowAccent}`}
                      onClick={() => { setDetailsRow(r); setDetailsOpen(true); }}
                    >
                      <TableCell className="align-middle py-2 sm:py-2.5">
                        <div className="flex flex-col leading-tight">
                          <span className="font-semibold text-gray-900 whitespace-nowrap text-sm sm:text-base">{r.appointment_date ? formatYMDToDMY(r.appointment_date) : ''}</span>
                          <span className="text-[12px] sm:text-sm text-gray-600 whitespace-nowrap">{tm}</span>
                        </div>
                      </TableCell>
                      <TableCell className="align-middle py-2 sm:py-2.5 max-w-[120px] sm:max-w-[160px] truncate text-gray-800">{r.staff_name||'-'}</TableCell>
                      <TableCell className="align-middle py-2 sm:py-2.5 max-w-[200px] sm:max-w-[260px] text-gray-800">
                        <div className="flex flex-col">
                          <span className="truncate font-medium text-sm sm:text-base">{r.customer_name||'-'}</span>
                          <span className="text-[12px] sm:text-sm text-gray-600 whitespace-nowrap">{r.customer_phone||'-'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap align-middle py-2 sm:py-2.5 text-slate-600 font-medium">{r.appointment_id||'-'}</TableCell>
                      <TableCell className="align-middle py-2.5">
                        {(() => {
                          const s = normalizeBookingStatus((r as any).status);
                          const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : '-';
                          const cls = s === 'cancelled'
                            ? 'bg-red-50 text-red-700 ring-1 ring-red-300'
                            : (s === 'confirmed' || s === 'completed')
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300'
                              : s === 'pending'
                                ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-300'
                                : 'bg-slate-50 text-slate-700 ring-1 ring-slate-300';
                          return (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums align-middle py-2.5 font-semibold text-sm sm:text-base">{r.amount!=null? fmtINR(r.amount): '-'}</TableCell>
                      <TableCell className="text-right tabular-nums align-middle py-2.5 font-semibold text-emerald-700 text-sm sm:text-base">
                        {isEditing ? (
                          <Input type="number" step="0.01" value={editAdvance} disabled={editPaymentStatus==='settled'} onChange={e=> setEditAdvance(e.target.value)} className="h-8 text-xs disabled:opacity-60" />
                        ) : (()=>{
                          return fmtINR(paid);
                        })()}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums align-middle py-2.5 font-semibold text-sm sm:text-base ${bal>0 ? 'text-amber-700' : 'text-emerald-700'}`}>{r.balance_due!=null? fmtINR(Number(r.balance_due)): '-'}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="default" disabled={savingId === (r.id||r.appointment_id)} onClick={()=> handleSave(r)} className="h-7 px-2 text-[10px]">{savingId=== (r.id||r.appointment_id)? 'Saving...' : 'Save'}</Button>
                            <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 px-2 text-[10px]">Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-stretch gap-1">
                            {r.payment_status === 'settled' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-28 justify-center border-slate-300 text-slate-700 hover:bg-slate-50"
                                title="View Appointment"
                                onClick={(e)=>{
                                  e.stopPropagation();
                                  setDetailsRow(r);
                                  setDetailsOpen(true);
                                }}
                              >
                                <Eye className="h-4 w-4 mr-1"/>
                                View
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-28 justify-center border-blue-300 text-blue-700 hover:bg-blue-50"
                                  title="Edit Appointment"
                                  onClick={(e)=>{
                                    e.stopPropagation();
                                    const qs = new URLSearchParams();
                                    qs.set('edit','1');
                                    if (r.id != null) qs.set('id', String(r.id));
                                    if (r.appointment_id) qs.set('appointment_id', String(r.appointment_id));
                                    navigate(`/appointments/create?${qs.toString()}`);
                                  }}
                                >
                                  <Pencil className="h-4 w-4 mr-1"/>
                                  Edit
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-7 w-28 justify-center border-emerald-300 text-emerald-700 hover:bg-emerald-50" 
                                  title="Generate Bill"
                                  onClick={(e)=> { 
                                    e.stopPropagation(); 
                                    // Navigate to Add Invoice with appointment context so it can prefill and save to billing_transaction
                                    const qs = new URLSearchParams();
                                    qs.set('from_appt','1');
                                    if (r.appointment_id) qs.set('appointment_id', String(r.appointment_id));
                                    if (r.customer_name) qs.set('customer_name', String(r.customer_name));
                                    if (r.customer_phone) qs.set('customer_phone', String(r.customer_phone));
                                    if (r.staff_name) qs.set('staff_name', String(r.staff_name));
                                    navigate(`/billing/add?${qs.toString()}`);
                                  }}
                                >
                                  <Printer className="h-4 w-4 mr-1"/>
                                  Produce Bill
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-28 justify-center border-red-300 text-red-700 hover:bg-red-50"
                                  title="Cancel Appointment"
                                  onClick={(e)=>{
                                    e.stopPropagation();
                                    setSelectedAppointmentId(String(r.appointment_id));
                                    setCancelRemark('');
                                    setCancelConfirmOpen(true);
                                  }}
                                >
                                  <XCircle className="h-4 w-4 mr-1"/>
                                  Cancel
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs mt-2">
            <div className="text-center sm:text-left">Showing {(page-1)*pageSize + 1}-{Math.min(page*pageSize, filtered.length)} of {filtered.length}</div>
            <div className="flex items-center justify-center gap-3">
              <label className="flex items-center gap-1">
                <span className="hidden sm:inline">Rows:</span>
                <select
                  className="border rounded px-2 py-1 text-xs sm:text-sm"
                  value={pageSize}
                  onChange={(e)=> { const n = Number(e.target.value)||10; setPageSize(n); setPage(1); }}
                >
                  {PAGE_SIZE_OPTIONS.map(n => (<option key={n} value={n}>{n}</option>))}
                </select>
              </label>
              <Button size="sm" variant="outline" disabled={page===1} onClick={()=> setPage(p=> Math.max(1,p-1))} className="w-20 justify-center">Prev</Button>
              <div className="font-medium text-xs sm:text-sm">Page {page} / {totalPages}</div>
              <Button size="sm" variant="outline" disabled={page===totalPages} onClick={()=> setPage(p=> Math.min(totalPages,p+1))} className="w-20 justify-center">Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
  {error && <div className="text-red-600 text-xs px-2 sm:px-0">{error}</div>}
  <div className="text-[10px] text-slate-400 px-2 sm:px-0">All dates & times in {IST_LABEL}</div>
      {/* Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl lg:max-w-6xl max-h-[90vh]">
          <DialogHeader className="pb-2 sm:pb-3 border-b">
            <DialogTitle className="text-base sm:text-lg font-semibold text-gray-900">
              Booking Details — {detailsRow?.appointment_id || 'N/A'}
            </DialogTitle>
          </DialogHeader>
          {detailsRow && (
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-6">
                
                {/* Customer Section */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                    <h3 className="text-sm font-semibold text-gray-900">Customer</h3>
                  </div>
                  <div className="bg-gray-50 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Customer</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-white">
                          <td className="px-4 py-3 text-sm text-gray-900">{detailsRow.customer_name || 'Walk-in Customer'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{detailsRow.customer_phone || '-'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Slots & Event Details Section */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                    <h3 className="text-sm font-semibold text-gray-900">Slots & Event Details</h3>
                  </div>
                  <div className="bg-gray-50 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Date</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Staff</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Slot</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-white">
                          <td className="px-4 py-3 text-sm text-gray-900">{detailsRow.appointment_date ? formatYMDToDMY(detailsRow.appointment_date) : '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{detailsRow.staff_name || 'Salon Staff'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{range12(detailsRow.slot_from as any, detailsRow.slot_to as any)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              detailsRow.payment_status === 'settled' ? 'bg-green-100 text-green-800' :
                              detailsRow.payment_status === 'advance' ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {detailsRow.payment_status === 'settled' ? 'Paid' : 
                               detailsRow.payment_status === 'advance' ? 'Advanced' : 'Pending'}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Services and Payment Details in Two Columns */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Services Section */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                      <h3 className="text-sm font-semibold text-gray-900">Services</h3>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 min-h-[120px] flex items-center">
                      {(detailsRow as any).services ? (
                        <div className="text-sm text-gray-700 w-full">
                          {(() => {
                            const services = (detailsRow as any).services;
                            try {
                              let parsed = services;
                              if (typeof services === 'string') {
                                try {
                                  parsed = JSON.parse(services);
                                } catch {
                                  return <div className="text-gray-600">{services}</div>;
                                }
                              }
                              
                              if (Array.isArray(parsed)) {
                                return (
                                  <div className="space-y-2">
                                    {parsed.map((service: any, index: number) => (
                                      <div key={index} className="flex justify-between items-center py-2 px-3 bg-white rounded border">
                                        <div>
                                          <div className="font-medium text-gray-900">
                                            {service.name || service.service_name || service.title || `Service ${index + 1}`}
                                          </div>
                                          {service.duration && (
                                            <div className="text-xs text-gray-500">{service.duration} mins</div>
                                          )}
                                        </div>
                                        {service.price && (
                                          <div className="font-semibold text-gray-900">{fmtINR(Number(service.price))}</div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              
                              if (typeof parsed === 'object' && parsed !== null) {
                                return (
                                  <div className="flex justify-between items-center py-2 px-3 bg-white rounded border">
                                    <div>
                                      <div className="font-medium text-gray-900">
                                        {parsed.name || parsed.service_name || parsed.title || 'Service'}
                                      </div>
                                      {parsed.duration && (
                                        <div className="text-xs text-gray-500">{parsed.duration} mins</div>
                                      )}
                                    </div>
                                    {parsed.price && (
                                      <div className="font-semibold text-gray-900">{fmtINR(Number(parsed.price))}</div>
                                    )}
                                  </div>
                                );
                              }
                              
                              return <div className="text-gray-600">{String(parsed)}</div>;
                            } catch (error) {
                              return <div className="text-red-600">Error displaying services</div>;
                            }
                          })()}
                        </div>
                      ) : (
                        <div className="text-gray-500 text-sm">No services</div>
                      )}
                    </div>
                  </div>

                  {/* Payment Details Section */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                      <h3 className="text-sm font-semibold text-gray-900">Payment Details</h3>
                    </div>
                    <div className="bg-gray-50 rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Pay Mode</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Reference</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Created Date</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 uppercase">Collected (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-white">
                            <td className="px-4 py-3 text-sm text-gray-900">{String((detailsRow as any).payment_mode || 'Cash')}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{(detailsRow as any).transaction_id || (detailsRow as any).reference || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{detailsRow.appointment_date ? formatYMDToDMY(detailsRow.appointment_date) : '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-semibold">
                              {(() => {
                                const paid = Number(detailsRow.advance_paid) || 0; // Use advance_paid directly as the paid amount
                                return `₹${paid.toLocaleString('en-IN')}`;
                              })()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Summary Footer */}
                <div className="border-t pt-4 mt-6">
                  <div className="flex justify-between items-center text-lg font-semibold">
                    <div className="flex gap-8">
                      <div>
                        <span className="text-gray-600">Total: </span>
                        <span className="text-blue-600">{fmtINR(Number(detailsRow.amount || detailsRow.total_amount || 0))}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Paid: </span>
                        <span className="text-green-600">{(() => {
                          const paid = Number(detailsRow.advance_paid) || 0; // Use advance_paid directly as the paid amount
                          return fmtINR(paid);
                        })()}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Pending: </span>
                        <span className="text-red-600">{(() => {
                          const amount = Number(detailsRow.amount || detailsRow.total_amount || 0);
                          const bal = detailsRow.balance_due != null ? Number(detailsRow.balance_due) : Math.max(amount - (Number(detailsRow.advance_paid)||0), 0);
                          return fmtINR(bal);
                        })()}</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Appointment Transaction Dialog */}
      <Dialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl lg:max-w-4xl max-h-[90vh]">
          <DialogHeader className="pb-2 sm:pb-3 border-b">
            <DialogTitle className="text-base sm:text-lg font-semibold text-gray-900">
              Appointment Transaction Details
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="flex-1 p-4">
            {selectedAppointmentId && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-md font-medium">Appointment ID: {selectedAppointmentId}</h3>
                  <Button 
                    onClick={() => {
                      const appointment = raw.find(r => r.appointment_id === selectedAppointmentId);
                      if (appointment) {
                        createAppointmentTransaction(appointment);
                      }
                    }}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Wallet className="w-4 h-4" />
                    Create Transactions
                  </Button>
                </div>

                {loadingTransactions.has(selectedAppointmentId) ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : appointmentTransactions[selectedAppointmentId] ? (
                  <div className="space-y-6">
                    {/* Master Appointment Details */}
                    {(() => {
                      const apptData = appointmentTransactions[selectedAppointmentId];
                      return (
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h4 className="font-medium text-gray-900 mb-3">Appointment Details</h4>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="font-medium">Customer:</span> {apptData.customer_name || '-'}
                            </div>
                            <div>
                              <span className="font-medium">Phone:</span> {apptData.customer_mobile || '-'}
                            </div>
                            <div>
                              <span className="font-medium">Staff:</span> {apptData.employee_name || '-'}
                            </div>
                            <div>
                              <span className="font-medium">Date:</span> {apptData.appointment_date ? formatYMDToDMY(apptData.appointment_date) : '-'}
                            </div>
                            <div>
                              <span className="font-medium">Time:</span> {apptData.slot_from || '-'} - {apptData.slot_to || '-'}
                            </div>
                            <div>
                              <span className="font-medium">Status:</span> 
                              <span className={`ml-1 px-2 py-1 rounded text-xs ${
                                apptData.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                                apptData.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                apptData.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                apptData.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {apptData.status || 'pending'}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Advance Paid:</span> ₹{Number(apptData.advance_paid || 0).toFixed(2)}
                            </div>
                            <div>
                              <span className="font-medium">Balance Due:</span> ₹{Number(apptData.balance_due || 0).toFixed(2)}
                            </div>
                            <div>
                              <span className="font-medium">Payment Mode:</span> {apptData.payment_mode || '-'}
                            </div>
                            <div>
                              <span className="font-medium">Special Requirements:</span> {apptData.special_requirements || '-'}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Service Summary */}
                    {appointmentTransactions[selectedAppointmentId].services && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Services ({appointmentTransactions[selectedAppointmentId].service_count || 0})</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-gray-50">
                                <TableHead>Service</TableHead>
                                <TableHead>Unit Price</TableHead>
                                <TableHead>Qty</TableHead>
                                <TableHead>Subtotal</TableHead>
                                <TableHead>Tax</TableHead>
                                <TableHead>Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {appointmentTransactions[selectedAppointmentId].services.map((service: any, index: number) => (
                                <TableRow key={index}>
                                  <TableCell>{service.service_name || '-'}</TableCell>
                                  <TableCell>₹{Number(service.unit_price || 0).toFixed(2)}</TableCell>
                                  <TableCell>{service.qty || 1}</TableCell>
                                  <TableCell>₹{Number(service.subtotal || 0).toFixed(2)}</TableCell>
                                  <TableCell>₹{Number(service.tax_amount || 0).toFixed(2)}</TableCell>
                                  <TableCell>₹{Number(service.grand_total || 0).toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {/* Financial Summary */}
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3">Financial Summary</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span>Subtotal:</span>
                          <span>₹{Number(appointmentTransactions[selectedAppointmentId].total_subtotal || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Discount:</span>
                          <span>₹{Number(appointmentTransactions[selectedAppointmentId].total_discount || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tax:</span>
                          <span>₹{Number(appointmentTransactions[selectedAppointmentId].total_tax || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span>Grand Total:</span>
                          <span>₹{Number(appointmentTransactions[selectedAppointmentId].grand_total || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Wallet className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No appointment data found</p>
                    <p className="text-sm mt-1">Click "Create Transactions" to generate appointment records</p>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter className="pt-6 border-t">
            <div className="flex items-center justify-between w-full">
              <div className="flex gap-2">
                {selectedAppointmentId && appointmentTransactions[selectedAppointmentId] && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-green-600 border-green-200 hover:bg-green-50"
                      onClick={async () => {
                        try {
                          await AppointmentTransactionService.updateAppointmentStatus(
                            selectedAppointmentId,
                            'confirmed',
                            (user as any)?.account_code,
                            (user as any)?.retail_code
                          );
                          // Optimistic update in list
                          setRaw(prev => prev.map(x => (String(x.appointment_id)===String(selectedAppointmentId) ? { ...x, status: 'confirmed' } : x)) as any);
                          await fetchAppointmentTransactions(selectedAppointmentId);
                          // Refresh the appointment list to show updated status
                          window.location.reload();
                          toast({ title: 'Status Updated', description: 'Appointment confirmed successfully' });
                        } catch (error: any) {
                          toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' });
                        }
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      onClick={async () => {
                        try {
                          await AppointmentTransactionService.updateAppointmentStatus(
                            selectedAppointmentId,
                            'completed',
                            (user as any)?.account_code,
                            (user as any)?.retail_code
                          );
                          // Optimistic update in list
                          setRaw(prev => prev.map(x => (String(x.appointment_id)===String(selectedAppointmentId) ? { ...x, status: 'completed' } : x)) as any);
                          await fetchAppointmentTransactions(selectedAppointmentId);
                          // Refresh the appointment list to show updated status
                          window.location.reload();
                          toast({ title: 'Status Updated', description: 'Appointment completed successfully' });
                        } catch (error: any) {
                          toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' });
                        }
                      }}
                    >
                      Complete
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { 
                        setSelectedAppointmentId(selectedAppointmentId); 
                        setCancelRemark(''); 
                        setCancelConfirmOpen(true); 
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
              <Button variant="outline" onClick={() => setTransactionDialogOpen(false)} className="px-6">
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
