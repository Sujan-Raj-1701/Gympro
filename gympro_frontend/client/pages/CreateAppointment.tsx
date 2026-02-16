import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from "react-dom";
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AppointmentService, AppointmentRow } from '@/services/appointmentService';
import AppointmentTransactionService from '@/services/appointmentTransactionService';
import { ApiService, ApiResponse } from '@/services/apiService';
import { DataService } from '@/services/userService';
import { todayYMDIST, IST_LABEL, ensureHHMMSS } from '@/lib/timezone';
import { generateSlots, filterPastSlots, buildToSlots, conflictsForStaff, deriveOverlap, TimeSlot } from '@/lib/timeSlots';
import { CalendarDays, Users, Scissors, StickyNote, Wallet, AlertTriangle, Search, X, ListChecks, Pencil, Plus, Minus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';

// Minimal skeleton for creating a salon appointment.
// Steps still pending: load masters, availability logic, totals/payment, persistence.

interface Staff { id?: string|number; name: string; price_markup_percent?: number; }
interface Service { id?: string|number; service_id?: string; name: string; price?: number; duration_minutes?: number; tax_id?: string|number; tax_rate?: number; hsn_id?: string|number; }
interface Tax { id?: string|number; name: string; tax_rate?: number; }
interface Customer { id?: string|number; name: string; phone: string; email?: string; }
interface PaymentMode { id?: string|number; mode_name: string; value?: string; label?: string; }

interface MasterMembership {
  id: number;
  membership_id: number;
  membership_name: string;
  duration_months: number;
  price: number;
  discount_percent: number;
  status: number;
}

interface CustomerSuggestion {
  customer_name?: string;
  full_name?: string;
  name?: string; // backend may return any of these
  phone?: string;
  mobile?: string;
  customer_phone?: string;
  id?: number|string;
  customer_id?: number|string; // Business customer ID (preferred over primary key id)
  email?: string;
  total_visits?: number;
  last_visit?: string;
  membership_id?: number|string; // For membership discount application
  membership_membership_name?: string; // Membership name from joined table
  membership_discount_percent?: number; // Discount percentage from joined table
  membership_membership_details?: string; // Additional membership details
  gender?: string; // Customer gender field
  customer_gender?: string; // Alternative gender field name
}

interface MasterCategory {
  id?: string | number;
  category_id?: string | number;
  category_name?: string;
  name?: string;
  category?: string;
}

interface MasterService {
  id?: string | number;
  service_id?: string;
  service_name?: string;
  name?: string;
  price?: number;
  duration_minutes?: number;
  tax_id?: string | number;
  tax_rate?: number;
  hsn_id?: string | number;
  category_id?: string | number;
  category_name?: string;
  preferred_gender?: string;
  gender?: string;
}

export default function CreateAppointment() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const params = new URLSearchParams(location.search);
  const dateParam = params.get('date');
  const staffParam = params.get('staff');
  const fromParam = params.get('from'); // HH:MM:SS
  const toParam = params.get('to');     // HH:MM:SS
  const editFlag = params.get('edit') === '1';
  const editId = params.get('id') || undefined;
  const editApptId = params.get('appointment_id') || undefined;

  const [appointmentDate, setAppointmentDate] = useState<string>(dateParam || todayYMDIST());
  const [slotFrom, setSlotFrom] = useState<string>('');
  const [slotTo, setSlotTo] = useState<string>('');
  // Pre-fill time from URL params will be handled in the consolidated useEffect below
  const baseSlots: TimeSlot[] = useMemo(()=> generateSlots(15,'00:00','23:45'),[]);
  const [slotOptions, setSlotOptions] = useState<TimeSlot[]>(()=> generateSlots(15,'00:00','23:45'));
  const [toSlotOptions, setToSlotOptions] = useState<TimeSlot[]>([]);
  const [staffId, setStaffId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerGender, setCustomerGender] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Placeholder arrays (to be loaded in next step)
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [serviceList, setServiceList] = useState<Service[]>([]);
  const [taxList, setTaxList] = useState<Tax[]>([]);
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [membershipList, setMembershipList] = useState<MasterMembership[]>([]);
  const [paymentModeList, setPaymentModeList] = useState<PaymentMode[]>([]);
  const [paymentModes, setPaymentModes] = useState<Array<{ value: string; label: string }>>([]);
  const [pendingTaxRate, setPendingTaxRate] = useState<number | null>(null);
  const [pendingStaffData, setPendingStaffData] = useState<{id?: string, name?: string} | null>(null);
  const [pendingServiceIds, setPendingServiceIds] = useState<string[] | null>(null);
  // Fallbacks to ensure edit screen shows values even if masters aren't loaded yet
  const [editFallbackServices, setEditFallbackServices] = useState<Service[]>([]);
  const [editFallbackStaff, setEditFallbackStaff] = useState<Staff | null>(null);
  // Edit-mode tax overrides from appointment_trans_summary (use when present)
  const [editTaxOverride, setEditTaxOverride] = useState<{ cgst?: number; sgst?: number; tax?: number } | null>(null);
  const [paymentMode, setPaymentMode] = useState<string>('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [taxId, setTaxId] = useState<string>('');
  const [advancePaid, setAdvancePaid] = useState<string>('');
  const [hallRent, setHallRent] = useState<string>('');
  const [discount, setDiscount] = useState<string>('0');
  // UI: collapse/expand for Advance & Payment block (default closed as requested)
  const [paymentSectionOpen, setPaymentSectionOpen] = useState<boolean>(false);
  const [isEdit, setIsEdit] = useState<boolean>(editFlag);
  const [recordId, setRecordId] = useState<string|number|undefined>(editId || undefined);
  const [recordApptId, setRecordApptId] = useState<string|undefined>(editApptId || undefined);

  // Existing appointments for overlap checking (will refine later)
  const [existing, setExisting] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [mastersLoading, setMastersLoading] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [appointmentStatus, setAppointmentStatus] = useState<'active'|'cancelled'>('active');
  const [paymentStatus, setPaymentStatus] = useState<'pending'|'advance'|'settled'>('pending');

  // Cancel confirmation dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelRemarks, setCancelRemarks] = useState('');

  // Customer suggestions state
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [customerSelectedIndex, setCustomerSelectedIndex] = useState(-1);
  const customerNameRef = useRef<HTMLInputElement|null>(null);
  const customerPhoneRef = useRef<HTMLInputElement|null>(null);
  const customerDropdownPos = useRef<{top:number;left:number;width:number}|null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string; email: string; phone: string; } | null>(null);

  // Membership state management
  const [masterMemberships, setMasterMemberships] = useState<MasterMembership[]>([]);
  const [customerMembership, setCustomerMembership] = useState<MasterMembership | null>(null);

  // Service filtering and master data
  const [masterServices, setMasterServices] = useState<MasterService[]>([]);
  const [masterCategories, setMasterCategories] = useState<MasterCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<string>('');
  const [serviceSearch, setServiceSearch] = useState<string>('');
  const [showOnlySelected, setShowOnlySelected] = useState<boolean>(false);
  const [categoryNameMap, setCategoryNameMap] = useState<Record<string, string>>({});
  const [taxExempted, setTaxExempted] = useState<boolean>(false);

  // Available categories and genders for filters
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    masterServices.forEach(service => {
      const catId = service.category_id ? String(service.category_id) : null;
      if (catId && catId !== '0') categories.add(catId);
    });
    return Array.from(categories).sort();
  }, [masterServices]);

  const availableGenders = useMemo(() => {
    const genders = new Set<string>();
    masterServices.forEach(service => {
      const gender = service.preferred_gender || service.gender;
      if (gender) genders.add(gender);
    });
    return Array.from(genders).sort();
  }, [masterServices]);

  // Filtered services based on category, gender, search, and selection filters
  const filteredServices = useMemo(() => {
    let services = masterServices;

    // Apply category filter
    if (categoryFilter) {
      services = services.filter(s => String(s.category_id) === categoryFilter);
    }

    // Apply gender filter
    if (genderFilter) {
      services = services.filter(s => (s.preferred_gender || s.gender) === genderFilter);
    }

    // Apply search filter
    if (serviceSearch) {
      const search = serviceSearch.toLowerCase();
      services = services.filter(s => 
        (s.service_name || s.name || '').toLowerCase().includes(search)
      );
    }

    // Apply show only selected filter
    if (showOnlySelected) {
      services = services.filter(s => selectedServiceIds.includes(String(s.id || s.service_id)));
    }

    return services;
  }, [masterServices, categoryFilter, genderFilter, serviceSearch, showOnlySelected, selectedServiceIds]);

  // Helper function to apply membership discount
  const applyMembershipDiscount = useCallback((membershipId: number | string | null) => {
    if (!membershipId || masterMemberships.length === 0) {
      setCustomerMembership(null);
      setDiscount('0');
      return;
    }

    const membership = masterMemberships.find(m => 
      m.membership_id == membershipId || m.id == membershipId
    );
    
    if (membership) {
      setCustomerMembership(membership);
      setDiscount(String(membership.discount_percent || 0));
      toast({
        title: "Membership Applied",
        description: `${membership.membership_name} - ${membership.discount_percent}% discount applied`
      });
    } else {
      setCustomerMembership(null);
      setDiscount('0');
    }
  }, [masterMemberships, toast]);

  // Map UI statuses to DB enum-sanitized values
  const sanitizePaymentStatus = (val: string): 'pending'|'advance'|'settled' => {
    const v = String(val || '').toLowerCase();
    if (v === 'advance') return 'advance';
    if (v === 'settled') return 'settled';
    return 'pending';
  };

  const sanitizeAppointmentStatus = (val: string): 'active'|'cancelled' => {
    const v = String(val || '').toLowerCase();
    if (v === 'cancelled' || v === 'canceled') return 'cancelled';
    return 'active';
  };

  // Convert combined status to separate statuses for UI
  // Helper function to add minutes to time string
  const addMinutes = (timeStr: string, minutes: number): string => {
    if (!timeStr) return '';
    const [hours, mins] = timeStr.split(':').map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
  };
  
  const parseStatus = (combinedStatus: string): { appointmentStatus: 'active'|'cancelled', paymentStatus: 'pending'|'advance'|'settled' } => {
    const v = String(combinedStatus || '').toLowerCase();
    if (v === 'cancelled' || v === 'canceled') {
      return { appointmentStatus: 'cancelled', paymentStatus: 'pending' };
    }
    return { 
      appointmentStatus: 'active', 
      paymentStatus: sanitizePaymentStatus(v)
    };
  };

  // Normalize gender strings coming from various sources to Select values
  const normalizeGender = (val: any): '' | 'male' | 'female' | 'other' => {
    const v = String(val ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'male' || v === 'm' || v === '1') return 'male';
    if (v === 'female' || v === 'f' || v === '2') return 'female';
    return 'other';
  };

  // Convert separate UI statuses to DB status enum
  // DB appears to reject 'advance' (Data truncated for column 'status') likely ENUM without that value.
  // Map rules:
  // - Cancelled appointment -> 'cancelled'
  // - No payment made (balance == total) -> 'pending'
  // - Partial payment (advance > 0, balance > 0) -> 'confirmed'
  // - Fully paid (balance == 0) -> 'settled'
  const combineStatus = (
    appointmentStat: string,
    paymentStat: string,
    totalAmountVal?: number,
    advanceVal?: number
  ): 'pending' | 'confirmed' | 'settled' | 'cancelled' => {
    if (appointmentStat === 'cancelled') return 'cancelled';
    const t = Number(((totalAmountVal ?? totalAmount) || 0));
    const a = Number(((advanceVal ?? advanceNum) || 0));
    if (t <= 0) return 'pending';
    if (a <= 0) return 'pending';
    if (a >= t) return 'settled';
    return 'confirmed';
  };

  // Helper to generate a sequential appointment ID
  const generateAppointmentId = async (prefix: string = 'APT-') => {
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      
      if (!acc || !ret) {
        // Fallback to simple timestamp if no account context
        return `${prefix}${Date.now()}`;
      }

      // Fetch existing appointments using the new 3-table service to determine the next sequential number
      const existingAppointments = await AppointmentTransactionService.fetchAppointments(acc, ret);
      
      // Extract numbers from appointment IDs with the same prefix
      const existingNumbers = existingAppointments
        .map(apt => apt.appointment_id || '')
        .filter(id => id.startsWith(prefix))
        .map(id => {
          const numberPart = id.replace(prefix, '');
          const num = parseInt(numberPart, 10);
          return isNaN(num) ? 0 : num;
        })
        .filter(num => num > 0);

      // Find the next sequential number
      const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
      const nextNumber = maxNumber + 1;

      return `${prefix}${nextNumber}`;
    } catch (error) {
      console.error('Error generating appointment ID:', error);
      // Fallback to timestamp-based ID if there's an error
      return `${prefix}${Date.now()}`;
    }
  };

  // Debounced customer search
  const customerSearchTimeout = useRef<number|undefined>(undefined);

  const dedupeCustomerSuggestions = (rows: CustomerSuggestion[]): CustomerSuggestion[] => {
    const seen = new Set<string>();
    const toDigits = (v: any) => String(v ?? '').replace(/\D/g, '');
    const toLower = (v: any) => String(v ?? '').trim().toLowerCase();

    const getKey = (s: CustomerSuggestion): string => {
      const customerId = (s as any).customer_id ?? s.customer_id ?? s.id;
      if (customerId != null && String(customerId).trim() !== '' && String(customerId) !== '0') {
        return `id:${String(customerId)}`;
      }

      const phone = toDigits(s.phone || s.mobile || s.customer_phone);
      if (phone) return `phone:${phone}`;

      const name = toLower(s.customer_name || s.full_name || s.name);
      const email = toLower(s.email);
      return `name:${name}|email:${email}`;
    };

    const out: CustomerSuggestion[] = [];
    for (const row of rows || []) {
      const key = getKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  };

  const performCustomerSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length === 0) { setCustomerSuggestions([]); setShowCustomerSuggestions(false); return; }
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const data = await ApiService.searchMasterCustomer(q, 10, acc, ret, true); // true for include_membership
      const unique = dedupeCustomerSuggestions(Array.isArray(data) ? data : []);
      setCustomerSuggestions(unique);
      if (unique.length > 0) {
        setShowCustomerSuggestions(true);
        // Position under name field
        const input = customerNameRef.current;
        if (input) {
          const rect = input.getBoundingClientRect();
          customerDropdownPos.current = { top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width };
        }
      } else {
        setShowCustomerSuggestions(false);
      }
    } catch (e) {
      console.warn('Customer search failed', e);
    }
  }, [user]);

  const handleCustomerInputChange = (value: string) => {
    setCustomerName(value);
    setSelectedCustomer(null);
    // Clear gender when manually typing (not selecting from suggestions)
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      setCustomerGender('');
    }
    if (customerSearchTimeout.current) window.clearTimeout(customerSearchTimeout.current);
    customerSearchTimeout.current = window.setTimeout(() => performCustomerSearch(value), 250);
  };

  const handleCustomerPhoneChange = (value: string) => {
    setCustomerPhone(value);
    setSelectedCustomer(null);
    // Clear gender when manually typing (not selecting from suggestions)
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      setCustomerGender('');
    }
    if (customerSearchTimeout.current) window.clearTimeout(customerSearchTimeout.current);
    customerSearchTimeout.current = window.setTimeout(() => performCustomerSearchByPhone(value), 250);
  };

  const performCustomerSearchByPhone = useCallback(async (phoneQuery: string) => {
    if (!phoneQuery || phoneQuery.trim().length === 0) { 
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      return;
    }
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const data = await ApiService.searchMasterCustomer(phoneQuery, 10, acc, ret, true); // true for include_membership
      const unique = dedupeCustomerSuggestions(Array.isArray(data) ? data : []);
      setCustomerSuggestions(unique);
      if (unique.length > 0) {
        setShowCustomerSuggestions(true);
        // Position under phone field
        const input = customerPhoneRef.current;
        if (input) {
          const rect = input.getBoundingClientRect();
          customerDropdownPos.current = { 
            top: rect.bottom + window.scrollY, 
            left: rect.left + window.scrollX, 
            width: rect.width 
          };
        }
      } else {
        setShowCustomerSuggestions(false);
      }
    } catch (e) {
      console.warn('Customer phone search failed', e);
    }
  }, [user]);

  const selectCustomer = async (suggestion: CustomerSuggestion) => {
    const name = suggestion.customer_name || suggestion.full_name || suggestion.name || '';
    const phone = String(suggestion.phone || suggestion.mobile || suggestion.customer_phone || '');
    // Prioritize customer_id over primary key id
    const customerId = (suggestion as any).customer_id || suggestion.id || '';
    const membershipId = (suggestion as any).membership_id;
    
    setCustomerName(name);
    setCustomerPhone(phone);
    
    // Since gender is not included in search results, fetch full customer details
    if (customerId && customerId !== '0' && customerId !== 0) {
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        
        if (acc && ret) {
          // Fetch full customer details to get gender
          const customerDetails = await DataService.readData(['master_customer'], acc, ret);
          console.log('Raw customer details response:', customerDetails);
          
          // Handle different possible data structures
          const customers = (customerDetails?.data as any)?.master_customer || 
                          (customerDetails?.data as any) || 
                          customerDetails || [];
          
          console.log('Customers array length:', Array.isArray(customers) ? customers.length : 'Not an array');
          console.log('Looking for customer_id:', customerId);
          console.log('First 3 customers:', Array.isArray(customers) ? customers.slice(0, 3) : 'Not array');
          
          // Try multiple matching strategies
          let fullCustomer = null;
          
          if (Array.isArray(customers)) {
            // Strategy 1: Match by customer_id
            fullCustomer = customers.find((c: any) => 
              String(c.customer_id || '') === String(customerId)
            );
            
            // Strategy 2: Match by id if customer_id didn't work
            if (!fullCustomer) {
              fullCustomer = customers.find((c: any) => 
                String(c.id || '') === String(customerId)
              );
            }
            
            // Strategy 3: Match by any ID field
            if (!fullCustomer) {
              fullCustomer = customers.find((c: any) => 
                String(c.customer_id || c.id || c.CUSTOMER_ID || c.ID || '') === String(customerId)
              );
            }
            
            console.log('Customer matching results:', {
              strategy1: customers.find((c: any) => String(c.customer_id || '') === String(customerId)) ? 'Found' : 'Not found',
              strategy2: customers.find((c: any) => String(c.id || '') === String(customerId)) ? 'Found' : 'Not found',
              strategy3: customers.find((c: any) => String(c.customer_id || c.id || c.CUSTOMER_ID || c.ID || '') === String(customerId)) ? 'Found' : 'Not found'
            });
          }
          
          if (fullCustomer) {
            console.log('Full customer data found:', fullCustomer);
            console.log('Available customer keys:', Object.keys(fullCustomer));
            
            // Try to get gender from full customer data
            const genderFromCustomer = fullCustomer.gender || 
                                      fullCustomer.customer_gender || 
                                      fullCustomer.Gender || 
                                      fullCustomer.GENDER ||
                                      fullCustomer.sex ||
                                      fullCustomer.SEX || '';
            
            console.log('Gender from full customer data:', genderFromCustomer);
            
            if (genderFromCustomer) {
              const normalizedGender = String(genderFromCustomer).trim().toLowerCase();
              console.log('Normalized gender:', normalizedGender);
              
              if (normalizedGender === 'male' || normalizedGender === 'm') {
                console.log('Setting gender to male');
                setCustomerGender('male');
              } else if (normalizedGender === 'female' || normalizedGender === 'f') {
                console.log('Setting gender to female');
                setCustomerGender('female');
              } else if (normalizedGender === 'other' || normalizedGender === 'o') {
                console.log('Setting gender to other');
                setCustomerGender('other');
              } else {
                console.log('Gender value not recognized:', normalizedGender);
              }
            } else {
              console.log('No gender field found in full customer data');
              console.log('Available fields in customer:', Object.keys(fullCustomer));
            }
          } else {
            console.log('Customer not found in master_customer table');
            console.log('Available customers (first 5):', Array.isArray(customers) ? 
              customers.slice(0, 5).map((c: any) => ({ 
                id: c.id, 
                customer_id: c.customer_id, 
                name: c.customer_name || c.name,
                keys: Object.keys(c) 
              })) : 'No customers array'
            );
          }
        }
      } catch (error) {
        console.error('Failed to fetch customer details:', error);
      }
    }
    
    setSelectedCustomer({
      id: String(customerId),
      name,
      email: suggestion.email || '',
      phone,
    });
    
    // Check if membership data is available directly from the API response
    if (membershipId && suggestion.membership_membership_name && suggestion.membership_discount_percent !== undefined) {
      // Use membership data directly from customer search response
      const membershipData: MasterMembership = {
        id: membershipId as number,
        membership_id: membershipId as number,
        membership_name: suggestion.membership_membership_name,
        discount_percent: suggestion.membership_discount_percent,
        duration_months: 0, // Default value, not needed for discount application
        price: 0, // Default value, not needed for discount application
        status: 1 // Default value, not needed for discount application
      };
      
      setCustomerMembership(membershipData);
      setDiscount(String(membershipData.discount_percent || 0));
      toast({
        title: "Membership Applied",
        description: `${membershipData.membership_name} - ${membershipData.discount_percent}% discount applied`
      });
    } else {
      // Fallback to the existing membership lookup logic
      applyMembershipDiscount(membershipId);
    }
    
    setShowCustomerSuggestions(false);
    setCustomerSelectedIndex(-1);
    // Focus on next field after customer selection
    setTimeout(() => { 
      const nextField = document.querySelector('input[placeholder="Add any special requirements or notes..."]') as HTMLInputElement;
      if (nextField) { 
        nextField.focus(); 
      }
    }, 50);
  };

  const handleCustomerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCustomerSuggestions && customerSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCustomerSelectedIndex(p => p < customerSuggestions.length-1 ? p+1 : 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCustomerSelectedIndex(p => p > 0 ? p-1 : customerSuggestions.length-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (customerSelectedIndex >=0) selectCustomer(customerSuggestions[customerSelectedIndex]); else selectCustomer(customerSuggestions[0]); }
      else if (e.key === 'Escape') { setShowCustomerSuggestions(false); setCustomerSelectedIndex(-1); }
    }
  };

  const handleCustomerPhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCustomerSuggestions && customerSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCustomerSelectedIndex(p => p < customerSuggestions.length-1 ? p+1 : 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCustomerSelectedIndex(p => p > 0 ? p-1 : customerSuggestions.length-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (customerSelectedIndex >=0) selectCustomer(customerSuggestions[customerSelectedIndex]); else selectCustomer(customerSuggestions[0]); }
      else if (e.key === 'Escape') { setShowCustomerSuggestions(false); setCustomerSelectedIndex(-1); }
    }
  };

  // Handler for service selection
  const handleServiceSelect = (service: MasterService) => {
    const serviceId = String(service.id || service.service_id);
    const isSelected = selectedServiceIds.includes(serviceId);
    
    if (isSelected) {
      // Remove service
      setSelectedServiceIds(prev => prev.filter(id => id !== serviceId));
    } else {
      // Add service
      setSelectedServiceIds(prev => [...prev, serviceId]);
    }
  };

  // Handler to get service quantity (for display purposes)
  const getServiceQuantity = (serviceId: string): number => {
    return selectedServiceIds.includes(serviceId) ? 1 : 0;
  };

  useEffect(()=>{ // fetch existing appointments (basic) for the date for now
    const run = async () => {
      if(!user) return; setLoading(true); setError(null);
      try {
        const acc = (user as any)?.account_code; const ret = (user as any)?.retail_code; if(!acc||!ret) return;
        const rows = await AppointmentTransactionService.fetchAppointments(acc, ret);
        setExisting(rows.filter(r=> r.appointment_date === appointmentDate));
      } catch(e:any){ setError(e.message||String(e)); }
      finally { setLoading(false); }
    };
    run();
  }, [user, appointmentDate]);

  // Separate useEffect for loading edit data from 3-table structure
  useEffect(() => {
    const loadEditData = async () => {
      if (!user || !isEdit || (!editId && !editApptId)) return;
      
      console.log('[EDIT] Loading appointment data with editId:', editId, 'editApptId:', editApptId);
      setLoading(true);
      
      try {
        const acc = (user as any)?.account_code; 
        const ret = (user as any)?.retail_code; 
        if (!acc || !ret) return;
        
        // Use appointment transaction service to get complete data
        let appointmentId = editApptId;
        
        // If we only have editId, we need to find the appointment_id
        if (!appointmentId && editId) {
          const rows = await AppointmentTransactionService.fetchAppointments(acc, ret);
          const target = rows.find(r=> String(r.id) === String(editId));
          appointmentId = target?.appointment_id;
        }
        
        if (appointmentId) {
          console.log('[EDIT] Loading complete appointment data for:', appointmentId);
          
          const appointmentResponse = await AppointmentTransactionService.get(appointmentId, acc, ret);
          console.log('[EDIT] Raw appointment response:', appointmentResponse);
          
          if (appointmentResponse?.success && appointmentResponse?.data) {
            // Some APIs return { appointment_id, data: { ...full appointment... } }
            // Normalize to always work with the inner appointment object
            const raw = appointmentResponse.data as any;
            const apptData = (raw && typeof raw === 'object' && raw.data && !Array.isArray(raw.data) && (
              raw.data.appointment_id || raw.data.customer_name || raw.data.slot_from || raw.data.employee_name
            )) ? raw.data : raw;
            console.log('[EDIT] Loaded complete appointment data:', apptData);
            
            // Set basic appointment data
            setRecordId(editId);
            setRecordApptId(appointmentId);
            setAppointmentDate(apptData.appointment_date || appointmentDate);
            
            // Set time slots
            console.log('[EDIT] Time slot data from API:', {
              slot_from: apptData.slot_from,
              slot_to: apptData.slot_to,
              available_keys: Object.keys(apptData)
            });
            
            // Normalize possible time field variants coming from API
            const rawFrom = apptData.slot_from || apptData.from_time || apptData.start_time || apptData.from_slot || '';
            const rawTo = apptData.slot_to || apptData.to_time || apptData.end_time || apptData.to_slot || '';
            const fromTime = ensureHHMMSS(String(rawFrom || ''));
            const toTime = ensureHHMMSS(String(rawTo || ''));
            console.log('[EDIT] Processed time slots:', { fromTime, toTime });
            
            setSlotFrom(fromTime);
            if (toTime) {
              console.log('[EDIT] Setting slotTo to:', toTime);
              setSlotTo(toTime); // Set immediately instead of using timeout
            } else {
              console.log('[EDIT] No toTime available, will auto-calculate from services');
              // One-time calculation when backend didn't send slot_to: derive from selected services
              try {
                const lines: any[] = Array.isArray(apptData.data) && apptData.data.length
                  ? apptData.data
                  : (Array.isArray(apptData.services) ? apptData.services : []);
                const totalDuration = (lines || []).reduce((sum, r: any) => {
                  const d = Number(r.duration_minutes || r.duration || 30);
                  return sum + (Number.isFinite(d) && d > 0 ? d : 30);
                }, 0);
                if (fromTime && totalDuration > 0) {
                  const derivedTo = addMinutes(fromTime, totalDuration);
                  console.log('[EDIT] Derived slotTo from services:', { totalDuration, derivedTo });
                  setSlotTo(derivedTo);
                }
              } catch (e) {
                console.warn('[EDIT] Could not auto-derive slot_to from services:', e);
              }
            }
            
            // Set customer data
            setCustomerName(apptData.customer_name || '');
            setCustomerPhone(String(apptData.customer_mobile || ''));
            setCustomerGender(normalizeGender(apptData.customer_gender || apptData.gender || ''));
            
            // Set staff data
            console.log('[EDIT] Setting staff data:', {
              employee_id: apptData.employee_id,
              employee_name: apptData.employee_name,
              staff_id: apptData.staff_id,
              staff_name: apptData.staff_name
            });
            
            const incomingStaffId = apptData.employee_id || apptData.staff_id;
            const incomingStaffName = apptData.employee_name || apptData.staff_name;

            if (incomingStaffId) {
              const staffIdToSet = String(incomingStaffId);
              setStaffId(staffIdToSet);
              console.log('[EDIT] Set staff ID directly:', staffIdToSet);
              // Provide a fallback staff entry so the Select can display it even before masters load
              if (incomingStaffName) {
                setEditFallbackStaff({ id: staffIdToSet, name: String(incomingStaffName) });
              }
            } else if (incomingStaffName) {
              const staffNameToSet = String(incomingStaffName);
              setStaffId(staffNameToSet);
              console.log('[EDIT] Set staff by name:', staffNameToSet);
              setEditFallbackStaff({ id: staffNameToSet, name: staffNameToSet });
            }
            
            // Store staff data for validation once staff list loads
            if (incomingStaffId || incomingStaffName) {
              const pendingData = {
                id: incomingStaffId ? String(incomingStaffId) : undefined,
                name: incomingStaffName ? String(incomingStaffName) : undefined
              };
              setPendingStaffData(pendingData);
              console.log('[EDIT] Set pending staff data:', pendingData);
            }
            
            // Set services from transaction data
            const transactionLines = apptData.data || apptData.services || [];
            console.log('[EDIT] Processing services. apptData.data:', apptData.data);
            console.log('[EDIT] Processing services. apptData.services:', apptData.services);
            
            if (Array.isArray(transactionLines) && transactionLines.length > 0) {
              console.log('[EDIT] Processing services from transaction data:', transactionLines);
              const serviceIds = transactionLines.map((line: any) => {
                const extractedId = String(line.service_id || line.id || '');
                console.log('[EDIT] Extracting service ID from line:', { line, extractedId });
                return extractedId;
              }).filter(Boolean);
              
              console.log('[EDIT] Extracted service IDs:', serviceIds);
              if (serviceIds.length > 0) {
                // Store service IDs to be resolved once service list loads
                setPendingServiceIds(serviceIds);
                // Also set immediately in case service list is already loaded
                setSelectedServiceIds(serviceIds);
                console.log('[EDIT] Set pending and selected service IDs:', serviceIds);

                // Build minimal fallback service entries so UI can render immediately
                const fallbackSvcs: Service[] = transactionLines.map((line: any) => ({
                  id: String(line.service_id || line.id || ''),
                  service_id: String(line.service_id || line.id || ''),
                  name: String(line.service_name || line.name || `Service ${String(line.service_id || line.id || '')}`),
                  price: Number(line.unit_price || line.price || 0),
                  duration_minutes: Number(line.duration_minutes || 30),
                  tax_id: line.tax_id,
                  tax_rate: Number(line.tax_rate_percent || line.tax_rate || 0)
                }));
                setEditFallbackServices(fallbackSvcs);
              }
            } else {
              console.log('[EDIT] No transaction lines found, checking alternative sources');
              // Fallback: check if services array exists separately
              if (apptData.services && Array.isArray(apptData.services) && apptData.services.length > 0) {
                console.log('[EDIT] Found services in separate array:', apptData.services);
                const serviceIds = apptData.services.map((service: any) => {
                  const extractedId = String(service.service_id || service.id || '');
                  console.log('[EDIT] Extracting service ID from service:', { service, extractedId });
                  return extractedId;
                }).filter(Boolean);
                
                console.log('[EDIT] Extracted service IDs from services array:', serviceIds);
                if (serviceIds.length > 0) {
                  // Store service IDs to be resolved once service list loads
                  setPendingServiceIds(serviceIds);
                  // Also set immediately in case service list is already loaded
                  setSelectedServiceIds(serviceIds);
                  console.log('[EDIT] Set pending and selected service IDs from services array:', serviceIds);

                  // Build minimal fallback service entries from summary rows
                  const fallbackSvcs: Service[] = apptData.services.map((s: any) => ({
                    id: String(s.service_id || s.id || ''),
                    service_id: String(s.service_id || s.id || ''),
                    name: String(s.service_name || s.name || `Service ${String(s.service_id || s.id || '')}`),
                    price: Number(s.unit_price || s.price || 0),
                    duration_minutes: 30,
                    tax_rate: Number(s.tax_rate_percent || s.tax_rate || 0)
                  }));
                  setEditFallbackServices(fallbackSvcs);
                }
              } else {
                console.log('[EDIT] No services found in any location');
              }
            }
            
            // Load financial data
            console.log('[EDIT] Loading financial data from apptData:', {
              advance_paid: apptData.advance_paid,
              payment_mode: apptData.payment_mode,
              total_discount: apptData.total_discount,
              status: apptData.status
            });
            
            if (apptData.advance_paid != null) {
              const advanceAmount = Number(apptData.advance_paid || 0);
              setAdvancePaid(String(advanceAmount));
              console.log('[EDIT] Set advance paid:', advanceAmount);
            }
            
            if (apptData.payment_mode) {
              setPaymentMode(apptData.payment_mode);
              console.log('[EDIT] Set payment mode:', apptData.payment_mode);
            }
            
            // Set financial info from aggregated data  
            if (apptData.total_discount != null) {
              const discountAmount = Number(apptData.total_discount || 0);
              setDiscount(String(discountAmount));
              console.log('[EDIT] Set discount:', discountAmount);
            }

            // Pull CGST/SGST/tax from summary if available and store as overrides for display
            try {
              // First, try detailed CGST/SGST fields or per-line aggregates
              let cg = Number(
                apptData.total_cgst ?? apptData.cgst_amount ?? (
                  Array.isArray(apptData.services)
                    ? apptData.services.reduce((s: number, r: any) => s + Number(r.total_cgst || r.cgst_amount || 0), 0)
                    : 0
                )
              ) || 0;
              let sg = Number(
                apptData.total_sgst ?? apptData.sgst_amount ?? (
                  Array.isArray(apptData.services)
                    ? apptData.services.reduce((s: number, r: any) => s + Number(r.total_sgst || r.sgst_amount || 0), 0)
                    : 0
                )
              ) || 0;

              // Derive total tax using top-level total_tax, tax_amount, or sum of per-line tax_amount
              const perLineTaxSum = Array.isArray(apptData.services)
                ? apptData.services.reduce((s: number, r: any) => s + Number(r.total_tax || r.tax_amount || 0), 0)
                : 0;
              const tx = Number(
                apptData.total_tax ?? apptData.tax_amount ?? perLineTaxSum ?? (cg + sg)
              ) || (cg + sg);

              // If only total tax is available (no CGST/SGST), split equally for display
              if ((cg <= 0 && sg <= 0) && tx > 0) {
                const half = Number((tx / 2).toFixed(2));
                cg = half;
                sg = half;
              }

              if (cg > 0 || sg > 0 || tx > 0) {
                setEditTaxOverride({ cgst: cg, sgst: sg, tax: tx });
                console.log('[EDIT] Applied tax overrides from summary:', { cg, sg, tx });
              }
            } catch (e) {
              console.warn('[EDIT] Could not derive tax overrides from summary:', e);
            }
            
            // Load appointment and payment status
            if (apptData.status) {
              const statusInfo = parseStatus(apptData.status);
              setAppointmentStatus(statusInfo.appointmentStatus);
              setPaymentStatus(statusInfo.paymentStatus);
              console.log('[EDIT] Set status:', statusInfo);
            }
            
            // Load notes
            if (apptData.special_requirements) {
              setNotes(apptData.special_requirements);
            }

            // If gender is still empty, try to resolve from master_customer using phone or name
            try {
              const currentGender = apptData.customer_gender || apptData.gender || '';
              if (!currentGender) {
                const acc = (user as any)?.account_code; const ret = (user as any)?.retail_code;
                if (acc && ret) {
                  const read = await DataService.readData(['master_customer'], acc, ret);
                  // Handle possible response shapes (array vs object)
                  const allCust: any[] = ((read?.data as any)?.master_customer || (read?.data as any) || read || []) as any[];
                  const phone = String(apptData.customer_mobile || '').trim();
                  const name = String(apptData.customer_name || '').toLowerCase().trim();
                  const found = allCust.find(c => {
                    const p = String(c.phone || c.mobile || c.customer_phone || '').trim();
                    const n = String(c.customer_name || c.full_name || c.name || '').toLowerCase().trim();
                    return (phone && p === phone) || (name && n === name);
                  });
                  if (found && (found.gender || found.customer_gender)) {
                    setCustomerGender(normalizeGender(found.gender || found.customer_gender));
                  }
                }
              }
            } catch (e) {
              console.warn('[EDIT] Could not resolve gender from master_customer:', e);
            }
            
          } else {
            console.error('[EDIT] Response structure issue:', {
              success: appointmentResponse?.success,
              hasData: !!appointmentResponse?.data,
              responseKeys: appointmentResponse ? Object.keys(appointmentResponse) : []
            });
            setError(`Failed to load appointment data: ${!appointmentResponse?.success ? 'Request failed' : 'No data in response'}`);
          }
        } else {
          console.error('[EDIT] Could not find appointment ID for editing');
          setError('Could not find appointment to edit');
        }
      } catch (error: any) {
        console.error('[EDIT] Error loading appointment data:', error);
        setError('Failed to load appointment data: ' + error.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadEditData();
  }, [user, isEdit, editId, editApptId, appointmentDate]);

  useEffect(()=>{
    const run = async () => {
      if(!user) return; setMastersLoading(true);
      try {
        const acc = (user as any)?.account_code; const ret = (user as any)?.retail_code; if(!acc||!ret) return;
        const resp = await DataService.readData([
          'master_employee', 
          'master_service', 
          'master_tax', 
          'master_customer', 
          'master_membership', 
          'master_paymentmodes',
          'master_category'
        ], acc, ret);
        
        // DataService may return either:
        // - { data: { master_employee: [...], master_service: [...], ... } }
        // - { data: [ { master_employee: [...], ... } ] }
        const rawData: any = (resp as any)?.data;
        const allData = Array.isArray(rawData)
          ? (rawData[0] || {})
          : (rawData?.data || rawData || {});
  const svcRows: any[] = allData.master_service || allData.master_services || allData.services || [];
  const stfRows: any[] = allData.master_employee || allData.master_staff || allData.staff || [];
        const payRows: any[] = allData.master_paymentmodes || allData.master_payment_mode || allData.payment_modes || [];
        const custRows: any[] = allData.master_customer || allData.customers || [];
        const taxRows: any[] = allData.master_tax || allData.tax || [];
        const membershipRows: any[] = allData.master_membership || allData.membership || [];
        const categoryRows: any[] = allData.master_category || allData.categories || [];
        
        setServiceList(svcRows.map(r=>({
          // Be liberal in what we accept: various backends send different keys
          id: String(
            r.service_id ?? r.id ?? r.serviceid ?? r.code ?? r.service_code ?? ''
          ),
          service_id: String(
            r.service_id ?? r.serviceid ?? r.id ?? r.code ?? r.service_code ?? ''
          ), // Ensure service_id is always present for matching
          name: String(r.service_name ?? r.name ?? r.title ?? ''),
          price: Number(r.price ?? r.service_price ?? r.base_price ?? 0),
          duration_minutes: Number(r.duration_minutes ?? r.duration ?? r.service_duration ?? 30),
          tax_id: r.tax_id ?? r.gst_id ?? r.hsn_id,
          tax_rate: Number(r.tax_rate ?? r.tax_rate_percent ?? r.gst_percentage ?? 0),
          price_markup_percent: Number(r.price_markup_percent ?? 0)
        })));
        
        // Set master services for the new UI
        setMasterServices(svcRows.map(r=>({
          id: String(r.service_id ?? r.id ?? r.serviceid ?? r.code ?? r.service_code ?? ''),
          service_id: String(r.service_id ?? r.serviceid ?? r.id ?? r.code ?? r.service_code ?? ''),
          service_name: String(r.service_name ?? r.name ?? r.title ?? ''),
          name: String(r.service_name ?? r.name ?? r.title ?? ''),
          price: Number(r.price ?? r.service_price ?? r.base_price ?? 0),
          duration_minutes: Number(r.duration_minutes ?? r.duration ?? r.service_duration ?? 30),
          tax_id: r.tax_id ?? r.gst_id ?? r.hsn_id,
          tax_rate: Number(r.tax_rate ?? r.tax_rate_percent ?? r.gst_percentage ?? 0),
          hsn_id: r.hsn_id,
          category_id: r.category_id ?? r.service_category_id,
          category_name: r.category_name ?? r.service_category_name,
          preferred_gender: r.preferred_gender ?? r.gender ?? r.service_gender
        })));
        
        // Set master categories
        setMasterCategories(categoryRows.map(r=>({
          id: String(r.id ?? r.category_id ?? ''),
          category_id: String(r.category_id ?? r.id ?? ''),
          category_name: String(r.category_name ?? r.name ?? ''),
          name: String(r.category_name ?? r.name ?? ''),
          category: String(r.category_name ?? r.name ?? '')
        })));
        
        // Build category name map
        const categoryNameMap: Record<string, string> = {};
        categoryRows.forEach((cat: any) => {
          const id = String(cat.id ?? cat.category_id ?? '');
          const name = cat.category_name ?? cat.name ?? cat.category ?? id;
          if (id) categoryNameMap[id] = name;
        });
        setCategoryNameMap(categoryNameMap);
        setStaffList(stfRows.map(r=>({
          // Accept staff_id/employee_id/id; likewise for name
          id: String(r.employee_id ?? r.staff_id ?? r.id ?? r.code ?? ''),
          name: String(r.employee_name ?? r.staff_name ?? r.name ?? r.title ?? ''),
          role: String(r.employee_role ?? r.role ?? 'Staff'),
          available: Boolean(r.available ?? true),
          price_markup_percent: Number(r.price_markup_percent ?? 0)
        })));
        setTaxList(taxRows.map(r => {
          let derivedRate = r.tax_rate ?? r.taxRate ?? r.rate ?? r.percentage ?? r.gst_percentage;
          if (derivedRate == null || derivedRate === '') {
            const cg = Number(r.cgst || 0); const sg = Number(r.sgst || 0);
            if (cg > 0 || sg > 0) { derivedRate = cg + sg; }
          }
          return { id: String(r.id || ''), name: String(r.tax_name || r.name || ''), tax_rate: Number(derivedRate || 0) };
        }));
        setMembershipList(membershipRows.map(r=>{
          let durationMonths = r.membership_duration;
          if(typeof durationMonths === 'string') {
            if(durationMonths.includes('month')) {
              durationMonths = parseInt(durationMonths.match(/\d+/)?.[0] || '0');
            } else if(durationMonths.includes('year')) {
              const years = parseInt(durationMonths.match(/\d+/)?.[0] || '0');
              durationMonths = years * 12;
            } else {
              durationMonths = parseInt(durationMonths) || 0;
            }
          }
          return {
            id: Number(r.id || 0),
            membership_id: Number(r.membership_id || r.id || 0),
            membership_name: String(r.membership_name || r.name || ''),
            duration_months: Number(durationMonths || 0),
            price: Number(r.membership_price || r.price || 0),
            discount_percent: Number(r.discount_percent || 0),
            status: Number(r.status || 1)
          };
        }));
        setPaymentModeList(payRows.map(r=>({
          id: String(r.payment_mode_id || r.id || ''),
          mode_name: String(r.payment_mode_name || r.name || ''),
          active: Boolean(r.active ?? true)
        })));
        setCustomerList(custRows.map(r=>({
          id: String(r.customer_id || r.id || ''),
          name: String(r.customer_name || r.name || ''),
          phone: String(r.customer_mobile || r.phone || ''),
          email: String(r.customer_email || r.email || ''),
          address: String(r.customer_address || r.address || ''),
          account_code: acc,
          retail_code: ret,
          active: Boolean(r.active ?? true)
        })));
        
        // Set master memberships state for customer membership functionality
        setMasterMemberships(membershipRows.map(r=>{
          let durationMonths = r.membership_duration;
          if(typeof durationMonths === 'string') {
            if(durationMonths.includes('month')) {
              durationMonths = parseInt(durationMonths.match(/\d+/)?.[0] || '0');
            } else if(durationMonths.includes('year')) {
              const years = parseInt(durationMonths.match(/\d+/)?.[0] || '0');
              durationMonths = years * 12;
            } else {
              durationMonths = parseInt(durationMonths) || 0;
            }
          }
          return {
            id: Number(r.id || 0),
            membership_id: Number(r.membership_id || r.id || 0),
            membership_name: String(r.membership_name || r.name || ''),
            duration_months: Number(durationMonths || 0),
            price: Number(r.membership_price || r.price || 0),
            discount_percent: Number(r.discount_percent || 0),
            status: Number(r.status || 1)
          };
        }));
        
        // Set payment modes dropdown options
        const pmOpts = (payRows || []).map((r:any, idx:number)=>{
          const name = String(r.payment_mode_name ?? r.name ?? r.mode ?? r.payment_mode ?? `Mode ${idx+1}`);
          return { value: name, label: name };
        });
        // stable sort by label
        pmOpts.sort((a,b)=> a.label.localeCompare(b.label));
        setPaymentModes(pmOpts);
      } catch(e:any){ setError(e.message||String(e)); }
      finally { setMastersLoading(false); }
    };
    run();
  }, [user]);

  useEffect(() => {
    if (!isEdit || staffList.length === 0 || !pendingStaffData) return;
    
    console.log('[EDIT] Resolving pending staff data:', pendingStaffData);
    console.log('[EDIT] Available staff:', staffList.map(s => ({ id: s.id, name: s.name })));
    
    const { id, name } = pendingStaffData;
    let staffMember = null;
    
    // Strategy 1: Match by ID
    if (id) {
      staffMember = staffList.find(s => String(s.id) === String(id));
      console.log(`[EDIT] Staff match by ID ${id}:`, staffMember ? 'Found' : 'Not found');
    }
    
    // Strategy 2: Match by name if ID didn't work
    if (!staffMember && name) {
      staffMember = staffList.find(s => 
        s.name && s.name.toLowerCase().trim() === String(name).toLowerCase().trim()
      );
      console.log(`[EDIT] Staff match by name "${name}":`, staffMember ? 'Found' : 'Not found');
    }
    
    if (staffMember) {
      const staffIdToSet = String(staffMember.id);
      setStaffId(staffIdToSet);
      setPendingStaffData(null);
      console.log('[EDIT] Successfully resolved staff:', { staffMember, staffIdToSet });
    } else {
      console.warn('[EDIT] Could not resolve staff:', {
        pendingData: pendingStaffData,
        availableStaff: staffList.map(s => ({ id: s.id, name: s.name }))
      });
    }
  }, [isEdit, staffList, pendingStaffData]);

  useEffect(() => {
    if (!isEdit || serviceList.length === 0 || !pendingServiceIds) return;
    
    console.log('[EDIT] Resolving pending service IDs:', pendingServiceIds);
    console.log('[EDIT] Available services:', serviceList.map(s => ({ id: s.id, service_id: s.service_id, name: s.name })));
    
    // Try multiple matching strategies for better compatibility
    const resolvedCanonicalIds = pendingServiceIds
      .map(id => {
        // Prefer canonical UI id (s.id). If incoming matches service_id, translate to s.id
        const byId = serviceList.find(s => String(s.id) === String(id));
        if (byId) {
          console.log(`[EDIT] Service match by id for incoming ${id} -> canonical ${byId.id}`);
          return String(byId.id);
        }
        const byServiceId = serviceList.find(s => String(s.service_id) === String(id));
        if (byServiceId) {
          console.log(`[EDIT] Service match by service_id for incoming ${id} -> canonical ${byServiceId.id}`);
          return String(byServiceId.id);
        }
        console.warn(`[EDIT] Service not found for incoming ${id}`);
        return null;
      })
      .filter((v): v is string => !!v);

    console.log('[EDIT] Resolved canonical service IDs:', resolvedCanonicalIds);
    
    if (resolvedCanonicalIds.length > 0) {
      setSelectedServiceIds(resolvedCanonicalIds);
      setPendingServiceIds(null);
      console.log('[EDIT] Successfully resolved and normalized service IDs:', resolvedCanonicalIds);
    } else {
      console.warn('[EDIT] No valid service IDs found. Available service info:', {
        pendingIds: pendingServiceIds,
        availableServiceIds: serviceList.map(s => s.id),
        availableServiceServiceIds: serviceList.map(s => s.service_id)
      });
    }
  }, [isEdit, serviceList, pendingServiceIds]);

  useEffect(() => {
    if (!isEdit || taxList.length === 0 || (!pendingTaxRate && taxId !== 'auto-resolve')) return;
    
    if (pendingTaxRate != null) {
      const matchingTax = taxList.find(t => Math.abs((t.tax_rate || 0) - pendingTaxRate) < 0.01);
      if (matchingTax) {
        setTaxId(String(matchingTax.id));
        setPendingTaxRate(null);
      }
    }
  }, [isEdit, taxList, pendingTaxRate, taxId]);

  useEffect(()=>{
    // In edit mode, respect the persisted end time from backend
    if (isEdit) return;
    if(!slotFrom) return;
    if(!serviceList || serviceList.length === 0) return;
    if(!selectedServiceIds || selectedServiceIds.length === 0) return;
    const services = selectedServiceIds.map(id=>serviceList.find(s=>s.id===id)).filter(Boolean);
    if(services.length === 0) return;
    const totalDuration = services.reduce((sum, service) => sum + (service?.duration_minutes || 30), 0);
    const endTime = addMinutes(slotFrom, totalDuration);
    setSlotTo(endTime);
  },[isEdit, slotFrom, serviceList, selectedServiceIds]);

  // Edit-mode fallback: if slot_to missing after masters/services load, derive from selected services
  useEffect(() => {
    if (!isEdit) return;
    if (!slotFrom) return;
    if (slotTo) return; // already have one from backend

    // Prefer resolved masters; fallback to editFallbackServices
    let services: Array<{ duration_minutes?: number } | undefined> = [];
    if (selectedServiceIds && selectedServiceIds.length && serviceList && serviceList.length) {
      services = selectedServiceIds.map(id => serviceList.find(s => s.id === id));
    } else if (editFallbackServices && editFallbackServices.length) {
      services = editFallbackServices;
    }

    const valid = services.filter(Boolean) as Array<{ duration_minutes?: number }>;
    if (!valid.length) return;
    const totalDuration = valid.reduce((sum, s) => sum + (Number(s.duration_minutes || 30) || 30), 0);
    if (totalDuration <= 0) return;

    // Use helper to pick a valid to-slot from available list
    const desired = addMinutesToFrom(slotFrom, totalDuration);
    if (desired && toSlotOptions?.some(s => s.value === desired)) {
      setSlotTo(desired);
      return;
    }
    // Fallback: choose the closest not exceeding desired
    if (toSlotOptions && toSlotOptions.length) {
      const sorted = [...toSlotOptions].sort((a,b)=> a.value.localeCompare(b.value));
      let pick: any = null;
      for (let i=sorted.length-1; i>=0; i--) { if (desired && sorted[i].value <= desired) { pick = sorted[i]; break; } }
      if (!pick) pick = sorted[0];
      if (pick?.value) setSlotTo(pick.value);
    }
  }, [isEdit, slotFrom, slotTo, selectedServiceIds, serviceList, editFallbackServices, toSlotOptions]);

  useEffect(() => {
    // If a customer was selected from suggestions, keep the dropdown closed.
    // Typing again clears `selectedCustomer` (see input handlers), which re-enables suggestions.
    if (selectedCustomer) {
      setShowCustomerSuggestions(false);
      return;
    }

    if (!customerName.trim()) {
      setShowCustomerSuggestions(false);
      setCustomerSuggestions([]);
      return;
    }

    const filtered = customerList
      .filter(c =>
        c.name.toLowerCase().includes(customerName.toLowerCase()) ||
        c.phone.includes(customerName)
      )
      .slice(0, 5);

    setCustomerSuggestions(filtered as any);
    setShowCustomerSuggestions(filtered.length > 0);
  }, [customerName, customerList, selectedCustomer]);



  // Resolve tax by rate if no tax_id was provided during edit
  useEffect(() => {
    if (pendingTaxRate != null && taxList.length > 0 && taxId === 'no-tax') {
      const matchingTax = taxList.find(t => Number(t.tax_rate) === Number(pendingTaxRate));
      if (matchingTax) {
        setTaxId(String(matchingTax.id || matchingTax.name));
        console.log('[EDIT] Resolved tax by rate:', matchingTax);
      }
      setPendingTaxRate(null); // Clean up
    }
  }, [taxList, taxId, pendingTaxRate]);

  // Debug selected services when serviceList loads
  useEffect(() => {
    if (selectedServiceIds.length > 0 && serviceList.length > 0) {
      console.log('[EDIT] Service matching debug:');
      console.log('Selected service IDs:', selectedServiceIds);
      console.log('Available services:', serviceList.map(s => ({ id: s.id, name: s.name })));
      
      const matchedServices = selectedServiceIds
        .map(id => serviceList.find(s => String(s.id || s.name) === String(id)))
        .filter(Boolean);
      console.log('Matched services:', matchedServices);
      
      if (matchedServices.length !== selectedServiceIds.length) {
        console.warn('[EDIT] Some services could not be matched!');
        // Try alternative matching strategies
        const alternativeMatches = selectedServiceIds.map(id => {
          // Try matching by name if ID match fails
          return serviceList.find(s => 
            String(s.id || s.name) === String(id) ||
            String(s.name).toLowerCase() === String(id).toLowerCase() ||
            String(s.id) === String(id)
          );
        }).filter(Boolean);
        console.log('Alternative matches:', alternativeMatches);
      }
    }
  }, [selectedServiceIds, serviceList]);

  // Auto-detect membership when customer suggestions are loaded
  useEffect(() => {
    if (!customerSuggestions.length || !customerName.trim()) return;

    const currentName = customerName.toLowerCase().trim();
    const currentPhone = String(customerPhone || '').trim();

    // Find matching customer suggestion
    const matchingCustomer = customerSuggestions.find(suggestion => {
      const suggestionName = (suggestion.customer_name || suggestion.full_name || suggestion.name || '').toLowerCase().trim();
      const suggestionPhone = (suggestion.phone || suggestion.mobile || suggestion.customer_phone || '').trim();
      
      return suggestionName === currentName || 
             (currentPhone && suggestionPhone && suggestionPhone === currentPhone);
    });

    if (matchingCustomer?.membership_id) {
      applyMembershipDiscount(matchingCustomer.membership_id);
    }
  }, [customerSuggestions, customerName, customerPhone, applyMembershipDiscount]);

  // Preselect staff from query param once staff list is available
  useEffect(()=>{
    if (!staffParam) return;
    if (!staffList.length) return;
    const byName = staffList.find(s=> (s.name||'').toLowerCase() === String(staffParam).toLowerCase());
    const byId = staffList.find(s=> String(s.id) === String(staffParam));
    const sel = byName || byId;
    if (sel) setStaffId(String(sel.id || sel.name));
  }, [staffParam, staffList]);

  // Validate and fix staffId during edit mode once staff list is loaded
  useEffect(() => {
    if (!isEdit || !staffList.length) return;
    
    let resolvedStaff = null;
    
    // If we have pending staff data from the appointment, try to resolve it
    if (pendingStaffData) {
      // First try to match by ID
      if (pendingStaffData.id) {
        resolvedStaff = staffList.find(s => String(s.id) === String(pendingStaffData.id));
      }
      
      // If no match by ID, try to match by name
      if (!resolvedStaff && pendingStaffData.name) {
        resolvedStaff = staffList.find(s => 
          String(s.name || '').toLowerCase().trim() === String(pendingStaffData.name || '').toLowerCase().trim()
        );
      }
      
      if (resolvedStaff) {
        const newStaffId = String(resolvedStaff.id || resolvedStaff.name);
        console.log('Resolved staff successfully:', { 
          pendingData: pendingStaffData, 
          resolvedStaff, 
          newStaffId 
        });
        setStaffId(newStaffId);
        setPendingStaffData(null); // Clear pending data
        return;
      }
    }
    
    // Check if current staffId exists in the staff list
    if (staffId) {
      const staffExists = staffList.find(s => String(s.id || s.name) === String(staffId));
      if (staffExists) {
        console.log('Staff ID validated successfully:', staffExists);
        return;
      }
    }
    
    // If we reach here, staff couldn't be resolved
    console.log('Staff ID not found in list:', { 
      staffId, 
      pendingStaffData, 
      staffListCount: staffList.length,
      staffListSample: staffList.slice(0, 3).map(s => ({ id: s.id, name: s.name }))
    });
    
    // Use first available staff as fallback
    const firstStaff = staffList[0];
    if (firstStaff) {
      console.log('Using first available staff as fallback:', firstStaff);
      setStaffId(String(firstStaff.id || firstStaff.name));
    }
  }, [isEdit, staffList, staffId, pendingStaffData]);

  // Preselect time slots from query params if valid
  useEffect(()=>{
    console.log('Time preselection useEffect triggered:', { fromParam, toParam, appointmentDate, baseSlotsLength: baseSlots.length });
    
    // Only proceed if we have URL params and slots are loaded
    if (!fromParam || !toParam || !baseSlots.length) {
      console.log('Skipping time preselection - missing params or slots');
      return;
    }

    const ensure = (v?: string|null)=> v ? ensureHHMMSS(v) : '';
    const f = ensure(fromParam);
    const t = ensure(toParam);
    
    console.log('Ensured time formats:', { f, t });
    
    if (!f || !t) {
      console.log('Failed to ensure time formats');
      return;
    }
    
    const fOk = baseSlots.find(s=> s.value === f);
    const tOk = baseSlots.find(s=> s.value === t);
    
    console.log('Time slot validation:', { fOk: !!fOk, tOk: !!tOk });
    
    if (fOk && tOk) {
      console.log('Setting time slots from URL params:', f, t);
      setSlotFrom(f);
      // Set slotTo after a small delay to ensure slotFrom is processed first
      setTimeout(() => {
        console.log('Setting slotTo:', t);
        setSlotTo(t);
      }, 50);
    } else {
      console.log('Time slots not found in baseSlots. Available values:', baseSlots.map(s => s.value).slice(0, 5));
    }
  }, [fromParam, toParam, appointmentDate, baseSlots]);

  // Auto-initialize "From Time" to current time when no URL params and not editing
  useEffect(() => {
    console.log('Auto-initialize from time useEffect triggered:', { 
      fromParam, toParam, slotFrom, isEdit, baseSlots: baseSlots.length, appointmentDate 
    });
    
    // Only auto-initialize if:
    // 1. No URL params for time
    // 2. Not in edit mode
    // 3. No current slotFrom value
    // 4. Base slots are loaded
    if (fromParam || toParam || isEdit || slotFrom || !baseSlots.length) {
      console.log('Skipping auto-initialize - conditions not met:', {
        fromParam: !!fromParam,
        toParam: !!toParam,
        isEdit,
        hasSlotFrom: !!slotFrom,
        hasBaseSlots: baseSlots.length > 0
      });
      return;
    }
    
    console.log('Auto-initializing time slot...');
    
    // Get available slots for the selected date
    const today = todayYMDIST();
    let availableSlots = baseSlots.slice(); // Copy all slots
    
    // If it's today, filter out past slots
    if (appointmentDate === today) {
      availableSlots = filterPastSlots(baseSlots, appointmentDate);
      console.log('Filtered past slots for today, remaining:', availableSlots.length);
    } else {
      // For future dates, use the first slot (e.g., 8:00 AM)
      console.log('Future date, using all slots');
    }
    
    if (availableSlots.length > 0) {
      const firstAvailable = availableSlots[0];
      console.log('Auto-initializing from time to:', firstAvailable.value, firstAvailable.label);
      setSlotFrom(firstAvailable.value);
    } else {
      // Fallback to first base slot if no available slots
      const fallbackSlot = baseSlots[0];
      if (fallbackSlot) {
        console.log('No available slots, using fallback:', fallbackSlot.value, fallbackSlot.label);
        setSlotFrom(fallbackSlot.value);
      } else {
        console.log('No slots available at all');
      }
    }
  }, [fromParam, toParam, slotFrom, isEdit, baseSlots, appointmentDate]);

  const disabled = !appointmentDate || !slotFrom || !slotTo || !staffId || !customerName;
  
  // Debug logging for button state
  console.log('Button state:', { 
    isEdit, 
    disabled, 
    overlapError, 
    appointmentDate: !!appointmentDate, 
    slotFrom: !!slotFrom, 
    slotTo: !!slotTo, 
    staffId: !!staffId, 
    customerName: !!customerName,
    actualValues: {
      appointmentDate,
      slotFrom,
      slotTo,
      staffId,
      customerName
    }
  });
  // Pricing derivations with staff markup
  const selectedServicesMemo = useMemo(() => {
    const sourceServices = (serviceList && serviceList.length > 0) ? serviceList : editFallbackServices;
    return selectedServiceIds
      .map(id => {
        // Try multiple matching strategies
        let service = sourceServices.find(s => String(s.id) === String(id));
        if (!service) {
          service = sourceServices.find(s => String(s.service_id) === String(id));
        }
        if (!service) {
          service = sourceServices.find(s => String(s.name) === String(id));
        }
        return service;
      })
      .filter(Boolean) as Service[];
  }, [selectedServiceIds, serviceList, editFallbackServices]);

  // Get selected staff's markup percentage
  // Build staff options that always include fallback staff (so UI shows selection even if masters miss it)
  const staffOptions = useMemo(() => {
    const base = Array.isArray(staffList) ? [...staffList] : [];
    if (editFallbackStaff) {
      const exists = base.find(s =>
        (s.id != null && String(s.id) === String(editFallbackStaff.id)) ||
        (s.name && editFallbackStaff.name && String(s.name).toLowerCase().trim() === String(editFallbackStaff.name).toLowerCase().trim())
      );
      if (!exists) base.unshift(editFallbackStaff);
    }
    return base;
  }, [staffList, editFallbackStaff]);

  const selectedStaffMarkup = useMemo(() => {
    const staff = staffOptions.find(s => String(s.id || s.name) === staffId);
    return Number(staff?.price_markup_percent || 0);
  }, [staffOptions, staffId]);

  // Hall rent & discount
  const hallRentNum = useMemo(()=> Number(hallRent) || 0, [hallRent]);
  const discountNum = useMemo(()=> Math.max(Number(discount)||0, 0), [discount]);
  
  // Check if current discount is from membership
  const isDiscountFromMembership = useMemo(() => {
    return customerMembership && Number(discount) === customerMembership.discount_percent;
  }, [customerMembership, discount]);

  // Calculate per-service tax amounts based on individual service tax_id
  const serviceTaxCalculations = useMemo(() => {
    return selectedServicesMemo.map(service => {
      const basePrice = Number(service?.price || 0);
      const markedUpPrice = selectedStaffMarkup > 0 ? basePrice * (1 + selectedStaffMarkup / 100) : basePrice;
      
      // Find tax rate for this service
      // Prefer the service's own tax_rate if present; fallback to tax_id lookup.
      let taxRate = 0;
      if (service.tax_rate != null && !isNaN(Number(service.tax_rate))) {
        taxRate = Number(service.tax_rate);
      } else if (service.tax_id) {
        const taxRecord = taxList.find(t => String(t.id) === String(service.tax_id));
        if (taxRecord) {
          taxRate = Number(taxRecord.tax_rate || 0);
        }
      }
      
      // Calculate CGST/SGST (split equally)
      const cgstRate = taxRate / 2;
      const sgstRate = taxRate / 2;
      const cgstAmount = (markedUpPrice * cgstRate) / 100;
      const sgstAmount = (markedUpPrice * sgstRate) / 100;
      const totalTaxAmount = cgstAmount + sgstAmount;
      
      return {
        service,
        basePrice,
        markedUpPrice,
        taxRate,
        cgstRate,
        sgstRate,
        cgstAmount,
        sgstAmount,
        totalTaxAmount
      };
    });
  }, [selectedServicesMemo, selectedStaffMarkup, taxList]);

  // Aggregate totals from individual service calculations
  const serviceSubtotalWithTax = useMemo(() => {
    return serviceTaxCalculations.reduce((sum, calc) => sum + calc.markedUpPrice, 0);
  }, [serviceTaxCalculations]);

  const serviceSubtotal = useMemo(() => {
    return serviceSubtotalWithTax;
  }, [serviceSubtotalWithTax]);

  // Calculate actual membership discount amount (not percentage)
  const membershipDiscountAmount = useMemo(() => {
    if (customerMembership && isDiscountFromMembership && serviceSubtotalWithTax > 0) {
      const amount = (serviceSubtotalWithTax * customerMembership.discount_percent) / 100;
      console.log(`[MEMBERSHIP_DISCOUNT] Calculated amount: ₹${amount} (${customerMembership.discount_percent}% of ₹${serviceSubtotalWithTax})`);
      return amount;
    }
    return 0;
  }, [customerMembership, isDiscountFromMembership, serviceSubtotalWithTax]);

  const totalCgstAmount = useMemo(() => {
    if (taxExempted) return 0;
    return serviceTaxCalculations.reduce((sum, calc) => sum + calc.cgstAmount, 0);
  }, [serviceTaxCalculations, taxExempted]);

  const totalSgstAmount = useMemo(() => {
    if (taxExempted) return 0;
    return serviceTaxCalculations.reduce((sum, calc) => sum + calc.sgstAmount, 0);
  }, [serviceTaxCalculations, taxExempted]);

  const totalServiceTaxAmount = useMemo(() => {
    if (taxExempted) return 0;
    return serviceTaxCalculations.reduce((sum, calc) => sum + calc.totalTaxAmount, 0);
  }, [serviceTaxCalculations, taxExempted]);

  // Base before tax = Hall Rent + Services - Discount
  const baseBeforeTax = useMemo(()=> {
    const gross = hallRentNum + serviceSubtotalWithTax;
    return Math.max(gross - discountNum, 0);
  }, [hallRentNum, serviceSubtotalWithTax, discountNum]);

  // For display purposes, calculate average tax rate
  const averageTaxRate = useMemo(() => {
    if (serviceSubtotalWithTax === 0) return 18; // Default fallback
    return (totalServiceTaxAmount / serviceSubtotalWithTax) * 100;
  }, [totalServiceTaxAmount, serviceSubtotalWithTax]);

  // Hall rent tax calculation (use default 18% or selected tax)
  const hallRentTaxRate = useMemo(() => {
    if (taxId && taxId !== 'no-tax') {
      const selectedTax = taxList.find(t => String(t.id || t.name) === String(taxId));
      if (selectedTax) return Number(selectedTax.tax_rate || 0);
    }
    return 18; // Default for hall rent
  }, [taxId, taxList]);

  const hallRentTaxAmount = useMemo(() => {
    if (taxExempted) return 0;
    return (hallRentNum * hallRentTaxRate) / 100;
  }, [hallRentNum, hallRentTaxRate, taxExempted]);

  // Total tax amount = service taxes + hall rent tax
  const totalTaxAmount = useMemo(() => {
    return totalServiceTaxAmount + hallRentTaxAmount;
  }, [totalServiceTaxAmount, hallRentTaxAmount]);

  // Use edit-mode overrides (summary) for tax when available to compute the displayed grand total
  const totalTaxForTotal = useMemo(() => {
    if (isEdit && editTaxOverride) {
      if (editTaxOverride.tax != null) return Number(editTaxOverride.tax);
      return Number(editTaxOverride.cgst || 0) + Number(editTaxOverride.sgst || 0);
    }
    return totalTaxAmount;
  }, [isEdit, editTaxOverride, totalTaxAmount]);

  // Final totals
  const totalBeforeTax = useMemo(() => {
    return Math.max(serviceSubtotalWithTax + hallRentNum - discountNum, 0);
  }, [serviceSubtotalWithTax, hallRentNum, discountNum]);

  const totalAmount = useMemo(() => {
    return totalBeforeTax + totalTaxForTotal;
  }, [totalBeforeTax, totalTaxForTotal]);
  const advanceNum = useMemo(()=> Number(advancePaid)||0, [advancePaid]);
  const balanceDue = useMemo(()=> {
    const balance = totalAmount - advanceNum;
    // Round to 2 decimal places to handle floating point precision issues
    const roundedBalance = Math.round(balance * 100) / 100;
    // If the balance is very close to zero (within 0.01), treat it as zero
    return Math.abs(roundedBalance) < 0.01 ? 0 : Math.max(roundedBalance, 0);
  }, [totalAmount, advanceNum]);
  const balanceDueUI = useMemo(()=> paymentStatus === 'settled' ? 0 : balanceDue, [paymentStatus, balanceDue]);

  // For backward compatibility and UI display
  const cgstRate = useMemo(() => averageTaxRate / 2, [averageTaxRate]);
  const sgstRate = useMemo(() => averageTaxRate / 2, [averageTaxRate]);
  const cgstAmount = useMemo(() => totalCgstAmount + (hallRentTaxAmount / 2), [totalCgstAmount, hallRentTaxAmount]);
  const sgstAmount = useMemo(() => totalSgstAmount + (hallRentTaxAmount / 2), [totalSgstAmount, hallRentTaxAmount]);
  // Prefer persisted summary amounts in edit mode when available

  const taxRate = useMemo(() => Number(averageTaxRate.toFixed(2)), [averageTaxRate]);
  const taxAmount = useMemo(() => {
    if (isEdit && editTaxOverride) {
      if (editTaxOverride.tax != null) return Number(editTaxOverride.tax);
      if (editTaxOverride.cgst != null || editTaxOverride.sgst != null) {
        return Number(editTaxOverride.cgst || 0) + Number(editTaxOverride.sgst || 0);
      }
    }
    return totalTaxAmount;
  }, [isEdit, editTaxOverride, totalTaxAmount]);

  // Auto-select tax based on selected services (create mode; don't override edit-loaded value)
  useEffect(() => {
    if (!selectedServiceIds.length) return;
    if (isEdit) return; // respect existing appointment's value
    // If user already picked a tax manually, don't override
    if (taxId && taxId !== 'no-tax') return;

    const selectedServices = selectedServiceIds
      .map(id => serviceList.find(s => String(s.id || s.name) === id))
      .filter(Boolean) as Service[];

    if (!selectedServices.length) return;

    const allTaxIds = new Set(
      selectedServices
        .map(s => (s.tax_id != null ? String(s.tax_id) : null))
        .filter((v): v is string => !!v)
    );

    if (allTaxIds.size === 1) {
      const onlyTaxId = Array.from(allTaxIds)[0];
      setTaxId(onlyTaxId);
      return;
    }

    // If tax_id differs or missing, try uniform tax_rate mapping to a tax in taxList
    const rates = new Set(
      selectedServices
        .map(s => (s.tax_rate != null ? Number(s.tax_rate) : null))
        .filter((v): v is number => v != null && !isNaN(v))
    );
    if (rates.size === 1) {
      const onlyRate = Array.from(rates)[0];
      const matchingTax = taxList.find(t => Number(t.tax_rate) === Number(onlyRate));
      if (matchingTax) {
        setTaxId(String(matchingTax.id || matchingTax.name));
        return;
      }
    }
    // Else leave as is; user can select manually
  }, [selectedServiceIds, serviceList, taxList, isEdit, taxId]);
  useEffect(()=>{
    console.log('Status auto-calculation triggered:', { totalAmount, advanceNum, balanceDue });
    if (totalAmount <= 0) { 
      console.log('Setting status to pending: totalAmount<=0');
      setPaymentStatus('pending'); 
      return; 
    }
    
    // Auto-calculate payment status based on balance logic
    if (balanceDue === totalAmount) {
      // If total == balance → Pending (no payment made)
      console.log('Setting status to pending: balance equals total amount');
      setPaymentStatus('pending');
    } else if (balanceDue < totalAmount && balanceDue > 0) {
      // Else if balance < total && balance > 0 → Advance (partial payment)
      console.log('Setting status to advance: partial payment made');
      setPaymentStatus('advance');
    } else if (balanceDue === 0) {
      // Else if balance == 0 → Settled (full payment)
      console.log('Setting status to settled: full payment made');
      setPaymentStatus('settled');
    }
  }, [totalAmount, advanceNum, balanceDue]);

  // Always keep appointment status as active
  useEffect(() => {
    setAppointmentStatus('active');
  }, []);



  // Recompute available from-slots based on date (filter past) and conflicts
  useEffect(()=>{
    if (baseSlots.length === 0) return;
    
    // Exclude the current record from conflict checks while editing
    const others = existing.filter(r=> !(isEdit && ((recordId!=null && String(r.id)===String(recordId)) || (recordApptId && String(r.appointment_id)===String(recordApptId)))));
    let slots = baseSlots.slice();
    
    // Only filter past slots for today and when not editing
    if (!isEdit && appointmentDate === todayYMDIST()) {
      slots = filterPastSlots(slots, appointmentDate);
    }
    
    // Filter blocked slots if staff is selected
    if (staffId) {
      const blocked = conflictsForStaff(slots, others.map(r=>({ from: r.slot_from||'', to: r.slot_to||'', staff_id: r.staff_id })), staffId);
      slots = slots.filter(s=> !blocked.has(s.value));
    }
    
    // Ensure current from time remains present while editing OR when loading from URL params
    const curFrom = ensureHHMMSS(slotFrom||'');
    const needsFromParam = fromParam && !isEdit && !slotFrom;
    const fromParamValue = needsFromParam ? ensureHHMMSS(fromParam) : '';
    
    if ((isEdit && curFrom && !slots.find(s=> s.value===curFrom)) || 
        (fromParamValue && !slots.find(s=> s.value===fromParamValue))) {
      const targetValue = curFrom || fromParamValue;
      const base = baseSlots.find(s=> s.value===targetValue);
      if (base) {
        slots = [base, ...slots].sort((a,b)=> a.value.localeCompare(b.value));
      }
    }
    
    setSlotOptions(slots);
  }, [baseSlots, appointmentDate, staffId, existing, isEdit, recordId, recordApptId, slotFrom, fromParam]);

  // Recompute to-slot options when from or conflicts change
  useEffect(()=>{
    if(!slotFrom){ setToSlotOptions([]); return; }
    const curFrom = ensureHHMMSS(slotFrom);
    const fromSlot = baseSlots.find(s=> s.value===curFrom);
    let slots = buildToSlots(fromSlot, baseSlots);
    
    // Preserve current to time for editing before applying filters
    const curTo = ensureHHMMSS(slotTo||'');
    const currentToSlot = curTo ? baseSlots.find(s=> s.value===curTo) : null;
    
    if (!isEdit) {
      slots = filterPastSlots(slots, appointmentDate);
    }
    const others = existing.filter(r=> !(isEdit && ((recordId!=null && String(r.id)===String(recordId)) || (recordApptId && String(r.appointment_id)===String(recordApptId)))));
    const blocked = conflictsForStaff(baseSlots, others.map(r=>({ from: r.slot_from||'', to: r.slot_to||'', staff_id: r.staff_id })), staffId || null);
    if (staffId) slots = slots.filter(s=> !blocked.has(s.value));
    
    // Ensure current to time remains present while editing, even if it would normally be filtered out
    if (isEdit && currentToSlot && !slots.find(s=> s.value===currentToSlot.value)) {
      slots = [...slots, currentToSlot].sort((a,b)=> a.value.localeCompare(b.value));
    }
    
    setToSlotOptions(slots);
  }, [slotFrom, slotTo, appointmentDate, staffId, existing, baseSlots, isEdit, recordId, recordApptId]);

  // Helper: compute a desired end time by adding minutes to the selected start time (15-min increments)
  const addMinutesToFrom = (fromHHMMSS: string, minutes: number): string | null => {
    const cur = ensureHHMMSS(fromHHMMSS);
    const idx = baseSlots.findIndex(s=> s.value === cur);
    if (idx < 0) return null;
    const steps = Math.floor(minutes / 15);
    const targetIdx = Math.min(baseSlots.length - 1, idx + steps);
    return baseSlots[targetIdx]?.value || null;
  };

  // Duration apply handler: pick the closest allowed to-slot not exceeding desired target
  const applyDuration = (minutes: 15 | 30 | 45 | 60) => {
    if (!slotFrom) return;
    if (!toSlotOptions || toSlotOptions.length === 0) return;
    const desired = addMinutesToFrom(slotFrom, minutes);
    if (!desired) return;
    const sorted = [...toSlotOptions].sort((a,b)=> a.value.localeCompare(b.value));
    let pick: any = null;
    for (let i=sorted.length-1; i>=0; i--) { if (sorted[i].value <= desired) { pick = sorted[i]; break; } }
    if (!pick) pick = sorted[0];
    if (pick?.value) setSlotTo(pick.value);
  };

  // Ensure an end time is selected once start time/options are ready (create mode)
  // Prefer URL `to` param if present; otherwise pick the first available option
  useEffect(() => {
    if (isEdit) return;               // editing respects existing value
    if (!slotFrom) return;            // need a start time first
    if (slotTo) return;               // already selected

    const desired = ensureHHMMSS(toParam || '');
    if (desired && toSlotOptions?.some(s => s.value === desired)) {
      setSlotTo(desired);
      return;
    }

    if (toSlotOptions && toSlotOptions.length > 0) {
      setSlotTo(toSlotOptions[0].value);
    }
  }, [isEdit, slotFrom, slotTo, toSlotOptions, toParam]);

  // Overlap calculation using helper
  useEffect(()=>{
    const others = existing.filter(r=> !(isEdit && ((recordId!=null && String(r.id)===String(recordId)) || (recordApptId && String(r.appointment_id)===String(recordApptId)))));
    const err = deriveOverlap(ensureHHMMSS(slotFrom), ensureHHMMSS(slotTo), others.map(r=>({ from: r.slot_from||'', to: r.slot_to||'', staff_id: r.staff_id })), staffId || null);
    setOverlapError(err);
  }, [slotFrom, slotTo, staffId, existing, isEdit, recordId, recordApptId]);

  // Close customer suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!customerNameRef.current && !customerPhoneRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (customerNameRef.current?.contains(e.target) || customerPhoneRef.current?.contains(e.target)) return;
      setShowCustomerSuggestions(false);
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const handleSave = async () => {
    if (disabled || overlapError) return;
    // Validate required fields (Date, From, To, Staff, Customer Name, Services, Payment Mode only when collecting money)
    const missing: string[] = [];
    if (!appointmentDate) missing.push('Date');
    if (!slotFrom) missing.push('From Time');
    if (!slotTo) missing.push('To Time');
    if (!staffId) missing.push('Staff');
    if (!customerName.trim()) missing.push('Customer Name');
    if (!String(customerPhone || '').trim()) missing.push('Customer Phone');
    if (!selectedServiceIds.length) missing.push('Services');

    // Compute amounts based on selected status to ensure correctness on save
    let advanceToSave = advanceNum;
    const dbStatus = combineStatus(appointmentStatus, paymentStatus, totalAmount, advanceToSave);
    if (paymentStatus === 'settled') {
      advanceToSave = totalAmount; // force full payment
    } else if (advanceToSave > totalAmount) {
      advanceToSave = totalAmount; // clamp
    }
    const balanceToSave = Math.max(totalAmount - advanceToSave, 0);
    // Only require payment mode when collecting advance payment (not for just booking)
    if (advanceToSave > 0 && !paymentMode) {
      missing.push('Payment Mode');
    }

    if (missing.length > 0) {
      toast({
        title: 'Please complete the form',
        description: `Missing: ${missing.join(', ')}`,
        variant: 'destructive'
      });
      return;
    }
    try {
      setLoading(true); setError(null);
      const acc = (user as any)?.account_code; const ret = (user as any)?.retail_code; if(!acc||!ret){ setError('Missing account context'); return; }
      const staff = staffList.find(s=> String(s.id||s.name)===staffId);
      const staffMarkup = Number(staff?.price_markup_percent || 0);
      const services = serviceTaxCalculations.map(calc => {
        const rec = calc.service;
        return { 
          id: rec?.id || rec?.service_id || rec?.name,
          service_id: rec?.service_id || rec?.id || rec?.name, // Explicitly include service_id
          name: rec?.name,
          service_name: rec?.name, // Add alternative field name for compatibility
          title: rec?.name,        // Add alternative field name for compatibility
          price: calc.markedUpPrice,
          base_price: calc.basePrice,
          markup_percent: staffMarkup,
          tax_id: rec?.tax_id,
          tax_rate: calc.taxRate,
          cgst_rate: calc.cgstRate,
          sgst_rate: calc.sgstRate,
          cgst_amount: calc.cgstAmount,
          sgst_amount: calc.sgstAmount,
          tax_amount: calc.totalTaxAmount
        };
      });
  // Store full word (Male/Female/Other) per request; fallback to initial on truncation error.
  const normalizedGender = (customerGender||'').trim().toLowerCase();
  const genderFull = (()=>{
    if (normalizedGender==='male' || normalizedGender==='m') return 'Male';
    if (normalizedGender==='female' || normalizedGender==='f') return 'Female';
    if (normalizedGender==='other' || normalizedGender==='o') return 'Other';
    return undefined;
  })();
      // Determine customer_id: 
      // - If customer selected from suggestions: use their actual customer_id
      // - If customer typed manually (not selected): use 0 to trigger new customer creation in backend
      const customerId = selectedCustomer?.id ? selectedCustomer.id : 0;
      
      const payload:any = {
        account_code: acc,
        retail_code: ret,
        appointment_date: appointmentDate,
        slot_from: ensureHHMMSS(slotFrom),
        slot_to: ensureHHMMSS(slotTo),
        staff_id: staff?.id || staffId,
        staff_name: staff?.name || staffId,
        customer_id: customerId, // Send customer_id: existing ID or 0 for new customer
        customer_name: customerName,
        customer_phone: customerPhone,
        // Audit fields (many tables enforce NOT NULL on these)
        created_by: (user as any)?.username || 'system',
        updated_by: (user as any)?.username || 'system',
  ...(genderFull ? { customer_gender: genderFull.slice(0,18) } : {}),
  // send services as JSON string in both fields for compatibility
  services: JSON.stringify(services),
  services_json: JSON.stringify(services),
  services_total: serviceSubtotal,
  // Pricing extras
  discount: discountNum,
  ...(hallRentNum ? { hall_rent: hallRentNum, hall_rent_tax_rate: hallRentTaxRate, hall_rent_tax_amount: hallRentTaxAmount } : {}),
  // Total tax amounts (sum of all service taxes + hall rent tax)
  tax_rate: taxRate,
        tax_amount: taxAmount,
    cgst_amount: cgstAmount,
    sgst_amount: sgstAmount,
        total_amount: totalAmount,
  advance_paid: advanceToSave,
  balance_due: balanceToSave,
        ...(paymentMode ? { payment_mode: paymentMode } : {}),
        // Include membership information
        ...(customerMembership ? { 
          membership_id: customerMembership.membership_id,
          membership_name: customerMembership.membership_name,
          membership_discount_percent: customerMembership.discount_percent,
          membership_discount: membershipDiscountAmount
        } : {}),
        // Include staff markup information
        ...(staff?.price_markup_percent ? { staff_markup_percent: staff.price_markup_percent } : {}),
        status: dbStatus, // DB enum expects: 'pending'|'advance'|'cancelled'|'settled'
        special_requirements: notes || undefined,
      };
      // Remove autoGen since we're handling ID generation manually
      
      // Debug logging for membership discount
      if (customerMembership) {
        console.log('[APPOINTMENT_PAYLOAD] Membership Info:', {
          membership_id: customerMembership.membership_id,
          membership_name: customerMembership.membership_name,
          discount_percent: customerMembership.discount_percent,
          calculated_amount: membershipDiscountAmount,
          serviceSubtotalWithTax,
          isDiscountFromMembership
        });
      }
      
      try {
        const finalPayload = { ...payload };
        const isNewCustomer = !selectedCustomer?.id; // customer_id will be 0 when new
        
        // --- Customer auto-create logic (reuse or allocate next customer_id) ---
        if (isNewCustomer && !isEdit && customerName.trim() && String(customerPhone || '').trim()) {
          try {
            // Read existing customers in scope
            const readRes: any = await DataService.readData(['master_customer'], acc, ret);
            const rowsRaw: any[] = (readRes?.data?.master_customer || readRes?.data?.customers || readRes?.data || []) as any[];
            const norm = (v: any) => String(v ?? '').trim().toLowerCase();
            let rows = Array.isArray(rowsRaw)
              ? rowsRaw.filter((r: any) => norm(r?.account_code) === norm(acc) && norm(r?.retail_code) === norm(ret))
              : [];
            if (!rows.length && Array.isArray(rowsRaw)) rows = rowsRaw; // fallback if backend didn’t scope

            // Try to reuse existing by phone (normalize digits)
            const onlyDigits = (s: string) => s.replace(/\D+/g, '');
            const phoneDigits = onlyDigits(String(customerPhone || '').trim());
            const existing = rows.find((r: any) => {
              const p = String(r?.phone || r?.phone1 || r?.mobile || r?.customer_phone || r?.mobile_number || '');
              return p && onlyDigits(p) === phoneDigits;
            });

            let useCustomerId: number | null = null;
            if (existing) {
              const cid = parseInt((existing.customer_id ?? existing.CUSTOMER_ID ?? '0') as any, 10);
              if (Number.isFinite(cid) && cid > 0) useCustomerId = cid;
            }

            // If not found, allocate next numeric id from scope
            if (!useCustomerId) {
              const numericIds = rows
                .map((c: any) => parseInt((c?.customer_id ?? c?.CUSTOMER_ID ?? '0') as any, 10))
                .filter((id: number) => Number.isFinite(id) && id > 0);
              let nextCustomerId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
              while (rows.some((c: any) => parseInt((c?.customer_id ?? c?.CUSTOMER_ID ?? '-1') as any, 10) === nextCustomerId)) {
                nextCustomerId++;
              }
              useCustomerId = nextCustomerId;
            }

            // Create the customer only if it didn’t already exist
            if (useCustomerId && !existing) {
              const customerData: any = {
                customer_id: useCustomerId,
                customer_name: customerName.trim(),
                phone: String(customerPhone || '').trim(),
                phone1: String(customerPhone || '').trim(),
                mobile_number: String(customerPhone || '').trim(),
                account_code: acc,
                retail_code: ret,
                status: 1,
                ...(genderFull ? { gender: genderFull } : {})
              };
              const createRes: any = await DataService.createData('master_customer', customerData, null, acc, ret);
              // Check if the response explicitly indicates failure
              if (createRes && createRes.success === false) {
                console.warn('Customer creation failed:', createRes.message);
              } else {
                console.log('Customer created/updated successfully with ID:', useCustomerId);
              }
            }

            if (useCustomerId) {
              finalPayload.customer_id = useCustomerId;
              setSelectedCustomer({ id: String(useCustomerId), name: customerName, email: '', phone: customerPhone });
            }
          } catch (customerError) {
            console.error('Customer creation failed:', customerError);
            // Continue with appointment creation even if customer creation fails
          }
        }
        
        if (isEdit) {
          // Update appointment using 3-table transaction system
          try {
            const updateFields = {
              // Master appointment table updates (scheduling, customer, payment info)
              customer_name: customerName.trim(),
              customer_mobile: String(customerPhone || '').trim(),
              employee_name: staff?.name || staffId,
              employee_id: staff?.id ? String(staff.id) : '',
              appointment_date: appointmentDate,
              slot_from: ensureHHMMSS(slotFrom),
              slot_to: ensureHHMMSS(slotTo),
              special_requirements: notes?.trim() || '',
              status: dbStatus,
              advance_paid: Number(advanceToSave.toFixed(2)),
              balance_due: Number(balanceToSave.toFixed(2)),
              payment_mode: paymentMode,
              
              // Transaction table updates (financial info)
              base_price: Number(serviceSubtotal.toFixed(2)),
              unit_price: Number(serviceSubtotal.toFixed(2)),
              subtotal: Number(serviceSubtotal.toFixed(2)),
              discount_amount: Number(discountNum.toFixed(2)),
              taxable_amount: Math.max(serviceSubtotal - discountNum, 0),
              tax_rate_percent: Number(taxRate.toFixed(2)),
              membership_discount: Number(membershipDiscountAmount.toFixed(2)),
              tax_amount: Number(taxAmount.toFixed(2)),
              total_cgst: Number(cgstAmount.toFixed(2)),
              total_sgst: Number(sgstAmount.toFixed(2))
            };

            console.log('Updating appointment across 3 tables with fields:', updateFields);

            await AppointmentTransactionService.update(
              recordApptId || '',
              { update_fields: updateFields },
              acc,
              ret
            );
            
            console.log('Appointment transaction updated successfully across all 3 tables');
          } catch (transactionError: any) {
            console.error('Transaction update failed:', transactionError);
            throw new Error(`Failed to update appointment: ${transactionError.message || transactionError}`);
          }

          {
            const isCancelledMsg = String(dbStatus || '').toLowerCase() === 'cancelled' || String(appointmentStatus||'').toLowerCase() === 'cancelled';
            toast({
              title: isCancelledMsg ? 'Booking Cancelled' : 'Booking Updated',
              description: isCancelledMsg
                ? `Appointment cancelled for ${customerName}.`
                : `Appointment updated for ${customerName} (${isNewCustomer ? 'new customer' : `existing #${selectedCustomer?.id}`}). Total ₹${totalAmount.toFixed(2)}`,
              variant: 'default'
            });
          }
        } else {
          // Always generate sequential appointment ID for new appointments with date/time encoding
          const appointmentId = await generateAppointmentId('APT-');
          // Encode scheduling info in the appointment ID for transaction storage
          const schedulingData = {
            appointment_date: appointmentDate,
            slot_from: ensureHHMMSS(slotFrom),
            slot_to: ensureHHMMSS(slotTo),
            customer_phone: customerPhone,
            special_requirements: notes || ''
          };
          
          console.log('Creating appointment via transaction system with payload:', {
            appointmentId,
            schedulingData,
            finalPayload
          });
          
          // Create appointment using transaction system instead of master_appointment
          try {
            const appointmentTransactionData = {
              appointment_id: appointmentId,
              account_code: acc,
              retail_code: ret,
              customer_id: finalPayload.customer_id ? String(finalPayload.customer_id) : '',
              customer_name: customerName,
              customer_phone: customerPhone,
              staff_id: staff?.id ? String(staff.id) : '',
              staff_name: staff?.name || staffId,
              services: services, // Array of service objects
              services_total: serviceSubtotal,
              discount: discountNum,
              tax_rate: taxRate,
              tax_amount: taxAmount,
              cgst_amount: cgstAmount,
              sgst_amount: sgstAmount,
              membership_discount: membershipDiscountAmount,
              // Include scheduling information
              appointment_date: appointmentDate,
              slot_from: ensureHHMMSS(slotFrom),
              slot_to: ensureHHMMSS(slotTo),
              special_requirements: notes || '',
              payment_mode: paymentMode,
              advance_paid: advanceToSave,
              balance_due: balanceToSave,
              status: dbStatus
            };

            console.log('Creating appointment transactions with data:', appointmentTransactionData);
            const res = await AppointmentTransactionService.createFromAppointment(appointmentTransactionData);
            
            if (res && (res as any).success === false) {
              throw new Error((res as any).message || 'Failed to create appointment transaction');
            }
            
            console.log('Appointment transaction created successfully:', res);
          } catch (transactionError: any) {
            console.error('Transaction creation failed:', transactionError);
            throw new Error(`Failed to create appointment: ${transactionError.message || transactionError}`);
          }

          toast({
            title: 'Booking Created',
            description: `Appointment created for ${customerName} (${isNewCustomer ? 'new customer will be created' : `existing #${selectedCustomer?.id}`}). Total ₹${totalAmount.toFixed(2)}`,
            variant: 'default'
          });
        }
        if (isEdit) navigate('/appointments'); else navigate('/appointments?created=1');
      } catch(err:any) {
        console.error('Appointment save error:', err);
        const msg = err?.message || err?.toString() || '';
        setError(msg || 'Error saving appointment');
        toast({
          title: isEdit ? 'Update Failed' : 'Create Failed',
          description: msg || 'Something went wrong while saving the booking. Please check the form and try again.',
          variant: 'destructive'
        });
      }
    } catch(e:any){ 
      setError(e.message||String(e)); 
      toast({ title: 'Error', description: e.message || String(e), variant: 'destructive' });
    }
    finally { setLoading(false); }
  };

  // Show cancel confirmation dialog
  const handleCancelAppointment = async () => {
    if (!isEdit) { navigate(-1); return; }
    setShowCancelDialog(true);
  };

  // Confirm cancellation with remarks
  const confirmCancellation = async () => {
    if (!cancelRemarks.trim() || cancelRemarks.trim().length < 3) {
      toast({
        title: 'Remarks Required',
        description: 'Please provide cancellation remarks (minimum 3 characters)',
        variant: 'destructive'
      });
      return;
    }

    setShowCancelDialog(false);
    // Force cancelled status and zero advance (do not collect money on cancellation)
    setAppointmentStatus('cancelled');
    setPaymentStatus('pending');
    // Store cancellation remarks in special_requirements field
    setNotes(prev => {
      const existingNotes = prev ? prev.trim() : '';
      const cancelNote = `[CANCELLED: ${cancelRemarks.trim()}]`;
      return existingNotes ? `${existingNotes}\n${cancelNote}` : cancelNote;
    });
    // Allow state to flush before save
    setTimeout(() => {
      handleSave();
    }, 25);
  };

  return (
    <form autoComplete="off" className="min-h-screen bg-slate-50" onSubmit={(e)=>e.preventDefault()}>
      <div className="w-full px-2 lg:px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          
          {/* Left column: Appointment Details */}
          <div className="lg:col-span-3 space-y-4">
            
            {/* Date & Time Section */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                  <CalendarDays className="h-4 w-4 text-blue-600 mr-2" />
                  Date & Time
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid md:grid-cols-3 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">Date <span className="text-red-500">*</span></label>
                    <Input 
                      type="date" 
                      value={appointmentDate} 
                      onChange={e=> setAppointmentDate(e.target.value)} 
                      className="h-8 py-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500 rounded-md text-xs" 
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">From Time <span className="text-red-500">*</span></label>
                    <Select value={slotFrom} onValueChange={v=> { setSlotFrom(v); setSlotTo(''); }}>
                      <SelectTrigger className="h-8 border-slate-300 focus:border-blue-500 rounded-md text-xs">
                        <SelectValue placeholder="Select start time"/>
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {slotOptions.length > 0 ? (
                          slotOptions.filter(s=> s.value).map(s=> <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)
                        ) : (
                          <div className="text-xs text-slate-400 px-2 py-1">
                            {baseSlots.length === 0 ? 'Loading slots...' : 'No slots available'}
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">To Time <span className="text-red-500">*</span></label>
                    <Select value={slotTo} onValueChange={v=> setSlotTo(v)} disabled={!slotFrom}>
                      <SelectTrigger className="h-8 border-slate-300 focus:border-blue-500 rounded-md text-xs">
                        <SelectValue placeholder="Select end time"/>
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {toSlotOptions.filter(s=> s.value).map(s=> <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        {slotFrom && toSlotOptions.length===0 && <div className="text-xs text-slate-400 px-2 py-1">No follow-up slots</div>}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Duration:</span>
                  {[15,30,45,60].map(min=> (
                    <Button
                      key={min}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={!slotFrom || toSlotOptions.length===0}
                      onClick={()=> applyDuration(min as 15|30|45|60)}
                    >{min}m</Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Staff & Customer Section */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                  <Users className="h-4 w-4 text-emerald-600 mr-2" />
                  Staff & Customer Details
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid md:grid-cols-4 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">Staff <span className="text-red-500">*</span></label>
                    <Select value={staffId} onValueChange={v=> setStaffId(v)}>
                      <SelectTrigger className="h-8 border-slate-300 focus:border-green-500 rounded-md text-xs">
                        <SelectValue placeholder="Select staff member"/>
                      </SelectTrigger>
                      <SelectContent>
                        {(staffOptions)
                        .filter(s=> String(s.id||s.name))
                        .map(s=> {
                          const markupText = s.price_markup_percent && s.price_markup_percent > 0 
                            ? ` (+${s.price_markup_percent}%)` 
                            : '';
                          return (
                            <SelectItem key={String(s.id||s.name)} value={String(s.id||s.name)}>
                              {s.name}{markupText}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">Customer Name <span className="text-red-500">*</span></label>
                    <Input 
                      ref={customerNameRef}
                      value={customerName} 
                      onChange={e=> handleCustomerInputChange(e.target.value)} 
                      onKeyDown={handleCustomerKeyDown}
                      placeholder="Enter customer name" 
                      className="h-8 py-1 border-slate-300 focus:border-green-500 focus:ring-green-500 rounded-md text-xs" 
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">Customer Phone <span className="text-red-500">*</span></label>
                    <Input 
                      ref={customerPhoneRef}
                      value={customerPhone} 
                      onChange={e=> handleCustomerPhoneChange(e.target.value)} 
                      onKeyDown={handleCustomerPhoneKeyDown}
                      placeholder="Enter phone number" 
                      className="h-8 py-1 border-slate-300 focus:border-green-500 focus:ring-green-500 rounded-md text-xs" 
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-slate-700">Gender</label>
                    <Select value={customerGender} onValueChange={v=> setCustomerGender(v)} data-gender-select>
                      <SelectTrigger className="h-8 border-slate-300 focus:border-green-500 rounded-md text-xs">
                        <SelectValue placeholder="Select gender"/>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Services Section */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-purple-50 to-violet-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center justify-between">
                  <div className="flex items-center">
                    <Scissors className="h-4 w-4 text-purple-600 mr-2" />
                    Services<span className="text-red-500"> *</span>
                  </div>
                  {/* Filters + Tax Exempt toggle in header */}
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    {/* Category Filter */}
                    <div className="w-40">
                      <Select
                        value={categoryFilter || "__all__"}
                        onValueChange={(value) => setCategoryFilter(value === "__all__" ? "" : value)}
                      >
                        <SelectTrigger className="h-8 text-xs border-slate-300 focus:border-purple-400">
                          <SelectValue placeholder="Filter by Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All Categories</SelectItem>
                          {availableCategories.map((category) => (
                            <SelectItem key={category} value={category}>
                              {categoryNameMap[category] || category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Gender Filter */}
                    <div className="w-36">
                      <Select
                        value={genderFilter || "__all__"}
                        onValueChange={(value) => setGenderFilter(value === "__all__" ? "" : value)}
                      >
                        <SelectTrigger className="h-8 text-xs border-slate-300 focus:border-purple-400">
                          <SelectValue placeholder="Filter by Gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All Genders</SelectItem>
                          {availableGenders.map((gender) => (
                            <SelectItem key={gender} value={gender}>
                              {gender}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Search Bar */}
                    <div className="relative w-48 sm:w-56 md:w-64">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input
                        type="text"
                        value={serviceSearch}
                        onChange={(e) => setServiceSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setServiceSearch(''); }}
                        placeholder="Search services..."
                        className="w-full h-8 pl-7 pr-6 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-0 focus:border-purple-400"
                      />
                      {serviceSearch && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => setServiceSearch("")}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-slate-100 text-slate-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {(categoryFilter || genderFilter || serviceSearch) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setCategoryFilter(""); setGenderFilter(""); setServiceSearch(""); }}
                        className="h-8 px-3 text-xs"
                      >
                        Clear
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowOnlySelected(v => !v)}
                      className={`h-8 px-2 ${showOnlySelected ? 'bg-purple-100 border-purple-300 text-purple-700' : ''}`}
                      title="Show only selected services"
                    >
                      <ListChecks className="h-4 w-4" />
                    </Button>
                    {/* Divider and Tax toggle */}
                    <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                      <button
                        type="button"
                        onClick={() => setTaxExempted(!taxExempted)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${taxExempted ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${taxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                      </button>
                      <Label className="text-xs font-medium text-gray-700">No Tax</Label>
                      {taxExempted && (
                        <span className="text-xs text-red-600 font-medium">(No Tax)</span>
                      )}
                    </div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                {/* Service Selection Grid */}
                <div className="mb-4">
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-[28rem] overflow-y-auto"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
                  >
                    {filteredServices.map((service) => {
                      const serviceId = String(service.id || service.service_id);
                      const isSelected = selectedServiceIds.includes(serviceId);
                      const basePrice = Number(service.price || 0);
                      const markedUpPrice = selectedStaffMarkup > 0 ? basePrice * (1 + selectedStaffMarkup / 100) : basePrice;
                      
                      return (
                        <div
                          key={serviceId}
                          onClick={() => handleServiceSelect(service)}
                          className={`p-2 border rounded-md transition-all cursor-pointer select-none ${
                            isSelected 
                              ? 'border-purple-300 bg-purple-50 shadow-sm' 
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                          style={{ minHeight: '80px' }}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div 
                              className="text-xs font-medium text-gray-900 flex-1 pr-2 whitespace-normal break-words"
                              title={service.service_name || service.name}
                            >
                              {service.service_name || service.name}
                            </div>
                            
                            {/* Gender Info - Top Right */}
                            <div className="flex-shrink-0">
                              {service.preferred_gender && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                                  service.preferred_gender === 'Male' ? 'bg-cyan-100 text-cyan-700' :
                                  service.preferred_gender === 'Female' ? 'bg-pink-100 text-pink-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {service.preferred_gender}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {isSelected ? (
                            // Selected: show price and quantity controls
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-purple-600">
                                  ₹{markedUpPrice.toLocaleString()}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedServiceIds(prev => prev.filter(id => id !== serviceId));
                                    }}
                                    className="h-5 w-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-[10px] font-bold text-gray-600"
                                    aria-label="Remove"
                                  >
                                    −
                                  </button>
                                  <span className="text-xs font-medium min-w-[1.25rem] text-center">
                                    1
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-5 w-5 flex items-center justify-center bg-gray-100 rounded text-[10px] font-bold text-gray-400 cursor-default"
                                    aria-label="Increase (not supported)"
                                    tabIndex={-1}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              {selectedStaffMarkup > 0 && (
                                <div className="text-[9px] text-green-600">
                                  Base: ₹{basePrice} + {selectedStaffMarkup}% markup
                                </div>
                              )}
                            </div>
                          ) : (
                            // Not selected: show price and add button
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-purple-600">
                                ₹{markedUpPrice.toLocaleString()}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="h-5 w-5 flex items-center justify-center bg-gray-100 rounded text-[10px] font-bold text-gray-400 cursor-default"
                                  aria-label="Decrease"
                                  tabIndex={-1}
                                >
                                  −
                                </button>
                                <span className="text-xs font-medium min-w-[1.25rem] text-center">0</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleServiceSelect(service); }}
                                  className="h-5 w-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-[10px] font-bold text-gray-600"
                                  aria-label="Add"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {filteredServices.length === 0 && (
                    <div className="text-xs text-slate-500 px-1 py-2 text-center">
                      {showOnlySelected
                        ? "No selected services to show"
                        : (categoryFilter || genderFilter || serviceSearch)
                          ? "No services match the selected filters"
                          : "No services found"
                      }
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Notes Section */}
            <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                  <StickyNote className="h-4 w-4 text-orange-600 mr-2" />
                  Additional Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <Textarea 
                  value={notes} 
                  onChange={e=> setNotes(e.target.value)} 
                  placeholder="Add any special requirements or notes..." 
                  className="border-slate-300 focus:border-orange-500 focus:ring-orange-500 resize-none h-20 text-xs rounded-md" 
                />
              </CardContent>
            </Card>
          </div>

          {/* Right column: Pricing & Payment */}
          <div className="lg:col-span-1">
            <Card className="border-0 bg-white rounded-xl overflow-hidden sticky top-6">
              <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b border-slate-200 py-2 px-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                    <Wallet className="h-4 w-4 text-green-600 mr-2" />
                    Pricing & Payment
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-slate-700 hover:text-slate-900"
                    onClick={() => navigate(-1)}
                    aria-label="Go back"
                  >
                    ← Back
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-3">
                {/* Price Inputs */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">Services</span>
                    <span className="text-xs font-semibold text-slate-800">₹{serviceSubtotal.toFixed(0)}</span>
                  </div>
                  
                  {selectedStaffMarkup > 0 && (
                    <div className="flex items-center justify-between bg-green-50 rounded px-2 py-1">
                      <span className="text-xs text-green-700">Staff Markup ({selectedStaffMarkup}%)</span>
                      <span className="text-xs font-medium text-green-700">
                        +₹{(serviceSubtotal - (serviceSubtotal / (1 + selectedStaffMarkup / 100))).toFixed(0)}
                      </span>
                    </div>
                  )}

                  {hallRentNum > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">Hall Rent</span>
                      <span className="text-xs font-medium text-slate-800">₹{hallRentNum.toFixed(0)}</span>
                    </div>
                  )}
                 

                  {/* Membership Information */}
                  {customerMembership && (
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-2 rounded border border-purple-200 mb-2">
                      <div className="text-xs font-medium flex items-center gap-2 text-purple-700 mb-1">
                        <div className="h-3 w-3 bg-purple-600 rounded-full"></div>
                        Membership Applied
                      </div>
                      <div className="text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-purple-600 font-medium">{customerMembership.membership_name}</span>
                          <span className="text-purple-700 font-semibold">{customerMembership.discount_percent}% OFF</span>
                        </div>
                        <div className="text-purple-500 text-[10px] mt-0.5">
                          Automatic membership discount applied
                        </div>
                      </div>
                    </div>
                  )}

                   <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">
                      {isDiscountFromMembership ? 'Membership Discount (%)' : 'Discount (%)'}
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={discount}
                      onChange={e=> setDiscount(e.target.value)}
                      placeholder="0"
                      className={`h-8 py-1 w-28 text-right text-xs border-slate-300 ${
                        isDiscountFromMembership ? 'border-purple-300 bg-purple-50' : ''
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-between bg-blue-50 rounded-md px-2 py-2 border border-blue-100">
                    <span className="text-sm font-semibold text-slate-800">Total</span>
                    <span className="text-base font-bold text-blue-700">₹{totalAmount.toLocaleString()}</span>
                  </div>
                  
                </div>

                {/* Advance & Mode */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Advance & Payment</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={()=> setPaymentSectionOpen(v=>!v)}
                      aria-expanded={paymentSectionOpen}
                      aria-controls="advance-payment-section"
                    >
                      {paymentSectionOpen ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                  {!paymentSectionOpen && (
                    <div className="flex items-center justify-between bg-slate-50 rounded-md px-2 py-2 border border-slate-200" id="advance-payment-section">
                      <span className="text-xs text-slate-600">Balance Due</span>
                      <span className={`text-xs font-bold ${balanceDueUI === 0 ? 'text-green-600' : 'text-red-600'}`}>₹{balanceDueUI.toFixed(2)}</span>
                    </div>
                  )}
                  {paymentSectionOpen && (
                    <div className="space-y-2" id="advance-payment-section">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Advance Payment</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={advancePaid}
                            onChange={e=> setAdvancePaid(e.target.value)}
                            placeholder="0"
                            className="h-8 py-1 text-xs border-slate-300"
                          />
                          <div className="flex items-center gap-1">
                            {([50,75,100] as const).map(p=> (
                              <Button
                                key={p}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={()=> {
                                  if (p === 100) {
                                    setAdvancePaid(String(totalAmount.toFixed(2)));
                                  } else {
                                    const amount = (totalAmount * p) / 100;
                                    setAdvancePaid(String(amount.toFixed(2)));
                                  }
                                }}
                              >{p}%</Button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-xs font-semibold text-slate-700">
                          Payment Mode 
                          {advanceNum > 0 && <span className="text-red-500">*</span>}
                          {advanceNum === 0 && <span className="text-gray-400 text-[10px] ml-1">(Only required when collecting payment)</span>}
                        </label>
                        <Select value={paymentMode} onValueChange={v=> setPaymentMode(v)}>
                          <SelectTrigger className="h-8 border-slate-300 text-xs">
                            <SelectValue placeholder={advanceNum > 0 ? "Select payment mode" : "Optional - Select if collecting payment"} />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentModes.filter(pm=> pm.value).map(pm=> <SelectItem key={pm.value} value={pm.value}>{pm.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between bg-slate-50 rounded-md px-2 py-2 border border-slate-200">
                        <span className="text-xs font-semibold text-slate-700">Balance Due</span>
                        <span className={`text-xs font-bold ${balanceDueUI === 0 ? 'text-green-600' : 'text-red-600'}`}>₹{balanceDueUI.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirmation Buttons */}
                <div className="space-y-2 pt-1">
                  <Button
                    type="button"
                    disabled={disabled || !!overlapError}
                    onClick={handleSave}
                    className={`w-full h-10 font-semibold text-sm rounded-md transition-colors ${
                      disabled || !!overlapError
                        ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                        : balanceDue === 0
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {isEdit ? 'Update Booking' : 'Book Now'}
                  </Button>
                  {isEdit && (
                    <Button
                      type="button"
                      onClick={handleCancelAppointment}
                      className="w-full h-9 font-semibold text-sm rounded-md bg-red-600 hover:bg-red-700 text-white"
                    >
                      Cancel Appointment
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    type="button"
                    onClick={()=> {
                      setHallRent('');
                      setDiscount('0');
                      setAdvancePaid('');
                      setPaymentMode('');
                      setSelectedServiceIds([]);
                      setNotes('');
                      setCustomerName('');
                      setCustomerPhone('');
                      setCustomerGender('');
                      setSelectedCustomer(null);
                      setCustomerSuggestions([]);
                      setShowCustomerSuggestions(false);
                      setCustomerMembership(null);
                    }}
                    className="w-full h-8 border-slate-300 text-slate-700 text-xs"
                  >
                    Reset Form
                  </Button>
                </div>

                {/* Status Messages */}
                {overlapError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                    <div className="text-xs text-red-700 font-semibold">⚠️ Schedule Conflict</div>
                    <div className="text-[10px] text-red-600 mt-1">{overlapError}</div>
                  </div>
                )}
                
                {mastersLoading && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                    <div className="text-xs text-blue-700">Loading data...</div>
                  </div>
                )}
                
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                    <div className="text-xs text-red-700 font-semibold">Error</div>
                    <div className="text-[10px] text-red-600 mt-1">{error}</div>
                  </div>
                )}


              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Portal-based Customer Suggestions Dropdown */}
      {showCustomerSuggestions && customerSuggestions.length > 0 && customerDropdownPos.current && createPortal(
        <div
          data-customer-suggestions
          className="fixed bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto"
          style={{ 
            top: customerDropdownPos.current.top, 
            left: customerDropdownPos.current.left, 
            width: customerDropdownPos.current.width,
            maxWidth: customerDropdownPos.current.width,
            zIndex: 10000 
          }}
        >
          {customerSuggestions.map((c, idx) => {
            const name = c.customer_name || c.full_name || c.name || '';
            const phone = c.phone || c.mobile || c.customer_phone || '';
            return (
              <div
                key={idx}
                className={`p-2 text-xs cursor-pointer hover:bg-gray-100 ${customerSelectedIndex === idx ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
                onMouseDown={() => selectCustomer(c)}
                onMouseEnter={() => setCustomerSelectedIndex(idx)}
              >
                <div className="font-medium flex justify-between gap-2 overflow-hidden">
                  <span className="truncate">{name}</span>
                  {phone && <span className="text-gray-500 shrink-0">{phone}</span>}
                </div>
                {(c.email || c.last_visit) && (
                  <div className="text-gray-500 flex justify-between gap-2 overflow-hidden">
                    <span className="truncate">{c.email || ''}</span>
                    {(c as any).last_visit && <span className="text-[10px] shrink-0">Last: {(c as any).last_visit}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>,
        document.body
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Cancel Appointment
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this appointment? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Cancellation Remarks <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={cancelRemarks}
                onChange={(e) => setCancelRemarks(e.target.value)}
                placeholder="Please provide reason for cancellation..."
                className="min-h-[80px] resize-none"
                maxLength={200}
              />
              <div className="text-xs text-gray-500">
                {cancelRemarks.length}/200 characters (minimum 3 required)
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowCancelDialog(false);
                setCancelRemarks('');
              }}
            >
              Keep Appointment
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancellation}
              disabled={!cancelRemarks.trim() || cancelRemarks.trim().length < 3}
            >
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
