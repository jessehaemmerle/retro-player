import type { Design } from './base';
import { Turntable } from './turntable';
import { Boombox } from './boombox';
import { Amplifier } from './amplifier';
import { Walkman } from './walkman';
import { Discman } from './discman';

export interface DesignEntry {
  id: string;
  name: string;
  short: string;
  create: () => Design;
}

export const DESIGNS: DesignEntry[] = [
  { id: 'turntable', name: 'Plattenspieler', short: 'Platte', create: () => new Turntable() },
  { id: 'boombox', name: 'Boombox', short: 'Boombox', create: () => new Boombox() },
  { id: 'amplifier', name: 'Receiver', short: 'Receiver', create: () => new Amplifier() },
  { id: 'walkman', name: 'Walkman', short: 'Walkman', create: () => new Walkman() },
  { id: 'discman', name: 'Discman', short: 'Discman', create: () => new Discman() },
];
