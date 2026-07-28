"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { DealItem } from "@/types";

export type PartialDealItem = Omit<DealItem, "id" | "deal_id" | "created_at"> & {
  id?: string;
};

interface DealItemsTableProps {
  items: PartialDealItem[];
  onChange: (items: PartialDealItem[]) => void;
  products: any[];
}



export function DealItemsTable({ items, onChange, products }: DealItemsTableProps) {
  const calculateItemTotals = (item: PartialDealItem) => {
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

  const updateItem = (index: number, updates: Partial<PartialDealItem>) => {
    const newItems = [...items];
    const item = { ...newItems[index], ...updates };

    if ("quantity" in updates || "price" in updates || "tax_rate" in updates) {
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
        product_name: "",
        unit: "—",
        quantity: 1,
        price: 0,
        tax_rate: 0,
        tax_amount: 0,
        sub_total: 0,
        total: 0,
        position: items.length,
      },
    ]);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    onChange(newItems);
  };

  const handleProductSelect = (index: number, productId: string) => {
    const selectedProduct = products.find((p) => p.id === productId);
    if (selectedProduct) {
      const price = Number(selectedProduct.selling_price || selectedProduct.price) || 0;
      // tax_slab is the joined object from tax_slabs(rate); fall back to 0 if not set
      const taxRate = Number(
        selectedProduct.tax_slab?.rate ?? selectedProduct.tax_rate ?? 0
      );
      const unit = selectedProduct.unit || "—";

      const item = {
        ...items[index],
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        unit: unit,
        price: price,
        tax_rate: taxRate,
      };

      const totals = calculateItemTotals(item);
      updateItem(index, {
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        unit: unit,
        price: price,
        tax_rate: taxRate,
        ...totals,
      });
    }
  };

  const subTotalSum = items.reduce((sum, item) => sum + (Number(item.sub_total) || 0), 0);
  const taxTotalSum = items.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0);
  const totalAmountSum = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2.5 px-4 text-left font-medium w-1/3">PRODUCT</th>
              <th className="py-2.5 px-4 text-left font-medium w-20">UNIT</th>
              <th className="py-2.5 px-4 text-right font-medium w-24">QTY</th>
              <th className="py-2.5 px-4 text-right font-medium w-32">PRICE (₹)</th>
              <th className="py-2.5 px-4 text-right font-medium w-24">TAX %</th>
              <th className="py-2.5 px-4 text-right font-medium w-32">TOTAL (₹)</th>
              <th className="py-2.5 px-4 text-center font-medium w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No products added yet. Click &quot;Add Product&quot; below.
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={index} className="hover:bg-muted/30">
                  <td className="py-2.5 px-4">
                    <SearchableSelect
                      value={item.product_id || ""}
                      onChange={(val) => {
                        if (val) handleProductSelect(index, val);
                      }}
                      options={products.map((p) => ({ label: p.name, value: p.id }))}
                      placeholder="Select a product..."
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="text-muted-foreground whitespace-nowrap text-xs">{item.unit || "—"}</span>
                  </td>
                  <td className="py-2.5 px-4">
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                      className="h-8 text-right text-xs"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.price}
                      onChange={(e) => updateItem(index, { price: Number(e.target.value) })}
                      className="h-8 text-right text-xs"
                    />
                  </td>
                  <td className="py-2.5 px-4 text-right text-muted-foreground text-xs font-medium">
                    {item.tax_rate || 0}%
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium">
                    ₹{Number(item.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(index)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="mr-1.5 h-4 w-4" /> Add Product
        </Button>

        <div className="text-right space-y-1 text-sm bg-muted/50 p-4 rounded-lg border border-border min-w-[240px]">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal:</span>
            <span>₹{subTotalSum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax:</span>
            <span>₹{taxTotalSum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between font-semibold text-foreground pt-2 border-t border-border">
            <span>Total Amount:</span>
            <span>₹{totalAmountSum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
