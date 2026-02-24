import { Language } from '../../types';

export interface SectionProps {
  config: Record<string, any>;
  setField: (path: string[], value: any) => void;
  getField: (path: string[]) => any;
  deleteField: (path: string[]) => void;
  appendToArray: (path: string[], value: any) => void;
  removeFromArray: (path: string[], index: number) => void;
  language: Language;
  save?: () => Promise<boolean>;
}
