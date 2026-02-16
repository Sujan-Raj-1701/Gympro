import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  ArrowLeftRight, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  ArrowLeft 
} from "lucide-react";

// Mock data for demonstration
const mockTransfers = [
  {
    id: 1,
    asset: "Conference Table - Executive",
    fromDepartment: "Admin Office",
    toDepartment: "Conference Room A",
    date: "2024-08-25",
    quantity: 1,
    transferredBy: "John Manager",
    status: "Completed",
    transferId: "TRF-2024-001"
  },
  {
    id: 2,
    asset: "Projector - HD 4K",
    fromDepartment: "Conference Room A",
    toDepartment: "Training Room",
    date: "2024-08-20",
    quantity: 1,
    transferredBy: "Sarah Admin",
    status: "Pending",
    transferId: "TRF-2024-002"
  },
  {
    id: 3,
    asset: "Office Chairs - Set of 6",
    fromDepartment: "Storage Room",
    toDepartment: "Meeting Room B",
    date: "2024-08-18",
    quantity: 6,
    transferredBy: "Mike Supervisor",
    status: "Completed",
    transferId: "TRF-2024-003"
  }
];

export default function AllocationTransfer() {
  const [searchTerm, setSearchTerm] = useState("");

  const handleAddTransfer = () => {
    // Navigate to add transfer entry page
    window.location.href = '/assets/allocation-transfer/add';
  };

  const handleExport = () => {
    console.log("Export allocation/transfer data");
    // Implement export functionality
  };

  const filteredTransfers = mockTransfers.filter(transfer =>
    transfer.asset.toLowerCase().includes(searchTerm.toLowerCase()) ||
    transfer.fromDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
    transfer.toDepartment.toLowerCase().includes(searchTerm.toLowerCase())
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
                  placeholder="Search assets, departments..."
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
            
            <Button onClick={handleAddTransfer}>
              <Plus className="h-4 w-4 mr-2" />
              Add Transfer Entry
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

      {/* Transfer Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle>Transfer Entries</CardTitle>
          <p className="text-sm text-gray-600">All asset allocation and transfer records with department details</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>From Department</TableHead>
                  <TableHead>To Department</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Transferred By</TableHead>
                  <TableHead>Transfer ID</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransfers.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell className="font-medium">{transfer.asset}</TableCell>
                    <TableCell>{transfer.fromDepartment}</TableCell>
                    <TableCell>{transfer.toDepartment}</TableCell>
                    <TableCell>{transfer.date}</TableCell>
                    <TableCell>{transfer.quantity}</TableCell>
                    <TableCell>{transfer.transferredBy}</TableCell>
                    <TableCell className="font-mono text-sm">{transfer.transferId}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        transfer.status === "Completed" 
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                      }`}>
                        {transfer.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredTransfers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      {searchTerm ? "No transfers found matching your search." : "No transfer entries found."}
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
