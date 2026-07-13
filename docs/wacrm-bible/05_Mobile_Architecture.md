*WACRM Engineering Bible* > *Core Architecture* > *Mobile Architecture*
[← 04_API_Documentation](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/04_API_Documentation.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [06_Web_Architecture →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/06_Web_Architecture.md)
---

# WACRM Engineering Bible - Mobile Architecture

*Version: v1.0 | Platform: WACRM Field Force (com.wacrm.fieldforce)*

## 1. Core Technology Stack
The mobile companion app is not a replica of the Web CRM. It is a purpose-built utility for Field Agents.
- **Framework:** Expo 57, React Native 0.86.0
- **Routing:** Expo Router (File-based routing)
- **Backend Communication:** `@supabase/supabase-js` (Direct SQL queries over REST/WebSockets).
- **Styling:** React Native StyleSheets (No Tailwind on mobile to ensure maximum performance).

## 2. Directory Structure (`c:\Users\Xitij\Desktop\wacrm-mobile`)
- `/app`: The Expo Router directory.
  - `/(auth)`: Login screen.
  - `/(tabs)`: The main bottom-tab navigation (Home, Contact, Activity, Map, Expense, Profile).
  - `/punch.tsx`, `/visit.tsx`, `/expense/[id].tsx`: Stack screens pushed over the tabs.
- `/components`: Reusable UI components (Buttons, Inputs, Headers).
- `/lib`: Domain logic (`location.ts`, `storage.ts`, `supabase.ts`).
- `/constants`: Global theme definitions (`Colors.ts`).

## 3. Location Tracking Architecture (The "Crown Jewel")
The most complex part of the mobile app is the background location tracker found in `lib/location.ts`.

### 3.1 Background Execution (Android Limitations)
Android aggressively kills background apps to save battery. To survive this, WACRM uses a **Foreground Service**.
- When an agent clicks "Punch In", the app calls `Location.startLocationUpdatesAsync`.
- A persistent notification ("📍 WACRM — On Duty") is pinned to the Android status bar. This forces the OS to keep the app alive.
- *Note: This native functionality absolutely does not work in the "Expo Go" development app. It requires a true EAS development build or production APK.*

### 3.2 Polling vs Throttle Strategy
- **Polling (OS Level):** The app requests coordinates from the OS every 30 seconds (`timeInterval: 30000`) with High Accuracy. This frequent polling is required to prevent the OS from deciding the Foreground Service is idle.
- **Throttle (Database Level):** Writing to Supabase every 30 seconds would bankrupt the database. A local state manager implements a strict **10-minute throttle** (`PING_INTERVAL_MS = 600000`). Only 1 ping every 10 minutes is actually written to the `location_pings` table.

### 3.3 Offline Queueing
If the 10-minute ping fails (e.g., driving through a tunnel), the ping is serialized to `expo-file-system`. The background task automatically attempts to flush the queue upon the next successful network request.

## 4. Hardware Integrations
- **expo-camera:** Used for capturing "Selfies" during punch-in, and "Odometer" photos during site visits. Photos are aggressively compressed before upload to save bandwidth in low-signal areas.
- **expo-battery:** Battery percentage is captured during every single location ping. If an agent claims "My phone died", the Admin can check the dashboard to see the battery level at the exact time the tracking stopped.

## 5. Deployment Strategy
- **EAS Build:** `eas.json` defines `development`, `preview`, and `production` profiles.
- **Android:** Generates `.apk` for preview, `.aab` for production Play Store submission.
- **iOS:** Generates `.app` for simulator, `.ipa` for TestFlight.
