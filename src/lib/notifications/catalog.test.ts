import { describe, expect, it } from 'vitest'
import { extractActorRawId, buildContent } from './catalog'

// Guards the two actor regressions fixed in the 2026-09-19 QA pass:
//  - order_created must name the creator (orders.user_id), not "A team member".
//  - task_completed's actor is the COMPLETER (assigned_user_id), not the creator,
//    so an admin who created the task isn't self-skipped out of the alert.
describe('extractActorRawId', () => {
  const A = '11111111-1111-1111-1111-111111111111'
  const B = '22222222-2222-2222-2222-222222222222'

  it('order_created → orders.user_id (the creator)', () => {
    expect(extractActorRawId('order_created', { user_id: A })).toBe(A)
  })

  it('task_completed → assigned_user_id (the completer), falling back to creator', () => {
    expect(extractActorRawId('task_completed', { user_id: A, assigned_user_id: B })).toBe(B)
    expect(extractActorRawId('task_completed', { user_id: A })).toBe(A)
  })

  it('task_assigned still uses the creator/assigner', () => {
    expect(extractActorRawId('task_assigned', { user_id: A, assigned_user_id: B })).toBe(A)
  })
})

describe('buildContent order_created', () => {
  it('names the actor when known', () => {
    const { body } = buildContent('order_created', { order_number: 'SO-1' }, 'Dhaval Vegad')
    expect(body).toContain('Dhaval Vegad')
  })
  it('falls back to a generic actor when unknown', () => {
    const { body } = buildContent('order_created', { order_number: 'SO-1' }, null)
    expect(body).toContain('A team member')
  })
})
