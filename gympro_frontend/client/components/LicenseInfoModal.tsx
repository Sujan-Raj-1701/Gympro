import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Shield, Calendar, Key, Phone, Mail, Clock, AlertTriangle } from "lucide-react";
import { format, isAfter, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { LicenseService, type LicenseInfo } from "@/services/licenseService";
import { useAuth } from "@/contexts/AuthContext";

interface LicenseInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  licenseInfo: LicenseInfo | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function LicenseInfoModal({ open, onOpenChange, licenseInfo, isLoading = false, error, onRetry }: LicenseInfoModalProps) {
  const [isExtending, setIsExtending] = useState(false);
  const canExtend = !!licenseInfo && !isExtending; // enable by default; disable only while processing
  const { logout } = useAuth();

  const licenseMeta = licenseInfo
    ? (() => {
        const expiryDate = new Date(licenseInfo.expiryDate);
        const today = new Date();
        const daysUntilExpiry = differenceInDays(expiryDate, today);

        // Treat license as expired only when the expiry date is in the past
        // (negative days difference). This avoids timezone/time-of-day issues
        // where "today" might be slightly after the stored expiry timestamp
        // even though the user still has days remaining.
        const isExpired = daysUntilExpiry < 0;
        const isExpiringSoon = daysUntilExpiry <= 30 && daysUntilExpiry > 0;

        const statusBadge = isExpired
          ? { variant: "destructive" as const, text: "Expired", icon: AlertTriangle }
          : isExpiringSoon
            ? { variant: "secondary" as const, text: `${daysUntilExpiry} days left`, icon: Clock }
            : { variant: "default" as const, text: "Active", icon: Shield };

        return { expiryDate, daysUntilExpiry, isExpired, isExpiringSoon, statusBadge };
      })()
    : null;

  const handleExtendLicense = async () => {
    if (!licenseInfo) return;
    setIsExtending(true);
    // Gather customer context from session/local storage
    let account_code: string | undefined;
    let retail_code: string | undefined;
    let phone: string | undefined;
    let email: string | undefined;
    try {
      const authUser = localStorage.getItem('auth_user');
      if (authUser) {
        const u = JSON.parse(authUser);
        account_code = u?.account_code || undefined;
        retail_code = u?.retail_code || undefined;
        phone = u?.phone || u?.mobile || undefined;
        email = u?.email || undefined;
      }
    } catch {}
    // Fallbacks from retail_master if available
    try {
      const rmRaw = sessionStorage.getItem('retail_master');
      if (rmRaw) {
        const rm = JSON.parse(rmRaw);
        account_code = account_code || rm?.account_code || rm?.AccountCode || undefined;
        retail_code = retail_code || rm?.retail_code || rm?.RetailCode || undefined;
        phone = phone || rm?.phone1 || rm?.phone || rm?.mobile || undefined;
        email = email || rm?.email || undefined;
      }
    } catch {}

    // Compose mail with prefilled details and days-left/expiry context
    const days = licenseMeta?.daysUntilExpiry;
    const expiryText = licenseMeta?.expiryDate ? `${format(licenseMeta.expiryDate, 'dd MMM yyyy')}` : '';
    const subject = encodeURIComponent(`License Extension Request - ${retail_code || licenseInfo.licenseId}`);
    const lines = [
      'Hello Techies Magnifier Support,',
      '',
      'I would like to extend my GYM Pro license.',
      '',
      `Organization: ${licenseInfo.retailName || ''}`,
      `Retail Code: ${retail_code || ''}`,
      `Account Code: ${account_code || ''}`,
      `License ID: ${licenseInfo.licenseId}`,
      `Current License Key: ${licenseInfo.licenseKey}`,
      expiryText ? `Expiry Date: ${expiryText}${typeof days === 'number' ? ` (${days > 0 ? `${days} days left` : 'Expired'})` : ''}` : undefined,
      '',
      'Requested Term: 1 year',
      phone ? `Preferred Phone: ${phone}` : undefined,
      email ? `Preferred Email: ${email}` : undefined,
      '',
      'Please process this extension request and let me know the next steps.',
      '',
      `Sent from GYM Pro on ${format(new Date(), 'dd MMM yyyy HH:mm')}`,
    ].filter(Boolean) as string[];
    const body = encodeURIComponent(lines.join('\n'));
    try {
      // Open default mail client immediately with prefilled message
      window.location.href = `mailto:admin@techiesmagnifier.com?subject=${subject}&body=${body}`;
    } catch {}

    // Fire-and-forget server-side extension request (best-effort)
    try {
      void LicenseService.extendLicense({
        retail_code: retail_code || licenseInfo.licenseId,
        account_code,
        license_key: licenseInfo.licenseKey,
        extension_term: '1-year',
      });
    } catch (e) {
      console.warn('Background extend request failed:', e);
    } finally {
      setIsExtending(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      try { window.location.href = "/login"; } catch {}
    }
  };

  // Contact details now shown as static info instead of a button

  const disallowClose = Boolean(licenseMeta?.isExpired);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Prevent closing the dialog when license is expired
        if (disallowClose && next === false) return; 
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-2xl lg:max-w-4xl max-h-[95vh] overflow-y-auto"
        hideCloseButton={disallowClose}
        overlayClassName={disallowClose ? "backdrop-blur-sm" : undefined}
        // Block escape key and outside clicks when closing must be disabled
        onEscapeKeyDown={(e) => { if (disallowClose) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (disallowClose) e.preventDefault(); }}
        onInteractOutside={(e) => { if (disallowClose) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            License Information
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Fetching license details...</p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <Card className="bg-red-50 border-red-200">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">Unable to load license information</p>
                    <p className="text-xs text-red-600 mt-1">{error}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            {onRetry && (
              <Button onClick={onRetry} className="w-full bg-blue-600 text-white hover:bg-blue-700">
                Retry
              </Button>
            )}
          </div>
        ) : licenseInfo && licenseMeta ? (
          <div className="space-y-4">
            {/* Header with Status Badge */}
            <div className="flex items-center justify-between pb-2">
              <h3 className="text-base font-semibold text-gray-900">License Status</h3>
              <Badge variant={licenseMeta.statusBadge.variant} className="flex items-center gap-1 px-2 py-0.5 text-xs">
                <licenseMeta.statusBadge.icon className="h-3 w-3" />
                {licenseMeta.statusBadge.text}
              </Badge>
            </div>

            {/* Single row grid for license details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* License ID */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg flex-shrink-0">
                      <Key className="h-3.5 w-3.5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">License ID</p>
                      <p className="text-xs font-semibold text-gray-900 font-mono">{licenseInfo.licenseId}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Expiry Date */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0",
                        licenseMeta.isExpired ? "bg-red-100" : licenseMeta.isExpiringSoon ? "bg-yellow-100" : "bg-green-100"
                      )}
                    >
                      <Calendar
                        className={cn(
                          "h-3.5 w-3.5",
                          licenseMeta.isExpired ? "text-red-600" : licenseMeta.isExpiringSoon ? "text-yellow-600" : "text-green-600"
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Expiry Date</p>
                      <p className="text-xs font-semibold text-gray-900">{format(licenseMeta.expiryDate, "dd MMM yyyy")}</p>
                      {!licenseMeta.isExpired && (
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {licenseMeta.daysUntilExpiry > 0 ? `${licenseMeta.daysUntilExpiry} days left` : "Expires today"}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Organization */}
              {licenseInfo.retailName && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg flex-shrink-0">
                        <Shield className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Organization</p>
                        <p className="text-xs font-semibold text-gray-900 truncate">{licenseInfo.retailName}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* License Key - full width */}
              <Card className="md:col-span-3">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-2">
                    <div className="flex items-center justify-center w-8 h-8 bg-green-100 rounded-lg flex-shrink-0">
                      <Shield className="h-3.5 w-3.5 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">License Key</p>
                      <p className="text-xs text-gray-700 font-mono bg-gray-50 p-2 rounded-lg border border-gray-200 break-all">
                        {licenseInfo.licenseKey}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Action Buttons - side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <Button
                onClick={handleExtendLicense}
                disabled={!canExtend}
                className={cn(
                  "w-full bg-blue-600 text-white h-10 text-sm font-semibold shadow-md transition-all",
                  canExtend ? "hover:bg-blue-700 hover:shadow-lg" : "opacity-50 cursor-not-allowed"
                )}
              >
                {isExtending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4 mr-2" />
                    Extend License
                  </>
                )}
              </Button>
              {licenseMeta.isExpired ? (
                <Button
                  onClick={handleLogout}
                  variant="destructive"
                  className="w-full h-10 text-sm font-semibold shadow-md"
                >
                  Logout
                </Button>
              ) : (
                <div className="w-full h-auto text-sm font-semibold border-2 rounded-md px-3 py-2 flex flex-col gap-1.5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-slate-700" />
                    <a href="tel:+917397288500" className="text-slate-800 hover:underline">7397288500</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-700" />
                    <a href="mailto:admin@techiesmagnifier.com" className="text-slate-800 hover:underline">admin@techiesmagnifier.com</a>
                  </div>
                </div>
              )}
            </div>

            {licenseMeta.isExpired && (
              <div className="mt-2">
                <div className="w-full h-auto text-sm font-semibold border-2 rounded-md px-3 py-2 flex flex-col gap-1.5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-slate-700" />
                    <a href="tel:+917397288500" className="text-slate-800 hover:underline">7397288500</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-700" />
                    <a href="mailto:admin@techiesmagnifier.com" className="text-slate-800 hover:underline">admin@techiesmagnifier.com</a>
                  </div>
                </div>
              </div>
            )}

            {(licenseMeta.isExpired || licenseMeta.isExpiringSoon) && (
              <Card
                className={cn(
                  "border-l-4",
                  licenseMeta.isExpired ? "border-l-red-500 bg-red-50" : "border-l-yellow-500 bg-yellow-50"
                )}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={cn(
                        "h-3.5 w-3.5 mt-0.5 flex-shrink-0",
                        licenseMeta.isExpired ? "text-red-600" : "text-yellow-600"
                      )}
                    />
                    <div className="text-xs">
                      <p
                        className={cn(
                          "font-semibold",
                          licenseMeta.isExpired ? "text-red-800" : "text-yellow-800"
                        )}
                      >
                        {licenseMeta.isExpired ? "License Expired" : "License Expiring Soon"}
                      </p>
                      <p
                        className={cn(
                          "text-[11px] mt-0.5",
                          licenseMeta.isExpired ? "text-red-700" : "text-yellow-700"
                        )}
                      >
                        {licenseMeta.isExpired
                          ? "Your license has expired. Some features may be unavailable. Please extend your license or contact support."
                          : "Your license will expire soon. We recommend extending it to avoid service interruption."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500">License information is not available right now.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}