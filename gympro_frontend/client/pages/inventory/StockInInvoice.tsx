import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Printer } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import { toast } from "@/hooks/use-toast";

const formatINR = (value: any) => {
  const n = Number(value || 0);
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const formatDateSafe = (value: any) => {
  if (!value) return "-";
  try {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return format(d, "dd-MM-yyyy");
  } catch {
    return String(value);
  }
};

type PartyInfo = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstin?: string;
  pan?: string;
  state?: string;
  placeOfSupply?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upi?: string;
};

const safeStr = (v: any) => {
  const s = String(v ?? "").trim();
  return s ? s : "-";
};

const readRetailProfile = (user: any): PartyInfo => {
  const fromUser: PartyInfo = {
    name: user?.company_name || user?.org_name || user?.RetailName || user?.retail_name || user?.retailName,
    phone: user?.company_phone || user?.phone || user?.mobile,
    email: user?.company_email || user?.email,
    gstin: user?.gstin || user?.GSTIN,
    pan: user?.pan || user?.PAN,
    address: user?.address || user?.company_address,
    website: user?.website,
    state: user?.state,
    placeOfSupply: user?.place_of_supply || user?.placeOfSupply,
  };

  const fromStorage = (() => {
    try {
      const raw = sessionStorage.getItem("retail_master") || localStorage.getItem("retail_master");
      if (!raw) return {} as PartyInfo;
      const rm = JSON.parse(raw);
      return {
        name: rm?.RetailName || rm?.retail_name || rm?.CompanyName || rm?.company_name || rm?.name,
        phone: rm?.Phone || rm?.phone || rm?.mobile,
        email: rm?.Email || rm?.email,
        address: rm?.Address || rm?.address,
        gstin: rm?.GSTIN || rm?.gstin,
        pan: rm?.PAN || rm?.pan,
        state: rm?.State || rm?.state,
        placeOfSupply: rm?.PlaceOfSupply || rm?.place_of_supply || rm?.placeOfSupply,
        website: rm?.Website || rm?.website,
        bankName: rm?.BankName || rm?.bank_name,
        bankAccountName: rm?.BankAccountName || rm?.bank_account_name,
        bankAccountNo: rm?.BankAccountNo || rm?.bank_account_no,
        bankIfsc: rm?.IFSC || rm?.ifsc,
        bankBranch: rm?.Branch || rm?.bank_branch,
        upi: rm?.UPI || rm?.upi,
      } as PartyInfo;
    } catch {
      return {} as PartyInfo;
    }
  })();

  return {
    ...fromStorage,
    ...fromUser,
    // prefer storage for bank fields if present
    bankName: fromStorage.bankName || fromUser.bankName,
    bankAccountName: fromStorage.bankAccountName || fromUser.bankAccountName,
    bankAccountNo: fromStorage.bankAccountNo || fromUser.bankAccountNo,
    bankIfsc: fromStorage.bankIfsc || fromUser.bankIfsc,
    bankBranch: fromStorage.bankBranch || fromUser.bankBranch,
    upi: fromStorage.upi || fromUser.upi,
  };
};

export default function StockInInvoice() {
  const { stockinId } = useParams();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    document.title = stockinId ? `Stock In Invoice - ${stockinId}` : "Stock In Invoice";
  }, [stockinId]);

  useEffect(() => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;
    if (!stockinId) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res: any = await ApiService.post("/stock-in/get", {
          account_code: acc,
          retail_code: ret,
          stockin_id: stockinId,
        });
        const payload = res?.data ?? res;
        const d = payload?.data ?? payload;
        if (!cancelled) setData(d);
      } catch (e: any) {
        console.error("Failed to load Stock In invoice", e);
        toast({ title: "Load failed", description: e?.message || String(e), variant: "destructive" });
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, stockinId]);

  const computed = useMemo(() => {
    const header = data?.header || {};
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    const payments: any[] = Array.isArray(data?.payments) ? data.payments : [];

    const itemRows = items.map((it) => {
      const qty = Number(it?.quantity || 0);
      const rate = Number(it?.unit_price || 0);
      const disc = Number(it?.discount || 0);
      const taxPct = Number(it?.tax_percent || 0);
      const net = it?.net_amount != null ? Number(it.net_amount) : Math.max(0, qty * rate - disc);
      const taxAmt = it?.tax_amount != null ? Number(it.tax_amount) : net * (taxPct / 100);
      const gross = it?.gross_amount != null ? Number(it.gross_amount) : net + taxAmt;
      return { ...it, qty, rate, disc, taxPct, net, taxAmt, gross };
    });

    const subtotal = Number(header?.subtotal ?? itemRows.reduce((s, r) => s + (r.net || 0), 0));
    const overallDiscount = Number(header?.discount ?? 0);
    const discountApplied = Math.min(Math.max(overallDiscount, 0), Math.max(subtotal, 0));
    const taxableAfterDiscount = Number(header?.taxable_base ?? Math.max(subtotal - discountApplied, 0));

    const totalTax = Number(header?.total_tax ?? itemRows.reduce((s, r) => s + (r.taxAmt || 0), 0));
    const cgst = Number(header?.cgst ?? (totalTax / 2));
    const sgst = Number(header?.sgst ?? (totalTax / 2));
    const igst = Number(header?.igst ?? 0);

    const grandTotal = Number(header?.grand_total ?? Math.max(taxableAfterDiscount + totalTax, 0));
    const paid = Number(header?.paid_total ?? payments.reduce((s, p) => s + Number(p?.amount || 0), 0));
    const balance = Number(header?.balance_due ?? Math.max(grandTotal - paid, 0));

    const totalQty = itemRows.reduce((s, r) => s + (Number(r.qty || 0) || 0), 0);
    const roundOff = Number(header?.round_off ?? 0);

    // HSN + tax breakup (CGST/SGST split). Allocate overall discount proportionally.
    const groups = new Map<string, { hsn: string; taxable: number; taxPct: number; cgstRate: number; sgstRate: number; cgstAmt: number; sgstAmt: number; totalTax: number }>();
    const subtotalBase = Math.max(subtotal, 0) || 0;
    for (const it of itemRows) {
      const hsn = String(it?.hsn_code || it?.hsn || it?.hsnCode || "-").trim() || "-";
      const taxPct = Number(it?.taxPct || it?.tax_percent || 0) || 0;
      const key = `${hsn}__${taxPct}`;

      const taxable = Number(it?.net || 0) || 0;
      const allocatedDisc = subtotalBase > 0 ? (taxable / subtotalBase) * discountApplied : 0;
      const taxableAdj = Math.max(taxable - allocatedDisc, 0);

      const taxAmt = Number(it?.taxAmt || 0) || 0;
      const cgstAmtRow = igst > 0 ? 0 : taxAmt / 2;
      const sgstAmtRow = igst > 0 ? 0 : taxAmt / 2;
      const cgstRate = igst > 0 ? 0 : taxPct / 2;
      const sgstRate = igst > 0 ? 0 : taxPct / 2;

      const prev = groups.get(key) || {
        hsn,
        taxable: 0,
        taxPct,
        cgstRate,
        sgstRate,
        cgstAmt: 0,
        sgstAmt: 0,
        totalTax: 0,
      };
      prev.taxable += taxableAdj;
      prev.cgstAmt += cgstAmtRow;
      prev.sgstAmt += sgstAmtRow;
      prev.totalTax += taxAmt;
      groups.set(key, prev);
    }
    const hsnBreakup = Array.from(groups.values()).sort((a, b) => (a.hsn || "").localeCompare(b.hsn || ""));

    const retail = readRetailProfile(user);

    const totals = {
      subtotal,
      discount: discountApplied,
      taxableAfterDiscount,
      cgst,
      sgst,
      igst,
      totalTax,
      roundOff,
      grandTotal,
      paid,
      balance,
      totalQty,
    };

    return { header, itemRows, payments, totals, hsnBreakup, retail };
  }, [data]);

  const supplier: PartyInfo = {
    name: computed.header?.supplier_name || computed.header?.supplier_id,
    address: computed.header?.supplier_address || computed.header?.supplier_addr,
    phone: computed.header?.supplier_phone || computed.header?.supplier_mobile,
    email: computed.header?.supplier_email,
    gstin: computed.header?.supplier_gstin,
    pan: computed.header?.supplier_pan,
    state: computed.header?.supplier_state,
  };

  const invoiceNo = computed.header?.invoice_no || computed.header?.bill_no || computed.header?.stockin_id || stockinId;
  const invoiceDate = computed.header?.invoice_date || computed.header?.bill_date || computed.header?.received_date;
  const entryDate = computed.header?.received_date || computed.header?.created_at;

  const extraCharges = Number(computed.header?.extra_charges ?? 0) || 0;
  const previousBalance = Number(computed.header?.previous_balance ?? 0) || 0;
  const currentBalance = Number(computed.header?.current_balance ?? computed.totals.balance ?? 0) || 0;
  const receivedAmount = computed.totals.paid;

  const isIGST = computed.totals.igst > 0;

  return (
    <div className="min-h-screen w-full bg-slate-50/40 p-2 md:p-4 print:bg-white print:p-0">
      <h1 className="sr-only">Stock In Invoice</h1>

      <style>
        {`
          @media print {
            @page { size: A4; margin: 10mm; }
            html, body { background: white !important; }
          }
          .invoice-a4 {
            max-width: 210mm;
            margin: 0 auto;
          }
          .inv-border { border: 1px solid #CBD5E1; }
          .inv-bt { border-top: 1px solid #CBD5E1; }
          .inv-bb { border-bottom: 1px solid #CBD5E1; }
          .inv-br { border-right: 1px solid #CBD5E1; }
          .inv-bl { border-left: 1px solid #CBD5E1; }
          .inv-cell { padding: 6px 8px; vertical-align: top; }
          .inv-small { font-size: 11px; }
          .inv-xs { font-size: 10px; }
          .inv-avoid { break-inside: avoid; page-break-inside: avoid; }
        `}
      </style>

      <div className="invoice-a4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div className="text-lg font-semibold">Stock In Invoice</div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/inventory/stock-in">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </div>

        {loading && <div className="inv-border bg-white p-8 text-center text-sm text-muted-foreground">Loading...</div>}
        {!loading && !data && <div className="inv-border bg-white p-8 text-center text-sm text-muted-foreground">No data</div>}

        {!loading && data && (
          <div className="inv-border bg-white">
            {/* Header row */}
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="inv-cell inv-br">
                <div className="text-base font-semibold leading-tight">{safeStr(supplier.name)}</div>
                <div className="inv-small text-slate-700 whitespace-pre-wrap">{safeStr(supplier.address)}</div>
                <div className="inv-xs text-slate-700 mt-1 space-y-0.5">
                  <div>Phone: {safeStr(supplier.phone)}</div>
                  <div>GSTIN: {safeStr(supplier.gstin)}</div>
                  <div>PAN: {safeStr(supplier.pan)}</div>
                </div>
              </div>
              <div className="inv-cell">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold tracking-wide">TAX INVOICE</div>
                    <div className="inv-xs text-slate-500">{isIGST ? "IGST" : "CGST/SGST"}</div>
                  </div>
                  <div className="inv-xs text-slate-400 uppercase">Original for recipient</div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 inv-small">
                  <div className="text-slate-600">Invoice No:</div>
                  <div className="text-right font-medium">{safeStr(invoiceNo)}</div>

                  <div className="text-slate-600">Invoice Date:</div>
                  <div className="text-right font-medium">{formatDateSafe(invoiceDate)}</div>

                  <div className="text-slate-600">Entry Date:</div>
                  <div className="text-right">{formatDateSafe(entryDate)}</div>

                  <div className="text-slate-600">Stock In ID:</div>
                  <div className="text-right">{safeStr(computed.header?.stockin_id || stockinId)}</div>

                  <div className="text-slate-600">Email:</div>
                  <div className="text-right">{safeStr(computed.retail.email)}</div>

                  <div className="text-slate-600">Website:</div>
                  <div className="text-right">{safeStr(computed.retail.website)}</div>
                </div>
              </div>
            </div>

            {/* Bill/Ship */}
            <div className="grid grid-cols-1 md:grid-cols-2 inv-bt">
              <div className="inv-cell inv-br">
                <div className="inv-xs font-semibold text-slate-700">BILL TO</div>
                <div className="mt-1 inv-small">
                  <div className="font-semibold">{safeStr(computed.retail.name)}</div>
                  <div className="text-slate-700 whitespace-pre-wrap">{safeStr(computed.retail.address)}</div>
                  <div className="inv-xs text-slate-700 mt-1 space-y-0.5">
                    <div>Phone: {safeStr(computed.retail.phone)}</div>
                    <div>PAN: {safeStr(computed.retail.pan)}</div>
                    <div>GSTIN: {safeStr(computed.retail.gstin)}</div>
                    <div>Place of Supply: {safeStr(computed.retail.placeOfSupply || computed.retail.state)}</div>
                  </div>
                </div>
              </div>
              <div className="inv-cell">
                <div className="inv-xs font-semibold text-slate-700">SHIP TO</div>
                <div className="mt-1 inv-small">
                  <div className="font-semibold">{safeStr(computed.retail.name)}</div>
                  <div className="text-slate-700 whitespace-pre-wrap">{safeStr(computed.retail.address)}</div>
                  <div className="inv-xs text-slate-700 mt-1 space-y-0.5">
                    <div>Phone: {safeStr(computed.retail.phone)}</div>
                    <div>PAN: {safeStr(computed.retail.pan)}</div>
                    <div>GSTIN: {safeStr(computed.retail.gstin)}</div>
                    <div>Place of Supply: {safeStr(computed.retail.placeOfSupply || computed.retail.state)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="inv-bt">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="inv-bb">
                      <th className="inv-cell inv-xs font-semibold text-left inv-br whitespace-nowrap">S. No.</th>
                      <th className="inv-cell inv-xs font-semibold text-left inv-br">Item</th>
                      <th className="inv-cell inv-xs font-semibold text-left inv-br whitespace-nowrap">HSN</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br whitespace-nowrap">Quantity</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br whitespace-nowrap">Rate</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br whitespace-nowrap">Tax/Unit</th>
                      <th className="inv-cell inv-xs font-semibold text-right whitespace-nowrap">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.itemRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="inv-cell inv-small text-center text-slate-500">No items</td>
                      </tr>
                    )}
                    {computed.itemRows.map((it: any, idx: number) => {
                      const hsn = String(it?.hsn_code || it?.hsn || it?.hsnCode || "-").trim() || "-";
                      const taxPerUnit = it.qty ? (Number(it.taxAmt || 0) / Number(it.qty || 1)) : 0;
                      return (
                        <tr key={String(it?.id ?? idx)} className="inv-bb inv-avoid">
                          <td className="inv-cell inv-xs inv-br">{idx + 1}</td>
                          <td className="inv-cell inv-xs inv-br">
                            <div className="font-medium">{safeStr(it?.item_name)}</div>
                            {it?.brand ? <div className="text-slate-500">{String(it.brand)}</div> : null}
                          </td>
                          <td className="inv-cell inv-xs inv-br">{safeStr(hsn)}</td>
                          <td className="inv-cell inv-xs inv-br text-right tabular-nums">{Number(it.qty || 0) || 0}</td>
                          <td className="inv-cell inv-xs inv-br text-right tabular-nums">{formatINR(it.rate)}</td>
                          <td className="inv-cell inv-xs inv-br text-right tabular-nums">{formatINR(taxPerUnit)}</td>
                          <td className="inv-cell inv-xs text-right tabular-nums">{formatINR(it.gross)}</td>
                        </tr>
                      );
                    })}

                    {/* Charges rows (match sample layout style) */}
                    <tr className="inv-avoid">
                      <td className="inv-cell inv-xs inv-br" colSpan={5} />
                      <td className="inv-cell inv-xs inv-br text-right">Extra Charges</td>
                      <td className="inv-cell inv-xs text-right tabular-nums">{formatINR(extraCharges)}</td>
                    </tr>
                    <tr className="inv-bb inv-avoid">
                      <td className="inv-cell inv-xs inv-br" colSpan={5} />
                      <td className="inv-cell inv-xs inv-br text-right">Discount</td>
                      <td className="inv-cell inv-xs text-right tabular-nums">-{formatINR(computed.totals.discount)}</td>
                    </tr>

                    <tr className="inv-avoid">
                      <td className="inv-cell inv-xs inv-br font-semibold" colSpan={3}>TOTAL</td>
                      <td className="inv-cell inv-xs inv-br text-right font-semibold tabular-nums" colSpan={1}>
                        {computed.totals.totalQty}
                      </td>
                      <td className="inv-cell inv-xs inv-br" colSpan={2} />
                      <td className="inv-cell inv-xs text-right font-semibold tabular-nums">{formatINR(computed.totals.grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment summary strip */}
            <div className="grid grid-cols-1 md:grid-cols-4 inv-bt inv-xs">
              <div className="inv-cell inv-br">
                <div className="text-slate-600">Received Amount</div>
                <div className="font-semibold tabular-nums">{formatINR(receivedAmount)}</div>
              </div>
              <div className="inv-cell inv-br">
                <div className="text-slate-600">Balance Amount</div>
                <div className="font-semibold tabular-nums">{formatINR(currentBalance)}</div>
              </div>
              <div className="inv-cell inv-br">
                <div className="text-slate-600">Previous Balance</div>
                <div className="font-semibold tabular-nums">{formatINR(previousBalance)}</div>
              </div>
              <div className="inv-cell">
                <div className="text-slate-600">Current Balance</div>
                <div className="font-semibold tabular-nums">{formatINR(currentBalance)}</div>
              </div>
            </div>

            {/* HSN wise tax breakup */}
            <div className="inv-bt">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="inv-bb">
                      <th className="inv-cell inv-xs font-semibold text-left inv-br">HSN</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br">Taxable Amount</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br">CGST Rate</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br">CGST Amount</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br">SGST Rate</th>
                      <th className="inv-cell inv-xs font-semibold text-right inv-br">SGST Amount</th>
                      <th className="inv-cell inv-xs font-semibold text-right">Total Tax Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.hsnBreakup.length === 0 && (
                      <tr>
                        <td colSpan={7} className="inv-cell inv-xs text-center text-slate-500">No tax breakup</td>
                      </tr>
                    )}
                    {computed.hsnBreakup.map((r, idx) => (
                      <tr key={`${r.hsn}-${r.taxPct}-${idx}`} className="inv-bb inv-avoid">
                        <td className="inv-cell inv-xs inv-br">{safeStr(r.hsn)}</td>
                        <td className="inv-cell inv-xs inv-br text-right tabular-nums">{formatINR(r.taxable)}</td>
                        <td className="inv-cell inv-xs inv-br text-right tabular-nums">{r.cgstRate ? `${r.cgstRate}%` : "-"}</td>
                        <td className="inv-cell inv-xs inv-br text-right tabular-nums">{formatINR(r.cgstAmt)}</td>
                        <td className="inv-cell inv-xs inv-br text-right tabular-nums">{r.sgstRate ? `${r.sgstRate}%` : "-"}</td>
                        <td className="inv-cell inv-xs inv-br text-right tabular-nums">{formatINR(r.sgstAmt)}</td>
                        <td className="inv-cell inv-xs text-right tabular-nums">{formatINR(r.totalTax)}</td>
                      </tr>
                    ))}
                    <tr className="inv-avoid">
                      <td className="inv-cell inv-xs inv-br font-semibold">Total</td>
                      <td className="inv-cell inv-xs inv-br text-right tabular-nums font-semibold">{formatINR(computed.totals.taxableAfterDiscount)}</td>
                      <td className="inv-cell inv-xs inv-br" />
                      <td className="inv-cell inv-xs inv-br text-right tabular-nums font-semibold">{formatINR(computed.totals.cgst)}</td>
                      <td className="inv-cell inv-xs inv-br" />
                      <td className="inv-cell inv-xs inv-br text-right tabular-nums font-semibold">{formatINR(computed.totals.sgst)}</td>
                      <td className="inv-cell inv-xs text-right tabular-nums font-semibold">{formatINR(computed.totals.totalTax)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer blocks */}
            <div className="grid grid-cols-1 md:grid-cols-2 inv-bt">
              <div className="inv-cell inv-br">
                <div className="inv-xs font-semibold text-slate-700">Remark</div>
                <div className="mt-1 inv-small text-slate-700 whitespace-pre-wrap">{safeStr(computed.header?.remarks)}</div>

                <div className="mt-3 inv-xs font-semibold text-slate-700">Terms & Conditions</div>
                <ol className="mt-1 list-decimal pl-4 inv-xs text-slate-700 space-y-0.5">
                  <li>Goods once sold will not be taken back.</li>
                  <li>Please verify items and amounts before payment.</li>
                  <li>Payment due within 15 days unless agreed otherwise.</li>
                </ol>
              </div>
              <div className="inv-cell">
                <div className="inv-xs font-semibold text-slate-700">Bank Details</div>
                <div className="mt-1 inv-xs text-slate-700 space-y-0.5">
                  <div>Bank: {safeStr(computed.retail.bankName)}</div>
                  <div>Account Holder: {safeStr(computed.retail.bankAccountName)}</div>
                  <div>Account No: {safeStr(computed.retail.bankAccountNo)}</div>
                  <div>IFSC: {safeStr(computed.retail.bankIfsc)}</div>
                  <div>Branch: {safeStr(computed.retail.bankBranch)}</div>
                  <div>UPI: {safeStr(computed.retail.upi)}</div>
                </div>

                <div className="mt-8 text-right inv-xs text-slate-700">
                  <div className="font-semibold">Authorised Signatory For</div>
                  <div className="mt-8 font-semibold">{safeStr(computed.retail.name)}</div>
                </div>
              </div>
            </div>

            {/* Hidden: keep existing payments pills/table component for debugging / data parity */}
            <div className="hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>pay_mode</TableHead>
                    <TableHead>amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(computed.payments || []).map((p: any, idx: number) => (
                    <TableRow key={String(p?.id ?? idx)}>
                      <TableCell>{String(p?.pay_mode || "-")}</TableCell>
                      <TableCell>{formatINR(p?.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
