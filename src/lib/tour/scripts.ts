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

export const TOURS: Record<string, TourScript> = {
  [territoryTour.id]: territoryTour,
};

// Getting Started step_key → tour id (only steps that have a guided tour).
export const STEP_TOURS: Record<string, string> = {
  territory_setup: 'territory',
};
