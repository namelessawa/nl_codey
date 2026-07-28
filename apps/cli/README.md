# NL_Codey CLI

`nlc` opens the terminal UI or runs one NL_Codey agent task from a terminal.

After installing the package, verify the compiled entry point with:

```powershell
nlc --help
```

The published tarball contains the compiled `dist/index.js` entry and its
`bin/nlc.mjs` launcher. TypeScript source and private workspace packages are
development inputs, not runtime package dependencies.
