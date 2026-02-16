import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Construction,
  MessageCircle,
  ArrowRight,
  Clock,
  CheckCircle2,
} from "lucide-react";

const moduleInfo: Record<
  string,
  { title: string; description: string; features: string[] }
> = {
  "/masters/categories": {
    title: "Category Master",
    description:
      "Organize products into categories for better inventory management",
    features: [
      "Create and manage product categories",
      "Hierarchical category structure",
      "Category-wise reporting",
      "Bulk category operations",
    ],
  },
  "/masters/suppliers": {
    title: "Supplier Master",
    description: "Manage supplier information and contact details",
    features: [
      "Supplier contact management",
      "Tax information tracking",
      "Purchase history",
      "Payment terms setup",
    ],
  },
  "/masters/bank": {
    title: "Bank Master",
    description: "Manage bank accounts and financial details",
    features: [
      "Account details",
      "Balance tracking",
      "Transaction history",
      "Reconciliation",
    ],
  },
  "/stock/purchase-in": {
    title: "Purchase In",
    description: "Record incoming stock and purchases",
    features: [
      "Supplier invoice entry",
      "Stock quantity updates",
      "Cost price management",
      "Purchase analytics",
    ],
  },
  "/stock/purchase-return": {
    title: "Purchase Return",
    description: "Handle returns to suppliers",
    features: [
      "Return documentation",
      "Stock adjustment",
      "Refund tracking",
      "Return analytics",
    ],
  },
  "/stock/transfer": {
    title: "Stock Transfer",
    description: "Transfer inventory between locations",
    features: [
      "Inter-branch transfers",
      "Warehouse management",
      "Transfer documentation",
      "Transit tracking",
    ],
  },
  "/stock/adjustment": {
    title: "Stock Adjustment",
    description: "Manual inventory corrections",
    features: [
      "Stock level corrections",
      "Damage reporting",
      "Audit trail",
      "Approval workflow",
    ],
  },
  "/stock/wastage": {
    title: "Inventory Wastage",
    description: "Track and manage inventory loss",
    features: [
      "Wastage documentation",
      "Loss categorization",
      "Cost impact analysis",
      "Prevention insights",
    ],
  },
  "/stock/audit": {
    title: "Inventory Audit",
    description: "Conduct stock verification and audits",
    features: [
      "Physical count recording",
      "Variance analysis",
      "Audit reports",
      "Cycle counting",
    ],
  },
  "/pos": {
    title: "POS Billing",
    description: "Point of sale system for quick billing",
    features: [
      "Product search & selection",
      "Auto tax calculation",
      "Multiple payment modes",
      "Receipt generation",
    ],
  },
  "/reports": {
    title: "Reports",
    description: "Comprehensive business analytics and reports",
    features: [
  "Booking reports",
      "Purchase analytics",
      "GST reports",
      "Inventory insights",
    ],
  },
  "/settings": {
    title: "Settings",
    description: "Configure business settings and preferences",
    features: [
      "Business information",
      "Tax configurations",
      "User management",
      "System preferences",
    ],
  },
};

export default function PlaceholderPage() {
  const location = useLocation();
  const module = moduleInfo[location.pathname];

  if (!module) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Construction className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Page Not Found</h2>
            <p className="text-muted-foreground">
              The requested page is not available or doesn't exist.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <h1 className="text-3xl font-bold text-gray-900">{module.title}</h1>
            <Badge
              variant="outline"
              className="bg-orange-50 text-orange-700 border-orange-200"
            >
              <Clock className="h-3 w-3 mr-1" />
              Coming Soon
            </Badge>
          </div>
          <p className="text-gray-600">{module.description}</p>
        </div>
        <Button>
          <MessageCircle className="h-4 w-4 mr-2" />
          Request Development
        </Button>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Construction className="h-5 w-5 mr-2 text-blue-600" />
              Module Under Development
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              This module is currently being developed and will be available
              soon. It will provide comprehensive functionality for{" "}
              {module.title.toLowerCase()}.
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">
                What you can expect:
              </h4>
              <ul className="space-y-1 text-sm text-blue-800">
                <li>• Modern, intuitive user interface</li>
                <li>• Real-time data synchronization</li>
                <li>• Advanced filtering and search</li>
                <li>• Export capabilities</li>
                <li>• Mobile-responsive design</li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-muted-foreground">
                Expected completion: Next update
              </span>
              <Button variant="outline" size="sm">
                <ArrowRight className="h-4 w-4 mr-2" />
                Notify Me
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Planned Features */}
        <Card>
          <CardHeader>
            <CardTitle>Planned Features</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {module.features.map((feature, index) => (
                <div key={index} className="flex items-start space-x-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{feature}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium mb-2">Need this module urgently?</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Let us know your requirements and we can prioritize the
                development of this module.
              </p>
              <Button variant="outline" size="sm" className="w-full">
                Contact Development Team
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Integration Notice */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">
              Ready for Integration
            </h3>
            <p className="text-muted-foreground mb-4">
              This application is designed to easily integrate with your
              existing backend systems, APIs, or databases. The UI components
              are ready and waiting for data connections.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge variant="outline">REST API Ready</Badge>
              <Badge variant="outline">Firebase Compatible</Badge>
              <Badge variant="outline">Supabase Ready</Badge>
              <Badge variant="outline">Custom Backend</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
