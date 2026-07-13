*WACRM Engineering Bible* > *Core Architecture* > *Technical Debt & Future Roadmap*
[← 08_UI_Design_System](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/08_UI_Design_System.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [10_Module_Details →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md)
---

# WACRM Engineering Bible - Technical Debt & Future Roadmap

*Version: v1.0*

This document outlines the known architectural limitations and the roadmap to achieve true Enterprise scale.

## 1. Known Technical Debt

### 1.1 The EAV (Entity-Attribute-Value) Bottleneck
**Current State:** Custom fields for Contacts and Expenses are stored in `custom_fields` (the definition) and `contact_custom_values` (the values).
**The Problem:** EAV tables are notoriously slow to query. If an account has 100,000 contacts and wants to filter by a custom field "Industry = Tech", the database must perform massive, slow JOINs.
**The Solution (Roadmap):** Migrate custom data into a single `JSONB` column directly on the `contacts` table and utilize Postgres GIN indices for lightning-fast querying.

### 1.2 In-Memory API Rate Limiting
**Current State:** The public API (`/api/v1`) uses a simple Node.js memory bucket to throttle requests.
**The Problem:** When WACRM scales to multiple Next.js server instances (e.g., Vercel Edge or Docker Swarm), in-memory state is not shared. An attacker could bypass limits by hitting different instances.
**The Solution (Roadmap):** Implement Upstash Redis or Supabase Edge Functions for a globally distributed, shared rate-limiting store.

### 1.3 Location Ping Bloat
**Current State:** Every agent generates ~1 ping every 10 minutes. 100 agents = 14,400 pings/day.
**The Problem:** Within a year, the `location_pings` table will contain millions of rows, slowing down map renders and dashboard queries.
**The Solution (Roadmap):** Implement PostgreSQL Table Partitioning (by month) and set up an automated cron job to archive or aggregate pings older than 90 days.

## 2. Future Module Expansions

### 2.1 Full Offline-First Architecture (WatermelonDB)
The mobile app currently requires a network connection to read/write most CRM data (except for the emergency GPS queue). The roadmap includes replacing direct Supabase queries with a local SQLite database synchronized in the background (WatermelonDB or PowerSync). This will allow agents to operate deep in the field with zero signal.

### 2.2 Advanced Sales Force Automation (SFA)
- **Beat Planning:** Allowing admins to define a predefined route (Beat) of 10 customers to visit in a day.
- **Route Optimization:** Using OpenRouteService to calculate the most efficient driving path for the day's tasks.

### 2.3 HRMS Evolution
Currently, WACRM tracks "Tracking Sessions". This will evolve into a formal Attendance module:
- Formal Leave Requests and Approvals.
- Shift scheduling and Late Mark logic.
- Automated Payroll calculation based on verified Hours + Approved Expenses.
