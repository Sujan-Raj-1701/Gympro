import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  UserCheck,
  Search,
  Filter,
  CheckCircle,
  AlertCircle,
  Users,
  RefreshCw,
  Eye,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ApiService } from "@/services/apiService";
import AppointmentService from "@/services/appointmentService";
import AppointmentTransactionService from "@/services/appointmentTransactionService";

interface Staff {
  id: string | number;
  name: string;
  employee_code?: string;
  department?: string;
  specialization?: string;
  skills?: string[];
  status: "available" | "busy" | "off-duty";
  current_appointments?: number;
  max_appointments?: number;
  rating?: number;
  experience_years?: number;
}

interface Service {
  id: string | number;
  name: string;
  duration: number; // in minutes
  price: number;
  category?: string;
  required_skills?: string[];
}

interface Appointment {
  id: string | number;
  appointment_id?: string;
  customer_name: string;
  customer_phone?: string;
  appointment_date: string;
  slot_from: string;
  slot_to: string;
  services: Service[];
  status: "pending" | "assigned" | "confirmed" | "in-progress" | "completed" | "cancelled";
  staff_id?: string | number;
  staff_name?: string;
  priority: "low" | "medium" | "high";
  special_requirements?: string;
  total_amount: number;
  created_at: string;
  estimated_duration: number;
}

interface Assignment {
  appointment_id: string | number;
  staff_id: string | number;
  notes?: string;
}

export default function AppointmentAssignment() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [filteredAppointments, setFilteredAppointments] = useState<Appointment[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [showAppointmentDetails, setShowAppointmentDetails] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [assignmentNotes, setAssignmentNotes] = useState("");
  
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Date range filter
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  // Sorting & Pagination
  type SortKey = "appointment_id" | "customer_name" | "date" | "staff_name" | "amount";
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  
  // Initialize default date range to today for compact dataset
  useEffect(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    if (!fromDate) setFromDate(today);
    if (!toDate) setToDate(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load employees (staff) and appointments from backend
  useEffect(() => {
    const loadData = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      setIsLoading(true);
      try {
        // 1) Load employees from master_employee
        const empResp: any = await ApiService.post("/read", {
          account_code: user.account_code,
          retail_code: user.retail_code,
          tables: ["master_employee"],
        });
        if (empResp?.success) {
          const raw = empResp.data;
          const empData = Array.isArray(raw)
            ? raw
            : (raw?.master_employee || raw?.employee || raw?.employees || []);
          const mappedStaff: Staff[] = (empData as any[]).map((emp: any) => ({
            id: emp.employee_id || emp.id,
            name: emp.employee_name || emp.name || "Unknown",
            employee_code: emp.employee_code,
            department: emp.department,
            specialization: emp.designation,
            skills: [],
            status: (String(emp.status || "").toLowerCase().includes("inactive") ? "off-duty" : "available") as Staff["status"],
            current_appointments: 0,
            max_appointments: 6,
            rating: undefined,
            experience_years: undefined,
          }));
          setStaff(mappedStaff);
        }
        // 2) Load appointments from 3-table API to get services and totals
        const txRows = await AppointmentTransactionService.fetchAppointments(
          user.account_code,
          user.retail_code,
          fromDate || undefined,
          toDate || undefined,
        );

        const toTimeHHMM = (t?: string) => {
          if (!t) return "";
          const m = String(t).match(/^(\d{2}):(\d{2})/);
          return m ? `${m[1]}:${m[2]}` : t;
        };
        const mapped: Appointment[] = (txRows as any[]).map((r: any) => {
          // Services come from summary items
          const services: Service[] = Array.isArray(r.services)
            ? r.services.map((s: any, idx: number) => ({
                id: s.service_id ?? idx + 1,
                name: s.service_name || s.name || "Service",
                duration: Number(s.duration_minutes || s.duration || 0),
                price: Number(s.unit_price || s.price || 0),
                category: s.category,
                required_skills: [],
              }))
            : [];

          const status = (String(r.status || "pending").toLowerCase() as Appointment["status"]) || "pending";
          const priority: Appointment["priority"] = Number(r.total_amount || r.grand_total || 0) >= 1500
            ? "high"
            : Number(r.total_amount || r.grand_total || 0) >= 800
            ? "medium"
            : "low";
          const dur = services.reduce((a, s) => a + (s.duration || 0), 0);
          return {
            id: r.appointment_id || Math.random().toString(36).slice(2),
            appointment_id: r.appointment_id,
            customer_name: r.customer_name || "",
            customer_phone: r.customer_phone || r.customer_mobile || "",
            appointment_date: r.appointment_date || "",
            slot_from: toTimeHHMM(r.slot_from || ""),
            slot_to: toTimeHHMM(r.slot_to || ""),
            services,
            status,
            staff_id: r.employee_id || r.staff_id,
            staff_name: r.staff_name || r.employee_name,
            priority,
            special_requirements: r.special_requirements || "",
            total_amount: Number(r.total_amount || r.grand_total || 0),
            created_at: r.created_at || new Date().toISOString(),
            estimated_duration: dur,
          };
        });
        setAppointments(mapped);
      } catch (e) {
        console.error("Failed to load data:", e);
        toast({ title: "Error", description: "Failed to load appointments", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [user, fromDate, toDate]);

  // Filter appointments based on search and filters
  useEffect(() => {
    let filtered = appointments;

    if (searchTerm) {
      filtered = filtered.filter(
        (appointment) =>
          appointment.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          appointment.appointment_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          appointment.customer_phone?.includes(searchTerm)
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((appointment) => appointment.status === statusFilter);
    }

    // Priority filter removed

    // Date range filter (inclusive)
    if (fromDate || toDate) {
      const start = fromDate || "0000-01-01";
      const end = toDate || "9999-12-31";
      filtered = filtered.filter((appointment) => {
        const d = appointment.appointment_date || "";
        return d >= start && d <= end;
      });
    }

    // Sorting
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = (() => {
        switch (sortKey) {
          case "appointment_id": return String(a.appointment_id || "");
          case "customer_name": return String(a.customer_name || "");
          case "date": return new Date(`${a.appointment_date} ${a.slot_from || '00:00'}`).getTime();
          case "staff_name": return String(a.staff_name || "");
          case "amount": return Number(a.total_amount || 0);
        }
      })();
      const bv = (() => {
        switch (sortKey) {
          case "appointment_id": return String(b.appointment_id || "");
          case "customer_name": return String(b.customer_name || "");
          case "date": return new Date(`${b.appointment_date} ${b.slot_from || '00:00'}`).getTime();
          case "staff_name": return String(b.staff_name || "");
          case "amount": return Number(b.total_amount || 0);
        }
      })();
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    // Reset to first page when filters or sorting change
    setPage(1);
    setFilteredAppointments(sorted);
  }, [appointments, searchTerm, statusFilter, fromDate, toDate, sortKey, sortDir]);

  const pagedAppointments = (() => {
    const start = (page - 1) * pageSize;
    return filteredAppointments.slice(start, start + pageSize);
  })();
  const totalPages = Math.max(1, Math.ceil(filteredAppointments.length / pageSize));
  const goToPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)));

  const getRecommendedStaff = (appointment: Appointment): Staff[] => {
    // Compute current assigned counts from appointments for the day
    const counts = new Map<string, number>();
    appointments.forEach((apt) => {
      if (apt.staff_id && ["assigned", "confirmed", "in-progress"].includes(apt.status)) {
        const key = String(apt.staff_id);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    const requiredSkills = appointment.services.flatMap(service => service.required_skills || []);
    const withLoad = staff.map((m) => ({
      ...m,
      current_appointments: counts.get(String(m.id)) || 0,
      max_appointments: m.max_appointments || 6,
    }));
    return withLoad
      .filter(member => 
        member.status !== "off-duty" &&
        (member.current_appointments || 0) < (member.max_appointments || 6) &&
        (requiredSkills.length === 0 || requiredSkills.some(skill => member.skills?.includes(skill)))
      )
      .sort((a, b) => {
        // Sort by availability (fewer current appointments first)
        const aAvailability = ((a.max_appointments || 6) - (a.current_appointments || 0)) / (a.max_appointments || 6);
        const bAvailability = ((b.max_appointments || 6) - (b.current_appointments || 0)) / (b.max_appointments || 6);
        const aDiff = bAvailability - aAvailability;
        if (Math.abs(aDiff) < 0.1) {
          return (b.rating || 0) - (a.rating || 0);
        }
        return aDiff;
      });
  };

  const handleAssignStaff = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setSelectedStaff("");
    setAssignmentNotes("");
    setShowAssignmentDialog(true);
  };

  const handleSaveAssignment = async () => {
    if (!selectedAppointment || !selectedStaff) {
      toast({
        title: "Error",
        description: "Please select a staff member",
        variant: "destructive",
      });
      return;
    }

    const staffMember = staff.find(s => s.id.toString() === selectedStaff);
    if (!staffMember) return;

    try {
      if (!user?.account_code || !user?.retail_code) throw new Error("Missing account/retail context");
      // Persist to backend using appointment_id (do not force status change)
      await AppointmentService.update(
        user.account_code,
        user.retail_code,
        { appointment_id: selectedAppointment.appointment_id },
        {
          staff_id: String(selectedStaff),
          staff_name: staffMember.name,
          updated_at: new Date().toISOString(),
        }
      );

      // Update local list
      setAppointments(prev => 
        prev.map(apt => 
          apt.id === selectedAppointment.id
            ? {
                ...apt,
                staff_id: selectedStaff,
                staff_name: staffMember.name,
              }
            : apt
        )
      );
      
      toast({
        title: "Success",
        description: `Appointment assigned to ${staffMember.name}`,
      });
      setShowAssignmentDialog(false);
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message || "Could not assign staff", variant: "destructive" });
    }
  };

  const handleUnassignStaff = async (appointment: Appointment) => {
    if (!appointment.staff_id) return;
    try {
      if (!user?.account_code || !user?.retail_code) throw new Error("Missing account/retail context");
      await AppointmentService.update(
        user.account_code,
        user.retail_code,
        { appointment_id: appointment.appointment_id },
        { staff_id: null as any, staff_name: "", updated_at: new Date().toISOString() }
      );

      setAppointments(prev => 
        prev.map(apt => 
          apt.id === appointment.id
            ? {
                ...apt,
                staff_id: undefined,
                staff_name: undefined,
              }
            : apt
        )
      );
      toast({ title: "Success", description: "Staff assignment removed" });
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message || "Could not unassign staff", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { color: "bg-yellow-100 text-yellow-800", label: "Pending", icon: Clock },
      assigned: { color: "bg-blue-100 text-blue-800", label: "Assigned", icon: UserCheck },
      confirmed: { color: "bg-green-100 text-green-800", label: "Confirmed", icon: CheckCircle },
      "in-progress": { color: "bg-purple-100 text-purple-800", label: "In Progress", icon: RefreshCw },
      completed: { color: "bg-green-100 text-green-800", label: "Completed", icon: CheckCircle },
      cancelled: { color: "bg-red-100 text-red-800", label: "Cancelled", icon: AlertCircle },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const IconComponent = config.icon;
    
    return (
      <Badge className={`${config.color} border-0 flex items-center gap-1`}>
        <IconComponent className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  // Removed Priority badge renderer per request

  const getStaffStatusBadge = (status: string) => {
    const statusConfig = {
      available: { color: "bg-green-100 text-green-800", label: "Available" },
      busy: { color: "bg-yellow-100 text-yellow-800", label: "Busy" },
      "off-duty": { color: "bg-red-100 text-red-800", label: "Off Duty" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.available;
    return (
      <Badge className={`${config.color} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const pendingAppointments = filteredAppointments.filter(apt => apt.status === "pending").length;
  const assignedAppointments = filteredAppointments.filter(apt => !!(apt.staff_id || apt.staff_name)).length;
  const availableStaff = staff.filter(member => member.status === "available").length;
  const totalAppointments = filteredAppointments.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Calendar className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Appointment Assignment</h1>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/staff")}
              className="h-8 text-xs"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back
            </Button>
          </div>

          {/* Inline Filters (single row; wraps on small screens) */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
              <Input
                placeholder="Search appointments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 border-slate-200 rounded-lg bg-white text-xs"
              />
            </div>

            <div className="w-full sm:w-auto sm:min-w-[160px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-full sm:w-40 rounded-lg border-slate-200 bg-white text-xs font-normal px-3">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">From</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 rounded-lg border-slate-200 bg-white text-xs"
              />
            </div>

            <span className="text-slate-400">→</span>

            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">To</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 rounded-lg border-slate-200 bg-white text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Appointments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{totalAppointments}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Pending Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{pendingAppointments}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Assigned</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{assignedAppointments}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Available Staff</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{availableStaff}</div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="border border-slate-200 shadow-sm bg-white">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-slate-900">Appointments</CardTitle>
              <div className="text-xs text-slate-500">
                Showing {(filteredAppointments.length === 0) ? 0 : ((page - 1) * pageSize + 1)}-{Math.min(page * pageSize, filteredAppointments.length)} of {filteredAppointments.length}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
          {/* Mobile Cards View */}
          <div className="block lg:hidden space-y-3">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin mr-2 text-gray-500" />
                <span className="text-gray-500">Loading appointments...</span>
              </div>
            )}
            {!isLoading && filteredAppointments.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No appointments found for the selected filters
              </div>
            )}
            {!isLoading && pagedAppointments.map((appointment) => (
              <Card key={appointment.id} className="border border-gray-200 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium text-sm text-gray-900">{appointment.appointment_id}</div>
                      <div className="text-xs text-gray-500">₹{appointment.total_amount}</div>
                    </div>
                    <div className="text-right">
                      {getStatusBadge(appointment.status)}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{appointment.customer_name}</div>
                      <div className="text-xs text-gray-500">{appointment.customer_phone}</div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-gray-400" />
                        <span>{appointment.appointment_date ? format(new Date(appointment.appointment_date), "MMM dd") : ""}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-gray-400" />
                        <span>{appointment.slot_from} - {appointment.slot_to}</span>
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Services:</div>
                      <div className="space-y-1">
                        {appointment.services.slice(0, 2).map((service, index) => (
                          <div key={index} className="text-xs text-gray-900">{service.name}</div>
                        ))}
                        {appointment.services.length > 2 && (
                          <div className="text-xs text-gray-500">+{appointment.services.length - 2} more</div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <div>
                        {appointment.staff_name ? (
                          <div>
                            <div className="text-xs font-medium text-gray-900">{appointment.staff_name}</div>
                            <div className="text-xs text-green-600">Assigned</div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">Not assigned</span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedAppointment(appointment);
                            setShowAppointmentDetails(true);
                          }}
                          className="h-7 px-2 text-xs"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        {!appointment.staff_name && (
                          <Button
                            size="sm"
                            onClick={() => handleAssignStaff(appointment)}
                            className="h-7 px-2 text-xs"
                          >
                            Assign
                          </Button>
                        )}
                        {/* Unassign action removed per request */}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block overflow-x-auto rounded-lg border border-slate-200">
            <Table className="text-xs [&_th]:py-2 [&_th]:px-3 [&_td]:py-2 [&_td]:px-3">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="cursor-pointer select-none font-semibold text-slate-600" onClick={() => {
                    setSortKey(prev => prev === 'appointment_id' ? prev : 'appointment_id');
                    setSortDir(prev => sortKey === 'appointment_id' ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
                  }}>
                    <div className="flex items-center gap-1">
                      Appointment 
                      {sortKey === 'appointment_id' ? (
                        sortDir === 'asc' ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40"/>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none font-semibold text-slate-600" onClick={() => {
                    setSortKey(prev => prev === 'customer_name' ? prev : 'customer_name');
                    setSortDir(prev => sortKey === 'customer_name' ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
                  }}>
                    <div className="flex items-center gap-1">
                      Customer 
                      {sortKey === 'customer_name' ? (
                        sortDir === 'asc' ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40"/>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none font-semibold text-slate-600" onClick={() => {
                    setSortKey(prev => prev === 'date' ? prev : 'date');
                    setSortDir(prev => sortKey === 'date' ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
                  }}>
                    <div className="flex items-center gap-1">
                      Date & Time 
                      {sortKey === 'date' ? (
                        sortDir === 'asc' ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40"/>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600">Services</TableHead>
                  <TableHead className="cursor-pointer select-none font-semibold text-slate-600" onClick={() => {
                    setSortKey(prev => prev === 'staff_name' ? prev : 'staff_name');
                    setSortDir(prev => sortKey === 'staff_name' ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
                  }}>
                    <div className="flex items-center gap-1">
                      Assigned Staff 
                      {sortKey === 'staff_name' ? (
                        sortDir === 'asc' ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40"/>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <div className="flex items-center justify-center text-gray-500">
                        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                        Loading appointments...
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filteredAppointments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <div className="text-gray-500">No appointments found for the selected filters</div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && pagedAppointments.map((appointment) => (
                  <TableRow key={appointment.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div>
                        <div className="text-gray-900 leading-tight">{appointment.appointment_id}</div>
                        <div className="text-xs text-gray-500 leading-tight">₹{appointment.total_amount}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="text-gray-900 leading-tight">{appointment.customer_name}</div>
                        <div className="text-xs text-gray-500 leading-tight">{appointment.customer_phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="text-gray-900 leading-tight">{appointment.appointment_date ? format(new Date(appointment.appointment_date), "MMM dd, yyyy") : ""}</div>
                        <div className="text-xs text-gray-500 leading-tight">{appointment.slot_from} - {appointment.slot_to}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {appointment.services.slice(0, 2).map((service, index) => (
                          <div key={index} className="text-xs text-gray-900 leading-tight">{service.name}</div>
                        ))}
                        {appointment.services.length > 2 && (
                          <div className="text-xs text-gray-500">+{appointment.services.length - 2} more</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {appointment.staff_name ? (
                        <div>
                          <div className="text-gray-900 leading-tight">{appointment.staff_name}</div>
                          <div className="text-xs text-gray-500 leading-tight">Assigned</div>
                        </div>
                      ) : (
                        <span className="text-gray-500">Not assigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedAppointment(appointment);
                            setShowAppointmentDetails(true);
                          }}
                          className="h-7 px-2 text-xs"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        {!appointment.staff_name && (
                          <Button
                            size="sm"
                            onClick={() => handleAssignStaff(appointment)}
                            className="h-7 px-2 text-xs"
                          >
                            Assign
                          </Button>
                        )}
                        {/* Unassign action removed per request */}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs mt-3 px-1">
            <div className="text-center sm:text-left text-slate-600">
              Page {page} / {totalPages}
            </div>
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <label className="flex items-center gap-1">
                <span className="hidden sm:inline text-slate-600">Rows:</span>
                <select
                  className="border border-slate-200 rounded px-2 py-1 text-xs sm:text-sm bg-white"
                  value={pageSize}
                  onChange={(e)=> { const n = Number(e.target.value)||10; setPageSize(n); setPage(1); }}
                >
                  {[5,10,20,50].map(n => (<option key={n} value={n}>{n}</option>))}
                </select>
              </label>
              <Button size="sm" variant="outline" disabled={page===1} onClick={()=> setPage(p=> Math.max(1,p-1))} className="px-2 h-8">
                <ChevronLeft className="h-4 w-4"/>
              </Button>
              <div className="font-medium text-xs sm:text-sm text-slate-700">
                {page}
              </div>
              <Button size="sm" variant="outline" disabled={page===totalPages} onClick={()=> setPage(p=> Math.min(totalPages,p+1))} className="px-2 h-8">
                <ChevronRight className="h-4 w-4"/>
              </Button>
            </div>
          </div>
          </CardContent>
        </Card>
      </div>


      {/* Assignment Dialog */}
      <Dialog open={showAssignmentDialog} onOpenChange={setShowAssignmentDialog}>
        <DialogContent className="sm:max-w-[700px] w-full max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Assign Staff to Appointment</DialogTitle>
            <DialogDescription className="text-sm">
              Select the best staff member for this appointment based on skills and availability.
            </DialogDescription>
          </DialogHeader>
          
          {selectedAppointment && (
            <div className="space-y-4">
              {/* Appointment Details */}
              <div className="bg-gray-50 p-3 sm:p-4 rounded-lg">
                <h4 className="font-medium mb-2 text-sm sm:text-base">Appointment Details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                  <div>
                    <span className="font-medium">Customer:</span> {selectedAppointment.customer_name}
                  </div>
                  <div>
                    <span className="font-medium">Date:</span> {format(new Date(selectedAppointment.appointment_date), "MMM dd, yyyy")}
                  </div>
                  <div>
                    <span className="font-medium">Time:</span> {selectedAppointment.slot_from} - {selectedAppointment.slot_to}
                  </div>
                  <div>
                    <span className="font-medium">Duration:</span> {selectedAppointment.estimated_duration} minutes
                  </div>
                </div>
                <div className="mt-2">
                  <span className="font-medium">Services:</span>
                  <div className="mt-1 space-y-1">
                    {selectedAppointment.services.map((service, index) => (
                      <div key={index} className="text-sm">
                        • {service.name}
                        {Number(service.duration) > 0 && service.price != null ? (
                          <> ({service.duration} - ₹{service.price})</>
                        ) : service.price != null ? (
                          <> (₹{service.price})</>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
                {selectedAppointment.special_requirements && (
                  <div className="mt-2">
                    <span className="font-medium">Special Requirements:</span>
                    <p className="text-sm mt-1">{selectedAppointment.special_requirements}</p>
                  </div>
                )}
              </div>

              {/* Staff Selection */}
              <div>
                <Label htmlFor="staff" className="text-sm">Select Staff Member</Label>
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Choose staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {getRecommendedStaff(selectedAppointment).map((member) => (
                      <SelectItem key={member.id} value={member.id.toString()}>
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <div className="font-medium text-sm">{member.name}</div>
                            <div className="text-xs text-gray-500">
                              {member.specialization || member.department || ""} • {(member.current_appointments ?? 0)}/{member.max_appointments ?? 6} appointments
                            </div>
                          </div>
                          <div className="ml-4">
                            {getStaffStatusBadge(member.status)}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Assignment Notes */}
              <div>
                <Label htmlFor="notes" className="text-sm">Assignment Notes (Optional)</Label>
                <Textarea
                  value={assignmentNotes}
                  onChange={(e) => setAssignmentNotes(e.target.value)}
                  placeholder="Add any special instructions or notes..."
                  rows={3}
                  className="mt-2 text-sm"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAssignmentDialog(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button onClick={handleSaveAssignment} className="w-full sm:w-auto">
              Assign Staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Appointment Details Dialog */}
      <Dialog open={showAppointmentDetails} onOpenChange={setShowAppointmentDetails}>
        <DialogContent className="sm:max-w-[600px] w-full max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Appointment Details</DialogTitle>
          </DialogHeader>
          
          {selectedAppointment && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <Label className="text-sm">Appointment ID</Label>
                  <p className="text-sm font-medium mt-1">{selectedAppointment.appointment_id}</p>
                </div>
                <div>
                  <Label className="text-sm">Status</Label>
                  <div className="mt-1">{getStatusBadge(selectedAppointment.status)}</div>
                </div>
                <div>
                  <Label className="text-sm">Customer</Label>
                  <p className="text-sm font-medium mt-1">{selectedAppointment.customer_name}</p>
                </div>
                <div>
                  <Label className="text-sm">Phone</Label>
                  <p className="text-sm font-medium mt-1">{selectedAppointment.customer_phone}</p>
                </div>
                <div>
                  <Label className="text-sm">Date</Label>
                  <p className="text-sm font-medium mt-1">
                    {format(new Date(selectedAppointment.appointment_date), "MMM dd, yyyy")}
                  </p>
                </div>
                <div>
                  <Label className="text-sm">Time</Label>
                  <p className="text-sm font-medium mt-1">
                    {selectedAppointment.slot_from} - {selectedAppointment.slot_to}
                  </p>
                </div>
                <div>
                  <Label className="text-sm">Total Amount</Label>
                  <p className="text-sm font-medium mt-1">₹{selectedAppointment.total_amount}</p>
                </div>
              </div>

              <div>
                <Label className="text-sm">Services</Label>
                <div className="mt-2 space-y-2">
                  {selectedAppointment.services.map((service, index) => (
                    <div key={index} className="flex justify-between p-2 bg-gray-50 rounded text-sm">
                      <div>
                        <div className="font-medium">{service.name}</div>
                        {Number(service.duration) > 0 ? (
                          <div className="text-xs text-gray-500">{service.duration} min</div>
                        ) : null}
                      </div>
                      <div className="font-medium">₹{service.price}</div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedAppointment.staff_name && (
                <div>
                  <Label className="text-sm">Assigned Staff</Label>
                  <p className="text-sm font-medium mt-1">{selectedAppointment.staff_name}</p>
                </div>
              )}

              {selectedAppointment.special_requirements && (
                <div>
                  <Label className="text-sm">Special Requirements</Label>
                  <p className="text-sm mt-1">{selectedAppointment.special_requirements}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAppointmentDetails(false)} className="w-full sm:w-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}