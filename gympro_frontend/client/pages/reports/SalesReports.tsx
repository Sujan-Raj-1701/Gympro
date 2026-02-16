import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import {
  Download,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  ShoppingCart,
  ArrowLeft,
  CreditCard,
  FileText,
  Clock,
  Search,
  XCircle,
  PauseCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import CustomerService, { type CustomerRow } from "@/services/customerService";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type InvoiceRow = Record<string, any>;
type PaymentRow = Record<string, any>;

type BillStatus = "Y" | "N" | "C" | "";

const safeNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Helper to get a property value case-insensitively; supports multiple fallback keys
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

const formatBillStatus = (s: BillStatus) => {
  if (s === "Y") return { label: "Completed", cls: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200" };
  if (s === "N") return { label: "Held", cls: "bg-amber-100 text-amber-700 ring-1 ring-amber-200" };
  if (s === "C") return { label: "Cancelled", cls: "bg-rose-100 text-rose-700 ring-1 ring-rose-200" };
  return { label: "—", cls: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" };
};

export default function SalesReports() {
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsBooking, setDetailsBooking] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const handleExportReport = (format: string) => {
    // legacy no-op; kept for compatibility if referenced elsewhere
  };

  const handleExportExcel = () => {
    const rows = filteredData.map((o) => {
      const paid = paymentsByBooking.get(String(o.pk)) || 0;
      const balance = Math.max((o.totalAmount || 0) - paid, 0);
      return {
        Date: format(o.created, "dd-MM-yyyy"),
        Order: String(o.displayId),
        Customer: o.customer || "-",
        Phone: o.customerPhone || "",
        Staff: o.staffName || "-",
        Bill: o.billStatus || "",
        Payment: o.paymentMode || "",
        GSTNo: o.customerGST || "",
        AadhaarNo: o.customerAadhaar || "",
        PANNo: o.customerPAN || "",
        Address: o.customerAddress || "",
        Hall: o.hall || "-",
        Subtotal: o.subtotalAmount || 0,
        Discount: o.discountAmount || 0,
        Tax: o.taxAmount || 0,
        Roundoff: o.roundoff || 0,
        Amount: o.totalAmount || 0,
        Paid: paid,
        Balance: balance,
        Status: o.status ? (o.status.charAt(0).toUpperCase() + o.status.slice(1)) : 'Active',
      };
    });
    // Append totals row
    const totals = {
      Amount: filteredData.reduce((s,o)=>s+(o.totalAmount||0),0),
      Paid: filteredData.reduce((s,o)=>s+(paymentsByBooking.get(String(o.pk))||0),0),
    } as const;
    const pending = Math.max(totals.Amount - totals.Paid, 0);
    rows.push({
      Date: "",
      Order: "Total",
      Customer: "",
      Phone: "",
      Staff: "",
      Bill: "",
      Payment: "",
      GSTNo: "",
      AadhaarNo: "",
      PANNo: "",
      Address: "",
      Hall: "",
      Subtotal: "" as any,
      Discount: "" as any,
      Tax: "" as any,
      Roundoff: "" as any,
      Amount: totals.Amount,
      Paid: totals.Paid,
      Balance: pending,
      Status: "",
    } as any);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Reports");
    XLSX.writeFile(wb, `sales-reports_${format(fromDate, 'yyyyMMdd')}_${format(toDate, 'yyyyMMdd')}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const title = `Sales Reports (${format(fromDate, 'dd-MM-yyyy')} → ${format(toDate, 'dd-MM-yyyy')})`;
    doc.setFontSize(14);
    doc.text(title, 14, 14);
    const body = filteredData.map((o) => {
      const paid = paymentsByBooking.get(String(o.pk)) || 0;
      const balance = Math.max((o.totalAmount || 0) - paid, 0);
      return [
        format(o.created, 'dd-MM-yyyy'),
        String(o.displayId),
        o.customer || '-',
        o.customerPhone || '',
        o.staffName || '-',
        String(o.billStatus || ''),
        o.paymentMode || '',
        o.customerGST || '',
        o.customerAadhaar || '',
        o.customerPAN || '',
        o.customerAddress || '',
        o.hall || '-',
        `₹${(o.totalAmount||0).toLocaleString()}`,
        `₹${paid.toLocaleString()}`,
        `₹${balance.toLocaleString()}`,
        o.status ? (o.status.charAt(0).toUpperCase() + o.status.slice(1)) : 'Active',
      ];
    });
    // Totals row at bottom
    const totalsAmount = filteredData.reduce((s,o)=>s+(o.totalAmount||0),0);
    const totalsPaid = filteredData.reduce((s,o)=>s+(paymentsByBooking.get(String(o.pk))||0),0);
    const totalsBalance = Math.max(totalsAmount - totalsPaid, 0);
    body.push([
      "",
      "Total",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `₹${totalsAmount.toLocaleString()}`,
      `₹${totalsPaid.toLocaleString()}`,
      `₹${totalsBalance.toLocaleString()}`,
      "",
    ]);
    autoTable(doc, {
      head: [["Date", "Order", "Customer", "Phone", "Staff", "Bill", "Payment", "GST No", "Aadhaar No", "PAN No", "Address", "Hall", "Amount", "Paid", "Balance", "Status"]],
      body,
      startY: 20,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [33, 150, 243] },
    });
    doc.save(`sales-reports_${format(fromDate, 'yyyyMMdd')}_${format(toDate, 'yyyyMMdd')}.pdf`);
  };

  // Load invoice + payment data from backend based on submitted dates
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

        const fromStr = format(fromDate, 'yyyy-MM-dd');
        const toStr = format(toDate, 'yyyy-MM-dd');

        const q = new URLSearchParams({
          account_code: accountCode,
          retail_code: retailCode,
          limit: '1000',
          from_date: fromStr,
          to_date: toStr,
        });

        // Use consolidated endpoint so we don't need separate invoice + payment calls
        const transitionsRes = await ApiService.get<any>(
          `/api/billing-transitions?${q.toString()}&include_details=true`
        );

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
        const invRows: any[] = Array.isArray(transitionsRes?.data)
          ? transitionsRes.data
          : Array.isArray(transitionsRes?.data?.data)
          ? transitionsRes.data.data
          : [];
        setInvoices(invRows);
        // Payments are embedded per invoice row; flatten for existing aggregation logic
        const flatPayments: any[] = invRows.flatMap((r: any) => (Array.isArray(r?.payments) ? r.payments : []));
        setPayments(flatPayments);
        setCustomers(Array.isArray(customerRows) ? customerRows : []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load sales data");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [user, fromDate, toDate]);

  const dateInRange = (d: Date) => {
    // Compare only date portion (ignore time)
    const dm = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const fm = fromDate ? new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()) : null;
    const tm = toDate ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate()) : null;
    return (!fm || dm >= fm) && (!tm || dm <= tm);
  };

  const paymentsByBooking = useMemo(() => {
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

    const pick = (row: CustomerRow, keys: string[]) => {
      for (const k of keys) {
        const v = (row as any)?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return undefined;
    };

    for (const c of customers) {
      const id = String(pick(c, ["id", "customer_id"]) ?? "").trim();
      if (id) byId.set(id, c);

      const phone = normPhone(
        pick(c, ["customer_mobile", "mobile", "phone", "phone1", "alternate_phone", "phone2", "alternate_mobile"])
      );
      if (phone) byPhone.set(phone, c);
    }

    return { byId, byPhone, normPhone };
  }, [customers]);

  const normalized = useMemo(() => {
    const idMatches = (row: any, id: any, idKeys: string[]) => {
      if (!row) return false;
      const idStr = String(id ?? "").trim().toLowerCase();
      if (!idStr) return false;
      for (const k of idKeys) {
        const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
        if (v != null && String(v).trim().toLowerCase() === idStr) return true;
      }
      return false;
    };

    const pickName = (row: any, nameKeys: string[]) => {
      for (const k of nameKeys) {
        const v = row?.[k] ?? row?.[k.toLowerCase()] ?? row?.[k.toUpperCase()];
        if (v != null && String(v) !== "") return v as string;
      }
      return undefined;
    };

    const resolveRowFromMasters = (
      id: any,
      rows: any[],
      idKeys: string[]
    ) => {
      if (!id || !rows?.length) return undefined;
      return rows.find((r) => idMatches(r, id, idKeys));
    };

    const isDigits = (v: any) => typeof v === "number" || (/^\d+$/.test(String(v).trim()));

    const list = invoices
      .map((r: any, idx) => {
      const billStatus = String(r.billstatus || r.bill_status || r.BILLSTATUS || "").toUpperCase() as BillStatus;

      const createdStr =
        r.txn_created_at ||
        r.last_created_at ||
        r.txn_updated_at ||
        r.last_updated_at ||
        r.created_at ||
        r.createdAt ||
        r.date;
      const created = createdStr ? new Date(createdStr) : new Date();

      const invoiceId = String(r.invoice_id ?? r.invoiceId ?? r.id ?? r.invoice ?? "").trim() || `inv-${idx}`;
      const subtotalAmount = safeNum(
        getValueCI(r, ["subtotal", "txn_subtotal_amount", "txn_subtotal", "raw_subtotal"])
      );
      const discountAmount = safeNum(
        getValueCI(r, ["discount_amount", "txn_discount_amount", "discount_sum"])
      );
      const taxAmount = safeNum(getValueCI(r, ["tax_amount", "txn_tax_amount"]));
      const roundoff = safeNum(getValueCI(r, ["roundoff", "round_off", "roundOff"]));
      const grandTotal =
        safeNum(
          getValueCI(r, [
            "grand_total",
            "txn_grand_total",
            "txn_total_amount",
            "txn_total",
            "total_amount",
            "amount",
            "total",
          ])
        ) || Math.max(0, subtotalAmount - discountAmount + taxAmount + roundoff);

      const totalAmount = grandTotal;

      const paidAgg = paymentsByBooking.get(invoiceId) || 0;
      let statusRaw = String(r.STATUS || r.status || "").toLowerCase();
      if (billStatus === "C") statusRaw = "cancelled";
      else if (billStatus === "N") statusRaw = "held";
      else if (!statusRaw) {
        if (totalAmount > 0 && paidAgg >= totalAmount - 0.01) statusRaw = "paid";
        else if (paidAgg > 0) statusRaw = "advanced";
        else statusRaw = "active";
      }
      if (statusRaw === "canceled") statusRaw = "cancelled";
      const status = statusRaw;

      const pk = invoiceId;
      const displayId = invoiceId;
      // Resolve customer: try many possible fields and nested object shapes
      let customer: any = getValueCI(r, [
        "txn_customer_name",
        "txn_customer",
        "customer_name",
        "customerr_name",
        "customer",
        "customerName",
        "cust_name",
        "customer_full_name",
        "customerfullname",
        "customername",
        "CLIENT_NAME",
        "CUSTOMER_NAME",
        "client_name",
        "guest_name",
        "party_name",
        "name",
      ]);
      if (typeof customer === "object" && customer) {
        customer = getValueCI(customer, ["full_name", "fullname", "name", "customer_name"]) ?? "";
      }
      // Try to capture a phone number on the booking record
      let customerPhone: any = getValueCI(r, [
        "txn_customer_phone",
        "customer_phone",
        "phone",
        "phone_no",
        "phone_number",
        "mobile",
        "customer_mobile_no",
        "mobile_no",
        "contact",
        "contact_no",
        "customer_mobile",
        "customer_contact",
        "CLIENT_PHONE",
        "CUSTOMER_PHONE",
      ]);
      // Also accept the known invoice header aliases
      if (!customerPhone) {
        customerPhone = getValueCI(r, [
          "txn_customer_mobile",
          "txn_customer_number",
          "customer_mobile",
          "customer_number",
        ]);
      }
      // Additional customer attributes: GST, Aadhaar, PAN, Address (with robust key fallbacks)
      const customerGST: any = getValueCI(r, [
        "gstin", "gst_no", "gst", "gstnumber", "gst_number", "gstno"
      ]);
      const customerAadhaar: any = getValueCI(r, [
        "aadhaar", "aadhar", "aadhaar_no", "aadhar_no", "aadhaar_number", "aadhar_number"
      ]);
      const customerPAN: any = getValueCI(r, [
        "pan", "pan_no", "panno", "pan_number"
      ]);
      let customerAddress: any = getValueCI(r, [
        "address", "address1", "address_line1", "addr1"
      ]);
      const address2: any = getValueCI(r, ["address2", "address_line2", "addr2"]);
      if (customerAddress && address2) customerAddress = `${customerAddress}, ${address2}`;
      if (!customer) customer = "-";
      if (!customerPhone) customerPhone = "";

      // Normalize phone to 10 digits (if present)
      customerPhone = customersIndex.normPhone(customerPhone);

      // Enrich customer details from master_customer when invoice rows don't carry them
      if ((customer === "-" || String(customer).trim() === "") || !customerPhone) {
        const customerId = String(
          getValueCI(r, [
            "txn_customer_id",
            "customer_id",
            "cust_id",
            "client_id",
            "customerid",
          ]) ??
            ""
        ).trim();

        const normalizedPhone = customersIndex.normPhone(customerPhone);
        const fromMaster =
          (customerId && customersIndex.byId.get(customerId)) ||
          (normalizedPhone && customersIndex.byPhone.get(normalizedPhone)) ||
          undefined;

        if (fromMaster) {
          const masterName =
            (fromMaster.customer_name ?? fromMaster.name ?? "") &&
            String(fromMaster.customer_name ?? fromMaster.name ?? "").trim();
          const masterPhone = customersIndex.normPhone(
            fromMaster.customer_mobile ??
              fromMaster.mobile ??
              fromMaster.phone ??
              fromMaster.phone1 ??
              fromMaster.alternate_phone ??
              fromMaster.phone2 ??
              fromMaster.alternate_mobile
          );

          if (customer === "-" && masterName) customer = masterName;
          if (!customerPhone && masterPhone) customerPhone = masterPhone;
        }
      }

      const staffName: string =
        String(
          getValueCI(r, ["employee_name", "txn_employee_name", "staff_name"]) ?? ""
        ).trim() || "-";

      const paymentsArr: any[] = Array.isArray(r?.payments) ? r.payments : [];
      const primaryPay = paymentsArr[0];
      const paymentMode: string =
        String(
          getValueCI(primaryPay, [
            "payment_mode_name",
            "payment_method",
            "mode",
            "payment_mode",
          ]) ??
            ""
        ).trim() || (paidAgg > 0 ? "Paid" : "—");

      // Resolve hall/venue
      let hall: any = getValueCI(r, [
        "hall_name",
        "hall",
        "hall_id",
        "hallid",
        "venue",
        "venue_name",
        "room",
      ]);
      if (typeof hall === "object" && hall) {
        hall = getValueCI(hall, ["name", "hall_name", "title"]) ?? "";
      }

      const customerDisplay = customerPhone ? `${customer} (${customerPhone})` : customer;
      const hallDisplay = hall || "-";
      const balance = Math.max(totalAmount - paidAgg, 0);
      return {
        pk,
        displayId,
        created,
        subtotalAmount,
        discountAmount,
        taxAmount,
        roundoff,
        grandTotal,
        totalAmount,
        paidAmount: paidAgg,
        balance,
        billStatus,
        staffName,
        paymentMode,
        status,
        customer,
        customerPhone,
        customerGST,
        customerAadhaar,
        customerPAN,
        customerAddress,
        customerDisplay,
        hall: hallDisplay,
        _row: r,
      };
    });
    return list.filter((x) => dateInRange(x.created));
  }, [invoices, paymentsByBooking, fromDate, toDate, customersIndex]);

  const metrics = useMemo(() => {
    // Process all invoices to get cancelled and held counts
    const allBills = invoices.map((r: any) => {
      const billStatus = String(r.billstatus || r.bill_status || r.BILLSTATUS || "").toUpperCase();
      const createdStr = r.txn_created_at || r.last_created_at || r.txn_updated_at || r.last_updated_at || r.created_at || r.createdAt || r.date;
      const created = createdStr ? new Date(createdStr) : new Date();
      const amount = Number(r.txn_grand_total ?? r.txn_total_amount ?? r.txn_total ?? r.grand_total ?? r.total_amount ?? r.amount ?? r.total ?? 0) || 0;
      return { billStatus, created, amount };
    }).filter((b) => dateInRange(b.created));

    const cancelledBills = allBills.filter((b) => b.billStatus === "C");
    const heldBills = allBills.filter((b) => b.billStatus === "N");
    const cancelledAmount = cancelledBills.reduce((s, b) => s + b.amount, 0);
    const heldAmount = heldBills.reduce((s, b) => s + b.amount, 0);

    // Completed bills metrics: only billstatus=Y should count as sales
    const completed = normalized.filter((x: any) => String(x.billStatus || "").toUpperCase() === "Y");
    const totalOrders = completed.length;
    const totalSales = completed.reduce((s: number, x: any) => s + (x.totalAmount || 0), 0);
    let collected = 0;
    completed.forEach((x: any) => {
      const paid = (x.pk && paymentsByBooking.get(String(x.pk))) || 0;
      collected += paid;
    });
    const pending = Math.max(totalSales - collected, 0);
    return { 
      totalOrders, 
      totalSales, 
      collected, 
      pending, 
      cancelledCount: cancelledBills.length,
      cancelledAmount,
      heldCount: heldBills.length,
      heldAmount,
    };
  }, [normalized, paymentsByBooking, invoices, fromDate, toDate]);

  // Filter normalized data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return normalized;
    const query = searchQuery.toLowerCase();
    return normalized.filter((item) => {
      return (
        (item.customer && item.customer.toLowerCase().includes(query)) ||
        (item.customerPhone && String(item.customerPhone).toLowerCase().includes(query)) ||
        (item.displayId && String(item.displayId).toLowerCase().includes(query)) ||
        (item.hall && item.hall.toLowerCase().includes(query)) ||
        (item.staffName && String(item.staffName).toLowerCase().includes(query)) ||
        (item.status && item.status.toLowerCase().includes(query))
      );
    });
  }, [normalized, searchQuery]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <IndianRupee className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Sales Reports</h1>
            </div>
            
            {/* Compact Action Bar */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportExcel} className="h-8 text-xs">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} className="h-8 text-xs">
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                Export PDF
              </Button>
              <Link to="/reports">
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back to Reports
                </Button>
              </Link>
            </div>
          </div>

          {/* Inline Date Filters & Search */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
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

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
              <Input
                placeholder="Search customers, orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>

            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Compact Key Metrics - Now with 6 cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Sales</CardTitle>
              <div className="p-1.5 rounded-md bg-emerald-50">
                <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">₹{metrics.totalSales.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Orders</CardTitle>
              <div className="p-1.5 rounded-md bg-blue-50">
                <ShoppingCart className="h-3.5 w-3.5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{metrics.totalOrders.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Pending</CardTitle>
              <div className="p-1.5 rounded-md bg-amber-50">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">₹{metrics.pending.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Collected</CardTitle>
              <div className="p-1.5 rounded-md bg-violet-50">
                <CreditCard className="h-3.5 w-3.5 text-violet-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">₹{metrics.collected.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Cancelled</CardTitle>
              <div className="p-1.5 rounded-md bg-rose-50">
                <XCircle className="h-3.5 w-3.5 text-rose-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold text-slate-900">₹{metrics.cancelledAmount.toLocaleString()}</div>
              <p className="text-[10px] text-slate-500 mt-0.5">{metrics.cancelledCount} {metrics.cancelledCount === 1 ? 'bill' : 'bills'}</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Held</CardTitle>
              <div className="p-1.5 rounded-md bg-orange-50">
                <PauseCircle className="h-3.5 w-3.5 text-orange-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold text-slate-900">₹{metrics.heldAmount.toLocaleString()}</div>
              <p className="text-[10px] text-slate-500 mt-0.5">{metrics.heldCount} {metrics.heldCount === 1 ? 'bill' : 'bills'}</p>
            </CardContent>
          </Card>
        </div>

        {/* Compact Sales Ledger Table */}
        <Card className="border-slate-200/60 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center">
              <FileText className="h-4 w-4 mr-2 text-blue-500" />
              Sales Ledger
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 bg-slate-50/50">
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Date</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Order</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Customer</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Phone</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Staff</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Amount</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Paid</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Balance</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Bill</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Status</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((o, i) => (
                    <TableRow key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <TableCell className="py-2.5 text-xs text-slate-600">{format(o.created, 'dd-MM-yyyy')}</TableCell>
                      <TableCell className="py-2.5 text-xs font-medium text-slate-900">{String(o.displayId)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{o.customer || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{o.customerPhone || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{o.staffName || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-semibold">₹{(o.totalAmount || 0).toLocaleString()}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">₹{(paymentsByBooking.get(String(o.pk)) || 0).toLocaleString()}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">₹{Math.max((o.totalAmount || 0) - (paymentsByBooking.get(String(o.pk)) || 0), 0).toLocaleString()}</TableCell>
                      <TableCell className="py-2.5">
                        {(() => {
                          const meta = formatBillStatus(String(o.billStatus || '').toUpperCase() as BillStatus);
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>
                              {meta.label}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {(() => {
                          const s = (o.status || '').toLowerCase();
                          const isCancelled = s === 'cancelled';
                          const isHeld = s === 'held';
                          const isAdvanced = s === 'advanced';
                          const isPaidOrSettled = s === 'paid' || s === 'settled';
                          const cls = isCancelled
                            ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'
                            : isHeld
                            ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                            : isAdvanced
                            ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                            : isPaidOrSettled
                            ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                            : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
                          const label = s ? (s.charAt(0).toUpperCase() + s.slice(1)) : 'Active';
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            title="View details"
                            onClick={() => {
                              setDetailsBooking(o);
                              setDetailsOpen(true);
                            }}
                          >
                            View
                          </Button>
                          <Link to={`/invoice/${o.displayId}`}>
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                              <FileText className="h-3 w-3 mr-1" /> Invoice
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {normalized.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-xs text-slate-400">No orders in this period.</TableCell>
                    </TableRow>
                  )}
                  {/* Totals Row */}
                  {normalized.length > 0 && (
                    <TableRow className="bg-slate-100/80 font-semibold">
                      <TableCell colSpan={5} className="py-2.5 text-xs text-slate-900">Total</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">₹{filteredData.reduce((s: number, x: any) => s + (x.totalAmount || 0), 0).toLocaleString()}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">₹{filteredData.reduce((s: number, x: any) => s + (paymentsByBooking.get(String(x.pk)) || 0), 0).toLocaleString()}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-bold">₹{Math.max(
                        filteredData.reduce((s: number, x: any) => s + (x.totalAmount || 0), 0) -
                          filteredData.reduce((s: number, x: any) => s + (paymentsByBooking.get(String(x.pk)) || 0), 0),
                        0
                      ).toLocaleString()}</TableCell>
                      <TableCell colSpan={4}></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice Details — {String((detailsBooking as any)?.displayId || "")}</DialogTitle>
          </DialogHeader>

          {detailsBooking ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] text-slate-500">Customer</div>
                  <div className="text-sm font-semibold text-slate-900">{(detailsBooking as any).customer || "-"}</div>
                  <div className="text-xs text-slate-600">{(detailsBooking as any).customerPhone || "-"}</div>
                </div>
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] text-slate-500">Staff</div>
                  <div className="text-sm font-semibold text-slate-900">{(detailsBooking as any).staffName || "-"}</div>
                  <div className="text-xs text-slate-600">Payment: {(detailsBooking as any).paymentMode || "—"}</div>
                </div>
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] text-slate-500">Bill</div>
                  <div className="mt-1">
                    {(() => {
                      const meta = formatBillStatus(String((detailsBooking as any).billStatus || "").toUpperCase() as BillStatus);
                      return (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>
                          {meta.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">Status: {String((detailsBooking as any).status || "—").toUpperCase()}</div>
                </div>
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] text-slate-500">Total</div>
                  <div className="text-sm font-semibold text-slate-900">₹{safeNum((detailsBooking as any).totalAmount).toLocaleString("en-IN")}</div>
                  <div className="text-xs text-slate-600">
                    Paid ₹{safeNum((detailsBooking as any).paidAmount).toLocaleString("en-IN")} • Bal ₹{safeNum((detailsBooking as any).balance).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              {/* Customer details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] text-slate-500">GST / Aadhaar / PAN</div>
                  <div className="text-xs text-slate-700 mt-1">
                    GST: {(detailsBooking as any).customerGST || "—"} • Aadhaar: {(detailsBooking as any).customerAadhaar || "—"} • PAN: {(detailsBooking as any).customerPAN || "—"}
                  </div>
                </div>
                <div className="rounded border bg-white p-3">
                  <div className="text-[11px] text-slate-500">Address</div>
                  <div className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{(detailsBooking as any).customerAddress || "—"}</div>
                </div>
              </div>

              {/* Items */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Items</div>
                <div className="rounded border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs text-right">Rate</TableHead>
                        <TableHead className="text-xs text-center">Qty</TableHead>
                        <TableHead className="text-xs text-right">Tax</TableHead>
                        <TableHead className="text-xs text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const row = (detailsBooking as any)._row || detailsBooking;
                        const services: any[] = Array.isArray((row as any)?.services) ? (row as any).services : [];
                        const packages: any[] = Array.isArray((row as any)?.packages) ? (row as any).packages : [];
                        const inventory: any[] = Array.isArray((row as any)?.inventory) ? (row as any).inventory : [];

                        const toTax = (x: any) =>
                          safeNum(
                            getValueCI(x, ["tax_amount", "total_tax", "gst_amount"]) ??
                              (safeNum(x?.total_cgst) + safeNum(x?.total_sgst) + safeNum(x?.total_igst) + safeNum(x?.total_vat))
                          );

                        const items = [
                          ...services.map((s, idx) => ({
                            key: `svc-${s?.id ?? s?.service_id ?? idx}`,
                            type: "Service",
                            name: String(getValueCI(s, ["service_name", "name"]) ?? "Service"),
                            qty: safeNum(getValueCI(s, ["qty", "quantity"]) ?? 1) || 1,
                            rate: safeNum(getValueCI(s, ["unit_price", "price"]) ?? 0),
                            tax: toTax(s),
                            amount: safeNum(getValueCI(s, ["grand_total", "total", "amount"]) ?? 0),
                          })),
                          ...packages.map((p, idx) => ({
                            key: `pkg-${p?.id ?? p?.package_id ?? idx}`,
                            type: "Package",
                            name: String(getValueCI(p, ["package_name", "name"]) ?? "Package"),
                            qty: safeNum(getValueCI(p, ["qty", "quantity"]) ?? 1) || 1,
                            rate: safeNum(getValueCI(p, ["unit_price", "price"]) ?? 0),
                            tax: toTax(p),
                            amount: safeNum(getValueCI(p, ["grand_total", "total", "amount"]) ?? 0),
                          })),
                          ...inventory.map((it, idx) => ({
                            key: `inv-${it?.id ?? it?.product_id ?? idx}`,
                            type: "Product",
                            name: String(getValueCI(it, ["product_name", "name", "item_name"]) ?? "Product"),
                            qty: safeNum(getValueCI(it, ["qty", "quantity"]) ?? 1) || 1,
                            rate: safeNum(getValueCI(it, ["unit_price", "price"]) ?? 0),
                            tax: toTax(it),
                            amount: safeNum(getValueCI(it, ["grand_total", "total", "amount"]) ?? 0),
                          })),
                        ].filter((x) => x.name);

                        if (items.length === 0) {
                          return (
                            <TableRow>
                              <TableCell colSpan={6} className="py-6 text-center text-xs text-slate-500">No line items found.</TableCell>
                            </TableRow>
                          );
                        }

                        return items.map((it) => (
                          <TableRow key={it.key}>
                            <TableCell className="text-xs text-slate-900">{it.name}</TableCell>
                            <TableCell className="text-xs text-slate-600">
                              <Badge variant="outline" className="text-[10px]">{it.type}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-right">₹{it.rate.toLocaleString("en-IN")}</TableCell>
                            <TableCell className="text-xs text-center">{it.qty}</TableCell>
                            <TableCell className="text-xs text-right">{it.tax ? `₹${it.tax.toLocaleString("en-IN")}` : "-"}</TableCell>
                            <TableCell className="text-xs text-right font-medium">₹{(it.amount || (it.rate * it.qty + it.tax)).toLocaleString("en-IN")}</TableCell>
                          </TableRow>
                        ));
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Payments */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Payments</div>
                <div className="rounded border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Mode</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const row = (detailsBooking as any)._row || detailsBooking;
                        const pays: any[] = Array.isArray((row as any)?.payments) ? (row as any).payments : [];
                        if (pays.length === 0) {
                          return (
                            <TableRow>
                              <TableCell colSpan={4} className="py-4 text-center text-xs text-slate-500">No payments.</TableCell>
                            </TableRow>
                          );
                        }
                        return pays.map((p, idx) => (
                          <TableRow key={`pay-${idx}`}>
                            <TableCell className="text-xs">{String(getValueCI(p, ["payment_mode_name", "payment_method", "mode"]) ?? "—")}</TableCell>
                            <TableCell className="text-xs">{String(getValueCI(p, ["status"]) ?? "—")}</TableCell>
                            <TableCell className="text-xs">{String(getValueCI(p, ["payment_date", "created_at"]) ?? "").replace("T", " ").slice(0, 19) || "—"}</TableCell>
                            <TableCell className="text-xs text-right font-medium">₹{safeNum(getValueCI(p, ["amount", "paid_amount"]) ?? 0).toLocaleString("en-IN")}</TableCell>
                          </TableRow>
                        ));
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Totals */}
              <div className="ml-auto w-full sm:max-w-sm space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-600">Subtotal</span><span className="font-medium">₹{safeNum((detailsBooking as any).subtotalAmount).toLocaleString("en-IN")}</span></div>
                {safeNum((detailsBooking as any).discountAmount) > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Discount</span><span className="font-medium text-red-600">-₹{safeNum((detailsBooking as any).discountAmount).toLocaleString("en-IN")}</span></div>
                )}
                {safeNum((detailsBooking as any).taxAmount) > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Tax</span><span className="font-medium">₹{safeNum((detailsBooking as any).taxAmount).toLocaleString("en-IN")}</span></div>
                )}
                {safeNum((detailsBooking as any).roundoff) !== 0 && (
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Round-off</span><span className="font-medium">₹{safeNum((detailsBooking as any).roundoff).toLocaleString("en-IN")}</span></div>
                )}
                <div className="flex justify-between text-base font-semibold border-t pt-2"><span>Total</span><span className="text-green-700">₹{safeNum((detailsBooking as any).totalAmount).toLocaleString("en-IN")}</span></div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>Close</Button>
            {(detailsBooking as any)?.displayId ? (
              <Link to={`/invoice/${String((detailsBooking as any).displayId)}`}>
                <Button>Open Invoice</Button>
              </Link>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
