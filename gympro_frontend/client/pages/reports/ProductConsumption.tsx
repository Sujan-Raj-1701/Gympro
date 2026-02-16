import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, PackageMinus, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ProductConsumptionData = {
  product_id: number;
  product_name: string;
  category: string;
  quantity_consumed: number;
  unit: string;
  consumption_value: number;
  times_used: number;
};

export default function ProductConsumption() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consumptionData, setConsumptionData] = useState<ProductConsumptionData[]>([]);

  const fetchConsumptionData = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const resp = await ApiService.get<ApiResponse<ProductConsumptionData[]>>(`/reports/product-consumption?salon_id=${user.salon_id}&from_date=${from}&to_date=${to}`);
      setConsumptionData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch product consumption data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConsumptionData();
  }, []);

  const handleSubmit = () => {
    fetchConsumptionData();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(consumptionData.map(row => ({
      "Product": row.product_name,
      "Category": row.category,
      "Quantity Consumed": row.quantity_consumed,
      "Unit": row.unit,
      "Times Used": row.times_used,
      "Value": row.consumption_value,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Product Consumption");
    XLSX.writeFile(wb, `Product_Consumption_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Product Consumption Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Product", "Category", "Consumed", "Unit", "Times Used", "Value"]],
      body: consumptionData.map(row => [
        row.product_name,
        row.category,
        row.quantity_consumed,
        row.unit,
        row.times_used,
        `₹${row.consumption_value.toFixed(2)}`,
      ]),
    });
    doc.save(`Product_Consumption_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalValue = consumptionData.reduce((sum, row) => sum + row.consumption_value, 0);
  const totalQuantity = consumptionData.reduce((sum, row) => sum + row.quantity_consumed, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <PackageMinus className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Product Consumption</h1>
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
        {consumptionData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Products</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{consumptionData.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Consumption Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">₹{totalValue.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Most Used Product</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">
                {consumptionData.length > 0 
                  ? consumptionData.reduce((max, row) => row.times_used > max.times_used ? row : max, consumptionData[0]).product_name
                  : 'N/A'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Consumption Details</CardTitle>
        </CardHeader>
        <CardContent>
          {consumptionData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Quantity Consumed</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Times Used</TableHead>
                    <TableHead className="text-right">Consumption Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.product_name}</TableCell>
                      <TableCell>{row.category}</TableCell>
                      <TableCell className="text-right font-semibold">{row.quantity_consumed}</TableCell>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell className="text-right">{row.times_used}</TableCell>
                      <TableCell className="text-right">₹{row.consumption_value.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell colSpan={5}>Total</TableCell>
                    <TableCell className="text-right">₹{totalValue.toFixed(2)}</TableCell>
                  </TableRow>
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
