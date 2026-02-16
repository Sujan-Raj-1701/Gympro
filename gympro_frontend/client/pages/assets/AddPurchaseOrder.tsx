import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
  ShoppingCart, 
  ArrowLeft, 
  Plus,
  X
} from "lucide-react";

// Mock data for dropdowns
const suppliers = [
  "Office Equipment Ltd",
  "Furniture World", 
  "Tech Solutions Inc",
  "Catering Supplies Co",
  "Cleaning Services Pro",
  "Security Systems Ltd",
  "Audio Visual Tech",
  "Kitchen Equipment Co"
];

const categories = [
  "Furniture",
  "Electronics",
  "Office Supplies",
  "Kitchen Equipment",
  "Cleaning Supplies",
  "Security Equipment",
  "Audio Visual",
  "Software",
  "Maintenance",
  "Others"
];

const units = [
  "Piece",
  "Set",
  "Box",
  "Kg",
  "Liter",
  "Meter",
  "Square Meter",
  "Hour",
  "Day",
  "Month"
];

interface PurchaseItem {
  id: number;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export default function AddPurchaseOrder() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    orderDate: new Date().toISOString().split('T')[0],
    expectedDelivery: "",
    supplier: "",
    department: "",
    requestedBy: "",
    priority: "",
    notes: ""
  });

  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    { id: 1, description: "", category: "", quantity: 1, unit: "", unitPrice: 0, total: 0 }
  ]);

  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState("%");

  const addPurchaseItem = () => {
    const newId = Math.max(...purchaseItems.map(item => item.id)) + 1;
    setPurchaseItems([...purchaseItems, { 
      id: newId, 
      description: "", 
      category: "", 
      quantity: 1, 
      unit: "", 
      unitPrice: 0, 
      total: 0
    }]);
  };

  const removePurchaseItem = (id: number) => {
    if (purchaseItems.length > 1) {
      setPurchaseItems(purchaseItems.filter(item => item.id !== id));
    }
  };

  const updatePurchaseItem = (id: number, field: keyof PurchaseItem, value: any) => {
    setPurchaseItems(purchaseItems.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          updatedItem.total = updatedItem.quantity * updatedItem.unitPrice;
        }
        return updatedItem;
      }
      return item;
    }));
  };

  const handleSubmit = () => {
    console.log("Creating purchase order:", { formData, purchaseItems });
    alert("Purchase order created successfully!");
    navigate("/assets/purchase-order");
  };

  const handleReset = () => {
    setFormData({
      orderDate: new Date().toISOString().split('T')[0],
      expectedDelivery: "",
      supplier: "",
      department: "",
      requestedBy: "",
      priority: "",
      notes: ""
    });
    setPurchaseItems([{ id: 1, description: "", category: "", quantity: 1, unit: "", unitPrice: 0, total: 0 }]);
    setDiscount(0);
  };

  const subtotal = purchaseItems.reduce((sum, item) => sum + (item.total || 0), 0);
  const discountAmount = discountType === "%" ? (subtotal * discount / 100) : discount;
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * 0.18; // 18% GST
  const grandTotal = taxableAmount + tax;

  return (
    <div className="min-h-screen">
      <div className="max-w-9xl mx-auto p-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-white border border-gray-300 rounded-lg">
              <ShoppingCart className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">New Purchase Order</h1>
              <p className="text-sm text-gray-600">Fast purchase order creation</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate("/assets/purchase-order")}
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
                  <Label className="text-sm font-medium text-gray-700">Supplier</Label>
                  <Select value={formData.supplier} onValueChange={(value) => setFormData({...formData, supplier: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Type supplier name or phone..." />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Date</Label>
                  <Input
                    type="date"
                    value={formData.orderDate}
                    onChange={(e) => setFormData({...formData, orderDate: e.target.value})}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Payment</Label>
                  <Select value={formData.priority} onValueChange={(value) => setFormData({...formData, priority: value})}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                                <div>
                  <Label className="text-sm font-medium text-gray-700">Expected Delivery</Label>
                  <Input
                    type="date"
                    value={formData.expectedDelivery}
                    onChange={(e) => setFormData({...formData, expectedDelivery: e.target.value})}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Department</Label>
                  <Input
                    placeholder="Enter department..."
                    value={formData.department}
                    onChange={(e) => setFormData({...formData, department: e.target.value})}
                    className="mt-1"
                  />
                </div>

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

            {/* Items Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Service / Product</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Price (₹)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Qty</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Total (₹)</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={addPurchaseItem}
                          className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {purchaseItems.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{index + 1}</td>
                        <td className="px-4 py-3">
                          <Input
                            placeholder="Type service name..."
                            value={item.description}
                            onChange={(e) => updatePurchaseItem(item.id, 'description', e.target.value)}
                            className="border-none shadow-none p-0 focus:ring-0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice || ''}
                            onChange={(e) => updatePurchaseItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="border-none shadow-none p-0 text-right focus:ring-0"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updatePurchaseItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                            className="border-none shadow-none p-0 text-center focus:ring-0"
                          />
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                          ₹{item.total || 0}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {purchaseItems.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removePurchaseItem(item.id)}
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
                    <div className="text-sm text-gray-600">Subtotal: <span className="font-medium">₹{subtotal || 0}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <Label className="text-sm font-medium text-gray-700">Notes</Label>
              <Textarea
                placeholder="Add notes..."
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                className="mt-1 min-h-[80px]"
                rows={3}
              />
            </div>

            <div className="flex justify-between items-center pt-4">
              <div className="text-lg font-semibold text-gray-900">
                Total to Collect: <span className="text-green-600">₹{grandTotal || 0}</span>
              </div>
              <div className="flex gap-2 text-xs text-gray-500">
                <span>Tab</span> <span>Next field</span>
                <span className="ml-4">Enter</span> <span>Next row</span>
                <span className="ml-4">Esc</span> <span>Close suggestions</span>
                <span className="ml-4">F10</span> <span>Save purchase order</span>
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
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">% Discount</span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={discount}
                        onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                        className="w-16 h-8 text-sm text-right"
                      />
                      <Select value={discountType} onValueChange={setDiscountType}>
                        <SelectTrigger className="w-14 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="%">%</SelectItem>
                          <SelectItem value="₹">₹</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Tax (%)</span>
                    <div className="bg-gray-50 px-3 py-1 rounded text-sm">18</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal:</span>
                    <span>₹{subtotal || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Tax (18%):</span>
                    <span>₹{Math.round(tax) || 0}</span>
                  </div>
                </div>

                <div className="bg-blue-600 text-white px-4 py-3 rounded-lg">
                  <div className="text-center">
                    <div className="text-sm font-bold">Total ₹{Math.round(grandTotal) || 0}</div>

                  </div>
                </div>

                <Button 
                  onClick={handleSubmit}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={!formData.supplier || purchaseItems.some(item => !item.description)}
                >
                   Create Purchase Order (F10)
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
