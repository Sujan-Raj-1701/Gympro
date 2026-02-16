import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, FileText, ArrowLeft, IndianRupee } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type GSTSummaryData = {
  date: string;
  total_sales: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_gst: number;
  taxable_amount: number;
};

export default function GSTSummaryReport() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gstData, setGstData] = useState<GSTSummaryData[]>([]);

  const fetchGSTData = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const resp = await ApiService.get<ApiResponse<GSTSummaryData[]>>(`/reports/gst-summary?salon_id=${user.salon_id}&from_date=${from}&to_date=${to}`);
      setGstData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch GST summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGSTData();
  }, []);

  const handleSubmit = () => {
    fetchGSTData();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(gstData.map(row => ({
      "Date": row.date,
      "Total Sales": row.total_sales,
      "Taxable Amount": row.taxable_amount,
      "CGST": row.cgst,
      "SGST": row.sgst,
      "IGST": row.igst,
      "Total GST": row.total_gst,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "GST Summary");
    XLSX.writeFile(wb, `GST_Summary_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("GST Summary Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Date", "Sales", "Taxable", "CGST", "SGST", "IGST", "Total GST"]],
      body: gstData.map(row => [
        row.date,
        `₹${row.total_sales.toFixed(2)}`,
        `₹${row.taxable_amount.toFixed(2)}`,
        `₹${row.cgst.toFixed(2)}`,
        `₹${row.sgst.toFixed(2)}`,
        `₹${row.igst.toFixed(2)}`,
        `₹${row.total_gst.toFixed(2)}`,
      ]),
    });
    doc.save(`GST_Summary_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalSales = gstData.reduce((sum, row) => sum + row.total_sales, 0);
  const totalCGST = gstData.reduce((sum, row) => sum + row.cgst, 0);
  const totalSGST = gstData.reduce((sum, row) => sum + row.sgst, 0);
  const totalIGST = gstData.reduce((sum, row) => sum + row.igst, 0);
  const totalGST = gstData.reduce((sum, row) => sum + row.total_gst, 0);
  const totalTaxable = gstData.reduce((sum, row) => sum + row.taxable_amount, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">GST Summary</h1>
            <p className="text-sm text-slate-500">GST and tax calculation summary</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleExportExcel} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      {/* Date Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium mb-2">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(fromDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={fromDate} onSelect={(date) => date && setFromDate(date)} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium mb-2">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(toDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={toDate} onSelect={(date) => date && setToDate(date)} />
                </PopoverContent>
              </Popover>
            </div>
            <Button onClick={handleSubmit} className="min-w-[120px]">
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {gstData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Sales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalSales.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Taxable Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalTaxable.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total GST</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalGST.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">GST %</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {totalSales > 0 ? ((totalGST / totalSales) * 100).toFixed(2) : '0'}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* GST Breakdown */}
      {gstData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">CGST</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalCGST.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">SGST</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalSGST.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">IGST</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalIGST.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily GST Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">{error}</div>
          ) : gstData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                    <TableHead className="text-right">Total GST</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gstData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.date}</TableCell>
                      <TableCell className="text-right">₹{row.total_sales.toFixed(2)}</TableCell>
                      <TableCell className="text-right">₹{row.taxable_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-green-600">₹{row.cgst.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-purple-600">₹{row.sgst.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-orange-600">₹{row.igst.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-bold text-blue-600">₹{row.total_gst.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">₹{totalSales.toFixed(2)}</TableCell>
                    <TableCell className="text-right">₹{totalTaxable.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-green-600">₹{totalCGST.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-purple-600">₹{totalSGST.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-orange-600">₹{totalIGST.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-blue-600">₹{totalGST.toFixed(2)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
