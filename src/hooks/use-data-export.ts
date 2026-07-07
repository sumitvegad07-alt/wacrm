import { ColumnDef } from "@/components/ui/data-table/data-table-types";

export function useDataExport() {
  const exportToCsv = <T,>(
    data: T[], 
    columns: ColumnDef<T>[], 
    filename: string = "export.csv"
  ) => {
    if (!data || data.length === 0) {
      console.warn("No data to export");
      return;
    }

    // 1. Get header row
    const headers = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(",");

    // 2. Get data rows
    const csvRows = data.map(row => {
      return columns.map(c => {
        // We need to resolve the value as it would render.
        // If the column has a render function, we can't easily parse React nodes to text here.
        // Instead, we will grab the raw value using the column id, which is usually the key.
        let val = (row as any)[c.id];
        
        // Handle basic formatting
        if (val === null || val === undefined) {
          val = "";
        } else if (c.type === 'date' && val) {
          val = new Date(val).toLocaleDateString();
        } else if (typeof val === 'object') {
          // If it's an object/array, stringify it
          val = JSON.stringify(val);
        } else {
          val = String(val);
        }

        // Escape quotes
        val = val.replace(/"/g, '""');
        
        return `"${val}"`;
      }).join(",");
    });

    const csvContent = [headers, ...csvRows].join("\n");
    
    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return { exportToCsv };
}
