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
    { id: 'check_levels', kind: 'check', flag: 'needsMoreLevels', ifTrue: 'enable_levels_nav', ifFalse: 'add_btn' },
    { id: 'enable_levels_nav', kind: 'navigate', page: '/settings?tab=territories' },
    {
      id: 'enable_levels', kind: 'spotlight',
      page: '/settings?tab=territories', anchor: '[data-tour="territory-levels"]',
      title: 'Turn on the levels you need', text: 'Enable Area (and Sub-area), then click Next to continue.',
      advanceOn: 'next', goto: 'back_to_territories',
    },
    { id: 'back_to_territories', kind: 'navigate', page: '/territories', goto: 'add_btn' },
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
