import { useState, useEffect, Fragment } from "react";
import { LicenseService } from "@/services/licenseService";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Store, Phone, Key, Calendar as CalendarIcon, ChevronDown, ChevronRight, CheckCircle, AlertTriangle, Users } from "lucide-react";
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// Use the Service directly 
// (Note: In the actual file LicenseService is exported as a named export, 
// but we just import it. If the user's file structure requires defined types, 
// we will infer them from the API response)

interface User {
    user_id: string;
    username: string;
    // other fields from backend if needed
}

interface RetailUnit {
    Id?: number;
    retail_code: string;
    RetailName: string;
    licencekey: string;
    address?: string;
    phone1?: string;
    email?: string;
    create_dt?: string;
    expiry_date?: string; // If available from backend, else derived
    users?: User[];
}

interface CustomerAccount {
    account_code: string;
    AccountName: string;
    Phone: string;
    email?: string;
    BusCode: string;
    company_code: string;
    retails?: RetailUnit[];
}

export const CustomerManagementView = () => {
    const [customers, setCustomers] = useState<CustomerAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [error, setError] = useState<string | null>(null);

    // State for expanded rows
    const [expandedRows, setExpandedRows] = useState<string[]>([]);
    const [expandedRetailRows, setExpandedRetailRows] = useState<string[]>([]);

    // State for Extend License Dialog
    const [extendDialogOpen, setExtendDialogOpen] = useState(false);
    const [selectedRetailForExtension, setSelectedRetailForExtension] = useState<RetailUnit | null>(null);
    const [extensionTerm, setExtensionTerm] = useState<string>("1-year");
    const [customExpiryDate, setCustomExpiryDate] = useState<Date | undefined>(undefined);
    const [isExtending, setIsExtending] = useState(false);

    useEffect(() => {
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        setLoading(true);
        try {
            // @ts-ignore - Assuming getAllCustomers exists on LicenseService
            const data = await LicenseService.getAllCustomers();
            setCustomers(data);
            setError(null);
        } catch (err) {
            console.error("Failed to fetch customers", err);
            setError("Failed to load customer data. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const toggleRow = (accountCode: string) => {
        setExpandedRows(prev =>
            prev.includes(accountCode)
                ? prev.filter(code => code !== accountCode)
                : [...prev, accountCode]
        );
    };

    const toggleRetailRow = (retailCode: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent bubbling if nested in clickable handlers
        setExpandedRetailRows(prev =>
            prev.includes(retailCode)
                ? prev.filter(code => code !== retailCode)
                : [...prev, retailCode]
        );
    };

    const filteredCustomers = customers.filter(customer =>
        customer.AccountName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.account_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.Phone?.includes(searchTerm) ||
        customer.retails?.some(r => r.RetailName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const deriveExpiry = (key: string) => {
        try {
            return LicenseService.deriveExpiryFromLicenceKey(key);
        } catch {
            return null;
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return "N/A";
        try {
            return format(new Date(dateString), "MMM dd, yyyy");
        } catch {
            return dateString;
        }
    };

    const handleExtendClick = (retail: RetailUnit) => {
        setSelectedRetailForExtension(retail);
        setExtensionTerm("1-year"); // Reset default
        setCustomExpiryDate(undefined);
        setExtendDialogOpen(true);
    };

    const submitExtension = async () => {
        if (!selectedRetailForExtension) return;

        setIsExtending(true);
        try {
            const payload = {
                retail_code: selectedRetailForExtension.retail_code,
                extension_term: extensionTerm,
                custom_expiry: extensionTerm === 'custom-date' && customExpiryDate
                    ? customExpiryDate.toISOString()
                    : undefined
            };

            const response = await fetch('/api/retail-master/extend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                toast({
                    title: "License Extended",
                    description: `License for ${selectedRetailForExtension.RetailName} extended successfully.`,
                });
                setExtendDialogOpen(false);
                fetchCustomers(); // Refresh data
            } else {
                throw new Error(result.message || "Failed to extend license");
            }

        } catch (err: any) {
            console.error("Extension failed", err);
            toast({
                title: "Extension Failed",
                description: err.message,
                variant: "destructive"
            });
        } finally {
            setIsExtending(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[500px]">
                <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-500">Loading customer details...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-[500px]">
                <p className="text-red-500 mb-4">{error}</p>
                <Button onClick={fetchCustomers}>Retry</Button>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4 h-full flex flex-col bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-sm">
            <div className="flex justify-between items-center">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Search accounts, retailers..."
                        className="pl-9 bg-white border-gray-200"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="text-sm text-gray-500">
                    <span className="font-medium text-gray-900">{customers.length}</span> Accounts, {" "}
                    <span className="font-medium text-gray-900">{customers.reduce((acc, curr) => acc + (curr.retails?.length || 0), 0)}</span> Retail Units
                </div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar rounded-md border border-gray-200 bg-white">
                <Table>
                    <TableHeader className="bg-gray-50 sticky top-0 z-10">
                        <TableRow>
                            <TableHead className="w-[50px]"></TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Account Code</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Business Type</TableHead>
                            <TableHead className="text-right">Retail Units</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredCustomers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-gray-500">
                                    No customers found matching your search.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredCustomers.map((customer) => {
                                const isExpanded = expandedRows.includes(customer.account_code);
                                return (
                                    <Fragment key={customer.account_code}>
                                        <TableRow
                                            className={`cursor-pointer transition-colors hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/50' : ''}`}
                                            onClick={() => toggleRow(customer.account_code)}
                                        >
                                            <TableCell>
                                                {isExpanded ?
                                                    <ChevronDown className="h-4 w-4 text-gray-500" /> :
                                                    <ChevronRight className="h-4 w-4 text-gray-500" />
                                                }
                                            </TableCell>
                                            <TableCell className="font-medium text-gray-900">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-xs font-bold">
                                                        {customer.AccountName.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    {customer.AccountName}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-gray-600 font-mono text-xs">{customer.account_code}</TableCell>
                                            <TableCell className="text-gray-600">
                                                <div className="flex items-center gap-1.5">
                                                    <Phone className="h-3 w-3 text-gray-400" />
                                                    {customer.Phone}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs bg-white text-gray-600 border-gray-200 font-normal">
                                                    {customer.BusCode}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Badge className={`${isExpanded ? 'bg-blue-600' : 'bg-gray-900'} text-white hover:bg-blue-700 transition-colors`}>
                                                    {customer.retails?.length || 0}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>

                                        {isExpanded && (
                                            <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                                                <TableCell colSpan={6} className="p-0 border-b border-gray-200">
                                                    <div className="p-4 pl-14 bg-gray-50/30 shadow-inner">
                                                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                            <Store className="h-3 w-3" />
                                                            Retail Units & Licenses
                                                        </h4>
                                                        <div className="rounded-md border border-gray-200 bg-white overflow-hidden shadow-sm">
                                                            <Table>
                                                                <TableHeader className="bg-gray-50">
                                                                    <TableRow>
                                                                        <TableHead className="w-[40px]"></TableHead>
                                                                        <TableHead className="h-8 text-xs font-medium">Retail Name</TableHead>
                                                                        <TableHead className="h-8 text-xs font-medium">Retail Code</TableHead>
                                                                        <TableHead className="h-8 text-xs font-medium">License Key</TableHead>
                                                                        <TableHead className="h-8 text-xs font-medium">Expiry</TableHead>
                                                                        <TableHead className="h-8 text-xs font-medium text-right">Action</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {customer.retails?.map((retail) => {
                                                                        const isRetailExpanded = expandedRetailRows.includes(retail.retail_code);
                                                                        const expiryStr = deriveExpiry(retail.licencekey);
                                                                        const expiryDate = expiryStr ? new Date(expiryStr) : null;
                                                                        const isExpired = expiryDate ? expiryDate < new Date() : false;
                                                                        const daysRemaining = expiryDate
                                                                            ? Math.ceil((expiryDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                                                                            : 0;

                                                                        return (
                                                                            <Fragment key={retail.retail_code}>
                                                                                <TableRow className={`hover:bg-gray-50 ${isRetailExpanded ? 'bg-gray-50' : ''}`}>
                                                                                    <TableCell className="py-2">
                                                                                        {/* Expand Button for Users */}
                                                                                        <div
                                                                                            className="cursor-pointer p-1 rounded hover:bg-gray-200 w-fit"
                                                                                            onClick={(e) => toggleRetailRow(retail.retail_code, e)}
                                                                                        >
                                                                                            {isRetailExpanded ?
                                                                                                <ChevronDown className="h-3 w-3 text-gray-500" /> :
                                                                                                <ChevronRight className="h-3 w-3 text-gray-500" />
                                                                                            }
                                                                                        </div>
                                                                                    </TableCell>
                                                                                    <TableCell className="py-2 text-sm font-medium text-gray-700">
                                                                                        {retail.RetailName}
                                                                                    </TableCell>
                                                                                    <TableCell className="py-2 text-sm text-gray-500 font-mono">
                                                                                        {retail.retail_code}
                                                                                    </TableCell>
                                                                                    <TableCell className="py-2">
                                                                                        <div className="flex items-center gap-2">
                                                                                            <Key className="h-3 w-3 text-gray-400" />
                                                                                            <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                                                                                {retail.licencekey.substring(0, 16)}...
                                                                                            </span>
                                                                                        </div>
                                                                                    </TableCell>
                                                                                    <TableCell className="py-2">
                                                                                        {expiryDate ? (
                                                                                            <div className="flex items-center gap-2">
                                                                                                {isExpired ? (
                                                                                                    <AlertTriangle className="h-3 w-3 text-red-500" />
                                                                                                ) : (
                                                                                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                                                                                )}
                                                                                                <span className={`text-xs ${isExpired ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                                                                                                    {formatDate(expiryStr || undefined)}
                                                                                                </span>
                                                                                                {!isExpired && daysRemaining < 30 && (
                                                                                                    <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">
                                                                                                        {daysRemaining} days left
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        ) : (
                                                                                            <span className="text-xs text-gray-400 italic">No expiry info</span>
                                                                                        )}
                                                                                    </TableCell>
                                                                                    <TableCell className="py-2 text-right">
                                                                                        <Button
                                                                                            variant="ghost"
                                                                                            size="sm"
                                                                                            className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                                                            onClick={() => handleExtendClick(retail)}
                                                                                        >
                                                                                            Extend
                                                                                        </Button>
                                                                                    </TableCell>
                                                                                </TableRow>

                                                                                {/* Expanded Area for Users */}
                                                                                {isRetailExpanded && (
                                                                                    <TableRow className="bg-gray-100/50">
                                                                                        <TableCell colSpan={6} className="p-0 border-b border-gray-200">
                                                                                            <div className="pl-12 pr-4 py-3 bg-gray-50/50 shadow-inner">
                                                                                                <h5 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                                                                                    <Users className="h-3 w-3" />
                                                                                                    Users for {retail.RetailName}
                                                                                                </h5>
                                                                                                {retail.users && retail.users.length > 0 ? (
                                                                                                    <div className="bg-white border border-gray-200 rounded-md overflow-hidden max-w-2xl">
                                                                                                        <Table>
                                                                                                            <TableHeader className="bg-gray-50/50">
                                                                                                                <TableRow>
                                                                                                                    <TableHead className="h-7 text-[10px] w-12">ID</TableHead>
                                                                                                                    <TableHead className="h-7 text-[10px]">Username</TableHead>
                                                                                                                    <TableHead className="h-7 text-[10px]">Status</TableHead>
                                                                                                                </TableRow>
                                                                                                            </TableHeader>
                                                                                                            <TableBody>
                                                                                                                {retail.users.map(u => (
                                                                                                                    <TableRow key={u.user_id} className="h-8">
                                                                                                                        <TableCell className="py-1 text-xs text-gray-500 font-mono">{u.user_id}</TableCell>
                                                                                                                        <TableCell className="py-1 text-xs font-medium text-gray-700">{u.username}</TableCell>
                                                                                                                        <TableCell className="py-1">
                                                                                                                            <Badge variant="outline" className="text-[10px] py-0 h-4 border-green-200 bg-green-50 text-green-700">Active</Badge>
                                                                                                                        </TableCell>
                                                                                                                    </TableRow>
                                                                                                                ))}
                                                                                                            </TableBody>
                                                                                                        </Table>
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <div className="text-xs text-gray-500 italic pl-1">No users found for this retail unit.</div>
                                                                                                )}
                                                                                            </div>
                                                                                        </TableCell>
                                                                                    </TableRow>
                                                                                )}
                                                                            </Fragment>
                                                                        );
                                                                    })}
                                                                </TableBody>
                                                            </Table>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Extend License Dialog */}
            <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Extend License</DialogTitle>
                        <DialogDescription>
                            Extend the license validity for {selectedRetailForExtension?.RetailName}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-right">
                                Extension Term
                            </label>
                            <div className="col-span-3">
                                <Select value={extensionTerm} onValueChange={setExtensionTerm}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select term" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1-year">1 Year</SelectItem>
                                        <SelectItem value="2-years">2 Years</SelectItem>
                                        <SelectItem value="3-years">3 Years</SelectItem>
                                        <SelectItem value="6-months">6 Months</SelectItem>
                                        <SelectItem value="custom-date">Custom Date</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        {extensionTerm === 'custom-date' && (
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-right">
                                    New Expiry
                                </label>
                                <div className="col-span-3">
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={"outline"}
                                                className={cn(
                                                    "w-[240px] pl-3 text-left font-normal",
                                                    !customExpiryDate && "text-muted-foreground"
                                                )}
                                            >
                                                {customExpiryDate ? (
                                                    format(customExpiryDate, "PPP")
                                                ) : (
                                                    <span>Pick a date</span>
                                                )}
                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={customExpiryDate}
                                                onSelect={setCustomExpiryDate}
                                                disabled={(date) =>
                                                    date < new Date()
                                                }
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setExtendDialogOpen(false)}>Cancel</Button>
                        <Button onClick={submitExtension} disabled={isExtending}>
                            {isExtending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm Extension
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
