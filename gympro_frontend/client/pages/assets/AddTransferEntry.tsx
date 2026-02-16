import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
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
  ArrowLeft, 
  Plus, 
  Check,
  X
} from "lucide-react";

// Mock data for dropdowns
const departments = [
  "Admin Office",
  "Conference Room A", 
  "Conference Room B",
  "Training Room",
  "Storage Room",
  "Meeting Room A",
  "Meeting Room B",
  "Reception Area"
];

const assets = [
  "Conference Table - Executive",
  "Projector - HD 4K", 
  "Office Chairs - Set of 6",
  "Whiteboard - Large",
  "Laptop - Dell Inspiron",
  "Monitor - 24 inch",
  "Printer - LaserJet Pro",
  "Scanner - Document",
  "Air Conditioner - Split",
  "Coffee Machine"
];

const transferReasons = [
  "Department Relocation",
  "Equipment Upgrade",
  "Maintenance Requirement",
  "Space Optimization",
  "Temporary Assignment",
  "Permanent Reallocation"
];

interface TransferItem {
  id: number;
  asset: string;
  quantity: number;
  condition: string;
  notes: string;
}

export default function AddTransferEntry() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    transferDate: new Date().toISOString().split('T')[0],
    fromDepartment: "",
    toDepartment: "",
    transferReason: "",
    requestedBy: "",
    approvedBy: "",
    notes: ""
  });

  const [transferItems, setTransferItems] = useState<TransferItem[]>([
    { id: 1, asset: "", quantity: 1, condition: "", notes: "" }
  ]);

  const addTransferItem = () => {
    const newId = Math.max(...transferItems.map(item => item.id)) + 1;
    setTransferItems([...transferItems, { 
      id: newId, 
      asset: "", 
      quantity: 1, 
      condition: "", 
      notes: "" 
    }]);
  };

  const removeTransferItem = (id: number) => {
    if (transferItems.length > 1) {
      setTransferItems(transferItems.filter(item => item.id !== id));
    }
  };

  const updateTransferItem = (id: number, field: keyof TransferItem, value: any) => {
    setTransferItems(transferItems.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleSubmit = () => {
    console.log("Creating transfer entry:", { formData, transferItems });
    // Here you would typically send the data to your backend
    alert("Transfer entry created successfully!");
    navigate("/assets/allocation-transfer");
  };

  const handleReset = () => {
    setFormData({
      transferDate: new Date().toISOString().split('T')[0],
      fromDepartment: "",
      toDepartment: "",
      transferReason: "",
      requestedBy: "",
      approvedBy: "",
      notes: ""
    });
    setTransferItems([{ id: 1, asset: "", quantity: 1, condition: "", notes: "" }]);
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-9xl mx-auto p-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-white border border-gray-300 rounded-lg">
              <ArrowLeftRight className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">New Transfer Entry</h1>
              <p className="text-sm text-gray-600">Fast asset transfer creation</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate("/assets/allocation-transfer")}
            className="border-gray-300"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="flex gap-6">
          {/* Main Form */}
          <div className="flex-1 space-y-6">
            {/* Basic Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div>
                  <Label className="text-sm font-medium text-gray-700">From Department</Label>
                  <Select value={formData.fromDepartment} onValueChange={(value) => setFormData({...formData, fromDepartment: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select department..." />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Transfer Date</Label>
                  <Input
                    type="date"
                    value={formData.transferDate}
                    onChange={(e) => setFormData({...formData, transferDate: e.target.value})}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">To Department</Label>
                  <Select value={formData.toDepartment} onValueChange={(value) => setFormData({...formData, toDepartment: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select department..." />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Transfer Reason</Label>
                  <Select value={formData.transferReason} onValueChange={(value) => setFormData({...formData, transferReason: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {transferReasons.map((reason) => (
                        <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Requested By</Label>
                  <Input
                    placeholder="Enter name..."
                    value={formData.requestedBy}
                    onChange={(e) => setFormData({...formData, requestedBy: e.target.value})}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Transfer Items */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Assets to Transfer</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addTransferItem}
                    className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset / Equipment</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Qty</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Condition</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {transferItems.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{index + 1}</td>
                        <td className="px-4 py-3">
                          <Select 
                            value={item.asset} 
                            onValueChange={(value) => updateTransferItem(item.id, 'asset', value)}
                          >
                            <SelectTrigger className="border-none shadow-none p-0 focus:ring-0">
                              <SelectValue placeholder="Select asset..." />
                            </SelectTrigger>
                            <SelectContent>
                              {assets.map((asset) => (
                                <SelectItem key={asset} value={asset}>{asset}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateTransferItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                            className="border-none shadow-none p-0 text-center focus:ring-0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Select 
                            value={item.condition} 
                            onValueChange={(value) => updateTransferItem(item.id, 'condition', value)}
                          >
                            <SelectTrigger className="border-none shadow-none p-0 focus:ring-0">
                              <SelectValue placeholder="Condition..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="excellent">Excellent</SelectItem>
                              <SelectItem value="good">Good</SelectItem>
                              <SelectItem value="fair">Fair</SelectItem>
                              <SelectItem value="needs-repair">Needs Repair</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            placeholder="Add notes..."
                            value={item.notes}
                            onChange={(e) => updateTransferItem(item.id, 'notes', e.target.value)}
                            className="border-none shadow-none p-0 focus:ring-0"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {transferItems.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTransferItem(item.id)}
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Additional Notes */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <Label className="text-sm font-medium text-gray-700">Additional Notes</Label>
              <Textarea
                placeholder="Add any additional notes or special instructions..."
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                className="mt-1 min-h-[80px]"
                rows={3}
              />
            </div>
          </div>

          {/* Summary Sidebar */}
          <div className="w-80">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Summary
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm text-gray-600">From Department</Label>
                  <p className="text-sm font-medium">
                    {formData.fromDepartment || "Not selected"}
                  </p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">To Department</Label>
                  <p className="text-sm font-medium">
                    {formData.toDepartment || "Not selected"}
                  </p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Transfer Date</Label>
                  <p className="text-sm font-medium">{formData.transferDate}</p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Total Assets</Label>
                  <p className="text-sm font-medium">
                    {transferItems.reduce((sum, item) => sum + item.quantity, 0)}
                  </p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Requested By</Label>
                  <p className="text-sm font-medium">
                    {formData.requestedBy || "Not specified"}
                  </p>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <Button 
                  onClick={handleSubmit} 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={!formData.fromDepartment || !formData.toDepartment || transferItems.some(item => !item.asset)}
                >
                  Create Transfer (F10)
                </Button>

                <Button 
                  onClick={handleReset} 
                  variant="outline" 
                  className="w-full border-gray-300"
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
