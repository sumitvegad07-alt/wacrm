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

const UNITS = ["Nos", "Kg", "Ltr", "Box", "Meter", "Pcs"];

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
        unit: "Nos",
        quantity: 1,
        price: 0,
        tax_rate: 18,
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
      const taxRate = Number(selectedProduct.default_tax_rate || selectedProduct.tax_rate) || 18;
      const unit = selectedProduct.unit || "Nos";

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
              <th className="py-2.5 px-4 text-left font-medium w-1/3">Product / Description</th>
              <th className="py-2.5 px-4 text-left font-medium w-24">Unit</th>
              <th className="py-2.5 px-4 text-right font-medium w-24">Qty</th>
              <th className="py-2.5 px-4 text-right font-medium w-32">Rate (₹)</th>
              <th className="py-2.5 px-4 text-right font-medium w-24">Tax %</th>
              <th className="py-2.5 px-4 text-right font-medium w-32">Total (₹)</th>
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
                    <div className="space-y-1.5">
                      <SearchableSelect
                        value={item.product_id || ""}
                        onChange={(val) => {
                          if (val) handleProductSelect(index, val);
                        }}
                        options={products.map((p) => ({ label: p.name, value: p.id }))}
                        placeholder="Select from catalogue..."
                      />
                      <Input
                        value={item.product_name}
                        onChange={(e) => updateItem(index, { product_name: e.target.value })}
                        placeholder="Or type custom item name..."
                        className="h-8 text-xs"
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={item.unit || "Nos"}
                      onChange={(e) => updateItem(index, { unit: e.target.value })}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
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
                  <td className="py-2.5 px-4">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={item.tax_rate}
                      onChange={(e) => updateItem(index, { tax_rate: Number(e.target.value) })}
                      className="h-8 text-right text-xs"
                    />
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
