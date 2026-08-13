'use client';

import { useEffect } from 'react';

export function PrintButton() {
  useEffect(() => {
    setTimeout(() => { window.print(); }, 500);
  }, []);

  return (
    <div className="fixed top-4 right-4 print-hide">
      <button
        onClick={() => window.print()}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-md text-sm font-medium transition-colors"
      >
        Print PDF
      </button>
    </div>
  );
}
