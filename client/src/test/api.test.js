import { describe, it, expect } from 'vitest'
import { contactsApi } from '../api/contactsApi'
import { dealsApi } from '../api/dealsApi'
import { invoicesApi } from '../api/invoicesApi'

describe('API modules', () => {
  it('contactsApi has expected methods', () => {
    expect(contactsApi).toHaveProperty('getAll')
    expect(contactsApi).toHaveProperty('getById')
    expect(contactsApi).toHaveProperty('create')
    expect(contactsApi).toHaveProperty('update')
    expect(contactsApi).toHaveProperty('delete')
    expect(contactsApi).toHaveProperty('export')
    expect(contactsApi).toHaveProperty('enrich')
  })

  it('dealsApi has expected methods', () => {
    expect(dealsApi).toHaveProperty('getAll')
    expect(dealsApi).toHaveProperty('getById')
    expect(dealsApi).toHaveProperty('create')
    expect(dealsApi).toHaveProperty('update')
    expect(dealsApi).toHaveProperty('delete')
    expect(dealsApi).toHaveProperty('updateStage')
  })

  it('invoicesApi has expected methods', () => {
    expect(invoicesApi).toHaveProperty('getAll')
    expect(invoicesApi).toHaveProperty('create')
    expect(invoicesApi).toHaveProperty('update')
    expect(invoicesApi).toHaveProperty('delete')
    expect(invoicesApi).toHaveProperty('createPaymentLink')
  })
})
