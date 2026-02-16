import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  ShoppingCart, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  ArrowLeft 
} from "lucide-react";

// Mock data for demonstration
const mockPurchaseOrders = [
  {
    id: 1,
    orderNumber: "PO-2024-001",
    supplier: "Office Equipment Ltd",
    orderDate: "2024-08-25",
    deliveryDate: "2024-09-05",
    items: 5,
    totalAmount: 45000,
    status: "Pending",
    requestedBy: "John Manager"
  },
  {
    id: 2,
    orderNumber: "PO-2024-002",
    supplier: "Furniture World",
    orderDate: "2024-08-20",
    deliveryDate: "2024-08-30",
    items: 3,
    totalAmount: 25000,
    status: "Delivered",
    requestedBy: "Sarah Admin"
  },
  {
    id: 3,
    orderNumber: "PO-2024-003",
    supplier: "Tech Solutions Inc",
    orderDate: "2024-08-18",
    deliveryDate: "2024-09-01",
    items: 8,
    totalAmount: 85000,
    status: "Approved",
    requestedBy: "Mike Supervisor"
  }
];

export default function PurchaseOrder() {
  const [searchTerm, setSearchTerm] = useState("");
  const navigate = useNavigate();

  const handleAddPurchaseOrder = () => {
    // Navigate to add purchase order page
    navigate('/assets/purchase-order/add');
  };

  const handleExport = () => {
    console.log("Export purchase order data");
    // Implement export functionality
  };

  const filteredOrders = mockPurchaseOrders.filter(order =>
    order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.supplier.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.requestedBy.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen  space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search orders, suppliers, items..."
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
            
            <Button onClick={handleAddPurchaseOrder}>
              <Plus className="h-4 w-4 mr-2" />
              Add Purchase Order
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

      {/* Purchase Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
          <p className="text-sm text-gray-600">All purchase orders with supplier details and delivery status</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Delivery Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.orderNumber}</TableCell>
                    <TableCell>{order.supplier}</TableCell>
                    <TableCell>{order.orderDate}</TableCell>
                    <TableCell>{order.deliveryDate}</TableCell>
                    <TableCell>{order.items}</TableCell>
                    <TableCell>₹{order.totalAmount.toLocaleString()}</TableCell>
                    <TableCell>{order.requestedBy}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        order.status === "Delivered" 
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : order.status === "Approved"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                      }`}>
                        {order.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      {searchTerm ? "No purchase orders found matching your search." : "No purchase orders found."}
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
