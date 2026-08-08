# Third-Party Notices

Siftmark source code itself is not offered under an open-source license. The following third-party packages, fonts, icons, and their transitive runtime dependencies retain their own licenses. Versions are resolved from `pnpm-lock.yaml` for the `0.1.0` production dependency graph.

## Fonts (SIL Open Font License 1.1)

- `@fontsource-variable/noto-sans-sc@5.3.0` / Noto Sans SC
- `@fontsource-variable/space-grotesk@5.3.0` / Space Grotesk

The complete OFL text is present after install at each package's `LICENSE` file. Fontsource packages redistribute the font files; reserved font names and modification rules remain governed by OFL-1.1.

## Apache License 2.0

- `dexie@4.4.4`

License text: <https://www.apache.org/licenses/LICENSE-2.0>

## ISC License

- `lucide-react@0.468.0`
- `inherits@2.0.4`

Copyright notices and the ISC permission/disclaimer text are retained in the installed packages. Lucide icons used by Siftmark remain under the Lucide ISC license.

## MIT License

Direct runtime packages:

- `@tanstack/react-virtual@3.14.9`
- `lottie-react@2.4.1`
- `minisearch@7.2.0`
- `react@18.3.1`
- `react-dom@18.3.1`
- `zod@3.25.76`
- `zustand@5.0.14`

Transitive runtime packages:

- `@tanstack/virtual-core@3.17.7`
- `@types/prop-types@15.7.15`, `@types/react@18.3.31`, `csstype@3.2.3`
- `core-util-is@1.0.3`, `immediate@3.0.6`, `isarray@1.0.0`, `js-tokens@4.0.0`, `lie@3.3.0`, `loose-envify@1.4.0`
- `lottie-web@5.13.0`
- `process-nextick-args@2.0.1`, `readable-stream@2.3.8`, `safe-buffer@5.1.2`, `scheduler@0.23.2`, `setimmediate@1.0.5`, `string_decoder@1.1.1`, `util-deprecate@1.0.2`

MIT permission notice and warranty disclaimer:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

Individual copyright holders are listed in the corresponding installed package `LICENSE` files.

## Dual/Combined Licenses

- `jszip@3.10.1`: MIT OR GPL-3.0-or-later. Siftmark uses JSZip under the MIT option. <https://github.com/Stuk/jszip/blob/main/LICENSE.markdown>
- `pako@1.0.11`: MIT AND Zlib. Both notices are retained by the package. <https://github.com/nodeca/pako/blob/master/LICENSE>

## Original Project Assets

The Siftmark brand mark and JSON animation assets under `assets/` were created for this project and are not MarkAI assets. UI symbols supplied by Lucide are covered by the ISC notice above. No remote font, icon, animation, or image CDN is used at runtime.

## Verification

From an installed workspace, regenerate the production inventory with:

```powershell
pnpm licenses list --prod --json
```

If the lockfile changes, update this notice before packaging. Package-specific license files in `node_modules` are authoritative if an abbreviated notice here differs from an upstream license.
