import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, Plus, Minus, Package, Calendar, User, FileText, Save, X, 
  AlertTriangle, Search, Eye, Trash2, BarChart3, Clock, 
  TrendingUp, TrendingDown, RefreshCw, CheckCircle, AlertCircle, 
  Archive, DollarSign, Target, Activity, Download
} from "lucide-react";
import { format, addDays, subDays, differenceInDays, isAfter, isBefore, addMonths } from "date-fns";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";

interface ExpiryItem {
  id: string;
  product_id: string;
  product_name: string;
  category: string;
  batch_number: string;
  manufacture_date: string;
  expiry_date: string;
  current_stock: number;
  unit: string;
  unit_cost: number;
  selling_price: number;
  location: string;
  supplier_name: string;
  days_to_expiry: number;
  expiry_status: "fresh" | "near_expiry" | "expired" | "critical";
  action_needed: boolean;
}

interface WastageEntry {
  id: string;
  product_id: string;
  product_name: string;
  batch_number: string;
  quantity_wasted: number;
  unit: string;
  unit_cost: number;
  total_loss: number;
  wastage_reason: "expired" | "damaged" | "contaminated" | "spillage" | "theft" | "other";
  disposal_method: "return_to_supplier" | "medical_waste" | "general_waste" | "recycling";
  disposal_date: string;
  reported_by: string;
  approved_by?: string;
  approval_date?: string;
  status: "reported" | "approved" | "disposed";
  notes?: string;
  evidence_photo?: string;
}

interface DisposalRecord {
  id: string;
  disposal_date: string;
  disposal_method: string;
  total_items: number;
  total_cost_loss: number;
  disposed_by: string;
  wastage_entries: string[];
  certificate_number?: string;
  vendor_name?: string;
  notes?: string;
}

interface AlertRule {
  id: string;
  name: string;
  category: string;
  days_before_expiry: number;
  notification_method: "email" | "sms" | "app" | "all";
  active: boolean;
  recipients: string[];
}

export default function ExpiryWastage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [expiryItems, setExpiryItems] = useState<ExpiryItem[]>([]);
  const [wastageEntries, setWastageEntries] = useState<WastageEntry[]>([]);
  const [disposalRecords, setDisposalRecords] = useState<DisposalRecord[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"expiry" | "wastage" | "disposal" | "alerts">("expiry");

  const [searchQuery, setSearchQuery] = useState("");

  type ExpiryStatusFilter = "all" | "fresh" | "near_expiry" | "critical" | "expired";
  const [expiryFilter, setExpiryFilter] = useState<ExpiryStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Form state
  const [showWastageForm, setShowWastageForm] = useState(false);
  const [showDisposalForm, setShowDisposalForm] = useState(false);
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [selectedExpiredItems, setSelectedExpiredItems] = useState<string[]>([]);

  // Wastage form
  const [wastageForm, setWastageForm] = useState({
    product_id: "",
    product_name: "",
    batch_number: "",
    quantity_wasted: "",
    wastage_reason: "",
    disposal_method: "",
    notes: "",
  });

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

    (async () => {
      setLoading(true);
      try {
        const res: any = await ApiService.post("/read", {
          tables: ["master_inventory", "current_stock", "master_uom", "master_category"],
          account_code: acc,
          retail_code: ret,
        });

        const payload = (res as any)?.data;
        const data = Array.isArray(payload)
          ? { master_inventory: payload }
          : (payload && typeof payload === "object" ? payload : {});

        const invRows: any[] = data?.master_inventory || [];
        const csRows: any[] = data?.current_stock || [];
        const unitRows: any[] = data?.master_uom || [];
        const categoryRows: any[] = data?.master_category || [];

        const unitNameById = new Map<string, string>();
        for (const r of unitRows) {
          const id = safePick(r, ["unit_id", "id", "unitId"]);
          const name = safePick(r, ["unit_name", "unit", "name", "unitName"]);
          if (id !== undefined && name !== undefined) unitNameById.set(String(id), String(name));
        }

        const categoryNameById = new Map<string, string>();
        for (const r of categoryRows) {
          const id = safePick(r, ["category_id", "id", "categoryId"]);
          const name = safePick(r, ["category_name", "category", "name", "categoryName"]);
          if (id !== undefined && name !== undefined) categoryNameById.set(String(id), String(name));
        }

        const currentQtyByItemId = new Map<string, number>();
        for (const r of csRows) {
          const id = safePick(r, ["item_id", "product_id", "productId", "id"]);
          if (id === undefined) continue;
          const qtyRaw = safePick(r, ["current_qty", "current_stock", "qty", "quantity"]);
          const qty = Number(qtyRaw ?? 0) || 0;
          currentQtyByItemId.set(String(id), qty);
        }

        const today = new Date();
        const processedItems: ExpiryItem[] = (invRows || [])
          .filter((r) => {
            const applicable = Number(safePick(r, ["expiry_applicable", "expiryApplicable"]) ?? 0) || 0;
            const expiryDate = safePick(r, ["expiry_date", "expiryDate"]);
            return applicable === 1 || !!expiryDate;
          })
          .map((r) => {
            const productIdRaw = safePick(r, ["product_id", "productId", "id"]);
            const productId = String(productIdRaw ?? "");
            const productName = String(safePick(r, ["product_name", "productName", "item_name", "name"]) ?? "");

            const expiryDateRaw = safePick(r, ["expiry_date", "expiryDate"]);
            const expiryDate = expiryDateRaw ? new Date(String(expiryDateRaw)) : null;

            const daysToExpiry = expiryDate ? differenceInDays(expiryDate, today) : 99999;
            let status: ExpiryItem["expiry_status"] = "fresh";
            let actionNeeded = false;
            if (expiryDate) {
              if (daysToExpiry < 0) {
                status = "expired";
                actionNeeded = true;
              } else if (daysToExpiry <= 7) {
                status = "critical";
                actionNeeded = true;
              } else if (daysToExpiry <= 30) {
                status = "near_expiry";
                actionNeeded = true;
              }
            }

            const categoryId = safePick(r, ["category_id", "categoryId"]);
            const category = categoryId !== undefined ? (categoryNameById.get(String(categoryId)) || String(categoryId)) : "";

            const unitId = safePick(r, ["unit_id", "unitId"]);
            const unit = unitId !== undefined ? (unitNameById.get(String(unitId)) || "") : "";

            const purchasePrice = Number(safePick(r, ["purchase_price", "purchasePrice", "unit_price", "unitPrice"]) ?? 0) || 0;
            const sellingPrice = Number(safePick(r, ["selling_price", "sellingPrice"]) ?? 0) || 0;
            const currentStock = currentQtyByItemId.get(productId) ?? 0;

            return {
              id: productId,
              product_id: productId,
              product_name: productName,
              category,
              batch_number: String(safePick(r, ["reference_code", "referenceCode", "barcode"]) ?? "-"),
              manufacture_date: String(safePick(r, ["manufacture_date", "mfg_date", "created_at", "createdAt"]) ?? ""),
              expiry_date: expiryDate ? format(expiryDate, "yyyy-MM-dd") : "",
              current_stock: currentStock,
              unit: unit || "unit",
              unit_cost: purchasePrice,
              selling_price: sellingPrice,
              location: String(safePick(r, ["location", "brand"]) ?? ""),
              supplier_name: String(safePick(r, ["supplier_name", "supplierName"]) ?? ""),
              days_to_expiry: expiryDate ? daysToExpiry : 99999,
              expiry_status: status,
              action_needed: actionNeeded,
            };
          })
          .filter((x) => !!x.product_id && !!x.product_name && !!x.expiry_date);

        if (!cancelled) setExpiryItems(processedItems);
      } catch (e: any) {
        if (!cancelled) {
          setExpiryItems([]);
          toast({
            title: "Failed to load expiry data",
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

  const getExpiryStatusBadge = (status: string) => {
    const statusConfig = {
      fresh: { color: "bg-green-100 text-green-800", label: "Fresh" },
      near_expiry: { color: "bg-yellow-100 text-yellow-800", label: "Near Expiry" },
      critical: { color: "bg-orange-100 text-orange-800", label: "Critical" },
      expired: { color: "bg-red-100 text-red-800", label: "Expired" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.fresh;
    return (
      <Badge className={`${config.color} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const getWastageStatusBadge = (status: string) => {
    const statusConfig = {
      reported: { color: "bg-yellow-100 text-yellow-800", label: "Reported" },
      approved: { color: "bg-blue-100 text-blue-800", label: "Approved" },
      disposed: { color: "bg-green-100 text-green-800", label: "Disposed" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.reported;
    return (
      <Badge className={`${config.color} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const getReasonBadge = (reason: string) => {
    const reasonConfig = {
      expired: { color: "bg-red-100 text-red-800", label: "Expired" },
      damaged: { color: "bg-orange-100 text-orange-800", label: "Damaged" },
      contaminated: { color: "bg-purple-100 text-purple-800", label: "Contaminated" },
      spillage: { color: "bg-blue-100 text-blue-800", label: "Spillage" },
      theft: { color: "bg-gray-100 text-gray-800", label: "Theft" },
      other: { color: "bg-gray-100 text-gray-800", label: "Other" },
    };
    
    const config = reasonConfig[reason as keyof typeof reasonConfig] || reasonConfig.other;
    return (
      <Badge className={`${config.color} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const handleCreateWastageEntry = () => {
    if (!wastageForm.product_name || !wastageForm.quantity_wasted || !wastageForm.wastage_reason) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const newEntry: WastageEntry = {
      id: Date.now().toString(),
      product_id: wastageForm.product_id || `PROD${Date.now()}`,
      product_name: wastageForm.product_name,
      batch_number: wastageForm.batch_number,
      quantity_wasted: parseInt(wastageForm.quantity_wasted),
      unit: "unit", // Default unit
      unit_cost: 500, // Mock cost
      total_loss: parseInt(wastageForm.quantity_wasted) * 500,
      wastage_reason: wastageForm.wastage_reason as WastageEntry['wastage_reason'],
      disposal_method: wastageForm.disposal_method as WastageEntry['disposal_method'],
      disposal_date: format(new Date(), 'yyyy-MM-dd'),
      reported_by: "CurrentUser",
      status: "reported",
      notes: wastageForm.notes,
    };

    setWastageEntries([newEntry, ...wastageEntries]);

    toast({
      title: "Success",
      description: "Wastage entry created successfully",
    });

    // Reset form
    setWastageForm({
      product_id: "",
      product_name: "",
      batch_number: "",
      quantity_wasted: "",
      wastage_reason: "",
      disposal_method: "",
      notes: "",
    });
    setShowWastageForm(false);
  };

  const handleBulkDisposal = () => {
    if (selectedExpiredItems.length === 0) {
      toast({
        title: "Error",
        description: "Please select items to dispose",
        variant: "destructive",
      });
      return;
    }

    const selectedItems = expiryItems.filter(item => selectedExpiredItems.includes(item.id));
    const totalLoss = selectedItems.reduce((sum, item) => sum + (item.current_stock * item.unit_cost), 0);

    // Create wastage entries for selected items
    const newWastageEntries = selectedItems.map(item => ({
      id: `${Date.now()}-${item.id}`,
      product_id: item.product_id,
      product_name: item.product_name,
      batch_number: item.batch_number,
      quantity_wasted: item.current_stock,
      unit: item.unit,
      unit_cost: item.unit_cost,
      total_loss: item.current_stock * item.unit_cost,
      wastage_reason: "expired" as WastageEntry['wastage_reason'],
      disposal_method: "general_waste" as WastageEntry['disposal_method'],
      disposal_date: format(new Date(), 'yyyy-MM-dd'),
      reported_by: "CurrentUser",
      status: "approved" as WastageEntry['status'],
      notes: "Bulk disposal of expired items",
    }));

    setWastageEntries([...newWastageEntries, ...wastageEntries]);

    // Create disposal record
    const newDisposal: DisposalRecord = {
      id: Date.now().toString(),
      disposal_date: format(new Date(), 'yyyy-MM-dd'),
      disposal_method: "general_waste",
      total_items: selectedItems.length,
      total_cost_loss: totalLoss,
      disposed_by: "CurrentUser",
      wastage_entries: newWastageEntries.map(entry => entry.id),
      notes: "Bulk disposal of expired products",
    };

    setDisposalRecords([newDisposal, ...disposalRecords]);

    // Remove disposed items from expiry list
    setExpiryItems(expiryItems.filter(item => !selectedExpiredItems.includes(item.id)));

    toast({
      title: "Success",
      description: `${selectedItems.length} items disposed successfully`,
    });

    setSelectedExpiredItems([]);
  };

  const filteredExpiryItems = expiryItems.filter((item) => {
    if (expiryFilter !== "all" && item.expiry_status !== expiryFilter) return false;
    if (categoryFilter !== "all" && item.category !== categoryFilter) return false;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const hay = `${item.product_name} ${item.batch_number} ${item.supplier_name} ${item.location} ${item.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredWastageEntries = wastageEntries.filter(entry => {
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen w-full bg-slate-50/40 p-2 md:p-3">
      <h1 className="sr-only">Expiry & Wastage</h1>
      <Card className="min-h-[calc(100vh-2rem)] flex flex-col border-slate-200 shadow-sm">
        <CardHeader className="pb-3 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-xl shrink-0">Expiry & Wastage</CardTitle>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
              <Button variant="outline" onClick={() => navigate("/inventory")}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-4 bg-white">
          {/* Filters */}
          <div className="grid grid-cols-1 items-end gap-3 xl:grid-cols-12">
            <div className="xl:col-span-4">
              <Label className="sr-only">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search product, batch, supplier..."
                  className="h-10 pl-10"
                />
              </div>
            </div>

            <div className="xl:col-span-3">
              <Label>Status</Label>
              <Select
                value={expiryFilter}
                onValueChange={(value) => {
                  const allowed: ExpiryStatusFilter[] = ["all", "fresh", "near_expiry", "critical", "expired"];
                  if (allowed.includes(value as ExpiryStatusFilter)) {
                    setExpiryFilter(value as ExpiryStatusFilter);
                  } else {
                    setExpiryFilter("all");
                  }
                }}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="critical">Critical (≤7 days)</SelectItem>
                  <SelectItem value="near_expiry">Near Expiry (≤30 days)</SelectItem>
                  <SelectItem value="fresh">Fresh</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="xl:col-span-3">
              <Label>Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="Hair Care">Hair Care</SelectItem>
                  <SelectItem value="Skincare">Skincare</SelectItem>
                  <SelectItem value="Nail Care">Nail Care</SelectItem>
                  <SelectItem value="Makeup">Makeup</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="xl:col-span-2 flex xl:justify-end">
              <Button
                onClick={handleBulkDisposal}
                disabled={selectedExpiredItems.length === 0}
                variant="destructive"
                className="h-10 w-full xl:w-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Dispose ({selectedExpiredItems.length})
              </Button>
            </div>
          </div>

          {/* Expiry Items Table */}
          <div className="flex-1 min-h-[420px] overflow-x-auto rounded-md border">
            <Table className="w-full min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={
                        selectedExpiredItems.length === filteredExpiryItems.filter((item) => item.expiry_status === "expired").length &&
                        filteredExpiryItems.filter((item) => item.expiry_status === "expired").length > 0
                      }
                      onChange={(e) => {
                        const expiredItems = filteredExpiryItems.filter((item) => item.expiry_status === "expired");
                        if (e.target.checked) {
                          setSelectedExpiredItems(expiredItems.map((item) => item.id));
                        } else {
                          setSelectedExpiredItems([]);
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">PRODUCT</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">BATCH</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">CURRENT STOCK</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">EXPIRY DATE</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">DAYS TO EXPIRY</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">STATUS</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold text-slate-800">LOSS VALUE</TableHead>
                  <TableHead className="whitespace-nowrap text-center font-semibold text-slate-800">ACTIONS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpiryItems.map((item) => (
                  <TableRow
                    key={item.id}
                    className={item.expiry_status === "expired" ? "bg-red-50" : item.expiry_status === "critical" ? "bg-orange-50" : ""}
                  >
                    <TableCell>
                      {item.expiry_status === "expired" && (
                        <input
                          type="checkbox"
                          checked={selectedExpiredItems.includes(item.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedExpiredItems([...selectedExpiredItems, item.id]);
                            } else {
                              setSelectedExpiredItems(selectedExpiredItems.filter((id) => id !== item.id));
                            }
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{item.product_name}</div>
                        <div className="text-sm text-gray-500">
                          {item.category} • {item.location}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.batch_number}</div>
                      {item.supplier_name ? <div className="text-sm text-gray-500">{item.supplier_name}</div> : null}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {item.current_stock} {item.unit}
                        </div>
                        <div className="text-sm text-gray-500">₹{item.unit_cost}/unit</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{format(new Date(item.expiry_date), "MMM dd, yyyy")}</div>
                        {item.manufacture_date ? (
                          <div className="text-sm text-gray-500">Mfg: {format(new Date(item.manufacture_date), "MMM dd, yyyy")}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div
                        className={`font-medium ${
                          item.days_to_expiry < 0
                            ? "text-red-600"
                            : item.days_to_expiry <= 7
                              ? "text-orange-600"
                              : item.days_to_expiry <= 30
                                ? "text-yellow-600"
                                : "text-gray-600"
                        }`}
                      >
                        {item.days_to_expiry < 0
                          ? `${Math.abs(item.days_to_expiry)} days ago`
                          : item.days_to_expiry === 0
                            ? "Today"
                            : `${item.days_to_expiry} days`}
                      </div>
                    </TableCell>
                    <TableCell>{getExpiryStatusBadge(item.expiry_status)}</TableCell>
                    <TableCell className="font-medium">₹{(item.current_stock * item.unit_cost).toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                        {item.action_needed && (
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredExpiryItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-[40vh] text-center align-middle text-sm text-muted-foreground">
                      {loading ? "Loading..." : "No expiry-tracked items found."}
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