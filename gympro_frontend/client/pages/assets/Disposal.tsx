import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Trash2, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  ArrowLeft 
} from "lucide-react";

// Mock data for demonstration
const mockDisposals = [
  {
    id: 1,
    asset: "Old Conference Table",
    department: "Admin Office",
    date: "2024-08-20",
    reason: "End of Life",
    disposalMethod: "Sold",
    approvedBy: "John Manager",
    status: "Completed",
    disposalId: "DSP-2024-001",
    value: "₹5,000"
  },
  {
    id: 2,
    asset: "Damaged Projector",
    department: "Conference Room A",
    date: "2024-08-15",
    reason: "Irreparable Damage",
    disposalMethod: "Scrapped",
    approvedBy: "Sarah Admin",
    status: "Pending",
    disposalId: "DSP-2024-002",
    value: "₹0"
  },
  {
    id: 3,
    asset: "Obsolete Computer System",
    department: "IT Department",
    date: "2024-08-10",
    reason: "Technology Upgrade",
    disposalMethod: "Donated",
    approvedBy: "Mike Supervisor",
    status: "Completed",
    disposalId: "DSP-2024-003",
    value: "₹0"
  }
];

export default function Disposal() {
  const [searchTerm, setSearchTerm] = useState("");

  const handleAddDisposal = () => {
    // Navigate to add disposal entry page
    window.location.href = '/assets/disposal/add';
  };

  const handleExport = () => {
    console.log("Export disposal data");
    // Implement export functionality
  };

  const filteredDisposals = mockDisposals.filter(disposal =>
    disposal.asset.toLowerCase().includes(searchTerm.toLowerCase()) ||
    disposal.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
    disposal.reason.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search assets, departments, reasons..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Button variant="outline">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
            
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            
            <Button onClick={handleAddDisposal}>
              <Plus className="h-4 w-4 mr-2" />
              Add Disposal Entry
            </Button>
              <Link to="/assets">
                  <Button variant="outline" size="sm">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Disposal Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle>Disposal Entries</CardTitle>
          <p className="text-sm text-gray-600">All asset disposal records with approval status and recovery details</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Recovery Value</TableHead>
                  <TableHead>Approved By</TableHead>
                  <TableHead>Disposal ID</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDisposals.map((disposal) => (
                  <TableRow key={disposal.id}>
                    <TableCell className="font-medium">{disposal.asset}</TableCell>
                    <TableCell>{disposal.department}</TableCell>
                    <TableCell>{disposal.date}</TableCell>
                    <TableCell>{disposal.reason}</TableCell>
                    <TableCell>{disposal.disposalMethod}</TableCell>
                    <TableCell>{disposal.value}</TableCell>
                    <TableCell>{disposal.approvedBy}</TableCell>
                    <TableCell className="font-mono text-sm">{disposal.disposalId}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        disposal.status === "Completed" 
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                      }`}>
                        {disposal.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredDisposals.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                      {searchTerm ? "No disposals found matching your search." : "No disposal entries found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
