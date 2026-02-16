import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
// Charts removed per request
import { format } from "date-fns";
import {
  Calendar as CalendarIcon,
  Users,
  Printer,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  UserCheck,
  Star,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import CustomerService, { CustomerRow } from "@/services/customerService";

type AnyRow = Record<string, any>;
type TopCustomer = {
  id: string;
  name: string;
  mobile?: string;
  gstNo?: string;
  email?: string;
  address?: string;
  totalOrders: number;
  totalSpent: number;
  creditAmount: number;
  lastOrder: Date | null;
  segment: string;
};
// Segment and acquisition/location types removed along with charts

export default function CustomerReports() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [toDate, setToDate] = useState<Date>(new Date());
  const [draftFromDate, setDraftFromDate] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [draftToDate, setDraftToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<AnyRow[]>([]);
  const [payments, setPayments] = useState<AnyRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  const money0 = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 0,
      }),
    []
  );
  const formatMoney0 = (value: number) => `₹${money0.format(Number(value || 0))}`;

  const handleExportReport = (format: string) => {
    console.log(`Exporting customer report as ${format}`);
    alert(`Customer report exported as ${format.toUpperCase()}`);
  };

  const handlePrintReport = () => {
    console.log(`Printing customer report`);
    alert(`Customer report sent to printer`);
  };

  // Load invoices + payments + customers for selected date range
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
          setCustomers([]);
          setError("Missing account/retail scope");
          return;
        }

        const fromStr = format(fromDate, "yyyy-MM-dd");
        const toStr = format(toDate, "yyyy-MM-dd");
        const q = new URLSearchParams({
          account_code: accountCode,
          retail_code: retailCode,
          limit: "5000",
          from_date: fromStr,
          to_date: toStr,
          billstatus: "Y",
        });

        const [invRes, payRes, custRes] = await Promise.all([
          ApiService.get<any>(`/api/invoices?${q.toString()}`),
          ApiService.getBillingPayments({ accountCode, retailCode, fromDate: fromStr, toDate: toStr }),
          CustomerService.getCustomers(accountCode, retailCode),
        ]);

        if (!mounted) return;
        setInvoices(Array.isArray(invRes?.data) ? invRes.data : []);
        setPayments(Array.isArray((payRes as any)?.data) ? (payRes as any).data : []);
        setCustomers(Array.isArray(custRes) ? custRes : []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load customer data");
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

  const aggregates = useMemo(() => {
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

    const normPhone = (v: any) => {
      const digits = String(v ?? "").replace(/\D/g, "");
      if (!digits) return "";
      return digits.length > 10 ? digits.slice(-10) : digits;
    };

    // Build customer index
    const custById = new Map<string, CustomerRow>();
    const custByPhone = new Map<string, CustomerRow>();
    customers.forEach((c) => {
      const id = String((c as any).customer_id ?? (c as any).id ?? "").trim();
      if (id) custById.set(id, c);
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
      if (phone && !custByPhone.has(phone)) custByPhone.set(phone, c);
    });

    type Agg = {
      id: string;
      name: string;
      mobile?: string;
      gstNo?: string;
      email?: string;
      address?: string;
      city?: string;
      totalOrders: number;
      totalSpent: number;
      creditAmount: number;
      lastOrder: Date | null;
    };
    const perCustomer = new Map<string, Agg>();
    let totalOrders = 0;

    // Payments map (invoiceId/billingId -> total paid)
    const paymentsByInvoice = new Map<string, number>();
    payments.forEach((p: any) => {
      const key = String(
        p?.billing_id ??
          p?.billingId ??
          p?.billing ??
          p?.invoice_id ??
          p?.invoiceId ??
          p?.invoice ??
          p?.id ??
          ""
      ).trim();
      if (!key) return;
      const amt = Number(p?.amount ?? p?.paid_amount ?? p?.value ?? p?.payment_amount ?? 0) || 0;
      paymentsByInvoice.set(key, (paymentsByInvoice.get(key) || 0) + amt);
    });

    // Aggregate by customer from invoices
    invoices.forEach((inv: any, idx: number) => {
      // Filter by billstatus: only include completed bills (Y)
      // Exclude cancelled bills (C) and held bills (N)
      const billStatus = String(inv.billstatus || inv.bill_status || inv.BILLSTATUS || "").toUpperCase();
      if (billStatus === "C" || billStatus === "N") return; // Skip cancelled and held bills
      if (billStatus && billStatus !== "Y") return; // Only include completed bills if billstatus is present

      let status = String(inv.STATUS || inv.status || "").toLowerCase();
      if (status === "canceled") status = "cancelled";
      if (status === "cancelled") return;

      const createdStr =
        inv.txn_created_at ||
        inv.last_created_at ||
        inv.txn_updated_at ||
        inv.last_updated_at ||
        inv.created_at ||
        inv.createdAt ||
        inv.invoice_date ||
        inv.date;
      const created = createdStr ? new Date(createdStr) : new Date();
      if (!dateInRange(created)) return;

      const invoiceId = String(inv.invoice_id ?? inv.invoiceId ?? inv.id ?? inv.invoice ?? `inv-${idx}`).trim();

      const amount = Number(
        inv.txn_grand_total ??
          inv.txn_total_amount ??
          inv.txn_total ??
          inv.grand_total ??
          inv.total_amount ??
          inv.amount ??
          inv.total ??
          0
      ) || 0;

      const paidForInvoice = paymentsByInvoice.get(invoiceId) || 0;
      const creditForInvoice = Math.max(amount - paidForInvoice, 0);

      // Identify customer by id or phone
      const cid = String(getCI(inv, ["customer_id", "customerId", "txn_customer_id", "master_customer_id"]) ?? "").trim();
      const invoicePhone = String(
        getCI(inv, [
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
        ]) ?? ""
      ).trim();
      const phoneNorm = normPhone(invoicePhone);

      const master = (cid ? custById.get(cid) : undefined) || (phoneNorm ? custByPhone.get(phoneNorm) : undefined);

      const invoiceNameRaw =
        getCI(inv, ["txn_customer_name", "customer_name", "customer", "client_name", "guest_name", "party_name", "name"]) ?? "";
      const invoiceName = typeof invoiceNameRaw === "object" ? "" : String(invoiceNameRaw ?? "").trim();
      const masterName = String((master?.customer_name || master?.name || "") ?? "").trim();
      const name = masterName || invoiceName || (phoneNorm || "Walk-in");

      const masterGst = String(
        ((master as any)?.gst_number || (master as any)?.gstin || (master as any)?.gst || "") ?? ""
      ).trim();
      const invoiceGst = String(getCI(inv, ["gstin", "gst_no", "gst_number", "gst"]) ?? "").trim();
      const gstNo = invoiceGst || masterGst || undefined;

      const address = String(
        ((master as any)?.address || (master as any)?.address1 || (master as any)?.address_line1 || "") ?? ""
      ).trim() || undefined;

      const email = String((master as any)?.email ?? (getCI(inv, ["email", "customer_email"]) ?? "") ?? "").trim() || undefined;
      const city = (master as any)?.city || (master as any)?.state_name || (master as any)?.state || (master as any)?.address || "Unknown";

      totalOrders += 1;

      const aggKey = cid || phoneNorm || name || invoiceId;
      if (!perCustomer.has(aggKey)) {
        perCustomer.set(aggKey, {
          id: aggKey,
          name,
          mobile: (invoicePhone || (master as any)?.mobile || (master as any)?.customer_mobile || (master as any)?.phone || phoneNorm || undefined) as any,
          gstNo,
          email,
          address,
          city,
          totalOrders: 0,
          totalSpent: 0,
          creditAmount: 0,
          lastOrder: null,
        });
      }
      const agg = perCustomer.get(aggKey)!;
      agg.totalOrders += 1;
      agg.totalSpent += amount;
      agg.creditAmount += creditForInvoice;
      if (!agg.lastOrder || created > agg.lastOrder) agg.lastOrder = created;
    });
    const list = Array.from(perCustomer.values());
    const totalRevenue = list.reduce((s, x) => s + x.totalSpent, 0);
    const repeatCustomers = list.filter((x) => x.totalOrders > 1).length;
    return { list, totalOrders, totalRevenue, repeatCustomers };
  }, [invoices, customers, payments, fromDate, toDate]);

  const topCustomers: TopCustomer[] = useMemo(() => {
    // Show ALL customers in the selected period (sorted by total spent desc)
    return aggregates.list
      .slice()
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .map((c) => ({
        id: c.id,
        name: c.name,
        mobile: (c as any).mobile,
        gstNo: (c as any).gstNo,
        email: c.email,
        address: (c as any).address,
        totalOrders: c.totalOrders,
        totalSpent: c.totalSpent,
        creditAmount: (c as any).creditAmount || 0,
        lastOrder: c.lastOrder,
        segment:
          c.totalOrders === 1
            ? "New"
            : (c.totalSpent >= 100000 || c.totalOrders >= 10)
              ? "Premium"
              : (c.totalSpent >= 50000 || c.totalOrders >= 5)
                ? "Regular"
                : "Occasional",
      }));
  }, [aggregates]);

  const totals = useMemo(() => {
    const totalCustomers = aggregates.list.length;
    const totalRevenue = aggregates.totalRevenue;
    const avgOrderValue = aggregates.totalOrders ? aggregates.totalRevenue / aggregates.totalOrders : 0;
    const repeatCustomers = aggregates.repeatCustomers;
    return { totalCustomers, totalRevenue, avgOrderValue, repeatCustomers };
  }, [aggregates]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Customer Reports</h1>
            </div>
            
            {/* Compact Action Bar */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleExportReport('pdf')} className="h-8 text-xs">
                Export PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrintReport} className="h-8 text-xs">
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                Print
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
        {/* Compact Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total Customers</CardTitle>
              <div className="p-1.5 rounded-md bg-blue-50">
                <Users className="h-3.5 w-3.5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{totals.totalCustomers}</div>
              <div className="flex items-center text-[11px] text-emerald-600 font-medium mt-1">
                <TrendingUp className="h-3 w-3 mr-1" />
                +15.2% from last month
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Customer Revenue</CardTitle>
              <div className="p-1.5 rounded-md bg-emerald-50">
                <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{formatMoney0(totals.totalRevenue)}</div>
              <div className="flex items-center text-[11px] text-emerald-600 font-medium mt-1">
                <TrendingUp className="h-3 w-3 mr-1" />
                +12.8% from last month
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Avg Order Value</CardTitle>
              <div className="p-1.5 rounded-md bg-amber-50">
                <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{formatMoney0(totals.avgOrderValue)}</div>
              <div className="flex items-center text-[11px] text-rose-600 font-medium mt-1">
                <TrendingDown className="h-3 w-3 mr-1" />
                -3.2% from last month
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Repeat Customers</CardTitle>
              <div className="p-1.5 rounded-md bg-violet-50">
                <UserCheck className="h-3.5 w-3.5 text-violet-600" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold text-slate-900">{totals.repeatCustomers}</div>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                {totals.totalCustomers ? Math.round((totals.repeatCustomers / totals.totalCustomers) * 100) : 0}% retention rate
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Compact Customer Table */}
        <Card className="border-slate-200/60 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center">
              <Star className="h-4 w-4 mr-2 text-amber-500" />
              Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 bg-slate-50/50">
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Customer Name</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Mobile</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">GST No</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Email</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Address</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Total Orders</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Total Spent</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600 text-right">Credit Amount</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Last Order</TableHead>
                    <TableHead className="h-9 text-xs font-semibold text-slate-600">Segment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCustomers.map((customer, index) => (
                    <TableRow key={index} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <TableCell className="py-2.5 text-xs font-medium text-slate-900">{customer.name}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{customer.mobile || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs font-mono text-slate-600">{customer.gstNo || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{customer.email || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600 max-w-[200px] truncate" title={customer.address || ''}>{customer.address || '-'}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-medium">{customer.totalOrders}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-900 text-right font-semibold">{formatMoney0(customer.totalSpent)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600 text-right">{formatMoney0(customer.creditAmount || 0)}</TableCell>
                      <TableCell className="py-2.5 text-xs text-slate-600">{customer.lastOrder ? format(customer.lastOrder, 'dd-MMM-yy') : '-'}</TableCell>
                      <TableCell className="py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${
                          customer.segment === "Premium" 
                            ? "bg-purple-100 text-purple-700 ring-1 ring-purple-200"
                            : customer.segment === "Regular"
                            ? "bg-blue-100 text-blue-700 ring-1 ring-blue-200"
                            : customer.segment === "Occasional"
                            ? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                            : "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                        }`}>
                          {customer.segment}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {topCustomers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-8 text-center text-xs text-slate-400">
                        No customers found in this period.
                      </TableCell>
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
