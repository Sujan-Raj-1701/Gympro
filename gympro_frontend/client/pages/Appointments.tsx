import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import muhurtham from '../../public/muhurtham.png';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addDays, addMonths, isSameMonth } from "date-fns";
// Tamil calendar + Muhurtham utilities
import { getTamilDate, getMuhurthamMarker, muhurtham2025, muhurtham2026 } from "@/lib/tamilCalendar";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Clock,
  MapPin,
  Plus,
  Search,
  Filter,
  Download,
  Edit,
  Trash2,
  Users,
  IndianRupee,
  CheckCircle,
  XCircle,
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff, 
  CalendarX,
  LayoutDashboard,
  ArrowUpDown,
  Receipt,
  Star,
} from "lucide-react";
import React from 'react';
// Removed direct XLSX usage; using shared exportUtils instead
import { exportData } from "@/lib/exportUtils";
// Restored missing imports after previous accidental removal
import { useAuth } from '@/contexts/AuthContext';
import { DataService } from '@/services/userService';
import { CalendarService } from '@/services/calendarService';
import { BookingsService, BookingRangeEntry } from '@/services/bookingsService';
import type { CalendarEntry } from '@/services/calendarService';
// ApiService may be needed for future direct calls; safe to import (was originally present)
import { ApiService } from '@/services/apiService';
import { MuhurthamModal } from '../components/MuhurthamModal';
// In-flight key (module level) to dedupe bookings-range fetches; preserve existing if already on globalThis
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gAny: any = globalThis as any;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let __HB_INFLIGHT_BOOKINGS_KEY: string | null = gAny.__HB_INFLIGHT_BOOKINGS_KEY ?? null;
gAny.__HB_INFLIGHT_BOOKINGS_KEY = __HB_INFLIGHT_BOOKINGS_KEY;

interface Hall {
  id: string;
  name: string;
  location: string;
  amenities: string[];
  hourlyRate: number;
  isActive: boolean;
}

interface Booking {
  id: string;
  hallId: string;
  hallName: string;
  slotId?: string; // reference to master_slot (optional)
  eventTypeId?: string; // reference to master_event_type (optional)
  customerName: string;
  email: string;
  phone: string;
  date: Date;
  startTime: string;
  endTime: string;
  purpose: string;
  attendees: number;
  totalAmount: number;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  notes: string;
  createdAt: Date;
  _paidTotal?: number;
  _pendingTotal?: number;
  _allDay?: boolean; // derived when backend provides date-only (no time)
  _slotName?: string;
  _slotStart?: string;
  _slotEnd?: string;
}

// No seed/demo data: start with an empty bookings list
const initialBookings: Booking[] = [];

// Utility fallback to avoid name conflict when initializing with fetched data
function hallsFallback(): Hall[] {
  // No default hall seed data; list will populate after backend fetch
  return [];
}

export default function HallBooking() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Real data states
  const [halls, setHalls] = useState<Hall[]>(() => hallsFallback());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
   const [bookings, setBookings] = useState<Booking[]>(initialBookings);
  // Master lookups for details modal
  const [serviceNameMap, setServiceNameMap] = useState<Record<string,string>>({});
  const [paymentModeNameMap, setPaymentModeNameMap] = useState<Record<string,string>>({});
  const [eventTypeNameMap, setEventTypeNameMap] = useState<Record<string,string>>({});
  // Dual Slot feature removed

  // Fetch halls (master) and initial lookups
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        if (!accountCode || !retailCode) return; // wait until auth ready

  const tableList = ['master_hall','master_slot','master_customer','master_event_type','master_service','master_paymentmodes'];
        const res: any = await DataService.readData(tableList, accountCode, retailCode);
        let dataMap: any = res?.data;
        // Support backend returning array for single table (legacy)
        if (Array.isArray(dataMap)) {
          // assume booking rows only
          dataMap = { booking: dataMap };
        }

  const hallRows: any[] = dataMap?.master_hall || dataMap?.hall || dataMap?.halls || [];
        if (mounted && Array.isArray(hallRows) && hallRows.length) {
          const mappedHalls = hallRows.map((r: any) => ({
            id: String(r.hall_id || r.id || r._id),
            name: r.hall_name || r.name || '',
            capacity: Number(r.capacity ?? 0),
            location: r.location || '',
            amenities: r.amenities || [],
            hourlyRate: Number(r.hourly_rate ?? r.price ?? 0) || 0,
            isActive: r.STATUS ? (r.STATUS === 'Active' || r.STATUS === 1) : (r.is_active === undefined ? true : !!r.is_active)
          }));
          setHalls(mappedHalls.length ? mappedHalls : halls);
        }

  const bookingRows: any[] = [];
        const serviceRows: any[] = [];
        const paymentRows: any[] = [];
  const slotRows: any[] = dataMap?.master_slot || [];
  const eventTypeRows: any[] = dataMap?.master_event_type || [];
  const masterServiceRows: any[] = dataMap?.master_service || dataMap?.service_master || dataMap?.services || [];
  const masterPaymentModeRows: any[] = dataMap?.master_paymentmodes || dataMap?.master_payment_mode || dataMap?.payment_mode_master || dataMap?.payment_modes || [];
  const customerRows: any[] = dataMap?.master_customer || dataMap?.customer_master || dataMap?.customers || [];
        if (mounted && Array.isArray(slotRows) && slotRows.length) {
          // Map master_slot to time period options
          const mappedSlots = slotRows.map((s:any)=>({
            id: String(s.slot_id || s.id || s._id),
            name: s.slot_name || s.name || 'Slot',
      // Prefer fromtime/totime (TIME columns) else legacy fields
      start: (s.fromtime || s.from_time || s.start_time || s.start || '00:00').toString().slice(0,5),
      end: (s.totime || s.to_time || s.end_time || s.end || '23:59').toString().slice(0,5)
          }));
          // Store into a ref/state for later (reuse selectedTimePeriod list)
          setCustomSlots(mappedSlots);
        }

        // group services & payments by booking_id
  const svcByBooking: Record<string, any[]> = {};
  const payByBooking: Record<string, any[]> = {};

        // Build quick lookup maps to avoid relying on yet-to-update state
        const hallNameMap: Record<string,string> = {};
        hallRows.forEach(h => { const id = String(h.hall_id || h.id || h._id || ''); if (id) hallNameMap[id] = h.hall_name || h.name || ''; });
    const slotMetaMap: Record<string,{name:string;start:string;end:string}> = {};
  const eventTypeNameMapLocal: Record<string,string> = {};
  const serviceNameMapLocal: Record<string,string> = {};
  const paymentModeNameMapLocal: Record<string,string> = {};
        slotRows.forEach((s:any)=>{
          const id = String(s.slot_id || s.id || s._id || '');
          if (!id) return;
          const start = (s.fromtime || s.from_time || s.start_time || s.start || '00:00').toString().slice(0,5);
          const end = (s.totime || s.to_time || s.end_time || s.end || '23:59').toString().slice(0,5);
          slotMetaMap[id] = { name: s.slot_name || s.name || 'Slot', start, end };
        });
        eventTypeRows.forEach((et:any)=>{
          const id = String(et.event_type_id || et.id || et._id || '');
          if (!id) return;
          const name = et.event_type_name || et.name || et.event_type || '';
          if (name) eventTypeNameMapLocal[id] = String(name);
        });
        masterServiceRows.forEach((ms:any)=>{
          const id = String(ms.service_id || ms.id || ms._id || '');
          const name = ms.service_name || ms.name || '';
          if (id && name) serviceNameMapLocal[id] = String(name);
        });
        masterPaymentModeRows.forEach((pm:any)=>{
          const id = String(pm.payment_mode_id || pm.id || pm._id || pm.code || '');
          const name = pm.payment_mode_name || pm.name || pm.mode || '';
          if (id && name) paymentModeNameMapLocal[id] = String(name);
        });
        if (mounted) {
          setServiceNameMap(serviceNameMapLocal);
          setPaymentModeNameMap(paymentModeNameMapLocal);
          setEventTypeNameMap(eventTypeNameMapLocal);
        }
        const customerByBusinessId: Record<string, any> = {};
        const customerByPk: Record<string, any> = {};
        customerRows.forEach((c:any)=>{
          const pk = String(c.id || c.ID || c._id || '');
          if (pk) customerByPk[pk] = c;
          const biz = String(c.customer_id || c.customerId || c.CustomerID || '') || '';
          if (biz) customerByBusinessId[biz] = c;
        });

  const mappedBookings = bookingRows.map((r: any, idx: number) => {
      // Keep primary key (id) for edit/update; keep display code for showing in UI
      const pkId = String(r.id || r.pk || r.booking_pk || '') || undefined;
      const dispId = String(r.booking_display_id || r.booking_code || r.booking_id || r.invoice_no || '') || undefined;
      const id = pkId || dispId || `b-${idx}`;
      const rawCustomerId = String(r.customer_id || r.customerId || r.CustomerID || r.cust_id || '') || '';
      const custRow = rawCustomerId ? (customerByBusinessId[rawCustomerId] || customerByPk[rawCustomerId]) : undefined;
      const startRaw = r.eventdate || r.start_time || r.start || r.startDate; // start_datetime deprecated; backend now uses eventdate
      // end_datetime removed from schema; treat booking as point-in-time (or slot-based)
      const startDateObj = startRaw ? new Date(startRaw) : new Date();
      const endDateObj = startDateObj; // single time point
          const timeFmt = (d: Date) => d.toISOString().slice(11,16);
          const services = svcByBooking[id] || [];
            const payments = payByBooking[id] || [];
            const servicesTotal = services.reduce((sum, s) => sum + Number(s.amount || s.line_total || s.unit_price || 0), 0);
            const paymentsTotal = payments.reduce((sum, p) => sum + Number(p.amount || p.paid_amount || 0), 0);
      const totalAmount = Number(r.total_amount ?? r.amount ?? (r.hall_rate || 0) + servicesTotal) || 0;
      const pendingTotal = Math.max(totalAmount - paymentsTotal, 0);
  // Capture an explicit slot id if the booking row has one so a date-only
  // booking with a chosen slot does NOT block every slot.
  const slotId = String(r.slot_id || r.slotId || r.slot || '') || undefined;
  // Attempt to resolve slot meta (name + times) from earlier loaded customSlots
  const slotMeta = slotId ? slotMetaMap[slotId] : undefined;
  const extractHHMM = (val:any, fallback:Date) => {
        if (!val) return timeFmt(fallback);
        const str = String(val);
        const m = str.match(/\b(\d{2}:\d{2})/);
        return m ? m[1] : timeFmt(fallback);
      };
      const startHHMM = extractHHMM(startRaw, startDateObj);
  // No separate end time; duplicate start (UI can choose to hide range if same)
  const endHHMM = startHHMM;
      const isDateOnly = typeof startRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startRaw.trim());
      // If date-only, treat as all-day; internally set time to 00:00 for consistency
      const startTimeStr = isDateOnly ? '00:00' : timeFmt(startDateObj);
  const eventTypeId = (r.event_type_id || r.eventTypeId) ? String(r.event_type_id || r.eventTypeId) : '';
  const purposeResolved = (r.event_type_name || r.event_type || r.purpose || (eventTypeId ? eventTypeNameMapLocal[eventTypeId] : '') || '');
          return {
            id, // primary identifier used for actions/edit
            displayId: dispId,
            hallId: String(r.hall_id || r.hallId || ''),
            hallName: r.hall_name || r.hallName || hallNameMap[String(r.hall_id || r.hallId || '')] || '',
  slotId, // optional single-slot reference
    eventTypeId: eventTypeId || undefined,
            customerName: r.customer_name || r.customerName || r.customer || custRow?.customer_name || custRow?.name || '',
            email: r.email || r.customer_email || custRow?.email || custRow?.customer_email || '',
            phone: r.phone || r.mobile || r.customer_mobile || custRow?.phone || custRow?.mobile || '',
            date: startDateObj,
            startTime: startTimeStr,
    endTime: startTimeStr,
  _startHHMM: startHHMM,
  // _endHHMM removed; using same as start
    _allDay: isDateOnly || undefined,
            // Add resolved slot display helpers
            _slotName: slotMeta?.name,
            _slotStart: slotMeta?.start,
            _slotEnd: slotMeta?.end,
    purpose: purposeResolved,
            attendees: Number(r.expected_guests ?? r.attendees ?? 0) || 0,
      totalAmount,
            status: (() => {
              const raw = String(r.STATUS || r.status || 'pending').toLowerCase();
              // Normalize variant spelling from backend: 'canceled' -> 'cancelled'
              return raw === 'canceled' ? 'cancelled' : raw;
            })(),
            // Keep cancellation date for dashboard card filtering
            cancel_date: ((): string | undefined => {
              const v = r.cancel_date || r.cancellation_date || r.cancelled_at || r.cancel_at || r.cancelledAt;
              if (!v) return undefined;
              try {
                const s = String(v);
                const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
                return m ? m[1] : s.slice(0, 10);
              } catch { return undefined; }
            })(),
            notes: r.notes || r.special_requirements || '',
            createdAt: r.created_at ? new Date(r.created_at) : startDateObj,
            // extra (not rendered yet) for potential future use
            _serviceCount: services.length,
            _paymentCount: payments.length,
            // Keep arrays for details modal
            _services: services,
            _payments: payments,
            _paidTotal: paymentsTotal,
      _pendingTotal: pendingTotal,
          } as Booking & any;
        });
  if (mounted && mappedBookings.length) setBookings(mappedBookings);
      } catch (e: any) {
        console.warn('Failed to load hall/booking data:', e);
        if (mounted) setError(e?.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [user]);

  // (moved below after date filter state declarations)
 
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hallListFilter, setHallListFilter] = useState<string>('all');
  // Sorting & Pagination state
  const [sortBy, setSortBy] = useState<'date'|'hall'|'slot'|'customer'|'amount'|'status'>('date');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Muhurtham modal state
  const currentYear = new Date().getFullYear();
  const availableMuhurthamYears = [2025, 2026];
  const initialMuhurthamYear = availableMuhurthamYears.includes(currentYear) ? currentYear : availableMuhurthamYears[0];
  const [showMuhurthamModal, setShowMuhurthamModal] = useState(false);
  const [muhurthamYear, setMuhurthamYear] = useState<number>(initialMuhurthamYear);
  const muhurthamYearData = useMemo(() => ({ 2025: muhurtham2025, 2026: muhurtham2026 } as Record<number, any[]>), []);
  const muhurthamList = useMemo(() => {
    const arr = muhurthamYearData[muhurthamYear] || [];
    return arr.slice().sort((a:any,b:any)=> a.date.localeCompare(b.date));
  }, [muhurthamYear, muhurthamYearData]);
  // Group by month for modal (month index 0-11)
  const muhurthamGrouped = useMemo(() => {
    const groups: Record<number, any[]> = {};
    muhurthamList.forEach(e => {
      const m = new Date(e.date).getMonth();
      (groups[m] ||= []).push(e);
    });
    return Object.entries(groups)
      .sort((a,b)=> Number(a[0]) - Number(b[0]))
      .map(([m, list]) => ({ month: Number(m), list: (list as any[]).sort((a,b)=> a.date.localeCompare(b.date)) }));
  }, [muhurthamList]);
  const gotoPrevMuhurthamYear = () => {
    const idx = availableMuhurthamYears.indexOf(muhurthamYear);
    if (idx > 0) setMuhurthamYear(availableMuhurthamYears[idx-1]);
  };
  const gotoNextMuhurthamYear = () => {
    const idx = availableMuhurthamYears.indexOf(muhurthamYear);
    if (idx >=0 && idx < availableMuhurthamYears.length-1) setMuhurthamYear(availableMuhurthamYears[idx+1]);
  };
  
  // Date range filter states - set to today by default
  const today = new Date();
  const [fromDate, setFromDate] = useState<Date | undefined>(today);
  const [toDate, setToDate] = useState<Date | undefined>(today);
  const [rangePreset, setRangePreset] = useState<'today'|'thisWeek'|'custom'>('today');
  const [onlyUpcoming, setOnlyUpcoming] = useState<boolean>(false);
  // Applied (committed) filters used for fetching and table/summary; kept in sync with inputs
  const [appliedFromDate, setAppliedFromDate] = useState<Date | undefined>(today);
  const [appliedToDate, setAppliedToDate] = useState<Date | undefined>(today);
  const [appliedOnlyUpcoming, setAppliedOnlyUpcoming] = useState<boolean>(false);
  // Signal when persisted filters are restored to avoid duplicate initial fetches
  const [filtersReady, setFiltersReady] = useState<boolean>(false);
  // Trigger to force refresh on tab visibility/focus changes
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  // Keep date range valid: toDate should not be earlier than fromDate
  const handleFromDateSelect = (date?: Date) => {
    setFromDate(date);
    let nextTo = toDate;
    if (date && nextTo && nextTo < date) {
      // Auto-adjust toDate up to fromDate
      nextTo = date;
      setToDate(date);
    }
    // If toDate not set (e.g., after exiting Upcoming), align it with new fromDate
    if (date && !nextTo && !onlyUpcoming) {
      nextTo = date;
      setToDate(date);
    }
    setRangePreset('custom');
    // Apply immediately
    setAppliedFromDate(date);
    setAppliedToDate(onlyUpcoming ? undefined : nextTo ?? date);
    setAppliedOnlyUpcoming(onlyUpcoming);
  };
  const handleToDateSelect = (date?: Date) => {
    if (date && fromDate && date < fromDate) {
      // Prevent selecting a toDate earlier than fromDate; clamp to fromDate
      setToDate(fromDate);
      setAppliedFromDate(fromDate);
      setAppliedToDate(onlyUpcoming ? undefined : fromDate);
      setAppliedOnlyUpcoming(onlyUpcoming);
      return;
    }
    setToDate(date);
    setRangePreset('custom');
    // Apply immediately
    setAppliedFromDate(fromDate);
    setAppliedToDate(onlyUpcoming ? undefined : date);
    setAppliedOnlyUpcoming(onlyUpcoming);
  };
  // Quick presets
  const applyToday = () => {
    const d = new Date();
    // normalize to date-only meaning (time ignored downstream anyway)
    setFromDate(d);
    setToDate(d);
    setRangePreset('today');
    setOnlyUpcoming(false);
    // Apply immediately
    setAppliedFromDate(d);
    setAppliedToDate(d);
    setAppliedOnlyUpcoming(false);
  };
  const applyThisWeek = () => {
    const d = new Date();
    const start = startOfWeek(d);
    const end = endOfWeek(d);
    setFromDate(start);
    setToDate(end);
    setRangePreset('thisWeek');
    setOnlyUpcoming(false);
    // Apply immediately
    setAppliedFromDate(start);
    setAppliedToDate(end);
    setAppliedOnlyUpcoming(false);
  };
  const toggleUpcoming = () => {
    const next = !onlyUpcoming;
    setOnlyUpcoming(next);
    if (next) {
      const now = new Date();
      const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setFromDate(mid);
      setToDate(undefined);
      setRangePreset('custom'); // ensure Today/This Week not highlighted
      // Apply immediately for Upcoming (open-ended)
      setAppliedFromDate(mid);
      setAppliedToDate(undefined);
      setAppliedOnlyUpcoming(true);
    }
    else {
      // When exiting Upcoming, if no quick preset is active, align toDate to fromDate
      if (rangePreset === 'custom') {
        const base = fromDate || today;
        setToDate(base);
        setAppliedFromDate(base);
        setAppliedToDate(base);
        setAppliedOnlyUpcoming(false);
      }
    }
  };

  // Common date range for report headers/metadata
  const reportDateRange = useMemo(() => {
    const from = appliedFromDate ?? new Date();
    const to = appliedToDate ?? appliedFromDate ?? new Date();
    return { from, to };
  }, [appliedFromDate, appliedToDate]);

  // Derived flags to ensure exclusive visual selection
  const isTodayActive = rangePreset === 'today' && !onlyUpcoming;
  const isThisWeekActive = rangePreset === 'thisWeek' && !onlyUpcoming;
  
  // (moved below after availability states)
  
  
  // Availability calendar states
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  const yearOptions = React.useMemo(() => {
    const cur = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => String(cur - 5 + i));
  }, []);
  const [selectedHallForCalendar, setSelectedHallForCalendar] = useState<string>("");
  // Dynamic border color for Hall Availability Calendar based on selected hall
  const hallBorderClass = useMemo(() => {
    const palette = [
      'border-sky-400',
      'border-emerald-400',
      'border-violet-400',
      'border-amber-400',
      'border-rose-400',
      'border-indigo-400',
      'border-teal-400',
      'border-fuchsia-400',
    ];
    const id = selectedHallForCalendar || '';
    if (!id) return 'border-gray-200';
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    const idx = hash % palette.length;
    return palette[idx];
  }, [selectedHallForCalendar]);
  const [selectedTimePeriod, setSelectedTimePeriod] = useState<string>("all");
  const [customSlots, setCustomSlots] = useState<{id:string;name:string;start:string;end:string;}[]>([]);
  
  // Persist calendar month/year in session so user's selection survives reloads
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('hallCalendarMonth');
      if (raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          // normalize to first day of month to avoid day-of-month drift
          setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
        }
      }
    }
    catch (e) {
      // ignore session storage errors
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('hallCalendarMonth', calendarMonth.toISOString());
    }
    catch (e) {
      // ignore storage write errors
    }
  }, [calendarMonth]);
  // Refs to avoid triggering refetch when these change; used only for mapping
  const hallsRef = useRef<Hall[]>(halls);
  useEffect(() => { hallsRef.current = halls; }, [halls]);
  const slotsRef = useRef<{id:string;name:string;start:string;end:string;}[]>(customSlots);
  useEffect(() => { slotsRef.current = customSlots; }, [customSlots]);
  // Guard to avoid duplicate fetches with the same params (e.g., React StrictMode)
  const lastBookingsKeyRef = useRef<string | null>(null);
  // Backend calendar data for the visible month (scoped by account/retail and optional hall)
  const [monthCal, setMonthCal] = useState<CalendarEntry[]>([]);
  // When halls load, pick the first active hall by default if none selected
  useEffect(() => {
    if (!selectedHallForCalendar && halls && halls.length) {
      const firstActive = halls.find(h => h.isActive) || halls[0];
      if (firstActive?.id) setSelectedHallForCalendar(String(firstActive.id));
    }
  }, [halls, selectedHallForCalendar]);
  // Slot selection modal state
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [slotModalDate, setSlotModalDate] = useState<Date | null>(null);
  const [slotModalSlots, setSlotModalSlots] = useState<Array<{
    id: string;
    name: string;
    start: string;
    end: string;
    isAvailable: boolean;
    bookedByName?: string;
    bookedByPhone?: string;
    bookedBookingId?: string | number;
    hallName?: string;
  }>>([]);
  // Selection state for slot modal (multi-select)
  const [slotModalSelectedIds, setSlotModalSelectedIds] = useState<string[]>([]);
  const [slotModalFullDay, setSlotModalFullDay] = useState<boolean>(false);
  // Accumulated selections when user chooses "Add more" in the modal
  const [slotModalAccumulated, setSlotModalAccumulated] = useState<Array<{date:string; slotIds:string[]; fullDay:boolean; hallId?: string}>>([]);
  const [slotModalAddMsg, setSlotModalAddMsg] = useState<string>('');
  const [slotModalAddErr, setSlotModalAddErr] = useState<string>('');
  // Ref for Full Day checkbox to show indeterminate when some slots are blocked
  const fullDayCheckboxRef = useRef<HTMLInputElement|null>(null);

  // Derived helpers for modal UI
  const slotModalAllAvailableIds = slotModalSlots ? slotModalSlots.filter(x => x.isAvailable).map(x => x.id) : [];
  const slotModalSelectedCount = slotModalFullDay ? slotModalAllAvailableIds.length : slotModalSelectedIds.length;


  // Visual: when Full Day is on but some slots are blocked (booked/added), show indeterminate
  useEffect(() => {
    const el = fullDayCheckboxRef.current;
    if (!el) return;
    const anyBlocked = (slotModalSlots || []).some(x => !x.isAvailable);
    const anyAvailable = (slotModalSlots || []).some(x => x.isAvailable);
    el.indeterminate = !!(slotModalFullDay && anyBlocked && anyAvailable);
  }, [slotModalFullDay, slotModalSlots]);

  // FIX: Reset slot modal state when hall changes to avoid stale availability
  useEffect(() => {
    setSlotModalSlots([]);
    setSlotModalSelectedIds([]);
    setSlotModalFullDay(false);
    setSlotModalOpen(false);
  }, [selectedHallForCalendar]);

  // Toggle selection for a slot id (used by row click and checkbox change flows)
  const toggleSlotId = (slotId: string) => {
    const slot = slotModalSlots.find(x => x.id === slotId);
    if (!slot || !slot.isAvailable) return; // blocked/booked slots not toggleable
    const allAvail = (slotModalSlots || []).filter(x => x.isAvailable).map(x => x.id);
    if (slotModalFullDay) {
      // If full day is active and user toggles a specific slot, disable full day and remove that slot
      setSlotModalFullDay(false);
      setSlotModalSelectedIds(allAvail.filter(id => id !== slotId));
      return;
    }
    setSlotModalSelectedIds(prev => {
      const has = prev.includes(slotId);
      const next = has ? prev.filter(id => id !== slotId) : [...prev, slotId];
      const uniqueNext = Array.from(new Set(next));
      if (uniqueNext.length > 0 && uniqueNext.length === allAvail.length && allAvail.length > 0) {
        setSlotModalFullDay(true);
        return allAvail;
      }
      return uniqueNext;
    });
  };
  
  // Calendar visibility state
  const [showCalendar, setShowCalendar] = useState(true);
  const [showDashboard, setShowDashboard] = useState(true);
  // Details modal state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsBooking, setDetailsBooking] = useState<any | null>(null);
  const openDetails = (b:any) => { setDetailsBooking(b); setDetailsOpen(true); };
  const closeDetails = () => { setDetailsOpen(false); setDetailsBooking(null); };

  const filteredBookings = bookings.filter((booking) => {
    const q = searchQuery.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, "");
    const phoneStr = String(booking.phone || "");
    const phoneDigits = phoneStr.replace(/[^0-9]/g, "");
    const matchesPhone = qDigits
      ? phoneDigits.includes(qDigits)
      : phoneStr.toLowerCase().includes(q);
    const matchesSearch =
      booking.customerName.toLowerCase().includes(q) ||
      booking.hallName.toLowerCase().includes(q) ||
      booking.purpose.toLowerCase().includes(q) ||
      String(booking.id || '').toLowerCase().includes(q) ||
      matchesPhone;

  const matchesStatus = (() => {
      if (statusFilter === "all") return true;
      if (statusFilter === "cancelled") return booking.status === "cancelled";
      // Derived status from payment details
      let d: string | undefined;
      try { d = String(derivePaymentStatus(booking) || '').toLowerCase(); } catch { d = undefined; }
      if (!d) return true; // fail-open
      // Treat 'advanced' and 'advance' as same bucket
      if (d === 'advanced') d = 'advance';
      if (statusFilter === 'advance') return d === 'advance';
      if (statusFilter === 'pending') {
        // When user selects Pending, also include advance/advanced bookings
        return d === 'pending' || d === 'advance';
      }
      return d === statusFilter;
    })();

  const matchesHallList = hallListFilter === 'all' || String(booking.hallId) === String(hallListFilter);

  // Date range filtering (compare only date portion, ignore time)
    // Compare only date portion (midnight) so different times still match the range
    const bookingDateMid = new Date(booking.date.getFullYear(), booking.date.getMonth(), booking.date.getDate());
  const fromMid = appliedFromDate ? new Date(appliedFromDate.getFullYear(), appliedFromDate.getMonth(), appliedFromDate.getDate()) : null;
  const toMid = appliedToDate ? new Date(appliedToDate.getFullYear(), appliedToDate.getMonth(), appliedToDate.getDate()) : null;
    // Matches if primary booking.date is in range OR any calendar row date is in range
    const inRange = (d: Date) => (!fromMid || d >= fromMid) && (!toMid || d <= toMid);
    const anyCalInRange = Array.isArray((booking as any)._calRows) && (booking as any)._calRows.some((hb: any) => {
      const s = String(hb.eventdate || hb.event_date || hb.date || '');
      if (!s) return false;
      try {
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        const iso = m ? m[1] : s;
        const parts = iso.split('-').map(Number);
        const d = parts.length === 3 ? new Date(parts[0], parts[1]-1, parts[2]) : new Date(s);
        if (isNaN(d as any)) return false;
        const dm = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return inRange(dm);
      } catch { return false; }
    });
    const matchesDateRange = inRange(bookingDateMid) || anyCalInRange;
    const todayMid = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  // Upcoming check: consider any calendar row date (not just the primary booking date)
  let anyEventOnOrAfterToday = bookingDateMid >= todayMid;
  if (Array.isArray((booking as any)._calRows) && (booking as any)._calRows.length) {
    for (const hb of (booking as any)._calRows) {
      const s = String(hb.eventdate || hb.event_date || hb.date || '');
      if (!s) continue;
      try {
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        const iso = m ? m[1] : s;
        const [y, mo, d] = iso.split('-').map(Number);
        if (y && mo && d) {
          const dm = new Date(y, mo - 1, d);
          const dmMid = new Date(dm.getFullYear(), dm.getMonth(), dm.getDate());
          if (dmMid >= todayMid) { anyEventOnOrAfterToday = true; break; }
        }
      } catch {}
    }
  }
  const matchesUpcoming = !appliedOnlyUpcoming || anyEventOnOrAfterToday;
  return matchesSearch && matchesStatus && matchesHallList && matchesDateRange && matchesUpcoming;
  });

  // Grand totals (over all filtered bookings, not just current page)
  const grandTotals = useMemo(() => {
    const list = filteredBookings;
    let adv = 0, pend = 0, amt = 0;
    for (const b of list) {
      const total = Number((b as any).totalAmount) || 0;
      const paid = Number((b as any)._paidTotal) || 0;
      const pending = (b as any)._pendingTotal != null ? Number((b as any)._pendingTotal) : Math.max(total - paid, 0);
      adv += paid; // treat paid portion as advance for total purposes
      pend += pending;
      amt += total;
    }
    return { advance: adv, pending: pend, amount: amt };
  }, [filteredBookings]);

  // Reset to page 1 when non-date filters change (date changes apply only on Submit)
  useEffect(()=>{ setPage(1); }, [searchQuery, statusFilter, hallListFilter]);
  // Reset pagination only when applied filters change, not while editing inputs
  useEffect(()=>{ setPage(1); }, [searchQuery, statusFilter, hallListFilter, appliedFromDate, appliedToDate, appliedOnlyUpcoming]);

  // Fetch calendar entries for the visible month whenever month/hall or auth changes
  useEffect(() => {
    (async () => {
      try {
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
  // Only fetch when a hall is selected to avoid initial unscoped call
  if (!accountCode || !retailCode || !selectedHallForCalendar) return;
        // month is 0-indexed in Date; API expects 1-12
        const y = calendarMonth.getFullYear();
        const m = calendarMonth.getMonth() + 1;
  const hallId = selectedHallForCalendar; // require hall id; skip unfiltered request
        const res = await CalendarService.getMonth({ account_code: accountCode, retail_code: retailCode, year: y, month: m, hall_id: hallId });
        if (res?.success && Array.isArray(res.data)) {
          setMonthCal(res.data);
        } else {
          setMonthCal([]);
        }
      } catch (e) {
        console.warn('Failed to load calendar month data:', e);
        setMonthCal([]);
      }
    })();
  }, [user, calendarMonth, selectedHallForCalendar]);

  // Load bookings list and dashboard data from /bookings-range based on applied date filters (auto-fetch on change)
  useEffect(() => {
    if (!filtersReady) return; // wait until filters restored
    let cancelled = false;
    (async () => {
      try {
  const accountCode = (user as any)?.account_code || '';
  const retailCode = (user as any)?.retail_code || '';
  if (!accountCode || !retailCode) return;
        // Determine API date range
        const baseFrom = appliedFromDate ? new Date(appliedFromDate) : new Date();
        let baseTo: Date | undefined = appliedToDate ? new Date(appliedToDate) : undefined;
        if (!baseTo) {
          baseTo = appliedOnlyUpcoming ? addMonths(new Date(), 6) : baseFrom;
        }
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const fromStr = fmt(baseFrom);
        const toStr = fmt(baseTo);

    // Prevent duplicate calls for the same key (only if both markers indicate in-flight)
  const reqKey = `${accountCode}|${retailCode}|${fromStr}|${toStr}`;
  if (lastBookingsKeyRef.current === reqKey && __HB_INFLIGHT_BOOKINGS_KEY === reqKey) return;
  // Mark as in-flight BEFORE the request to avoid StrictMode double-invoke duplicate
  lastBookingsKeyRef.current = reqKey;
  __HB_INFLIGHT_BOOKINGS_KEY = reqKey;

  const res = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate: fromStr, todate: toStr });
        const rows: BookingRangeEntry[] = (res && Array.isArray((res as any).data)) ? (res as any).data : (Array.isArray(res) ? res as any : []);

        // quick lookups
        const hallNameMap: Record<string,string> = {};
        hallsRef.current.forEach(h => { hallNameMap[String(h.id)] = h.name; });
        const slotMetaMap: Record<string,{name:string;start:string;end:string}> = {};
        slotsRef.current.forEach(s => { slotMetaMap[String(s.id)] = { name: s.name, start: (s.start||'00:00').slice(0,5), end: (s.end||'23:59').slice(0,5) }; });

        const parseDateLoose = (val: any): Date | null => {
          if (!val) return null;
          try {
            let s = String(val).trim();
            // If contains time, prefer the date part to avoid TZ shifts
            const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
            if (m) s = m[1];
            const parts = s.split('-').map(Number);
            if (parts.length === 3) {
              return new Date(parts[0], parts[1]-1, parts[2]);
            }
            const d = new Date(val);
            return isNaN(d as any) ? null : d;
          } catch { return null; }
        };

        const num = (v:any, def=0) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : def;
        };

  const mapped: Booking[] = rows.map((entry: any, idx: number) => {
          const b = entry?.booking || {};
          const customer = entry?.customer || {};
          const payments = Array.isArray(entry?.payments) ? entry.payments : [];
          const services = Array.isArray(entry?.services) ? entry.services : [];
          const hallBookings = Array.isArray(entry?.hallbooking) ? entry.hallbooking : [];

          const pkId = String(b.id || b.pk || b.booking_pk || b.ID || '') || undefined;
          const dispId = String(b.booking_display_id || b.booking_code || b.booking_id || b.invoice_no || b.InvoiceNo || '') || undefined;
          const id = pkId || dispId || `br-${idx}`;
          const hallId = String(b.hall_id || b.hallId || hallBookings[0]?.hall_id || b.HallID || b.hall || '');
          let hallName = hallNameMap[hallId] || b.hall_name || b.HallName || '';

          // derive event date (ignore any legacy secondary date fields)
          const rawDate1: any = (
            b.eventdate || b.event_date || b.date || b.start_date || b.startDate ||
            hallBookings[0]?.eventdate || hallBookings[0]?.event_date || hallBookings[0]?.date
          );
          const date1Obj = parseDateLoose(rawDate1);
          const dateObj = date1Obj || new Date();

          // pick slot based on primary date only
          const matchHb = hallBookings.find((hb:any)=>{
            const hbDate = (hb.eventdate || hb.event_date || hb.date) || '';
            const d = parseDateLoose(hbDate);
            try { return d && d.toDateString() === dateObj.toDateString(); } catch { return false; }
          }) || hallBookings[0];
          const slotIdRaw = (matchHb?.slot_id ?? b.slot_id);
          const slotId = slotIdRaw != null ? String(slotIdRaw) : undefined;
          const slotMeta = slotId ? slotMetaMap[String(slotId)] : undefined;

          const finalHallId = hallId;
          hallName = hallNameMap[finalHallId] || hallName;

          const email = b.email || customer.email || customer.customer_email || customer.Email || '';
          const phone = b.phone || b.mobile || customer.phone || customer.mobile || customer.customer_mobile || customer.Mobile || '';
          const custName = b.customer_name || customer.customer_name || customer.name || customer.CustomerName || '';

          // normalize customer identity fields for details modal (GST, Aadhaar, PAN, Address)
          const gstUnified = (
            b.gstin || b.gst_no || b.gst_number ||
            customer.gstin || customer.gst_no || customer.gst_number || (customer as any)?.GSTNo || ''
          ) as string;
          const aadhaarUnified = (
            b.aadhaar || b.aadhar || b.aadhar_no ||
            customer.aadhaar || customer.aadhar || customer.aadhar_no || ''
          ) as string;
          const panUnified = (
            b.pan || b.pan_no || b.pancard || b.pancard_no ||
            customer.pan || customer.pan_no || customer.pancard || customer.pancard_no || ''
          ) as string;
          const addressUnified = (
            b.address || b.customer_address ||
            customer.address || customer.customer_address ||
            [customer.address_line1, customer.address_line2, customer.city, customer.pincode].filter(Boolean).join(', ')
          ) as string;

          const totalAmount = num(b.total_amount ?? b.totalamount ?? b.amount ?? b.grand_total, 0);
          // Prefer backend-computed paid/balance when available, else fall back to summed payments
          let paidTotal = (() => {
            // If balance_due is present with total, infer paid = total - balance
            const hasBalance = (b.balance_due ?? b.balance ?? b.due) != null;
            const bal = num(b.balance_due ?? b.balance ?? b.due, NaN);
            if (hasBalance && Number.isFinite(bal) && totalAmount > 0) {
              const inferred = totalAmount - bal;
              if (inferred >= 0) return inferred;
            }
            // Next, try explicit advance/paid fields
            const adv = num(b.advance_payment ?? b.advance ?? b.paid ?? b.paid_amount, 0);
            if (adv > 0) return adv;
            // Fallback to summing payment rows
            const sumRows = payments.reduce((sum:number, p:any)=> sum + num(p.amount ?? p.paid_amount ?? p.PaidAmount, 0), 0);
            return sumRows;
          })();
          if (paidTotal > totalAmount && totalAmount > 0) paidTotal = totalAmount; // clamp
          const pendingTotal = Math.max(totalAmount - paidTotal, 0);

          const startRaw: any = b.eventdate || b.event_date || b.start_time || b.start || rawDate1;
          const isDateOnly = typeof startRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(startRaw.trim());
          const startTime = isDateOnly ? '00:00' : (dateObj.toISOString().slice(11,16));

          const eventTypeId = (b.event_type_id || b.eventTypeId) ? String(b.event_type_id || b.eventTypeId) : '';
          const purpose = b.event_type_name || b.event_type || b.purpose || b.EventType || (eventTypeId ? eventTypeNameMap[eventTypeId] : '');

          return {
            id,
            hallId: finalHallId,
            hallName,
            slotId,
            eventTypeId: eventTypeId || undefined,
            customerName: custName,
            email,
            phone,
            date: dateObj,
            startTime,
            endTime: startTime,
            purpose,
            attendees: Number(b.expected_guests ?? b.attendees ?? 0) || 0,
            totalAmount,
            status: (() => {
              const raw = String(b.STATUS || b.status || b.Status || 'pending').toLowerCase();
              return raw === 'canceled' ? 'cancelled' : (raw as any);
            })(),
            // expose cancellation date for dashboard cancelled card
            cancel_date: ((): string | undefined => {
              const v = b.cancel_date || b.cancellation_date || b.cancelled_at || b.cancel_at || (b as any).cancelledAt;
              if (!v) return undefined;
              try {
                const s = String(v);
                const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
                return m ? m[1] : s.slice(0, 10);
              } catch { return undefined; }
            })(),
            notes: b.notes || b.special_requirements || '',
            createdAt: b.created_at ? new Date(b.created_at) : dateObj,
            _paidTotal: paidTotal,
            _pendingTotal: pendingTotal,
            _allDay: isDateOnly || undefined,
            _slotName: slotMeta?.name,
            _slotStart: slotMeta?.start,
            _slotEnd: slotMeta?.end,
            // keep raw primary for details modal
            ...(rawDate1 ? { eventdate_1: rawDate1 } : {}),
            ...(matchHb?.slot_id != null ? { slot_id_1: String(matchHb?.slot_id) } : {}),
            ...(hallId ? { hall_id_1: String(hallId) } : {}),
            ...(eventTypeId ? { event_type_id_1: eventTypeId } : {}),
            // surface identity fields and common aliases for the details drawer/table
            ...(custName ? { customer_name: custName } : {}),
            ...(phone ? { customer_phone: phone } : {}),
            ...(gstUnified ? { gstin: gstUnified, gst_no: gstUnified, gst_number: gstUnified } : {}),
            ...(aadhaarUnified ? { aadhaar: aadhaarUnified, aadhar_no: aadhaarUnified, aadhaar_no: aadhaarUnified } : {}),
            ...(panUnified ? { pan: panUnified, pan_no: panUnified, pancard: panUnified, pancard_no: panUnified } : {}),
            ...(addressUnified ? { address: addressUnified, customer_address: addressUnified } : {}),
            // extra for details modal
            ...(dispId ? { displayId: dispId } : {}),
            ...(services?.length ? { _services: services } : {}),
            ...(payments?.length ? { _payments: payments } : {}),
            ...(hallBookings?.length ? { _calRows: hallBookings } : {}),
          } as Booking & any;
        });

    if (!cancelled) {
  setBookings(mapped);
  // Mark complete and allow subsequent reloads
  lastBookingsKeyRef.current = null;
  __HB_INFLIGHT_BOOKINGS_KEY = null;
    }
      } catch (e) {
        console.warn('Failed to load bookings-range:', e);
  if (!cancelled) setBookings([]);
  // Clear key on failure so a retry can be attempted
  lastBookingsKeyRef.current = null;
  __HB_INFLIGHT_BOOKINGS_KEY = null;
      }
    })();
    return () => { cancelled = true; };
  }, [user, appliedFromDate, appliedToDate, appliedOnlyUpcoming, filtersReady, refreshNonce]);

  // Clear global in-flight marker on unmount to ensure future reloads when navigating back
  useEffect(() => {
    return () => { __HB_INFLIGHT_BOOKINGS_KEY = null; };
  }, []);

  // Refresh when tab becomes visible or window gains focus (helps when navigating back)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        __HB_INFLIGHT_BOOKINGS_KEY = null;
        setRefreshNonce(n => n + 1);
      }
    };
    const onFocus = () => { __HB_INFLIGHT_BOOKINGS_KEY = null; setRefreshNonce(n => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, []);

  const sortedBookings = useMemo(() => {
    const list = [...filteredBookings];
    const cmp = (a:any,b:any, key:string) => {
      const av = a, bv = b;
      let va:any, vb:any;
      switch (key) {
        case 'date': va = a.date?.getTime?.()||0; vb = b.date?.getTime?.()||0; break;
        case 'hall': va = (a.hallName||'').toLowerCase(); vb=(b.hallName||'').toLowerCase(); break;
        case 'slot': va = (a._slotName||'').toLowerCase(); vb=(b._slotName||'').toLowerCase(); break;
        case 'customer': va=(a.customerName||'').toLowerCase(); vb=(b.customerName||'').toLowerCase(); break;
        case 'amount': va=Number(a.totalAmount)||0; vb=Number(b.totalAmount)||0; break;
        case 'status': va=(a.status||'').toLowerCase(); vb=(b.status||'').toLowerCase(); break;
        default: va = 0; vb = 0;
      }
      if (va < vb) return -1; if (va > vb) return 1; return 0;
    };
    list.sort((a,b)=> (sortDir==='asc' ? cmp(a,b,sortBy) : -cmp(a,b,sortBy)));
    return list;
  }, [filteredBookings, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedBookings.length / pageSize));
  const pagedBookings = useMemo(() => {
    const start = (page-1)*pageSize;
    return sortedBookings.slice(start, start+pageSize);
  }, [sortedBookings, page, pageSize]);

  // Bookings filtered by booking date (for summary cards)
  const dateRangeBookings = useMemo(() => {
    const fromMid = appliedFromDate ? new Date(appliedFromDate.getFullYear(), appliedFromDate.getMonth(), appliedFromDate.getDate()) : null;
    const toMid = appliedToDate ? new Date(appliedToDate.getFullYear(), appliedToDate.getMonth(), appliedToDate.getDate()) : null;
    const inRange = (d: Date) => {
      const t = d.getTime();
      if (fromMid && toMid) return t >= fromMid.getTime() && t <= toMid.getTime();
      if (fromMid) return t >= fromMid.getTime();
      if (toMid) return t <= toMid.getTime();
      return true; // no range defined => include all
    };
    return bookings.filter((b) => {
      if (!b.date) return false;
      return inRange(new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate()));
    });
  }, [bookings, appliedFromDate, appliedToDate]);

  // Aggregates for cards
  // Normalize status once to ensure 'advance' and 'advanced' are treated the same.
  const normStatus = (b: Booking) => {
    const s = String((b as any).status || '').toLowerCase();
    if (s === 'canceled') return 'cancelled';
    if (s === 'advance') return 'advanced';
    return s;
  };
  // Apply current hall and status filters also to dashboard card aggregates
  const filteredForCards = useMemo(() => {
    return dateRangeBookings.filter(b => {
      // Hall filter
      if (hallListFilter && hallListFilter !== 'all' && String(b.hallId) !== String(hallListFilter)) return false;
      // Status filter: 'all' means include all, else match normalized status
      if (statusFilter && statusFilter !== 'all') {
        if (normStatus(b) !== statusFilter) return false;
      }
      return true;
    });
  }, [dateRangeBookings, hallListFilter, statusFilter]);

  const advanceCollected = useMemo(() => {
    return filteredForCards
      .filter(b => normStatus(b) !== 'cancelled' && normStatus(b) === 'advanced')
      .reduce((sum, b) => sum + (typeof (b as any)._paidTotal === 'number' ? (b as any)._paidTotal : 0), 0);
  }, [filteredForCards]);
  const pendingAmount = useMemo(() => {
    return filteredForCards
      .filter(b => normStatus(b) !== 'cancelled')
      .reduce((sum, b) => {
        const total = typeof b.totalAmount === 'number' ? b.totalAmount : 0;
        const paid = typeof b._paidTotal === 'number' ? b._paidTotal : 0;
        const pend = typeof b._pendingTotal === 'number' ? b._pendingTotal : Math.max(total - paid, 0);
        return sum + pend;
      }, 0);
  }, [filteredForCards]);
  // Payment-status counts and total revenue across date range (excluding cancelled)
  const nonCancelledRange = useMemo(() => filteredForCards.filter(b => normStatus(b) !== 'cancelled'), [filteredForCards]);
  const paymentPendingCount = useMemo(() => nonCancelledRange.filter(b => normStatus(b) === 'pending').length, [nonCancelledRange]);
  const paymentSettledCount = useMemo(() => nonCancelledRange.filter(b => normStatus(b) === 'settled').length, [nonCancelledRange]);
  const totalRevenue = useMemo(() => nonCancelledRange.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0), [nonCancelledRange]);
  // Cancelled card should be filtered by bookings.cancel_date within the selected date range (inclusive)
  const cancelledRangeBookings = useMemo(() => {
    const fromMid = appliedFromDate ? new Date(appliedFromDate.getFullYear(), appliedFromDate.getMonth(), appliedFromDate.getDate()) : null;
    const toMid = appliedToDate ? new Date(appliedToDate.getFullYear(), appliedToDate.getMonth(), appliedToDate.getDate()) : null;

    const inRange = (d: Date) => {
      const t = d.getTime();
      if (fromMid && toMid) return t >= fromMid.getTime() && t <= toMid.getTime();
      if (fromMid) return t >= fromMid.getTime();
      if (toMid) return t <= toMid.getTime();
      return true;
    };
    const toDateOnly = (val: any): Date | null => {
      if (!val) return null;
      try {
        const s = String(val);
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        const iso = m ? m[1] : s;
        const [y, mo, d] = iso.split('-').map(Number);
        if (!y || !mo || !d) return null;
        return new Date(y, mo - 1, d);
      } catch { return null; }
    };

    const isCancelledLike = (s: string) => {
      const v = String(s || '').toLowerCase();
      return v === 'cancelled' || v === 'canceled' || v === 'cancel';
    };

  return bookings.filter((b) => {
      if (!isCancelledLike((b as any).status)) return false;
      const cdate = (b as any).cancel_date || (b as any).cancellation_date || (b as any).cancelled_at || (b as any).cancel_at || (b as any).cancelledAt;
      const d = toDateOnly(cdate);
      if (!d) return false;
      const only = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return inRange(only);
    });
  }, [bookings, appliedFromDate, appliedToDate]);
  const cancelledCount = useMemo(() => cancelledRangeBookings.length, [cancelledRangeBookings]);

  // Extra aggregates to display amounts alongside counts in cards
  const totalBookingsAmount = useMemo(() => filteredForCards.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0), [filteredForCards]);
  const cancelledAmount = useMemo(() => cancelledRangeBookings.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0), [cancelledRangeBookings]);
  const settledAmount = useMemo(() => nonCancelledRange.filter(b => normStatus(b) === 'settled').reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0), [nonCancelledRange]);
  const advanceCount = useMemo(() => nonCancelledRange.filter(b => normStatus(b) === 'advanced').length, [nonCancelledRange]);

  // PAID card: includes only advance bookings (partial payments, not fully settled)
  const paidCount = useMemo(() => nonCancelledRange.filter(b => normStatus(b) === 'paid').length, [nonCancelledRange]);
  const paidAmount = useMemo(() => nonCancelledRange.filter(b => normStatus(b) === 'paid').reduce((sum, b) => sum + (Number((b as any)._paidTotal) || 0), 0), [nonCancelledRange]);

  // TOTAL should be ADVANCED + PAID + SETTLEMENT (both Qty and Amount)
  const totalCombinedQty = useMemo(() => advanceCount + paidCount + paymentSettledCount, [advanceCount, paidCount, paymentSettledCount]);
  const totalCombinedAmount = useMemo(() => advanceCollected + paidAmount + settledAmount, [advanceCollected, paidAmount, settledAmount]);

  // Check if a specific hall is available on a given date
  const isHallAvailableOnDate = (hallId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    // Prefer backend monthCal data when available
    const dayEntries = monthCal.filter(e => e.date === dateStr && (!hallId || !e.hall_id || String(e.hall_id) === String(hallId)) && String(e.status||'').toLowerCase() !== 'cancelled');
    if (dayEntries.length > 0) return false;
    // Fallback to local bookings if backend data missing
    const hallBookings = bookings.filter(
      booking => 
        booking.hallId === hallId &&
        format(booking.date, 'yyyy-MM-dd') === dateStr &&
        booking.status !== 'cancelled'
    );
    return hallBookings.length === 0;
  };

  // Return array of available slot objects (customSlots) for a given date
  const getAvailableSlotsForDate = (date: Date) => {
    if (!customSlots.length) return [];
    const dateStr = format(date, 'yyyy-MM-dd');
    // Prefer backend entries for this date
    const dayEntries = monthCal.filter(e => e.date === dateStr && String(e.status||'').toLowerCase() !== 'cancelled');
    const dayBookings = dayEntries.length
      ? dayEntries.map(e => ({
          slotId: e.slot_id,
          _allDay: true, // treat as date-only from calendar
          customerName: e.customer_name,
          phone: e.customer_phone,
          id: e.booking_id,
          hallId: e.hall_id,
          hallName: halls.find(h => String(h.id) === String(e.hall_id))?.name,
          _startHHMM: '00:00',
          startTime: '00:00',
          status: e.status?.toLowerCase?.() || 'pending',
        }))
      : bookings.filter(b => format(b.date, 'yyyy-MM-dd') === dateStr && b.status !== 'cancelled');
    const toMin = (t:string) => { const [h,m]=t.split(':').map(Number); return h*60+m; };
    const slotRanges = customSlots.map(s => {
      const start = toMin((s.start||'00:00').slice(0,5));
      let end = toMin((s.end||'23:59').slice(0,5));
      if (end <= start) end += 24*60;
      return { id: s.id, start, end, raw: s };
    });
    const bookedSlotIds = new Set<string>();
    // Apply temporary blocks from accumulated selections (same hall/date)
  const tempBlocks = (slotModalAccumulated || []).filter(e => e.date === dateStr && (!e.hallId || String(e.hallId) === String(selectedHallForCalendar === 'all' ? '' : selectedHallForCalendar)));
    tempBlocks.forEach(e => {
      if (e.fullDay) {
        customSlots.forEach(s => bookedSlotIds.add(s.id));
      } else {
        e.slotIds.forEach(id => bookedSlotIds.add(id));
      }
    });
    dayBookings.forEach(b => {
      const bb:any = b;
      if (bb._allDay) {
        // Only block all if there's no explicit slot reference.
        if (!bb.slotId) {
          customSlots.forEach(s => bookedSlotIds.add(s.id));
          return;
        }
        // Has a slotId → block only that slot
        bookedSlotIds.add(String(bb.slotId));
        return;
      }
      const bStart = toMin((bb._startHHMM||bb.startTime).slice(0,5));
  // With no separate end time, treat booking as occupying the slot whose window contains start
  const slot = slotRanges.find(sr => bStart >= sr.start && bStart < sr.end);
      if (slot) bookedSlotIds.add(slot.id);
    });
    return customSlots.filter(s => !bookedSlotIds.has(s.id));
  };

  // Return all slots with availability status for modal
  const getAllSlotsWithStatus = (date: Date) => {
    if (!customSlots.length) return [];
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayEntries = monthCal.filter(e => e.date === dateStr && String(e.status||'').toLowerCase() !== 'cancelled');
    const dayBookings = dayEntries.length
      ? dayEntries.map(e => ({
          slotId: e.slot_id,
          _allDay: true,
          customerName: e.customer_name,
          phone: e.customer_phone,
          id: e.booking_id,
          hallId: e.hall_id,
          hallName: halls.find(h => String(h.id) === String(e.hall_id))?.name,
          _startHHMM: '00:00',
          startTime: '00:00',
          status: e.status?.toLowerCase?.() || 'pending',
        }))
      : bookings.filter(b => format(b.date, 'yyyy-MM-dd') === dateStr && b.status !== 'cancelled');
    const toMin = (t:string) => { const [h,m]=t.split(':').map(Number); return h*60+m; };
    const slotRanges = customSlots.map(s => {
      const start = toMin((s.start||'00:00').slice(0,5));
      let end = toMin((s.end||'23:59').slice(0,5));
      if (end <= start) end += 24*60;
      return { id: s.id, start, end, raw: s };
    });
    const bookedBy: Record<string, {name?: string; phone?: string; bookingId?: string|number; hallId?: string; hallName?: string; temp?: boolean}> = {};
    const bookedSlotIds = new Set<string>();
    // Temp blocks from accumulated selections
  const tempBlocks = (slotModalAccumulated || []).filter(e => e.date === dateStr && (!e.hallId || String(e.hallId) === String(selectedHallForCalendar === 'all' ? '' : selectedHallForCalendar)));
    tempBlocks.forEach(e => {
      const hid = e.hallId || (selectedHallForCalendar === 'all' ? undefined : selectedHallForCalendar);
      const hname = hid ? (halls.find(h => String(h.id) === String(hid))?.name) : undefined;
      if (e.fullDay) {
        customSlots.forEach(s => { bookedSlotIds.add(s.id); bookedBy[s.id] = { temp: true, hallId: hid, hallName: hname }; });
      } else {
        e.slotIds.forEach(id => { bookedSlotIds.add(id); bookedBy[id] = { temp: true, hallId: hid, hallName: hname }; });
      }
    });
  dayBookings.forEach(b => {
      const bb:any = b;
      if (bb._allDay) {
        if (!bb.slotId) {
          customSlots.forEach(s => {
            bookedSlotIds.add(s.id);
      // capture booking info; override temp placeholders if present
      if (!bookedBy[s.id] || (bookedBy[s.id] as any).temp) bookedBy[s.id] = { name: bb.customerName, phone: bb.phone, bookingId: bb.id, hallId: bb.hallId, hallName: bb.hallName };
          });
          return;
        }
        const sid = String(bb.slotId);
        bookedSlotIds.add(sid);
    if (!bookedBy[sid] || (bookedBy[sid] as any).temp) bookedBy[sid] = { name: bb.customerName, phone: bb.phone, bookingId: bb.id, hallId: bb.hallId, hallName: bb.hallName };
        return;
      }
      const bStart = toMin((bb._startHHMM||bb.startTime).slice(0,5));
      const slot = slotRanges.find(sr => bStart >= sr.start && bStart < sr.end);
      if (slot) {
        bookedSlotIds.add(slot.id);
    if (!bookedBy[slot.id] || (bookedBy[slot.id] as any).temp) bookedBy[slot.id] = { name: bb.customerName, phone: bb.phone, bookingId: bb.id, hallId: bb.hallId, hallName: bb.hallName };
      }
    });
    return customSlots.map(s => {
      const info = bookedBy[s.id];
      // If a specific hall is selected, only show booked status for that hall; otherwise, any hall
      const matchesHall = (selectedHallForCalendar === 'all') || !info || (String(info.hallId||'') === String(selectedHallForCalendar));
      const isBooked = bookedSlotIds.has(s.id) && matchesHall;
      return {
        ...s,
        isAvailable: !isBooked,
        bookedByName: isBooked ? (info?.temp ? 'Added' : info?.name) : undefined,
        bookedByPhone: isBooked ? info?.phone : undefined,
        bookedBookingId: isBooked ? info?.bookingId : undefined,
        hallName: isBooked ? info?.hallName : undefined,
  isTempBlocked: !!(info && (info as any).temp),
      };
    });
  };

  // Get time range for period
  const getTimePeriodRange = (period: string) => {
    if (period === 'all') return null;
    // If matches a custom slot id return its start/end
    const slot = customSlots.find(s => s.id === period);
    if (slot) return { start: slot.start?.slice(0,5) || '00:00', end: slot.end?.slice(0,5) || '23:59' };
    switch (period) {
      case "morning":
        return { start: "06:00", end: "12:00" };
      case "afternoon":
        return { start: "12:00", end: "18:00" };
      case "evening":
        return { start: "18:00", end: "22:00" };
      case "night":
        return { start: "22:00", end: "06:00" };
      default:
        return null;
    }
  };

  // Check if a hall is available for a specific time period on a date
  const isHallAvailableForTimePeriod = (hallId: string, date: Date, timePeriod: string) => {
    if (timePeriod === "all") {
      return isHallAvailableOnDate(hallId, date);
    }

    const dateStr = format(date, 'yyyy-MM-dd');
    const periodRange = getTimePeriodRange(timePeriod);
    if (!periodRange) return isHallAvailableOnDate(hallId, date);

    const hallBookings = bookings.filter(
      booking => 
        booking.hallId === hallId &&
        format(booking.date, 'yyyy-MM-dd') === dateStr &&
        booking.status !== 'cancelled'
    );

    // Check if any booking overlaps with the time period
    return !hallBookings.some(booking => {
      const bb:any = booking as any;
  if (bb._allDay) {
        // If date-only but tied to a single slot, only block periods overlapping that slot window.
        if (bb.slotId) {
          const slot = customSlots.find(s => s.id === bb.slotId);
          if (!slot) return false; // unknown slot, ignore
          const toMinutes = (t:string)=>{const [H,M]=t.split(':').map(Number);return H*60+M;};
          const slotStart = toMinutes((slot.start||'00:00').slice(0,5));
          let slotEnd = toMinutes((slot.end||'23:59').slice(0,5));
          if (slotEnd <= slotStart) slotEnd += 24*60;
          const periodRange = getTimePeriodRange(timePeriod);
          if (!periodRange) return false;
          let pStart = toMinutes(periodRange.start);
          let pEnd = toMinutes(periodRange.end);
          if (timePeriod === 'night') pEnd += 24*60;
          // Overlap check between slot and period
          return !(slotEnd <= pStart || slotStart >= pEnd);
        }
        return true; // full-day, no slot
      }
      const bookingStart = bb._startHHMM || bb.startTime;
  const bookingEnd = bb.startTime; // same as start
      
      // Convert times to minutes for easier comparison
      const toMinutes = (time: string) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };

      const periodStartMinutes = toMinutes(periodRange.start);
      const periodEndMinutes = timePeriod === "night" ? 
        toMinutes(periodRange.end) + 24 * 60 : // Handle night period crossing midnight
        toMinutes(periodRange.end);
      const bookingStartMinutes = toMinutes(bookingStart);
      const bookingEndMinutes = toMinutes(bookingEnd);

      // Check for overlap
      if (timePeriod === "night") {
        // Special case for night period (22:00 to 06:00)
        return (bookingStartMinutes >= periodStartMinutes) || 
               (bookingEndMinutes <= (periodEndMinutes - 24 * 60));
      } else {
        return !(bookingEndMinutes <= periodStartMinutes || bookingStartMinutes >= periodEndMinutes);
      }
    });
  };

  // Get availability status for a date (specific hall)
  const getDateAvailability = (date: Date) => {
  const hallId = selectedHallForCalendar || (halls[0]?.id || "");
    if (!hallId) {
      return { status: 'unavailable', availableCount: 0, totalCount: 0 };
    }
    // If master slots exist, base availability on slots rather than hall count
    if (customSlots.length > 0) {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayEntries = monthCal.filter(e => e.date === dateStr && String(e.status||'').toLowerCase() !== 'cancelled' && (!hallId || !e.hall_id || String(e.hall_id) === String(hallId)));
      const dayBookings = dayEntries.length
        ? dayEntries.map(e => ({ slotId: e.slot_id, _allDay: true, _startHHMM: '00:00', startTime: '00:00' }))
        : bookings.filter(b => 
            format(b.date, 'yyyy-MM-dd') === dateStr && 
            b.status !== 'cancelled' && 
            String((b as any).hallId) === String(hallId)
          );
      const toMin = (t:string) => { const [h,m]=t.split(':').map(Number); return h*60+m; };
      // Pre-compute slot ranges
      const slotRanges = customSlots.map(s => {
        const start = toMin((s.start||'00:00').slice(0,5));
        let end = toMin((s.end||'23:59').slice(0,5));
        const crosses = end <= start;
        if (crosses) end += 24*60; // normalize
        return { id: s.id, start, end, raw: s };
      });
      const bookedSlotIds = new Set<string>();
      // Temp blocks from accumulated selections on this date & hall
  const tempBlocks = (slotModalAccumulated || []).filter(e => e.date === dateStr && (!e.hallId || String(e.hallId) === String(hallId)));
      tempBlocks.forEach(e => {
        if (e.fullDay) {
          customSlots.forEach(s => bookedSlotIds.add(s.id));
        } else {
          e.slotIds.forEach(id => bookedSlotIds.add(id));
        }
      });
  dayBookings.forEach(b => {
        const bb:any = b;
        // Find first slot whose window contains booking start (point-in-time)
        if (bb._allDay) {
          if (!bb.slotId) {
            customSlots.forEach(s => bookedSlotIds.add(s.id));
          } else {
            bookedSlotIds.add(String(bb.slotId));
          }
        } else {
          const bStart = toMin((bb._startHHMM||bb.startTime).slice(0,5));
          const slot = slotRanges.find(sr => bStart >= sr.start && bStart < sr.end);
          if (slot) bookedSlotIds.add(slot.id);
        }
      });
      const totalSlots = customSlots.length;
      const bookedCount = bookedSlotIds.size;
      const availableCount = Math.max(totalSlots - bookedCount, 0);
      const filteredSlots = selectedTimePeriod === 'all' ? customSlots : customSlots.filter(s => s.id === selectedTimePeriod);
      const filteredTotalSlots = filteredSlots.length;
      const filteredBookedCount = filteredSlots.filter(s => bookedSlotIds.has(s.id)).length;
      const filteredAvailableCount = Math.max(filteredTotalSlots - filteredBookedCount, 0);
      return {
        status: filteredAvailableCount === filteredTotalSlots ? 'fully-available' : (filteredAvailableCount === 0 ? 'unavailable' : 'partially-available'),
        availableCount: filteredAvailableCount,
        totalCount: filteredTotalSlots
      };
    }
    // Check specific hall for the selected time period
    const isAvailable = isHallAvailableForTimePeriod(hallId, date, selectedTimePeriod);
    return {
      status: isAvailable ? 'fully-available' : 'unavailable',
      availableCount: isAvailable ? 1 : 0,
      totalCount: 1
    };
  };

  // Generate calendar days for the current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [calendarMonth, bookings, halls, selectedHallForCalendar, selectedTimePeriod]);

  const handleEdit = (booking: Booking) => {
    // Navigate to create booking page with booking data for editing
    const searchParams = new URLSearchParams();
    searchParams.set('date', format(booking.date, 'yyyy-MM-dd'));
    searchParams.set('hallId', booking.hallId);
  searchParams.set('hallName', booking.hallName);
  // Pass slotId so the edit form can preselect the Event Slot
  if (booking.slotId) searchParams.set('slotId', booking.slotId);
  // Pass eventTypeId to preselect Event Type reliably
  if (booking.eventTypeId) searchParams.set('eventTypeId', booking.eventTypeId);
  // Legacy secondary fields removed: no date2/slotId2/eventTypeId2/attendees2
  // Include current booking status so edit view can be read-only when cancelled
  if (booking.status) searchParams.set('status', booking.status);
    searchParams.set('customerName', booking.customerName);
    searchParams.set('email', booking.email);
    searchParams.set('phone', booking.phone);
    searchParams.set('startTime', booking.startTime);
    searchParams.set('endTime', booking.endTime);
    searchParams.set('purpose', booking.purpose);
    searchParams.set('attendees', booking.attendees.toString());
    searchParams.set('notes', booking.notes);
  // Use the display Booking ID (e.g., INV-1) when available so edit flow sends correct booking_id
  const eid = (booking as any).displayId || booking.id;
  searchParams.set('editId', String(eid));
    navigate(`/create-booking?${searchParams.toString()}`);
  };

  const handlePrintInvoice = (booking: Booking) => {
  const bid = (booking as any).displayId || booking.id;
  navigate(`/invoice/${bid}`);
  };

  const handlePrintAdvanceReceipt = (booking: Booking) => {
    const total = Number(booking.totalAmount) || 0;
    const paid = Number((booking as any)._paidTotal) || 0;
    const pending = Math.max(total - paid, 0);
    if (paid <= 0) {
      alert("No advance amount collected for this booking.");
      return;
    }
    const bookingId = (booking as any).displayId || booking.id;
    const customerName = booking.customerName || "";
    const phone = booking.phone || "";
    const email = (booking as any).email || "";
    const eventDate = format(booking.date, "MMM dd, yyyy");
    const eventTime = booking._allDay ? "All Day" : `${booking.startTime} - ${booking.endTime}`;
    const hall = booking.hallName || "-";
    const guests = Number((booking as any).attendees || 0) || 0;
    const eventType = (booking as any).purpose || "-";
    const printedAt = format(new Date(), "MMM dd, yyyy • hh:mm a");

  const fmt = (n:number) => `₹${Number(n||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const payments: any[] = (booking as any)._payments || [];
    const paymentRows = payments.map((p:any, idx:number) => {
      const amt = Number(p.amount || p.paid_amount || 0) || 0;
      const modeId = String(p.payment_mode_id || p.mode_id || p.mode || p.payment_mode || '');
      const mode = paymentModeNameMap[modeId] || String(p.payment_mode || p.mode || p.PaymentMode || "Other");
      const d = p.created_at || p.payment_date || p.createdon || p.date || p.PaymentDate || p.createdAt;
      let ds = '';
      try { ds = d ? format(new Date(d), 'MMM dd, yyyy • hh:mm a') : ''; } catch { ds = ''; }
      // Build row-specific Receipt ID from bookingId and a best-effort payment identifier
      const payIdPart = String(
        p.id || p.payment_id || p.PaymentID || p.receipt_id || p.ReceiptID || p.receipt_no || p.ReceiptNo || p.pk || p.PaymentNo || (idx+1)
      );
      const rowReceiptId = `${bookingId}A${payIdPart}`;
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${idx+1}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${mode}${ds ? `<div style=\"color:#64748b;font-size:12px\">${ds}</div>`:''}<div style=\"color:#64748b;font-size:12px\">Receipt ID: ${rowReceiptId}</div></td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmt(amt)}</td>
      </tr>`;
    }).join('');

  const orgName = (user as any)?.company_name || (user as any)?.org_name || '';
  const orgCode = (user as any)?.retail_code || (user as any)?.account_code || '';
  const addr1 = (user as any)?.address || (user as any)?.org_address || '';
  const orgPhone = (user as any)?.mobile || (user as any)?.phone || (user as any)?.org_phone || '';
  const gstin = (user as any)?.gstin || (user as any)?.gst || (user as any)?.org_gstin || '';

  // Pull seller details from session retail_master for the From card
  let retailMaster: any = null;
  try {
    const raw = sessionStorage.getItem('retail_master');
    retailMaster = raw ? JSON.parse(raw) : null;
  } catch {}
  const pick = (obj: any, keys: string[], fallback?: any) => {
    if (!obj) return fallback;
    const map = new Map<string, string>();
    Object.keys(obj).forEach((k) => map.set(k.toLowerCase(), k));
    for (const k of keys) {
      const ak = map.get(k.toLowerCase());
      if (ak != null && obj[ak] != null && String(obj[ak]) !== '') return obj[ak];
    }
    return fallback;
  };
  const sellerName = pick(retailMaster, ['retail_name','name','company_name','org_name','retailname'], orgName) || '';
  const sA1 = pick(retailMaster, ['address','address1','address_line1','addr1','line1'], '');
  const sA2 = pick(retailMaster, ['address2','address_line2','addr2','line2'], '');
  const sCity = pick(retailMaster, ['city','city_name'], '');
  const sState = pick(retailMaster, ['state_name','state'], '');
  const sPin = pick(retailMaster, ['pincode','pin','zip','zipcode'], '');
  const sellerAddress = [sA1, sA2, [sCity, sState, sPin].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const sellerGST = pick(retailMaster, ['gstin','gst_no','gst','gst_number','org_gstin'], gstin) || '';

  // Build Receipt ID as bookingId + 'A' + <latest payment id or count>
  const latestPayment = (payments && payments.length) ? payments[payments.length - 1] : undefined;
  let payIdPart = '';
  if (latestPayment) {
    payIdPart = String(
      latestPayment.id ||
      latestPayment.payment_id ||
      latestPayment.PaymentID ||
      latestPayment.receipt_id ||
      latestPayment.ReceiptID ||
      latestPayment.receipt_no ||
      latestPayment.ReceiptNo ||
      latestPayment.pk ||
      latestPayment.PaymentNo ||
      ''
    );
  }
  if (!payIdPart) {
    // Fallback to number of payments (or 1 if none) to always show a non-empty suffix
    payIdPart = String((payments && payments.length) ? payments.length : 1);
  }
  const receiptId = `${bookingId}A${payIdPart}`;

    const html = `<!doctype html>
    <html>
      <head>
        <meta charset=\"utf-8\" />
        <title>Advance Receipt - ${bookingId}</title>
        <style>
          :root { --ink:#0f172a; --muted:#64748b; --line:#e5e7eb; --brand:#1e293b; }
          * { box-sizing: border-box; }
          body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:var(--ink); margin: 24px; }
          .wrap { max-width: 860px; margin:0 auto; }
          .header { text-align:center; margin:0 0 8px; }
          .header .name { font-weight:700; }
          .header .sub { color:var(--muted); font-size:12px; }
          .title { text-align:center; margin:16px 0 8px; font-size:18px; letter-spacing:.06em; font-weight:700; }
          .grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
          .card { border:1px solid var(--line); border-radius:8px; padding:12px; }
          .label { color:var(--muted); font-size:12px; }
          .value { font-weight:600; }
          table { width:100%; border-collapse:collapse; margin-top:8px; }
          th { text-align:left; font-size:12px; color:var(--muted); padding:8px; border-bottom:1px solid var(--line); }
          td { font-size:14px; }
          .totals { margin-top:8px; }
          .totals .row { display:flex; justify-content:space-between; padding:6px 0; border-top:1px dashed var(--line); }
          .totals .row strong { font-size:15px; }
          .footnote { color:var(--muted); font-size:12px; margin-top:12px; }
          @media print { body { margin:0; } .wrap { max-width:none; } }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="header">
            <div class="name">${orgName}</div>
            ${(addr1 || gstin || orgPhone) ? `<div class="sub">${[addr1, (gstin?`GSTIN: ${gstin}`:''), (orgPhone?`Phone: ${orgPhone}`:'')].filter(Boolean).join(' | ')}</div>`:''}
          </div>
          <div class="title">ADVANCE RECEIPT</div>

          <div class="grid">
            <div class="card">
              <div class="label">Booking ID</div>
              <div class="value">${bookingId}</div>
              <div class="label" style="margin-top:8px">Event Date</div>
              <div class="value">${eventDate} • ${eventTime}</div>
              <div class="label" style="margin-top:8px">Hall</div>
              <div class="value">${hall}</div>
            </div>
            <div class="card">
              <div class="label">Customer</div>
              <div class="value">${customerName}</div>
              <div class="label" style="margin-top:8px">Phone / Email</div>
              <div class="value">${phone || '-'}${email ? ' • '+email : ''}</div>
              <div class="label" style="margin-top:8px">Receipt ID</div>
              <div class="value">${receiptId}</div>
            </div>
            <div class="card">
              <div class="label">From</div>
              <div class="value">${sellerName || '-'}</div>
              ${sellerAddress ? `<div style="color:#64748b;font-size:12px;margin-top:4px">${sellerAddress}</div>` : ''}
              ${sellerGST ? `<div style="color:#64748b;font-size:12px;margin-top:4px">GSTIN: ${sellerGST}</div>`:''}
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <div class="label">Payments Received</div>
            <table>
              <thead>
                <tr><th style="width:64px;">#</th><th>Mode / Date</th><th style="text-align:right;">Amount</th></tr>
              </thead>
              <tbody>
                ${paymentRows || `<tr><td colspan=\"3\" style=\"padding:10px;color:#64748b\">No payment records available.</td></tr>`}
              </tbody>
            </table>
            <div class="totals">
              <div class="row"><span>Total Amount</span><strong>${fmt(total)}</strong></div>
              <div class="row"><span>Advance Paid</span><span>${fmt(paid)}</span></div>
              <div class="row"><span>Pending Balance</span><span>${fmt(pending)}</span></div>
            </div>
          </div>

          <div class="footnote">This receipt acknowledges the advance received against the above booking. A final invoice will be issued upon completion/settlement.</div>
        </div>
        <script>window.onload = function(){ setTimeout(function(){ window.print(); window.close(); }, 200); };</script>
      </body>
    </html>`;

    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const handleDelete = (id: string) => {
    setBookings((prev) => prev.filter((booking) => booking.id !== id));
  };

  const updateBookingStatus = (id: string, status: Booking["status"]) => {
    setBookings((prev) =>
      prev.map((booking) =>
        booking.id === id ? { ...booking, status } : booking,
      ),
    );
  };

  // -------- Reports (Excel) --------
  const buildEventTypeAndDetails = (b: any) => {
    const eventTypeLabel = (() => {
      const rawFromBooking = b.purpose || b.event_type_name || b.event_type;
      if (rawFromBooking && String(rawFromBooking).trim()) return String(rawFromBooking);
      const ids = [b.eventTypeId, b.event_type_id_1, b.event_type_id]
        .map((x: any) => (x != null ? String(x) : ""))
        .filter(Boolean);
      for (const id of ids) {
        const name = (eventTypeNameMap as any)[id];
        if (name) return String(name);
      }
      const calRows2: any[] = b._calRows || [];
      if (Array.isArray(calRows2)) {
        for (const hb of calRows2) {
          const n = hb?.event_type_name || hb?.event_type;
          if (n && String(n).trim()) return String(n);
          const hid = hb?.event_type_id != null ? String(hb.event_type_id) : "";
          if (hid && (eventTypeNameMap as any)[hid]) return String((eventTypeNameMap as any)[hid]);
        }
      }
      return "-";
    })();

    const slotMetaLookup: Record<string, { name: string; start: string; end: string }> = {};
    try {
      (customSlots || []).forEach((s) => {
        const id = String((s as any).id);
        if (id) slotMetaLookup[id] = { name: (s as any).name, start: (s as any).start, end: (s as any).end };
      });
    } catch {}
    const calRows: any[] = b._calRows || [];
    const scheduleParts: string[] = [];
    if (Array.isArray(calRows) && calRows.length) {
      calRows.forEach((hb: any) => {
        const dRaw = hb?.eventdate || hb?.event_date || hb?.date;
        let dStr = "";
        try {
          dStr = dRaw ? format(new Date(dRaw), "yyyy-MM-dd") : "";
        } catch {
          dStr = "";
        }
        const sid = String(hb?.slot_id ?? hb?.slot ?? hb?.slotId ?? "");
        const sm = sid ? slotMetaLookup[sid] : undefined;
        const slotStr = sm ? `${sm.name} (${sm.start}${sm.end && sm.end !== sm.start ? `-${sm.end}` : ""})` : "";
        const part = [dStr, slotStr].filter(Boolean).join(" ");
        if (part) scheduleParts.push(part);
      });
    } else {
      const slotStr = b._slotName
        ? `${b._slotName}${b._slotStart ? ` (${b._slotStart}${b._slotEnd && b._slotEnd !== b._slotStart ? `-${b._slotEnd}` : ""})` : ""}`
        : "";
      const dStr = b?.date ? format(b.date, "yyyy-MM-dd") : "";
      const part = [dStr, slotStr].filter(Boolean).join(" ");
      if (part) scheduleParts.push(part);
    }
    const detailsParts: string[] = [];
    if (eventTypeLabel && eventTypeLabel !== "-") detailsParts.push(eventTypeLabel);
    if (scheduleParts.length) detailsParts.push(scheduleParts.join(" | "));
    const eventDetails = detailsParts.join(" | ");
    return { eventTypeLabel, eventDetails };
  };

  const exportAppointmentListExcel = () => {
    const rows = filteredBookings.map((b) => {
      const total = Number(b.totalAmount) || 0;
      const paid = Number((b as any)._paidTotal || 0) || 0;
      const pending = Math.max(total - paid, 0);
      const payRows: any[] = (b as any)._payments || [];
      const details = payRows
        .map((p: any) => {
          const modeId = String(p.payment_mode_id || p.mode_id || p.mode || p.payment_mode || p.PaymentMode || "");
          const mode = (paymentModeNameMap as any)[modeId] || String(p.payment_mode || p.mode || p.PaymentMode || "Other");
          const amt = Number(p.amount || p.paid_amount || 0) || 0;
          const d = p.created_at || p.payment_date || p.createdon || p.date || p.PaymentDate || p.createdAt;
          let ds = "";
          try {
            ds = d ? format(new Date(d), "yyyy-MM-dd HH:mm") : "";
          } catch {
            ds = "";
          }
          return `${mode}: ₹${amt.toLocaleString("en-IN")} ${ds ? `(${ds})` : ""}`.trim();
        })
        .join(" | ");

      const { eventTypeLabel, eventDetails } = buildEventTypeAndDetails(b as any);
      const paymentStatus = derivePaymentStatus(b as any);

      return {
        date: b.date,
        time: (b as any)._allDay ? "All Day" : `${b.startTime} - ${b.endTime}`,
        hall: (b as any).hallName || "-",
        slot: (b as any)._slotName || "-",
        slot_time: (b as any)._slotStart ? `${(b as any)._slotStart}${(b as any)._slotEnd && (b as any)._slotEnd !== (b as any)._slotStart ? ` - ${(b as any)._slotEnd}` : ""}` : "-",
        customer: b.customerName || "-",
        phone: (b as any).phone || "-",
        booking_id: (b as any).displayId || (b as any).id,
        event_type: eventTypeLabel,
        event_details: eventDetails || "-",
        advance_amount: paid,
        pending_amount: pending,
        total_amount: total,
        payment_status: paymentStatus,
        booking_status: (b as any).status || "-",
        payment_details: details || "-",
      };
    });

    exportData("excel", {
      filename: `appointments-list-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Appointment List",
      columns: [
        { header: "Date", dataKey: "date", width: 14 },
        { header: "Time", dataKey: "time", width: 14 },
        { header: "Hall", dataKey: "hall", width: 16 },
        { header: "Slot", dataKey: "slot", width: 14 },
        { header: "Slot Time", dataKey: "slot_time", width: 14 },
        { header: "Customer", dataKey: "customer", width: 22 },
        { header: "Phone", dataKey: "phone", width: 16 },
        { header: "Booking ID", dataKey: "booking_id", width: 16 },
        { header: "Event Type", dataKey: "event_type", width: 18 },
        { header: "Event Details", dataKey: "event_details", width: 28 },
        { header: "Advance", dataKey: "advance_amount", width: 12 },
        { header: "Pending", dataKey: "pending_amount", width: 12 },
        { header: "Amount", dataKey: "total_amount", width: 12 },
        { header: "Payment Status", dataKey: "payment_status", width: 14 },
        { header: "Booking Status", dataKey: "booking_status", width: 14 },
        { header: "Payment Details", dataKey: "payment_details", width: 34 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportDailySummaryExcel = () => {
    const map = new Map<string, { date: Date; qty: number; advance_amount: number; pending_amount: number; total_amount: number }>();
    filteredBookings.forEach((b) => {
      const key = format(b.date, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, { date: new Date(b.date), qty: 0, advance_amount: 0, pending_amount: 0, total_amount: 0 });
      const rec = map.get(key)!;
      const total = Number(b.totalAmount) || 0;
      const paid = Number((b as any)._paidTotal || 0) || 0;
      const pending = Math.max(total - paid, 0);
      rec.qty += 1;
      rec.advance_amount += paid;
      rec.pending_amount += pending;
      rec.total_amount += total;
    });
    const rows = Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    exportData("excel", {
      filename: `appointments-daily-summary-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Daily Summary",
      columns: [
        { header: "Date", dataKey: "date", width: 14 },
        { header: "Appointments", dataKey: "qty", width: 14 },
        { header: "Advance", dataKey: "advance_amount", width: 14 },
        { header: "Pending", dataKey: "pending_amount", width: 14 },
        { header: "Total Amount", dataKey: "total_amount", width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportHallSummaryExcel = () => {
    const map = new Map<string, { hall: string; qty: number; total_amount: number }>();
    filteredBookings.forEach((b) => {
      const hall = (b as any).hallName || "-";
      if (!map.has(hall)) map.set(hall, { hall, qty: 0, total_amount: 0 });
      const rec = map.get(hall)!;
      rec.qty += 1;
      rec.total_amount += Number(b.totalAmount) || 0;
    });
    const rows = Array.from(map.values()).sort((a, b) => b.total_amount - a.total_amount);
    exportData("excel", {
      filename: `appointments-hall-summary-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Hall-wise Summary",
      columns: [
        { header: "Hall", dataKey: "hall", width: 22 },
        { header: "Appointments", dataKey: "qty", width: 14 },
        { header: "Total Amount", dataKey: "total_amount", width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportPaymentStatusSummaryExcel = () => {
    const buckets: Record<string, { status: string; qty: number; total_amount: number }> = {
      pending: { status: "Pending", qty: 0, total_amount: 0 },
      advance: { status: "Advanced", qty: 0, total_amount: 0 },
      paid: { status: "Paid", qty: 0, total_amount: 0 },
      settled: { status: "Settled", qty: 0, total_amount: 0 },
    };
    filteredBookings.forEach((b) => {
      const s = derivePaymentStatus(b as any);
      const rec = buckets[s];
      if (!rec) return;
      rec.qty += 1;
      rec.total_amount += Number(b.totalAmount) || 0;
    });
    const rows = Object.values(buckets);
    exportData("excel", {
      filename: `appointments-payment-summary-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Payment Status Summary",
      columns: [
        { header: "Payment Status", dataKey: "status", width: 18 },
        { header: "Appointments", dataKey: "qty", width: 14 },
        { header: "Total Amount", dataKey: "total_amount", width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportCustomerContactsExcel = () => {
    const map = new Map<string, { customer: string; phone: string; bookings: number; total_amount: number }>();
    filteredBookings.forEach((b) => {
      const name = (b as any).customerName || "-";
      const phone = (b as any).phone || "-";
      const key = `${name}|${phone}`;
      if (!map.has(key)) map.set(key, { customer: name, phone, bookings: 0, total_amount: 0 });
      const rec = map.get(key)!;
      rec.bookings += 1;
      rec.total_amount += Number(b.totalAmount) || 0;
    });
    const rows = Array.from(map.values()).sort((a, b) => b.total_amount - a.total_amount);
    exportData("excel", {
      filename: `appointments-contacts-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Customer Contact List",
      columns: [
        { header: "Customer", dataKey: "customer", width: 26 },
        { header: "Phone", dataKey: "phone", width: 18 },
        { header: "Bookings", dataKey: "bookings", width: 12 },
        { header: "Total Amount", dataKey: "total_amount", width: 16 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const getStatusColor = (status: Booking["status"]) => {
    switch (status) {
      case "confirmed":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      case "completed":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: Booking["status"]) => {
    switch (status) {
      case "confirmed":
        return <CheckCircle className="h-4 w-4" />;
      case "pending":
        return <AlertCircle className="h-4 w-4" />;
      case "cancelled":
        return <XCircle className="h-4 w-4" />;
      case "completed":
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  // Payment status helpers (Pending / Advance / Paid / Settled)
  type PaymentStatus = 'pending' | 'advance' | 'paid' | 'settled';
  function derivePaymentStatus(b: Booking): PaymentStatus {
    // Prefer backend-declared status when provided to avoid mismatches
    const raw = String((b as any).status || '').toLowerCase();
    const normalized = raw === 'canceled' ? 'cancelled' : (raw === 'advance' ? 'advanced' : raw);
    if (normalized === 'pending') return 'pending';
    if (normalized === 'advanced') return 'advance';
    if (normalized === 'paid') return 'paid';
    if (normalized === 'settled') return 'settled';

    // Fallback to inferring from amounts
    const total = Number(b.totalAmount) || 0;
    const paid = Number((b as any)._paidTotal || 0) || 0;
    if (paid <= 0) return 'pending';
    if (paid < total) return 'advance';
    if (paid >= total && total > 0) return 'paid';
    return 'settled';
  }
  const getPaymentStatusColor = (status: PaymentStatus) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'advance':
        return 'bg-blue-100 text-blue-800';
      case 'paid':
        return 'bg-emerald-100 text-emerald-800';
      case 'settled':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };
  // Keep hover style identical to base color for status badges (no color change on hover)
  const getPaymentStatusHoverColor = (status: PaymentStatus) => {
    switch (status) {
      case 'pending':
        return 'hover:bg-yellow-100 hover:text-yellow-800';
      case 'advance':
        return 'hover:bg-blue-100 hover:text-blue-800';
      case 'paid':
        return 'hover:bg-emerald-100 hover:text-emerald-800';
      case 'settled':
        return 'hover:bg-green-100 hover:text-green-800';
      default:
        return 'hover:bg-gray-100 hover:text-gray-800';
    }
  };
  const getPaymentStatusIcon = (status: PaymentStatus) => {
    switch (status) {
      case 'pending':
        return <AlertCircle className="h-4 w-4" />;
      case 'advance':
  return <IndianRupee className="h-4 w-4" />;
      case 'paid':
        return <CheckCircle className="h-4 w-4" />;
      case 'settled':
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const handleSettle = (booking: Booking) => {
    // Mark as settled locally by setting paid to total and pending to 0
    setBookings(prev => prev.map(b => {
      if (b.id !== booking.id) return b;
      const total = Number(b.totalAmount) || 0;
      return { ...b, _paidTotal: total, _pendingTotal: 0 } as any;
    }));
  };

  // Load filters from sessionStorage on mount
  useEffect(() => {
    const savedFromDate = sessionStorage.getItem('fromDate');
    const savedToDate = sessionStorage.getItem('toDate');
    const savedRangePreset = sessionStorage.getItem('rangePreset');
    const savedOnlyUpcoming = sessionStorage.getItem('onlyUpcoming');
    const savedSelectedHall = sessionStorage.getItem('selectedHallForCalendar');
    const savedSelectedTimePeriod = sessionStorage.getItem('selectedTimePeriod');
  const savedShowCalendar = sessionStorage.getItem('showCalendar');
  const savedShowDashboard = sessionStorage.getItem('showDashboard');
  const savedStatusFilter = sessionStorage.getItem('statusFilter');
  const savedHallListFilter = sessionStorage.getItem('hallListFilter');
  // Dual Slot feature removed

    if (savedFromDate) setFromDate(new Date(savedFromDate));
    if (savedToDate && savedToDate !== '') {
      setToDate(new Date(savedToDate));
    } else {
      // Default toDate to match fromDate (or today) when nothing saved; Upcoming mode will override below
      const baseFrom = savedFromDate ? new Date(savedFromDate) : today;
      setToDate(baseFrom);
    }
    if (savedRangePreset) setRangePreset(savedRangePreset as 'today' | 'thisWeek' | 'custom');

    if (savedOnlyUpcoming) {
      const upcoming = savedOnlyUpcoming === 'true';
      setOnlyUpcoming(upcoming);
  if (upcoming) {
        // Ensure Upcoming uses open-ended range: from today onwards
        const now = new Date();
        const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (!savedFromDate) setFromDate(mid);
        setToDate(undefined);
        // Visually de-highlight Today/This Week if not already
        setRangePreset('custom');
      }
    }
    if (savedSelectedHall) setSelectedHallForCalendar(savedSelectedHall);
    if (savedSelectedTimePeriod) setSelectedTimePeriod(savedSelectedTimePeriod);
    if (savedShowCalendar) setShowCalendar(savedShowCalendar === 'true');
  if (savedShowDashboard) setShowDashboard(savedShowDashboard === 'true');
    if (savedStatusFilter) setStatusFilter(savedStatusFilter);
  if (savedHallListFilter) setHallListFilter(savedHallListFilter);
  // Dual Slot feature removed
  // Initialize applied states from the current visible inputs
  setAppliedFromDate(prev => savedFromDate ? new Date(savedFromDate) : fromDate);
  setAppliedToDate(prev => (savedOnlyUpcoming === 'true') ? undefined : (savedToDate && savedToDate !== '' ? new Date(savedToDate) : (fromDate || today)));
  setAppliedOnlyUpcoming(savedOnlyUpcoming === 'true');
  setFiltersReady(true);
  }, []);

  // Save filters to sessionStorage whenever they change
  useEffect(() => {
    sessionStorage.setItem('fromDate', fromDate ? fromDate.toISOString() : '');
    sessionStorage.setItem('toDate', toDate ? toDate.toISOString() : '');
    sessionStorage.setItem('rangePreset', rangePreset);
    sessionStorage.setItem('onlyUpcoming', String(onlyUpcoming));
    sessionStorage.setItem('selectedHallForCalendar', selectedHallForCalendar);
    sessionStorage.setItem('selectedTimePeriod', selectedTimePeriod);
    sessionStorage.setItem('showCalendar', String(showCalendar));
    sessionStorage.setItem('showDashboard', String(showDashboard));
    sessionStorage.setItem('statusFilter', statusFilter);
    sessionStorage.setItem('hallListFilter', hallListFilter);
  }, [fromDate, toDate, rangePreset, onlyUpcoming, selectedHallForCalendar, selectedTimePeriod, showCalendar, statusFilter, hallListFilter, showDashboard]);

  // Persist applied states too (optional but helpful across reloads)
  useEffect(() => {
    sessionStorage.setItem('appliedFromDate', appliedFromDate ? appliedFromDate.toISOString() : '');
    sessionStorage.setItem('appliedToDate', appliedToDate ? appliedToDate.toISOString() : '');
    sessionStorage.setItem('appliedOnlyUpcoming', String(appliedOnlyUpcoming));
  }, [appliedFromDate, appliedToDate, appliedOnlyUpcoming]);

  // Dual Slot feature removed

  // Mutually exclusive quick range selections
useEffect(() => {
  // If Upcoming is on, clear highlight from Today/This Week
  if (onlyUpcoming && (rangePreset === 'today' || rangePreset === 'thisWeek')) {
    setRangePreset('custom');
  }
}, [onlyUpcoming, rangePreset]);

  return (
    <div className="space-y-4 p-4">
      {/* Header removed to bring calendar higher */}

  {/* Stats Cards moved to bottom */}

      {/* Real-time Availability Calendar */}
  {showCalendar && (
  <div className="mx-auto w-full max-w-[1100px] md:max-w-[1200px]">
  <Card className={cn('border-2 transition-colors shadow-sm', hallBorderClass)}>
        <CardHeader className="py-3 px-4">
          {/* Professional, modern toolbar for Hall Availability Calendar */}
          <div className="flex items-center flex-nowrap gap-2 md:gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-2 w-full overflow-x-auto whitespace-nowrap pr-2">
            <CardTitle className="text-lg flex items-center font-bold text-slate-800 mr-2">
              <CalendarDays className="h-5 w-5 mr-2 text-blue-600" />
              Calendar
            </CardTitle>
            <Button
              variant="outline"
              size="icon"
              className="rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100"
              onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* Year selector */}
            <Select value={String(calendarMonth.getFullYear())} onValueChange={(y) => setCalendarMonth(new Date(Number(y), calendarMonth.getMonth(), 1))}>
              <SelectTrigger className="w-[4.8rem] rounded-lg border-slate-200 bg-white text-base font-medium shrink">
                <SelectValue placeholder={String(calendarMonth.getFullYear())} />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Month selector (wider) */}
            <Select value={String(calendarMonth.getMonth())} onValueChange={(m) => setCalendarMonth(new Date(calendarMonth.getFullYear(), Number(m), 1))}>
              <SelectTrigger className="min-w-[7.5rem] w-auto rounded-lg border-slate-200 bg-white text-base font-medium px-3 shrink">
                <SelectValue placeholder={format(calendarMonth, "MMMM")} />
              </SelectTrigger>
              <SelectContent>
                {monthNames.map((nm, idx) => (
                  <SelectItem key={nm} value={String(idx)}>{nm}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-4 font-medium text-sm ml-1 bg-white border border-slate-200 text-slate-800 shadow-none"
              onClick={() => setCalendarMonth(new Date())}
              title="Jump to current month"
            >
              Today
            </Button>
            {/* Dual Slot toggle removed */}
            <Select value={selectedHallForCalendar} onValueChange={setSelectedHallForCalendar}>
              <SelectTrigger
                aria-label="Select Hall"
                className="min-w-[8.5rem] w-auto rounded-lg px-3 shrink text-base font-medium bg-white text-slate-800 border-slate-200 hover:bg-slate-50 focus:outline-none"
              >
                <SelectValue placeholder="Select Hall" />
              </SelectTrigger>
              <SelectContent>
                {halls.filter(hall => hall.isActive).map((hall) => (
                  <SelectItem key={hall.id} value={hall.id}>
                    {hall.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Time period selector */}
            <Select value={selectedTimePeriod} onValueChange={setSelectedTimePeriod}>
              <SelectTrigger className="min-w-[6.5rem] w-auto rounded-lg border-slate-200 bg-white text-base font-medium px-3 shrink">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Day</SelectItem>
                {customSlots.length > 0 ? (
                  customSlots.map(s => {
                    const start = s.start?.slice(0,5) || '00:00';
                    const end = s.end?.slice(0,5) || '23:59';
                    return (
                      <SelectItem key={s.id} value={s.id}>{`${s.name} (${start} - ${end})`}</SelectItem>
                    );
                  })
                ) : (
                  <>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="afternoon">Afternoon</SelectItem>
                    <SelectItem value="evening">Evening</SelectItem>
                    <SelectItem value="night">Night</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            {/* Muhurtham Dates trigger */}
            <Button
              variant="outline"
              size="sm"
              onClick={()=> setShowMuhurthamModal(true)}
              className="rounded-full border-rose-300/70 bg-rose-50/60 hover:bg-rose-100 text-rose-700 font-medium flex items-center gap-1 px-4 shadow-none"
              title="View full list of Muhurtham (auspicious) dates"
            >
              <Star className="h-4 w-4 fill-rose-400 text-rose-500" />
              Muhurtham Dates
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-lg border-slate-300 bg-slate-50 hover:bg-slate-100"
              onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {/* Toolbar moved to header above to keep a single straight line */}

          {/* Calendar Grid */}
      <div className="space-y-3">
            {/* Days of week header (wrapped for horizontal scroll on small screens) */}
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
        <div key={day} className="p-1.5 text-center text-xs font-medium text-gray-500">
                  {day}
                </div>
              ))}
                </div>

                {/* Calendar days */}
                <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, index) => {
                const availability = getDateAvailability(day);
                const isCurrentMonth = isSameMonth(day, calendarMonth);
                const isToday = isSameDay(day, new Date());
                const isPast = day < new Date() && !isToday;
                const tamil = isCurrentMonth ? getTamilDate(day) : null;
                const muhurtham = isCurrentMonth ? getMuhurthamMarker(day) : null;
                const isSelected = !!(selectedDate && isSameDay(day, selectedDate));
                // Hover list removed
                // Dual-slot: mark first selection on this date as blocked for second selection
                // Dual Slot removed

                return (
                  <div
                    key={index}
                    className={cn(
                      "group relative p-2 h-24 sm:h-20 border rounded-lg transition-all",
                      {
                        // Outside-month cells: show subtle placeholders (no hover/actions)
                        "bg-slate-50 border-slate-100 text-transparent cursor-default hover:shadow-none": !isCurrentMonth,
                        // Past days within current month
                        "bg-gray-50 text-gray-400 cursor-not-allowed": isCurrentMonth && isPast,
                        // Interactive current-month days
                        "bg-white hover:bg-blue-100": isCurrentMonth && !isPast,
                        "cursor-pointer": isCurrentMonth && !isPast,
                        // Highlight states
                        "ring-2 ring-blue-500": isToday || isSelected,
                        "opacity-50": isPast,
                        // Availability backgrounds
                        "bg-green-50 border-green-200 hover:bg-green-200": isCurrentMonth && availability.status === 'fully-available' && !isPast,
                        "bg-yellow-50 border-yellow-200 hover:bg-yellow-200": isCurrentMonth && availability.status === 'partially-available' && !isPast,
                        "bg-red-50 border-red-200 hover:bg-red-200": isCurrentMonth && availability.status === 'unavailable' && !isPast,
                      }
                    )}
                    onClick={() => {
                      if (!isCurrentMonth) return; // Do nothing for outside-month cells
                      if (isCurrentMonth && !isPast) {
                        // Visually select the clicked day
                        try { setSelectedDate(day); } catch {}
                        // Build slot list for modal - show all slots with status
                        const allSlots = getAllSlotsWithStatus(day);
                        // If no custom slots go directly
                        if (!customSlots.length) {
                          const searchParams = new URLSearchParams();
                          searchParams.set('date', format(day, 'yyyy-MM-dd'));
                          if (selectedHallForCalendar !== "all") searchParams.set('hallId', selectedHallForCalendar);
                          navigate(`/create-booking?${searchParams.toString()}`);
                          return;
                        }
                        setSlotModalDate(day);
                        setSlotModalSlots(allSlots);
                        // Reset selection state on open
                        setSlotModalSelectedIds([]);
                        setSlotModalFullDay(false);
                        setSlotModalOpen(true);
                      }
                    }}
                  >
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "text-xs sm:text-sm font-medium",
                            isToday ? "text-blue-600" : "text-gray-900",
                            !isCurrentMonth && "invisible"
                          )}
                          aria-hidden={!isCurrentMonth}
                        >
                          {format(day, 'd')}
                        </span>
                        <div className="flex items-center space-x-1">
                          {isCurrentMonth && muhurtham && !isPast && (
                            <img
                              src={muhurtham.value}
                              alt="Muhurtham"
                              className="h-4 w-4 object-contain select-none"
                              title="Muhurtham (Auspicious)"
                              loading="lazy"
                            />
                          )}
                          {isCurrentMonth && !isPast && (
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              {
                                "bg-green-500": availability.status === 'fully-available',
                                "bg-yellow-500": availability.status === 'partially-available',
                                "bg-red-500": availability.status === 'unavailable',
                              }
                            )} />
                          )}
                          {/* Dual Slot badge removed */}
                          {isCurrentMonth && !isPast && (
                            <Plus className="h-3 w-3 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                      </div>
                      {/* Tamil date now shown inline at bottom instead of top-left overlay */}
                      {/* Festival icon moved to top-right; removed from bottom-right */}
                      
                      {isCurrentMonth && !isPast && (
                        <div className="flex-1 flex flex-col justify-end gap-1">
                          <div className="text-[11px] text-gray-600">
                            {(customSlots.length > 0 && availability.totalCount > 0)
                              ? (availability.availableCount === availability.totalCount ? 'All slots available' : `${availability.availableCount}/${availability.totalCount} available`)
                              : (availability.status === 'fully-available' ? 'Available' : 'Booked')}
                          </div>
                          {tamil && (
                            // Tamil day number hidden per request; placeholder retained for future use
                            <></>
                          )}
                          {/* Removed 'Click to book' hover hint as requested */}
                          {/* Hover slot availability removed as requested */}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-xs text-gray-600">Available</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <span className="text-xs text-gray-600">Partially Available</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <span className="text-xs text-gray-600">Booked</span>
                </div>
                <div className="flex items-center space-x-2 ">
                  <img className="h-5 w-5 object-contain select-none"
                    src={muhurtham}
                    alt="Muhurtham"
                  />
                  <span className="text-xs text-gray-600">Muhurtham</span>
                </div>
              </div>
              
              {selectedTimePeriod !== "all" && (
                <div className="text-xs text-gray-500">
                  {(() => {
                    const slot = customSlots.find(s => s.id === selectedTimePeriod);
                    if (slot) {
                      const start = slot.start?.slice(0,5) || '00:00';
                      const end = slot.end?.slice(0,5) || '23:59';
                      return <>Showing availability for: <span className="font-medium">{slot.name}</span> ({start} - {end})</>;
                    }
                    return (
                      <>
                        Showing availability for: <span className="font-medium capitalize">{selectedTimePeriod}</span>
                        {selectedTimePeriod === "morning" && " (06:00 - 12:00)"}
                        {selectedTimePeriod === "afternoon" && " (12:00 - 18:00)"}
                        {selectedTimePeriod === "evening" && " (18:00 - 22:00)"}
                        {selectedTimePeriod === "night" && " (22:00 - 06:00)"}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </CardContent>
    </Card>
  </div>
  )}

      {/* Filters moved below the calendar */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          {/* Professional Date Range & Quick Filters */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 w-full">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
              <Label className="text-xs font-semibold text-slate-600 whitespace-nowrap uppercase tracking-wide mr-2">
                Date Range
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "min-w-[110px] justify-start text-left rounded-lg h-8 px-2 font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-4 w-4 text-slate-500" />
                    {fromDate ? format(fromDate, "dd-MM-yyyy") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={handleFromDateSelect}
                    disabled={toDate ? { after: toDate } : undefined}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <span className="text-slate-400 text-xs px-1">→</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "min-w-[110px] justify-start text-left rounded-lg h-8 px-2 font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-4 w-4 text-slate-500" />
                    {toDate ? format(toDate, "dd-MM-yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={handleToDateSelect}
                    disabled={fromDate ? { before: fromDate } : undefined}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            {/* Quick range presets */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 shadow-sm">
              <Button
                variant={isTodayActive ? 'default' : 'ghost'}
                size="sm"
                className={cn("rounded-full px-4 font-medium text-sm shadow-none",
                  isTodayActive ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-800 hover:bg-white")}
                onClick={applyToday}
              >
                <CalendarIcon className="h-4 w-4 mr-1.5" />
                Today
              </Button>
              <Button
                variant={isThisWeekActive ? 'default' : 'ghost'}
                size="sm"
                className={cn("rounded-full px-4 font-medium text-sm shadow-none",
                  isThisWeekActive ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-800 hover:bg-white")}
                onClick={applyThisWeek}
              >
                <CalendarDays className="h-4 w-4 mr-1.5" />
                This Week
              </Button>
              <Button
                variant={onlyUpcoming ? 'default' : 'ghost'}
                size="sm"
                className={cn("rounded-full px-4 font-medium text-sm shadow-none",
                  onlyUpcoming ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-800 hover:bg-white")}
                onClick={toggleUpcoming}
                title="Show events from today onwards"
              >
                <Clock className="h-4 w-4 mr-1.5" />
                Upcoming
              </Button>
              {/* Outdoor Event Booking button removed as per requirement */}
            </div>
            {/* Submit button removed; filters auto-apply on change */}
          </div>
          {/* Toggle Calendar and Dashboard moved below the calendar */}
          <div className="flex items-center space-x-2 ml-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowCalendar(!showCalendar)}
              className="rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800"
              title={showCalendar ? 'Hide Calendar' : 'Show Calendar'}
              aria-label={showCalendar ? 'Hide Calendar' : 'Show Calendar'}
            >
              {showCalendar ? (
                <CalendarDays className="h-4 w-4" />
              ) : (
                <CalendarX className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDashboard(!showDashboard)}
              className="rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800"
              title={showDashboard ? 'Hide Dashboard' : 'Show Dashboard'}
              aria-label={showDashboard ? 'Hide Dashboard' : 'Show Dashboard'}
            >
              <LayoutDashboard className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards moved inside the Booking List table card below */}

      {/* Slot selection modal */}
      {slotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=> setSlotModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
              <h3 className="text-base font-semibold">Select Slot for {slotModalDate ? format(slotModalDate,'dd-MM-yyyy') : ''}</h3>
              <button onClick={()=> setSlotModalOpen(false)} className="text-slate-500 hover:text-slate-700 text-sm">✕</button>
            </div>
            <div className="p-5 space-y-3 overflow-auto flex-1 min-h-0">
              {slotModalSlots.length === 0 && (
                <div className="text-sm text-red-600">No slots available. You can still create an all-day booking.</div>
              )}
              {slotModalSlots.length > 0 && slotModalSlots.every(s=>!s.isAvailable) && (
                <div className="text-sm text-amber-700">All slots are already booked for this date.</div>
              )}
              {/* Dual Slot helper removed */}
              {/* Full Day toggle */}
              {slotModalSlots.some(s=>s.isAvailable) && (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const next = !slotModalFullDay;
                    setSlotModalFullDay(next);
                    if (next) {
                      const allAvail = (slotModalSlots || []).filter(x => x.isAvailable).map(x => x.id);
                      setSlotModalSelectedIds(allAvail);
                    } else {
                      setSlotModalSelectedIds([]);
                    }
                  }
                }}
                onClick={() => {
                  const next = !slotModalFullDay;
                  setSlotModalFullDay(next);
                  if (next) {
                    const allAvail = (slotModalSlots || []).filter(x => x.isAvailable).map(x => x.id);
                    setSlotModalSelectedIds(allAvail);
                  } else {
                    setSlotModalSelectedIds([]);
                  }
                }}
                className="flex items-center justify-between p-3 rounded-md border border-slate-200 bg-slate-50"
              >
                <div className="flex flex-col">
                  <span className="font-medium">Full Day</span>
                  <span className="text-xs text-slate-500">Selects all slots for this date</span>
                </div>
                <input
                  type="checkbox"
          ref={fullDayCheckboxRef}
          className="h-4 w-4 accent-blue-600 rounded-sm"
                  checked={slotModalFullDay}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={(e)=>{
                    const next = e.target.checked;
                    setSlotModalFullDay(next);
                    if (next) {
            // Select only available (non-booked) slot IDs
            const allAvail = (slotModalSlots || []).filter(x => x.isAvailable).map(x => x.id);
            setSlotModalSelectedIds(allAvail);
                    } else {
                      // Clear selections when turning Full Day off
                      setSlotModalSelectedIds([]);
                    }
                  }}
                />
              </div>
              )}
              <div className="space-y-2">
                {slotModalSlots.map(s => {
                  const start = s.start?.slice(0,5) || '00:00';
                  const end = s.end?.slice(0,5) || '23:59';
      const isBookedBlocked = !s.isAvailable;
      const isBlocked = isBookedBlocked;
      const isTemp = !!(s as any).isTempBlocked;
                  return (
                    <div
                      key={s.id}
                      role={isBlocked ? undefined : 'button'}
                      tabIndex={isBlocked ? -1 : 0}
                      onKeyDown={(e) => {
                        if (isBlocked) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSlotId(s.id);
                        }
                      }}
                      onClick={(e) => {
                        if (isBlocked) return;
                        // inner inputs/buttons call stopPropagation() so row click is safe to always toggle
                        toggleSlotId(s.id);
                      }}
                      className={`flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition ${
                        isBlocked
                          ? (isTemp ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-700')
                          : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                      } ${!isBlocked ? 'cursor-pointer' : ''}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{s.name}</span>
                        {isBookedBlocked && (s.bookedByName || s.bookedByPhone) && (
                          <span className={`text-[11px] ${isTemp ? 'text-amber-700' : 'text-red-600/90'}`}>{s.bookedByName || '—'}{s.bookedByPhone ? ` • ${s.bookedByPhone}` : ''}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">{start} - {end}</span>
                        {!isBlocked && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-blue-600 rounded-sm"
                            checked={slotModalFullDay ? !isBlocked : slotModalSelectedIds.includes(s.id)}
                            onClick={(ev) => ev.stopPropagation()}
                            onChange={() => {
                              // Delegate to the shared toggle helper to keep behavior consistent
                              toggleSlotId(s.id);
                            }}
                          />
                        )}
                        {isBookedBlocked && !isTemp && (
                          <button
                            className="text-xs text-red-600 font-medium underline"
                            title="View booking details"
                            onClick={(ev) => { ev.stopPropagation();
                              if (!slotModalDate) return;
                              const dateStr = format(slotModalDate,'yyyy-MM-dd');
                              const toMin = (t:string)=>{ const [H,M] = t.split(':').map(Number); return H*60+M; };
                              const sStart = toMin(start);
                              let sEnd = toMin(end);
                              if (sEnd <= sStart) sEnd += 24*60;
                              let booked:any;
                              const bid = s.bookedBookingId != null ? String(s.bookedBookingId) : '';
                              booked = bid ? bookings.find(b => String(b.id) === bid || String((b as any).displayId||'') === bid) : undefined;
                              if (!booked) {
                                booked = bookings.find(b => {
                                  const sameDate = format(b.date,'yyyy-MM-dd') === dateStr;
                                  if (!sameDate) return false;
                                  if (selectedHallForCalendar !== 'all' && String(b.hallId) !== String(selectedHallForCalendar)) return false;
                                  const bb:any = b;
                                  if (bb._allDay) {
                                    if (bb.slotId) return String(bb.slotId) === String(s.id);
                                    return true;
                                  }
                                  const bStart = toMin((bb._startHHMM||bb.startTime||'00:00').slice(0,5));
                                  return bStart >= sStart && bStart < sEnd;
                                });
                              }
                              if (!booked) {
                                const calHit = monthCal.find(e => e.date === dateStr && String(e.slot_id||'') === String(s.id) && (!selectedHallForCalendar || String(e.hall_id||'') === String(selectedHallForCalendar)));
                                if (calHit) {
                                  const hallName = halls.find(h => String(h.id) === String(calHit.hall_id))?.name || '';
                                  const slotMeta = customSlots.find(cs => String(cs.id) === String(calHit.slot_id));
                                  booked = {
                                    id: calHit.booking_id,
                                    displayId: calHit.booking_id,
                                    hallId: String(calHit.hall_id||''),
                                    hallName,
                                    slotId: String(calHit.slot_id||''),
                                    _slotName: slotMeta?.name,
                                    _slotStart: slotMeta?.start,
                                    _slotEnd: slotMeta?.end,
                                    customerName: calHit.customer_name || '',
                                    phone: calHit.customer_phone || '',
                                    date: new Date(dateStr),
                                    startTime: '00:00',
                                    endTime: '00:00',
                                    _startHHMM: '00:00',
                                    _allDay: true,
                                    purpose: '',
                                    attendees: 500,
                                    totalAmount: 0,
                                    status: (calHit.status || 'pending').toLowerCase(),
                                    notes: '',
                                    createdAt: new Date(dateStr),
                                    _services: [],
                                    _payments: [],
                                    _paidTotal: 0,
                                    _pendingTotal: 0,
                                  } as any;
                                }
                              }
                              if (booked) {
                                setSlotModalOpen(false);
                                openDetails(booked);
                              }
                            }}
                          >{'Booked'}</button>
                        )}
                        {isBookedBlocked && isTemp && (
                          <span className="text-xs text-amber-700 font-medium">Added</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Modal footer actions */}
              {(slotModalSlots.some(s=>s.isAvailable) || slotModalAccumulated.length > 0) && (
              <div className="pt-3 flex items-center justify-end gap-3 border-t mt-3 flex-shrink-0">
        <Button
                  variant="outline"
                  size="sm"
                  className={cn(slotModalAddErr ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100' : undefined)}
                  onClick={()=>{
                    // Add current selection to accumulator and clear selection for next picks
                    if (!slotModalDate) return;
                    const slotIds = slotModalFullDay ? slotModalAllAvailableIds.slice() : slotModalSelectedIds.slice();
          if (slotIds.length === 0) {
            setSlotModalAddErr('Please choose at least one slot');
            setTimeout(()=> setSlotModalAddErr(''), 1500);
            return;
          }
          const entry = { date: format(slotModalDate,'yyyy-MM-dd'), slotIds, fullDay: !!slotModalFullDay, hallId: (selectedHallForCalendar && selectedHallForCalendar !== 'all') ? selectedHallForCalendar : undefined };
                    setSlotModalAccumulated(prev => [...prev, entry]);
                    setSlotModalSelectedIds([]);
                    setSlotModalFullDay(false);
          setSlotModalAddMsg(`${slotIds.length} slot(s) added`);
          setTimeout(()=> setSlotModalAddMsg(''), 1200);
          // Close modal so user can pick another date
          setSlotModalOpen(false);
                  }}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add more
                </Button>
                <Button
                  size="sm"
                  onClick={()=>{
                    if (!slotModalDate) return;
                    // Build entries: include accumulated entries plus current selection (if any)
                    const currentSlotIds = slotModalFullDay ? slotModalAllAvailableIds.slice() : slotModalSelectedIds.slice();
                    const currentEntry = (currentSlotIds && currentSlotIds.length>0) ? { date: format(slotModalDate,'yyyy-MM-dd'), slotIds: currentSlotIds, fullDay: !!slotModalFullDay } : null;
                    const combinedEntries = slotModalAccumulated.slice();
                    if (currentEntry) combinedEntries.push(currentEntry);
                    if (combinedEntries.length === 0) return;

                    const params = new URLSearchParams();
                    if (selectedHallForCalendar !== 'all') params.set('hallId', selectedHallForCalendar);

                    // If all entries share the same date, pass explicit slotIds so booked slots aren’t included
                    const allDates = Array.from(new Set(combinedEntries.map(e => e.date)));
                    if (allDates.length === 1) {
                      const onlyDate = allDates[0];
                      params.set('date', onlyDate);
                      const accumulatedIds = combinedEntries.flatMap(a => a.slotIds || []);
                      const combinedIds = Array.from(new Set(accumulatedIds));
                      if (combinedIds.length === 1) {
                        params.set('slotId', combinedIds[0]);
                      } else if (combinedIds.length > 1) {
                        params.set('slotIds', combinedIds.join(','));
                      } else {
                        return; // nothing selected
                      }
                    } else {
                      // Multiple dates: encode entries as JSON in multiSlots param
                      try {
                        params.set('multiSlots', encodeURIComponent(JSON.stringify(combinedEntries)));
                      } catch (e) {
                        // fallback: do nothing
                        return;
                      }
                    }

                    setSlotModalOpen(false);
                    navigate(`/create-booking?${params.toString()}`);
                  }}
                  disabled={!slotModalFullDay && slotModalSelectedIds.length === 0 && slotModalAccumulated.length === 0}
                >
                  Continue
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              )}
              {slotModalAddMsg && (
                <div className="px-5 pb-2 text-sm text-emerald-600">{slotModalAddMsg}</div>
              )}
              {slotModalAddErr && (
                <div className="px-5 pb-2 text-sm text-rose-600">{slotModalAddErr}</div>
              )}
            </div>
          </div>
        </div>
      )}

  {/* Filters moved into table header */}

      {/* Bookings Table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 px-5">
          <div className="flex items-center">
            <CardTitle className="text-lg">Booking List</CardTitle>
          </div>
          {/* Single-line toolbar: scrolls horizontally on small screens */}
          <div className="mt-3 flex items-center gap-3 sm:gap-4 overflow-x-auto whitespace-nowrap">
            {/* Search */}
            <div className="relative w-full md:w-[28rem] lg:w-[34rem] shrink-0">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                className="pl-8"
                placeholder="Search bookings (customer, phone, hall, purpose, ID)"
                value={searchQuery}
                onChange={(e)=> setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Hall filter */}
              <Select value={hallListFilter} onValueChange={setHallListFilter}>
                <SelectTrigger className="w-48 shrink-0">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Hall" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Halls</SelectItem>
                  {halls.filter(h=>h.isActive).map(h=> (
                    <SelectItem key={h.id} value={String(h.id)}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48 shrink-0">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="advance">Advanced</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="settled">Settled</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="shrink-0 bg-yellow-500/90 text-black hover:bg-yellow-500">
                    <Download className="h-4 w-4 mr-2" />
                    Reports
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Export Excel</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={exportAppointmentListExcel}>Appointment List (filtered)</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportDailySummaryExcel}>Daily Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportHallSummaryExcel}>Hall-wise Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPaymentStatusSummaryExcel}>Payment Status Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCustomerContactsExcel}>Customer Contact List</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Removed date badges as requested */}
          </div>
        </CardHeader>
        <CardContent className="px-5">
          {showDashboard && (
            <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {[
                { label: 'ADVANCED', qty: advanceCount, amount: advanceCollected, icon: <Receipt className="h-4 w-4" />, tone: 'from-purple-500/10 to-purple-500/5', iconTint: 'bg-purple-100 text-purple-600 ring-purple-200/60' },
                { label: 'PAID', qty: paidCount, amount: paidAmount, icon: <CheckCircle className="h-4 w-4" />, tone: 'from-emerald-500/10 to-emerald-500/5', iconTint: 'bg-emerald-100 text-emerald-600 ring-emerald-200/60' },
                { label: 'SETTLEMENT', qty: paymentSettledCount, amount: settledAmount, icon: <IndianRupee className="h-4 w-4" />, tone: 'from-teal-500/10 to-teal-500/5', iconTint: 'bg-teal-100 text-teal-600 ring-teal-200/60' },
                { label: 'CANCELLED', qty: cancelledCount, amount: cancelledAmount, icon: <XCircle className="h-4 w-4" />, tone: 'from-red-500/10 to-red-500/5', iconTint: 'bg-red-100 text-red-600 ring-red-200/60' },
                // TOTAL = ADVANCED + PAID + SETTLEMENT
                { label: 'TOTAL', qty: totalCombinedQty, amount: totalCombinedAmount, icon: <CalendarDays className="h-4 w-4" />, tone: 'from-amber-500/10 to-amber-500/5', iconTint: 'bg-amber-100 text-amber-600 ring-amber-200/60' }
              ].map(card => (
                <div key={card.label} className="relative overflow-hidden rounded-xl border border-gray-200/70 dark:border-gray-800/60 bg-white dark:bg-gray-900 px-5 py-4 shadow-sm hover:shadow-md transition-shadow group min-h-[112px]">
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.tone} opacity-80 pointer-events-none`}></div>
                  <div className="relative flex items-start justify-between gap-4 min-h-[72px]">
                    <div className="w-full">
                      <div className="h-5 flex items-end">
                        <p className="text-[12px] font-semibold tracking-wide text-gray-600 dark:text-gray-400 uppercase leading-none whitespace-nowrap">{card.label}</p>
                      </div>
                      {typeof (card as any).qty !== 'undefined' && typeof (card as any).amount !== 'undefined' ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-[11px] text-gray-500">Qty</div>
                            <div className="text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{(card as any).qty}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-gray-500">Amount</div>
                            <div className="text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">₹{Number(((card as any).qty === 0 ? 0 : (card as any).amount)||0).toLocaleString('en-IN')}</div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{(card as any).value}</span>
                          </div>
                          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-500 flex items-center gap-1">{(card as any).sub}</p>
                        </>
                      )}
                    </div>
                    <div className={`shrink-0 h-8 w-8 rounded-md ${card.iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform mt-1`}>{card.icon}</div>
                  </div>
                  <div className="absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-white/30 dark:bg-white/5 blur-2xl opacity-40"></div>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <div className="min-w-[900px] md:min-w-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={()=>{ setSortBy(prev=> prev==='date'?'date':'date'); setSortDir(d=> (sortBy==='date' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Date & Time <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={()=>{ setSortBy('hall'); setSortDir(d=> (sortBy==='hall' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Hall <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead className="cursor-pointer hidden md:table-cell" onClick={()=>{ setSortBy('slot'); setSortDir(d=> (sortBy==='slot' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Slot <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={()=>{ setSortBy('customer'); setSortDir(d=> (sortBy==='customer' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Customer <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  Booking ID
                </TableHead>
                <TableHead className="hidden sm:table-cell cursor-pointer" onClick={()=>{ setSortBy('status'); setSortDir(d=> (sortBy==='status' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Status <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead className="hidden sm:table-cell">Advance</TableHead>
                <TableHead className="hidden sm:table-cell">Pending</TableHead>
                <TableHead className="cursor-pointer" onClick={()=>{ setSortBy('amount'); setSortDir(d=> (sortBy==='amount' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Amount <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead className="cursor-pointer hidden sm:table-cell" onClick={()=>{ setSortBy('status'); setSortDir(d=> (sortBy==='status' ? (d==='asc'?'desc':'asc'):'asc')); }}>
                  <span className="inline-flex items-center gap-1">Payment Status <ArrowUpDown className="h-3 w-3 opacity-50"/></span>
                </TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
        {pagedBookings.length === 0 ? (
                <TableRow>
          <TableCell colSpan={10} className="text-center text-sm text-slate-500 py-8">
                    No bookings found for the selected date range.
                  </TableCell>
                </TableRow>
              ) : pagedBookings.map((booking) => (
                <TableRow
                  key={booking.id}
                  onClick={() => openDetails(booking)}
                  style={{ cursor: 'pointer' }}
                  className={cn(
                    booking.status === 'cancelled' ? 'bg-rose-50/70 hover:bg-rose-100/70' : undefined
                  )}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {(() => {
                          const b:any = booking;
                          const parseD = (raw:any): Date | null => {
                            try {
                              if (!raw) return null;
                              const s = String(raw);
                              const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
                              const iso = m ? m[1] : s;
                              const parts = iso.split('-').map(Number);
                              const d = parts.length === 3 ? new Date(parts[0], parts[1]-1, parts[2]) : (new Date(raw));
                              return isNaN(d as any) ? null : d;
                            } catch { return null; }
                          };

                          // Derive From and To event dates
                          let fromD: Date | null = null;
                          let toD: Date | null = null;
                          const calRows: any[] = Array.isArray(b._calRows) ? b._calRows : [];
                          if (calRows.length) {
                            const dates: Date[] = calRows
                              .map((hb:any) => parseD(hb.eventdate || hb.date))
                              .filter((d: any) => d && !isNaN(d as any)) as Date[];
                            if (dates.length) {
                              dates.sort((a:Date,b:Date)=> a.getTime()-b.getTime());
                              fromD = dates[0];
                              toD = dates[dates.length-1];
                            }
                          }
                          if (!fromD) fromD = parseD(b.eventdate_1 || b.eventdate || b.date) || (booking.date as Date);
                          if (!toD) toD = fromD;

                          const fromStr = fromD ? format(fromD, 'dd-MM-yyyy') : '-';
                          const toStr = toD ? format(toD, 'dd-MM-yyyy') : '-';
                          return (toD && fromD && toD.getTime() !== fromD.getTime()) ? `${fromStr} → ${toStr}` : fromStr;
                        })()}
                      </span>
                      <span className="text-sm text-gray-500">
                        {booking._allDay ? 'All Day' : `${booking.startTime} - ${booking.endTime}`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{booking.hallName || '—'}</span>
                      {halls.find((h) => h.id === booking.hallId)?.location && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {halls.find((h) => h.id === booking.hallId)?.location}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {(() => {
                      const b:any = booking;
                      const findMeta = (sid?: string) => sid ? (slotsRef.current.find(s=> String(s.id)===String(sid)) || null) : null;
                      const label = (m:any) => {
                        if (!m) return '';
                        const s = (m.start||'').slice(0,5);
                        const e = (m.end||'').slice(0,5);
                        return `${m.name}${s ? ` (${s}${e && e!==s ? ` - ${e}`: ''})` : ''}`;
                      };
                      const sid1 = b.slot_id_1 ? String(b.slot_id_1) : (b.slotId ? String(b.slotId) : undefined);
                      const l1 = label(findMeta(sid1));
                      if (l1) {
                        return (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{l1}</span>
                          </div>
                        );
                      }
                      if (booking.slotId || booking._slotName) {
                        const s = (booking._slotStart||'');
                        const e = (booking._slotEnd||'');
                        const single = `${booking._slotName || booking.slotId}${s ? ` (${s}${e && e!==s ? ` - ${e}`: ''})` : ''}`;
                        return (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{single}</span>
                          </div>
                        );
                      }
                      return <span className="text-xs text-gray-400 italic">—</span>;
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {booking.customerName || '—'}
                      </span>
                      <span className="text-sm text-gray-500">
                        {booking.phone || '—'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-700 hidden md:table-cell">{(booking as any).displayId || booking.id}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {(() => {
                      const raw = String((booking as any).status || '').toLowerCase();
                      const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '-';
                      const s = (raw === 'canceled' ? 'cancelled' : raw) as Booking["status"];
                      return (
                        <Badge className={cn("text-xs w-fit", getStatusColor(s))}>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(s)}
                            {label}
                          </div>
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {(() => {
                      const paid = typeof booking._paidTotal === 'number' ? booking._paidTotal : 0;
                      return <span className="text-green-700 font-semibold">₹{paid.toLocaleString()}</span>;
                    })()}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {(() => {
                      const total = typeof booking.totalAmount === 'number' ? booking.totalAmount : 0;
                      const paid = typeof booking._paidTotal === 'number' ? booking._paidTotal : 0;
                      const pending = typeof booking._pendingTotal === 'number' ? booking._pendingTotal : Math.max(total - paid, 0);
                      return <span className="text-red-700 font-semibold">₹{pending.toLocaleString()}</span>;
                    })()}
                  </TableCell>
                  <TableCell className="font-medium">
                    {(() => {
                      const total = typeof booking.totalAmount === 'number' ? booking.totalAmount : 0;
                      return <span>₹{total.toLocaleString()}</span>;
                    })()}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {(() => {
                      if (booking.status === 'cancelled') {
                        return (
                          <div className="flex flex-col gap-1">
                            <Badge className={cn("text-xs w-fit bg-red-100 text-red-800 hover:bg-red-100 hover:text-red-800")}> 
                              <div className="flex items-center gap-1">
                                <XCircle className="h-4 w-4" />
                                Cancelled
                              </div>
                            </Badge>
                            <span className="text-[10px] text-slate-500">Booking: cancelled</span>
                          </div>
                        );
                      }
                      const pStatus = derivePaymentStatus(booking);
                      const label = pStatus === 'advance' ? 'Advanced' : (pStatus.charAt(0).toUpperCase() + pStatus.slice(1));
                      return (
                        <div className="flex flex-col gap-1">
                          <Badge className={cn("text-xs w-fit", getPaymentStatusColor(pStatus), getPaymentStatusHoverColor(pStatus))}>
                            <div className="flex items-center gap-1">
                              {getPaymentStatusIcon(pStatus)}
                              {label}
                            </div>
                          </Badge>
                          <span className="text-[10px] text-slate-500">Booking: {booking.status}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={(e)=>{ e.stopPropagation(); handleEdit(booking); }}
                        size="sm"
                        variant="outline"
                        title="Edit Booking"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={(e)=>{ e.stopPropagation(); handlePrintAdvanceReceipt(booking); }}
                        size="sm"
                        variant="outline"
                        title="Advance Receipt"
                      >
                        <Receipt className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {pagedBookings.length > 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-semibold">Grand Total</TableCell>
                  <TableCell className="hidden sm:table-cell"></TableCell>
                  <TableCell className="font-semibold text-emerald-700 hidden sm:table-cell">₹{grandTotals.advance.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="font-semibold text-rose-700 hidden sm:table-cell">₹{grandTotals.pending.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="font-semibold">₹{grandTotals.amount.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="hidden sm:table-cell"></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
            </div>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-sm text-gray-600">Showing {(page-1)*pageSize + 1}–{Math.min(page*pageSize, sortedBookings.length)} of {sortedBookings.length}</div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Rows:</span>
              <select className="border rounded px-2 py-1 text-sm" value={pageSize} onChange={e=>{ setPageSize(Number(e.target.value)||10); setPage(1); }}>
                {[5,10,20,50].map(n=> (<option key={n} value={n}>{n}</option>))}
              </select>
              <Button variant="outline" size="sm" disabled={page<=1} onClick={()=> setPage(p=> Math.max(1, p-1))}><ChevronLeft className="h-4 w-4"/></Button>
              <div className="text-sm w-16 text-center">{page} / {totalPages}</div>
              <Button variant="outline" size="sm" disabled={page>=totalPages} onClick={()=> setPage(p=> Math.min(totalPages, p+1))}><ChevronRight className="h-4 w-4"/></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {detailsOpen && detailsBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDetails}>
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-5xl" onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">Booking Details — {(detailsBooking as any).displayId || detailsBooking.id}</div>
              <button onClick={closeDetails} className="text-gray-500 hover:text-gray-700 text-sm">✕</button>
            </div>
            <div className="p-5">
              <div className="overflow-auto">
                <div className="min-w-full border rounded-lg">
                  <table className="min-w-full text-xs md:text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Customer</th>
                        <th className="px-3 py-2 text-left font-semibold">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="divide-x align-top">
                        <td className="px-3 py-2">{(detailsBooking as any).customerName || (detailsBooking as any).customer_name || (detailsBooking as any).name || '—'}</td>
                        <td className="px-3 py-2">{(detailsBooking as any).phone || (detailsBooking as any).mobile || (detailsBooking as any).customer_phone || '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border-t pt-4 mt-2">
                {/* Slots & Event Details Table */}
                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-2">Slots & Event Details</div>
                  {Array.isArray((detailsBooking as any)._calRows) && (detailsBooking as any)._calRows.length ? (
                    <div className="overflow-auto border rounded-md">
                      <table className="min-w-full text-xs md:text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="text-left font-semibold px-3 py-2">Date</th>
                            <th className="text-left font-semibold px-3 py-2">Hall</th>
                            <th className="text-left font-semibold px-3 py-2">Slot</th>
                            <th className="text-left font-semibold px-3 py-2">Event Type</th>
                            <th className="text-right font-semibold px-3 py-2">Guests</th>
                            <th className="text-left font-semibold px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(detailsBooking as any)._calRows
                            .slice()
                            .sort((a:any,b:any)=>{
                              const ad = String(a.eventdate||a.date||'');
                              const bd = String(b.eventdate||b.date||'');
                              if (ad<bd) return -1; if (ad>bd) return 1;
                              const asid = String(a.slot_id||'');
                              const bsid = String(b.slot_id||'');
                              return asid.localeCompare(bsid);
                            })
                            .map((hb:any, idx:number) => {
                              const dRaw = hb.eventdate || hb.date;
                              let dStr = '-';
                              try {
                                if (dRaw) {
                                  const s = String(dRaw);
                                  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
                                  const iso = m ? m[1] : s;
                                  const parts = iso.split('-').map(Number);
                                  const d = parts.length===3 ? new Date(parts[0], parts[1]-1, parts[2]) : new Date(s);
                                  dStr = !isNaN(d as any) ? format(d as Date, 'dd-MM-yyyy') : '-';
                                }
                              } catch {}

                              const hallId = String(hb.hall_id || (detailsBooking as any).hallId || '');
                              const hallName = hallId ? (hallsRef.current.find(h => String(h.id)===hallId)?.name || (detailsBooking as any).hallName || '-') : ((detailsBooking as any).hallName || '-');

                              const slotId = hb.slot_id != null ? String(hb.slot_id) : ((detailsBooking as any).slotId ? String((detailsBooking as any).slotId) : undefined);
                              const slotMeta = slotId ? (slotsRef.current.find(s => String(s.id)===slotId) || null) : null;
                              const slotLabel = slotMeta ? (()=>{
                                const s = (slotMeta.start||'').slice(0,5);
                                const e = (slotMeta.end||'').slice(0,5);
                                return `${slotMeta.name}${s?` (${s}${e && e!==s?` - ${e}`:''})`:''}`;
                              })() : ((detailsBooking as any)._slotName ? (()=>{
                                const s = (detailsBooking as any)._slotStart||'';
                                const e = (detailsBooking as any)._slotEnd||'';
                                return `${(detailsBooking as any)._slotName}${s?` (${s}${e && e!==s?` - ${e}`:''})`:''}`;
                              })() : '-');

                              const etId = hb.event_type_id != null ? String(hb.event_type_id) : ((detailsBooking as any).eventTypeId ? String((detailsBooking as any).eventTypeId) : '');
                              const etName = etId ? (eventTypeNameMap[etId] || (detailsBooking as any).purpose || '-') : ((detailsBooking as any).purpose || '-');

                              const guests = Number(hb.expected_guests ?? hb.attendees ?? (detailsBooking as any).attendees ?? 0) || 0;
                              const statusRaw = String(hb.status || (detailsBooking as any).status || '').toLowerCase();
                              const statusLabel = statusRaw ? statusRaw.charAt(0).toUpperCase()+statusRaw.slice(1) : '-';
                              const cls = statusRaw === 'cancelled'
                                ? 'bg-red-100 text-red-800'
                                : statusRaw === 'confirmed' || statusRaw === 'completed'
                                  ? 'bg-green-100 text-green-800'
                                  : statusRaw === 'pending'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-slate-100 text-slate-800';

                              return (
                                <tr key={idx}>
                                  <td className="px-3 py-2">{dStr}</td>
                                  <td className="px-3 py-2">{hallName || '-'}</td>
                                  <td className="px-3 py-2">{slotLabel || '-'}</td>
                                  <td className="px-3 py-2">{etName || '-'}</td>
                                  <td className="px-3 py-2 text-right">{guests ? guests.toLocaleString() : '-'}</td>
                                  <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded ${cls}`}>{statusLabel}</span></td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-gray-500 border rounded-md">No slot entries</div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Services Table */}
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Services</div>
                    {(detailsBooking._services||[]).length ? (
                      <div className="overflow-auto border rounded-md">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-50 text-gray-600">
                            <tr>
                              <th className="text-left font-semibold px-3 py-2">Service</th>
                              <th className="text-right font-semibold px-3 py-2">Amount (₹)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(detailsBooking._services||[]).map((s:any,idx:number)=>{
                              const sid = String(s.service_id || s.id || s.serviceId || s.ServiceID || '');
                              const name = serviceNameMap[sid] || s.service_name || s.name || `Service ${idx+1}`;
                              const price = Number(s.amount || s.line_total || s.unit_price || 0) || 0;
                              return (
                                <tr key={idx}>
                                  <td className="px-3 py-2">{name}</td>
                                  <td className="px-3 py-2 text-right">{price.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-gray-500 border rounded-md">No services</div>
                    )}
                  </div>

                  {/* Payment Details Table */}
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Payment Details</div>
                    {(detailsBooking._payments||[]).length ? (
                      <div className="overflow-auto border rounded-md">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-50 text-gray-600">
                            <tr>
                              <th className="text-left font-semibold px-3 py-2">Pay Mode</th>
                              <th className="text-left font-semibold px-3 py-2">Reference</th>
                              <th className="text-left font-semibold px-3 py-2">Created Date</th>
                              <th className="text-right font-semibold px-3 py-2">Collected (₹)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(detailsBooking._payments||[]).map((p:any,idx:number)=>{
                              const modeId = String(p.payment_mode_id || p.mode_id || p.mode || p.payment_mode || p.PaymentMode || '');
                              const modeName = paymentModeNameMap[modeId] || String(p.payment_mode || p.mode || p.PaymentMode || 'Other');
                              const amt = Number(p.amount || p.paid_amount || 0) || 0;
                              // Prefer UPI transaction id; else cheque number; else blank
                              const upiRef = p.upi_transaction_id || p.transaction_id || p.upi_transaction_no || p.upi_reference || p.reference_no;
                              const chqRef = p.cheque_no || p.cheque_number || p.check_no;
                              const refText = ((): string => {
                                if (upiRef) return `UPI: ${String(upiRef)}`;
                                if (chqRef) return `Cheque: ${String(chqRef)}`;
                                return '-';
                              })();
                              const rawDate = p.created_at || p.payment_date || p.createdon || p.date || p.PaymentDate || p.createdAt;
                              let dateStr = '-';
                              try {
                                const d = rawDate ? new Date(rawDate) : null;
                                // Show date with time
                                dateStr = d && !isNaN(d as any) ? format(d as Date, 'MMM dd, yyyy • hh:mm a') : '-';
                              } catch { /* ignore */ }
                              return (
                                <tr key={idx}>
                                  <td className="px-3 py-2">{modeName}</td>
                                  <td className="px-3 py-2">{refText}</td>
                                  <td className="px-3 py-2">{dateStr}</td>
                                  <td className="px-3 py-2 text-right">{amt.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-gray-500 border rounded-md">No payments</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-end gap-6 text-sm">
                  <div className="text-gray-600">Total: <span className="font-semibold text-gray-900">₹{Number(detailsBooking.totalAmount||0).toLocaleString()}</span></div>
                  <div className="text-green-700">Paid: <span className="font-semibold">₹{Number(detailsBooking._paidTotal||0).toLocaleString()}</span></div>
                  <div className="text-rose-700">Pending: <span className="font-semibold">₹{Math.max(Number(detailsBooking.totalAmount||0)-Number(detailsBooking._paidTotal||0),0).toLocaleString()}</span></div>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-end">
              <Button variant="outline" size="sm" onClick={closeDetails}>Close</Button>
            </div>
          </div>
        </div>
      )}
      <MuhurthamModal
        open={showMuhurthamModal}
        onClose={()=> setShowMuhurthamModal(false)}
        year={muhurthamYear}
        availableYears={availableMuhurthamYears}
        onPrevYear={gotoPrevMuhurthamYear}
        onNextYear={gotoNextMuhurthamYear}
        grouped={muhurthamGrouped}
        listLength={muhurthamList.length}
      />
    </div>
  );
}
