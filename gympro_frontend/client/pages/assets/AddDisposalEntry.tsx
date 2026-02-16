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
  Trash2, 
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
  "Reception Area",
  "IT Department"
];

const assets = [
  "Old Conference Table",
  "Damaged Projector", 
  "Obsolete Computer System",
  "Broken Office Chairs",
  "Faulty Air Conditioner",
  "Old Printer",
  "Damaged Monitor",
  "Outdated Scanner",
  "Worn Carpet",
  "Broken Coffee Machine"
];

const disposalReasons = [
  "End of Life",
  "Irreparable Damage",
  "Technology Upgrade",
  "Space Optimization",
  "Safety Concerns",
  "Cost of Maintenance",
  "Obsolescence"
];

const disposalMethods = [
  "Sold",
  "Scrapped",
  "Donated",
  "Recycled",
  "Returned to Vendor",
  "Destroyed"
];

interface DisposalItem {
  id: number;
  asset: string;
  originalValue: number;
  currentCondition: string;
  recoveryValue: number;
  notes: string;
}

export default function AddDisposalEntry() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    disposalDate: new Date().toISOString().split('T')[0],
    department: "",
    disposalReason: "",
    disposalMethod: "",
    requestedBy: "",
    approvedBy: "",
    notes: ""
  });

  const [disposalItems, setDisposalItems] = useState<DisposalItem[]>([
    { id: 1, asset: "", originalValue: 0, currentCondition: "", recoveryValue: 0, notes: "" }
  ]);

  const addDisposalItem = () => {
    const newId = Math.max(...disposalItems.map(item => item.id)) + 1;
    setDisposalItems([...disposalItems, { 
      id: newId, 
      asset: "", 
      originalValue: 0, 
      currentCondition: "", 
      recoveryValue: 0, 
      notes: "" 
    }]);
  };

  const removeDisposalItem = (id: number) => {
    if (disposalItems.length > 1) {
      setDisposalItems(disposalItems.filter(item => item.id !== id));
    }
  };

  const updateDisposalItem = (id: number, field: keyof DisposalItem, value: any) => {
    setDisposalItems(disposalItems.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleSubmit = () => {
    console.log("Creating disposal entry:", { formData, disposalItems });
    // Here you would typically send the data to your backend
    alert("Disposal entry created successfully!");
    navigate("/assets/disposal");
  };

  const handleReset = () => {
    setFormData({
      disposalDate: new Date().toISOString().split('T')[0],
      department: "",
      disposalReason: "",
      disposalMethod: "",
      requestedBy: "",
      approvedBy: "",
      notes: ""
    });
    setDisposalItems([{ id: 1, asset: "", originalValue: 0, currentCondition: "", recoveryValue: 0, notes: "" }]);
  };

  const totalRecoveryValue = disposalItems.reduce((sum, item) => sum + (item.recoveryValue || 0), 0);

  return (
    <div className="min-h-screen">
      <div className="max-w-9xl mx-auto p-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-white border border-gray-300 rounded-lg">
              <Trash2 className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">New Disposal Entry</h1>
              <p className="text-sm text-gray-600">Fast asset disposal creation</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate("/assets/disposal")}
            className="border-gray-300"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {/* Basic Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Department</Label>
                  <Select value={formData.department} onValueChange={(value) => setFormData({...formData, department: value})}>
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
                  <Label className="text-sm font-medium text-gray-700">Disposal Date</Label>
                  <Input
                    type="date"
                    value={formData.disposalDate}
                    onChange={(e) => setFormData({...formData, disposalDate: e.target.value})}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Disposal Reason</Label>
                  <Select value={formData.disposalReason} onValueChange={(value) => setFormData({...formData, disposalReason: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {disposalReasons.map((reason) => (
                        <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Disposal Method</Label>
                  <Select value={formData.disposalMethod} onValueChange={(value) => setFormData({...formData, disposalMethod: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select method..." />
                    </SelectTrigger>
                    <SelectContent>
                      {disposalMethods.map((method) => (
                        <SelectItem key={method} value={method}>{method}</SelectItem>
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

                <div>
                  <Label className="text-sm font-medium text-gray-700">Approved By</Label>
                  <Input
                    placeholder="Enter name..."
                    value={formData.approvedBy}
                    onChange={(e) => setFormData({...formData, approvedBy: e.target.value})}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Disposal Items */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset / Equipment</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Original Value (₹)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Condition</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Recovery Value (₹)</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={addDisposalItem}
                          className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {disposalItems.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{index + 1}</td>
                        <td className="px-4 py-3">
                          <Select 
                            value={item.asset} 
                            onValueChange={(value) => updateDisposalItem(item.id, 'asset', value)}
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
                            min="0"
                            step="0.01"
                            value={item.originalValue || ''}
                            onChange={(e) => updateDisposalItem(item.id, 'originalValue', parseFloat(e.target.value) || 0)}
                            className="border-none shadow-none p-0 text-right focus:ring-0"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Select 
                            value={item.currentCondition} 
                            onValueChange={(value) => updateDisposalItem(item.id, 'currentCondition', value)}
                          >
                            <SelectTrigger className="border-none shadow-none p-0 focus:ring-0">
                              <SelectValue placeholder="Condition..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="excellent">Excellent</SelectItem>
                              <SelectItem value="good">Good</SelectItem>
                              <SelectItem value="fair">Fair</SelectItem>
                              <SelectItem value="poor">Poor</SelectItem>
                              <SelectItem value="damaged">Damaged</SelectItem>
                              <SelectItem value="unusable">Unusable</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.recoveryValue || ''}
                            onChange={(e) => updateDisposalItem(item.id, 'recoveryValue', parseFloat(e.target.value) || 0)}
                            className="border-none shadow-none p-0 text-right focus:ring-0"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {disposalItems.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeDisposalItem(item.id)}
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

              <div className="border-t border-gray-200 px-6 py-4">
                <div className="flex justify-end">
                  <div className="text-right">
                    <div className="text-sm text-gray-600">Total Recovery: <span className="font-medium">₹{totalRecoveryValue || 0}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <Label className="text-sm font-medium text-gray-700">Notes</Label>
              <Textarea
                placeholder="Add any additional notes, disposal conditions, or special instructions..."
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                className="mt-1 min-h-[80px]"
                rows={3}
              />
            </div>

            <div className="flex justify-between items-center pt-4">
              <div className="text-lg font-semibold text-gray-900">
                Total Recovery Value: <span className="text-green-600">₹{totalRecoveryValue || 0}</span>
              </div>
              <div className="flex gap-2 text-xs text-gray-500">
                <span>Tab</span> <span>Next field</span>
                <span className="ml-4">Enter</span> <span>Next row</span>
                <span className="ml-4">Esc</span> <span>Close suggestions</span>
                <span className="ml-4">F10</span> <span>Save disposal entry</span>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-80">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Summary
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm text-gray-600">Department</Label>
                  <p className="text-sm font-medium">
                    {formData.department || "Not selected"}
                  </p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Disposal Date</Label>
                  <p className="text-sm font-medium">{formData.disposalDate}</p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Method</Label>
                  <p className="text-sm font-medium">
                    {formData.disposalMethod || "Not selected"}
                  </p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Total Assets</Label>
                  <p className="text-sm font-medium">
                    {disposalItems.filter(item => item.asset).length}
                  </p>
                </div>

                <div>
                  <Label className="text-sm text-gray-600">Requested By</Label>
                  <p className="text-sm font-medium">
                    {formData.requestedBy || "Not specified"}
                  </p>
                </div>
              </div>

              <div className="bg-blue-600 text-white px-4 py-3 rounded-lg mt-4">
                <div className="text-center">
                  <div className="text-sm font-bold">Recovery ₹{totalRecoveryValue || 0}</div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <Button 
                  onClick={handleSubmit} 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={!formData.department || !formData.disposalReason || disposalItems.some(item => !item.asset)}
                >
                  Create Disposal (F10)
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
