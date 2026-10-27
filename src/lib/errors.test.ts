import { describe, expect, it } from 'vitest';
import { errorMessage, isMissingSchemaObject } from './errors';

describe('isMissingSchemaObject', () => {
  it('recognises missing function and table codes', () => {
    expect(isMissingSchemaObject({ code: 'PGRST202', message: 'nope' })).toBe(true);
    expect(isMissingSchemaObject({ code: 'PGRST205', message: 'nope' })).toBe(true);
  });

  it('falls back to the message when no code is present', () => {
    expect(isMissingSchemaObject({ message: 'Could not find the function public.my_profile in the schema cache' })).toBe(true);
    expect(isMissingSchemaObject(new Error('Could not find the table public.messages in the schema cache'))).toBe(true);
  });

  it('does not classify ordinary failures as schema problems', () => {
    expect(isMissingSchemaObject({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingSchemaObject(new Error('Failed to fetch'))).toBe(false);
    expect(isMissingSchemaObject(null)).toBe(false);
    expect(isMissingSchemaObject(undefined)).toBe(false);
  });
});

describe('errorMessage', () => {
  it('prefers a real Error message and otherwise falls back', () => {
    expect(errorMessage(new Error('Network down'))).toBe('Network down');
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage({ message: 'row level security' })).toBe('row level security');
    expect(errorMessage(null, 'Fallback')).toBe('Fallback');
  });
});
