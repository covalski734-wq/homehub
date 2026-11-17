import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { applyServerErrors } from './form-errors';

describe('applyServerErrors', () => {
  it('maps known field issues onto form fields', () => {
    const setError = vi.fn();
    const error = new ApiError(400, {
      error: 'VALIDATION_FAILED',
      message: 'Проверьте введенные данные',
      issues: [
        { path: 'amount', code: 'VALIDATION_AMOUNT_POSITIVE', message: 'stale server text' },
      ],
    });
    expect(applyServerErrors(error, setError, ['amount'])).toBeNull();
    expect(setError).toHaveBeenCalledWith('amount', {
      type: 'server',
      message: 'Сумма должна быть больше нуля',
    });
  });

  it('returns unmatched issues as a form-level message', () => {
    const setError = vi.fn();
    const error = new ApiError(400, {
      error: 'VALIDATION_FAILED',
      issues: [
        { path: '', code: 'VALIDATION_NO_CHANGES', message: 'Нет изменений' },
        {
          path: 'note',
          code: 'VALIDATION_TOO_LONG',
          params: { maximum: 500 },
          message: 'Не более 500 символов',
        },
      ],
    });
    expect(applyServerErrors(error, setError, ['amount'])).toBe(
      'Нет изменений. Не более 500 символов',
    );
  });

  it('returns the translated code for business errors', () => {
    const error = new ApiError(422, {
      error: 'FINANCE_ACCOUNT_NAMED_ARCHIVED',
      params: { name: 'Карта' },
      message: 'stale server text',
    });
    expect(applyServerErrors(error, vi.fn(), [])).toBe('Счет «Карта» в архиве');
  });
});
