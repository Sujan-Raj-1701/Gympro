import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableRow 
} from "@/components/ui/table";
import { format } from "date-fns";
import { 
  BarChart3, 
  Search, 
  Filter, 
  Download, 
  ArrowLeft,
  Calendar as CalendarIcon,
  Printer,
  TrendingUp,
  Package,
  DollarSign,
  AlertTriangle
} from "lucide-react";

// Mock data for demonstration
const mockAssetData = [
  {
    id: 1,
    assetName: "Conference Table - Executive",
    category: "Furniture",
    department: "Conference Room A",
    purchaseDate: "2023-01-15",
    originalValue: 25000,
    currentValue: 22000,
    condition: "Good",
    lastMaintenance: "2024-06-15",
    status: "Active"
  },
  {
    id: 2,
    assetName: "Projector - HD 4K",
    category: "Electronics",
    department: "Training Room",
    purchaseDate: "2022-08-20",
    originalValue: 45000,
    currentValue: 35000,
    condition: "Excellent",
    lastMaintenance: "2024-07-10",
    status: "Active"
  },
  {
    id: 3,
    assetName: "Office Chairs - Set of 6",
    category: "Furniture",
    department: "Meeting Room B",
    purchaseDate: "2023-03-10",
    originalValue: 18000,
    currentValue: 15000,
    condition: "Fair",
    lastMaintenance: "2024-05-20",
    status: "Needs Maintenance"
  },
  {
    id: 4,
    assetName: "Air Conditioner - Split",
    category: "HVAC",
    department: "Admin Office",
    purchaseDate: "2021-12-05",
    originalValue: 35000,
    currentValue: 25000,
    condition: "Good",
    lastMaintenance: "2024-08-01",
    status: "Active"
  }
];

export default function Reports() {
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState<Date>(new Date(new Date().getFullYear(), 0, 1));
  const [toDate, setToDate] = useState<Date>(new Date());

  const handleExport = () => {
    console.log("Export asset reports");
    // Implement export functionality
  };

  const handlePrint = () => {
    console.log("Print asset reports");
    // Implement print functionality
  };

  const filteredAssets = mockAssetData.filter(asset =>
    asset.assetName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    asset.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    asset.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate summary metrics
  const totalAssets = mockAssetData.length;
  const totalOriginalValue = mockAssetData.reduce((sum, asset) => sum + asset.originalValue, 0);
  const totalCurrentValue = mockAssetData.reduce((sum, asset) => sum + asset.currentValue, 0);
  const maintenanceRequired = mockAssetData.filter(asset => asset.status === "Needs Maintenance").length;

  return (
    <div className="min-h-screen space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full">
          <BarChart3 className="h-6 w-6 text-gray-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Asset Reports</h1>
          <p className="text-gray-600">Comprehensive asset tracking, valuation, and maintenance reports</p>
        </div>
        <Link to="/assets">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-gray-900">{totalAssets}</div>
                <div className="text-sm text-gray-600">Total Assets</div>
              </div>
              <Package className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-gray-900">₹{totalOriginalValue.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Original Value</div>
              </div>
              <DollarSign className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-gray-900">₹{totalCurrentValue.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Current Value</div>
              </div>
              <TrendingUp className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-gray-900">{maintenanceRequired}</div>
                <div className="text-sm text-gray-600">Need Maintenance</div>
              </div>
              <AlertTriangle className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px]">
              <Label>From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={(d) => d && setFromDate(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1 min-w-[220px]">
              <Label>To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={(d) => d && setToDate(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1 min-w-[250px]">
              <Label>Search Assets</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search assets, categories, departments..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline">
                <Filter className="h-4 w-4 mr-2" />
                Filter
              </Button>

              <Button variant="outline" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>

              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Asset Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Asset Details Report</CardTitle>
          <p className="text-sm text-gray-600">Complete asset inventory with valuation and maintenance status</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Purchase Date</TableHead>
                  <TableHead>Original Value</TableHead>
                  <TableHead>Current Value</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Last Maintenance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell className="font-medium">{asset.assetName}</TableCell>
                    <TableCell>{asset.category}</TableCell>
                    <TableCell>{asset.department}</TableCell>
                    <TableCell>{asset.purchaseDate}</TableCell>
                    <TableCell>₹{asset.originalValue.toLocaleString()}</TableCell>
                    <TableCell>₹{asset.currentValue.toLocaleString()}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        asset.condition === "Excellent" 
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : asset.condition === "Good"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                      }`}>
                        {asset.condition}
                      </span>
                    </TableCell>
                    <TableCell>{asset.lastMaintenance}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        asset.status === "Active" 
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}>
                        {asset.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredAssets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                      {searchTerm ? "No assets found matching your search." : "No assets found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Asset Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { category: "Furniture", count: 2, value: 43000 },
                { category: "Electronics", count: 1, value: 45000 },
                { category: "HVAC", count: 1, value: 35000 }
              ].map((item, index) => (
                <div key={index} className="flex justify-between items-center p-3 border rounded">
                  <div>
                    <div className="font-medium">{item.category}</div>
                    <div className="text-sm text-gray-600">{item.count} assets</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">₹{item.value.toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Maintenance Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { asset: "Conference Table", due: "2024-12-15", status: "Due Soon" },
                { asset: "Projector", due: "2025-01-10", status: "Scheduled" },
                { asset: "Office Chairs", due: "2024-11-20", status: "Overdue" }
              ].map((item, index) => (
                <div key={index} className="flex justify-between items-center p-3 border rounded">
                  <div>
                    <div className="font-medium">{item.asset}</div>
                    <div className="text-sm text-gray-600">Due: {item.due}</div>
                  </div>
                  <div>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      item.status === "Overdue" 
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : item.status === "Due Soon"
                        ? "bg-yellow-50 text-yellow-700 border border-yellow-200"
                        : "bg-green-50 text-green-700 border border-green-200"
                    }`}>
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
