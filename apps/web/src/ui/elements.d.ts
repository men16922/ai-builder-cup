import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type Element<T = object> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & T;
type ButtonProps = { disabled?: boolean; href?: string; target?: string; type?: 'button' | 'submit' | 'reset'; 'aria-label'?: string };
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'md-filled-button': Element<ButtonProps>;
      'md-filled-tonal-button': Element<ButtonProps>;
      'md-outlined-button': Element<ButtonProps>;
      'md-text-button': Element<ButtonProps>;
      'md-checkbox': Element<{ checked?: boolean; disabled?: boolean; 'aria-label'?: string }>;
      'md-dialog': Element<{ open?: boolean }>;
      'md-circular-progress': Element<{ indeterminate?: boolean; value?: number; 'four-color'?: boolean }>;
      'md-outlined-select': Element<{ label?: string; value?: string; disabled?: boolean; required?: boolean; 'aria-label'?: string }>;
      'md-select-option': Element<{ value?: string; selected?: boolean; disabled?: boolean }>;
      'md-outlined-text-field': Element<{ label?: string; value?: string; type?: string; rows?: number; disabled?: boolean; placeholder?: string; 'aria-label'?: string; maxlength?: number; 'supporting-text'?: string }>;
    }
  }
}
