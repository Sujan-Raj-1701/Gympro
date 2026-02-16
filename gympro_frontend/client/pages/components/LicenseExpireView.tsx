import { useState, useEffect } from "react";
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
import {
    Search,
    Loader2,
    Store,
    Phone,
    Key,
    Calendar as CalendarIcon,
    AlertTriangle,
    CheckCircle,
    Filter,
    RefreshCw,
    AlertCircle,
    Clock
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface User {
    user_id: string;
    username: string;
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
    expiry_date?: string;
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

interface LicenseExpiryData {
    retail: RetailUnit;
    account: CustomerAccount;
    expiryDate: Date | null;
    daysRemaining: number;
    isExpired: boolean;
    status: 'expired' | 'critical' | 'warning' | 'active';
}

export function LicenseExpireView() {
    const [customers, setCustomers] = useState<CustomerAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [sortBy, setSortBy] = useState<string>("expiry-asc");

    useEffect(() => {
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        setLoading(true);
        try {
            const data = await LicenseService.getAllCustomers();
            setCustomers(data);
            setError(null);
        } catch (err) {
            console.error("Failed to fetch customers", err);
            setError("Failed to load license data. Please try again.");
        } finally {
            setLoading(false);
        }
    };

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

    // Process all retail units into a flat list with expiry information
    const processLicenseData = (): LicenseExpiryData[] => {
        const licenseData: LicenseExpiryData[] = [];

        customers.forEach(account => {
            account.retails?.forEach(retail => {
                const expiryStr = deriveExpiry(retail.licencekey);
                const expiryDate = expiryStr ? new Date(expiryStr) : null;
                const now = new Date();
                const daysRemaining = expiryDate ? differenceInDays(expiryDate, now) : 0;
                const isExpired = expiryDate ? expiryDate < now : false;

                let status: 'expired' | 'critical' | 'warning' | 'active' = 'active';
                if (isExpired) {
                    status = 'expired';
                } else if (daysRemaining <= 7) {
                    status = 'critical';
                } else if (daysRemaining <= 30) {
                    status = 'warning';
                }

                licenseData.push({
                    retail,
                    account,
                    expiryDate,
                    daysRemaining,
                    isExpired,
                    status
                });
            });
        });

        return licenseData;
    };

    // Filter and sort license data
    const getFilteredAndSortedData = (): LicenseExpiryData[] => {
        let data = processLicenseData();

        // Apply search filter
        if (searchTerm) {
            data = data.filter(item =>
                item.retail.RetailName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.account.AccountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.retail.retail_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.account.account_code.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Apply status filter
        if (filterStatus !== "all") {
            data = data.filter(item => item.status === filterStatus);
        }

        // Apply sorting
        switch (sortBy) {
            case "expiry-asc":
                data.sort((a, b) => {
                    if (!a.expiryDate) return 1;
                    if (!b.expiryDate) return -1;
                    return a.expiryDate.getTime() - b.expiryDate.getTime();
                });
                break;
            case "expiry-desc":
                data.sort((a, b) => {
                    if (!a.expiryDate) return 1;
                    if (!b.expiryDate) return -1;
                    return b.expiryDate.getTime() - a.expiryDate.getTime();
                });
                break;
            case "name-asc":
                data.sort((a, b) => a.retail.RetailName.localeCompare(b.retail.RetailName));
                break;
            case "name-desc":
                data.sort((a, b) => b.retail.RetailName.localeCompare(a.retail.RetailName));
                break;
        }

        return data;
    };

    const filteredData = getFilteredAndSortedData();

    // Calculate statistics
    const stats = {
        total: processLicenseData().length,
        expired: processLicenseData().filter(d => d.status === 'expired').length,
        critical: processLicenseData().filter(d => d.status === 'critical').length,
        warning: processLicenseData().filter(d => d.status === 'warning').length,
        active: processLicenseData().filter(d => d.status === 'active').length,
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'expired':
                return <Badge className="bg-red-600 text-white hover:bg-red-700">Expired</Badge>;
            case 'critical':
                return <Badge className="bg-orange-600 text-white hover:bg-orange-700">Critical</Badge>;
            case 'warning':
                return <Badge className="bg-yellow-600 text-white hover:bg-yellow-700">Warning</Badge>;
            case 'active':
                return <Badge className="bg-green-600 text-white hover:bg-green-700">Active</Badge>;
            default:
                return <Badge className="bg-gray-600 text-white">Unknown</Badge>;
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-600 text-lg">Loading license expiry data...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <AlertCircle className="h-12 w-12 text-red-600 mb-4" />
                <p className="text-red-600 text-lg mb-4">{error}</p>
                <Button onClick={fetchCustomers} className="bg-blue-600 hover:bg-blue-700">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col space-y-4 p-4">
            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <Card className="border-2 border-gray-200 bg-white/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-600">Total Licenses</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-red-200 bg-red-50/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Expired
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-red-600">{stats.expired}</div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-orange-200 bg-orange-50/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-orange-700 flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Critical (≤7 days)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-orange-600">{stats.critical}</div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-yellow-200 bg-yellow-50/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-yellow-700 flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            Warning (≤30 days)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-yellow-600">{stats.warning}</div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-green-200 bg-green-50/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-green-700 flex items-center gap-2">
                            <CheckCircle className="h-4 w-4" />
                            Active
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-green-600">{stats.active}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters and Search */}
            <Card className="border border-gray-200 bg-white/80 backdrop-blur-sm">
                <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search by retail name, account name, or code..."
                                className="pl-10 bg-white border-gray-200"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-3">
                            <Select value={filterStatus} onValueChange={setFilterStatus}>
                                <SelectTrigger className="w-[180px] bg-white">
                                    <Filter className="h-4 w-4 mr-2" />
                                    <SelectValue placeholder="Filter by status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="expired">Expired</SelectItem>
                                    <SelectItem value="critical">Critical (≤7 days)</SelectItem>
                                    <SelectItem value="warning">Warning (≤30 days)</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={sortBy} onValueChange={setSortBy}>
                                <SelectTrigger className="w-[180px] bg-white">
                                    <SelectValue placeholder="Sort by" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="expiry-asc">Expiry (Earliest)</SelectItem>
                                    <SelectItem value="expiry-desc">Expiry (Latest)</SelectItem>
                                    <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                                    <SelectItem value="name-desc">Name (Z-A)</SelectItem>
                                </SelectContent>
                            </Select>

                            <Button
                                onClick={fetchCustomers}
                                variant="outline"
                                className="bg-white hover:bg-gray-50"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* License Table */}
            <Card className="border border-gray-200 bg-white/80 backdrop-blur-sm flex-1 overflow-hidden flex flex-col">
                <CardContent className="pt-6 flex-1 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-auto custom-scrollbar rounded-md border border-gray-200 bg-white">
                        <Table>
                            <TableHeader className="bg-gray-50 sticky top-0 z-10">
                                <TableRow>
                                    <TableHead>Retail Name</TableHead>
                                    <TableHead>Account Name</TableHead>
                                    <TableHead>Retail Code</TableHead>
                                    <TableHead>License Key</TableHead>
                                    <TableHead>Expiry Date</TableHead>
                                    <TableHead>Days Remaining</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredData.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-32 text-center text-gray-500">
                                            No licenses found matching your criteria.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredData.map((item, index) => (
                                        <TableRow
                                            key={`${item.retail.retail_code}-${index}`}
                                            className={`hover:bg-gray-50 transition-colors ${item.status === 'expired' ? 'bg-red-50/30' :
                                                    item.status === 'critical' ? 'bg-orange-50/30' :
                                                        item.status === 'warning' ? 'bg-yellow-50/30' : ''
                                                }`}
                                        >
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <Store className="h-4 w-4 text-gray-400" />
                                                    {item.retail.RetailName}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-gray-600">
                                                {item.account.AccountName}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-gray-500">
                                                {item.retail.retail_code}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Key className="h-3 w-3 text-gray-400" />
                                                    <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded border border-gray-200">
                                                        {item.retail.licencekey.substring(0, 20)}...
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <CalendarIcon className="h-4 w-4 text-gray-400" />
                                                    <span className={`text-sm ${item.isExpired ? 'text-red-600 font-semibold' : 'text-gray-600'
                                                        }`}>
                                                        {item.expiryDate ? formatDate(item.expiryDate.toISOString()) : 'N/A'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {item.isExpired ? (
                                                    <span className="text-red-600 font-semibold">
                                                        Expired {Math.abs(item.daysRemaining)} days ago
                                                    </span>
                                                ) : (
                                                    <span className={`font-medium ${item.daysRemaining <= 7 ? 'text-orange-600' :
                                                            item.daysRemaining <= 30 ? 'text-yellow-600' :
                                                                'text-green-600'
                                                        }`}>
                                                        {item.daysRemaining} days
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {getStatusBadge(item.status)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="mt-4 text-sm text-gray-500 text-center">
                        Showing {filteredData.length} of {stats.total} licenses
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
