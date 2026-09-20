import type { TourScript } from './types';

// The Territory handholding tour — the reference implementation.
export const territoryTour: TourScript = {
  id: 'territory',
  stepKey: 'territory_setup',
  beats: [
    {
      id: 'method', kind: 'ask',
      title: 'How do you want to add your territories?',
      text: 'You can add them one at a time, or import from an Excel file.',
      answerKey: 'method',
      options: [
        { label: 'Add manually (one by one)', value: 'manual' },
        { label: 'Import from an Excel file', value: 'import', goto: 'import_open' },
      ],
    },

    // ── Manual branch ──
    {
      id: 'levels', kind: 'ask',
      title: 'How many territory levels do you need?',
      text: 'By default OZZO shows up to City. You can go deeper if you assign work by Area.',
      answerKey: 'levels',
      options: [
        { label: 'Country → State → City', value: 'city', badge: 'Default' },
        { label: '…and Area', value: 'area' },
        { label: '…and Area + Sub-area', value: 'subarea' },
      ],
    },
    { id: 'check_levels', kind: 'check', flag: 'needsMoreLevels', ifTrue: 'open_config_tab', ifFalse: 'add_btn' },
    {
      id: 'open_config_tab', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-tab-config"]',
      title: 'Open “Hierarchy & assignment”', text: 'Your territory levels live under this tab. Click it to open the level settings.',
      advanceOn: 'click',
    },
    {
      id: 'enable_levels', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-levels"]',
      title: 'Turn on the levels you need', text: 'Switch on Area (and Sub-area), Save, then click Next to continue.',
      advanceOn: 'next',
    },
    {
      id: 'open_tree_tab', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-tab-tree"]',
      title: 'Back to “Manage territories”', text: 'Now let’s add your territory — click this tab.',
      advanceOn: 'click', goto: 'add_btn',
    },
    {
      id: 'add_btn', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-add"]',
      title: 'Click here to add a territory', text: 'This opens the add-territory form.',
      advanceOn: 'click',
    },
    {
      id: 'teach_autofill', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-city"]',
      title: 'Just type your city', text: 'Type the city name — the state and country fill in automatically. Save it, and you are done.',
      advanceOn: 'next', goto: 'complete', optional: true,
    },

    // ── Import branch ──
    {
      id: 'import_open', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-import"]',
      title: 'Click here to import', text: 'Open the Excel import.',
      advanceOn: 'click',
    },
    {
      id: 'import_file', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-import-file"]',
      title: 'Choose your Excel file', text: 'Pick your file, then click Next.',
      advanceOn: 'next', optional: true,
    },
    {
      id: 'import_save', kind: 'spotlight',
      page: '/territories', anchor: '[data-tour="territory-import-save"]',
      title: 'Click Save to import', text: 'If any rows show an error, fix them in your file and import again.',
      advanceOn: 'next', goto: 'complete', optional: true,
    },

    { id: 'complete', kind: 'complete', title: 'Territories set up 🎉', text: 'Nice — back to your setup checklist.' },
  ],
};

// The Customers handholding tour. DATA-DRIVEN: unlike Territory it never
// force-completes the step (markDone:false) — the real customer_count validation
// ticks it green once a customer actually exists. Area-wise accounts get an extra
// beat spotlighting the territory picker (a territory is mandatory there).
export const customersTour: TourScript = {
  id: 'customers',
  stepKey: 'customer_creation',
  beats: [
    {
      id: 'method', kind: 'ask',
      title: 'How do you want to add your customers?',
      text: 'Add one at a time, or bulk-import from an Excel/CSV file.',
      answerKey: 'method',
      options: [
        { label: 'Add manually (one by one)', value: 'manual', goto: 'add_customer' },
        { label: 'Import from a spreadsheet', value: 'import', goto: 'import_open' },
      ],
    },

    // ── Manual branch ──
    {
      id: 'add_customer', kind: 'spotlight',
      page: '/contacts', anchor: '[data-tour="customer-add"]',
      title: 'Click here to add a customer', text: 'This opens the new-customer form.',
      advanceOn: 'click',
    },
    { id: 'check_area', kind: 'check', flag: 'areaWise', ifTrue: 'pick_territory', ifFalse: 'save_customer' },
    {
      id: 'pick_territory', kind: 'spotlight',
      page: '/contacts/new', anchor: '[data-tour="customer-territory"]',
      title: 'Assign this customer’s area/territory',
      text: 'Because you assign customers area-wise, every customer needs a territory — that’s how a rep gets linked to them. Pick it here.',
      advanceOn: 'next', optional: true,
    },
    {
      id: 'save_customer', kind: 'spotlight',
      page: '/contacts/new', anchor: '[data-shortcut="save"]',
      title: 'Fill the details, then Save', text: 'Enter the customer’s name & phone (and territory), then click Create Customer to save.',
      // advanceOn 'click' (not 'next') so the tour only moves on when they actually
      // click Save — no generic Next button to skip past without doing anything.
      advanceOn: 'click', optional: true, goto: 'done',
    },

    // ── Import branch ──
    {
      id: 'import_open', kind: 'spotlight',
      page: '/contacts', anchor: '[data-tour="customer-import"]',
      title: 'Click here to import', text: 'Open the spreadsheet import.',
      advanceOn: 'click',
    },
    {
      id: 'import_upload', kind: 'spotlight',
      page: '/contacts', anchor: '[data-tour="import-upload"]',
      title: 'Upload your file', text: 'Choose your CSV/Excel and follow the on-screen steps (map columns → preview → import) to finish.',
      advanceOn: 'next', optional: true, goto: 'done',
    },

    // Data-driven end: does NOT mark the step done, so the wording must NOT claim a
    // customer was created — it only tells them what completes the step.
    { id: 'done', kind: 'complete', title: 'That’s how you add customers', text: 'This step turns green automatically once your first customer is saved.', markDone: false },
  ],
};

// The Roles handholding tour. Data-driven (role_count decides completion).
export const rolesTour: TourScript = {
  id: 'roles',
  stepKey: 'role_creation',
  beats: [
    {
      id: 'add_role', kind: 'spotlight',
      page: '/team/roles', anchor: '[data-tour="role-add"]',
      title: 'Click “New Role”', text: 'Roles decide what each employee can see and do (e.g. Field Rep, Manager).',
      advanceOn: 'click',
    },
    {
      id: 'name_role', kind: 'spotlight',
      page: '/team/roles', anchor: '[data-tour="role-name"]',
      title: 'Name the role', text: 'e.g. “Field Rep”. Then tick the permissions this role should have below.',
      advanceOn: 'next', optional: true,
    },
    {
      id: 'save_role', kind: 'spotlight',
      page: '/team/roles', anchor: '[data-tour="role-save"]',
      title: 'Save the role', text: 'Once you’ve set the name and permissions, click Save Role.',
      advanceOn: 'click', optional: true, goto: 'done',
    },
    { id: 'done', kind: 'complete', title: 'That’s how you create roles', text: 'This step turns green automatically once your first role is saved.', markDone: false },
  ],
};

// The Employees handholding tour. Data-driven (employee_count decides completion).
export const employeesTour: TourScript = {
  id: 'employees',
  stepKey: 'employee_creation',
  beats: [
    {
      id: 'add_employee', kind: 'spotlight',
      page: '/team/employees', anchor: '[data-tour="employee-add"]',
      title: 'Click “Add Employee”', text: 'This opens the new-employee form. Each employee gets a mobile login.',
      advanceOn: 'click',
    },
    { id: 'check_area', kind: 'check', flag: 'areaWise', ifTrue: 'assign_area', ifFalse: 'save_employee' },
    {
      id: 'assign_area', kind: 'spotlight',
      page: '/team/employees/new', anchor: '[data-tour="employee-area"]',
      title: 'Assign this employee’s area',
      text: 'You assign customers area-wise, so give each field employee their territory here — that’s how they get the customers in that area. (Office/manager staff can be left blank.)',
      advanceOn: 'next', optional: true,
    },
    {
      id: 'save_employee', kind: 'spotlight',
      page: '/team/employees/new', anchor: '[data-shortcut="save"]',
      title: 'Fill the details, then Create', text: 'Enter the employee’s name, mobile number and role, then click Create Employee to save.',
      advanceOn: 'click', optional: true, goto: 'done',
    },
    { id: 'done', kind: 'complete', title: 'That’s how you add employees', text: 'This step turns green automatically once your first employee is added.', markDone: false },
  ],
};

// The See-live-data tour. A light, observational walk — data-driven completion.
export const seeLiveDataTour: TourScript = {
  id: 'see_live_data',
  stepKey: 'see_live_data',
  beats: [
    { id: 'go', kind: 'navigate', page: '/location-tracking/overview' },
    {
      id: 'show', kind: 'spotlight',
      page: '/location-tracking/overview', anchor: '[data-tour="live-data"]',
      title: 'Your live field data shows here',
      text: 'Once your team logs in on mobile and starts working, attendance, visits and tracking appear here in real time.',
      advanceOn: 'next', optional: true, goto: 'done',
    },
    { id: 'done', kind: 'complete', title: 'You’re ready to go live', text: 'This step turns green automatically once real field data starts flowing.', markDone: false },
  ],
};

export const TOURS: Record<string, TourScript> = {
  [territoryTour.id]: territoryTour,
  [customersTour.id]: customersTour,
  [rolesTour.id]: rolesTour,
  [employeesTour.id]: employeesTour,
  [seeLiveDataTour.id]: seeLiveDataTour,
};

// Getting Started step_key → tour id (only steps that have a guided tour).
export const STEP_TOURS: Record<string, string> = {
  territory_setup: 'territory',
  customer_creation: 'customers',
  role_creation: 'roles',
  employee_creation: 'employees',
  see_live_data: 'see_live_data',
};
