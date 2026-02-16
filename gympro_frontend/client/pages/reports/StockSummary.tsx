import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Download, Boxes, ArrowLeft, AlertTriangle, Package } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Badge } from "@/components/ui/badge";

type StockSummaryData = {
  product_id: number;
  product_name: string;
  category: string;
  current_stock: number;
  min_stock_level: number;
  unit: string;
  last_purchase_date: string;
  last_purchase_qty: number;
  stock_value: number;
};

export default function StockSummary() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockData, setStockData] = useState<StockSummaryData[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    fetchStockSummary();
  }, []);

  const fetchStockSummary = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await ApiService.get<ApiResponse<StockSummaryData[]>>(`/reports/stock-summary?salon_id=${user.salon_id}`);
      setStockData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch stock summary");
    } finally {
      setLoading(false);
    }
  };

  const getStockStatus = (current: number, min: number) => {
    if (current === 0) return { label: "Out of Stock", color: "bg-red-100 text-red-700" };
    if (current <= min) return { label: "Low Stock", color: "bg-orange-100 text-orange-700" };
    return { label: "In Stock", color: "bg-green-100 text-green-700" };
  };

  const filteredData = stockData.filter(row => {
    if (filterStatus === "all") return true;
    const status = getStockStatus(row.current_stock, row.min_stock_level);
    if (filterStatus === "out") return status.label === "Out of Stock";
    if (filterStatus === "low") return status.label === "Low Stock";
    if (filterStatus === "in") return status.label === "In Stock";
    return true;
  });

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredData.map(row => ({
      "Product": row.product_name,
      "Category": row.category,
      "Current Stock": row.current_stock,
      "Min Level": row.min_stock_level,
      "Unit": row.unit,
      "Stock Value": row.stock_value,
      "Last Purchase": row.last_purchase_date,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Summary");
    XLSX.writeFile(wb, `Stock_Summary_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Stock Summary Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Product", "Category", "Stock", "Min", "Unit", "Value"]],
      body: filteredData.map(row => [
        row.product_name,
        row.category,
        row.current_stock,
        row.min_stock_level,
        row.unit,
        `₹${row.stock_value.toFixed(2)}`,
      ]),
    });
    doc.save(`Stock_Summary_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const totalValue = filteredData.reduce((sum, row) => sum + row.stock_value, 0);
  const outOfStockCount = stockData.filter(row => row.current_stock === 0).length;
  const lowStockCount = stockData.filter(row => row.current_stock > 0 && row.current_stock <= row.min_stock_level).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-50">
                <Boxes className="h-5 w-5 text-cyan-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Stock Summary</h1>
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

          {/* Inline Filter */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">Filter</Label>
              <select
                className="h-8 text-xs border rounded-md px-2 bg-white"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Products</option>
                <option value="out">Out of Stock</option>
                <option value="low">Low Stock</option>
                <option value="in">In Stock</option>
              </select>
            </div>

            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Summary Cards */}
        {stockData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Products</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{stockData.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Out of Stock</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{outOfStockCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Low Stock</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{lowStockCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">₹{totalValue.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Stock Details</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Current Stock</TableHead>
                    <TableHead className="text-right">Min Level</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Stock Value</TableHead>
                    <TableHead>Last Purchase</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((row, idx) => {
                    const status = getStockStatus(row.current_stock, row.min_stock_level);
                    return (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{row.product_name}</TableCell>
                        <TableCell>{row.category}</TableCell>
                        <TableCell className="text-right font-semibold">{row.current_stock}</TableCell>
                        <TableCell className="text-right text-slate-500">{row.min_stock_level}</TableCell>
                        <TableCell>{row.unit}</TableCell>
                        <TableCell>
                          <Badge className={status.color}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">₹{row.stock_value.toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {row.last_purchase_date || 'N/A'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerts */}
      {(outOfStockCount > 0 || lowStockCount > 0) && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-orange-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {outOfStockCount > 0 && (
                <p className="text-sm text-orange-800">
                  <strong>{outOfStockCount}</strong> product(s) are out of stock and need immediate attention.
                </p>
              )}
              {lowStockCount > 0 && (
                <p className="text-sm text-orange-800">
                  <strong>{lowStockCount}</strong> product(s) are running low and should be reordered soon.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
