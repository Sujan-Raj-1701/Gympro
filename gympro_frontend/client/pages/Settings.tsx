import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, 
  Save,
  Printer,
  Bluetooth,
  Search,
  Loader2,
  Settings as SettingsIcon
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiService, DataService } from "@/services";
import { API_BASE_URL } from "@/services/apiService";

// Extend Navigator interface to include Bluetooth API
declare global {
  interface Navigator {
    bluetooth?: {
      requestDevice(options: {
        filters?: Array<{
          services?: string[];
          namePrefix?: string;
        }>;
        optionalServices?: string[];
      }): Promise<BluetoothDevice>;
    };
  }

  interface BluetoothDevice {
    id: string;
    name?: string;
    gatt: BluetoothRemoteGATTServer;
    addEventListener(event: 'gattserverdisconnected', handler: () => void): void;
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
  }
}

interface SettingCategory {
  id: string;
  title: string;
  icon: any;
}

const settingCategories: SettingCategory[] = [
  {
    id: "company",
    title: "Company Profile",
    icon: Building2,
  },
  {
    id: "printer",
    title: "Printer Settings",
    icon: Printer,
  },
  {
    id: "billingui",
    title: "Billing UI",
    icon: SettingsIcon,
  }
];

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();

  const validCategoryIds = useMemo(
    () => new Set(settingCategories.map((c) => c.id)),
    []
  );

  const normalizeCategory = (value: string | null | undefined) => {
    if (!value) return null;
    return validCategoryIds.has(value) ? value : null;
  };

  const SETTINGS_TAB_STORAGE_KEY = "settings_active_tab";

  const getInitialCategory = () => {
    const urlValue = normalizeCategory(
      new URLSearchParams(window.location.search).get("tab")
    );
    if (urlValue) return urlValue;

    try {
      const storedValue = normalizeCategory(
        localStorage.getItem(SETTINGS_TAB_STORAGE_KEY)
      );
      if (storedValue) return storedValue;
    } catch {
      // ignore
    }

    return "company";
  };

  const [activeCategory, setActiveCategory] = useState(getInitialCategory);
  const [companyData, setCompanyData] = useState({
    name: "",
    address: "",
    phone: "",
    altPhone: "",
    email: "",
    gstin: "",
    logoUrl: "",
    currency: "INR",
    theme: "light",
    language: "en"
  });
  
  const [printerData, setPrinterData] = useState({
    receiptPrinter: "",
    paperSize: "80mm",
    printLogo: true,
    printHeader: true,
    printFooter: true,
    footerText: "Thank you for visiting!",
    copies: 1
  });
  
  const [printerState, setPrinterState] = useState({
    isBluetoothScanning: false,
    isWiredScanning: false,
    availablePrinters: [],
    isBluetoothSupported: false,
    isWiredSupported: false,
    connectedPrinters: new Set()
  });
  const { user } = useAuth();
  const { toast } = useToast();

  const normalizeBillingUIMode = (value: any): "touch" | "type" => {
    const s = String(value ?? "").trim().toLowerCase();
    return s === "type" ? "type" : "touch";
  };

  const [billingUIMode, setBillingUIMode] = useState<"touch" | "type">("touch");
  const [sendWhatsAppOnBill, setSendWhatsAppOnBill] = useState(false);
    const [invoiceWhatsAppTemplateItems, setInvoiceWhatsAppTemplateItems] = useState<any[]>([]);
    const [invoiceWhatsAppTemplateLoading, setInvoiceWhatsAppTemplateLoading] = useState(false);
    const [invoiceWhatsAppTemplateMessageId, setInvoiceWhatsAppTemplateMessageId] = useState<string>("");

    const normalizedInvoiceTemplateMessageId = useMemo(() => {
      const v = String(invoiceWhatsAppTemplateMessageId ?? "").trim();
      if (!v) return "";
      if (v === "0") return "";
      return v;
    }, [invoiceWhatsAppTemplateMessageId]);

    const isInvoiceTemplateMissing = sendWhatsAppOnBill && normalizedInvoiceTemplateMessageId === "";

    const selectedInvoiceWhatsAppTemplate = useMemo(() => {
      const want = String(normalizedInvoiceTemplateMessageId || "").trim();
      if (!want) return null;
      return (
        invoiceWhatsAppTemplateItems.find((t: any) => String(t?.message_id ?? t?.messageId ?? t?.MessageId ?? "").trim() === want) ||
        null
      );
    }, [invoiceWhatsAppTemplateItems, normalizedInvoiceTemplateMessageId]);
  const [enableServiceOnBilling, setEnableServiceOnBilling] = useState(true);
  const [enablePackagesOnBilling, setEnablePackagesOnBilling] = useState(true);
  const [enableInventoryOnBilling, setEnableInventoryOnBilling] = useState(true);
  const [accountMasterRow, setAccountMasterRow] = useState<any | null>(null);

  const parseYNFlag = (value: any, defaultValue: boolean) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    const s = String(value).trim().toLowerCase();
    if (["y", "yes", "true", "1", "on", "enabled"].includes(s)) return true;
    if (["n", "no", "false", "0", "off", "disabled"].includes(s)) return false;
    return defaultValue;
  };

  // localStorage utility functions for printer sessions (both Bluetooth and wired)
  const savePrinterSessions = (printers: any[]) => {
    try {
      const sessions = printers.map(p => ({
        id: p.id,
        name: p.name,
        isConnected: p.isConnected,
        type: p.type, // 'bluetooth' or 'wired'
        vendorId: p.vendorId,
        productId: p.productId,
        port: p.port,
        lastConnected: p.lastConnected || new Date().toISOString()
      }));
      localStorage.setItem('thermal_printer_sessions', JSON.stringify(sessions));
      // Keep old key for backward compatibility
      localStorage.setItem('bluetooth_printer_sessions', JSON.stringify(sessions.filter(s => s.type === 'bluetooth')));
    } catch (error) {
      console.error('Failed to save printer sessions:', error);
    }
  };

  const loadPrinterSessions = () => {
    try {
      // Try new key first
      let saved = localStorage.getItem('thermal_printer_sessions');
      if (saved) {
        return JSON.parse(saved);
      }
      
      // Fallback to old key and migrate
      saved = localStorage.getItem('bluetooth_printer_sessions');
      if (saved) {
        const oldSessions = JSON.parse(saved);
        const migratedSessions = oldSessions.map((session: any) => ({
          ...session,
          type: session.type || 'bluetooth',
          lastConnected: session.lastConnected || new Date().toISOString()
        }));
        // Save to new key
        localStorage.setItem('thermal_printer_sessions', JSON.stringify(migratedSessions));
        return migratedSessions;
      }
      
      return [];
    } catch (error) {
      console.error('Failed to load printer sessions:', error);
      return [];
    }
  };

  const updatePrinterSession = (printerId: string, isConnected: boolean) => {
    const sessions = loadPrinterSessions();
    const updatedSessions = sessions.map((session: any) => 
      session.id === printerId ? { ...session, isConnected, lastConnected: new Date().toISOString() } : session
    );
    localStorage.setItem('thermal_printer_sessions', JSON.stringify(updatedSessions));
    // Keep old key updated for backward compatibility
    const bluetoothSessions = updatedSessions.filter(s => s.type === 'bluetooth');
    localStorage.setItem('bluetooth_printer_sessions', JSON.stringify(bluetoothSessions));
  };

  // Load all Settings data using a single /read call (tables array)
  useEffect(() => {
    const pickTableRows = (data: any, tableName: string) => {
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (typeof data !== "object") return [];

      const direct = (data as any)[tableName];
      if (Array.isArray(direct)) return direct;

      const matchKey = Object.keys(data).find((k) => k.toLowerCase() === tableName.toLowerCase());
      if (matchKey && Array.isArray((data as any)[matchKey])) return (data as any)[matchKey];

      // Legacy shapes
      if (tableName === "retail_master") {
        return (data as any).RetailMaster || (data as any).retail || (data as any).Retail || [];
      }
      if (tableName === "account_master") {
        return (data as any).AccountMaster || [];
      }
      return [];
    };

    const loadSettings = async () => {
      try {
        const accountCode = user?.account_code || "";
        const retailCode = user?.retail_code || "";
        if (!accountCode || !retailCode) return;

        const res: any = await DataService.readData(["retail_master", "account_master"], accountCode, retailCode);
        const data = res?.data ?? null;

        const retailRows = pickTableRows(data, "retail_master");
        const retailRow = Array.isArray(retailRows) ? retailRows[0] : retailRows;
        if (retailRow) {
          const mapped = {
            name:
              retailRow.RetailName ||
              retailRow.retail_name ||
              retailRow.company_name ||
              retailRow.CompanyName ||
              retailRow.org_name ||
              retailRow.OrgName ||
              companyData.name,
            address:
              retailRow.address ||
              retailRow.Address ||
              retailRow.company_address ||
              retailRow.CompanyAddress ||
              retailRow.retail_address ||
              retailRow.RetailAddress ||
              "",
            phone:
              retailRow.phone1 ||
              retailRow.phone ||
              retailRow.Phone ||
              retailRow.phone_number ||
              retailRow.PhoneNumber ||
              retailRow.mobile ||
              retailRow.Mobile ||
              "",
            altPhone:
              retailRow.phone2 ||
              retailRow.alt_phone ||
              retailRow.AltPhone ||
              retailRow.alternate_phone ||
              retailRow.AlternatePhone ||
              "",
            email: retailRow.email || retailRow.Email || "",
            gstin: retailRow.gst_no || retailRow.gstin || retailRow.GSTIN || retailRow.GSTNo || "",
            logoUrl: retailRow.logo || retailRow.Logo || companyData.logoUrl,
            currency: retailRow.currency || retailRow.Currency || companyData.currency,
            theme: companyData.theme,
            language: companyData.language,
          };
          setCompanyData((prev) => ({ ...prev, ...mapped }));
          setRetailMasterRow(retailRow);
          const swVal = retailRow.SendWhatsAppOnBill ?? retailRow.send_whatsapp_on_bill;
          setSendWhatsAppOnBill(
            swVal === 1 || swVal === "1" || swVal === "Y" || swVal === "y"
          );

          const invoiceWaMsgId =
            retailRow.whatsapp_messageid ??
            retailRow.whatsapp_message_id ??
            retailRow.WhatsAppMessageId ??
            retailRow.WhatsApp_MessageId ??
            retailRow.invoice_whatsapp_messageid ??
            retailRow.InvoiceWhatsAppMessageId;
          if (
            invoiceWaMsgId !== null &&
            typeof invoiceWaMsgId !== "undefined" &&
            String(invoiceWaMsgId).trim() !== "" &&
            String(invoiceWaMsgId).trim() !== "0"
          ) {
            setInvoiceWhatsAppTemplateMessageId(String(invoiceWaMsgId));
          } else {
            setInvoiceWhatsAppTemplateMessageId("");
          }

          // Billing feature flags (retail_master)
          setEnableServiceOnBilling(
            parseYNFlag(
              retailRow.enable_services_onbilling ??
                retailRow.enable_service_onbilling ??
                retailRow.EnableServicesOnBilling ??
                retailRow.EnableServiceOnBilling ??
                retailRow.enableServicesOnBilling ??
                retailRow.enableServiceOnBilling,
              true
            )
          );
          setEnablePackagesOnBilling(
            parseYNFlag(
              retailRow.enable_packages_onbilling ?? retailRow.EnablePackagesOnBilling ?? retailRow.enablePackagesOnBilling,
              true
            )
          );
          setEnableInventoryOnBilling(
            parseYNFlag(
              retailRow.enable_inventory_onbilling ?? retailRow.EnableInventoryOnBilling ?? retailRow.enableInventoryOnBilling,
              true
            )
          );
        }

        const accountRows = pickTableRows(data, "account_master");
        const accountRow = Array.isArray(accountRows) ? accountRows[0] : accountRows;
        if (accountRow) {
          setAccountMasterRow(accountRow);
          setBillingUIMode(
            normalizeBillingUIMode(accountRow.BillingUI ?? accountRow.billingui ?? accountRow.billing_ui)
          );
        }
      } catch (e) {
        console.error("Failed to load settings tables:", e);
      }
    };

    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const loadInvoiceWhatsAppTemplates = async () => {
      if (!sendWhatsAppOnBill) return;
      if (invoiceWhatsAppTemplateItems.length > 0) return;

      setInvoiceWhatsAppTemplateLoading(true);
      try {
        const resp: any = await ApiService.get(`/whatsapp-templates?status=ACTIVE&category_code=0006`);
        const items = resp?.items ?? resp?.data?.items ?? [];
        setInvoiceWhatsAppTemplateItems(Array.isArray(items) ? items : []);
      } catch (e) {
        console.error("Failed to load WhatsApp templates:", e);
        setInvoiceWhatsAppTemplateItems([]);
      } finally {
        setInvoiceWhatsAppTemplateLoading(false);
      }
    };

    loadInvoiceWhatsAppTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendWhatsAppOnBill]);

  const [retailMasterRow, setRetailMasterRow] = useState<any | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const persistActiveCategory = (category: string) => {
    try {
      localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, category);
    } catch {
      // ignore
    }
  };

  const setTabQueryParam = (category: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", category);
        return next;
      },
      { replace: true }
    );
  };

  const handleTabChange = (category: string) => {
    const normalized = normalizeCategory(category) ?? "company";
    setActiveCategory(normalized);
    persistActiveCategory(normalized);
    setTabQueryParam(normalized);
  };

  // Keep state in sync with URL (supports refresh/back/forward).
  useEffect(() => {
    const urlCategory = normalizeCategory(searchParams.get("tab"));

    if (!urlCategory) {
      setTabQueryParam(activeCategory);
      return;
    }

    if (urlCategory !== activeCategory) {
      setActiveCategory(urlCategory);
      persistActiveCategory(urlCategory);
    }
  }, [searchParams, activeCategory]);

  // Check both Bluetooth and Web Serial support, and load sessions on component mount
  useEffect(() => {
    const checkPrinterSupport = async () => {
      let bluetoothSupported = false;
      let wiredSupported = false;
      
      if ('bluetooth' in navigator) {
        bluetoothSupported = true;
      } else {
        console.log('Bluetooth not supported in this browser');
      }
      
      if ('serial' in navigator) {
        wiredSupported = true;
      } else {
        console.log('Web Serial API not supported in this browser');
      }
      
      setPrinterState(prev => ({ 
        ...prev, 
        isBluetoothSupported: bluetoothSupported,
        isWiredSupported: wiredSupported
      }));
    };
    
    const loadSavedSessions = () => {
      const savedPrinters = loadPrinterSessions();
      if (savedPrinters.length > 0) {
        // Convert saved sessions to printer objects.
        // Always start as disconnected because Bluetooth links
        // are not guaranteed to survive tab changes.
        const sessionPrinters = savedPrinters.map((session: any) => ({
          id: session.id,
          name: session.name,
          type: session.type,
          device: null,
          isConnected: false,
          lastConnected: session.lastConnected
        }));

        setPrinterState(prev => ({
          ...prev,
          availablePrinters: sessionPrinters,
          connectedPrinters: new Set()
        }));
      }
    };

    checkPrinterSupport();
    loadSavedSessions();
  }, []);

  const scanBluetoothPrinters = async () => {
    if (!printerState.isBluetoothSupported) {
      toast({ 
        title: "Bluetooth Not Supported", 
        description: "Your browser doesn't support Bluetooth connectivity.", 
        variant: "destructive" 
      });
      return;
    }

    setPrinterState(prev => ({ ...prev, isBluetoothScanning: true }));
    
    try {
      // Request Bluetooth device with more comprehensive printer services
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ['000018f0-0000-1000-8000-00805f9b34fb'] }, // Standard printer service
          { services: ['49535343-fe7d-4ae5-8fa9-9fafd205e455'] }, // HM-10 service
          { services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }, // Nordic UART service
          { namePrefix: 'Printer' },
          { namePrefix: 'POS' },
          { namePrefix: 'Receipt' },
          { namePrefix: 'Thermal' },
          { namePrefix: 'MPT' },
          { namePrefix: 'BT' },
          { namePrefix: 'ESP32' }
        ],
        optionalServices: [
          'generic_access', 
          'generic_attribute',
          '000018f0-0000-1000-8000-00805f9b34fb',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
        ]
      });

      if (device) {
        // Check if device already exists to prevent duplicates
        const existingPrinter = printerState.availablePrinters.find(p => p.id === device.id);
        
        if (existingPrinter) {
          // Update existing printer with new device reference
          setPrinterState(prev => ({
            ...prev,
            availablePrinters: prev.availablePrinters.map(p => 
              p.id === device.id ? { ...p, device: device } : p
            )
          }));
          
          toast({ 
            title: "Printer Already Added", 
            description: `${existingPrinter.name} is already in your printer list`,
            className: "bg-yellow-50 border-yellow-200 text-yellow-800" 
          });
          return;
        }

        // Add disconnect event listener
        device.addEventListener('gattserverdisconnected', () => {
          setPrinterState(prev => {
            const newConnectedPrinters = new Set(prev.connectedPrinters);
            newConnectedPrinters.delete(device.id);
            
            const updatedPrinters = prev.availablePrinters.map(p => 
              p.id === device.id ? { ...p, isConnected: false } : p
            );
            
            // Update localStorage
            updatePrinterSession(device.id, false);
            
            return {
              ...prev,
              connectedPrinters: newConnectedPrinters,
              availablePrinters: updatedPrinters
            };
          });
        });

        const newPrinter = {
          id: device.id,
          name: device.name || 'Unknown Printer',
          type: 'bluetooth',
          device: device,
          isConnected: false
        };
        
        setPrinterState(prev => {
          const updatedPrinters = [...prev.availablePrinters, newPrinter];
          // Save to localStorage
          savePrinterSessions(updatedPrinters);
          
          return {
            ...prev,
            availablePrinters: updatedPrinters
          };
        });
        
        toast({ 
          title: "Printer Found", 
          description: `Found printer: ${newPrinter.name}` 
        });
      }
    } catch (error) {
      console.error('Bluetooth scan error:', error);
      if (error.name === 'NotFoundError') {
        toast({ 
          title: "No Printers Found", 
          description: "No Bluetooth printers were found nearby.", 
          className: "bg-yellow-50 border-yellow-200 text-yellow-800" 
        });
      } else {
        toast({ 
          title: "Scan Failed", 
          description: error.message || "Failed to scan for Bluetooth printers.", 
          variant: "destructive" 
        });
      }
    } finally {
      setPrinterState(prev => ({ ...prev, isBluetoothScanning: false }));
    }
  };

  const connectPrinter = async (printerId: string) => {
    const printer = printerState.availablePrinters.find(p => p.id === printerId);
    if (!printer) {
      toast({ 
        title: "Printer Not Found", 
        description: "Please scan for printers first.", 
        variant: "destructive" 
      });
      return;
    }
    
    if (!printer.device) {
      toast({ 
        title: "Device Reference Lost", 
        description: "Please scan for this printer again to reconnect.", 
        variant: "destructive" 
      });
      return;
    }

    try {
      if (!printer.device.gatt.connected) {
        await printer.device.gatt.connect();
      }
      
      setPrinterState(prev => {
        const updatedPrinters = prev.availablePrinters.map(p => 
          p.id === printerId ? { ...p, isConnected: true } : p
        );
        
        // Save to localStorage
        savePrinterSessions(updatedPrinters);
        updatePrinterSession(printerId, true);
        
        return {
          ...prev,
          connectedPrinters: new Set([...prev.connectedPrinters, printerId]),
          availablePrinters: updatedPrinters
        };
      });
      
      toast({ 
        title: "Printer Connected", 
        description: `${printer.name} is now connected` 
      });
    } catch (error) {
      console.error('Connection failed:', error);
      toast({ 
        title: "Connection Failed", 
        description: `Failed to connect to ${printer.name}`, 
        variant: "destructive" 
      });
    }
  };

  const disconnectPrinter = async (printerId: string) => {
    const printer = printerState.availablePrinters.find(p => p.id === printerId);
    if (!printer) return;

    try {
      if (printer.device && printer.device.gatt.connected) {
        printer.device.gatt.disconnect();
      }
      
      setPrinterState(prev => {
        const newConnectedPrinters = new Set(prev.connectedPrinters);
        newConnectedPrinters.delete(printerId);
        
        const updatedPrinters = prev.availablePrinters.map(p => 
          p.id === printerId ? { ...p, isConnected: false } : p
        );
        
        // Save to localStorage
        savePrinterSessions(updatedPrinters);
        updatePrinterSession(printerId, false);
        
        return {
          ...prev,
          connectedPrinters: newConnectedPrinters,
          availablePrinters: updatedPrinters
        };
      });
      
      toast({ 
        title: "Printer Disconnected", 
        description: `${printer.name} has been disconnected`,
        className: "bg-yellow-50 border-yellow-200 text-yellow-800" 
      });
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  const selectPrinter = (printerId: string, printerType: 'receipt') => {
    const printer = printerState.availablePrinters.find(p => p.id === printerId);
    if (printer) {
      setPrinterData(prev => ({ ...prev, receiptPrinter: printer.name }));
      toast({ 
        title: "Printer Selected", 
        description: `${printer.name} selected as ${printerType} printer` 
      });
    }
  };

  const clearAllPrinters = () => {
    // Disconnect all connected printers first
    printerState.availablePrinters.forEach(printer => {
      if (printer.isConnected && printer.device) {
        try {
          if (printer.type === 'bluetooth') {
            printer.device.gatt.disconnect();
          }
          // For wired printers, we don't need to disconnect as they don't maintain persistent connections
        } catch (error) {
          console.error(`Failed to disconnect ${printer.name}:`, error);
        }
      }
    });

    // Clear state and localStorage
    setPrinterState(prev => ({
      ...prev,
      availablePrinters: [],
      connectedPrinters: new Set()
    }));
    
    localStorage.removeItem('thermal_printer_sessions');
    localStorage.removeItem('bluetooth_printer_sessions'); // Keep for backward compatibility
    
    toast({ 
      title: "Printers Cleared", 
      description: "All printer sessions have been cleared",
      className: "bg-blue-50 border-blue-200 text-blue-800" 
    });
  };

  // Wired printer scanning functions
  const scanWiredPrinters = async () => {
    if (!printerState.isWiredSupported) {
      toast({
        title: "Web Serial Not Supported",
        description: "Your browser doesn't support Web Serial API for wired printer detection.",
        variant: "destructive"
      });
      return;
    }

    setPrinterState(prev => ({ ...prev, isWiredScanning: true }));

    try {
      // First check for existing saved ports
      const savedPorts = await (navigator as any).serial.getPorts();
      const thermalVendorIds = [0x04B8, 0x0483, 0x067B, 0x1A86, 0x0403, 0x10C4, 0x0519, 0x0B00];
      
      let foundPorts = savedPorts.filter((port: any) => {
        const info = port.getInfo();
        return thermalVendorIds.includes(info.usbVendorId);
      });

      // If no saved thermal printers, prompt user to select
      if (foundPorts.length === 0) {
        try {
          const port = await (navigator as any).serial.requestPort({
            filters: thermalVendorIds.map(id => ({ usbVendorId: id }))
          });
          
          if (port) {
            foundPorts = [port];
          }
        } catch (err: any) {
          if (err.name === 'NotFoundError') {
            toast({
              title: "No Thermal Printers Found",
              description: "No compatible wired thermal printers were detected. Make sure your printer is connected via USB and powered on.",
              className: "bg-yellow-50 border-yellow-200 text-yellow-800"
            });
          } else {
            toast({
              title: "Scan Cancelled",
              description: "Wired printer scan was cancelled by user.",
              className: "bg-yellow-50 border-yellow-200 text-yellow-800"
            });
          }
          return;
        }
      }

      // Process found ports
      let addedCount = 0;
      for (const port of foundPorts) {
        const info = port.getInfo();
        const portId = `wired_${info.usbVendorId}_${info.usbProductId}_${Date.now()}`;
        
        // Check if this port is already added
        const existingPrinter = printerState.availablePrinters.find(p => 
          p.type === 'wired' && p.vendorId === info.usbVendorId && p.productId === info.usbProductId
        );
        
        if (existingPrinter) {
          continue; // Skip if already exists
        }

        // Create a descriptive name based on vendor ID
        let printerName = 'Unknown Thermal Printer';
        switch (info.usbVendorId) {
          case 0x04B8: printerName = 'Epson Thermal Printer'; break;
          case 0x0483: printerName = 'STMicroelectronics Thermal Printer'; break;
          case 0x067B: printerName = 'Prolific USB-Serial Printer'; break;
          case 0x1A86: printerName = 'CH340 USB-Serial Printer'; break;
          case 0x0403: printerName = 'FTDI USB-Serial Printer'; break;
          case 0x10C4: printerName = 'Silicon Labs USB-Serial Printer'; break;
          case 0x0519: printerName = 'Star Micronics Thermal Printer'; break;
          case 0x0B00: printerName = 'Generic Thermal Printer'; break;
        }

        const newPrinter = {
          id: portId,
          name: printerName,
          type: 'wired',
          port: port,
          vendorId: info.usbVendorId,
          productId: info.usbProductId,
          isConnected: false,
          device: null
        };

        setPrinterState(prev => {
          const updatedPrinters = [...prev.availablePrinters, newPrinter];
          savePrinterSessions(updatedPrinters);
          return {
            ...prev,
            availablePrinters: updatedPrinters
          };
        });

        addedCount++;
      }

      if (addedCount > 0) {
        toast({
          title: "Wired Printers Found",
          description: `Found ${addedCount} wired thermal printer${addedCount > 1 ? 's' : ''}.`
        });
      } else {
        toast({
          title: "No New Printers",
          description: "All detected printers are already in your list.",
          className: "bg-yellow-50 border-yellow-200 text-yellow-800"
        });
      }

    } catch (error: any) {
      console.error('Wired printer scan error:', error);
      toast({
        title: "Scan Failed",
        description: `Failed to scan for wired printers: ${error.message}`,
        variant: "destructive"
      });
    } finally {
      setPrinterState(prev => ({ ...prev, isWiredScanning: false }));
    }
  };

  const testWiredPrinter = async (printerId: string) => {
    const printer = printerState.availablePrinters.find(p => p.id === printerId && p.type === 'wired');
    if (!printer || !printer.port) {
      toast({
        title: "Printer Not Found",
        description: "Wired printer port not available. Please scan again.",
        variant: "destructive"
      });
      return;
    }

    try {
      // Test connection with different baud rates
      const baudRates = [9600, 19200, 38400, 115200];
      let connected = false;

      for (const baudRate of baudRates) {
        try {
          await printer.port.open({
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
          });
          connected = true;

          // Send a simple test command (initialize + line feed)
          const testData = new Uint8Array([0x1B, 0x40, 0x0A]); // ESC @ (initialize) + LF
          const writer = printer.port.writable.getWriter();
          await writer.write(testData);
          writer.releaseLock();

          await printer.port.close();
          
          // Update printer status
          setPrinterState(prev => {
            const updatedPrinters = prev.availablePrinters.map(p =>
              p.id === printerId ? { ...p, isConnected: true, lastConnected: new Date().toISOString() } : p
            );
            savePrinterSessions(updatedPrinters);
            updatePrinterSession(printerId, true);
            return {
              ...prev,
              availablePrinters: updatedPrinters,
              connectedPrinters: new Set([...prev.connectedPrinters, printerId])
            };
          });

          toast({
            title: "Test Successful",
            description: `${printer.name} is working properly at ${baudRate} baud.`,
            className: "bg-green-50 border-green-200 text-green-800"
          });
          
          return;
        } catch (error) {
          if (connected) {
            try { await printer.port.close(); } catch {} // Cleanup on error
          }
          continue; // Try next baud rate
        }
      }

      // If we get here, all baud rates failed
      toast({
        title: "Test Failed",
        description: `Cannot communicate with ${printer.name}. Check if the printer is powered on and try again.`,
        variant: "destructive"
      });

    } catch (error: any) {
      console.error('Wired printer test error:', error);
      toast({
        title: "Test Error",
        description: `Failed to test printer: ${error.message}`,
        variant: "destructive"
      });
    }
  };

  // ESC/POS command generator for thermal printers
  const generateEscPosCommands = (content: string) => {
    const ESC = 0x1B;
    const GS = 0x1D;
    
    const commands = [];
    
    // Initialize printer
    commands.push(ESC, 0x40); // ESC @ - Initialize printer
    
    // Center align
    commands.push(ESC, 0x61, 0x01); // ESC a 1 - Center alignment
    
    // Bold text for company name
    commands.push(ESC, 0x45, 0x01); // ESC E 1 - Bold on
    
    // Add company name
    const companyName = companyData.name || 'Test Company';
    const companyBytes = new TextEncoder().encode(companyName + '\n');
    commands.push(...Array.from(companyBytes));
    
    // Add separator line
    const separator = '================================\n';
    const separatorBytes = new TextEncoder().encode(separator);
    commands.push(...Array.from(separatorBytes));
    
    // Turn off bold
    commands.push(ESC, 0x45, 0x00); // ESC E 0 - Bold off
    
    // Add test print message
    const testMsg = 'TEST PRINT SUCCESSFUL\n\n';
    const testBytes = new TextEncoder().encode(testMsg);
    commands.push(...Array.from(testBytes));
    
    // Left align for details
    commands.push(ESC, 0x61, 0x00); // ESC a 0 - Left alignment
    
    // Add date and time
    const dateTime = `Date: ${new Date().toLocaleDateString()}\nTime: ${new Date().toLocaleTimeString()}\n\n`;
    const dateBytes = new TextEncoder().encode(dateTime);
    commands.push(...Array.from(dateBytes));
    
    // Add printer info
    const printerInfo = `Printer: ${printerState.availablePrinters.find(p => p.isConnected)?.name || 'Unknown'}\nStatus: Connected & Working\n\n`;
    const printerBytes = new TextEncoder().encode(printerInfo);
    commands.push(...Array.from(printerBytes));
    
    // Center align for separator
    commands.push(ESC, 0x61, 0x01); // ESC a 1 - Center alignment
    commands.push(...Array.from(separatorBytes));
    
    // Add footer if enabled
    if (printerData.printFooter && printerData.footerText) {
      const footerBytes = new TextEncoder().encode(printerData.footerText + '\n');
      commands.push(...Array.from(footerBytes));
    }
    
    // Feed lines and cut paper
    commands.push(0x0A, 0x0A, 0x0A); // Line feeds
    commands.push(GS, 0x56, 0x00); // GS V 0 - Cut paper
    
    return new Uint8Array(commands);
  };

  const testPrint = async () => {
    // Try to find a connected printer
    const connectedPrinter = printerState.availablePrinters.find(p => p.isConnected);
    
    if (!connectedPrinter) {
      toast({ 
        title: "No Printer Connected", 
        description: "Please connect a printer first to test printing.", 
        variant: "destructive" 
      });
      return;
    }

    if (!connectedPrinter.device || !connectedPrinter.device.gatt.connected) {
      toast({ 
        title: "Printer Not Connected", 
        description: "Printer connection lost. Please reconnect and try again.", 
        variant: "destructive" 
      });
      return;
    }

    try {
      // Generate ESC/POS commands for thermal printer
      const printData = generateEscPosCommands('test');
      
      // Try different service UUIDs commonly used by thermal printers
      const serviceUUIDs = [
        '000018f0-0000-1000-8000-00805f9b34fb', // Common thermal printer service
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Another common service
        '6e400001-b5a3-f393-e0a9-e50e24dcca9e'  // Nordic UART service
      ];
      
      const characteristicUUIDs = [
        '00002af1-0000-1000-8000-00805f9b34fb', // Write characteristic
        '49535343-8841-43f4-a8d4-ecbe34729bb3', // Write characteristic
        '6e400002-b5a3-f393-e0a9-e50e24dcca9e'  // TX characteristic
      ];

      let printed = false;
      
      for (const serviceUUID of serviceUUIDs) {
        if (printed) break;
        
        try {
          const service = await connectedPrinter.device.gatt.getPrimaryService(serviceUUID);
          
          for (const charUUID of characteristicUUIDs) {
            try {
              const characteristic = await service.getCharacteristic(charUUID);
              
              // Check if characteristic supports write
              if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
                // Send data in chunks (thermal printers often have MTU limitations)
                const chunkSize = 20; // Conservative chunk size
                for (let i = 0; i < printData.length; i += chunkSize) {
                  const chunk = printData.slice(i, i + chunkSize);
                  
                  if (characteristic.properties.writeWithoutResponse) {
                    await characteristic.writeValueWithoutResponse(chunk);
                  } else {
                    await characteristic.writeValue(chunk);
                  }
                  
                  // Small delay between chunks
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                printed = true;
                
                toast({ 
                  title: "Test Print Sent", 
                  description: `Test print sent to ${connectedPrinter.name}`,
                  className: "bg-green-50 border-green-200 text-green-800" 
                });
                
                break;
              }
            } catch (charError) {
              console.log(`Characteristic ${charUUID} not available:`, charError);
              continue;
            }
          }
        } catch (serviceError) {
          console.log(`Service ${serviceUUID} not available:`, serviceError);
          continue;
        }
      }
      
      if (!printed) {
        // Fallback: try to send as raw text to any writable characteristic
        try {
          const services = await connectedPrinter.device.gatt.getPrimaryServices();
          
          for (const service of services) {
            if (printed) break;
            
            try {
              const characteristics = await service.getCharacteristics();
              
              for (const char of characteristics) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                  // Send simple text version
                  const simpleText = `${companyData.name || 'Test Company'}\nTEST PRINT SUCCESSFUL\n${new Date().toLocaleString()}\n\n\n`;
                  const textData = new TextEncoder().encode(simpleText);
                  
                  if (char.properties.writeWithoutResponse) {
                    await char.writeValueWithoutResponse(textData);
                  } else {
                    await char.writeValue(textData);
                  }
                  
                  printed = true;
                  
                  toast({ 
                    title: "Test Print Sent (Simple)", 
                    description: `Simple text sent to ${connectedPrinter.name}`,
                    className: "bg-green-50 border-green-200 text-green-800" 
                  });
                  
                  break;
                }
              }
            } catch (charError) {
              console.log('Error getting characteristics:', charError);
            }
          }
        } catch (fallbackError) {
          console.error('Fallback print failed:', fallbackError);
        }
      }
      
      if (!printed) {
        throw new Error('Could not find writable characteristic for printing');
      }

    } catch (error) {
      console.error('Test print failed:', error);
      toast({ 
        title: "Test Print Failed", 
        description: error.message || "Failed to send test print. Make sure printer is properly connected.", 
        variant: "destructive" 
      });
    }
  };

  const renderPrinterSettings = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1.5">
        <h2 className="text-lg font-semibold text-slate-900">Printer Settings</h2>
      </div>
      <Card className="pt-3 shadow-sm">
        <CardContent className="space-y-3">
          {/* Bluetooth Scanner Section */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bluetooth className="h-5 w-5 text-blue-600" />
                <span className="font-medium text-blue-900">Bluetooth Printer Scanner</span>
                {printerState.availablePrinters.filter(p => p.type === 'bluetooth').length > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                    {printerState.availablePrinters.filter(p => p.type === 'bluetooth').length} saved
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {printerState.availablePrinters.length > 0 && (
                  <Button 
                    onClick={clearAllPrinters} 
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                  >
                    Clear All
                  </Button>
                )}
                <Button 
                  onClick={scanBluetoothPrinters} 
                  disabled={printerState.isBluetoothScanning || !printerState.isBluetoothSupported}
                  variant="outline"
                  size="sm"
                  className="border-blue-300 text-blue-700 hover:bg-blue-100"
                >
                  {printerState.isBluetoothScanning ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</>
                  ) : (
                    <><Search className="h-4 w-4 mr-2" /> Scan Printers</>
                  )}
                </Button>
              </div>
            </div>
            
            {!printerState.isBluetoothSupported && (
              <p className="text-sm text-yellow-700 bg-yellow-100 p-2 rounded">
                ⚠️ Bluetooth not supported in this browser. Please use Chrome, Edge, or Opera.
              </p>
            )}
            
            {printerState.availablePrinters.filter(p => p.type === 'bluetooth').length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-blue-800">Found Bluetooth Printers:</p>
                <div className="space-y-1">
                  {printerState.availablePrinters.filter(p => p.type === 'bluetooth').map((printer) => (
                    <div key={printer.id} className="flex items-center justify-between bg-white p-3 rounded border">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{printer.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className={`w-2 h-2 rounded-full ${
                              printer.isConnected ? 'bg-green-500' : 'bg-red-500'
                            }`}></div>
                            <span className={`text-xs font-medium ${
                              printer.isConnected ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {printer.isConnected ? 'Connected' : 'Disconnected'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {printer.isConnected ? (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => disconnectPrinter(printer.id)}
                            className="text-xs border-red-300 text-red-700 hover:bg-red-50"
                          >
                            Disconnect
                          </Button>
                        ) : (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => connectPrinter(printer.id)}
                            className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                          >
                            Connect
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Test Print Button */}
          <div className="pt-3 border-t border-gray-200">
            <Button 
              onClick={testPrint}
              variant="outline"
              className="w-full border-green-300 text-green-700 hover:bg-green-50"
              disabled={printerState.availablePrinters.filter(p => p.isConnected).length === 0}
            >
              <Printer className="h-4 w-4 mr-2" />
              Test Print
            </Button>
            {printerState.availablePrinters.filter(p => p.isConnected).length === 0 && (
              <p className="text-xs text-gray-500 mt-1 text-center">
                Connect a printer to enable test printing
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Wired Thermal Printer Scanner */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-900">Wired Printer Scanner</span>
                {printerState.availablePrinters.filter(p => p.type === 'wired').length > 0 && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                    {printerState.availablePrinters.filter(p => p.type === 'wired').length} saved
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={scanWiredPrinters} 
                  disabled={printerState.isWiredScanning || !printerState.isWiredSupported}
                  variant="outline"
                  size="sm"
                  className="border-green-300 text-green-700 hover:bg-green-100"
                >
                  {printerState.isWiredScanning ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</>
                  ) : (
                    <><Search className="h-4 w-4 mr-2" /> Scan USB</>
                  )}
                </Button>
              </div>
            </div>
            
            {!printerState.isWiredSupported && (
              <p className="text-sm text-yellow-700 bg-yellow-100 p-2 rounded">
                ⚠️ Web Serial API not supported in this browser. Please use Chrome, Edge, or Opera for wired printer support.
              </p>
            )}
            
            {printerState.availablePrinters.filter(p => p.type === 'wired').length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-green-800">Found Wired Printers:</p>
                <div className="space-y-1">
                  {printerState.availablePrinters.filter(p => p.type === 'wired').map((printer) => (
                    <div key={printer.id} className="flex items-center justify-between bg-white p-3 rounded border">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{printer.name}</span>
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                              USB
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className={`w-2 h-2 rounded-full ${
                              printer.isConnected ? 'bg-green-500' : 'bg-gray-400'
                            }`}></div>
                            <span className={`text-xs font-medium ${
                              printer.isConnected ? 'text-green-600' : 'text-gray-600'
                            }`}>
                              {printer.isConnected ? 'Tested & Working' : 'Not Tested'}
                            </span>
                            {printer.vendorId && (
                              <span className="text-xs text-gray-500">
                                VID: 0x{printer.vendorId.toString(16).toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => testWiredPrinter(printer.id)}
                          size="sm"
                          variant="outline"
                          className="border-green-300 text-green-700 hover:bg-green-100"
                        >
                          Test
                        </Button>
                        <Button
                          onClick={() => selectPrinter(printer.id, 'receipt')}
                          size="sm"
                          variant="outline"
                          className="border-blue-300 text-blue-700 hover:bg-blue-100"
                        >
                          Select as Receipt
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderCompanyProfile = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1.5">
        <h2 className="text-lg font-semibold text-slate-900">Company Profile</h2>
      </div>
      <Card className="pt-3 shadow-sm">
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Company Name</Label>
              <Input 
                value={companyData.name} 
                onChange={(e) => setCompanyData({...companyData, name: e.target.value})}
                className="mt-0.5 h-10"
              />
            </div>
                        <div>
              <Label>Email Address</Label>
              <Input 
                type="email"
                value={companyData.email}
                onChange={(e) => setCompanyData({...companyData, email: e.target.value})}
                className="mt-0.5 h-10"
                placeholder="company@example.com"
              />
            </div>
          </div>

          <div>
            <Label>Business Address</Label>
            <Textarea 
              value={companyData.address}
              onChange={(e) => setCompanyData({...companyData, address: e.target.value})}
              className="mt-0.5"
              rows={3}
              placeholder="Enter complete business address"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phone Number </Label>
              <Input 
                value={companyData.phone}
                onChange={(e) => setCompanyData({...companyData, phone: e.target.value})}
                className="mt-0.5 h-10"
                placeholder="+91 XXXXX XXXXX"
              />
            </div>

            <div>
              <Label>Alternate Phone Number </Label>
              <Input 
                value={companyData.altPhone}
                onChange={(e) => setCompanyData({...companyData, altPhone: e.target.value})}
                className="mt-0.5 h-10"
                placeholder="+91 XXXXX XXXXX"
              />
            </div>

          </div>

          <div>
            <Label>GSTIN</Label>
            <Input 
              value={companyData.gstin}
              onChange={(e) => setCompanyData({...companyData, gstin: e.target.value})}
              className="mt-0.5 h-10"
              placeholder="Enter GST Identification Number"
            />
          </div>

          <div>
            <Label>Company Logo</Label>
            <div className="mt-1 flex items-center gap-3">
              {companyData.logoUrl ? (
                <img
                  src={companyData.logoUrl}
                  alt="Company logo"
                  className="h-12 w-12 rounded border border-slate-200 bg-white object-contain"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-400">
                  No logo
                </div>
              )}
              <div className="flex flex-col gap-1 text-xs text-slate-600">
                <input
                  type="file"
                  accept="image/*"
                  className="block w-full text-xs text-slate-700"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const form = new FormData();
                      form.append("file", file);
                      const resp = await ApiService.fetchWithAuth(`${API_BASE_URL}/retail-master/logo`, {
                        method: "POST",
                        body: form,
                      });
                      const data: any = await ApiService.handleResponse<any>(resp);
                      if (data?.success && data.logo_url) {
                        setCompanyData((prev) => ({ ...prev, logoUrl: data.logo_url }));
                        setRetailMasterRow((prev: any) => ({ ...(prev || {}), logo: data.logo_url }));
                        try {
                          const raw = sessionStorage.getItem("retail_master");
                          const existing = raw ? JSON.parse(raw) : {};
                          sessionStorage.setItem("retail_master", JSON.stringify({ ...existing, logo: data.logo_url }));
                        } catch {
                          // ignore storage issues
                        }
                        toast({ title: "Logo updated", description: "Company logo uploaded successfully." });
                      } else {
                        toast({
                          title: "Upload failed",
                          description: data?.message || "Could not upload logo.",
                          variant: "destructive",
                        });
                      }
                    } catch (err: any) {
                      console.error("Logo upload failed:", err);
                      toast({
                        title: "Upload error",
                        description: err?.message || "Unexpected error while uploading logo.",
                        variant: "destructive",
                      });
                    } finally {
                      e.target.value = "";
                    }
                  }}
                />
                <span>Recommended: PNG/JPEG, up to 10 MB.</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderBillingUI = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1.5">
        <h2 className="text-lg font-semibold text-slate-900">Billing UI</h2>
      </div>
      <Card className="pt-3 shadow-sm">
        <CardContent className="space-y-3">
          <div className="text-sm text-slate-600">
            Choose your billing screen mode based on how you operate.
          </div>

          <RadioGroup
            value={billingUIMode}
            onValueChange={(v) => setBillingUIMode(normalizeBillingUIMode(v))}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
              <RadioGroupItem value="touch" className="mt-1" />
              <div>
                <div className="font-medium text-slate-900">Touch</div>
                <div className="text-sm text-slate-600">Bigger controls, touch-friendly.</div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
              <RadioGroupItem value="type" className="mt-1" />
              <div>
                <div className="font-medium text-slate-900">Type</div>
                <div className="text-sm text-slate-600">Keyboard-focused, faster typing.</div>
              </div>
            </label>
          </RadioGroup>

          <div className="pt-2 border-t border-slate-100 mt-2">
            <h3 className="text-sm font-medium text-slate-900 mb-2">Notifications</h3>
            <div className="flex items-center space-x-3">
                <Switch
                  id="wa-on-bill"
                  checked={sendWhatsAppOnBill}
                  onCheckedChange={(checked) => setSendWhatsAppOnBill(checked)}
                />
                <label
                  htmlFor="wa-on-bill"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Send Invoice Message on WhatsApp after Billing
                </label>
            </div>

            {sendWhatsAppOnBill && (
              <div className="mt-3">
                <Label className="text-xs text-slate-600">
                  Invoice WhatsApp Template <span className="text-red-600">*</span>
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Select
                    value={normalizedInvoiceTemplateMessageId}
                    onValueChange={(v) => setInvoiceWhatsAppTemplateMessageId(v)}
                  >
                    <SelectTrigger
                      className={`h-10 w-full ${isInvoiceTemplateMissing ? "border-red-500 focus:ring-red-500" : ""}`}
                      aria-invalid={isInvoiceTemplateMissing}
                    >
                      {invoiceWhatsAppTemplateLoading && invoiceWhatsAppTemplateItems.length === 0 ? (
                        <span className="text-slate-500">Loading templates...</span>
                      ) : isInvoiceTemplateMissing ? (
                        <span className="text-slate-500">Select template</span>
                      ) : (
                        <SelectValue />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {invoiceWhatsAppTemplateItems.map((t: any) => {
                        const messageId = t?.message_id ?? t?.messageId ?? t?.MessageId;
                        const label = t?.template_name ?? t?.templateName ?? t?.TemplateName ?? `Template ${messageId ?? ''}`;
                        if (messageId === null || typeof messageId === "undefined") return null;
                        return (
                          <SelectItem key={String(messageId)} value={String(messageId)}>
                            {label} (ID: {String(messageId)})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {invoiceWhatsAppTemplateLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                  )}
                </div>

                {isInvoiceTemplateMissing && (
                  <div className="text-xs text-red-600 mt-1">Select template (required)</div>
                )}

                {!!selectedInvoiceWhatsAppTemplate && (
                  <div className="mt-3">
                    <Label className="text-xs text-slate-600">Template Message</Label>
                    <Textarea
                      value={
                        String(
                          selectedInvoiceWhatsAppTemplate?.message_content ??
                            selectedInvoiceWhatsAppTemplate?.messageContent ??
                            ""
                        )
                      }
                      readOnly
                      className="mt-1 min-h-[110px] text-xs font-mono"
                      placeholder="No message content found for this template."
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 mt-2">
            <h3 className="text-sm font-medium text-slate-900 mb-2">Billing Features</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <Switch
                  id="enable-service-onbilling"
                  checked={enableServiceOnBilling}
                  onCheckedChange={(checked) => {
                    if (!checked && !enablePackagesOnBilling && !enableInventoryOnBilling) {
                      toast({
                        title: "Not allowed",
                        description: "At least one of Services / Packages / Inventory must be enabled on Billing.",
                        variant: "destructive",
                      });
                      return;
                    }
                    setEnableServiceOnBilling(checked);
                  }}
                />
                <label
                  htmlFor="enable-service-onbilling"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Enable Services on Billing
                </label>
              </div>

              <div className="flex items-center space-x-3">
                <Switch
                  id="enable-packages-onbilling"
                  checked={enablePackagesOnBilling}
                  onCheckedChange={(checked) => {
                    if (!checked && !enableServiceOnBilling && !enableInventoryOnBilling) {
                      toast({
                        title: "Not allowed",
                        description: "At least one of Services / Packages / Inventory must be enabled on Billing.",
                        variant: "destructive",
                      });
                      return;
                    }
                    setEnablePackagesOnBilling(checked);
                  }}
                />
                <label
                  htmlFor="enable-packages-onbilling"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Enable Packages on Billing
                </label>
              </div>

              <div className="flex items-center space-x-3">
                <Switch
                  id="enable-inventory-onbilling"
                  checked={enableInventoryOnBilling}
                  onCheckedChange={(checked) => {
                    if (!checked && !enableServiceOnBilling && !enablePackagesOnBilling) {
                      toast({
                        title: "Not allowed",
                        description: "At least one of Services / Packages / Inventory must be enabled on Billing.",
                        variant: "destructive",
                      });
                      return;
                    }
                    setEnableInventoryOnBilling(checked);
                  }}
                />
                <label
                  htmlFor="enable-inventory-onbilling"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Enable Inventory on Billing
                </label>
              </div>
            </div>
          </div>

          {!accountMasterRow && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              Account settings not loaded yet. Please refresh and try again.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const handleUpdate = async () => {
    try {
      if (!user?.account_code || !user?.retail_code) return;
      setIsUpdating(true);

      if (activeCategory === "billingui") {
        const errors: string[] = [];

        if (sendWhatsAppOnBill && String(normalizedInvoiceTemplateMessageId || "").trim() === "") {
          toast({
            title: "Update blocked",
            description: "Select a WhatsApp invoice template to send after billing.",
            variant: "destructive",
          });
          return;
        }

        if (!enableServiceOnBilling && !enablePackagesOnBilling && !enableInventoryOnBilling) {
          toast({
            title: "Update blocked",
            description: "Enable at least one of Services / Packages / Inventory on Billing.",
            variant: "destructive",
          });
          return;
        }

        // Update Account Master (BillingUI)
        let pkAccount = accountMasterRow?.Id ?? accountMasterRow?.id ?? accountMasterRow?.ID;
        if (pkAccount) {
          const payloadAccount: any = {
            Id: pkAccount,
            account_code: user.account_code,
            retail_code: user.retail_code,
            BillingUI: billingUIMode, 
          };
          const respAccount: any = await DataService.updateData("account_master", payloadAccount);
          if (!respAccount?.success) {
            errors.push("Failed to update Billing UI: " + (respAccount?.message || "Unknown error"));
          }
        } else {
           errors.push("Account settings missing ID.");
        }

        // Update Retail Master (SendWhatsAppOnBill)
        let pkRetail = retailMasterRow?.Id ?? retailMasterRow?.id ?? retailMasterRow?.ID;
        if (pkRetail) {
          const parsedMessageId = sendWhatsAppOnBill
            ? Number(String(normalizedInvoiceTemplateMessageId || "").trim() || 0)
            : 0;
          const normalizedMessageId = sendWhatsAppOnBill && parsedMessageId > 0 ? parsedMessageId : null;
          const payloadRetail: any = {
            Id: pkRetail,
            account_code: user.account_code,
            retail_code: user.retail_code,
            SendWhatsAppOnBill: sendWhatsAppOnBill ? "Y" : "N",
            // Persist invoice template message id; backend will map to whichever column exists.
            whatsapp_messageid: normalizedMessageId,
            whatsapp_message_id: normalizedMessageId,
            // Some deployments use enable_service_onbilling (singular) and others enable_services_onbilling (plural).
            // Send both; backend will apply whichever column exists.
            enable_service_onbilling: enableServiceOnBilling ? "Y" : "N",
            enable_services_onbilling: enableServiceOnBilling ? "Y" : "N",
            enable_packages_onbilling: enablePackagesOnBilling ? "Y" : "N",
            enable_inventory_onbilling: enableInventoryOnBilling ? "Y" : "N",
          };
          const respRetail: any = await DataService.updateData("retail_master", payloadRetail);
          if (!respRetail?.success) {
            errors.push("Failed to update WhatsApp setting: " + (respRetail?.message || "Unknown error"));
          } else {
            // Keep in-memory row and session retail_master in sync so other screens can react immediately.
            setRetailMasterRow((prev: any) => ({ ...(prev || {}), ...payloadRetail }));
            try {
              const raw = sessionStorage.getItem('retail_master');
              const existing = raw ? JSON.parse(raw) : {};
              sessionStorage.setItem('retail_master', JSON.stringify({ ...existing, ...payloadRetail }));
            } catch {
              // ignore session storage issues
            }
          }
        } else {
           errors.push("Retail settings missing ID.");
        }

        if (errors.length === 0) {
          toast({ title: "Updated", description: "Settings saved successfully." });
        } else {
          toast({ title: "Update failed", description: errors.join("\n"), variant: "destructive" });
        }
        return;
      }

      if (activeCategory === "printer") {
        toast({ title: "Saved", description: "Printer settings are saved automatically on this device." });
        return;
      }

      // Ensure primary key exists; try common variants if missing
      let pk = retailMasterRow?.Id ?? retailMasterRow?.id ?? retailMasterRow?.ID;
      if (!pk) {
        toast({
          title: "Update failed",
          description: "Company profile not loaded (missing Id). Please refresh and try again.",
          variant: "destructive",
        });
        return;
      }
      const payload: any = {
        Id: pk,
        account_code: user.account_code,
        retail_code: user.retail_code,
        RetailName: companyData.name,
        address: companyData.address,
        phone1: companyData.phone,
        phone2: companyData.altPhone,
        gst_no: companyData.gstin,
        email: companyData.email,
        logo: companyData.logoUrl,
      };
      const resp: any = await DataService.updateData('retail_master', payload);
      if (resp?.success) {
        toast({ title: "Updated", description: "Company profile saved successfully." });
      } else {
        toast({ title: "Update failed", description: resp?.message || "Could not save changes.", variant: "destructive" });
      }
    } catch (e: any) {
      console.error('Failed to update retail_master:', e);
      toast({ title: "Update error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/40 p-1 sm:p-2">
      <div className="w-full space-y-2">
        <Tabs value={activeCategory} onValueChange={handleTabChange} className="w-full">
          <Card className="shadow-sm">
            <CardContent className="p-2 sm:p-3">
              <div className="grid gap-3 md:grid-cols-[240px_1fr] md:items-start">
                {/* Sidebar */}
                <div className="rounded-lg border border-slate-200 bg-white p-1.5">
                  <div className="px-2 pt-1 pb-1.5">
                    <div className="text-xs font-medium text-slate-500">CONFIGURATION</div>
                  </div>
                  <TabsList className="w-full bg-transparent p-0 h-auto flex flex-row md:flex-col gap-1">
                    {settingCategories.map((c) => {
                      const Icon = c.icon;
                      const isActive = activeCategory === c.id;
                      const iconColor =
                        c.id === "company"
                          ? isActive
                            ? "text-blue-600"
                            : "text-blue-500/70"
                          : c.id === "printer"
                            ? isActive
                              ? "text-emerald-600"
                              : "text-emerald-500/70"
                            : isActive
                              ? "text-purple-600"
                              : "text-purple-500/70";
                      return (
                        <TabsTrigger
                          key={c.id}
                          value={c.id}
                          className="w-full justify-start gap-2 rounded-md px-3 py-2 text-sm data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-none"
                        >
                          <Icon className={`h-4 w-4 ${iconColor}`} />
                          <span className="truncate">{c.title}</span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                {/* Content */}
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="p-2 sm:p-3">
                    <TabsContent value="company" className="m-0">
                      {renderCompanyProfile()}
                    </TabsContent>
                    <TabsContent value="printer" className="m-0">
                      {renderPrinterSettings()}
                    </TabsContent>
                    <TabsContent value="billingui" className="m-0">
                      {renderBillingUI()}
                    </TabsContent>
                  </div>

                  {/* Actions */}
                  <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/70 sm:px-3">
                    <div className="text-xs text-slate-500">
                      {activeCategory === "printer"
                        ? "Printer sessions are saved automatically on this device."
                        : "Changes are saved when you click Update."}
                    </div>
                    <Button
                      onClick={handleUpdate}
                      disabled={
                        isUpdating ||
                        activeCategory === "printer" ||
                        (activeCategory === "company" && !(retailMasterRow?.Id || retailMasterRow?.id || retailMasterRow?.ID)) ||
                        (activeCategory === "billingui" && !(accountMasterRow?.Id || accountMasterRow?.id || accountMasterRow?.ID))
                      }
                      className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-70"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isUpdating ? "Updating..." : "Update"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Tabs>
      </div>
    </div>
  );
}
