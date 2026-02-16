import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { DataService } from '@/services/userService';
import { format } from 'date-fns';
import { Printer, ArrowLeft } from 'lucide-react';

type BookingRow = any;

const currency = (n: number | undefined | null) => `₹${(Number(n||0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Convert number to words (Indian numbering system)
function numberToIndianWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const twoDigits = (n:number) => n < 20 ? ones[n] : `${tens[Math.floor(n/10)]}${n%10?` ${ones[n%10]}`:""}`.trim();
  const threeDigits = (n:number) => {
    const h = Math.floor(n/100), r = n%100;
    return `${h?`${ones[h]} Hundred${r?" ":""}`:""}${r?twoDigits(r):""}`.trim();
  };
  if (amount === 0) return "Rupees Zero Only";
  const r = Math.round((amount + Number.EPSILON) * 100) / 100;
  const rupees = Math.floor(r);
  const paise = Math.round((r - rupees) * 100);
  const parts:string[] = [];
  const units = [
    { mod: 10000000, name: "Crore" },
    { mod: 100000, name: "Lakh" },
    { mod: 1000, name: "Thousand" },
    { mod: 100, name: "" },
  ];
  let n = rupees;
  for (const u of units) {
    if (n >= u.mod) {
      const q = Math.floor(n / u.mod);
      n = n % u.mod;
      const chunk = u.mod === 100 ? threeDigits(q) : twoDigits(q);
      parts.push(`${chunk}${u.name?` ${u.name}`:""}`.trim());
    }
  }
  // Append the remaining tens/ones after processing hundreds
  if (n > 0) {
    parts.push(twoDigits(n));
  }
  const words = parts.join(" ") || "Zero";
  if (paise) {
    return `Rupees ${words} and ${twoDigits(paise)} Paise Only`.replace(/\s+/g,' ').trim();
  }
  return `Rupees ${words} Only`.replace(/\s+/g,' ').trim();
}

export default function InvoicePrint() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const accountCode = (user as any)?.account_code || '';
  const retailCode = (user as any)?.retail_code || '';

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [invoice, setInvoice] = React.useState<any | null>(null);
  // Read seller/retail master from session for "From" details
  const retailMaster = React.useMemo(() => {
    try {
      const raw = sessionStorage.getItem('retail_master');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);
  // Build seller (From) details from retail_master with sensible fallbacks
  const seller = React.useMemo(() => {
    const rm: any = retailMaster || {};
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
    const name = pick(rm, ['retail_name','name','company_name','org_name','retailname']);
    const a1 = pick(rm, ['address','address1','address_line1','addr1','line1']);
    const a2 = pick(rm, ['address2','address_line2','addr2','line2']);
    const city = pick(rm, ['city','city_name']);
    const state = pick(rm, ['state_name','state']);
    const pin = pick(rm, ['pincode','pin','zip','zipcode']);
    const phone = pick(rm, ['phone','phone_no','mobile','mobile_no','contact','org_phone']);
    const email = pick(rm, ['email','mail']);
    const gst = pick(rm, ['gstin','gst_no','gst','gst_number','org_gstin']);
    const stateCode = pick(rm, ['state_code','code']);
    const addrLines = [a1, a2, [city, state, pin].filter(Boolean).join(', ')].filter(Boolean);
    return { name, addressLines: addrLines, phone, email, gst, state, stateCode };
  }, [retailMaster]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
  if (!bookingId || !accountCode || !retailCode) return;
  // Use the display booking_id exactly as shown (e.g., INV-2). Do not strip hyphens.
  const canonicalBookingId = String(bookingId).trim();
  const numericBookingId = canonicalBookingId.replace(/\D+/g, '');
  // Load master tables first
  const masterTables = ['master_hall','master_event_type','master_hsn','master_tax','master_service'];
    const mastersRes: any = await DataService.readData(masterTables, accountCode, retailCode);
    let data: any = mastersRes?.data || {};
    if (Array.isArray(data)) {
      data = {};
    }
    // Then load booking-scoped data via /read-by-booking
  let bookRes: any = await DataService.readByBooking(['booking','booking_service','booking_payment'], accountCode, retailCode, canonicalBookingId);
    let bookData: any = bookRes?.data || {};
    // Fallback: if nothing returned, try again with numeric-only ID (e.g., 2 for INV-2)
    const noBookingData = !bookData || (typeof bookData === 'object' && Object.keys(bookData).length === 0) || (Array.isArray((bookData as any).booking) && (bookData as any).booking.length === 0);
    if (noBookingData && numericBookingId && numericBookingId !== canonicalBookingId) {
      const bookRes2: any = await DataService.readByBooking(['booking','booking_service','booking_payment'], accountCode, retailCode, numericBookingId);
      const bookData2: any = bookRes2?.data || {};
      if (bookData2 && (Object.keys(bookData2).length > 0)) {
        bookRes = bookRes2;
        bookData = bookData2;
      }
    }
    if (bookData && typeof bookData === 'object') {
      data = { ...data, ...bookData };
    }
    const bookings: BookingRow[] = data.booking || [];
  // Accept both singular and plural table keys
  const services: any[] = data.booking_service || data.booking_services || [];
  const payments: any[] = data.booking_payment || data.booking_payments || [];
    const halls: any[] = data.master_hall || [];
    const customers: any[] = data.master_customer || [];
    const eventTypes: any[] = data.master_event_type || [];
  const hsnRows: any[] = data.master_hsn || [];
    const taxRows: any[] = data.master_tax || [];
  const serviceMaster: any[] = data.master_service || data.service_master || data.services || [];

        // Robust booking lookup: id, booking_id, display/invoice number, and numeric part (e.g., matches INV-1 with 1)
        const normalize = (v:any) => String(v ?? '').trim();
        const onlyDigits = (s:string) => s.replace(/\D+/g,'');
        const target = normalize(bookingId);
        const targetDigits = onlyDigits(target);
        const row = bookings.find((b:any) => {
          const candidates = [
            normalize(b.booking_id),
            normalize(b.id),
            normalize(b.booking_display_id || b.display_id || b.invoice_no || b.invoice_number)
          ].filter(Boolean);
          if (candidates.includes(target)) return true;
          const candDigits = new Set(candidates.map(onlyDigits).filter(Boolean));
          if (targetDigits && candDigits.has(targetDigits)) return true;
          if (targetDigits && candidates.includes(`INV-${targetDigits}`)) return true;
          return false;
        });
        if (!row) throw new Error('Booking not found');

        // derive details
        const hall = halls.find(h => String(h.hall_id || h.id) === String(row.hall_id || row.hallId));
        // Resolve Hall HSN info: code + human label (description may contain the code in our master)
        const resolveHallHsnInfo = () => {
          const norm = (v:any) => String(v ?? '').trim();
          const codeDirect = norm(hall?.hsn_code || hall?.hsnCode || '');
          // Try to find HSN record by id or code
          const key = norm(hall?.hsn_id ?? hall?.hsnId ?? hall?.hsn ?? codeDirect);
          let rec = null as any;
          if (key) {
            rec = hsnRows.find((r:any) => {
              const cand = [r.hsn_id, r.id, r.code, r.hsn_code, r.description].map(norm).filter(Boolean);
              return cand.includes(key);
            }) || null;
          }
          // In our data, master_hsn.description holds the numeric HSN like '997211'
          let code = norm(codeDirect || rec?.hsn_code || rec?.code || rec?.description || '');
          const label = norm(rec?.description || rec?.hsn_description || rec?.name || code);
          // If code is still empty but label looks like a numeric HSN (all digits), use label as code
          if (!code && label && /^\d{4,8}$/.test(label)) code = label;
          return { code, label };
        };
  const { code: hallHsnCode, label: hallHsnLabel } = resolveHallHsnInfo();
        const customer = (() => {
          const pk = String(row.customer_id || row.customerId || row.CustomerID || '');
          return customers.find((c:any)=> String(c.customer_id||c.id||c.CustomerID) === pk) || null;
        })();
        // Resolve Event Type robustly from various possible keys on booking
        const eventIdRaw = (() => {
          const keys = ['event_type_id','eventTypeId','event_typeid','event_typeID','eventType_id','event_id','eventId'];
          for (const k of keys) {
            const v = (row as any)[k];
            if (v != null && String(v).trim() !== '') return String(v).trim();
          }
          return '';
        })();
        const evt = eventTypes.find(e => String(e.event_type_id || e.id) === eventIdRaw);
        const eventNameResolved = (() => {
          const nameFromMaster = evt?.event_type_name || (evt as any)?.name;
          if (nameFromMaster) return String(nameFromMaster);
          const keys = ['event_type_name','eventTypeName','event_name','event','event_type'];
          for (const k of keys) {
            const v = (row as any)[k];
            if (v != null && String(v).trim() !== '') return String(v).trim();
          }
          return '-';
        })();
  // Robustly match related rows using multiple keys and route digits fallback
  const routeDigits = String(bookingId ?? '').replace(/\D+/g, '');
  const rowKeys = [row.booking_id, row.id]
    .map((v:any) => (v!=null ? String(v) : ''))
    .filter(Boolean);
  const targetIdMatch = (x:any) => {
    const k = String(x.booking_id || x.bookingId || x.bookingID || '');
    if (!k) return false;
    if (rowKeys.includes(k)) return true;
    if (routeDigits && k === routeDigits) return true;
    const kDigits = k.replace(/\D+/g, '');
    if (routeDigits && kDigits && kDigits === routeDigits) return true;
    return false;
  };
  const svc = services.filter(targetIdMatch);
  const pays = payments.filter(targetIdMatch);

        // Build service metadata map from master_service (name + optional HSN)
        const serviceMetaMap: Record<string, { name?: string; hsn?: string }> = {};
        (serviceMaster || []).forEach((ms:any) => {
          const id = String(ms.service_id || ms.id || ms._id || '').trim();
          if (!id) return;
          const name = ms.service_name || ms.name || ms.service || '';
          // Resolve HSN from either explicit code fields or via hsn_id lookup
          let hsn = String(ms.hsn_code || ms.hsn || ms.HSN || ms.HSNCode || ms.code || '').trim();
          if (!hsn && (ms.hsn_id != null || ms.hsnId != null)) {
            const key = String(ms.hsn_id ?? ms.hsnId).trim();
            const rec = (hsnRows || []).find((r:any) => {
              const cand = [r.hsn_id, r.id, r.code, r.hsn_code, r.description].map((v:any)=> String(v ?? '').trim()).filter(Boolean);
              return cand.includes(key);
            });
            if (rec) {
              hsn = String(rec.hsn_code || rec.code || rec.description || '').trim();
              // if description looks like numeric HSN, keep it
              if (!hsn && rec.description && /^\d{4,8}$/.test(String(rec.description))) hsn = String(rec.description);
            }
          }
          serviceMetaMap[id] = { name: name ? String(name) : undefined, hsn: hsn || undefined };
        });

    const serviceLines = svc.map((s,idx) => {
          const sid = String(s.service_id || s.id || '').trim();
          const meta = sid ? serviceMetaMap[sid] : undefined;
          const svcHSN = String(s.hsn_code || s.hsn || meta?.hsn || '').trim();
          return {
            sno: idx+1,
            description: s.service_name || meta?.name || s.service_description || s.service || s.description || s.name || `Service ${idx+1}`,
            qty: Number(s.qty || s.quantity || 1) || 1,
            rate: Number(s.rate || s.unit_price || s.price || 0) || 0,
            amount: Number(s.amount || s.line_total || (Number(s.qty||1) * Number(s.rate||0))) || 0,
            // Prefer per-service HSN, otherwise fallback to hall HSN
      hsn: svcHSN || hallHsnCode,
      // Carry through raw row for further tax derivation
      _raw: s,
          } as any;
        });
        // Fallback: if hall HSN is missing, try to pick from any service record's hsn
        const hallHsnFinal = ((): string => {
          const direct = String(hallHsnCode || '').trim();
          if (direct) return direct;
          // Prefer any explicit HSN found on a service line
          const fromSvcLine = serviceLines.find((l:any) => l.hsn && String(l.hsn).trim() !== '');
          if (fromSvcLine) return String(fromSvcLine.hsn).trim();
          // As a last resort, check raw booking service rows
          const fromSvc = svc.find((s:any) => s.hsn_code || s.hsn);
          const svcCode = String(fromSvc?.hsn_code || fromSvc?.hsn || '').trim();
          return svcCode || '';
        })();
  const itemsTotal = serviceLines.reduce((a,l)=> a + l.amount, 0);
  const hallRate = Number(row.hall_rate ?? row.hallrent ?? row.hall_amount ?? 0) || 0;
        const servicesTotal = Number(row.services_total ?? itemsTotal) || 0;
        const discount = Number(row.discount ?? 0) || 0;
        const cgstAmt = Number(row.cgst_amount ?? 0) || 0;
        const sgstAmt = Number(row.sgst_amount ?? 0) || 0;
        let taxRate = row.tax_rate != null ? Number(row.tax_rate) : undefined;
        if (taxRate != null && taxRate > 1.5) taxRate = taxRate / 100; // percent -> fraction
        // Derive tax rate from HSN/Tax if missing
        if ((taxRate == null || isNaN(taxRate)) && halls.length) {
          const hall = halls.find(h => String(h.hall_id || h.id) === String(row.hall_id || row.hallId));
          const hsnKey = hall ? normalize(hall.hsn_id ?? hall.hsnId ?? hall.hsn ?? hall.hsn_code) : '';
          const hsn = hsnRows.find((h:any)=> [normalize(h.hsn_id), normalize(h.id), normalize(h.hsn_code), normalize(h.code)].includes(hsnKey));
          const taxKey = hsn ? normalize(hsn.tax_id ?? hsn.tax) : '';
          const taxRec = taxRows.find((t:any)=> normalize(t.tax_id||t.id||t.tax_code||t.code) === taxKey);
          const extractRate = (rec:any): number | undefined => {
            if (!rec) return undefined;
            let r:any = rec.tax_rate ?? rec.rate ?? rec.percentage ?? rec.total_rate ?? rec.gst_percentage ?? rec.gst_percent ?? rec.tax_percent;
            const cg = Number(rec.cgst ?? rec.cgst_rate ?? 0) || 0;
            const sg = Number(rec.sgst ?? rec.sgst_rate ?? 0) || 0;
            if (cg > 0 || sg > 0) r = cg + sg;
            if (r == null) return undefined;
            r = Number(r);
            if (isNaN(r)) return undefined;
            return r > 1.5 ? r/100 : r;
          };
          taxRate = extractRate(hsn) ?? extractRate(taxRec);
        }

  const subTotal = hallRate + servicesTotal; // before discount & tax
        const taxableValue = Math.max(subTotal - discount, 0);
        const bookingTotal = Number(row.total_amount ?? row.amount ?? (taxableValue + cgstAmt + sgstAmt)) || 0;
        const paid = pays.reduce((a,p)=> a + Number(p.amount || p.paid_amount || 0), 0);
        const balance = Math.max(bookingTotal - paid, 0);

  // Prefer invoice/billing/created date, then event date
  const invoiceDateVal = row.invoice_date || row.billing_date || row.created_at || row.createdon || row.createdOn;
  const eventDate = row.eventdate || row.start_time || row.start || row.startDate;
  const dateObj = (invoiceDateVal ? new Date(invoiceDateVal) : (eventDate ? new Date(eventDate) : new Date()));
  const eventDateObj = eventDate ? new Date(eventDate) : dateObj;

  const company = {
          // Do not default to 'Banquet' to avoid showing placeholder text
          name: (user as any)?.org_name || (user as any)?.account_name || '',
          address: (user as any)?.org_address || '',
          phone: (user as any)?.org_phone || '',
          gst: (user as any)?.org_gstin || '',
        };

        const party = {
          name: row.customer_name || row.customer || customer?.customer_name || customer?.name || '-',
          phone: row.phone || row.mobile || customer?.phone || customer?.mobile || '-',
          email: row.email || customer?.email || '-',
        };

        // Build items: Hall first, then services separately
  const hallAmount = hallRate > 0 ? hallRate : (serviceLines.length === 0 ? taxableValue : 0);
        const itemsCombined: any[] = [];
        if (hallAmount > 0) {
          itemsCombined.push({
            sno: 1,
            description: hall?.hall_name || 'Appointments ',
            qty: 1,
            rate: hallAmount,
            amount: hallAmount,
            hsn: hallHsnFinal || invoice?.meta?.hsn,
          });
        }
        serviceLines.forEach((sl, i) => {
          // Ensure each service line carries its own HSN when available
          itemsCombined.push({ ...sl, sno: itemsCombined.length + 1, hsn: (sl.hsn || hallHsnFinal || '') });
        });

        // Discount applies only to hall
        if (discount > 0 && itemsCombined.length) {
          const hallIdx = 0; // hall is first when present
          itemsCombined.forEach((it, idx) => {
            it.discountAmt = idx === hallIdx ? Math.round(discount * 100) / 100 : 0;
          });
        }

        const displayId = String(row.booking_display_id || row.display_id || row.invoice_no || row.invoice_number || '') || '';
        // Build Services Tax Details: show line-wise CGST/SGST where possible
        const deriveCombinedRate = (rec:any): { total?: number; cgst?: number; sgst?: number } => {
          if (!rec) return {};
          const num = (v:any) => {
            if (v == null || v === '') return undefined as any;
            const n = Number(v);
            if (isNaN(n)) return undefined as any;
            return n;
          };
          let total = num(rec.tax_rate ?? rec.rate ?? rec.percentage ?? rec.total_rate ?? rec.gst_percentage ?? rec.gst_percent ?? rec.tax_percent);
          let cg = num(rec.cgst ?? rec.cgst_rate);
          let sg = num(rec.sgst ?? rec.sgst_rate);
          if ((cg != null || sg != null) && (total == null || total === 0)) {
            cg = Number(cg || 0); sg = Number(sg || 0);
            if (cg + sg > 0) total = cg + sg;
          }
          // Normalize: interpret >1.5 as percent
          let cgst = cg, sgst = sg;
          if (total != null && total > 1.5) {
            if (cgst != null) cgst = cgst / 100;
            if (sgst != null) sgst = sgst / 100;
            total = total / 100;
          }
          if ((cgst == null || sgst == null) && total != null) {
            cgst = total/2; sgst = total/2;
          }
          return { total: total ?? undefined, cgst: cgst ?? undefined, sgst: sgst ?? undefined };
        };
        const findHsnRec = (key:string) => {
          const norm = (v:any) => String(v ?? '').trim();
          if (!key) return null as any;
          return hsnRows.find((r:any)=> {
            const cand = [r.hsn_id, r.id, r.code, r.hsn_code, r.description].map(norm).filter(Boolean);
            return cand.includes(norm(key));
          }) || null;
        };
        const serviceTaxDetails = serviceLines.map((sl:any) => {
          const s = sl._raw || {};
          const normB = (v:any) => {
            const t = String(v ?? '').toLowerCase();
            return ['1','true','yes','y','on'].includes(t) || v === 1 || v === true;
          };
          const isExempt = normB(s.taxexempted ?? s.tax_exempt ?? s.taxExempt ?? s.is_tax_exempt ?? s.exempt ?? s.taxexampted ?? s.tax_exampted);
          const rawTaxKey = s.tax_id ?? s.tax ?? s.tax_code;
          const taxRec = rawTaxKey ? taxRows.find((t:any)=> String(t.tax_id ?? t.id ?? t.tax_code ?? t.code) === String(rawTaxKey)) : null;
          const hsnKey = s.hsn_code ?? s.hsn ?? sl.hsn;
          const hsnRec = hsnKey ? findHsnRec(String(hsnKey)) : null;
          // Prefer tax from service->tax_id; else HSN->tax; else hall taxRate
          const r1 = deriveCombinedRate(taxRec);
          const r2 = deriveCombinedRate(hsnRec);
          const effective = r1.total != null ? r1 : (r2.total != null ? r2 : (taxRate != null ? { total: taxRate, cgst: (taxRate/2), sgst: (taxRate/2) } : {}));
          const taxable = Math.max(Number(sl.amount || 0), 0);
          const cgstAmtL = isExempt ? 0 : Math.round(((effective.cgst ?? 0) * taxable + Number.EPSILON) * 100) / 100;
          const sgstAmtL = isExempt ? 0 : Math.round(((effective.sgst ?? 0) * taxable + Number.EPSILON) * 100) / 100;
          const pctFmt = (p:number|undefined) => (p != null ? `${Math.round((p*100)*100)/100}%` : '-');
          return {
            description: sl.description,
            hsn: String(sl.hsn || '') || '-',
            taxable,
            cgstRatePct: effective.cgst != null && !isExempt ? Math.round((effective.cgst*100)*100)/100 : undefined,
            sgstRatePct: effective.sgst != null && !isExempt ? Math.round((effective.sgst*100)*100)/100 : undefined,
            cgstAmt: cgstAmtL,
            sgstAmt: sgstAmtL,
            totalTax: Math.round(((cgstAmtL + sgstAmtL) + Number.EPSILON) * 100) / 100,
            _isExempt: isExempt,
          };
        });

        const inv = {
          id: displayId || String(row.booking_id || row.id),
          date: dateObj,
          hall: hall?.hall_name || hall?.name || '-',
          event: eventNameResolved,
          eventDate: eventDateObj,
          items: itemsCombined.length ? itemsCombined : [{ sno: 1, description: hall?.hall_name || 'Appointments ', qty: 1, rate: taxableValue, amount: taxableValue, hsn: hallHsnFinal || hall?.hsn_code || hall?.hsnCode }],
          amounts: {
            subTotal,
            discount,
            taxableValue,
            cgst: cgstAmt,
            sgst: sgstAmt,
            cgstRatePct: taxRate != null ? Math.round(((taxRate/2)*100)*100)/100 : (taxableValue>0 ? Math.round(((cgstAmt/taxableValue)*100)*100)/100 : undefined),
            sgstRatePct: taxRate != null ? Math.round(((taxRate/2)*100)*100)/100 : (taxableValue>0 ? Math.round(((sgstAmt/taxableValue)*100)*100)/100 : undefined),
            total: bookingTotal,
            advance: paid,
            balance,
          },
          company,
          party,
          meta: {
            irn: row.irn || row.einv_irn || '',
            ackNo: row.ack_no || row.ackno || '',
            ackDate: row.ack_date || row.ackdate || '',
            buyerGstin: customer?.gstin || customer?.gst_no || customer?.gst_number || row.gstin || '',
            buyerAddress: customer?.address || '',
            buyerState: customer?.state_name || '',
            buyerStateCode: customer?.state_code || '',
            // keep code (not description) in HSN/SAC; if hall HSN missing, fallback to first item HSN
            hsn: (hallHsnFinal || hallHsnCode || (itemsCombined.find((it:any)=> it.hsn)?.hsn) || ''),
          },
          serviceTaxes: serviceTaxDetails,
        };
        if (mounted) setInvoice(inv);
      } catch (e:any) {
        if (mounted) setError(e?.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [bookingId, accountCode, retailCode, user]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div className="p-6 text-sm">Loading invoice…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!invoice) return null;
  const totalQty = Array.isArray(invoice.items)
    ? invoice.items.reduce((a: number, it: any) => a + (Number(it.qty) || 0), 0)
    : 0;

  return (
  <div className="p-4 md:p-6 bg-white min-h-screen invoice-print-area">
      <style>{`
        @media print {
          /* Hide the entire app except the invoice area */
          body * { visibility: hidden !important; }
          .invoice-print-area, .invoice-print-area * { visibility: visible !important; }
          .invoice-print-area { position: fixed; inset: 0; margin: 0 !important; padding: 0 !important; background: white !important; }
          .no-print { display: none !important; }
          .print-page { box-shadow: none !important; margin: 0 !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between mb-4">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Button onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" /> Print
        </Button>
      </div>

      <Card className="print-page max-w-4xl mx-auto bg-white border border-slate-300">
        <CardContent className="p-4">
          {/* Tally-like Header */}
          <div className="text-center border-b p-2">
            <div className="text-base font-semibold">Tax Invoice</div>
          </div>
          <div className="grid grid-cols-2 gap-0 border-b">
            <div className="p-2 text-center">
              {(seller.name || invoice.company.name) ? (
                <div className="font-semibold">{seller.name || invoice.company.name}</div>
              ) : null}
              {(() => {
                const addr = (seller.addressLines && seller.addressLines.length)
                  ? seller.addressLines.join(', ')
                  : (invoice.company.address || '');
                return addr ? <div className="text-xs">{addr}</div> : null;
              })()}
              {((seller.gst || seller.phone) || (invoice.company.gst || invoice.company.phone)) && (
                <div className="text-xs">GSTIN/UIN: {seller.gst || invoice.company.gst || '-'} {(seller.phone || invoice.company.phone) ? ` | Phone: ${seller.phone || invoice.company.phone}` : ''}</div>
              )}
            </div>
            <div className="p-2 text-xs text-right">
              <div>Invoice No. : {invoice.id}</div>
              <div>Dated : {format(invoice.date, 'dd-MMM-yy')}</div>
              <div>Mode/Terms of Payment</div>
            </div>
          </div>

          {/* From seller block intentionally removed */}

          {/* Buyer / Dispatch block */}
          <div className="grid grid-cols-2 border-b mb-3">
            {/* Buyer (Bill to) */}
            <div className="border-r p-2 text-xs">
              <div className="font-semibold">Buyer (Bill to)</div>
              <div>{invoice.party.name || '-'}</div>
              <div>{invoice.meta?.buyerAddress || '-'}</div>
              <div>Phone : {invoice.party.phone || '-'}</div>
              {invoice.party.email ? (<div>Email : {invoice.party.email}</div>) : null}
              {invoice.meta?.buyerGstin ? (<div>GSTIN/UIN : {invoice.meta?.buyerGstin}</div>) : null}
              {(invoice.meta?.buyerState || invoice.meta?.buyerStateCode) && (
                <div>State Name : {invoice.meta?.buyerState || '-'}, Code : {invoice.meta?.buyerStateCode || '-'}</div>
              )}
            </div>
            {/* Dispatch/Booking Details */}
            <div className="p-2 text-xs">
              <div className="font-semibold">Dispatch/Booking Details</div>
              <div>Hall : {invoice.hall}</div>
              {/* <div>Event : {invoice.event}</div> */}
              <div>Event Date : {format(invoice.eventDate || invoice.date, 'dd-MMM-yy')}</div>
            </div>
          </div>

          {/* Items table (Tally-like) */}
          <table className="w-full text-xs border-b border-collapse">
            <thead>
              <tr>
                <th className="border p-2 w-10 text-left">Sl No</th>
                <th className="border p-2 text-left">Description</th>
                <th className="border p-2 w-16 text-center">HSN/SAC</th>
                <th className="border p-2 w-16 text-right">Qty</th>
                <th className="border p-2 w-16 text-right">Rate</th>
                <th className="border p-2 w-12 text-center">per</th>
                <th className="border p-2 w-20 text-right">Disc. Amt</th>
                <th className="border p-2 w-24 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it: any) => (
                <tr key={it.sno}>
                  <td className="p-2 align-top border-l">{it.sno}</td>
                  <td className="p-2 border-l">{it.description}</td>
                  <td className="p-2 text-center border-l">{it.hsn || invoice.meta?.hsn || ''}</td>
                  <td className="p-2 text-right border-l">{it.qty}</td>
                  <td className="p-2 text-right border-l">{currency(it.rate)}</td>
                  <td className="p-2 text-center border-l">No</td>
                  <td className="p-2 text-right border-l">{currency(it.discountAmt || 0)}</td>
                  <td className="p-2 text-right border-l border-r">{currency(it.amount)}</td>
                </tr>
              ))}
              {/* CGST/SGST rows inside items box */}
              <tr>
                <td className="p-2 border-l"></td>
                <td className="p-2 italic font-semibold text-slate-700 border-l">CGST</td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 text-right border-l border-r">{currency(invoice.amounts.cgst)}</td>
              </tr>
              <tr>
                <td className="p-2 border-l"></td>
                <td className="p-2 italic font-semibold text-slate-700 border-l">SGST</td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 text-right border-l border-r">{currency(invoice.amounts.sgst)}</td>
              </tr>
              {/* Tax Amount row - Total of CGST + SGST */}
              <tr>
                <td className="p-2 border-l"></td>
                <td className="p-2 font-bold text-slate-800 border-l">Tax Amount</td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 border-l"></td>
                <td className="p-2 text-right font-bold border-l border-r">{currency((invoice.amounts.cgst || 0) + (invoice.amounts.sgst || 0))}</td>
              </tr>
              {/* Total row inside items table */}
              <tr>
                <td className="border-t border-l p-2"></td>
                <td className="border-t border-l p-2 font-semibold">Total</td>
                <td className="border-t border-l p-2"></td>
                <td className="border-t border-l p-2 text-right font-semibold">{totalQty} No</td>
                <td className="border-t border-l p-2"></td>
                <td className="border-t border-l p-2"></td>
                <td className="border-t border-l p-2 text-right font-semibold">{currency(invoice.amounts.discount)}</td>
                <td className="border-t border-l border-r p-2 text-right font-semibold">{currency(invoice.amounts.total)}</td>
              </tr>
            </tbody>
          </table>

          {/* Tax summary block (includes hall + services grouped by HSN) */}
          <div className="border-b mt-3">
            {(() => {
              // Build HSN groups from per-service details plus residual hall tax
              const svc = Array.isArray(invoice.serviceTaxes) ? invoice.serviceTaxes : [];
              const sum = (arr:any[], key:string) => arr.reduce((a:any, x:any) => a + (Number(x?.[key]) || 0), 0);
              const svcTaxable = sum(svc, 'taxable');
              const svcCgst = sum(svc, 'cgstAmt');
              const svcSgst = sum(svc, 'sgstAmt');
              const hallTaxable = Math.max((Number(invoice.amounts?.taxableValue) || 0) - svcTaxable, 0);
              const hallCgst = Math.max((Number(invoice.amounts?.cgst) || 0) - svcCgst, 0);
              const hallSgst = Math.max((Number(invoice.amounts?.sgst) || 0) - svcSgst, 0);
              type G = { hsn: string; taxable: number; cgst: number; sgst: number; rCgstPct?: number; rSgstPct?: number };
              const groupsMap = new Map<string, G>();
              const add = (hsn:string, taxable:number, cgst:number, sgst:number, rCgstPct?: number, rSgstPct?: number) => {
                const key = (hsn && String(hsn).trim()) || '-';
                const g = groupsMap.get(key) || { hsn: key, taxable: 0, cgst: 0, sgst: 0 };
                g.taxable += (Number(taxable)||0);
                g.cgst += (Number(cgst)||0);
                g.sgst += (Number(sgst)||0);
                // Prefer an explicit rate if available; keep first non-undefined
                if (g.rCgstPct == null && rCgstPct != null) g.rCgstPct = rCgstPct;
                if (g.rSgstPct == null && rSgstPct != null) g.rSgstPct = rSgstPct;
                groupsMap.set(key, g);
              };
              // Add services by their own HSN
              svc.forEach((st:any) => add(st.hsn || '-', st.taxable || 0, st.cgstAmt || 0, st.sgstAmt || 0, st.cgstRatePct, st.sgstRatePct));
              // Add hall residual under hall HSN/meta HSN
              const hallHsn = invoice.meta?.hsn || '';
              if (hallTaxable > 0 || hallCgst > 0 || hallSgst > 0) add(hallHsn || '-', hallTaxable, hallCgst, hallSgst, invoice.amounts?.cgstRatePct, invoice.amounts?.sgstRatePct);
              const groups = Array.from(groupsMap.values());
              // Expose for table rendering below via closure
              (invoice as any)._taxGroups = groups;
              return null;
            })()}
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="border p-2" rowSpan={2}>HSN/SAC</th>
                  <th className="border p-2" rowSpan={2}>Taxable Value</th>
                  <th className="border p-2 text-center" colSpan={2}>CGST</th>
                  <th className="border p-2 text-center" colSpan={2}>SGST</th>
                  <th className="border p-2" rowSpan={2}>Total Tax Amount</th>
                </tr>
                <tr>
                  <th className="border p-2 text-center">Rate</th>
                  <th className="border p-2 text-right">Amount</th>
                  <th className="border p-2 text-center">Rate</th>
                  <th className="border p-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray((invoice as any)._taxGroups) && (invoice as any)._taxGroups.length > 0 ? (
                  (invoice as any)._taxGroups.map((g:any, idx:number) => {
                    const rCG = (g.rCgstPct != null) ? g.rCgstPct : (g.taxable > 0 ? Math.round(((g.cgst / g.taxable) * 100) * 100) / 100 : undefined);
                    const rSG = (g.rSgstPct != null) ? g.rSgstPct : (g.taxable > 0 ? Math.round(((g.sgst / g.taxable) * 100) * 100) / 100 : undefined);
                    const totalTax = (g.cgst || 0) + (g.sgst || 0);
                    return (
                      <tr key={idx}>
                        <td className="border p-2 text-left">{g.hsn || '-'}</td>
                        <td className="border p-2 text-right">{currency(g.taxable)}</td>
                        <td className="border p-2 text-center">{rCG != null ? `${rCG}%` : '-'}</td>
                        <td className="border p-2 text-right">{currency(g.cgst)}</td>
                        <td className="border p-2 text-center">{rSG != null ? `${rSG}%` : '-'}</td>
                        <td className="border p-2 text-right">{currency(g.sgst)}</td>
                        <td className="border p-2 text-right">{currency(totalTax)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="border p-2 text-left">{invoice.meta?.hsn || '-'}</td>
                    <td className="border p-2 text-right">{currency(invoice.amounts.taxableValue)}</td>
                    <td className="border p-2 text-center">{invoice.amounts.cgstRatePct != null ? `${invoice.amounts.cgstRatePct}%` : '-'}</td>
                    <td className="border p-2 text-right">{currency(invoice.amounts.cgst)}</td>
                    <td className="border p-2 text-center">{invoice.amounts.sgstRatePct != null ? `${invoice.amounts.sgstRatePct}%` : '-'}</td>
                    <td className="border p-2 text-right">{currency(invoice.amounts.sgst)}</td>
                    <td className="border p-2 text-right">{currency((invoice.amounts.cgst||0)+(invoice.amounts.sgst||0))}</td>
                  </tr>
                )}
                <tr>
                  <td className="border p-2 font-semibold">Total</td>
                  <td className="border p-2 text-right font-semibold">{currency(invoice.amounts.taxableValue)}</td>
                  <td className="border p-2 text-center"></td>
                  <td className="border p-2 text-right font-semibold">{currency(invoice.amounts.cgst)}</td>
                  <td className="border p-2 text-center"></td>
                  <td className="border p-2 text-right font-semibold">{currency(invoice.amounts.sgst)}</td>
                  <td className="border p-2 text-right font-semibold">{currency((invoice.amounts.cgst||0)+(invoice.amounts.sgst||0))}</td>
                </tr>
              </tbody>
            </table>
            <div className="p-2 border-t">
              <div className="text-xs font-semibold">Amount Chargeable (in words)</div>
              <div className="text-xs mt-1">{numberToIndianWords(invoice.amounts.total)}</div>
            </div>
          </div>

          {/* Declaration only (totals panel removed as requested) */}
          <div className="border-b p-2 text-xs">
            <div className="font-semibold">Declaration</div>
            <div>We declare that this invoice shows the actual price of the goods/services described and that all particulars are true and correct.</div>
          </div>

          {/* Footer signature */}
          <div className="grid grid-cols-2">
            <div className="col-start-2 p-2 text-right">
              {invoice.company?.name ? <div>for {invoice.company.name}</div> : null}
              <div className="mt-12">Authorised Signatory</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
