import React, { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { ApiService } from "@/services/apiService";
import { useAuth } from "@/contexts/AuthContext";
interface HoldBillItem {
  invoice_id: string;
  amount: number;
  customer_name?: string;
  customer_phone?: string;
  updated_at?: string;
}

export function NotificationBell(
  props: { triggerMode?: 'icon' | 'button'; triggerLabel?: string; triggerClassName?: string } = {},
) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const triggerMode = props.triggerMode || 'icon';
  const triggerLabel = props.triggerLabel || 'View Hold Bills';
  const triggerClassName = props.triggerClassName || '';
  const [holdBills, setHoldBills] = useState<HoldBillItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchHoldBills = async () => {
      try {
        setIsLoading(true);
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        if (!acc || !ret) {
          setHoldBills([]);
          setUnreadCount(0);
          setIsLoading(false);
          return;
        }
        const params = new URLSearchParams();
        params.set('account_code', acc);
        params.set('retail_code', ret);
        params.set('limit', '100');
        // Hold bills are billstatus = 'N'
        params.set('billstatus', 'N');
        // Use backend-supported invoices endpoint
        const resp: any = await ApiService.get(`/api/invoices?${params.toString()}`);
        // Support both shapes:
        // 1) resp.data = [...] (array)
        // 2) resp.data = { success, count, data: [...] }
        const rows: any[] = Array.isArray(resp?.data)
          ? resp.data
          : Array.isArray(resp?.data?.data)
          ? resp.data.data
          : [];
        const holds = rows.filter(r => (r?.billstatus || r?.txn_billstatus) === 'N');
        const items: HoldBillItem[] = holds.map(r => {
          const customerNameRaw =
            r.txn_customer_name ??
            r.customer_name ??
            r.customerr_name ??
            r.customername ??
            r.customerName ??
            r.cust_name ??
            r.customer?.customer_name ??
            r.customer?.customerr_name ??
            r.customer?.customername ??
            r.customer?.name ??
            r.customer?.customerName ??
            undefined;

          const customerPhoneRaw =
            r.txn_customer_phone ??
            r.txn_customer_mobile ??
            r.customer_phone ??
            r.customer_mobile ??
            r.customer_mobile_no ??
            r.mobile ??
            r.phone ??
            undefined;

          return {
            invoice_id: r.invoice_id,
            amount: Number(r.txn_grand_total ?? r.txn_total_amount ?? r.txn_total ?? r.grand_total ?? 0),
            customer_name: customerNameRaw != null && String(customerNameRaw).trim() !== '' ? String(customerNameRaw) : undefined,
            customer_phone: customerPhoneRaw != null ? String(customerPhoneRaw) : undefined,
            updated_at: r.txn_updated_at ?? r.last_updated_at ?? undefined,
          };
        });
        setHoldBills(items);
        setUnreadCount(items.length);
      } catch (e) {
        setHoldBills([]);
        setUnreadCount(0);
      } finally {
        setIsLoading(false);
      }
    };
    fetchHoldBills();
  }, [user]);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        {triggerMode === 'button' ? (
          <Button
            variant="outline"
            size="sm"
            className={`h-9 px-3 min-w-[150px] sm:min-w-[180px] text-[10px] border-slate-300 bg-white hover:bg-slate-50 text-slate-900 rounded flex items-center justify-center gap-2 ${triggerClassName}`}
          >
            <Bell className="h-3.5 w-3.5 text-destructive" />
            <span className="whitespace-nowrap">{triggerLabel}</span>
            {unreadCount > 0 && (
              <Badge className="ml-1 h-4 px-1.5 text-[10px] leading-4" variant="destructive">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-lg hover:bg-slate-100">
            <Bell className="h-4 w-4 text-slate-600" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center border border-white shadow-sm min-w-[16px]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[480px] overflow-y-auto">
        <div className="px-4 py-3 border-b bg-gradient-to-r from-slate-50 to-slate-100 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
                  <h3 className="font-semibold text-sm text-slate-900">Hold Bills</h3>
            </div>
          </div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-slate-300 border-t-slate-600 rounded-full mx-auto"></div>
            <p className="text-sm text-slate-500 mt-3">Loading notifications...</p>
          </div>
        ) : holdBills.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {holdBills.map((hb) => (
              <DropdownMenuItem
                key={hb.invoice_id}
                onClick={() => {
                  navigate(`/billing/add?edit=${encodeURIComponent(hb.invoice_id)}`);
                  setIsOpen(false);
                }}
                className="flex items-start gap-3 p-3 cursor-pointer border-none focus:outline-none hover:bg-emerald-50"
              >
                <div className="flex-shrink-0 mt-0.5 p-2 rounded-full bg-emerald-100">
                  <Bell className="h-4 w-4 text-emerald-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 leading-snug">
                    {hb.invoice_id} — ₹{hb.amount.toFixed(0)}
                  </p>
                  {(hb.customer_name || hb.customer_phone) && (
                    <p className="text-xs text-slate-600 mt-0.5 truncate">
                      {hb.customer_name ? hb.customer_name : ''}
                      {hb.customer_name && hb.customer_phone ? ' • ' : ''}
                      {hb.customer_phone ? hb.customer_phone : ''}
                    </p>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-3 rounded-full bg-slate-100">
              <Bell className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-900">No hold bills</p>
            <p className="text-xs text-slate-500 mt-1">You're all caught up</p>
          </div>
        )}
        {/* Removed 'View All Bills' button as requested */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
