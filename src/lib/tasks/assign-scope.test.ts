import { describe, expect, it } from 'vitest';
import { decideAssignMode, type AssignRights } from './assign-scope';

const none: AssignRights = {
  unrestricted: false,
  assignAll: false,
  assignChild: false,
  assignParent: false,
  hierarchyOn: false,
};

describe('decideAssignMode', () => {
  it('gives an owner/admin everyone', () => {
    expect(decideAssignMode({ ...none, unrestricted: true })).toBe('all');
    // Even with hierarchy off: they are not scoped by it in the first place.
    expect(decideAssignMode({ ...none, unrestricted: true, hierarchyOn: false })).toBe('all');
  });

  it('gives assign_tasks_all everyone, hierarchy or not', () => {
    expect(decideAssignMode({ ...none, assignAll: true })).toBe('all');
    expect(decideAssignMode({ ...none, assignAll: true, hierarchyOn: true })).toBe('all');
  });

  it('gives a user with no assign right only themselves', () => {
    expect(decideAssignMode(none)).toBe('self');
    expect(decideAssignMode({ ...none, hierarchyOn: true })).toBe('self');
  });

  /**
   * The bug this was written for. A Sales Executive holding only
   * `assign_tasks_child` was offered EVERY employee in the company, because
   * the form asked "any of the three rights?" and then showed the whole
   * roster.
   */
  it('keeps a child-only right inside the reporting tree', () => {
    expect(decideAssignMode({ ...none, assignChild: true, hierarchyOn: true })).toBe('tree');
    expect(decideAssignMode({ ...none, assignParent: true, hierarchyOn: true })).toBe('tree');
    expect(
      decideAssignMode({ ...none, assignChild: true, assignParent: true, hierarchyOn: true }),
    ).toBe('tree');
  });

  /**
   * The founder's second condition: "if hierarchy is ON then & then only this
   * task can be done". Without a manager tree a downline is undefined, so the
   * directional rights cannot widen anything.
   */
  it('falls back to self when Reporting Hierarchy is off', () => {
    expect(decideAssignMode({ ...none, assignChild: true, hierarchyOn: false })).toBe('self');
    expect(decideAssignMode({ ...none, assignParent: true, hierarchyOn: false })).toBe('self');
    expect(
      decideAssignMode({ ...none, assignChild: true, assignParent: true, hierarchyOn: false }),
    ).toBe('self');
  });

  it('lets assign_tasks_all beat a missing hierarchy', () => {
    expect(
      decideAssignMode({ ...none, assignAll: true, assignChild: true, hierarchyOn: false }),
    ).toBe('all');
  });
});
