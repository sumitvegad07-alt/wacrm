*WACRM Engineering Bible* > *Deep Specifications* > *Web vs Mobile Parity Gap*
[← 10_Module_Details](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [12_Offline_First_Architecture →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/12_Offline_First_Architecture.md)
---

# WACRM Engineering Bible - Web vs Mobile Parity Gap

*This document outlines the current feature disparity between the Web Dashboard and the Mobile Companion App, serving as the implementation roadmap.*

## 1. CRM & Sales

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Contact List** | ✅ Full | ✅ Basic | Low | Medium (Add advanced filtering to mobile) |
| **Contact Custom Fields** | ✅ Full | ❌ Missing | High | High (Dynamic form rendering on React Native) |
| **Pipelines & Deals** | ✅ Full | ❌ Missing | Medium | Medium (Needs mobile pipeline UI) |
| **Leads** | ✅ Full | ❌ Missing | Medium | Low (Simple CRUD duplication) |

## 2. Field Force Operations

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Background Location** | ❌ N/A | ✅ Full | None | Mobile-exclusive feature |
| **Live Map Dashboard** | ✅ Full | ❌ N/A | None | Web-exclusive feature |
| **Punch In / Out** | ❌ N/A | ✅ Full | None | Mobile-exclusive feature |
| **Site Visits** | ✅ View Only | ✅ Check In/Out | None | Balanced |

## 3. Communication

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **WhatsApp Inbox** | ✅ Full | ❌ Missing | Critical | Very High (Requires robust offline sync and complex chat UI in RN) |
| **Broadcasts** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |

## 4. Automation & AI

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Flow Builder** | ✅ Full | ❌ Missing | Low | Web-exclusive feature (Too complex for mobile screens) |
| **AI Bot Settings** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |

## 5. Administration

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Expense Approval** | ✅ Full | ❌ Missing | High | Low (List view with Approve/Reject buttons) |
| **Team Management** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |
| **Billing / Subscription** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |
