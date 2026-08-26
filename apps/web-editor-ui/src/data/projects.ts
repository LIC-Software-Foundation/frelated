export const PROJECTS_STORAGE_KEY = 'web-editor-projects';

export const DEFAULT_FIGURES_FOLDER = 'figures';

export const SUPPORTED_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'pdf',
];

export const MINIMAL_LATEX_TEMPLATE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}

\\title{__PROJECT_NAME__}
\\author{Auteur}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Votre introduction ici.

\\end{document}`;
