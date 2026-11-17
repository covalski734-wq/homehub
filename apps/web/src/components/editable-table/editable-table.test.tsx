import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditableTable, type Column } from './editable-table';
import { validateMoney, validateRequired } from './validators';

interface Row {
  id: string;
  name: string;
  amount: string;
}

const columns: Column<Row>[] = [
  {
    key: 'name',
    header: 'Название',
    editor: 'text',
    value: (r) => r.name,
    validate: validateRequired,
    mobile: 'title',
  },
  {
    key: 'amount',
    header: 'Сумма',
    editor: 'money',
    value: (r) => r.amount,
    validate: validateMoney,
    mobile: 'amount',
  },
];

function setup(overrides: Partial<Parameters<typeof EditableTable<Row>>[0]> = {}) {
  const onCommit = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue(undefined);
  const rows = [
    { id: 'a', name: 'Аренда', amount: '3000.00' },
    { id: 'b', name: 'Интернет', amount: '60.00' },
  ];
  render(
    <EditableTable<Row>
      label="Тест"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onCommit={onCommit}
      draft={{
        addLabel: 'Добавить',
        defaults: { name: '', amount: '' },
        required: ['name', 'amount'],
        create,
      }}
      {...overrides}
    />,
  );
  // Desktop grid and phone cards both render; the grid comes first.
  const amounts = () => screen.getAllByRole('textbox', { name: 'Сумма' });
  return { onCommit, create, amounts };
}

describe('EditableTable', () => {
  it('saves a changed cell on Enter and moves to the same column of the next row', async () => {
    const user = userEvent.setup();
    const { onCommit, amounts } = setup();
    await user.clear(amounts()[0]!);
    await user.type(amounts()[0]!, '3100{Enter}');
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'amount', '3100');
    expect(amounts()[1]).toHaveFocus();
    // Enter saved; the blur caused by moving focus must not save the same value again.
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('saves on Enter in the last row too (no next row to move to)', async () => {
    const user = userEvent.setup();
    const { onCommit, amounts } = setup();
    await user.clear(amounts()[1]!);
    await user.type(amounts()[1]!, '65{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), 'amount', '65');
  });

  it('never sends a value discarded with Escape', async () => {
    const user = userEvent.setup();
    const { onCommit, amounts } = setup();
    await user.clear(amounts()[0]!);
    await user.type(amounts()[0]!, '999{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(amounts()[0]).toHaveValue('3000.00');
  });

  it('does not save unchanged values', async () => {
    const user = userEvent.setup();
    const { onCommit, amounts } = setup();
    await user.click(amounts()[0]!);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('rejects invalid input locally and restores the saved value on Escape', async () => {
    const user = userEvent.setup();
    const { onCommit, amounts } = setup();
    await user.clear(amounts()[0]!);
    await user.type(amounts()[0]!, 'abc');
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(amounts()[0]).toHaveAttribute('aria-invalid', 'true');
    await user.click(amounts()[0]!);
    await user.keyboard('{Escape}');
    expect(amounts()[0]).toHaveValue('3000.00');
    expect(amounts()[0]).not.toHaveAttribute('aria-invalid');
  });

  it('shows the server error and keeps the typed value', async () => {
    const user = userEvent.setup();
    const { amounts } = setup({
      onCommit: vi.fn().mockRejectedValue(new Error('Строку уже изменили')),
    });
    await user.clear(amounts()[0]!);
    await user.type(amounts()[0]!, '1{Enter}');
    await waitFor(() => expect(amounts()[0]).toHaveAttribute('aria-invalid', 'true'));
    expect(amounts()[0]).toHaveValue('1');
    expect(screen.getByText('Есть несохраненные изменения')).toBeInTheDocument();
  });

  it('creates a row from the "+" draft only when required cells are filled', async () => {
    const user = userEvent.setup();
    const { create } = setup();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    const names = screen.getAllByRole('textbox', { name: 'Название' });
    const draftName = names[2]!;
    await waitFor(() => expect(draftName).toHaveFocus());
    await user.type(draftName, 'Netflix{Enter}');
    expect(create).not.toHaveBeenCalled();
    const draftAmount = screen.getAllByRole('textbox', { name: 'Сумма' })[2]!;
    await user.type(draftAmount, '49{Enter}');
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Netflix', amount: '49' }));
    // Enter and the blur it causes must not create the row twice.
    expect(create).toHaveBeenCalledTimes(1);
  });
});

it('sums selected monetary rows independently of edits and excludes search-hidden rows', async () => {
  const user = userEvent.setup();
  const { onCommit } = setup({
    columns: columns.map((c) => (c.key === 'amount' ? { ...c, suffix: () => 'PLN' } : c)),
    searchText: (r) => r.name,
  });
  await user.click(screen.getByRole('checkbox', { name: /Выбрать все/ }));
  expect(screen.getByText(/3.*060/)).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Поиск' }), 'Интернет');
  expect(screen.queryByText(/3.*060/)).not.toBeInTheDocument();
  expect(screen.getByText(/Выбрано: 1/)).toBeInTheDocument();
  expect(onCommit).not.toHaveBeenCalled();
});

it('keeps currencies separate and excludes percent fields from money totals', async () => {
  const user = userEvent.setup();
  setup({
    rows: [
      { id: 'a', name: 'PLN row', amount: '0.10' },
      { id: 'b', name: 'EUR row', amount: '0.20' },
      { id: 'c', name: 'Rate', amount: '15' },
    ],
    columns: columns.map((c) =>
      c.key === 'amount'
        ? { ...c, suffix: (r: Row) => (r.id === 'a' ? 'PLN' : r.id === 'b' ? 'EUR' : '%') }
        : c,
    ),
  });
  await user.click(screen.getByRole('checkbox', { name: /Выбрать все/ }));
  expect(screen.getByText(/0,20.*€.*0,10.*PLN/)).toBeInTheDocument();
  expect(screen.getByText(/Выбрано: 3/)).toBeInTheDocument();
});
