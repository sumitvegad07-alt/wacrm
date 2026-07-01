'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Check } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import type { QuotationItem } from '@/types';

// We omit 'id', 'quotation_id', 'created_at' for items being created in the form
export type PartialQuotationItem = Omit<QuotationItem, 'id' | 'quotation_id' | 'created_at'> & {
  id?: string;
};

interface ProductDetailsTableProps {
  items: PartialQuotationItem[];
  onChange: (items: PartialQuotationItem[]) => void;
  products: any[];
}

const UNITS = ['Nos', 'Kg', 'Ltr', 'Box', 'Meter', 'Pcs'];

export function ProductDetailsTable({ items, onChange, products }: ProductDetailsTableProps) {
  const calculateItemTotals = (item: PartialQuotationItem) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    const taxRate = Number(item.tax_rate) || 0;
    
    const subTotal = qty * price;
    const taxAmount = (subTotal * taxRate) / 100;
    const total = subTotal + taxAmount;
    
    return {
      sub_total: subTotal,
      tax_amount: taxAmount,
      total: total,
    };
  };

  const updateItem = (index: number, updates: Partial<PartialQuotationItem>) => {
    const newItems = [...items];
    const item = { ...newItems[index], ...updates };
    
    // Auto calculate if qty, price, or tax changes
    if ('quantity' in updates || 'price' in updates || 'tax_rate' in updates) {
      const totals = calculateItemTotals(item);
      Object.assign(item, totals);
    }
    
    newItems[index] = item;
    onChange(newItems);
  };

  const addItem = () => {
    onChange([
      ...items,
      {
        product_id: null,
        product_name: '',
        unit: 'Nos',
        quantity: 1,
        price: 0,
        tax_rate: 0,
        tax_amount: 0,
        sub_total: 0,
        total: 0,
        position: items.length,
      }
    ]);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    // Re-assign positions
    newItems.forEach((item, i) => { item.position = i; });
    onChange(newItems);
  };

  const grandSubTotal = items.reduce((sum, item) => sum + (Number(item.sub_total) || 0), 0);
  const grandTaxTotal = items.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0);
  const grandTotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-foreground">Product Details</h3>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground w-1/4 min-w-[200px]">Product</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground w-32">Unit</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground w-32">Quantity</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground w-32">Price (₹)</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground w-32">Tax (%)</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground w-32">Sub Total (₹)</th>
              <th className="h-10 px-4 text-center font-medium text-muted-foreground w-14"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-b border-border hover:bg-muted/30">
                <td className="p-2 align-top">
                  <SearchableSelect
                    options={products.map(p => ({ label: p.sku ? `[${p.sku}] ${p.name}` : p.name, value: p.id }))}
                    value={item.product_id || ''}
                    onChange={(val) => {
                      const product = products.find(p => p.id === val);
                      if (product) {
                         updateItem(index, {
                            product_id: product.id,
                            product_name: product.sku ? `[${product.sku}] ${product.name}` : product.name,
                            price: Number(product.price) || 0,
                         });
                      } else {
                         updateItem(index, { product_id: null, product_name: '' });
                      }
                    }}
                    placeholder={item.product_name || "Select Product..."}
                  />
                  
                  {/* Allow custom manual entry if not in list */}
                  {!item.product_id && item.product_name === '' && (
                    <Input 
                      className="mt-2 h-9 text-xs" 
                      placeholder="Or type custom product..." 
                      value={item.product_name}
                      onChange={(e) => updateItem(index, { product_name: e.target.value })}
                    />
                  )}
                  {item.product_id === null && item.product_name !== '' && (
                     <Input 
                     className="mt-2 h-9 text-xs" 
                     placeholder="Custom product name" 
                     value={item.product_name}
                     onChange={(e) => updateItem(index, { product_name: e.target.value })}
                   />
                  )}
                </td>
                
                <td className="p-2 align-top">
                  <SearchableSelect
                    options={UNITS.map(u => ({ label: u, value: u }))}
                    value={item.unit || ''}
                    onChange={(val) => updateItem(index, { unit: val })}
                    placeholder="Unit"
                  />
                </td>
                
                <td className="p-2 align-top">
                  <Input 
                    type="number" 
                    min="1" 
                    step="0.01" 
                    className="h-10 text-right bg-background" 
                    value={item.quantity === 0 ? '' : item.quantity}
                    onChange={(e) => updateItem(index, { quantity: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                
                <td className="p-2 align-top">
                  <Input 
                    type="number" 
                    min="0" 
                    step="0.01" 
                    className="h-10 text-right bg-background" 
                    value={item.price === 0 ? '' : item.price}
                    onChange={(e) => updateItem(index, { price: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                
                <td className="p-2 align-top">
                  <Input 
                    type="number" 
                    min="0" 
                    step="0.01" 
                    max="100"
                    className="h-10 text-right bg-background" 
                    value={item.tax_rate === 0 ? '' : item.tax_rate}
                    onChange={(e) => updateItem(index, { tax_rate: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                
                <td className="p-2 align-top text-right align-middle font-medium">
                  {item.sub_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                
                <td className="p-2 align-top text-center align-middle">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          {items.length > 0 && (
            <tfoot className="border-t border-border bg-muted/20">
              <tr>
                <td colSpan={4} className="p-4"></td>
                <td className="p-4 text-right font-medium text-muted-foreground">Sub Total</td>
                <td className="p-4 text-right font-semibold text-foreground">
                  {grandSubTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={4} className="p-4 pt-0"></td>
                <td className="p-4 pt-0 text-right font-medium text-muted-foreground">Total Tax</td>
                <td className="p-4 pt-0 text-right font-semibold text-foreground">
                  {grandTaxTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
              <tr className="border-t border-border/50 bg-muted/40">
                <td colSpan={4} className="p-4"></td>
                <td className="p-4 text-right font-bold text-foreground">Total Amount</td>
                <td className="p-4 text-right font-bold text-primary text-lg">
                  ₹{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addItem}
        className="gap-2 border-dashed border-border"
      >
        <Plus className="h-4 w-4" />
        Add Line Item
      </Button>
    </div>
  );
}
