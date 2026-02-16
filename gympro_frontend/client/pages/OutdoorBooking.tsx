// Independent OutdoorBooking page (forked from CreateBooking) for separate operations.
// Differences:
//  - User-facing terminology uses "Outdoor Area" instead of "Hall".
//  - API endpoints point to /create-outdoor-booking and /update-outdoor-booking (fallback to generic if not present).
//  - Navigation after save returns to /outdoor-booking.
//  - Can be further customized for outdoor-specific pricing & masters (e.g., master_outdoor_area) later.

import { useState, useEffect, useMemo, useRef } from 'react';
import Swal from 'sweetalert2';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { createPortal } from 'react-dom';
import { DataService } from '@/services/userService';
import { ApiService } from '@/services/apiService';
import { MASTER_TABLES } from '@/services/masterTables';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft,
  Save,
  Users,
  MapPin,
  Clock,
  Wrench,
  Plus,
  Trash2,
  CreditCard,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface OutdoorArea {
  id: string;
  name: string;
  capacity: number;
  hourlyRate: number;
  fullDayPrice?: number;
  taxRate?: number;
  hsnCode?: string;
  hsnDescription?: string;
  images: string[];
  isAvailable: boolean;
}

interface Service { id: string; name: string; price: number; category?: string; taxId?: string; }
const FALLBACK_SERVICES: Service[] = [];

export default function OutdoorBooking() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  // Customer state
  const [customer, setCustomer] = useState({ fullName: '', mobile: '', altMobile: '', email: '', address: '', deliveryAddress: '', gstin: '', aadhaar: '', pan: '' });
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | string | null>(null);
  // Event
  const [eventType, setEventType] = useState('');
  const [startDateTime, setStartDateTime] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [expectedGuests, setExpectedGuests] = useState<number | ''>(50);
  const [specialReq, setSpecialReq] = useState('');
  // Outdoor Area selection
  const [selectedOutdoorId, setSelectedOutdoorId] = useState('');
  const [lockedOutdoor, setLockedOutdoor] = useState(false);
  // Slots / Event timings
  const [eventSlots, setEventSlots] = useState<Array<{ value: string; label: string }>>([]);
  const [eventSlot, setEventSlot] = useState('');
  const [lockedSlot, setLockedSlot] = useState(false);
  const [lockedDate, setLockedDate] = useState(false);
  const [multiSlots, setMultiSlots] = useState<Array<{ id?: string; date: string; eventType: string; eventSlot: string; expectedGuests: number | '' }>>([]);

  // Services
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [availableServices, setAvailableServices] = useState<Service[]>(FALLBACK_SERVICES);
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({});
  const [showServices, setShowServices] = useState(false);
  const mastersInFlight = useRef(false);
  const [eventTypes, setEventTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [outdoorAreas, setOutdoorAreas] = useState<OutdoorArea[]>([]);
  const [masterInventory, setMasterInventory] = useState<Array<any>>([]);
  const [hsnMapState, setHsnMapState] = useState<Record<string, any>>({});
  const [taxMapState, setTaxMapState] = useState<Record<string, any>>({});
  // Additional custom items state (added earlier for clarity if not already declared)
  const emptyCustomRow = () => ({ id: (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)), description: '', qty: 1, price: 0, discount: 0, tax: 0 });
  const [customItems, setCustomItems] = useState<Array<{ id: string; description: string; qty: number; price: number; discount: number; tax: number }>>([emptyCustomRow()]);
  const [descSuggestions, setDescSuggestions] = useState<Array<any>>([]);
  const [portalRect, setPortalRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [portalRowId, setPortalRowId] = useState<string | null>(null);
  const [descHighlight, setDescHighlight] = useState<number>(-1);
  // per-row input refs to manage focus navigation
  const rowRefs = useRef<Record<string, { desc?: HTMLInputElement | null; qty?: HTMLInputElement | null; price?: HTMLInputElement | null; discount?: HTMLInputElement | null; tax?: HTMLInputElement | null }>>({});

  const registerRef = (rowId: string, field: 'desc' | 'qty' | 'price' | 'discount' | 'tax', el: HTMLInputElement | null) => {
    if (!rowId) return;
    const map = rowRefs.current || (rowRefs.current = {});
    if (!map[rowId]) map[rowId] = {} as any;
    map[rowId][field] = el;
  };

  // Payment
  const [advancePayment, setAdvancePayment] = useState(0);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentModes, setPaymentModes] = useState<Array<{ value: string; label: string }>>([]);
  const [discount, setDiscount] = useState(0);
  const [taxExempt, setTaxExempt] = useState<boolean>(false);
  // replace venue rent override with a delivery charge field
  const [deliveryCharge, setDeliveryCharge] = useState<number>(0);
  const [upiTxnId, setUpiTxnId] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [existingPaid, setExistingPaid] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Customer search helpers (simplified from original)
  interface CustomerRecord { id?: number | string; full_name?: string; fullName?: string; name?: string; mobile?: string; phone?: string; email?: string; address?: string; gstin?: string; aadhar_no?: string; pan_no?: string; }
  const [customerList, setCustomerList] = useState<CustomerRecord[]>([]);
  const [showNameSuggest, setShowNameSuggest] = useState(false);
  const [showMobileSuggest, setShowMobileSuggest] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [mobileQuery, setMobileQuery] = useState('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);

  // Prefill from URL (outdoorId maps to hallId semantics)
  useEffect(() => {
    const idParam = searchParams.get('outdoorId');
    if (idParam) setSelectedOutdoorId(prev => prev || idParam);
  }, [searchParams]);

  // Masters load (reusing existing hall, slot, service masters until dedicated outdoor masters exist)
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mastersInFlight.current) return;
        mastersInFlight.current = true;
        const accountCode = (user as any)?.account_code || '';
        const retailCode = (user as any)?.retail_code || '';
        const tables = [
          MASTER_TABLES.service,
          MASTER_TABLES.paymode,
          MASTER_TABLES.event_type,
          MASTER_TABLES.hall, // reused for now; treat halls as outdoor areas
          MASTER_TABLES.inventory,
          MASTER_TABLES.shiftslot,
          MASTER_TABLES.hsn,
          MASTER_TABLES.tax,
        ];
        const res = await DataService.readData(tables, accountCode, retailCode);
        let dataMap: any = (res as any)?.data || {};
        if (Array.isArray(dataMap)) dataMap = { [tables[0]]: dataMap };

        // Services
        const svcRows = dataMap[MASTER_TABLES.service] || [];
        if (mounted && Array.isArray(svcRows) && svcRows.length > 0) {
          const mapped: Service[] = svcRows.map((r: any, idx: number) => ({
            id: String(r.service_id ?? r.id ?? `svc-${idx}`),
            name: String(r.service_name ?? r.service_description ?? r.service ?? r.name ?? '').trim() || `Service ${idx + 1}`,
            price: Number(r.price ?? r.seasonal_price ?? 0) || 0,
            category: r.category_name || r.service_category || r.category,
            taxId: r.tax_id ?? r.taxId ?? r.tax_code,
          }));
          setAvailableServices(mapped);
          setServicePrices(prev => {
            const next = { ...prev } as Record<string, number>;
            const ids = new Set(mapped.map(s => s.id));
            mapped.forEach(s => { if (next[s.id] == null || isNaN(next[s.id])) next[s.id] = Number(s.price) || 0; });
            Object.keys(next).forEach(k => { if (!ids.has(k)) delete next[k]; });
            return next;
          });
        } else if (mounted) {
          setAvailableServices(FALLBACK_SERVICES);
        }

        // Paymodes
        const pmRows = dataMap[MASTER_TABLES.paymode] || [];
        if (mounted && Array.isArray(pmRows) && pmRows.length > 0) {
          const opts = pmRows.map((r: any, idx: number) => ({
            value: String(r.payment_id ?? r.id ?? `pm-${idx}`),
            label: String(r.payment_mode_name ?? r.name ?? r.mode ?? '').trim() || `Mode ${idx + 1}`,
          }));
          setPaymentModes(opts);
          if (!opts.find(o => o.value === paymentMode)) setPaymentMode(opts[0]?.value || paymentMode);
        }

        // Event Types
        const etRows = dataMap[MASTER_TABLES.event_type] || [];
        if (mounted && Array.isArray(etRows) && etRows.length > 0) {
          const opts = etRows.map((r: any, idx: number) => ({
            value: String(r.event_type_id ?? r.id ?? r.event_type_name ?? `et-${idx}`),
            label: String(r.event_type_name ?? r.name ?? r.event_type ?? '').trim() || `Type ${idx + 1}`,
          }));
          setEventTypes(opts);
          if (!eventType || !opts.some(o => o.value === eventType)) setEventType(opts[0]?.value || '');
        } else if (mounted) {
          const fallback = [
            { value: 'wedding', label: 'Wedding' },
            { value: 'reception', label: 'Reception' },
            { value: 'party', label: 'Party' },
            { value: 'corporate', label: 'Corporate' },
            { value: 'other', label: 'Other' },
          ];
            setEventTypes(fallback);
            if (!eventType) setEventType(fallback[0].value);
        }

        // HSN & Taxes for rate derivation
  const hsnRows = dataMap[MASTER_TABLES.hsn] || [];
  const taxRows = dataMap[MASTER_TABLES.tax] || [];
  const inventoryRows = dataMap[MASTER_TABLES.inventory] || [];
        const hsnMap: Record<string, any> = {};
        hsnRows.forEach((h: any) => { const key = String(h.hsn_id ?? h.id ?? h.hsn_code ?? h.code ?? '').trim(); if (key) hsnMap[key] = h; });
        const taxMap: Record<string, any> = {};
        taxRows.forEach((t: any) => { const key = String(t.tax_id ?? t.id ?? t.tax_code ?? t.code ?? '').trim(); if (key) taxMap[key] = t; });
        // persist maps for dynamic tax lookup
        if (mounted) {
          setHsnMapState(hsnMap);
          setTaxMapState(taxMap);
        }
        const extractRate = (rec: any): number | undefined => {
          if (!rec) return undefined; let rate: any = rec.tax_rate ?? rec.rate ?? rec.percentage ?? rec.total_rate ?? rec.gst_percentage ?? rec.gst_percent; const cg = rec.cgst ?? rec.cgst_rate; const sg = rec.sgst ?? rec.sgst_rate; if (cg != null && sg != null) { const combined = Number(cg) + Number(sg); if (combined > 0) rate = combined; } if (rate == null) return undefined; rate = Number(rate); if (isNaN(rate)) return undefined; if (rate > 1.5) rate = rate / 100; return rate; };

        // Outdoor Areas (reuse hall data for now)
        const hallRows = dataMap[MASTER_TABLES.hall] || [];
        if (mounted && Array.isArray(hallRows) && hallRows.length > 0) {
          const toNumber = (val: any): number => { if (typeof val === 'number') return val; if (typeof val === 'string') { const m = val.replace(/[\,\s]/g, '').match(/-?\d+(?:\.\d+)?/); if (m) return Number(m[0]); } return NaN; };
          const findNumericRate = (r: any): number => { const fields = ['price','hourly_rate','hourlyRate','hall_rate','rate','rent','per_hour']; for (const k of fields) { if (r[k] != null) { const n = toNumber(r[k]); if (!isNaN(n) && n > 0) return n; } } return 0; };
          const mapped: OutdoorArea[] = hallRows.map((r: any, idx: number) => {
            const hsnKey = String(r.hsn_id ?? r.hsn_code ?? '').trim();
            let taxRate: number | undefined; if (hsnKey && hsnMap[hsnKey]) { taxRate = extractRate(hsnMap[hsnKey]); const tKey = String(hsnMap[hsnKey].tax_id ?? hsnMap[hsnKey].tax)?.trim(); if (!taxRate && tKey && taxMap[tKey]) taxRate = extractRate(taxMap[tKey]); }
            if (!taxRate) taxRate = extractRate(r);
            return { id: String(r.hall_id ?? r.id ?? `oa-${idx}`), name: String(r.hall_name ?? r.name ?? `Area ${idx+1}`), capacity: Number(r.capacity ?? r.seating_capacity ?? 0) || 0, hourlyRate: Number(findNumericRate(r)) || 0, fullDayPrice: undefined, taxRate, hsnCode: hsnKey || undefined, hsnDescription: undefined, images: Array.isArray(r.images) ? r.images : (r.images ? [String(r.images)] : ['/placeholder.svg']), isAvailable: true };
          });
          setOutdoorAreas(mapped);
          const idParam = searchParams.get('outdoorId');
          if (idParam && mapped.some(h => String(h.id) === String(idParam))) setSelectedOutdoorId(idParam);
          else if (!selectedOutdoorId && mapped.length === 1) setSelectedOutdoorId(mapped[0].id);
        }

        if (mounted && Array.isArray(inventoryRows)) {
          const mappedInv = inventoryRows.map((r:any, idx:number) => {
            const id = String(r.inventory_id ?? r.id ?? r.item_id ?? `inv-${idx}`);
            const name = String(r.item_name ?? r.name ?? r.description ?? r.item_description ?? '').trim();
            const price = Number(r.price ?? r.rate ?? r.mrp ?? 0) || 0;
            // derive per-item taxRate: prefer explicit tax_id -> taxMap, then hsn -> hsnMap, otherwise try to extract from record
            let invTaxRate: number | undefined;
            const tKey = String(r.tax_id ?? r.tax ?? r.tax_code ?? '').trim();
            if (tKey && taxMap[tKey]) invTaxRate = extractRate(taxMap[tKey]);
            const hsnKey = String(r.hsn_id ?? r.hsn_code ?? '').trim();
            if (!invTaxRate && hsnKey && hsnMap[hsnKey]) {
              invTaxRate = extractRate(hsnMap[hsnKey]);
              const maybeTaxId = String(hsnMap[hsnKey].tax_id ?? hsnMap[hsnKey].tax ?? '').trim();
              if (!invTaxRate && maybeTaxId && taxMap[maybeTaxId]) invTaxRate = extractRate(taxMap[maybeTaxId]);
            }
            if (!invTaxRate) invTaxRate = extractRate(r);
            return { id, name, price, raw: r, taxRate: invTaxRate };
          });
          setMasterInventory(mappedInv);
        }

        // Slots
        const slotRows = dataMap[MASTER_TABLES.shiftslot] || [];
        if (mounted && Array.isArray(slotRows) && slotRows.length > 0) {
          const normalizeTime = (t: any, fb: string) => { if (!t) return fb; const m = String(t).match(/(\d{2}:\d{2})/); return m ? m[1] : fb; };
          const mapped = slotRows.map((r: any, idx: number) => {
            const id = String(r.slot_id ?? r.id ?? `slot-${idx}`);
            const rawName = String(r.slot_name ?? r.name ?? r.shift_name ?? '').trim() || `Slot ${idx+1}`;
            const start = normalizeTime(r.fromtime || r.from_time || r.start_time || r.start, '00:00');
            const end = normalizeTime(r.totime || r.to_time || r.end_time || r.end, '23:59');
            const timeLabel = start === end ? start : `${start} - ${end}`;
            return { value: id, label: `${rawName} (${timeLabel})`, _start: start };
          }).sort((a,b) => a._start.localeCompare(b._start));
          setEventSlots(mapped.map(m => ({ value: m.value, label: m.label })));
          if (!eventSlot && mapped.length > 0) setEventSlot(mapped[0].value);
        }
      } catch (e) {
        if (mounted) console.error('Failed to load masters for outdoor booking', e);
      } finally {
        mastersInFlight.current = false;
      }
    };
    load();
    return () => { mounted = false; };
  }, [user, searchParams]);

  const selectedOutdoor = outdoorAreas.find(h => h.id === selectedOutdoorId);

  // helper: find inventory master record by description (best-effort match)
  const findInventoryByDesc = (desc?: string) => {
    if (!desc) return undefined;
    const q = String(desc).trim().toLowerCase();
    if (!q) return undefined;
    return masterInventory.find(mi => {
      const name = String(mi.name || '').toLowerCase();
      return name === q || name.includes(q);
    });
  };

  // compute tax amount for a custom item row using per-item taxRate if present, otherwise outdoor area taxRate
  const computeTaxForRow = (row: { description?: string; qty?: number; price?: number; tax?: number }) => {
    if (taxExempt) return 0;
    const base = (row.qty || 0) * (row.price || 0);
    if (base <= 0) return 0;
    // prefer explicit tax value if user already entered a positive tax amount
    if (row.tax && Number(row.tax) > 0) return Number(row.tax);
    const inv = findInventoryByDesc(row.description);
    const rate = (inv && inv.taxRate != null) ? inv.taxRate : (selectedOutdoor?.taxRate ?? 0);
    return base * (rate || 0);
  };

  // compute tax components (cgst, sgst, total) for a row using tax maps (returns amounts)
  const computeTaxComponentsForRow = (row: { description?: string; qty?: number; price?: number; tax?: number }) => {
    if (taxExempt) return { tax: 0, cgst: 0, sgst: 0 };
    const base = (row.qty || 0) * (row.price || 0);
    if (base <= 0) return { tax: 0, cgst: 0, sgst: 0 };
    // if user entered absolute tax, distribute it equally if no master info
    if (row.tax && Number(row.tax) > 0) {
      const t = Number(row.tax);
      return { tax: t, cgst: t / 2, sgst: t / 2 };
    }
    const inv = findInventoryByDesc(row.description);
    // resolve tax record: prefer inventory.raw.tax_id or hsn -> taxMap
    let taxRec: any = undefined;
    if (inv && inv.raw) {
      const tKey = String(inv.raw.tax_id ?? inv.raw.tax ?? inv.raw.tax_code ?? '').trim();
      if (tKey && taxMapState[tKey]) taxRec = taxMapState[tKey];
      const hKey = String(inv.raw.hsn_id ?? inv.raw.hsn_code ?? '').trim();
      if (!taxRec && hKey && hsnMapState[hKey]) {
        const maybe = hsnMapState[hKey];
        const maybeTaxId = String(maybe.tax_id ?? maybe.tax ?? '').trim();
        if (maybeTaxId && taxMapState[maybeTaxId]) taxRec = taxMapState[maybeTaxId];
        else taxRec = maybe;
      }
    }
    // fallback to selectedOutdoor hsn/tax
    if (!taxRec && selectedOutdoor) {
      const hKey = selectedOutdoor.hsnCode ?? undefined;
      if (hKey && hsnMapState[hKey]) {
        const rec = hsnMapState[hKey];
        const tKey = String(rec.tax_id ?? rec.tax ?? rec.tax_code ?? '').trim();
        if (tKey && taxMapState[tKey]) taxRec = taxMapState[tKey];
        else taxRec = rec;
      } else if (selectedOutdoor.taxRate != null) {
        // no record but numeric rate available
        const rate = selectedOutdoor.taxRate;
        const tAmt = base * rate;
        return { tax: tAmt, cgst: tAmt / 2, sgst: tAmt / 2 };
      }
    }

    if (taxRec) {
      const cg = Number(taxRec.cgst ?? taxRec.cgst_rate ?? 0) || 0;
      const sg = Number(taxRec.sgst ?? taxRec.sgst_rate ?? 0) || 0;
      let totalPct = 0;
      if (cg || sg) totalPct = cg + sg;
      else {
        const maybe = Number(taxRec.tax_rate ?? taxRec.rate ?? taxRec.percentage ?? taxRec.gst_percentage ?? 0);
        totalPct = maybe > 1.5 ? maybe : maybe * 100;
      }
      const totalRate = totalPct / 100;
      const tAmt = base * totalRate;
      const cgAmt = tAmt * (cg / Math.max(totalPct, 1));
      const sgAmt = tAmt * (sg / Math.max(totalPct, 1));
      // if cg/sg both zero, split equally
      if (!cg && !sg) return { tax: tAmt, cgst: tAmt / 2, sgst: tAmt / 2 };
      return { tax: tAmt, cgst: cgAmt, sgst: sgAmt };
    }
    // ultimate fallback: zero
    return { tax: 0, cgst: 0, sgst: 0 };
  };

  // compute tax split percentages (cgstPct, sgstPct, totalPct) for a row
  const computeTaxSplitPercentForRow = (row: { description?: string; qty?: number; price?: number; tax?: number }) => {
    if (taxExempt) return { cgstPct: 0, sgstPct: 0, totalPct: 0 };
    const inv = findInventoryByDesc(row.description);
    let taxRec: any = undefined;
    if (inv && inv.raw) {
      const tKey = String(inv.raw.tax_id ?? inv.raw.tax ?? inv.raw.tax_code ?? '').trim();
      if (tKey && taxMapState[tKey]) taxRec = taxMapState[tKey];
      const hKey = String(inv.raw.hsn_id ?? inv.raw.hsn_code ?? '').trim();
      if (!taxRec && hKey && hsnMapState[hKey]) {
        const maybe = hsnMapState[hKey];
        const maybeTaxId = String(maybe.tax_id ?? maybe.tax ?? '').trim();
        if (maybeTaxId && taxMapState[maybeTaxId]) taxRec = taxMapState[maybeTaxId];
        else taxRec = maybe;
      }
    }
    if (!taxRec && selectedOutdoor) {
      const hKey = selectedOutdoor.hsnCode ?? undefined;
      if (hKey && hsnMapState[hKey]) {
        const rec = hsnMapState[hKey];
        const tKey = String(rec.tax_id ?? rec.tax ?? rec.tax_code ?? '').trim();
        if (tKey && taxMapState[tKey]) taxRec = taxMapState[tKey];
        else taxRec = rec;
      } else if (selectedOutdoor.taxRate != null) {
        const total = selectedOutdoor.taxRate * 100;
        return { cgstPct: total / 2, sgstPct: total / 2, totalPct: total };
      }
    }
    if (taxRec) {
      const cg = Number(taxRec.cgst ?? taxRec.cgst_rate ?? 0) || 0;
      const sg = Number(taxRec.sgst ?? taxRec.sgst_rate ?? 0) || 0;
      if (cg || sg) return { cgstPct: cg, sgstPct: sg, totalPct: (cg + sg) };
      const maybe = Number(taxRec.tax_rate ?? taxRec.rate ?? taxRec.percentage ?? taxRec.gst_percentage ?? 0);
      const total = maybe > 1.5 ? maybe : maybe * 100;
      return { cgstPct: total / 2, sgstPct: total / 2, totalPct: total };
    }
    // fallback: compute from absolute tax if base present
    const base = (row.qty || 0) * (row.price || 0);
    if (base > 0 && row.tax && Number(row.tax) > 0) {
      const totalPct = (Number(row.tax) / base) * 100;
      return { cgstPct: totalPct / 2, sgstPct: totalPct / 2, totalPct };
    }
    return { cgstPct: 0, sgstPct: 0, totalPct: 0 };
  };

  // compute tax percent for a row (e.g., 9.0) using master tax records or area rate
  const computeTaxPercentForRow = (row: { description?: string; qty?: number; price?: number; tax?: number }) => {
    if (taxExempt) return 0;
    const inv = findInventoryByDesc(row.description);
    let taxRec: any = undefined;
    if (inv && inv.raw) {
      const tKey = String(inv.raw.tax_id ?? inv.raw.tax ?? inv.raw.tax_code ?? '').trim();
      if (tKey && taxMapState[tKey]) taxRec = taxMapState[tKey];
      const hKey = String(inv.raw.hsn_id ?? inv.raw.hsn_code ?? '').trim();
      if (!taxRec && hKey && hsnMapState[hKey]) {
        const maybe = hsnMapState[hKey];
        const maybeTaxId = String(maybe.tax_id ?? maybe.tax ?? '').trim();
        if (maybeTaxId && taxMapState[maybeTaxId]) taxRec = taxMapState[maybeTaxId];
        else taxRec = maybe;
      }
    }
    if (!taxRec && selectedOutdoor) {
      const hKey = selectedOutdoor.hsnCode ?? undefined;
      if (hKey && hsnMapState[hKey]) {
        const rec = hsnMapState[hKey];
        const tKey = String(rec.tax_id ?? rec.tax ?? rec.tax_code ?? '').trim();
        if (tKey && taxMapState[tKey]) taxRec = taxMapState[tKey];
        else taxRec = rec;
      } else if (selectedOutdoor.taxRate != null) {
        return selectedOutdoor.taxRate * 100;
      }
    }
    if (taxRec) {
      const cg = Number(taxRec.cgst ?? taxRec.cgst_rate ?? 0) || 0;
      const sg = Number(taxRec.sgst ?? taxRec.sgst_rate ?? 0) || 0;
      if (cg || sg) return cg + sg;
      const maybe = Number(taxRec.tax_rate ?? taxRec.rate ?? taxRec.percentage ?? taxRec.gst_percentage ?? 0);
      return maybe > 1.5 ? maybe : maybe * 100;
    }
    // fallback: if absolute tax present and base known, compute percent
    const base = (row.qty || 0) * (row.price || 0);
    if (base > 0 && row.tax && Number(row.tax) > 0) return (Number(row.tax) / base) * 100;
    return 0;
  };

  // Pricing
  const servicesCost = Object.entries(services).reduce((sum, [k, v]) => {
    if (!v) return sum; const edited = servicePrices[k]; if (edited != null && !isNaN(Number(edited))) return sum + Number(edited); const svc = availableServices.find(s => s.id === k); return sum + (svc ? (Number(svc.price) || 0) : 0);
  }, 0);
  // Delivery charge replaces outdoor rent in totals.
  const taxRate = selectedOutdoor?.taxRate;
  // delivery-specific tax (absolute amount)
  const deliveryTax = taxExempt ? 0 : (taxRate ? taxRate * Math.max(0, deliveryCharge) : 0);

  // breakdown for custom items
  const itemsBase = (customItems || []).reduce((s, ci) => s + ((ci.qty || 0) * (ci.price || 0)), 0);
  const itemsDiscount = (customItems || []).reduce((s, ci) => s + Math.min(ci.discount || 0, (ci.qty || 0) * (ci.price || 0)), 0);
  // compute itemsTax and per-component sums dynamically using master tax records
  const itemTaxComponents = (customItems || []).map(ci => computeTaxComponentsForRow(ci));
  const itemsTax = itemTaxComponents.reduce((s, c) => s + (c.tax || 0), 0);
  const itemsCgst = itemTaxComponents.reduce((s, c) => s + (c.cgst || 0), 0);
  const itemsSgst = itemTaxComponents.reduce((s, c) => s + (c.sgst || 0), 0);
  const itemsNet = Math.max(0, itemsBase - itemsDiscount);
  const customItemsTotal = itemsNet + itemsTax;

  // subtotal (pre-tax) and grand totals
  const subtotal = Math.max(0, servicesCost + itemsNet + Math.max(0, deliveryCharge) - discount);

  // total tax is itemsTax + deliveryTax (taxExempt overrides above)
  // helper: resolve a tax record from maps by id
  const findTaxRecord = (taxId?: string) => {
    if (!taxId) return undefined;
    return taxMapState[String(taxId).trim()] || undefined;
  };

  // helper: given a tax record or a numeric rate, return { cgstPct, sgstPct, totalPct }
  const splitTaxPercent = (taxRecOrRate?: any) => {
    if (!taxRecOrRate) return { cgstPct: 0, sgstPct: 0, totalPct: 0 };
    if (typeof taxRecOrRate === 'number') {
      const total = taxRecOrRate * 100;
      return { cgstPct: total / 2, sgstPct: total / 2, totalPct: total };
    }
    // prefer cgst & sgst fields
    const cg = Number(taxRecOrRate.cgst ?? taxRecOrRate.cgst_rate ?? 0);
    const sg = Number(taxRecOrRate.sgst ?? taxRecOrRate.sgst_rate ?? 0);
    if (cg || sg) return { cgstPct: cg, sgstPct: sg, totalPct: (cg + sg) };
    const maybe = Number(taxRecOrRate.tax_rate ?? taxRecOrRate.rate ?? taxRecOrRate.percentage ?? taxRecOrRate.gst_percentage ?? 0);
    const total = maybe > 1.5 ? maybe : maybe * 100;
    return { cgstPct: total / 2, sgstPct: total / 2, totalPct: total };
  };

  // compute totalTax, cgst, sgst dynamically using tax maps and item-level components
  // delivery tax is already computed as deliveryTax (absolute); need to split deliveryTax into cgst/sgst according to outdoor tax rec
  const outdoorTaxRec = (() => {
    const hsnKey = selectedOutdoor?.hsnCode || undefined;
    if (hsnKey && hsnMapState[hsnKey]) {
      const rec = hsnMapState[hsnKey];
      const tKey = String(rec.tax_id ?? rec.tax ?? rec.tax_code ?? '').trim();
      if (tKey && taxMapState[tKey]) return taxMapState[tKey];
      return rec;
    }
    return (selectedOutdoor?.taxRate != null) ? selectedOutdoor.taxRate : undefined;
  })();
  const outdoorSplit = splitTaxPercent(outdoorTaxRec);
  // derive a display split: prefer outdoorSplit, but fall back to weighted item-level split when outdoor has no tax info
  const itemLevelSplits = (customItems || []).map(ci => computeTaxSplitPercentForRow(ci));
  const totalTax = taxExempt ? 0 : (itemsTax + deliveryTax);
  let displaySplit = outdoorSplit;
  if (!displaySplit || !displaySplit.totalPct || displaySplit.totalPct <= 0) {
    const bases = (customItems || []).map(ci => Math.max(0, (ci.qty || 0) * (ci.price || 0) - Math.min(ci.discount || 0, (ci.qty || 0) * (ci.price || 0))));
    const totalBase = bases.reduce((s, v) => s + v, 0);
    if (totalBase > 0) {
      const cgWeighted = bases.reduce((s, b, i) => s + b * (itemLevelSplits[i]?.cgstPct || 0), 0) / totalBase;
      const sgWeighted = bases.reduce((s, b, i) => s + b * (itemLevelSplits[i]?.sgstPct || 0), 0) / totalBase;
      displaySplit = { cgstPct: cgWeighted, sgstPct: sgWeighted, totalPct: (cgWeighted + sgWeighted) };
    } else if (subtotal > 0) {
      const tPct = (totalTax / subtotal) * 100;
      displaySplit = { cgstPct: tPct / 2, sgstPct: tPct / 2, totalPct: tPct };
    }
  }
  const deliveryCgst = deliveryTax * (outdoorSplit.cgstPct / Math.max(1, outdoorSplit.totalPct));
  const deliverySgst = deliveryTax * (outdoorSplit.sgstPct / Math.max(1, outdoorSplit.totalPct));
  const cgst = itemsCgst + deliveryCgst;
  const sgst = itemsSgst + deliverySgst;
  // display tax percentage based on outdoorSplit
  const totalTaxPercent = displaySplit?.totalPct || (subtotal > 0 ? (totalTax / subtotal) * 100 : 0);
  const halfTaxPercent = Number.isFinite(totalTaxPercent) ? (totalTaxPercent / 2) : 0;

  const totalAmount = Math.max(0, subtotal + totalTax);
  // roundoff to nearest rupee
  const roundedTotal = Math.round(totalAmount);
  const roundOff = Number((roundedTotal - totalAmount).toFixed(2));
  const maxAdditionalPayable = Math.max(0, totalAmount - (Number(existingPaid) || 0));
  const safeAdvance = Math.min(Math.max(0, Number(advancePayment) || 0), maxAdditionalPayable);
  const balanceDue = Math.max(0, totalAmount - ((Number(existingPaid) || 0) + safeAdvance));

  // aggregate tax amounts by slab (percent). include item-level slabs and delivery slab
  const slabMap: Record<string, { totalPct: number; cgst: number; sgst: number; cgstPct: number; sgstPct: number }> = {};
  itemTaxComponents.forEach((comp, idx) => {
    const sp = computeTaxSplitPercentForRow(customItems[idx]);
    const key = String(Number(sp.totalPct || 0).toFixed(2));
    if (!key || Number(key) <= 0) return;
    if (!slabMap[key]) slabMap[key] = { totalPct: Number(sp.totalPct || 0), cgst: 0, sgst: 0, cgstPct: Number(sp.cgstPct || 0), sgstPct: Number(sp.sgstPct || 0) };
    slabMap[key].cgst += comp.cgst || 0;
    slabMap[key].sgst += comp.sgst || 0;
  });
  // include delivery split under outdoorSplit if deliveryTax > 0
  if ((deliveryTax || 0) > 0 && (outdoorSplit?.totalPct || 0) > 0) {
    const key = String(Number(outdoorSplit.totalPct || 0).toFixed(2));
    if (!slabMap[key]) slabMap[key] = { totalPct: Number(outdoorSplit.totalPct || 0), cgst: 0, sgst: 0, cgstPct: Number(outdoorSplit.cgstPct || 0), sgstPct: Number(outdoorSplit.sgstPct || 0) };
    slabMap[key].cgst += deliveryCgst || 0;
    slabMap[key].sgst += deliverySgst || 0;
  }
  const slabEntries = Object.keys(slabMap).map(k => slabMap[k]).sort((a,b) => a.totalPct - b.totalPct);

  const toggleService = (k: string) => setServices(s => ({ ...s, [k]: !s[k] }));
  const setServicePrice = (id: string, price: number) => setServicePrices(prev => ({ ...prev, [id]: Math.max(0, Number(price) || 0) }));

  const validate = () => {
    const errs: Record<string,string> = {};
    if (!customer.fullName) errs.fullName = 'Full Name is required';
    if (!customer.mobile) errs.mobile = 'Mobile Number is required';
    if (!eventType) errs.eventType = 'Event Type required';
    if (!startDateTime) errs.startDateTime = 'Event Date required';
    if (!safeAdvance && totalAmount > 0 && (balanceDue === totalAmount)) errs.advancePayment = 'Advance required';
    if ((Number(safeAdvance) || 0) > 0 && !paymentMode) errs.paymentMode = 'Payment Mode required';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const [isSaving, setIsSaving] = useState(false);
  const [createdOutdoorBookingId, setCreatedOutdoorBookingId] = useState<number | string | null>(null);
  const rawEditId = searchParams.get('editId');
  const editModeId: string | number | null = rawEditId ? (rawEditId.match(/\d+/)?.[0] ? Number(rawEditId.match(/\d+/)![0]) : rawEditId) : null;

  const resetForm = () => {
  setCustomer({ fullName: '', mobile: '', altMobile: '', email: '', address: '', deliveryAddress: '', gstin: '', aadhaar: '', pan: '' });
    setSelectedCustomerId(null);
    setEventType('');
    setEventSlot('');
    setStartDateTime('');
    setExpectedGuests('');
    setSpecialReq('');
  setSelectedOutdoorId('');
  setDeliveryCharge(0);
  setServices({});
    setAdvancePayment(0);
    setPaymentMode(paymentModes[0]?.value || 'cash');
    setDiscount(0);
    setUpiTxnId('');
    setChequeNo('');
    setFieldErrors({});
    setCreatedOutdoorBookingId(null);
  setCustomItems([emptyCustomRow()]);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!validate()) return;
    setIsSaving(true);
    try {
      const accountCode = (user as any)?.account_code || '';
      const retailCode = (user as any)?.retail_code || '';
      const bookingPayload: any = {
        account_code: accountCode,
        retail_code: retailCode,
        // outdoor_area_id removed (field hidden) – backend can infer or ignore
        event_type_id: eventType ? Number(eventType) : null,
        // slot_id removed (Event Slot hidden)
        eventdate: startDateTime ? (/^\d{4}-\d{2}-\d{2}$/.test(startDateTime) ? `${startDateTime}T00:00:00` : startDateTime) : null,
        expected_guests: Number(expectedGuests) || 0,
        special_requirements: specialReq || null,
        customer_name: customer.fullName || null,
        phone: customer.mobile || null,
        email: customer.email || null,
  address: customer.address || null,
  delivery_address: (customer as any).deliveryAddress || null,
  alt_phone: (customer as any).altMobile || null,
        gstin: customer.gstin || null,
        aadhaar: (customer as any).aadhaar || null,
        pan: (customer as any).pan || null,
  // delivery charge replaces outdoor rate
  delivery_charge: Number(deliveryCharge) || 0,
    services_total: Number(servicesCost) || 0,
    discount: Number(discount) || 0,
  tax_rate: Number(taxRate) || 0,
  tax_amount: Number(totalTax) || 0,
  cgst_amount: Number(cgst) || 0,
  sgst_amount: Number(sgst) || 0,
    subtotal: Number(subtotal) || 0,
    total_amount: Number(roundedTotal) || 0,
    roundoff: Number(roundOff) || 0,
    balance_due: Number(balanceDue) || 0,
        tax_exempt: !!taxExempt ? 1 : 0,
        STATUS: (Number(balanceDue) || 0) > 0 ? 'pending' : 'confirmed',
        created_by: (user as any)?.username || (user as any)?.user_id || null,
        updated_by: (user as any)?.username || null,
        custom_items: (customItems || []).map(ci => {
          const base = (ci.qty || 0) * (ci.price || 0);
          const disc = Math.min(ci.discount || 0, base);
          const taxAmt = ci.tax || 0;
          return { description: ci.description || null, qty: ci.qty || 0, price: ci.price || 0, discount: disc, tax: taxAmt, line_total: Math.max(0, (base - disc) + taxAmt) };
        }),
      };

      const selectedServiceIds = Object.entries(services).filter(([k,v]) => v).map(([k]) => k);
      const serviceLines = selectedServiceIds.map(sid => {
        const svc = availableServices.find(s => s.id === sid);
        const edited = servicePrices[sid];
        const unit = (edited != null && !isNaN(Number(edited))) ? Number(edited) : (Number(svc?.price) || 0);
        return { service_id: Number(svc?.id) || svc?.id, qty: 1, unit_price: unit, amount: unit, tax_id: (svc as any)?.taxId };
      });
      const paymentPayload = Number(safeAdvance) > 0 ? {
        payment_mode_id: paymentMode ? Number(paymentMode) : null,
        amount: Number(safeAdvance) || 0,
        transaction_id: ((): string | undefined => { const sel = (paymentModes || []).find(pm => String(pm.value) === String(paymentMode)); const label = String(sel?.label || '').toLowerCase(); return label.includes('upi') ? (upiTxnId?.trim() || undefined) : undefined; })(),
        cheque_no: ((): string | undefined => { const sel = (paymentModes || []).find(pm => String(pm.value) === String(paymentMode)); const label = String(sel?.label || '').toLowerCase(); return (label.includes('cheque') || label.includes('check')) ? (chequeNo?.trim() || undefined) : undefined; })(),
      } : undefined;

      const endpointCreate = '/create-outdoor-booking';
      const endpointUpdate = '/update-outdoor-booking';
      let resp: any = null; let createdId: any = null;
      try {
        if (editModeId) {
          resp = await ApiService.post(endpointUpdate, { booking_id: editModeId, booking: bookingPayload, services: serviceLines, payment: paymentPayload });
          createdId = editModeId;
          Swal.fire({ icon: 'success', title: 'Outdoor Booking Updated', timer: 1800, showConfirmButton: false, width: 520 });
        } else {
          resp = await ApiService.post(endpointCreate, { booking: bookingPayload, services: serviceLines, payment: paymentPayload });
          createdId = resp?.outdoor_booking_id ?? resp?.booking_id ?? resp?.data?.booking_id ?? resp?.data ?? null;
          Swal.fire({ icon: 'success', title: 'Outdoor Booking Created', timer: 2200, showConfirmButton: false, width: 520 });
        }
      } catch (e:any) {
        // Fallback to generic endpoints if outdoor-specific not implemented yet
        const fallbackEndpoint = editModeId ? '/update-booking' : '/create-booking';
        try {
          resp = await ApiService.post(fallbackEndpoint, { booking: bookingPayload, services: serviceLines, payment: paymentPayload });
          createdId = resp?.booking_id ?? resp?.data?.booking_id ?? resp?.data ?? null;
          Swal.fire({ icon: 'success', title: 'Booking Saved (Generic)', timer: 2200, showConfirmButton: false, width: 520 });
        } catch (inner) {
          console.error('Failed saving outdoor booking', inner);
          Swal.fire({ icon: 'error', title: 'Save Failed', text: 'Could not save outdoor booking' });
          return;
        }
      }
      setCreatedOutdoorBookingId(createdId);
      resetForm();
      setTimeout(() => navigate('/outdoor-booking'), 600);
    } finally {
      setIsSaving(false);
    }
  };

  const isEdit = !!editModeId;

  return (<>
    <form autoComplete="off" className="min-h-screen bg-slate-50" onSubmit={(e)=>e.preventDefault()}>
      {/* Header bar removed per request */}
      <div className="w-full px-1 sm:px-2 lg:px-3 xl:px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 lg:gap-4">
          <div className="lg:col-span-3 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
            {/* Customer Information */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-2">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center"><Users className="h-4 w-4 mr-2 text-blue-600" /> Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="p-2 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Full Name<span className="text-rose-600">*</span></Label>
                    <Input value={customer.fullName} onChange={e=>{setCustomer({...customer, fullName:e.target.value}); setNameQuery(e.target.value); setCustomerSearchTerm(e.target.value); setShowNameSuggest(true); setFieldErrors(p=>({...p, fullName:''})); setSelectedCustomerId(null);}} className={`h-8 py-1 text-xs ${fieldErrors.fullName?'border-red-400':''}`} placeholder="Enter full name" />
                    {fieldErrors.fullName && <div className="text-[10px] text-red-500">{fieldErrors.fullName}</div>}
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Mobile<span className="text-rose-600">*</span></Label>
                    <Input value={customer.mobile} onChange={e=>{setCustomer({...customer, mobile:e.target.value}); setMobileQuery(e.target.value); setFieldErrors(p=>({...p, mobile:''}));}} className={`h-8 py-1 text-xs ${fieldErrors.mobile?'border-red-400':''}`} placeholder="Mobile" />
                    {fieldErrors.mobile && <div className="text-[10px] text-red-500">{fieldErrors.mobile}</div>}
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Alternate Phone</Label>
                    <Input value={customer.altMobile} onChange={e=> setCustomer({...customer, altMobile:e.target.value})} className="h-8 py-1 text-xs" placeholder="Alternate" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">GSTIN</Label>
                    <Input value={customer.gstin} onChange={e=> { setCustomer({...customer, gstin: e.target.value}); setFieldErrors(p=>({...p, gstin:''})); }} className="h-8 py-1 text-xs" placeholder="GSTIN" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Customer Address</Label>
                    <Textarea rows={2} value={customer.address} onChange={e=> setCustomer({...customer, address:e.target.value})} className="text-xs" />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Delivery Address</Label>
                    <Textarea rows={2} value={customer.deliveryAddress} onChange={e=> setCustomer({...customer, deliveryAddress:e.target.value})} className="text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Event & Outdoor Area */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border-b border-slate-200 py-2 px-2">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center"><Clock className="h-4 w-4 mr-2 text-violet-600" /> Event & Outdoor Details</CardTitle>
              </CardHeader>
              <CardContent className="p-2 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Event Date<span className="text-rose-600">*</span></Label>
                    <Input type="date" value={startDateTime} onChange={e=>{setStartDateTime(e.target.value); setLockedDate(true);}} className={`h-8 py-1 text-xs ${fieldErrors.startDateTime?'border-red-400':''}`} />
                    {fieldErrors.startDateTime && <div className="text-[10px] text-red-500">{fieldErrors.startDateTime}</div>}
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Event Type<span className="text-rose-600">*</span></Label>
                    <Select value={eventType} onValueChange={v=>{setEventType(v); setFieldErrors(p=>({...p, eventType:''}));}}>
                      <SelectTrigger className={`h-8 px-2 text-xs ${fieldErrors.eventType?'border-red-400':''}`}><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent className="max-h-64">
                        {eventTypes.map(o=> <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {fieldErrors.eventType && <div className="text-[10px] text-red-500">{fieldErrors.eventType}</div>}
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Expected Guests</Label>
                    <Input type="number" value={expectedGuests} onChange={e=> setExpectedGuests(e.target.value ? Number(e.target.value) : '')} className="h-8 py-1 text-xs" />
                  </div>
                </div>
                <div className="pt-2">
                  <label className="inline-flex items-center gap-2">
                    <input id="taxExempt" type="checkbox" checked={taxExempt} onChange={e => setTaxExempt(!!e.target.checked)} className="h-4 w-4 text-indigo-600 border rounded" />
                    <span className="text-xs font-medium text-slate-700">Tax Exempt</span>
                  </label>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-xs font-semibold">Special Requirements</Label>
                  <Textarea value={specialReq} onChange={e=> setSpecialReq(e.target.value)} rows={2} className="text-xs" />
                </div>
              </CardContent>
            </Card>
            </div>

            {/* Services */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader
                role="button"
                tabIndex={0}
                onClick={() => setShowServices(s => !s)}
                onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowServices(s => !s); } }}
                className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-slate-200 py-2 px-2 flex items-center justify-between cursor-pointer select-none"
              >
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center"><Wrench className="h-4 w-4 mr-2 text-emerald-600" /> Add-ons & Services</CardTitle>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-3 text-xs" onClick={(e:any)=>{ e.stopPropagation(); setShowServices((s)=>!s); }}>{showServices ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
              </CardHeader>
              {showServices && (
                <CardContent className="p-2 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {availableServices.map(s => (
                      <div key={s.id} className={`rounded-lg border p-2 cursor-pointer ${services[s.id] ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300'}`} onClick={()=> toggleService(s.id)}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-800 truncate" title={s.name}>{s.name}</span>
                          {services[s.id] && <CheckCircle className="h-4 w-4 text-emerald-600" />}
                        </div>
                        {services[s.id] && (
                          <Input type="number" value={servicePrices[s.id] ?? s.price} onChange={e=> setServicePrice(s.id, Number(e.target.value)||0)} className="h-7 text-[11px]" />
                        )}
                        {!services[s.id] && (
                          <div className="text-[11px] text-slate-500">₹{(servicePrices[s.id] ?? s.price) || 0}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
            {/* Additional Items (now correctly below Add-on Services) */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-white border-b border-slate-200 py-2 px-3">
                <div className="flex items-center">
                  <Plus className="h-4 w-4 mr-2 text-cyan-600" />
                  <CardTitle className="text-sm font-semibold text-slate-800 mb-0">Inventory Items</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-2">
                {customItems.length === 0 && (
                  <div className="text-[11px] text-slate-500 py-2 text-center">No items added.</div>
                )}
                {customItems.length > 0 && (
                  <div className="overflow-x-auto overflow-visible">
                    <table className="w-full text-xs border border-slate-200 rounded-md">
                      <thead className="bg-slate-100 text-[11px]">
                        <tr className="text-left">
                          <th className="px-2 py-1 w-10">Sl.</th>
                          <th className="px-2 py-1 w-56">Description</th>
                          <th className="px-2 py-1 w-20">Qty</th>
                          <th className="px-2 py-1 w-20">Price</th>
                          <th className="px-2 py-1 w-24">Discount Amt</th>
                          <th className="px-2 py-1 w-20">Tax</th>
                          <th className="px-2 py-1 w-24">Total Value</th>
                          <th className="px-2 py-1 w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {customItems.map((row, idx) => {
                          const base = (row.qty || 0) * (row.price || 0);
                          const disc = Math.min(row.discount || 0, base);
                          const taxAmt = row.tax || 0;
                          const lineTotal = Math.max(0, (base - disc) + taxAmt);
                          return (
                            <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50 transition-colors">
                              <td className="px-2 py-1 align-middle">{idx + 1}</td>
                              <td className="px-2 py-1 align-middle w-56 relative">
                                <Input
                                  type="text"
                                  value={row.description}
                  onChange={e => {
                                    const val = e.target.value;
                                    setCustomItems(rs => rs.map(r => r.id === row.id ? { ...r, description: val } : r));
                                    if (val && val.trim().length >= 2) {
                                      const q = val.trim().toLowerCase();
                                      const matches = masterInventory.filter(mi => String(mi.name || '').toLowerCase().includes(q)).slice(0, 8);
                    setDescSuggestions(matches);
                    setDescHighlight(matches.length > 0 ? 0 : -1);
                                      // compute position: align dropdown flush with input bottom-left edge
                                      const inputEl = (e.target as HTMLElement);
                                      const rect = inputEl.getBoundingClientRect();
                                      const left = rect.left + window.scrollX;
                                      const width = Math.max(120, rect.width);
                                      setPortalRect({ top: rect.bottom + window.scrollY, left, width });
                                      setPortalRowId(row.id);
                                    } else {
                                      setDescSuggestions([]);
                                      setPortalRect(null);
                                      setPortalRowId(null);
                    setDescHighlight(-1);
                                    }
                                  }}
                                  placeholder="Description"
                                  className="h-8 text-[11px] w-full focus:outline-none focus:ring-0"
                                  ref={(el:any) => registerRef(row.id, 'desc', el)}
                                  onKeyDown={(e:any) => {
                                    if (e.key === 'Enter') {
                                      // if suggestions open and highlight selected, choose it
                                      if (descSuggestions.length > 0 && descHighlight >= 0) {
                                        e.preventDefault();
                                        const sel = descSuggestions[descHighlight];
                                        const targetRow = row.id;
                                        const invTaxRate = (sel as any)?.taxRate ?? undefined;
                                        setCustomItems(rs => rs.map(r => {
                                          if (r.id !== targetRow) return r;
                                          const price = Number((sel as any).price) || 0;
                                          const base = (r.qty || 0) * price;
                                          const computedTax = (invTaxRate != null) ? (base * invTaxRate) : (taxRate ? base * taxRate : 0);
                                          return { ...r, description: String((sel as any).name), price, tax: computedTax };
                                        }));
                                        setDescSuggestions([]);
                                        setPortalRect(null);
                                        setPortalRowId(null);
                                        setDescHighlight(-1);
                                        setTimeout(() => { const q = rowRefs.current?.[targetRow!]?.qty; if (q) q.focus(); }, 20);
                                      } else {
                                        e.preventDefault();
                                        const next = rowRefs.current?.[row.id]?.qty;
                                        if (next) next.focus();
                                      }
                                    } else if (e.key === 'ArrowDown') {
                                      if (descSuggestions.length > 0) {
                                        e.preventDefault();
                                        setDescHighlight(i => Math.min(Math.max(i, 0) + 1, descSuggestions.length - 1));
                                      }
                                    } else if (e.key === 'ArrowUp') {
                                      if (descSuggestions.length > 0) {
                                        e.preventDefault();
                                        setDescHighlight(i => Math.max(i - 1, 0));
                                      }
                                    } else if (e.key === 'Escape') {
                                      setDescSuggestions([]);
                                      setPortalRect(null);
                                      setPortalRowId(null);
                                      setDescHighlight(-1);
                                    }
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Input type="number" value={row.qty} onChange={e => setCustomItems(rs => rs.map(r => {
                                  if (r.id !== row.id) return r;
                                  const newQty = Math.max(0, Number(e.target.value) || 0);
                                  const updated = { ...r, qty: newQty };
                                  const newTax = computeTaxForRow(updated);
                                  return { ...updated, tax: newTax };
                                }))} className="h-7 text-[11px] w-20" ref={(el:any) => registerRef(row.id, 'qty', el)} onKeyDown={(e:any) => { if (e.key === 'Enter') { e.preventDefault(); const next = rowRefs.current?.[row.id]?.price; if (next) next.focus(); } }} />
                              </td>
                              <td className="px-2 py-1">
                                <Input type="number" value={row.price} onChange={e => setCustomItems(rs => rs.map(r => {
                                  if (r.id !== row.id) return r;
                                  const newPrice = Math.max(0, Number(e.target.value) || 0);
                                  const updated = { ...r, price: newPrice };
                                  const newTax = computeTaxForRow(updated);
                                  return { ...updated, tax: newTax };
                                }))} className="h-7 text-[11px]" ref={(el:any) => registerRef(row.id, 'price', el)} onKeyDown={(e:any) => { if (e.key === 'Enter') { e.preventDefault(); const next = rowRefs.current?.[row.id]?.discount; if (next) next.focus(); } }} />
                              </td>
                              <td className="px-2 py-1">
                                <Input type="number" value={row.discount} onChange={e => setCustomItems(rs => rs.map(r => r.id === row.id ? { ...r, discount: Math.max(0, Number(e.target.value) || 0) } : r))} className="h-7 text-[11px]" ref={(el:any) => registerRef(row.id, 'discount', el)} onKeyDown={(e:any) => { if (e.key === 'Enter') { e.preventDefault(); // when Enter pressed in discount, add new row and focus its description
                                          setCustomItems(rs => {
                                            const nextRow = emptyCustomRow();
                                            const updated = [...rs, nextRow];
                                            // focus will be set in next tick
                                            setTimeout(() => { const d = rowRefs.current?.[nextRow.id]?.desc; if (d) d.focus(); }, 50);
                                            return updated;
                                          });
                                        } }} />
                              </td>
                              <td className="px-2 py-1">
                                <Input type="number" value={row.tax} readOnly className="h-7 text-[11px] bg-slate-50" ref={(el:any) => registerRef(row.id, 'tax', el)} />
                              </td>
                              <td className="px-2 py-1 font-semibold">₹{lineTotal.toFixed(2)}</td>
                              <td className="px-1 py-1">
                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-rose-600" onClick={() => setCustomItems(rs => rs.filter(r => r.id !== row.id))}>✕</Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-semibold">
                          <td className="px-2 py-2 text-right" colSpan={6}>Items Total</td>
                          <td className="px-2 py-2">₹{customItemsTotal.toFixed(2)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right summary column */}
          <div className="space-y-3 lg:space-y-4">
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-slate-200 py-2 px-2">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center"><MapPin className="h-4 w-4 mr-2 text-orange-600" /> Outdoor Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-2 space-y-2 text-xs">
                <div className="flex justify-between"><span>Services</span><span className="font-medium">₹{servicesCost.toFixed(2)}</span></div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Delivery Charge</Label>
                  <Input type="number" value={deliveryCharge} onChange={e=> setDeliveryCharge(Math.max(0, Number(e.target.value) || 0))} className="h-8 py-1 text-xs" />
                </div>
                <div className="border-t my-1" />
                <div className="flex justify-between text-sm font-semibold"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
                {slabEntries.length > 0 ? (
                  slabEntries.map(se => (
                    <div key={String(se.totalPct)} className="space-y-0.5">
                      <div className="flex justify-between"><span>CGST <span className="text-[11px] text-slate-500">({Number(se.cgstPct).toFixed(2)}%)</span></span><span className="font-medium">₹{se.cgst.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>SGST <span className="text-[11px] text-slate-500">({Number(se.sgstPct).toFixed(2)}%)</span></span><span className="font-medium">₹{se.sgst.toFixed(2)}</span></div>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex justify-between"><span>CGST <span className="text-[11px] text-slate-500">({outdoorSplit.cgstPct.toFixed(2)}%)</span></span><span className="font-medium">₹{cgst.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>SGST <span className="text-[11px] text-slate-500">({outdoorSplit.sgstPct.toFixed(2)}%)</span></span><span className="font-medium">₹{sgst.toFixed(2)}</span></div>
                  </>
                )}
                <div className="flex justify-between text-sm font-semibold"><span>Roundoff</span><span>₹{roundOff.toFixed(2)}</span></div>
                <div className="my-2">
                  <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-700">Total</div>
                      <div className="text-lg font-extrabold text-blue-800">₹{roundedTotal.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-between"><span>Existing Paid</span><span>₹{existingPaid.toFixed(2)}</span></div>
                <div className="flex justify-between items-center mt-2">
                  <div className="text-sm">Advance Now</div>
                  <div className="text-sm font-medium">₹{safeAdvance.toFixed(2)}</div>
                </div>
                <div className="mt-2">
                  <div className="inline-block px-3 py-2 bg-slate-50 border rounded text-sm font-medium">Balance Due: ₹{balanceDue.toFixed(2)}</div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-rose-50 to-pink-50 border-b border-slate-200 py-2 px-2">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center"><CreditCard className="h-4 w-4 mr-2 text-rose-600" /> Payments</CardTitle>
              </CardHeader>
              <CardContent className="p-2 space-y-2 text-xs">
                <div className="space-y-0.5">
                  <Label className="text-[11px] font-medium">Advance Payment</Label>
                  <Input type="number" value={advancePayment} onChange={e=>{setAdvancePayment(Number(e.target.value)||0); setFieldErrors(p=>({...p, advancePayment:''}));}} className={`h-8 py-1 text-xs ${fieldErrors.advancePayment?'border-red-400':''}`} />
                  {fieldErrors.advancePayment && <div className="text-[10px] text-red-500">{fieldErrors.advancePayment}</div>}
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[11px] font-medium">Payment Mode</Label>
                  <Select value={paymentMode} onValueChange={v=>{setPaymentMode(v); setFieldErrors(p=>({...p, paymentMode:''}));}}>
                    <SelectTrigger className={`h-8 px-2 text-xs ${fieldErrors.paymentMode?'border-red-400':''}`}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{paymentModes.map(p=> <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {fieldErrors.paymentMode && <div className="text-[10px] text-red-500">{fieldErrors.paymentMode}</div>}
                </div>
                {paymentMode && paymentModes.find(m=>m.value===paymentMode)?.label.toLowerCase().includes('upi') && (
                  <div className="space-y-0.5">
                    <Label className="text-[11px] font-medium">UPI Txn ID</Label>
                    <Input value={upiTxnId} onChange={e=> setUpiTxnId(e.target.value)} className={`h-8 py-1 text-xs ${fieldErrors.upiTxnId?'border-red-400':''}`} />
                    {fieldErrors.upiTxnId && <div className="text-[10px] text-red-500">{fieldErrors.upiTxnId}</div>}
                  </div>
                )}
                {paymentMode && paymentModes.find(m=>m.value===paymentMode)?.label.toLowerCase().includes('cheque') && (
                  <div className="space-y-0.5">
                    <Label className="text-[11px] font-medium">Cheque No</Label>
                    <Input value={chequeNo} onChange={e=> setChequeNo(e.target.value)} className={`h-8 py-1 text-xs ${fieldErrors.chequeNo?'border-red-400':''}`} />
                    {fieldErrors.chequeNo && <div className="text-[10px] text-red-500">{fieldErrors.chequeNo}</div>}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" onClick={() => setAdvancePayment(Math.round(roundedTotal * 0.5))} className="h-8 px-3 text-xs">50%</Button>
                    <Button type="button" size="sm" onClick={() => setAdvancePayment(Math.round(roundedTotal * 0.75))} className="h-8 px-3 text-xs">75%</Button>
                    <Button type="button" size="sm" onClick={() => setAdvancePayment(Math.round(roundedTotal * 1))} className="h-8 px-3 text-xs">100%</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Confirmation card with big primary button */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-2">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">Confirmation</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  <Button type="button" size="lg" onClick={handleSave} disabled={isSaving} className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold">{isEdit ? 'Update Booking' : 'Confirm Booking'}</Button>
                  <Button type="button" variant="outline" size="sm" onClick={resetForm} disabled={isSaving} className="w-full h-10">Reset Form</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </form>
  {portalRect && portalRowId && descSuggestions.length > 0 && createPortal(
      <div style={{ position: 'absolute', top: portalRect.top + 'px', left: portalRect.left + 'px', width: portalRect.width + 'px', zIndex: 9999 }}>
  <div className="bg-white rounded shadow-sm text-[12px] max-h-56 overflow-auto">
          {descSuggestions.map((sug, si) => (
            <div key={sug.id} className={`px-3 py-2 cursor-pointer ${si === descHighlight ? 'bg-slate-100' : 'hover:bg-slate-100'}`} onMouseDown={(ev:any) => {
                ev.preventDefault();
                const targetRow = portalRowId;
                setCustomItems(rs => rs.map(r => {
                  if (r.id !== targetRow) return r;
                  const price = Number(sug.price) || 0;
                  const base = (r.qty || 0) * price;
                  const invTaxRate = (sug as any)?.taxRate ?? undefined;
                  const computedTax = (invTaxRate != null) ? (base * invTaxRate) : (taxRate ? base * taxRate : 0);
                  return { ...r, description: String(sug.name), price, tax: computedTax };
                }));
                setDescSuggestions([]);
                setPortalRect(null);
                setPortalRowId(null);
                setDescHighlight(-1);
                // focus qty of the same row after applying suggestion
                setTimeout(() => { const q = rowRefs.current?.[targetRow!]?.qty; if (q) q.focus(); }, 20);
              }} onMouseEnter={() => setDescHighlight(si)}>
              <div className="text-sm font-medium truncate">{sug.name}</div>
            </div>
          ))}
        </div>
      </div>, document.body)
    }
    </>
  );
}
