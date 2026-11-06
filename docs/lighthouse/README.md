# Lighthouse reports (mobile, 2026-11-06)

Lighthouse 13.6 with its default mobile profile (Moto G Power, 4x CPU slowdown, slow 4G). Open the `.html` files in a browser.

| Page | Report | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|---|
| `/` landing (live) | `landing-mobile.html` | 89 (86-89 over 4 runs) | 100 | 100 | 100 | 1.3 s | 0 | 410 ms |
| `/pay/iyke` (live) | `pay-mobile.html` | 92 (88-92 over 4 runs) | 100 | 100 | 100 | 1.0 s | 0 | 330 ms |
| `/home` signed in (`pnpm local`, production build) | `home-local-mobile.html` | 91 (89-91) | 100 | 100 | 90 (app pages are `noindex` on purpose) | 1.6 s | 0 | 370 ms |

Before the 2026-11-06 work: landing 87 (accessibility 96), pay page 80 (LCP 3.4 s, CLS 0.026).

What changed: the pay page renders the recipient on the server and loads no signing code; landing links no longer prefetch app code; `@oiko/ui` is side-effect free and loads the QR library only when a QR code is shown; Acorn's fallback font is metric-matched per weight so text doesn't re-wrap when the font loads; low-contrast demo text fixed.

What's left: Total Blocking Time is mostly React hydration on a throttled phone. Scores move by a few points between runs on the same build.

Reproduce:

```bash
npx lighthouse@13.6.0 https://oikodotnear.vercel.app/ --only-categories=performance,accessibility,best-practices,seo --view
```
