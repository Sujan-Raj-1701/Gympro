import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Trash2, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { DataService } from "@/services/userService";
import { ApiService } from "@/services/apiService";
import MASTER_TABLES from "@/services/masterTables";

export default function AddCashFlowEntry() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const accountCode = (user as any)?.account_code || "";
  const retailCode = (user as any)?.retail_code || "";
  const today = new Date().toISOString().split("T")[0];
  const initialType = (searchParams.get("type") === "outflow" ? "outflow" : "inflow") as "inflow" | "outflow";

  type ItemRow = { description: string; qty: number; price: number; amount: number; remark?: string; tax_id?: string; inclusive?: boolean; _preInclusive?: { price: number; amount: number } };

  const [form, setForm] = useState({
    date: today,
    type: initialType,
    payment: "cash",
    customer_name: "",
    customer_phone: "",
    customer_address: "",
    customer_gstin: ""
  });
  const [paymodes, setPaymodes] = useState<Array<{ value: string; label: string }>>([]);
  const [taxes, setTaxes] = useState<Array<{ value: string; label: string; rate?: number }>>([]);
  const [items, setItems] = useState<ItemRow[]>([{ description: "", qty: 1, price: 0, amount: 0, remark: "" }]);
  const descRefs = useRef<Array<HTMLInputElement | null>>([]);
  const qtyRefs = useRef<Array<HTMLInputElement | null>>([]);
  const priceRefs = useRef<Array<HTMLInputElement | null>>([]);
  // Customer search state
  const [custQuery, setCustQuery] = useState("");
  const [custSuggestions, setCustSuggestions] = useState<Array<{ id?: string; name: string; phone?: string; address?: string; gstin?: string }>>([]);
  const [showCustDropdown, setShowCustDropdown] = useState(false);
  const custDropdownRef = useRef<HTMLDivElement | null>(null);
  const [isSearchingCust, setIsSearchingCust] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  // Validation state
  const [custNameError, setCustNameError] = useState<string>("");
  const [custPhoneError, setCustPhoneError] = useState<string>("");
  const [itemErrors, setItemErrors] = useState<Array<{ description?: string; qty?: string; price?: string }>>([]);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);

  const computedLine = (row: { qty: number; price: number }) => Number(row.qty || 0) * Number(row.price || 0);
  const taxRateMap = useMemo(() => {
    const m: Record<string, number> = {};
    taxes.forEach(t => { if (t.value && typeof t.rate === 'number') m[String(t.value)] = t.rate; });
    return m;
  }, [taxes]);
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const grossWithTax = (row: { qty: number; price: number; tax_id?: string }) => {
    const base = computedLine(row);
    const rate = row.tax_id ? taxRateMap[String(row.tax_id)] : undefined;
    return rate ? round2(base + base * rate) : round2(base);
  };
  const lineTotal = (row: { qty: number; price: number; amount?: number; tax_id?: string }) => {
    // If amount matches the auto gross calculation treat as auto else manual override
    const auto = grossWithTax(row);
    if (typeof row.amount === 'number') {
      // If user overrode, keep explicit; if it equals auto (within 0.01) recompute for safety.
      const diff = Math.abs(Number(row.amount || 0) - auto);
      return diff < 0.01 ? auto : Number(row.amount || 0);
    }
    return auto;
  };
  const totalAmount = useMemo(() => items.reduce((s, it) => s + lineTotal(it), 0), [items]);
  // Run item validation whenever items change
  useEffect(() => {
    setItemErrors(items.map(it => {
      const errs: { description?: string; qty?: string; price?: string } = {};
      if (!it.description?.trim()) errs.description = 'Required';
      if (!(Number(it.qty) > 0)) errs.qty = 'Qty > 0';
      if (!(Number(it.price) > 0)) errs.price = 'Price > 0';
      return errs;
    }));
  }, [items]);

  // Customer validation effects - removed since customer details are now optional

  const hasAtLeastOneItem = useMemo(() => items.some(it => it.description?.trim()), [items]);
  // Save button enabled if base required pieces present; detailed validation on click
  const canSave = useMemo(() => Boolean(form.date && hasAtLeastOneItem), [form.date, hasAtLeastOneItem]);

  const runSubmitValidation = () => {
    // Customer details are now optional - no validation needed
    // Items validation only
    const newItemErrs = items.map(it => {
      const er: { description?: string; qty?: string; price?: string } = {};
      if (!it.description?.trim()) er.description = 'Required';
      if (!(Number(it.qty) > 0)) er.qty = 'Qty > 0';
      if (!(Number(it.price) > 0)) er.price = 'Price > 0';
      return er;
    });
    setItemErrors(newItemErrs);
    // Determine pass - only need at least one valid item
    const anyItemValid = newItemErrs.some(er => !er.description && !er.qty && !er.price);
    return anyItemValid;
  };

  const typeLabel = form.type === "inflow" ? "Income" : "Expense";
  const saveBtnClass = form.type === "inflow" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white";
  const summaryPillClass = form.type === "inflow" ? "bg-emerald-600" : "bg-rose-600";

  const slug = (s: any) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  // Use native date input bound to ISO (yyyy-mm-dd)

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (!accountCode || !retailCode) return;
        // Fetch payment modes + tax masters together
        const res = await DataService.readData([MASTER_TABLES.paymode, MASTER_TABLES.tax], accountCode, retailCode);
        const d: any = (res as any)?.data;
        let pmRows: any[] = [];
        let taxRows: any[] = [];
        if (Array.isArray(d)) {
          pmRows = d.filter((x: any) => x?.payment_mode_name || x?.payment_mode || x?.mode_name || x?.name);
          taxRows = d.filter((x: any) => x?.tax_id || x?.tax_code || x?.tax_rate || typeof x?.cgst !== 'undefined');
        } else if (d && typeof d === "object") {
          pmRows = (d[MASTER_TABLES.paymode] || d.paymodes || d.payment_modes || []) as any[];
          taxRows = (d[MASTER_TABLES.tax] || d.taxes || d.master_tax || []) as any[];
        }
        const mapped = (pmRows || []).map((p: any) => {
          const label = p?.payment_mode_name || p?.name || p?.mode_name || p?.title || p?.payment_mode || p?.paymode || "";
          return { value: slug(label), label: String(label) };
        });
        const uniq = Array.from(new Map(mapped.map((m) => [m.value, m])).values());
        if (!mounted) return;
        setPaymodes(uniq);
        if (uniq.length) {
          const exists = uniq.some((o) => o.value === form.payment);
          if (!exists) setForm((f) => ({ ...f, payment: uniq[0].value }));
        }
        // Map tax rows -> select options (value = tax_id or slug(code), label = name + rate%)
        const taxOpts = (taxRows || []).map((t: any) => {
          const id = String(t.tax_id || t.id || t.tax_code || t.code || slug(t.name || t.tax_name || t.description || 'tax'));
          // Determine combined rate: prefer explicit total then sum of cgst/sgst
          let rate: any = t.tax_rate ?? t.rate ?? t.percentage ?? t.total_rate ?? t.gst_percentage ?? t.gst_percent ?? undefined;
          const cg = Number(t.cgst ?? t.cgst_rate ?? 0) || 0;
          const sg = Number(t.sgst ?? t.sgst_rate ?? 0) || 0;
          if ((cg || sg) && (rate == null || rate === '')) rate = cg + sg;
          rate = Number(rate);
          if (isNaN(rate)) rate = undefined;
          const pct = rate != null ? (rate > 1.5 ? rate : rate * 100) : undefined; // stored percent value for display if needed
          const baseName = t.description || t.tax_name || t.name || t.title || t.tax_code || t.code || `Tax ${id}`;
          // If description already contains a % symbol, don't append rate again
          const label = (t.description && /%/.test(String(t.description)))
            ? String(baseName)
            : (pct != null ? `${baseName} (${pct}% )` : String(baseName));
          return { value: id, label, rate: pct != null ? pct/100 : undefined };
        });
  const uniqueTax = Array.from(new Map(taxOpts.map(o => [o.value, o])).values());
  const noTax = { value: 'none', label: 'No Tax', rate: undefined as number | undefined };
  const finalTaxList = [noTax, ...uniqueTax];
  setTaxes(finalTaxList);
  // Auto-assign 'No Tax' to existing rows if no tax selected
  setItems(arr => arr.map(r => (!r.tax_id ? { ...r, tax_id: 'none' } : r)));
      } catch (e) {
        console.warn("Failed to load masters:", e);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [accountCode, retailCode]);

  // Debounced customer search (by name or phone)
  useEffect(() => {
    const q = form.customer_name.trim() || form.customer_phone.trim();
    setCustQuery(q);
  }, [form.customer_name, form.customer_phone]);

  useEffect(() => {
    if (!custQuery || custQuery.length < 2) { setCustSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsSearchingCust(true);
        const rows = await ApiService.searchMasterCustomer(custQuery, 10, accountCode, retailCode);
        if (cancelled) return;
        const mapped = (rows || []).map((r: any) => ({
          id: String(r.id || r.customer_id || r.cust_id || '') || undefined,
          name: r.customer_name || r.full_name || r.name || '',
          phone: r.customer_phone || r.customer_mobile || r.mobile || r.phone || '',
          address: r.customer_address || r.address || '',
          gstin: r.customer_gstin || r.gstin || r.gst_no || r.gst_number || ''
        })).filter(r => r.name || r.phone);
        setCustSuggestions(mapped.slice(0,10));
        setShowCustDropdown(true);
      } catch { /* ignore */ }
      finally { if (!cancelled) setIsSearchingCust(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [custQuery, accountCode, retailCode]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (custDropdownRef.current && !custDropdownRef.current.contains(e.target as Node)) {
        setShowCustDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const applyCustomerSuggestion = (s: { id?: string; name: string; phone?: string; address?: string; gstin?: string }) => {
    setSelectedCustomerId(s.id);
    setForm(f => ({
      ...f,
      customer_name: s.name || f.customer_name,
      customer_phone: s.phone || f.customer_phone,
      customer_address: s.address || f.customer_address,
      customer_gstin: (s.gstin || f.customer_gstin || '').toUpperCase()
    }));
    setShowCustDropdown(false);
  };

  const handleSubmit = () => {
    setAttemptedSave(true);
    if (!runSubmitValidation()) {
      toast({
        title: 'Validation failed',
        description: 'Fix highlighted fields before saving',
        variant: 'destructive'
      });
      return;
    }
    toast({
      title: 'Cash entry saved',
      description: `${typeLabel} • ${form.payment.replace("_", " ")}${totalAmount ? ` • ₹${totalAmount.toLocaleString("en-IN")}` : ""}`
    });
    (async () => {
      try {
        const payload = {
          account_code: accountCode,
          retail_code: retailCode,
          entry_date: form.date,
          type: form.type === 'inflow' ? 'Income' : 'Expense',
          payment_method: form.payment,
          ...(selectedCustomerId && { customer_id: selectedCustomerId }),
          ...(form.customer_name?.trim() && { customer_name: form.customer_name.trim() }),
          ...(form.customer_phone?.trim() && { customer_phone: form.customer_phone.trim() }),
          ...(form.customer_address?.trim() && { customer_address: form.customer_address.trim() }),
          ...(form.customer_gstin?.trim() && { customer_gstin: form.customer_gstin.trim() }),
          items: items
            .filter((it) => it.description?.trim())
            .map((it) => ({ description: it.description, qty: it.qty, price: it.price, amount: lineTotal(it), remarks: it.remark || undefined, tax_id: (it.tax_id && it.tax_id !== 'none') ? it.tax_id : undefined })),
        } as any;
        await DataService.createIncomeExpense(payload);
      } catch (e) {
        console.warn("Failed to persist cash entry:", e);
      }
      navigate("/assets/cashflow");
    })();
  };

  const handleReset = () => {
  setForm({ date: today, type: "inflow", payment: "cash", customer_name: "", customer_phone: "", customer_address: "", customer_gstin: "" });
  setSelectedCustomerId(undefined);
  setAttemptedSave(false);
  setShowCustomerDetails(false);
  setCustNameError('');
  setCustPhoneError('');
  setItemErrors([]);
  setItems([{ description: "", qty: 1, price: 0, amount: 0, remark: "", tax_id: 'none' }]);
  };

  return (
    <form autoComplete="off" className="min-h-screen bg-slate-50" onSubmit={(e)=>e.preventDefault()}>
      <div className="w-full px-2 lg:px-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left column widened */}
          <div className="lg:col-span-10 space-y-4">
            {/* Entry details */}
            <Card className="border-0 bg-white rounded-xl overflow-visible">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-base font-semibold text-slate-800 flex items-center">
                  <DollarSign className="h-4 w-4 mr-2 text-blue-600" />
                  Cash Entry
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Date Filter</Label>
                    <Input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      className="mt-1 border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as any })}>
                      <SelectTrigger disabled className="mt-1 cursor-not-allowed opacity-70 border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:outline-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inflow">Income</SelectItem>
                        <SelectItem value="outflow">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Payment</Label>
                    <Select value={form.payment} onValueChange={(v) => setForm({ ...form, payment: v })}>
                      <SelectTrigger className="mt-1 border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:outline-none">
                        <SelectValue placeholder={paymodes.length ? "Select payment mode" : "Loading..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {paymodes.length ? (
                          paymodes.map((pm) => (
                            <SelectItem key={pm.value} value={pm.value}>
                              {pm.label}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value={form.payment} disabled>
                            Loading…
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Customer row - Initially hidden */}
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowCustomerDetails(!showCustomerDetails)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <span>{showCustomerDetails ? '▼' : '▶'}</span>
                    <span>Add Customer Details</span>
                  </button>
                </div>
                {showCustomerDetails && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-start border-t pt-4">
                    <div className="md:col-span-3 relative flex flex-col" ref={custDropdownRef}>
                      <Label className="text-xs font-semibold text-slate-700 flex justify-between"><span>Customer Name</span>{isSearchingCust && <span className="text-[10px] text-slate-500">Searching…</span>}</Label>
                      <Input
                        placeholder="Type name (min 2 chars)"
                        value={form.customer_name}
                        onChange={(e) => { setForm(f => ({ ...f, customer_name: e.target.value })); setShowCustDropdown(true); }}
                        onFocus={() => custSuggestions.length && setShowCustDropdown(true)}
                        className={`mt-1 border-slate-300 text-sm focus:ring-0 focus-visible:ring-0 focus:outline-none rounded-lg ${showCustDropdown && custSuggestions.length > 0 ? 'rounded-b-none' : ''}`}
                      />
                      {showCustDropdown && custSuggestions.length > 0 && (
                        <div className="absolute left-0 top-full z-50 w-full bg-white border border-t-0 border-slate-200 rounded-b-md shadow-lg max-h-60 overflow-auto text-xs">
                          {custSuggestions.map((s,i) => (
                            <button
                              type="button"
                              key={i}
                              onClick={() => applyCustomerSuggestion(s)}
                              className="w-full text-left px-2 py-1 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                            >
                              <div className="font-medium truncate">{s.name || '—'}</div>
                              <div className="text-[10px] text-slate-500 flex justify-between"><span>{s.phone || 'No phone'}</span>{s.gstin && <span>{s.gstin}</span>}</div>
                            </button>
                          ))}
                          {!isSearchingCust && custSuggestions.length === 0 && (
                            <div className="px-2 py-1 text-slate-500">No matches</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2 flex flex-col">
                      <Label className="text-xs font-semibold text-slate-700">Phone</Label>
                      <Input
                        placeholder="Phone / search"
                        value={form.customer_phone}
                        onChange={(e) => { 
                          // keep digits + plus sign but validate separately
                          const val = e.target.value.replace(/[^0-9+]/g,'');
                          setForm(f => ({ ...f, customer_phone: val })); 
                          setShowCustDropdown(true); 
                        }}
                        onFocus={() => custSuggestions.length && setShowCustDropdown(true)}
                        className={`mt-1 border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:outline-none`}
                      />
                    </div>
                    <div className="md:col-span-5 flex flex-col">
                      <Label className="text-xs font-semibold text-slate-700">Address</Label>
                      <Input
                        placeholder="Address"
                        value={form.customer_address}
                        onChange={(e) => setForm(f => ({ ...f, customer_address: e.target.value }))}
                        className="mt-1 border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2 flex flex-col">
                      <Label className="text-xs font-semibold text-slate-700">GSTIN</Label>
                      <Input
                        placeholder="GSTIN"
                        value={form.customer_gstin}
                        onChange={(e) => setForm(f => ({ ...f, customer_gstin: e.target.value.toUpperCase() }))}
                        className="mt-1 border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:outline-none uppercase"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Entries */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-base font-semibold text-slate-800">Entries</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="hidden md:grid md:grid-cols-12 gap-3 text-xs font-semibold text-gray-600 mb-2 px-1">
                  <div className="md:col-span-2">Description</div>
                  <div className="md:col-span-1">Qty</div>
                  <div className="md:col-span-2">Price</div>
                  <div className="md:col-span-2">Tax</div>
                  <div className="md:col-span-1">Inclusive</div>
                  <div className="md:col-span-2">Amount</div>
                  <div className="md:col-span-1">Remarks</div>
                  <div className="md:col-span-1"></div>
                </div>
                <div className="max-h-80 overflow-y-auto pr-1">
                  <div className="space-y-3">
                  {items.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                      <div className="md:col-span-2">
                        <Input
                          placeholder="e.g., Home Rent, EB Bill"
                          value={row.description}
                          ref={(el) => {
                            descRefs.current[idx] = el;
                          }}
              onChange={(e) => setItems((arr) => arr.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))}
                          className={`border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none ${attemptedSave && itemErrors[idx]?.description ? 'border-red-500' : ''}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                if (String((e.currentTarget as HTMLInputElement).value || "").trim() === "") return;
                qtyRefs.current[idx]?.focus();
                            }
                          }}
                        />
                        {attemptedSave && itemErrors[idx]?.description && <div className="text-[10px] text-red-600 mt-0.5">{itemErrors[idx]?.description}</div>}
                      </div>
                      <div className="md:col-span-1">
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          value={row.qty}
                          ref={(el) => {
                            qtyRefs.current[idx] = el;
                          }}
                          onChange={(e) => setItems((arr) => arr.map((r, i) => {
                            if (i !== idx) return r;
                            const newQty = Number(e.target.value);
                            const prevComputed = grossWithTax(r);
                            const isAuto = Math.abs(Number(r.amount ?? 0) - prevComputed) < 0.01;
                            const next: ItemRow = { ...r, qty: newQty } as ItemRow;
                            if (isAuto) next.amount = grossWithTax({ ...next });
                            return next;
                          }))}
                          className={`border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none ${attemptedSave && itemErrors[idx]?.qty ? 'border-red-500' : ''}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (String((e.currentTarget as HTMLInputElement).value || "").trim() === "") return;
                              priceRefs.current[idx]?.focus();
                            }
                          }}
                        />
                        {attemptedSave && itemErrors[idx]?.qty && <div className="text-[10px] text-red-600 mt-0.5">{itemErrors[idx]?.qty}</div>}
                      </div>
                      <div className="md:col-span-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.price}
                          ref={(el) => {
                            priceRefs.current[idx] = el;
                          }}
                          onChange={(e) => setItems((arr) => arr.map((r, i) => {
                            if (i !== idx) return r;
                            const newPrice = Number(e.target.value);
                            const prevComputed = grossWithTax(r);
                            const isAuto = Math.abs(Number(r.amount ?? 0) - prevComputed) < 0.01;
                            const next: ItemRow = { ...r, price: newPrice } as ItemRow;
                            if (isAuto) next.amount = grossWithTax({ ...next });
                            return next;
                          }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const val = Number((e.currentTarget as HTMLInputElement).value);
                              // Block moving to next if price is 0 or not a positive number
                              if (!(val > 0)) return;
                              setItems((arr) => {
                                const next = [...arr, { description: "", qty: 1, price: 0, amount: 0, remark: "" }];
                                setTimeout(() => {
                                  const i = next.length - 1;
                                  descRefs.current[i]?.focus();
                                }, 0);
                                return next;
                              });
                            }
                          }}
                          className={`border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none ${attemptedSave && itemErrors[idx]?.price ? 'border-red-500' : ''}`}
                        />
                        {attemptedSave && itemErrors[idx]?.price && <div className="text-[10px] text-red-600 mt-0.5">{itemErrors[idx]?.price}</div>}
                      </div>
                      <div className="md:col-span-2">
                        <Select
                          value={row.tax_id ? String(row.tax_id) : (taxes[0]?.value ? String(taxes[0].value) : '')}
                          onValueChange={(v) => setItems(arr => arr.map((r,i) => {
                            if (i !== idx) return r;
                            const prevAuto = grossWithTax(r);
                            const isAuto = Math.abs(Number(r.amount ?? 0) - prevAuto) < 0.01;
                            const updated: ItemRow = { ...r, tax_id: v };
                            // If inclusive and tax changed, recompute net price from current gross
                            if (updated.inclusive && updated.tax_id) {
                              const rate = taxRateMap[String(v)] || 0;
                              const grossPerUnit = updated.price * (1 + (rate || 0)); // current stored net -> gross
                              // Recompute net from gross to avoid compounding rounding when changing tax
                              if (rate > 0) {
                                const newNet = grossPerUnit / (1 + rate);
                                updated.price = round2(newNet);
                              }
                            }
                            if (isAuto) updated.amount = grossWithTax(updated);
                            return updated;
                          }))}
                        >
                          <SelectTrigger className="border-slate-300 rounded-lg text-xs h-9 w-full min-w-[110px] focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none truncate">
                            <SelectValue placeholder={taxes.length ? 'Select tax' : '...'} />
                          </SelectTrigger>
                          <SelectContent>
                            {taxes.length === 0 && (<SelectItem value="loading" disabled>Loading...</SelectItem>)}
                            {taxes.map(t => (
                              <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-1 flex items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-blue-600 cursor-pointer"
                          checked={!!row.inclusive}
                          onChange={(e) => setItems(arr => arr.map((r,i) => {
                            if (i !== idx) return r;
                            const rate = r.tax_id ? taxRateMap[String(r.tax_id)] : 0;
                            let updated: ItemRow = { ...r };
                            if (e.target.checked) {
                              // Capture pre-inclusive snapshot only the first time we switch on
                              if (!r.inclusive) {
                                const shownAmount = typeof r.amount === 'number' ? r.amount : grossWithTax(r);
                                updated._preInclusive = { price: r.price, amount: shownAmount };
                              }
                              if (rate && rate > 0) {
                                // Current displayed price is gross; convert to net for storage
                                const grossUnit = r.price;
                                const netUnit = grossUnit / (1 + rate);
                                updated.price = round2(netUnit);
                              }
                              updated.inclusive = true;
                              // Recompute amount if auto
                              const prevAuto = grossWithTax(r);
                              const isAuto = Math.abs(Number(r.amount ?? 0) - prevAuto) < 0.01;
                              if (isAuto) updated.amount = grossWithTax(updated);
                            } else {
                              // Revert to snapshot if available
                              if (r._preInclusive) {
                                updated.price = r._preInclusive.price;
                                updated.amount = r._preInclusive.amount;
                                delete updated._preInclusive;
                              }
                              updated.inclusive = false;
                            }
                            return updated;
                          }))}
                          title="Price entered is tax inclusive (uncheck to revert)"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.amount}
                          onChange={(e) => setItems((arr) => arr.map((r, i) => (i === idx ? { ...r, amount: Number(e.target.value) } : r)))}
                          className="border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none"
                        />
                      </div>
                      <div className="md:col-span-1">
                        <Input
                          placeholder="Optional remarks"
                          value={row.remark || ""}
                          onChange={(e) => setItems((arr) => arr.map((r, i) => (i === idx ? { ...r, remark: e.target.value } : r)))}
                          className="border-slate-300 rounded-lg text-sm focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              // optional: add new row if description present
                              if (!row.description?.trim()) return;
                              setItems((arr) => {
                                const baseRow: ItemRow = { description: "", qty: 1, price: 0, amount: 0, remark: "", tax_id: taxes[0]?.value, inclusive: false };
                                baseRow.amount = grossWithTax(baseRow);
                                const next = [...arr, baseRow];
                                setTimeout(() => {
                                  const i = next.length - 1;
                                  descRefs.current[i]?.focus();
                                }, 0);
                                return next;
                              });
                            }
                          }}
                        />
                      </div>
                      <div className="md:col-span-1 flex items-center">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => setItems((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr))}
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column: Summary (narrow) */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold text-slate-800">Summary</CardTitle>
                  <Button type="button" variant="outline" size="sm" onClick={() => navigate("/assets/cashflow")} className="border-gray-300">
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Type:</span><span className="font-medium">{typeLabel}</span></div>
                  <div className="flex justify-between"><span>Payment:</span><span className="font-medium capitalize">{form.payment.replace("_", " ")}</span></div>
                  <div className="flex justify-between"><span>Total:</span><span className="font-semibold">₹{totalAmount.toLocaleString("en-IN")}</span></div>
                </div>
                <div className="mt-4 space-y-2">
                  <Button type="button" onClick={handleSubmit} className={`w-full ${saveBtnClass}`} disabled={!canSave}>Save Entry</Button>
                  <Button type="button" variant="outline" onClick={handleReset} className="w-full border-gray-300">Reset</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </form>
  );
}
