import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft,
  Package,
  ShoppingCart,
  Bell,
  Users,
  Download,
} from "lucide-react";
import { format, addDays, subDays } from "date-fns";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock_level: number;
  max_stock_level: number;
  reorder_point: number;
  economic_order_quantity: number;
  unit_cost: number;
  selling_price: number;
  supplier_id: string;
  supplier_name: string;
  lead_time_days: number;
  avg_daily_usage: number;
  last_ordered_date?: string;
  last_ordered_quantity?: number;
  location: string;
  status: "in_stock" | "low_stock" | "out_of_stock" | "reorder_needed";
}

interface Supplier {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  payment_terms: string;
  delivery_time: string;
  rating: number;
  products_count: number;
  last_order_date?: string;
  status: "active" | "inactive";
}

interface ReorderSuggestion {
  id: string;
  product_id: string;
  product_name: string;
  current_stock: number;
  min_stock_level: number;
  reorder_point: number;
  suggested_quantity: number;
  estimated_cost: number;
  supplier_id: string;
  supplier_name: string;
  urgency: "high" | "medium" | "low";
  days_until_stockout: number;
  reason: string;
  created_at: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  order_date: string;
  expected_delivery: string;
  status: "draft" | "sent" | "confirmed" | "delivered" | "cancelled";
  items: PurchaseOrderItem[];
  total_amount: number;
  notes?: string;
}

interface PurchaseOrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export default function ReorderAlert() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reorderSuggestions, setReorderSuggestions] = useState<ReorderSuggestion[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);

  // Filters
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");

  // Load realtime inventory + current stock and compute reorder suggestions
  useEffect(() => {
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;

    const safePick = (row: any, keys: string[]) => {
      for (const k of keys) {
        const v = row?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return undefined;
    };

    const toNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const extract = (dataRoot: any, primary: string, aliases: string[]): any[] => {
      if (Array.isArray(dataRoot)) return dataRoot;
      if (Array.isArray(dataRoot?.[primary])) return dataRoot[primary];
      for (const k of aliases) {
        if (Array.isArray(dataRoot?.[k])) return dataRoot[k];
      }
      const lower = primary.toLowerCase();
      for (const k of Object.keys(dataRoot || {})) {
        if (k.toLowerCase().includes(lower) && Array.isArray(dataRoot[k])) return dataRoot[k];
      }
      return [];
    };

    (async () => {
      setLoading(true);
      try {
        const res: any = await ApiService.post("/read", {
          tables: ["master_inventory", "current_stock", "master_supplier"],
          account_code: acc,
          retail_code: ret,
        });

        const dataRoot: any = res?.data ?? res ?? {};
        const invRows = extract(dataRoot, "master_inventory", ["inventory", "product_master", "products"]);
        const csRows = extract(dataRoot, "current_stock", ["stock", "currentStock", "stocks"]);
        const supRows = extract(dataRoot, "master_supplier", ["suppliers", "supplier", "vendor", "vendors"]);

        const supplierNameById = new Map<string, string>();
        for (const s of supRows) {
          const id = String(
            safePick(s, ["supplier_id", "supplierId", "vendor_id", "master_supplier_id", "id"]) ?? ""
          ).trim();
          const name = String(
            safePick(s, ["supplier_name", "name", "vendor_name", "company_name", "business_name", "customer_name"]) ?? ""
          ).trim();
          if (id && name) supplierNameById.set(id, name);
        }

        const currentQtyByItemId = new Map<string, number>();
        for (const r of csRows) {
          const id = safePick(r, ["item_id", "product_id", "productId", "inventory_id", "id"]);
          if (id === undefined) continue;
          const qtyRaw = safePick(r, ["current_qty", "current_stock", "qty", "quantity", "stock_qty", "stock"]);
          currentQtyByItemId.set(String(id), toNum(qtyRaw));
        }

        const normalizedProducts: Product[] = (invRows || [])
          .map((r: any) => {
            const productId = String(safePick(r, ["product_id", "productId", "item_id", "itemId", "id"]) ?? "").trim();
            const productName = String(safePick(r, ["product_name", "productName", "item_name", "name"]) ?? "").trim();
            if (!productId || !productName) return null;

            const supplierId = String(safePick(r, ["supplier_id", "supplierId", "vendor_id", "vendorId"]) ?? "").trim();
            const supplierName =
              String(safePick(r, ["supplier_name", "supplierName", "vendor_name", "vendorName"]) ?? "").trim() ||
              (supplierId ? supplierNameById.get(supplierId) || "" : "");

            const minStock = toNum(safePick(r, ["min_stock_level", "min_stock", "min_qty", "minimum_stock"])) || 0;
            const maxStock = toNum(safePick(r, ["max_stock_level", "max_stock", "max_qty", "maximum_stock"])) || 0;
            const reorderPoint = toNum(safePick(r, ["reorder_point", "reorder_level", "reorderPoint"])) || 0;
            const eoq = toNum(safePick(r, ["economic_order_quantity", "eoq", "economicOrderQuantity"])) || 0;
            const unitCost = toNum(safePick(r, ["unit_cost", "purchase_price", "purchasePrice", "unit_price", "unitPrice"])) || 0;
            const sellingPrice = toNum(safePick(r, ["selling_price", "sellingPrice"])) || 0;
            const avgDailyUsage = toNum(safePick(r, ["avg_daily_usage", "avgDailyUsage", "daily_usage", "dailyUsage"])) || 0;
            const leadTimeDays = toNum(safePick(r, ["lead_time_days", "leadTimeDays", "lead_time", "leadTime"])) || 0;

            const currentStock = currentQtyByItemId.get(productId) ?? 0;

            const reorderNeeded = (reorderPoint > 0 && currentStock <= reorderPoint) || (minStock > 0 && currentStock <= minStock);
            let status: Product["status"] = "in_stock";
            if (reorderNeeded) status = "reorder_needed";
            else if (minStock > 0 && currentStock <= minStock) status = "low_stock";
            else if (currentStock <= 0) status = "out_of_stock";

            return {
              id: productId,
              name: productName,
              category: String(safePick(r, ["category", "category_name", "categoryName"]) ?? ""),
              unit: String(safePick(r, ["unit", "uom", "unit_name", "unitName"]) ?? "unit"),
              current_stock: currentStock,
              min_stock_level: minStock,
              max_stock_level: maxStock,
              reorder_point: reorderPoint,
              economic_order_quantity: eoq,
              unit_cost: unitCost,
              selling_price: sellingPrice,
              supplier_id: supplierId,
              supplier_name: supplierName,
              lead_time_days: leadTimeDays,
              avg_daily_usage: avgDailyUsage,
              last_ordered_date: undefined,
              last_ordered_quantity: undefined,
              location: String(safePick(r, ["location", "brand"]) ?? ""),
              status,
            } as Product;
          })
          .filter(Boolean) as Product[];

        const supplierProductCounts = new Map<string, number>();
        for (const p of normalizedProducts) {
          if (!p.supplier_id) continue;
          supplierProductCounts.set(p.supplier_id, (supplierProductCounts.get(p.supplier_id) ?? 0) + 1);
        }

        const normalizedSuppliers: Supplier[] = (supRows || [])
          .map((s: any) => {
            const id = String(
              safePick(s, ["supplier_id", "supplierId", "vendor_id", "master_supplier_id", "id"]) ?? ""
            ).trim();
            const name = String(
              safePick(s, ["supplier_name", "name", "vendor_name", "company_name", "business_name", "customer_name"]) ?? ""
            ).trim();
            if (!id || !name) return null;

            const deliveryDays = toNum(safePick(s, ["lead_time_days", "leadTimeDays", "delivery_days", "deliveryDays"])) || 0;
            return {
              id,
              name,
              contact_person: String(safePick(s, ["contact_person", "contactPerson", "contact_name", "contactName"]) ?? ""),
              phone: String(safePick(s, ["phone", "mobile", "mobile_no", "mobileNo"]) ?? ""),
              email: String(safePick(s, ["email"]) ?? ""),
              address: String(safePick(s, ["address", "supplier_address", "supplierAddress"]) ?? ""),
              payment_terms: String(safePick(s, ["payment_terms", "paymentTerms"]) ?? ""),
              delivery_time: `${deliveryDays || 3} days`,
              rating: 0,
              products_count: supplierProductCounts.get(id) ?? 0,
              last_order_date: undefined,
              status: "active",
            } as Supplier;
          })
          .filter(Boolean) as Supplier[];

        // If there are products with supplier_id but supplier master is empty, still allow filtering.
        if (normalizedSuppliers.length === 0) {
          const derived = new Map<string, Supplier>();
          for (const p of normalizedProducts) {
            if (!p.supplier_id) continue;
            if (derived.has(p.supplier_id)) continue;
            derived.set(p.supplier_id, {
              id: p.supplier_id,
              name: p.supplier_name || p.supplier_id,
              contact_person: "",
              phone: "",
              email: "",
              address: "",
              payment_terms: "",
              delivery_time: `${p.lead_time_days || 3} days`,
              rating: 0,
              products_count: supplierProductCounts.get(p.supplier_id) ?? 0,
              last_order_date: undefined,
              status: "active",
            });
          }
          normalizedSuppliers.push(...Array.from(derived.values()));
        }

        const suggestions: ReorderSuggestion[] = normalizedProducts
          .map((p) => {
            const threshold = p.reorder_point || p.min_stock_level || 0;
            if (threshold <= 0) return null;
            if (p.current_stock > threshold) return null;

            const daysToStockout = p.avg_daily_usage > 0
              ? Math.max(0, Math.floor(p.current_stock / p.avg_daily_usage))
              : (p.current_stock <= 0 ? 0 : 999);

            let urgency: ReorderSuggestion["urgency"] = "low";
            if (p.current_stock <= 0 || p.current_stock <= p.min_stock_level || daysToStockout <= 1) urgency = "high";
            else if (p.current_stock <= p.reorder_point) urgency = "medium";

            let suggestedQty = p.economic_order_quantity > 0 ? p.economic_order_quantity : 0;
            if (suggestedQty <= 0) {
              if (p.max_stock_level > 0) suggestedQty = Math.max(1, p.max_stock_level - p.current_stock);
              else suggestedQty = Math.max(1, (p.min_stock_level || threshold) - p.current_stock);
            }

            const estimatedCost = suggestedQty * (p.unit_cost || 0);

            const reason =
              p.current_stock <= 0
                ? "Out of stock - immediate reorder required"
                : p.current_stock <= p.min_stock_level
                  ? "Current stock below minimum level"
                  : "Current stock at/below reorder point";

            return {
              id: p.id,
              product_id: p.id,
              product_name: p.name,
              current_stock: p.current_stock,
              min_stock_level: p.min_stock_level,
              reorder_point: threshold,
              suggested_quantity: Math.round(suggestedQty),
              estimated_cost: estimatedCost,
              supplier_id: p.supplier_id,
              supplier_name: p.supplier_name,
              urgency,
              days_until_stockout: daysToStockout,
              reason,
              created_at: new Date().toISOString(),
            } as ReorderSuggestion;
          })
          .filter(Boolean) as ReorderSuggestion[];

        const urgencyRank: Record<ReorderSuggestion["urgency"], number> = { high: 0, medium: 1, low: 2 };
        suggestions.sort((a, b) => {
          const d = urgencyRank[a.urgency] - urgencyRank[b.urgency];
          if (d !== 0) return d;
          return a.days_until_stockout - b.days_until_stockout;
        });

        if (!cancelled) {
          setProducts(normalizedProducts);
          setSuppliers(normalizedSuppliers);
          setReorderSuggestions(suggestions);
          setPurchaseOrders([]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setProducts([]);
          setSuppliers([]);
          setReorderSuggestions([]);
          setPurchaseOrders([]);
          toast({
            title: "Failed to load reorder data",
            description: String(e?.message || e),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const getUrgencyBadge = (urgency: string) => {
    const urgencyConfig = {
      high: { color: "bg-red-100 text-red-800", label: "High Priority" },
      medium: { color: "bg-yellow-100 text-yellow-800", label: "Medium Priority" },
      low: { color: "bg-green-100 text-green-800", label: "Low Priority" },
    };
    
    const config = urgencyConfig[urgency as keyof typeof urgencyConfig] || urgencyConfig.low;
    return (
      <Badge className={`${config.color} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const redirectToStockInAdd = () => {
    if (selectedSuggestions.length === 0) {
      toast({
        title: "Select items",
        description: "Please select at least one item.",
        variant: "warning",
      });
      return;
    }

    const selected = reorderSuggestions.filter((s) => selectedSuggestions.includes(s.id));
    const supplierIds = Array.from(new Set(selected.map((s) => String(s.supplier_id || "").trim()).filter(Boolean)));
    const explicitSupplierId = supplierFilter !== "all" ? supplierFilter : "";

    let supplierId = "";
    if (supplierIds.length === 0) {
      // Items don't have supplier_id in master data; allow user selection from dropdown.
      if (!explicitSupplierId) {
        toast({
          title: "Choose supplier",
          description: "Select a supplier in the dropdown, then click Create Purchase Order.",
          variant: "warning",
        });
        return;
      }
      supplierId = explicitSupplierId;
    } else if (supplierIds.length === 1) {
      supplierId = supplierIds[0];
      if (explicitSupplierId && explicitSupplierId !== supplierId) {
        toast({
          title: "Supplier mismatch",
          description: "Selected items are for a different supplier. Clear selection or choose matching items.",
          variant: "warning",
        });
        return;
      }
    } else {
      // Multiple suppliers inside selection; enforce one.
      if (!explicitSupplierId) {
        toast({
          title: "Multiple suppliers",
          description: "Select one supplier in the dropdown (or select items from a single supplier).",
          variant: "warning",
        });
        return;
      }
      if (!supplierIds.includes(explicitSupplierId)) {
        toast({
          title: "Supplier mismatch",
          description: "Selected items don't match the chosen supplier.",
          variant: "warning",
        });
        return;
      }
      supplierId = explicitSupplierId;
    }

    navigate("/inventory/stock-in/add", {
      state: {
        reorderPrefill: {
          source: "reorder-level",
          supplier_id: supplierId,
          items: selected.map((s) => ({
            product_id: s.product_id,
            item_name: s.product_name,
            quantity: s.suggested_quantity,
            unit_price: s.suggested_quantity > 0 ? s.estimated_cost / s.suggested_quantity : 0,
          })),
        },
      },
    });
  };

  const filteredSuggestions = reorderSuggestions.filter(suggestion => {
    if (urgencyFilter !== "all" && suggestion.urgency !== urgencyFilter) return false;
    if (supplierFilter !== "all" && suggestion.supplier_id && suggestion.supplier_id !== supplierFilter) return false;
    return true;
  });

  const highPrioritySuggestions = reorderSuggestions.filter(s => s.urgency === "high").length;
  const totalReorderValue = reorderSuggestions.reduce((sum, s) => sum + s.estimated_cost, 0);
  const activeSuppliers = suppliers.filter(s => s.status === "active").length;

  return (
    <div className="min-h-screen bg-slate-50">
      <h1 className="sr-only">Reorder Level</h1>
      <div className="w-full px-1 lg:px-2">
        <div className="grid grid-cols-1 gap-3">
          <Card className="border-0 bg-white rounded-xl overflow-visible">
            <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-1 rounded-full bg-blue-600/80" aria-hidden="true" />
                  <CardTitle className="text-base font-semibold tracking-tight text-slate-900">Reorder Level</CardTitle>
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => navigate("/inventory")}>
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs">
                    <Download className="mr-1 h-4 w-4" />
                    Export Report
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="px-3 py-3">
              {/* KPI Cards (match inventory pages style) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">
                {[
                  {
                    label: "HIGH PRIORITY ALERTS",
                    value: String(highPrioritySuggestions),
                    icon: <Bell className="h-3 w-3 sm:h-4 sm:w-4" />,
                    tone: "from-rose-500/10 to-rose-500/5",
                    iconTint: "bg-rose-100 text-rose-700 ring-rose-200/60",
                  },
                  {
                    label: "REORDER SUGGESTIONS",
                    value: String(reorderSuggestions.length),
                    icon: <Package className="h-3 w-3 sm:h-4 sm:w-4" />,
                    tone: "from-amber-500/10 to-amber-500/5",
                    iconTint: "bg-amber-100 text-amber-800 ring-amber-200/60",
                  },
                  {
                    label: "EST. REORDER VALUE",
                    value: `₹${Number(totalReorderValue || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
                    icon: <ShoppingCart className="h-3 w-3 sm:h-4 sm:w-4" />,
                    tone: "from-emerald-500/10 to-emerald-500/5",
                    iconTint: "bg-emerald-100 text-emerald-700 ring-emerald-200/60",
                  },
                  {
                    label: "ACTIVE SUPPLIERS",
                    value: String(activeSuppliers),
                    icon: <Users className="h-3 w-3 sm:h-4 sm:w-4" />,
                    tone: "from-violet-500/10 to-violet-500/5",
                    iconTint: "bg-violet-100 text-violet-700 ring-violet-200/60",
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-3 sm:px-5 py-3 sm:py-4 shadow-sm hover:shadow-md transition-shadow group min-h-[80px] sm:min-h-[112px]"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${card.tone} opacity-80 pointer-events-none`} />
                    <div className="relative flex items-start justify-between gap-2 sm:gap-4 min-h-[56px] sm:min-h-[72px]">
                      <div className="w-full">
                        <div className="h-4 sm:h-5 flex items-end">
                          <p className="text-[10px] sm:text-[12px] font-semibold tracking-wide text-slate-600 uppercase leading-none whitespace-nowrap">
                            {card.label}
                          </p>
                        </div>
                        <div className="mt-1 sm:mt-2">
                          <div className="text-lg sm:text-2xl leading-none font-semibold text-slate-900 tabular-nums">
                            {card.value}
                          </div>
                        </div>
                      </div>
                      <div className={`shrink-0 h-6 w-6 sm:h-8 sm:w-8 rounded-md ${card.iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform mt-1`}>
                        {card.icon}
                      </div>
                    </div>
                    <div className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 h-16 w-16 sm:h-24 sm:w-24 rounded-full bg-white/30 blur-2xl opacity-40" />
                  </div>
                ))}
              </div>

              <div className="space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 items-end gap-3 xl:grid-cols-12">
              <div className="xl:col-span-3">
                <Label>Priority</Label>
                <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="All Priorities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="high">High Priority</SelectItem>
                    <SelectItem value="medium">Medium Priority</SelectItem>
                    <SelectItem value="low">Low Priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="xl:col-span-3">
                <Label>Supplier</Label>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="All Suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="xl:col-span-6 flex xl:justify-end">
                <Button
                  onClick={redirectToStockInAdd}
                  className="h-10 w-full xl:w-auto"
                  disabled={selectedSuggestions.length === 0}
                >
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Create Purchase Order
                </Button>
              </div>
            </div>

            {/* Reorder Suggestions Table */}
            <div className="flex-1 min-h-[420px] overflow-x-auto rounded-md border">
              <Table className="w-full min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.length === filteredSuggestions.length && filteredSuggestions.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSuggestions(filteredSuggestions.map(s => s.id));
                        } else {
                          setSelectedSuggestions([]);
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Reorder Point</TableHead>
                  <TableHead>Suggested Order</TableHead>
                  <TableHead>Estimated Cost</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Days to Stockout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                      Loading reorder suggestions...
                    </TableCell>
                  </TableRow>
                ) : filteredSuggestions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                      No items currently below reorder level.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSuggestions.map((suggestion) => (
                    <TableRow key={suggestion.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedSuggestions.includes(suggestion.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSuggestions([...selectedSuggestions, suggestion.id]);
                          } else {
                            setSelectedSuggestions(selectedSuggestions.filter(id => id !== suggestion.id));
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{suggestion.product_name}</div>
                        <div className="text-sm text-gray-500">{suggestion.reason}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{suggestion.current_stock}</div>
                        <div className="text-sm text-gray-500">Min: {suggestion.min_stock_level}</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {suggestion.reorder_point}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{suggestion.suggested_quantity} units</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      ₹{suggestion.estimated_cost.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{suggestion.supplier_name}</div>
                        <div className="text-sm text-gray-500">
                          {(suppliers.find(s => s.id === suggestion.supplier_id)?.delivery_time) || ""}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getUrgencyBadge(suggestion.urgency)}
                    </TableCell>
                    <TableCell>
                      <div className={`font-medium ${
                        suggestion.days_until_stockout <= 1 ? 'text-red-600' :
                        suggestion.days_until_stockout <= 3 ? 'text-yellow-600' : 'text-gray-600'
                      }`}>
                        {suggestion.days_until_stockout === 0 ? 'Today' : `${suggestion.days_until_stockout} days`}
                      </div>
                    </TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
              </Table>
            </div>
          </div>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}