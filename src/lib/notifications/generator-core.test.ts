import { describe, expect, it } from 'vitest'
import {
  decideRecipients,
  holdsCategoryRight,
  isActive,
  isAdminRole,
  type CandidateProfile,
} from './generator-core'

function profile(over: Partial<CandidateProfile> & { id: string }): CandidateProfile {
  return { accountRole: 'agent', status: 'active', permissions: null, ...over }
}

function world(profiles: CandidateProfile[]): Map<string, CandidateProfile> {
  return new Map(profiles.map((p) => [p.id, p]))
}

describe('isAdminRole / isActive', () => {
  it('owner and admin are all-true roles', () => {
    expect(isAdminRole('owner')).toBe(true)
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('agent')).toBe(false)
    expect(isAdminRole(null)).toBe(false)
  })
  it('only explicit inactive is inactive (null counts as active)', () => {
    expect(isActive('active')).toBe(true)
    expect(isActive(null)).toBe(true)
    expect(isActive('inactive')).toBe(false)
  })
})

describe('holdsCategoryRight', () => {
  it('admins hold every category right without an explicit grant', () => {
    const p = profile({ id: 'a', accountRole: 'admin', permissions: null })
    expect(holdsCategoryRight(p, 'team_activity')).toBe(true)
  })
  it('an agent needs the explicit right', () => {
    const withoutRight = profile({ id: 'b', permissions: { view_leads: true } })
    const withRight = profile({ id: 'c', permissions: { receive_task_notifications: true } })
    expect(holdsCategoryRight(withoutRight, 'task')).toBe(false)
    expect(holdsCategoryRight(withRight, 'task')).toBe(true)
  })
  it("respects the has_permission string-'true' storage quirk", () => {
    const p = profile({ id: 'd', permissions: { receive_assignment_notifications: 'true' } })
    expect(holdsCategoryRight(p, 'assignment')).toBe(true)
  })
})

describe('decideRecipients', () => {
  it('notifies an assignee who holds the right and is not the actor', () => {
    const assignee = profile({ id: 'u1', permissions: { receive_task_notifications: true } })
    const out = decideRecipients({
      category: 'task',
      candidateIds: ['u1'],
      actorProfileId: 'someone-else',
      profilesById: world([assignee]),
      mutedIds: new Set(),
    })
    expect(out).toEqual(['u1'])
  })

  it('skips the actor even when they would otherwise qualify (self-skip)', () => {
    const u = profile({ id: 'u1', permissions: { receive_task_notifications: true } })
    const out = decideRecipients({
      category: 'task',
      candidateIds: ['u1'],
      actorProfileId: 'u1',
      profilesById: world([u]),
      mutedIds: new Set(),
    })
    expect(out).toEqual([])
  })

  it('drops candidates without the right', () => {
    const u = profile({ id: 'u1', permissions: { view_leads: true } })
    const out = decideRecipients({
      category: 'assignment',
      candidateIds: ['u1'],
      actorProfileId: null,
      profilesById: world([u]),
      mutedIds: new Set(),
    })
    expect(out).toEqual([])
  })

  it('drops muted candidates even when they hold the right', () => {
    const u = profile({ id: 'u1', accountRole: 'admin' })
    const out = decideRecipients({
      category: 'team_activity',
      candidateIds: ['u1'],
      actorProfileId: null,
      profilesById: world([u]),
      mutedIds: new Set(['u1']),
    })
    expect(out).toEqual([])
  })

  it('drops inactive candidates', () => {
    const u = profile({ id: 'u1', accountRole: 'admin', status: 'inactive' })
    const out = decideRecipients({
      category: 'team_activity',
      candidateIds: ['u1'],
      actorProfileId: null,
      profilesById: world([u]),
      mutedIds: new Set(),
    })
    expect(out).toEqual([])
  })

  it('dedupes candidates (manager who is also an admin appears once)', () => {
    const mgr = profile({ id: 'm', accountRole: 'admin' })
    const out = decideRecipients({
      category: 'team_activity',
      candidateIds: ['m', 'm'],
      actorProfileId: 'rep',
      profilesById: world([mgr]),
      mutedIds: new Set(),
    })
    expect(out).toEqual(['m'])
  })

  it('team-activity: notifies the admin pool but not the acting rep', () => {
    const admin1 = profile({ id: 'a1', accountRole: 'admin' })
    const admin2 = profile({ id: 'a2', accountRole: 'owner' })
    const rep = profile({ id: 'rep', accountRole: 'agent' })
    const out = decideRecipients({
      category: 'team_activity',
      candidateIds: ['a1', 'a2', 'rep'],
      actorProfileId: 'rep',
      profilesById: world([admin1, admin2, rep]),
      mutedIds: new Set(),
    })
    expect(out.sort()).toEqual(['a1', 'a2'])
  })
})
