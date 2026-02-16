import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, UserCheck, ArrowLeft, Users, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

type CustomerVisitData = {
  visit_date: string;
  new_customers: number;
  repeat_customers: number;
  total_customers: number;
  new_revenue: number;
  repeat_revenue: number;
};

type BillingTransitionsResponse = {
  success: boolean;
  data?: any[];
  count?: number;
  error?: string;
  message?: string;
};

const normBillStatus = (v: any) => String(v || '').toUpperCase();

function parseInvoiceDate(inv: any): Date | null {
  const invDate = inv?.txn_created_at || inv?.created_at || inv?.last_created_at || inv?.date;
  if (!invDate) return null;
  const d = new Date(invDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getInvoiceTotal(inv: any): number {
  const val = inv?.grand_total ?? inv?.total_amount ?? inv?.total ?? inv?.bill_amount ?? inv?.net_amount ?? 0;
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

function getCustomerKey(inv: any): string {
  const id = inv?.customer_id ?? inv?.txn_customer_id ?? inv?.billing_customer_id ?? inv?.cust_id;
  if (id != null && String(id).trim()) return `id:${String(id).trim()}`;
  const phone = inv?.customer_mobile ?? inv?.txn_customer_mobile ?? inv?.customer_phone ?? inv?.customer_number;
  if (phone != null && String(phone).trim()) return `phone:${String(phone).trim()}`;
  return 'walkin';
}

function extractBillingTransitionsRows(resp: any): any[] {
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.data?.data)) return resp.data.data;
  if (Array.isArray(resp)) return resp;
  return [];
}

const COLORS = ['#10b981', '#3b82f6'];

export default function CustomerVisit() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visitData, setVisitData] = useState<CustomerVisitData[]>([]);

  const fetchVisitData = useCallback(async () => {
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
        limit: '10000',
        include_details: 'false',
      });

      const resp = await ApiService.get<BillingTransitionsResponse>(`/billing-transitions?${params.toString()}`);
      if (resp && resp.success === false) {
        throw new Error(resp?.error || resp?.message || 'Failed to fetch billing transitions');
      }

      const invoices = extractBillingTransitionsRows(resp);

      // Track first-seen customers within the fetched window (simple + consistent)
      const seenCustomers = new Set<string>();

      const daily = new Map<
        string,
        {
          visit_date: string;
          new_customers: number;
          repeat_customers: number;
          customerSet: Set<string>;
          new_revenue: number;
          repeat_revenue: number;
        }
      >();

      const fromD = new Date(from);
      const toD = new Date(to);
      toD.setHours(23, 59, 59, 999);

      for (const inv of invoices) {
        const billStatus = normBillStatus(inv?.billstatus ?? inv?.bill_status ?? inv?.BILLSTATUS);
        if (billStatus === 'C' || billStatus === 'N') continue;
        if (billStatus && billStatus !== 'Y') continue;

        const d = parseInvoiceDate(inv);
        if (!d || d < fromD || d > toD) continue;

        const dayKey = format(d, 'yyyy-MM-dd');
        const customerKey = getCustomerKey(inv);
        const total = getInvoiceTotal(inv);

        const rawVisit = inv?.customer_visit_count ?? inv?.customer_visitcnt ?? inv?.visit_count;
        const visitCount = Number(rawVisit);
        let isNew: boolean;
        if (Number.isFinite(visitCount) && visitCount > 0) {
          isNew = visitCount === 1;
        } else {
          isNew = !seenCustomers.has(customerKey);
        }
        seenCustomers.add(customerKey);

        const row = daily.get(dayKey) || {
          visit_date: dayKey,
          new_customers: 0,
          repeat_customers: 0,
          customerSet: new Set<string>(),
          new_revenue: 0,
          repeat_revenue: 0,
        };

        row.customerSet.add(customerKey);

        if (isNew) {
          row.new_customers += 1;
          row.new_revenue += total;
        } else {
          row.repeat_customers += 1;
          row.repeat_revenue += total;
        }

        daily.set(dayKey, row);
      }

      const out: CustomerVisitData[] = Array.from(daily.values())
        .sort((a, b) => a.visit_date.localeCompare(b.visit_date))
        .map((r) => ({
          visit_date: r.visit_date,
          new_customers: r.new_customers,
          repeat_customers: r.repeat_customers,
          total_customers: r.customerSet.size,
          new_revenue: Number(r.new_revenue.toFixed(2)),
          repeat_revenue: Number(r.repeat_revenue.toFixed(2)),
        }));

      setVisitData(out);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch customer visit data');
      setVisitData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.account_code, user?.retail_code, fromDate, toDate]);

  useEffect(() => {
    fetchVisitData();
  }, [fetchVisitData]);

  const handleSubmit = () => {
    fetchVisitData();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(visitData.map(row => ({
      "Date": row.visit_date,
      "New Customers": row.new_customers,
      "Repeat Customers": row.repeat_customers,
      "Total": row.total_customers,
      "New Revenue": row.new_revenue,
      "Repeat Revenue": row.repeat_revenue,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customer Visits");
    XLSX.writeFile(wb, `Customer_Visits_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Customer Visit Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Date", "New", "Repeat", "Total", "New Revenue", "Repeat Revenue"]],
      body: visitData.map(row => [
        row.visit_date,
        row.new_customers,
        row.repeat_customers,
        row.total_customers,
        `₹${row.new_revenue.toFixed(2)}`,
        `₹${row.repeat_revenue.toFixed(2)}`,
      ]),
    });
    doc.save(`Customer_Visits_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalNew = visitData.reduce((sum, row) => sum + row.new_customers, 0);
  const totalRepeat = visitData.reduce((sum, row) => sum + row.repeat_customers, 0);
  const totalCustomers = totalNew + totalRepeat;
  const newRevenue = visitData.reduce((sum, row) => sum + row.new_revenue, 0);
  const repeatRevenue = visitData.reduce((sum, row) => sum + row.repeat_revenue, 0);

  const chartData = [
    { name: 'New Customers', value: totalNew },
    { name: 'Repeat Customers', value: totalRepeat },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <UserCheck className="h-5 w-5 text-emerald-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Customer Visit Report</h1>
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
        {visitData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                New Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{totalNew}</div>
              <p className="text-sm text-slate-500 mt-1">₹{newRevenue.toFixed(2)} revenue</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Repeat Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{totalRepeat}</div>
              <p className="text-sm text-slate-500 mt-1">₹{repeatRevenue.toFixed(2)} revenue</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Customers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{totalCustomers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Retention Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {totalCustomers > 0 ? ((totalRepeat / totalCustomers) * 100).toFixed(1) : '0'}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart and Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Customer Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <div>
                  <p className="text-sm text-slate-600">New Customer Revenue</p>
                  <p className="text-2xl font-bold text-green-600">₹{newRevenue.toFixed(2)}</p>
                </div>
                <UserPlus className="h-8 w-8 text-green-600" />
              </div>
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                <div>
                  <p className="text-sm text-slate-600">Repeat Customer Revenue</p>
                  <p className="text-2xl font-bold text-blue-600">₹{repeatRevenue.toFixed(2)}</p>
                </div>
                <Users className="h-8 w-8 text-blue-600" />
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm text-slate-600">Total Revenue</p>
                  <p className="text-2xl font-bold text-slate-900">₹{(newRevenue + repeatRevenue).toFixed(2)}</p>
                </div>
                <UserCheck className="h-8 w-8 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {visitData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Repeat</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">New Revenue</TableHead>
                    <TableHead className="text-right">Repeat Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visitData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.visit_date}</TableCell>
                      <TableCell className="text-right text-green-600">{row.new_customers}</TableCell>
                      <TableCell className="text-right text-blue-600">{row.repeat_customers}</TableCell>
                      <TableCell className="text-right font-semibold">{row.total_customers}</TableCell>
                      <TableCell className="text-right">₹{row.new_revenue.toFixed(2)}</TableCell>
                      <TableCell className="text-right">₹{row.repeat_revenue.toFixed(2)}</TableCell>
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
