import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Printer, ArrowLeft } from "lucide-react";
import { ApiService } from "@/services/apiService";

interface EnquiryPrintLocationState {
  enquiry?: any;
}

const EnquiryPrint: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as EnquiryPrintLocationState;
  const enquiry = state.enquiry;

  const retailMasterRaw = typeof window !== "undefined" ? sessionStorage.getItem("retail_master") : null;
  let companyName = "";
  let companyAddress = "";
  let companyPhone = "";
  let companyEmail = "";
  let companyGstin = "";
  let accountCode = "";
  let retailCode = "";
  if (retailMasterRaw) {
    try {
      const rm: any = JSON.parse(retailMasterRaw) || {};

      const pick = (obj: any, keys: string[]): any => {
        if (!obj) return undefined;
        const map = new Map<string, string>();
        Object.keys(obj).forEach((k) => map.set(k.toLowerCase(), k));
        for (const k of keys) {
          const ak = map.get(k.toLowerCase());
          if (ak != null && obj[ak] != null && String(obj[ak]) !== "") return obj[ak];
        }
        return undefined;
      };

      const name = pick(rm, [
        "retail_name",
        "name",
        "company_name",
        "org_name",
        "retailname",
      ]);
      const a1 = pick(rm, ["address", "address1", "address_line1", "addr1", "line1"]);
      const a2 = pick(rm, ["address2", "address_line2", "addr2", "line2"]);
      const city = pick(rm, ["city", "city_name"]);
      const state = pick(rm, ["state_name", "state"]);
      const pin = pick(rm, ["pincode", "pin", "zip", "zipcode"]);
      const phone = pick(rm, [
        "phone",
        "phone_no",
        "mobile",
        "mobile_no",
        "contact",
        "org_phone",
      ]);
      const email = pick(rm, ["email", "mail"]);
      const gst = pick(rm, ["gstin", "gst_no", "gst", "gst_number", "org_gstin"]);

      const addrLines = [a1, a2, [city, state, pin].filter(Boolean).join(", ")]
        .filter((v) => v != null && String(v) !== "")
        .map((v) => String(v));

      companyName = (name && String(name)) || "";
      companyAddress = addrLines.join(", ");
      companyPhone = (phone && String(phone)) || "";
      companyEmail = (email && String(email)) || "";
      companyGstin = (gst && String(gst)) || "";
      accountCode =
        (pick(rm, ["account_code", "accountCode"]) &&
          String(pick(rm, ["account_code", "accountCode"]))) ||
        "";
      retailCode =
        (pick(rm, ["retail_code", "retailCode"]) &&
          String(pick(rm, ["retail_code", "retailCode"])) ) ||
        "";
    } catch {
      // ignore parsing errors
    }
  }

  type ItemPricing = { price: number; taxPercent: number };

  const [itemMap, setItemMap] = useState<Record<string, ItemPricing>>({});
  const printRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadInventoryAndTax = async () => {
      // If we don't have codes, there's nothing extra to load
      if (!accountCode || !retailCode) {
        return;
      }

      try {
        const response: any = await ApiService.post("/read", {
          account_code: accountCode,
          retail_code: retailCode,
          tables: ["master_inventory", "master_tax"],
        });

        const dataRoot: any = response?.data ?? response ?? {};

        const extract = (primary: string, aliases: string[]): any[] => {
          if (Array.isArray(dataRoot)) return dataRoot;
          if (Array.isArray(dataRoot[primary])) return dataRoot[primary];
          for (const k of aliases) {
            if (Array.isArray(dataRoot[k])) return dataRoot[k];
          }
          const lower = primary.toLowerCase();
          for (const k of Object.keys(dataRoot)) {
            if (k.toLowerCase().includes(lower) && Array.isArray((dataRoot as any)[k])) return (dataRoot as any)[k];
          }
          return [];
        };

        const invRows: any[] = extract("master_inventory", ["inventory", "product_master", "products"]);
        const taxRows: any[] = extract("master_tax", ["tax", "mastertax", "tax_master"]);

        const taxByRef = new Map<number, number>();
        taxRows.forEach((t: any) => {
          const idNum = Number(t.id ?? 0);
          const taxIdNumRaw = t.tax_id ?? t.taxId ?? t.taxID ?? t.tax_code;
          const taxIdNum = Number(taxIdNumRaw);
          const pctRaw =
            t.tax_percentage ?? t.percentage ?? t.tax_rate ?? t.rate ?? t.tax;

          const parsePercent = (value: any): number | undefined => {
            if (value == null) return undefined;
            const n = Number(value);
            if (!Number.isFinite(n)) return undefined;
            return n;
          };

          const cgst = Number(t.cgst ?? 0) || 0;
          const sgst = Number(t.sgst ?? 0) || 0;
          const igst = Number(t.igst ?? 0) || 0;
          const vat = Number(t.vat ?? 0) || 0;
          const computed = cgst + sgst + igst + vat;

          const pct =
            parsePercent(pctRaw) ??
            (Number.isFinite(computed) ? computed : undefined);

          if (pct == null) return;
          if (Number.isFinite(idNum) && idNum) taxByRef.set(idNum, pct);
          if (Number.isFinite(taxIdNum) && taxIdNum) taxByRef.set(taxIdNum, pct);
        });

        const map: Record<string, ItemPricing> = {};
        invRows.forEach((p: any) => {
          const name = String(
            p.item_name ?? p.product_name ?? p.reference_code ?? ""
          ).trim();
          if (!name) return;
          const price = Number(p.selling_price ?? p.price ?? 0);
          if (!Number.isFinite(price) || price <= 0) return;

          const taxRef = p.tax ?? p.tax_id;
          let taxPercent = 0;
          if (taxRef != null) {
            const refNum = Number(taxRef);
            if (Number.isFinite(refNum) && refNum) {
              const found = taxByRef.get(refNum);
              if (found != null) taxPercent = found;
            }
          }

          map[name.toLowerCase()] = { price, taxPercent };
        });

        setItemMap(map);
      } catch (error) {
        console.error("Failed to load inventory prices for quotation", error);
        setItemMap({});
      }
    };

    loadInventoryAndTax();
  }, [accountCode, retailCode]);

  if (!enquiry) {
    return (
      <div className="p-4 flex flex-col items-center justify-center min-h-[60vh]">
        <Card className="max-w-xl w-full shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Quotation Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              No enquiry data was provided. Please open the quotation print from the Manage All Enquiries screen.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const interestedText: string = (enquiry.description || "").trim();
  const interestedItems = interestedText
    ? interestedText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const handlePrint = () => {
    if (typeof window === "undefined") return;

    const items = interestedItems;

    const rowsHtml = items.length
      ? items
          .map((line, idx) => {
            const key = line.trim();
            const pricing = itemMap[key.toLowerCase()];
            const price = pricing?.price ?? 0;
            const taxPercent = pricing?.taxPercent ?? 0;
            const amount = price + (price * taxPercent) / 100;
            const fmt = (v: number) =>
              v ? v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "-";
            return `
              <tr>
                <td style="border:1px solid #cbd5e1;padding:4px;text-align:center;vertical-align:top;">${idx + 1}</td>
                <td style="border:1px solid #cbd5e1;padding:4px;vertical-align:top;">${key}</td>
                <td style="border:1px solid #cbd5e1;padding:4px;text-align:right;vertical-align:top;">${price ? "₹" + fmt(price) : "-"}</td>
                <td style="border:1px solid #cbd5e1;padding:4px;text-align:right;vertical-align:top;">${taxPercent ? taxPercent + "%" : "-"}</td>
                <td style="border:1px solid #cbd5e1;padding:4px;text-align:right;vertical-align:top;">${price ? "₹" + fmt(amount) : "-"}</td>
              </tr>`;
          })
          .join("")
      : `
          <tr>
            <td colspan="5" style="border:1px solid #cbd5e1;padding:8px;text-align:center;color:#64748b;">No items captured.</td>
          </tr>`;

    const grandTotal = items.reduce((sum, line) => {
      const key = line.trim();
      const pricing = itemMap[key.toLowerCase()];
      if (!pricing) return sum;
      const { price, taxPercent } = pricing;
      if (!price) return sum;
      const amount = price + (price * taxPercent) / 100;
      return sum + amount;
    }, 0);

    const grandTotalHtml = items.length
      ? `
        <tfoot>
          <tr>
            <td colspan="4" style="border:1px solid #cbd5e1;padding:4px;text-align:right;font-weight:600;">Grand Total</td>
            <td style="border:1px solid #cbd5e1;padding:4px;text-align:right;font-weight:600;">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
          </tr>
        </tfoot>`
      : "";

    const safe = (v: any) => (v == null ? "" : String(v));

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Quotation</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }
          h1 { font-size: 18px; letter-spacing: 0.25em; text-transform: uppercase; }
          .header { text-align:center; margin-bottom:16px; }
          .company-name { font-size:16px; font-weight:600; }
          .small { font-size:11px; color:#334155; }
          .section-title { font-weight:600; margin-bottom:4px; }
          table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
          th { background:#f1f5f9; text-align:left; }
          th, td { border:1px solid #cbd5e1; padding:4px; }
          .footer { margin-top:40px; text-align:right; font-size:13px; color:#334155; }
          @page { margin: 16mm; }
        </style>
      </head>
      <body>
        <div>
          <div class="header">
            <h1>QUOTATION</h1>
            ${enquiry.dateToFollow ? `<div class="small" style="margin-top:4px;"><span style="font-weight:600;">Date:&nbsp;</span>${safe(enquiry.dateToFollow)}</div>` : ""}
          </div>

          <div style="border:1px solid #94a3b8;margin:12px 0 12px 0;">
            <div style="display:flex;flex-wrap:wrap;">
              <div style="flex:1 1 260px;padding:8px;border-right:1px solid #94a3b8;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#334155;">Supplier (From)</div>
                <div style="margin-top:4px;font-size:13px;font-weight:600;">${safe(companyName) || "-"}</div>
                ${companyAddress ? `<div class="small">${safe(companyAddress)}</div>` : ""}
                ${companyPhone ? `<div class="small">Ph: ${safe(companyPhone)}</div>` : ""}
              </div>
              <div style="flex:1 1 260px;padding:8px;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#334155;">Buyer (Bill To)</div>
                <div style="margin-top:4px;font-size:13px;font-weight:600;">${safe(enquiry.clientName) || "-"}</div>
                ${enquiry.address ? `<div class="small">${safe(enquiry.address)}</div>` : ""}
                ${enquiry.contact ? `<div class="small">Ph: ${safe(enquiry.contact)}</div>` : ""}
                ${enquiry.email ? `<div class="small">Email: ${safe(enquiry.email)}</div>` : ""}
              </div>
            </div>
          </div>
          <div style="font-size:13px;">
            <div class="section-title" style="margin-bottom:6px;">Details of requested services / items</div>
            <table>
              <thead>
                <tr>
                  <th style="width:32px;">Sl</th>
                  <th>Description</th>
                  <th style="width:88px;text-align:right;">Price (₹)</th>
                  <th style="width:64px;text-align:right;">Tax %</th>
                  <th style="width:104px;text-align:right;">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
              ${grandTotalHtml}
            </table>
          </div>

          ${enquiry.response ? `<div style="margin-top:16px;font-size:13px;"><div class="section-title">Remarks</div><div style="white-space:pre-line;">${safe(enquiry.response)}</div></div>` : ""}

          <div class="footer">
            <div>For ${safe(companyName)}</div>
            <div style="height:48px;"></div>
            <div style="font-weight:600;">Authorised Signatory</div>
          </div>
        </div>
      </body>
    </html>`;

    const printWindow = window.open("", "_blank", "width=900,height=650");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    try {
      printWindow.print();
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-4 print:p-0 flex justify-center bg-slate-100 min-h-screen">
      <div ref={printRef} className="w-full max-w-4xl print:shadow-none">
        <div className="print:hidden flex items-center justify-between mb-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print / Download
          </Button>
        </div>

        <Card className="shadow-md print:shadow-none border border-slate-400">
          <CardHeader className="pb-3 border-b border-slate-400 flex flex-col items-center justify-center text-center gap-1">
            <CardTitle className="text-xl font-semibold tracking-[0.25em] text-slate-800 uppercase">
              QUOTATION
            </CardTitle>
            {enquiry.dateToFollow ? (
              <p className="text-[12px] text-slate-700">
                <span className="font-semibold">Date:&nbsp;</span>
                {enquiry.dateToFollow}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="pt-4 pb-6 text-sm">
            {/* Supplier / Buyer block */}
            <div className="border border-slate-400 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-400">
                <div className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Supplier (From)</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{companyName || "-"}</p>
                  {companyAddress ? (
                    <p className="text-[12px] text-slate-700 whitespace-pre-line">{companyAddress}</p>
                  ) : null}
                  {companyPhone ? (
                    <p className="text-[12px] text-slate-700">Ph: {companyPhone}</p>
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Buyer (Bill To)</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{enquiry.clientName || "-"}</p>
                  {enquiry.address ? (
                    <p className="text-[12px] text-slate-700 whitespace-pre-line">{enquiry.address}</p>
                  ) : null}
                  {enquiry.contact ? (
                    <p className="text-[12px] text-slate-700">Ph: {enquiry.contact}</p>
                  ) : null}
                  {enquiry.email ? (
                    <p className="text-[12px] text-slate-700">Email: {enquiry.email}</p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="mb-4">
              <p className="mb-2 font-semibold text-slate-800 text-[13px]">Details of requested services / items</p>
              <table className="w-full border border-slate-300 text-[12px] border-collapse">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border border-slate-300 px-2 py-1 text-left w-10">Sl</th>
                    <th className="border border-slate-300 px-2 py-1 text-left">Description</th>
                    <th className="border border-slate-300 px-2 py-1 text-right w-24">Price (₹)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right w-20">Tax %</th>
                    <th className="border border-slate-300 px-2 py-1 text-right w-28">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {interestedItems.length > 0 ? (
                    interestedItems.map((line, idx) => {
                      const key = line.trim();
                      const pricing = itemMap[key.toLowerCase()];
                      const price = pricing?.price ?? 0;
                      const taxPercent = pricing?.taxPercent ?? 0;
                      const amount = price + (price * taxPercent) / 100;
                      return (
                        <tr key={idx}>
                          <td className="border border-slate-300 px-2 py-1 text-center align-top">{idx + 1}</td>
                          <td className="border border-slate-300 px-2 py-1 align-top">{key}</td>
                          <td className="border border-slate-300 px-2 py-1 text-right align-top tabular-nums">
                            {price
                              ? `₹${Number(price).toLocaleString("en-IN")}`
                              : "-"}
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-right align-top tabular-nums">
                            {taxPercent ? `${taxPercent}%` : "-"}
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-right align-top tabular-nums">
                            {price
                              ? `₹${Number(amount).toLocaleString("en-IN")}`
                              : "-"}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        className="border border-slate-300 px-2 py-2 text-center text-slate-500"
                        colSpan={5}
                      >
                        No items captured.
                      </td>
                    </tr>
                  )}
                </tbody>
                {interestedItems.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="border border-slate-300 px-2 py-1 text-right font-semibold" colSpan={4}>
                        Grand Total
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right font-semibold tabular-nums">
                        {(() => {
                          const total = interestedItems.reduce((sum, line) => {
                            const key = line.trim();
                            const pricing = itemMap[key.toLowerCase()];
                            if (!pricing) return sum;
                            const { price, taxPercent } = pricing;
                            if (!price) return sum;
                            const amount = price + (price * taxPercent) / 100;
                            return sum + amount;
                          }, 0);
                          return `₹${Number(total).toLocaleString("en-IN")}`;
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Remarks */}
            {enquiry.response ? (
              <div className="space-y-1 mb-6 text-[13px]">
                <p className="font-semibold text-slate-800">Remarks</p>
                <p className="text-slate-700 whitespace-pre-line leading-relaxed">{enquiry.response}</p>
              </div>
            ) : null}

            {/* Footer */}
            <div className="mt-10 flex justify-end">
              <div className="text-right text-[13px] text-slate-700">
                <p>For {companyName || ""}</p>
                <div className="h-12" aria-hidden="true" />
                <p className="font-semibold">Authorised Signatory</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default EnquiryPrint;
