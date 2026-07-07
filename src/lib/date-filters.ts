export function isDateInFilter(dateString: string | Date | null | undefined, filterValue: string | string[]): boolean {
  if (!dateString) return false;
  
  const targetDate = new Date(dateString);
  if (isNaN(targetDate.getTime())) return false;
  
  const now = new Date();
  
  if (Array.isArray(filterValue)) {
    // Custom range: [startDate, endDate]
    const start = filterValue[0] ? new Date(filterValue[0]) : null;
    const end = filterValue[1] ? new Date(filterValue[1]) : null;
    
    if (end) end.setHours(23, 59, 59, 999);
    
    if (start && targetDate < start) return false;
    if (end && targetDate > end) return false;
    return true;
  }
  
  if (filterValue === "today") {
    return targetDate.toDateString() === now.toDateString();
  }
  
  if (filterValue === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return targetDate.toDateString() === yesterday.toDateString();
  }
  
  if (filterValue === "last_week") {
    // Last week (last 7 days, excluding today? Or previous week?)
    // Let's implement as "within the last 7 days"
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    lastWeek.setHours(0, 0, 0, 0);
    return targetDate >= lastWeek && targetDate <= now;
  }
  
  if (filterValue === "current_month") {
    return targetDate.getMonth() === now.getMonth() && targetDate.getFullYear() === now.getFullYear();
  }
  
  if (filterValue === "previous_month") {
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return targetDate.getMonth() === prevMonth.getMonth() && targetDate.getFullYear() === prevMonth.getFullYear();
  }
  
  if (filterValue === "current_quarter") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetQuarter = Math.floor(targetDate.getMonth() / 3);
    return targetQuarter === currentQuarter && targetDate.getFullYear() === now.getFullYear();
  }
  
  if (filterValue === "current_year") {
    return targetDate.getFullYear() === now.getFullYear();
  }

  return true;
}
