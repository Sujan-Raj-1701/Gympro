import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import {
  Calendar as CalendarIcon,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import CustomerService, { CustomerRow } from "@/services/customerService";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type AnyRow = Record<string, any>;
type InvoiceRow = Record<string, any>;
type PaymentRow = Record<string, any>;
type GSTRow = {
  invoiceNo: string;
  date: Date;
  customer: string;
  gstNo: string;
  taxableAmount: number;
  sgst: number;
  cgst: number;
  igst: number;
  total: number;
};

export default function GSTReports() {
  const { user } = useAuth();
  // Default both filters to today's date
  // Submitted dates (used for fetching + filtering)
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  // Draft dates (used in the pickers; won't trigger fetch until Submit)
  const [draftFromDate, setDraftFromDate] = useState<Date>(new Date());
  const [draftToDate, setDraftToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const customersCacheRef = useRef<{ key: string; rows: CustomerRow[] } | null>(null);

  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

  const formatMoney = (value: number) => `₹${money.format(Number(value || 0))}`;
  const toExcelNumber = (value: number) => Number((Number(value || 0)).toFixed(2));

  const handleExportReport = (fmt: "pdf" | "excel") => {
    try {
      const fromStr = format(fromDate, "yyyyMMdd");
      const toStr = format(toDate, "yyyyMMdd");
      const filenameBase = `gst-summary_${fromStr}_${toStr}`;

      if (fmt === "excel") {
        const data = rows.map((r) => ({
          "Invoice No": r.invoiceNo,
          Date: format(r.date, "dd-MMM-yy"),
          Customer: r.customer,
          "GST No": r.gstNo || "-",
          "Taxable Amount": toExcelNumber(r.taxableAmount),
          SGST: toExcelNumber(r.sgst),
          CGST: toExcelNumber(r.cgst),
          IGST: toExcelNumber(r.igst),
          Total: toExcelNumber(r.total),
        }));
        // Append totals row
        data.push({
          "Invoice No": "Total",
          Date: "",
          Customer: "",
          "GST No": "",
          "Taxable Amount": toExcelNumber(totals.taxableAmount),
          SGST: toExcelNumber(totals.sgst),
          CGST: toExcelNumber(totals.cgst),
          IGST: toExcelNumber(totals.igst),
          Total: toExcelNumber(totals.total),
        } as any);

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "GST Summary");
        XLSX.writeFile(wb, `${filenameBase}.xlsx`);
        return;
      }

      // PDF export
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14);
      doc.text("GST Summary", 14, 14);
      doc.setFontSize(10);
      doc.text(`Period: ${format(fromDate, "dd-MM-yyyy")} to ${format(toDate, "dd-MM-yyyy")}`, 14, 20);
      doc.text(
        `Total SGST: ${formatMoney(totals.sgst)}  |  Total CGST: ${formatMoney(totals.cgst)}  |  Total IGST: ${formatMoney(totals.igst)}  |  Total Tax: ${formatMoney(totals.sgst + totals.cgst + totals.igst)}`,
        14,
        26
      );

      const head = [[
        "Invoice No",
        "Date",
        "Customer",
        "GST No",
        "Taxable Amount",
        "SGST",
        "CGST",
        "IGST",
        "Total",
      ]];
      const body = rows.map((r) => [
        r.invoiceNo,
        format(r.date, "dd-MMM-yy"),
        r.customer,
        r.gstNo || "-",
        formatMoney(r.taxableAmount),
        formatMoney(r.sgst),
        formatMoney(r.cgst),
        formatMoney(r.igst),
        formatMoney(r.total),
      ]);
      // Totals row
      body.push([
        "Total",
        "",
        "",
        "",
        formatMoney(totals.taxableAmount),
        formatMoney(totals.sgst),
        formatMoney(totals.cgst),
        formatMoney(totals.igst),
        formatMoney(totals.total),
      ]);

      autoTable(doc, {
        head,
        body,
        startY: 32,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [15, 23, 42] }, // slate-900
        theme: "striped",
      });

      doc.save(`${filenameBase}.pdf`);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  // Load invoice + billing payment data (only when submitted dates change)
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const accountCode = (user as any)?.account_code || "";
        const retailCode = (user as any)?.retail_code || "";
        if (!accountCode || !retailCode) {
          if (!mounted) return;
          setInvoices([]);
          setPayments([]);
          setError("Missing account/retail scope");
          return;
        }

        const fromStr = format(fromDate, "yyyy-MM-dd");
        const toStr = format(toDate, "yyyy-MM-dd");

        const q = new URLSearchParams({
          account_code: accountCode,
          retail_code: retailCode,
          limit: "1000",
          from_date: fromStr,
          to_date: toStr,
          billstatus: "Y",
        });

        const [invRes, payRes] = await Promise.all([
          ApiService.get<any>(`/api/invoices?${q.toString()}`),
          ApiService.getBillingPayments({ accountCode, retailCode, fromDate: fromStr, toDate: toStr }),
        ]);

        // Load customer master (cached by scope)
        const cacheKey = `${accountCode}::${retailCode}`;
        let customerRows: CustomerRow[] = [];
        if (customersCacheRef.current?.key === cacheKey) {
          customerRows = customersCacheRef.current.rows;
        } else {
          customerRows = await CustomerService.getCustomers(accountCode, retailCode);
          customersCacheRef.current = { key: cacheKey, rows: customerRows };
        }

        if (!mounted) return;
        setInvoices(Array.isArray(invRes?.data) ? invRes.data : []);
        setPayments(Array.isArray((payRes as any)?.data) ? (payRes as any).data : []);
        setCustomers(Array.isArray(customerRows) ? customerRows : []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load GST data");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [user, fromDate, toDate]);

  const dateInRange = (d: Date) => {
    const dm = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const fm = fromDate ? new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()) : null;
    const tm = toDate ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate()) : null;
    return (!fm || dm >= fm) && (!tm || dm <= tm);
  };

  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      const bid = String((p as any).billing_id ?? (p as any).invoice_id ?? (p as any).invoice ?? "").trim();
      if (!bid) continue;
      const amt = Number((p as any).amount ?? (p as any).paid_amount ?? (p as any).value ?? 0) || 0;
      map.set(bid, (map.get(bid) || 0) + amt);
    }
    return map;
  }, [payments]);

  const customersIndex = useMemo(() => {
    const byId = new Map<string, CustomerRow>();
    const byPhone = new Map<string, CustomerRow>();

    const normPhone = (v: any) => {
      const digits = String(v ?? "").replace(/\D/g, "");
      if (!digits) return "";
      return digits.length > 10 ? digits.slice(-10) : digits;
    };
    const getCI = (obj: any, keys: string[]) => {
      if (!obj) return undefined;
      const lowerToActual = new Map<string, string>();
      Object.keys(obj).forEach((k) => lowerToActual.set(k.toLowerCase(), k));
      for (const k of keys) {
        const actual = lowerToActual.get(k.toLowerCase());
        if (actual !== undefined) {
          const v = (obj as any)[actual];
          if (v !== undefined && v !== null && String(v) !== "") return v;
        }
      }
      return undefined;
    };

    for (const c of customers) {
      const cid = String((c as any).customer_id ?? (c as any).id ?? "").trim();
      if (cid) byId.set(cid, c);

      const phone = normPhone(
        getCI(c, [
          "mobile",
          "customer_mobile",
          "phone",
          "phone1",
          "alternate_phone",
          "phone2",
          "alternate_mobile",
        ])
      );
      if (phone && !byPhone.has(phone)) byPhone.set(phone, c);
    }

    return { byId, byPhone };
  }, [customers]);

  const rows: GSTRow[] = useMemo(() => {
    const toNum = (v: any) => {
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };
    const getValueCI = (obj: any, keys: string[]): any => {
      if (!obj) return undefined;
      const lowerToActual = new Map<string, string>();
      Object.keys(obj).forEach((k) => lowerToActual.set(k.toLowerCase(), k));
      for (const k of keys) {
        const actual = lowerToActual.get(k.toLowerCase());
        if (actual !== undefined) {
          const v = (obj as any)[actual];
          if (v !== undefined && v !== null && String(v) !== "") return v;
        }
      }
      return undefined;
    };

    const normPhone = (v: any) => {
      const digits = String(v ?? "").replace(/\D/g, "");
      if (!digits) return "";
      return digits.length > 10 ? digits.slice(-10) : digits;
    };

    const isNumericLike = (s: string) => /^\d{5,}$/.test(s.trim());

    const res: GSTRow[] = [];
    invoices.forEach((r: any, idx: number) => {
      // Filter by billstatus: only include completed bills (Y)
      // Exclude cancelled bills (C) and held bills (N)
      const billStatus = String(r.billstatus || r.bill_status || r.BILLSTATUS || "").toUpperCase();
      if (billStatus === "C" || billStatus === "N") return; // Skip cancelled and held bills
      if (billStatus && billStatus !== "Y") return; // Only include completed bills if billstatus is present

      const createdStr =
        r.txn_created_at ||
        r.last_created_at ||
        r.txn_updated_at ||
        r.last_updated_at ||
        r.created_at ||
        r.createdAt ||
        r.invoice_date ||
        r.date;
      const d = createdStr ? new Date(createdStr) : new Date();
      if (!dateInRange(d)) return;

      const invoiceId = String(r.invoice_id ?? r.invoiceId ?? r.id ?? r.invoice ?? "").trim() || `inv-${idx + 1}`;
      const totalAmount = toNum(
        r.txn_grand_total ??
          r.txn_total_amount ??
          r.txn_total ??
          r.grand_total ??
          r.total_amount ??
          r.amount ??
          r.total ??
          0
      );
      const paidAgg = paymentsByInvoice.get(invoiceId) || 0;

      let statusRaw = String(r.STATUS || r.status || "").toLowerCase();
      if (statusRaw === "canceled") statusRaw = "cancelled";
      // If backend doesn't provide status, infer it from payments
      if (!statusRaw) {
        if (totalAmount > 0 && paidAgg >= totalAmount) statusRaw = "settled";
        else if (paidAgg > 0) statusRaw = "advanced";
        else statusRaw = "active";
      }
      if (statusRaw === "cancelled") return;

      // GST report: show settlement bills only
      const isSettled = statusRaw === "settled" || statusRaw === "paid" || (totalAmount > 0 && paidAgg >= totalAmount);
      if (!isSettled) return;

      const invoiceCustomerId = String(
        getValueCI(r, ["customer_id", "customerId", "txn_customer_id", "master_customer_id", "customer_master_id"]) ?? ""
      ).trim();

      let customerName: any = getValueCI(r, [
        "txn_customer_name",
        "txn_customer",
        "customer_name",
        "customer",
        "customer_full_name",
        "customerfullname",
        "customer_fullname",
        "customername",
        "client_name",
        "guest_name",
        "party_name",
        "name",
      ]);
      if (typeof customerName === "object" && customerName) {
        customerName = getValueCI(customerName, ["full_name", "fullname", "name", "customer_name"]) ?? "";
      }
      customerName = String(customerName ?? "").trim();

      let customerPhone: any = getValueCI(r, [
        "txn_customer_mobile",
        "txn_customer_number",
        "customer_mobile",
        "customer_number",
        "customer_phone",
        "phone",
        "phone_no",
        "phone_number",
        "mobile",
        "mobile_no",
        "contact",
        "contact_no",
      ]);
      if (typeof customerPhone === "object" && customerPhone) customerPhone = "";
      customerPhone = String(customerPhone ?? "").trim();

      // Try to enrich from master_customer by id/mobile
      const invoicePhoneNorm = normPhone(customerPhone);
      const customerFromMaster =
        (invoiceCustomerId ? customersIndex.byId.get(invoiceCustomerId) : undefined) ||
        (invoicePhoneNorm ? customersIndex.byPhone.get(invoicePhoneNorm) : undefined);

      const masterNameRaw = customerFromMaster
        ? (customerFromMaster.customer_name || customerFromMaster.name || "")
        : "";
      const masterName = String(masterNameRaw ?? "").trim();

      const masterMobileRaw = customerFromMaster
        ? (
            (customerFromMaster.mobile ||
              customerFromMaster.customer_mobile ||
              customerFromMaster.phone ||
              customerFromMaster.phone1 ||
              customerFromMaster.alternate_phone ||
              customerFromMaster.phone2 ||
              customerFromMaster.alternate_mobile ||
              "") as any
          )
        : "";
      const masterMobile = String(masterMobileRaw ?? "").trim();

      // Prefer a non-numeric name; if invoice only has a phone-like value, use master name
      const chosenName = customerName && !isNumericLike(customerName) ? customerName : (masterName || "");
      const chosenMobile = customerPhone || masterMobile;

      const customerDisplay = customerName
        ? (customerPhone ? `${customerName} (${customerPhone})` : customerName)
        : (customerPhone ? customerPhone : "Walk-in");

      const finalCustomerDisplay = chosenName
        ? (chosenMobile ? `${chosenName} (${chosenMobile})` : chosenName)
        : (chosenMobile ? chosenMobile : customerDisplay);

      const gstFromInvoice: string = String(
        getValueCI(r, [
          "gstin",
          "gst_no",
          "gst",
          "gstnumber",
          "gst_number",
          "gstno",
          "customer_gstin",
          "customer_gst",
          "txn_customer_gstin",
          "txn_customer_gst_no",
          "txn_customer_gst",
        ]) ?? ""
      ).trim();

      const gstFromMaster: string = customerFromMaster
        ? String(
            (customerFromMaster.gst_number || customerFromMaster.gstin || (customerFromMaster as any).gst || "") ?? ""
          ).trim()
        : "";

      const gstNo = gstFromInvoice || gstFromMaster;

      const cgst = toNum(getValueCI(r, ["txn_total_cgst", "total_cgst", "cgst_amount", "cgst"]) ?? 0);
      const sgst = toNum(getValueCI(r, ["txn_total_sgst", "total_sgst", "sgst_amount", "sgst"]) ?? 0);
      const igst = toNum(getValueCI(r, ["txn_total_igst", "total_igst", "igst_amount", "igst"]) ?? 0);
      const tax = toNum(getValueCI(r, ["tax_amount", "txn_tax_amount", "tax_amount_total"]) ?? (cgst + sgst + igst));
      let taxable = toNum(getValueCI(r, ["txn_taxable_amount", "taxable_amount", "subtotal_amount", "txn_subtotal", "raw_subtotal"]) ?? 0);
      if (!taxable && totalAmount) taxable = Math.max(totalAmount - tax, 0);

      res.push({
        invoiceNo: invoiceId,
        date: d,
        customer: finalCustomerDisplay,
        gstNo,
        taxableAmount: taxable,
        sgst,
        cgst,
        igst,
        total: totalAmount,
      });
    });
    // Sort by date desc
    res.sort((a, b) => b.date.getTime() - a.date.getTime());
    return res;
  }, [invoices, paymentsByInvoice, customersIndex, fromDate, toDate]);

  // Calculate totals
  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      taxableAmount: acc.taxableAmount + row.taxableAmount,
      sgst: acc.sgst + row.sgst,
      cgst: acc.cgst + row.cgst,
      igst: acc.igst + row.igst,
      total: acc.total + row.total,
    }),
    { taxableAmount: 0, sgst: 0, cgst: 0, igst: 0, total: 0 }
  ), [rows]);
  const totalTax = (totals.sgst || 0) + (totals.cgst || 0) + (totals.igst || 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <FileText className="h-5 w-5 text-emerald-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">GST Reports</h1>
            </div>
            
            {/* Compact Action Bar */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleExportReport('pdf')} className="h-8 text-xs">
                Export PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExportReport('excel')} className="h-8 text-xs">
                Export Excel
              </Button>
              <Link to="/reports">
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back to Reports
                </Button>
              </Link>
            </div>
          </div>

          {/* Inline Date Filters */}
          <div className="flex items-center gap-2 mt-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {format(draftFromDate, 'dd-MM-yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={draftFromDate} onSelect={(d) => d && setDraftFromDate(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <span className="text-slate-400">→</span>

            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {format(draftToDate, 'dd-MM-yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={draftToDate} onSelect={(d) => d && setDraftToDate(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <Button
              size="sm"
              onClick={() => {
                setFromDate(draftFromDate);
                setToDate(draftToDate);
              }}
              disabled={loading}
              className="h-8 px-4 text-xs"
            >
              Submit
            </Button>

            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Info Note */}
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4.25c0 .414.336.75.75.75h2.5a.75.75 0 000-1.5h-1.75V6.5zM10 13a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-blue-800 font-medium">Note: Tax is calculated only for settlement bills.</p>
        </div>

        {/* Compact Tax Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total SGST</CardTitle>
              <div className="p-1.5 rounded-md bg-blue-50">
                <FileText className="h-3.5 w-3.5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{formatMoney(totals.sgst)}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total CGST</CardTitle>
              <div className="p-1.5 rounded-md bg-emerald-50">
                <FileText className="h-3.5 w-3.5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{formatMoney(totals.cgst)}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total IGST</CardTitle>
              <div className="p-1.5 rounded-md bg-amber-50">
                <FileText className="h-3.5 w-3.5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{formatMoney(totals.igst)}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Tax</CardTitle>
              <div className="p-1.5 rounded-md bg-violet-50">
                <FileText className="h-3.5 w-3.5 text-violet-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{formatMoney(totalTax)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Compact GST Summary Table */}
        <Card className="border-slate-200/60 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center">
              <FileText className="h-4 w-4 mr-2 text-emerald-500" />
              GST Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 bg-slate-50/50">
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Invoice No</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Date</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Customer</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">GST No</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Taxable Amount</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">SGST</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">CGST</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">IGST</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={index} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <TableCell className="py-2.5 text-xs font-medium text-slate-900">{row.invoiceNo}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{format(row.date, 'dd-MMM-yy')}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{row.customer}</TableCell>
                      <TableCell className="py-2.5 text-xs font-mono text-slate-600">{row.gstNo || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">{formatMoney(row.taxableAmount)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">{formatMoney(row.sgst)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">{formatMoney(row.cgst)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">{formatMoney(row.igst)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-semibold">{formatMoney(row.total)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  {rows.length > 0 && (
                    <TableRow className="bg-slate-100/80 font-semibold">
                      <TableCell colSpan={4} className="py-2.5 text-xs text-slate-900">Total</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">{formatMoney(totals.taxableAmount)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">{formatMoney(totals.sgst)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">{formatMoney(totals.cgst)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">{formatMoney(totals.igst)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">{formatMoney(totals.total)}</TableCell>
                    </TableRow>
                  )}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-xs text-slate-400">No invoices in this period.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
