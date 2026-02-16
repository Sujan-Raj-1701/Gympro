import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BusinessService, BusinessType } from "@/services/businessService";
import { LicenseService } from "@/services/licenseService";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Building2, Phone, Users, ShoppingBag, Calendar as CalendarIcon, Plus, X, Shield, Settings, LogOut, AlertCircle, CheckCircle, List, AlertTriangle } from "lucide-react";
import { LicenseSidebar } from "./components/LicenseSidebar";
import { CustomerManagementView } from "./components/CustomerManagementView";
import { LicenseExpireView } from "./components/LicenseExpireView";
import InvoiceGenerator from "./InvoiceGenerator";

interface BusinessDetails {
  accountName: string;
  accountPhone: string;
  retailCount: number;
  licenseApplicationType: "all" | "each";
  licensePeriod: string;
  customEndDate?: Date;
  retailUnitPeriods?: { period: string; customEndDate?: Date }[];
}

interface ValidationError {
  field: string;
  message: string;
}

interface FormErrors {
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  businessTypes?: string;
  businesses?: { [key: string]: { [key: number]: { [field: string]: string } } };
}

// Validation utility functions
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePhone = (phone: string): boolean => {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
};

const validateCompanyName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z0-9\s\-\.\_\&]+$/.test(name);
};

const validateAccountName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z0-9\s\-\.\_]+$/.test(name);
};

const validateRetailCount = (count: number): boolean => {
  return count >= 1 && count <= 999 && Number.isInteger(count);
};

// Field validation status component
const FieldValidationIcon = ({ isValid, hasError, showValidation }: {
  isValid: boolean;
  hasError: boolean;
  showValidation: boolean;
}) => {
  if (!showValidation) return null;

  if (hasError) {
    return <AlertCircle className="h-4 w-4 text-red-500 absolute right-2 top-1/2 transform -translate-y-1/2" />;
  }

  if (isValid) {
    return <CheckCircle className="h-4 w-4 text-green-500 absolute right-2 top-1/2 transform -translate-y-1/2" />;
  }

  return null;
};

export default function LicenseManagement() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [selectedBusinessTypes, setSelectedBusinessTypes] = useState<string[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [isLoadingBusinessTypes, setIsLoadingBusinessTypes] = useState(true);
  const [businesses, setBusinesses] = useState<{ [key: string]: BusinessDetails[] }>({});
  const [currentBusinessType, setCurrentBusinessType] = useState<string>("");
  const [currentBusinessIndex, setCurrentBusinessIndex] = useState<{ [key: string]: number }>({});
  const [activeView, setActiveView] = useState("creation");

  // Validation states
  const [errors, setErrors] = useState<FormErrors>({});
  const [isValidating, setIsValidating] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  // Comprehensive validation function
  const validateForm = (): { isValid: boolean; errors: FormErrors } => {
    const newErrors: FormErrors = {};

    // Company information validation
    if (!companyName.trim()) {
      newErrors.companyName = "Company name is required";
    } else if (!validateCompanyName(companyName)) {
      newErrors.companyName = "Company name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, underscores, and ampersands";
    }

    if (!companyPhone.trim()) {
      newErrors.companyPhone = "Phone number is required";
    } else if (!validatePhone(companyPhone)) {
      newErrors.companyPhone = "Please enter a valid phone number with at least 10 digits";
    }

    if (!companyEmail.trim()) {
      newErrors.companyEmail = "Email address is required";
    } else if (!validateEmail(companyEmail)) {
      newErrors.companyEmail = "Please enter a valid email address";
    }

    // Business types validation
    if (selectedBusinessTypes.length === 0) {
      newErrors.businessTypes = "At least one business type must be selected";
    }

    // Business details validation
    const businessErrors: { [key: string]: { [key: number]: { [field: string]: string } } } = {};

    selectedBusinessTypes.forEach(businessType => {
      const businessArray = businesses[businessType];
      if (!businessArray || businessArray.length === 0) {
        if (!businessErrors[businessType]) businessErrors[businessType] = {};
        businessErrors[businessType][0] = { general: `At least one business must be configured for ${businessTypes.find(t => t.id === businessType)?.name || businessType}` };
        return;
      }

      businessArray.forEach((business, index) => {
        const businessFieldErrors: { [field: string]: string } = {};

        // Account name validation
        if (!business.accountName.trim()) {
          businessFieldErrors.accountName = "Account name is required";
        } else if (!validateAccountName(business.accountName)) {
          businessFieldErrors.accountName = "Account name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, and underscores";
        }

        // Account phone validation
        if (!business.accountPhone.trim()) {
          businessFieldErrors.accountPhone = "Account phone is required";
        } else if (!validatePhone(business.accountPhone)) {
          businessFieldErrors.accountPhone = "Please enter a valid phone number with at least 10 digits";
        }

        // Retail count validation
        if (!validateRetailCount(business.retailCount)) {
          businessFieldErrors.retailCount = "Retail count must be a number between 1 and 999";
        }

        // License period validation for "all" type
        if (business.licenseApplicationType === "all") {
          if (!business.licensePeriod) {
            businessFieldErrors.licensePeriod = "License period is required";
          } else if (business.licensePeriod === "Custom" && !business.customEndDate) {
            businessFieldErrors.customEndDate = "Custom end date is required when custom period is selected";
          } else if (business.licensePeriod === "Custom" && business.customEndDate && business.customEndDate <= new Date()) {
            businessFieldErrors.customEndDate = "Custom end date must be in the future";
          }
        }

        // Individual retail unit validation for "each" type
        if (business.licenseApplicationType === "each") {
          const retailUnitPeriods = business.retailUnitPeriods || [];
          let hasRetailUnitErrors = false;

          for (let i = 0; i < business.retailCount; i++) {
            const retailUnit = retailUnitPeriods[i];
            if (!retailUnit || !retailUnit.period) {
              businessFieldErrors[`retailUnit_${i}_period`] = `License period is required for Unit #${i + 1}`;
              hasRetailUnitErrors = true;
            } else if (retailUnit.period === "Custom" && !retailUnit.customEndDate) {
              businessFieldErrors[`retailUnit_${i}_customDate`] = `Custom end date is required for Unit #${i + 1}`;
              hasRetailUnitErrors = true;
            } else if (retailUnit.period === "Custom" && retailUnit.customEndDate && retailUnit.customEndDate <= new Date()) {
              businessFieldErrors[`retailUnit_${i}_customDate`] = `Custom end date must be in the future for Unit #${i + 1}`;
              hasRetailUnitErrors = true;
            }
          }

          if (hasRetailUnitErrors) {
            businessFieldErrors.retailUnits = "Please configure all retail unit license periods";
          }
        }

        if (Object.keys(businessFieldErrors).length > 0) {
          if (!businessErrors[businessType]) businessErrors[businessType] = {};
          businessErrors[businessType][index] = businessFieldErrors;
        }
      });
    });

    if (Object.keys(businessErrors).length > 0) {
      newErrors.businesses = businessErrors;
    }

    return {
      isValid: Object.keys(newErrors).length === 0,
      errors: newErrors
    };
  };

  // Real-time validation for individual fields
  const validateField = (field: string, value: string, businessType?: string, businessIndex?: number) => {
    const newErrors = { ...errors };

    switch (field) {
      case 'companyName':
        if (!value.trim()) {
          newErrors.companyName = "Company name is required";
        } else if (!validateCompanyName(value)) {
          newErrors.companyName = "Company name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, underscores, and ampersands";
        } else {
          delete newErrors.companyName;
        }
        break;

      case 'companyPhone':
        if (!value.trim()) {
          newErrors.companyPhone = "Phone number is required";
        } else if (!validatePhone(value)) {
          newErrors.companyPhone = "Please enter a valid phone number with at least 10 digits";
        } else {
          delete newErrors.companyPhone;
        }
        break;

      case 'companyEmail':
        if (!value.trim()) {
          newErrors.companyEmail = "Email address is required";
        } else if (!validateEmail(value)) {
          newErrors.companyEmail = "Please enter a valid email address";
        } else {
          delete newErrors.companyEmail;
        }
        break;

      case 'accountName':
        if (businessType && typeof businessIndex === 'number') {
          if (!newErrors.businesses) newErrors.businesses = {};
          if (!newErrors.businesses[businessType]) newErrors.businesses[businessType] = {};
          if (!newErrors.businesses[businessType][businessIndex]) newErrors.businesses[businessType][businessIndex] = {};

          if (!value.trim()) {
            newErrors.businesses[businessType][businessIndex].accountName = "Account name is required";
          } else if (!validateAccountName(value)) {
            newErrors.businesses[businessType][businessIndex].accountName = "Account name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, and underscores";
          } else {
            delete newErrors.businesses[businessType][businessIndex].accountName;
            if (Object.keys(newErrors.businesses[businessType][businessIndex]).length === 0) {
              delete newErrors.businesses[businessType][businessIndex];
            }
            if (Object.keys(newErrors.businesses[businessType]).length === 0) {
              delete newErrors.businesses[businessType];
            }
            if (Object.keys(newErrors.businesses).length === 0) {
              delete newErrors.businesses;
            }
          }
        }
        break;

      case 'accountPhone':
        if (businessType && typeof businessIndex === 'number') {
          if (!newErrors.businesses) newErrors.businesses = {};
          if (!newErrors.businesses[businessType]) newErrors.businesses[businessType] = {};
          if (!newErrors.businesses[businessType][businessIndex]) newErrors.businesses[businessType][businessIndex] = {};

          if (!value.trim()) {
            newErrors.businesses[businessType][businessIndex].accountPhone = "Account phone is required";
          } else if (!validatePhone(value)) {
            newErrors.businesses[businessType][businessIndex].accountPhone = "Please enter a valid phone number with at least 10 digits";
          } else {
            delete newErrors.businesses[businessType][businessIndex].accountPhone;
            if (Object.keys(newErrors.businesses[businessType][businessIndex]).length === 0) {
              delete newErrors.businesses[businessType][businessIndex];
            }
            if (Object.keys(newErrors.businesses[businessType]).length === 0) {
              delete newErrors.businesses[businessType];
            }
            if (Object.keys(newErrors.businesses).length === 0) {
              delete newErrors.businesses;
            }
          }
        }
        break;
    }

    setErrors(newErrors);
  };

  // Fetch business types from backend
  const fetchBusinessTypes = async () => {
    try {
      setIsLoadingBusinessTypes(true);
      if (!user?.account_code || !user?.retail_code) {
        setBusinessTypes([{ id: 'RESTAURANT', name: 'Restaurant' }]);
        return;
      }
      const types = await BusinessService.getBusinessTypes(user.account_code, user.retail_code);
      setBusinessTypes(types);
    } catch (error) {
      console.error('Error fetching business types:', error);
      // Fallback to default data
      setBusinessTypes([{ id: 'RESTAURANT', name: 'Restaurant' }]);
    } finally {
      setIsLoadingBusinessTypes(false);
    }
  };

  // Handle business type selection/deselection
  const handleBusinessTypeToggle = (typeId: string) => {
    setSelectedBusinessTypes(prev => {
      const newSelection = prev.includes(typeId)
        ? prev.filter(id => id !== typeId)
        : [...prev, typeId];

      // Create business details for new selections
      if (!prev.includes(typeId)) {
        setBusinesses(prevBusinesses => ({
          ...prevBusinesses,
          [typeId]: [{
            accountName: "",
            accountPhone: "",
            retailCount: 1,
            licenseApplicationType: "all",
            licensePeriod: "",
            customEndDate: undefined,
            retailUnitPeriods: [{ period: "", customEndDate: undefined }],
          }]
        }));

        // Set the current business type to the newly added one
        if (newSelection.length === 1) {
          setCurrentBusinessType(typeId);
        }

        // Initialize current business index for this type
        setCurrentBusinessIndex(prev => ({
          ...prev,
          [typeId]: 0
        }));
      } else {
        // Remove business details for deselected types
        setBusinesses(prevBusinesses => {
          const newBusinesses = { ...prevBusinesses };
          delete newBusinesses[typeId];
          return newBusinesses;
        });

        // Remove current business index for this type
        setCurrentBusinessIndex(prev => {
          const newIndexes = { ...prev };
          delete newIndexes[typeId];
          return newIndexes;
        });

        // Update current business type if the removed one was selected
        if (currentBusinessType === typeId) {
          setCurrentBusinessType(newSelection[0] || "");
        }
      }

      return newSelection;
    });
  };

  // Handle admin logout
  const handleLogout = () => {
    // Clear admin access from session
    sessionStorage.removeItem('adminAccess');
    sessionStorage.removeItem('adminAccessTime');

    // Redirect to admin access page
    navigate('/admin-access');
  };

  // Fetch business types and details on component mount
  useEffect(() => {
    fetchBusinessTypes();
    setSelectedBusinessTypes([]); // Ensure no default selection
  }, []);

  const handleAddBusiness = () => {
    // This function is no longer needed as we create businesses per type
  };

  const handleRemoveBusiness = (index: number) => {
    // This function is no longer needed as we manage businesses per type
  };

  const handleAddBusinessToType = (businessType: string) => {
    setBusinesses(prev => ({
      ...prev,
      [businessType]: [
        ...(prev[businessType] || []),
        {
          accountName: "",
          accountPhone: "",
          retailCount: 1,
          licenseApplicationType: "all",
          licensePeriod: "",
          customEndDate: undefined,
          retailUnitPeriods: [{ period: "", customEndDate: undefined }],
        }
      ]
    }));

    // Set the current business index to the newly added business
    const newIndex = (businesses[businessType]?.length || 0);
    setCurrentBusinessIndex(prev => ({
      ...prev,
      [businessType]: newIndex
    }));
  };

  const handleRemoveBusinessFromType = (businessType: string, index: number) => {
    const businessArray = businesses[businessType] || [];
    if (businessArray.length > 1) {
      setBusinesses(prev => ({
        ...prev,
        [businessType]: businessArray.filter((_, i) => i !== index)
      }));

      // Update current business index
      const currentIndex = currentBusinessIndex[businessType] || 0;
      if (currentIndex >= businessArray.length - 1) {
        setCurrentBusinessIndex(prev => ({
          ...prev,
          [businessType]: 0
        }));
      }
    }
  };

  const handleBusinessChange = (businessType: string, businessIndex: number, field: keyof BusinessDetails, value: any) => {
    setBusinesses(prev => {
      const updated = { ...prev };
      if (!updated[businessType] || !updated[businessType][businessIndex]) return prev;

      const businessArray = [...updated[businessType]];

      if (field === "retailCount") {
        // Update retail unit periods array when retail count changes
        const newCount = parseInt(value) || 1;
        const currentPeriods = businessArray[businessIndex].retailUnitPeriods || [];

        const newPeriods = Array.from({ length: newCount }, (_, index) =>
          currentPeriods[index] || { period: "", customEndDate: undefined }
        );

        businessArray[businessIndex] = {
          ...businessArray[businessIndex],
          [field]: newCount,
          retailUnitPeriods: newPeriods,
        };
      } else {
        businessArray[businessIndex] = { ...businessArray[businessIndex], [field]: value };
      }

      updated[businessType] = businessArray;
      return updated;
    });
  };

  const handleRetailUnitPeriodChange = (businessType: string, businessIndex: number, unitIndex: number, period: string) => {
    setBusinesses(prev => {
      const updated = { ...prev };
      if (!updated[businessType] || !updated[businessType][businessIndex]) return prev;

      const businessArray = [...updated[businessType]];
      const currentBusiness = businessArray[businessIndex];
      const retailUnitPeriods = [...(currentBusiness.retailUnitPeriods || [])];
      retailUnitPeriods[unitIndex] = {
        ...retailUnitPeriods[unitIndex],
        period,
        customEndDate: period === "Custom" ? retailUnitPeriods[unitIndex]?.customEndDate : undefined
      };
      businessArray[businessIndex] = { ...currentBusiness, retailUnitPeriods };
      updated[businessType] = businessArray;
      return updated;
    });
  };

  const handleRetailUnitDateChange = (businessType: string, businessIndex: number, unitIndex: number, date: Date | undefined) => {
    setBusinesses(prev => {
      const updated = { ...prev };
      if (!updated[businessType] || !updated[businessType][businessIndex]) return prev;

      const businessArray = [...updated[businessType]];
      const currentBusiness = businessArray[businessIndex];
      const retailUnitPeriods = [...(currentBusiness.retailUnitPeriods || [])];
      retailUnitPeriods[unitIndex] = { ...retailUnitPeriods[unitIndex], customEndDate: date };
      businessArray[businessIndex] = { ...currentBusiness, retailUnitPeriods };
      updated[businessType] = businessArray;
      return updated;
    });
  };

  const handleResetForm = () => {
    setCompanyName("");
    setCompanyPhone("");
    setCompanyEmail("");
    setSelectedBusinessTypes([]);
    setBusinesses({});
    setCurrentBusinessType("");
    setCurrentBusinessIndex({});
    setErrors({});
    setShowValidation(false);
  };

  const handleGenerateLicense = async () => {
    try {
      setIsValidating(true);
      setShowValidation(true);

      // Perform comprehensive validation
      const validation = validateForm();
      setErrors(validation.errors);

      if (!validation.isValid) {
        setIsValidating(false);

        // Show a summary of validation errors
        const errorCount = Object.keys(validation.errors).reduce((count, key) => {
          if (key === 'businesses' && validation.errors.businesses) {
            return count + Object.values(validation.errors.businesses).reduce((businessCount, businessType) => {
              return businessCount + Object.keys(businessType).length;
            }, 0);
          }
          return count + 1;
        }, 0);

        alert(`Please fix ${errorCount} validation error${errorCount > 1 ? 's' : ''} before generating the license.`);
        return;
      }

      // Prepare the request data
      const licenseRequest = {
        companyName,
        companyPhone,
        companyEmail,
        selectedBusinessTypes,
        businesses
      };

      console.log("Generating license with data:", licenseRequest);

      // Send request to backend using LicenseService
      const result = await LicenseService.processLicense(licenseRequest);

      if (result.success) {
        alert(`License generated successfully!\n\nCompany Code: ${result.companyCode}\nAccount Codes: ${result.accountCodes?.join(', ')}\nLicense Keys Generated: ${result.licenseKeys?.length}`);

        // Reset the form and validation state
        handleResetForm();
        setErrors({});
        setShowValidation(false);
      } else {
        alert(`Failed to generate license: ${result.message}`);
      }

    } catch (error) {
      console.error('Error generating license:', error);
      alert('An error occurred while generating the license. Please try again.');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <>
      {/* Custom Scrollbar Styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: rgba(241, 245, 249, 0.5);
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, #3b82f6, #6366f1);
            border-radius: 3px;
            transition: all 0.2s ease;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, #2563eb, #5b21b6);
          }
          .custom-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: #3b82f1 rgba(241, 245, 249, 0.5);
          }
          
          .main-scrollbar::-webkit-scrollbar {
            width: 8px;
          }
          .main-scrollbar::-webkit-scrollbar-track {
            background: rgba(241, 245, 249, 0.3);
            border-radius: 4px;
          }
          .main-scrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, #4f46e5, #7c3aed);
            border-radius: 4px;
            transition: all 0.3s ease;
          }
          .main-scrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, #4338ca, #6b21a8);
            transform: scaleX(1.2);
          }
        `
      }} />

      <div className="h-screen w-full overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex flex-col">
        <div className="flex flex-1 h-full overflow-hidden">
          <LicenseSidebar activeView={activeView} onNavigate={setActiveView} />

          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <header className="bg-white/50 border-b border-gray-100 flex-shrink-0 z-10">
              <div className="max-w-7xl mx-auto px-4 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Shield className="h-6 w-6 text-blue-600" />
                    <div>
                      <h1 className="text-lg font-bold text-gray-800">License Management</h1>
                      <p className="text-xs text-gray-600">Business License Portal</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <p className="text-xs font-medium text-gray-700">Admin Portal</p>
                      <p className="text-xs text-gray-500">{new Date().toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        onClick={handleLogout}
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-gray-600 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Logout"
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                      <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-white" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 p-3 overflow-hidden main-scrollbar">
              {activeView === 'creation' && (
                <div className="max-w-7xl mx-auto h-full">
                  {/* Validation Summary */}
                  {showValidation && Object.keys(errors).length > 0 && (
                    <Alert className="mb-4 border-red-200 bg-red-50">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-800">
                        <span className="font-medium">Please fix the following errors:</span>
                        <ul className="mt-2 list-disc list-inside space-y-1 text-sm">
                          {errors.companyName && <li>Company Name: {errors.companyName}</li>}
                          {errors.companyPhone && <li>Company Phone: {errors.companyPhone}</li>}
                          {errors.companyEmail && <li>Company Email: {errors.companyEmail}</li>}
                          {errors.businessTypes && <li>Business Types: {errors.businessTypes}</li>}
                          {errors.businesses && Object.entries(errors.businesses).map(([businessType, businessErrors]) => (
                            Object.entries(businessErrors).map(([index, fieldErrors]) => (
                              Object.entries(fieldErrors as { [field: string]: string }).map(([field, message]) => (
                                <li key={`${businessType}-${index}-${field}`}>
                                  {businessTypes.find(t => t.id === businessType)?.name || businessType}
                                  {Object.keys(businessErrors).length > 1 ? ` #${parseInt(index) + 1}` : ''}: {message}
                                </li>
                              ))
                            ))
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-120px)]">

                    {/* Left Column - Company & Business Info */}
                    <div className="space-y-2 overflow-y-auto custom-scrollbar">
                      {/* Company Information */}
                      <Card className="border border-gray-200 bg-white/80 backdrop-blur-sm">
                        <CardHeader className="pb-1">
                          <CardTitle className="flex items-center space-x-2 text-sm text-gray-800">
                            <Building2 className="h-3 w-3 text-blue-600" />
                            <span>Company Info</span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-gray-700">Company Name</Label>
                            <div className="relative">
                              <Input
                                value={companyName}
                                onChange={(e) => {
                                  setCompanyName(e.target.value);
                                  if (showValidation) {
                                    validateField('companyName', e.target.value);
                                  }
                                }}
                                onBlur={() => {
                                  if (showValidation) {
                                    validateField('companyName', companyName);
                                  }
                                }}
                                placeholder="Enter company name"
                                className={cn(
                                  "h-7 text-xs border-gray-200 focus:border-blue-500 pr-8",
                                  errors.companyName && showValidation ? "border-red-500 focus:border-red-500" : "",
                                  !errors.companyName && showValidation && companyName && validateCompanyName(companyName) ? "border-green-500" : ""
                                )}
                              />
                              <FieldValidationIcon
                                isValid={!errors.companyName && companyName && validateCompanyName(companyName)}
                                hasError={!!errors.companyName}
                                showValidation={showValidation}
                              />
                            </div>
                            {errors.companyName && showValidation && (
                              <div className="flex items-center space-x-1 text-red-600">
                                <AlertCircle className="h-3 w-3" />
                                <span className="text-xs">{errors.companyName}</span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-gray-700">Phone Number</Label>
                            <Input
                              value={companyPhone}
                              onChange={(e) => {
                                setCompanyPhone(e.target.value);
                                if (showValidation) {
                                  validateField('companyPhone', e.target.value);
                                }
                              }}
                              onBlur={() => {
                                if (showValidation) {
                                  validateField('companyPhone', companyPhone);
                                }
                              }}
                              placeholder="Enter phone number"
                              className={cn(
                                "h-7 text-xs border-gray-200 focus:border-blue-500",
                                errors.companyPhone && showValidation ? "border-red-500 focus:border-red-500" : ""
                              )}
                            />
                            {errors.companyPhone && showValidation && (
                              <div className="flex items-center space-x-1 text-red-600">
                                <AlertCircle className="h-3 w-3" />
                                <span className="text-xs">{errors.companyPhone}</span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-gray-700">Email Address</Label>
                            <Input
                              type="email"
                              value={companyEmail}
                              onChange={(e) => {
                                setCompanyEmail(e.target.value);
                                if (showValidation) {
                                  validateField('companyEmail', e.target.value);
                                }
                              }}
                              onBlur={() => {
                                if (showValidation) {
                                  validateField('companyEmail', companyEmail);
                                }
                              }}
                              placeholder="Enter email address"
                              className={cn(
                                "h-7 text-xs border-gray-200 focus:border-blue-500",
                                errors.companyEmail && showValidation ? "border-red-500 focus:border-red-500" : ""
                              )}
                            />
                            {errors.companyEmail && showValidation && (
                              <div className="flex items-center space-x-1 text-red-600">
                                <AlertCircle className="h-3 w-3" />
                                <span className="text-xs">{errors.companyEmail}</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Business Type */}
                      <Card className="border border-gray-200 bg-white/80 backdrop-blur-sm">
                        <CardHeader className="pb-1">
                          <CardTitle className="flex items-center space-x-2 text-sm text-gray-800">
                            <ShoppingBag className="h-3 w-3 text-green-600" />
                            <span>Business Type</span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {/* Selected Business Types Display */}
                            {selectedBusinessTypes.length > 0 && (
                              <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-md min-h-[32px]">
                                {selectedBusinessTypes.map((typeId) => {
                                  const type = businessTypes.find(t => t.id === typeId);
                                  return type ? (
                                    <Badge
                                      key={typeId}
                                      className="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs flex items-center gap-1"
                                    >
                                      {type.name}
                                      <button
                                        onClick={() => handleBusinessTypeToggle(typeId)}
                                        className="ml-1 hover:bg-blue-300 rounded-full w-3 h-3 flex items-center justify-center text-blue-600"
                                      >
                                        ×
                                      </button>
                                    </Badge>
                                  ) : null;
                                })}
                              </div>
                            )}

                            {/* Business Type Selection */}
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full h-8 text-xs justify-start border-gray-200 hover:bg-gray-50"
                                  disabled={isLoadingBusinessTypes}
                                >
                                  {isLoadingBusinessTypes ? (
                                    "Loading business types..."
                                  ) : selectedBusinessTypes.length === 0 ? (
                                    "Select business types"
                                  ) : (
                                    `${selectedBusinessTypes.length} type${selectedBusinessTypes.length > 1 ? 's' : ''} selected`
                                  )}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 p-0" align="start">
                                <Command>
                                  <CommandInput
                                    placeholder="Search business types..."
                                    className="h-8 text-xs"
                                  />
                                  <CommandList>
                                    <CommandEmpty>No business types found.</CommandEmpty>
                                    <CommandGroup>
                                      {businessTypes.map((type) => (
                                        <CommandItem
                                          key={type.id}
                                          onSelect={() => handleBusinessTypeToggle(type.id)}
                                          className="flex items-center space-x-2 text-xs py-2"
                                        >
                                          <Checkbox
                                            checked={selectedBusinessTypes.includes(type.id)}
                                            className="h-3 w-3"
                                          />
                                          <span className="flex-1">{type.name}</span>
                                          <Badge className="bg-gray-100 text-gray-600 text-xs">
                                            {type.id}
                                          </Badge>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>

                            {errors.businessTypes && showValidation && (
                              <div className="flex items-center space-x-1 text-red-600 mt-1">
                                <AlertCircle className="h-3 w-3" />
                                <span className="text-xs">{errors.businessTypes}</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Action Buttons */}
                      <div className="flex justify-start space-x-2 mt-2">
                        <Button
                          onClick={handleResetForm}
                          variant="outline"
                          size="sm"
                          className="px-4 py-2 border-gray-300 hover:bg-gray-50 text-xs"
                        >
                          Reset Form
                        </Button>
                        <Button
                          onClick={handleGenerateLicense}
                          disabled={isValidating}
                          size="sm"
                          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold transition-all duration-200 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Shield className="h-3 w-3 mr-1" />
                          {isValidating ? "Validating..." : "Generate License"}
                        </Button>
                      </div>
                    </div>

                    {/* Center Column - Business Details */}
                    <div className="lg:col-span-2 overflow-y-auto custom-scrollbar">
                      <Card className="border border-gray-200 bg-white/80 backdrop-blur-sm">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center space-x-2 text-lg text-gray-800">
                              <Users className="h-5 w-5 text-purple-600" />
                              <span>Business Details</span>
                            </CardTitle>
                            {selectedBusinessTypes.length > 1 && (
                              <div className="flex items-center space-x-1">
                                {/* Business Type Selector */}
                                <Select value={currentBusinessType} onValueChange={setCurrentBusinessType}>
                                  <SelectTrigger className="w-40 h-7 text-xs">
                                    <SelectValue placeholder="Select business type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {selectedBusinessTypes.map((typeId) => {
                                      const type = businessTypes.find(t => t.id === typeId);
                                      return type ? (
                                        <SelectItem key={typeId} value={typeId}>
                                          {type.name} ({businesses[typeId]?.length || 0})
                                        </SelectItem>
                                      ) : null;
                                    })}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pb-4">
                          {selectedBusinessTypes.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                              <Users className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                              <p className="text-sm">Please select at least one business type to configure business details.</p>
                            </div>
                          ) : (
                            <>
                              {selectedBusinessTypes.length === 1 && (
                                // Auto-select the only business type
                                (() => {
                                  const businessType = selectedBusinessTypes[0];
                                  if (currentBusinessType !== businessType) {
                                    setCurrentBusinessType(businessType);
                                  }
                                  return null;
                                })()
                              )}

                              {currentBusinessType && businesses[currentBusinessType] && (
                                <div className="space-y-4">
                                  {/* Business Instance Selector */}
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                      {businesses[currentBusinessType].length > 1 && (
                                        <Select
                                          value={(currentBusinessIndex[currentBusinessType] || 0).toString()}
                                          onValueChange={(value) => setCurrentBusinessIndex(prev => ({
                                            ...prev,
                                            [currentBusinessType]: parseInt(value)
                                          }))}
                                        >
                                          <SelectTrigger className="w-32 h-7 text-xs">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {businesses[currentBusinessType].map((_, index) => (
                                              <SelectItem key={index} value={index.toString()}>
                                                Business #{index + 1}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      )}
                                    </div>

                                    <div className="flex items-center space-x-1">
                                      {/* Add Business Button */}
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleAddBusinessToType(currentBusinessType)}
                                        className="h-7 w-7 p-0 bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                        title="Add another business"
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>

                                      {/* Remove Business Button */}
                                      {businesses[currentBusinessType].length > 1 && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleRemoveBusinessFromType(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0)}
                                          className="h-7 w-7 p-0 bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                          title="Remove this business"
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Business Type Header */}
                                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-3 border border-purple-100">
                                    <div className="flex items-center justify-between mb-3">
                                      <h3 className="text-sm font-semibold text-gray-800 flex items-center">
                                        <Settings className="h-4 w-4 text-purple-600 mr-2" />
                                        Business Configuration - {businessTypes.find(t => t.id === currentBusinessType)?.name || currentBusinessType}
                                        {businesses[currentBusinessType].length > 1 && (
                                          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                                            #{(currentBusinessIndex[currentBusinessType] || 0) + 1}
                                          </span>
                                        )}
                                      </h3>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                      {/* Account Details */}
                                      <div className="space-y-3">
                                        <div className="space-y-1">
                                          <Label className="text-xs font-semibold text-gray-700">Account Name</Label>
                                          <Input
                                            value={businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountName || ""}
                                            onChange={(e) => {
                                              handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "accountName", e.target.value);
                                              if (showValidation) {
                                                validateField('accountName', e.target.value, currentBusinessType, currentBusinessIndex[currentBusinessType] || 0);
                                              }
                                            }}
                                            onBlur={() => {
                                              if (showValidation) {
                                                const value = businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountName || "";
                                                validateField('accountName', value, currentBusinessType, currentBusinessIndex[currentBusinessType] || 0);
                                              }
                                            }}
                                            placeholder="Enter business account name"
                                            className={cn(
                                              "h-8 text-xs border-gray-300 focus:border-purple-500 focus:ring-1 focus:ring-purple-500",
                                              errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountName && showValidation
                                                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                : ""
                                            )}
                                          />
                                          {errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountName && showValidation && (
                                            <div className="flex items-center space-x-1 text-red-600">
                                              <AlertCircle className="h-3 w-3" />
                                              <span className="text-xs">{errors.businesses[currentBusinessType][currentBusinessIndex[currentBusinessType] || 0].accountName}</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="space-y-1">
                                          <Label className="text-xs font-semibold text-gray-700">Account Phone</Label>
                                          <Input
                                            value={businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountPhone || ""}
                                            onChange={(e) => {
                                              handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "accountPhone", e.target.value);
                                              if (showValidation) {
                                                validateField('accountPhone', e.target.value, currentBusinessType, currentBusinessIndex[currentBusinessType] || 0);
                                              }
                                            }}
                                            onBlur={() => {
                                              if (showValidation) {
                                                const value = businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountPhone || "";
                                                validateField('accountPhone', value, currentBusinessType, currentBusinessIndex[currentBusinessType] || 0);
                                              }
                                            }}
                                            placeholder="Enter contact phone number"
                                            className={cn(
                                              "h-8 text-xs border-gray-300 focus:border-purple-500 focus:ring-1 focus:ring-purple-500",
                                              errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountPhone && showValidation
                                                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                : ""
                                            )}
                                          />
                                          {errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.accountPhone && showValidation && (
                                            <div className="flex items-center space-x-1 text-red-600">
                                              <AlertCircle className="h-3 w-3" />
                                              <span className="text-xs">{errors.businesses[currentBusinessType][currentBusinessIndex[currentBusinessType] || 0].accountPhone}</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="space-y-1">
                                          <Label className="text-xs font-semibold text-gray-700">Number of Retail Units</Label>
                                          <Input
                                            type="number"
                                            min="1"
                                            max="999"
                                            value={businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailCount || 1}
                                            onChange={(e) => {
                                              const value = parseInt(e.target.value) || 1;
                                              handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "retailCount", value);
                                            }}
                                            className={cn(
                                              "h-8 text-xs border-gray-300 focus:border-purple-500 focus:ring-1 focus:ring-purple-500",
                                              errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailCount && showValidation
                                                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                                                : ""
                                            )}
                                            placeholder="Enter number of retail units"
                                          />
                                          {errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailCount && showValidation && (
                                            <div className="flex items-center space-x-1 text-red-600">
                                              <AlertCircle className="h-3 w-3" />
                                              <span className="text-xs">{errors.businesses[currentBusinessType][currentBusinessIndex[currentBusinessType] || 0].retailCount}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* License Type Selection */}
                                      <div className="space-y-3">
                                        <Label className="text-xs font-semibold text-gray-700">License Application Strategy</Label>
                                        <RadioGroup
                                          value={businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licenseApplicationType || "all"}
                                          onValueChange={(value) => handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "licenseApplicationType", value as "all" | "each")}
                                          className="space-y-2"
                                        >
                                          <div className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licenseApplicationType === "all"
                                            ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                                            : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
                                            }`}
                                            onClick={() => handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "licenseApplicationType", "all")}
                                          >
                                            <div className="flex items-start space-x-2">
                                              <RadioGroupItem
                                                value="all"
                                                id="all-redesign"
                                                className="mt-0.5"
                                              />
                                              <div className="flex-1">
                                                <Label htmlFor="all-redesign" className="text-xs font-medium text-gray-800 cursor-pointer">
                                                  Single License for All Units
                                                </Label>
                                                <p className="text-xs text-gray-600 mt-0.5">
                                                  Apply one license period across all {businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailCount || 1} retail units
                                                </p>
                                              </div>
                                            </div>
                                          </div>

                                          <div className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licenseApplicationType === "each"
                                            ? "border-purple-500 bg-purple-50 ring-1 ring-purple-200"
                                            : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/30"
                                            }`}
                                            onClick={() => handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "licenseApplicationType", "each")}
                                          >
                                            <div className="flex items-start space-x-2">
                                              <RadioGroupItem
                                                value="each"
                                                id="each-redesign"
                                                className="mt-0.5"
                                              />
                                              <div className="flex-1">
                                                <Label htmlFor="each-redesign" className="text-xs font-medium text-gray-800 cursor-pointer">
                                                  Individual Licenses per Unit
                                                </Label>
                                                <p className="text-xs text-gray-600 mt-0.5">
                                                  Set custom license periods for each of the {businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailCount || 1} retail units
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        </RadioGroup>
                                      </div>
                                    </div>
                                  </div>

                                  {/* License Period Section - Only show when "all" is selected */}
                                  {businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licenseApplicationType === "all" && (
                                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                                      <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center">
                                        <CalendarIcon className="h-4 w-4 text-blue-600 mr-2" />
                                        License Period Configuration
                                      </h3>
                                      <div className="space-y-3">
                                        <div className="space-y-1">
                                          <Label className="text-xs font-semibold text-gray-700">Select License Duration</Label>
                                          <Select
                                            value={businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licensePeriod || ""}
                                            onValueChange={(value) => handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "licensePeriod", value)}
                                          >
                                            <SelectTrigger className={cn(
                                              "h-8 text-xs border-gray-300 focus:border-blue-500",
                                              errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licensePeriod && showValidation
                                                ? "border-red-500 focus:border-red-500"
                                                : ""
                                            )}>
                                              <SelectValue placeholder="Choose license period" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="7-days">7 Days</SelectItem>
                                              <SelectItem value="15-days">15 Days</SelectItem>
                                              <SelectItem value="1-month">1 Month</SelectItem>
                                              <SelectItem value="3-months">3 Months</SelectItem>
                                              <SelectItem value="6-months">6 Months</SelectItem>
                                              <SelectItem value="1-year">1 Year</SelectItem>
                                              <SelectItem value="2-years">2 Years</SelectItem>
                                              <SelectItem value="Custom">Custom Date</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          {errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licensePeriod && showValidation && (
                                            <div className="flex items-center space-x-1 text-red-600">
                                              <AlertCircle className="h-3 w-3" />
                                              <span className="text-xs">{errors.businesses[currentBusinessType][currentBusinessIndex[currentBusinessType] || 0].licensePeriod}</span>
                                            </div>
                                          )}
                                        </div>

                                        {/* Custom Date Picker */}
                                        {businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licensePeriod === "Custom" && (
                                          <div className="space-y-1 p-2 bg-white rounded-lg border border-gray-200">
                                            <Label className="text-xs font-semibold text-gray-700">Custom License End Date</Label>
                                            <Popover>
                                              <PopoverTrigger asChild>
                                                <Button
                                                  variant="outline"
                                                  className={cn(
                                                    "w-full justify-start text-left font-normal h-8 text-xs border-gray-300",
                                                    !businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.customEndDate && "text-muted-foreground",
                                                    errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.customEndDate && showValidation
                                                      ? "border-red-500 focus:border-red-500"
                                                      : ""
                                                  )}
                                                >
                                                  <CalendarIcon className="mr-2 h-3 w-3" />
                                                  {businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.customEndDate ? (
                                                    format(businesses[currentBusinessType][currentBusinessIndex[currentBusinessType] || 0].customEndDate!, "PPP")
                                                  ) : (
                                                    <span>Select custom end date</span>
                                                  )}
                                                </Button>
                                              </PopoverTrigger>
                                              <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                  mode="single"
                                                  selected={businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.customEndDate}
                                                  onSelect={(date) => handleBusinessChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, "customEndDate", date)}
                                                  disabled={(date) => date < new Date()}
                                                  initialFocus
                                                />
                                              </PopoverContent>
                                            </Popover>
                                            {errors.businesses?.[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.customEndDate && showValidation && (
                                              <div className="flex items-center space-x-1 text-red-600">
                                                <AlertCircle className="h-3 w-3" />
                                                <span className="text-xs">{errors.businesses[currentBusinessType][currentBusinessIndex[currentBusinessType] || 0].customEndDate}</span>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Individual Retail Unit License Periods */}
                                  {businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.licenseApplicationType === "each" && (
                                    <div className="space-y-3 mt-4">
                                      <Label className="text-sm font-medium text-gray-700">License Period for Each Retail Unit:</Label>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                                        {Array.from({ length: businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailCount || 1 }, (_, index) => {
                                          const retailUnit = businesses[currentBusinessType]?.[currentBusinessIndex[currentBusinessType] || 0]?.retailUnitPeriods?.[index] || { period: "", customEndDate: undefined };
                                          return (
                                            <div key={index} className="space-y-2 p-2 border border-gray-200 rounded-lg bg-white">
                                              <Label className="text-xs font-semibold text-gray-700 flex items-center">
                                                <span className="w-4 h-4 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-xs font-bold mr-1">
                                                  {index + 1}
                                                </span>
                                                Unit #{index + 1}
                                              </Label>
                                              <Select
                                                value={retailUnit.period}
                                                onValueChange={(value) => handleRetailUnitPeriodChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, index, value)}
                                              >
                                                <SelectTrigger className="h-7 text-xs border-gray-200">
                                                  <SelectValue placeholder="--Select--" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="7-days">7 Days</SelectItem>
                                                  <SelectItem value="15-days">15 Days</SelectItem>
                                                  <SelectItem value="3-months">3 Months</SelectItem>
                                                  <SelectItem value="6-months">6 Months</SelectItem>
                                                  <SelectItem value="1-year">1 Year</SelectItem>
                                                  <SelectItem value="2-years">2 Years</SelectItem>
                                                  <SelectItem value="Custom">Custom</SelectItem>
                                                </SelectContent>
                                              </Select>

                                              {/* Custom Date Picker for Each Retail Unit */}
                                              {retailUnit.period === "Custom" && (
                                                <div className="space-y-1">
                                                  <Label className="text-xs font-medium text-gray-700">End Date</Label>
                                                  <Popover>
                                                    <PopoverTrigger asChild>
                                                      <Button
                                                        variant="outline"
                                                        className={cn(
                                                          "w-full justify-start text-left font-normal h-7 text-xs",
                                                          !retailUnit.customEndDate && "text-muted-foreground"
                                                        )}
                                                      >
                                                        <CalendarIcon className="mr-1 h-3 w-3" />
                                                        {retailUnit.customEndDate ? (
                                                          format(retailUnit.customEndDate, "MMM dd, yyyy")
                                                        ) : (
                                                          <span>Pick date</span>
                                                        )}
                                                      </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0">
                                                      <Calendar
                                                        mode="single"
                                                        selected={retailUnit.customEndDate}
                                                        onSelect={(date) => handleRetailUnitDateChange(currentBusinessType, currentBusinessIndex[currentBusinessType] || 0, index, date)}
                                                        disabled={(date) => date < new Date()}
                                                        initialFocus
                                                      />
                                                    </PopoverContent>
                                                  </Popover>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>
              )}

              {activeView === 'management' && (
                <CustomerManagementView />
              )}

              {activeView === 'expire' && (
                <LicenseExpireView />
              )}

              {activeView === 'invoice' && (
                <div className="h-full overflow-auto">
                  <InvoiceGenerator />
                </div>
              )}
            </main>

            {/* Compact Footer */}
            <footer className="bg-white/50 backdrop-blur-sm border-t border-gray-100 flex-shrink-0">
              <div className="max-w-7xl mx-auto px-4 py-2">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <p>© 2025 License Management System</p>
                  <div className="flex items-center space-x-4">
                    <span>Version 1.0.0</span>
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-green-600">Operational</span>
                    </div>
                  </div>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </div >
    </>
  );
}
