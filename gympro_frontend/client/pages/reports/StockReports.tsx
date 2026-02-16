import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { format } from "date-fns";
import {
  Download,
  Calendar as CalendarIcon,
  Package,
  Printer,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";

const stockReportData = [
  {
    product: "Laptop Pro 15",
    openingStock: 30,
    purchaseIn: 15,
    saleOut: 20,
    closingStock: 25,
    value: 2250000,
    minStock: 20,
    maxStock: 50,
  },
  {
    product: "Office Chair",
    openingStock: 25,
    purchaseIn: 10,
    saleOut: 18,
    closingStock: 17,
    value: 212500,
    minStock: 15,
    maxStock: 30,
  },
  {
    product: "Desk Lamp",
    openingStock: 50,
    purchaseIn: 25,
    saleOut: 40,
    closingStock: 35,
    value: 87500,
    minStock: 30,
    maxStock: 100,
  },
  {
    product: "USB Cable",
    openingStock: 100,
    purchaseIn: 50,
    saleOut: 75,
    closingStock: 75,
    value: 67500,
    minStock: 50,
    maxStock: 200,
  },
  {
    product: "Wireless Mouse",
    openingStock: 40,
    purchaseIn: 20,
    saleOut: 35,
    closingStock: 25,
    value: 45000,
    minStock: 20,
    maxStock: 80,
  },
];

export default function StockReports() {
  const [date, setDate] = useState<Date>();
  const [reportPeriod, setReportPeriod] = useState("monthly");

  const handleExportReport = (format: string) => {
    console.log(`Exporting stock report as ${format}`);
    alert(`Stock report exported as ${format.toUpperCase()}`);
  };

  const handlePrintReport = () => {
    console.log(`Printing stock report`);
    alert(`Stock report sent to printer`);
  };

  // Calculate totals and stats
  const totals = stockReportData.reduce(
    (acc, row) => ({
      openingStock: acc.openingStock + row.openingStock,
      purchaseIn: acc.purchaseIn + row.purchaseIn,
      saleOut: acc.saleOut + row.saleOut,
      closingStock: acc.closingStock + row.closingStock,
      value: acc.value + row.value,
    }),
    { openingStock: 0, purchaseIn: 0, saleOut: 0, closingStock: 0, value: 0 }
  );

  const lowStockItems = stockReportData.filter(item => item.closingStock <= item.minStock);
  const overStockItems = stockReportData.filter(item => item.closingStock >= item.maxStock);

  return (
  <div className="min-h-screen space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between"> 
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Reports</h1>
          <p className="text-muted-foreground">
            Analyze inventory levels and stock movement
          </p>
        </div>
        <Link to="/reports">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Reports
          </Button>
        </Link>
  </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="period">Period</Label>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <Label>Date Range</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex gap-2">
              <Select
                defaultValue="pdf"
                onValueChange={(value) => handleExportReport(value)}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Export" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">Export PDF</SelectItem>
                  <SelectItem value="excel">Export Excel</SelectItem>
                  <SelectItem value="csv">Export CSV</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" onClick={handlePrintReport}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Stock Value</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totals.value.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Current inventory worth
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{lowStockItems.length}</div>
            <p className="text-xs text-muted-foreground">
              Items below minimum level
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Movement</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.saleOut}</div>
            <p className="text-xs text-muted-foreground">
              Items sold this period
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stock Movement Report */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Stock Movement Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Opening Stock</TableHead>
                  <TableHead>Purchase In</TableHead>
                  <TableHead>Sale Out</TableHead>
                  <TableHead>Closing Stock</TableHead>
                  <TableHead>Stock Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockReportData.map((row, index) => {
                  const isLowStock = row.closingStock <= row.minStock;
                  const isOverStock = row.closingStock >= row.maxStock;
                  
                  return (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{row.product}</TableCell>
                      <TableCell>{row.openingStock}</TableCell>
                      <TableCell className="text-green-600">+{row.purchaseIn}</TableCell>
                      <TableCell className="text-red-600">-{row.saleOut}</TableCell>
                      <TableCell className="font-medium">{row.closingStock}</TableCell>
                      <TableCell>₹{row.value.toLocaleString()}</TableCell>
                      <TableCell>
                        {isLowStock && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Low Stock
                          </span>
                        )}
                        {isOverStock && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            Over Stock
                          </span>
                        )}
                        {!isLowStock && !isOverStock && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Normal
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals Row */}
                <TableRow className="bg-gray-50 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell>{totals.openingStock}</TableCell>
                  <TableCell className="text-green-600">+{totals.purchaseIn}</TableCell>
                  <TableCell className="text-red-600">-{totals.saleOut}</TableCell>
                  <TableCell>{totals.closingStock}</TableCell>
                  <TableCell>₹{totals.value.toLocaleString()}</TableCell>
                  <TableCell>-</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
