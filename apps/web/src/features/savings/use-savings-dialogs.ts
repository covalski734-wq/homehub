import type { PotDto, PotKind } from '@homehub/shared';
import { useState } from 'react';
import type { AutoDialogState } from './auto-dialog';
import type { MovementDialogState } from './movement-dialog';
import type { PartDialogState } from './part-dialog';
import type { PlanDialogState } from './plan-dialog';
import type { PotDialogState } from './pot-dialog';
import type { PositionDialogState } from './position-dialog';

/** A dialog that is open with its subject, or closed (null). */
function useDialog<T>() {
  const [state, setState] = useState<T | null>(null);
  return { state, open: (value: T) => setState(value), close: () => setState(null) };
}

/** Which dialog of the savings page is open, and for what. */
export function useSavingsDialogs() {
  // The pot dialog keeps its subject while closing, so the title does not jump.
  const [potState, setPotState] = useState<PotDialogState>({
    open: false,
    pot: null,
    kind: 'CASH',
  });
  return {
    pot: {
      state: potState,
      create: (kind: PotKind) => setPotState({ open: true, pot: null, kind }),
      edit: (pot: PotDto) => setPotState({ open: true, pot, kind: pot.kind }),
      close: () => setPotState((s) => ({ ...s, open: false })),
    },
    movement: useDialog<MovementDialogState>(),
    part: useDialog<PartDialogState>(),
    plan: useDialog<PlanDialogState>(),
    auto: useDialog<AutoDialogState>(),
    position: useDialog<PositionDialogState>(),
    deleting: useDialog<PotDto>(),
  };
}
