import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, Star, ArrowLeft, IndianRupee, Phone, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type TopCustomerData = {
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  visit_count: number;
  total_spent: number;
  avg_invoice_value: number;
  last_visit_date: string;
};

type BillingTransitionsResponse = {
  success: boolean;
  data?: any[];
  count?: number;
  error?: string;
  message?: string;
};

const normBillStatus = (v: any) => String(v || "").toUpperCase();

function extractBillingTransitionsRows(resp: any): any[] {
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.data?.data)) return resp.data.data;
  if (Array.isArray(resp)) return resp;
  return [];
}

function parseInvoiceDate(inv: any): Date | null {
  const invDate = inv?.txn_created_at || inv?.created_at || inv?.last_created_at || inv?.date;
  if (!invDate) return null;
  const d = new Date(invDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getInvoiceTotal(inv: any): number {
  const val = inv?.txn_grand_total ?? inv?.txn_total_amount ?? inv?.txn_total ?? inv?.grand_total ?? inv?.total_amount ?? inv?.total ?? 0;
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

function getCustomerId(inv: any): number {
  const raw = inv?.txn_customer_id ?? inv?.customer_id;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function getCustomerName(inv: any): string {
  const name = inv?.txn_customer_name ?? inv?.customer_name;
  return String(name || "").trim();
}

function getCustomerPhone(inv: any): string {
  const phone =
    inv?.txn_customer_mobile ??
    inv?.txn_customer_number ??
    inv?.customer_mobile ??
    inv?.customer_number ??
    inv?.customer_phone;
  return String(phone || "").trim();
}

function getCustomerKey(inv: any): string {
  const id = inv?.txn_customer_id ?? inv?.customer_id;
  if (id != null && String(id).trim()) return `id:${String(id).trim()}`;
  const phone = getCustomerPhone(inv);
  if (phone) return `phone:${phone}`;
  const name = getCustomerName(inv);
  if (name) return `name:${name.toLowerCase()}`;
  // Prevent merging multiple anonymous walk-in invoices into one “customer”
  const invId = String(inv?.invoice_id ?? "").trim();
  if (invId) return `walkin:${invId}`;
  return `walkin:${Math.random().toString(36).slice(2)}`;
}

export default function TopCustomers() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerData, setCustomerData] = useState<TopCustomerData[]>([]);
  const [limit, setLimit] = useState<number>(20);

  const fetchTopCustomers = useCallback(async () => {
    if (!user?.account_code || !user?.retail_code) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");

      const params = new URLSearchParams({
        account_code: String(user.account_code),
        retail_code: String(user.retail_code),
        from_date: from,
        to_date: to,
        limit: "10000",
        include_details: "false",
      });
      const resp = await ApiService.get<BillingTransitionsResponse>(`/billing-transitions?${params.toString()}`);
      if (resp && resp.success === false) {
        throw new Error(resp?.error || resp?.message || "Failed to fetch billing transitions");
      }

      const invoices = extractBillingTransitionsRows(resp);

      type Agg = {
        customerKey: string;
        customer_id: number;
        customer_name: string;
        customer_phone: string;
        visit_count: number;
        total_spent: number;
        last_visit: Date | null;
      };
      const byCustomer = new Map<string, Agg>();

      const fromD = new Date(from);
      const toD = new Date(to);
      toD.setHours(23, 59, 59, 999);

      for (const inv of invoices) {
        const billStatus = normBillStatus(inv?.billstatus ?? inv?.bill_status ?? inv?.BILLSTATUS);
        if (billStatus === "C" || billStatus === "N") continue;
        if (billStatus && billStatus !== "Y") continue;

        const d = parseInvoiceDate(inv);
        if (!d || d < fromD || d > toD) continue;

        const customerKey = getCustomerKey(inv);
        const total = getInvoiceTotal(inv);

        const existing = byCustomer.get(customerKey) || {
          customerKey,
          customer_id: getCustomerId(inv),
          customer_name: getCustomerName(inv),
          customer_phone: getCustomerPhone(inv),
          visit_count: 0,
          total_spent: 0,
          last_visit: null,
        };

        if (!existing.customer_id) {
          const cid = getCustomerId(inv);
          if (cid) existing.customer_id = cid;
        }
        if (!existing.customer_name) {
          const nm = getCustomerName(inv);
          if (nm) existing.customer_name = nm;
        }
        if (!existing.customer_phone) {
          const ph = getCustomerPhone(inv);
          if (ph) existing.customer_phone = ph;
        }

        existing.visit_count += 1;
        existing.total_spent += total;
        if (!existing.last_visit || d > existing.last_visit) existing.last_visit = d;

        byCustomer.set(customerKey, existing);
      }

      const rows: TopCustomerData[] = Array.from(byCustomer.values())
        .map((a) => {
          const avg = a.visit_count ? a.total_spent / a.visit_count : 0;
          const displayPhone = a.customer_phone || "-";
          const displayName = a.customer_name || (displayPhone !== "-" ? displayPhone : "Walk-in");
          const lastVisitDate = a.last_visit ? format(a.last_visit, "dd/MM/yyyy") : "-";
          return {
            customer_id: a.customer_id || 0,
            customer_name: displayName,
            customer_phone: displayPhone,
            visit_count: a.visit_count,
            total_spent: Number(a.total_spent.toFixed(2)),
            avg_invoice_value: Number(avg.toFixed(2)),
            last_visit_date: lastVisitDate,
          };
        })
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, limit);

      setCustomerData(rows);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch top customers data");
      setCustomerData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.account_code, user?.retail_code, fromDate, toDate, limit]);

  useEffect(() => {
    fetchTopCustomers();
  }, [fetchTopCustomers]);

  const handleSubmit = () => {
    fetchTopCustomers();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(customerData.map((row, idx) => ({
      "Rank": idx + 1,
      "Customer Name": row.customer_name,
      "Phone": row.customer_phone,
      "Visits": row.visit_count,
      "Total Spent": row.total_spent,
      "Avg Invoice": row.avg_invoice_value,
      "Last Visit": row.last_visit_date,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Top Customers");
    XLSX.writeFile(wb, `Top_Customers_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Top Customers Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Rank", "Customer", "Phone", "Visits", "Total Spent", "Last Visit"]],
      body: customerData.map((row, idx) => [
        idx + 1,
        row.customer_name,
        row.customer_phone,
        row.visit_count,
        `₹${row.total_spent.toFixed(2)}`,
        row.last_visit_date,
      ]),
    });
    doc.save(`Top_Customers_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalRevenue = customerData.reduce((sum, row) => sum + row.total_spent, 0);
  const totalVisits = customerData.reduce((sum, row) => sum + row.visit_count, 0);

  const getMedalIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (rank === 2) return <Trophy className="h-5 w-5 text-gray-400" />;
    if (rank === 3) return <Trophy className="h-5 w-5 text-amber-600" />;
    return <span className="text-slate-500 font-semibold">{rank}</span>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <Star className="h-5 w-5 text-emerald-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Top Customers</h1>
            </div>

            {/* Compact Action Bar */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportExcel} className="h-8 text-xs">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} className="h-8 text-xs">
                <Download className="h-3.5 w-3.5 mr-1.5" />
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

          {/* Inline Date Filters */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {format(fromDate, "dd-MM-yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={fromDate} onSelect={(d) => d && setFromDate(d)} initialFocus />
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
                    {format(toDate, "dd-MM-yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={(d) => d && setToDate(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">Top</Label>
              <select
                className="h-8 text-xs border rounded-md px-2 bg-white"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <Button size="sm" onClick={handleSubmit} disabled={loading} className="h-8 px-4 text-xs">
              Submit
            </Button>

            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Summary Cards */}
        {customerData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalRevenue.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Visits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{totalVisits}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Top Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">{customerData[0]?.customer_name}</div>
              <p className="text-sm text-slate-500">₹{customerData[0]?.total_spent.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Avg per Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {(totalRevenue / customerData.length).toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Customer Rankings</CardTitle>
        </CardHeader>
        <CardContent>
          {customerData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Total Spent</TableHead>
                    <TableHead className="text-right">Avg Invoice</TableHead>
                    <TableHead>Last Visit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerData.map((row, idx) => (
                    <TableRow key={idx} className={idx < 3 ? 'bg-slate-50' : ''}>
                      <TableCell className="text-center">{getMedalIcon(idx + 1)}</TableCell>
                      <TableCell className="font-medium">{row.customer_name}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {row.customer_phone}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.visit_count}</TableCell>
                      <TableCell className="text-right font-bold text-green-600">
                        ₹{row.total_spent.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">₹{row.avg_invoice_value.toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-slate-500">{row.last_visit_date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
