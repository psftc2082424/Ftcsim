import { describe, expect, it } from 'vitest';
import { createControlInput } from '../../core/control/controlInput.js';
import { fieldCentricInput } from './driveMode.js';

describe('field-centric controls', () => {
  it('maps screen-up forward to a left strafe for a robot facing +X', () => {
    const input = fieldCentricInput(createControlInput(1, 0, 0), 0);
    expect(input.drive.x).toBeCloseTo(0, 12);
    expect(input.drive.y).toBeCloseTo(1, 12);
  });

  it('keeps the field direction fixed as the robot turns', () => {
    const input = fieldCentricInput(createControlInput(1, 0, -0.4, { intake: true }), Math.PI / 2);
    expect(input.drive.x).toBeCloseTo(1, 12);
    expect(input.drive.y).toBeCloseTo(0, 12);
    expect(input.drive.turn).toBe(-0.4);
    expect(input.buttons).toEqual({ intake: true });
  });
});
