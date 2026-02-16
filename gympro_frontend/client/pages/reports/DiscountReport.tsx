import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, Percent, ArrowLeft, IndianRupee, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type DiscountReportData = {
  discount_type: string;
  discount_count: number;
  total_discount_amount: number;
  revenue_impact: number;
  avg_discount_percent: number;
};

export default function DiscountReport() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discountData, setDiscountData] = useState<DiscountReportData[]>([]);

  const fetchDiscountData = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const resp = await ApiService.get<ApiResponse<DiscountReportData[]>>(`/reports/discounts?salon_id=${user.salon_id}&from_date=${from}&to_date=${to}`);
      setDiscountData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch discount data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiscountData();
  }, []);

  const handleSubmit = () => {
    fetchDiscountData();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(discountData.map(row => ({
      "Discount Type": row.discount_type,
      "Count": row.discount_count,
      "Total Amount": row.total_discount_amount,
      "Revenue Impact": row.revenue_impact,
      "Avg %": row.avg_discount_percent,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Discounts");
    XLSX.writeFile(wb, `Discount_Report_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Discount & Offer Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Type", "Count", "Amount", "Revenue Impact", "Avg %"]],
      body: discountData.map(row => [
        row.discount_type,
        row.discount_count,
        `₹${row.total_discount_amount.toFixed(2)}`,
        `₹${row.revenue_impact.toFixed(2)}`,
        `${row.avg_discount_percent.toFixed(1)}%`,
      ]),
    });
    doc.save(`Discount_Report_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalDiscountAmount = discountData.reduce((sum, row) => sum + row.total_discount_amount, 0);
  const totalRevenueImpact = discountData.reduce((sum, row) => sum + row.revenue_impact, 0);
  const totalCount = discountData.reduce((sum, row) => sum + row.discount_count, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-50">
                <Percent className="h-5 w-5 text-orange-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Discount Report</h1>
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
        {discountData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Discounts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Discount Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalDiscountAmount.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Revenue Impact</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalRevenueImpact.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Avg Discount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {totalCount > 0 
                  ? (discountData.reduce((sum, row) => sum + row.avg_discount_percent, 0) / discountData.length).toFixed(1)
                  : '0'}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Discount Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {discountData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No discount data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Discount Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Revenue Impact</TableHead>
                    <TableHead className="text-right">Avg %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discountData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <Tag className="h-4 w-4 text-orange-600" />
                        {row.discount_type}
                      </TableCell>
                      <TableCell className="text-right">{row.discount_count}</TableCell>
                      <TableCell className="text-right text-orange-600 font-semibold">
                        ₹{row.total_discount_amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">₹{row.revenue_impact.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{row.avg_discount_percent.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{totalCount}</TableCell>
                    <TableCell className="text-right text-orange-600">₹{totalDiscountAmount.toFixed(2)}</TableCell>
                    <TableCell className="text-right">₹{totalRevenueImpact.toFixed(2)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights */}
      {discountData.length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-800">Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-blue-800">
              <p>
                • Total discount given: <strong>₹{totalDiscountAmount.toFixed(2)}</strong>
              </p>
              <p>
                • Revenue generated after discounts: <strong>₹{totalRevenueImpact.toFixed(2)}</strong>
              </p>
              <p>
                • {totalCount} transactions received discounts during this period
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
