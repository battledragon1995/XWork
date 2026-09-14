# Wireframe fonts

Self-hosted WOFF2 subsets downloaded on 2026-09-14 from the Google Fonts CSS API used by `00-Docs/01-Wireframe/assets/wireframe.css`. Runtime makes no external font request. Latin, extended Latin and Vietnamese subsets preserve the English UI and Vietnamese project/note text; other scripts use the existing system fallbacks.

| Family | Weights | Source and license |
|---|---|---|
| Cormorant Garamond | 500–600 | [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond), [OFL](cormorantgaramond-OFL.txt) |
| Inter | 400–600 | [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/inter), [OFL](inter-OFL.txt) |
| JetBrains Mono | 400–500 | [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono), [OFL](jetbrainsmono-OFL.txt) |

The original files are unmodified. Google Fonts returns the same variable-font URL for each requested weight within a family/subset; `fonts.css` declares that range once per subset.
