import { useMemo, useState, useEffect } from "react";
import { CreditCard, Plus, Loader2, History } from "lucide-react";
import { SiMeta } from "react-icons/si";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiService } from "@/services/apiService";
import CreditHistory from "./CreditHistory";

type Props = {
  className?: string;
};

const COST_PER_MESSAGE = 0.98;
const GST_RATE = 0.18;

function formatInr(amount: number) {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `₹${safe.toFixed(2)}`;
}

export default function AddCreditsButton({ className = "" }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messageCountRaw, setMessageCountRaw] = useState<string>("100");
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    fetchBalance();
  }, []);

  useEffect(() => {
    const handler = () => {
      fetchBalance();
    };
    window.addEventListener("credits:refresh", handler as EventListener);
    return () => {
      window.removeEventListener("credits:refresh", handler as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBalance = async () => {
    try {
      const res: any = await ApiService.get("/api/credits/balance");
      if (res.success) {
        setBalance(Number(res.balance));
      }
    } catch (error) {
      console.error("Failed to fetch credit balance", error);
    }
  };

  const messageCount = useMemo(() => {
    const n = Math.floor(Number(messageCountRaw));
    return Number.isFinite(n) ? n : 0;
  }, [messageCountRaw]);

  const baseAmount = useMemo(() => Math.max(0, messageCount) * COST_PER_MESSAGE, [messageCount]);
  const gstAmount = useMemo(() => baseAmount * GST_RATE, [baseAmount]);
  const totalAmount = useMemo(() => baseAmount + gstAmount, [baseAmount, gstAmount]);

  const canPay = messageCount > 0;

  const loadRazorpay = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => {
        resolve(true);
      };
      script.onerror = () => {
        resolve(false);
      };
      document.body.appendChild(script);
    });
  };

  const handlePayment = async () => {
    if (!canPay) return;
    setLoading(true);

    const isRazorpayEnabled = (import.meta.env.VITE_RAZORPAY_INTEGRATION || import.meta.env.VITE_RAZORPAY_INTEGRATIONGRATION) === 'Y';

    if (!isRazorpayEnabled) {
      // MOCK PAYMENT FOR TESTING
      try {
        await ApiService.post("/api/credits/topup", { credits_count: messageCount });
        toast({
          title: "Success",
          description: "Payment successful! Credits added. (TEST MODE)",
        });
        setOpen(false);
        fetchBalance(); // Refresh balance
      } catch (e) {
        toast({
          title: "Error",
          description: "Failed to add mock credits",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    // REAL PAYMENT FLOW
    try {
        const res = await loadRazorpay();

        if (!res) {
          throw new Error("Razorpay SDK failed to load");
        }

        // 1. Create Order
        const orderData: any = await ApiService.post("/api/payment/razorpay/create-order", {
            amount: totalAmount,
            currency: "INR",
            receipt: `receipt_${Date.now()}`
        });

        if (!orderData || !orderData.id) {
            throw new Error("Failed to create order");
        }

        const options = {
            key: import.meta.env.VITE_RAZORPAY_KEY_ID, 
            amount: orderData.amount,
            currency: orderData.currency,
            name: "GYM Pro",
            description: "Message Credits Purchase",
            order_id: orderData.id,
            handler: async function (response: any) {
                // Verify Payment
                try {
                    const verifyResponse: any = await ApiService.post("/api/payment/razorpay/verify", {
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        credits_count: messageCount // Send expected credits count
                    });
                    
                    if(verifyResponse.success){
                        // After verification, add the credits
                        try {
                           const topupRes: any = await ApiService.post("/api/credits/topup", { 
                               credits_count: messageCount 
                           });
                           
                           if (topupRes.success) {
                                toast({
                                  title: "Success",
                                  description: "Payment successful! Credits added.",
                                });
                                setOpen(false);
                                fetchBalance(); // Refresh balance
                           } else {
                               throw new Error("Failed to add credits");
                           }
                        } catch (err) {
                           console.error(err);
                           toast({
                                title: "Error",
                                description: "Payment verified but failed to add credits. Contact support.",
                                variant: "destructive"
                           });
                        }
                    } else {
                        throw new Error("Verification failed");
                    }
                } catch (error) {
                    toast({
                        title: "Payment Verification Failed",
                        description: "Please contact support.",
                        variant: "destructive"
                    });
                }
            },
            prefill: {
                name: "Salon Owner",
                email: "owner@example.com",
                contact: "9999999999"
            },

            theme: {
                color: "#1877F2"
            },
            modal: {
                ondismiss: function() {
                    setLoading(false);
                    toast({
                        title: "Payment Cancelled",
                        description: "You cancelled the payment process.",
                    });
                }
            }
        };

        const paymentObject = new window.Razorpay(options);
        paymentObject.open();
        
        setLoading(false);

    } catch (error) {
        console.error(error);
        toast({
            title: "Error",
            description: "Something went wrong during payment initialization",
            variant: "destructive",
        });
        setLoading(false);
    }

  };

  return (
    <>
      <div className={`inline-flex h-10 items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm ${className}`}>
        {balance !== null && (
           <div className="flex items-center gap-2 px-3 py-1.5 border-r border-slate-200">
             <SiMeta className="h-4 w-4 text-[#0668E1]" />
             <span className="text-sm font-medium text-slate-700">{balance} Credits</span>
           </div>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 mx-1"
          title="Transaction History"
        >
          <History className="h-4 w-4" />
        </button>
        <div className="h-4 w-px bg-slate-200 mx-1" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <Plus className="h-4 w-4 text-emerald-600" />
          <span>Add Credits</span>
        </button>
      </div>

      <CreditHistory open={historyOpen} onOpenChange={setHistoryOpen} />

      {open && <div className="fixed inset-0 z-40 bg-black/80" aria-hidden="true" />}


      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent
          className="sm:max-w-[425px] p-6 z-50"
          overlayClassName="hidden"
          hideCloseButton
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                <SiMeta className="h-4 w-4 text-[#0668E1]" aria-hidden="true" />
                <span className="text-xs font-semibold text-slate-700">Meta</span>
              </div>
            </div>
            <DialogTitle className="mt-4 text-xl">Purchase Message Credits</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="space-y-2">
              <Label>Message Count</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={messageCountRaw}
                onChange={(e) => setMessageCountRaw(e.target.value)}
                placeholder="Enter message count"
              />
              {!canPay ? (
                <p className="text-xs text-rose-600">Please enter a valid message count.</p>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Base amount</span>
                <span className="font-semibold text-slate-900">{formatInr(baseAmount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-600">GST ({Math.round(GST_RATE * 100)}%) amount</span>
                <span className="font-semibold text-slate-900">{formatInr(gstAmount)}</span>
              </div>
              <div className="mt-3 h-px bg-slate-200" />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Total estimated amount</span>
                <span className="text-base font-bold text-emerald-700">{formatInr(totalAmount)}</span>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-10 px-6" disabled={loading}>
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-2 bg-[#1877F2] hover:bg-[#0c65d6] h-10 px-6"
              disabled={!canPay || loading}
              onClick={handlePayment}
            >
              {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                  <CreditCard className="h-4 w-4" />
              )}
              Pay Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}