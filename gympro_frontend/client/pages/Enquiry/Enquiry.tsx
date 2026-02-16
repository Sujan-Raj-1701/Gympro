import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Edit, Download, Plus, ChevronLeft, ChevronRight, ChevronDown, Save, FileSignature } from 'lucide-react';
import { toast } from "@/hooks/use-toast";
import { ApiService, API_BASE_URL } from '@/services/apiService';
import { useNavigate } from 'react-router-dom';

interface EnquiryData {
  id: number;
  accountCode: string;
  retailCode: string;
  contact: string;
  clientName: string;
  email: string;
  address: string;
  enquiryFor: string;
  enquiryType: string;
  response: string;
  dateToFollow: string;
  source: string;
  leadRep: string;
  leadStatus: string;
  sendSms: boolean;
  sendWhatsApp: boolean;
  description: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

interface Employee {
  id: string;
  name: string;
  employee_code?: string;
  department?: string;
  designation?: string;
  status?: string;
}

interface InventoryItemOption {
  id: number;
  name: string;
}

// Enquiry page — form + listing
export default function Enquiry() {
  
  // Form state
  const [accountCode, setAccountCode] = useState('');
  const [retailCode, setRetailCode] = useState('');
  const [contact, setContact] = useState('');
  const [clientName, setClientName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [enquiryFor, setEnquiryFor] = useState('');
  const [enquiryType, setEnquiryType] = useState('');
  const [response, setResponse] = useState('');
  const [dateToFollow, setDateToFollow] = useState<string>(new Date().toISOString().slice(0,10));
  const [source, setSource] = useState('');
  const [leadRep, setLeadRep] = useState('Admin');
  const [leadStatus, setLeadStatus] = useState('Pending');
  const [sendSms, setSendSms] = useState(false);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [description, setDescription] = useState('');

  // Filter state
  const [fromDateFilter, setFromDateFilter] = useState(new Date().toISOString().slice(0,10));
  const [toDateFilter, setToDateFilter] = useState(new Date().toISOString().slice(0,10));
  const [enquiryForFilter, setEnquiryForFilter] = useState('');
  const [leadRepFilter, setLeadRepFilter] = useState('all');
  const [enquiryTypeFilter, setEnquiryTypeFilter] = useState('');

  const [list, setList] = useState<EnquiryData[]>([]);
  const [filteredList, setFilteredList] = useState<EnquiryData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  const [inventoryOptions, setInventoryOptions] = useState<InventoryItemOption[]>([]);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<number[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');

  const navigate = useNavigate();

  // Billing/invoice creation from enquiry is disabled on this screen.

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Form visibility state
  const [showForm, setShowForm] = useState(false);

  // Get account and retail codes from session/local storage
  useEffect(() => {
    const getStoredCodes = () => {
      try {
        let accountCode = '';
        let retailCode = '';
        
        // Priority 1: Try to get from retail_master in sessionStorage (most reliable)
        const retailMasterData = sessionStorage.getItem('retail_master');
        if (retailMasterData) {
          try {
            const retailMaster = JSON.parse(retailMasterData);
            accountCode = retailMaster.account_code || '';
            retailCode = retailMaster.retail_code || '';
            console.log('Retrieved from retail_master:', { accountCode, retailCode });
          } catch (e) {
            console.warn('Failed to parse retail_master data:', e);
          }
        }
        
        // Priority 2: Try direct keys in sessionStorage
        if (!accountCode || !retailCode) {
          accountCode = accountCode || sessionStorage.getItem('account_code') || '';
          retailCode = retailCode || sessionStorage.getItem('retail_code') || '';
          if (accountCode || retailCode) {
            console.log('Retrieved from direct session keys:', { accountCode, retailCode });
          }
        }
        
        // Priority 3: Try to get from user data in sessionStorage
        if (!accountCode || !retailCode) {
          const userData = sessionStorage.getItem('user');
          if (userData) {
            try {
              const user = JSON.parse(userData);
              accountCode = accountCode || user.account_code || '';
              retailCode = retailCode || user.retail_code || '';
              if (accountCode || retailCode) {
                console.log('Retrieved from user data:', { accountCode, retailCode });
              }
            } catch (e) {
              console.warn('Failed to parse user data from storage:', e);
            }
          }
        }
        
        // Priority 4: Fallback to localStorage
        if (!accountCode || !retailCode) {
          accountCode = accountCode || localStorage.getItem('account_code') || '';
          retailCode = retailCode || localStorage.getItem('retail_code') || '';
          if (accountCode || retailCode) {
            console.log('Retrieved from localStorage:', { accountCode, retailCode });
          }
        }
        
        // Final validation and setting
        if (!accountCode || !retailCode) {
          console.warn('Could not retrieve account/retail codes from any storage, using defaults');
          accountCode = 'C4B3A1'; // Default should match user's actual account
          retailCode = 'C4B3A1R1';
        }
        
        console.log('Final codes being set:', { accountCode, retailCode });
        setAccountCode(accountCode);
        setRetailCode(retailCode);
      } catch (error) {
        console.error('Failed to get account codes from storage:', error);
        // Set default values if storage fails
        setAccountCode('C4B3A1');
        setRetailCode('C4B3A1R1');
      }
    };
    
    getStoredCodes();
  }, []);

  // API functions
  const createEnquiry = async (enquiryData: Omit<EnquiryData, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      // Validate that the enquiry data uses current user's account/retail codes
      if (enquiryData.accountCode !== accountCode || enquiryData.retailCode !== retailCode) {
        throw new Error('Account or retail code mismatch. Please refresh the page.');
      }

      const response = await fetch(`${API_BASE_URL}/enquiries`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountCode: enquiryData.accountCode,
          retailCode: enquiryData.retailCode,
          contact: enquiryData.contact,
          clientName: enquiryData.clientName,
          email: enquiryData.email || null,
          address: enquiryData.address || null,
          enquiryFor: enquiryData.enquiryFor,
          enquiryType: enquiryData.enquiryType,
          response: enquiryData.response || null,
          dateToFollow: enquiryData.dateToFollow,
          source: enquiryData.source,
          leadRep: enquiryData.leadRep || 'Admin',
          leadStatus: enquiryData.leadStatus || 'Pending',
          sendSms: enquiryData.sendSms || false,
          sendWhatsApp: enquiryData.sendWhatsApp || false,
          description: enquiryData.description || null,
          createdBy: enquiryData.createdBy || 'admin_user'
        }),
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to create enquiry';
        try {
          const errorText = await response.text();
          if (errorText.startsWith('{')) {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.message || errorData.detail || errorMessage;
          } else {
            errorMessage = errorText || errorMessage;
          }
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error creating enquiry:', error);
      throw error;
    }
  };

  const fetchEnquiries = async () => {
    try {
      // Validate that we have account and retail codes before making the request
      if (!accountCode || !retailCode) {
        console.warn('Missing account or retail code, cannot fetch enquiries');
        return [];
      }

      const params = new URLSearchParams();
      params.append('account_code', accountCode);
      params.append('retail_code', retailCode);
      params.append('limit', '100');
      
      const requestUrl = `${API_BASE_URL}/enquiries?${params.toString()}`;
      console.log('Fetching enquiries with URL:', requestUrl);
      console.log('Request parameters:', { account_code: accountCode, retail_code: retailCode });
      
      const response = await fetch(requestUrl, {
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('access_token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch enquiries';
        try {
          const errorText = await response.text();
          // Try to parse as JSON first
          if (errorText.startsWith('{')) {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.message || errorData.detail || errorMessage;
          } else {
            errorMessage = errorText || errorMessage;
          }
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      console.log('Raw API response:', result);
      
      // Handle possible response shapes:
      // - Array of enquiries
      // - { success: true, data: [...] }
      // - { success: true, data: { ...single enquiry... } }
      // - (legacy) single enquiry object
      let enquiries: any[] = [];
      if (Array.isArray(result)) {
        enquiries = result;
      } else if (Array.isArray((result as any)?.data)) {
        enquiries = (result as any).data;
      } else if ((result as any)?.data && typeof (result as any).data === 'object') {
        enquiries = [(result as any).data];
      } else if (result && typeof result === 'object' && (result as any).id !== undefined) {
        enquiries = [result];
      }

      console.log(`Received ${enquiries.length} total enquiries from API`);
      
      // Log each enquiry to see what account/retail codes they have
      enquiries.forEach((enquiry, index) => {
        const enquiryAccountCode = enquiry.accountCode || enquiry.account_code;
        const enquiryRetailCode = enquiry.retailCode || enquiry.retail_code;
        console.log(`Enquiry ${index + 1}:`, {
          id: enquiry.id,
          accountCode: enquiryAccountCode,
          retailCode: enquiryRetailCode,
          clientName: enquiry.clientName
        });
      });
      
      // Client-side validation: Filter to only include records matching current account/retail codes
      const originalCount = enquiries.length;
      enquiries = enquiries.filter(enquiry => {
        const enquiryAccountCode = enquiry.accountCode || enquiry.account_code;
        const enquiryRetailCode = enquiry.retailCode || enquiry.retail_code;

        // If backend didn't include codes (some prod builds), don't drop the record.
        // The API call itself is already scoped by account_code + retail_code.
        if (!enquiryAccountCode && !enquiryRetailCode) return true;

        const matches = enquiryAccountCode === accountCode && enquiryRetailCode === retailCode;
        if (!matches) {
          console.warn(`Filtering out enquiry with mismatched codes:`, {
            enquiry: { accountCode: enquiryAccountCode, retailCode: enquiryRetailCode },
            expected: { accountCode, retailCode }
          });
        }
        return matches;
      });
      
      console.log(`Filtered from ${originalCount} to ${enquiries.length} enquiries for account ${accountCode}, retail ${retailCode}`);
      return enquiries;
    } catch (error) {
      console.error('Error fetching enquiries:', error);
      // Return empty array as fallback instead of throwing
      return [];
    }
  };

  const updateEnquiry = async (id: number, enquiryData: Partial<EnquiryData>) => {
    try {
      // Validate that the enquiry data uses current user's account/retail codes
      if (enquiryData.accountCode && enquiryData.accountCode !== accountCode) {
        throw new Error('Cannot update enquiry: Account code mismatch.');
      }
      if (enquiryData.retailCode && enquiryData.retailCode !== retailCode) {
        throw new Error('Cannot update enquiry: Retail code mismatch.');
      }

      const params = new URLSearchParams();
      params.append('account_code', accountCode);
      params.append('retail_code', retailCode);
      
      const response = await fetch(`${API_BASE_URL}/enquiries/${id}?${params.toString()}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountCode: enquiryData.accountCode || accountCode,
          retailCode: enquiryData.retailCode || retailCode,
          contact: enquiryData.contact,
          clientName: enquiryData.clientName,
          email: enquiryData.email,
          address: enquiryData.address,
          enquiryFor: enquiryData.enquiryFor,
          enquiryType: enquiryData.enquiryType,
          response: enquiryData.response,
          dateToFollow: enquiryData.dateToFollow,
          source: enquiryData.source,
          leadRep: enquiryData.leadRep,
          leadStatus: enquiryData.leadStatus,
          sendSms: enquiryData.sendSms,
          sendWhatsApp: enquiryData.sendWhatsApp,
          description: enquiryData.description,
          updatedBy: enquiryData.updatedBy || 'admin_user'
        }),
      });
      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to update enquiry: ${errorData}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error updating enquiry:', error);
      throw error;
    }
  };

  const deleteEnquiry = async (id: number) => {
    try {
      // Validate that we're only deleting enquiries from the current account/retail
      const enquiryToDelete = list.find(item => item.id === id);
      if (enquiryToDelete) {
        const enquiryAccountCode = enquiryToDelete.accountCode;
        const enquiryRetailCode = enquiryToDelete.retailCode;
        if (enquiryAccountCode !== accountCode || enquiryRetailCode !== retailCode) {
          throw new Error('Cannot delete enquiry: Account or retail code mismatch.');
        }
      }

      const params = new URLSearchParams();
      params.append('account_code', accountCode);
      params.append('retail_code', retailCode);
      
      const response = await fetch(`${API_BASE_URL}/enquiries/${id}?${params.toString()}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('access_token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to delete enquiry';
        try {
          const errorText = await response.text();
          if (errorText.startsWith('{')) {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.message || errorData.detail || errorMessage;
          } else {
            errorMessage = errorText || errorMessage;
          }
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting enquiry:', error);
      throw error;
    }
  };

  // Load employees from master_employee (kept for potential future use in reports/filters)
  useEffect(() => {
    const loadEmployees = async () => {
      if (!accountCode || !retailCode) {
        return;
      }

      setEmployeesLoading(true);
      try {
        const response: any = await ApiService.post('/read', {
          account_code: accountCode,
          retail_code: retailCode,
          tables: ['master_employee'],
        });

        if (response?.success) {
          const raw = response.data;
          const empData = Array.isArray(raw)
            ? raw
            : (raw?.master_employee || raw?.employee || raw?.employees || []);
          const mappedEmployees: Employee[] = (empData as any[]).map((emp: any) => ({
            id: String(emp.employee_id || emp.id || ''),
            name: emp.employee_name || emp.name || 'Unknown',
            employee_code: emp.employee_code,
            department: emp.department,
            designation: emp.designation,
            status: emp.status || emp.employee_status || emp.is_active,
          }));
          setEmployees(mappedEmployees.filter(emp => emp.id && emp.name !== 'Unknown'));
        }
      } catch (error) {
        console.error('Failed to load employees:', error);
        setEmployees([]);
      } finally {
        setEmployeesLoading(false);
      }
    };

    loadEmployees();
  }, [accountCode, retailCode]); // Re-fetch when account/retail codes change

  // Load data on component mount and when account/retail codes change
  useEffect(() => {
    const loadEnquiries = async () => {
      // Ensure we have valid account and retail codes
      if (!accountCode || !retailCode) {
        console.warn('Account or retail code not available, skipping enquiry load');
        return;
      }
      
      console.log('Loading enquiries for:', { accountCode, retailCode });
      
      // Validate codes format (basic validation)
      if (accountCode.length < 3 || retailCode.length < 3) {
        console.warn('Invalid account or retail code format:', { accountCode, retailCode });
        toast({ title: "Warning", description: "Invalid account or retail code. Please refresh the page.", variant: "destructive" });
        return;
      }
      // Fetch enquiries....
      try {
        setIsLoading(true);
        const data = await fetchEnquiries();
        setList(data);
        
        if (data.length === 0) {
          console.log(`No enquiries found for account ${accountCode}, retail ${retailCode}`);
        }
      } catch (error) {
        console.error('Failed to load enquiries:', error);
        setList([]); // Clear any existing data on error
        // Show user-friendly error
        toast({ title: "Error", description: "Failed to load enquiries. Please check your connection and try again.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    };
    
    loadEnquiries();
  }, [accountCode, retailCode]); // Re-fetch when account/retail codes change

  // Load inventory items for multi-select (from master_inventory)
  useEffect(() => {
    const loadInventory = async () => {
      if (!accountCode || !retailCode) return;

      try {
        const response: any = await ApiService.post('/read', {
          account_code: accountCode,
          retail_code: retailCode,
          tables: ['master_inventory'],
        });

        if (response?.success) {
          const raw = response.data;
          const rows: any[] = Array.isArray(raw)
            ? raw
            : (raw?.master_inventory || raw?.inventory || raw?.product_master || raw?.products || []);

          const mapped: InventoryItemOption[] = rows
            .map((p: any) => {
              const idNum = Number(p.id ?? p.inventory_id ?? p.product_id ?? 0);
              const name = String(p.item_name ?? p.product_name ?? p.reference_code ?? '').trim();
              return { id: Number.isFinite(idNum) ? idNum : 0, name };
            })
            .filter((it) => it.id && it.name);

          setInventoryOptions(mapped);
        }
      } catch (error) {
        console.error('Failed to load inventory for enquiries:', error);
        setInventoryOptions([]);
      }
    };

    loadInventory();
  }, [accountCode, retailCode]);

  // Filter the list when filters change
  useEffect(() => {
    let filtered = [...list];

    if (fromDateFilter || toDateFilter) {
      filtered = filtered.filter(item => {
        const parseDate = (value?: string | null) => {
          const raw = String(value || '').trim();
          if (!raw) return null;
          // Normalize common backend formats like "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
          const normalized = (!raw.includes('T') && raw.includes(' ')) ? raw.replace(' ', 'T') : raw;
          const d = new Date(normalized);
          return isNaN(d.getTime()) ? null : d;
        };

        // Filter should be based on enquiry created date (matches "From Date" / "To Date" labels)
        const itemDate =
          parseDate((item as any).createdAt) ||
          parseDate((item as any).created_at) ||
          // Fallback to follow-up date if created date isn't present
          parseDate((item as any).dateToFollow) ||
          parseDate((item as any).date_to_follow);

        // If we can't parse any date on the item, don't filter it out.
        if (!itemDate) return true;
        
        // Parse filter dates
        const fromDate = fromDateFilter ? new Date(fromDateFilter) : null;
        const toDate = toDateFilter ? new Date(toDateFilter) : null;
        
        
        if (fromDate) {
          fromDate.setHours(0, 0, 0, 0);
        }
        if (toDate) {
          toDate.setHours(23, 59, 59, 999);
        }
        
        // Ensure itemDate is properly set to start of day for comparison
        itemDate.setHours(0, 0, 0, 0);
        
        if (fromDate && itemDate < fromDate) return false;
        if (toDate && itemDate > toDate) return false;
        return true;
      });
    }
    if (enquiryForFilter) {
      const term = enquiryForFilter.toLowerCase();
      filtered = filtered.filter(item => {
        const fields = [
          item.enquiryFor,
          item.clientName,
          item.contact,
          item.email,
          item.address,
          item.description,
        ];
        return fields.some((value) =>
          String(value || '').toLowerCase().includes(term)
        );
      });
    }
    if (leadRepFilter && leadRepFilter !== 'all') {
      filtered = filtered.filter(item => item.leadRep === leadRepFilter);
    }
    if (enquiryTypeFilter && enquiryTypeFilter !== 'all') {
      filtered = filtered.filter(item => item.enquiryType === enquiryTypeFilter);
    }

    setFilteredList(filtered);
  }, [list, fromDateFilter, toDateFilter, enquiryForFilter, leadRepFilter, enquiryTypeFilter]);

  const validateForm = () => {
    if (!accountCode.trim()) {
      toast({ title: "Validation Error", description: "Account code could not be loaded. Please refresh the page.", variant: "destructive" });
      return false;
    }
    if (!contact.trim()) {
      toast({ title: "Validation Error", description: "Contact number is required", variant: "destructive" });
      return false;
    }
    if (!clientName.trim()) {
      toast({ title: "Validation Error", description: "Client name is required", variant: "destructive" });
      return false;
    }
    if (!enquiryFor.trim()) {
      toast({ title: "Validation Error", description: "Enquiry for is required", variant: "destructive" });
      return false;
    }
    if (!enquiryType) {
      toast({ title: "Validation Error", description: "Enquiry type is required", variant: "destructive" });
      return false;
    }
    if (!source) {
      toast({ title: "Validation Error", description: "Source of enquiry is required", variant: "destructive" });
      return false;
    }
    if (!leadStatus) {
      toast({ title: "Validation Error", description: "Lead status is required", variant: "destructive" });
      return false;
    }
    if (selectedInventoryIds.length === 0) {
      toast({ title: "Validation Error", description: "Please select at least one interested item", variant: "destructive" });
      return false;
    }
    return true;
  };

  const onAdd = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const enquiryData = {
        accountCode,
        retailCode,
        contact, 
        clientName, 
        email, 
        address, 
        enquiryFor, 
        enquiryType, 
        response, 
        dateToFollow, 
        source, 
        leadRep, 
        leadStatus,
        sendSms,
        sendWhatsApp,
        description,
        createdBy: 'admin_user' // Replace with actual user
      };
      
      if (editingId) {
        // Update existing enquiry
        await updateEnquiry(editingId, enquiryData);
        setEditingId(null);
        toast({ title: "Success", description: "Enquiry updated successfully" });
      } else {
        // Create new enquiry
        await createEnquiry(enquiryData);
        toast({ title: "Success", description: "Enquiry added successfully" });
      }
      
      // Reload data
      const updatedData = await fetchEnquiries();
      setList(updatedData);
      
      // Reset form fields
      resetForm();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save enquiry. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    // Don't reset accountCode and retailCode as they are auto-populated
    setContact(''); 
    setClientName(''); 
    setEmail(''); 
    setAddress('');
    setEnquiryFor(''); 
    setResponse('');
    setEnquiryType('');
    setSource('');
    setDateToFollow(new Date().toISOString().slice(0,10));
    setSendSms(false);
    setSendWhatsApp(false);
    setDescription('');
    setSelectedInventoryIds([]);
    setInventorySearch('');
    setEditingId(null);
    setShowForm(false); // Hide form when resetting
  };

  const onEdit = (enquiry: EnquiryData) => {
    // Validate that we can only edit enquiries from the current account/retail
    if (enquiry.accountCode !== accountCode || enquiry.retailCode !== retailCode) {
      toast({ title: "Error", description: "Cannot edit enquiry: Account or retail code mismatch.", variant: "destructive" });
      return;
    }

    // Don't edit accountCode and retailCode as they are auto-populated
    setContact(enquiry.contact);
    setClientName(enquiry.clientName);
    setEmail(enquiry.email);
    setAddress(enquiry.address);
    setEnquiryFor(enquiry.enquiryFor);
    setEnquiryType(enquiry.enquiryType);
    setResponse(enquiry.response);
    setDateToFollow(enquiry.dateToFollow);
    setSource(enquiry.source);
    setLeadRep(enquiry.leadRep);
    setLeadStatus(enquiry.leadStatus);
    setSendSms(enquiry.sendSms);
    setSendWhatsApp(enquiry.sendWhatsApp);
    setDescription(enquiry.description);
    setEditingId(enquiry.id);
    setShowForm(true); // Show form when editing
    
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearFilters = () => {
    setFromDateFilter('');
    setToDateFilter('');
    setEnquiryForFilter('');
    setLeadRepFilter('all');
    setEnquiryTypeFilter('');
    setCurrentPage(1); // Reset to first page when clearing filters
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredList.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedList = filteredList.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const goToPrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  // Reset to page 1 when filtered list changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filteredList.length]);

  const exportData = () => {
    // Simple CSV export
    const headers = ['Name', 'Email', 'Phone', 'Date to follow', 'Lead type', 'Enquiry for', 'Source', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredList.map(row => [
        row.clientName,
        row.email,
        row.contact,
        row.dateToFollow,
        row.enquiryType,
        row.enquiryFor,
        row.source,
        row.leadStatus
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'enquiries.csv';
    a.click();
    window.URL.revokeObjectURL(url);

    toast({ title: "Success", description: "Data exported successfully" });
  };

  return (
    <div className="p-2 sm:p-4 w-full max-w-none">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {([
          {
            label: 'Total',
            value: filteredList.length,
            sub: 'Enquiries',
            tone: 'from-blue-500/10 to-blue-500/5',
            iconTint: 'bg-blue-100 text-blue-600 ring-blue-200/60',
            icon: (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ),
          },
          {
            label: 'Pending',
            value: filteredList.filter((item) => item.leadStatus === 'Pending').length,
            sub: 'Follow-ups',
            tone: 'from-orange-500/10 to-orange-500/5',
            iconTint: 'bg-orange-100 text-orange-600 ring-orange-200/60',
            icon: (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
          },
          {
            label: 'Contacted',
            value: filteredList.filter((item) => item.leadStatus === 'Contacted').length,
            sub: 'In touch',
            tone: 'from-indigo-500/10 to-indigo-500/5',
            iconTint: 'bg-indigo-100 text-indigo-600 ring-indigo-200/60',
            icon: (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            ),
          },
          {
            label: 'Converted',
            value: filteredList.filter((item) => item.leadStatus === 'Converted').length,
            sub: 'Success',
            tone: 'from-green-500/10 to-green-500/5',
            iconTint: 'bg-green-100 text-green-600 ring-green-200/60',
            icon: (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
          },
        ] as const).map((card) => (
          <div
            key={card.label}
            className="relative overflow-hidden rounded-xl border border-gray-200/70 dark:border-gray-800/60 bg-white dark:bg-gray-900 px-4 py-4 shadow-sm hover:shadow-md transition-shadow group min-h-[96px]"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${card.tone} opacity-80 pointer-events-none`}></div>
            <div className="relative flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] font-semibold tracking-wide text-gray-600 dark:text-gray-400 uppercase leading-none">{card.label}</p>
                <p className="mt-2 text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{card.value}</p>
                <p className="mt-1 text-[12px] text-gray-500">{card.sub}</p>
              </div>
              <div className={`shrink-0 h-10 w-10 rounded-md ${card.iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform`}>{card.icon}</div>
            </div>
            <div className="absolute -right-4 -bottom-4 h-16 w-16 rounded-full bg-white/30 dark:bg-white/5 blur-2xl opacity-40"></div>
          </div>
        ))}
      </div>

      {/* Add Enquiry Form - Show only when showForm is true */}
      {showForm && (
        <Card className="mb-6 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <CardTitle className="text-lg text-gray-800">
                {editingId ? "Edit Enquiry" : "Add New Enquiry"}
              </CardTitle>
              <Button 
                onClick={() => {
                  setShowForm(false);
                  if (editingId) {
                    resetForm();
                  }
                }}
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
              >
                ✕
              </Button>
            </div>
          </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Row 1: core client/contact info */}
            <div>
              <Label className="text-sm font-medium text-gray-700">Client name <span className="text-red-500">*</span></Label>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Enter client name"
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Contact number <span className="text-red-500">*</span></Label>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Enter contact number"
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                type="email"
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Date to follow <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={dateToFollow}
                onChange={(e) => setDateToFollow(e.target.value)}
                className="mt-2"
              />
            </div>

            {/* Row 2: enquiry meta */}
            <div>
              <Label className="text-sm font-medium text-gray-700">Source of enquiry <span className="text-red-500">*</span></Label>
              <Select value={source} onValueChange={(v) => setSource(v)}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walkin">Walk-in</SelectItem>
                  <SelectItem value="phone">Phone Call</SelectItem>
                  <SelectItem value="social">Social Media</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="advertisement">Advertisement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Enquiry type <span className="text-red-500">*</span></Label>
              <Select value={enquiryType} onValueChange={(v) => setEnquiryType(v)}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="follow_up">Follow Up</SelectItem>
                  <SelectItem value="promotion">Promotion</SelectItem>
                  <SelectItem value="consultation">Consultation</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Lead status <span className="text-red-500">*</span></Label>
              <Select value={leadStatus} onValueChange={(v) => setLeadStatus(v)}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Contacted">Contacted</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Converted">Converted</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">Response</Label>
              <Input
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Customer response"
                className="mt-2"
              />
            </div>

            {/* Row 3: enquiry content & additional info */}
            <div>
              <Label className="text-sm font-medium text-gray-700">Enquiry for <span className="text-red-500">*</span></Label>
              <Input
                value={enquiryFor}
                onChange={(e) => setEnquiryFor(e.target.value)}
                placeholder=""
                className="mt-2"
              />
            </div>

            {/* Inventory multi-select as select-style control */}
            <div>
              <Label className="text-sm font-medium text-gray-700">Interested items <span className="text-red-500">*</span></Label>
              <div className="mt-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between bg-white border-slate-300 h-9 px-3 text-left text-sm"
                    >
                      <span className={selectedInventoryIds.length ? "truncate text-slate-900" : "truncate text-muted-foreground"}>
                        {(() => {
                          const selectedNames = selectedInventoryIds
                            .map((id) => inventoryOptions.find((it) => it.id === id)?.name)
                            .filter(Boolean) as string[];
                          if (!selectedNames.length) return "";
                          if (selectedNames.length === 1) return selectedNames[0];
                          return `${selectedNames[0]} + ${selectedNames.length - 1} more`;
                        })()}
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
                        placeholder="Search inventory items..."
                        className="h-9"
                        value={inventorySearch}
                        onValueChange={setInventorySearch}
                      />
                      <CommandList>
                        <CommandEmpty>No items found.</CommandEmpty>
                        <CommandGroup>
                          {inventoryOptions
                            .filter((it) => {
                              const q = inventorySearch.trim().toLowerCase();
                              if (!q) return true;
                              return it.name.toLowerCase().includes(q);
                            })
                            .slice(0, 50)
                            .map((it) => {
                              const checked = selectedInventoryIds.includes(it.id);
                              return (
                                <CommandItem
                                  key={it.id}
                                  value={it.name}
                                  onSelect={() => {
                                    setSelectedInventoryIds((prev) => {
                                      const next = checked
                                        ? prev.filter((id) => id !== it.id)
                                        : [...prev, it.id];

                                      const selectedNames = next
                                        .map((id) => inventoryOptions.find((opt) => opt.id === id)?.name)
                                        .filter(Boolean)
                                        .join(', ');

                                      setDescription(selectedNames);
                                      return next;
                                    });
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5 rounded border-slate-300"
                                      readOnly
                                      checked={checked}
                                    />
                                    <span className="truncate" title={it.name}>
                                      {it.name}
                                    </span>
                                  </div>
                                </CommandItem>
                              );
                            })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedInventoryIds.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-700">
                    {selectedInventoryIds
                      .map((id) => inventoryOptions.find((it) => it.id === id)?.name)
                      .filter(Boolean)
                      .map((name) => (
                        <span key={name as string} className="rounded bg-slate-100 px-1.5 py-0.5">
                          {name}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter address"
                className="mt-2"
              />
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">Description</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional description"
                className="mt-2 min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-vertical"
                rows={3}
              />
            </div>

            {/* Communication section hidden for future use
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-3">
                <Label className="text-sm font-medium text-gray-700">Communication</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input 
                      type="checkbox" 
                      checked={sendSms} 
                      onChange={e=>setSendSms(e.target.checked)}
                      className="rounded border-gray-300" 
                    /> 
                    SMS
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input 
                      type="checkbox" 
                      checked={sendWhatsApp} 
                      onChange={e=>setSendWhatsApp(e.target.checked)}
                      className="rounded border-gray-300" 
                    /> 
                    WhatsApp
                  </label>
                </div>
              </div>
            </div>
            */}
          </div>
          
          <div className="flex justify-end gap-3">
            {editingId && (
              <Button 
                onClick={resetForm} 
                variant="outline"
                className="px-6"
              >
                Cancel
              </Button>
            )}
            <Button 
              onClick={onAdd} 
              className="bg-green-600 hover:bg-green-700 px-6"
              disabled={isLoading}
            >
              <Save className="mr-2 h-4 w-4" />
              {isLoading ? (editingId ? "Updating..." : "Saving...") : (editingId ? "Update Enquiry" : "Save")}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* View & Manage Enquiries */}
      <Card className="border bg-white shadow-sm">
        <CardHeader className="border-b bg-slate-50/80">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="text-lg text-slate-900">Manage All Enquiries</CardTitle>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              {!showForm && (
                <Button 
                  onClick={() => setShowForm(true)}
                  className="w-full sm:w-auto gap-2 bg-blue-700 hover:bg-blue-800 text-white"
                >
                  <Plus className="h-4 w-4" />
                  Add New Enquiry
                </Button>
              )}
              <Button 
                onClick={exportData}
                variant="outline"
                className="w-full sm:w-auto flex items-center justify-center gap-2"
                disabled={filteredList.length === 0}
              >
                <Download className="w-4 h-4" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {/* Filters */}
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center border border-input bg-background shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden rounded-lg">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-3">
              <div className="min-w-0">
                <Label className="text-xs text-slate-600">From Date</Label>
                <Input type="date" className="mt-1 h-10" value={fromDateFilter} onChange={(e) => setFromDateFilter(e.target.value)} />
              </div>
              <div className="min-w-0">
                <Label className="text-xs text-slate-600">To Date</Label>
                <Input type="date" className="mt-1 h-10" value={toDateFilter} onChange={(e) => setToDateFilter(e.target.value)} />
              </div>
              <div className="min-w-0 lg:col-span-2">
                <Label className="text-xs text-slate-600">Enquiry for</Label>
                <Input
                  placeholder="Search services/products"
                  className="mt-1 h-10 w-full"
                  value={enquiryForFilter}
                  onChange={(e) => setEnquiryForFilter(e.target.value)}
                />
              </div>
              {/* Lead representative filter removed as per request */}
              <div className="min-w-0">
                <Label className="text-xs text-slate-600">Enquiry type</Label>
                <Select value={enquiryTypeFilter} onValueChange={setEnquiryTypeFilter}>
                  <SelectTrigger className="mt-1 h-10">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="follow_up">Follow Up</SelectItem>
                    <SelectItem value="promotion">Promotion</SelectItem>
                    <SelectItem value="consultation">Consultation</SelectItem>
                    <SelectItem value="complaint">Complaint</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="p-3 sm:p-0 sm:w-[160px] flex items-center justify-center">
              <Button onClick={clearFilters} variant="outline" className="w-full sm:w-full rounded-none border-0 h-10">
                Clear Filters
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase text-gray-600 w-[60px] text-center">Sl. No</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Phone</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Date to follow</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Lead type</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Enquiry for</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Source</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase text-gray-600">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-500">
                      {list.length === 0 ? 'No enquiries yet. Add your first enquiry above.' : 'No enquiries match your filters.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedList.map((row, index) => {
                    const enquiryTypeCls =
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border shadow-sm ' +
                      (row.enquiryType === 'general'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : row.enquiryType === 'follow_up'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : row.enquiryType === 'promotion'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : row.enquiryType === 'consultation'
                              ? 'border-violet-200 bg-violet-50 text-violet-700'
                              : 'border-rose-200 bg-rose-50 text-rose-700');

                    const statusCls =
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border shadow-sm ' +
                      (row.leadStatus === 'Pending'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : row.leadStatus === 'Contacted'
                          ? 'border-sky-200 bg-sky-50 text-sky-700'
                          : row.leadStatus === 'In Progress'
                            ? 'border-orange-200 bg-orange-50 text-orange-700'
                            : row.leadStatus === 'Converted'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-rose-200 bg-rose-50 text-rose-700');

                    return (
                      <TableRow
                        key={row.id}
                        className={editingId === row.id ? 'bg-blue-50/60' : index % 2 === 0 ? 'bg-white' : 'bg-white'}
                      >
                        <TableCell className="text-center text-slate-700">{startIndex + index + 1}</TableCell>
                        <TableCell className="font-medium text-slate-900">
                          <div className="flex flex-col gap-0.5">
                            <span>{row.clientName}</span>
                            {row.description ? (
                              <span className="text-[11px] text-slate-500 line-clamp-2">
                                {row.description}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-700">{row.contact}</TableCell>
                        <TableCell className="text-slate-700">{row.dateToFollow}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={enquiryTypeCls}>
                            {String(row.enquiryType || '').replace('_', ' ') || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700">{row.enquiryFor}</TableCell>
                        <TableCell className="text-slate-700 capitalize">{row.source}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusCls}>
                            {row.leadStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600"
                              onClick={() => navigate('/enquiry/print', { state: { enquiry: row } })}
                              title="Print quotation"
                              aria-label="Print quotation"
                            >
                              <FileSignature className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600"
                              onClick={() => onEdit(row)}
                              title="Edit enquiry"
                              aria-label="Edit enquiry"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination Controls */}
          {filteredList.length > itemsPerPage && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
              <div className="text-center sm:text-left text-sm text-slate-600">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredList.length)} of {filteredList.length} results
              </div>
              
              <div className="flex items-center justify-center sm:justify-end gap-2">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage === 1} onClick={goToPrevPage} aria-label="Previous page" title="Previous">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <Button key={page} onClick={() => goToPage(page)} variant={currentPage === page ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0">
                      {page}
                    </Button>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage === totalPages} onClick={goToNextPage} aria-label="Next page" title="Next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
