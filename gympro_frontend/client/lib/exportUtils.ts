import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { format } from "date-fns";
// Optional: use ExcelJS when we need true in-sheet dropdowns (data validation)
// We avoid importing upfront to keep bundle size lean; will dynamic-import when needed.

export interface ExportColumn {
  header: string;
  dataKey: string;
  width?: number;
}

export interface ExportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  data: any[];
  dateRange?: {
    from: Date;
    to: Date;
  };
  // Optional lookup lists to include in a separate sheet for data entry guidance
  lookups?: Record<string, string[]>; // e.g., { category_name: ['Food','Service','Spa'] }
  // Optional mapping from HSN Name/Code to Tax Name for auto-fill
  hsnTaxMap?: Array<{ hsn: string; tax: string }>;
}

export class ExportManager {
  static exportToPDF(options: ExportOptions) {
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    let yPosition = 14;

    // Professional compact header (no large banner)
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(options.title, 14, yPosition);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated: ${format(new Date(), "MMM dd, yyyy HH:mm")}`, pageWidth - 14, yPosition, { align: "right" });
    yPosition += 6;

    if (options.dateRange) {
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      const dateText = `Date: ${format(options.dateRange.from, "MMM dd, yyyy")} - ${format(options.dateRange.to, "MMM dd, yyyy")}`;
      doc.text(dateText, 14, yPosition);
      yPosition += 6;
    } else if (options.subtitle) {
      // If no date range, optionally show subtitle inline
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(options.subtitle, 14, yPosition);
      yPosition += 6;
    }

    // Prepare table data
    const tableColumns = options.columns.map((col) =>
      col.dataKey.includes("amount") ? `${col.header} (INR)` : col.header,
    );
    const amountIndex = options.columns.findIndex((c) => c.dataKey.includes("amount"));
    const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
    const tableRows = options.data.map((row) =>
      options.columns.map((col) => {
        const value = row[col.dataKey];
        if (value instanceof Date) {
          return format(value, "MMM dd, yyyy");
        }
        if (typeof value === "number" && col.dataKey.includes("amount")) {
          // Keep as plain number formatting without currency symbol to avoid glyph issues
          return numberFmt.format(value);
        }
        return String(value ?? "");
      }),
    );

    // Add table
    autoTable(doc, {
      head: [tableColumns],
      body: tableRows,
      startY: yPosition + 5,
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [41, 98, 255],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [245, 247, 250],
      },
      // Expand table to available width
      tableWidth: 'auto',
      columnStyles: options.columns.reduce(
        (acc, _col, index) => {
          if (index === amountIndex) acc[index] = { halign: 'right' } as any; // Right align amount
          return acc;
        },
        {} as Record<number, any>,
      ),
      margin: { top: 10, left: 14, right: 14 },
      didDrawPage: (data) => {
        // Add footer
        const footerY = pageHeight - 10;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Page ${data.pageNumber} of ${doc.getNumberOfPages()}`,
          pageWidth - 14,
          footerY,
          { align: "right" },
        );
        doc.text("CivixZo Management System", 14, footerY);
      },
    });

    // Add summary if numeric data exists
    const numericColumns = options.columns.filter((col) =>
      col.dataKey.includes("amount"),
    );
    if (numericColumns.length > 0) {
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text("Summary:", 14, finalY);

      const sumFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
      numericColumns.forEach((col, index) => {
        const total = options.data.reduce(
          (sum, row) => sum + (row[col.dataKey] || 0),
          0,
        );
        doc.text(
          `Total ${col.header} (INR): ${sumFmt.format(total)}`,
          14,
          finalY + 8 + index * 6,
        );
      });
    }

    // Save the PDF
    doc.save(`${options.filename}.pdf`);
  }

  static exportToExcel(options: ExportOptions) {
    // If lookups are provided and we need real Excel dropdowns, try ExcelJS path
    const needsValidation = !!(options.lookups && Object.keys(options.lookups).length > 0);
    if (needsValidation) {
      try {
        return ExportManager.exportToExcelWithValidation(options);
      } catch (e) {
        // Fallback to plain XLSX if ExcelJS is unavailable
        console.warn('ExcelJS export with validation failed; falling back to plain XLSX.', e);
      }
    }
    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Prepare data with headers
    const headers = options.columns.map((col) =>
      col.dataKey.includes("amount") ? `${col.header} (INR)` : col.header,
    );
    const data = [
      headers,
      ...options.data.map((row) =>
        options.columns.map((col) => {
          const value = row[col.dataKey];
          if (value instanceof Date) {
            return format(value, "MMM dd, yyyy");
          }
          if (typeof value === "number" && col.dataKey.includes("amount")) {
            return value; // Keep as number for Excel calculations
          }
          return value || "";
        }),
      ),
    ];

    // Add summary row if numeric data exists
    const numericColumns = options.columns.filter((col) =>
      col.dataKey.includes("amount"),
    );
    if (numericColumns.length > 0) {
      data.push([]); // Empty row
      data.push(["SUMMARY"]);
      numericColumns.forEach((col) => {
        const total = options.data.reduce(
          (sum, row) => sum + (row[col.dataKey] || 0),
          0,
        );
        const colIndex = options.columns.findIndex((c) => c === col);
        const summaryRow = new Array(options.columns.length).fill("");
        summaryRow[0] = `Total ${col.header}`;
        summaryRow[colIndex] = total;
        data.push(summaryRow);
      });
    }

    // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = options.columns.map((col) => ({
      wch: col.width || 15,
    }));
    ws["!cols"] = colWidths;

    // Style the header row
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellRef]) continue;
      ws[cellRef].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "2962FF" } },
        alignment: { horizontal: "center" },
      };
    }

    // Try to right-align numeric amount column cells (supported by some viewers)
    const amtColIndex = options.columns.findIndex((c) => c.dataKey.includes("amount"));
    if (amtColIndex >= 0) {
      for (let r = 1; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: amtColIndex });
        if (ws[cellRef]) {
          ws[cellRef].t = ws[cellRef].t || 'n';
          ws[cellRef].s = { ...(ws[cellRef].s || {}), alignment: { horizontal: "right" } } as any;
        }
      }
    }

    // Add main data sheet FIRST so it opens by default
    XLSX.utils.book_append_sheet(wb, ws, "Data");

    // Add metadata sheet SECOND
    const metaData = [
      ["Report Title", options.title],
      ["Generated On", format(new Date(), "MMM dd, yyyy HH:mm")],
      ["Total Records", options.data.length.toString()],
    ];

    if (options.dateRange) {
      metaData.push([
        "Date Range",
        `${format(options.dateRange.from, "MMM dd, yyyy")} - ${format(options.dateRange.to, "MMM dd, yyyy")}`,
      ]);
    }

    const metaWs = XLSX.utils.aoa_to_sheet(metaData);
    XLSX.utils.book_append_sheet(wb, metaWs, "Report Info");

    // Add a Lists sheet with lookup values to help users pick valid entries
    if (options.lookups && Object.keys(options.lookups).length > 0) {
      const listsAoA: any[][] = [];
      Object.entries(options.lookups).forEach(([key, values]) => {
        listsAoA.push([String(key)]);
        (values || []).forEach((v) => listsAoA.push([String(v)]));
        listsAoA.push([""]); // gap between lists
      });
      const listsWs = XLSX.utils.aoa_to_sheet(listsAoA);
      XLSX.utils.book_append_sheet(wb, listsWs, "Lists");
    }

    // Write file
    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, `${options.filename}.xlsx`);
  }

  // Build Excel with Data Validation dropdowns using ExcelJS
  static async exportToExcelWithValidation(options: ExportOptions) {
    const ExcelJS = await import(/* webpackChunkName: "exceljs-chunk" */ 'exceljs');
    const wb = new ExcelJS.Workbook();

    // Data sheet
    const ws = wb.addWorksheet('Data');
    const headers = options.columns.map((c) => c.header);
    ws.addRow(headers);
    options.data.forEach((row) => {
      ws.addRow(options.columns.map((c) => row[c.dataKey] instanceof Date ? format(row[c.dataKey], 'MMM dd, yyyy') : (row[c.dataKey] ?? '')));
    });

    // Column widths
    ws.columns = options.columns.map((c) => ({ width: (c.width ? Math.round(c.width/8) : 15) }));

    // Lists sheet
    const listsSheet = wb.addWorksheet('Lists');
    const namedRanges: Record<string, { sheet: string; startRow: number; endRow: number }> = {};
    if (options.lookups) {
      let currentRow = 1;
      for (const [key, values] of Object.entries(options.lookups)) {
        // Title row for readability
        listsSheet.getCell(currentRow, 1).value = key;
        currentRow++;
        const startRow = currentRow;
        values.forEach((v) => {
          listsSheet.getCell(currentRow, 1).value = v;
          currentRow++;
        });
        const endRow = currentRow - 1;
        namedRanges[key] = { sheet: 'Lists', startRow, endRow };
        currentRow++; // gap row
      }
    }

    // Add HSN→Tax mapping table when provided
    let hsnMapStart = { row: 1, col: 3 };
    let hsnMapRange: { hCol: string; tCol: string; startRow: number; endRow: number } | null = null;
    if (options.hsnTaxMap && options.hsnTaxMap.length > 0) {
      // Header
      listsSheet.getCell(hsnMapStart.row, hsnMapStart.col).value = 'HSN';
      listsSheet.getCell(hsnMapStart.row, hsnMapStart.col + 1).value = 'Tax';
      const startRow = hsnMapStart.row + 1;
      let r = startRow;
      options.hsnTaxMap.forEach((pair) => {
        listsSheet.getCell(r, hsnMapStart.col).value = pair.hsn;
        listsSheet.getCell(r, hsnMapStart.col + 1).value = pair.tax;
        r++;
      });
      const endRow = r - 1;
      // Record columns like C and D for range references
      const colLetter = (colIdx: number) => String.fromCharCode('A'.charCodeAt(0) + (colIdx - 1));
      const hCol = colLetter(hsnMapStart.col);
      const tCol = colLetter(hsnMapStart.col + 1);
      hsnMapRange = { hCol, tCol, startRow, endRow };
    }

    // Apply data validation for known columns when lookup is provided
    const headerIndexByKey: Record<string, number> = {};
    options.columns.forEach((c, idx) => {
      headerIndexByKey[c.dataKey] = idx + 1; // 1-based
    });

    const setValidationForColumn = (headerName: string, rangeNameKey: string) => {
      const colIdx = headers.findIndex((h) => h === headerName) + 1;
      const range = namedRanges[rangeNameKey];
      if (!colIdx || !range) return;
      const formula = `=${range.sheet}!$A$${range.startRow}:$A$${range.endRow}`;
      // Apply to rows 2..(data length + 1)
      for (let r = 2; r <= (options.data.length + 1); r++) {
        const cell = ws.getCell(r, colIdx);
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Invalid Selection',
          error: 'Please choose a value from the dropdown list.',
        } as any;
      }
    };

    // Common mapping: bind validation by header names
    if (options.lookups?.category_name) {
      setValidationForColumn('Category Name', 'category_name');
      setValidationForColumn('Category', 'category_name');
    }
    if (options.lookups?.tax_name) {
      setValidationForColumn('Tax Name', 'tax_name');
      setValidationForColumn('Tax', 'tax_name');
    }
    if (options.lookups?.hsn_name) {
      // Support different capitalizations generated from keys (e.g., 'Hsn Name')
      setValidationForColumn('HSN Name', 'hsn_name');
      setValidationForColumn('Hsn Name', 'hsn_name');
      setValidationForColumn('HSN Code', 'hsn_name');
      setValidationForColumn('Hsn Code', 'hsn_name');
    }
    if (options.lookups?.status) {
      setValidationForColumn('Status', 'status');
    }

    // Auto-fill Tax Name when HSN is selected using XLOOKUP on Lists mapping
    if (hsnMapRange) {
      const taxHeaderIdx = headers.findIndex((h) => h === 'Tax Name' || h === 'Tax');
      const hsnHeaderIdx = headers.findIndex((h) => h === 'HSN Name' || h === 'Hsn Name' || h === 'HSN Code' || h === 'Hsn Code');
      if (taxHeaderIdx >= 0 && hsnHeaderIdx >= 0) {
        const taxCol = taxHeaderIdx + 1;
        const hsnCol = hsnHeaderIdx + 1;
        for (let r = 2; r <= (options.data.length + 1); r++) {
          const taxCell = ws.getCell(r, taxCol);
          const hsnCellAddr = ws.getCell(r, hsnCol).address;
          // Use INDEX/MATCH for broader compatibility instead of XLOOKUP
          // MATCH the HSN in Lists!<hCol> range, then INDEX into the parallel Tax column
          const hRange = `Lists!${hsnMapRange.hCol}${hsnMapRange.startRow}:Lists!${hsnMapRange.hCol}${hsnMapRange.endRow}`;
          const tRange = `Lists!${hsnMapRange.tCol}${hsnMapRange.startRow}:Lists!${hsnMapRange.tCol}${hsnMapRange.endRow}`;
          const formula = `IFERROR(INDEX(${tRange},MATCH(${hsnCellAddr},${hRange},0)),"")`;
          (taxCell as any).value = { formula };
        }
      }
    }
    if (options.lookups?.preferred_gender) {
      setValidationForColumn('Preferred Gender', 'preferred_gender');
      setValidationForColumn('Gender', 'preferred_gender');
    }

    // Report Info sheet
    const infoWs = wb.addWorksheet('Report Info');
    infoWs.addRows([
      ['Report Title', options.title],
      ['Generated On', format(new Date(), 'MMM dd, yyyy HH:mm')],
      ['Total Records', options.data.length.toString()],
    ]);
    if (options.dateRange) {
      infoWs.addRow(['Date Range', `${format(options.dateRange.from, 'MMM dd, yyyy')} - ${format(options.dateRange.to, 'MMM dd, yyyy')}`]);
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${options.filename}.xlsx`);
  }

  static exportToCSV(options: ExportOptions) {
    const headers = options.columns.map((col) => col.header);
    const csvContent = [
      headers.join(","),
      ...options.data.map((row) =>
        options.columns
          .map((col) => {
            let value = row[col.dataKey];
            if (value instanceof Date) {
              value = format(value, "MMM dd, yyyy");
            } else if (
              typeof value === "number" &&
              col.dataKey.includes("amount")
            ) {
              value = value.toString();
            } else {
              value = String(value || "");
            }
            // Escape commas and quotes
            if (value.includes(",") || value.includes('"')) {
              value = `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `${options.filename}.csv`);
  }
}

// Utility function for common export scenarios
export const exportData = (
  format: "pdf" | "excel" | "csv",
  options: ExportOptions,
) => {
  switch (format) {
    case "pdf":
      ExportManager.exportToPDF(options);
      break;
    case "excel":
      ExportManager.exportToExcel(options);
      break;
    case "csv":
      ExportManager.exportToCSV(options);
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
};
