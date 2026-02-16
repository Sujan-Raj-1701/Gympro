import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format, addDays, subDays, eachDayOfInterval, startOfDay, endOfDay } from "date-fns";
import {
  CalendarIcon,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  ArrowLeft,
  Search,
  Calendar as CalendarIcon2,
  FileText,
  BarChart3,
  FileSpreadsheet,
  ChevronDown,
  CalendarDays,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { ApiService } from "@/services/apiService";
import { nowIST } from "@/lib/timezone";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Employee {
  id: string | number;
  name: string;
  employee_code?: string;
  department?: string;
  designation?: string;
  gender?: string;
  status?: number | boolean | string;
  skill_level?: string;
}

interface AttendanceRecord {
  id?: string | number;
  employee_id: string | number;
  employee_name: string;
  date: string;
  status: "present" | "absent" | "half-day" | "leave";
  check_in_time?: string;
  check_out_time?: string;
  remarks?: string;
}

const ATTENDANCE_STATUS_META: Record<
  AttendanceRecord["status"] | "default",
  { label: string; badgeClass: string; dotClass: string }
> = {
  present: {
    label: "Present",
    badgeClass: "border border-emerald-200 bg-emerald-50 text-emerald-600",
    dotClass: "bg-emerald-500",
  },
  absent: {
    label: "Absent",
    badgeClass: "border border-rose-200 bg-rose-50 text-rose-600",
    dotClass: "bg-rose-500",
  },
  "half-day": {
    label: "Half Day",
    badgeClass: "border border-amber-200 bg-amber-50 text-amber-600",
    dotClass: "bg-amber-500",
  },
  leave: {
    label: "On Leave",
    badgeClass: "border border-sky-200 bg-sky-50 text-sky-600",
    dotClass: "bg-sky-500",
  },
  default: {
    label: "Not Marked",
    badgeClass: "border border-slate-200 bg-slate-50 text-slate-600",
    dotClass: "bg-slate-400",
  },
};

export default function StaffAttendance() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  type GenderFilter = "all" | "male" | "female" | "other";
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Date-wise grid state
  const [fromDate, setFromDate] = useState<Date>(subDays(new Date(), 6));
  const [toDate, setToDate] = useState<Date>(new Date());
  const [dateWiseAttendance, setDateWiseAttendance] = useState<Record<string, AttendanceRecord[]>>({});
  const [isGridLoading, setIsGridLoading] = useState(false);

  // Store Leave Days state
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [leaveMonth, setLeaveMonth] = useState<string>(format(new Date(), "yyyy-MM"));
  const [storeLeaves, setStoreLeaves] = useState<Record<string, Set<string>>>({});
  const [leaveLoading, setLeaveLoading] = useState(false);

  // Grid visibility state
  const [showDateGrid, setShowDateGrid] = useState(false);

  // Time change dialog state
  const [showTimeDialog, setShowTimeDialog] = useState(false);
  const [timeDialogEmployee, setTimeDialogEmployee] = useState<{
    employeeId: string | number;
    employeeName: string;
  } | null>(null);
  const [timeDialogCheckIn, setTimeDialogCheckIn] = useState<string>("");
  const [timeDialogCheckOut, setTimeDialogCheckOut] = useState<string>("");
  const [timeDialogSaving, setTimeDialogSaving] = useState(false);

  // Load employees from master_employee
  useEffect(() => {
    const loadEmployees = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      setIsLoading(true);
      try {
        const response: any = await ApiService.post("/read", {
          account_code: user.account_code,
          retail_code: user.retail_code,
          tables: ["master_employee"],
        });

        if (response?.success) {
          const raw = response.data;
          // Backend returns:
          // - Single table -> data as an array
          // - Multiple tables -> data as an object { tableName: rows }
          const empData = Array.isArray(raw)
            ? raw
            : (raw?.master_employee || raw?.employee || raw?.employees || []);
          const mapped: Employee[] = (empData as any[])
            .map((emp: any) => ({
              id: emp.employee_id || emp.id,
              name: emp.employee_name || emp.name || "Unknown",
              employee_code: emp.employee_code,
              department: emp.department,
              designation: emp.designation,
              gender: emp.gender,
              status: emp.status,
              skill_level: emp.skill_level,
            }))
            .filter((emp: Employee) => {
              // Filter to show only active employees
              // status can be boolean (true/false) or number (1/0) or string
              if (typeof emp.status === 'boolean') {
                return emp.status === true;
              }
              if (typeof emp.status === 'number') {
                return emp.status === 1;
              }
              if (typeof emp.status === 'string') {
                const statusStr = emp.status.toLowerCase();
                return statusStr === 'active' || statusStr === '1';
              }
              // If status is undefined or null, assume inactive
              return false;
            });
          setEmployees(mapped);
        }
      } catch (error) {
        console.error("Failed to load employees:", error);
        toast({
          title: "Error",
          description: "Failed to load employee data",
          className: "border-yellow-200 bg-yellow-50 text-yellow-900",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadEmployees();
  }, [user]);

  // Load attendance records from backend for the selected date
  useEffect(() => {
    const loadAttendance = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      
      try {
        const dateStr = format(selectedDate, "yyyy-MM-dd");
        // Fetch existing rows for this date
        const fetched: any = await ApiService.post("/attendance/by-date", {
          account_code: user.account_code,
          retail_code: user.retail_code,
          attendance_date: dateStr,
          employee_ids: employees.map((e) => Number(e.id)).filter((n) => !Number.isNaN(n)),
        });

        const rows: any[] = Array.isArray(fetched?.data) ? fetched.data : [];
        // Map DB status to UI status
        const mapDbToUi = (s: string): AttendanceRecord["status"] => {
          const v = String(s || "").toLowerCase();
          if (v.startsWith("present")) return "present";
          if (v.startsWith("half")) return "half-day";
          return "absent";
        };

        const byEmp = new Map<string, any>();
        rows.forEach((r) => {
          const id = r.employee_id;
          byEmp.set(String(id), r);
        });

        const normalizeTimeHHMM = (t: any) => {
          if (t === null || t === undefined) return "";
          const s = String(t);
          if (!s) return "";
          return s.length >= 5 ? s.slice(0, 5) : s;
        };

        const records: AttendanceRecord[] = employees.map((emp) => {
          const row = byEmp.get(String(emp.id));
          return {
            employee_id: emp.id,
            employee_name: emp.name,
            date: dateStr,
            status: mapDbToUi(row?.status),
            check_in_time: normalizeTimeHHMM(row?.check_in_time ?? row?.CheckIn ?? row?.checkin ?? row?.check_in),
            check_out_time: normalizeTimeHHMM(row?.check_out_time ?? row?.CheckOut ?? row?.checkout ?? row?.check_out),
            remarks: row?.remarks || "",
          };
        });

        setAttendance(records);
      } catch (error) {
        console.error("Failed to load attendance:", error);
      }
    };

    if (employees.length > 0) {
      loadAttendance();
    }
  }, [employees, selectedDate, user]);

  // Load date-wise attendance for grid
  useEffect(() => {
    const loadDateWiseAttendance = async () => {
      if (!user?.account_code || !user?.retail_code || employees.length === 0) return;
      
      setIsGridLoading(true);
      try {
        const dateRange = eachDayOfInterval({ start: fromDate, end: toDate });
        const attendanceByDate: Record<string, AttendanceRecord[]> = {};

        // Fetch attendance for each date in the range
        for (const date of dateRange) {
          const dateStr = format(date, "yyyy-MM-dd");
          
          try {
            const fetched: any = await ApiService.post("/attendance/by-date", {
              account_code: user.account_code,
              retail_code: user.retail_code,
              attendance_date: dateStr,
              employee_ids: employees.map((e) => Number(e.id)).filter((n) => !Number.isNaN(n)),
            });

            const rows: any[] = Array.isArray(fetched?.data) ? fetched.data : [];
            
            // Map DB status to UI status
            const mapDbToUi = (s: string): AttendanceRecord["status"] => {
              const v = String(s || "").toLowerCase();
              if (v.startsWith("present")) return "present";
              if (v.startsWith("half")) return "half-day";
              return "absent";
            };

            const byEmp = new Map<string, any>();
            rows.forEach((r) => {
              const id = r.employee_id;
              byEmp.set(String(id), r);
            });

            const normalizeTimeHHMM = (t: any) => {
              if (t === null || t === undefined) return "";
              const s = String(t);
              if (!s) return "";
              return s.length >= 5 ? s.slice(0, 5) : s;
            };

            const records: AttendanceRecord[] = employees.map((emp) => {
              const row = byEmp.get(String(emp.id));
              return {
                employee_id: emp.id,
                employee_name: emp.name,
                date: dateStr,
                status: row ? mapDbToUi(row.status) : "absent",
                check_in_time: normalizeTimeHHMM(row?.check_in_time ?? row?.CheckIn ?? row?.checkin ?? row?.check_in),
                check_out_time: normalizeTimeHHMM(row?.check_out_time ?? row?.CheckOut ?? row?.checkout ?? row?.check_out),
                remarks: row?.remarks || "",
              };
            });

            attendanceByDate[dateStr] = records;
          } catch (error) {
            console.error(`Failed to load attendance for ${dateStr}:`, error);
            // Create default records for this date
            attendanceByDate[dateStr] = employees.map((emp) => ({
              employee_id: emp.id,
              employee_name: emp.name,
              date: dateStr,
              status: "absent" as AttendanceRecord["status"],
              check_in_time: "",
              check_out_time: "",
              remarks: "",
            }));
          }
        }

        setDateWiseAttendance(attendanceByDate);
      } catch (error) {
        console.error("Failed to load date-wise attendance:", error);
        toast({
          title: "Error",
          description: "Failed to load date-wise attendance data",
          className: "border-yellow-200 bg-yellow-50 text-yellow-900",
        });
      } finally {
        setIsGridLoading(false);
      }
    };

    loadDateWiseAttendance();
  }, [employees, fromDate, toDate, user]);

  // Load store leave days
  useEffect(() => {
    const loadStoreLeaves = async () => {
      if (!user?.account_code || !user?.retail_code) return;
      
      try {
        const currentMonth = format(selectedDate, "yyyy-MM");
        const resp: any = await ApiService.post('/store-leaves/get-month', {
          account_code: user.account_code,
          retail_code: user.retail_code,
          month: currentMonth,
        });
        
        if (resp?.success && resp?.data) {
          const dates = resp.data || [];
          setStoreLeaves(prev => ({
            ...prev,
            [currentMonth]: new Set(dates)
          }));
        }
      } catch (error) {
        console.error("Failed to load store leaves:", error);
      }
    };

    loadStoreLeaves();
  }, [user, selectedDate]);

  const statusSummary = useMemo(() => {
    const present = attendance.filter((r) => r.status === "present").length;
    const absent = attendance.filter((r) => r.status === "absent").length;
    const halfDay = attendance.filter((r) => r.status === "half-day").length;
    const leave = attendance.filter((r) => r.status === "leave").length;

    return {
      total: employees.length,
      present,
      absent,
      halfDay,
      leave,
    };
  }, [attendance, employees]);

  const employeeLookup = useMemo(() => {
    return new Map(employees.map((emp) => [String(emp.id), emp]));
  }, [employees]);

  // Filter attendance records
  const filteredRecords = useMemo(() => {
    return attendance.filter((record) => {
      const matchesSearch = record.employee_name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || record.status === statusFilter;
      const employee = employeeLookup.get(String(record.employee_id));
      const genderValue = String(employee?.gender || "").trim().toLowerCase();
      const genderKey = genderValue.startsWith("m")
        ? "male"
        : genderValue.startsWith("f")
          ? "female"
          : "other";
      const matchesGender = genderFilter === "all" || genderKey === genderFilter;
      return matchesSearch && matchesStatus && matchesGender;
    });
  }, [attendance, employeeLookup, genderFilter, searchQuery, statusFilter]);

  const selectedDateStr = useMemo(() => format(selectedDate, "yyyy-MM-dd"), [selectedDate]);

  const mapUiToDbStatus = (uiStatus: AttendanceRecord["status"]): string => {
    const mapStatus: Record<string, string> = {
      present: "Present",
      absent: "Absent",
      "half-day": "Half Day",
      leave: "Absent",
    };
    return mapStatus[uiStatus] || uiStatus;
  };

  const getNowHHMM = () => format(nowIST(), "HH:mm");

  const formatTime12h = (t?: string) => {
    const s = (t || "").trim();
    if (!s) return "--:--";
    // If already 12h with AM/PM, keep it.
    if (/\b(am|pm)\b/i.test(s)) return s;
    const base = s.slice(0, 8); // supports HH:mm or HH:mm:ss
    const parts = base.split(":");
    if (parts.length < 2) return s;
    const h = Number(parts[0]);
    const m = parts[1];
    if (Number.isNaN(h)) return s;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = ((h + 11) % 12) + 1;
    return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  const upsertAttendance = async (
    employeeId: string | number,
    patch: Partial<Pick<AttendanceRecord, "status" | "check_in_time" | "check_out_time" | "remarks">>
  ) => {
    if (!user?.account_code || !user?.retail_code) return;

    const current = attendance.find((r) => String(r.employee_id) === String(employeeId));
    const finalStatus = (patch.status || current?.status || "absent") as AttendanceRecord["status"];

    const payload: any = {
      account_code: user.account_code,
      retail_code: user.retail_code,
      employee_id: employeeId,
      attendance_date: selectedDateStr,
      status: mapUiToDbStatus(finalStatus),
    };
    if (patch.check_in_time !== undefined) payload.check_in_time = patch.check_in_time;
    if (patch.check_out_time !== undefined) payload.check_out_time = patch.check_out_time;
    if (patch.remarks !== undefined) payload.remarks = patch.remarks;

    await ApiService.post("/attendance/upsert", payload);
  };

  // Update attendance status
  const handleStatusChange = async (employeeId: string | number, newStatus: string) => {
    const prev = attendance;
    const now = getNowHHMM();
    const current = prev.find((r) => String(r.employee_id) === String(employeeId));

    // Determine check-in/check-out times based on status
    let checkInTime = current?.check_in_time;
    let checkOutTime = current?.check_out_time;

    if (newStatus === "present") {
      // Auto check-in if not already checked in
      if (!checkInTime) {
        checkInTime = now;
      }
    } else if (newStatus === "absent") {
      // Clear times when marking absent
      checkInTime = "";
      checkOutTime = "";
    } else if (newStatus === "half-day") {
      // Auto check-in for half-day if not already checked in
      if (!checkInTime) {
        checkInTime = now;
      }
    }

    // Optimistic UI update
    setAttendance((p) =>
      p.map((r) =>
        r.employee_id === employeeId
          ? { ...r, status: newStatus as AttendanceRecord["status"], check_in_time: checkInTime || "", check_out_time: checkOutTime || "" }
          : r
      )
    );

    try {
      const payload: Partial<Pick<AttendanceRecord, "status" | "check_in_time" | "check_out_time">> = {
        status: newStatus as AttendanceRecord["status"],
      };
      
      if (checkInTime !== undefined) payload.check_in_time = checkInTime;
      if (checkOutTime !== undefined) payload.check_out_time = checkOutTime;

      await upsertAttendance(employeeId, payload);
    } catch (e: any) {
      // Revert on failure
      setAttendance(prev);
      toast({ title: "Failed", description: e?.message || "Could not save attendance", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
    }
  };

  const handleCheckIn = async (employeeId: string | number) => {
    const prev = attendance;
    const now = getNowHHMM();

    setAttendance((p) =>
      p.map((r) => {
        if (String(r.employee_id) !== String(employeeId)) return r;
        const nextStatus: AttendanceRecord["status"] = r.status === "absent" ? "present" : r.status;
        return { ...r, status: nextStatus, check_in_time: r.check_in_time || now };
      })
    );

    try {
      const current = prev.find((r) => String(r.employee_id) === String(employeeId));
      const nextStatus: AttendanceRecord["status"] = current?.status === "absent" ? "present" : (current?.status || "present");
      await upsertAttendance(employeeId, { status: nextStatus, check_in_time: current?.check_in_time || now });
    } catch (e: any) {
      setAttendance(prev);
      toast({ title: "Failed", description: e?.message || "Could not check in", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
    }
  };

  const handleCheckOut = async (employeeId: string | number) => {
    const prev = attendance;
    const now = getNowHHMM();

    setAttendance((p) =>
      p.map((r) => {
        if (String(r.employee_id) !== String(employeeId)) return r;
        const nextStatus: AttendanceRecord["status"] = r.status === "absent" ? "present" : r.status;
        return { ...r, status: nextStatus, check_out_time: r.check_out_time || now };
      })
    );

    try {
      const current = prev.find((r) => String(r.employee_id) === String(employeeId));
      const nextStatus: AttendanceRecord["status"] = current?.status === "absent" ? "present" : (current?.status || "present");
      await upsertAttendance(employeeId, { status: nextStatus, check_out_time: current?.check_out_time || now });
    } catch (e: any) {
      setAttendance(prev);
      toast({ title: "Failed", description: e?.message || "Could not check out", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
    }
  };

  // Update check-in/check-out time
  const handleTimeChange = (
    employeeId: string | number,
    field: "check_in_time" | "check_out_time",
    value: string
  ) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.employee_id === employeeId
          ? { ...record, [field]: value }
          : record
      )
    );
  };

  const openTimeDialog = (record: AttendanceRecord) => {
    setTimeDialogEmployee({
      employeeId: record.employee_id,
      employeeName: record.employee_name,
    });
    setTimeDialogCheckIn(record.check_in_time || "");
    setTimeDialogCheckOut(record.check_out_time || "");
    setShowTimeDialog(true);
  };

  const saveTimeDialog = async () => {
    if (!timeDialogEmployee) return;
    const employeeId = timeDialogEmployee.employeeId;

    const prev = attendance;
    const nextCheckIn = (timeDialogCheckIn || "").trim();
    const nextCheckOut = (timeDialogCheckOut || "").trim();

    const current = prev.find((r) => String(r.employee_id) === String(employeeId));
    const hasAnyTime = Boolean(nextCheckIn) || Boolean(nextCheckOut);
    const nextStatus: AttendanceRecord["status"] = hasAnyTime
      ? (current?.status === "absent" ? "present" : (current?.status || "present"))
      : "absent";

    // Optimistic UI update
    setAttendance((p) =>
      p.map((r) =>
        String(r.employee_id) === String(employeeId)
          ? { ...r, status: nextStatus, check_in_time: nextCheckIn, check_out_time: nextCheckOut }
          : r
      )
    );

    setTimeDialogSaving(true);
    try {
      await upsertAttendance(employeeId, {
        status: nextStatus,
        check_in_time: nextCheckIn,
        check_out_time: nextCheckOut,
      });
      setShowTimeDialog(false);
      toast({
        title: "Updated",
        description: "Attendance time updated successfully",
      });
    } catch (e: any) {
      setAttendance(prev);
      toast({
        title: "Failed",
        description: e?.message || "Could not update time",
        className: "border-yellow-200 bg-yellow-50 text-yellow-900",
      });
    } finally {
      setTimeDialogSaving(false);
    }
  };

  // Save attendance
  const handleSaveAttendance = async () => {
    if (!user?.account_code || !user?.retail_code) return;

    setIsLoading(true);
    try {
      // TODO: Implement actual save to backend
      // await apiClient.post("/attendance/save", {
      //   account_code: user.account_code,
      //   retail_code: user.retail_code,
      //   attendance: attendance,
      // });

      toast({
        title: "Success",
        description: "Attendance saved successfully",
      });
    } catch (error) {
      console.error("Failed to save attendance:", error);
      toast({
        title: "Error",
        description: "Failed to save attendance",
        className: "border-yellow-200 bg-yellow-50 text-yellow-900",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Export attendance
  const handleExport = () => {
    const statusLabel = (status: AttendanceRecord["status"]) => {
      switch (status) {
        case "present":
          return "Present";
        case "absent":
          return "Absent";
        case "half-day":
          return "Half Day";
        case "leave":
          return "On Leave";
        default:
          return "Not Marked";
      }
    };

    const escapeCsv = (value: string | number | null | undefined) => {
      const stringValue = value === null || value === undefined ? "" : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    };

    const headers = [
      "Date",
      "Employee Name",
      "Employee Code",
      "Designation",
      "Department",
      "Gender",
      "Attendance Status",
      "Check In",
      "Check Out",
      "Remarks",
    ];

    const rows = filteredRecords.map((record) => {
      const employee = employeeLookup.get(String(record.employee_id));
      const formattedDate = record.date ? format(new Date(record.date), "yyyy-MM-dd") : format(selectedDate, "yyyy-MM-dd");

      return [
        formattedDate,
        record.employee_name,
        employee?.employee_code || "-",
        employee?.designation || "-",
        employee?.department || "-",
        employee?.gender || "-",
        statusLabel(record.status),
        record.check_in_time || "-",
        record.check_out_time || "-",
        record.remarks || "-",
      ];
    });

    const csvContent = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_${format(selectedDate, "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export ready",
      description: `Attendance sheet generated for ${format(selectedDate, "PPP")}`,
    });
  };

  // Date-wise grid report generation functions
  const generateDetailedReport = () => {
    const statusLabel = (status: AttendanceRecord["status"]) => {
      switch (status) {
        case "present": return "Present";
        case "absent": return "Absent";
        case "half-day": return "Half Day";
        case "leave": return "On Leave";
        default: return "Not Marked";
      }
    };

    const escapeCsv = (value: string | number | null | undefined) => {
      const stringValue = value === null || value === undefined ? "" : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    };

    const dateRange = eachDayOfInterval({ start: fromDate, end: toDate });
    const rows: string[][] = [];

    // Add date range info as first rows
    rows.push(["Report Period:", `From: ${format(fromDate, "dd/MM/yyyy")} To: ${format(toDate, "dd/MM/yyyy")}`]);
    rows.push([]); // Empty row for spacing

    // Add headers
    const headers = [
      "Employee Name",
      "Employee Code", 
      "Department",
      "Designation",
      "Date",
      "Day",
      "Status"
    ];

    const csvContent = [
      ...rows.map(row => row.map(escapeCsv).join(",")),
      headers.map(escapeCsv).join(","),
      ...employees.map(employee => {
        return dateRange.map(date => {
          const dateStr = format(date, "yyyy-MM-dd");
          const attendanceForDate = dateWiseAttendance[dateStr] || [];
          const record = attendanceForDate.find(r => String(r.employee_id) === String(employee.id));
          
          return [
            employee.name,
            employee.employee_code || "",
            employee.department || "",
            employee.designation || "",
            format(date, "dd/MM/yyyy"),
            format(date, "EEEE"),
            statusLabel(record?.status || "absent")
          ].map(escapeCsv).join(",");
        });
      }).flat()
    ].join("\n");

    downloadFile(csvContent, `detailed_attendance_${format(fromDate, "dd-MM-yyyy")}_to_${format(toDate, "dd-MM-yyyy")}.csv`, "text/csv");
    
    toast({
      title: "Detailed Report Generated",
      description: `Complete attendance details from ${format(fromDate, "dd MMM")} to ${format(toDate, "dd MMM")}`
    });
  };

  const generateSummaryReport = () => {
    const escapeCsv = (value: string | number | null | undefined) => {
      const stringValue = value === null || value === undefined ? "" : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    };

    const dateRange = eachDayOfInterval({ start: fromDate, end: toDate });
    const rows: string[][] = [];

    // Add date range info as first rows
    rows.push(["Report Period:", `From: ${format(fromDate, "dd/MM/yyyy")} To: ${format(toDate, "dd/MM/yyyy")}`]);
    rows.push([]); // Empty row for spacing

    // Add headers
    const headers = [
      "Employee Name",
      "Total Days",
      "Present Days",
      "Absent Days", 
      "Half Days",
      "Attendance %"
    ];

    // Calculate summary for each employee
    employees.forEach(employee => {
      let presentDays = 0;
      let absentDays = 0;
      let halfDays = 0;

      dateRange.forEach(date => {
        const dateStr = format(date, "yyyy-MM-dd");
        const attendanceForDate = dateWiseAttendance[dateStr] || [];
        const record = attendanceForDate.find(r => String(r.employee_id) === String(employee.id));
        const status = record?.status || "absent";

        if (status === "present") presentDays++;
        else if (status === "half-day") halfDays++;
        else absentDays++;
      });

      const totalDays = dateRange.length;
      const attendancePercentage = totalDays > 0 ? ((presentDays + halfDays * 0.5) / totalDays * 100).toFixed(1) : "0";

      rows.push([
        employee.name,
        totalDays.toString(),
        presentDays.toString(),
        absentDays.toString(),
        halfDays.toString(),
        `${attendancePercentage}%`
      ]);
    });

    const csvContent = [
      ...rows.slice(0, 2).map(row => row.map(escapeCsv).join(",")),
      headers.map(escapeCsv).join(","),
      ...rows.slice(2).map(row => row.map(escapeCsv).join(","))
    ].join("\n");

    downloadFile(csvContent, `attendance_summary_${format(fromDate, "dd-MM-yyyy")}_to_${format(toDate, "dd-MM-yyyy")}.csv`, "text/csv");
    
    toast({
      title: "Summary Report Generated",
      description: `Attendance summary from ${format(fromDate, "dd MMM")} to ${format(toDate, "dd MMM")}`
    });
  };

  const generateMatrixReport = () => {
    const escapeCsv = (value: string | number | null | undefined) => {
      const stringValue = value === null || value === undefined ? "" : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    };

    const dateRange = eachDayOfInterval({ start: fromDate, end: toDate });
    
    // Create initial rows with date range info
    const initialRows: string[][] = [];
    initialRows.push(["Report Period:", `From: ${format(fromDate, "dd/MM/yyyy")} To: ${format(toDate, "dd/MM/yyyy")}`]);
    initialRows.push([]); // Empty row for spacing
    
    // Create headers with dates
    const headers = [
      "Employee Name", 
      "Designation",
      ...dateRange.map(date => format(date, "EEE dd/MM"))
    ];

    const rows: string[][] = [];

    // Add data rows in matrix format
    employees.forEach(employee => {
      const row = [
        employee.name,
        employee.designation || employee.department || ""
      ];

      dateRange.forEach(date => {
        const dateStr = format(date, "yyyy-MM-dd");
        const currentMonth = format(date, "yyyy-MM");
        const isStoreLeave = storeLeaves[currentMonth]?.has(dateStr) || false;
        const attendanceForDate = dateWiseAttendance[dateStr] || [];
        const record = attendanceForDate.find(r => String(r.employee_id) === String(employee.id));
        const status = isStoreLeave ? "leave" : (record?.status || "absent");
        
        // Use single letter codes matching the grid
        const statusCode = status === "present" ? "P" 
                           : status === "half-day" ? "H" 
                           : status === "leave" ? "L" 
                           : "A";
        row.push(statusCode);
      });

      rows.push(row);
    });

    const csvContent = [
      ...initialRows.map(row => row.map(escapeCsv).join(",")),
      headers.map(escapeCsv).join(","),
      ...rows.map(row => row.map(escapeCsv).join(","))
    ].join("\n");

    downloadFile(csvContent, `attendance_matrix_${format(fromDate, "dd-MM-yyyy")}_to_${format(toDate, "dd-MM-yyyy")}.csv`, "text/csv");
    
    toast({
      title: "Matrix Report Generated",
      description: `Grid-style attendance matrix from ${format(fromDate, "dd MMM")} to ${format(toDate, "dd MMM")}`
    });
  };



  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Stats
  // Derived loading state for employee list
  const isEmployeesLoading = isLoading && employees.length === 0;

  return (
    <div className="min-h-screen space-y-2 bg-slate-50/80 p-3">
      <div className="rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm backdrop-blur">
        {/* Combined Header + Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Section: Title */}
          <h1 className="shrink-0 text-xl font-semibold text-gray-900">Staff Attendance</h1>

          {/* Middle Section: Search + Gender + Status Filters */}
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search team members"
                className="w-full rounded-xl border-slate-200 bg-white pl-9 text-sm shadow-inner"
              />
            </div>

            <div className="w-full sm:w-40">
              <Select value={genderFilter} onValueChange={(v) => setGenderFilter(v as GenderFilter)}>
                <SelectTrigger className="rounded-xl border-slate-200 bg-white text-sm shadow-inner">
                  <SelectValue placeholder="Gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All genders</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ToggleGroup
              type="single"
              value={statusFilter}
              onValueChange={(value) => value && setStatusFilter(value)}
              className="flex flex-wrap gap-1"
            >
              {(() => {
                const options = [
                  { value: "all", label: "All", count: statusSummary.total },
                  { value: "present", label: "Present", count: statusSummary.present },
                  { value: "absent", label: "Absent", count: statusSummary.absent },
                  { value: "half-day", label: "Half Day", count: statusSummary.halfDay },
                ];
                return options.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    className="h-9 rounded-full border border-slate-200 px-3 text-sm font-medium transition data-[state=on]:border-violet-300 data-[state=on]:bg-violet-50 data-[state=on]:text-violet-700"
                  >
                    <span>{option.label}</span>
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold leading-none text-slate-700 data-[state=on]:bg-violet-100 data-[state=on]:text-violet-800">
                      {option.count}
                    </span>
                  </ToggleGroupItem>
                ));
              })()}
            </ToggleGroup>
          </div>

          {/* Right Section: Date Picker + Back Button */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-start rounded-xl border-2 border-violet-300 bg-violet-50 text-left text-sm font-semibold text-violet-700 shadow-md hover:border-violet-400 hover:bg-violet-100"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="rounded-2xl border-slate-200 p-0 shadow-xl" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Button onClick={() => navigate(-1)} variant="outline" size="sm" className="rounded-xl border-slate-200">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        </div>
      </div>

      {/* Employee Cards or loading skeletons */}
      {isEmployeesLoading ? (
  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="rounded-xl border border-transparent bg-white shadow-sm">
              <CardContent className="p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="mt-2 flex gap-1">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-14 rounded-full" />
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {filteredRecords.map((record) => {
          const employee = employeeLookup.get(String(record.employee_id));
          if (!employee) return null;

          const genderValue = String(employee.gender || "").trim().toLowerCase();
          const genderBorderRingClass = genderValue.startsWith("m")
            ? "border-blue-200/60 ring-blue-100/40 hover:border-blue-300 hover:ring-blue-200/60"
            : genderValue.startsWith("f")
              ? "border-pink-200/60 ring-pink-100/40 hover:border-pink-300 hover:ring-pink-200/60"
              : "border-violet-200/50 ring-violet-100/40 hover:border-violet-300 hover:ring-violet-200/60";

          const initials = String(employee.name || "?")
            .split(" ")
            .map((part) => part.charAt(0))
            .slice(0, 2)
            .join("")
            .toUpperCase();

          const statusMeta = ATTENDANCE_STATUS_META[record.status] || ATTENDANCE_STATUS_META.default;

          return (
            <Card
              key={record.employee_id}
              className={`group relative overflow-hidden rounded-xl border-2 bg-white shadow-md transition-all duration-200 hover:shadow-lg ${genderBorderRingClass}`}
            >
              <CardContent className="p-3 space-y-3">
                {/* Header: Avatar, Name & Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 via-purple-400 to-indigo-500 text-sm font-bold text-white shadow-md ring-2 ring-white">
                      {initials || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">{employee.name}</p>
                      <p className="truncate text-xs text-slate-500">{employee.designation || employee.department || "Staff"}</p>
                    </div>
                  </div>
                  <Badge className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm ${statusMeta.badgeClass}`}>
                    {statusMeta.label}
                  </Badge>
                </div>

                {/* Status Toggle Buttons */}
                <div className="flex gap-1.5">
                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={record.status}
                    onValueChange={(value) => value && handleStatusChange(record.employee_id, value)}
                    className="flex w-full gap-1"
                  >
                    <ToggleGroupItem
                      value="present"
                      aria-label="Present"
                      className="flex-1 h-8 rounded-lg text-xs font-semibold transition-all border border-emerald-200 data-[state=on]:bg-emerald-500 data-[state=on]:text-white data-[state=on]:border-emerald-500 data-[state=off]:hover:bg-emerald-50"
                    >
                      <CheckCircle className="mr-1 h-3.5 w-3.5" />
                      Present
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="absent"
                      aria-label="Absent"
                      className="flex-1 h-8 rounded-lg text-xs font-semibold transition-all border border-rose-200 data-[state=on]:bg-rose-500 data-[state=on]:text-white data-[state=on]:border-rose-500 data-[state=off]:hover:bg-rose-50"
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" />
                      Absent
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="half-day"
                      aria-label="Half Day"
                      className="flex-1 h-8 rounded-lg text-xs font-semibold transition-all border border-amber-200 data-[state=on]:bg-amber-500 data-[state=on]:text-white data-[state=on]:border-amber-500 data-[state=off]:hover:bg-amber-50"
                    >
                      <Clock className="mr-1 h-3.5 w-3.5" />
                      Half
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {/* Time Display */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex flex-col gap-1 rounded-lg border border-emerald-100 bg-emerald-50/50 p-2">
                    <span className="text-[10px] font-semibold uppercase text-emerald-700">Check In</span>
                    <div className="flex items-center gap-1 text-emerald-900">
                      <Clock className="h-3 w-3" />
                      <span className="font-bold">{formatTime12h(record.check_in_time)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 rounded-lg border border-violet-100 bg-violet-50/50 p-2">
                    <span className="text-[10px] font-semibold uppercase text-violet-700">Check Out</span>
                    <div className="flex items-center gap-1 text-violet-900">
                      <Clock className="h-3 w-3" />
                      <span className="font-bold">{formatTime12h(record.check_out_time)}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckIn(record.employee_id)}
                    disabled={Boolean(record.check_in_time)}
                    className="flex-1 h-8 rounded-lg border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-slate-50"
                  >
                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                    Check In
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckOut(record.employee_id)}
                    disabled={!record.check_in_time || Boolean(record.check_out_time)}
                    className="flex-1 h-8 rounded-lg border-violet-300 bg-violet-50 text-violet-700 text-xs font-semibold hover:bg-violet-100 hover:border-violet-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-slate-50"
                  >
                    <Clock className="mr-1.5 h-3.5 w-3.5" />
                    Check Out
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openTimeDialog(record)}
                  className="h-8 w-full rounded-lg text-xs font-semibold"
                >
                  Change Time
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}

      <Dialog open={showTimeDialog} onOpenChange={setShowTimeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Attendance Time</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              {timeDialogEmployee?.employeeName || ""}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Check In</Label>
                <Input
                  type="time"
                  value={timeDialogCheckIn}
                  onChange={(e) => setTimeDialogCheckIn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Check Out</Label>
                <Input
                  type="time"
                  value={timeDialogCheckOut}
                  onChange={(e) => setTimeDialogCheckOut(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setShowTimeDialog(false)}
                disabled={timeDialogSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={saveTimeDialog}
                disabled={timeDialogSaving}
              >
                {timeDialogSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {!isEmployeesLoading && filteredRecords.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/80 py-10 text-center text-sm text-slate-500">
          <Users className="mb-3 h-8 w-8 text-slate-300" />
          <p>No team members match the current filters.</p>
        </div>
      )}

      {/* Date-wise Attendance Grid - Modern Expandable Design */}
      <Card className="rounded-2xl border border-slate-200/60 bg-gradient-to-r from-white via-violet-50/20 to-white shadow-lg backdrop-blur transition-all duration-300 hover:shadow-xl">
        {/* Clickable Header */}
        <div 
          onClick={() => setShowDateGrid(!showDateGrid)}
          className="group cursor-pointer select-none transition-all duration-300 hover:bg-gradient-to-r hover:from-violet-50/40 hover:via-indigo-50/20 hover:to-violet-50/40"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${
                  showDateGrid 
                    ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg' 
                    : 'bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-700 group-hover:from-violet-200 group-hover:to-indigo-200'
                }`}>
                  <CalendarIcon2 className="h-5 w-5" />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-violet-700 transition-colors duration-200">
                    Date-wise Attendance Grid
                  </h3>
                  <p className="text-sm text-slate-500 group-hover:text-slate-600 transition-colors duration-200">
                    {showDateGrid ? 'Click to collapse' : 'Click to expand attendance matrix'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className={`rounded-full px-3 py-1 text-xs font-medium transition-all duration-300 ${
                  showDateGrid 
                    ? 'bg-violet-100 text-violet-700 border border-violet-200' 
                    : 'bg-slate-100 text-slate-600 border border-slate-200 group-hover:bg-violet-50 group-hover:text-violet-600 group-hover:border-violet-200'
                }`}>
                  {format(fromDate, 'MMM dd')} - {format(toDate, 'MMM dd')}
                </div>
                <div className={`rounded-full p-2 transition-all duration-300 ${
                  showDateGrid 
                    ? 'bg-violet-100 text-violet-700' 
                    : 'bg-slate-100 text-slate-600 group-hover:bg-violet-100 group-hover:text-violet-700'
                }`}>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${showDateGrid ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </div>
          </CardContent>
        </div>

        {/* Expandable Controls Section */}
        {showDateGrid && (
          <div className="border-t border-slate-200/50 bg-gradient-to-r from-slate-50/50 via-white to-slate-50/50">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Date Range Controls */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">From:</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-[130px] justify-start rounded-xl border-slate-300 bg-white text-left text-sm shadow-sm hover:bg-violet-50 hover:border-violet-300 transition-all duration-200"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4 text-violet-600" />
                          {format(fromDate, "MMM dd, yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="rounded-2xl border-slate-200 p-0 shadow-xl" align="start">
                        <Calendar mode="single" selected={fromDate} onSelect={(date) => date && setFromDate(date)} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">To:</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-[130px] justify-start rounded-xl border-slate-300 bg-white text-left text-sm shadow-sm hover:bg-violet-50 hover:border-violet-300 transition-all duration-200"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4 text-violet-600" />
                          {format(toDate, "MMM dd, yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="rounded-2xl border-slate-200 p-0 shadow-xl" align="end">
                        <Calendar mode="single" selected={toDate} onSelect={(date) => date && setToDate(date)} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-xl border-slate-300 bg-white text-sm shadow-sm hover:bg-emerald-50 hover:border-emerald-300 transition-all duration-200">
                        <Download className="mr-2 h-4 w-4 text-emerald-600" />
                        Export Reports
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 rounded-xl border-slate-200 shadow-xl">
                      <DropdownMenuItem onClick={generateDetailedReport} className="rounded-lg p-3 hover:bg-slate-50">
                        <FileText className="mr-3 h-4 w-4 text-blue-600" />
                        <div>
                          <div className="font-medium text-slate-900">Detailed Report</div>
                          <div className="text-xs text-slate-500">Complete attendance with check-in/out times</div>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={generateSummaryReport} className="rounded-lg p-3 hover:bg-slate-50">
                        <BarChart3 className="mr-3 h-4 w-4 text-violet-600" />
                        <div>
                          <div className="font-medium text-slate-900">Summary Report</div>
                          <div className="text-xs text-slate-500">Employee-wise attendance statistics</div>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={generateMatrixReport} className="rounded-lg p-3 hover:bg-slate-50">
                        <FileSpreadsheet className="mr-3 h-4 w-4 text-emerald-600" />
                        <div>
                          <div className="font-medium text-slate-900">Matrix Report</div>
                          <div className="text-xs text-slate-500">Excel-style attendance grid (P/A/H)</div>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    onClick={() => {
                      setLeaveMonth(format(selectedDate, "yyyy-MM"));
                      setShowLeaveDialog(true);
                    }}
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-slate-300 bg-white text-sm shadow-sm hover:bg-amber-50 hover:border-amber-300 transition-all duration-200"
                  >
                    <CalendarDays className="mr-2 h-4 w-4 text-amber-600" />
                    Store Leaves
                  </Button>
                </div>
              </div>
            </CardContent>
          </div>
        )}

        {/* Expandable Grid Content */}
        {showDateGrid && (
          <div className="border-t border-slate-200/50 bg-gradient-to-b from-white to-slate-50/30 animate-in slide-in-from-top-2 duration-300">
            <CardContent className="p-4">
              {/* Grid Table */}
              {isGridLoading ? (
                <div className="space-y-3 rounded-xl bg-white p-4 shadow-inner">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              ) : (
                <div className="relative max-h-[70vh] overflow-auto rounded-2xl border border-slate-200/60 bg-white shadow-lg">
                  <table className="border-collapse" style={{ minWidth: '100%', width: 'max-content' }}>
                    <thead className="sticky top-0 z-30">
                      <tr className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-violet-50/30 to-slate-50">
                        <th className="sticky left-0 top-0 z-40 border-r border-slate-200/80 bg-gradient-to-r from-slate-50 via-violet-50/30 to-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-800">
                          Employee
                        </th>
                        {eachDayOfInterval({ start: fromDate, end: toDate }).map((date) => (
                          <th
                            key={format(date, "yyyy-MM-dd")}
                            className="sticky top-0 min-w-[80px] border-r border-slate-200 bg-gradient-to-r from-slate-50 via-violet-50/30 to-slate-50 px-2 py-2 text-center text-xs font-semibold text-slate-700"
                          >
                            <div className="flex flex-col">
                              <span className="text-xs">{format(date, "EEE")}</span>
                              <span className="text-xs text-slate-500">{format(date, "dd/MM")}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                  {employees.map((employee) => (
                    <tr key={employee.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 hover:bg-slate-50/50">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 via-white to-indigo-100 text-xs font-semibold text-violet-700">
                            {String(employee.name || "?")
                              .split(" ")
                              .map((part) => part.charAt(0))
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-900 truncate">{employee.name}</p>
                            <p className="text-xs text-slate-500 truncate">{employee.designation || employee.department || "---"}</p>
                          </div>
                        </div>
                      </td>
                      {eachDayOfInterval({ start: fromDate, end: toDate }).map((date) => {
                        const dateStr = format(date, "yyyy-MM-dd");
                        const currentMonth = format(date, "yyyy-MM");
                        const isStoreLeave = storeLeaves[currentMonth]?.has(dateStr) || false;
                        const attendanceForDate = dateWiseAttendance[dateStr] || [];
                        const employeeRecord = attendanceForDate.find(
                          (record) => String(record.employee_id) === String(employee.id)
                        );
                        const computedStatus = isStoreLeave ? "leave" : (employeeRecord?.status || "absent");
                        const statusMeta = ATTENDANCE_STATUS_META[computedStatus] || ATTENDANCE_STATUS_META.default;

                        return (
                          <td key={dateStr} className="border-r border-slate-200 px-2 py-2 text-center">
                            <div className="flex flex-col items-center justify-center">
                              <Badge
                                className={`text-xs font-medium ${statusMeta.badgeClass} ${isStoreLeave ? '' : 'cursor-pointer hover:opacity-80'}`}
                                onClick={() => {
                                  if (isStoreLeave) return; // do not toggle on store leave days
                                  // Handle status change for grid cells
                                  const currentStatus = employeeRecord?.status || "absent";
                                  let newStatus: AttendanceRecord["status"];
                                  
                                  if (currentStatus === "absent") newStatus = "present";
                                  else if (currentStatus === "present") newStatus = "half-day";
                                  else newStatus = "absent";

                                  const now = getNowHHMM();
                                  let nextCheckIn = employeeRecord?.check_in_time || "";
                                  let nextCheckOut = employeeRecord?.check_out_time || "";
                                  if (newStatus === "present" || newStatus === "half-day") {
                                    if (!nextCheckIn) nextCheckIn = now;
                                  } else if (newStatus === "absent") {
                                    nextCheckIn = "";
                                    nextCheckOut = "";
                                  }
                                  
                                  // Update the grid state
                                  setDateWiseAttendance(prev => {
                                    const updated = { ...prev };
                                    const dateRecords = [...(updated[dateStr] || [])];
                                    const recordIndex = dateRecords.findIndex(r => String(r.employee_id) === String(employee.id));
                                    
                                    if (recordIndex >= 0) {
                                      dateRecords[recordIndex] = {
                                        ...dateRecords[recordIndex],
                                        status: newStatus,
                                        check_in_time: nextCheckIn,
                                        check_out_time: nextCheckOut,
                                      };
                                    } else {
                                      dateRecords.push({
                                        employee_id: employee.id,
                                        employee_name: employee.name,
                                        date: dateStr,
                                        status: newStatus,
                                        check_in_time: nextCheckIn,
                                        check_out_time: nextCheckOut,
                                        remarks: "",
                                      });
                                    }
                                    
                                    updated[dateStr] = dateRecords;
                                    return updated;
                                  });

                                  // Save to backend
                                  const saveAttendance = async () => {
                                    try {
                                      const mapStatus: Record<string, string> = {
                                        present: "Present",
                                        absent: "Absent",
                                        "half-day": "Half Day",
                                      };
                                      
                                      await ApiService.post("/attendance/upsert", {
                                        account_code: user?.account_code,
                                        retail_code: user?.retail_code,
                                        employee_id: employee.id,
                                        attendance_date: dateStr,
                                        status: mapStatus[newStatus] || newStatus,
                                        check_in_time: nextCheckIn,
                                        check_out_time: nextCheckOut,
                                      });
                                    } catch (error) {
                                      console.error("Failed to save attendance:", error);
                                      toast({
                                        title: "Error",
                                        description: "Failed to save attendance",
                                        className: "border-yellow-200 bg-yellow-50 text-yellow-900",
                                      });
                                    }
                                  };
                                  
                                  saveAttendance();
                                }}
                              >
                                {computedStatus === "present" && <CheckCircle className="mr-1 h-2.5 w-2.5" />}
                                {computedStatus === "absent" && <XCircle className="mr-1 h-2.5 w-2.5" />}
                                {computedStatus === "half-day" && <Clock className="mr-1 h-2.5 w-2.5" />}
                                {computedStatus === "leave" && <CalendarDays className="mr-1 h-2.5 w-2.5" />}
                                {computedStatus === "present" && "P"}
                                {computedStatus === "absent" && "A"}
                                {computedStatus === "half-day" && "H"}
                                {computedStatus === "leave" && "L"}
                              </Badge>
                            </div>

                            <div className="mt-1 w-full space-y-0.5 text-[10px] font-medium text-slate-600">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-500">In</span>
                                <span className="text-slate-800">{formatTime12h(employeeRecord?.check_in_time)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-500">Out</span>
                                <span className="text-slate-800">{formatTime12h(employeeRecord?.check_out_time)}</span>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-600 text-xs">
                <CheckCircle className="mr-1 h-2.5 w-2.5" />P
              </Badge>
              <span className="text-slate-600">Present</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge className="border border-rose-200 bg-rose-50 text-rose-600 text-xs">
                <XCircle className="mr-1 h-2.5 w-2.5" />A
              </Badge>
              <span className="text-slate-600">Absent</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge className="border border-amber-200 bg-amber-50 text-amber-600 text-xs">
                <Clock className="mr-1 h-2.5 w-2.5" />H
              </Badge>
              <span className="text-slate-600">Half Day</span>
            </div>
          </div>
            </CardContent>
          </div>
        )}
      </Card>

      {/* Filters and Attendance Table removed as requested */}

      {/* Store Leave Dialog */}
      <StoreLeaveDialog
        open={showLeaveDialog}
        onOpenChange={setShowLeaveDialog}
        month={leaveMonth}
        setMonth={setLeaveMonth}
        currentSet={storeLeaves[leaveMonth]}
        isLoading={leaveLoading}
        onSave={async (dates: string[]) => {
          if (!user?.account_code || !user?.retail_code) return;
          setLeaveLoading(true);
          try {
            const payload = {
              account_code: user.account_code,
              retail_code: user.retail_code,
              month: leaveMonth,
              dates,
            };
            const resp: any = await ApiService.post('/store-leaves/save-month', payload);
            if (resp?.success) {
              setStoreLeaves((prev) => ({ ...prev, [leaveMonth]: new Set(dates) }));
              toast({
                title: 'Saved',
                description: 'Store leave days updated.',
              });
              setShowLeaveDialog(false);
            }
          } catch (e: any) {
            toast({
              title: 'Save failed',
              description: e?.message || String(e),
              variant: 'destructive',
            });
          } finally {
            setLeaveLoading(false);
          }
        }}
      />
    </div>
  );
}

// Store Leave Dialog Component
function StoreLeaveDialog({ open, onOpenChange, month, setMonth, currentSet, onSave, isLoading }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  month: string;
  setMonth: (v: string) => void;
  currentSet: Set<string> | undefined;
  onSave: (dates: string[]) => Promise<void>;
  isLoading: boolean;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    // initialize from currentSet
    const s = new Set<number>();
    if (currentSet) {
      for (const d of currentSet) {
        const parts = d.split("-");
        const day = parseInt(parts[2], 10);
        if (!isNaN(day)) s.add(day);
      }
    }
    setSel(s);
  }, [currentSet, month, open]);

  const daysInMonth = (() => {
    try { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); } catch { return 30; }
  })();
  const startWeekday = (() => {
    try { const [y, m] = month.split("-").map(Number); return new Date(y, m - 1, 1).getDay(); } catch { return 0; }
  })();
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const toggle = (d: number) => {
    setSel(prev => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  };

  const makeDates = (): string[] => {
    const [y, m] = month.split("-");
    return Array.from(sel).sort((a, b) => a - b).map(d => `${y}-${m}-${String(d).padStart(2, '0')}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[90vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Store Leave Days</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Month selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Label className="text-sm font-medium">Month</Label>
            <Input 
              className="h-10 text-sm w-full sm:w-[200px]" 
              type="month" 
              value={month} 
              onChange={(e) => setMonth(e.target.value)} 
            />
          </div>

          {/* Calendar section */}
          <div className="space-y-3">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 text-sm text-muted-foreground">
              {weekdayLabels.map((w) => (
                <div key={w} className="text-center py-2 font-medium">{w}</div>
              ))}
            </div>
            
            {/* Calendar grid with offset for first day */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startWeekday }).map((_, idx) => (
                <div key={`sp-${idx}`} className="h-10" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  onClick={() => toggle(d)}
                  className={`h-10 text-sm rounded-lg border text-center transition-colors ${
                    sel.has(d) 
                      ? 'bg-red-600 text-white border-red-600 hover:bg-red-700' 
                      : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}
                  title={`Mark ${d} as leave`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Selected dates summary */}
          {sel.size > 0 && (
            <div className="p-3 bg-red-50 rounded-lg">
              <div className="text-sm font-medium text-red-800 mb-1">
                Selected Leave Days ({sel.size})
              </div>
              <div className="text-sm text-red-700">
                {Array.from(sel).sort((a, b) => a - b).join(', ')}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-10">
              Close
            </Button>
            <Button 
              disabled={isLoading} 
              onClick={() => onSave(makeDates())} 
              className="h-10"
            >
              {isLoading ? 'Saving...' : 'Save Leave Days'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}