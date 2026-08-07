"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function DocumentTemplateEditor({ templateId, moduleParam }: { templateId?: string; moduleParam?: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [manageFooterOpen, setManageFooterOpen] = useState(false);
  
  // Dummy configuration state
  const [config, setConfig] = useState({
    name: templateId ? "Default" : "New Template",
    module: moduleParam || "order",
    header: {
      orgLogo: true,
      orgName: true,
      orgContact: true,
      orgAddress: true,
      orgGst: true,
    },
    documentInfo: {
      serialNo: true,
      orderTo: { enabled: true, label: "Order To", code: true, name: true, address: true, area: true, city: true, statePin: true, contactDetails: true, gstDetails: true },
      billingDetails: { enabled: true, label: "Order From", code: true, name: true, title: false, address: true, area: true, city: true, statePin: true, contactDetails: true, gstDetails: true },
      orderDate: { enabled: true, label: "Order Date" },
      orderStatus: { enabled: true, label: "Order Status" },
      priceGroup: { enabled: false, label: "Price group" },
      remark: { enabled: false, label: "Remark" },
      createdBy: { enabled: true, label: "Created By" },
      createdByEmail: { enabled: false, label: "Email" },
      createdByContact: { enabled: false, label: "Contact No" },
    },
    itemTable: {
      itemNo: { enabled: true, label: "#" },
      image: { enabled: true, label: "image" },
      itemCode: { enabled: true, label: "Item Code" },
      item: { enabled: true, label: "Item" },
      hsnCode: { enabled: false, label: "HSN Code" },
      category: { enabled: true, label: "Category" },
      quantity: { enabled: true, label: "Quantity" },
      price: { enabled: true, label: "Price" },
      tax: { enabled: false, label: "Tax" },
      netPrice: { enabled: false, label: "Net Price" },
      subAmount: { enabled: true, label: "Sub Amount" },
      netAmount: { enabled: false, label: "Net Amount" },
      subTotal: { enabled: true, label: "Sub Total" },
      taxSummary: { enabled: true, label: "Tax Summary" },
      total: { enabled: true, label: "Total" },
    },
    bottomSections: {
      totalQuantity: { enabled: true, label: "Total Quantity" },
      signature: { enabled: true, label: "Authorize signature", name: "Name", image: false, attachmentUrl: "" },
      additionalSignature: { enabled: true, label: "Receiver's signature", name: "Name" },
      footer: { enabled: true, text: "1. Goods once sold will not be taken back.\n2. Subject to Rajkot jurisdiction." }
    }
  });

  const handleSave = () => {
    setSaving(true);
    // Simulate save
    setTimeout(() => {
      setSaving(false);
      router.push("/settings?tab=document_templates");
    }, 1000);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Top Navigation Bar */}
      <div className="h-14 border-b flex items-center justify-between px-4 bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="font-semibold text-lg flex items-center gap-2 text-foreground">
            {templateId ? `Edit Template` : "New Template"}
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          SAVE
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Configurator */}
        <div className="w-[350px] border-r bg-muted/20 overflow-y-auto flex flex-col">
          <div className="p-4 border-b bg-card shrink-0">
            <Label className="text-muted-foreground text-xs font-semibold mb-2 block">Template Name *</Label>
            <Input 
              value={config.name} 
              onChange={e => setConfig({...config, name: e.target.value})} 
              className="bg-white"
            />
          </div>

          <Accordion className="flex-1 w-full p-2 space-y-2">
            
            <AccordionItem value="header" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">Header</AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1 pb-3">
                {Object.entries(config.header).map(([key, val]) => (
                  <div key={key} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`hdr-${key}`} 
                      checked={val} 
                      onCheckedChange={(c) => setConfig({...config, header: {...config.header, [key]: c}})}
                    />
                    <label htmlFor={`hdr-${key}`} className="text-sm font-medium leading-none cursor-pointer">
                      {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                    </label>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="doc-info" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">Document Info</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-1 pb-3">
                {/* Simple boolean toggles */}
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="doc-serial" 
                    checked={config.documentInfo.serialNo}
                    onCheckedChange={(c) => setConfig({...config, documentInfo: {...config.documentInfo, serialNo: !!c}})}
                  />
                  <label htmlFor="doc-serial" className="text-sm font-medium leading-none cursor-pointer">Serial No</label>
                </div>

                {/* Complex sections with labels */}
                {['orderTo', 'billingDetails'].map(sectionKey => {
                  const s = config.documentInfo[sectionKey as keyof typeof config.documentInfo] as any;
                  return (
                    <div key={sectionKey} className="border p-3 rounded-md bg-muted/10 space-y-3 mt-4">
                      <div className="flex items-center gap-3">
                        <Checkbox 
                          checked={s.enabled}
                          onCheckedChange={(c) => setConfig({...config, documentInfo: {...config.documentInfo, [sectionKey]: {...s, enabled: !!c}}})}
                        />
                        <Input 
                          value={s.label} 
                          onChange={(e) => setConfig({...config, documentInfo: {...config.documentInfo, [sectionKey]: {...s, label: e.target.value}}})}
                          className="h-8 text-sm font-semibold"
                        />
                      </div>
                      <div className="pl-6 space-y-2">
                        {['code', 'name', 'address', 'area', 'city', 'statePin', 'contactDetails', 'gstDetails'].map(f => (
                          <div key={f} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`${sectionKey}-${f}`} 
                              checked={s[f]}
                              onCheckedChange={(c) => setConfig({...config, documentInfo: {...config.documentInfo, [sectionKey]: {...s, [f]: !!c}}})}
                            />
                            <label htmlFor={`${sectionKey}-${f}`} className="text-xs font-medium cursor-pointer text-muted-foreground">
                              {f.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="pt-2 border-t mt-4 space-y-3">
                  {['orderDate', 'orderStatus', 'priceGroup', 'remark', 'createdBy'].map(k => {
                    const v = config.documentInfo[k as keyof typeof config.documentInfo] as any;
                    return (
                      <div key={k} className="flex items-center gap-3">
                        <Checkbox 
                          checked={v.enabled} 
                          onCheckedChange={(c) => setConfig({...config, documentInfo: {...config.documentInfo, [k]: {...v, enabled: !!c}}})}
                        />
                        <Input 
                          value={v.label}
                          onChange={(e) => setConfig({...config, documentInfo: {...config.documentInfo, [k]: {...v, label: e.target.value}}})}
                          className="h-8 text-xs"
                          disabled={!v.enabled}
                        />
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="custom-fields" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">Custom Fields</AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1 pb-3">
                {['Dispatch Through', 'E-Way Bill', 'Destination', 'Transport Mode'].map((cf, i) => (
                  <div key={cf} className="flex items-center space-x-2">
                    <Checkbox id={`cf-${i}`} defaultChecked={i < 2} />
                    <label htmlFor={`cf-${i}`} className="text-sm font-medium leading-none cursor-pointer">{cf}</label>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-table" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">Item Table</AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1 pb-3">
                {Object.entries(config.itemTable).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3">
                    <Checkbox 
                      id={`tbl-${key}`} 
                      checked={val.enabled} 
                      onCheckedChange={(c) => setConfig({...config, itemTable: {...config.itemTable, [key]: {...val, enabled: !!c}}})}
                    />
                    <Input 
                      value={val.label}
                      onChange={(e) => setConfig({...config, itemTable: {...config.itemTable, [key]: {...val, label: e.target.value}}})}
                      className="h-8 text-xs"
                      disabled={!val.enabled}
                    />
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="bottom-sections" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">Bottom Sections</AccordionTrigger>
              <AccordionContent className="space-y-5 pt-1 pb-3">
                
                <div className="space-y-3">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Total Quantity</p>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={config.bottomSections.totalQuantity.enabled} onCheckedChange={(c) => setConfig({...config, bottomSections: {...config.bottomSections, totalQuantity: {...config.bottomSections.totalQuantity, enabled: !!c}}})} />
                    <Input value={config.bottomSections.totalQuantity.label} onChange={(e) => setConfig({...config, bottomSections: {...config.bottomSections, totalQuantity: {...config.bottomSections.totalQuantity, label: e.target.value}}})} className="h-8 text-xs" />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Signature</p>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={config.bottomSections.signature.enabled} onCheckedChange={(c) => setConfig({...config, bottomSections: {...config.bottomSections, signature: {...config.bottomSections.signature, enabled: !!c}}})} />
                    <span className="text-xs w-16 text-muted-foreground font-medium">Label</span>
                    <Input value={config.bottomSections.signature.label} onChange={(e) => setConfig({...config, bottomSections: {...config.bottomSections, signature: {...config.bottomSections.signature, label: e.target.value}}})} className="h-8 text-xs" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={true} disabled />
                    <span className="text-xs w-16 text-muted-foreground font-medium">Sign. Name</span>
                    <Input value={config.bottomSections.signature.name} onChange={(e) => setConfig({...config, bottomSections: {...config.bottomSections, signature: {...config.bottomSections.signature, name: e.target.value}}})} className="h-8 text-xs" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={config.bottomSections.signature.image} onCheckedChange={(c) => setConfig({...config, bottomSections: {...config.bottomSections, signature: {...config.bottomSections.signature, image: !!c}}})} />
                    <span className="text-xs font-medium">Sign. Image</span>
                  </div>
                  {config.bottomSections.signature.image && (
                    <div className="pl-6 pt-1">
                      <Button variant="secondary" className="w-full h-8 text-xs bg-muted">@ Attach a File</Button>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Additional Signature</p>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={config.bottomSections.additionalSignature.enabled} onCheckedChange={(c) => setConfig({...config, bottomSections: {...config.bottomSections, additionalSignature: {...config.bottomSections.additionalSignature, enabled: !!c}}})} />
                    <span className="text-xs w-16 text-muted-foreground font-medium">Label</span>
                    <Input value={config.bottomSections.additionalSignature.label} onChange={(e) => setConfig({...config, bottomSections: {...config.bottomSections, additionalSignature: {...config.bottomSections.additionalSignature, label: e.target.value}}})} className="h-8 text-xs" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={true} disabled />
                    <span className="text-xs w-16 text-muted-foreground font-medium">Sign. Name</span>
                    <Input value={config.bottomSections.additionalSignature.name} onChange={(e) => setConfig({...config, bottomSections: {...config.bottomSections, additionalSignature: {...config.bottomSections.additionalSignature, name: e.target.value}}})} className="h-8 text-xs" />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Footer</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={config.bottomSections.footer.enabled} onCheckedChange={(c) => setConfig({...config, bottomSections: {...config.bottomSections, footer: {...config.bottomSections.footer, enabled: !!c}}})} />
                      <span className="text-sm font-medium">Footer</span>
                    </div>
                    <Button size="sm" onClick={() => setManageFooterOpen(true)} className="h-7 px-3 text-[10px] font-bold tracking-wider bg-blue-500 hover:bg-blue-600">MANAGE</Button>
                  </div>
                </div>
                
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </div>

        {/* Right Pane Preview */}
        <div className="flex-1 bg-muted/30 p-8 overflow-y-auto flex justify-center">
          {/* A4 Sheet Mockup */}
          <Card className="w-full max-w-[800px] min-h-[1131px] bg-white shadow-md p-10 flex flex-col">
            {/* Header Preview */}
            <div className="flex items-start justify-between border-b pb-6">
              <div className="flex items-center gap-4">
                {config.header.orgLogo && (
                  <div className="w-16 h-16 bg-blue-500 rounded-md flex items-center justify-center text-white font-bold">LOGO</div>
                )}
                <div>
                  {config.header.orgName && <h1 className="text-xl font-bold text-gray-800">KOOPS DEMO SFA</h1>}
                  {config.header.orgContact && <p className="text-sm text-gray-500">1234567890 | demo@example.com</p>}
                  {config.header.orgGst && <p className="text-sm text-gray-500">GST No : 33AADCA0479R1ZC</p>}
                  {config.header.orgAddress && <p className="text-sm text-gray-500 mt-1 max-w-xs">8 Archana Park, Rajkot, Gujarat, India - 360001</p>}
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-2xl text-gray-800 tracking-wider font-semibold">
                  {config.module.toUpperCase()} <span className="text-blue-600">#ORDC0010009</span>
                </h2>
              </div>
            </div>

            {/* Document Info Preview */}
            <div className="grid grid-cols-3 gap-6 py-6 border-b text-sm">
              {config.documentInfo.billingDetails.enabled && (
                <div>
                  <h3 className="font-semibold text-gray-600 mb-2 italic">{config.documentInfo.billingDetails.label}</h3>
                  <div className="text-gray-800">
                    {config.documentInfo.billingDetails.code && config.documentInfo.billingDetails.name && <p className="font-medium text-blue-600">[C001] Dummy Customer</p>}
                    {config.documentInfo.billingDetails.address && <p>Nr. Dholakiya School, Rajkot</p>}
                    {config.documentInfo.billingDetails.contactDetails && <p className="mt-1">+91 92283 08366</p>}
                  </div>
                </div>
              )}
              {config.documentInfo.orderTo.enabled && (
                <div>
                  <h3 className="font-semibold text-gray-600 mb-2 italic">{config.documentInfo.orderTo.label}</h3>
                  <div className="text-gray-800">
                    {config.documentInfo.orderTo.code && config.documentInfo.orderTo.name && <p className="font-medium font-bold">[D001] Dummy Distributor</p>}
                    {config.documentInfo.orderTo.address && <p>University Road, Rajkot</p>}
                    {config.documentInfo.orderTo.contactDetails && <p className="mt-1">+91 92283 08366</p>}
                  </div>
                </div>
              )}
              <div className="text-right space-y-1 text-gray-700">
                {config.documentInfo.orderDate.enabled && <p><span className="font-medium text-gray-500">{config.documentInfo.orderDate.label} :</span> 20-06-2026</p>}
                {config.documentInfo.orderStatus.enabled && <p><span className="font-medium text-gray-500">{config.documentInfo.orderStatus.label} :</span> Open</p>}
                {config.documentInfo.remark.enabled && <p><span className="font-medium text-gray-500">{config.documentInfo.remark.label} :</span> Urgent delivery</p>}
                {config.documentInfo.createdBy.enabled && <p><span className="font-medium text-gray-500">{config.documentInfo.createdBy.label} :</span> Dummy Staff</p>}
              </div>
            </div>

            {/* Custom Fields Preview */}
            <div className="grid grid-cols-4 gap-4 py-4 border-b text-xs text-gray-700">
              <div><span className="font-medium text-gray-500">Dispatch Through :</span> Road</div>
              <div><span className="font-medium text-gray-500">E-Way Bill :</span> 123456789012</div>
            </div>

            {/* Item Table Preview */}
            <div className="mt-6 flex-1">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-gray-50 border-y">
                  <tr>
                    {Object.entries(config.itemTable).map(([key, val]) => {
                      if (!val.enabled || ['subTotal', 'taxSummary', 'total'].includes(key)) return null;
                      return <th key={key} className="py-3 px-2 font-semibold text-gray-700">{val.label}</th>;
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[1, 2, 3].map((row) => (
                    <tr key={row}>
                      {config.itemTable.itemNo.enabled && <td className="py-3 px-2">{row}</td>}
                      {config.itemTable.image.enabled && <td className="py-3 px-2"><div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-[10px] text-gray-500">img</div></td>}
                      {config.itemTable.itemCode.enabled && <td className="py-3 px-2">[p{row}]</td>}
                      {config.itemTable.item.enabled && <td className="py-3 px-2">Sample Product {row}</td>}
                      {config.itemTable.hsnCode.enabled && <td className="py-3 px-2">1234</td>}
                      {config.itemTable.category.enabled && <td className="py-3 px-2">Category</td>}
                      {config.itemTable.quantity.enabled && <td className="py-3 px-2">10.00</td>}
                      {config.itemTable.price.enabled && <td className="py-3 px-2">₹ 15.00</td>}
                      {config.itemTable.tax.enabled && <td className="py-3 px-2">18%</td>}
                      {config.itemTable.netPrice.enabled && <td className="py-3 px-2">₹ 15.00</td>}
                      {config.itemTable.subAmount.enabled && <td className="py-3 px-2">₹ 150.00</td>}
                      {config.itemTable.netAmount.enabled && <td className="py-3 px-2">₹ 150.00</td>}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Section */}
              <div className="mt-4 border-t pt-4 flex justify-between items-start">
                <div className="flex gap-12 text-xs text-gray-700 font-medium">
                  {config.bottomSections.totalQuantity.enabled && (
                    <>
                      <span>Total PCS : 1 (1 Items)</span>
                      <span>Total KG : 12.600 (3 Items)</span>
                    </>
                  )}
                </div>
                
                <div className="w-64 space-y-2 text-sm text-gray-700">
                  {config.itemTable.subTotal.enabled && (
                    <div className="flex justify-between">
                      <span>{config.itemTable.subTotal.label}</span>
                      <span className="font-medium">₹ 450.00</span>
                    </div>
                  )}
                  {config.itemTable.taxSummary.enabled && (
                    <div className="flex justify-between border-t pt-2">
                      <span>IGST (18%)</span>
                      <span className="font-medium">₹ 13.50</span>
                    </div>
                  )}
                  {config.itemTable.total.enabled && (
                    <div className="flex justify-between font-bold text-gray-900 border-t pt-2 text-base">
                      <span>{config.itemTable.total.label}</span>
                      <span>₹ 417.00</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer & Signatures */}
            <div className="mt-auto border-t pt-6 text-xs text-gray-500 flex justify-between items-end">
              <div>
                {config.bottomSections.footer.enabled && (
                  <div className="whitespace-pre-line leading-relaxed">
                    <p className="font-semibold text-gray-700">Terms & Conditions</p>
                    {config.bottomSections.footer.text}
                  </div>
                )}
                
                {config.bottomSections.signature.enabled && (
                  <div className="mt-6">
                    <p className="text-gray-800 font-medium">{config.bottomSections.signature.label}</p>
                    <p className="text-gray-500 mt-1">{config.bottomSections.signature.name}</p>
                  </div>
                )}
              </div>
              
              {config.bottomSections.additionalSignature.enabled && (
                <div className="text-right">
                  <p className="text-gray-800 font-medium">{config.bottomSections.additionalSignature.label}</p>
                  <p className="text-gray-500 mt-1">{config.bottomSections.additionalSignature.name}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={manageFooterOpen} onOpenChange={setManageFooterOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Manage Footer Terms</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea 
              value={config.bottomSections.footer.text} 
              onChange={(e) => setConfig({...config, bottomSections: {...config.bottomSections, footer: {...config.bottomSections.footer, text: e.target.value}}})}
              rows={6}
              className="w-full text-sm resize-none"
              placeholder="Enter your terms and conditions..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageFooterOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
