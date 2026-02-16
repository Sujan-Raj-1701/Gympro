import { useState, useEffect, useMemo, useRef } from "react";
import CreateBookingView from "./CreateBookingView";
import Swal from 'sweetalert2';
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Carousel } from "@/components/ui/carousel";
import { format } from "date-fns";
import { DataService } from '@/services/userService';
import { BookingsService } from '@/services/bookingsService';
import { ApiService, API_BASE_URL } from '@/services/apiService';
import { MASTER_TABLES } from '@/services/masterTables';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft,
  Save,
  Users,
  MapPin,
  Clock,
  DollarSign,
  Plus,
  Trash2,
  CreditCard,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Hall {
  id: string;
  name: string;
  capacity: number;
  hourlyRate: number;
  // Optional: price to charge when booking covers more than one slot (full day)
  fullDayPrice?: number;
  // dualslotPrice removed
  taxRate?: number;
  hsnCode?: string;
  hsnDescription?: string;
  images: string[];
  isAvailable: boolean;
}

// Removed static default halls; list now fully driven by master data fetch
const halls: Hall[] = [];

interface Service {
  id: string;
  name: string;
  price: number;
  category?: string;
  taxId?: string;
}

// fallback static services (used if master table fetch fails or is empty)
const FALLBACK_SERVICES: Service[] = [];

export default function CreateBooking() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Customer Information
  const [customer, setCustomer] = useState({ fullName: "", mobile: "", email: "", address: "", gstin: "", aadhaar: "", pan: "" });
  // Selected customer ID when picked from suggestions; null implies a new customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | string | null>(null);

  // Event Details
  const [eventType, setEventType] = useState("");
  const [startDateTime, setStartDateTime] = useState<string>("");
  // Removed endDateTime per requirement (single event date only)

  const [expectedGuests, setExpectedGuests] = useState<number | "">(50);
  const [specialReq, setSpecialReq] = useState("");

  // Hall Selection
  const [selectedHallId, setSelectedHallId] = useState("");
  // Hall Selection locking (only lock in edit mode now)
  const [lockedHall, setLockedHall] = useState(false);

  // Services & Add-ons
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [availableServices, setAvailableServices] = useState<Service[]>(FALLBACK_SERVICES);
  const [serviceTaxExempt, setServiceTaxExempt] = useState<Record<string, boolean>>({});
  const [serviceSearch, setServiceSearch] = useState<string>("");
  // Prevent duplicate masters fetch in dev StrictMode
  const mastersInFlight = useRef(false);
  // Editable unit prices for services (per booking)
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({});
  const [serviceTaxMapState, setServiceTaxMapState] = useState<Record<string, number | undefined>>({});
  const { user } = useAuth();
  const [showServices, setShowServices] = useState(true);
  const [eventTypes, setEventTypes] = useState<Array<{value: string; label: string}>>([]);
  const [masterHalls, setMasterHalls] = useState<Hall[]>([]);
  const [eventSlots, setEventSlots] = useState<Array<{value: string; label: string}>>([]);
  const [eventSlot, setEventSlot] = useState("");
  // Dual slot fields removed
  const [lockedSlot, setLockedSlot] = useState(false);
  const [lockedDate, setLockedDate] = useState(false);
  // Multi-slot/full-day booking rows
  const [multiSlots, setMultiSlots] = useState<Array<{id?:string; date: string; eventType: string; eventSlot: string; expectedGuests: number | ''}>>([]);
  // const [lockedDate2, setLockedDate2] = useState(false);
  // Pre-initialize hall from URL so computed totals use it once masters resolve
  useEffect(() => {
    const hallIdParam = searchParams.get('hallId');
    if (hallIdParam) {
      // Prefill hall from URL but keep it editable in create mode
      setSelectedHallId(prev => prev || hallIdParam);
    }
  }, [searchParams]);

  // Pricing & Payment
  const [advancePayment, setAdvancePayment] = useState(0);
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentModes, setPaymentModes] = useState<Array<{value: string; label: string}>>([]);
  const [discount, setDiscount] = useState(0);
  // Tax exemption toggle
  const [taxExempt, setTaxExempt] = useState<boolean>(false);
  // Manual Hall Rent override (when set, replaces computed rent)
  const [hallRentOverride, setHallRentOverride] = useState<number | null>(null);
  // Conditional payment details
  const [upiTxnId, setUpiTxnId] = useState<string>("");
  const [chequeNo, setChequeNo] = useState<string>("");
  // Sum of payments already made for this booking (edit mode)
  const [existingPaid, setExistingPaid] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // --- Customer autocomplete state ---
  interface CustomerRecord { id?: number|string; full_name?: string; fullName?: string; name?: string; mobile?: string; phone?: string; email?: string; address?: string; gstin?: string; gst_no?: string; gst_number?: string; aadhar_no?: string; pan_no?: string; }
  const [customerList, setCustomerList] = useState<CustomerRecord[]>([]);
  const [showNameSuggest, setShowNameSuggest] = useState(false);
  const [showMobileSuggest, setShowMobileSuggest] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [mobileQuery, setMobileQuery] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  // Prefill slot/date for create mode (when coming from HallBooking with slot selection)
  useEffect(() => {
    const editId = searchParams.get('editId');
    if (editId) return; // handled in edit prefill above
    const slotParam = searchParams.get('slotId') || searchParams.get('slot');
    if (slotParam) {
      // Always honor explicit slot param (override any earlier default)
      setEventSlot(prev => prev === slotParam ? prev : slotParam);
      setLockedSlot(true);
    }
    const dateParam = searchParams.get('date');
    if (dateParam && !startDateTime) {
      setStartDateTime(dateParam);
      setLockedDate(true);
    }
  }, [searchParams, startDateTime]);
  // Dual slot defaults removed

  // After event types load, enforce selection using URL params or fallback to first option
  useEffect(() => {
    if (eventTypes.length === 0) return;
    const idParamRaw = searchParams.get('eventTypeId');
    const labelParamRaw = searchParams.get('purpose');
    const idParam = idParamRaw != null ? String(idParamRaw).trim() : '';
    const labelParam = labelParamRaw != null ? String(labelParamRaw).trim() : '';

    const normalize = (v: any) => v == null ? '' : String(v).trim();
    const asNumberString = (v: string) => {
      // if numeric-like (e.g. "2" or 2), normalize as plain digits for compare
      const m = v.match(/^\d+$/);
      return m ? m[0] : v;
    };

    // Build fast lookup maps
    const valuesSet = new Set(eventTypes.map(o => normalize(o.value)));
    const labelToValue = new Map<string, string>();
    eventTypes.forEach(o => labelToValue.set(normalize(o.label).toLowerCase(), normalize(o.value)));

    const currentNorm = normalize(eventType);
    const currentNum = asNumberString(currentNorm);

    let next = '';
    // 1) Exact value match (including numeric coercion)
    if (currentNorm && (valuesSet.has(currentNorm) || valuesSet.has(currentNum))) {
      next = valuesSet.has(currentNorm) ? currentNorm : currentNum;
    }
    // 2) URL id param
    else if (idParam) {
      const idNum = asNumberString(idParam);
      if (valuesSet.has(idParam)) next = idParam;
      else if (valuesSet.has(idNum)) next = idNum;
    }
    // 3) URL label param
    else if (labelParam) {
      const key = labelParam.toLowerCase();
      if (labelToValue.has(key)) next = labelToValue.get(key)!;
    }
    // 4) Try to map current (if it's actually a label) to a value
    if (!next && currentNorm) {
      const key = currentNorm.toLowerCase();
      if (labelToValue.has(key)) next = labelToValue.get(key)!;
    }
    // 5) Fallback to first option
    if (!next && eventTypes[0]) next = normalize(eventTypes[0].value);

    if (next && next !== eventType) setEventType(next);
  }, [eventTypes, eventType, searchParams]);

  // After halls load, enforce edit-mode hall selection using URL params or slot mapping
  useEffect(() => {
    const editId = searchParams.get('editId');
    if (!editId || masterHalls.length === 0) return;
    const norm = (s:string)=> s.trim().toLowerCase();
    const hId = searchParams.get('hallId') || '';
    const hName = searchParams.get('hallName') || '';
    const currentOk = selectedHallId && masterHalls.some(h => String(h.id) === String(selectedHallId));
    if (!currentOk) {
      if (hId) {
        const byId = masterHalls.find(h => norm(String(h.id)) === norm(hId));
        if (byId) { setSelectedHallId(String(byId.id)); return; }
      }
      if (hName) {
        const byNameExact = masterHalls.find(h => norm(h.name) === norm(hName));
        if (byNameExact) { setSelectedHallId(String(byNameExact.id)); return; }
        const byNamePartial = masterHalls.find(h => norm(h.name).includes(norm(hName)));
        if (byNamePartial) { setSelectedHallId(String(byNamePartial.id)); return; }
      }
    }
  }, [masterHalls, selectedHallId, searchParams]);

  // Ensure a Payment Mode is selected once options load (fallback to first option)
  useEffect(() => {
    if (paymentModes.length > 0) {
      const has = paymentMode && paymentModes.some(m => m.value === paymentMode);
      if (!has) setPaymentMode(paymentModes[0].value);
    } else {
      // keep sensible default when masters empty
      if (!paymentMode) setPaymentMode('cash');
    }
  }, [paymentModes]);

  useEffect(() => {
    const term = customerSearchTerm.trim();
    // Trigger search after first character (was 2)
    if (term.length < 1) { setCustomerList([]); return; }
    const handle = setTimeout(async () => {
      try {
        setIsSearchingCustomers(true);
        setCustomerSearchError(null);
        const { ApiService } = await import('../services/apiService');
  const accountCode = (user as any)?.account_code || '';
  const retailCode = (user as any)?.retail_code || '';
  const rows: any[] = await ApiService.searchMasterCustomer(term, 10, accountCode, retailCode);
        const mapped: CustomerRecord[] = rows.map(r => ({
          id: r.id || r.customer_id,
          full_name: r.customer_name || r.full_name || r.name,
          mobile: r.customer_mobile || r.mobile || r.phone,
          email: r.email,
          address: r.address,
          gstin: r.gstin || r.gst_no || r.gst_number,
          aadhar_no: r.aadhar_no,
          pan_no: r.pan_no,
        }));
        setCustomerList(mapped);
      } catch (e) {
        setCustomerSearchError('Search failed');
      } finally {
        setIsSearchingCustomers(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [customerSearchTerm, user]);

  const nameFiltered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return customerList.slice(0,8); // show first results immediately
    return customerList.filter(c => (c.full_name||c.fullName||c.name||'').toLowerCase().includes(q)).slice(0,8);
  }, [nameQuery, customerList]);
  const mobileFiltered = useMemo(() => {
    const q = mobileQuery.trim();
    if (!q) return [] as CustomerRecord[];
    return customerList.filter(c => (c.mobile||c.phone||'').includes(q)).slice(0,8);
  }, [mobileQuery, customerList]);

  const applyCustomerRecord = (rec: CustomerRecord) => {
    setCustomer(c => ({
      ...c,
      fullName: (rec.full_name||rec.fullName||rec.name||c.fullName||''),
      mobile: (rec.mobile||rec.phone||c.mobile||''),
      email: rec.email || c.email || '',
      address: rec.address || c.address || '',
      gstin: rec.gstin || rec.gst_no || rec.gst_number || c.gstin || '',
      // Auto-fill IDs as well
      aadhaar: (rec as any).aadhaar || rec.aadhar_no || (c as any).aadhaar || '',
      pan: (rec as any).pan || rec.pan_no || (c as any).pan || '',
    }));
  if (rec.id != null) setSelectedCustomerId(rec.id as any);
    setFieldErrors(prev => ({ ...prev, fullName: '', mobile: '' }));
  };

  useEffect(() => {
    const name = searchParams.get("customer");
    if (name) setCustomer((c) => ({ ...c, fullName: name }));
  }, [searchParams]);

  // load services and payment modes in a single grouped read
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mastersInFlight.current) return; // guard duplicate in StrictMode
        mastersInFlight.current = true;
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
  // Include HSN & Tax masters so we can derive hall-specific tax from mapped HSN
  const tables = [
    MASTER_TABLES.service,
    MASTER_TABLES.paymode,
    MASTER_TABLES.event_type,
    MASTER_TABLES.hall,
    MASTER_TABLES.shiftslot,
    MASTER_TABLES.hsn,
    MASTER_TABLES.tax,
  ];
        // First fetch master tables only
        const editIdParam = searchParams.get('editId');
        const res = await DataService.readData(tables, accountCode, retailCode);
        let dataMap: any = (res as any)?.data || {};

        // backend may return an array when single table requested; normalize
        if (Array.isArray(dataMap)) {
          const tname = tables[0];
          const tmp: Record<string, any[]> = {};
          tmp[tname] = dataMap;
          dataMap = tmp;
        }

        // When editing a booking, derive a numeric booking_id (e.g., INV-1 -> 1) and use it for /read-by-booking
        if (editIdParam) {
          try {
            // Use the display booking_id exactly as provided (e.g., INV-1) so it matches the DB value
            const resolved = String(editIdParam).trim();
            const extra = await DataService.readByBooking(
              ['booking', 'booking_service', 'booking_payment'],
              accountCode,
              retailCode,
              resolved
            );
            const extraData: any = (extra as any)?.data || {};
            if (Array.isArray(extraData)) {
              // Should not happen for multiple tables, but guard just in case
            } else if (extraData && typeof extraData === 'object') {
              dataMap = { ...(dataMap || {}), ...extraData };
            }
          } catch (e) {
            console.warn('Failed to load booking-scoped data via /read-by-booking', e);
          }
        }

  // parse services
        const svcRows = dataMap[MASTER_TABLES.service] || [];
        if (mounted && Array.isArray(svcRows) && svcRows.length > 0) {
          const mapped: Service[] = svcRows.map((r: any, idx: number) => ({
            id: String(r.service_id ?? r.id ?? `svc-${idx}`),
            name: String(r.service_name ?? r.service_description ?? r.service ?? r.name ?? '').trim() || `Service ${idx+1}`,
            price: Number(r.price ?? r.seasonal_price ?? 0) || 0,
            category: String(r.category_name ?? r.service_category ?? r.category ?? '').trim() || undefined,
            taxId: ((): string | undefined => {
              const raw = r.tax_id ?? r.taxId ?? r.tax_code ?? r.tax;
              const v = raw != null ? String(raw).trim() : '';
              return v ? v : undefined;
            })(),
          }));
          setAvailableServices(mapped);
          // Initialize editable prices for any new services; drop removed ones
          setServicePrices(prev => {
            const next: Record<string, number> = { ...prev };
            const idSet = new Set<string>();
            mapped.forEach(s => {
              idSet.add(s.id);
              if (next[s.id] == null || isNaN(Number(next[s.id]))) next[s.id] = Number(s.price) || 0;
            });
            Object.keys(next).forEach(k => { if (!idSet.has(k)) delete next[k]; });
            return next;
          });
        } else if (mounted) {
          setAvailableServices(FALLBACK_SERVICES);
          // Initialize prices from fallback if empty
          setServicePrices(prev => {
            const next: Record<string, number> = { ...prev };
            const idSet = new Set<string>();
            FALLBACK_SERVICES.forEach(s => {
              idSet.add(s.id);
              if (next[s.id] == null || isNaN(Number(next[s.id]))) next[s.id] = Number(s.price) || 0;
            });
            Object.keys(next).forEach(k => { if (!idSet.has(k)) delete next[k]; });
            return next;
          });
        }

        // parse payment modes
        const pmRows = dataMap[MASTER_TABLES.paymode] || [];
        if (mounted && Array.isArray(pmRows) && pmRows.length > 0) {
          const sorted = [...pmRows].sort((a:any,b:any)=>{
            const get = (x:any) => Number(x.display_order ?? x.displayOrder ?? x.displayorder ?? 1e9) || 1e9;
            const da = get(a), db = get(b);
            if (da !== db) return da - db;
            const na = String(a.payment_mode_name ?? a.name ?? a.mode ?? '');
            const nb = String(b.payment_mode_name ?? b.name ?? b.mode ?? '');
            return na.localeCompare(nb);
          });
          const opts = sorted.map((r: any, idx: number) => ({
            value: String(r.payment_id ?? r.id ?? `pm-${idx}`),
            label: String(r.payment_mode_name ?? r.name ?? r.mode ?? '').trim() || `Mode ${idx+1}`,
          }));
          setPaymentModes(opts);
          if (!opts.find(o => o.value === paymentMode)) setPaymentMode(opts[0]?.value || paymentMode);
        }

  // parse event types
  const etRows = dataMap[MASTER_TABLES.event_type] || [];
  if (mounted && Array.isArray(etRows) && etRows.length > 0) {
          const opts = etRows.map((r: any, idx: number) => ({
            value: String(r.event_type_id ?? r.id ?? r.event_type_name ?? `et-${idx}`),
            label: String(r.event_type_name ?? r.name ?? r.event_type ?? '').trim() || `Type ${idx+1}`,
          }));
          setEventTypes(opts);
          // Robust edit prefill: resolve using URL params directly to avoid ambiguity
          const editId = searchParams.get('editId');
          const idParam = searchParams.get('eventTypeId');
          const labelParam = searchParams.get('purpose');
          if (editId) {
            if (idParam && opts.some(o => o.value === String(idParam))) {
              setEventType(prev => prev && opts.some(o => o.value === prev) ? prev : String(idParam));
            } else if (labelParam) {
              const match = opts.find(o => o.label.toLowerCase() === String(labelParam).toLowerCase());
              if (match) setEventType(prev => prev && opts.some(o => o.value === prev) ? prev : match.value);
            } else if (!eventType || !opts.some(o => o.value === eventType)) {
              setEventType(opts[0]?.value || '');
            }
          } else {
            if (!opts.find(o => o.value === eventType)) setEventType(opts[0]?.value || eventType);
          }
        } else if (mounted) {
          // No event types in masters: build a sensible fallback list and try to preselect from URL label
          const fallbackOpts = [
            { value: 'wedding', label: 'Wedding' },
            { value: 'birthday', label: 'Birthday' },
            { value: 'corporate', label: 'Corporate' },
            { value: 'conference', label: 'Conference' },
            { value: 'other', label: 'Other' },
          ];
          const editId = searchParams.get('editId');
          if (editId) {
            const labelParam = (searchParams.get('purpose') || '').trim();
            if (labelParam) {
              const match = fallbackOpts.find(o => o.label.toLowerCase() === labelParam.toLowerCase());
              if (match) {
                setEventTypes(fallbackOpts);
                setEventType(match.value);
              } else {
                // Add the label as a dynamic option so it can display
                const dynVal = labelParam.toLowerCase().replace(/\s+/g, '_');
                const dyn = { value: dynVal, label: labelParam };
                setEventTypes([dyn, ...fallbackOpts]);
                setEventType(dyn.value);
              }
            } else {
              setEventTypes(fallbackOpts);
              if (!eventType) setEventType(fallbackOpts[0].value);
            }
          } else {
            setEventTypes(fallbackOpts);
            if (!eventType) setEventType(fallbackOpts[0].value);
          }
        }

        // Build HSN & Tax lookup maps to derive hall tax
        const hsnRows = dataMap[MASTER_TABLES.hsn] || [];
        const taxRows = dataMap[MASTER_TABLES.tax] || [];

        const hsnMap: Record<string, any> = {};
        hsnRows.forEach((h: any) => {
          const key = String(h.hsn_id ?? h.id ?? h.hsn_code ?? h.code ?? '').trim();
          if (key) hsnMap[key] = h;
        });
        const taxMap: Record<string, any> = {};
        taxRows.forEach((t: any) => {
          const key = String(t.tax_id ?? t.id ?? t.tax_code ?? t.code ?? '').trim();
          if (key) taxMap[key] = t;
        });

              // Helper for service rendering: map taxId -> numeric rate (0..1) and cache
              const serviceTaxMap: Record<string, number | undefined> = {};
              const extractNumericRate = (rec: any): number | undefined => {
                if (!rec) return undefined;
                let r: any = rec.tax_rate ?? rec.rate ?? rec.percentage ?? rec.total_rate ?? rec.gst_percentage ?? rec.gst_percent ?? rec.tax_percent;
                const cgst = rec.cgst ?? rec.cgst_rate;
                const sgst = rec.sgst ?? rec.sgst_rate;
                if ((cgst != null || sgst != null) && (r == null || r === '')) {
                  const cg = Number(cgst) || 0; const sg = Number(sgst) || 0; const combined = cg + sg; if (combined > 0) r = combined;
                }
                if (r == null) return undefined;
                r = Number(r);
                if (isNaN(r)) return undefined;
                if (r > 1.5) r = r / 100; // treat percent like 18 -> 0.18
                return r;
              };
              Object.keys(taxMap).forEach(k => { serviceTaxMap[k] = extractNumericRate(taxMap[k]); });

              // persist map to state so downstream view can access it
              try { setServiceTaxMapState(serviceTaxMap); } catch {}

              const roundTo2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

        // Helper to extract numeric total rate (0-1) from a record
        const extractRate = (rec: any): number | undefined => {
          if (!rec) return undefined;
          let rate: any = rec.tax_rate ?? rec.rate ?? rec.percentage ?? rec.total_rate ?? rec.gst_percentage ?? rec.gst_percent ?? rec.tax_percent;
            const cgst = rec.cgst ?? rec.cgst_rate;
            const sgst = rec.sgst ?? rec.sgst_rate;
            if (cgst != null && sgst != null) {
              const cg = Number(cgst) || 0; const sg = Number(sgst) || 0;
              const combined = cg + sg;
              if (combined > 0) rate = combined; // treat as percent if >1
            }
          if (rate == null) return undefined;
          rate = Number(rate);
          if (isNaN(rate)) return undefined;
          // If looks like percentage (e.g. 18) convert to fraction (0.18)
            if (rate > 1.5) rate = rate / 100;
          return rate;
        };

  // parse halls with tax derivation
  const hallRows = dataMap[MASTER_TABLES.hall] || [];
  if (mounted && Array.isArray(hallRows) && hallRows.length > 0) {
          // Helper to parse a number even if currency symbols are present
          const toNumber = (val: any): number => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const m = val.replace(/[,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
              if (m) return Number(m[0]);
            }
            return NaN;
          };
          // Helper to find a numeric rate from any plausible field
          const findNumericRate = (r: any): number => {
            const knownFields = [
              'price','hourly_rate','hourlyRate','hall_rate','hall_rent','rate_per_hour','rate','rent','base_price','amount','amount_per_hour','per_hour','per_day','hallrent','hallrate','rentamount','hall_amount'
            ];
            for (const k of knownFields) {
              if (r[k] != null) {
                const n = toNumber(r[k]);
                if (!isNaN(n) && n > 0) return n;
              }
            }
            // Case-insensitive scan
            for (const [k, v] of Object.entries(r)) {
              if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) {
                const low = k.toLowerCase();
                if (/(rate|rent|price|amount)/.test(low)) {
                  const n = toNumber(v as any);
                  if (!isNaN(n) && n > 0) return n;
                }
              }
            }
            return 0;
          };
          let mappedHalls: Hall[] = hallRows.map((r: any, idx: number) => {
            const hallHsnKey = String(r.hsn_id ?? r.hsnId ?? r.hsn ?? r.hsn_code ?? '').trim();
            // Try multiple fields for hall rate to avoid 0 when schema differs
            const rawRate = findNumericRate(r);
            // Discover a dedicated dual-slot price if present on the master
        // Dual slot pricing removed
            const base: Hall = {
              id: String(r.hall_id ?? r.id ?? `h-${idx}`),
              name: String(r.hall_name ?? r.name ?? r.hall ?? `Hall ${idx+1}`),
              capacity: Number(r.capacity ?? r.seating_capacity ?? r.max_guests ?? 0) || 0,
              hourlyRate: Number(rawRate) || 0,
              // Capture full-day price from common field names
              fullDayPrice: ((): number | undefined => {
                const candidates = [
                  r.fullday_price, r.full_day_price, r.full_dayprice, r.full_dayrate, r.fulldayrate,
                  r.fullday, r.full_day, r.day_rate, r.per_day, r.daily_rate, r.daily_price, r.perday
                ];
                for (const v of candidates) {
                  const n = toNumber(v);
                  if (!isNaN(n) && n > 0) return n;
                }
                return undefined;
              })(),
          // dualslotPrice: undefined,
              hsnCode: hallHsnKey || undefined,
              hsnDescription: undefined,
              images: Array.isArray(r.images) ? r.images : (r.images ? [String(r.images)] : ["/placeholder.svg"]),
              isAvailable: (r.STATUS === 'Active' || r.status === 'Active' || r.isAvailable === true || r.STATUS === 1 || r.status === 1) ? true : false,
            };

            // Derive tax via hall -> hsn -> tax
            let derivedRate: number | undefined;
            if (hallHsnKey && hsnMap[hallHsnKey]) {
              const hsnRec = hsnMap[hallHsnKey];
              // capture description text from HSN
              base.hsnDescription = String(
                hsnRec.hsn_description ?? hsnRec.description ?? hsnRec.hsn_name ?? hsnRec.name ?? ''
              ).trim() || undefined;
              // Rate directly on HSN
              derivedRate = extractRate(hsnRec);
              // If HSN references tax
              const taxKey = String(hsnRec.tax_id ?? hsnRec.taxId ?? hsnRec.tax ?? '').trim();
              if (!derivedRate && taxKey && taxMap[taxKey]) {
                derivedRate = extractRate(taxMap[taxKey]);
              }
            }
            // Direct tax fields on hall as fallback
            if (!derivedRate) {
              const directRate = extractRate(r);
              if (directRate) derivedRate = directRate;
            }
            return { ...base, taxRate: derivedRate };
          });
          // If URL provides a hall that isn't present in masters, inject a minimal option so it can display
          {
            const hallIdParam = searchParams.get('hallId') || '';
            const hallNameParam = searchParams.get('hallName') || '';
            const hasId = hallIdParam && mappedHalls.some(h => String(h.id) === String(hallIdParam));
            const hasName = hallNameParam && mappedHalls.some(h => String(h.name).trim().toLowerCase() === String(hallNameParam).trim().toLowerCase());
            if (!hasId && !hasName && (hallIdParam || hallNameParam)) {
              const id = String(hallIdParam || hallNameParam);
              const name = hallNameParam ? String(hallNameParam) : `Hall ${id}`;
              mappedHalls = [
                ...mappedHalls,
                { id, name, capacity: 0, hourlyRate: 0, images: [], isAvailable: true }
              ];
            }
          }
          setMasterHalls(mappedHalls);
          // After halls load, reconcile any hall preselection from URL (create or edit mode)
          {
            const hallIdParam = searchParams.get('hallId') || '';
            const hallNameParam = searchParams.get('hallName') || '';
            const norm = (s:string)=> s.trim().toLowerCase();
            let resolvedId: string | null = null;
            if (hallIdParam) {
              // exact id match first
              const byIdExact = mappedHalls.find(h => String(h.id) === String(hallIdParam));
              if (byIdExact) resolvedId = String(byIdExact.id);
              else {
                // try numeric-only match (URLs sometimes carry prefixed ids)
                const digits = String(hallIdParam).replace(/\D+/g, '');
                if (digits) {
                  const byDigits = mappedHalls.find(h => String(h.id).replace(/\D+/g,'') === digits);
                  if (byDigits) resolvedId = String(byDigits.id);
                }
              }
            }
            if (!resolvedId && hallNameParam) {
              const byNameExact = mappedHalls.find(h => norm(h.name) === norm(hallNameParam));
              if (byNameExact) resolvedId = String(byNameExact.id);
              else {
                const byNamePartial = mappedHalls.find(h => norm(h.name).includes(norm(hallNameParam)));
                if (byNamePartial) resolvedId = String(byNamePartial.id);
              }
            }
            if (resolvedId) {
              setSelectedHallId(resolvedId);
              // Lock only in edit mode (create mode should stay editable)
              if (searchParams.get('editId')) setLockedHall(true);
            }
          }
          // Reconcile selection for edit mode after halls load
          const editId = searchParams.get('editId');
          if (editId) {
            const hallIdParam = searchParams.get('hallId') || '';
            const hallNameParam = searchParams.get('hallName') || '';
            const norm = (s:string)=> s.trim().toLowerCase();
            const hasId = hallIdParam && mappedHalls.some(h => norm(h.id) === norm(hallIdParam));
            if (hasId) {
              setSelectedHallId(prev => prev || hallIdParam);
              setLockedHall(true);
            } else if (hallNameParam) {
              const byNameExact = mappedHalls.find(h => norm(h.name) === norm(hallNameParam));
              if (byNameExact) { setSelectedHallId(prev => prev || byNameExact.id); setLockedHall(true); }
              else {
                const byNamePartial = mappedHalls.find(h => norm(h.name).includes(norm(hallNameParam)));
                if (byNamePartial) { setSelectedHallId(prev => prev || byNamePartial.id); setLockedHall(true); }
              }
            } else if (!selectedHallId && mappedHalls.length === 1) {
              setSelectedHallId(mappedHalls[0].id);
            }
          }
        } else if (mounted) {
          // Fallback when no hall masters are returned: if URL has hallId/hallName, inject a minimal option
          const hallIdParam = searchParams.get('hallId') || '';
          const hallNameParam = searchParams.get('hallName') || '';
          if (hallIdParam || hallNameParam) {
            const id = String(hallIdParam || hallNameParam).trim();
            const name = hallNameParam ? String(hallNameParam).trim() : `Hall ${id}`;
            const fallback: Hall = {
              id,
              name,
              capacity: 0,
              hourlyRate: 0,
              images: [],
              isAvailable: true,
              fullDayPrice: undefined,
              taxRate: undefined,
              hsnCode: undefined,
              hsnDescription: undefined,
            };
            setMasterHalls([fallback]);
            // Respect prefill but keep editable in create mode
            setSelectedHallId(prev => prev || id);
            // Do not lock in fallback so user can change once masters arrive
            setLockedHall(false);
          }
        }
  // parse event slots (master_slot)
  const slotRows = dataMap[MASTER_TABLES.shiftslot] || [];
  if (mounted && Array.isArray(slotRows) && slotRows.length > 0) {
          const normalizeTime = (t: any, fallback: string) => {
            if (!t) return fallback;
            const str = String(t);
            const m = str.match(/(\d{2}:\d{2})/);
            return m ? m[1] : fallback;
          };
          const mapped = slotRows.map((r: any, idx: number) => {
            const id = String(r.slot_id ?? r.id ?? `slot-${idx}`);
            const rawName = String(r.slot_name ?? r.name ?? r.shift_name ?? r.slot ?? '').trim() || `Slot ${idx + 1}`;
            const start = normalizeTime(r.fromtime || r.from_time || r.start_time || r.start, '00:00');
            const end = normalizeTime(r.totime || r.to_time || r.end_time || r.end, '23:59');
            const timeLabel = start === end ? start : `${start} - ${end}`;
            return {
              value: id,
              label: `${rawName} (${timeLabel})`,
              _start: start,
              _end: end,
              _name: rawName,
            };
          });
          // Sort by start time (HH:MM)
          mapped.sort((a, b) => (a._start < b._start ? -1 : a._start > b._start ? 1 : 0));
          // Build final options list and ensure the URL slotId is present even if masters don't include it
          let optsAll = mapped.map(({ value, label }) => ({ value, label }));
          const slotParam = searchParams.get('slotId') || searchParams.get('slot');
          if (slotParam && !optsAll.some(o => String(o.value) === String(slotParam))) {
            optsAll = [{ value: String(slotParam), label: `Slot ${String(slotParam)}` }, ...optsAll];
          }
          setEventSlots(optsAll);
          if (slotParam && optsAll.find(o => String(o.value) === String(slotParam))) {
            // Always honor explicit slot from calendar
            setEventSlot(String(slotParam));
          } else if (lockedSlot) {
            if (!optsAll.find(o => String(o.value) === String(eventSlot))) setEventSlot(optsAll[0]?.value || '');
          } else if (!eventSlot) {
            setEventSlot(optsAll[0]?.value || '');
          }
          // If URL requests fullDay or multiple slots, build multiSlots rows
          const slotIdsParam = (searchParams.get('slotIds') || '').trim();
          const fullDayParam = (searchParams.get('fullDay') || '').trim();
          const dateParam = searchParams.get('date') || startDateTime || '';
          const multiSlotsParam = (searchParams.get('multiSlots') || '').trim();

          // If multiSlots JSON is provided (supports multiple dates), parse it first
          if (multiSlotsParam) {
            try {
              const decoded = JSON.parse(decodeURIComponent(multiSlotsParam));
              if (Array.isArray(decoded) && decoded.length > 0) {
                const attendeesRaw = (searchParams.get('attendees') || searchParams.get('expectedGuests') || '');
                const attendeesNum: number | '' = (attendeesRaw && !isNaN(Number(attendeesRaw))) ? Number(attendeesRaw) : (typeof expectedGuests === 'number' ? expectedGuests : '');
                const defaultEventType = (searchParams.get('eventTypeId') || eventType) || (eventTypes[0]?.value || '');
                const rows: any[] = [];
                decoded.forEach((entry: any) => {
                  const d = String(entry.date || '').trim();
                  const ids: string[] = Array.isArray(entry.slotIds) ? entry.slotIds.map(String) : (String(entry.slotIds||'').split(',').map((s:string)=>s.trim()).filter(Boolean));
                  ids.forEach(id => rows.push({ id, date: d, eventType: defaultEventType, eventSlot: id, expectedGuests: attendeesNum }));
                });
                if (rows.length > 0) {
                  setMultiSlots(rows);
                  // For multi-date, we allow editing dates per-row, so do not lock date; but lock hall selection
                  setLockedDate(false);
                  setLockedSlot(false);
                  setLockedHall(false);
                }
              }
            } catch (e) {
              // fall back to older params
            }
          }
          else if ((fullDayParam === '1' || slotIdsParam) && dateParam) {
            // Prefer explicit slot ids if provided; else map fullDay to current slot options
            const ids = (slotIdsParam ? slotIdsParam.split(',').map(s=>s.trim()).filter(Boolean) : optsAll.map(o => String(o.value)))
              .filter(id => optsAll.some(o => String(o.value) === String(id)));
            if (ids.length > 0) {
              const attendeesRaw = (searchParams.get('attendees') || searchParams.get('expectedGuests') || '');
              const attendeesNum: number | '' = (attendeesRaw && !isNaN(Number(attendeesRaw))) ? Number(attendeesRaw) : (typeof expectedGuests === 'number' ? expectedGuests : '');
              const defaultEventType = (searchParams.get('eventTypeId') || eventType) || (eventTypes[0]?.value || '');
              const rows = ids.map(id => ({ id, date: dateParam, eventType: defaultEventType, eventSlot: id, expectedGuests: attendeesNum }));
              setMultiSlots(rows);
              // Lock date & slot dropdowns when multi-row created from calendar
              setLockedDate(true);
              setLockedSlot(true);
            }
          }
          // Fallbacks to resolve hall via slot if current selection is invalid or missing
          const editId = searchParams.get('editId');
          if (editId) {
            const slotIdParam = searchParams.get('slotId') || '';
            const selectedExists = selectedHallId && masterHalls.some(h => String(h.id) === String(selectedHallId));
            if (slotIdParam && !selectedExists) {
              const slotRec = slotRows.find((r:any)=> String(r.slot_id ?? r.id ?? r._id) === slotIdParam);
              const hallFromSlot = slotRec ? String(slotRec.hall_id ?? slotRec.hallId ?? '') : '';
              if (hallFromSlot && masterHalls.find(h => String(h.id) === hallFromSlot)) {
                setSelectedHallId(hallFromSlot);
              }
            }
          }
        } else if (mounted) {
          // Fallback when no slot masters are returned: if URL has slotId/slot, inject a minimal option
          const slotParam = searchParams.get('slotId') || searchParams.get('slot') || '';
          if (slotParam) {
            const opt = { value: String(slotParam), label: `Slot ${String(slotParam)}` };
            setEventSlots([opt]);
            setEventSlot(prev => prev || String(slotParam));
            setLockedSlot(true);
          }
        }

  // Compute existing paid amount for this booking in edit mode
        if (mounted && editIdParam) {
          try {
            const payRows: any[] = dataMap['booking_payment'] || dataMap['booking_payments'] || [];
            const rawParam = String(editIdParam);
            const onlyDigits = (rawParam.match(/(\d{1,})/) || [,''])[1] || '';
            const candidates = new Set<string>([rawParam]);
            if (onlyDigits) {
              candidates.add(onlyDigits);
              candidates.add(`INV-${onlyDigits}`);
              candidates.add(`INV${onlyDigits}`);
            }
            // Also derive from booking table if present
            try {
              const bRows: any[] = dataMap['booking'] || [];
              if (Array.isArray(bRows) && bRows.length > 0) {
                const matchBooking = (r:any) => {
                  const vals = [r.booking_id, r.bookingId, r.bookingID, r.id, r.ID, r.booking_display_id, r.display_id, r.invoice_no, r.invoice_number]
                    .map((v:any)=> v!=null ? String(v) : '').filter(Boolean);
                  return vals.some(v => {
                    if (candidates.has(v)) return true;
                    const vDigits = v.replace(/\D+/g,'');
                    return onlyDigits && vDigits === onlyDigits;
                  });
                };
                const bRec = bRows.find(matchBooking);
                if (bRec) {
                  const bid = bRec.booking_id != null ? String(bRec.booking_id) : '';
                  const nid = bRec.id != null ? String(bRec.id) : '';
                  if (bid) candidates.add(bid);
                  if (nid) candidates.add(nid);
                }
              }
            } catch { /* ignore */ }
            const sum = payRows
              .filter((p:any) => {
                const fk = String(p.booking_id || p.bookingID || p.bookingId || '');
                if (!fk) return false;
                if (candidates.has(fk)) return true;
                const fkDigits = fk.replace(/\D+/g,'');
                return onlyDigits && fkDigits === onlyDigits;
              })
              .reduce((acc:number, p:any) => acc + (Number(p.amount || p.paid_amount || 0) || 0), 0);
            setExistingPaid(sum || 0);
          } catch {
            setExistingPaid(0);
          }
        }

        // Edit mode: prefill multiSlots from hallbooking_calander so all rows render while editing
        if (mounted && editIdParam) {
          try {
            const calRowsRaw: any[] = dataMap['hallbooking_calander'] || dataMap['hallbooking_calendar'] || [];
            if (Array.isArray(calRowsRaw) && calRowsRaw.length > 0) {
              const rawParam = String(editIdParam);
              const onlyDigits = (rawParam.match(/(\d{1,})/) || [,'' ])[1] || '';
              const candidates = new Set<string>([rawParam]);
              if (onlyDigits) {
                candidates.add(onlyDigits);
                candidates.add(`INV-${onlyDigits}`);
                candidates.add(`INV${onlyDigits}`);
              }
              const calRows = calRowsRaw.filter((r:any) => {
                const fk = String(r.booking_id || r.bookingId || r.bookingID || '');
                if (!fk) return false;
                if (candidates.has(fk)) return true;
                const fkDigits = fk.replace(/\D+/g,'');
                return onlyDigits && fkDigits === onlyDigits;
              });
              if (calRows.length > 0) {
                const mapRow = (r:any) => {
                  const d = String(r.eventdate || r.date || '').slice(0,10);
                  const slot = String(r.slot_id || r.slotId || r.slot || '').trim();
                  const et = r.event_type_id != null ? String(r.event_type_id) : (eventType || '');
                  const guestsRaw = r.expected_guests ?? r.guests ?? r.attendees;
                  const guests = guestsRaw != null ? Number(guestsRaw) : (typeof expectedGuests === 'number' ? expectedGuests : '');
                  return { id: String(r.id || `${d}-${slot}`), date: d, eventType: et, eventSlot: slot, expectedGuests: (Number.isFinite(guests) ? Number(guests) : '') as any };
                };
                const key = (row:any) => `${row.date}__${row.eventSlot}`;
                const dedup: Record<string, any> = {};
                calRows.forEach(r => {
                  const m = mapRow(r);
                  if (!m.date || !m.eventSlot) return;
                  dedup[key(m)] = m;
                });
                const rows = Object.values(dedup);
                const slotOrder: Record<string, number> = {};
                try { (eventSlots || []).forEach((s:any, idx:number) => { slotOrder[String(s.value)] = idx; }); } catch {}
                rows.sort((a:any, b:any) => {
                  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
                  const ao = slotOrder[a.eventSlot];
                  const bo = slotOrder[b.eventSlot];
                  if (ao != null && bo != null) return ao - bo;
                  const an = Number(a.eventSlot); const bn = Number(b.eventSlot);
                  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
                  return String(a.eventSlot).localeCompare(String(b.eventSlot));
                });
                if (rows.length > 0) {
                  setMultiSlots(rows as any);
                  const first: any = rows[0];
                  if (!startDateTime && first?.date) setStartDateTime(first.date);
                  if (!eventSlot && first?.eventSlot) setEventSlot(first.eventSlot);
                  if (!eventType && first?.eventType) setEventType(first.eventType);
                }
              }
            }
          } catch { /* ignore calendar prefill errors */ }
        }

        // Set selectedCustomerId and discount from booking row in edit mode
        if (mounted && editIdParam) {
          try {
            const rows: any[] = dataMap['booking'] || [];
            const raw = String(editIdParam);
            const routeDigits = raw.replace(/\D+/g, '');
            const matchesTarget = (r:any) => {
              const cand: string[] = [
                r.booking_id, r.bookingId, r.bookingID,
                r.id, r.ID,
                r.booking_display_id, r.display_id, r.invoice_no, r.invoice_number
              ].map((v:any)=> v!=null ? String(v) : '').filter(Boolean);
              if (cand.includes(raw)) return true;
              if (routeDigits) {
                const has = cand.some(c => c.replace(/\D+/g,'') === routeDigits);
                if (has) return true;
              }
              return false;
            };
            const rec = rows.find(matchesTarget);
            if (rec) {
              const cid = rec.customer_id ?? rec.customerId ?? rec.customerid;
              if (cid != null) setSelectedCustomerId(cid);
              // Prefill tax exemption toggle from booking row when present
              try {
                const tval = rec.tax_exempt ?? rec.taxExempt ?? rec.is_tax_exempt;
                if (tval != null) {
                  const b = ((): boolean => {
                    if (tval === true || tval === false) return !!tval;
                    const s = String(tval).trim().toLowerCase();
                    if (!s) return false;
                    if (s === '1' || s === 'true' || s === 't' || s === 'yes' || s === 'y' || s === 'on') return true;
                    return false;
                  })();
                  setTaxExempt(b);
                }
              } catch { /* ignore */ }
              // Capture booking status for UI (normalize canceled/cancelled)
              const rawStatus = rec.STATUS ?? rec.status ?? rec.booking_status ?? rec.state ?? '';
              if (rawStatus != null) {
                let s = String(rawStatus).trim().toLowerCase();
                if (s === 'canceled') s = 'cancelled';
                setBookingStatus(s);
              }
              // Prefill customer details from booking record, then override with master_customer if available
              try {
                // Base from booking row (backward compatible)
                setCustomer(prev => ({
                  ...prev,
                  fullName: prev.fullName || rec.customer_name || rec.full_name || rec.name || '',
                  mobile: prev.mobile || rec.phone || rec.mobile || rec.customer_mobile || '',
                  email: prev.email || rec.email || rec.customer_email || '',
                  address: prev.address || rec.address || rec.customer_address || '',
                  gstin: prev.gstin || rec.gstin || rec.gst_no || rec.gst_number || '',
                  aadhaar: prev.aadhaar || rec.aadhaar || rec.aadhar || rec.aadhar_no || rec.aadhaar_no || '',
                  pan: prev.pan || rec.pan || rec.pan_no || rec.pancard || rec.pancard_no || '',
                }));

                // If master_customer came from /read-by-booking, prefer those authoritative values
                try {
                  const customers: any[] = (dataMap && (dataMap['master_customer'] || dataMap['customer_master'] || dataMap['customers'])) || [];
                  const cidStr = String(cid ?? '') || String(rec.customer_id ?? rec.customerId ?? rec.customerid ?? '');
                  const match = customers.find((c: any) => String(c.customer_id ?? c.id ?? '') === cidStr);
                  if (match) {
                    setCustomer(prev => ({
                      ...prev,
                      fullName: match.customer_name || match.full_name || match.name || prev.fullName || '',
                      mobile: match.customer_mobile || match.mobile || match.phone || match.phone1 || prev.mobile || '',
                      email: match.email || match.email_id || match.customer_email || match.mail || match.customerEmail || prev.email || '',
                      address: match.address ?? prev.address ?? '',
                      gstin: match.gstin || match.gst_no || match.gst_number || prev.gstin || '',
                      aadhaar: match.aadhaar || match.aadhar_no || match.aadhaar_no || prev.aadhaar || '',
                      pan: match.pan || match.pan_no || prev.pan || '',
                    }));
                  }
                } catch { /* ignore enrichment */ }
              } catch { /* ignore */ }
              // Prefill discount amount (absolute), not percentage; fallback to recompute if missing
              const discRaw = rec.discount ?? rec.discount_amount ?? rec.discount_amt ?? rec.disc_amount;
              let discNum = Number(discRaw);
              if (!Number.isFinite(discNum) || isNaN(discNum)) {
                const hall = Number(rec.hall_rate ?? 0) || 0;
                const svc = Number(rec.services_total ?? 0) || 0;
                const taxAmt = Number(rec.tax_amount ?? ((Number(rec.cgst_amount||0)+Number(rec.sgst_amount||0))||0)) || 0;
                const total = Number(rec.total_amount ?? rec.amount ?? 0) || 0;
                const computed = (hall + svc + taxAmt) - total;
                discNum = Number.isFinite(computed) ? Math.max(0, computed) : 0;
              }
              setDiscount(discNum);

              // Prefill editable Hall Rent from existing record if present
              try {
                const candidates = [rec.hall_rate, rec.hall_rent, rec.hallrent, rec.hall_amount, rec.base_price];
                for (const v of candidates) {
                  const n = Number(v);
                  if (Number.isFinite(n) && !isNaN(n) && n >= 0) { setHallRentOverride(n); break; }
                }
              } catch { /* ignore */ }

              // Dual-slot prefill removed
            }
          } catch { /* ignore */ }
        }

        // Prefill selected services for this booking in edit mode
        if (mounted && editIdParam) {
          try {
            const svcLines: any[] = dataMap['booking_service'] || dataMap['booking_services'] || [];
            // Build robust set of candidate booking identifiers to match lines
            const rawParam = String(editIdParam);
            const onlyDigits = (rawParam.match(/(\d{1,})/) || [,''])[1] || '';
            const candidates = new Set<string>([rawParam]);
            if (onlyDigits) {
              candidates.add(onlyDigits);
              candidates.add(`INV-${onlyDigits}`);
              candidates.add(`INV${onlyDigits}`);
            }
            // Also derive from booking table if present
            try {
              const bRows: any[] = dataMap['booking'] || [];
              if (Array.isArray(bRows) && bRows.length > 0) {
                const matchBooking = (r:any) => {
                  const vals = [r.booking_id, r.bookingId, r.bookingID, r.id, r.ID, r.booking_display_id, r.display_id, r.invoice_no, r.invoice_number]
                    .map((v:any)=> v!=null ? String(v) : '').filter(Boolean);
                  return vals.some(v => {
                    if (candidates.has(v)) return true;
                    const vDigits = v.replace(/\D+/g,'');
                    return onlyDigits && vDigits === onlyDigits;
                  });
                };
                const bRec = bRows.find(matchBooking);
                if (bRec) {
                  const bid = bRec.booking_id != null ? String(bRec.booking_id) : '';
                  const nid = bRec.id != null ? String(bRec.id) : '';
                  if (bid) candidates.add(bid);
                  if (nid) candidates.add(nid);
                }
              }
            } catch { /* ignore */ }
            const myLines = svcLines.filter((r:any) => {
              const fk = String(r.booking_id || r.bookingID || r.bookingId || '');
              if (!fk) return false;
              if (candidates.has(fk)) return true;
              const fkDigits = fk.replace(/\D+/g,'');
              return onlyDigits && fkDigits === onlyDigits;
            });
            if (myLines.length > 0) {
              // Ensure master contains these services; add minimal entries if missing
              const existingIds = new Set((availableServices||[]).map(s => String(s.id)));
              const missing: Service[] = [];
              myLines.forEach((ln:any, idx:number) => {
                const sid = String(ln.service_id ?? ln.serviceId ?? ln.sid ?? `svc-${idx}`);
                if (!existingIds.has(sid)) {
                  const unit = Number(ln.unit_price ?? ln.price ?? ln.amount ?? 0) || 0;
                  missing.push({ id: sid, name: `Service ${sid}`, price: unit, category: 'Imported' });
                  existingIds.add(sid);
                }
              });
              if (missing.length > 0) {
                setAvailableServices(prev => {
                  // Avoid duplicates if state changed since capture
                  const have = new Set((prev||[]).map(s => String(s.id)));
                  const toAdd = missing.filter(m => !have.has(String(m.id)));
                  return [...(prev||[]), ...toAdd];
                });
              }
              // Set selected services and prices
              const nextSel: Record<string, boolean> = {};
              const nextPrices: Record<string, number> = {};
              const nextExempt: Record<string, boolean> = {};
        myLines.forEach((ln:any) => {
                const sid = String(ln.service_id ?? ln.serviceId ?? ln.sid ?? '');
                if (!sid) return;
                nextSel[sid] = true;
                const unit = Number(ln.unit_price ?? ln.price ?? ln.amount ?? 0) || 0;
                nextPrices[sid] = unit;
                // Prefill exemption from persisted columns
                try {
          const raw = ln.taxexempted ?? ln.tax_exempt ?? ln.is_tax_exempt ?? ln.exempt ?? ln.taxexampted ?? ln.tax_exampted;
                  if (raw != null) {
                    const b = ((): boolean => {
                      if (raw === true || raw === false) return !!raw;
                      const s = String(raw).trim().toLowerCase();
                      if (!s) return false;
                      return ['1','true','t','yes','y','on'].includes(s);
                    })();
                    nextExempt[sid] = b;
                  }
                } catch {/* ignore */}
              });
              setServices(nextSel);
              setServicePrices(prev => ({ ...prev, ...nextPrices }));
              if (Object.keys(nextExempt).length > 0) setServiceTaxExempt(prev => ({ ...prev, ...nextExempt }));
              // Auto-expand services panel when there are selected lines
              setShowServices(true);
            }
            // Fallback: attempt customer prefill from a booking table variant if present
            try {
              const bRows2: any[] = dataMap['booking'] || dataMap['bookings'] || [];
              const cand = (bRows2 || []).find((r:any) => {
                const vals = [r.booking_id, r.id, r.booking_display_id, r.invoice_no]
                  .map((v:any)=> v!=null ? String(v) : '');
                return vals.some(v => v && (String(v)===String(editIdParam) || v.replace(/\D+/g,'')===String(editIdParam).replace(/\D+/g,'')));
              });
              if (cand) {
                setCustomer(prev => ({
                  ...prev,
                  fullName: prev.fullName || cand.customer_name || cand.full_name || cand.name || '',
                  mobile: prev.mobile || cand.phone || cand.mobile || cand.customer_mobile || '',
                  email: prev.email || cand.email || cand.customer_email || '',
                  address: prev.address || cand.address || cand.customer_address || '',
                  gstin: prev.gstin || cand.gstin || cand.gst_no || cand.gst_number || '',
                  aadhaar: prev.aadhaar || cand.aadhaar || cand.aadhar || cand.aadhar_no || cand.aadhaar_no || '',
                  pan: prev.pan || cand.pan || cand.pan_no || cand.pancard || cand.pancard_no || '',
                }));
              }
            } catch { /* ignore */ }
          } catch {
            // ignore
          }
        }

      } catch (err) {
        console.error('Failed to load masters', err);
        if (mounted) {
          setAvailableServices(FALLBACK_SERVICES);
        }
      } finally {
        mastersInFlight.current = false;
      }
    };
    load();
    return () => { mounted = false; };
  }, [user, searchParams]);
  // Load services from master_service table
  

  const selectedHall = masterHalls.find((h) => h.id === selectedHallId);

  // Final reconciliation: ensure slot from URL is selected and present in options after masters settle
  useEffect(() => {
    const editId = searchParams.get('editId');
    if (editId) return; // don't override edit mode values
    const slotParam = searchParams.get('slotId') || searchParams.get('slot');
    if (!slotParam) return;
    const sVal = String(slotParam);
    const hasOpt = Array.isArray(eventSlots) && eventSlots.some(o => String(o.value) === sVal);
    if (!hasOpt) {
      setEventSlots(prev => [{ value: sVal, label: `Slot ${sVal}` }, ...(Array.isArray(prev) ? prev : [])]);
    }
    if (eventSlot !== sVal) setEventSlot(sVal);
  }, [eventSlots, eventSlot, searchParams]);

  // Final reconciliation: ensure hall from URL is selected and present in options after masters settle
  useEffect(() => {
    const editId = searchParams.get('editId');
    if (editId) return; // don't override edit mode values
    const hallIdParam = searchParams.get('hallId');
    const hallNameParam = searchParams.get('hallName');
    const id = (hallIdParam || hallNameParam) ? String(hallIdParam || hallNameParam) : '';
    if (!id) return;
    const hasOpt = Array.isArray(masterHalls) && masterHalls.some(h => String(h.id) === id);
    if (!hasOpt) {
      const name = hallNameParam ? String(hallNameParam) : `Hall ${id}`;
      const fallback: Hall = { id, name, capacity: 0, hourlyRate: 0, images: [], isAvailable: true } as Hall;
      setMasterHalls(prev => ([...(Array.isArray(prev) ? prev : []), fallback]));
    }
    if (!selectedHallId) setSelectedHallId(id);
  }, [masterHalls, selectedHallId, searchParams]);

  // Edit mode: if a customer is selected but some fields are missing, fetch from customer master
  // Avoid background calls during edit unless user actively searches
  useEffect(() => {
    const need = !customer?.email || !customer?.address || !customer?.gstin || !(customer as any)?.aadhaar || !(customer as any)?.pan;
    if (!selectedCustomerId || !need) return;
    const isEdit = !!searchParams.get('editId');
    const userSearching = customerSearchTerm.trim().length > 0;
    if (isEdit && !userSearching) return;
    let cancelled = false;
    (async () => {
      try {
        const { ApiService } = await import('../services/apiService');
        // Try primary selectedCustomerId first; fallback to mobile/name if none found
        const primaryQ = String(selectedCustomerId);
        const altQ = customer?.mobile || customer?.fullName || '';
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        let rows: any[] = await ApiService.searchMasterCustomer(primaryQ, 10, accountCode, retailCode);
        if (!cancelled && (!rows || rows.length === 0) && altQ) {
          rows = await ApiService.searchMasterCustomer(altQ, 10, accountCode, retailCode);
        }
        if (cancelled) return;
        const match = (rows || []).find(r => String(r.id || r.customer_id) === String(selectedCustomerId)) || rows?.[0];
        if (match) {
          setCustomer(prev => ({
            ...prev,
            fullName: prev.fullName || match.customer_name || match.full_name || match.name || '',
            mobile: prev.mobile || match.customer_mobile || match.mobile || match.phone || '',
            email: prev.email || match.email || '',
            address: prev.address || match.address || '',
            gstin: prev.gstin || match.gstin || match.gst_no || match.gst_number || '',
            aadhaar: (prev as any).aadhaar || match.aadhar_no || '',
            pan: (prev as any).pan || match.pan_no || '',
          }));
        }
      } catch {
        // ignore errors
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCustomerId]);

  const parseDT = (v: string) => (v ? new Date(v) : null);

  const durationHours = (() => {
    // With single event date (no end) assume 1 slot = 1 hour (adjust if slot metadata includes duration)
    if (!startDateTime) return 0;
    return 1;
  })();

  // Services total (tax-inclusive): sum of (unit price + per-service tax) for selected services
  const servicesCost = useMemo(() => {
    try {
      let total = 0;
      for (const [id, selected] of Object.entries(services || {})) {
        if (!selected) continue;
        const svc = (availableServices || []).find(s => String(s.id) === String(id));
        const unitEdited = servicePrices?.[id];
        const unit = (unitEdited != null && !isNaN(Number(unitEdited)))
          ? Number(unitEdited)
          : Number(svc?.price || 0);
        // tax rate from precomputed map (already normalized to 0..1)
        const taxKey = (svc as any)?.taxId || (svc as any)?.tax_id || (svc as any)?.tax;
    // if service marked tax-exempt, force rate 0 for this line
    const exempt = !!serviceTaxExempt?.[String(id)];
    const baseRate = (taxKey != null) ? (serviceTaxMapState?.[String(taxKey)] ?? 0) : 0;
    const rate = exempt ? 0 : baseRate;
        const lineGross = unit * (1 + (Number(rate) || 0));
        total += lineGross;
      }
      // Round to 2 decimals to avoid floating drift
      return Math.round((total + Number.EPSILON) * 100) / 100;
    } catch {
      return 0;
    }
  }, [services, servicePrices, availableServices, serviceTaxMapState, serviceTaxExempt]);

  // Filter services by search text
  const filteredServices = useMemo(() => {
    const q = (serviceSearch || '').trim().toLowerCase();
    if (!q) return availableServices;
    return availableServices.filter((s) => {
      const name = String(s.name || '').toLowerCase();
      const cat = String(s.category || '').toLowerCase();
      return name.includes(q) || cat.includes(q);
    });
  }, [availableServices, serviceSearch]);
  // Compute hall rent:
  // - If multiple rows exist, group by date. For each date:
  //   * If the day has >1 unique slots and fullDayPrice is set, charge fullDayPrice for that day.
  //   * Else charge hourlyRate per slot (durationHours per slot).
  // - If only single-slot selection, use hourlyRate * durationHours.
  const computedHallRent = useMemo(() => {
    if (!selectedHall) return 0;
    const perSlotAmount = selectedHall.hourlyRate * Math.max(1, durationHours);
    const fullDay = Number(selectedHall.fullDayPrice) || 0;

    // Count total unique slots across the booking (date+slot pairs)
    let totalSlots = 0;
    if (Array.isArray(multiSlots) && multiSlots.length > 0) {
      const uniq = new Set<string>();
      for (const r of multiSlots) {
        const d = String(r?.date || '');
        const s = String(r?.eventSlot || '');
        if (!d || !s) continue;
        uniq.add(`${d}__${s}`);
      }
      totalSlots = uniq.size;
    } else if (eventSlot) {
      totalSlots = 1;
    }

    if (totalSlots <= 0) return 0;

    // Rule:
    // - Every 2 slots => one full-day charge (if available)
    // - Remaining 1 slot => hourly per-slot amount
    if (fullDay > 0 && totalSlots >= 2) {
      const fulls = Math.floor(totalSlots / 2);
      const rem = totalSlots % 2;
      return fulls * fullDay + rem * perSlotAmount;
    }
    // No full-day price configured or only one slot
    return perSlotAmount * totalSlots;
  }, [selectedHall, multiSlots, eventSlot, durationHours]);
  // Final hall rent used everywhere
  const hallRent = (hallRentOverride != null && !isNaN(Number(hallRentOverride)))
    ? Math.max(0, Number(hallRentOverride))
    : computedHallRent;
  // Remove default tax: apply only after a hall is chosen AND hall has a derived taxRate
  const hallTaxRate = selectedHall?.taxRate; // may be undefined
  const taxableAmount = selectedHall ? Math.max(0, hallRent) : 0;
  const tax = taxExempt ? 0 : (hallTaxRate ? hallTaxRate * taxableAmount : 0);
  const cgst = taxExempt ? 0 : (hallTaxRate ? tax / 2 : 0);
  const sgst = taxExempt ? 0 : (hallTaxRate ? tax / 2 : 0);
  const totalAmount = Math.max(0, hallRent + servicesCost + tax - discount);
  // Clamp new advance so total paid (existing + new) does not exceed total
  const maxAdditionalPayable = Math.max(0, totalAmount - (Number(existingPaid) || 0));
  const safeAdvance = Math.min(Math.max(0, Number(advancePayment) || 0), maxAdditionalPayable);
  const balanceDue = Math.max(0, totalAmount - ((Number(existingPaid) || 0) + safeAdvance));

  // bookingId will be generated by backend; removed frontend generation

  const toggleService = (k: string) => setServices((s) => ({ ...s, [k]: !s[k] }));
  const setServicePrice = (id: string, price: number) => {
    setServicePrices(prev => ({ ...prev, [id]: Math.max(0, Number(price) || 0) }));
  };


  const downloadSlip = () => {
    const slip = {
  // bookingId handled by backend
      customer,
      eventType,
  eventSlot,
      startDateTime,
  // endDateTime removed
      expectedGuests,
      selectedHall: selectedHall?.name || null,
      services,
      hallRent,
      servicesCost,
      tax,
      discount,
      existingPaid,
      advancePayment,
      totalAmount,
      balanceDue,
      paymentMode,
    };
    const blob = new Blob([JSON.stringify(slip, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
  a.download = `booking-data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validateBooking = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!customer.fullName || customer.fullName.trim().length < 3) errs.fullName = 'Customer full name is required (min 3 chars)';
    if (!customer.mobile || customer.mobile.trim().length < 6) errs.mobile = 'Valid mobile number is required';
    if (!selectedHallId) errs.selectedHall = 'Please select a hall';
    const hasMulti = Array.isArray(multiSlots) && multiSlots.length > 0;
    // Event Type can be set at header or per row; require if neither provided
    const rowsHaveType = hasMulti && multiSlots.every(r => !!r.eventType);
    if (!eventType && !rowsHaveType) errs.eventType = 'Select an event type';
    if (hasMulti) {
      // Validate per-row date/slot
      const bad = multiSlots.find(r => !r.date || !r.eventSlot);
      if (bad) {
        errs.eventSlot = 'Fill date and slot for all rows';
      }
    } else {
      if (!eventSlot) errs.eventSlot = 'Select an event slot';
      if (!startDateTime) errs.startDateTime = 'Select an event date';
    }
  // Dual-slot validation removed
  // Require an advance when creating a new booking if Due equals Total (i.e., nothing paid yet)
  const total = Number(totalAmount) || 0;
  const due = Number(balanceDue) || 0;
  const adv = Number(safeAdvance) || 0;
  if (!editModeId && total > 0 && due === total && adv <= 0) {
    errs.advancePayment = 'Advance amount is required to create a booking';
  }
  // Require payment mode if collecting any additional advance
  if ((Number(safeAdvance) || 0) > 0 && !paymentMode) errs.paymentMode = 'Select a payment mode';
  // Require payment references for specific modes
  if ((Number(safeAdvance) || 0) > 0 && paymentMode) {
    // Find selected paymode label for robust matching
    const sel = (paymentModes || []).find(pm => String(pm.value) === String(paymentMode));
    const label = String(sel?.label || '').toLowerCase();
    if (label.includes('upi')) {
      const v = (upiTxnId || '').trim();
      if (!v) errs.upiTxnId = 'UPI Transaction ID is required';
      else if (v.length < 4) errs.upiTxnId = 'UPI Transaction ID looks too short';
    }
    if (label.includes('cheque') || label.includes('check')) {
      const v = (chequeNo || '').trim();
      if (!v) errs.chequeNo = 'Cheque number is required';
      else if (v.length < 4) errs.chequeNo = 'Cheque number looks too short';
    }
  }
  // endDateTime validation removed
    return errs;
  };

  const handleConfirm = () => {
    // placeholder replaced by async saver below
  };

  const [isSaving, setIsSaving] = useState(false);
  const [createdBookingId, setCreatedBookingId] = useState<number | string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const rawEditId = searchParams.get('editId');
  // Normalize edit id: prefer numeric PK; handle formats like 'INV-123' by extracting digits
  const editModeId: string | number | null = (() => {
    if (!rawEditId) return null;
    const directNum = Number(rawEditId);
    if (Number.isFinite(directNum) && String(directNum) === rawEditId) return directNum;
    const m = String(rawEditId).match(/(\d{1,})/);
    if (m) return Number(m[1]);
    return rawEditId;
  })();

  // Ensure default Event Type is chosen in create mode and applied to multi-slot rows
  useEffect(() => {
    // Only for create (not edit) flow
    if (editModeId) return;
    if (!eventTypes || eventTypes.length === 0) return;
    const firstVal = eventTypes[0]?.value || '';
    if (!firstVal) return;
    // If no top-level eventType selected yet, default to the first option
    if (!eventType) setEventType(firstVal);
    // If multi-slot rows exist, ensure each row has an eventType; default to first
    setMultiSlots(prev => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let changed = false;
      const next = prev.map(r => {
        if (!r || r.eventType) return r;
        changed = true;
        return { ...r, eventType: firstVal };
      });
      return changed ? next : prev;
    });
  }, [eventTypes, editModeId]);

  // Reset all booking form fields
  const resetForm = () => {
  setCustomer({ fullName: '', mobile: '', email: '', address: '', gstin: '', aadhaar: '', pan: '' });
  setSelectedCustomerId(null);
    setEventType('');
    setEventSlot('');
    setStartDateTime('');
  // endDateTime reset removed
    setExpectedGuests('');
    setSpecialReq('');
    setSelectedHallId('');
    setServices({});
    setAdvancePayment(0);
    setPaymentMode(paymentModes[0]?.value || 'cash');
    setDiscount(0);
  setUpiTxnId('');
  setChequeNo('');
    setFieldErrors({});
    setCreatedBookingId(null);
  };

  const handleConfirmSave = async () => {
  if (isSaving) return; // simple in-flight guard to prevent duplicate submits
    const errors = validateBooking();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // TODO: focus first invalid field
      return;
    }

    setFieldErrors({});
    setIsSaving(true);
    setCreatedBookingId(null);

    try {
      const accountCode = (user as any)?.account_code || '';
      const retailCode = (user as any)?.retail_code || '';

      // Build booking payload matching SQL schema
  const bookingPayload: any = {
        // booking_code: OPTIONAL backend-generated
        account_code: accountCode,
        retail_code: retailCode,
        // customer_id will be assigned below based on create vs update
        hall_id: Number(selectedHallId) || null,
        event_type_id: eventType ? Number(eventType) : null,
        slot_id: eventSlot ? Number(eventSlot) : null,
        eventdate: startDateTime
          ? (/^\d{4}-\d{2}-\d{2}$/.test(startDateTime) ? `${startDateTime}T00:00:00` : startDateTime)
          : null,
        expected_guests: Number(expectedGuests) || 0,
        special_requirements: specialReq || null,
        customer_name: customer.fullName || null,
        full_name: customer.fullName || null,
        phone: customer.mobile || null,
        mobile: customer.mobile || null,
        email: customer.email || null,
        address: customer.address || null,
        gstin: customer.gstin || null,
  // Ensure identity details are sent to backend for new customer creation
  aadhaar: (customer as any).aadhaar || null,
  pan: (customer as any).pan || null,
        hall_rate: Number(hallRent) || 0,
        services_total: Number(servicesCost) || 0,
        discount: Number(discount) || 0,
        tax_rate: Number(hallTaxRate) || 0,
        tax_amount: Number(tax) || 0,
        cgst_amount: Number(cgst) || 0,
        sgst_amount: Number(sgst) || 0,
  total_amount: Number(totalAmount) || 0,
  // Persist net due after considering existing + new payments
  balance_due: Number(balanceDue) || 0,
  // Persist tax exemption flag in canonical backend column
  tax_exempt: !!taxExempt ? 1 : 0,
        // Default status: pending if due remains else confirmed; overridden to 'settled' on edit settlement (see below)
        STATUS: (Number(balanceDue) || 0) > 0 ? 'pending' : 'confirmed',
        created_by: (user as any)?.username || (user as any)?.user_id || null,
        updated_by: (user as any)?.username || null,
      };

  // Dual-slot payload fields removed

      // If we're in edit mode and Balance Due is 0, it's a settlement checkout -> mark as settled
      if (editModeId && Number(balanceDue) === 0) {
        bookingPayload.STATUS = 'settled';
      }

      // Assign customer_id: for create use 0 when new; for update omit if unchanged
      const parseCid = (raw:any) => {
        const n = Number(raw);
        if (Number.isFinite(n) && String(n) === String(raw)) return n;
        const m = String(raw).match(/\d+/);
        return m ? Number(m[0]) : raw;
      };
      if (editModeId) {
        if (selectedCustomerId != null) {
          bookingPayload.customer_id = parseCid(selectedCustomerId);
        }
        // else: omit field to avoid overwriting with 0
      } else {
        bookingPayload.customer_id = selectedCustomerId != null ? parseCid(selectedCustomerId) : 0;
      }

  // Call backend transactional endpoint to create booking + services + payment
      const selectedServiceIds = Object.entries(services).filter(([k, v]) => v).map(([k]) => k);
      const serviceLines = selectedServiceIds.map((sid) => {
        const svc = availableServices.find(s => s.id === sid);
        const edited = servicePrices[sid];
        const unit = (edited != null && !isNaN(Number(edited))) ? Number(edited) : (Number(svc?.price) || 0);
        const qty = 1;
        const amount = unit * qty;
        const taxKey = (svc as any)?.taxId ?? (svc as any)?.tax_id ?? (svc as any)?.tax;
        const exempt = !!serviceTaxExempt?.[String(sid)];
        const baseRate = taxKey != null ? (serviceTaxMapState?.[String(taxKey)] ?? 0) : 0;
        const rate = exempt ? 0 : (Number(baseRate) || 0);
        const cgstAmt = amount * (rate / 2);
        const sgstAmt = amount * (rate / 2);
        const totalLine = amount + cgstAmt + sgstAmt;
        const round2 = (v:number)=> Math.round((v + Number.EPSILON) * 100) / 100;
        const round3 = (v:number)=> Math.round((v + Number.EPSILON) * 1000) / 1000;
        return {
          service_id: Number(svc?.id) || svc?.id,
          qty,
          unit_price: round2(unit),
          amount: round2(amount),
          // Persist tax exemption at line-level as per DB column
          taxexempted: exempt ? 1 : 0,
          taxexampted: exempt ? 1 : 0,
          total_cgst: round3(cgstAmt),
          total_sgst: round3(sgstAmt),
          total_price: round3(totalLine),
          account_code: accountCode,
          retail_code: retailCode,
          created_by: (user as any)?.username || (user as any)?.user_id || undefined,
          updated_by: (user as any)?.username || undefined,
          tax_id: ((): any => {
            const t = (svc as any)?.taxId;
            if (t == null) return undefined;
            const n = Number(t);
            return Number.isFinite(n) && String(n) === String(t) ? n : String(t);
          })(),
        };
      });

  const paymentPayload = Number(safeAdvance) > 0 ? {
        payment_mode_id: paymentMode ? Number(paymentMode) : null,
        amount: Number(safeAdvance) || 0,
        // Include optional references based on mode
        transaction_id: ((): string | undefined => {
          const sel = (paymentModes || []).find(pm => String(pm.value) === String(paymentMode));
          const label = String(sel?.label || '').toLowerCase();
          return label.includes('upi') ? (upiTxnId?.trim() || undefined) : undefined;
        })(),
        cheque_no: ((): string | undefined => {
          const sel = (paymentModes || []).find(pm => String(pm.value) === String(paymentMode));
          const label = String(sel?.label || '').toLowerCase();
          return (label.includes('cheque') || label.includes('check')) ? (chequeNo?.trim() || undefined) : undefined;
  })(),
      } : undefined;

  let resp: any = null;
  let createdId: any = null;
      try {
  if (editModeId) {
          // Update flow
          // If multi-slot rows are present in edit mode, send them so the backend can update the calendar entries
          let bookingWithMulti: any = { ...bookingPayload };
          if (multiSlots && Array.isArray(multiSlots) && multiSlots.length > 0) {
            const ms = multiSlots.map((row) => ({
              date: row.date && (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) ? row.date : (row.date || ''),
              slotId: row.eventSlot ? (Number(row.eventSlot) || row.eventSlot) : null,
              hallId: selectedHallId ? (Number(selectedHallId) || selectedHallId) : null,
              eventTypeId: row.eventType ? (Number(row.eventType) || row.eventType) : (eventType ? Number(eventType) || eventType : null),
              attendees: Number(row.expectedGuests) || (Number(expectedGuests) || 0),
            }));
            bookingWithMulti.multiSlots = ms;
          }
          resp = await ApiService.post('/update-booking', {
            booking_id: editModeId,
            booking: bookingWithMulti,
            services: serviceLines,
            payment: paymentPayload,
          });
          createdId = editModeId;
          Swal.fire({
            icon: 'success',
            title: 'Booking Updated',
            timer: 1800,
            showConfirmButton: false,
            width: 520,
            color: '#0f172a',
            background: '#ffffff',
            backdrop: 'rgba(15, 23, 42, 0.35)',
            customClass: {
              popup: 'rounded-2xl shadow-2xl border border-slate-200/70',
              title: 'text-2xl font-semibold text-slate-800',
              icon: 'rounded-full !border-0 !bg-emerald-50 !text-emerald-600 !w-20 !h-20 flex items-center justify-center ring-1 ring-emerald-200'
            },
            buttonsStyling: false,
          });
          setCreatedBookingId(createdId);
          // Navigate back to Appointments  after a brief delay to show the toast
          setTimeout(() => navigate('/appointments'), 600);
        } else {
          // Create flow: always create a single booking; when multiple slots are selected,
          // send them as a multiSlots array so the backend inserts multiple calendar rows.
          let bookingWithMulti: any = { ...bookingPayload };
          if (multiSlots && Array.isArray(multiSlots) && multiSlots.length > 0) {
            const ms = multiSlots.map((row) => ({
              date: row.date && (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) ? row.date : (row.date || ''),
              slotId: row.eventSlot ? (Number(row.eventSlot) || row.eventSlot) : null,
              hallId: selectedHallId ? (Number(selectedHallId) || selectedHallId) : null,
              eventTypeId: row.eventType ? (Number(row.eventType) || row.eventType) : (eventType ? Number(eventType) || eventType : null),
              attendees: Number(row.expectedGuests) || (Number(expectedGuests) || 0),
            }));
            bookingWithMulti.multiSlots = ms;
          }

          resp = await ApiService.post('/create-booking', {
            booking: bookingWithMulti,
            services: serviceLines,
            payment: paymentPayload,
          });
          createdId = resp?.booking_id ?? resp?.data?.booking_id ?? resp?.data?.inserted_id ?? resp?.data ?? null;
          const displayId = resp?.booking_display_id || createdId;
          if (!createdId) {
            console.warn('Create-booking response did not include booking id', resp);
            Swal.fire({ icon: 'success', title: 'Booking Created', text: 'Booking created successfully', timer: 2200, showConfirmButton: false, width: 520 });
          } else {
            Swal.fire({ icon: 'success', title: 'Booking Created', html: `<div style="font-size:13px">Booking ID: <strong>${displayId}</strong></div>`, timer: 2500, showConfirmButton: false, width: 520 });
          }
          setCreatedBookingId(createdId);
          resetForm();
          setTimeout(()=> navigate('/appointments'), 600);
        }
      } catch (e) {
        console.error('Failed to save booking', e);
      }

      // keep form values so user can review; optionally reset or navigate
      console.log('Booking saved', { bookingPayload, createdId, resp });
    } catch (err) {
      console.error('Failed to save booking', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Cancel booking handler (edit mode only): asks for password and reason, verifies, then updates status to 'cancelled'
  const handleCancelBooking = async () => {
    if (!editModeId) return;
    try {
      // Step 1: ask for password
      const passRes = await Swal.fire({
        title: 'Confirm Cancellation',
        html: '<p class="text-slate-600 text-sm">Enter your password to confirm cancellation</p>',
        input: 'password',
        inputLabel: 'Password',
        inputPlaceholder: 'Enter password',
        inputAttributes: { autocapitalize: 'off', autocorrect: 'off', autocomplete: 'current-password' },
        showCancelButton: true,
        confirmButtonText: 'Next',
  cancelButtonText: 'Cancel',
        reverseButtons: true,
        width: 560,
        color: '#0f172a',
        background: '#ffffff',
        backdrop: 'rgba(15, 23, 42, 0.5)',
        customClass: {
          popup: 'rounded-xl shadow-2xl border border-slate-200',
          title: 'text-2xl font-semibold text-slate-800',
          htmlContainer: 'text-slate-600',
          input: 'swal2-input !mt-3 !px-4 !py-3 !text-sm !rounded-lg !border-slate-300 focus:!ring-2 focus:!ring-blue-500',
          confirmButton: 'inline-flex items-center justify-center rounded-lg bg-rose-600 text-white px-4 py-2 text-sm font-semibold hover:bg-rose-700 focus:outline-none',
          cancelButton: 'inline-flex items-center justify-center rounded-lg bg-slate-600/90 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-700 focus:outline-none',
          actions: 'gap-3 pt-2'
        },
        buttonsStyling: false,
        allowOutsideClick: () => !Swal.isLoading(),
        inputValidator: (v) => !v ? 'Password is required' : undefined,
      });
      if (!passRes.isConfirmed) return;
      const password = passRes.value as string;

      // Step 2: ask for reason
      const reasonRes = await Swal.fire({
        title: 'Cancellation Reason',
        html: '<p class="text-slate-600 text-sm">Please provide a brief reason for cancelling this booking.</p>',
        input: 'textarea',
        inputLabel: 'Reason',
        inputPlaceholder: 'Type your reason... (min 3 characters)',
  inputAttributes: { maxlength: '250', rows: '4' },
        showCancelButton: true,
        confirmButtonText: 'Cancel Booking',
  cancelButtonText: 'Cancel',
        reverseButtons: true,
        width: 560,
        color: '#0f172a',
        background: '#ffffff',
        backdrop: 'rgba(15, 23, 42, 0.5)',
        customClass: {
          popup: 'rounded-xl shadow-2xl border border-slate-200',
          title: 'text-2xl font-semibold text-slate-800',
          htmlContainer: 'text-slate-600',
          input: 'swal2-textarea !mt-3 !px-4 !py-3 !text-sm !rounded-lg !border-slate-300 focus:!ring-2 focus:!ring-rose-500',
          confirmButton: 'inline-flex items-center justify-center rounded-lg bg-rose-600 text-white px-4 py-2 text-sm font-semibold hover:bg-rose-700 focus:outline-none',
          cancelButton: 'inline-flex items-center justify-center rounded-lg bg-slate-600/90 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-700 focus:outline-none',
          actions: 'gap-3 pt-2'
        },
        buttonsStyling: false,
        allowOutsideClick: () => !Swal.isLoading(),
        inputValidator: (v) => {
          const t = (v || '').trim();
          if (!t) return 'Reason is required';
          if (t.length < 3) return 'Reason is too short';
          return undefined;
        },
      });
      if (!reasonRes.isConfirmed) return;
      const reason = (reasonRes.value as string).trim();

      // Step 3: verify password against /token (form-encoded)
      const username = (user as any)?.username || '';
      if (!username) {
        await Swal.fire({ icon: 'error', title: 'Not authenticated', text: 'User context missing', timer: 2000, showConfirmButton: false });
        return;
      }
      const form = new URLSearchParams();
      form.set('username', username);
      form.set('password', password);
      let authOk = false;
      try {
        const resp = await fetch(`${API_BASE_URL}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        });
        authOk = resp.ok;
      } catch (e) {
        authOk = false;
      }
      if (!authOk) {
        await Swal.fire({
          icon: 'error',
          title: 'Authentication failed',
          text: 'Invalid password',
          timer: 2200,
          showConfirmButton: false,
          customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' }
        });
        return;
      }

    // Step 4: perform cancellation via update-booking
      try {
        const payload: any = {
      STATUS: 'canceled',
          cancellation_reason: reason,
          cancelled_by: username,
          cancelled_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };
        await ApiService.post('/update-booking', {
          booking_id: editModeId,
          booking: payload,
          services: undefined,
          payment: undefined,
        });
        await Swal.fire({
          icon: 'success',
          title: 'Booking Cancelled',
          timer: 1600,
          showConfirmButton: false,
          customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' }
        });
  // Mark local state as cancelled (in case view persists briefly) and navigate
  setBookingStatus('cancelled');
  navigate('/appointments');
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : 'Failed to cancel booking';
        await Swal.fire({
          icon: 'error',
          title: 'Cancellation failed',
          text: msg,
          customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' }
        });
      }
    } catch (e) {
      // swallow; user likely cancelled the prompt
    }
  };

  const vm = {
    // customer & suggestions
  customer, setCustomer, nameFiltered, showNameSuggest, setShowNameSuggest, nameQuery, setNameQuery,
    customerSearchTerm, setCustomerSearchTerm, isSearchingCustomers, fieldErrors, setFieldErrors,
  mobileFiltered, setMobileQuery, showMobileSuggest, setShowMobileSuggest, applyCustomerRecord,
  setSelectedCustomerId,
  // when a suggestion is chosen, mark as existing customer to lock marked fields
  isExistingCustomer: selectedCustomerId != null,
    // event
  eventType, setEventType, eventTypes, eventSlot, setEventSlot, lockedSlot, eventSlots,
  startDateTime, setStartDateTime, expectedGuests, setExpectedGuests, specialReq, setSpecialReq,
  lockedDate,
  // tax helper exposure for view
  serviceTaxMap: serviceTaxMapState,
  roundTo2: (v: number) => Math.round((v + Number.EPSILON) * 100) / 100,
  // per-service tax exemption
  serviceTaxExempt,
  setServiceTaxExempt,
  // services search
  serviceSearch,
  setServiceSearch,
  filteredServices,
    // halls
  masterHalls, selectedHallId, setSelectedHallId, selectedHall,
  lockedHall,
    setHallRent: (val: number | string) => {
      const n = Number(val);
      if (isNaN(n)) { setHallRentOverride(null); return; }
      setHallRentOverride(Math.max(0, n));
    },
    // Hall change with availability guard
    handleHallChange: async (newHallId: string) => {
      try {
        // Gather selected date/slot pairs
        type Combo = { date: string; slot: string };
        const combos: Combo[] = [];
  const normYMD = (s: string) => {
          try { return String(s).slice(0,10); } catch { return ""; }
        };
  const normId = (v: any) => (v==null?"":String(v));
  // Local normalizer used below when comparing ids/slots
  const norm = (v: any) => (v==null ? "" : String(v));
        if (multiSlots && Array.isArray(multiSlots) && multiSlots.length > 0) {
          multiSlots.forEach(row => {
            const d = normYMD(row.date || "");
            const sid = normId(row.eventSlot || "");
            if (d && sid) combos.push({ date: d, slot: sid });
          });
        } else {
          const d = normYMD(startDateTime || "");
          const sid = normId(eventSlot || "");
          if (d && sid) combos.push({ date: d, slot: sid });
        }
        // If we don't have date/slot yet, just set the hall
        if (combos.length === 0) {
          setSelectedHallId(newHallId);
          setFieldErrors((prev: any) => ({ ...prev, selectedHall: '' }));
          return;
        }

        // Build range
        const dates = combos.map(c => c.date).sort();
        const fromdate = dates[0];
        const todate = dates[dates.length - 1];
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        if (!accountCode || !retailCode) {
          // Fallback: allow change if codes unavailable
          setSelectedHallId(newHallId);
          setFieldErrors((prev: any) => ({ ...prev, selectedHall: '' }));
          return;
        }
        const res: any = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate, todate });
        const entries: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        // Index existing bookings by date for the target hall
        const bookedByDate: Record<string, Array<{slot?: string; status?: string}>> = {};
        const normStatus = (s:any) => String(s||'').trim().toLowerCase();
        const isCancelledLike = (s:string) => ['cancelled','canceled','cancel'].includes(s);
        for (const entry of entries) {
          const b = entry?.booking || {};
          const hallBookings: any[] = Array.isArray(entry?.hallbooking) ? entry.hallbooking : [];
          if (hallBookings.length > 0) {
            for (const hb of hallBookings) {
              const hid = norm(String(hb.hall_id || hb.hallId || b.hall_id || b.hallId || ''));
              if (hid !== String(newHallId)) continue;
              const d = normYMD(hb.eventdate || hb.date || b.eventdate || b.date || '');
              if (!d) continue;
              const st = normStatus(hb.status || hb.STATUS || b.status || b.STATUS);
              if (isCancelledLike(st)) continue;
              const sid = norm(hb.slot_id || hb.slotId || b.slot_id || b.slotId || '');
              (bookedByDate[d] ||= []).push({ slot: sid || undefined, status: st });
            }
          } else {
            const hid = norm(b.hall_id || b.hallId || '');
            if (hid !== String(newHallId)) continue;
            const d = normYMD(b.eventdate || b.date || '');
            if (!d) continue;
            const st = normStatus(b.status || b.STATUS);
            if (isCancelledLike(st)) continue;
            const sid = norm(b.slot_id || b.slotId || '');
            (bookedByDate[d] ||= []).push({ slot: sid || undefined, status: st });
          }
        }
        // Detect conflicts: same date and either all-day (no slot) or exact slot match
        let conflict: { date: string; slot: string } | null = null;
        for (const c of combos) {
          const rows = bookedByDate[c.date] || [];
          const has = rows.some(r => !r.slot || String(r.slot) === String(c.slot));
          if (has) { conflict = c; break; }
        }

        if (conflict) {
          const hallName = (() => {
            const h = masterHalls.find((h:any)=> String(h.id)===String(newHallId));
            return h?.name || 'Selected hall';
          })();
          const slotLabel = (() => {
            const found = (eventSlots||[]).find((s:any)=> String(s.value)===String(conflict!.slot));
            return found?.label || `Slot ${conflict!.slot}`;
          })();
          await Swal.fire({
            icon: 'warning',
            title: 'Hall not available',
            text: `${hallName} is already booked on ${conflict.date} for ${slotLabel}.`,
            customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' }
          });
          // Do not change selection
          return;
        }

        // No conflicts → apply change
        setSelectedHallId(newHallId);
        setFieldErrors((prev: any) => ({ ...prev, selectedHall: '' }));
      } catch (e) {
        // On error, allow change but inform briefly
        console.warn('Hall availability check failed:', e);
        setSelectedHallId(newHallId);
        setFieldErrors((prev: any) => ({ ...prev, selectedHall: '' }));
      }
    },
    // Event Date change with availability guard (single-row)
    handleDateChange: async (newDate: string) => {
      try {
        const hallId = selectedHallId;
        // Always apply if no hall chosen or no slot selected yet
        if (!hallId || !newDate || !eventSlot) {
          setStartDateTime(newDate);
          setFieldErrors((prev: any) => ({ ...prev, startDateTime: '' }));
          return;
        }
        // Check availability for this date/slot on current hall
        const d = String(newDate).slice(0,10);
        const sid = String(eventSlot);
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        if (!accountCode || !retailCode) {
          setStartDateTime(newDate);
          setFieldErrors((prev: any) => ({ ...prev, startDateTime: '' }));
          return;
        }
        const res: any = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate: d, todate: d });
        const entries: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        const booked: Array<{slot?: string; status?: string}> = [];
        const norm = (v:any)=> String(v||'');
        const normStatus = (s:any)=> String(s||'').trim().toLowerCase();
        const isCancelledLike = (s:string)=> ['cancelled','canceled','cancel'].includes(s);
        for (const entry of entries) {
          const b = entry?.booking || {};
          const hallBookings: any[] = Array.isArray(entry?.hallbooking) ? entry.hallbooking : [];
          if (hallBookings.length > 0) {
            for (const hb of hallBookings) {
              const hid = norm(hb.hall_id || hb.hallId || b.hall_id || b.hallId || '');
              if (hid !== String(hallId)) continue;
              const date = String(hb.eventdate || hb.date || b.eventdate || b.date || '').slice(0,10);
              if (date !== d) continue;
              const st = normStatus(hb.status || hb.STATUS || b.status || b.STATUS);
              if (isCancelledLike(st)) continue;
              const sId = norm(hb.slot_id || hb.slotId || b.slot_id || b.slotId || '');
              booked.push({ slot: sId || undefined, status: st });
            }
          } else {
            const hid = norm(b.hall_id || b.hallId || '');
            if (hid !== String(hallId)) continue;
            const date = String(b.eventdate || b.date || '').slice(0,10);
            if (date !== d) continue;
            const st = normStatus(b.status || b.STATUS);
            if (isCancelledLike(st)) continue;
            const sId = norm(b.slot_id || b.slotId || '');
            booked.push({ slot: sId || undefined, status: st });
          }
        }
        const hasConflict = booked.some(r => !r.slot || String(r.slot) === String(sid));
        if (hasConflict) {
          const hallName = selectedHall?.name || 'Selected hall';
          const slotLabel = (() => {
            const found = (eventSlots||[]).find((s:any)=> String(s.value)===String(sid));
            return found?.label || `Slot ${sid}`;
          })();
          await Swal.fire({ icon: 'warning', title: 'Not available', text: `${hallName} is already booked on ${d} for ${slotLabel}.`, customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' } });
          return;
        }
        setStartDateTime(newDate);
        setFieldErrors((prev: any) => ({ ...prev, startDateTime: '' }));
      } catch (e) {
        // On error, allow change
        setStartDateTime(newDate);
        setFieldErrors((prev: any) => ({ ...prev, startDateTime: '' }));
      }
    },
    // Event Slot change with availability guard (single-row)
    handleSlotChange: async (newSlot: string) => {
      try {
        const hallId = selectedHallId;
        if (!hallId || !startDateTime || !newSlot) {
          setEventSlot(newSlot);
          setFieldErrors((prev: any) => ({ ...prev, eventSlot: '' }));
          return;
        }
        const d = String(startDateTime).slice(0,10);
        const sid = String(newSlot);
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        if (!accountCode || !retailCode) {
          setEventSlot(newSlot);
          setFieldErrors((prev: any) => ({ ...prev, eventSlot: '' }));
          return;
        }
        const res: any = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate: d, todate: d });
        const entries: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        const booked: Array<{slot?: string; status?: string}> = [];
        const norm = (v:any)=> String(v||'');
        const normStatus = (s:any)=> String(s||'').trim().toLowerCase();
        const isCancelledLike = (s:string)=> ['cancelled','canceled','cancel'].includes(s);
        for (const entry of entries) {
          const b = entry?.booking || {};
          const hallBookings: any[] = Array.isArray(entry?.hallbooking) ? entry.hallbooking : [];
          if (hallBookings.length > 0) {
            for (const hb of hallBookings) {
              const hid = norm(hb.hall_id || hb.hallId || b.hall_id || b.hallId || '');
              if (hid !== String(hallId)) continue;
              const date = String(hb.eventdate || hb.date || b.eventdate || b.date || '').slice(0,10);
              if (date !== d) continue;
              const st = normStatus(hb.status || hb.STATUS || b.status || b.STATUS);
              if (isCancelledLike(st)) continue;
              const sId = norm(hb.slot_id || hb.slotId || b.slot_id || b.slotId || '');
              booked.push({ slot: sId || undefined, status: st });
            }
          } else {
            const hid = norm(b.hall_id || b.hallId || '');
            if (hid !== String(hallId)) continue;
            const date = String(b.eventdate || b.date || '').slice(0,10);
            if (date !== d) continue;
            const st = normStatus(b.status || b.STATUS);
            if (isCancelledLike(st)) continue;
            const sId = norm(b.slot_id || b.slotId || '');
            booked.push({ slot: sId || undefined, status: st });
          }
        }
        const hasConflict = booked.some(r => !r.slot || String(r.slot) === String(sid));
        if (hasConflict) {
          const hallName = selectedHall?.name || 'Selected hall';
          const slotLabel = (() => {
            const found = (eventSlots||[]).find((s:any)=> String(s.value)===String(sid));
            return found?.label || `Slot ${sid}`;
          })();
          await Swal.fire({ icon: 'warning', title: 'Not available', text: `${hallName} is already booked on ${d} for ${slotLabel}.`, customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' } });
          return;
        }
        setEventSlot(newSlot);
        setFieldErrors((prev: any) => ({ ...prev, eventSlot: '' }));
      } catch (e) {
        setEventSlot(newSlot);
        setFieldErrors((prev: any) => ({ ...prev, eventSlot: '' }));
      }
    },
    // Multi-row date/slot change with availability guard for the row
    handleRowDateChange: async (idx: number, newDate: string) => {
      try {
        const hallId = selectedHallId;
        if (!Array.isArray(multiSlots) || !multiSlots[idx]) return;
        const row = multiSlots[idx];
        if (!hallId || !newDate || !row.eventSlot) {
          const next = [...multiSlots]; next[idx] = { ...row, date: newDate } as any; setMultiSlots(next);
          return;
        }
        const d = String(newDate).slice(0,10);
        const sid = String(row.eventSlot);
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        if (!accountCode || !retailCode) {
          const next = [...multiSlots]; next[idx] = { ...row, date: newDate } as any; setMultiSlots(next);
          return;
        }
        const res: any = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate: d, todate: d });
        const entries: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        const booked: Array<{slot?: string; status?: string}> = [];
        const norm = (v:any)=> String(v||'');
        const normStatus = (s:any)=> String(s||'').trim().toLowerCase();
        const isCancelledLike = (s:string)=> ['cancelled','canceled','cancel'].includes(s);
        for (const entry of entries) {
          const b = entry?.booking || {};
          const hallBookings: any[] = Array.isArray(entry?.hallbooking) ? entry.hallbooking : [];
          if (hallBookings.length > 0) {
            for (const hb of hallBookings) {
              const hid = norm(hb.hall_id || hb.hallId || b.hall_id || b.hallId || '');
              if (hid !== String(hallId)) continue;
              const date = String(hb.eventdate || hb.date || b.eventdate || b.date || '').slice(0,10);
              if (date !== d) continue;
              const st = normStatus(hb.status || hb.STATUS || b.status || b.STATUS);
              if (isCancelledLike(st)) continue;
              const sId = norm(hb.slot_id || hb.slotId || b.slot_id || b.slotId || '');
              booked.push({ slot: sId || undefined, status: st });
            }
          } else {
            const hid = norm(b.hall_id || b.hallId || '');
            if (hid !== String(hallId)) continue;
            const date = String(b.eventdate || b.date || '').slice(0,10);
            if (date !== d) continue;
            const st = normStatus(b.status || b.STATUS);
            if (isCancelledLike(st)) continue;
            const sId = norm(b.slot_id || b.slotId || '');
            booked.push({ slot: sId || undefined, status: st });
          }
        }
        const hasConflict = booked.some(r => !r.slot || String(r.slot) === String(sid));
        if (hasConflict) {
          const hallName = selectedHall?.name || 'Selected hall';
          const slotLabel = (() => {
            const found = (eventSlots||[]).find((s:any)=> String(s.value)===String(sid));
            return found?.label || `Slot ${sid}`;
          })();
          await Swal.fire({ icon: 'warning', title: 'Not available', text: `${hallName} is already booked on ${d} for ${slotLabel}.`, customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' } });
          return;
        }
        const next = [...multiSlots]; next[idx] = { ...row, date: newDate } as any; setMultiSlots(next);
      } catch (e) {
        const next = [...multiSlots]; const row = multiSlots[idx]; next[idx] = { ...row, date: newDate } as any; setMultiSlots(next);
      }
    },
    handleRowSlotChange: async (idx: number, newSlot: string) => {
      try {
        const hallId = selectedHallId;
        if (!Array.isArray(multiSlots) || !multiSlots[idx]) return;
        const row = multiSlots[idx];
        if (!hallId || !row.date || !newSlot) {
          const next = [...multiSlots]; next[idx] = { ...row, eventSlot: newSlot } as any; setMultiSlots(next);
          return;
        }
        const d = String(row.date).slice(0,10);
        const sid = String(newSlot);
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        if (!accountCode || !retailCode) {
          const next = [...multiSlots]; next[idx] = { ...row, eventSlot: newSlot } as any; setMultiSlots(next);
          return;
        }
        const res: any = await BookingsService.getRange({ account_code: accountCode, retail_code: retailCode, fromdate: d, todate: d });
        const entries: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        const booked: Array<{slot?: string; status?: string}> = [];
        const norm = (v:any)=> String(v||'');
        const normStatus = (s:any)=> String(s||'').trim().toLowerCase();
        const isCancelledLike = (s:string)=> ['cancelled','canceled','cancel'].includes(s);
        for (const entry of entries) {
          const b = entry?.booking || {};
          const hallBookings: any[] = Array.isArray(entry?.hallbooking) ? entry.hallbooking : [];
          if (hallBookings.length > 0) {
            for (const hb of hallBookings) {
              const hid = norm(hb.hall_id || hb.hallId || b.hall_id || b.hallId || '');
              if (hid !== String(hallId)) continue;
              const date = String(hb.eventdate || hb.date || b.eventdate || b.date || '').slice(0,10);
              if (date !== d) continue;
              const st = normStatus(hb.status || hb.STATUS || b.status || b.STATUS);
              if (isCancelledLike(st)) continue;
              const sId = norm(hb.slot_id || hb.slotId || b.slot_id || b.slotId || '');
              booked.push({ slot: sId || undefined, status: st });
            }
          } else {
            const hid = norm(b.hall_id || b.hallId || '');
            if (hid !== String(hallId)) continue;
            const date = String(b.eventdate || b.date || '').slice(0,10);
            if (date !== d) continue;
            const st = normStatus(b.status || b.STATUS);
            if (isCancelledLike(st)) continue;
            const sId = norm(b.slot_id || b.slotId || '');
            booked.push({ slot: sId || undefined, status: st });
          }
        }
        const hasConflict = booked.some(r => !r.slot || String(r.slot) === String(sid));
        if (hasConflict) {
          const hallName = selectedHall?.name || 'Selected hall';
          const slotLabel = (() => {
            const found = (eventSlots||[]).find((s:any)=> String(s.value)===String(sid));
            return found?.label || `Slot ${sid}`;
          })();
          await Swal.fire({ icon: 'warning', title: 'Not available', text: `${hallName} is already booked on ${d} for ${slotLabel}.`, customClass: { popup: 'rounded-xl shadow-2xl border border-slate-200' } });
          return;
        }
        const next = [...multiSlots]; next[idx] = { ...row, eventSlot: newSlot } as any; setMultiSlots(next);
      } catch (e) {
        const next = [...multiSlots]; const row = multiSlots[idx]; next[idx] = { ...row, eventSlot: newSlot } as any; setMultiSlots(next);
      }
    },
    // services
  services, availableServices, toggleService, showServices, setShowServices,
  servicePrices, setServicePrice,
    // payment & totals
  paymentModes, paymentMode, setPaymentMode, discount, setDiscount, hallTaxRate, cgst, sgst,
  hallRent, servicesCost, totalAmount, advancePayment, setAdvancePayment, balanceDue, existingPaid,
  taxExempt, setTaxExempt,
  // conditional payment refs
  upiTxnId, setUpiTxnId, chequeNo, setChequeNo,
    // actions
  resetForm, isSaving, handleConfirmSave, editModeId, createdBookingId, handleCancelBooking,
  bookingStatus,
    // multi-slot rows for fullDay/slotIds
    multiSlots, setMultiSlots,
  // Hide primary action when fully paid and no services in edit mode
  hidePrimaryAction: ((): boolean => {
    const dueZero = Number(balanceDue) === 0;
    const hasServices = Object.values(services || {}).some(Boolean);
    return !!editModeId && dueZero && !hasServices;
  })(),
  // derived read-only when cancelled (immediate via URL param, then via loaded status)
  isCancelledReadonly: ((): boolean => {
    const norm = (v:any) => String(v||'').trim().toLowerCase();
    const sState = norm(bookingStatus);
    const sParam = norm(searchParams.get('status'));
    const isCancelledLike = (s:string) => s === 'cancelled' || s === 'canceled' || s === 'cancel' || s === 'void' || s === 'inactive';
    return isCancelledLike(sState) || isCancelledLike(sParam);
  })(),
  // simple back navigation for header button
  goBack: () => {
    try {
      if (typeof window !== 'undefined' && window.history && window.history.length > 2) navigate(-1);
  else navigate('/appointments');
    } catch {
  navigate('/appointments');
    }
  },
  };

  return <CreateBookingView vm={vm} />;
}