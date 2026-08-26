import { LogEntry } from '../types';

export const SUCCESS_LOGS: LogEntry[] = [
  {
    level: 'info',
    message:
      'pdfTeX, Version 3.141592653-2.6-1.40.24 (TeX Live 2023) restricted \\write18 enabled.',
  },
  { level: 'info', message: 'Entering extended mode.' },
  { level: 'info', message: 'LaTeX2e <2022-11-01> patch level 1' },
  {
    level: 'info',
    message:
      'Document class: article 2022/07/02 v1.4n Standard LaTeX document class',
  },
  {
    level: 'info',
    message:
      '(/usr/local/texlive/2023/texmf-dist/tex/latex/inputenc/inputenc.sty)',
  },
  {
    level: 'info',
    message:
      '(/usr/local/texlive/2023/texmf-dist/tex/latex/fontenc/fontenc.sty)',
  },
  {
    level: 'warning',
    message:
      'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.',
    file: 'main.tex',
  },
  {
    level: 'info',
    message:
      '[1{/usr/local/texlive/2023/texmf-var/fonts/map/pdftex/updmap/pdftex.map}]',
  },
  {
    level: 'info',
    message: 'Output written on main.pdf (1 page, 18 432 bytes).',
  },
  { level: 'info', message: 'Transcript written on main.log.' },
];

export const ERROR_LOGS: LogEntry[] = [
  {
    level: 'info',
    message: 'pdfTeX, Version 3.141592653-2.6-1.40.24 (TeX Live 2023)',
  },
  { level: 'info', message: 'Entering extended mode.' },
  { level: 'info', message: 'LaTeX2e <2022-11-01> patch level 1' },
  {
    level: 'error',
    message: '! Undefined control sequence \\unknownCmd',
    line: 14,
    file: 'main.tex',
  },
  {
    level: 'error',
    message: '! Missing $ inserted. <inserted text>',
    line: 22,
    file: 'main.tex',
  },
  {
    level: 'warning',
    message:
      'LaTeX Warning: Citation "dupont2023" on page 1 undefined on input line 18.',
    line: 18,
    file: 'main.tex',
  },
  { level: 'info', message: 'Emergency stop.' },
  {
    level: 'error',
    message: 'Fatal error occurred, no output PDF file produced.',
  },
];
