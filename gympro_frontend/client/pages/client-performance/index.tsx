import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Search,
    Plus,
    Activity,
    User,
    TrendingUp,
    TrendingDown,
    Calendar,
    Phone,
    UserCircle,
    Target,
    Scale,
    Save,
    Dumbbell,
    Info,
    AlertCircle,
    RefreshCw,
    History
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiService } from "@/services/apiService";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    LineChart,
    Line
} from "recharts";

// --- Types ---
interface PerformanceRecord {
    id: number;
    client_name: string;
    height: number;
    weight: number;
    bmi: number;
    body_fat: number;
    muscle_mass: number;
    created_at: string;
}

interface ClientProfile {
    id: number;
    customer_id: string;
    customer_name: string;
    gender: string;
    phone: string;
    height_cm: number;
    weight_kg: number;
    age: number;
    goal: string;
    email_id?: string;
}

export default function ClientPerformance() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);
    const [history, setHistory] = useState<PerformanceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form state for new measurement
    const [form, setForm] = useState({
        height: "",
        weight: "",
        body_fat: "",
        muscle_mass: ""
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    // BMI calculation
    const calculatedBMI = useMemo(() => {
        const h = parseFloat(form.height);
        const w = parseFloat(form.weight);
        if (h > 0 && w > 0) {
            return (w / Math.pow(h / 100, 2)).toFixed(2);
        }
        return "";
    }, [form.height, form.weight]);

    // Handle Search
    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (searchQuery.trim()) {
                try {
                    const results = await ApiService.searchMasterCustomer(
                        searchQuery,
                        10,
                        user?.account_code,
                        user?.retail_code
                    );
                    setSearchResults(results);
                } catch (err) {
                    console.error("Search failed", err);
                }
            } else {
                setSearchResults([]);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchQuery, user]);

    // Fetch history
    const fetchHistory = useCallback(async (clientName: string) => {
        setIsLoading(true);
        try {
            const endpoint = `/api/measurements/history?client_name=${encodeURIComponent(clientName)}&account_code=${user?.account_code}&retail_code=${user?.retail_code}`;
            console.log("[DEBUG] Fetching history from:", endpoint);
            const resp = await ApiService.get<any>(endpoint);
            if (resp.success) {
                setHistory(resp.data);
            }
        } catch (error) {
            console.error("Failed to fetch history", error);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    // Handle Client Selection
    const handleSelectClient = (client: any) => {
        const clientName = client.customer_name || client.full_name || client.name;
        setSelectedClient({
            id: client.id,
            customer_id: client.customer_id,
            customer_name: clientName,
            gender: client.gender || "Not specified",
            phone: client.customer_mobile || client.mobile || client.phone,
            height_cm: client.height_cm || 0,
            weight_kg: client.weight_kg || 0,
            age: client.age || 0,
            goal: client.goal || "Weight Loss",
            email_id: client.email_id
        });
        setSearchQuery("");
        setSearchResults([]);

        // Initial form values from profile
        setForm({
            height: client.height_cm ? String(client.height_cm) : "",
            weight: client.weight_kg ? String(client.weight_kg) : "",
            body_fat: "",
            muscle_mass: ""
        });

        fetchHistory(clientName);
    };

    // Validation
    const validate = () => {
        const e: Record<string, string> = {};
        if (!form.height || isNaN(parseFloat(form.height)) || parseFloat(form.height) <= 0) e.height = "Required & > 0";
        if (!form.weight || isNaN(parseFloat(form.weight)) || parseFloat(form.weight) <= 0) e.weight = "Required & > 0";
        if (form.body_fat && isNaN(parseFloat(form.body_fat))) e.body_fat = "Must be numeric";
        if (form.muscle_mass && isNaN(parseFloat(form.muscle_mass))) e.muscle_mass = "Must be numeric";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    // Save Logic
    const handleSave = async () => {
        if (!validate() || !selectedClient) return;
        setIsSaving(true);
        try {
            const payload = {
                account_code: user?.account_code,
                retail_code: user?.retail_code,
                client_name: selectedClient.customer_name,
                height: parseFloat(form.height),
                weight: parseFloat(form.weight),
                body_fat: form.body_fat ? parseFloat(form.body_fat) : 0,
                muscle_mass: form.muscle_mass ? parseFloat(form.muscle_mass) : 0,
                bmi: calculatedBMI ? parseFloat(calculatedBMI) : 0,
                created_by: user?.username || "admin"
            };

            console.log("[DEBUG] Saving measurement to /api/measurements/add with payload:", payload);
            const resp = await ApiService.post<any>("/api/measurements/add", payload);
            console.log("[DEBUG] Save response:", resp);

            if (resp.status === "success" || resp.success) {
                toast({ title: "Success", description: "Measurements saved successfully" });
                setShowAddDialog(false);
                setForm(prev => ({ ...prev, weight: "", body_fat: "", muscle_mass: "" }));
                // LIVE UPDATE
                await fetchHistory(selectedClient.customer_name);
            } else {
                throw new Error(resp.message || "Unable to save measurement. Please try again.");
            }
        } catch (error) {
            console.error("Save failed", error);
            toast({
                title: "Error",
                description: "Unable to save measurement. Please try again.",
                variant: "destructive"
            });
        } finally {
            setIsSaving(false);
        }
    };

    const latest = history[0] || null;
    const prev = history[1] || null;

    // Chart Data
    const chartData = useMemo(() => {
        return [...history].reverse().map(it => ({
            date: format(new Date(it.created_at), 'MMM dd'),
            weight: it.weight,
            bmi: it.bmi,
            fat: it.body_fat,
            muscle: it.muscle_mass
        }));
    }, [history]);

    return (
        <div className="flex flex-col min-h-screen bg-[#f8fafc] p-6 space-y-6">
            {/* Header / Search */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-200">
                <div className="space-y-1">
                    <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
                        <Activity className="h-8 w-8 text-yellow-500" />
                        Client Performance
                    </h1>
                    <p className="text-slate-500 font-medium">Analyze and track physical transformation</p>
                </div>

                <div className="relative w-full lg:w-[450px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <Input
                        placeholder="Search client to begin tracking..."
                        className="pl-12 h-14 bg-white border-slate-200 rounded-2xl shadow-sm focus:ring-yellow-500/20 text-lg"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <AnimatePresence>
                        {searchResults.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className="absolute top-[64px] left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden"
                            >
                                {searchResults.map(res => (
                                    <button
                                        key={res.id}
                                        onClick={() => handleSelectClient(res)}
                                        className="w-full p-4 flex items-center gap-4 hover:bg-yellow-50 transition-colors text-left"
                                    >
                                        <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 font-bold uppercase">
                                            {(res.customer_name || res.full_name)[0]}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800">{res.customer_name || res.full_name}</p>
                                            <p className="text-xs text-slate-400">{res.customer_mobile || res.phone}</p>
                                        </div>
                                    </button>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {!selectedClient ? (
                <div className="flex-1 flex flex-col items-center justify-center py-24 bg-white border border-dashed border-slate-200 rounded-[3rem] text-center">
                    <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                        <Search className="h-10 w-10 text-slate-200" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">No Client Selected</h3>
                    <p className="text-slate-400 mt-2 max-w-xs">Use the search bar above to select a client and view their performance dashboard.</p>
                </div>
            ) : (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Top Stats Overview */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <Card className="lg:col-span-3 bg-white border-slate-100 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-10">
                            <div className="h-24 w-24 rounded-[2rem] bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-xl shadow-yellow-500/20">
                                <User className="h-12 w-12 text-white" />
                            </div>
                            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-8">
                                <DataPoint label="Name" value={selectedClient.customer_name} icon={<UserCircle className="h-4 w-4 text-yellow-500" />} />
                                <DataPoint label="Phone" value={selectedClient.phone} icon={<Phone className="h-4 w-4 text-blue-500" />} />
                                <DataPoint label="Goal" value={selectedClient.goal} icon={<Target className="h-4 w-4 text-rose-500" />} highlight />
                                <DataPoint label="Enrollment Weight" value={`${selectedClient.weight_kg} kg`} icon={<Scale className="h-4 w-4 text-emerald-500" />} />
                            </div>
                        </Card>

                        <Button
                            onClick={() => setShowAddDialog(true)}
                            className="h-full bg-slate-900 hover:bg-slate-800 text-white font-black rounded-[2.5rem] flex flex-col items-center justify-center gap-3 p-8 shadow-lg transition-transform active:scale-95"
                        >
                            <div className="h-12 w-12 rounded-2xl bg-slate-800 flex items-center justify-center text-yellow-500">
                                <Plus className="h-6 w-6" />
                            </div>
                            <span className="text-lg">+ Add New Measurement</span>
                        </Button>
                    </div>

                    <Tabs defaultValue="overview" className="w-full">
                        <TabsList className="bg-white border border-slate-100 p-1.5 rounded-2xl mb-8">
                            <TabsTrigger value="overview" className="px-10 py-3 rounded-xl data-[state=active]:bg-yellow-500 data-[state=active]:text-white transition-all font-bold">Overview</TabsTrigger>
                            <TabsTrigger value="history" className="px-10 py-3 rounded-xl data-[state=active]:bg-yellow-500 data-[state=active]:text-white transition-all font-bold">History</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview" className="space-y-8 mt-0 outline-none">
                            {/* Metric Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <StatCard
                                    label="Current Weight"
                                    value={latest ? `${latest.weight}kg` : "--"}
                                    icon={<Scale />}
                                    color="emerald"
                                    change={latest && prev ? (latest.weight - prev.weight).toFixed(1) : null}
                                />
                                <StatCard
                                    label="Body BMI"
                                    value={latest ? latest.bmi : "--"}
                                    icon={<Activity />}
                                    color="purple"
                                    change={latest && prev ? (latest.bmi - prev.bmi).toFixed(2) : null}
                                />
                                <StatCard
                                    label="Body Fat %"
                                    value={latest && latest.body_fat ? `${latest.body_fat}%` : "--"}
                                    icon={<Target />}
                                    color="rose"
                                    change={latest && prev && latest.body_fat && prev.body_fat ? (latest.body_fat - prev.body_fat).toFixed(1) : null}
                                />
                                <StatCard
                                    label="Muscle Mass"
                                    value={latest && latest.muscle_mass ? `${latest.muscle_mass}kg` : "--"}
                                    icon={<Dumbbell />}
                                    color="blue"
                                    change={latest && prev && latest.muscle_mass && prev.muscle_mass ? (latest.muscle_mass - prev.muscle_mass).toFixed(1) : null}
                                />
                            </div>

                            {/* Charts */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <ChartBox title="Weight Transformation" description="Kilograms over time">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="colW" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Area type="monotone" dataKey="weight" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colW)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </ChartBox>

                                <ChartBox title="BMI & Fat Analysis" description="Indexed progress">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Line type="monotone" dataKey="bmi" stroke="#a855f7" strokeWidth={4} dot={{ r: 4, fill: '#a855f7' }} />
                                            <Line type="monotone" dataKey="fat" stroke="#f43f5e" strokeWidth={4} dot={{ r: 4, fill: '#f43f5e' }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartBox>
                            </div>
                        </TabsContent>

                        <TabsContent value="history" className="mt-0 outline-none">
                            <Card className="bg-white border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden">
                                <div className="p-8 border-b border-slate-50">
                                    <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                        <History className="h-5 w-5 text-yellow-500" />
                                        Measurement History
                                    </h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-widest">
                                                <th className="px-8 py-5">Date</th>
                                                <th className="px-8 py-5">Height</th>
                                                <th className="px-8 py-5">Weight</th>
                                                <th className="px-8 py-5">BMI</th>
                                                <th className="px-8 py-5">Fat %</th>
                                                <th className="px-8 py-5">Muscle</th>
                                                <th className="px-8 py-5 text-center">Trend</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {history.length > 0 ? history.map((row, idx) => (
                                                <tr key={row.id} className="hover:bg-yellow-50/20 transition-colors">
                                                    <td className="px-8 py-5 font-bold text-slate-600">{format(new Date(row.created_at), 'dd MMM yyyy')}</td>
                                                    <td className="px-8 py-5 text-slate-500">{row.height} cm</td>
                                                    <td className="px-8 py-5 font-black text-slate-900">{row.weight} kg</td>
                                                    <td className="px-8 py-5">
                                                        <Badge variant="outline" className="border-slate-100 bg-white font-black text-slate-500">{row.bmi}</Badge>
                                                    </td>
                                                    <td className="px-8 py-5 text-slate-500">{row.body_fat ? `${row.body_fat}%` : "--"}</td>
                                                    <td className="px-8 py-5 text-slate-500">{row.muscle_mass ? `${row.muscle_mass} kg` : "--"}</td>
                                                    <td className="px-8 py-5">
                                                        <div className="flex justify-center gap-3">
                                                            {getHistoryTrend(history, 'weight', idx)}
                                                            {getHistoryTrend(history, 'bmi', idx)}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr><td colSpan={7} className="p-20 text-center text-slate-300 italic font-medium">No history recorded yet.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            )}

            {/* Add Measurement Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="max-w-[480px] bg-white rounded-[3rem] p-0 overflow-hidden border-0 shadow-2xl">
                    <DialogHeader className="bg-slate-900 p-10 text-white relative">
                        <DialogTitle className="text-3xl font-black">Record Stats</DialogTitle>
                        <DialogDescription className="text-slate-400 font-bold mt-2">
                            Add new body metrics for {selectedClient?.customer_name}
                        </DialogDescription>
                        <div className="absolute right-0 top-0 bottom-0 w-32 bg-yellow-500/10 clip-path-slant" />
                    </DialogHeader>

                    <div className="p-10 space-y-8">
                        <div className="grid grid-cols-2 gap-6">
                            <InputField label="Height (cm) *" value={form.height} error={errors.height} onChange={v => setForm({ ...form, height: v })} />
                            <InputField label="Weight (kg) *" value={form.weight} error={errors.weight} onChange={v => setForm({ ...form, weight: v })} />
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <InputField label="Body Fat %" value={form.body_fat} error={errors.body_fat} onChange={v => setForm({ ...form, body_fat: v })} />
                            <InputField label="Muscle Mass (kg)" value={form.muscle_mass} error={errors.muscle_mass} onChange={v => setForm({ ...form, muscle_mass: v })} />
                        </div>

                        <div className="space-y-3">
                            <Label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Calculated BMI (Read-Only)</Label>
                            <div className="h-14 bg-slate-50 border border-slate-100 rounded-2xl flex items-center px-5 font-black text-xl text-slate-800">
                                {calculatedBMI || "--"}
                            </div>
                        </div>

                        <div className="bg-blue-50/50 p-5 rounded-2xl flex gap-4 border border-blue-100/50">
                            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-blue-900/60 font-bold leading-relaxed">
                                BMI is automatically computed using the standard formula. New records will update the dashboard and transformation charts in real-time.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="p-10 pt-0 flex gap-4">
                        <Button
                            variant="ghost"
                            onClick={() => setShowAddDialog(false)}
                            disabled={isSaving}
                            className="flex-1 h-14 rounded-2xl font-black text-slate-400 border-none"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex-1 h-14 bg-yellow-500 hover:bg-yellow-600 text-slate-900 font-black rounded-2xl shadow-xl shadow-yellow-500/20 active:scale-95 transition-all"
                        >
                            {isSaving ? <RefreshCw className="h-5 w-5 animate-spin" /> : "Save Measurement"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// --- Sub-components ---

function DataPoint({ label, value, icon, highlight = false }: any) {
    return (
        <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-black flex items-center gap-2">{icon} {label}</p>
            <p className={cn("text-base font-black truncate", highlight ? "text-yellow-600" : "text-slate-900")}>{value || "—"}</p>
        </div>
    );
}

function StatCard({ label, value, icon, color, change }: any) {
    const theme: any = {
        emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
        purple: "bg-purple-50 text-purple-600 border-purple-100",
        rose: "bg-rose-50 text-rose-600 border-rose-100",
        blue: "bg-blue-50 text-blue-600 border-blue-100",
    };

    const isPositive = parseFloat(change) > 0;
    const isZero = parseFloat(change) === 0;

    return (
        <Card className="bg-white border-slate-100 rounded-[2rem] p-6 shadow-sm hover:shadow-lg transition-all border-b-4 border-transparent hover:border-b-yellow-500 group">
            <div className="flex items-center justify-between mb-6">
                <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110", theme[color])}>
                    {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6" })}
                </div>
                {change !== null && !isZero && (
                    <div className={cn("flex items-center text-[10px] font-black px-2.5 py-1 rounded-full uppercase", isPositive ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>
                        {isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                        {Math.abs(parseFloat(change))}
                    </div>
                )}
            </div>
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
            <h3 className="text-3xl font-black text-slate-900 mt-1">{value}</h3>
        </Card>
    );
}

function ChartBox({ title, description, children }: any) {
    return (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] p-8 shadow-sm">
            <div className="mb-8">
                <h3 className="text-xl font-black text-slate-800">{title}</h3>
                <p className="text-slate-400 font-bold text-xs mt-1">{description}</p>
            </div>
            <div className="h-[300px] w-full">{children}</div>
        </Card>
    );
}

function InputField({ label, value, error, onChange }: any) {
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{label}</Label>
                {error && <span className="text-[10px] text-rose-500 font-black">{error}</span>}
            </div>
            <Input
                className={cn("h-14 bg-slate-50 border-slate-100 rounded-2xl focus:ring-yellow-500/20 font-bold text-lg", error && "border-rose-200 bg-rose-50")}
                type="number"
                value={value}
                onChange={e => onChange(e.target.value)}
            />
        </div>
    );
}

function CustomTooltip({ active, payload, label }: any) {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900 p-4 rounded-2xl shadow-2xl border-0">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">{label}</p>
                {payload.map((entry: any, i: number) => (
                    <div key={i} className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                        <p className="text-sm font-black text-white">{entry.name}: {entry.value}</p>
                    </div>
                ))}
            </div>
        );
    }
    return null;
}

function getHistoryTrend(history: PerformanceRecord[], key: keyof PerformanceRecord, idx: number) {
    if (idx >= history.length - 1) return null;
    const cur = history[idx][key] as number;
    const prv = history[idx + 1][key] as number;
    if (cur > prv) return <TrendingUp className="h-4 w-4 text-rose-500" title="Increased" />;
    if (cur < prv) return <TrendingDown className="h-4 w-4 text-emerald-500" title="Decreased" />;
    return null;
}
