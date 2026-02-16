import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Users, Clock, DollarSign, Plus, CheckCircle, ChevronDown, ChevronUp, Save, Trash2, Search } from "lucide-react";

type VM = Record<string, any>;

export default function CreateBookingView({ vm }: { vm: VM }) {
  const {
    // customer
    customer, setCustomer,
    nameFiltered, showNameSuggest, setShowNameSuggest,
    nameQuery, setNameQuery, customerSearchTerm, setCustomerSearchTerm,
    isSearchingCustomers, fieldErrors, setFieldErrors,
    mobileFiltered, setMobileQuery, showMobileSuggest, setShowMobileSuggest, applyCustomerRecord,

    // event
    eventType, setEventType, eventTypes,
    eventSlot, setEventSlot, lockedSlot, eventSlots,
    startDateTime, setStartDateTime,
  // dual selection removed
    expectedGuests, setExpectedGuests,
    specialReq, setSpecialReq,

    // halls
    masterHalls, selectedHallId, setSelectedHallId, selectedHall,

    // services
    services, availableServices, toggleService,
    servicePrices, setServicePrice,
    showServices, setShowServices,

  // tax helpers (injected from parent vm)
  serviceTaxMap, roundTo2,
  // per-service tax exemption map
  serviceTaxExempt, setServiceTaxExempt,

    // payment & totals
    paymentModes, paymentMode, setPaymentMode,
  upiTxnId, setUpiTxnId, chequeNo, setChequeNo,
  discount, setDiscount,
    hallTaxRate, cgst, sgst,
    hallRent, servicesCost, totalAmount,
    advancePayment, setAdvancePayment, balanceDue, existingPaid,
  taxExempt, setTaxExempt,

    // actions
  resetForm, isSaving, handleConfirmSave,
    editModeId, createdBookingId, handleCancelBooking,
    bookingStatus,
  isCancelledReadonly,
  isExistingCustomer,
  hidePrimaryAction,

  // new flags
  lockedDate,
  } = vm;

  const isCancelled = typeof bookingStatus === 'string' && bookingStatus.toLowerCase().startsWith('cancel');
  const isSettled = typeof bookingStatus === 'string' && bookingStatus.toLowerCase() === 'settled';
  const isReadOnly = typeof isCancelledReadonly === 'boolean' ? isCancelledReadonly : isCancelled;
  const isMarkedReadonly = !!isExistingCustomer;
  // Lock customer fields during edit mode or when globally read-only
  const isCustomerLocked = !!editModeId || isReadOnly;
  // Determine if at least one service is selected
  const hasServicesSelected = (() => {
    try {
      return Object.values(services || {}).some(Boolean);
    } catch { return false; }
  })();
  // Dynamic primary action label: show "Settle & Checkout" ONLY when there is at least one service
  // selected AND the balance due is 0. Otherwise, in edit mode show "Update Booking".
  const primaryActionLabel = (() => {
    const dueZero = Number(balanceDue) === 0;
    if (editModeId) {
      if (dueZero && hasServicesSelected) return 'Settle & Checkout';
      return 'Update Booking';
    }
    if (!editModeId && dueZero) return 'Create Booking';
    return 'Confirm Booking';
  })();

  // Proactively clear Aadhaar/PAN errors when values become non-empty (handles autofill and late updates)
  React.useEffect(() => {
    try {
      const hasAadhaar = String((customer as any)?.aadhaar || '').trim().length > 0;
      if (hasAadhaar) setFieldErrors((prev: any) => (prev?.aadhaar ? { ...prev, aadhaar: '' } : prev));
    } catch {}
    try {
      const hasPan = String((customer as any)?.pan || '').trim().length > 0;
      if (hasPan) setFieldErrors((prev: any) => (prev?.pan ? { ...prev, pan: '' } : prev));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(customer as any)?.aadhaar, (customer as any)?.pan]);

  // Default-select the 0th Payment Mode if none is chosen yet
  React.useEffect(() => {
    if (isReadOnly) return;
    const hasValue = typeof paymentMode === 'string' && paymentMode.trim() !== '';
    if (hasValue) return;
    // Prefer first provided mode
    if (Array.isArray(paymentModes) && paymentModes.length > 0) {
      const first = paymentModes[0] as any;
      const v = (typeof first === 'string')
        ? first
        : (first?.value ?? first?.id ?? first?.code ?? first?.paymode_id ?? first?.payment_mode_id ?? first?.payment_id);
      if (v != null && String(v).trim() !== '') {
        setPaymentMode(String(v));
        try { setFieldErrors((prev: any) => ({ ...prev, paymentMode: '' })); } catch {}
        return;
      }
    }
    // Fallback to a sensible default when no master list is provided
    setPaymentMode('cash');
    try { setFieldErrors((prev: any) => ({ ...prev, paymentMode: '' })); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReadOnly, paymentModes, paymentMode]);

  // Require key fields
  const validateRequired = React.useCallback(() => {
    const errs: any = {};
    // Customer fields (skip when locked)
    if (!isCustomerLocked) {
      const nm = String(customer?.fullName || '').trim();
      const mob = String(customer?.mobile || '').trim();
      const aad = String(customer?.aadhaar || '').trim();
      const pn = String(customer?.pan || '').trim();
      if (!nm) errs.fullName = 'Full Name is required';
      if (!mob) errs.mobile = 'Mobile Number is required';
      if (!aad) errs.aadhaar = 'Aadhaar No is required';
      if (!pn) errs.pan = 'PAN No is required';
    }
    // Event fields (single-slot mode only; multi-slot rows validated upstream)
    const hasMulti = Array.isArray(vm.multiSlots) && vm.multiSlots.length > 0;
    if (!hasMulti) {
      const dt = String(startDateTime || '').trim();
      const et = String(eventType || '').trim();
      const es = String(eventSlot || '').trim();
      if (!dt) errs.startDateTime = 'Event Date is required';
      if (!et) errs.eventType = 'Event Type is required';
      if (!es) errs.eventSlot = 'Event Slot is required';
    }
    // Hall always required
    const hall = String(selectedHallId || '').trim();
    if (!hall) errs.selectedHall = 'Hall is required';

    if (Object.keys(errs).length > 0) {
      setFieldErrors((prev: any) => ({ ...prev, ...errs }));
      return false;
    }
    return true;
  }, [customer, isCustomerLocked, vm.multiSlots, startDateTime, eventType, eventSlot, selectedHallId, setFieldErrors]);

  const handleConfirmClick = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!validateRequired()) return;
    if (typeof handleConfirmSave === 'function') handleConfirmSave(e);
  }, [validateRequired, handleConfirmSave]);

  return (
    <form autoComplete="off" className="min-h-screen bg-slate-50" onSubmit={(e)=>e.preventDefault()}>
      {/* Hidden dummy inputs to trick browser autofill engines */}
      <input type="text" name="fake_username" autoComplete="username" style={{display:'none'}} />
      <input type="password" name="fake_password" autoComplete="new-password" style={{display:'none'}} />
      <div className="w-full px-2 lg:px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left column: Customer & Event */}
          <div className="lg:col-span-3 space-y-4">
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                  <Users className="h-4 w-4 mr-2 text-blue-600" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Full Name <span className="text-rose-600" aria-hidden>*</span></Label>
                    <Input
                      required
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_full_name"
                      value={customer.fullName}
                      onChange={(e) => { const v=e.target.value; setCustomer({ ...customer, fullName: v }); setNameQuery(v); setCustomerSearchTerm(v); setShowNameSuggest(true); setFieldErrors((prev: any) => ({ ...prev, fullName: '' })); if (vm.setSelectedCustomerId) vm.setSelectedCustomerId(null); }}
                      onFocus={() => { if (customer.fullName) { setNameQuery(customer.fullName); setCustomerSearchTerm(customer.fullName); } setShowNameSuggest(true); }}
                      onBlur={() => setTimeout(()=> setShowNameSuggest(false), 120)}
                      className={`h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs ${fieldErrors.fullName ? 'border-red-400' : ''}`}
                      disabled={isCustomerLocked}
                      placeholder="Enter full name"
                    />
                    {showNameSuggest && !isCustomerLocked && (
                      <div className="relative">
                        <div className="absolute left-0 right-0 mt-1 border border-slate-200 rounded-md shadow-lg bg-white max-h-56 overflow-auto text-xs z-30">
                          {isSearchingCustomers && <div className="px-2 py-1 text-slate-500 italic">Searching...</div>}
                          {!isSearchingCustomers && nameFiltered.map((rec: any) => {
                            const dispName = rec.full_name||rec.fullName||rec.name||'';
                            const q = nameQuery.trim().toLowerCase();
                            const idx = dispName.toLowerCase().indexOf(q);
                            let highlighted: JSX.Element | string = dispName;
                            if (q && idx >= 0) {
                              highlighted = (
                                <span>
                                  {dispName.slice(0, idx)}
                                  <span className="bg-yellow-200 text-slate-900">{dispName.slice(idx, idx+q.length)}</span>
                                  {dispName.slice(idx+q.length)}
                                </span>
                              );
                            }
                            return (
                              <div key={`${dispName}-${rec.mobile||rec.phone||rec.id}`}
                                className="px-2 py-1 cursor-pointer hover:bg-blue-50 flex flex-col"
                                onMouseDown={() => { applyCustomerRecord(rec); }}
                              >
                                <span className="font-medium text-slate-700">{highlighted}</span>
                                <span className="text-slate-500">{rec.mobile||rec.phone} {rec.email?`• ${rec.email}`:''}</span>
                              </div>
                            );
                          })}
                          {!isSearchingCustomers && nameFiltered.length===0 && customerSearchTerm.trim().length>=1 && <div className="px-2 py-1 text-slate-500">No matches</div>}
                        </div>
                      </div>
                    )}
                    {fieldErrors.fullName && <div className="text-rose-600 text-xs mt-1">{fieldErrors.fullName}</div>}
                  </div>
          <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Mobile Number <span className="text-rose-600" aria-hidden>*</span></Label>
                    <Input
                      required
                      autoComplete="new-password"
                      inputMode="tel"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_mobile"
                      value={customer.mobile}
                      onChange={(e) => { const v=e.target.value; setCustomer({ ...customer, mobile: v }); setMobileQuery(v); setCustomerSearchTerm(v); setShowMobileSuggest(true); setFieldErrors((prev: any) => ({ ...prev, mobile: '' })); if (vm.setSelectedCustomerId) vm.setSelectedCustomerId(null); }}
                      onFocus={() => { if (customer.mobile) { setMobileQuery(customer.mobile); setCustomerSearchTerm(customer.mobile); } setShowMobileSuggest(true); }}
                      onBlur={() => setTimeout(()=> setShowMobileSuggest(false), 120)}
            className={`h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs ${fieldErrors.mobile ? 'border-red-400' : ''}`}
                      disabled={isCustomerLocked}
                      placeholder="Enter mobile number"
                    />
                    {showMobileSuggest && (mobileFiltered.length > 0 || isSearchingCustomers) && !isCustomerLocked && (
                      <div className="mt-1 border border-slate-200 rounded-md shadow-sm bg-white max-h-48 overflow-auto text-xs z-20 relative">
                        {isSearchingCustomers && <div className="px-2 py-1 text-slate-500 italic">Searching...</div>}
                        {!isSearchingCustomers && mobileFiltered.map((rec: any) => {
                          const dispName = rec.full_name||rec.fullName||rec.name||'';
                          return (
                            <div key={`${rec.mobile||rec.phone}-${dispName}`}
                              className="px-2 py-1 cursor-pointer hover:bg-blue-50 flex flex-col"
                              onMouseDown={() => { applyCustomerRecord(rec); }}
                            >
                              <span className="font-medium text-slate-700">{rec.mobile||rec.phone}</span>
                              <span className="text-slate-500">{dispName} {rec.email?`• ${rec.email}`:''}</span>
                            </div>
                          );
                        })}
                        {!isSearchingCustomers && mobileFiltered.length===0 && customerSearchTerm.trim().length>=2 && <div className="px-2 py-1 text-slate-500">No matches</div>}
                      </div>
                    )}
                    {fieldErrors.mobile && <div className="text-rose-600 text-xs mt-1">{fieldErrors.mobile}</div>}
                  </div>
          <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Email</Label>
                    <Input 
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_email"
                      value={customer.email} 
                      onChange={(e) => setCustomer({ ...customer, email: e.target.value })} 
            className="h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs"
                      disabled={isCustomerLocked}
                      placeholder="Enter email address"
                    />
                  </div>
          <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">GSTIN</Label>
                    <Input 
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_gstin"
                      value={customer.gstin}
                      onChange={(e) => setCustomer({ ...customer, gstin: e.target.value.toUpperCase() })}
            className="h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs"
                      disabled={isCustomerLocked}
                      placeholder="Enter GSTIN"
                    />
                  </div>
          <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Aadhaar No <span className="text-rose-600" aria-hidden>*</span></Label>
                    <Input
                      required
                      autoComplete="new-password"
                      inputMode="numeric"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_aadhaar"
                      value={customer.aadhaar || ''}
                      onChange={(e) => { setCustomer({ ...customer, aadhaar: e.target.value }); setFieldErrors((prev: any) => ({ ...prev, aadhaar: '' })); }}
            className="h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs"
                      disabled={isCustomerLocked || isMarkedReadonly}
                      placeholder={isMarkedReadonly ? "Selected from customer master" : "Enter Aadhaar number"}
                    />
                    {fieldErrors.aadhaar && <div className="text-rose-600 text-xs mt-1">{fieldErrors.aadhaar}</div>}
                  </div>
          <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">PAN No <span className="text-rose-600" aria-hidden>*</span></Label>
                    <Input
                      required
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_pan"
                      value={customer.pan || ''}
                      onChange={(e) => { setCustomer({ ...customer, pan: e.target.value.toUpperCase() }); setFieldErrors((prev: any) => ({ ...prev, pan: '' })); }}
            className="h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs"
                      disabled={isCustomerLocked || isMarkedReadonly}
                      placeholder={isMarkedReadonly ? "Selected from customer master" : "Enter PAN number"}
                    />
                    {fieldErrors.pan && <div className="text-rose-600 text-xs mt-1">{fieldErrors.pan}</div>}
                  </div>
          <div className="md:col-span-2 space-y-0.5">
                    <Label className="text-xs font-semibold text-slate-700">Address</Label>
        <Textarea 
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      name="customer_address"
                      value={customer.address} 
                      onChange={(e) => setCustomer({ ...customer, address: e.target.value })} 
      rows={2} 
      className="h-12 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs"
                      disabled={isCustomerLocked}
                      placeholder="Enter full address"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-medium text-slate-800 flex items-center">
                  <Clock className="h-4 w-4 mr-2 text-green-600" />
                  Event Details
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Unified table-style layout for single or multi */}
                  <div className="md:col-span-4">
                    <div className="mt-2 space-y-1">
                      {/* header */}
                      <div className="grid grid-cols-12 gap-1 items-center bg-white p-1">
                        <div className="col-span-3 text-sm font-medium text-slate-700">Event Date <span className="text-rose-600" aria-hidden>*</span></div>
                        <div className="col-span-3 text-sm font-medium text-slate-700">Event Type <span className="text-rose-600" aria-hidden>*</span></div>
                        <div className="col-span-4 text-sm font-medium text-slate-700">Event Slot <span className="text-rose-600" aria-hidden>*</span></div>
                        <div className="col-span-1 text-sm font-medium text-slate-700">Guests</div>
                        <div className="col-span-1 text-sm font-medium text-slate-700 text-right">&nbsp;</div>
                      </div>

                      {/* rows */}
                      {vm.multiSlots && Array.isArray(vm.multiSlots) && vm.multiSlots.length > 0 ? (
                        vm.multiSlots.map((row: any, idx: number) => (
                          <div key={`${row.id || idx}-${idx}`} className="grid grid-cols-12 gap-1 items-end bg-white p-1">
                            <div className="col-span-3">
                              <Input type="date" value={row.date || ''} onChange={(e)=>{
                                if (vm.handleRowDateChange) { vm.handleRowDateChange(idx, e.target.value); }
                                else { const next = [...vm.multiSlots]; next[idx] = { ...next[idx], date: e.target.value }; vm.setMultiSlots(next); }
                              }} className="rounded-sm" disabled={isReadOnly} />
                            </div>
                            <div className="col-span-3">
                              <Select value={row.eventType || ''} onValueChange={(v)=>{ const next=[...vm.multiSlots]; next[idx]={...next[idx], eventType: v}; vm.setMultiSlots(next); }} disabled={isReadOnly}>
                                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Type" /></SelectTrigger>
                                <SelectContent>
                                  {(eventTypes||[]).map((et:any)=>(<SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-4">
                              <Select value={row.eventSlot || ''} onValueChange={(v)=>{ if (vm.handleRowSlotChange) { vm.handleRowSlotChange(idx, v); } else { const next=[...vm.multiSlots]; next[idx]={...next[idx], eventSlot: v}; vm.setMultiSlots(next); } }} disabled={isReadOnly}>
                                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Choose time slot" /></SelectTrigger>
                                <SelectContent>
                                  {(eventSlots||[]).map((es:any)=>(<SelectItem key={es.value} value={es.value}>{es.label}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-1">
                              <Input type="number" value={String(row.expectedGuests||'')} onChange={(e)=>{ const val = e.target.value? Number(e.target.value):''; const next=[...vm.multiSlots]; next[idx]={...next[idx], expectedGuests: val}; vm.setMultiSlots(next); }} className="rounded-sm" disabled={isReadOnly} />
                            </div>
                            <div className="col-span-1 flex items-center justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (!vm.setMultiSlots) return;
                                  if (!vm.multiSlots || vm.multiSlots.length <= 1) return;
                                  const next = [...vm.multiSlots];
                                  next.splice(idx, 1);
                                  vm.setMultiSlots(next);
                                }}
                                className="text-rose-600 hover:bg-rose-50"
                                disabled={isReadOnly || !(vm.multiSlots && vm.multiSlots.length > 1)}
                                title={!(vm.multiSlots && vm.multiSlots.length > 1) ? "At least one slot is required" : "Remove this slot"}
                                aria-disabled={!(vm.multiSlots && vm.multiSlots.length > 1) ? true : undefined}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="grid grid-cols-12 gap-1 items-end bg-white p-1">
                          <div className="col-span-3">
                            <Input
                              type="date"
                              value={startDateTime}
                              onChange={(e) => { if (vm.handleDateChange) { vm.handleDateChange(e.target.value); } else { setStartDateTime(e.target.value); setFieldErrors((prev: any) => ({ ...prev, startDateTime: '' })); } }}
                              className={`rounded-sm border-slate-300 focus:border-green-500 focus:ring-green-500 ${fieldErrors.startDateTime ? 'border-red-400' : ''}`}
                              disabled={isReadOnly}
                              required
                            />
                            {fieldErrors.startDateTime && <div className="text-rose-600 text-xs mt-1">{fieldErrors.startDateTime}</div>}
                          </div>
                          <div className="col-span-3">
                            <Select value={eventType} onValueChange={(v) => { setEventType(v); setFieldErrors((prev: any) => ({ ...prev, eventType: '' })); }} disabled={isReadOnly}>
                              <SelectTrigger className="rounded-sm border-slate-300 focus:border-green-500"><SelectValue placeholder="Type" /></SelectTrigger>
                              <SelectContent>
                                {eventTypes.length > 0 ? (
                                  eventTypes.map((et: any) => <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>)
                                ) : (
                                  <>
                                    <SelectItem value="wedding">Wedding</SelectItem>
                                    <SelectItem value="birthday">Birthday</SelectItem>
                                    <SelectItem value="corporate">Corporate</SelectItem>
                                    <SelectItem value="conference">Conference</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                            {fieldErrors.eventType && <div className="text-rose-600 text-xs mt-1">{fieldErrors.eventType}</div>}
                          </div>
                          <div className="col-span-4">
                            <Select value={eventSlot} onValueChange={(v) => { if (!isReadOnly) { if (vm.handleSlotChange) { vm.handleSlotChange(v); } else { setEventSlot(v); setFieldErrors((prev: any) => ({ ...prev, eventSlot: '' })); } } }} disabled={isReadOnly}>
                              <SelectTrigger className="rounded-sm border-slate-300 focus:border-green-500 focus:ring-green-500 text-sm bg-white" disabled={isReadOnly}>
                                <SelectValue placeholder="Choose time slot" />
                              </SelectTrigger>
                              <SelectContent>
                                {eventSlots.length > 0 && eventSlots.map((es: any) => (
                                  <SelectItem key={es.value} value={es.value}>{es.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {fieldErrors.eventSlot && <div className="text-rose-600 text-xs mt-1">{fieldErrors.eventSlot}</div>}
                          </div>
                          <div className="col-span-1">
                            <Input 
                              type="number" 
                              value={String(expectedGuests)} 
                              onChange={(e) => setExpectedGuests(e.target.value ? Number(e.target.value) : "")} 
                              className="rounded-sm border-slate-300 focus:border-green-500 focus:ring-green-500"
                              disabled={isReadOnly}
                              placeholder="Guests"
                            />
                          </div>
                          <div className="col-span-1 flex items-center justify-end">&nbsp;</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Dual Slot second block removed */}
                  {/* Select Hall moved inside Event Details */}
                  <div className="md:col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-slate-700">Select Hall <span className="text-rose-600" aria-hidden>*</span></Label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-600">Tax Exempt</span>
                        <Switch checked={!!taxExempt} onCheckedChange={(v)=> setTaxExempt(!!v)} disabled={isReadOnly} />
                      </div>
                    </div>
                    <Select value={selectedHallId} onValueChange={(v) => { if (vm.handleHallChange) { vm.handleHallChange(v); } else { setSelectedHallId(v); setFieldErrors((prev: any) => ({ ...prev, selectedHall: '' })); } }}>
                      <SelectTrigger className="border-slate-300 focus:border-amber-600 focus:ring-amber-600 rounded-lg text-sm bg-white" >
                        <SelectValue placeholder="Choose your hall" />
                      </SelectTrigger>
                      <SelectContent>
                        {masterHalls.map((h: any) => (
                          <SelectItem key={h.id} value={h.id}>
                            <div className="flex items-center w-full">
                              <div className="font-medium text-sm">{h.name}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* HSN info badge removed as requested */}
                    
                    {vm.lockedHall && (
                      <></>
                    )}
                    {fieldErrors.selectedHall && <div className="text-rose-600 text-xs mt-1">{fieldErrors.selectedHall}</div>}
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">Special Requirements</Label>
                    <Textarea 
                      value={specialReq} 
                      onChange={(e) => setSpecialReq(e.target.value)} 
                      rows={3} 
                      className="border-slate-300 focus:border-green-500 focus:ring-green-500 rounded-lg"
                      disabled={isReadOnly}
                      placeholder="Any special arrangements or requirements"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            {/* Services & Add-ons moved below Event Details */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader
                className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-slate-200 py-2 px-3 select-none"
              >
                <div
                  className="flex items-center justify-between gap-3"
                  role="button"
                  aria-expanded={!!showServices}
                  tabIndex={0}
                  onClick={() => { if (!isReadOnly) setShowServices(!showServices); }}
                  onKeyDown={(e) => { if (!isReadOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setShowServices(!showServices); } }}
                >
                  <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <Plus className="h-4 w-4 text-orange-600" />
                    <span>Services & Add-ons</span>
                    <span className="ml-1 text-orange-600">{showServices ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                  </CardTitle>
                  {/* Search in header; prevent toggling when using input */}
                  <div
                    className="relative w-40 sm:w-56 lg:w-72"
                    onClick={(e)=> e.stopPropagation()}
                    onKeyDown={(e)=> e.stopPropagation()}
                  >
                    <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="Search services..."
                      value={vm.serviceSearch || ''}
                      onChange={(e) => vm.setServiceSearch ? vm.setServiceSearch(e.target.value) : undefined}
                      className="h-8 pl-7 text-xs border-slate-300 focus:border-orange-500 focus:ring-orange-500 bg-white"
                    />
                  </div>
                </div>
              </CardHeader>
              {showServices && (
                <CardContent className="p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {(vm.filteredServices || availableServices).map((service: any) => {
                      const selected = !!services[service.id];
                      const price = (servicePrices?.[service.id] ?? service.price) as number;
                      // compute tax amount and total when tax info available on service
                      const taxId = service.taxId || service.tax_id || service.tax || undefined;
                      const taxRec = (serviceTaxMap && taxId) ? serviceTaxMap[String(taxId)] : undefined;
                      const taxRate = taxRec ? (typeof taxRec === 'number' ? taxRec : (taxRec.rate ?? taxRec.tax_rate ?? undefined)) : undefined;
                      const numericRate = taxRate != null ? (Number(taxRate) > 1.5 ? Number(taxRate)/100 : Number(taxRate)) : undefined;
                      const isExempt = !!serviceTaxExempt?.[String(service.id)];
                      const taxAmount = (numericRate && !isExempt) ? roundTo2(price * numericRate) : 0;
                      const total = price + taxAmount;
                      return (
                        <div
                          key={service.id}
                          className={`group relative p-2 rounded-lg border transition-all min-h-[120px] flex flex-col justify-between ${selected ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-200' : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50 hover:shadow-sm'}`}
                          role="button"
                          tabIndex={isReadOnly ? -1 : 0}
                          aria-pressed={selected}
                          aria-label={`Toggle service ${service?.name ?? ''}`}
                          onClick={() => { if (!isReadOnly) toggleService(service.id); }}
                          onKeyDown={(e) => { if (!isReadOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleService(service.id); } }}
                        >
                          {/* Header: checkbox + name, and price at top-right when not selected */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleService(service.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="mr-2 h-3 w-3 text-orange-600 focus:ring-orange-500 border-slate-300 rounded"
                                disabled={isReadOnly}
                              />
                              <div className="flex flex-col">
                                <span className="font-medium text-slate-800 text-sm break-words whitespace-normal" title={service.name}>{service.name}</span>
                                {service.category && <span className="text-[11px] text-slate-500">{service.category}</span>}
                              </div>
                            </div>
                            {!selected && (
                              <div className="shrink-0 text-right">
                                <div className="text-[13px] font-semibold text-orange-600">₹{Number(price || service.price || 0).toLocaleString()}</div>
                              </div>
                            )}
                          </div>
                          {/* Body: editable price when selected */}
                          {selected && (
                            <div className="mt-2">
                              <div className="relative w-full max-w-[200px]">
                                <span className="pointer-events-none absolute left-2 top-1.5 text-[10px] text-slate-500">₹</span>
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  value={String(price ?? 0)}
                                  onChange={(e) => setServicePrice(service.id, Number(e.target.value) || 0)}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  className="h-8 pl-4 text-right border-orange-300 focus:border-orange-500 focus:ring-orange-500 rounded-md text-xs"
                                  disabled={isReadOnly}
                                />
                              </div>
                            </div>
                          )}

                          {/* Footer: Tax, Exempt toggle and Total */}
                          <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600 flex-nowrap">
                            <div className="flex items-center gap-3 whitespace-nowrap">
                              <div className="shrink-0 leading-none">Tax: <span className="text-slate-700">₹{taxAmount.toLocaleString('en-IN')}</span></div>
                              <label
                                className="inline-flex items-center gap-1 cursor-pointer select-none whitespace-nowrap"
                                onClick={(e)=> e.stopPropagation()}
                                onKeyDown={(e)=> e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3 text-orange-600 border-slate-300 rounded align-middle"
                                  checked={!!serviceTaxExempt?.[String(service.id)]}
                                  onChange={(e)=> setServiceTaxExempt({ ...(serviceTaxExempt||{}), [String(service.id)]: !!e.target.checked })}
                                  disabled={isReadOnly}
                                />
                                <span className="text-[10px]">Exempt</span>
                              </label>
                            </div>
                            <div className="shrink-0 whitespace-nowrap leading-none">Total: <span className="font-semibold text-slate-800">₹{total.toLocaleString('en-IN')}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {((vm.filteredServices || availableServices) || []).length === 0 && (
                    <div className="text-xs text-slate-500 py-4 text-center">No services found</div>
                  )}
                </CardContent>
              )}
            </Card>
          </div>

          {/* Right column: Pricing & Confirmation */}
          <div className="space-y-4 lg:col-span-1">
            {/* Services card removed from right column */}

            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-slate-200 py-2 px-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-slate-800 flex items-center">
                    <DollarSign className="h-3 w-3 mr-2 text-emerald-600" />
                    Pricing & Payment
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 px-2 text-xs border border-slate-300 hover:bg-white hover:border-slate-400 text-slate-700"
                    onClick={() => vm.goBack && vm.goBack()}
                    title="Back"
                  >
                    ← Back
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-600 text-xs">Hall Rent</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">₹</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={String(hallRent ?? 0)}
                        onChange={(e) => vm?.setHallRent?.(e.target.value)}
                        className="w-24 h-7 text-right border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 rounded-md text-xs"
                        disabled={isReadOnly}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-600 text-xs">Services</span>
                    <span className="font-semibold text-slate-800 text-xs">₹{servicesCost.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-slate-600 text-xs">Discount (Rs)</span>
                    <Input 
                      type="number" 
                      value={String(discount)} 
                      onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} 
                      className="w-20 h-8 text-right border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 rounded-lg text-xs"
                      disabled={isReadOnly}
                      placeholder="0"
                    />
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-600 text-xs">CGST {hallTaxRate && !taxExempt ? `(${(hallTaxRate * 100 / 2).toFixed(1)}%)` : ''}</span>
                    <span className="font-semibold text-slate-800 text-xs">₹{cgst.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-600 text-xs">SGST {hallTaxRate && !taxExempt ? `(${(hallTaxRate * 100 / 2).toFixed(1)}%)` : ''}</span>
                    <span className="font-semibold text-slate-800 text-xs">₹{sgst.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 bg-gradient-to-r from-blue-50 to-indigo-50 px-2 rounded-lg border border-blue-300">
                    <span className="font-bold text-blue-900 text-base">Total</span>
                    <span className="font-normal text-black text-base">₹{totalAmount.toLocaleString()}</span>
                  </div>
                  {Number(existingPaid) > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-slate-600 text-xs">Already Paid</span>
                      <span className="font-semibold text-emerald-700 text-xs">₹{Number(existingPaid).toLocaleString()}</span>
                    </div>
                  )}
          <div className="space-y-1 mt-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-slate-700">Advance Payment {Number(existingPaid) > 0 ? '(Additional)' : ''}</Label>
                      <div className="flex items-center gap-2">
                        <Input 
                          type="number" 
                          inputMode="numeric"
                          min={0}
                          max={Math.max(0, (Number(totalAmount) || 0) - (Number(existingPaid) || 0))}
                          step={1}
                          value={String(advancePayment)} 
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = Number(raw);
                            const maxAdd = Math.max(0, (Number(totalAmount) || 0) - (Number(existingPaid) || 0));
                            const capped = isNaN(n) ? 0 : Math.min(Math.max(n, 0), maxAdd);
                            setAdvancePayment(capped);
                          }} 
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            const maxAdd = Math.max(0, (Number(totalAmount) || 0) - (Number(existingPaid) || 0));
                            const capped = isNaN(n) ? 0 : Math.min(Math.max(n, 0), maxAdd);
                            if (capped !== n) setAdvancePayment(capped);
                          }}
                          className="h-8 border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 rounded-lg text-xs flex-1"
                          disabled={isReadOnly}
                          placeholder="Enter advance amount"
                        />
                        <div className="flex items-center gap-1">
                          {([
                            { label: '50%', val: 0.5 },
                            { label: '75%', val: 0.75 },
                            { label: '100%', val: 1 },
                          ] as const).map(btn => (
                            <button
                              key={btn.label}
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => {
                                const maxAdd = Math.max(0, (Number(totalAmount) || 0) - (Number(existingPaid) || 0));
                                const amount = Math.round(maxAdd * btn.val);
                                setAdvancePayment(amount);
                              }}
                              className={`px-2 py-1 rounded-md text-[10px] border ${isReadOnly ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'} transition`}
                              aria-label={`Set advance to ${btn.label}`}
                              title={`Set advance to ${btn.label} of payable`}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {fieldErrors.advancePayment && (
                        <div className="text-rose-600 text-xs mt-1">{fieldErrors.advancePayment}</div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-slate-700">Payment Mode</Label>
                      <Select value={paymentMode} onValueChange={(v)=>{ setPaymentMode(v); setFieldErrors((prev:any)=>({ ...prev, paymentMode: '', upiTxnId: '', chequeNo: '' })); }} disabled={isReadOnly}>
            <SelectTrigger className="h-8 border-slate-300 focus:border-emerald-500 rounded-lg text-xs" disabled={isReadOnly}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentModes.length > 0 ? (
                            paymentModes.map((m: any) => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))
                          ) : (
                            <>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="card">Card</SelectItem>
                              <SelectItem value="online">Online</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      {fieldErrors.paymentMode && <div className="text-rose-600 text-xs mt-1">{fieldErrors.paymentMode}</div>}
                      {/* Conditional payment references */}
                      {(() => {
                        try {
                          const sel = (paymentModes || []).find((pm: any) => String(pm.value) === String(paymentMode));
                          const label = String(sel?.label || '').toLowerCase();
                          if (label.includes('upi')) {
                            return (
                              <div className="mt-2 space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">UPI Transaction ID <span className="text-rose-600" aria-hidden>*</span></Label>
                                <Input
                                  type="text"
                                  value={upiTxnId || ''}
                                  onChange={(e) => { setUpiTxnId(e.target.value); setFieldErrors((prev:any)=>({ ...prev, upiTxnId: '' })); }}
                                  placeholder="Enter UPI transaction reference"
                                  className={`h-8 border-slate-300 focus:border-emerald-500 rounded-lg text-xs ${fieldErrors.upiTxnId ? 'border-red-400' : ''}`}
                                  disabled={isReadOnly}
                                />
                                {fieldErrors.upiTxnId && <div className="text-rose-600 text-xs mt-1">{fieldErrors.upiTxnId}</div>}
                              </div>
                            );
                          }
                          if (label.includes('cheque') || label.includes('check')) {
                            return (
                              <div className="mt-2 space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">Cheque Number <span className="text-rose-600" aria-hidden>*</span></Label>
                                <Input
                                  type="text"
                                  value={chequeNo || ''}
                                  onChange={(e) => { setChequeNo(e.target.value); setFieldErrors((prev:any)=>({ ...prev, chequeNo: '' })); }}
                                  placeholder="Enter cheque number"
                                  className={`h-8 border-slate-300 focus:border-emerald-500 rounded-lg text-xs ${fieldErrors.chequeNo ? 'border-red-400' : ''}`}
                                  disabled={isReadOnly}
                                />
                                {fieldErrors.chequeNo && <div className="text-rose-600 text-xs mt-1">{fieldErrors.chequeNo}</div>}
                              </div>
                            );
                          }
                        } catch {}
                        return null;
                      })()}
                    </div>
          <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600">Balance Due:</span>
                        <span className="font-semibold text-slate-800">₹{balanceDue.toLocaleString()}</span>
                      </div>
                      {Number(existingPaid) > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">Includes ₹{Number(existingPaid).toLocaleString()} already paid</div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-medium text-slate-800 flex items-center">
                  <CheckCircle className="h-3 w-3 mr-2 text-blue-600" />
                  Confirmation
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2">
                  {/* Booking ID generated by backend; not shown in frontend */}
                  <div className="flex flex-col gap-2 pt-1">
                    {isReadOnly ? (
                      <div className="w-full text-center text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg py-2">
                        Cancelled
                      </div>
                    ) : (
                    <>
                    {!isSettled && !hidePrimaryAction && (
                      <Button 
                        className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 font-semibold py-1.5 rounded-lg transition-all duration-200 text-xs" 
                        onClick={handleConfirmClick}
                        disabled={isSaving}
                      >
                        <Save className="h-3 w-3 mr-2" /> 
                        {primaryActionLabel}
                      </Button>
                    )}
                    {!isSettled && hidePrimaryAction && editModeId && (
                      <Button 
                        className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 font-semibold py-1.5 rounded-lg transition-all duration-200 text-xs" 
                        onClick={handleConfirmClick}
                        disabled={isSaving}
                      >
                        <Save className="h-3 w-3 mr-2" /> 
                        Update Booking
                      </Button>
                    )}
                    {editModeId && (
                      <Button
                        variant="destructive"
                        onClick={handleCancelBooking}
                        className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-1.5 rounded-lg transition-all duration-200 text-xs"
                      >
                        Cancel Booking
                      </Button>
                    )}
                    {!editModeId && (
                      <Button
                        variant="ghost"
                        onClick={resetForm}
                        className="w-full border border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-xs py-1.5"
                      >
                        Reset Form
                      </Button>
                    )}
                    </>
                    )}
                    {createdBookingId && (
                      <div className="text-xs text-emerald-600 text-center mt-2">Booking created (ID: {String(createdBookingId)})</div>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 text-center pt-1 border-t border-slate-200">By confirming you agree to our cancellation policy and terms.</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </form>
  );
}
