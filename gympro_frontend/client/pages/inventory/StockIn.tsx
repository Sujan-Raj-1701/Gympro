import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ArrowUpDown, Check, ChevronDown, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { ApiService } from "@/services/apiService";
import { toast } from "@/hooks/use-toast";

type Supplier = {
  id: string;
  name: string;
};

type StockItem = {
  id: string;
  itemName: string;
  variantId: string;
  variantName: string;
  uom: string;
  batchNo: string;
  hsnCode: string;
  hsnDesc: string;
  taxName: string;
  taxId?: number;
  brand: string;
  taxPercent: number;
  discount: number;
  quantity: number;
  unitPrice: number;
  total: number;
};

type MasterInventoryLite = {
  id: number;
  product_id?: string;
  item_name: string;
  uom_id?: string;
  uom?: string;
  barcode?: string;
  hsn_code?: string;
  brand?: string;
  purchase_price?: number;
  selling_price?: number;
  tax?: any;
};

type MasterUomLite = {
  id: number;
  uom_id: string;
  description: string;
  status?: number;
};

type MasterHsnLite = {
  id: number;
  hsn_code: string;
  description: string;
};

type MasterTaxLite = {
  id: number;
  tax_id?: number;
  name: string;
  description: string;
  percentage?: number;
};

type MasterVariantLite = {
  id: number;
  variant_id: string;
  variant_name: string;
  size?: string;
  color?: string;
  width?: string;
  status?: number;
};

const parsePercent = (value: unknown): number | undefined => {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return undefined;
    // Common formats: "18", "18%", "GST 18%", "18.00 %"
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const getTaxName = (tax: any): string => {
  if (!tax) return "";
  if (typeof tax === "string") return tax;
  if (typeof tax === "number") return String(tax);
  if (Array.isArray(tax)) {
    const parts = tax
      .map((t) => getTaxName(t))
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(parts)).join(", ");
  }
  if (typeof tax === "object") {
    const candidate =
      (tax as any).tax_name ??
      (tax as any).taxName ??
      (tax as any).name ??
      (tax as any).label ??
      (tax as any).tax;
    return candidate ? String(candidate) : "";
  }
  return "";
};

const PAYMENT_MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank Transfer" },
] as const;

export default function StockIn() {
  const RequiredMark = () => <span className="text-red-500">*</span>;
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { stockinId } = useParams();
  const isEditing = !!stockinId;

  const controlCls =
    "h-8 px-2 text-sm rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700";
  const inputCls = "h-8 px-2 text-sm rounded-lg bg-slate-50 border border-slate-200 text-slate-700";
  const textareaCls = "min-h-[80px] text-sm rounded-lg bg-slate-50 border border-slate-200 text-slate-700";

  // Supplier/PO meta
  const [supplierId, setSupplierId] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [entryDate, setEntryDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [billDate, setBillDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [billNo, setBillNo] = useState("");
  const [taxExempt, setTaxExempt] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [barcodeScan, setBarcodeScan] = useState("");

  // Pricing & payment
  const [discount, setDiscount] = useState<number>(0);
  const [deliveryCharge, setDeliveryCharge] = useState<number>(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [paymentModes, setPaymentModes] = useState<string[]>([]);
  const [paymentModeOpen, setPaymentModeOpen] = useState(false);
  const [paymentByMode, setPaymentByMode] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [successOpen, setSuccessOpen] = useState(false);
  const [successStockInId, setSuccessStockInId] = useState<string>("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"noPayment" | "balance" | null>(null);
  const [confirmBalance, setConfirmBalance] = useState<number>(0);
  const confirmPayloadRef = useRef<any>(null);
  const confirmEndpointRef = useRef<string>("");

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [holdConfirmOpen, setHoldConfirmOpen] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [masterInventory, setMasterInventory] = useState<MasterInventoryLite[]>([]);
  const [masterHsn, setMasterHsn] = useState<MasterHsnLite[]>([]);
  const [masterTax, setMasterTax] = useState<MasterTaxLite[]>([]);
  const [masterVariants, setMasterVariants] = useState<MasterVariantLite[]>([]);
  const [masterUom, setMasterUom] = useState<MasterUomLite[]>([]);
  const [itemPickerRowId, setItemPickerRowId] = useState<string | null>(null);
  const [itemPickerQuery, setItemPickerQuery] = useState<string>("");
  const [variantPickerRowId, setVariantPickerRowId] = useState<string | null>(null);
  const [variantPickerQuery, setVariantPickerQuery] = useState<string>("");
  const itemInputRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const variantTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const variantSearchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const nextRowIdRef = useRef<number>(2);
  const createRowId = () => String(nextRowIdRef.current++);
  const [pendingFocus, setPendingFocus] = useState<null | { rowId: string; field: "item" | "variant" | "qty" }>(null);
  const [items, setItems] = useState<StockItem[]>([
    {
      id: "1",
      itemName: "",
      variantId: "",
      variantName: "",
      uom: "",
      batchNo: "",
      hsnCode: "",
      hsnDesc: "",
      taxName: "",
      taxId: undefined,
      brand: "",
      taxPercent: 0,
      discount: 0,
      quantity: 0,
      unitPrice: 0,
      total: 0,
    },
  ]);

  const reorderPrefillAppliedRef = useRef(false);

  useEffect(() => {
    if (isEditing) return;
    if (reorderPrefillAppliedRef.current) return;

    const raw = (location as any)?.state?.reorderPrefill;
    if (!raw) return;
    if (!Array.isArray(raw?.items) || raw.items.length === 0) return;
    if (!masterInventory || masterInventory.length === 0) return;

    const supplierFromState = String(raw?.supplier_id ?? "").trim();
    if (supplierFromState) setSupplierId(supplierFromState);

    const toNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const buildRow = (rowId: string, inv?: MasterInventoryLite, qty?: number, unitPriceOverride?: number): StockItem => {
      const hsn = inv ? resolveHsn(inv.hsn_code) : { code: "", description: "" };
      const taxLabel = inv ? resolveTaxLabel(inv.tax) : "";
      const taxPercent = inv ? resolveTaxPercent(inv.tax) : 0;
      const taxId = inv ? resolveTaxId(inv.tax) : undefined;
      const unitPrice = Number.isFinite(unitPriceOverride as any)
        ? Number(unitPriceOverride)
        : (inv ? (Number(inv.purchase_price ?? inv.selling_price ?? 0) || 0) : 0);

      const quantity = Math.max(0, toNum(qty));
      const base = quantity * (Number(unitPrice) || 0);

      return {
        id: rowId,
        itemName: inv?.item_name ?? String(raw?.items?.[0]?.item_name ?? "").trim(),
        variantId: "",
        variantName: "",
        uom: resolveUomLabel(inv),
        batchNo: String(raw?.items?.[0]?.batch_no ?? raw?.items?.[0]?.batchNo ?? "").trim(),
        hsnCode: hsn.code,
        hsnDesc: hsn.description,
        taxName: taxLabel,
        taxId,
        brand: inv?.brand ?? "",
        taxPercent,
        discount: 0,
        quantity,
        unitPrice: Number(unitPrice) || 0,
        total: Math.max(base, 0),
      };
    };

    const rows: StockItem[] = raw.items
      .map((it: any, idx: number) => {
        const rowId = String(idx + 1);
        const prodId = String(it?.product_id ?? "").trim();
        const itemName = String(it?.item_name ?? "").trim();
        const qty = toNum(it?.quantity);
        const unitPriceOverride = toNum(it?.unit_price);

        const inv = masterInventory.find((m) => {
          const mp = String(m.product_id ?? "").trim();
          if (prodId && mp && mp === prodId) return true;
          if (itemName && String(m.item_name ?? "").trim() === itemName) return true;
          if (itemName && String(m.item_name ?? "").trim().toLowerCase() === itemName.toLowerCase()) return true;
          return false;
        });

        return buildRow(rowId, inv, qty, unitPriceOverride);
      })
      .filter((r) => String(r.itemName || "").trim() && Number(r.quantity || 0) > 0);

    if (rows.length > 0) {
      setItems(rows);
      nextRowIdRef.current = rows.length + 1;
      setPendingFocus({ rowId: rows[0].id, field: "variant" });
    }

    reorderPrefillAppliedRef.current = true;
  }, [isEditing, location, masterInventory]);

  // Load suppliers from master_supplier
  useEffect(() => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;
    (async () => {
      try {
        const res: any = await ApiService.post("/read", { tables: ["master_supplier"], account_code: acc, retail_code: ret });
        const dataRoot: any = res?.data ?? res ?? {};

        const extract = (primary: string, aliases: string[]): any[] => {
          if (Array.isArray(dataRoot)) return dataRoot;
          if (Array.isArray(dataRoot[primary])) return dataRoot[primary];
          for (const k of aliases) {
            if (Array.isArray(dataRoot[k])) return dataRoot[k];
          }
          const lower = primary.toLowerCase();
          for (const k of Object.keys(dataRoot)) {
            if (k.toLowerCase().includes(lower) && Array.isArray(dataRoot[k])) return dataRoot[k];
          }
          return [];
        };

        const rows = extract("master_supplier", ["suppliers", "supplier", "vendor", "vendors"]);
        const normalized: Supplier[] = rows
          .filter((s: any) => s && (s.status == null || s.status === 1))
          .map((s: any) => {
            // Use supplier_id as the stable/business identifier (not the internal row id).
            const id = String(s.supplier_id ?? s.supplierId ?? s.vendor_id ?? s.master_supplier_id ?? s.id ?? "").trim();
            const name = String(
              s.supplier_name ?? s.name ?? s.vendor_name ?? s.company_name ?? s.business_name ?? s.customer_name ?? ""
            ).trim();
            return { id, name };
          })
          .filter((s) => s.id && s.name);

        if (!cancelled) setSuppliers(normalized);
      } catch (e) {
        console.error("Failed to load master_supplier", e);
        if (!cancelled) setSuppliers([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load master inventory for suggestions
  useEffect(() => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;
    (async () => {
      try {
        const res: any = await ApiService.post("/read", {
          tables: ["master_inventory", "master_hsn", "master_tax", "master_variants", "master_uom"],
          account_code: acc,
          retail_code: ret,
        });
        const dataRoot: any = res?.data ?? res ?? {};

        const extract = (primary: string, aliases: string[]): any[] => {
          if (Array.isArray(dataRoot)) return dataRoot;
          if (Array.isArray(dataRoot[primary])) return dataRoot[primary];
          for (const k of aliases) {
            if (Array.isArray(dataRoot[k])) return dataRoot[k];
          }
          const lower = primary.toLowerCase();
          for (const k of Object.keys(dataRoot)) {
            if (k.toLowerCase().includes(lower) && Array.isArray(dataRoot[k])) return dataRoot[k];
          }
          return [];
        };

        const rows = extract("master_inventory", ["inventory", "product_master", "products"]);
        const normalized: MasterInventoryLite[] = rows
          .filter((p: any) => p && (p.status == null || p.status === 1))
          .map((p: any) => {
            const idNum = Number(p.id ?? p.inventory_id ?? p.product_id ?? 0);
            const itemName = String(p.item_name ?? p.product_name ?? p.reference_code ?? "").trim();
            const barcode = String(
              p.barcode ?? p.bar_code ?? p.barCode ?? p.barcode_no ?? p.barcodeNo ?? p.ean ?? p.upc ?? p.sku ?? ""
            ).trim();
            const brandName = String(
              p.brand_name ?? p.brandName ?? p.brand ?? p.brand_title ?? p.brandTitle ?? (p.brand_id != null ? p.brand_id : "")
            ).trim();
            const uomId = String(p.uom_id ?? p.uomId ?? p.unit_id ?? p.unitId ?? "").trim();
            const uomLabel = String(
              p.uom ?? p.uom_name ?? p.uomName ?? p.unit ?? p.unit_name ?? p.unitName ?? p.unit_desc ?? p.unitDesc ?? ""
            ).trim();
            const purchase = p.purchase_price != null ? Number(p.purchase_price) : (p.buying_price != null ? Number(p.buying_price) : undefined);
            const selling = p.selling_price != null ? Number(p.selling_price) : (p.price != null ? Number(p.price) : undefined);
            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              product_id: p.product_id != null ? String(p.product_id) : undefined,
              item_name: itemName,
              uom_id: uomId || undefined,
              uom: uomLabel || undefined,
              barcode: barcode || undefined,
              hsn_code: p.hsn_code != null ? String(p.hsn_code) : (p.hsn_id != null ? String(p.hsn_id) : undefined),
              brand: brandName || undefined,
              purchase_price: purchase,
              selling_price: selling,
              tax: p.tax ?? p.tax_id ?? undefined,
            };
          })
          .filter((p) => p.id && p.item_name);

        const hsnRows = extract("master_hsn", ["hsn", "masterhsn", "hsn_master"]);
        const normalizedHsn: MasterHsnLite[] = hsnRows
          .map((h: any) => {
            const idNum = Number(h.id ?? h.hsn_id ?? 0);
            const code = String(h.hsn_code ?? h.code ?? h.hsn ?? "").trim();
            const desc = String(h.hsn_description ?? h.description ?? h.hsn_desc ?? h.hsn_name ?? h.name ?? "").trim();
            return { id: Number.isFinite(idNum) ? idNum : 0, hsn_code: code, description: desc };
          })
          .filter((h) => h.id && h.hsn_code);

        const taxRows = extract("master_tax", ["tax", "mastertax", "tax_master"]);
        const normalizedTax: MasterTaxLite[] = taxRows
          .map((t: any) => {
            const idNum = Number(t.id ?? 0);
            const taxIdNumRaw = t.tax_id ?? t.taxId ?? t.taxID ?? t.tax_code;
            const taxIdNum = Number(taxIdNumRaw);
            const name = String(t.tax_name ?? t.name ?? t.label ?? t.tax ?? "").trim();
            const desc = String(t.tax_description ?? t.description ?? t.tax_desc ?? "").trim();
            const pctRaw = t.tax_percentage ?? t.percentage ?? t.tax_rate ?? t.rate ?? t.tax;
            const pctNum = parsePercent(pctRaw);

            // Some schemas store CGST/SGST separately instead of a total percentage.
            const cgst = Number(t.cgst ?? 0) || 0;
            const sgst = Number(t.sgst ?? 0) || 0;
            const igst = Number(t.igst ?? 0) || 0;
            const vat = Number(t.vat ?? 0) || 0;
            const computed = cgst + sgst + igst + vat;

            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              tax_id: Number.isFinite(taxIdNum) ? taxIdNum : undefined,
              name,
              description: desc,
              percentage: pctNum != null ? pctNum : (Number.isFinite(computed) ? computed : undefined),
            };
          })
          .filter((t) => (t.tax_id != null || t.id) && (t.name || t.description || t.percentage != null));

        const variantRows = extract("master_variants", ["variant", "variants", "master_variants", "master_variant"]);
        const normalizedVariants: MasterVariantLite[] = variantRows
          .filter((v: any) => v && (v.status == null || v.status === 1))
          .map((v: any) => {
            const idNum = Number(v.id ?? 0);
            const variantId = String(v.variant_id ?? v.variantId ?? v.code ?? "").trim();
            const variantName = String(v.variant_name ?? v.variantName ?? v.name ?? v.label ?? "").trim();
            const size = String(v.size ?? "").trim();
            const color = String(v.color ?? "").trim();
            const width = String(v.width ?? "").trim();
            const statusNum = v.status != null ? Number(v.status) : undefined;
            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              variant_id: variantId,
              variant_name: variantName,
              size: size || undefined,
              color: color || undefined,
              width: width || undefined,
              status: Number.isFinite(statusNum as any) ? statusNum : undefined,
            };
          })
          .filter((v) => v.id && v.variant_id && v.variant_name);

        const uomRows = extract("master_uom", ["uom", "uoms", "master_uom", "master_uoms"]);
        const normalizedUom: MasterUomLite[] = (uomRows || [])
          .filter((u: any) => u && (u.status == null || u.status === 1))
          .map((u: any) => {
            const idNum = Number(u.id ?? 0);
            const uomIdRaw = u.uom_id ?? u.uomId ?? u.code ?? u.id;
            const uomId = String(uomIdRaw ?? "").trim();
            const desc = String(
              u.description ?? u.desc ?? u.name ?? u.uom ?? u.uom_name ?? u.uomName ?? u.unit ?? u.unit_name ?? u.unitName ?? ""
            ).trim();
            const statusNum = u.status != null ? Number(u.status) : undefined;
            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              // Some schemas only have numeric `id` + `description` (no `uom_id`).
              uom_id: uomId || (Number.isFinite(idNum) && idNum > 0 ? String(idNum) : ""),
              description: desc,
              status: Number.isFinite(statusNum as any) ? statusNum : undefined,
            };
          })
          .filter((u: MasterUomLite) => u.id && u.description);

        if (!cancelled) {
          setMasterInventory(normalized);
          setMasterHsn(normalizedHsn);
          setMasterTax(normalizedTax);
          setMasterVariants(normalizedVariants);
          setMasterUom(normalizedUom);
        }
      } catch (e) {
        console.error("Failed to load master_inventory", e);
        if (!cancelled) {
          setMasterInventory([]);
          setMasterHsn([]);
          setMasterTax([]);
          setMasterVariants([]);
          setMasterUom([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const masterHsnById = useMemo(() => {
    const m = new Map<number, MasterHsnLite>();
    for (const h of masterHsn) m.set(h.id, h);
    return m;
  }, [masterHsn]);

  const masterHsnByCode = useMemo(() => {
    const m = new Map<string, MasterHsnLite>();
    for (const h of masterHsn) m.set(h.hsn_code, h);
    return m;
  }, [masterHsn]);

  const masterTaxById = useMemo(() => {
    const m = new Map<number, MasterTaxLite>();
    for (const t of masterTax) m.set(t.id, t);
    return m;
  }, [masterTax]);

  const masterTaxByTaxId = useMemo(() => {
    const m = new Map<number, MasterTaxLite>();
    for (const t of masterTax) {
      if (t.tax_id != null) m.set(t.tax_id, t);
    }
    return m;
  }, [masterTax]);

  const masterVariantById = useMemo(() => {
    const m = new Map<string, MasterVariantLite>();
    for (const v of masterVariants) m.set(String(v.variant_id), v);
    return m;
  }, [masterVariants]);

  const masterUomByUomId = useMemo(() => {
    const m = new Map<string, MasterUomLite>();
    for (const u of masterUom) {
      const key1 = String(u.uom_id || "").trim();
      if (key1) m.set(key1, u);
      const key2 = String(u.id || "").trim();
      if (key2) m.set(key2, u);
    }
    return m;
  }, [masterUom]);

  const resolveUomLabel = (inv?: MasterInventoryLite): string => {
    if (!inv) return "";
    if (inv.uom) return String(inv.uom).trim();
    if (inv.uom_id) return masterUomByUomId.get(String(inv.uom_id).trim())?.description ?? "";
    return "";
  };

  // Backfill UOM for rows that were loaded/selected before master data finished loading.
  // This also covers edit mode where items may be set after master_inventory was already fetched.
  useEffect(() => {
    if (!masterInventory.length) return;
    if (!items.some((it) => !String(it.uom || "").trim() && String(it.itemName || "").trim())) return;

    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (String(it.uom || "").trim()) return it;
        const name = String(it.itemName || "").trim();
        if (!name) return it;
        const inv = masterInventory.find((m) => String(m.item_name || "").trim().toLowerCase() === name.toLowerCase());
        if (!inv) return it;
        const uom = (inv.uom
          ? String(inv.uom).trim()
          : inv.uom_id
            ? masterUomByUomId.get(String(inv.uom_id).trim())?.description ?? ""
            : "").trim();
        if (!uom) return it;
        changed = true;
        return { ...it, uom };
      });
      return changed ? next : prev;
    });
  }, [items, masterInventory, masterUomByUomId]);

  const resolveHsn = (hsnRef: unknown): { code: string; description: string } => {
    if (hsnRef == null) return { code: "", description: "" };
    const refStr = String(hsnRef).trim();
    if (!refStr) return { code: "", description: "" };

    const refNum = Number(refStr);
    if (Number.isFinite(refNum)) {
      const byId = masterHsnById.get(refNum);
      if (byId) return { code: byId.hsn_code, description: byId.description };
    }

    const byCode = masterHsnByCode.get(refStr);
    if (byCode) return { code: byCode.hsn_code, description: byCode.description };

    // Fallback: treat as code/id without master data
    return { code: refStr, description: "" };
  };

  const resolveTaxLabel = (taxRef: unknown): string => {
    if (taxRef == null) return "";
    if (typeof taxRef === "object") {
      const fromObj = getTaxName(taxRef);
      return fromObj;
    }
    const refStr = String(taxRef).trim();
    if (!refStr) return "";

    const refNum = Number(refStr);
    if (Number.isFinite(refNum)) {
      const row = masterTaxByTaxId.get(refNum) ?? masterTaxById.get(refNum);
      if (row) {
        const base = row.description || row.name;
        const pct = row.percentage != null ? `${row.percentage}%` : "";
        return [base, pct].filter(Boolean).join(" ").trim();
      }
    }

    // Fallback: if it's already a label, return as-is.
    return refStr;
  };

  const resolveTaxPercent = (taxRef: unknown): number => {
    if (taxRef == null) return 0;
    if (Array.isArray(taxRef)) {
      // If multiple taxes are present, pick the max % for display/calculation.
      const pcts = taxRef.map((x) => resolveTaxPercent(x)).filter((n) => Number.isFinite(n));
      return pcts.length ? Math.max(...pcts) : 0;
    }
    if (typeof taxRef === "object") {
      const obj: any = taxRef as any;
      const pct = obj.tax_percentage ?? obj.percentage ?? obj.tax_rate ?? obj.rate ?? obj.taxPercent;
      const direct = parsePercent(pct);
      if (direct != null) return direct;

      // Sometimes the object carries an id/tax_id instead of percentage.
      const maybeId = obj.tax_id ?? obj.id ?? obj.taxId;
      const idNum = Number(maybeId);
      if (Number.isFinite(idNum)) {
        const row = masterTaxById.get(idNum);
        if (row?.percentage != null) return row.percentage;
      }
      return 0;
    }
    const refStr = String(taxRef).trim();
    if (!refStr) return 0;

    // Handle JSON-stringified tax object/array
    if ((refStr.startsWith("{") && refStr.endsWith("}")) || (refStr.startsWith("[") && refStr.endsWith("]"))) {
      try {
        const parsed = JSON.parse(refStr);
        return resolveTaxPercent(parsed);
      } catch {
        // fall through
      }
    }

    const refNum = Number(refStr);
    if (Number.isFinite(refNum)) {
      const row = masterTaxByTaxId.get(refNum) ?? masterTaxById.get(refNum);
      if (row?.percentage != null) return row.percentage;
      // Numeric-looking string is treated as tax_id/id only.
      return 0;
    }

    // Handle label strings containing explicit percentages (e.g., "GST 18%", "Tax 5%")
    if (refStr.includes("%")) {
      const pctFromLabel = parsePercent(refStr);
      if (pctFromLabel != null && !Number.isNaN(pctFromLabel)) return pctFromLabel;
    }
    return 0;
  };

  const resolveTaxId = (taxRef: unknown): number | undefined => {
    if (taxRef == null) return undefined;

    if (Array.isArray(taxRef)) {
      for (const t of taxRef) {
        const v = resolveTaxId(t);
        if (v != null && Number.isFinite(v) && v > 0) return v;
      }
      return undefined;
    }

    if (typeof taxRef === "object") {
      const obj: any = taxRef as any;
      const raw = obj.tax_id ?? obj.taxId ?? obj.taxID ?? obj.id ?? obj.tax_code ?? obj.code;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        const row = masterTaxByTaxId.get(n) ?? masterTaxById.get(n);
        return (row?.tax_id ?? row?.id ?? n) as number;
      }

      const label = getTaxName(obj);
      const pct = parsePercent(obj.tax_percentage ?? obj.percentage ?? obj.tax_rate ?? obj.rate ?? label);
      if (pct != null) {
        const hit = masterTax.find((t) => t.percentage != null && Number(t.percentage) === Number(pct));
        if (hit) return (hit.tax_id ?? hit.id) as number;
      }
      if (label) {
        const norm = label.toLowerCase().replace(/[^a-z0-9]/g, "");
        const hit = masterTax.find((t) => {
          const nm = String(t.name || t.description || "").toLowerCase();
          return nm && nm.replace(/[^a-z0-9]/g, "") === norm;
        });
        if (hit) return (hit.tax_id ?? hit.id) as number;
      }
      return undefined;
    }

    const refStr = String(taxRef).trim();
    if (!refStr) return undefined;

    if ((refStr.startsWith("{") && refStr.endsWith("}")) || (refStr.startsWith("[") && refStr.endsWith("]"))) {
      try {
        const parsed = JSON.parse(refStr);
        return resolveTaxId(parsed);
      } catch {
        // fall through
      }
    }

    const refNum = Number(refStr);
    if (Number.isFinite(refNum) && refNum > 0) {
      const row = masterTaxByTaxId.get(refNum) ?? masterTaxById.get(refNum);
      return (row?.tax_id ?? row?.id ?? refNum) as number;
    }

    const pct = parsePercent(refStr);
    if (pct != null) {
      const hit = masterTax.find((t) => t.percentage != null && Number(t.percentage) === Number(pct));
      if (hit) return (hit.tax_id ?? hit.id) as number;
    }

    const norm = refStr.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = masterTax.find((t) => {
      const nm = String(t.name || t.description || "").toLowerCase();
      return nm && nm.replace(/[^a-z0-9]/g, "") === norm;
    });
    return (hit?.tax_id ?? hit?.id) as number | undefined;
  };

  const updateItem = (id: string, patch: Partial<StockItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        const base = Number(next.quantity || 0) * Number(next.unitPrice || 0);
        const disc = Math.max(Number(next.discount || 0), 0);
        next.total = Math.max(base - disc, 0);
        return next;
      })
    );
  };

  useEffect(() => {
    if (!pendingFocus) return;
    const { rowId, field } = pendingFocus;
    const el =
      field === "item"
        ? itemInputRefs.current[rowId]
        : field === "variant"
          ? variantTriggerRefs.current[rowId]
          : qtyInputRefs.current[rowId];
    // Wait a tick so the input exists after state updates.
    const raf = window.requestAnimationFrame(() => {
      el?.focus();
      if (field !== "item") {
        try {
          (el as HTMLInputElement | null)?.select?.();
        } catch {
          // ignore
        }
      }
    });
    setPendingFocus(null);
    return () => window.cancelAnimationFrame(raf);
  }, [pendingFocus]);

  // When the variant picker opens, focus its search input.
  useEffect(() => {
    if (!variantPickerRowId) return;
    const raf = window.requestAnimationFrame(() => {
      variantSearchInputRef.current?.focus();
      try {
        variantSearchInputRef.current?.select?.();
      } catch {
        // ignore
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [variantPickerRowId]);

  const selectInventoryItem = (rowId: string, prod: MasterInventoryLite) => {
    const hsn = resolveHsn(prod.hsn_code);
    const taxLabel = resolveTaxLabel(prod.tax);
    const taxPercent = resolveTaxPercent(prod.tax);
    const taxId = resolveTaxId(prod.tax);
    updateItem(rowId, {
      itemName: prod.item_name,
      variantId: "",
      variantName: "",
      uom: resolveUomLabel(prod),
      batchNo: "",
      hsnCode: hsn.code,
      hsnDesc: hsn.description,
      taxName: taxLabel,
      taxId,
      brand: prod.brand ?? "",
      taxPercent,
      unitPrice: Number(prod.purchase_price ?? prod.selling_price ?? 0) || 0,
    });
    setItemPickerRowId(null);
    setItemPickerQuery("");

    // After selecting an item, move to Variant.
    setVariantPickerRowId(rowId);
    setVariantPickerQuery("");
    setPendingFocus({ rowId, field: "variant" });
  };

  const handleBarcodeScan = () => {
    const code = String(barcodeScan || "").trim();
    if (!code) return;

    const hit = masterInventory.find((m) => String(m.barcode || "").trim() === code);
    if (!hit) {
      toast({ title: "Barcode not found" });
      return;
    }

    const targetRow = items.find((x) => !String(x.itemName || "").trim());
    const rowId = targetRow?.id ?? createRowId();
    if (!targetRow) {
      setItems((prev) => [
        ...prev,
        {
          id: rowId,
          itemName: "",
          variantId: "",
          variantName: "",
          uom: "",
          batchNo: "",
          hsnCode: "",
          hsnDesc: "",
          taxName: "",
          taxId: undefined,
          brand: "",
          taxPercent: 0,
          discount: 0,
          quantity: 0,
          unitPrice: 0,
          total: 0,
        },
      ]);
    }

    // Select item and jump to variant.
    selectInventoryItem(rowId, hit);
    setBarcodeScan("");
  };

  const addItem = (opts?: { focus?: boolean }) => {
    const id = createRowId();
    setItems((prev) => [
      ...prev,
      {
        id,
        itemName: "",
        variantId: "",
        variantName: "",
        uom: "",
        batchNo: "",
        hsnCode: "",
        hsnDesc: "",
        taxName: "",
        taxId: undefined,
        brand: "",
        taxPercent: 0,
        discount: 0,
        quantity: 0,
        unitPrice: 0,
        total: 0,
      },
    ]);
    if (opts?.focus !== false) setPendingFocus({ rowId: id, field: "item" });
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      return next.length > 0
        ? next
        : [
            {
              id: "1",
              itemName: "",
              variantId: "",
              variantName: "",
              uom: "",
              batchNo: "",
              hsnCode: "",
              hsnDesc: "",
              taxName: "",
              taxId: undefined,
              brand: "",
              taxPercent: 0,
              discount: 0,
              quantity: 0,
              unitPrice: 0,
              total: 0,
            },
          ];
    });
  };

  const subtotal = useMemo(() => items.reduce((s, it) => s + (Number(it.total) || 0), 0), [items]);
  const discountSafe = Math.max(Number(discount || 0), 0);
  const discountApplied = Math.min(discountSafe, subtotal);
  const taxableBase = Math.max(subtotal - discountApplied, 0);
  const deliveryChargeSafe = Math.max(Number(deliveryCharge || 0), 0);
  const totalTax = useMemo(
    () => (taxExempt ? 0 : items.reduce((s, it) => s + (Number(it.total || 0) * (Number(it.taxPercent || 0) / 100)), 0)),
    [items, taxExempt]
  );
  const cgst = totalTax / 2;
  const sgst = totalTax / 2;
  const grandTotalExact = taxableBase + cgst + sgst + deliveryChargeSafe;
  const grandTotalRounded = Math.round(grandTotalExact);
  const roundOff = Number((grandTotalRounded - grandTotalExact).toFixed(2));

  const paidTotal = useMemo(
    () =>
      Object.values(paymentByMode)
        .map((n) => Number(n || 0))
        .reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0),
    [paymentByMode]
  );

  const balanceDue = Math.max(grandTotalRounded - paidTotal, 0);

  const resetForm = () => {
    setSupplierId("");
    setEntryDate(format(new Date(), "yyyy-MM-dd"));
    setBillDate(format(new Date(), "yyyy-MM-dd"));
    setBillNo("");
    setTaxExempt(false);
    setRemarks("");

    setDiscount(0);
    setDeliveryCharge(0);
    setPaymentModes([]);
    setPaymentByMode({});

    nextRowIdRef.current = 2;
    setItems([
      {
        id: "1",
        itemName: "",
        variantId: "",
        variantName: "",
        uom: "",
        batchNo: "",
        hsnCode: "",
        hsnDesc: "",
        taxName: "",
        taxId: undefined,
        brand: "",
        taxPercent: 0,
        discount: 0,
        quantity: 0,
        unitPrice: 0,
        total: 0,
      },
    ]);
    setItemPickerRowId(null);
    setItemPickerQuery("");
    setPendingFocus({ rowId: "1", field: "item" });
  };

  // Load Stock In for edit
  useEffect(() => {
    if (!isEditing) return;
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res: any = await ApiService.post("/stock-in/get", {
          account_code: acc,
          retail_code: ret,
          stockin_id: stockinId,
        });
        const data = res?.data ?? res;
        const header = data?.header ?? {};
        const lines = Array.isArray(data?.items) ? data.items : [];
        const pays = Array.isArray(data?.payments) ? data.payments : [];

        if (cancelled) return;

        setSupplierId(String(header?.supplier_id ?? "").trim());
        setEntryDate(String(header?.received_date ?? "").slice(0, 10) || format(new Date(), "yyyy-MM-dd"));
        setBillDate(String(header?.invoice_date ?? "").slice(0, 10) || format(new Date(), "yyyy-MM-dd"));
        setBillNo(String(header?.invoice_no ?? "").trim());
        setTaxExempt(Boolean(header?.tax_exempt) || header?.tax_exempt === 1);
        setRemarks(String(header?.remarks ?? ""));
        setDiscount(Number(header?.discount ?? 0) || 0);
        setDeliveryCharge(Number(header?.delivery_charge ?? header?.deliveryCharge ?? 0) || 0);

        const nextItems: StockItem[] = (lines as any[]).map((l, idx) => {
          const qty = Number(l?.quantity ?? 0) || 0;
          const unit = Number(l?.unit_price ?? 0) || 0;
          const disc = Number(l?.discount ?? 0) || 0;
          const total = Math.max(qty * unit - disc, 0);
          return {
            id: String(idx + 1),
            itemName: String(l?.item_name ?? "").trim(),
            variantId: String(l?.variant_id ?? l?.variantId ?? "").trim(),
            variantName: String(l?.variant_name ?? l?.variantName ?? "").trim(),
            uom: String(l?.uom ?? l?.unit ?? l?.uom_name ?? l?.unit_name ?? "").trim(),
            batchNo: String(l?.batch_no ?? l?.batchNo ?? l?.batch_number ?? l?.batchNumber ?? "").trim(),
            hsnCode: String(l?.hsn_code ?? "").trim(),
            hsnDesc: "",
            taxName: String(l?.tax_name ?? "").trim(),
            taxId: Number(l?.tax_id ?? l?.taxId ?? l?.taxID) || undefined,
            brand: String(l?.brand ?? "").trim(),
            taxPercent: Number(l?.tax_percent ?? 0) || 0,
            discount: disc,
            quantity: qty,
            unitPrice: unit,
            total,
          };
        });

        nextRowIdRef.current = Math.max(nextItems.length + 1, 2);
        setItems(
          nextItems.length
            ? nextItems
            : [
                {
                  id: "1",
                  itemName: "",
                  variantId: "",
                  variantName: "",
                  uom: "",
                  batchNo: "",
                  hsnCode: "",
                  hsnDesc: "",
                  taxName: "",
                  taxId: undefined,
                  brand: "",
                  taxPercent: 0,
                  discount: 0,
                  quantity: 0,
                  unitPrice: 0,
                  total: 0,
                },
              ]
        );

        const modeSet = new Set<string>();
        const byMode: Record<string, number> = {};
        for (const p of pays as any[]) {
          const mode = String(p?.pay_mode ?? "").trim().toLowerCase();
          if (!mode) continue;
          modeSet.add(mode);
          byMode[mode] = (byMode[mode] || 0) + (Number(p?.amount ?? 0) || 0);
        }
        setPaymentModes(Array.from(modeSet));
        setPaymentByMode(byMode);
      } catch (e: any) {
        console.error("Failed to load Stock In", e);
        if (!cancelled) toast({ title: "Load failed", description: e?.message || String(e), variant: "warning" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditing, stockinId, user]);

  const setPaymentForMode = (mode: string, amount: number) => {
    const safe = Math.max(Number(amount || 0), 0);
    const otherTotal = paymentModes
      .filter((m) => m !== mode)
      .reduce((s, m) => s + (Number(paymentByMode[m] || 0) || 0), 0);

    const allowed = Math.max(grandTotalRounded - otherTotal, 0);
    const clamped = Math.min(safe, allowed);

    if (safe > allowed + 0.0001) {
      const label = PAYMENT_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
      toast({
        title: "Payment exceeds total",
        description: `Max allowed for ${label} is ₹${allowed.toFixed(0)}.`,
        variant: "warning",
      });
    }

    setPaymentByMode((prev) => ({ ...prev, [mode]: clamped }));
  };

  const removePaymentMode = (mode: string) => {
    setPaymentModes((prev) => prev.filter((x) => x !== mode));
    setPaymentByMode((prev) => {
      const next = { ...prev };
      delete next[mode];
      return next;
    });
  };

  const setPaymentPercent = (pct: number) => {
    const amt = Math.round((grandTotalRounded * pct) / 100);
    // If exactly one mode is selected, fill that mode.
    if (paymentModes.length === 1) {
      setPaymentForMode(paymentModes[0], amt);
      return;
    }
    // Otherwise, keep current split and just ensure total doesn't exceed.
    // (User can manually split across modes.)
  };

  const submitStockIn = async (endpoint: string, payload: any, toastTitleOverride?: string) => {
    setLoading(true);
    try {
      const res: any = await ApiService.post(endpoint, payload);
      const data = res?.data ?? res;

      const id = String(data?.stockin_id ?? stockinId ?? "").trim();
      setSuccessStockInId(id);
      setSuccessOpen(true);

      toast({
        title: toastTitleOverride ?? (isEditing ? "Stock In updated" : "Stock In saved"),
        description: id ? `Saved as ${id}` : "Saved successfully.",
      });
    } catch (e: any) {
      console.error("Stock In save failed", e);
      toast({ title: "Save failed", description: e?.message || String(e), variant: "warning" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (billstatus: "Y" | "N" | "C" = "Y") => {
    if (!user) {
      toast({ title: "Not logged in", description: "Please login again.", variant: "warning" });
      return;
    }

    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) {
      toast({ title: "Missing scope", description: "account_code / retail_code missing.", variant: "warning" });
      return;
    }

    if (!supplierId) {
      toast({ title: "Select supplier", description: "Supplier is required.", variant: "warning" });
      return;
    }

    const zeroMode = paymentModes.find((m) => Number(paymentByMode[m] || 0) <= 0);
    if (zeroMode) {
      const label = PAYMENT_MODE_OPTIONS.find((o) => o.value === zeroMode)?.label ?? zeroMode;
      toast({ title: "Enter payment amount", description: `Enter amount for ${label}.`, variant: "warning" });
      return;
    }

    if (paidTotal > grandTotalRounded + 0.0001) {
      toast({
        title: "Payment exceeds total",
        description: "Paid total cannot be more than total amount.",
        variant: "warning",
      });
      return;
    }

    const cleanedItems = items
      .map((x) => ({
        inventory_id: (masterInventory.find((m) => m.item_name === x.itemName)?.id ?? undefined) as any,
        product_id: masterInventory.find((m) => m.item_name === x.itemName)?.product_id,
        item_name: x.itemName,
        variant_id: x.variantId || undefined,
        variant_name: x.variantId
          ? ((masterVariantById.get(String(x.variantId))?.variant_name ?? x.variantName) || undefined)
          : undefined,
        uom_id: masterInventory.find((m) => m.item_name === x.itemName)?.uom_id,
        uom: String(x.uom || resolveUomLabel(masterInventory.find((m) => m.item_name === x.itemName))).trim() || undefined,
        batch_no: String(x.batchNo || "").trim() || undefined,
        brand: x.brand,
        hsn_code: x.hsnCode,
        tax_name: x.taxName,
        tax_id: x.taxId ?? undefined,
        tax_percent: Number(x.taxPercent || 0),
        discount: Number(x.discount || 0),
        quantity: Number(x.quantity || 0),
        unit_price: Number(x.unitPrice || 0),
      }))
      .filter((x) => String(x.item_name || "").trim() && Number(x.quantity || 0) > 0);

    // Variant is mandatory for any item line with Qty > 0.
    const missingVariant = items.find((x) => String(x.itemName || "").trim() && Number(x.quantity || 0) > 0 && !String(x.variantId || "").trim());
    if (missingVariant) {
      toast({
        title: "Select variant",
        description: `Variant is required for ${missingVariant.itemName || "this item"}.`,
        variant: "warning",
      });
      setVariantPickerRowId(missingVariant.id);
      setVariantPickerQuery("");
      setPendingFocus({ rowId: missingVariant.id, field: "variant" });
      return;
    }

    if (cleanedItems.length === 0) {
      toast({ title: "Add items", description: "Add at least one item with Qty > 0.", variant: "warning" });
      return;
    }

    const payments = paymentModes
      .map((mode) => ({ pay_mode: mode, amount: Number(paymentByMode[mode] || 0) }))
      .filter((p) => p.pay_mode && Number(p.amount || 0) > 0);

    const supplierName = suppliers.find((s) => s.id === supplierId)?.name;

    const payload = {
      account_code: acc,
      retail_code: ret,
      ...(isEditing ? { stockin_id: stockinId } : {}),
      supplier_id: supplierId,
      supplier_name: supplierName,
      received_date: entryDate || undefined,
      invoice_date: billDate || undefined,
      invoice_no: billNo || undefined,
      tax_exempt: !!taxExempt,
      remarks: remarks || undefined,
      discount: Number(discountApplied || 0),
      delivery_charge: Number(deliveryChargeSafe || 0),
      items: cleanedItems,
      payments,
      billstatus,
    };

    const endpoint = isEditing ? "/stock-in/update" : "/stock-in/create";

    const toastTitle = billstatus === "N" ? "Stock In held" : billstatus === "C" ? "Stock In cancelled" : undefined;

    // Confirm when creating stock-in with no payment OR any pending balance.
    // Proceed only after explicit confirmation.
    if (billstatus === "Y") {
      const hasTotal = Number(grandTotalRounded || 0) > 0;
      if (hasTotal && paidTotal <= 0.0001) {
        confirmPayloadRef.current = payload;
        confirmEndpointRef.current = endpoint;
        setConfirmKind("noPayment");
        setConfirmBalance(balanceDue);
        setConfirmOpen(true);
        return;
      }

      if (hasTotal && balanceDue > 0.0001) {
        confirmPayloadRef.current = payload;
        confirmEndpointRef.current = endpoint;
        setConfirmKind("balance");
        setConfirmBalance(balanceDue);
        setConfirmOpen(true);
        return;
      }
    }

    await submitStockIn(endpoint, payload, toastTitle);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (loading) return;

      if (e.key === "F2") {
        e.preventDefault();
        addItem();
        return;
      }

      if (e.key === "F8") {
        e.preventDefault();
        if (itemPickerRowId) return;
        setHoldConfirmOpen(true);
        return;
      }

      if (e.key === "F9") {
        if (!isEditing) return;
        e.preventDefault();
        setCancelConfirmOpen(true);
        return;
      }

      if (e.key === "F10") {
        e.preventDefault();
        if (itemPickerRowId) return;
        void handleCreate("Y");
        return;
      }

      if (e.key === "Escape") {
        // Close overlays first, then fall back to Back navigation.
        if (holdConfirmOpen) {
          e.preventDefault();
          setHoldConfirmOpen(false);
          return;
        }
        if (cancelConfirmOpen) {
          e.preventDefault();
          setCancelConfirmOpen(false);
          return;
        }
        if (confirmOpen) {
          e.preventDefault();
          setConfirmOpen(false);
          return;
        }
        if (successOpen) {
          e.preventDefault();
          setSuccessOpen(false);
          return;
        }
        if (itemPickerRowId) {
          e.preventDefault();
          setItemPickerRowId(null);
          setItemPickerQuery("");
          return;
        }
        if (supplierOpen) {
          e.preventDefault();
          setSupplierOpen(false);
          return;
        }
        if (paymentModeOpen) {
          e.preventDefault();
          setPaymentModeOpen(false);
          return;
        }

        e.preventDefault();
        navigate("/inventory/stock-in");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    addItem,
    cancelConfirmOpen,
    confirmOpen,
    handleCreate,
    holdConfirmOpen,
    isEditing,
    itemPickerRowId,
    loading,
    navigate,
    paymentModeOpen,
    successOpen,
    supplierOpen,
  ]);

  return (
    <form
      autoComplete="off"
      className="min-h-screen bg-slate-50"
      onKeyDownCapture={(e) => {
        if (e.key !== "Enter") return;
        if (e.defaultPrevented) return;

        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target instanceof HTMLTextAreaElement) return;
        if (target instanceof HTMLButtonElement) return;

        // Allow Enter to be handled by cmdk inputs (Command / combobox search inputs).
        if (target instanceof HTMLInputElement) {
          const isCmdkInput = target.hasAttribute("cmdk-input");
          if (isCmdkInput) return;
        }

        // Prevent implicit form submit when pressing Enter in inputs.
        // Specific inputs (e.g., Qty) handle Enter themselves.
        if (target instanceof HTMLInputElement) e.preventDefault();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (itemPickerRowId) return;
        if (!loading) void handleCreate();
      }}
    >
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="w-[95vw] max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-base">{isEditing ? "Stock In Updated" : "Stock In Created"}</DialogTitle>
            <DialogDescription>
              {successStockInId ? (
                <span>
                  Stock In saved successfully. Reference: <span className="font-semibold">{successStockInId}</span>
                </span>
              ) : (
                <span>Stock In saved successfully.</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (isEditing) {
                  setSuccessOpen(false);
                  navigate("/inventory/stock-in");
                  return;
                }

                setSuccessOpen(false);
                setSuccessStockInId("");
                resetForm();
              }}
            >
              {isEditing ? "Back to List" : "Create Another"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSuccessOpen(false);
                navigate("/inventory/stock-in");
              }}
            >
              Go to List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">
              {confirmKind === "noPayment" ? "No Payment Entered" : "Balance Pending"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-700">
              {confirmKind === "noPayment" ? (
                <span>
                  No payment was entered. This will create a balance of{" "}
                  <span className="font-semibold text-red-600">₹{Number(confirmBalance || 0).toFixed(0)}</span>. Continue?
                </span>
              ) : (
                <span>
                  A balance of{" "}
                  <span className="font-semibold text-red-600">₹{Number(confirmBalance || 0).toFixed(0)}</span> is pending. Continue saving?
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                setConfirmKind(null);
                const payload = confirmPayloadRef.current;
                const endpoint = confirmEndpointRef.current;
                confirmPayloadRef.current = null;
                confirmEndpointRef.current = "";
                if (!payload || !endpoint) return;
                void submitStockIn(endpoint, payload);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={holdConfirmOpen} onOpenChange={setHoldConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-700">Hold Stock In</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-700">
              This will mark the bill status as <span className="font-semibold text-amber-700">N</span> (Hold). Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                setHoldConfirmOpen(false);
                void handleCreate("N");
              }}
            >
              Yes, Hold
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

        <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600">Cancel Stock In</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-700">
                This will mark the bill status as <span className="font-semibold text-red-600">C</span> (Cancelled). Continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={loading}
                onClick={(e) => {
                  e.preventDefault();
                  setCancelConfirmOpen(false);
                  void handleCreate("C");
                }}
              >
                Yes, Cancel
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      <h1 className="sr-only">Stock In</h1>

      <div className="w-full px-1 lg:px-2">
        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-3">
            {/* Supplier & Invoice */}
            <Card className="border-0 bg-white rounded-xl overflow-visible">
              <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1 rounded-full bg-blue-600/80" aria-hidden="true" />
                    <CardTitle className="text-base font-semibold tracking-tight text-slate-900">Stock In Details</CardTitle>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => navigate("/inventory/stock-in")}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back (Esc)
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">
                      Supplier <RequiredMark />
                    </Label>
                    <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={supplierOpen}
                          className="flex w-full items-center justify-between px-2 py-1.5 ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-9 text-sm border border-slate-300 focus:border-blue-500 rounded bg-white"
                        >
                          <span style={{ pointerEvents: "none" }}>
                            {supplierId ? suppliers.find((s) => s.id === supplierId)?.name ?? "Select supplier" : "Select supplier"}
                          </span>
                          <ArrowUpDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search supplier..." className="h-9" />
                          <CommandList>
                            <CommandEmpty>No suppliers found.</CommandEmpty>
                            <CommandGroup>
                              {suppliers.map((s) => {
                                const selected = supplierId === s.id;
                                return (
                                  <CommandItem
                                    key={s.id}
                                    value={s.name}
                                    onSelect={() => {
                                      setSupplierId(s.id);
                                      setSupplierOpen(false);
                                    }}
                                  >
                                    <Check className={["mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0"].join(" ")} />
                                    <span className="truncate">{s.name}</span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">
                      Received Date <RequiredMark />
                    </Label>
                    <Input
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      className="h-9 text-sm bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Invoice Date</Label>
                    <Input
                      type="date"
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      className="h-9 text-sm bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Invoice No</Label>
                    <div className="relative">
                      <ReceiptText className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        value={billNo}
                        onChange={(e) => setBillNo(e.target.value)}
                        placeholder="Enter invoice number"
                        className="h-9 text-sm pl-9 bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Notes</Label>
                    <Input
                      placeholder="Add notes..."
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className="h-9 text-sm bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Scan Barcode</Label>
                    <Input
                      placeholder="Scan barcode..."
                      value={barcodeScan}
                      onChange={(e) => setBarcodeScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        handleBarcodeScan();
                      }}
                      className="h-9 text-sm bg-white border-red-400 focus-visible:border-red-500 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stock Items */}
            <Card className="border-0 bg-white rounded-xl overflow-visible">
              <CardContent className="p-2">
                <div className="relative rounded-lg border border-slate-200 overflow-auto max-h-[320px]">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[48px]">#</th>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[280px] min-w-[280px]">
                          <div className="flex items-center justify-between gap-2">
                            <span>
                              Item <span className="text-red-500">*</span>
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addItem()}
                              className="h-7 px-2 text-[10px]"
                            > 
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add Row (F2)
                            </Button>
                          </div>
                        </th>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[180px]">
                          Variant <span className="text-red-500">*</span>
                        </th>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[140px]">Batch No</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[120px]">Disc</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[120px]">Tax Amt</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[110px]">
                          Qty <span className="text-red-500">*</span>
                        </th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[140px]">Unit Price</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[140px]">Amount</th>
                        <th className="h-8 px-2 text-center text-xs font-semibold text-slate-600 w-[56px]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={it.id} className="border-t border-slate-200">
                          <td className="px-2 py-1.5 text-xs text-slate-700">{idx + 1}</td>
                          <td className="px-2 py-1.5">
                            <div className="relative">
                              <Popover
                                open={itemPickerRowId === it.id}
                                onOpenChange={(open) => {
                                  if (open) {
                                    setItemPickerRowId(it.id);
                                    setItemPickerQuery("");
                                  } else {
                                    setItemPickerRowId(null);
                                    setItemPickerQuery("");
                                  }
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    ref={(el) => {
                                      itemInputRefs.current[it.id] = el;
                                    }}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    role="combobox"
                                    className="h-10 w-full justify-between bg-white border-slate-300"
                                  >
                                    <div className="flex flex-col items-start min-w-0">
                                      <span
                                        className={
                                          it.itemName ? "truncate text-xs text-slate-900" : "truncate text-xs text-muted-foreground"
                                        }
                                      >
                                        {it.itemName || "Select item"}
                                      </span>
                                      {(() => {
                                        const meta = [String(it.uom || "").trim(), String(it.brand || "").trim()]
                                          .filter(Boolean)
                                          .join(" / ");
                                        return meta ? (
                                          <span className="truncate text-[10px] text-slate-500 leading-tight" title={meta}>
                                            {meta}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] leading-tight">&nbsp;</span>
                                        );
                                      })()}
                                    </div>
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                  </Button>
                                </PopoverTrigger>

                                <PopoverContent
                                  className="w-[--radix-popover-trigger-width] p-0"
                                  align="start"
                                  side="bottom"
                                  collisionPadding={8}
                                >
                                  <Command>
                                    <CommandInput
                                      placeholder="Search item..."
                                      className="h-9"
                                      value={itemPickerQuery}
                                      onValueChange={setItemPickerQuery}
                                    />
                                    <CommandList>
                                      <CommandEmpty>No items found.</CommandEmpty>
                                      <CommandGroup>
                                        {masterInventory
                                          .filter((p) => {
                                            const q = itemPickerQuery.trim().toLowerCase();
                                            if (!q) return true;
                                            return p.item_name.toLowerCase().includes(q);
                                          })
                                          .slice(0, 50)
                                          .map((p) => (
                                            <CommandItem
                                              key={p.id}
                                              value={p.item_name}
                                              onSelect={() => selectInventoryItem(it.id, p)}
                                            >
                                              <div className="flex w-full items-center justify-between gap-2">
                                                <span className="truncate">{p.item_name}</span>
                                                {p.brand ? (
                                                  <span className="text-[10px] text-slate-500 truncate max-w-[45%]">{p.brand}</span>
                                                ) : null}
                                              </div>
                                            </CommandItem>
                                          ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <Popover
                              open={variantPickerRowId === it.id}
                              onOpenChange={(open) => {
                                if (!it.itemName.trim()) return;
                                if (open) {
                                  setVariantPickerRowId(it.id);
                                  setVariantPickerQuery("");
                                } else {
                                  setVariantPickerRowId(null);
                                  setVariantPickerQuery("");
                                }
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  ref={(el) => {
                                    variantTriggerRefs.current[it.id] = el;
                                  }}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  role="combobox"
                                  disabled={!it.itemName.trim()}
                                  className="h-8 w-full justify-between text-xs bg-white border-slate-300"
                                >
                                  <span className={it.variantId ? "truncate text-slate-900" : "truncate text-muted-foreground"}>
                                    {it.variantId
                                      ? (() => {
                                          const v = masterVariantById.get(String(it.variantId));
                                          const meta = [v?.size, v?.color].filter(Boolean).join(" / ");
                                          return meta ? `${v?.variant_name ?? it.variantName} (${meta})` : (v?.variant_name ?? it.variantName);
                                        })()
                                      : "Select variant"}
                                  </span>
                                  <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                              </PopoverTrigger>

                              <PopoverContent
                                className="w-[--radix-popover-trigger-width] p-0"
                                align="start"
                                side="bottom"
                                collisionPadding={8}
                              >
                                <Command>
                                  <CommandInput
                                    placeholder="Search variant..."
                                    className="h-9"
                                    ref={variantPickerRowId === it.id ? variantSearchInputRef : undefined}
                                    value={variantPickerQuery}
                                    onValueChange={setVariantPickerQuery}
                                  />
                                  <CommandList>
                                    <CommandEmpty>No variants found.</CommandEmpty>
                                    <CommandGroup>
                                      {masterVariants
                                        .filter((v) => {
                                          const q = variantPickerQuery.trim().toLowerCase();
                                          if (!q) return true;
                                          const hay = [v.variant_name, v.variant_id, v.size, v.color, v.width]
                                            .filter(Boolean)
                                            .join(" ")
                                            .toLowerCase();
                                          return hay.includes(q);
                                        })
                                        .slice(0, 50)
                                        .map((v) => (
                                          <CommandItem
                                            key={String(v.id)}
                                            value={String(v.variant_id)}
                                            onSelect={() => {
                                              updateItem(it.id, { variantId: String(v.variant_id), variantName: v.variant_name });
                                              setVariantPickerRowId(null);
                                              setVariantPickerQuery("");
                                              setPendingFocus({ rowId: it.id, field: "qty" });
                                            }}
                                          >
                                            <div className="flex w-full items-center justify-between gap-2">
                                              <span className="truncate">{v.variant_name}</span>
                                              <span className="text-[10px] text-slate-500 truncate max-w-[55%]">
                                                {[v.size, v.color].filter(Boolean).join(" / ")}
                                              </span>
                                            </div>
                                          </CommandItem>
                                        ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              value={it.batchNo}
                              onChange={(e) => updateItem(it.id, { batchNo: e.target.value })}
                              placeholder="Batch No"
                              className="h-8 text-xs bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              inputMode="decimal"
                              value={it.discount}
                              onChange={(e) => updateItem(it.id, { discount: Number(e.target.value || 0) })}
                              placeholder="0"
                              className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-800">
                            ₹{(
                              taxExempt
                                ? 0
                                : (Number(it.total || 0) * (Number(it.taxPercent || 0) / 100))
                            ).toFixed(2)}
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={it.quantity}
                              ref={(el) => {
                                qtyInputRefs.current[it.id] = el;
                              }}
                              onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value || 0) })}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();

                                // Variant is mandatory before proceeding from Qty.
                                if (it.itemName.trim() && !String(it.variantId || "").trim()) {
                                  setVariantPickerRowId(it.id);
                                  setVariantPickerQuery("");
                                  setPendingFocus({ rowId: it.id, field: "variant" });
                                  return;
                                }

                                const qtyVal = Number((e.currentTarget as HTMLInputElement).value || 0);
                                if (!(qtyVal > 0)) {
                                  setPendingFocus({ rowId: it.id, field: "qty" });
                                  return;
                                }

                                const rowIndex = items.findIndex((x) => x.id === it.id);
                                const nextRow = rowIndex >= 0 ? items[rowIndex + 1] : undefined;
                                if (nextRow) {
                                  setPendingFocus({ rowId: nextRow.id, field: "item" });
                                  return;
                                }

                                // If it's the last row, auto-add a new row (only when current row has an item).
                                if (!it.itemName.trim()) {
                                  setPendingFocus({ rowId: it.id, field: "item" });
                                  return;
                                }

                                addItem({ focus: true });
                              }}
                              className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              inputMode="decimal"
                              value={it.unitPrice}
                              onChange={(e) => updateItem(it.id, { unitPrice: Number(e.target.value || 0) })}
                              placeholder="0"
                              className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-800">₹{(it.total || 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeItem(it.id)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Stock In Summary */}
            <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen}>
              <Card className="border-0 bg-white rounded-xl overflow-hidden">
                <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-1 rounded-full bg-blue-600/80" aria-hidden="true" />
                      <CardTitle className="text-base font-semibold tracking-tight text-slate-900">Stock In Summary</CardTitle>
                    </div>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className={[
                          "inline-flex items-center gap-1 px-4 h-8 rounded-full border border-blue-500 bg-white text-blue-700 font-semibold text-xs shadow-sm transition-all",
                          summaryOpen ? "bg-blue-50" : "bg-white"
                        ].join(" ")}
                        style={{ minWidth: 80 }}
                      >
                        <span>{summaryOpen ? "Close" : "Open"}</span>
                        <ChevronDown className={["ml-1 h-4 w-4 transition-transform", summaryOpen ? "rotate-180" : ""].join(" ")} />
                      </button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2 p-2">
                  <CollapsibleContent className="space-y-2">
                    <div className="space-y-2 bg-gray-50/80 p-2 rounded-lg border border-gray-100">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-600">Subtotal</span>
                        <span className="font-medium text-gray-800 tabular-nums">₹{subtotal.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-600">Delivery Charge</span>
                        <span className="font-medium text-gray-800 tabular-nums">₹{deliveryChargeSafe.toFixed(2)}</span>
                      </div>

                      <div className="pt-1 border-t border-gray-200 space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">CGST</span>
                          <span className="font-medium text-gray-800 tabular-nums">₹{cgst.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">SGST</span>
                          <span className="font-medium text-gray-800 tabular-nums">₹{sgst.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">Round Off</span>
                          <span className="font-medium text-gray-800 tabular-nums">₹{roundOff.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-stretch">
                    <div className="md:col-span-4 space-y-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-[12px] font-semibold text-slate-700">Discount</Label>
                          <Input
                            type="number"
                            value={discount}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              const safe = Number.isFinite(next) ? Math.max(next, 0) : 0;
                              const clamped = Math.min(safe, subtotal);
                              if (safe > subtotal) {
                                toast({
                                  title: "Invalid discount",
                                  description: "Discount cannot be more than subtotal.",
                                  variant: "warning",
                                });
                              }
                              setDiscount(clamped);
                            }}
                            className="h-8 w-24 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                          />
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Label className="text-[12px] font-semibold text-slate-700">Delivery Charge</Label>
                          <Input
                            type="number"
                            value={deliveryCharge}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              const safe = Number.isFinite(next) ? Math.max(next, 0) : 0;
                              setDeliveryCharge(safe);
                            }}
                            className="h-8 w-24 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                          />
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Label className="text-[12px] font-semibold text-slate-700">Tax Exempt</Label>
                          <Switch checked={taxExempt} onCheckedChange={setTaxExempt} className="scale-90" />
                        </div>
                      </div>

                      <div className="bg-green-50 p-4 min-h-[120px] rounded-lg border-2 border-green-600 flex flex-col justify-center shadow-sm">
                        <div className="text-center text-sm text-green-800 font-semibold tracking-tight">Total Amount</div>
                        <div className="text-center text-2xl font-bold text-green-800 tabular-nums">₹{grandTotalRounded.toFixed(0)}</div>
                      </div>
                    </div>

                    {/* Segment 2: Paymode */}
                    <div className="md:col-span-4 rounded-lg border border-slate-200 bg-white p-2">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-end">
                        <div className="md:col-span-8 space-y-1">
                          <Label className="text-[12px] font-semibold text-slate-700">Payment Mode</Label>
                          <Popover open={paymentModeOpen} onOpenChange={setPaymentModeOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                role="combobox"
                                aria-expanded={paymentModeOpen}
                                className="h-9 w-full justify-between"
                              >
                                <span className="flex flex-wrap items-center gap-1 min-w-0">
                                  {paymentModes.length === 0 ? (
                                    <span className="text-xs text-muted-foreground">Select payment modes</span>
                                  ) : (
                                    paymentModes
                                      .map((v) => PAYMENT_MODE_OPTIONS.find((o) => o.value === v)?.label)
                                      .filter(Boolean)
                                      .map((label) => (
                                        <Badge key={String(label)} variant="secondary" className="text-[10px]">
                                          {label}
                                        </Badge>
                                      ))
                                  )}
                                </span>
                                <ArrowUpDown className="h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search payment mode..." className="h-9" />
                                <CommandList>
                                  <CommandEmpty>No payment modes found.</CommandEmpty>
                                  <CommandGroup>
                                    {PAYMENT_MODE_OPTIONS.map((opt) => {
                                      const selected = paymentModes.includes(opt.value);
                                      return (
                                        <CommandItem
                                          key={opt.value}
                                          value={opt.label}
                                          onSelect={() => {
                                            if (!selected) {
                                              const missing = paymentModes.find((m) => Number(paymentByMode[m] || 0) <= 0);
                                              if (missing) {
                                                const label = PAYMENT_MODE_OPTIONS.find((o) => o.value === missing)?.label ?? missing;
                                                toast({
                                                  title: "Enter amount first",
                                                  description: `Enter amount for ${label} before adding another payment mode.`,
                                                  variant: "warning",
                                                });
                                                return;
                                              }
                                            }
                                            setPaymentModes((prev) => {
                                              const selected = prev.includes(opt.value);
                                              const next = selected ? prev.filter((x) => x !== opt.value) : [...prev, opt.value];
                                              return next;
                                            });
                                            setPaymentByMode((prev) => {
                                              const selected = paymentModes.includes(opt.value);
                                              const next = { ...prev };
                                              if (selected) {
                                                delete next[opt.value];
                                              } else {
                                                if (next[opt.value] == null) next[opt.value] = 0;
                                              }
                                              return next;
                                            });
                                          }}
                                        >
                                          <span className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded border">
                                            {selected ? <Check className="h-3.5 w-3.5" /> : null}
                                          </span>
                                          <span className="truncate">{opt.label}</span>
                                        </CommandItem>
                                      );
                                    })}

                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>

                        <div className="md:col-span-4 space-y-1">
                          <Label className="text-[12px] font-semibold text-slate-700">Balance</Label>
                          <div
                            className={[
                              "h-9 px-2 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-end text-xs tabular-nums font-semibold",
                              balanceDue > 0.0001 ? "text-red-600" : "text-slate-900",
                            ].join(" ")}
                          >
                            ₹{balanceDue.toFixed(0)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2">
                        {paymentModes.length === 0 ? null : (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {paymentModes.map((mode) => {
                                const opt = PAYMENT_MODE_OPTIONS.find((o) => o.value === mode);
                                const label = opt?.label ?? mode;
                                const val = Number(paymentByMode[mode] || 0);
                                return (
                                  <div key={mode} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                                    <div className="min-w-[64px] text-xs font-semibold text-slate-700 truncate">{label}</div>
                                    <Input
                                      type="number"
                                      min={0}
                                      inputMode="decimal"
                                      value={val}
                                      onChange={(e) => setPaymentForMode(mode, Number(e.target.value || 0))}
                                      className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => removePaymentMode(mode)}
                                      title="Remove"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex items-center justify-between rounded-md bg-slate-50 border border-slate-200 px-2 py-2">
                              <div className="text-xs text-slate-700">Paid Total</div>
                              <div className="text-sm font-semibold tabular-nums text-slate-900">₹{paidTotal.toFixed(0)}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Segment 3: Actions */}
                    <div className="md:col-span-4 rounded-lg border border-slate-200 bg-white p-2">
                      <div className="mt-1 flex flex-col gap-2 items-center">
                        <Button type="submit" className="w-full sm:w-[260px] h-10" disabled={loading}>
                          {isEditing ? "Update Stock In (F10)" : "Create Stock In (F10)"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full sm:w-[260px] h-10 border-amber-300 text-amber-800 hover:bg-amber-50"
                          disabled={loading}
                          onClick={() => setHoldConfirmOpen(true)}
                        >
                          Hold (F8)
                        </Button>
                        {isEditing ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-[260px] h-10 border-red-300 text-red-700 hover:bg-red-50"
                            disabled={loading}
                            onClick={() => setCancelConfirmOpen(true)}
                          >
                            Cancel (F9)
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Collapsible>
          </div>
        </div>
      </div>
    </form>
  );
}