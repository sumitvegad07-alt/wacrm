// Guided-tour engine types. A tour is a declarative list of "beats" that run on
// the REAL app pages (spotlight a real button, ask a branching question, send the
// user to a settings page and back, then mark a Getting Started step complete).

export type Beat =
  | {
      id: string; kind: 'ask';
      title: string; text?: string;
      answerKey: string;
      options: { label: string; value: string; note?: string; badge?: string; goto?: string }[];
    }
  | {
      id: string; kind: 'spotlight';
      page: string;        // pathname the anchor lives on (may include ?query)
      anchor: string;      // CSS selector, e.g. [data-tour="territory-add"]
      title: string; text?: string;
      advanceOn?: 'click' | 'next'; // click the real element, or a "Next" button
      goto?: string;
      optional?: boolean;  // if the anchor never appears, allow Skip
    }
  | { id: string; kind: 'navigate'; page: string; goto?: string }
  | { id: string; kind: 'check'; flag: string; ifTrue: string; ifFalse: string }
  | { id: string; kind: 'complete'; title: string; text?: string };

export interface TourScript {
  id: string;        // e.g. 'territory'
  stepKey: string;   // Getting Started step this tour completes
  beats: Beat[];
}

export interface TourState {
  tourId: string;
  stepId: string;    // impl_steps.id to mark complete on finish
  beatId: string;
  answers: Record<string, string>;
}

export type TourFlags = Record<string, boolean>;
